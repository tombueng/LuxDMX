// Signal-loss policy: per-output behaviour once every source for a universe goes
// quiet (HOLD last frame / BLACKOUT / STOP). Runs against a live LuxDMX.
//
// Shape + UI tests are read-only (safe any time). The behavioural tests set a
// loss mode, reboot, drive a source on output A (Art-Net and sACN), stop it,
// wait past the 2.5 s source timeout and assert the output buffer via
// /dmx.json — opt-in via LUXDMX_WRITE=1. The original config is restored after.
//
// /dmx.json reports the output *buffer*, so it proves HOLD (held) vs BLACKOUT
// (zeroed) outright, and proves STOP took the no-zero path (buffer held, not
// blacked out). STOP's defining "the line stops clocking on the wire" is not
// web-observable (it needs a logic analyzer / scope on the TX pin) and is out of
// scope for an e2e test.
import { test, expect } from '@playwright/test';
import {
  deviceHost, UdpSender, streamFor, artDmxPacket, e131Packet, prepInput, sleep,
  ART_PORT, SACN_PORT,
} from './lib/net.mjs';
import { info, dmx, pollFor, waitForState } from './lib/device.mjs';

const HOLD = 0, BLACKOUT = 1, STOP = 2;
const SOURCE_TIMEOUT_MS = 2500;                 // matches firmware SOURCE_TIMEOUT_MS
const AFTER_LOSS_MS     = SOURCE_TIMEOUT_MS + 1500;

const ART_PAT  = { 1: 200, 2: 150, 3: 100, 4: 50 };
const SACN_PAT = { 1: 190, 2: 140, 3: 90,  4: 40 };
const PROTOS   = [['artnet', ART_PAT], ['sacn', SACN_PAT]];

let host;
test.beforeAll(async () => { host = await deviceHost(); });

// Full /config form from an /info.json snapshot, with overrides on output A.
// Sends every output field (nothing gets clobbered) and re-asserts the network
// mode checkboxes (useeth/ethon/staticip) so an Ethernet device is never knocked
// off the wire by an omitted hasParam box.
function configForm(snap, o0Overrides = {}) {
  const f = {
    protocol: String(snap.protocol),
    hostname: snap.hostname,
    otapw: snap.otapw,
    ledtype: String(snap.ledType),
    ledpin: String(snap.ledPin),
    ip: snap.sip || '', gateway: snap.gateway || '',
    subnet: snap.subnet || '', dns: snap.dns || '',
  };
  if (snap.staticIp)    f.staticip = '1';
  if (snap.useEthernet) f.useeth   = '1';
  if (snap.ethW5500)    f.ethon    = '1';
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
  });
  return f;
}

// Drive output A with one protocol's pattern, assert the device shows it, then
// stop the stream and wait past the source timeout. Returns the post-loss /dmx.
async function driveThenDropSource(request, proto, artUni, pattern) {
  await prepInput(host);
  const data = Buffer.alloc(512);
  for (const [ch, v] of Object.entries(pattern)) data[Number(ch) - 1] = v;
  const port = proto === 'artnet' ? ART_PORT : SACN_PORT;
  const uni  = proto === 'artnet' ? artUni  : artUni + 1;     // sACN universe = art + 1
  const make = proto === 'artnet'
    ? (i) => artDmxPacket(uni, data, i)
    : (i) => e131Packet(uni, data, i);
  const sender = new UdpSender(host);
  try {
    const streaming = streamFor(sender, port, make, { ms: 2500 });
    const active = await pollFor(() => dmx(request),
      (x) => x.ch[0] === pattern[1] && x.ch[1] === pattern[2], { ms: 6000 });
    expect(active.ch[0], `${proto}: source drives ch1`).toBe(pattern[1]);
    expect(active.ch[1], `${proto}: source drives ch2`).toBe(pattern[2]);
    await streaming;                          // last frame sent; source now silent
  } finally { sender.close(); }
  await sleep(AFTER_LOSS_MS);                 // let the source time out (> 2.5 s)
  return dmx(request);
}

async function setLoss(request, before, mode) {
  await request.post('/config', { form: configForm(before, { loss: mode }) });
  await waitForState(request, (d) => d.outputs[0].loss === mode);
}
async function restore(request, before) {
  await request.post('/config', { form: configForm(before) });
  await waitForState(request, (d) => d.outputs[0].loss === before.outputs[0].loss);
}
function skipUnlessWrite() {
  test.skip(process.env.LUXDMX_WRITE !== '1',
    'set LUXDMX_WRITE=1 to run device-mutating tests (reboots the device)');
}

test.describe('Signal-loss policy', () => {
  // ── shape + UI (read-only) ───────────────────────────────────────────────
  test('/info.json exposes a numeric loss mode per output', async ({ request }) => {
    const d = await info(request);
    for (const o of d.outputs) {
      expect(o, 'output missing "loss"').toHaveProperty('loss');
      expect(typeof o.loss, 'loss is a number').toBe('number');
      expect(o.loss).toBeGreaterThanOrEqual(0);
      expect(o.loss).toBeLessThanOrEqual(2);
    }
  });

  test('config page exposes an On-signal-loss selector per output', async ({ page }) => {
    await page.goto('/config');
    for (const n of ['o0_loss', 'o1_loss']) {
      await expect(page.locator(`[name="${n}"]`)).toHaveCount(1);
      await expect(page.locator(`[name="${n}"] option`)).toHaveCount(3);
    }
  });

  // ── behaviour (opt-in: mutates + reboots the device) ─────────────────────
  test('HOLD keeps the last frame after the source stops (Art-Net + sACN)', async ({ request }) => {
    skipUnlessWrite();
    test.setTimeout(150_000);
    const before = await info(request);
    try {
      await setLoss(request, before, HOLD);
      for (const [proto, pat] of PROTOS) {
        const after = await driveThenDropSource(request, proto, before.outputs[0].uni, pat);
        expect(after.ch[0], `${proto}: ch1 still held`).toBe(pat[1]);
        expect(after.ch[1], `${proto}: ch2 still held`).toBe(pat[2]);
        expect(after.ch[2], `${proto}: ch3 still held`).toBe(pat[3]);
      }
    } finally { await restore(request, before); }
  });

  test('BLACKOUT zeros the whole output after the source stops (Art-Net + sACN)', async ({ request }) => {
    skipUnlessWrite();
    test.setTimeout(150_000);
    const before = await info(request);
    try {
      await setLoss(request, before, BLACKOUT);
      for (const [proto, pat] of PROTOS) {
        const after = await driveThenDropSource(request, proto, before.outputs[0].uni, pat);
        const sum = after.ch.reduce((a, b) => a + b, 0);
        expect(sum, `${proto}: whole frame driven to 0`).toBe(0);
      }
    } finally { await restore(request, before); }
  });

  test('STOP holds the buffer (not blackout) after the source stops (Art-Net + sACN)', async ({ request }) => {
    skipUnlessWrite();
    test.setTimeout(150_000);
    const before = await info(request);
    try {
      await setLoss(request, before, STOP);
      for (const [proto, pat] of PROTOS) {
        const after = await driveThenDropSource(request, proto, before.outputs[0].uni, pat);
        // STOP keeps the last buffer (it does NOT blackout). The line actually
        // going idle on the wire is not visible through /dmx.json (buffer-only).
        expect(after.ch[0], `${proto}: ch1 buffer held`).toBe(pat[1]);
        expect(after.ch.reduce((a, b) => a + b, 0), `${proto}: buffer not zeroed`).toBeGreaterThan(0);
      }
    } finally { await restore(request, before); }
  });

  test('loss mode persists across a reboot', async ({ request }) => {
    skipUnlessWrite();
    test.setTimeout(120_000);
    const before = await info(request);
    try {
      await setLoss(request, before, STOP);
      const mid = await info(request);
      expect(mid.outputs[0].loss, 'STOP survived the save + reboot').toBe(STOP);
    } finally { await restore(request, before); }
  });
});
