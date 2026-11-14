// The gallery: what the 3D stage draws, a live tile each (the 3D stage's own models, in one shared
// renderer), bigger on a click, and Add takes that light to Add fixtures.
import type { Locator } from '@playwright/test';
import { fresh, test, expect } from './helpers';

// how much light there is in a tile's picture
const lit = (l: Locator) => l.locator('canvas').first().evaluate((c: HTMLCanvasElement) => {
  const x = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < x.length; i += 4) if (x[i] + x[i + 1] + x[i + 2] > 150) n++;
  return n;
});

test('the gallery: a live tile for each thing the 3D stage draws, machines too; bigger on a click; Add takes that light to Add fixtures', async ({ page }) => {
  test.setTimeout(120_000);
  await fresh(page);
  await page.locator('body').press('Control+k');
  await page.getByRole('combobox', { name: 'Find anything' }).fill('gallery');
  await page.keyboard.press('Enter');
  const g = page.getByRole('dialog', { name: 'What the 3D stage draws' });
  await expect(g).toBeVisible();
  await expect(g.getByRole('group')).toHaveCount(23);
  // a gobo spot plays: its gobo on the floor
  const gobos = g.locator('[data-item="gobos"]');
  await expect.poll(() => lit(gobos), { timeout: 40000 }).toBeGreaterThan(15);
  // a machine too: the sparks
  const sparks = g.locator('[data-item="sparks"]');
  await sparks.scrollIntoViewIfNeeded();
  await expect.poll(() => lit(sparks), { timeout: 40000 }).toBeGreaterThan(5);
  // uplights at the foot of a wall: their light on the wall, four colours
  const ups = g.locator('[data-item="uplights"]');
  await ups.scrollIntoViewIfNeeded();
  await expect.poll(() => lit(ups), { timeout: 40000 }).toBeGreaterThan(400);
  const hues = await ups.locator('canvas').first().evaluate((c: HTMLCanvasElement) => {
    const x = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data, seen = new Set<number>();
    for (let i = 0; i < x.length; i += 4) { const r = x[i], gg = x[i + 1], b = x[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      if (mx > 120 && mx - mn > 60) seen.add(Math.round((Math.atan2(Math.sqrt(3) * (gg - b), 2 * r - gg - b) * 180 / Math.PI + 360) % 360 / 45)); }
    return seen.size;
  });
  expect(hues).toBeGreaterThanOrEqual(3);
  // bigger, and back
  await gobos.scrollIntoViewIfNeeded();
  await gobos.getByRole('button', { name: 'Gobos, turning, bigger' }).click();
  await expect(g.locator('.big canvas')).toBeVisible();
  await expect.poll(() => lit(g.locator('.big')), { timeout: 40000 }).toBeGreaterThan(15);
  await g.getByRole('button', { name: 'All of them' }).click();
  // Add: the light picked in Add fixtures
  await g.locator('[data-item="winch"]').getByRole('button', { name: 'Add Kinetic winches' }).click();
  const add = page.getByRole('dialog', { name: 'Add fixtures' });
  await expect(add.locator('[data-type="gen-winch"]').first()).toHaveClass(/\bcur\b/);
  await expect(add.getByRole('button', { name: /^Add \d+ × / })).toBeVisible();
});

test('the gallery is in the top bar\'s menu and the 3D stage\'s menu too', async ({ page }) => {
  await fresh(page);
  await page.locator('.top').getByRole('button', { name: 'More', exact: true }).click();
  await page.locator('.ctx').getByRole('menuitem', { name: 'What the 3D stage draws (gallery)' }).click();
  await expect(page.getByRole('dialog', { name: 'What the 3D stage draws' })).toBeVisible();
});
