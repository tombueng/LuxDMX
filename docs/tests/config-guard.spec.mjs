// The /config page must never invent settings (issue #132).
//
// It renders from /info.json. If that answer isn't actually this device's config
// -- a half-booted device, an error body, a captive portal -- the page used to
// substitute hardcoded placeholders ("output A on GPIO17, output B off") and left
// Save enabled, so one click wrote those invented pins over a working setup. The
// device kept running on its real pins until the next reboot, which is why it
// showed up as "the UI is out of sync" rather than as an obvious failure.
//
// Read-only: every case here intercepts /info.json in the browser, so the device
// itself is never written to and no LUXDMX_WRITE gate is needed.
import { test, expect } from '@playwright/test';

// Serve `body` for /info.json, let everything else through.
async function serveInfo(page, body, status = 200) {
  await page.route('**/info.json*', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
}

const SAVE = '#save-btn';

test.describe('/config guards against a payload that is not the config', () => {
  test('a real /info.json renders and Save is enabled', async ({ page }) => {
    await page.goto('/config');
    await expect(page.locator(SAVE)).toBeEnabled({ timeout: 15_000 });
    // The outputs came from the device, not from a placeholder.
    await expect(page.locator('#o0_tx')).toHaveCount(1);
  });

  test('an answer without outputs disables Save instead of inventing pins', async ({ page }) => {
    await serveInfo(page, { version: '1.0.0', hostname: 'dmx-gateway' });   // valid JSON, no config
    await page.goto('/config');
    const save = page.locator(SAVE);
    await expect(save).toBeDisabled({ timeout: 15_000 });
    await expect(save).toHaveText(/cannot read settings/i);
  });

  test('an error body does not become "output A on GPIO17"', async ({ page }) => {
    await serveInfo(page, { error: 'busy' }, 503);
    await page.goto('/config');
    await expect(page.locator(SAVE)).toBeDisabled({ timeout: 15_000 });
    // The old placeholder was tx 17 on output A with output B off. If a value is shown
    // at all it must not be that fabricated pair presented as saveable settings.
    const tx0 = page.locator('#o0_tx');
    if (await tx0.count()) await expect(page.locator(SAVE)).toBeDisabled();
  });

  test('outputs sent as something other than an array is refused', async ({ page }) => {
    await serveInfo(page, { version: '1.0.0', outputs: 'nope' });
    await page.goto('/config');
    await expect(page.locator(SAVE)).toBeDisabled({ timeout: 15_000 });
  });
});
