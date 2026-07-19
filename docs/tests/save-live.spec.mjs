// Saving /config only restarts the device when something that actually needs a restart changed.
//
// Before this, every save rebooted. Most settings are re-read by the running firmware on every use
// (merge mode, signal-loss policy, output rate, LED brightness, button roles), so restarting for
// them was pure ceremony, and it cost a few seconds of dark DMX every time you nudged a universe.
//
// Fields bound to a GPIO or to a driver installed at boot still need the restart. The device now
// reports which ones forced it, so the UI can say why instead of rebooting unannounced.
import { test, expect } from '@playwright/test';
import { info, dmx } from './lib/device.mjs';
import { sleep } from './lib/net.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';
function skipUnlessWrite() {
  test.skip(!WRITE, 'device-mutating: set LUXDMX_WRITE=1 to run');
}

// Uptime as seconds. A restart shows up as this going DOWN.
async function uptimeSec(request) {
  const m = /(\d+)d (\d+):(\d+):(\d+)/.exec((await dmx(request)).up);
  if (!m) return 0;
  return +m[1] * 86400 + +m[2] * 3600 + +m[3] * 60 + +m[4];
}

test.describe('Save without reboot', () => {
  test('the save button no longer promises a restart', async ({ page }) => {
    await page.goto('/config');
    await expect(page.locator('#save-btn')).toHaveText(/^Save$/);
  });

  test('a live-only change is applied without restarting', async ({ page, request }) => {
    skipUnlessWrite();
    test.setTimeout(90_000);
    const up0 = await uptimeSec(request);

    await page.goto('/config', { waitUntil: 'networkidle' });
    // Merge mode is CFG_LIVE: the merge engine re-reads it on every frame.
    const sel = page.locator('select[name="o1_merge"]');
    const was = await sel.inputValue();
    const next = was === '0' ? '1' : '0';
    await sel.selectOption(next);
    await page.click('#save-btn');
    await page.waitForTimeout(2500);

    // No "restarting" modal, because nothing needed one.
    await expect(page.locator('#app-modal.show')).toHaveCount(0);

    const after = await info(request);
    expect(after.outputs[1].merge, 'the change actually stuck').toBe(Number(next));
    const up1 = await uptimeSec(request);
    expect(up1, `uptime went ${up0} -> ${up1}, so the device restarted`).toBeGreaterThanOrEqual(up0);

    // put it back
    await page.goto('/config', { waitUntil: 'networkidle' });
    await page.locator('select[name="o1_merge"]').selectOption(was);
    await page.click('#save-btn');
    await page.waitForTimeout(2000);
  });

  test('a pin/driver-bound change restarts, and says which setting forced it', async ({ page, request }) => {
    skipUnlessWrite();
    test.setTimeout(120_000);
    const before = await info(request);
    const up0 = await uptimeSec(request);

    await page.goto('/config', { waitUntil: 'networkidle' });
    // Hostname is CFG_REBOOT (mDNS and the DHCP name are claimed at boot) and, unlike the pin
    // fields, is never locked by a board template, so this works on every board.
    const want = before.hostname === 'dmx-gateway' ? 'dmx-gateway-t' : 'dmx-gateway';
    await page.locator('#dev-host').fill(want);
    await page.click('#save-btn');
    await page.waitForTimeout(2500);

    const body = await page.locator('#app-modal-body').textContent();
    expect(body, 'the modal explains the restart').toMatch(/need a restart/i);
    expect(body, 'and names the setting that forced it').toMatch(/Hostname/);

    await sleep(12_000);
    const up1 = await uptimeSec(request);
    expect(up1, `uptime ${up0} -> ${up1}, expected a restart`).toBeLessThan(up0);
    expect((await info(request)).hostname).toBe(want);

    // put it back (and let it restart again)
    await page.goto('/config', { waitUntil: 'networkidle' });
    await page.locator('#dev-host').fill(before.hostname);
    await page.click('#save-btn');
    await sleep(12_000);
    expect((await info(request)).hostname).toBe(before.hostname);
  });
});
