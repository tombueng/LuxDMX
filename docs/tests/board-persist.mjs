// Behaviour test for "the board selection sticks across a reboot / OTA".
//
// The board a build REPORTS is compile-time (BOARD_ID in main.cpp) and a released LuxDMX v6
// runs the generic esp32s3dev firmware, so it reports "esp32s3-devkitc-1" like any other S3.
// The picked board therefore has to be persisted on the device (cfg.boardSel, schema key
// "board", surfaced as /info.json boardSel). Before that it wasn't stored anywhere, so the
// dropdown snapped back to "ESP32-S3 DevKitC-1" on every reboot and firmware update while the
// applied pins stayed put, which is exactly what a user sees as "the selection doesn't stick".
//
// Serves the real src/pages/config.html against stub devices and asserts:
//   * boardSel wins over the detected board (v6 selected, and its copper-pin locks applied)
//   * the detected id is still reported next to the selector (it's diagnostics, not the pick)
//   * the selector actually SUBMITS (name="board"), so Save persists the choice
//   * boardSel="custom" stays custom instead of snapping to the detected board
//   * no boardSel (fresh device / older config) still falls back to detection
//   * a saved board this page can't show (offline catalog, unknown id) is KEPT, not replaced by the
//     detected one on the next Save, and the page still works
//
// Run:  node docs/tests/board-persist.mjs     (from the repo root)
//       CHROME=/path/to/chrome node docs/tests/board-persist.mjs   (when playwright's own browser is missing)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = fs.readFileSync(path.join(ROOT, 'src/pages/config.html'), 'utf8').replace(/__FWVER__/g, 'test');

// A v6 in the field: generic esp32s3dev build (detects as the DevKitC), v6 pins already saved.
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

let info = { ...BASE, boardSel: 'luxdmx_v6' };
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

// Read one field out of a POST body. Saving goes over fetch with a FormData body since the
// no-reboot save landed, so /config arrives as multipart, not urlencoded -- grepping for
// "name=value" silently stopped matching anything.
function postedField(body, name) {
  if (!body) return null;
  if (/^--/.test(body)) {
    const m = new RegExp(`name="${name}"\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n--`).exec(body);
    return m ? m[1] : null;
  }
  const m = new RegExp(`(?:^|&)${name}=([^&]*)`).exec(body);
  return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
}

const port = await new Promise((r) => server.listen(0, () => r(server.address().port)));
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
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

  // ---- 1. saved v6 survives a reboot on a build that detects as a DevKitC ------------
  await open(page);
  const r1 = await page.evaluate(() => ({
    sel: document.getElementById('board-sel').value,
    detected: document.getElementById('board-detected').textContent,
    name: document.getElementById('board-sel').getAttribute('name'),
    o0tx: (() => { const e = document.getElementsByName('o0_tx')[0]; return e ? { v: e.value, disabled: e.disabled } : null; })(),
  }));
  fails += check('saved board (luxdmx_v6) wins over the detected DevKitC', r1.sel === 'luxdmx_v6');
  fails += check('the detected id is still shown as diagnostics', /esp32s3-devkitc-1/.test(r1.detected));
  fails += check('the selector submits (name="board")', r1.name === 'board');
  fails += check('v6 copper-pin locks follow the restored pick (o0_tx fixed 17)',
    !!r1.o0tx && r1.o0tx.v === '17' && r1.o0tx.disabled);

  // ---- 2. Save posts the picked board so it can be persisted -------------------------
  await page.click('#save-btn');
  await page.waitForFunction(() => document.body && document.body.textContent.indexOf('saved') >= 0, { timeout: 8000 });
  fails += check('POST /config carries board=luxdmx_v6', postedField(posted, 'board') === 'luxdmx_v6');

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

  // ---- 5. a saved board this page can't show is kept ---------------------------------
  // An id this firmware doesn't know (one from another firmware, a catalog board while the
  // browser is offline -- luxdmx.org is blocked above -- or a typo over the serial console) must
  // not wedge the page, AND must not be quietly replaced: the selector used to sit on the
  // detected board and the next Save wrote that over the pick. Now it stays selected under a
  // placeholder, behaves like Custom (no copper locks), and Save sends it back unchanged.
  info = { ...BASE, boardSel: 'luxdmx_v5' };
  await open(page);
  const r5 = await page.evaluate(() => {
    const sel = document.getElementById('board-sel');
    return {
      sel: sel.value,
      label: sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '',
      o0tx: (() => { const e = document.getElementsByName('o0_tx')[0]; return e ? { v: e.value, disabled: e.disabled } : null; })(),
      saveEnabled: (() => { const e = document.getElementById('save-btn'); return e ? !e.disabled : false; })(),
    };
  });
  fails += check('an unknown saved board stays selected', r5.sel === 'luxdmx_v5');
  fails += check('...and says it is not in this firmware', /not in this firmware/.test(r5.label));
  fails += check('...with no copper locks (like Custom)', !!r5.o0tx && !r5.o0tx.disabled);
  fails += check('the form still works with it', r5.o0tx !== null && r5.saveEnabled);
  posted = null;
  await page.click('#save-btn');
  await page.waitForFunction(() => document.body && document.body.textContent.indexOf('saved') >= 0, { timeout: 8000 });
  fails += check('Save writes the saved board back, not the detected one', postedField(posted, 'board') === 'luxdmx_v5');
} finally {
  await browser.close();
  server.close();
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll board-persist checks passed');
process.exit(fails ? 1 : 0);
