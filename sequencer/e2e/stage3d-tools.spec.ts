// The 3D stage's toolbar and panels at the sizes people use: one row of tools everywhere (what
// doesn't fit is in More), the venue panel under the toolbar with a close and Escape, the aim hint
// clear of the selection's numbers, the selection panel folding (remembered) and compact on a phone,
// "mixed" readable, −/+ big enough to hit.
import type { Locator, Page } from '@playwright/test';
import { openConnected, resetFake, patch, selectAll, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });
// (the 3D stage draws in software in the test browser: slow when the machine is busy)
test.describe.configure({ timeout: 150_000 });

async function open3d(page: Page) {
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45_000 });      // (three.js loads first)
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d), { timeout: 15000 }).toBe(true);
}
const box = async (l: Locator) => (await l.boundingBox())!;
const oneRow = (page: Page) => page.locator('.s3 .tools').evaluate((t) => ({ h: t.getBoundingClientRect().height, over: t.scrollWidth - t.clientWidth }));
const apart = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('one row of tools, the rest in More; the venue panel under it closes; the selection panel is small and folds', async ({ page }) => {
    await openConnected(page);
    await page.evaluate(() => (window as any).__luxdmx.addFixtures('gen-mover8', '', 6, 0, 'Head'));
    await page.getByRole('navigation', { name: 'Program panes' }).getByRole('button', { name: 'Stage' }).click();
    await open3d(page);
    const s3 = page.locator('.s3');
    const row = await oneRow(page);
    expect(row.h).toBeLessThan(56);                     // one row of 44 px buttons (it was three)
    expect(row.over).toBeLessThanOrEqual(1);            // and nothing hidden off the side
    await expect(s3.getByRole('button', { name: 'Record a video' })).toBeVisible();
    // the camera, haze, glow, venue, video size and full screen are in More
    await s3.getByRole('button', { name: 'More', exact: true }).click();
    const more = s3.getByRole('group', { name: 'More for the 3D stage' });
    for (const b of ['Front', 'FOH', 'Tour', 'Venue…', 'Full screen']) await expect(more.getByRole('button', { name: b, exact: true })).toBeVisible();
    for (const l of ['Haze in the air', 'Glow', 'Video size']) await expect(more.getByLabel(l)).toBeVisible();
    await more.getByRole('button', { name: 'FOH' }).click();
    await expect(more).toHaveCount(0);
    // the venue panel: under the toolbar (not over it), closes with Escape and with its X
    await s3.getByRole('button', { name: 'More', exact: true }).click();
    await more.getByRole('button', { name: 'Venue…' }).click();
    const venue = s3.getByRole('group', { name: 'The venue' });
    // (More is gone: the keys go on in the panel)
    await expect(venue.getByRole('button', { name: /Load a 3D model/ })).toBeFocused();
    expect((await box(venue)).y).toBeGreaterThanOrEqual((await box(s3.locator('.tools'))).y + (await box(s3.locator('.tools'))).height - 1);
    await page.keyboard.press('Escape');
    await expect(venue).toHaveCount(0);
    await s3.getByRole('button', { name: 'More', exact: true }).click();
    await more.getByRole('button', { name: 'Venue…' }).click();
    await venue.getByRole('button', { name: 'Close the venue panel' }).click();
    await expect(venue).toHaveCount(0);
    // the selection's panel: a small part of the view, −/+ 44 px tall for a finger
    await page.evaluate(() => (window as any).__luxdmx.selectAll());
    const sel = s3.getByRole('group', { name: 'The selected lights' });
    await expect(sel).toBeVisible();
    expect((await box(sel)).height / (await box(s3)).height).toBeLessThan(0.25);
    expect((await box(sel.getByRole('button', { name: 'X m more' }))).height).toBeGreaterThanOrEqual(44);
    // folded to its name, and still folded when the 3D stage opens again
    await sel.getByRole('button', { name: '6 lights' }).click();
    await expect(sel.getByLabel('X m', { exact: true })).toHaveCount(0);
    expect((await box(sel)).height).toBeLessThan(60);
    await page.locator('.stage-wrap').getByRole('button', { name: '2D' }).click();
    await open3d(page);
    await expect(sel.getByRole('button', { name: '6 lights' })).toHaveAttribute('aria-expanded', 'false');
    await sel.getByRole('button', { name: '6 lights' }).click();
    await expect(sel.getByLabel('X m', { exact: true })).toBeVisible();
  });
});

test('desktop: Venue in the toolbar, its panel closes with Escape (focus back on Venue); the aim hint is clear of the numbers; "mixed" fits; −/+ are 28 px', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover8', 3, 0, 'Head');
  await open3d(page);
  const s3 = page.locator('.s3');
  expect((await oneRow(page)).h).toBeLessThan(40);
  // (the camera, the click tools, Venue and Record fit; Haze, Glow, the video size and full screen are in More)
  await expect(s3.locator('.tools').getByLabel('Haze in the air')).toHaveCount(0);
  await s3.getByRole('button', { name: 'Venue', exact: true }).click();
  const venue = s3.getByRole('group', { name: 'The venue' });
  await expect(venue).toBeVisible();
  const t = await box(s3.locator('.tools'));
  expect((await box(venue)).y).toBeGreaterThanOrEqual(t.y + t.height - 1);
  await page.keyboard.press('Escape');
  await expect(venue).toHaveCount(0);
  await expect(s3.getByRole('button', { name: 'Venue', exact: true })).toBeFocused();
  await s3.getByRole('button', { name: 'More', exact: true }).click();
  for (const l of ['Haze in the air', 'Glow', 'Video size']) await expect(s3.getByRole('group', { name: 'More for the 3D stage' }).getByLabel(l)).toBeVisible();
  await page.keyboard.press('Escape');
  // three heads in a row: X differs ("mixed"), the same height
  await selectAll(page);
  const sel = s3.getByRole('group', { name: 'The selected lights' });
  const x = sel.getByLabel('X m', { exact: true });
  await expect(x).toHaveAttribute('placeholder', 'mixed');
  await expect(x).toHaveValue('');
  const fit = await x.evaluate((el: HTMLInputElement) => {
    const cs = getComputedStyle(el), c = document.createElement('canvas').getContext('2d')!;
    c.font = `italic ${cs.fontSize} ${cs.fontFamily}`;
    return { text: c.measureText(el.placeholder).width, room: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) };
  });
  expect(fit.text).toBeLessThan(fit.room);
  for (const b of ['X m less', 'Roll ° more']) { const r = await box(sel.getByRole('button', { name: b })); expect(r.width).toBeGreaterThanOrEqual(28); expect(r.height).toBeGreaterThanOrEqual(28); }
  // Aim's hint sits under the toolbar, never over Turn / Tip / Roll
  await s3.getByRole('button', { name: 'Aim', exact: true }).click();
  const hint = s3.locator('.aimhint');
  await expect(hint).toBeVisible();
  expect(apart(await box(hint), await box(sel))).toBe(true);
  for (const f of ['Turn °', 'Tip °', 'Roll °']) expect(apart(await box(hint), await box(sel.getByLabel(f, { exact: true })))).toBe(true);
});

test.describe('a wide screen', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  test('everything in the toolbar, one row, no More', async ({ page }) => {
    await openConnected(page);
    await open3d(page);
    const s3 = page.locator('.s3');
    const row = await oneRow(page);
    expect(row.h).toBeLessThan(40); expect(row.over).toBeLessThanOrEqual(1);
    for (const b of ['Front', 'Tour', 'Select', 'Venue', 'Record a video', 'Render a video', 'Full screen']) await expect(s3.locator('.tools').getByRole('button', { name: b, exact: true })).toBeVisible();
    for (const l of ['Haze in the air', 'Glow', 'Ambient light', 'Spill from your lights', 'Video size']) await expect(s3.locator('.tools').getByLabel(l)).toBeVisible();
    await expect(s3.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
    // the venue panel opens under the toolbar and closes with its X
    await s3.getByRole('button', { name: 'Venue', exact: true }).click();
    const venue = s3.getByRole('group', { name: 'The venue' });
    const t = await box(s3.locator('.tools'));
    expect((await box(venue)).y).toBeGreaterThanOrEqual(t.y + t.height - 1);
    await venue.getByRole('button', { name: 'Close the venue panel' }).click();
    await expect(venue).toHaveCount(0);
  });
});
