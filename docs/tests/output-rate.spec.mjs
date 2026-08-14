// Per-output DMX transmit rate + style (issue #93). The gateway used to free-run at a fixed 40 Hz
// regardless of the input rate, so any console on another rate (MagicQ and MADRIX both sit at
// 33.3 fps) had roughly (40 - in)/40 of its frames repeated on the wire. Both settings are now per
// output and apply live.
//
// Read-only tests assert the shape: /info.json carries rate/style/styleSrc per output, /config
// renders both selectors, and ArtPollReply's RefreshRate tracks the configured rate.
//
// The behavioural tests change config, so they gate behind LUXDMX_WRITE=1 and restore afterwards.
// They prove the two things that matter and that no unit test can: that picking a rate actually
// changes the rate on the wire (measured via the device's own transmit counter, which counts real
// frames handed to the RMT), and that Delta makes the output rate follow the input rate instead of
// free-running. Confirming the *duplicate frame* share needs the RP2350 analyzer on the DMX line
// and lives on the bench rig, not here.
import { test, expect } from '@playwright/test';
import { deviceHost, UdpSender, streamFor, artDmxPacket, prepInput, sleep, ART_PORT } from './lib/net.mjs';
import { info, dmx, pollFor, waitForState } from './lib/device.mjs';
import { ArtRdmClient } from './lib/artrdm.mjs';
import { openConfig } from './lib/ui.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';

// Index -> nominal fps, matching ENUM_TXRATE / DMX_RATE_MS in the firmware.
const RATE_FPS = [40, 41.7, 33.3, 25, 20];
const CONTINUOUS = 0, DELTA = 1;

let host;
test.beforeAll(async () => { host = await deviceHost(); });

function skipUnlessWrite() {
  test.skip(!WRITE, 'device-mutating: set LUXDMX_WRITE=1 to run');
}

// Rebuild the WHOLE /config form from a known-good snapshot, changing only what we ask for.
//
// Every boolean has to be listed explicitly. handleConfigPost sets bools from checkbox *presence*,
// so a key this helper forgets is not "left alone", it is actively set to false. Forgetting
// `useeth` takes the device off Ethernet and strands it in its setup AP with no way back over the
// network. Learned the hard way while verifying this very feature.
function configForm(snap, o0Overrides = {}) {
  const f = {
    protocol: String(snap.protocol),
    hostname: snap.hostname,
    otapw:    snap.otapw,
    ledtype:  String(snap.ledType),
    ledpin:   String(snap.ledPin),
    ip: snap.sip || '', gateway: snap.gateway || '',
    subnet: snap.subnet || '', dns: snap.dns || '',
  };
  if (snap.staticIp)      f.staticip = '1';
  if (snap.useEthernet)   f.useeth   = '1';
  if (snap.ethW5500)      f.ethon    = '1';
  if (snap.artnetRdm)     f.artrdm   = '1';
  if (snap.ipProg)        f.ipprog   = '1';
  if (snap.autoUpdate)    f.autoupd  = '1';
  if (snap.encReverse)    f.encrev   = '1';
  if (snap.btnActiveHigh) f.btnah    = '1';
  // Every output, not a fixed pair: an omitted o<i>_en reads as "disabled" (checkbox form).
  const outs = snap.outputs.map((o, i) => (i === 0 ? { ...o, ...o0Overrides } : o));
  outs.forEach((o, i) => {
    if (o.en) f[`o${i}_en`] = '1';              // omitted key == disabled
    f[`o${i}_uni`]   = String(o.uni);
    f[`o${i}_port`]  = String(o.port);
    f[`o${i}_tx`]    = String(o.tx);
    f[`o${i}_rx`]    = String(o.rx);
    f[`o${i}_rts`]   = String(o.rts);
    f[`o${i}_merge`] = String(o.merge ?? 0);
    f[`o${i}_loss`]  = String(o.loss ?? 0);
    f[`o${i}_rate`]  = String(o.rate ?? 0);
    f[`o${i}_style`] = String(o.style ?? 0);
  });
  return f;
}

// Drive output A's universe at `fps` for `ms`, then report the device's own transmit rate.
async function measureOut(request, uni, fps, ms) {
  const sender = new UdpSender(host);
  const data = Buffer.alloc(512);
  const period = 1000 / fps;
  try {
    const end = Date.now() + ms;
    let i = 0;
    while (Date.now() < end) {
      data[0] = i & 0xff;
      await sender.send(ART_PORT, artDmxPacket(uni, data, i));
      i++;
      await sleep(Math.max(1, Math.round(period)));
    }
  } finally { sender.close(); }
  const d = await dmx(request);
  return { inFps: d.fps, outFps: d.outfps[0] };
}

test.describe('DMX output rate + transmit style — shape (always)', () => {
  test('/info.json exposes rate, style and styleSrc per output', async ({ request }) => {
    const d = await info(request);
    for (const [i, o] of d.outputs.entries()) {
      expect(typeof o.rate, `out${i} rate`).toBe('number');
      expect(o.rate, `out${i} rate in range`).toBeGreaterThanOrEqual(0);
      expect(o.rate, `out${i} rate in range`).toBeLessThan(RATE_FPS.length);
      expect([CONTINUOUS, DELTA], `out${i} style`).toContain(o.style);
      expect([0, 1], `out${i} styleSrc`).toContain(o.styleSrc);
    }
  });

  test('config page renders a rate and a transmit-style selector per output', async ({ page }) => {
    await openConfig(page);
    await expect(page.locator('select[name="o0_rate"]')).toHaveCount(1);
    await expect(page.locator('select[name="o0_style"]')).toHaveCount(1);
    await expect(page.locator('select[name="o1_rate"]')).toHaveCount(1);
    // 33.3 has to be offered, it is the whole point for MagicQ / MADRIX users.
    await expect(page.locator('select[name="o0_rate"] option', { hasText: '33.3' })).toHaveCount(1);
    // and the provenance badge must be rendered next to the style selector
    await expect(page.locator('.style-src').first()).toBeVisible();
  });

  test('the navbar shows the transmit style, and marks one set over Art-Net', async ({ page, request }) => {
    const d = await info(request);
    await page.goto('/');
    // The /ws frame is only pushed when input arrives, so drive something first.
    const sender = new UdpSender(host);
    try {
      const data = Buffer.alloc(512);
      const streaming = streamFor(sender, ART_PORT, (i) => artDmxPacket(d.outputs[0].uni, data, i), { ms: 4000 });
      await expect.poll(async () => page.locator('#txstyle').textContent(), { timeout: 12_000 })
        .toMatch(/[CD]/);
      await streaming;
    } finally { sender.close(); }
    const txt = (await page.locator('#txstyle').textContent()).trim();
    const title = await page.locator('#txstyle').getAttribute('title');
    // One letter per output: C = continuous (free-run), D = delta (following the input).
    expect(txt.replace(/·/g, '').split(/\s+/).length, 'one style per output').toBe(d.outputs.length);
    expect(title, 'the tooltip spells it out').toMatch(/continuous \(free-run\)|delta \(follows the input\)/);
    // A style pushed by a controller must be distinguishable from one chosen here.
    expect(title).toMatch(/set (here|over Art-Net)/);
  });

  test('ArtPollReply RefreshRate matches the configured rate', async ({ request }) => {
    const d = await info(request);
    const c = new ArtRdmClient(host);
    await c.ready;
    try {
      // ArtPoll/ArtPollReply is UDP, so a single lost datagram is not a firmware bug. Ask a
      // few times before calling it a failure (this flaked exactly once in a full run).
      let reply = null;
      for (let i = 0; i < 3 && !reply; i++) reply = await c.poll();
      expect(reply, 'no ArtPollReply after 3 ArtPolls').toBeTruthy();
      const want = RATE_FPS[d.outputs[0].rate];
      // integer Hz field, so allow the rounding the firmware does (41.7 -> 42, 33.3 -> 33)
      expect(Math.abs(reply.refreshRate - want),
        `advertised ${reply.refreshRate} for configured ${want} fps`).toBeLessThanOrEqual(1);
      expect(reply.outputStyle).toBe(d.outputs[0].style === DELTA ? 'delta' : 'continuous');
    } finally { await c.close(); }
  });
});

test.describe('DMX output rate + transmit style — behaviour (LUXDMX_WRITE=1)', () => {
  let before;
  test.beforeAll(async ({ request }) => { before = await info(request); });
  test.afterAll(async ({ request }) => {
    if (!WRITE || !before) return;
    await request.post('/config', { form: configForm(before) });
    await waitForState(request, (d) => d.outputs[0].rate === (before.outputs[0].rate ?? 0));
  });

  test('picking 33.3 fps actually changes the transmit rate on that output', async ({ request }) => {
    skipUnlessWrite();
    test.setTimeout(120_000);
    await prepInput(host);
    const uni = before.outputs[0].uni;

    await request.post('/config', { form: configForm(before, { rate: 0 }) });   // 40 fps
    await waitForState(request, (d) => d.outputs[0].rate === 0);
    const at40 = await pollFor(() => dmx(request), (x) => x.outfps[0] > 1, { ms: 8000 });
    expect(at40.outfps[0], 'free-running at 40 fps').toBeGreaterThan(38);
    expect(at40.outfps[0], 'free-running at 40 fps').toBeLessThan(42);

    await request.post('/config', { form: configForm(before, { rate: 2 }) });   // 33.3 fps
    await waitForState(request, (d) => d.outputs[0].rate === 2);
    const at33 = await pollFor(() => dmx(request), (x) => x.outfps[0] > 1, { ms: 8000 });
    expect(at33.outfps[0], 'free-running at 33.3 fps').toBeGreaterThan(31.5);
    expect(at33.outfps[0], 'free-running at 33.3 fps').toBeLessThan(35);
    expect(uni).toBeGreaterThanOrEqual(0);
  });

  test('Delta makes the output follow the input rate instead of free-running', async ({ request }) => {
    skipUnlessWrite();
    test.setTimeout(180_000);
    const uni = before.outputs[0].uni;

    // Continuous at 40 fps, fed a deliberately slower 25 fps source: the wire stays at 40 and the
    // surplus frames are repeats. This is the bug from issue #93, pinned so it can't come back.
    await request.post('/config', { form: configForm(before, { rate: 0, style: CONTINUOUS }) });
    await waitForState(request, (d) => d.outputs[0].style === CONTINUOUS && d.outputs[0].rate === 0);
    const cont = await measureOut(request, uni, 25, 12000);
    expect(cont.outFps, 'continuous ignores the 25 fps source').toBeGreaterThan(38);

    // Same source, Delta: now the wire should track the input instead.
    await request.post('/config', { form: configForm(before, { rate: 0, style: DELTA }) });
    await waitForState(request, (d) => d.outputs[0].style === DELTA);
    const delta = await measureOut(request, uni, 25, 12000);
    expect(delta.outFps, 'delta follows the source down').toBeLessThan(cont.outFps - 5);
    expect(Math.abs(delta.outFps - delta.inFps),
      `delta: out ${delta.outFps} should track in ${delta.inFps}`).toBeLessThan(6);
  });

  test('a quiet source in Delta falls back to free-running (the line never stops)', async ({ request }) => {
    skipUnlessWrite();
    test.setTimeout(120_000);
    await request.post('/config', { form: configForm(before, { rate: 0, style: DELTA }) });
    await waitForState(request, (d) => d.outputs[0].style === DELTA);
    await sleep(3000);                       // no source at all for well past the 800 ms fallback
    const idle = await dmx(request);
    expect(idle.outfps[0], 'delta falls back to the configured rate when idle').toBeGreaterThan(38);
  });
});
