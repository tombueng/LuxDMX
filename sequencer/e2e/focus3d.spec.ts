// The camera to the selected lights: the 3D stage's "Selected", and "Show it in 3D" in a light's
// menu (it opens the 3D stage too). The light ends up in the middle of the picture, near enough to
// see, and grabbing the stage stops the flight.
import type { Page } from '@playwright/test';
import { openConnected, patch, test, expect } from './helpers';

// where a light is in the 3D picture, from the middle of it (0: the middle, 1: the edge)
const offCentre = (page: Page, name: string) => page.evaluate((name) => {
  const a = (window as any).__luxdmx, s = (window as any).__stage3d;
  const f = a.show.fixtures.find((x: any) => x.name === name), p = s.screenOf(f.id), r = document.querySelector('.s3 canvas')!.getBoundingClientRect();
  return Math.hypot((p.x - (r.left + r.width / 2)) / (r.width / 2), (p.y - (r.top + r.height / 2)) / (r.height / 2));
}, name);
const camTo = (page: Page, name: string) => page.evaluate((name) => {
  const a = (window as any).__luxdmx, s = (window as any).__stage3d, f = a.show.fixtures.find((x: any) => x.name === name);
  const c = s.internals.camera.position, t = s.internals.controls.target, p = s.screenOf(f.id);
  return { dist: Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z), flying: s.flying(), p };
}, name);

test('the camera flies to the selected lights: "Selected" on the 3D stage, "Show it in 3D" in a light\'s menu', async ({ page }) => {
  test.setTimeout(120_000);
  await openConnected(page);
  await patch(page, 'gen-mover8', 6, 0, 'Head');
  // from the fixture list, the 3D stage closed: it opens and the camera goes to the light
  await page.locator('.fl li[data-fixture="Head 5"]').click();
  await page.locator('.fl li[data-fixture="Head 5"]').click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: 'Show it in 3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45000 });
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d?.internals), { timeout: 30000 }).toBe(true);
  await expect.poll(() => camTo(page, 'Head 5').then((c) => c.flying), { timeout: 20000 }).toBe(false);
  await expect.poll(() => offCentre(page, 'Head 5'), { timeout: 20000 }).toBeLessThan(0.25);
  const near = await camTo(page, 'Head 5');
  expect(near.dist).toBeLessThan(8);                                      // (near: the hall's front view is 24 m off)
  // the front view, then "Selected" with two lights: both in the picture, their middle in its middle
  const cam = page.locator('.s3').getByRole('group', { name: 'Camera' });
  await cam.getByRole('button', { name: 'Front', exact: true }).click();
  await page.locator('.fl li[data-fixture="Head 1"]').click();
  await page.locator('.fl li[data-fixture="Head 2"]').click({ modifiers: ['Shift'] });
  await cam.getByRole('button', { name: 'Selected', exact: true }).click();
  await expect.poll(() => camTo(page, 'Head 1').then((c) => c.flying), { timeout: 20000 }).toBe(false);
  for (const n of ['Head 1', 'Head 2']) expect(await offCentre(page, n)).toBeLessThan(0.8);
  // nothing selected: nothing to fly to
  await page.locator('.stage-wrap').getByRole('button', { name: 'Select none' }).click();
  await expect(cam.getByRole('button', { name: 'Selected', exact: true })).toBeDisabled();
});
