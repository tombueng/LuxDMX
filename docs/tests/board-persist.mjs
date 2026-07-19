// Behaviour test for "the board selection sticks across a reboot / OTA".
//
// The board a build REPORTS is compile-time (BOARD_ID in main.cpp) and a released LuxDMX v5
// runs the generic esp32s3dev firmware, so it reports "esp32s3-devkitc-1" like any other S3.
// The picked board therefore has to be persisted on the device (cfg.boardSel, schema key
// "board", surfaced as /info.json boardSel). Before that it wasn't stored anywhere, so the
// dropdown snapped back to "ESP32-S3 DevKitC-1" on every reboot and firmware update while the
// applied pins stayed put, which is exactly what a user sees as "the selection doesn't stick".
//
// Serves the real src/pages/config.html against stub devices and asserts:
//   * boardSel wins over the detected board (v5 selected, and its copper-pin locks applied)
//   * the detected id is still reported next to the selector (it's diagnostics, not the pick)
//   * the selector actually SUBMITS (name="board"), so Save persists the choice
//   * boardSel="custom" stays custom instead of snapping to the detected board
//   * no boardSel (fresh device / older config) still falls back to detection
//
// Run:  node docs/tests/board-persist.mjs     (from the repo root)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = fs.readFileSync(path.join(ROOT, 'src/pages/config.html'), 'utf8').replace(/__FWVER__/g, 'test');

// A v5 in the field: generic esp32s3dev build (detects as the DevKitC), v5 pins already saved.
const BASE = {
  hostname: 'luxdmx', ip: '192.168.1.42', version: 'test', board: 'esp32s3-devkitc-1', mcu: 'esp32s3',
  universe: 0, protocol: 2, useEthernet: false, ethSpi: true, ethRmii: false, hasEth: true, wifiMode: 0,
  ledType: 3, ledPin: -1, ledR: 1, ledG: 2, ledY: 6, ledB: 7, ledW: 15,
  dispType: 1, dispSda: 4, dispScl: 5, dispSck: 39, dispMosi: 40, dispCs: 41, dispDc: 42, dispRst: 38,
  ethCs: 10, ethSck: 12, ethMosi: 11, ethMiso: 13, ethInt: 14, ethRst: 9, ethFreq: 20, ethW5500: true, wiredPhy: 0,
  outputs: [
    { en: true, uni: 0, port: 1, tx: 17, rx: 18, rts: 8 },
    { en: true, uni: 1, port: 2, tx: 16, rx: 21, rts: 47 },
  ],
};

let info = { ...BASE, boardSel: 'luxdmx_v5' };
let posted = null;   // body of the last POST /config

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'POST' && url === '/config') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { posted = body; res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('saved'); });
    return;
  }
  if (url === '/config' || url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(CONFIG); return; }
  if (url === '/info.json')  { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(info)); return; }
  if (url === '/version.json'){ res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"version":"test","versions":[]}'); return; }
  if (url.endsWith('.json'))  { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
  res.writeHead(200); res.end('');
});

function check(name, cond) { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); return cond ? 0 : 1; }

const port = await new Promise((r) => server.listen(0, () => r(server.address().port)));
const browser = await chromium.launch();
let fails = 0;

// Load /config and wait until the board <select> has been populated + pointed somewhere.
async function open(page) {
  await page.goto(`http://127.0.0.1:${port}/config`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const s = document.getElementById('board-sel');
    return s && s.options.length > 1;
  }, { timeout: 8000 });
}

try {
  const page = await browser.newPage();
  await page.route('**://luxdmx.org/**', (route) => route.abort());   // offline: built-in board list only

  // ---- 1. saved v5 survives a reboot on a build that detects as a DevKitC ------------
  await open(page);
  const r1 = await page.evaluate(() => ({
    sel: document.getElementById('board-sel').value,
    detected: document.getElementById('board-detected').textContent,
    name: document.getElementById('board-sel').getAttribute('name'),
    o0tx: (() => { const e = document.getElementsByName('o0_tx')[0]; return e ? { v: e.value, disabled: e.disabled } : null; })(),
  }));
  fails += check('saved board (luxdmx_v5) wins over the detected DevKitC', r1.sel === 'luxdmx_v5');
  fails += check('the detected id is still shown as diagnostics', /esp32s3-devkitc-1/.test(r1.detected));
  fails += check('the selector submits (name="board")', r1.name === 'board');
  fails += check('v5 copper-pin locks follow the restored pick (o0_tx fixed 17)',
    !!r1.o0tx && r1.o0tx.v === '17' && r1.o0tx.disabled);

  // ---- 2. Save posts the picked board so it can be persisted -------------------------
  await page.click('#save-btn');
  await page.waitForFunction(() => document.body && document.body.textContent.indexOf('saved') >= 0, { timeout: 8000 });
  fails += check('POST /config carries board=luxdmx_v5', !!posted && /(^|&)board=luxdmx_v5(&|$)/.test(posted));

  // ---- 3. an explicit "Custom" pick is not overwritten by detection ------------------
  info = { ...BASE, boardSel: 'custom' };
  await open(page);
  const sel3 = await page.evaluate(() => document.getElementById('board-sel').value);
  fails += check('boardSel="custom" stays custom', sel3 === 'custom');

  // ---- 4. no saved pick (fresh device / pre-update config) -> detection --------------
  info = { ...BASE };   // no boardSel at all
  await open(page);
  const sel4 = await page.evaluate(() => document.getElementById('board-sel').value);
  fails += check('no boardSel falls back to the detected board', sel4 === 'esp32s3-devkitc-1');
} finally {
  await browser.close();
  server.close();
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll board-persist checks passed');
process.exit(fails ? 1 : 0);
