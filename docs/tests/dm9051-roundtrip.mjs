// Regression test: a DM9051 box must survive a /config save.
//
// The wired-PHY selector is driven from /info.json's `ethSpiPhy` (0 = W5500, 1 = DM9051)
// and writes it straight back through a hidden field that rides along on every save. So
// if the firmware doesn't PUBLISH ethSpiPhy, the page reads undefined, lands on W5500,
// and posts ethspiphy=0 the next time you save anything at all -- renaming the host,
// moving a DMX pin, whatever. A DM9051 device silently becomes a W5500 device and loses
// its wired link on the next boot. /info.json was missing the field entirely.
//
// This drives the real src/pages/config.html against a stub reporting a DM9051 box and
// asserts the value survives the round trip. The W5500 direction is checked too, so a
// future change can't "fix" this by hard-coding the other chip.
//
// Run:  node docs/tests/dm9051-roundtrip.mjs     (from the repo root)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = fs.readFileSync(path.join(ROOT, 'src/pages/config.html'), 'utf8').replace(/__FWVER__/g, 'test');

// A wired box on an SPI PHY. `ethSpiPhy` is the field under test; everything else is filler.
const baseInfo = {
  hostname: 'luxdmx', ip: '192.168.1.42', version: 'test', board: 'esp32s3-devkitc-1', mcu: 'esp32s3',
  universe: 0, protocol: 2, ledType: 0, dispType: 0,
  ethSpi: true, ethRmii: false, hasEth: true, ethW5500: true, useEthernet: true,
  wiredPhy: 0, linkLossMode: 0, wifiMode: 0,
  ethCs: 10, ethSck: 12, ethMosi: 11, ethMiso: 13, ethInt: 14, ethRst: 9, ethFreq: 20,
  outputs: [{ en: true, uni: 0, port: 1, tx: 17, rx: 18, rts: -1 }],
};

function serve(info) {
  return http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/config' || url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(CONFIG); return; }
    if (url === '/info.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(info)); return; }
    if (url === '/version.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"version":"test","versions":[]}'); return; }
    if (url.endsWith('.json')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
    res.writeHead(200); res.end('');
  });
}

function check(name, cond) { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); return cond ? 0 : 1; }

// Load /config against `info` and report what the selector shows + what a save would POST.
async function readBack(browser, info) {
  const server = serve(info);
  const port = await new Promise((r) => server.listen(0, () => r(server.address().port)));
  try {
    const page = await browser.newPage();
    await page.route('**://luxdmx.org/**', (route) => route.abort());
    await page.goto(`http://127.0.0.1:${port}/config`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const s = document.getElementById('wired-sel');
      return s && s.options.length > 1;                    // selector built from /info.json
    }, { timeout: 8000 });
    const r = await page.evaluate(() => ({
      selector: document.getElementById('wired-sel').value,
      posted: document.getElementById('eth-spi-phy').value,   // the hidden field a save submits
    }));
    await page.close();
    return r;
  } finally { server.close(); }
}

const browser = await chromium.launch();
let fails = 0;
try {
  // --- the bug: a DM9051 box must stay a DM9051 box -------------------------
  const dm = await readBack(browser, { ...baseInfo, ethSpiPhy: 1 });
  fails += check('DM9051 device: selector shows DM9051', dm.selector === 'dm9051');
  fails += check('DM9051 device: a save posts ethspiphy=1 (not silently reset to W5500)', dm.posted === '1');

  // --- the other direction, so this can't be "fixed" by hard-coding ---------
  const w5 = await readBack(browser, { ...baseInfo, ethSpiPhy: 0 });
  fails += check('W5500 device: selector shows W5500', w5.selector === 'w5500');
  fails += check('W5500 device: a save posts ethspiphy=0', w5.posted === '0');

  // --- what the old firmware did: field absent => wrong answer --------------
  // Kept as documentation of the failure mode. With ethSpiPhy missing the page cannot
  // know the chip, falls back to W5500, and would clobber a DM9051 box on save. This is
  // why the firmware MUST publish the field (see /info.json in src/main.cpp).
  const missing = await readBack(browser, { ...baseInfo });
  fails += check('field absent (pre-fix firmware) demonstrably loses the setting',
    missing.selector === 'w5500' && missing.posted === '0');
} finally {
  await browser.close();
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll DM9051 round-trip checks passed');
process.exit(fails ? 1 : 0);
