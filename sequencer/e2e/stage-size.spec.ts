// Your own stage: its size in the Venue panel (width, depth, a riser or not, how many trusses and
// how high); the 3D stage builds that room, the lights hang on its trusses, and it's kept with the
// show.
import type { Page } from '@playwright/test';
import { openConnected, patch, test, expect, startTemplate, cues } from './helpers';

const venue = (page: Page) => page.evaluate(() => (window as any).__stage3d?.venue?.());
const where = (page: Page, name: string) => page.evaluate((name) => { const a = (window as any).__luxdmx; return (window as any).__stage3d.where(a.show.fixtures.find((f: any) => f.name === name).id); }, name);

test('your own stage at its size: the room is built for it, heads hang on its truss, bars stand on its deck or the floor; kept with the show', async ({ page }) => {
  test.setTimeout(150_000);
  await openConnected(page);
  await patch(page, 'gen-mover8', 2, 0, 'Head');
  await patch(page, 'gen-bar8', 1, 0, 'Bar');
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect.poll(async () => !!(await venue(page)), { timeout: 45000 }).toBe(true);
  const s3 = page.locator('.s3');
  await s3.getByRole('button', { name: 'Venue', exact: true }).click();
  const v = s3.getByRole('group', { name: 'The venue' });
  await v.getByRole('button', { name: 'Your stage' }).click();
  await expect(v.getByRole('group', { name: "Your stage's size" })).toBeVisible();
  for (const [label, val] of [['Stage width (m)', '6'], ['Stage depth (m)', '4'], ['Truss height (m, its underside above the floor)', '4.5'], ['Trusses over the stage', '1']] as const) {
    await v.getByLabel(label).fill(val);
    await v.getByLabel(label).press('Tab');
  }
  await expect.poll(async () => (await venue(page))?.key, { timeout: 20000 }).toBe('custom:6:4:1:4.5:1');
  const r = await venue(page);
  expect(r.deck).toEqual({ x: 3, z0: -2, z1: 2 });
  expect(r.truss).toEqual([{ z: 0, y: 4.5 }]);
  // the heads hang under its truss, inside its width; the bar stands on the deck
  for (const n of ['Head 1', 'Head 2']) {
    const p = await where(page, n);
    expect(p.y).toBeCloseTo(4.5 - 0.35, 1);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(3);
  }
  expect((await where(page, 'Bar')).y).toBeCloseTo(1.2, 2);
  // off the riser: the bar on the floor
  await v.getByLabel(/On a riser/).uncheck();
  await expect.poll(async () => (await venue(page))?.key, { timeout: 20000 }).toBe('custom:6:4:0:4.5:1');
  await expect.poll(async () => (await where(page, 'Bar')).y, { timeout: 10000 }).toBeCloseTo(0, 2);
  // kept with the show, also after a reload (the loader used to drop a room it didn't know)
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.settings.stage3d)).toMatchObject({ room: 'custom', size: { w: 6, d: 4, riser: false, trussY: 4.5, trusses: 1 } });
  await page.waitForTimeout(1200);                                           // (saved)
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx?.show.settings.stage3d), { timeout: 20000 }).toMatchObject({ room: 'custom', size: { w: 6, d: 4 } });
  await expect.poll(async () => (await venue(page))?.key, { timeout: 45000 }).toBe('custom:6:4:0:4.5:1');
  // the plan in metres: its width and depth on its edges
  await page.locator('.stage-wrap').getByRole('button', { name: '2D' }).click();
  await expect(page.locator('.stage-wrap g.dims')).toContainText('6 m wide');
  await expect(page.locator('.stage-wrap g.dims')).toContainText('4 m deep');
  expect(await page.locator('.stage-wrap g.dims line').count()).toBe(7 + 5);   // (a tick a metre, both ends)
});

test('the Cinema, Bar, Theatre, Church and Wedding templates play in their own rooms, every light installed there; the Venue panel has them too', async ({ page }) => {
  test.setTimeout(240_000);
  await openConnected(page);
  const inRoom = async (name: string, room: string) => {
    await startTemplate(page, name);
    expect(await page.evaluate(() => (window as any).__luxdmx.show.fixtures.every((f: any) => !!f.p3))).toBe(true);
    if (!(await page.locator('.s3 canvas').isVisible())) await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
    await expect.poll(async () => (await venue(page))?.room, { timeout: 45000 }).toBe(room);
  };
  await inRoom('Cinema', 'cinema');
  await inRoom('Theatre', 'theatre');
  // the theatre's: the cyc lights on the top bar over the stage, the footlights on the apron's edge,
  // the front-of-house bar over the stalls
  expect((await where(page, 'Cyc 1')).y).toBeGreaterThan(7);
  expect((await where(page, 'Footlight 1')).y).toBeLessThan(1.5);
  expect((await where(page, 'Front 1')).z).toBeGreaterThan(6);
  await inRoom('Church', 'church');
  // the church's: the wall uplights on the floor at the walls, the heads up in the roof
  const wall = await where(page, 'Wall 1');
  expect(wall.y).toBeLessThan(0.5); expect(Math.abs(wall.x)).toBeGreaterThan(8);
  expect((await where(page, 'Head 1')).y).toBeGreaterThan(9);
  await inRoom('Wedding', 'ballroom');
  // the ballroom's: the uplights at the foot of the walls, the pinspots in the ceiling over the tables
  const up = await where(page, 'Uplight 1');
  expect(up.y).toBeLessThan(0.5); expect(Math.abs(up.x)).toBeGreaterThan(10);
  expect((await where(page, 'Pinspot 1')).y).toBeGreaterThan(6);
  await inRoom('Bar', 'bar');
  // the bar's lights where a bar has them: the shelf uplights low on the back bar, the PARs on the rail
  expect((await where(page, 'Shelf 1')).y).toBeLessThan(1.3);
  expect((await where(page, 'PAR 1')).y).toBeGreaterThan(3);
  const v = page.locator('.s3').getByRole('group', { name: 'The venue' });
  await page.locator('.s3').getByRole('button', { name: 'Venue', exact: true }).click();
  await expect(v.getByRole('button', { name: 'Bar', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const [label, room] of [['Cinema', 'cinema'], ['Theatre', 'theatre'], ['Church', 'church'], ['Ballroom', 'ballroom']] as const) {
    await v.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(async () => (await venue(page))?.room, { timeout: 45000 }).toBe(room);
  }
});

test('light lands on the walls: the church\'s uplights wash its walls; with the built-in room hidden, nothing lands where its walls were', async ({ page }) => {
  test.setTimeout(150_000);
  await openConnected(page);
  await startTemplate(page, 'Church');
  // a look with the wall uplights on (full, blue)
  await cues(page).filter({ hasText: 'Worship concert' }).first().dblclick();
  if (!(await page.locator('.s3 canvas').isVisible())) await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect.poll(async () => (await venue(page))?.room, { timeout: 45000 }).toBe('church');
  const walls = () => page.evaluate(() => (window as any).__stage3d.pools().walls as number);
  await expect.poll(walls, { timeout: 20000 }).toBeGreaterThanOrEqual(6);                      // (six uplights, a wash each)
  // the built-in room hidden (your own venue model instead): no light on walls that aren't there
  const s3 = page.locator('.s3');
  await s3.getByRole('button', { name: 'Venue', exact: true }).click();
  const box = s3.getByRole('group', { name: 'The venue' }).getByRole('checkbox', { name: /The built-in stage/ });
  await box.uncheck();
  await expect.poll(walls, { timeout: 20000 }).toBe(0);
  await box.check();
  await expect.poll(walls, { timeout: 20000 }).toBeGreaterThanOrEqual(6);
});
