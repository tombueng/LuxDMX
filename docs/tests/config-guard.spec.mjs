// The /config page must never invent settings (issue #132).
//
// It renders from /info.json. If that answer isn't actually this device's config
// -- a half-booted device, an error body, a captive portal -- the page used to
// substitute hardcoded placeholders ("output A on GPIO17, output B off") and left
// Save enabled, so one click wrote those invented pins over a working setup. The
// device kept running on its real pins until the next reboot, which is why it
// showed up as "the UI is out of sync" rather than as an obvious failure.
//
// The same placeholder also came up with a perfectly good /info.json: when the answer arrived
// before the browser had run the page's later <script> blocks (a quick second load in the same
// tab), populating hit "initBoards is not defined", fell into the placeholder path with Save
// already enabled, and a save wrote "A on 17/16, B off" over the real pins. The race tests below
// force that order every time by answering /info.json before those blocks exist.
//
// Read-only: every case here fakes /info.json in the browser, so the device is never written to
// and no LUXDMX_WRITE gate is needed.
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
    // The outputs came from the device, not from a placeholder. By name: the output fields
    // have no id, and a board that wires TX in copper adds a hidden .fixed-mirror with the same
    // name, so leave that one out.
    await expect(page.locator('input[name="o0_tx"]:not(.fixed-mirror)')).toHaveCount(1);
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

  test('Save stays off in that state even after a pin is edited', async ({ page }) => {
    await serveInfo(page, { error: 'busy' }, 503);
    // A POST would write the placeholders: catch it here so the device is never touched, even
    // on a firmware that still has the hole.
    let posted = false;
    await page.route('**/config', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posted = true;
      return route.abort();
    });
    await page.goto('/config');
    const save = page.locator(SAVE);
    await expect(save).toHaveText(/cannot read settings/i, { timeout: 15_000 });
    // Editing a pin runs the pin check, which switched Save back on whenever the pins looked fine.
    await page.locator('[name="o0_tx"]:not(.fixed-mirror)').evaluate((el) => {
      el.value = '21';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(500);
    await expect(save).toBeDisabled();
    // And a submit that gets through some other way (Enter in a field) sends nothing.
    await page.locator('form[action="/config"]').evaluate((f) => f.requestSubmit());
    await page.waitForTimeout(1000);
    expect(posted, 'placeholders were posted').toBe(false);
  });

  test('outputs sent as something other than an array is refused', async ({ page }) => {
    await serveInfo(page, { version: '1.0.0', outputs: 'nope' });
    await page.goto('/config');
    await expect(page.locator(SAVE)).toBeDisabled({ timeout: 15_000 });
  });
});

// Answer the page's own /info.json fetch instantly, from data the test already has (or fail it
// at once). A promise that's already settled runs its .then at the first checkpoint after the
// first <script> block finishes, i.e. before the parser has even reached the later blocks: the
// order a quick second load in the same tab produced by chance, made certain. (Rewriting the
// document instead doesn't work: a page Playwright serves itself counts as public to Chromium,
// which then blocks every fetch to the device.)
async function answerInfoEarly(page, data) {
  await page.addInitScript((d) => {
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      if (String(url).split('?')[0] !== '/info.json') return real(url, opts);
      if (d === null) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(d))) });
    };
  }, data);
}

test.describe('/config when /info.json answers before the page has finished loading', () => {
  test('the real outputs are shown, not the placeholder, and nothing throws', async ({ page, request }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const d = await (await request.get('/info.json')).json();
    await answerInfoEarly(page, d);
    await page.goto('/config');
    await expect(page.locator(SAVE)).toBeEnabled({ timeout: 15_000 });
    await page.waitForTimeout(1000);   // a late failure would flip it to "Cannot read settings"
    await expect(page.locator(SAVE)).not.toHaveText(/cannot read settings/i);
    expect(errors, 'script errors while loading').toEqual([]);
    await expect(page.locator('#board-sel')).not.toHaveValue('');
    for (const [i, o] of d.outputs.entries()) {
      const tx = page.locator(`[name="o${i}_tx"]:not(.fixed-mirror)`);
      await expect(tx, `output ${i} has a card`).toHaveCount(1);
      for (const k of ['tx', 'rx', 'rts'])
        await expect(page.locator(`[name="o${i}_${k}"]:not(.fixed-mirror)`), `output ${i} ${k}`).toHaveValue(String(o[k]));
    }
  });

  test('a failed /info.json at that moment keeps Save off', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await answerInfoEarly(page, null);
    await page.goto('/config');
    await expect(page.locator(SAVE)).toHaveText(/cannot read settings/i, { timeout: 15_000 });
    await expect(page.locator(SAVE)).toBeDisabled();
    expect(errors, 'script errors while loading').toEqual([]);
  });
});
