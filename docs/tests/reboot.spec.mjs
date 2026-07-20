// Remote restart (POST /reboot).
//
// Every other restart path the firmware has is a side effect of something else: saving a
// setting, finishing an OTA, erasing the WiFi credentials. There was no way to simply
// restart a box you can reach over the network, which matters because a long-running
// gateway can fragment its heap far enough that an OTA upload no longer fits — and the
// only cure was walking over to it and pulling the plug.
//
// The shape tests are safe to run anywhere. The one that actually restarts the device is
// opt-in, like the rest of the device-mutating suite.
import { test, expect } from '@playwright/test';
import { info, dmx } from './lib/device.mjs';
import { openConfig } from './lib/ui.mjs';
import { sleep } from './lib/net.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';

// "00d 00:17:34" -> seconds. A restart shows up as this going DOWN.
async function uptimeSec(request) {
  const m = /(\d+)d (\d+):(\d+):(\d+)/.exec((await dmx(request)).up);
  if (!m) return 0;
  return +m[1] * 86400 + +m[2] * 3600 + +m[3] * 60 + +m[4];
}

test.describe('Remote restart', () => {
  test('GET /reboot does NOT restart the device', async ({ request }) => {
    // The whole point of making this POST-only: a browser prefetching a link, a link
    // scanner, or a dashboard thumbnailer must not be able to black out a live rig.
    const before = await uptimeSec(request);
    const res = await request.get('/reboot');
    expect(res.status(), 'GET must not be a working restart').not.toBe(200);
    await sleep(3000);
    const after = await uptimeSec(request);
    expect(after, 'device restarted on a GET').toBeGreaterThanOrEqual(before);
  });

  test('the Device section offers a Restart button', async ({ page }) => {
    await openConfig(page);
    const btn = page.locator('#reboot-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveText(/Restart/i);
    // It must not be a submit control sitting inside the config form, or it would save.
    expect(await btn.evaluate((el) => el.type)).toBe('button');
  });

  test('clicking Restart asks first, and Cancel does nothing', async ({ page, request }) => {
    const before = await uptimeSec(request);
    await openConfig(page);
    await page.locator('#reboot-btn').click();
    await expect(page.locator('#app-modal')).toBeVisible();
    await expect(page.locator('#app-modal-body')).toContainText(/restart/i);
    await page.locator('#app-modal-cancel').click();
    await expect(page.locator('#app-modal')).toBeHidden();
    await sleep(2000);
    expect(await uptimeSec(request), 'Cancel restarted the device').toBeGreaterThanOrEqual(before);
  });

  test('POST /reboot restarts the device and keeps every setting', async ({ request }) => {
    test.skip(!WRITE, 'device-mutating: set LUXDMX_WRITE=1 to run');
    test.setTimeout(120_000);
    const before = await info(request);
    const upBefore = await uptimeSec(request);

    const res = await request.post('/reboot');
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).ok).toBeTruthy();

    // It answers first and restarts a moment later, so wait for it to actually go away
    // before waiting for it to come back — otherwise "it answers" proves nothing.
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) {
      try { await request.get('/info.json', { timeout: 1000 }); await sleep(250); }
      catch { gone = true; }
    }
    expect(gone, 'device never went away, so it never restarted').toBeTruthy();

    let back = null;
    for (let i = 0; i < 60 && !back; i++) {
      try { back = await info(request); } catch { await sleep(1000); }
    }
    expect(back, 'device did not come back within a minute').toBeTruthy();

    // Uptime restarted from zero, and nothing was reconfigured on the way through.
    expect(await uptimeSec(request)).toBeLessThan(upBefore + 1);
    expect(back.hostname).toBe(before.hostname);
    expect(back.outputs[0].uni).toBe(before.outputs[0].uni);
    expect(back.useEthernet).toBe(before.useEthernet);
    expect(back.wifiSsid).toBe(before.wifiSsid);   // /reboot is not /reset
    expect(back.ledType).toBe(before.ledType);
  });
});
