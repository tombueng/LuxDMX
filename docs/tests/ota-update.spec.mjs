// OTA update flow: the home-page "Update" button → install popup → progress page.
//
// Runs against a live LuxDMX (see playwright.config.mjs for target resolution).
// The /ota/status shape check is read-only. The full end-to-end test (flash a dev
// build, hit Update, watch the progress dialog show the real phases and only land
// on the live page once the device reports the NEW version) reflashes the device
// several times and is opt-in via LUXDMX_WRITE=1.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The dev build that exercises the new progress page + /ota/status. Override with
// LUXDMX_FW if your build dir differs.
const FW = process.env.LUXDMX_FW || resolve(__dirname, '../../.pio/build/luxdmx_v4/firmware.bin');

async function currentVersion(request) {
  const r = await request.get('/version.json', { timeout: 5_000 });
  return (await r.json()).current;
}

// Upload a local firmware.bin over OTA, then wait for a real reboot: see the
// device go offline (the flash + restart) and come back — optionally on
// `wantCurrent`. Watching the down→up edge (not just "the server answered")
// avoids trusting the old firmware that keeps serving HTTP mid-write.
async function flashAndWait(request, buf, wantCurrent, ms = 150_000) {
  await request.post('/ota/upload', {
    timeout: 180_000,
    multipart: { firmware: { name: 'firmware.bin', mimeType: 'application/octet-stream', buffer: buf } },
  });
  const t0 = Date.now();
  let sawDown = false;
  await new Promise((r) => setTimeout(r, 1_500));
  while (Date.now() - t0 < ms) {
    let up = false, cur = null;
    try {
      const r = await request.get('/version.json', { timeout: 2_500 });
      if (r.ok()) { up = true; cur = (await r.json()).current; }
    } catch { up = false; }
    if (!up) sawDown = true;
    else if (sawDown && (!wantCurrent || cur === wantCurrent)) return cur;
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new Error('device did not reboot back after flash');
}

test.describe('OTA update flow', () => {
  test('/ota/status reports a {phase,pct} shape', async ({ request }) => {
    const r = await request.get('/ota/status');
    expect(r.ok()).toBeTruthy();
    const d = await r.json();
    expect(typeof d.phase).toBe('number');
    expect(typeof d.pct).toBe('number');
    expect(d.pct).toBeGreaterThanOrEqual(0);
    expect(d.pct).toBeLessThanOrEqual(100);
  });

  test('flash dev → Update → dialog shows progress and lands live on the new version', async ({ page, request }) => {
    test.skip(process.env.LUXDMX_WRITE !== '1',
      'set LUXDMX_WRITE=1 to run the device-mutating OTA test (reflashes the device a few times)');
    test.setTimeout(420_000);

    const fw = readFileSync(FW);

    // 1) Put a known dev build on the device: an update is then genuinely
    //    available, and the progress page being served is the one under test.
    await flashAndWait(request, fw, 'dev');

    // 2) The home page shows the update banner (dev < latest release).
    await page.goto('/');
    await expect(page.locator('#update-banner')).toBeVisible({ timeout: 25_000 });
    const target = (await page.locator('#update-ver').textContent()).trim();
    expect(target).toMatch(/^\d+\.\d+\.\d+$/);

    // 3) Hit Update → confirm popup → Update & reboot (installs the latest release).
    await page.locator('#update-go').click();
    await expect(page.locator('#app-modal')).toBeVisible();
    await expect(page.locator('#app-modal-body')).toContainText('Install v' + target);
    await expect(page.locator('#app-modal-ok')).toHaveText(/Update & reboot/);
    await page.locator('#app-modal-ok').click();

    // 4) We land on the progress dialog — it must NOT bounce straight back to the
    //    status page while the old firmware is still serving the download. The
    //    spinner + a progress/installing/rebooting title prove we're on it.
    await expect(page.locator('#spin')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#title'))
      .toHaveText(/update|download|flash|install|reboot/i, { timeout: 20_000 });

    // 5) Only once the device reports the NEW version does it reload to the live
    //    status page — and that page must be live, not a stale frozen one.
    await expect(page.locator('#grid .ch')).toHaveCount(512, { timeout: 180_000 });
    await expect(page.locator('#ws-badge')).toHaveText(/Live/, { timeout: 20_000 });
    await expect(page.locator('#fps')).not.toHaveText('—', { timeout: 20_000 });   // live data, not stale

    const after = await currentVersion(request);
    expect(after, 'device should report the freshly installed version').toBe(target);
    expect(after).not.toBe('dev');

    // 6) Restore the dev build so the device stays on the build under test.
    await flashAndWait(request, fw, 'dev');
    expect(await currentVersion(request)).toBe('dev');
  });
});
