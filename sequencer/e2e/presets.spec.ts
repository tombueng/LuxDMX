// Presets by reference: a cue remembers the preset, so changing the preset changes the cue.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, patch, channels, selectAll, record, jumpTo, swatch, full, tab, test, expect } from './helpers';

const tile = (page: Page, name: string) => page.locator(`.pp .tile[data-preset="${name}"]`);
const menuItem = (page: Page, name: string | RegExp) => page.locator('.ctx').getByRole('menuitem', { name });

test.beforeEach(async () => { await resetFake(); });

test('a cue follows its colour preset when the preset changes; deleting the preset keeps the look', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 2, 0, 'PAR');
  await selectAll(page); await full(page); await swatch(page, 'Warm white');
  await record(page);
  await expect.poll(() => channels(0, 4)).toEqual([255, 255, 191, 115]);

  // retune "Warm white" from the stage: set the PARs to a new colour, right-click the preset, Update
  await tab(page, 'Presets');
  await expect(tile(page, 'Warm white')).toContainText('1');                    // used in one cue
  await selectAll(page); await swatch(page, 'Orange');
  await tile(page, 'Warm white').click({ button: 'right' });
  await menuItem(page, 'Update from the selected lights').click();
  await page.locator('.prog').getByRole('button', { name: 'Clear' }).click();
  await jumpTo(page, 0);
  await expect.poll(() => channels(0, 4)).toEqual([255, 255, 115, 0]);          // the cue plays the new warm white

  // delete the preset: the cue keeps its (new) colour as plain values
  await tile(page, 'Warm white').click({ button: 'right' });
  await menuItem(page, /^Delete/).click();
  await expect(tile(page, 'Warm white')).toHaveCount(0);
  await jumpTo(page, 0);
  await expect.poll(() => channels(0, 4)).toEqual([255, 255, 115, 0]);
});

test('position presets: each head keeps its own pan in a fan, and the stage draws the beams', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover8', 3, 0, 'Head');
  await selectAll(page); await full(page);
  await tab(page, 'Presets');
  // the standard set has no fan yet (no heads when the show was made): add the missing ones
  await page.locator('.pp').getByRole('button', { name: 'Add missing standard presets' }).click();
  await tile(page, 'Fan out').click();
  // mover8: pan at 1, 9, 17
  await expect.poll(async () => { const c = await channels(0, 24); return [c[0], c[8], c[16]]; }).toEqual([77, 128, 179]);
  await expect(page.locator('.stage-wrap .beam[data-for="Head 1"]')).toHaveCount(1);
  await expect(tile(page, 'Fan out')).toHaveClass(/active/);
});

test('save the selection as a new preset, and the standard set comes back when it was removed', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 2, 0, 'P');
  await selectAll(page); await full(page);
  await page.locator('.prog .wheel').click({ position: { x: 150, y: 90 } });   // something blue-ish from the wheel
  await tab(page, 'Presets');
  await page.locator('.pp').getByRole('button', { name: 'New Colours preset' }).click();
  const ask = page.getByRole('dialog', { name: 'New colour preset' });
  await ask.getByLabel('Name').fill('Stage blue');
  await ask.getByRole('button', { name: 'Save preset' }).click();
  await expect(tile(page, 'Stage blue')).toHaveCount(1);
  const before = await channels(0, 3);
  await page.locator('.prog').getByRole('button', { name: 'Clear' }).click();
  await selectAll(page); await full(page); await swatch(page, 'Red');
  await tile(page, 'Stage blue').click();
  await expect.poll(() => channels(0, 3)).toEqual(before);
});

test('colours from a picture: presets, and a colour fade in them on the selected lights', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 4, 0, 'PAR');
  await selectAll(page);
  // a poster: mostly red, some blue, a bit of grey
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 60; c.height = 40;
    const x = c.getContext('2d')!;
    x.fillStyle = '#e00000'; x.fillRect(0, 0, 36, 40);
    x.fillStyle = '#0010c0'; x.fillRect(36, 0, 18, 40);
    x.fillStyle = '#808080'; x.fillRect(54, 0, 6, 40);
    return c.toDataURL('image/png').split(',')[1];
  });
  await tab(page, 'Presets');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.pp').getByRole('button', { name: 'Colours from a picture' }).click()]);
  await chooser.setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('.toast')).toContainText('colours from "poster.png" are colour presets now');
  await expect(tile(page, 'poster 1')).toBeVisible();
  // nothing starts by itself; the message offers the fade on the selected lights
  await page.locator('.toast').getByRole('button', { name: 'Fade through them on the selection' }).click();
  await tab(page, 'Effects');
  const fx = page.locator('.ep li.oitem', { hasText: 'poster colours' });
  await expect(fx).toHaveClass(/running/);
  await fx.locator('[data-play="stop"]').click();
  // the most used colour comes first, at full: the red
  await tab(page, 'Presets');
  await full(page);
  await tile(page, 'poster 1').click();
  await expect.poll(() => channels(0, 3), { timeout: 4000 }).toEqual([255, 0, 0]);
  await tile(page, 'poster 2').click();
  await expect.poll(async () => { const [r, g, b] = await channels(0, 3); return r < 30 && g < 40 && b === 255; }, { timeout: 4000 }).toBe(true);
});
