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
  if (snap.encReverse)    f.encrev   = '1';
  if (snap.btnActiveHigh) f.btnah    = '1';
  const outs = [{ ...snap.outputs[0], ...o0Overrides }, snap.outputs[1]];
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

// Like measureOut, but the value changes at `changeHz` while each change is sent `repeat` times
// back to back -- the way MagicQ and Art-Net's send-on-change model actually transmit. The device
// therefore sees ~changeHz*repeat packets/s but only changeHz real changes/s.
async function measureBurst(request, uni, changeHz, repeat, ms) {
  const sender = new UdpSender(host);
  const data = Buffer.alloc(512);
  const period = 1000 / changeHz;
  try {
    const end = Date.now() + ms;
    let i = 0, seq = 0;
    while (Date.now() < end) {
      data[0] = i & 0xff; data[1] = (i >> 8) & 0xff;             // the value that actually changes
      for (let r = 0; r < repeat; r++)                           // ...sent several times, no gap
        await sender.send(ART_PORT, artDmxPacket(uni, data, seq++));
      i++;
      await sleep(Math.max(1, Math.round(period)));
    }
  } finally { sender.close(); }
  const d = await dmx(request);
  return { inFps: d.fps, outFps: d.outfps[0] };
}

// Drive a MagicQ-style burst (changeHz unique changes/s, each sent `repeat` times) while polling
// /info.json every second, so the firmware's change-rate window keeps closing the way it does under
// a real browser on the WS. Returns the beat flag + detected change rate from the last poll.
async function watchBeat(request, uni, changeHz, repeat, ms) {
  const sender = new UdpSender(host);
  const data = Buffer.alloc(512);
  const period = 1000 / changeHz;
  let last = { beat: false, chgHz: 0 };
  try {
    const end = Date.now() + ms;
    let i = 0, seq = 0, nextPoll = Date.now() + 1000;
    while (Date.now() < end) {
      data[0] = i & 0xff; data[1] = (i >> 8) & 0xff;               // the value that actually changes
      for (let r = 0; r < repeat; r++)
        await sender.send(ART_PORT, artDmxPacket(uni, data, seq++));
      i++;
      if (Date.now() >= nextPoll) {
        const d = await info(request);
        last = { beat: d.outputs[0].beat, chgHz: d.outputs[0].chgHz };
        nextPoll = Date.now() + 1000;
      }
      await sleep(Math.max(1, Math.round(period)));
    }
  } finally { sender.close(); }
  return last;
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

  test('/info.json exposes the per-output beat warning (beat + change rate)', async ({ request }) => {
    const d = await info(request);
    for (const [i, o] of d.outputs.entries()) {
      expect(typeof o.beat, `out${i} beat is a boolean`).toBe('boolean');
      expect(typeof o.chgHz, `out${i} chgHz is a number`).toBe('number');
      expect(o.chgHz, `out${i} chgHz >= 0`).toBeGreaterThanOrEqual(0);
    }
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

  test('Delta follows the change rate, not the packet rate, when the source repeats frames', async ({ request }) => {
    skipUnlessWrite();
    test.setTimeout(120_000);
    const uni = before.outputs[0].uni;
    await request.post('/config', { form: configForm(before, { rate: 0, style: DELTA }) });
    await waitForState(request, (d) => d.outputs[0].style === DELTA);

    // The reopened half of issue #93: a MagicQ user reported ~97 packets/s off a 33.3 Hz engine,
    // because MagicQ sends each change 3 times. Delta used to wake on every packet, so clamped to
    // the 24 ms wire floor it clocked ~42 Hz of partly-stale frames -- a stutter. It must wake on
    // real content changes only, so the wire tracks the ~33 Hz the console actually updates at.
    const res = await measureBurst(request, uni, 33.3, 3, 15000);
    expect(res.inFps, `device really sees the burst (~100 packets/s), got ${res.inFps}`).toBeGreaterThan(80);
    expect(res.outFps, `delta tracks the ~33 Hz change rate, not the packets, got ${res.outFps}`).toBeGreaterThan(30);
    expect(res.outFps, `delta does not clock the duplicates out, got ${res.outFps}`).toBeLessThan(38);
  });

  test('a Continuous output beating a mismatched source raises the warning; Delta clears it', async ({ request }) => {
    skipUnlessWrite();
    test.setTimeout(120_000);
    const uni = before.outputs[0].uni;

    // Continuous at 40 fps fed a MagicQ-shaped 33.3 fps source (each change sent x3): the output
    // free-runs at 40 against 33 real changes, so it beats. The warning must fire, and it must read
    // the *change* rate (~33), not the ~100 packets/s.
    await request.post('/config', { form: configForm(before, { rate: 0, style: CONTINUOUS }) });
    await waitForState(request, (d) => d.outputs[0].style === CONTINUOUS && d.outputs[0].rate === 0);
    const cont = await watchBeat(request, uni, 33.3, 3, 9000);
    expect(cont.beat, `continuous vs a 33 fps source must warn (chgHz ${cont.chgHz})`).toBe(true);
    expect(Math.abs(cont.chgHz - 33), `detected change rate ~33, got ${cont.chgHz}`).toBeLessThan(6);

    // Same source in Delta: it follows the input, so there is no beat and no warning.
    await request.post('/config', { form: configForm(before, { rate: 0, style: DELTA }) });
    await waitForState(request, (d) => d.outputs[0].style === DELTA);
    const delta = await watchBeat(request, uni, 33.3, 3, 9000);
    expect(delta.beat, 'delta follows the source, so it never beats or warns').toBe(false);
  });

  test('a Continuous output whose rate matches its source does not warn', async ({ request }) => {
    skipUnlessWrite();
    test.setTimeout(120_000);
    const uni = before.outputs[0].uni;
    // Output at 33.3 fps, source at 33.3 fps: the rates line up, so no beat and no false alarm.
    await request.post('/config', { form: configForm(before, { rate: 2, style: CONTINUOUS }) });
    await waitForState(request, (d) => d.outputs[0].rate === 2 && d.outputs[0].style === CONTINUOUS);
    const m = await watchBeat(request, uni, 33.3, 3, 9000);
    expect(m.beat, `matched rates must not warn (chgHz ${m.chgHz})`).toBe(false);
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
