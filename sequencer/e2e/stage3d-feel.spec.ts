// How the 3D stage feels: moving heads turn at a real head's speed (not a jump per frame), the
// world is handed on between Program, Timeline and Live (not built again) and let go in 2D, a
// light clicked in 3D shows selected in the list (scrolled to), the Haze slider acts at once, the
// drawing quality starts at High, a pixel bar lit by an effect reads its real level, and a Release
// says which effects go on running.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, patch, fresh, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

const S = (page: Page) => page.evaluate(() => (window as any).__stage3d?.stats());
async function open3d(page: Page) {
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 30000 });
  await expect.poll(() => S(page).then((s) => s?.fixtures ?? -1), { timeout: 30000 }).toBeGreaterThan(-1);
}
const room = (page: Page) => page.evaluate(() => (window as any).__stage3d?.venue().group);

test('a moving head turns at a real head\'s speed: on its way after a moment, there after two seconds', async ({ page }) => {
  test.setTimeout(90_000);
  await openConnected(page);
  await patch(page, 'gen-mover8', 1, 0, 'Head');
  await open3d(page);
  const id = await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].id);
  const head = () => page.evaluate((id) => (window as any).__stage3d.head(id), id);
  const aim = (pan: number) => page.evaluate(([id, pan]) => { (window as any).__luxdmx.programmer[id as string] = { pan, tilt: 0.5, intensity: 1 }; }, [id, pan] as const);
  await aim(0);
  await expect.poll(async () => (await head())?.pan, { timeout: 15000 }).toBeCloseTo(-270, 0);
  await aim(1);                                     // the whole way round: 540°
  await page.waitForTimeout(500);
  const mid = (await head())!.pan;
  expect(mid).toBeGreaterThan(-265); expect(mid).toBeLessThan(200);   // on its way, not there
  await expect.poll(async () => (await head())?.pan, { timeout: 15000 }).toBeCloseTo(270, 0);
});

test('switching Program, Timeline and Live hands the 3D world on; 2D lets it go', async ({ page }) => {
  test.setTimeout(120_000);
  await openConnected(page);
  await patch(page, 'gen-drgb', 2, 0, 'PAR');
  await open3d(page);
  const first = await room(page);
  expect(first).toBeTruthy();
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 30000 });
  await expect.poll(() => room(page), { timeout: 30000 }).toBe(first);
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 30000 });
  await expect.poll(() => room(page), { timeout: 30000 }).toBe(first);
  // 2D and back: the old one went back to the graphics chip, this is a new one
  await page.locator('.stage-wrap').getByRole('button', { name: '2D' }).click();
  await expect(page.locator('.s3')).toHaveCount(0);
  await open3d(page);
  await expect.poll(() => room(page), { timeout: 30000 }).not.toBe(first);
});

test('a light clicked in 3D is selected in the list too, scrolled into view', async ({ page }) => {
  test.setTimeout(90_000);
  await openConnected(page);
  await patch(page, 'gen-dimmer', 96, 0, 'D');
  await open3d(page);
  await expect.poll(() => S(page).then((s) => s?.fixtures), { timeout: 30000 }).toBe(96);
  const ids: string[] = await page.evaluate(() => (window as any).__luxdmx.show.fixtures.map((f: any) => f.id));
  const item = (id: string) => page.locator(`.fl li.oitem[data-id="${id}"]`);
  // (adding them selected all 96, and the list followed the last one: nothing selected, the list at its top)
  await page.evaluate(() => (window as any).__luxdmx.selectNone());
  await item(ids[0]).scrollIntoViewIfNeeded();
  await expect(item(ids[90])).not.toBeInViewport();          // (far down the list)
  const xy = await page.evaluate((id) => (window as any).__stage3d.screenOf(id), ids[90]);
  await page.mouse.click(xy.x, xy.y);
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.selected.length)).toBe(1);
  const picked: string = await page.evaluate(() => (window as any).__luxdmx.selected[0]);
  expect(ids.indexOf(picked)).toBeGreaterThan(70);           // one of the far ones (lights stand close in 3D)
  await expect(item(picked)).toHaveClass(/\bsel\b/);
  await expect(item(picked)).toBeInViewport();
});

test('the Haze slider acts at once, over its whole range', async ({ page }) => {
  test.setTimeout(90_000);
  await openConnected(page);
  await patch(page, 'gen-mover8', 1, 0, 'Head');
  await open3d(page);
  // (in the toolbar on a wide screen, under More on a narrow one: one of them is there once it's drawn)
  const slider = page.getByLabel('Haze in the air'), more = page.locator('.s3').getByRole('button', { name: 'More', exact: true });
  await expect(slider.or(more).first()).toBeVisible({ timeout: 30000 });
  if (!(await slider.isVisible())) { await more.click(); await expect(slider).toBeVisible(); }
  const haze = () => page.evaluate(() => (window as any).__stage3d.haze());
  await slider.fill('0');
  await expect.poll(haze, { timeout: 1000 }).toBeLessThan(0.15);
  await slider.fill('0.5');
  await expect.poll(haze, { timeout: 1000 }).toBeGreaterThan(0.4);
  await slider.fill('1');
  await expect.poll(haze, { timeout: 1000 }).toBeGreaterThan(0.85);
});

test('the drawing quality starts at High (glow on), and stays there while the DMX has its own thread', async ({ page }) => {
  await fresh(page);
  expect(await page.evaluate(() => (window as any).__luxload.quality)).toBe(2);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as any).__luxload.level)).toBe(2);
});

test('a pixel bar lit by an effect reads its real level; a Release says the effect goes on, and stops it', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-bar12', 1, 0, 'Bar');
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.addEffect('theater', { fixtures: [a.show.fixtures[0].id] }); a.selected = [a.show.fixtures[0].id]; });
  await expect(page.locator('.panel.prog')).toContainText(/out (100|[1-9]\d)%/);
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.release(a.show.cueLists[0]?.id); });
  const t = page.locator('.toast').filter({ hasText: 'keeps running' });
  await expect(t).toContainText('Theater');
  await t.getByRole('button', { name: 'Stop it' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.engine.liveEffects().length)).toBe(0);
});

test('the Ambient slider sets the room\'s own light: starts low, 0 is a dark venue, 1 a lit one', async ({ page }) => {
  test.setTimeout(90_000);
  await openConnected(page);
  await patch(page, 'gen-drgb', 1, 0, 'PAR');
  await open3d(page);
  const amb = () => page.evaluate(() => (window as any).__stage3d.ambient());
  // (its default: less than the room always had: 0.6 on the eye's curve)
  await expect.poll(async () => (await amb()).sky, { timeout: 10000 }).toBeCloseTo(0.35 * 1.25 * Math.pow(0.6, 2.2), 3);
  // the hall's walls and roof (unlit) go with it: near black at the default
  expect((await amb()).walls).toBeLessThan(0.04);
  // the dark end is fine-grained: a tenth of the slider from the bottom is under 1 % of the top
  await expect(page.getByLabel('Ambient light').or(page.locator('.s3').getByRole('button', { name: 'More', exact: true })).first()).toBeVisible({ timeout: 30000 });
  const slider = page.getByLabel('Ambient light'), more = page.locator('.s3').getByRole('button', { name: 'More', exact: true });
  await expect(slider.or(more).first()).toBeVisible({ timeout: 30000 });
  if (!(await slider.isVisible())) { await more.click(); await expect(slider).toBeVisible(); }
  await slider.fill('0.1');
  await expect.poll(async () => (await amb()).sky, { timeout: 5000 }).toBeLessThan(0.4375 * 0.01);
  await slider.fill('0');
  await expect.poll(amb, { timeout: 5000 }).toEqual({ sky: 0, key: 0, env: 0, walls: 0 });
  await slider.fill('1');
  await expect.poll(async () => (await amb()).sky, { timeout: 5000 }).toBeCloseTo(0.4375, 3);
  expect((await amb()).walls).toBeGreaterThan(0.1);
  // kept in this browser
  await page.reload();
  await open3d(page).catch(() => {});
  await expect.poll(async () => (await amb())?.sky, { timeout: 30000 }).toBeCloseTo(0.4375, 3);
});
