// Several saved WiFi networks, tried in order (issue #120). Slot 1 is the network the setup portal
// stores (wifissid / wifipsk); wifissid2..4 / wifipsk2..4 are the rest. The device joins the
// highest one on the list that's on the air and moves down the list when it doesn't work or
// goes away. The page never sees a stored password, so reordering moves SSID + password pairs on
// the device (the form sends wifiorder) and a blank password field keeps what's stored.
//
// Read-only: /info.json shape (SSIDs, which slots have a password, the slot in use, never a
// password), and the four-row list on /config including the up/down buttons, without saving.
//
// Opt-in (LUXDMX_WRITE=1): save two extra networks through the real form, reorder them with the
// buttons and check each password stayed with its network, remove one and check the list closed
// up, then put the original list back. None of that may restart the device: networks 2..4 are
// only read at the next join. Skipped on a device that already has extra networks saved,
// because their passwords can't be read back to restore them afterwards.
//
// The failover itself (LUXDMX_WRITE=1 LUXDMX_WIFI_FAILOVER=1, device on WiFi): put a network
// that doesn't exist first and the real one second. A new first network restarts the device,
// and it must come back on the real one, reporting slot 2. Then a network slipped in above it
// (no restart) must move wifiSlot along with it. If the failover went wrong the box would sit in
// its setup AP, which is why it has its own switch. It skips on a wired device, there's no WiFi
// to fail over.
//
// Art-Net / sACN: not exercised here, nothing in this feature touches the DMX path.
import { test, expect } from '@playwright/test';
import { sleep } from './lib/net.mjs';
import { info } from './lib/device.mjs';
import { openConfig } from './lib/ui.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';
const FAILOVER = process.env.LUXDMX_WIFI_FAILOVER === '1';
const SFX = ['', '2', '3', '4'];

// Fill rows on /config and save. rows: { k: { ssid, psk } } for the rows to touch; a missing
// psk leaves that password field blank (= keep). The network card only shows the list in WiFi
// client mode or with the join-WiFi fallback, so on a wired box the inputs are set directly.
async function setRows(page, rows) {
  for (const [k, v] of Object.entries(rows)) {
    const ssid = page.locator(`#wifi-ssid${SFX[k]}`), psk = page.locator(`#wifi-psk${SFX[k]}`);
    if ('ssid' in v) await ssid.evaluate((el, x) => { el.value = x; }, v.ssid);
    if ('psk' in v) await psk.evaluate((el, x) => { el.value = x; }, v.psk);
  }
}
// Click Save; returns the device's answer ({ saved, reboot, fields }).
async function save(page) {
  const [resp] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === '/config' && r.request().method() === 'POST'),
    page.click('#save-btn'),
  ]);
  const j = await resp.json();
  await page.waitForTimeout(1000);
  return j;
}
// It answers first and restarts ~600 ms later: wait for it to go away, then to come back.
async function waitRestart(request) {
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) {
    try { await request.get('/info.json', { timeout: 1000 }); await sleep(250); } catch { gone = true; }
  }
  expect(gone, 'device never went away, so it never restarted').toBeTruthy();
  let back = null;
  for (let i = 0; i < 120 && !back; i++) { try { back = await info(request); } catch { await sleep(1000); } }
  expect(back, 'device did not come back within two minutes').toBeTruthy();
  return back;
}
// Move the row holding `ssid` to the top with the ▲ buttons (page only).
async function moveToTop(page, ssid) {
  const vals = await page.locator('.wifi-net input[id^="wifi-ssid"]').evaluateAll((els) => els.map((e) => e.value));
  for (let k = vals.indexOf(ssid); k > 0; k--)
    await page.locator('.wifi-net').nth(k).locator('.wifi-up').evaluate((b) => b.click());
}
async function freshConfig(page, request) {
  const want = await info(request);
  await openConfig(page);
  await expect.poll(() => page.locator('#dev-host').inputValue(), { timeout: 15_000 }).toBe(want.hostname);
  return want;
}
const slots = (d) => [d.wifiSsid, d.wifiSsid2, d.wifiSsid3, d.wifiSsid4];

test.describe('Saved WiFi networks (issue #120)', () => {
  test('/info.json lists the networks, never their passwords', async ({ request }) => {
    const d = await info(request);
    for (const k of ['wifiSsid', 'wifiSsid2', 'wifiSsid3', 'wifiSsid4']) expect(typeof d[k], k).toBe('string');
    expect(Array.isArray(d.wifiPskSet) && d.wifiPskSet.length === 4, 'wifiPskSet: 4 booleans').toBe(true);
    d.wifiPskSet.forEach((b) => expect(typeof b).toBe('boolean'));
    expect(Number.isInteger(d.wifiSlot)).toBe(true);
    expect(d.wifiSlot).toBeGreaterThanOrEqual(-1);
    expect(d.wifiSlot).toBeLessThanOrEqual(3);
    if (d.useEthernet && !d.ethFallback) expect(d.wifiSlot, 'wired: not on any WiFi slot').toBe(-1);
    for (const k of ['wifiPsk', 'wifiPsk2', 'wifiPsk3', 'wifiPsk4']) expect(k in d, `${k} is never sent`).toBe(false);
    // no gaps: a set slot never follows an empty one
    const s = slots(d);
    for (let k = 1; k < 4; k++) if (s[k]) expect(s[k - 1], `slot ${k + 1} set but slot ${k} empty`).not.toBe('');
  });

  test('/config shows four rows in order, and the arrows move a row', async ({ page, request }) => {
    const d = await freshConfig(page, request);
    await expect(page.locator('.wifi-net')).toHaveCount(4);
    await expect(page.locator('#wifi-ssid')).toHaveAttribute('name', 'wifissid');   // slot 1 is still the portal's field
    await expect(page.locator('#wifi-psk')).toHaveAttribute('name', 'wifipsk');
    for (let k = 1; k < 4; k++) {
      await expect(page.locator(`#wifi-ssid${SFX[k]}`)).toHaveAttribute('name', `wifissid${SFX[k]}`);
      await expect(page.locator(`#wifi-ssid${SFX[k]}`)).toHaveValue(slots(d)[k]);
    }
    await expect(page.locator('.wifi-net').first().locator('.wifi-up')).toBeDisabled();
    await expect(page.locator('.wifi-net').last().locator('.wifi-down')).toBeDisabled();
    await expect(page.locator('#wifi-order')).toHaveValue('0,1,2,3');
    // Move row 3 up (page only, not saved): values swap, the order records it, and back again.
    await setRows(page, { 1: { ssid: 'row-b', psk: 'typed-b' }, 2: { ssid: 'row-c' } });
    await page.locator('.wifi-net').nth(2).locator('.wifi-up').evaluate((b) => b.click());
    await expect(page.locator('#wifi-ssid2')).toHaveValue('row-c');
    await expect(page.locator('#wifi-ssid3')).toHaveValue('row-b');
    await expect(page.locator('#wifi-psk3')).toHaveValue('typed-b');   // typed password moves with its row
    await expect(page.locator('#wifi-order')).toHaveValue('0,2,1,3');
    await page.locator('.wifi-net').nth(1).locator('.wifi-down').evaluate((b) => b.click());
    await expect(page.locator('#wifi-order')).toHaveValue('0,1,2,3');
    // leave without saving
  });

  test('saving, reordering and removing networks keeps each password with its network', async ({ page, request }) => {
    test.skip(!WRITE, 'device-mutating: set LUXDMX_WRITE=1 to run');
    test.setTimeout(120_000);
    const orig = await info(request);
    test.skip(!!(orig.wifiSsid2 || orig.wifiSsid3 || orig.wifiSsid4),
      'this device already has extra networks saved; their passwords could not be restored afterwards');
    try {
      // two extra networks, one with a password and one open
      await freshConfig(page, request);
      await setRows(page, { 1: { ssid: 'lux-test-a', psk: 'secret-a' }, 2: { ssid: 'lux-test-b', psk: '' } });
      expect((await save(page)).reboot, 'adding networks 2 and 3 needs no restart').toBe(false);
      let d = await info(request);
      expect(d.wifiSlot, 'still on the same network').toBe(orig.wifiSlot);
      expect(slots(d).slice(1)).toEqual(['lux-test-a', 'lux-test-b', '']);
      expect(d.wifiPskSet.slice(1, 3), 'a has a password, b is open').toEqual([true, false]);
      expect(d.wifiSsid, 'slot 1 untouched').toBe(orig.wifiSsid);
      expect(d.wifiPskSet[0]).toBe(orig.wifiPskSet[0]);

      // move b above a, password fields left blank: a's password must follow a
      await freshConfig(page, request);
      await page.locator('.wifi-net').nth(2).locator('.wifi-up').evaluate((b) => b.click());
      expect((await save(page)).reboot, 'reordering 2 and 3 needs no restart').toBe(false);
      d = await info(request);
      expect(slots(d).slice(1)).toEqual(['lux-test-b', 'lux-test-a', '']);
      expect(d.wifiPskSet.slice(1, 3), "a's password moved with it").toEqual([false, true]);

      // remove b (now slot 2): the list closes up, a is slot 2 again with its password
      await freshConfig(page, request);
      await setRows(page, { 1: { ssid: '' } });
      expect((await save(page)).reboot, 'removing one needs no restart').toBe(false);
      d = await info(request);
      expect(slots(d).slice(1)).toEqual(['lux-test-a', '', '']);
      expect(d.wifiPskSet.slice(1)).toEqual([true, false, false]);
    } finally {
      await freshConfig(page, request);
      await setRows(page, { 1: { ssid: '' }, 2: { ssid: '' }, 3: { ssid: '' } });
      await save(page);
    }
    const back = await info(request);
    expect(slots(back)).toEqual(slots(orig));
    expect(back.wifiPskSet).toEqual(orig.wifiPskSet);
  });

  test('failover: a missing first network hands over to the second', async ({ page, request }) => {
    test.skip(!WRITE || !FAILOVER, 'set LUXDMX_WRITE=1 LUXDMX_WIFI_FAILOVER=1 to run (the box sits in its setup AP if this fails)');
    test.setTimeout(240_000);
    const orig = await info(request);
    test.skip(orig.useEthernet && !orig.ethFallback, 'device is wired, there is no WiFi to fail over');
    test.skip(!!orig.wifiSsid2, 'slot 2 is in use; this test needs it free');
    const bogus = 'lux-nonexistent-' + Date.now().toString(36);
    try {
      // real network into slot 2 with its stored password: type the bogus one into row 1, which
      // moves the real one (and its password, via the reorder) down first
      await freshConfig(page, request);
      await page.locator('.wifi-net').nth(0).locator('.wifi-down').evaluate((b) => b.click());
      await setRows(page, { 0: { ssid: bogus, psk: 'nope-nope' } });
      expect((await save(page)).reboot, 'a new first network restarts to join in the new order').toBe(true);
      const back = await waitRestart(request);
      expect([back.wifiSsid, back.wifiSsid2]).toEqual([bogus, orig.wifiSsid]);
      expect(back.wifiSlot, 'on saved network #2').toBe(1);
      expect(back.ssid).toBe(orig.wifiSsid);

      // slip a new network in above the one it's on: no restart, and wifiSlot follows
      await freshConfig(page, request);
      await setRows(page, { 2: { ssid: 'lux-test-c' } });
      await page.locator('.wifi-net').nth(2).locator('.wifi-up').evaluate((b) => b.click());
      expect((await save(page)).reboot, 'shuffling networks 2..4 needs no restart').toBe(false);
      const d = await info(request);
      expect([d.wifiSsid, d.wifiSsid2, d.wifiSsid3]).toEqual([bogus, 'lux-test-c', orig.wifiSsid]);
      expect(d.wifiSlot, 'wifiSlot moved with its network').toBe(2);
      expect(d.ssid).toBe(orig.wifiSsid);
    } finally {
      // real one back to the top, the rest removed; slot 1 changes, so it restarts
      await freshConfig(page, request);
      await moveToTop(page, orig.wifiSsid);
      await setRows(page, { 1: { ssid: '' }, 2: { ssid: '' }, 3: { ssid: '' } });
      if ((await save(page)).reboot) await waitRestart(request);
    }
    const fin = await info(request);
    expect(slots(fin)).toEqual([orig.wifiSsid, '', '', '']);
    expect(fin.wifiPskSet).toEqual(orig.wifiPskSet);
    expect(fin.wifiSlot).toBe(0);
  });
});
