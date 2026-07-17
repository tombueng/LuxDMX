// Behaviour test for the "LuxDMX v5" board template in /config.
//
// The v5 has no dedicated firmware any more: a v5 owner flashes the generic esp32s3dev
// build (which reports board "esp32s3-devkitc-1") and picks the "LuxDMX v5" template in
// /config to get the fixed pin map. This test drives that exact flow in a real browser
// against a stub device that reports the GENERIC board (so no copper-pin locks apply),
// selects the v5 template, applies it, and asserts:
//   * the W5500 SPI pins get set (the gap that made "just document it" not work — the
//     preset used to omit them, so the picked template left a board with no Ethernet)
//   * the LED, display and DMX-output pins get set
//   * the tuned panel brightness is pushed to /led/bright?...&save=1 (it is not a config-
//     form field, so it can't ride along on Save)
//   * fields stay EDITABLE (the board isn't detected as a v5, so nothing is locked)
//
// Run:  node docs/tests/v5-template.mjs     (from the repo root)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = fs.readFileSync(path.join(ROOT, 'src/pages/config.html'), 'utf8').replace(/__FWVER__/g, 'test');

// A generic S3 with the W5500 driver compiled in (ethSpi) — i.e. the released esp32s3dev
// build running on a v5. It reports the DevKitC id, so the picker does NOT lock anything.
const INFO = {
  hostname: 'luxdmx', ip: '192.168.1.42', version: 'test', board: 'esp32s3-devkitc-1', mcu: 'esp32s3',
  universe: 0, protocol: 2, useEthernet: false, ethSpi: true, ethRmii: false, hasEth: true, wifiMode: 0,
  ledType: 2, ledPin: 48, ledR: -1, ledG: -1, ledY: -1, ledB: -1, ledW: -1,
  dispType: 0, dispSda: 8, dispScl: 9, dispSck: -1, dispMosi: -1, dispCs: -1, dispDc: -1, dispRst: -1,
  ethCs: 5, ethSck: 18, ethMosi: 23, ethMiso: 19, ethInt: 4, ethRst: 25, ethFreq: 20, ethW5500: true, wiredPhy: 0,
  outputs: [
    { en: true, uni: 0, port: 1, tx: 17, rx: 16, rts: -1 },
    { en: false, uni: 1, port: 2, tx: -1, rx: -1, rts: -1 },
  ],
};

let ledBrightHit = null;   // captured query string of the /led/bright call the template fires

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/config' || url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(CONFIG); return; }
  if (url === '/info.json')  { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(INFO)); return; }
  if (url === '/version.json'){ res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"version":"test","versions":[]}'); return; }
  if (url === '/led/bright') { ledBrightHit = req.url.split('?')[1] || ''; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return; }
  if (url.endsWith('.json'))  { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
  res.writeHead(200); res.end('');
});

function check(name, cond) { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); return cond ? 0 : 1; }

const port = await new Promise((r) => server.listen(0, () => r(server.address().port)));
const browser = await chromium.launch();
let fails = 0;
try {
  const page = await browser.newPage();
  await page.route('**://luxdmx.org/**', (route) => route.abort());   // offline: fall back to the built-in board list
  await page.goto(`http://127.0.0.1:${port}/config`, { waitUntil: 'domcontentloaded' });

  // the built-in board list must offer LuxDMX v5 even offline
  await page.waitForFunction(() => {
    const sel = document.getElementById('board-sel');
    return sel && [...sel.options].some((o) => o.value === 'luxdmx_v5');
  }, { timeout: 8000 });

  // pick the v5 template and apply it, then confirm the modal
  await page.evaluate(() => {
    const sel = document.getElementById('board-sel');
    sel.value = 'luxdmx_v5';
    sel.dispatchEvent(new Event('change'));
    document.getElementById('board-apply').click();
  });
  await page.click('#app-modal-ok');
  await page.waitForFunction(() => {
    const e = document.getElementsByName('ethcs')[0];
    return e && e.value === '10';
  }, { timeout: 4000 }).catch(() => {});

  const r = await page.evaluate(() => {
    const val = (n) => { const e = document.getElementsByName(n)[0]; return e ? { found: true, disabled: !!e.disabled, value: String(e.value) } : { found: false }; };
    return {
      ethcs: val('ethcs'), ethsck: val('ethsck'), ethmosi: val('ethmosi'),
      ethmiso: val('ethmiso'), ethint: val('ethint'), ethrst: val('ethrst'),
      ledr: val('ledr'), ledw: val('ledw'), ledtype: val('ledtype'),
      dispsda: val('dispsda'),
      o0_tx: val('o0_tx'), o0_rts: val('o0_rts'), o1_tx: val('o1_tx'), o1_rts: val('o1_rts'),
    };
  });

  // THE gap this change closes: the W5500 pins come across
  const eth = { ethcs: '10', ethsck: '12', ethmosi: '11', ethmiso: '13', ethint: '14', ethrst: '9' };
  for (const [n, v] of Object.entries(eth)) fails += check(`${n} set to ${v}`, r[n].found && r[n].value === v);
  // LED panel + DMX outputs
  fails += check('ledtype set to 3 (5-LED panel)', r.ledtype.value === '3');
  fails += check('ledr=1, ledw=15', r.ledr.value === '1' && r.ledw.value === '15');
  fails += check('dispsda=4', r.dispsda.value === '4');
  fails += check('output A tx=17 rts=8', r.o0_tx.value === '17' && r.o0_rts.value === '8');
  fails += check('output B tx=16 rts=47', r.o1_tx.value === '16' && r.o1_rts.value === '47');
  // NOT locked — the board is a generic DevKitC, so the applied fields stay editable
  fails += check('ethcs stays editable (not a detected v5, no lock)', r.ethcs.found && !r.ethcs.disabled);
  // brightness pushed to the endpoint, persisted
  fails += check('fired /led/bright with the tuned duty (g=8, w=17, save=1)',
    !!ledBrightHit && /(^|&)g=8(&|$)/.test(ledBrightHit) && /(^|&)w=17(&|$)/.test(ledBrightHit) && /(^|&)save=1(&|$)/.test(ledBrightHit));
} finally {
  await browser.close();
  server.close();
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll v5-template checks passed');
process.exit(fails ? 1 : 0);
