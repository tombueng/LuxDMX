// 5-LED status panel — activity signalling (LuxDMX v4/v5 board, ledType 3).
//
// Once the box is green (network up), the coloured LEDs signal LIVE TRAFFIC:
//   Green  = network up (solid)
//   Blue   = outgoing DMX being clocked onto the wire   (driven by lastDmxTxMs)
//   Yellow = outgoing RDM request sent                  (driven by g_rdmSent / rdmTx)
//   White  = RDM response received / identify active    (driven by g_rdmRecv / rdmRx)
//   Red    = no network, or (when up) a source conflict
//
// What Playwright CAN check here: the API-visible signals that gate each LED —
//   * the RDM device cap (info.json.rdmMax), which auto-sizes to the chip and
//     regressed to 16 on the ESP32-S3 (must be 64); and
//   * the RDM tx/rx counters (rdm.json.rdmTx / rdmRx) that pulse the yellow/white LEDs.
// The DMX-out (blue) signal is the same continuous 40 Hz transmit already covered by
// artnet/sacn/signal-loss (channels route to the output; STOP-on-loss goes dark).
//
// What it CANNOT check: the actual photons. Whether the blue/yellow/white LEDs really
// blink is only observable with a camera or a logic analyser on the LED GPIOs (R=1 G=2
// Y=6 B=7 W=15) — verified on the bench, the same way the on-wire DMX/RDM timing is
// validated on the RP2350 analyzer rig rather than in Playwright (see rdm-trigger.spec).
import { test, expect } from '@playwright/test';
import { info, pollFor } from './lib/device.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';
const rdm = async (request) => (await request.get('/rdm.json')).json();

test.describe('5-LED panel — API-visible state (read-only, always runs)', () => {
  test('/info.json exposes the LED panel config + chip + RDM cap', async ({ request }) => {
    const i = await info(request);
    for (const k of ['ledType', 'ledR', 'ledG', 'ledY', 'ledB', 'ledW'])
      expect(typeof i[k], `info.${k}`).toBe('number');
    expect(typeof i.chip).toBe('string');       // e.g. "ESP32" / "ESP32-S3"
    expect(typeof i.rdmMax).toBe('number');      // effective RDM device cap
  });

  test('/info.json + /led/bright expose the per-colour PWM brightness (0-255)', async ({ request }) => {
    const i = await info(request);
    for (const k of ['ledBrR', 'ledBrG', 'ledBrY', 'ledBrB', 'ledBrW'])
      expect(typeof i[k], `info.${k}`).toBe('number');
    const b = await (await request.get('/led/bright')).json();
    expect(b.ok).toBe(true);
    for (const k of ['r', 'g', 'y', 'b', 'w']) {
      expect(typeof b[k], `bright.${k}`).toBe('number');
      expect(b[k], `bright.${k} in 0..255`).toBeGreaterThanOrEqual(0);
      expect(b[k]).toBeLessThanOrEqual(255);
    }
    expect([0, 1]).toContain(b.test);   // calibration-mode flag (all LEDs on)
  });

  test('RDM device cap auto-sizes to the chip — S3 must be 64, not 16 (regression guard)', async ({ request }) => {
    const i = await info(request);
    expect(i.rdmMax).toBeGreaterThanOrEqual(16);
    expect(i.rdmMax).toBeLessThanOrEqual(64);
    // Assumes the default rdmmaxdev=0 (auto). The old auto-detect gated on FREE internal
    // RAM, so a big firmware silently dropped the S3 to the 16-device bucket (found 16
    // instead of 64 fixtures). The fix keys off the chip model instead.
    if (i.chip === 'ESP32') {
      expect(i.rdmMax, 'classic ESP32 keeps the small 16-device table').toBe(16);
    } else {
      expect(i.rdmMax, `${i.chip} must report the full 64-device RDM cap`).toBe(64);
    }
  });
});

test.describe('RDM activity counters — the yellow/white LED sources (opt-in)', () => {
  test.skip(!WRITE, 'triggers RDM discovery on the bus; set LUXDMX_WRITE=1 to enable');

  test('discovery pumps rdmTx (yellow LED); a reply pumps rdmRx (white LED)', async ({ request }) => {
    const before = await rdm(request);
    expect(typeof before.rdmTx).toBe('number');
    expect(typeof before.rdmRx).toBe('number');

    const r = await request.get('/rdm/discover');
    expect(r.ok()).toBeTruthy();

    // Every RDM frame put on the wire bumps rdmTx -> the yellow LED pulses on each.
    const after = await pollFor(() => rdm(request), (x) => x.rdmTx > before.rdmTx, { ms: 15000 });
    expect(after.rdmTx, 'discovery must transmit RDM frames (yellow activity)').toBeGreaterThan(before.rdmTx);
    // rdmRx only advances if a fixture actually answers (white LED). Don't require a
    // responder on the bench, but it must never run backwards.
    expect(after.rdmRx).toBeGreaterThanOrEqual(before.rdmRx);
  });
});

test.describe('5-LED brightness + calibration — /led/bright (opt-in, drives the panel live)', () => {
  test.skip(!WRITE, 'changes the panel brightness live; set LUXDMX_WRITE=1 to enable');

  test('a colour applies live and reads back; the calibration flag toggles', async ({ request }) => {
    const bright = async (q) => (await request.get('/led/bright' + q)).json();
    const before = await bright('');
    try {
      // set green to a distinct value, live only (no &save) -> echoed straight back
      const set = await bright('?g=42');
      expect(set.ok).toBe(true);
      expect(set.g).toBe(42);
      // calibration on lights all five (test:1); off returns to normal (test:0)
      expect((await bright('?test=1')).test).toBe(1);
      expect((await bright('?test=0')).test).toBe(0);
    } finally {
      // restore the original green + calibration off (nothing was persisted to NVS)
      await bright('?g=' + before.g + '&test=0');
    }
  });
});
