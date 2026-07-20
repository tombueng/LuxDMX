// Web UI loads + REST API contract (no network input required).
import { test, expect } from '@playwright/test';
import { openConfig } from './lib/ui.mjs';

test.describe('Web UI + REST', () => {
  test('status page loads with the channel grid and key cards', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/LuxDMX/i);
    await expect(page.locator('#grid .ch')).toHaveCount(512);
    await expect(page.locator('#senders-body')).toBeVisible();
    await expect(page.locator('#log-body')).toBeVisible();
    // Subtitle is filled from /info.json: hostname.local · ip · version. It used to carry
    // the viewed output's "Universe N" too, but the navbar became a shared fragment in #72
    // and _nav.html has no notion of which output tab you're on, so that segment went away
    // on purpose. Assert what it actually shows rather than the pre-#72 shape.
    await expect(page.locator('#nav-sub')).toContainText('.local');
    await expect(page.locator('#nav-sub')).toContainText('v');
  });

  test('settings page loads with protocol + outputs + network cards', async ({ page }) => {
    await openConfig(page);
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
    await openConfig(page);
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
    await openConfig(page);
    await page.locator('#wired-sel').selectOption('w5500');   // activate the W5500 bus + its reserved flags
    // Regression: GPIO9-14 carry a reserved:eth-spi flag, and the W5500 role fields
    // (CS/SCK/MOSI/MISO/INT/RST) sit on exactly those pins. They used to be flagged
    // "reserved for the W5500 Ethernet" against their OWN role, which blocked Save.
    await expect(page.locator('#pin-warnings')).not.toContainText('reserved for the W5500 Ethernet');
    await expect(page.locator('#save-btn')).toBeEnabled();
    // A fixed-pin board (the LuxDMX board) locks the hard-wired fields, with an Advanced unlock
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

  test('selecting luxdmx_v6 locks the copper pins and tags the header pads', async ({ page }) => {
    await openConfig(page);
    test.skip(await page.locator('#board-sel option[value="luxdmx_v6"]').count() === 0,
      'luxdmx_v6 board not offered on this chip');
    await page.locator('#wired-sel').selectOption('w5500').catch(() => {});   // reveal the W5500 fields
    await page.locator('#board-sel').selectOption('luxdmx_v6');
    // Picking the board applies its copper-pin locks even when the firmware detects a generic
    // esp32s3dev / esp32s3-devkitc-1, so you can't accidentally move the W5500 or DMX pins.
    // The J4 display pins stay editable; the Advanced unlock is the escape hatch.
    await expect(page.locator('#eth-cs')).toBeDisabled();          // W5500 CS locked
    await expect(page.locator('#eth-cs')).toHaveValue('10');       // to the v6 value
    await expect(page.locator('#disp-sda')).toBeEnabled();         // J4 display pin editable
    await expect(page.locator('#pin-unlock-row')).toBeVisible();
    await page.locator('#pin-unlock').check();
    await expect(page.locator('#eth-cs')).toBeEnabled();           // unlock re-enables it
    await page.locator('#pin-unlock').uncheck();
    // each GPIO field is tagged with the header pin it comes out of
    await expect(page.locator('.pin-grp:has(#disp-sda) .hdr-hint')).toHaveText('J4.3');
    // the diagram tags each header GPIO with its physical header pin...
    await page.locator('#board-open').click();
    const board = page.locator('#board-svg-wrap > svg.board-svg');
    await expect(board.locator('.pad[data-gpio="4"] title')).toContainText('J4 pin 3');
    await expect(board.locator('.pad[data-gpio="35"] title')).toContainText('J6 pin 4');
    // ...and both wirable connectors are drawn as their own strips, with the rails inert
    // and the signal pins clickable (see docs/tests/v6-headers.mjs for the full behaviour)
    await expect(page.locator('.hdr-strips svg.hdr-strip')).toHaveCount(2);
    await expect(page.locator('.hdr-strips g.pad[data-gpio="36"]')).toHaveCount(1);
    expect(await page.locator('.hdr-strips g.ppin.power[data-gpio]').count()).toBe(0);
  });

  test('luxdmx_v6 shows J4 and J6 with matching power pins and no 5V on J6', async ({ page }) => {
    await openConfig(page);
    test.skip(await page.locator('#board-sel option[value="luxdmx_v6"]').count() === 0,
      'luxdmx_v6 board not offered on this chip');

    // J4 and J6 are the same JST SH 9-pin part sitting next to each other, so a cable fits
    // either. They therefore share one power layout (1=+3V3, 2=GND) and a mis-plug is a
    // non-event. The picker is where a user reads the pinout off before crimping, so this
    // asserts the page actually shows that -- a wrong pinout here is a destroyed panel.
    const j6row = (n) => page.locator('.hdr-tbl', { hasText: 'J6' }).locator('tr').nth(n - 1);
    const j4row = (n) => page.locator('.hdr-tbl', { hasText: 'J4' }).locator('tr').nth(n - 1);

    await page.locator('#board-sel').selectOption('luxdmx_v6');
    // pins 1 and 2 are identical on both headers: that IS the safety property
    await expect(j4row(1)).toContainText('3V3');
    await expect(j6row(1)).toContainText('3V3');
    await expect(j4row(2)).toContainText('GND');
    await expect(j6row(2)).toContainText('GND');
    // and 5V is gone from J6 entirely, not merely moved
    await expect(page.locator('.hdr-tbl', { hasText: 'J6' })).not.toContainText('5V');
    // signals slid up one: IO35 is pin 3 now, and pin 9 became a second return
    await expect(j6row(3)).toContainText('IO35');
    await expect(j6row(9)).toContainText('GND');
    await page.locator('#board-open').click();
    await expect(page.locator('.pad[data-gpio="35"] title')).toContainText('J6 pin 3');
    await expect(page.locator('.pad[data-gpio="4"] title')).toContainText('J4 pin 3');   // J4 unmoved

    // UART0 is on 7/8 and is the only thing on J6 that costs you something (the serial console)
    await expect(j6row(7)).toContainText('TX0');
    await expect(j6row(8)).toContainText('RX0');
  });

  test('the Join-WiFi link-loss fallback reveals the WiFi credentials on a wired box', async ({ page, request }) => {
    const d = await (await request.get('/info.json')).json();
    test.skip(!d.ethSpi && !d.ethRmii, 'build has no wired Ethernet');
    await openConfig(page);
    await page.locator('#wired-sel').selectOption('w5500');    // a wired PHY -> the mode + fallback rows appear
    await page.locator('#useeth-sw').check();                  // wired mode
    await expect(page.locator('#sta-creds-row')).toBeHidden(); // no WiFi creds while purely wired
    await page.locator('#fb-mode').selectOption('3');          // fall back to the saved WiFi network
    await expect(page.locator('#sta-creds-row')).toBeVisible();// now the SSID/password must be enterable
    await expect(page.locator('input[name="wifissid"]')).toBeVisible();
    await page.locator('#fb-mode').selectOption('1');          // AP fallback wants the AP password instead
    await expect(page.locator('#ap-pw-row')).toBeVisible();
    await expect(page.locator('#sta-creds-row')).toBeHidden();
    await page.locator('#useeth-sw').uncheck();                // restore (browser-only, nothing saved)
  });

  test('Wired selector: one list of None + the build PHYs, swaps the pin sections', async ({ page, request }) => {
    const d = await (await request.get('/info.json')).json();
    test.skip(!d.ethSpi && !d.ethRmii, 'build has no wired Ethernet');
    await openConfig(page);
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

  test('settings sections fold away, summarise themselves and remember it', async ({ page }) => {
    // NB: no openConfig() here -- this test is about the folded default itself.
    await page.goto('/config');
    const net = page.locator('[data-sec="network"]');

    // The page opens as an overview: every section folded, nothing expanded for you.
    await expect(page.locator('.card[data-sec]')).not.toHaveCount(0);
    await expect(page.locator('.card[data-sec]:not(.sec-closed)')).toHaveCount(0);
    await expect(page.locator('#sec-all')).toHaveText('Expand all');
    // A folded header says what is inside it instead of just its title
    await expect(net.locator('.sec-sum')).not.toHaveText('');
    // Folded only hides: the fields still go out with the form (they are not disabled)
    expect(await page.evaluate(() =>
      [...new FormData(document.getElementById('cfg-form')).keys()].includes('wifissid'))).toBeTruthy();

    // Clicking the header unfolds that one section...
    await net.locator('.sec-title').click();
    await expect(net.locator('.card-body')).toBeVisible();
    await expect(net.locator('.sec-sum')).toHaveText('');           // summary yields to the real fields
    // ...and that choice is what you get next time
    await page.reload();
    await expect(net.locator('.card-body')).toBeVisible();
    await expect(page.locator('[data-sec="protocol"] .card-body')).toBeHidden();   // the rest stayed folded
    await net.locator('.sec-title').click();                        // fold it again
    await expect(net.locator('.card-body')).toBeHidden();

    // A control that lives in a card header (the per-output Enabled switch) must keep
    // working without folding or unfolding the card under it.
    const out = page.locator('[data-sec="out0"]');
    const en = page.locator('#o0_en');
    const before = await en.isChecked();
    const foldedBefore = await out.getAttribute('class');
    await en.click();
    expect(await out.getAttribute('class')).toBe(foldedBefore);
    await en.click();                                               // restore (browser-only, nothing saved)
    expect(await en.isChecked()).toBe(before);

    // Fold/unfold everything at once
    await page.locator('#sec-all').click();
    await expect(page.locator('.card[data-sec].sec-closed')).toHaveCount(0);
    await expect(page.locator('#sec-all')).toHaveText('Collapse all');
    await page.locator('#sec-all').click();
    await expect(page.locator('.card[data-sec]:not(.sec-closed)')).toHaveCount(0);

    // Expand all has to reach sections that only get built later: the DMX output cards
    // are cloned once /info.json lands. They used to come up folded anyway, which made
    // "Expand all" a lie on a slow load. Delay /info.json and click before it arrives.
    await page.route('**/info.json', async (r) => { await new Promise((s) => setTimeout(s, 800)); await r.continue(); });
    await page.goto('/config');
    await page.locator('#sec-all').click();                     // outputs do not exist yet
    await expect(page.locator('.out-card')).toHaveCount(2);     // ...they show up now
    await expect(page.locator('.out-card.sec-closed')).toHaveCount(0);
    await page.unroute('**/info.json');
  });

  test('firmware-update UI is labelled LuxDMX.org, not GitHub', async ({ page }) => {
    await openConfig(page);
    await expect(page.getByText('Update from LuxDMX.org')).toBeVisible();
    expect(await page.content()).not.toContain('Update from GitHub');
  });
});
