// Comprehensive /config round-trip: prove EVERY web-form option still arrives
// after the schema-driven handleConfigPost refactor. Flips a distinct value for
// each settable field, POSTs the full form, reboots, and reads each back from
// /info.json. Connectivity + secret fields (eth pins, useEthernet, wifiMode,
// static IP, otapw, apPassword) are kept as-is so the device stays reachable and
// to avoid masked values; everything else is exercised.
//
// Mutating + reboots the device, opt-in via LUXDMX_WRITE=1.
import { test, expect, request as pwRequest } from '@playwright/test';

// Return only after `pred` holds on TWO consecutive reads, so the device is
// solidly back up (not mid-reboot) before the next test runs against it.
async function waitForState(request, pred, ms = 45_000) {
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 2_000));
  let streak = 0, last = null;
  while (Date.now() - t0 < ms) {
    try {
      const r = await request.get('/info.json', { timeout: 4000 });
      if (r.ok()) { const d = await r.json(); if (pred(d)) { last = d; if (++streak >= 2) return d; } else streak = 0; }
      else streak = 0;
    } catch { streak = 0; }   // mid-reboot
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (last) return last;
  throw new Error('device did not reach expected state in time');
}

// Build the COMPLETE /config form from an /info.json snapshot (so unflipped fields
// keep their value), then apply `flips` (form-key -> string value). Booleans use
// "1" when on and are omitted when off (the form's checkbox semantics).
function fullForm(info, flips = {}) {
  const f = {
    hostname: info.hostname,
    otapw: info.otapw,
    protocol: String(info.protocol),
    ledtype: String(info.ledType), ledpin: String(info.ledPin),
    ledr: String(info.ledR), ledg: String(info.ledG), ledy: String(info.ledY),
    ledb: String(info.ledB), ledw: String(info.ledW),
    disptype: String(info.dispType), dispsda: String(info.dispSda), dispscl: String(info.dispScl),
    disprot: String(info.dispRot), dispcs: String(info.dispCs), dispdc: String(info.dispDc),
    disprst: String(info.dispRst), dispsck: String(info.dispSck), dispmosi: String(info.dispMosi),
    ethcs: String(info.ethCs), ethsck: String(info.ethSck), ethmosi: String(info.ethMosi),
    ethmiso: String(info.ethMiso), ethint: String(info.ethInt), ethrst: String(info.ethRst),
    ethfreq: String(info.ethFreq), wiredphy: String(info.wiredPhy),
    rmiiphy: String(info.rmiiPhy ?? 0), rmiiaddr: String(info.rmiiAddr ?? 1),
    rmiimdc: String(info.rmiiMdc ?? 23), rmiimdio: String(info.rmiiMdio ?? 18),
    rmiipwr: String(info.rmiiPwr ?? 16), rmiiclk: String(info.rmiiClk ?? 0),
    wifimode: String(info.wifiMode), fbmode: String(info.linkLossMode),
    ip: info.sip || '', gateway: info.gateway || '', subnet: info.subnet || '', dns: info.dns || '',
  };
  if (info.ethW5500)   f.ethon = '1';
  if (info.useEthernet) f.useeth = '1';
  if (info.staticIp)   f.staticip = '1';
  info.outputs.forEach((o, i) => {
    if (o.en) f[`o${i}_en`] = '1';
    f[`o${i}_uni`] = String(o.uni); f[`o${i}_port`] = String(o.port);
    f[`o${i}_tx`] = String(o.tx); f[`o${i}_rx`] = String(o.rx);
    f[`o${i}_rts`] = String(o.rts); f[`o${i}_merge`] = String(o.merge);
    f[`o${i}_loss`] = String(o.loss);
  });
  // apply overrides; a null value deletes the key (turns a checkbox off)
  for (const [k, v] of Object.entries(flips)) { if (v === null) delete f[k]; else f[k] = v; }
  return f;
}

test('every web-form option round-trips through /config', async ({ request }) => {
  test.skip(process.env.LUXDMX_WRITE !== '1',
    'set LUXDMX_WRITE=1 to run this device-mutating test (reboots the device twice)');
  test.setTimeout(180_000);

  const before = await (await request.get('/info.json')).json();

  // form key -> [test value, getter(info) for read-back]. Connectivity + secret +
  // display-enable fields are intentionally excluded (see file header).
  const checks = [
    ['protocol', '1', (d) => d.protocol],
    ['ledtype',  '1', (d) => d.ledType],
    ['ledpin',  '13', (d) => d.ledPin],
    ['ledr',    '10', (d) => d.ledR],
    ['ledg',    '11', (d) => d.ledG],
    ['ledy',    '12', (d) => d.ledY],
    ['ledb',    '14', (d) => d.ledB],
    ['ledw',    '16', (d) => d.ledW],
    ['dispsda', '33', (d) => d.dispSda],
    ['dispscl', '34', (d) => d.dispScl],
    ['disprot',  '1', (d) => d.dispRot],
    ['dispcs',  '35', (d) => d.dispCs],
    ['dispdc',  '36', (d) => d.dispDc],
    ['disprst', '37', (d) => d.dispRst],
    ['dispsck', '38', (d) => d.dispSck],
    ['dispmosi','39', (d) => d.dispMosi],
    ['rmiiphy',  '2', (d) => d.rmiiPhy],
    ['rmiiaddr', '7', (d) => d.rmiiAddr],
    ['rmiimdc', '26', (d) => d.rmiiMdc],
    ['rmiimdio','27', (d) => d.rmiiMdio],
    ['rmiipwr',  '5', (d) => d.rmiiPwr],
    ['rmiiclk',  '2', (d) => d.rmiiClk],
    ['fbmode',   '2', (d) => d.linkLossMode],
    ['o0_uni',   '3', (d) => d.outputs[0].uni],
    ['o0_port',  '2', (d) => d.outputs[0].port],
    ['o0_tx',   '20', (d) => d.outputs[0].tx],
    ['o0_rx',   '21', (d) => d.outputs[0].rx],
    ['o0_rts',  '22', (d) => d.outputs[0].rts],
    ['o0_merge', '2', (d) => d.outputs[0].merge],
    ['o0_loss',  '1', (d) => d.outputs[0].loss],
    ['o1_en',  true,  (d) => d.outputs[1].en],   // flip the disabled output on
    ['o1_uni',   '4', (d) => d.outputs[1].uni],
    ['o1_port',  '1', (d) => d.outputs[1].port],
    ['o1_tx',   '23', (d) => d.outputs[1].tx],
    ['o1_rx',   '24', (d) => d.outputs[1].rx],
    ['o1_rts',  '25', (d) => d.outputs[1].rts],
    ['o1_merge', '1', (d) => d.outputs[1].merge],
    ['o1_loss',  '2', (d) => d.outputs[1].loss],
  ];

  // /info.json only echoes the RMII pin fields on a chip with an internal EMAC
  // (HAS_ETH_RMII, classic ESP32). On the S3 they're applied but not reported, so
  // skip them here when the device says it has no RMII (verify those via serial dump).
  const active = checks.filter(([k]) => before.ethRmii || !k.startsWith('rmii'));

  const flips = {};
  for (const [k, v] of active) flips[k] = (v === true) ? '1' : String(v);

  try {
    await request.post('/config', { form: fullForm(before, flips) });
    const after = await waitForState(request, (d) => d.ledPin === 13 && d.outputs[1].en === true);

    const fails = [];
    for (const [k, v, get] of active) {
      const want = (v === true) ? true : Number.isNaN(Number(v)) ? v : Number(v);
      const got = get(after);
      if (got !== want) fails.push(`${k}: expected ${want}, got ${got}`);
    }
    expect(fails, `fields that did NOT round-trip:\n  ${fails.join('\n  ')}`).toHaveLength(0);
  } finally {
    // restore the original config exactly
    await request.post('/config', { form: fullForm(before) });
    await waitForState(request, (d) => d.ledPin === before.ledPin && d.outputs[1].en === before.outputs[1].en);
  }
});
