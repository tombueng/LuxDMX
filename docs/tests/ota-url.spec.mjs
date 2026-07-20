// Install firmware from a URL (POST /ota/url).
//
// The push upload (POST /ota/upload) has to buffer the request inside the running system, so a
// gateway that has been up a while can refuse it partway with nothing but a dropped connection
// to show for it. Measured on the bench: ~66 KB free heap, the upload died after 192 KB of a
// 1.59 MB image, twice, and ArduinoOTA authenticated and then went silent.
//
// This endpoint takes the road the release updater already takes: stash the target, reboot, and
// download early in setup() where the heap is pristine. An http:// URL needs no TLS handshake,
// so it needs single-digit KB contiguous instead of ~50 KB.
//
// The shape and validation tests are safe anywhere. Actually flashing the device is opt-in and
// serves the image over a throwaway local HTTP server.
import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { info, dmx } from './lib/device.mjs';
import { openConfig } from './lib/ui.mjs';
import { sleep } from './lib/net.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';
// Which .bin to serve when actually flashing. Defaults to this repo's esp32s3 build.
const BIN = process.env.LUXDMX_BIN
  || path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', '..',
                  '.pio', 'build', 'esp32s3dev', 'firmware.bin');

async function uptimeSec(request) {
  const m = /(\d+)d (\d+):(\d+):(\d+)/.exec((await dmx(request)).up);
  return m ? +m[1] * 86400 + +m[2] * 3600 + +m[3] * 60 + +m[4] : 0;
}

// First non-internal IPv4 address, so the device can reach back to us.
function lanAddress() {
  for (const nics of Object.values(os.networkInterfaces()))
    for (const n of nics || [])
      if (n.family === 'IPv4' && !n.internal) return n.address;
  return null;
}

test.describe('Install firmware from a URL', () => {
  test('a URL without a scheme is rejected, and nothing is scheduled', async ({ request }) => {
    const before = await uptimeSec(request);
    for (const bad of ['', '   ', 'firmware.bin', 'ftp://host/firmware.bin', '192.168.1.20/fw.bin']) {
      const res = await request.post('/ota/url', { form: { url: bad } });
      expect(res.status(), `"${bad}" should be refused`).toBe(400);
      expect((await res.json()).ok).toBeFalsy();
    }
    // A refused request must not have rebooted the device into an update attempt.
    await sleep(2000);
    expect(await uptimeSec(request), 'a rejected URL still rebooted the device')
      .toBeGreaterThanOrEqual(before);
  });

  test('GET /ota/url does not schedule an update', async ({ request }) => {
    // POST-only, same reasoning as /reboot: a prefetch must not be able to reflash a rig.
    const before = await uptimeSec(request);
    const res = await request.get('/ota/url?url=http://example.invalid/firmware.bin');
    expect(res.status()).not.toBe(200);
    await sleep(2000);
    expect(await uptimeSec(request)).toBeGreaterThanOrEqual(before);
  });

  test('the Firmware Update card offers the URL form', async ({ page }) => {
    await openConfig(page);
    const form = page.locator('form[action="/ota/url"]');
    await expect(form).toBeVisible();
    const url = page.locator('#ota-url');
    const btn = page.locator('#ota-url-btn');
    await expect(btn).toBeDisabled();                       // nothing typed yet
    await url.fill('not-a-url');
    await expect(btn, 'a bare string must not be submittable').toBeDisabled();
    await url.fill('http://192.168.1.20:8000/firmware.bin');
    await expect(btn).toBeEnabled();
    await url.fill('');                                     // leave it as we found it
    await expect(btn).toBeDisabled();
  });

  test('the device fetches and installs a .bin from a local HTTP server', async ({ request }) => {
    test.skip(!WRITE, 'device-mutating: set LUXDMX_WRITE=1 to run');
    test.skip(!fs.existsSync(BIN), `no firmware at ${BIN} (build it, or set LUXDMX_BIN)`);
    const addr = lanAddress();
    test.skip(!addr, 'no LAN address to serve the image from');
    test.setTimeout(240_000);

    const image = fs.readFileSync(BIN);
    let served = 0;
    const srv = http.createServer((req, res) => {
      served++;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': image.length });
      res.end(image);
    });
    await new Promise((r) => srv.listen(0, r));
    const url = `http://${addr}:${srv.address().port}/firmware.bin`;

    try {
      const before = await info(request);
      const res = await request.post('/ota/url', { form: { url } });
      expect(res.ok()).toBeTruthy();

      // It reboots into the clean-heap update, so it has to disappear first.
      let gone = false;
      for (let i = 0; i < 60 && !gone; i++) {
        try { await request.get('/info.json', { timeout: 1000 }); await sleep(250); } catch { gone = true; }
      }
      expect(gone, 'device never rebooted into the update').toBeTruthy();

      // Boot, download, flash, reboot again. Give it room.
      let back = null;
      for (let i = 0; i < 150 && !back; i++) {
        try { back = await info(request); } catch { await sleep(1000); }
      }
      expect(back, 'device did not come back after the URL update').toBeTruthy();

      expect(served, 'the device never fetched the image').toBeGreaterThan(0);
      // It really installed rather than falling back to a normal boot, and kept its config.
      expect(back.version).toBe(before.version);   // same image in, same version out
      expect(back.hostname).toBe(before.hostname);
      expect(back.outputs[0].uni).toBe(before.outputs[0].uni);
      expect(await uptimeSec(request)).toBeLessThan(180);
    } finally { srv.close(); }
  });
});
