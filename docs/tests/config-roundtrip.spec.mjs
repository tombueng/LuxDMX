// Comprehensive /config round-trip: prove EVERY web-form option still arrives
// after the schema-driven handleConfigPost refactor. Flips a distinct value for
// each settable field, POSTs the full form, reboots, and reads each back from
// /info.json. Connectivity + secret fields (eth pins, useEthernet, wifiMode,
// static IP, otapw, apPassword) are kept as-is so the device stays reachable and
// to avoid masked values; everything else is exercised.
//
// Mutating + reboots the device, opt-in via LUXDMX_WRITE=1.
import { test, expect, request as pwRequest } from '@playwright/test';
import { pixelFormFields, pixelPorts } from './lib/device.mjs';

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
    artshort: info.artShort || '', artlong: info.artLong || '',   // Art-Net node names (issue #129)
    otapw: info.otapw,
    protocol: String(info.protocol),
    ledtype: String(info.ledType), ledpin: String(info.ledPin),
    ledr: String(info.ledR), ledg: String(info.ledG), ledy: String(info.ledY),
    ledb: String(info.ledB), ledw: String(info.ledW),
    disptype: String(info.dispType), dispsda: String(info.dispSda), dispscl: String(info.dispScl),
    disprot: String(info.dispRot), dispcs: String(info.dispCs), dispdc: String(info.dispDc),
    disprst: String(info.dispRst), dispsck: String(info.dispSck), dispmosi: String(info.dispMosi),
    disptimeout: String(info.dispTimeout ?? 20),   // screen timeout (issue #134)
    ethcs: String(info.ethCs), ethsck: String(info.ethSck), ethmosi: String(info.ethMosi),
    ethmiso: String(info.ethMiso), ethint: String(info.ethInt), ethrst: String(info.ethRst),
    ethfreq: String(info.ethFreq), wiredphy: String(info.wiredPhy),
    rmiiphy: String(info.rmiiPhy ?? 0), rmiiaddr: String(info.rmiiAddr ?? 1),
    rmiimdc: String(info.rmiiMdc ?? 23), rmiimdio: String(info.rmiiMdio ?? 18),
    rmiipwr: String(info.rmiiPwr ?? 16), rmiiclk: String(info.rmiiClk ?? 0),
    wifimode: String(info.wifiMode), fbmode: String(info.linkLossMode),
    ip: info.sip || '', gateway: info.gateway || '', subnet: info.subnet || '', dns: info.dns || '',
    // on-unit controls (issue #24)
    enca: String(info.encA ?? -1), encb: String(info.encB ?? -1), encsw: String(info.encSw ?? -1),
    encsteps: String(info.encSteps ?? 4),
    btn1pin: String(info.btn1Pin ?? -1), btn1act: String(info.btn1Act ?? 3),
    btn2pin: String(info.btn2Pin ?? -1), btn2act: String(info.btn2Act ?? 4),
    btn3pin: String(info.btn3Pin ?? -1), btn3act: String(info.btn3Act ?? 1),
    btn4pin: String(info.btn4Pin ?? -1), btn4act: String(info.btn4Act ?? 2),
    ctlunimax: String(info.ctlUniMax ?? 15),
  };
  if (info.ethW5500)   f.ethon = '1';
  if (info.useEthernet) f.useeth = '1';
  if (info.staticIp)   f.staticip = '1';
  if (info.encReverse)    f.encrev = '1';
  if (info.btnActiveHigh) f.btnah  = '1';
  info.outputs.forEach((o, i) => {
    if (o.en) f[`o${i}_en`] = '1';
    f[`o${i}_uni`] = String(o.uni); f[`o${i}_port`] = String(o.port);
    f[`o${i}_tx`] = String(o.tx); f[`o${i}_rx`] = String(o.rx);
    f[`o${i}_rts`] = String(o.rts); f[`o${i}_merge`] = String(o.merge);
    f[`o${i}_loss`] = String(o.loss);
  });
  // The pixel ports are in this form too, and p<i>_en is a checkbox like every other bool:
  // leave them out and the save switches all five off. See pixelFormFields().
  Object.assign(f, pixelFormFields(info.pixels));
  // apply overrides; a null value deletes the key (turns a checkbox off)
  for (const [k, v] of Object.entries(flips)) { if (v === null) delete f[k]; else f[k] = v; }
  return f;
}

// Pins this chip may be handed for a test write. Deliberately conservative: BOOT, the USB
// D-/D+ pair, the SPI flash range, UART0 and the octal-PSRAM pins are all left out. "The config
// stored it" is not worth a board that needs a serial cable to come back.
function safePins(info) {
  // S3: 22-25 do not exist, 19/20 are USB, 26-37 belong to the SPI flash and (on an R8 part)
  // the octal PSRAM, 43/44 are UART0, 0/45/46 are strapping pins. What is left is small, and on
  // a board that uses all of it there is nothing safe to write -- which is the right answer, not
  // a reason to widen the list.
  if ((info.chip || '').includes('S3'))
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21,
            38, 39, 40, 41, 42, 47, 48];
  return [4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33];
}

// Every key in the list below whose value is a GPIO number rather than a mode or an id.
const PIN_KEYS = new Set([
  'ledpin', 'ledr', 'ledg', 'ledy', 'ledb', 'ledw',
  'dispsda', 'dispscl', 'dispcs', 'dispdc', 'disprst', 'dispsck', 'dispmosi',
  'rmiimdc', 'rmiimdio', 'rmiipwr',
  'o0_tx', 'o0_rx', 'o0_rts', 'o1_tx', 'o1_rx', 'o1_rts',
  'enca', 'encb', 'encsw', 'btn1pin', 'btn2pin',
]);

test('every web-form option round-trips through /config', async ({ request }) => {
  test.skip(process.env.LUXDMX_WRITE !== '1',
    'set LUXDMX_WRITE=1 to run this device-mutating test (reboots the device twice)');
  test.setTimeout(180_000);

  const before = await (await request.get('/info.json')).json();
  // The pixel ports are not in /info.json but they are in this form, and their `en` is a
  // checkbox: a body without them switches every port off, and the restore at the end of
  // this test would post the same gap again rather than putting them back.
  before.pixels = await pixelPorts(request);

  // Which pins this board is already using. A pin-valued field in the list below is a real
  // GPIO the firmware will drive once its subsystem is on, so a value picked for a DevKit can
  // be a wrecking ball somewhere else: `ledpin: '13'` took the LuxDMX carrier off the network,
  // because 13 is the W5500 MISO there. The LED writer drove the SPI line, the link never came
  // up, the task watchdog rebooted the box (`rst:0x8 TG1WDT_SYS_RST`), and the restore at the
  // end of this test could not reach the device to undo it. USB never finished enumerating
  // either, so from the outside it looked like a dying power supply rather than a bad pin.
  const busy = new Set();
  for (const k of ['ethCs', 'ethSck', 'ethMosi', 'ethMiso', 'ethInt', 'ethRst',
                   'dispSda', 'dispScl', 'encA', 'encB', 'encSw'])
    if (typeof before[k] === 'number' && before[k] >= 0) busy.add(before[k]);
  for (const o of before.outputs || []) for (const k of ['tx', 'rx', 'rts'])
    if (o[k] >= 0) busy.add(o[k]);
  for (const p of before.pixels || []) if (p.pin >= 0) busy.add(p.pin);
  for (const k of ['btn1Pin', 'btn2Pin', 'btn3Pin', 'btn4Pin'])
    if (typeof before[k] === 'number' && before[k] >= 0) busy.add(before[k]);

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
    ['disptimeout', '45', (d) => d.dispTimeout],
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
    // on-unit controls (issue #24)
    ['enca',    '35', (d) => d.encA],
    ['encb',    '36', (d) => d.encB],
    ['encsw',   '37', (d) => d.encSw],
    ['encsteps', '2', (d) => d.encSteps],
    ['encrev', true,  (d) => d.encReverse],
    ['btn1pin', '19', (d) => d.btn1Pin],
    ['btn1act',  '1', (d) => d.btn1Act],
    ['btn2act',  '2', (d) => d.btn2Act],
    ['btnah',  true,  (d) => d.btnActiveHigh],
    ['ctlunimax','31',(d) => d.ctlUniMax],
    // Art-Net node names (issue #129). Not CFG_KEEPNE, so unlike the hostname a blank field really
    // clears them -- which is why they are safe to exercise here and get restored below.
    ['artshort', 'rig short', (d) => d.artShort],
    ['artlong',  'rig long name', (d) => d.artLong],
  ];

  // /info.json only echoes the RMII pin fields on a chip with an internal EMAC
  // (HAS_ETH_RMII, classic ESP32). On the S3 they're applied but not reported, so
  // skip them here when the device says it has no RMII (verify those via serial dump).
  const active = checks.filter(([k]) => before.ethRmii || !k.startsWith('rmii'));

  // Pin-valued fields get their value from THIS board, not from a constant. The list above was
  // written in the classic-ESP32 pin space: 20/21/22 for output A, 23/24/25 for output B,
  // 35/36/37 for the encoder, 19 for a button, 13 for the status LED. On an ESP32-S3 several of
  // those are impossible (22-25 do not exist, 19/20 are USB D-/D+, 35/36/37 are the octal PSRAM
  // on an R8 part) and the rest collide with whatever the board actually wires there. A fully
  // populated board may have almost no spare GPIO left, in which case those fields simply are
  // not round-trip testable live and get reported as skipped rather than written anyway.
  const pool = safePins(before).filter((p) => !busy.has(p));
  const pinSkips = [];
  const resolved = [];
  for (const [k, v, get] of active) {
    if (!PIN_KEYS.has(k)) { resolved.push([k, v, get]); continue; }
    const pin = pool.shift();
    if (pin === undefined) { pinSkips.push(k); continue; }
    resolved.push([k, String(pin), get]);
  }
  if (pinSkips.length)
    console.log(`config-roundtrip: no spare GPIO on this board for ${pinSkips.join(', ')}`);

  const flips = {};
  for (const [k, v] of resolved) flips[k] = (v === true) ? '1' : String(v);

  // The sentinel the restore waits on has to be one of the values actually written.
  const ledFlip = resolved.find(([k]) => k === 'ledpin');
  const settled = ledFlip
    ? (d) => d.ledPin === Number(ledFlip[1]) && d.outputs[1].en === true
    : (d) => d.outputs[1].en === true;

  try {
    await request.post('/config', { form: fullForm(before, flips) });
    const after = await waitForState(request, settled);

    const fails = [];
    for (const [k, v, get] of resolved) {
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

// Read-only: the on-unit controls (issue #24) config surface is exposed in
// /info.json with the right shape, so the web UI can populate the Controls card.
// Non-destructive, runs without LUXDMX_WRITE.
test('on-unit controls config surface is present in /info.json', async ({ request }) => {
  const d = await (await request.get('/info.json')).json();
  const keys = ['encA', 'encB', 'encSw', 'encSteps', 'encReverse',
                'btn1Pin', 'btn1Act', 'btn2Pin', 'btn2Act',
                'btn3Pin', 'btn3Act', 'btn4Pin', 'btn4Act',
                'btnActiveHigh', 'ctlUniMax'];
  const missing = keys.filter((k) => !(k in d));
  expect(missing, `missing controls keys in /info.json: ${missing.join(', ')}`).toHaveLength(0);
  expect(typeof d.encReverse).toBe('boolean');
  expect(typeof d.btnActiveHigh).toBe('boolean');
  expect(d.encSteps).toBeGreaterThanOrEqual(1);
  expect(d.encSteps).toBeLessThanOrEqual(4);
  // button actions are the BtnRole enum 0..4
  for (const k of ['btn1Act', 'btn2Act', 'btn3Act', 'btn4Act']) {
    expect(d[k]).toBeGreaterThanOrEqual(0);
    expect(d[k]).toBeLessThanOrEqual(4);
  }
});
