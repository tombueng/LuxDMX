// Web UI loads + REST API contract (no network input required).
import { test, expect } from '@playwright/test';

test.describe('Web UI + REST', () => {
  test('status page loads with the channel grid and key cards', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/LuxDMX/i);
    await expect(page.locator('#grid .ch')).toHaveCount(512);
    await expect(page.locator('#senders-body')).toBeVisible();
    await expect(page.locator('#log-body')).toBeVisible();
    // Subtitle is filled from /info.json (hostname · ip · Universe N · version)
    await expect(page.locator('#nav-sub')).toContainText('Universe');
  });

  test('settings page loads with protocol + outputs + network cards', async ({ page }) => {
    await page.goto('/config');
    await expect(page.locator('select[name="protocol"]')).toBeVisible();
    await expect(page.locator('.out-card')).toHaveCount(2);
    await expect(page.locator('input[name="hostname"]')).toBeVisible();
    await expect(page.locator('#save-btn')).toBeEnabled();
    // Save & Restart is a fixed bar, always visible, wired to the config form
    await expect(page.locator('#save-bar')).toBeVisible();
    expect(await page.locator('#save-bar').evaluate(el => getComputedStyle(el).position)).toBe('fixed');
    expect(await page.locator('#save-btn').evaluate(el => el.form && el.form.id)).toBe('cfg-form');
  });

  test('live status badge connects (WebSocket)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#ws-badge')).toHaveText(/Live/, { timeout: 10000 });
  });

  test('navbar link indicator reflects the active interface (WiFi/LAN/AP)', async ({ page, request }) => {
    await page.goto('/');
    // wait for the first WS frame to populate the navbar (value leaves the "—" default)
    await expect(page.locator('#rssi')).not.toHaveText('—', { timeout: 10000 });
    const label = (await page.locator('#net-label').textContent()).trim();
    const value = (await page.locator('#rssi').textContent()).trim();
    expect(['WiFi', 'LAN', 'AP']).toContain(label);
    if (label === 'LAN')  expect(value).toMatch(/^\d+M$/);   // wired link speed, e.g. 100M
    if (label === 'WiFi') expect(value).toMatch(/dBm$/);     // signal strength
    if (label === 'AP')   expect(value).toBe('active');
    // cross-check: a wired device reports ssid "Ethernet" in /info.json
    const info = await (await request.get('/info.json')).json();
    if (info.ssid === 'Ethernet') expect(label).toBe('LAN');
  });

  test('/info.json has the expected top-level fields', async ({ request }) => {
    const d = await (await request.get('/info.json')).json();
    for (const k of ['ip', 'hostname', 'version', 'protocol', 'outputs', 'ledType', 'staticIp']) {
      expect(d, `info.json missing "${k}"`).toHaveProperty(k);
    }
    expect(d.protocol).toBeGreaterThanOrEqual(0);
    expect(d.protocol).toBeLessThanOrEqual(2);
  });

  test('/dmx.json returns 512 channel values + fps + manual flag', async ({ request }) => {
    const d = await (await request.get('/dmx.json')).json();
    expect(Array.isArray(d.ch)).toBeTruthy();
    expect(d.ch.length).toBe(512);
    for (const v of d.ch) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(255); }
    expect(typeof d.manual).toBe('boolean');
    expect(d).toHaveProperty('fps');
  });

  test('/senders.json and /log.json return arrays', async ({ request }) => {
    expect(Array.isArray(await (await request.get('/senders.json')).json())).toBeTruthy();
    expect(Array.isArray(await (await request.get('/log.json')).json())).toBeTruthy();
  });

  test('/version.json reports current + latest, and null latest when unknown', async ({ request }) => {
    const d = await (await request.get('/version.json')).json();
    expect(d).toHaveProperty('current');
    expect(typeof d.current).toBe('string');
    expect(d).toHaveProperty('latest');
    expect(typeof d.update).toBe('boolean');
    // latest is either a version string or null -- NEVER a copy of current as a stand-in for
    // "the check didn't run". That fallback made a failed check look like "up to date" and hid
    // real updates (a device reported latest=1.0.166 while 1.0.171 was published). The device
    // fetches it over plain HTTP now, so it should normally succeed; null is the honest answer
    // when it hasn't yet (e.g. no internet on the bench).
    expect(d.latest === null || typeof d.latest === 'string').toBeTruthy();
    if (d.latest !== null) expect(d.latest).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('/labels.json returns a JSON object', async ({ request }) => {
    const res = await request.get('/labels.json');
    expect(res.ok()).toBeTruthy();
    expect(typeof await res.json()).toBe('object');
  });

  test('/rdm.json exposes availability + a devices array', async ({ request }) => {
    const d = await (await request.get('/rdm.json')).json();
    expect(typeof d.available).toBe('boolean');
    expect(Array.isArray(d.devices)).toBeTruthy();
  });

  test('/logo.webp serves a small WebP image (replaces the old ~117 KB PNG)', async ({ request }) => {
    const res = await request.get('/logo.webp');
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toBe('image/webp');
    const body = await res.body();
    expect(body.slice(0, 4).toString('latin1')).toBe('RIFF');   // WebP container magic
    expect(body.slice(8, 12).toString('latin1')).toBe('WEBP');
    expect(body.length).toBeLessThan(20000);                    // was ~117 KB as a PNG
    // the old PNG endpoint is gone
    expect((await request.get('/logo.png')).status()).toBe(404);
  });

  test('/info.json advertises the W5500 SPI Ethernet config fields', async ({ request }) => {
    const d = await (await request.get('/info.json')).json();
    expect(typeof d.ethSpi).toBe('boolean');    // whether the W5500 driver is compiled in
    expect(typeof d.ethRmii).toBe('boolean');   // whether the internal-MAC RMII PHY is compiled in
    expect(typeof d.wiredPhy).toBe('number');   // 0 = W5500, 1 = LAN8720 RMII
    expect(typeof d.ethSpiPhy).toBe('number');  // SPI chip: 0 = W5500, 1 = DM9051 (issue #36)
    expect(typeof d.linkLossMode).toBe('number'); // WIRED_FB_* link-loss policy
    if (d.ethSpi) {
      for (const k of ['ethCs', 'ethSck', 'ethMosi', 'ethMiso', 'ethInt', 'ethRst', 'ethFreq']) {
        expect(d, `info.json missing "${k}"`).toHaveProperty(k);
        expect(typeof d[k]).toBe('number');
      }
    }
    if (d.ethRmii) {   // classic ESP32: RMII PHY family + wiring is configurable
      for (const k of ['rmiiPhy', 'rmiiAddr', 'rmiiMdc', 'rmiiMdio', 'rmiiPwr', 'rmiiClk']) {
        expect(d, `info.json missing "${k}"`).toHaveProperty(k);
        expect(typeof d[k]).toBe('number');
      }
    }
  });

  test('W5500 pins appear when W5500 is picked in the wired selector', async ({ page, request }) => {
    const d = await (await request.get('/info.json')).json();
    test.skip(!d.ethSpi, 'build has no W5500 SPI support');
    await page.goto('/config');
    await expect(page.locator('#w5500-card')).toBeVisible();
    await page.locator('#wired-sel').selectOption('w5500');             // browser-only, no save
    await expect(page.locator('input[name="ethcs"]')).toBeVisible();
    await expect(page.locator('input[name="ethsck"]')).toBeVisible();
    await expect(page.locator('#net-mode-row')).toBeVisible();          // "Use wired Ethernet" appears
    await expect(page.locator('.pin-grp input[name="ethcs"]')).toHaveCount(1);   // pin-picker button
  });

  test('W5500 role pins are not flagged "reserved" against their own role (Save stays enabled)', async ({ page, request }) => {
    const d = await (await request.get('/info.json')).json();
    test.skip(!d.ethSpi, 'build has no W5500 SPI support');
    await page.goto('/config');
    await page.locator('#wired-sel').selectOption('w5500');   // activate the W5500 bus + its reserved flags
    // Regression: GPIO9-14 carry a reserved:eth-spi flag, and the W5500 role fields
    // (CS/SCK/MOSI/MISO/INT/RST) sit on exactly those pins. They used to be flagged
    // "reserved for the W5500 Ethernet" against their OWN role, which blocked Save.
    await expect(page.locator('#pin-warnings')).not.toContainText('reserved for the W5500 Ethernet');
    await expect(page.locator('#save-btn')).toBeEnabled();
    // A fixed-pin board (LuxDMX v4) locks the hard-wired fields, with an Advanced unlock
    // toggle for a reworked board. Only assert it where the board is actually detected as fixed.
    if (await page.locator('#pin-unlock-row').isVisible()) {
      // target the real inputs by id — locking adds a hidden .fixed-mirror with the same name
      await expect(page.locator('#eth-cs')).toBeDisabled();    // internal (no-header) pin locked
      await expect(page.locator('#disp-sda')).toBeEnabled();   // J4 display pin stays editable
      await page.locator('#pin-unlock').check();
      await expect(page.locator('#eth-cs')).toBeEnabled();     // unlock re-enables it
      await page.locator('#pin-unlock').uncheck();             // restore
    }
  });

  test('luxdmx_v5 picker tags each header GPIO with its J4/J6 pin', async ({ page }) => {
    // The diagram follows the SELECTED board (currentBoardDesc), so this works on any build
    // that offers luxdmx_v5, regardless of what board the firmware detects. (The board-card
    // header panel + copper-pin locks are detection-gated and covered by v5-locks.mjs.)
    await page.goto('/config');
    test.skip(await page.locator('#board-sel option[value="luxdmx_v5"]').count() === 0,
      'luxdmx_v5 board not offered on this chip');
    await page.locator('#board-sel').selectOption('luxdmx_v5');
    await page.locator('#board-open').click();                        // open the picker diagram
    // GPIO4 is J4 pin 3 (SDA) on the v5 -> tagged on the pad + in its tooltip.
    await expect(page.locator('.pad[data-gpio="4"] title')).toContainText('J4 pin 3');
    await expect(page.locator('.pad[data-gpio="35"] title')).toContainText('J6 pin 4');
  });

  test('Wired selector: one list of None + the build PHYs, swaps the pin sections', async ({ page, request }) => {
    const d = await (await request.get('/info.json')).json();
    test.skip(!d.ethSpi && !d.ethRmii, 'build has no wired Ethernet');
    await page.goto('/config');
    const sel = page.locator('#wired-sel');
    await expect(sel).toBeVisible();
    await expect(sel.locator('option[value="none"]')).toHaveCount(1);   // None always present
    if (d.ethSpi) {
      await expect(sel.locator('option[value="w5500"]')).toHaveCount(1);
      await sel.selectOption('w5500');
      await expect(page.locator('#w5500-pins')).toBeVisible();
      await expect(page.locator('#rmii-pins')).toBeHidden();
      // DM9051 is the W5500 alternative: same SPI pin card, ethSpiPhy = 1 (issue #36)
      await expect(sel.locator('option[value="dm9051"]')).toHaveCount(1);
      await sel.selectOption('dm9051');
      await expect(page.locator('#w5500-pins')).toBeVisible();
      await expect(page.locator('#eth-spi-phy')).toHaveValue('1');
      await sel.selectOption('w5500');
      await expect(page.locator('#eth-spi-phy')).toHaveValue('0');
    }
    if (d.ethRmii) {
      await expect(sel.locator('option[value^="rmii"]')).toHaveCount(6);   // all six RMII PHYs
      await sel.selectOption('rmii0');
      await expect(page.locator('#rmii-pins')).toBeVisible();
      await expect(page.locator('#w5500-pins')).toBeHidden();
    }
    await sel.selectOption('none');                                     // None hides both + forces WiFi
    await expect(page.locator('#w5500-pins')).toBeHidden();
    await expect(page.locator('#rmii-pins')).toBeHidden();
    await expect(page.locator('#net-mode-row')).toBeHidden();
  });

  test('home-page Update button installs the latest release directly (no detour via /config)', async ({ page }) => {
    // Mock the version + release feed so the update banner appears regardless of
    // what the device actually runs. The install is never confirmed (Cancel only),
    // and POST /ota/github is blocked as a safety net so the device cannot reboot.
    await page.route('**/version.json', route =>
      route.fulfill({ contentType: 'application/json',
        body: JSON.stringify({ current: '1.0.1', latest: '1.0.999', update: true }) }));
    await page.route('https://luxdmx.org/firmware/releases', route =>
      route.fulfill({ contentType: 'application/json',
        body: JSON.stringify([{ tag_name: 'v1.0.999', published_at: '2026-01-01T00:00:00Z',
          body: '- shiny new thing\n- another fix' }]) }));
    let otaPosted = false;
    await page.route('**/ota/github', route => { otaPosted = true; route.abort(); });

    await page.goto('/');
    await expect(page.locator('#update-banner')).toBeVisible();
    await expect(page.locator('#update-ver')).toHaveText('1.0.999');

    // The Update control is a button that opens the confirm popup in place — not a
    // link that navigates away to the settings page.
    const go = page.locator('#update-go');
    await expect(go).toHaveJSProperty('tagName', 'BUTTON');
    await go.click();

    const modal = page.locator('#app-modal');
    await expect(modal).toBeVisible();
    await expect(page.locator('#app-modal-body')).toContainText('Install v1.0.999');
    await expect(page.locator('#app-modal-ok')).toHaveText(/Update & reboot/);
    // The hidden form posts a version-targeted OTA to the install endpoint.
    await expect(page.locator('#ota-form')).toHaveAttribute('action', '/ota/github');

    // Cancel must not install / reboot the device.
    await page.locator('#app-modal-cancel').click();
    await expect(modal).toBeHidden();
    expect(otaPosted).toBeFalsy();
  });

  test('firmware-update UI is labelled LuxDMX.org, not GitHub', async ({ page }) => {
    await page.goto('/config');
    await expect(page.getByText('Update from LuxDMX.org')).toBeVisible();
    expect(await page.content()).not.toContain('Update from GitHub');
  });
});
