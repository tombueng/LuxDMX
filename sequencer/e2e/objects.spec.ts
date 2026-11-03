// Lists of real objects: select like files, drag to reorder, copy / cut / paste / duplicate /
// delete with the keys and the context menu. Fixtures, cues and groups.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, patch, channels, selectAll, selectFixtures, intensity, record, cues, jumpTo, go, fixturesOnStage, tab, swatch, full , test, expect } from './helpers';

const items = (page: Page) => page.locator('.fl li.oitem');
const names = async (page: Page) => (await items(page).locator('.nm').allTextContents());
const menuItem = (page: Page, name: string | RegExp) => page.locator('.ctx').getByRole('menuitem', { name });

test.beforeEach(async () => { await resetFake(); });

test('fixtures: shift-select, drag to reorder, copy and paste to free addresses, delete', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 4, 0, 'D');
  expect(await names(page)).toEqual(['D 1', 'D 2', 'D 3', 'D 4']);
  // every item shows what it is and where it's patched
  await expect(items(page).first()).toContainText('Dimmer');
  await expect(items(page).nth(2).locator('.addr')).toHaveText('3');

  await items(page).nth(0).click();
  await items(page).nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.fl li.oitem.sel')).toHaveCount(2);
  await expect(page.locator('.stage-wrap .fx[aria-pressed="true"]')).toHaveCount(2);     // the stage follows

  // drag D 1 + D 2 below D 4
  await items(page).nth(0).dragTo(items(page).nth(3), { targetPosition: { x: 20, y: 30 } });
  expect(await names(page)).toEqual(['D 3', 'D 4', 'D 1', 'D 2']);

  // copy, paste: two new dimmers at the next free addresses (5, 6), selected
  await page.locator('.fl .olist').press('Control+c');
  await page.locator('.fl .olist').press('Control+v');
  await expect(items(page)).toHaveCount(6);
  expect(await names(page)).toEqual(['D 3', 'D 4', 'D 1', 'D 2', 'D 5', 'D 6']);
  await expect(page.locator('.fl li.oitem.sel .addr')).toHaveText(['5', '6']);
  await intensity(page, 1);
  await expect.poll(() => channels(0, 6)).toEqual([0, 0, 0, 0, 255, 255]);

  // Delete removes them at once; Undo in the message (or Ctrl+Z) brings them back
  await page.locator('.fl .olist').press('Delete');
  await expect(items(page)).toHaveCount(4);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(items(page)).toHaveCount(6);
  await items(page).nth(4).click();
  await page.locator('.fl .olist').press('Delete');
  await expect(items(page)).toHaveCount(5);
  await page.locator('body').press('Control+z');
  await expect(items(page)).toHaveCount(6);
});

test('fixtures: the context menu duplicates and groups; a group selects its lights', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 3, 0, 'PAR');
  await items(page).nth(0).click();                 // just PAR 1 (adding selects all new ones)
  await items(page).nth(0).click({ button: 'right' });
  await menuItem(page, 'Duplicate').click();
  await expect(items(page)).toHaveCount(4);
  await expect(items(page).last().locator('.addr')).toHaveText('10');

  await selectFixtures(page, ['PAR 1', 'PAR 3']);
  await items(page).nth(0).click({ button: 'right' });
  await menuItem(page, 'Make a group from the selection').click();
  const ask = page.getByRole('dialog', { name: 'New group' });
  await ask.getByLabel('Name').fill('Sides');
  await ask.getByLabel('Name').press('Enter');
  await tab(page, 'Groups');
  await expect(page.locator('li[data-group="Sides"]')).toContainText('2 lights');
  await page.locator('.stage-wrap').getByRole('button', { name: 'Select none' }).click();
  await page.locator('.stage-wrap .grp', { hasText: 'Sides' }).click();
  await expect(page.locator('.stage-wrap .fx[aria-pressed="true"]')).toHaveCount(2);
  await full(page); await swatch(page, 'Red');
  await expect.poll(() => channels(0, 9)).toEqual([255, 0, 0, 0, 0, 0, 255, 0, 0]);
});

test('cues: cards with their look, drag to reorder changes the GO order, copy/paste/duplicate/delete, update', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 3, 0, 'D');
  for (const n of ['D 1', 'D 2', 'D 3']) {
    await selectAll(page); await intensity(page, 0);
    await selectFixtures(page, [n]); await intensity(page, 1);
    await record(page);
  }
  await expect(cues(page)).toHaveCount(3);
  await expect(cues(page).first().locator('.pic img.look')).toBeVisible();      // a picture of the look
  await expect(cues(page).first()).toContainText('2 s');                        // fade
  await expect(cues(page).first()).toContainText('3 lights');                   // what it sets
  await expect(cues(page).first()).toContainText('GO');                         // waits for GO

  // drag cue 3 in front of cue 1
  await cues(page).nth(2).dragTo(cues(page).nth(0), { targetPosition: { x: 5, y: 30 } });
  await expect(cues(page).locator('.name')).toHaveText(['Cue 3', 'Cue 1', 'Cue 2']);
  await jumpTo(page, 0);
  await expect.poll(() => channels(0, 3)).toEqual([0, 0, 255]);
  await go(page);
  await expect.poll(() => channels(0, 3), { timeout: 4000 }).toEqual([255, 0, 0]);

  // Ctrl+C / Ctrl+V on the selected card: a copy right after it
  await cues(page).nth(0).click();
  await page.locator('.deck .cards').press('Control+c');
  await page.locator('.deck .cards').press('Control+v');
  await expect(cues(page).locator('.name')).toHaveText(['Cue 3', 'Cue 3', 'Cue 1', 'Cue 2']);
  await page.locator('.deck .cards').press('Control+d');
  await expect(cues(page)).toHaveCount(5);
  // Delete twice: the selection moves on to the next card, like in a file manager
  await page.locator('.deck .cards').press('Delete');
  await expect(cues(page)).toHaveCount(4);
  await page.locator('.deck .cards').press('Delete');
  await expect(cues(page).locator('.name')).toHaveText(['Cue 3', 'Cue 3', 'Cue 2']);

  // rename in the inspector, update the look with new changes
  await cues(page).nth(0).click();
  await page.locator('.insp').getByLabel('Cue name').fill('Right');
  await expect(cues(page).nth(0).locator('.name')).toHaveText('Right');
  await jumpTo(page, 0);                                                        // Update goes into the cue on stage
  await selectFixtures(page, ['D 2']); await intensity(page, 0.5);
  await expect(page.locator('.deck').getByRole('button', { name: 'Update' })).toContainText('"Right"');
  await page.locator('.deck').getByRole('button', { name: 'Update' }).click();
  await jumpTo(page, 0);
  await expect.poll(() => channels(0, 3), { timeout: 4000 }).toEqual([0, 128, 255]);

  // right-click: go to a cue, delete it
  await cues(page).nth(2).click({ button: 'right' });
  await menuItem(page, 'Go to this cue').click();
  await expect.poll(() => channels(0, 3), { timeout: 4000 }).toEqual([0, 255, 0]);
  await cues(page).nth(2).click({ button: 'right' });
  await menuItem(page, 'Delete').click();
  await expect(cues(page)).toHaveCount(2);
});

test('the stage: drag a box to select, drag a light to move it', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 4, 0, 'P');
  const svg = page.locator('.stage-wrap svg[aria-label="Stage"]');
  const box = (await svg.boundingBox())!;
  const fx = async (n: string) => (await page.locator(`.stage-wrap .fx[data-name="${n}"] circle`).last().boundingBox())!;
  const a = await fx('P 1'), b = await fx('P 2');
  // a rubber band around the first two
  await page.mouse.move(a.x - 20, a.y + a.height + 25);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 20, b.y - 25, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.stage-wrap .fx[aria-pressed="true"]')).toHaveCount(2);
  // move P 4 up
  const d = await fx('P 4');
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
  await page.mouse.down();
  await page.mouse.move(d.x + d.width / 2, box.y + box.height * 0.2, { steps: 6 });
  await page.mouse.up();
  const moved = await fx('P 4');
  expect(moved.y).toBeLessThan(d.y - 50);
  await expect(fixturesOnStage(page)).toHaveCount(4);
});

test('keyboard: arrows select, Shift extends, Alt moves; cues move with Alt+arrows and the menu', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 4, 0, 'D');
  const list = page.locator('.fl .olist');
  await items(page).nth(0).click();
  await list.press('ArrowDown');
  await expect(page.locator('.fl li.oitem.sel .nm')).toHaveText(['D 2']);
  await list.press('Shift+ArrowDown');
  await expect(page.locator('.fl li.oitem.sel .nm')).toHaveText(['D 2', 'D 3']);
  await list.press('Alt+ArrowDown');
  expect(await names(page)).toEqual(['D 1', 'D 4', 'D 2', 'D 3']);
  await list.press('Alt+ArrowUp');
  await list.press('Alt+ArrowUp');
  expect(await names(page)).toEqual(['D 2', 'D 3', 'D 1', 'D 4']);
  await list.press('Escape');
  await expect(page.locator('.fl li.oitem.sel')).toHaveCount(0);

  for (const n of ['D 1', 'D 2']) { await selectFixtures(page, [n]); await intensity(page, 1); await record(page); }
  await cues(page).nth(0).click();
  await page.locator('.deck .cards').press('Alt+ArrowRight');
  await expect(cues(page).locator('.name')).toHaveText(['Cue 2', 'Cue 1']);
  await cues(page).nth(1).click({ button: 'right' });
  await menuItem(page, 'Move earlier').click();
  await expect(cues(page).locator('.name')).toHaveText(['Cue 1', 'Cue 2']);
});

test('the stage zooms with the wheel and fits again', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 4, 0, 'P');
  const svg = page.locator('.stage-wrap svg[aria-label="Stage"]');
  const fit = page.locator('.stage-wrap').getByRole('button', { name: 'Fit the stage' });
  await expect(fit).toHaveText('100%');
  const b = (await svg.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, -400);
  await expect(fit).not.toHaveText('100%');
  expect(await svg.getAttribute('viewBox')).not.toBe('0.0 0.0 1000.0 560.0');
  // selecting by clicking still hits the right light when zoomed
  await page.locator('.stage-wrap .fx[data-name="P 2"]').click();
  await expect(page.locator('.fl li.oitem.sel .nm')).toHaveText(['P 2']);
  await fit.click();
  await expect(fit).toHaveText('100%');
});

test('cue names: double-click renames, new cues are named after their presets', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 2, 0, 'PAR');
  await selectAll(page); await full(page); await swatch(page, 'Warm white');
  await record(page);
  await expect(cues(page).first().locator('.name')).toHaveText('Warm white');
  await cues(page).first().locator('.name').dblclick();
  await cues(page).first().getByLabel('Cue name').fill('Opening');
  await cues(page).first().getByLabel('Cue name').press('Enter');
  await expect(cues(page).first().locator('.name')).toHaveText('Opening');
  // double-click on the picture still goes to the cue
  await page.locator('.deck').getByRole('button', { name: 'Release', exact: true }).click();
  await expect.poll(() => channels(0, 1), { timeout: 4000 }).toEqual([0]);
  await cues(page).first().locator('.pic').dblclick();
  await expect.poll(() => channels(0, 1)).toEqual([255]);
});

test('the stage: arrow keys nudge the selected lights, dragging snaps to the others', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  const pos = (n: string) => page.evaluate((name) => { const f = (window as any).__luxdmx.show.fixtures.find((x: any) => x.name === name); return { x: f.x, y: f.y }; }, n);
  const before = await pos('D 1');
  await page.locator('.stage-wrap .fx[data-name="D 1"]').click();
  const svg = page.locator('.stage-wrap svg[aria-label="Stage"]');
  await svg.focus();
  for (let i = 0; i < 3; i++) await svg.press('ArrowRight');
  await svg.press('Shift+ArrowDown');
  const after = await pos('D 1');
  expect(after.x - before.x).toBeCloseTo(0.03, 3);
  expect(after.y - before.y).toBeCloseTo(0.05, 3);
  // drag D 2 to just off D 1's row: it lands exactly on it, with a guide while dragging
  const d1 = (await page.locator('.stage-wrap .fx[data-name="D 1"] circle').last().boundingBox())!;
  const d2 = (await page.locator('.stage-wrap .fx[data-name="D 2"] circle').last().boundingBox())!;
  await page.mouse.move(d2.x + d2.width / 2, d2.y + d2.height / 2);
  await page.mouse.down();
  await page.mouse.move(d2.x + d2.width / 2 + 10, d1.y + d1.height / 2 + 3, { steps: 6 });
  await expect(page.locator('.stage-wrap line.snapguide')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.stage-wrap line.snapguide')).toHaveCount(0);
  expect((await pos('D 2')).y).toBeCloseTo(after.y, 5);
});

test('keys on a DIP switch belong to the switch, not the list', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await page.locator('.fl li.oitem', { hasText: 'D 2' }).dblclick();
  const dlg = page.getByRole('dialog', { name: 'Patch: D 2' });
  const sw1 = dlg.locator('.dip').getByRole('button', { name: 'Switch 1 (1)' });
  await expect(sw1).toBeVisible();
  await sw1.press('Backspace');                                           // not "remove the light"
  await expect(page.locator('.fl li.oitem')).toHaveCount(2);
  await sw1.press('Space');                                               // flips it: 2 -> 3
  await expect(dlg.getByLabel('Fixture address')).toHaveValue('3');
  await expect(page.locator('.deck .card')).toHaveCount(0);
});
