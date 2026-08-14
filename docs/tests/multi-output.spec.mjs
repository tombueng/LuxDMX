// Multi-universe / multi-output feature tests (issue #4).
//
// Runs against a live LuxDMX (see playwright.config.mjs for target resolution).
// The default tests are read-only (safe to run any time). The config round-trip
// test mutates + reboots the device and is opt-in via LUXDMX_WRITE=1.
import { test, expect } from '@playwright/test';

const OUT_KEYS = ['en', 'uni', 'port', 'tx', 'rx', 'rts'];

async function getInfo(request) {
  const res = await request.get('/info.json');
  expect(res.ok(), 'GET /info.json should succeed').toBeTruthy();
  return res.json();
}

// Poll /info.json across a reboot until `pred(info)` holds (or time out).
async function waitForState(request, pred, ms = 45_000) {
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 2_000)); // let the reboot begin
  while (Date.now() - t0 < ms) {
    try {
      const res = await request.get('/info.json', { timeout: 3_000 });
      if (res.ok()) { const d = await res.json(); if (pred(d)) return d; }
    } catch { /* device is mid-reboot — keep polling */ }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error('device did not reach the expected state in time');
}

// Rebuild a full /config form body from an /info.json snapshot, applying
// overrides to output 1. Sending every field avoids clobbering other settings.
function configForm(info, o1Overrides = {}) {
  const f = {
    protocol: String(info.protocol),
    hostname: info.hostname,
    otapw: info.otapw,
    ledtype: String(info.ledType),
    ledpin: String(info.ledPin),
    ip: info.sip || '',
    gateway: info.gateway || '',
    subnet: info.subnet || '',
    dns: info.dns || '',
  };
  // EVERY boolean: an absent key in this checkbox form is written false, and dropping `useeth`
  // takes a wired device off Ethernet into its setup AP with no way back over the network.
  if (info.staticIp)      f.staticip = '1';
  if (info.useEthernet)   f.useeth   = '1';
  if (info.ethW5500)      f.ethon    = '1';
  if (info.artnetRdm)     f.artrdm   = '1';
  if (info.ipProg)        f.ipprog   = '1';
  if (info.autoUpdate)    f.autoupd  = '1';
  if (info.encReverse)    f.encrev   = '1';
  if (info.btnActiveHigh) f.btnah    = '1';
  // Every output, not a fixed pair: an omitted o<i>_en reads as "disabled" (checkbox form).
  const outs = info.outputs.map((o, i) => (i === 1 ? { ...o, ...o1Overrides } : o));
  outs.forEach((o, i) => {
    if (o.en) f[`o${i}_en`] = '1';          // omitted key == disabled
    f[`o${i}_uni`]  = String(o.uni);
    f[`o${i}_port`] = String(o.port);
    f[`o${i}_tx`]   = String(o.tx);
    f[`o${i}_rx`]   = String(o.rx);
    f[`o${i}_rts`]  = String(o.rts);
  });
  return f;
}

test.describe('Multi-output (issue #4)', () => {
  test('/info.json exposes a 3-output array with the right shape', async ({ request }) => {
    const d = await getInfo(request);
    expect(Array.isArray(d.outputs), 'outputs should be an array').toBeTruthy();
    expect(d.outputs.length).toBe(3);
    for (const o of d.outputs) {
      for (const k of OUT_KEYS) expect(o, `output missing "${k}"`).toHaveProperty(k);
      expect(o.port >= 1 && o.port <= 3, 'port is 1..3').toBeTruthy();
      expect(o.uni).toBeGreaterThanOrEqual(0);
      // 15 was the old Art-Net-only ceiling. Universes are 0..32767 now (sACN + Art-Net 4),
      // and the config form accepts that range, so a box on universe 77 is perfectly legal.
      expect(o.uni).toBeLessThanOrEqual(32767);
    }
    expect(d).toHaveProperty('rdmOut');
  });

  test('legacy "universe" field mirrors output A (back-compat)', async ({ request }) => {
    const d = await getInfo(request);
    expect(d.universe).toBe(d.outputs[0].uni);
  });

  test('migration leaves Output A enabled', async ({ request }) => {
    // A device updated from single-universe firmware must keep driving its line.
    const d = await getInfo(request);
    expect(d.outputs[0].en).toBe(true);
  });

  test('rdmOut points at an enabled output with an RTS pin, or is -1', async ({ request }) => {
    const d = await getInfo(request);
    if (d.rdmOut === -1) return;
    expect(d.rdmOut).toBeGreaterThanOrEqual(0);
    expect(d.rdmOut).toBeLessThan(d.outputs.length);
    const o = d.outputs[d.rdmOut];
    expect(o.en, 'RDM output must be enabled').toBe(true);
    expect(o.rts, 'RDM output must have an RTS pin').toBeGreaterThanOrEqual(0);
  });

  test('enabled outputs use distinct UART ports', async ({ request }) => {
    const d = await getInfo(request);
    // What the firmware actually enforces is one TX GPIO per output: each one binds its own
    // RMT channel to that pin. It used to guard the `port` field instead, but that is a
    // leftover from the esp_dmx era and no longer selects a peripheral (TX is on RMT, RDM's
    // RX UART is shared and switched per line), so it is no longer the real constraint.
    const txPins = d.outputs.filter((o) => o.en).map((o) => o.tx);
    expect(new Set(txPins).size, 'no two enabled outputs share a TX pin').toBe(txPins.length);
  });

  test('config page builds an Output A, B and C block', async ({ page }) => {
    await page.goto('/config');
    await expect(page.locator('.out-card')).toHaveCount(3);
    await expect(page.locator('.out-card .out-title').nth(0)).toHaveText(/Output A/);
    await expect(page.locator('.out-card .out-title').nth(1)).toHaveText(/Output B/);
    await expect(page.locator('.out-card .out-title').nth(2)).toHaveText(/Output C/);
    // Cloned-template fields are renamed per output index.
    for (const n of ['o0_uni', 'o0_port', 'o0_tx', 'o0_rx', 'o0_rts',
                     'o1_uni', 'o1_port', 'o1_tx', 'o1_rx', 'o1_rts',
                     'o2_uni', 'o2_port', 'o2_tx', 'o2_rx', 'o2_rts']) {
      // :not(.fixed-mirror) -- on a fixed-pin board a locked field grows a hidden mirror
      // input with the same name so the value still POSTs. One real control is the assertion.
      await expect(page.locator(`[name="${n}"]:not(.fixed-mirror)`)).toHaveCount(1);
    }
    await expect(page.locator('#o0_en')).toBeChecked(); // Output A enabled
  });

  test('status page View selector matches the number of enabled outputs', async ({ page, request }) => {
    const d = await getInfo(request);
    const enabled = d.outputs.filter((o) => o.en).length;
    await page.goto('/');
    const wrap = page.locator('#out-sel-wrap');
    if (enabled > 1) {
      await expect(wrap).toBeVisible();
      await expect(wrap.locator('#out-sel button')).toHaveCount(enabled);
    } else {
      await expect(wrap).toBeHidden();
    }
  });

  // Opt-in: mutates and reboots the device (twice). Enable Output B as a
  // same-universe splitter, confirm it persists, then restore the original.
  test('config round-trip: enable Output B as a splitter, then restore', async ({ request }) => {
    test.skip(process.env.LUXDMX_WRITE !== '1',
      'set LUXDMX_WRITE=1 to run device-mutating tests (reboots the device twice)');
    test.setTimeout(120_000);   // two reboots
    // Output B needs a real TX GPIO to be accepted (the sanitizer drops pin-less
    // outputs). Default is an ESP32-S3-safe free pin; override per board.
    const txB = Number(process.env.LUXDMX_TXB || 18);
    const before = await getInfo(request);
    try {
      await request.post('/config', {
        form: configForm(before, { en: true, uni: before.outputs[0].uni, port: 2, tx: txB, rx: -1, rts: -1 }),
      });
      const mid = await waitForState(request, (d) => d.outputs[1].en === true);
      expect(mid.outputs[1].en).toBe(true);
      expect(mid.outputs[1].port).toBe(2);
      expect(mid.outputs[1].tx).toBe(txB);
      expect(mid.outputs[1].uni, 'splitter shares output A universe').toBe(before.outputs[0].uni);
    } finally {
      await request.post('/config', { form: configForm(before) });
      await waitForState(request, (d) => d.outputs[1].en === before.outputs[1].en);
    }
  });

  // Regression: enabling an output with no TX pin (tx=-1) once boot-looped the
  // device (esp_dmx crashed in initDmx). It must now be sanitized to disabled
  // and the device must stay reachable.
  test('enabling an output with no TX pin is sanitized, not bricked', async ({ request }) => {
    test.skip(process.env.LUXDMX_WRITE !== '1',
      'set LUXDMX_WRITE=1 to run device-mutating tests (reboots the device)');
    test.setTimeout(120_000);   // two reboots
    const before = await getInfo(request);
    try {
      await request.post('/config', {
        form: configForm(before, { en: true, port: 2, tx: -1, rx: -1, rts: -1 }),
      });
      // Device must come back online at all (proves no boot loop)...
      const after = await waitForState(request, (d) => d && Array.isArray(d.outputs));
      // ...and the pin-less output must have been forced off.
      expect(after.outputs[1].en, 'pin-less output disabled by the sanitizer').toBe(false);
    } finally {
      await request.post('/config', { form: configForm(before) });
      await waitForState(request, (d) => d.outputs[1].en === before.outputs[1].en);
    }
  });
});
