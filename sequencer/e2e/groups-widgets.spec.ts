// Groups end to end, and the live page's widget settings for faders and special buttons.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, patch, channels, tab, selectAll, intensity, record, test, expect } from './helpers';

const groups = (page: Page) => page.locator('.gp li.oitem');
test.beforeEach(async () => { await resetFake(); });

test('groups: made by type, renamed with F2, a click selects them, deleting can be undone', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 3, 0, 'P');
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await tab(page, 'Groups');
  await page.locator('.gp').getByRole('button', { name: 'Group by fixture type' }).click();
  await expect(groups(page)).toHaveCount(2);
  await expect(groups(page).first()).toContainText('3 lights');
  await groups(page).first().locator('.main').focus();
  await page.keyboard.press('F2');
  await page.locator('.gp').getByLabel('Group name').fill('Wash');
  await page.locator('.gp').getByLabel('Group name').press('Enter');
  await expect(groups(page).first()).toContainText('Wash');
  await page.locator('.stage-wrap').getByRole('button', { name: 'Select none' }).click();
  await groups(page).first().click();
  await expect(page.locator('.stage-wrap .fx[aria-pressed="true"]')).toHaveCount(3);
  await groups(page).nth(1).click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: 'Delete group' }).click();
  await expect(groups(page)).toHaveCount(1);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(groups(page)).toHaveCount(2);
});

test('live widgets: a fader set to a list level, a Tap button', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 1, 0, 'D');
  await selectAll(page); await intensity(page, 1); await record(page);
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.live').getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('.ctx').getByRole('menuitem', { name: 'Fader' }).click();
  const ed = page.getByRole('complementary', { name: 'Control settings' });
  await ed.getByLabel('Fader target').selectOption({ label: 'Main' });
  await ed.getByLabel('Label').fill('Show level');
  await page.locator('.live').getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.live .tile.cue').first().click();
  await expect.poll(() => channels(0, 1), { timeout: 4000 }).toEqual([255]);
  const f = page.locator('.live .tile.fader', { hasText: 'Show level' });
  await f.focus();
  await page.keyboard.press('PageDown'); await page.keyboard.press('PageDown');   // 100 -> 50 %
  await expect.poll(() => channels(0, 1)).toEqual([128]);
  // a Tap button sets the tempo
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.live').getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('.ctx').getByRole('menuitem', { name: /Blackout, tap/ }).click();
  // a special button is named by what it does: switched to Blinder it never reads "Blackout"
  await expect(ed.getByLabel('Label')).toHaveValue('');
  await ed.getByLabel('Special action').selectOption('blinder');
  await expect(page.locator('.live .tile.special.selected, .live .tile.special').last()).not.toContainText('Blackout');
  await ed.getByLabel('Special action').selectOption('tap');
  await ed.getByLabel('Label').fill('TapIt');
  await page.locator('.live').getByRole('button', { name: 'Done', exact: true }).click();
  const tap = page.locator('.live .tile', { hasText: 'TapIt' });
  for (let i = 0; i < 4; i++) { await tap.click(); await page.waitForTimeout(500); }
  await expect.poll(async () => Number(await page.locator('.top input[aria-label="BPM"]').inputValue())).toBeGreaterThan(100);
  expect(Number(await page.locator('.top input[aria-label="BPM"]').inputValue())).toBeLessThan(135);
});
