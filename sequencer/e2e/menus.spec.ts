// Right-click everywhere it makes sense, and drag things where they belong: a preset onto a light,
// an effect onto a cue.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, patch, channels, selectAll, intensity, record, cues, tab, full, test, expect } from './helpers';

const menuItem = (page: Page, name: string | RegExp) => page.locator('.ctx').getByRole('menuitem', { name });
const onStage = (page: Page, n: string) => page.locator(`.stage-wrap .fx[data-name="${n}"]`);

test.beforeEach(async () => { await resetFake(); });

test('right-click a light on the stage, and the stage floor', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 2, 0, 'P');
  await onStage(page, 'P 1').click();                                  // just P 1 (adding selects both)
  await onStage(page, 'P 1').click({ button: 'right' });
  await menuItem(page, 'Duplicate').click();
  await expect(page.locator('.stage-wrap .fx')).toHaveCount(3);
  const svg = (await page.locator('.stage-wrap svg[aria-label="Stage"]').boundingBox())!;
  await page.mouse.click(svg.x + 15, svg.y + 15, { button: 'right' });
  await menuItem(page, 'Select all').click();
  await expect(page.locator('.stage-wrap .fx[aria-pressed="true"]')).toHaveCount(3);
});

test('drag a preset onto a light; drag an effect onto a cue', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 2, 0, 'PAR');
  await selectAll(page); await full(page);
  await page.locator('.stage-wrap').getByRole('button', { name: 'Select none' }).click();
  await tab(page, 'Presets');
  await page.locator('.pp .tile[data-preset="Blue"]').dragTo(onStage(page, 'PAR 2'));
  await expect.poll(() => channels(0, 8)).toEqual([255, 255, 255, 255, 255, 0, 0, 255]);
  await expect(page.locator('.toast')).toContainText('Blue on PAR 2');

  await selectAll(page); await intensity(page, 1); await record(page);
  await tab(page, 'Effects');
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add an effect' }).locator('[data-effect="wave"]').click();
  await page.locator('.ep [data-play="stop"]').first().click();      // not by hand: in the cue
  await page.locator('.ep li.oitem').first().dragTo(cues(page).first());
  await expect(cues(page).first().locator('.fxbadge')).toContainText('Wave');
  await expect(page.locator('.toast')).toContainText('runs with this cue now');
});

test('right-click a cue list tab to rename it; the programmer says when an effect is running', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await selectAll(page); await intensity(page, 0.5); await record(page);
  await page.locator('.deck .tab').first().click({ button: 'right' });
  await menuItem(page, 'Rename…').click();
  const ask = page.getByRole('dialog', { name: 'Rename the list' });
  await ask.getByLabel('Name').fill('Songs');
  await ask.getByLabel('Name').press('Enter');
  await expect(page.locator('.deck .tab').first()).toContainText('Songs');

  await selectAll(page);
  await tab(page, 'Effects');
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add an effect' }).locator('[data-effect="pulse"]').click();
  await expect(page.locator('.prog .fxnote')).toContainText('Pulse (brightness) is running on these lights');
  await page.locator('.prog .fxnote').getByRole('button', { name: /Stop/ }).first().click();
  await expect(page.locator('.prog .fxnote')).toHaveCount(0, { timeout: 3000 });
});

test('right-click a live button to change it', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Bar' }).last().click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.locator('.live .tile.cue').first().click({ button: 'right' });
  await menuItem(page, 'Change this control…').click();
  await expect(page.getByRole('complementary', { name: 'Control settings' })).toBeVisible();
  await expect(page.locator('.live .tile.cue').first()).toHaveClass(/selected/);
});

test('a colour dropped on a light a rainbow runs over says so, and can stop the rainbow', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 2, 0, 'PAR');
  await selectAll(page); await full(page);
  await tab(page, 'Effects');
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add an effect' }).locator('[data-effect="rainbow"]').click();
  await page.locator('.stage-wrap').getByRole('button', { name: 'Select none' }).click();
  await tab(page, 'Presets');
  await page.locator('.pp .tile[data-preset="Blue"]').dragTo(onStage(page, 'PAR 1'));
  await expect(page.locator('.toast')).toContainText('Blue on PAR 1, but Rainbow on PARs is running over it');   // (named after its lights)
  await page.locator('.toast').getByRole('button', { name: 'Stop Rainbow on PARs' }).click();
  await expect.poll(() => channels(0, 4), { timeout: 4000 }).toEqual([255, 0, 0, 255]);   // now it's blue
});
