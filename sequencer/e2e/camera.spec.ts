// The camera moves in the 3D toolbar: Tour and five crews filming the show (Broadcast, Crane,
// Steadicam, Drone, Band cam), picked from the list next to the Tour button. Each one moves the
// camera by itself, inside the room (the hall and the pub); grabbing the stage stops it (a click on
// it doesn't); the one running comes back after a reload in the same tab; on a phone it's under More.
// (Where each crew goes, its speeds and cuts: src/stage3d/director.test.ts.)
import type { Page } from '@playwright/test';
import { openConnected, resetFake, patch, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });
// (the 3D stage draws in software in the test browser: slow when the machine is busy)
test.describe.configure({ timeout: 150_000 });

const MODES = ['Tour', 'Broadcast', 'Crane', 'Steadicam', 'Drone', 'Band cam'];
async function open3d(page: Page) {
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d), { timeout: 15000 }).toBe(true);
}
// the camera as drawn: where it is, which way it looks, its lens
const cam = (page: Page) => page.evaluate(() => {
  const c = (window as any).__stage3d?.internals.camera;
  return c ? { m: Array.from(c.matrixWorld.elements as number[]), p: c.position.toArray() as number[], fov: c.fov as number } : null;
});
type Cam = NonNullable<Awaited<ReturnType<typeof cam>>>;
const changed = (a: Cam, b: Cam) => a.m.some((v, i) => Math.abs(v - b.m[i]) > 1e-4) || Math.abs(a.fov - b.fov) > 1e-3;
const seg = (page: Page) => page.locator('.s3').getByRole('group', { name: 'Camera', exact: true });
async function pick(page: Page, name: string) {
  await page.locator('.s3').getByRole('button', { name: 'Pick a camera move' }).click();
  const list = page.locator('.s3').getByRole('group', { name: 'Camera moves' });
  await expect(list).toBeVisible();
  for (const m of MODES) await expect(list.getByRole('button', { name: new RegExp(`^${m}`) })).toHaveAttribute('title', /.{30,}/);
  await list.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(list).toHaveCount(0);
}
// the camera keeps moving by itself: three looks a moment apart all differ
async function moving(page: Page) {
  const a = (await cam(page))!;
  await expect.poll(async () => changed(a, (await cam(page))!), { timeout: 10000 }).toBe(true);
  const b = (await cam(page))!;
  await expect.poll(async () => changed(b, (await cam(page))!), { timeout: 10000 }).toBe(true);
}
// the camera holds still (a drag's own glide has settled)
async function settles(page: Page) {
  await expect.poll(async () => { const a = (await cam(page))!; await page.waitForTimeout(600); return changed(a, (await cam(page))!); }, { timeout: 45000, intervals: [100] }).toBe(false);
}
async function setup(page: Page) {
  await openConnected(page);
  await patch(page, 'gen-mover8', 2, 0, 'Head');
  await open3d(page);
}

test('every camera move moves the camera by itself, inside the hall; the button says which one runs', async ({ page }) => {
  await setup(page);
  for (const name of MODES) {
    await pick(page, name);
    const btn = seg(page).getByRole('button', { name, exact: true });
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await moving(page);
    const p = (await cam(page))!.p;
    // (the hall: walls at x ±24, z -10 and 31, the roof at 15; the old Tour swings a little past the side walls)
    if (name !== 'Tour') expect(Math.abs(p[0])).toBeLessThan(24); expect(p[1]).toBeGreaterThan(0.5); expect(p[1]).toBeLessThan(15); expect(p[2]).toBeGreaterThan(-10); expect(p[2]).toBeLessThan(31);
  }
  // the button stops the one running, and starts it again
  await seg(page).getByRole('button', { name: 'Band cam', exact: true }).click();
  await expect(seg(page).getByRole('button', { name: 'Band cam', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(600);
  const still = (await cam(page))!;
  await page.waitForTimeout(800);
  expect(changed(still, (await cam(page))!)).toBe(false);
  await seg(page).getByRole('button', { name: 'Band cam', exact: true }).click();
  await moving(page);
  // a view button stops it too
  await seg(page).getByRole('button', { name: 'Front', exact: true }).click();
  await expect(seg(page).getByRole('button', { name: 'Band cam', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('a drag on the stage stops a camera move (the camera stays where you leave it); a click doesn\'t', async ({ page }) => {
  await setup(page);
  const box = (await page.locator('.s3 canvas').boundingBox())!, cx = box.x + box.width / 2, cy = box.y + box.height * 0.6;
  await pick(page, 'Crane');
  const btn = seg(page).getByRole('button', { name: 'Crane', exact: true });
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  // a click (nothing there to select): the crane goes on
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(500);
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await moving(page);
  // a drag: it stops, and the camera stays where the drag left it
  await pick(page, 'Drone');
  const drone = seg(page).getByRole('button', { name: 'Drone', exact: true });
  await expect(drone).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(cx, cy); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx + i * 20, cy - i * 4);
  await page.mouse.up();
  await expect(drone).toHaveAttribute('aria-pressed', 'false');
  await settles(page);
  await page.waitForTimeout(1500);
  await settles(page);
  await expect(drone).toHaveAttribute('aria-pressed', 'false');
  // the wheel stops one too
  await pick(page, 'Steadicam');
  await page.mouse.move(cx, cy); await page.mouse.wheel(0, -200);
  await expect(seg(page).getByRole('button', { name: 'Steadicam', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('the camera move running comes back after a reload in the same tab', async ({ page }) => {
  await setup(page);
  await pick(page, 'Steadicam');
  await moving(page);
  await page.reload();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45_000 });
  await expect(seg(page).getByRole('button', { name: 'Steadicam', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d), { timeout: 15000 }).toBe(true);
  await moving(page);
  // stopped, it stays stopped over a reload (and the button still offers Steadicam)
  await seg(page).getByRole('button', { name: 'Steadicam', exact: true }).click();
  await page.reload();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45_000 });
  await expect(seg(page).getByRole('button', { name: 'Steadicam', exact: true })).toHaveAttribute('aria-pressed', 'false', { timeout: 15000 });
});

test('in the small club / pub: the crews film inside its walls, under its low ceiling', async ({ page }) => {
  await setup(page);
  await page.locator('.s3').getByRole('button', { name: 'Venue', exact: true }).click();
  await page.locator('.s3').getByRole('group', { name: 'The venue' }).getByRole('button', { name: 'Small club / pub' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__stage3d.venue().room), { timeout: 30000 }).toBe('pub');
  await page.locator('.s3').getByRole('button', { name: 'Close the venue panel' }).click();
  for (const name of ['Drone', 'Band cam', 'Broadcast']) {
    await pick(page, name);
    await moving(page);
    for (let i = 0; i < 4; i++) {
      const p = (await cam(page))!.p;
      // (the pub: walls at x ±4.6, z -1.8 and 14.6, the ceiling at 5.1)
      expect(Math.abs(p[0])).toBeLessThan(4.6); expect(p[1]).toBeLessThan(5.1); expect(p[2]).toBeGreaterThan(-1.8); expect(p[2]).toBeLessThan(14.6);
      await page.waitForTimeout(300);
    }
  }
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('the camera moves are under More with the views', async ({ page }) => {
    await openConnected(page);
    await page.getByRole('navigation', { name: 'Program panes' }).getByRole('button', { name: 'Stage' }).click();
    await open3d(page);
    const s3 = page.locator('.s3');
    await s3.getByRole('button', { name: 'More', exact: true }).click();
    const more = s3.getByRole('group', { name: 'More for the 3D stage' });
    await expect(more.getByRole('button', { name: 'Tour', exact: true })).toBeVisible();
    await more.getByRole('button', { name: 'Pick a camera move' }).click();
    const list = more.getByRole('group', { name: 'Camera moves' });
    await expect(list).toBeVisible();
    // (finger sized)
    for (const m of MODES) expect((await list.getByRole('button', { name: new RegExp(`^${m}`) }).boundingBox())!.height).toBeGreaterThanOrEqual(38);
    await list.getByRole('button', { name: /^Drone/ }).click();
    await expect(more).toHaveCount(0);
    await moving(page);
    await s3.getByRole('button', { name: 'More', exact: true }).click();
    await expect(more.getByRole('button', { name: 'Drone', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
});
