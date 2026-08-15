// WS281x pixel output, end to end against a live device.
//
// The interesting assertion here is the framebuffer readback (/pixels/frame). Everything else
// in this file is shape and arithmetic; the readback is what proves a specific channel of a
// specific universe landed on a specific pixel, which is otherwise only visible on a logic
// analyzer. See docs/pixels.md for the mapping model.
import { test, expect } from '@playwright/test';
import { info, waitForState } from './lib/device.mjs';
import { UdpSender, artDmxPacket, e131Packet, sleep, ART_PORT, SACN_PORT, deviceHost } from './lib/net.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';
const skipUnlessWrite = () => test.skip(!WRITE, 'device-mutating: set LUXDMX_WRITE=1 to run');

// A pin that is free on the bench boards. Overridable for a different rig.
const PIX_PIN = +(process.env.LUXDMX_PIXEL_PIN || 38);
// Well clear of the DMX outputs' universes on any of our templates.
const PIX_UNI = +(process.env.LUXDMX_PIXEL_UNI || 40);

let host, base;
test.beforeAll(async () => { host = await deviceHost(); base = 'http://' + host; });

// Applying config live re-points sockets and re-inits the DMX driver, so for a moment after a
// save the device refuses connections, and when the heap is tight it answers 503 {"busy":1}
// rather than risking a bad_alloc in the async task. Both are transient and both used to fail
// a test that happened to poll at the wrong instant, which reads as a firmware bug and is not
// one. Retry instead of asserting on the first answer.
async function getJson(url, tries = 15) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 503) { last = new Error(`${url}: busy`); await sleep(400); continue; }
      return await r.json();
    } catch (e) { last = e; await sleep(400); }
  }
  throw last || new Error('no answer from ' + url);
}

const pixels = async () => getJson(base + '/pixels.json');
const frame  = async (port, cells) =>
  getJson(`${base}/pixels/frame?port=${port}` + (cells ? `&cells=${cells}` : ''));

// Rebuild the whole /config form the way the device expects it: EVERY boolean, because an
// absent checkbox is written false, and dropping `useeth` strands a wired device in its setup
// AP with no way back. Non-bool fields are left out unless we mean to change them -- those the
// handler only writes when present.
async function postConfig(changes, { pixelsOff = false } = {}) {
  const d = await getJson(base + '/info.json');
  const px = await pixels();
  const f = new URLSearchParams();
  const bool = (k, v) => { if (v) f.set(k, '1'); };
  bool('staticip', d.staticIp);   bool('useeth', d.useEthernet);
  bool('ethon', d.ethW5500);      bool('artrdm', d.artnetRdm);
  bool('ipprog', d.ipProg);       bool('encrev', d.encReverse);
  bool('btnah', d.btnActiveHigh);
  d.outputs.forEach((o, i) => bool(`o${i}_en`, o.en));
  if (!pixelsOff) px.ports.forEach((p, i) => bool(`p${i}_en`, p.en));
  for (const [k, v] of Object.entries(changes)) f.set(k, String(v));
  // The POST needs the same tolerance as the reads: a save that lands while the previous one
  // is still re-initialising gets its connection reset mid-response. The write itself is
  // idempotent (the same full form), so retrying is safe.
  let status = 0;
  for (let i = 0; i < 5 && status === 0; i++) {
    try {
      const r = await fetch(base + '/config', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: f });
      status = r.status;
    } catch { await sleep(1200); }
  }
  expect(status, '/config POST accepted').toBeGreaterThan(0);
  expect(status, '/config POST accepted').toBeLessThan(400);
  // Der Apply laeuft bewusst NICHT im Web-Task, sondern verzoegert in loop() (sonst blockiert
  // der Puffer-Neuaufbau die HTTP-Antwort). Also warten, bis das Geraet die Aenderung
  // wirklich zeigt, statt blind zu schlafen -- sonst liest der Test den alten Zustand.
  const wantCount = changes.p0_count != null ? Number(changes.p0_count) : null;
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    try {
      const now = await pixels();
      const p0 = now.ports && now.ports[0];
      if (!p0) continue;
      if (wantCount == null || p0.count === wantCount) break;
    } catch { /* Geraet antwortet gleich wieder */ }
  }
  // The device must never leave the network because of a config write.
  const after = await getJson(base + '/info.json');
  expect(after.useEthernet, 'the POST preserved the wired-Ethernet setting').toBe(d.useEthernet);
}

const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('');

test.describe('Pixel output — shape and arithmetic', () => {
  test('/pixels.json exposes every port with the expected fields', async () => {
    const d = await pixels();
    expect(Array.isArray(d.ports)).toBeTruthy();
    expect(d.ports.length).toBeGreaterThanOrEqual(1);
    expect(d).toHaveProperty('railMa');
    expect(d).toHaveProperty('backend');
    for (const p of d.ports)
      for (const k of ['en', 'pin', 'count', 'chip', 'order', 'uni', 'start', 'uniMode',
                       'latch', 'bright', 'gamma', 'maxMa', 'spans', 'ma', 'worstMa',
                       'scale', 'lost', 'maxFps'])
        expect(p, `port missing "${k}"`).toHaveProperty(k);
  });

  test('the reported frame-rate ceiling matches the wire, not a guess', async () => {
    const d = await pixels();
    for (const p of d.ports) {
      if (p.count <= 0) continue;
      // 24 bits x 1.25 us = 30 us per RGB pixel; RGBW is 32 bits. The device works this out
      // itself and the UI shows it live, so a wrong figure here would mislead every user
      // choosing a pixel count.
      const bpp = p.chip === 2 ? 4 : 3;
      const perPixelNs = bpp * 8 * (p.chip === 1 ? 2500 : 1250);
      const want = Math.floor(1000000 / (Math.floor(perPixelNs * p.count / 1000) + 300));
      expect(Math.abs(p.maxFps - want), `port maxFps for ${p.count} px`).toBeLessThanOrEqual(1);
    }
  });

  test('a disabled port allocates nothing and reports no draw', async () => {
    const d = await pixels();
    for (const p of d.ports)
      if (!p.en) { expect(p.spans).toBe(0); expect(p.ma).toBe(0); }
  });

  test('the settings page renders a card per pixel port', async ({ page }) => {
    await page.goto('/config');
    await page.waitForFunction(() => document.querySelectorAll('.pix-card').length > 0,
                               null, { timeout: 10000 });
    const n = (await pixels()).ports.length;
    await expect(page.locator('.pix-card')).toHaveCount(n);
    for (const f of ['p0_pin', 'p0_count', 'p0_uni', 'p0_start', 'p0_chip', 'p0_order'])
      await expect(page.locator(`[name="${f}"]`)).toHaveCount(1);
  });

  test('the planner states the universe span and the next free universe', async ({ page }) => {
    await page.goto('/config');
    await page.waitForFunction(() => document.querySelectorAll('.pix-card').length > 0,
                               null, { timeout: 10000 });
    // 400 RGB pixels is 1200 channels = three universes. The user should never have to work
    // that out, so the page says it.
    await page.locator('#p0_en').check();
    await page.locator('[name="p0_count"]').fill('400');
    await page.locator('[name="p0_uni"]').fill('7');
    await page.locator('[name="p0_count"]').dispatchEvent('input');
    await expect(page.locator('.pix-card').first().locator('.pix-span')).toContainText('3 universes');
    await expect(page.locator('#pix-plan')).toContainText('universes 7-9');
    await expect(page.locator('#pix-plan')).toContainText('Next free universe: 10');
  });
});

test.describe('Pixel output — mapping on a live device (LUXDMX_WRITE=1)', () => {
  let restore = null;

  test.beforeAll(async () => {
    if (!WRITE) return;
    const px = await pixels();
    restore = px.ports[0];
  });
  test.afterAll(async () => {
    if (!WRITE || !restore) return;
    await postConfig({
      p0_pin: restore.pin, p0_count: restore.count, p0_uni: restore.uni,
      p0_start: restore.start, p0_chip: restore.chip, p0_order: restore.order,
      p0_gamma: restore.gamma, p0_bright: restore.bright, p0_maxma: restore.maxMa,
      p0_unimode: restore.uniMode, p0_latch: restore.latch,
    }, { pixelsOff: !restore.en });
  });

  test('Art-Net lands on the right pixel, byte for byte', async () => {
    skipUnlessWrite();
    await postConfig({ p0_en: 1, p0_pin: PIX_PIN, p0_count: 8, p0_uni: PIX_UNI, p0_start: 1,
                       p0_chip: 0, p0_order: 1, p0_gamma: 0, p0_bright: 255, p0_maxma: 0 });
    const px = await pixels();
    expect(px.ports[0].en, 'port 0 enabled').toBe(true);
    expect(px.backend, 'a backend claimed the port').not.toBe('none');

    const s = new UdpSender(host);
    const data = Buffer.alloc(512);
    const want = [];
    for (let i = 0; i < 8; i++) {
      data[i * 3] = 10 * i + 1; data[i * 3 + 1] = 10 * i + 2; data[i * 3 + 2] = 10 * i + 3;
      want.push(10 * i + 1, 10 * i + 2, 10 * i + 3);
    }
    for (let n = 0; n < 30; n++) { await s.send(ART_PORT, artDmxPacket(PIX_UNI, data, n)); await sleep(25); }
    s.close();

    const f = await frame(0);
    expect(f.bpp).toBe(3);
    expect(f.count).toBe(8);
    expect(f.px, 'every channel mapped exactly').toBe(hex(want));
  });

  test('a port spanning two universes stitches them in the right order', async () => {
    skipUnlessWrite();
    // 200 RGB pixels = 600 channels: 170 in the first universe, 30 in the second.
    await postConfig({ p0_en: 1, p0_pin: PIX_PIN, p0_count: 200, p0_uni: PIX_UNI, p0_start: 1,
                       p0_chip: 0, p0_order: 1, p0_gamma: 0, p0_bright: 255, p0_maxma: 0 });
    expect((await pixels()).ports[0].spans, '200 RGB px spans two universes').toBe(2);

    const s = new UdpSender(host);
    const a = Buffer.alloc(512).fill(0x11);      // universe N   -> pixels 1..170
    const b = Buffer.alloc(512).fill(0x22);      // universe N+1 -> pixels 171..200
    for (let n = 0; n < 30; n++) {
      await s.send(ART_PORT, artDmxPacket(PIX_UNI, a, n));
      await s.send(ART_PORT, artDmxPacket(PIX_UNI + 1, b, n));
      await sleep(25);
    }
    s.close();

    const f = await frame(0);
    const bytes = f.px.match(/../g).map((h) => parseInt(h, 16));
    expect(bytes[0], 'first pixel comes from the first universe').toBe(0x11);
    expect(bytes[169 * 3], 'pixel 170 is still the first universe').toBe(0x11);
    expect(bytes[170 * 3], 'pixel 171 comes from the second universe').toBe(0x22);
    expect(bytes[199 * 3], 'the last pixel too').toBe(0x22);
  });

  test('sACN feeds a pixel port the same as Art-Net', async () => {
    skipUnlessWrite();
    await postConfig({ p0_en: 1, p0_pin: PIX_PIN, p0_count: 4, p0_uni: PIX_UNI, p0_start: 1,
                       p0_chip: 0, p0_order: 1, p0_gamma: 0, p0_bright: 255, p0_maxma: 0 });
    const s = new UdpSender(host);
    const data = Buffer.alloc(512);
    for (let i = 0; i < 12; i++) data[i] = 0x40 + i;
    // sACN universe = our universe + 1 (E1.31 counts from 1). Unicast: multicast does not
    // cross the bench boundary, see the HIL notes in README.
    for (let n = 0; n < 30; n++) { await s.send(SACN_PORT, e131Packet(PIX_UNI + 1, data, n)); await sleep(25); }
    s.close();
    const f = await frame(0);
    expect(f.px).toBe(hex([...Array(12)].map((_, i) => 0x40 + i)));
  });

  test('the power cap scales the output down and says so', async () => {
    skipUnlessWrite();
    // 100 RGB pixels at 20.00 mA a channel: all-white is 100*3*20 + 100*1 = 6100 mA.
    await postConfig({ p0_en: 1, p0_pin: PIX_PIN, p0_count: 100, p0_uni: PIX_UNI, p0_start: 1,
                       p0_chip: 0, p0_order: 1, p0_gamma: 0, p0_bright: 255,
                       p0_machan: 2000, p0_quiesma: 100, p0_maxma: 0 });
    let p = (await pixels()).ports[0];
    expect(p.worstMa, 'worst case is arithmetic, not a guess').toBe(100 * 3 * 20 + 100);

    const s = new UdpSender(host);
    const white = Buffer.alloc(512).fill(255);
    for (let n = 0; n < 20; n++) { await s.send(ART_PORT, artDmxPacket(PIX_UNI, white, n)); await sleep(25); }
    s.close();
    p = (await pixels()).ports[0];
    expect(p.ma, 'full white draws the worst case').toBeGreaterThan(5000);
    expect(p.scale, 'no cap set, so nothing is scaled').toBe(256);

    // Now cap it well below and the engine must dim, and report the factor it used.
    await postConfig({ p0_maxma: 1000 });
    const s2 = new UdpSender(host);
    for (let n = 0; n < 20; n++) { await s2.send(ART_PORT, artDmxPacket(PIX_UNI, white, n)); await sleep(25); }
    s2.close();
    p = (await pixels()).ports[0];
    expect(p.scale, 'the cap is actively scaling').toBeLessThan(256);
    expect(p.ma, 'and the result respects the cap').toBeLessThanOrEqual(1100);
  });

  test('a missing universe latches partially instead of dropping the frame', async () => {
    skipUnlessWrite();
    await postConfig({ p0_en: 1, p0_pin: PIX_PIN, p0_count: 200, p0_uni: PIX_UNI, p0_start: 1,
                       p0_chip: 0, p0_order: 1, p0_gamma: 0, p0_bright: 255, p0_maxma: 0 });
    // Feed ONLY the first of the port's two universes. A design that waits for a complete
    // frame would stall here and never light anything; ours latches on timeout with the
    // missing slice holding its previous content, so a lost packet costs one stale slice
    // rather than the whole frame across every port.
    const s = new UdpSender(host);
    const a = Buffer.alloc(512).fill(0x5a);
    for (let n = 0; n < 30; n++) { await s.send(ART_PORT, artDmxPacket(PIX_UNI, a, n)); await sleep(25); }
    s.close();
    const p = (await pixels()).ports[0];
    expect(p.latches, 'frames still went out').toBeGreaterThan(0);
    expect(p.partials, 'and they were recorded as partial').toBeGreaterThan(0);
    const bytes = (await frame(0)).px.match(/../g).map((h) => parseInt(h, 16));
    expect(bytes[0], 'the universe that did arrive is applied').toBe(0x5a);
  });
});

// Which peripheral ends up driving the strips is decided at runtime from a budget that pixels
// SHARE with DMX: DMX TX is clocked on RMT too, and so is a WS2812 status LED. So the rule is
// `DMX outputs + pixel ports + status LED <= TX channels`, and a test that hard-codes "3 ports
// fit" only holds for one particular DMX configuration. Derive it instead.
test.describe('Pixel output — backend selection (LUXDMX_WRITE=1)', () => {
  let restore = null;

  const on = (n) => {                       // enables for ports 0..n-1, plus a small count each
    const f = {};
    for (let i = 0; i < n; i++) { f[`p${i}_en`] = 1; f[`p${i}_count`] = 16; }
    return f;
  };

  test.beforeAll(async () => {
    if (!WRITE) return;
    const px = await pixels();
    const d  = await getJson(base + '/info.json');
    restore = { ports: px.ports.map((p) => ({ en: p.en, count: p.count })), pixbk: d.pixBackend || 0 };
  });
  test.afterAll(async () => {
    if (!WRITE || !restore) return;
    const f = { pixbk: restore.pixbk };
    restore.ports.forEach((p, i) => { if (p.en) f[`p${i}_en`] = 1; f[`p${i}_count`] = p.count; });
    await postConfig(f, { pixelsOff: true });
  });

  test('the RMT channel budget is shared with DMX, and running out switches to LCD_CAM', async () => {
    skipUnlessWrite();
    const px0 = await pixels();
    const info0 = await getJson(base + '/info.json');
    const dmx = (info0.outputs || []).filter((o) => o.en).length;
    const led = info0.ledType === 2 ? 1 : 0;          // a WS2812 status LED takes a channel too
    const budget = (px0.rmtMax || 0) - dmx - led;     // pixel ports that can still be served by RMT

    test.skip(!px0.rmtMax, 'firmware does not report rmtMax');
    test.skip(budget < 1 || budget + 1 > px0.ports.length,
      `budget ${budget} of ${px0.rmtMax} channels does not leave a testable step on this board`);
    const dmxJson = await getJson(base + '/dmx.json');
    test.skip(!dmxJson.psram && dmxJson.heapBlock < 24000,
      `not enough headroom without PSRAM (largest block ${dmxJson.heapBlock} B)`);

    // Exactly the budget still fits in RMT...
    await postConfig({ ...on(budget), pixbk: 0 }, { pixelsOff: true });
    const fit = await pixels();
    expect(fit.ports.filter((p) => p.en).length, 'ports enabled').toBe(budget);
    expect(fit.backend, `${dmx} DMX + ${budget} ports fits ${px0.rmtMax} channels`).toBe('rmt');

    // ...and one more does not. Partial service is not an option: every port moves together.
    await postConfig({ ...on(budget + 1), pixbk: 0 }, { pixelsOff: true });
    const over = await pixels();
    expect(over.ports.filter((p) => p.en).length, 'ports enabled').toBe(budget + 1);
    expect(over.backend, 'one port past the budget falls back to the parallel backend').toBe('lcd');

    // ...and it must actually clock frames, not just claim the ports.
    const s = new UdpSender(host);
    const data = Buffer.alloc(512).fill(0x40);
    for (let n = 0; n < 40; n++) {
      for (const p of over.ports.filter((q) => q.en)) await s.send(ART_PORT, artDmxPacket(p.uni, data, n));
      await sleep(25);
    }
    s.close();
    for (const p of (await pixels()).ports.filter((q) => q.en))
      expect(p.latches, `port ${p.idx + 1} pushed frames`).toBeGreaterThan(0);
  });

  test('forcing LCD_CAM overrides a choice that would otherwise be RMT', async () => {
    skipUnlessWrite();
    const px0 = await pixels();
    test.skip(!px0.rmtMax, 'firmware does not report rmtMax');
    const info0 = await getJson(base + '/info.json');
    test.skip((info0.mcu || '') !== 'esp32s3', 'LCD_CAM only exists on the ESP32-S3');

    // One port on its own always fits RMT, so anything but "rmt" here is the override working.
    await postConfig({ ...on(1), pixbk: 0 }, { pixelsOff: true });
    expect((await pixels()).backend, 'a single port would pick RMT').toBe('rmt');

    await postConfig({ ...on(1), pixbk: 2 }, { pixelsOff: true });
    const forced = await pixels();
    expect(forced.backend, 'pixbk=2 forces the parallel backend').toBe('lcd');
    expect(forced.pixbk, 'the setting is reported back').toBe(2);
  });
});
