// Behaviour test for the wirable-connector strips in the pin picker.
//
// The board diagram answers "which GPIO is that pad?"; the J4/J6 strips answer "which
// hole in the plug do I crimp this wire into?". This serves the real src/pages/config.html
// with a stub /info.json reporting a LuxDMX v6, opens the picker, and asserts that both
// headers render as connectors in their real pin order, that rails are inert, that a
// header pin click assigns into the field being picked, and that each GPIO field carries
// its "J4.3" header-pin hint.
//
// Run:  node docs/tests/v6-headers.mjs     (from the repo root)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expandAll } from './lib/ui.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = fs.readFileSync(path.join(ROOT, 'src/pages/config.html'), 'utf8').replace(/__FWVER__/g, 'test');

const INFO = {
  hostname: 'luxdmx', ip: '192.168.1.42', version: 'test', board: 'luxdmx_v6', mcu: 'esp32s3',
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
  res.writeHead(200); res.end('');
});

function check(name, cond) { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); return cond ? 0 : 1; }

const port = await new Promise((r) => server.listen(0, () => r(server.address().port)));
const browser = await chromium.launch();
let fails = 0;
try {
  const page = await browser.newPage();
  await page.route('**://luxdmx.org/**', (route) => route.abort());   // offline: built-in descriptors only
  await page.goto(`http://127.0.0.1:${port}/config`, { waitUntil: 'domcontentloaded' });
  await expandAll(page);   // the settings sections start folded; this test clicks real controls
  await page.waitForFunction(() => {
    const i = document.getElementsByName('o0_tx')[0];
    return i && i.disabled;                                            // v6 detected, locks applied
  }, { timeout: 8000 });

  // ---- the "J4.3" hint next to each GPIO field (no diagram needed) ---------
  const hints = await page.evaluate(() => {
    const of = (n) => {
      const inp = document.getElementsByName(n)[0];
      const grp = inp && inp.closest('.pin-grp');
      const tag = grp && grp.querySelector('.hdr-hint');
      return tag ? tag.textContent : null;
    };
    return { dispsda: of('dispsda'), dispscl: of('dispscl'), disprst: of('disprst'), o0_tx: of('o0_tx') };
  });
  fails += check('display SDA (GPIO4) is tagged J4.3', hints.dispsda === 'J4.3');
  fails += check('display SCL (GPIO5) is tagged J4.4', hints.dispscl === 'J4.4');
  fails += check('display RST (GPIO38) is tagged J4.9', hints.disprst === 'J4.9');
  fails += check('a non-header pin (DMX A TX, GPIO17) has no header tag', hints.o0_tx === null);

  // ---- the connector strips in the picker ----------------------------------
  await page.click('#board-open');
  await page.waitForSelector('#board-svg-wrap .hdr-strips svg.hdr-strip', { timeout: 8000 });
  const strips = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll('#board-svg-wrap .hdr-strips svg.hdr-strip')];
    return svgs.map((svg) => ({
      caption: svg.querySelector('text').textContent,
      // pads are the assignable signal pins, in document (= pin) order
      pads: [...svg.querySelectorAll('g.pad')].map((g) => +g.getAttribute('data-gpio')),
      rails: svg.querySelectorAll('g.ppin.power').length,
      railsClickable: svg.querySelectorAll('g.ppin.power[data-gpio]').length,
      // every pin number 1..9 is drawn
      nums: [...svg.querySelectorAll('g text')].map((t) => t.textContent),
      tips: [...svg.querySelectorAll('g title')].map((t) => t.textContent),
    }));
  });
  fails += check('both headers render as connector strips', strips.length === 2);
  const [j4, j6] = strips;
  fails += check('J4 is captioned "J4 · Display header"', /^J4 · Display header$/.test(j4.caption || ''));
  fails += check('J6 is captioned "J6 · Expansion header"', /^J6 · Expansion header$/.test(j6.caption || ''));
  // pin ORDER is the whole point: J4 signal pins are 3..9 = SDA SCL SCK MOSI CS DC RST
  fails += check('J4 signal pins are in physical pin order (4,5,39,40,41,42,38)',
    JSON.stringify(j4.pads) === JSON.stringify([4, 5, 39, 40, 41, 42, 38]));
  // J6: pins 1/2 are the rails that match J4, 3..8 are IO35/36/37/48 then UART0, 9 a 2nd GND
  fails += check('J6 signal pins are in physical pin order (35,36,37,48,43,44)',
    JSON.stringify(j6.pads) === JSON.stringify([35, 36, 37, 48, 43, 44]));
  fails += check('J4 rails (3V3, GND) are shown', j4.rails === 2);
  fails += check('J6 rails (3V3, GND, GND) are shown', j6.rails === 3);
  fails += check('no rail is a click target', j4.railsClickable === 0 && j6.railsClickable === 0);
  fails += check('every pin number 1..9 is drawn on J6',
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'].every((n) => j6.nums.includes(n)));
  fails += check('a signal tooltip names its header pin', j4.tips.some((t) => /GPIO4 .*J4 pin 3/.test(t)));
  fails += check('a rail tooltip says it is not assignable', j6.tips.some((t) => /^3V3 .*not assignable/.test(t)));

  // ---- clicking a header pin assigns it into the field being picked --------
  await page.click('#board-modal-done');
  await page.locator('.pin-grp:has(input[name="dispscl"]) button.pin-pick').click();
  await page.waitForSelector('#board-svg-wrap .hdr-strips svg.hdr-strip', { timeout: 8000 });
  // wire display SCL to J6 pin 4 (IO36) instead of the J4 default
  await page.locator('.hdr-strips g.pad[data-gpio="36"] rect.pin-pad').first().click();
  const after = await page.evaluate(() => {
    const inp = document.getElementsByName('dispscl')[0];
    const tag = inp.closest('.pin-grp').querySelector('.hdr-hint');
    return { value: inp.value, hint: tag ? tag.textContent : null, open: document.getElementById('board-modal').classList.contains('show') };
  });
  fails += check('clicking J6 pin 4 assigns GPIO36 to display SCL', after.value === '36');
  fails += check('the picker closes after the pick', after.open === false);
  fails += check('the field hint follows the new pin (J6.4)', after.hint === 'J6.4');

  // ---- the assigned pin is called out on the strip -------------------------
  await page.click('#board-open');
  await page.waitForSelector('#board-svg-wrap .hdr-strips svg.hdr-strip', { timeout: 8000 });
  const callout = await page.evaluate(() => {
    const g = document.querySelector('.hdr-strips g.pad[data-gpio="36"]');
    const svg = g.closest('svg');
    return {
      tip: g.querySelector('title').textContent,
      texts: [...svg.querySelectorAll('text')].map((t) => t.textContent),
    };
  });
  fails += check('J6 pin 4 tooltip now names the assigned role', /Display SCL|SCL/i.test(callout.tip) && /J6 pin 4/.test(callout.tip));
  fails += check('the strip draws the assignment callout', callout.texts.some((t) => /SCL/i.test(t)));
} finally {
  await browser.close();
  server.close();
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll v6 header-strip checks passed');
process.exit(fails ? 1 : 0);
