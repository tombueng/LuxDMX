// More than two axes. Endless pan and tilt: a head turning round and round past any position its
// range has, both ways, then back to its position the short way. A third axis (roll): the head
// turning round its own beam to an angle, or on and on, its gobo turning with it. Driven through the
// programmer's range buttons and sliders, on the wire, read in 3D through window.__stage3d.
import type { Page } from '@playwright/test';
import { channels, full, openConnected, patch, resetFake, selectAll, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });
test.describe.configure({ timeout: 120_000 });

async function open3d(page: Page) {
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d?.venue), { timeout: 15000 }).toBe(true);
}
const ranges = (page: Page, name: string) => page.locator('.prog').getByRole('group', { name: `${name}: ranges`, exact: true });

test('endless pan: round and round past its range, the other way too, then to its position the short way', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-endless', 1, 0, 'Endless');
  await open3d(page);
  await selectAll(page); await full(page);
  const id = await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].id);
  const pan = () => page.evaluate((id) => (window as any).__stage3d.head(id)?.pan, id);
  await expect.poll(pan, { timeout: 15000 }).toBeCloseTo(0, 0);
  await ranges(page, 'Pan rotation (endless)').getByRole('button', { name: 'Rotation CW fast..slow' }).click();
  await expect.poll(async () => (await channels(0, 6))[4]).toBe(69);                 // the middle of the CW range on the wire
  await expect.poll(pan, { timeout: 20000 }).toBeGreaterThan(400);                    // past the 270 a position reaches
  await ranges(page, 'Pan rotation (endless)').getByRole('button', { name: 'Rotation CCW slow..fast' }).click();
  const at = await pan();
  await expect.poll(async () => at - (await pan()), { timeout: 20000 }).toBeGreaterThan(200);   // backwards now
  await ranges(page, 'Pan rotation (endless)').getByRole('button', { name: 'Off' }).click();
  // back at its position (the middle: 0°, give or take whole turns), and still there
  await expect.poll(async () => { const p = await pan(); return Math.abs((((p % 360) + 540) % 360) - 180); }, { timeout: 15000 }).toBeLessThan(1);
});

test('a third axis: the head turns round its own beam to an angle, or on and on backwards; its gobo turns with it', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-roll', 1, 0, 'Roll head');
  await open3d(page);
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d.gobos()), { timeout: 30000 }).toBe(true);
  await selectAll(page); await full(page);
  const id = await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].id);
  const head = () => page.evaluate((id) => (window as any).__stage3d.head(id), id);
  const gobo = () => page.evaluate((id) => (window as any).__stage3d.gobo(id), id);
  await page.locator('.prog').getByRole('region', { name: 'Gobo', exact: true }).getByRole('button', { name: 'Star' }).click();
  // an angle: roll at full is half a turn of its 360
  await page.locator('.prog input[type=range][aria-label="Roll (third axis)"]').fill('1');
  await expect.poll(async () => (await channels(0, 3))[2]).toBe(255);
  await expect.poll(async () => (await head())?.roll, { timeout: 15000 }).toBeCloseTo(180, 0);
  // the gobo turned with the head (its turn: the roll's angle, its own rotation still)
  await expect.poll(async () => (await gobo())?.turn[0], { timeout: 10000 }).toBeCloseTo(Math.PI, 1);
  // on and on, backwards
  await ranges(page, 'Roll rotation (endless)').getByRole('button', { name: 'Rotation CCW slow..fast' }).click();
  await expect.poll(async () => (await head())?.roll, { timeout: 20000 }).toBeLessThan(-200);
});

test('a moving bar: picked heads tilt on their own (on the wire and in 3D, each head its own motor), the bar pans as one', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-headbar4', 1, 0, 'Bar');
  await open3d(page);
  await selectAll(page); await full(page);
  const id = await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].id);
  const bar3d = () => page.evaluate((id) => (window as any).__stage3d.bar(id), id);
  const TILT = (k: number) => 2 + k * 6;
  await expect.poll(async () => (await bar3d())?.tilts.length, { timeout: 15000 }).toBe(4);
  // heads 2 and 3 picked, tilted to 80 %
  const picker = page.locator('.prog #pg-cells');
  await picker.getByLabel('Cells to pick').fill('2-3'); await picker.getByLabel('Cells to pick').press('Enter');
  await page.locator('.prog').getByRole('button', { name: /^Tilt: .*type a value$/ }).click();
  await page.locator('.prog').getByLabel('Tilt (percent)').fill('80');
  await page.locator('.prog').getByLabel('Tilt (percent)').press('Enter');
  await expect.poll(async () => { const c = await channels(0, 26); return [0, 1, 2, 3].map((k) => c[TILT(k)]); }).toEqual([128, 204, 204, 128]);
  // in 3D the two heads tilted (their own motors), the others not
  await expect.poll(async () => { const t = (await bar3d())!.tilts; return Math.round(t[1] - t[0]); }, { timeout: 15000 }).toBeGreaterThan(70);
  const t = (await bar3d())!.tilts;
  expect(Math.abs(t[0] - t[3])).toBeLessThan(1);
  expect(Math.abs(t[1] - t[2])).toBeLessThan(1);
  // the whole bar again (no heads picked): its pan turns the bar
  await picker.getByRole('button', { name: 'Whole light', exact: true }).click();
  await page.locator('.prog').getByRole('button', { name: /^Pan: .*type a value$/ }).click();
  await page.locator('.prog').getByLabel('Pan (percent)').fill('75');
  await page.locator('.prog').getByLabel('Pan (percent)').press('Enter');
  await expect.poll(async () => (await channels(0, 1))[0]).toBe(191);
  await expect.poll(async () => (await bar3d())!.pan, { timeout: 15000 }).toBeCloseTo(135, 0);   // (a quarter of its 540 off the middle)
});
