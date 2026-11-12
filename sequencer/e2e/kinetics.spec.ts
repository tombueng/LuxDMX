// Kinetics: a winch with an LED ball. Its height goes out only while the machines are armed (its
// motion enable follows the arming); made safe it stays where it is, never 0 (its top). Soft limits
// set in its Mounting keep whatever the programmer says within them. In 3D the ball goes down at the
// winch's real speed once armed, and stays where the wire holds it while safe
// (window.__stage3d.winch: how far down, in metres).
import type { Page } from '@playwright/test';
import { channels, full, openConnected, patch, resetFake, selectAll, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });
test.describe.configure({ timeout: 120_000 });

async function open3d(page: Page) {
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d?.venue), { timeout: 15000 }).toBe(true);
}
async function holdArm(page: Page) {
  const arm = page.locator('.top .arm');
  const box = (await arm.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // (longer than its 1.2 s: the 3D view keeps a busy page, timers run late)
  await page.mouse.down(); await page.waitForTimeout(2500); await page.mouse.up();
  await expect(arm).toHaveAttribute('aria-pressed', 'true');
}
const height = (page: Page, v: string) => page.locator('.prog input[type=range][aria-label="Winch height (moves only armed)"]').fill(v);

test('a winch: moves only armed, safe it holds where it is (not 0), soft limits, the ball at its real speed in 3D', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-winch', 1, 0, 'Winch');
  await open3d(page);
  await selectAll(page); await full(page);                     // (the ball lit: frames go out)
  await expect.poll(async () => (await channels(0, 5))[4]).toBe(255);
  const id = await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].id);
  const drop = () => page.evaluate((id) => (window as any).__stage3d.winch(id), id);
  await expect.poll(drop, { timeout: 15000 }).toBeCloseTo(0, 1);
  // half way down: not armed, nothing moves on the wire (height at its top default, enable safe),
  // and the 3D shows it where it really hangs (live and safe: where the wire holds it)
  await height(page, '0.5');
  await page.waitForTimeout(1500);
  let c = await channels(0, 4);
  expect([c[0], c[3]]).toEqual([0, 0]);
  expect(await drop()).toBeLessThan(0.05);
  // armed: it goes, its enable on; the ball goes down 2 m of its 4 at 0.5 m/s, a few seconds
  const t0 = Date.now();
  await holdArm(page);
  await expect.poll(async () => { const x = await channels(0, 4); return [x[0], x[3]]; }).toEqual([128, 178]);
  const mid = await drop();
  expect(mid).toBeGreaterThan(0.05);
  expect(mid).toBeLessThan(1.9);
  await expect.poll(drop, { timeout: 20000 }).toBeCloseTo(2, 1);
  expect(Date.now() - t0).toBeGreaterThan(3500);
  // safe again: enable shut, the height held where it was, also when the programmer says otherwise,
  // and the 3D keeps it there
  await page.locator('.top .arm').click();
  await expect.poll(async () => (await channels(0, 4))[3]).toBe(0);
  await height(page, '0.9');
  await page.waitForTimeout(1200);
  c = await channels(0, 4);
  expect([c[0], c[3]]).toEqual([128, 0]);
  expect(await drop()).toBeCloseTo(2, 1);
  // its lowest at 40 % (Mounting): armed again, the 90 % becomes 40 %; the ball stops there in 3D
  await page.locator('.fl li[data-fixture="Winch"]').dblclick();
  const dlg = page.getByRole('dialog', { name: 'Patch: Winch' });
  await dlg.getByRole('tab', { name: 'Mounting' }).click();
  await dlg.getByLabel('Winch limit, lowest').fill('40');
  await dlg.getByLabel('Winch limit, lowest').press('Tab');
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].hoistLimits)).toEqual([0, 0.4]);
  await page.keyboard.press('Escape');
  await holdArm(page);
  await expect.poll(async () => (await channels(0, 4))[0]).toBe(102);
  await expect.poll(drop, { timeout: 20000 }).toBeCloseTo(1.6, 1);
  await page.locator('.top .arm').click();
});
