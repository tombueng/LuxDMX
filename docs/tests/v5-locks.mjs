// Behaviour test for the LuxDMX v5 fixed-pin locking (issue #17 follow-up).
//
// Serves the real src/pages/config.html with a stub /info.json that reports the v5
// board, drives it in a real browser, and asserts that the hard-wired fields (DMX A/B,
// W5500, LEDs, display) are disabled and carry their fixed values + a hidden mirror so
// the value still submits, while the genuinely configurable fields stay editable.
//
// Run:  node docs/tests/v5-locks.mjs     (from the repo root)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = fs.readFileSync(path.join(ROOT, 'src/pages/config.html'), 'utf8').replace(/__FWVER__/g, 'test');

// What a real v5 reports. Only board/mcu + two outputs matter for the lock; the rest is filler.
const INFO = {
  hostname: 'luxdmx', ip: '192.168.1.42', version: 'test', board: 'luxdmx_v5', mcu: 'esp32s3',
  universe: 0, protocol: 2, useEthernet: false, ethSpi: true, ethRmii: false, hasEth: true, wifiMode: 0,
  ledType: 3, ledPin: -1, ledR: 1, ledG: 2, ledY: 6, ledB: 7, ledW: 15,
  dispType: 1, dispSda: 4, dispScl: 5, dispSck: 39, dispMosi: 40, dispCs: 41, dispDc: 42, dispRst: 38,
  ethCs: 10, ethSck: 12, ethMosi: 11, ethMiso: 13, ethInt: 14, ethRst: 9, ethFreq: 20, ethW5500: true, wiredPhy: 0,
  outputs: [
    { en: true, uni: 0, port: 1, tx: 17, rx: 18, rts: 8 },
    { en: true, uni: 1, port: 2, tx: 16, rx: 21, rts: 47 },
  ],
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/config' || url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(CONFIG); return; }
  if (url === '/info.json')  { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(INFO)); return; }
  if (url === '/version.json'){ res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"version":"test","versions":[]}'); return; }
  if (url.endsWith('.json'))  { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
  res.writeHead(200); res.end('');   // css / logo / anything else: empty 200
});

function check(name, cond) { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); return cond ? 0 : 1; }

const port = await new Promise((r) => server.listen(0, () => r(server.address().port)));
const browser = await chromium.launch();
let fails = 0;
try {
  const page = await browser.newPage();
  await page.route('**://luxdmx.org/**', (route) => route.abort());   // keep the offline catalog fetch from stalling
  await page.goto(`http://127.0.0.1:${port}/config`, { waitUntil: 'domcontentloaded' });
  // wait until the v5 board is detected and the locks have been applied
  await page.waitForFunction(() => {
    const i = document.getElementsByName('o0_tx')[0];
    return i && i.disabled;
  }, { timeout: 8000 });

  const r = await page.evaluate(() => {
    const byName = (n) => document.getElementsByName(n)[0];
    const state = (n) => { const e = byName(n); return e ? { found: true, disabled: !!e.disabled, value: String(e.value) } : { found: false }; };
    const mirrors = [...document.querySelectorAll('input.fixed-mirror')].map((m) => ({ name: m.name, value: m.value }));
    return {
      o0_tx: state('o0_tx'), o0_rx: state('o0_rx'), o0_rts: state('o0_rts'), o0_port: state('o0_port'),
      o1_tx: state('o1_tx'), o1_rx: state('o1_rx'), o1_rts: state('o1_rts'), o1_port: state('o1_port'),
      ethsck: state('ethsck'), ethcs: state('ethcs'), ledr: state('ledr'), ledw: state('ledw'),
      ledtype: state('ledtype'), dispsda: state('dispsda'), disprst: state('disprst'),
      o0_uni: state('o0_uni'), disptype: state('disptype'),   // these must stay editable
      mirrors,
      hw: document.getElementById('board-hardwired').innerHTML,
    };
  });

  // every fixed pin: disabled + correct value
  const fixed = {
    o0_tx: '17', o0_rx: '18', o0_rts: '8', o0_port: '1',
    o1_tx: '16', o1_rx: '21', o1_rts: '47', o1_port: '2',
    ethsck: '12', ethcs: '10', ledr: '1', ledw: '15', ledtype: '3', dispsda: '4', disprst: '38',
  };
  for (const [name, val] of Object.entries(fixed)) {
    fails += check(`${name} is locked (disabled, =${val})`, r[name].found && r[name].disabled && r[name].value === val);
  }
  // configurable fields stay editable
  fails += check('o0_uni stays editable', r.o0_uni.found && !r.o0_uni.disabled);
  fails += check('disptype stays editable', r.disptype.found && !r.disptype.disabled);
  // every locked field has a hidden mirror so its value still POSTs
  const mirrorNames = new Set(r.mirrors.map((m) => m.name));
  fails += check(`hidden mirrors present for all ${Object.keys(fixed).length}+ fixed fields`,
    Object.keys(fixed).every((n) => mirrorNames.has(n)) && r.mirrors.length >= Object.keys(fixed).length);
  fails += check('mirror carries the fixed value (o1_rts=47)', r.mirrors.some((m) => m.name === 'o1_rts' && m.value === '47'));
  // the fixed-wiring notice + both headers render
  fails += check('shows the fixed-wiring notice', /Fixed wiring/i.test(r.hw));
  fails += check('shows the J4 display header', /J4/.test(r.hw) && /Display header/i.test(r.hw));
  fails += check('shows the J6 expansion header', /J6/.test(r.hw) && /Expansion header/i.test(r.hw));
} finally {
  await browser.close();
  server.close();
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll v5-lock checks passed');
process.exit(fails ? 1 : 0);
