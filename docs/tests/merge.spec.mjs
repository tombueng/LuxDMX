// Source merging (issue #10): HTP / LTP / off and sACN priority.
//
// Runs against a live LuxDMX. The shape + UI tests are read-only (safe any
// time). The behavioural tests set a merge mode, reboot, drive two simultaneous
// sources on output A's universe, assert the merged DMX, then restore the
// original config — opt-in via LUXDMX_WRITE=1.
import { test, expect } from '@playwright/test';
import {
  deviceHost, UdpSender, streamFor, artDmxPacket, e131Packet, prepInput,
  wsFirstBinary, ART_PORT, SACN_PORT,
} from './lib/net.mjs';
import { info, dmx, pollFor, waitForState } from './lib/device.mjs';

let host;
test.beforeAll(async () => { host = await deviceHost(); });

// Source state byte in the WS push frame: 0 = normal, 1 = conflict, 2 = merging.
async function srcStatus(host) {
  const v = await wsFirstBinary(host, 2500);
  return v.getUint8(13);
}

// Full /config form from an /info.json snapshot, applying overrides to output A
// (output 0). Sending every field avoids clobbering unrelated settings.
function configForm(snap, o0Overrides = {}) {
  const f = {
    protocol: String(snap.protocol),
    hostname: snap.hostname,
    otapw: snap.otapw,
    ledtype: String(snap.ledType),
    ledpin: String(snap.ledPin),
    ip: snap.sip || '',
    gateway: snap.gateway || '',
    subnet: snap.subnet || '',
    dns: snap.dns || '',
  };
  if (snap.staticIp) f.staticip = '1';
  const outs = [{ ...snap.outputs[0], ...o0Overrides }, snap.outputs[1]];
  outs.forEach((o, i) => {
    if (o.en) f[`o${i}_en`] = '1';            // omitted key == disabled
    f[`o${i}_uni`]   = String(o.uni);
    f[`o${i}_port`]  = String(o.port);
    f[`o${i}_tx`]    = String(o.tx);
    f[`o${i}_rx`]    = String(o.rx);
    f[`o${i}_rts`]   = String(o.rts);
    f[`o${i}_merge`] = String(o.merge ?? 0);
  });
  return f;
}

test.describe('Source merging (issue #10)', () => {
  // ── shape + UI (read-only) ────────────────────────────────────────────────
  test('/info.json exposes a numeric merge mode per output', async ({ request }) => {
    const d = await info(request);
    for (const o of d.outputs) {
      expect(o, 'output missing "merge"').toHaveProperty('merge');
      expect(typeof o.merge, 'merge is a number').toBe('number');
      expect(o.merge).toBeGreaterThanOrEqual(0);
      expect(o.merge).toBeLessThanOrEqual(2);
    }
  });

  test('config page exposes an Off/HTP/LTP selector per output', async ({ page }) => {
    await page.goto('/config');
    for (const n of ['o0_merge', 'o1_merge']) {
      await expect(page.locator(`[name="${n}"]`)).toHaveCount(1);
      await expect(page.locator(`[name="${n}"] option`)).toHaveCount(3);
    }
  });

  // Two sources on one universe while that output is in Off mode is a genuine
  // unmanaged clash → the WS frame must report conflict (srcStatus 1). Default
  // merge mode is Off, so this needs no config change.
  test('two sources with merging off report the conflict status', async ({ request }) => {
    const before = await info(request);
    test.skip(before.outputs[0].merge !== 0, 'output A is not in Off merge mode');
    const art = before.outputs[0].uni, sacn = art + 1;
    await prepInput(host);
    const a = new UdpSender(host), s = new UdpSender(host);
    const d = Buffer.alloc(512); d[0] = 80;
    try {
      const streaming = Promise.all([
        streamFor(a, ART_PORT,  (i) => artDmxPacket(art, d, i), { ms: 6000 }),
        streamFor(s, SACN_PORT, (i) => e131Packet(sacn, d, i),  { ms: 6000 }),
      ]);
      const st = await pollFor(() => srcStatus(host), (x) => x === 1, { ms: 6000, every: 400 });
      expect(st, 'srcStatus should be 1 (conflict) with merging off').toBe(1);
      await streaming;
    } finally { a.close(); s.close(); }
  });

  // ── behaviour (opt-in: mutates + reboots the device) ──────────────────────
  test('HTP merges two sources per channel; sACN priority overrides', async ({ request }) => {
    test.skip(process.env.LUXDMX_WRITE !== '1',
      'set LUXDMX_WRITE=1 to run device-mutating tests (reboots the device twice)');
    test.setTimeout(120_000);   // two reboots
    const before = await info(request);
    const art = before.outputs[0].uni, sacn = art + 1;
    try {
      await request.post('/config', { form: configForm(before, { merge: 1 }) });
      await waitForState(request, (d) => d.outputs[0].merge === 1);
      await prepInput(host);

      // Per-channel HTP across two equal-priority (100) sources:
      //   Art-Net ch1=200 ch2=10  +  sACN ch1=50 ch2=240
      //   → ch1=max(200,50)=200, ch2=max(10,240)=240
      {
        const a = new UdpSender(host), s = new UdpSender(host);
        const da = Buffer.alloc(512); da[0] = 200; da[1] = 10;
        const ds = Buffer.alloc(512); ds[0] = 50;  ds[1] = 240;
        try {
          const streaming = Promise.all([
            streamFor(a, ART_PORT,  (i) => artDmxPacket(art, da, i), { ms: 3000 }),
            streamFor(s, SACN_PORT, (i) => e131Packet(sacn, ds, i),  { ms: 3000 }),
          ]);
          const got = await pollFor(() => dmx(request),
            (x) => x.ch[0] === 200 && x.ch[1] === 240, { ms: 5000 });
          expect(got.ch[0], 'ch1 = HTP max(200,50)').toBe(200);
          expect(got.ch[1], 'ch2 = HTP max(10,240)').toBe(240);
          await streaming;
        } finally { a.close(); s.close(); }
      }

      // sACN priority (200) outranks Art-Net (default 100): only sACN contributes.
      //   Art-Net ch1=200 ch2=111  +  sACN@200 ch1=50 ch3=99
      //   → ch1=50, ch2=0 (Art-Net suppressed), ch3=99
      {
        const a = new UdpSender(host), s = new UdpSender(host);
        const da = Buffer.alloc(512); da[0] = 200; da[1] = 111;
        const ds = Buffer.alloc(512); ds[0] = 50;  ds[2] = 99;
        try {
          const streaming = Promise.all([
            streamFor(a, ART_PORT,  (i) => artDmxPacket(art, da, i), { ms: 3000 }),
            streamFor(s, SACN_PORT, (i) => e131Packet(sacn, ds, i, { priority: 200 }), { ms: 3000 }),
          ]);
          const got = await pollFor(() => dmx(request),
            (x) => x.ch[0] === 50 && x.ch[2] === 99, { ms: 5000 });
          expect(got.ch[0], 'higher-priority sACN wins ch1 despite a lower value').toBe(50);
          expect(got.ch[1], 'lower-priority Art-Net suppressed on ch2').toBe(0);
          expect(got.ch[2], 'sACN ch3 present').toBe(99);
          await streaming;
        } finally { a.close(); s.close(); }
      }
    } finally {
      await request.post('/config', { form: configForm(before) });
      await waitForState(request, (d) => d.outputs[0].merge === before.outputs[0].merge);
    }
  });

  test('HTP merge shows the merging indicator, not a conflict', async ({ page, request }) => {
    test.skip(process.env.LUXDMX_WRITE !== '1',
      'set LUXDMX_WRITE=1 to run device-mutating tests (reboots the device twice)');
    test.setTimeout(120_000);   // two reboots
    const before = await info(request);
    const art = before.outputs[0].uni, sacn = art + 1;
    try {
      await request.post('/config', { form: configForm(before, { merge: 1 }) });
      await waitForState(request, (d) => d.outputs[0].merge === 1);
      await prepInput(host);
      await page.goto('/');
      await expect(page.locator('#ws-badge')).toHaveText(/Live/);
      const a = new UdpSender(host), s = new UdpSender(host);
      const d = Buffer.alloc(512); d[0] = 90;
      try {
        const streaming = Promise.all([
          streamFor(a, ART_PORT,  (i) => artDmxPacket(art, d, i), { ms: 8000 }),
          streamFor(s, SACN_PORT, (i) => e131Packet(sacn, d, i),  { ms: 8000 }),
        ]);
        // WS frame reports merging (2), never conflict (1), with HTP enabled.
        const st = await pollFor(() => srcStatus(host), (x) => x === 2, { ms: 6000, every: 400 });
        expect(st, 'srcStatus should be 2 (merging) under HTP').toBe(2);
        // UI shows the positive banner and hides the conflict one.
        await expect(page.locator('#merge-banner')).toBeVisible();
        await expect(page.locator('#conflict-banner')).toBeHidden();
        await streaming;
      } finally { a.close(); s.close(); }
    } finally {
      await request.post('/config', { form: configForm(before) });
      await waitForState(request, (d) => d.outputs[0].merge === before.outputs[0].merge);
    }
  });

  test('LTP merge mode persists across a reboot', async ({ request }) => {
    test.skip(process.env.LUXDMX_WRITE !== '1',
      'set LUXDMX_WRITE=1 to run device-mutating tests (reboots the device twice)');
    test.setTimeout(120_000);   // two reboots
    const before = await info(request);
    try {
      await request.post('/config', { form: configForm(before, { merge: 2 }) });
      const mid = await waitForState(request, (d) => d.outputs[0].merge === 2);
      expect(mid.outputs[0].merge).toBe(2);
    } finally {
      await request.post('/config', { form: configForm(before) });
      await waitForState(request, (d) => d.outputs[0].merge === before.outputs[0].merge);
    }
  });
});
