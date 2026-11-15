// A pixel port's data pin, checked against what's ON (issue #165). The firmware refuses a pin
// another part of the box uses, but it counted the pins of features that are off as well: the
// WT32-ETH01 keeps the W5500's default pins although it runs its LAN8720 over RMII, so a port on
// GPIO5 (the W5500 CS there) was turned off on every save while the page, which only counts
// what's on, said "Saved". Now both use the same rule (src/pixel_pins.h, activeRoles() in
// config.html), and a port the box still turns off is said in the save's answer and on the page.
//
// Read-only: the page's side. The save is answered in the browser (it never reaches the box)
// with a port turned off: the page says which and why, and unticks it.
// Opt-in (LUXDMX_WRITE=1), config put back after each:
// - the display switched off (its pins kept, as /config keeps them): a pixel port on its SDA pin
//   stays on (the WT32 case, on a box with a display instead of an unused W5500);
// - a pixel port on a pin that IS in use (the W5500's CS, while it's the wired PHY): turned off,
//   and the save's answer says so.
// The WT32-ETH01 case itself needs that board: the native test (test/native/pixel_pins_test.cpp)
// runs its pin set.
import { test, expect } from '@playwright/test';
import { configSnapshot, configForm, info, waitReady } from './lib/device.mjs';
import { openConfig } from './lib/ui.mjs';
import { sleep } from './lib/net.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';

async function pixelsJson(request) {
  for (let i = 0; i < 30; i++) {
    try { const r = await request.get('/pixels.json'); if (r.ok()) return await r.json(); } catch {}
    await sleep(500);
  }
  throw new Error('no /pixels.json');
}
// The save, its answer read (a restart after it is waited out)
async function save(request, form) {
  const r = await request.post('/config', { form, timeout: 15_000 });
  expect(r.ok(), `POST /config -> ${r.status()}`).toBeTruthy();
  const j = await r.json();
  if (j.reboot) { await sleep(3000); await waitReady(request, 60_000); }
  return j;
}

test('the page says which pixel port the box turned off, and why, and unticks it', async ({ page, request }) => {
  const ports = (await pixelsJson(request)).ports;
  const on = ports.findIndex((p) => p.en);
  test.skip(on < 0, 'no pixel port is on to be turned off');
  // (answered here: nothing reaches the box)
  await page.route('**/config', (r) => (r.request().method() === 'POST'
    ? r.fulfill({ json: { saved: true, reboot: false, fields: '', pixOff: [{ port: on, why: `GPIO${ports[on].pin} is the W5500 CS` }] } })
    : r.continue()));
  await openConfig(page);
  const box = page.locator('.pix-card').nth(on).locator('.pix-en');
  await expect(box).toBeChecked();
  await page.locator('#save-btn').click();
  const modal = page.locator('#app-modal');
  await expect(modal).toContainText('Saved, but a pixel port is off');
  await expect(modal).toContainText(`Pixel port ${on + 1}: GPIO${ports[on].pin} is the W5500 CS`);
  await expect(modal).toContainText('Pick another pin');
  await expect(box).not.toBeChecked();
});

test.describe('on the box', () => {
  test.skip(!WRITE, 'device-mutating: set LUXDMX_WRITE=1 to run');
  let original;
  test.beforeEach(async ({ request }) => { original = await configSnapshot(request); });
  test.afterEach(async ({ request }) => {
    await save(request, { ...configForm(original), disptype: String(original.dispType) });
    const back = await configSnapshot(request);
    expect(back.dispType).toBe(original.dispType);
    expect(back.pixels.map((p) => [p.en, p.pin, p.count])).toEqual(original.pixels.map((p) => [p.en, p.pin, p.count]));
  });

  test('the display off: a pixel port on its SDA pin stays on', async ({ request }) => {
    test.setTimeout(150_000);
    test.skip(!(original.dispType >= 1 && original.dispType <= 3) || !(original.dispSda >= 0), 'no I2C display set up');
    const i = original.pixels.findIndex((p) => !p.en);
    test.skip(i < 0, 'no free pixel port');
    const pin = original.dispSda;
    const want = { ...original, pixels: original.pixels.map((p, k) => (k === i ? { ...p, en: true, pin, count: 8 } : p)) };
    const j = await save(request, { ...configForm(want), disptype: '0' });
    expect(j.pixOff ?? []).toEqual([]);
    const port = (await pixelsJson(request)).ports[i];
    expect([port.en, port.pin], `pixel port ${i + 1} on GPIO${pin} with the display off`).toEqual([true, pin]);
    expect((await info(request)).dispSda).toBe(pin);           // (the display's pins are kept)
  });

  test('a pixel port on a pin that is in use (the W5500 CS): off, and the answer says why', async ({ request }) => {
    test.setTimeout(150_000);
    test.skip(!(original.wiredPhy === 0 && original.ethW5500 && original.ethCs >= 0), 'the W5500 is not the wired PHY here');
    const i = original.pixels.findIndex((p) => !p.en);
    test.skip(i < 0, 'no free pixel port');
    const pin = original.ethCs;
    const want = { ...original, pixels: original.pixels.map((p, k) => (k === i ? { ...p, en: true, pin, count: 8 } : p)) };
    const j = await save(request, { ...configForm(want), disptype: String(original.dispType) });
    expect(j.pixOff).toEqual([{ port: i, why: `GPIO${pin} is the W5500 CS` }]);
    expect((await pixelsJson(request)).ports[i].en).toBe(false);
  });
});
