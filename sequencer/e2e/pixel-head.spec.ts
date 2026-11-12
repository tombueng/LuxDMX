// Pixel heads made by hand: the fixture editor's "+ Cells" (a block of channels again for every LED,
// with the head's shape) and the channel wizard's "the rest are more of the same", then single
// cells of the new head picked in the programmer. Measured on the wire (the fake box).
import type { Page } from '@playwright/test';
import { channels, full, openConnected, resetFake, selectAll, swatch, tab, test, expect } from './helpers';

const addDialog = (page: Page) => page.getByRole('dialog', { name: 'Add fixtures' });
async function openEditor(page: Page) {
  await tab(page, 'Fixtures');
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  await addDialog(page).getByRole('button', { name: 'Make my own…' }).click();
}
async function patchSelected(page: Page, count: number, universe = 0) {
  const dlg = addDialog(page);
  await dlg.getByLabel('How many').fill(String(count));
  await dlg.getByLabel('Universe').fill(String(universe));
  await dlg.getByRole('button', { name: /^Add \d+ × / }).click();
  await expect(dlg).toBeHidden();
}
const cellsBox = (page: Page) => page.getByRole('region', { name: 'Add cells' });
const picker = (page: Page) => page.locator('.prog #pg-cells');

test.beforeEach(async () => { await resetFake(); });

test('a 37-LED bee eye in one go: head channels, then 37 RGBW cells on rings of 1, 6, 12, 18', async ({ page }) => {
  await openConnected(page);
  await openEditor(page);
  await page.getByLabel('Model').fill('Bee eye 37');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '+ Channel' }).click();
  await page.getByLabel('Channel 1 function').selectOption('pan');
  await page.getByLabel('Channel 2 function').selectOption('tilt');
  await page.getByLabel('Channel 3 function').selectOption('intensity');
  await page.getByRole('button', { name: '+ Cells…' }).click();
  await cellsBox(page).getByLabel('Channels per cell', { exact: true }).selectOption('rgbw');
  await cellsBox(page).getByLabel('How many cells').fill('37');
  await cellsBox(page).getByLabel('Shape').selectOption('rings');
  await cellsBox(page).getByLabel('LEDs per ring').fill('1, 6, 12');
  await expect(cellsBox(page)).toContainText('That shape has 19 LEDs, the light will have 37 cells: set How many cells to 19');
  await cellsBox(page).getByLabel('LEDs per ring').fill('1, 6, 12, 18');
  await expect(cellsBox(page)).toContainText('37 × 4 = 148 channels, cells 1 to 37');
  await cellsBox(page).getByRole('button', { name: 'Add 37 cells' }).click();
  // 151 rows, the 148 cell rows as one line until opened
  await expect(page.getByRole('button', { name: /Cells 1 to 37/ })).toContainText('Red, Green, Blue, White each, 148 channels');
  await expect(page.getByLabel('Channel 150 function')).toHaveCount(0);
  await page.getByRole('button', { name: /Cells 1 to 37/ }).click();
  await expect(page.getByLabel('Channel 151 name')).toHaveValue('White 37');
  await expect(page.getByLabel('Channel 151 cell')).toHaveValue('37');
  await expect(page.getByText('Shape: rings of 1, 6, 12, 18 (37 LEDs)')).toBeVisible();
  await page.getByRole('button', { name: 'Save type' }).click();
  await patchSelected(page, 1);
  await selectAll(page);
  // the centre LED (the data's first, on the ring of 1) red at full: the dimmer carries it, nothing else lights
  await expect(picker(page).locator('canvas')).toHaveAttribute('data-cells', '37');
  await picker(page).getByRole('button', { name: 'Centre', exact: true }).click();
  await expect(picker(page)).toContainText('1 of 37 picked');
  await full(page);
  await swatch(page, 'Red');
  await expect.poll(async () => (await channels(0, 11)).slice(2)).toEqual([255, 255, 0, 0, 0, 0, 0, 0, 0]);
  // the rim (the last 18 LEDs) blue: LED 20 on, LED 19 (ring of 12) still dark
  await picker(page).getByRole('button', { name: 'Rim', exact: true }).click();
  await expect(picker(page)).toContainText('18 of 37 picked');
  await full(page);
  await swatch(page, 'Blue');
  await expect.poll(async () => { const c = await channels(0, 151); return [c.slice(3 + 18 * 4, 3 + 19 * 4), c.slice(3 + 19 * 4, 3 + 20 * 4), c.slice(147, 151)]; })
    .toEqual([[0, 0, 0, 0], [0, 0, 255, 0], [0, 0, 255, 0]]);
});

test('rows from the manual\'s table as the first cell, the rest made from them', async ({ page }) => {
  await openConnected(page);
  await openEditor(page);
  await page.getByLabel('Model').fill('Bar 8');
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '+ Channel' }).click();
  await page.getByLabel('Channel 1 function').selectOption('intensity');
  await page.getByLabel('Channel 2 function').selectOption('red');
  await page.getByLabel('Channel 3 function').selectOption('green');
  await page.getByLabel('Channel 4 function').selectOption('blue');
  await page.getByRole('button', { name: '+ Cells…' }).click();
  await cellsBox(page).getByRole('radio', { name: 'Rows of the table' }).check();
  await cellsBox(page).getByLabel('First row of the cell').fill('2');
  await cellsBox(page).getByLabel('Last row of the cell').fill('4');
  await cellsBox(page).getByLabel('How many cells').fill('8');
  await expect(cellsBox(page)).toContainText('8 × 3 = 24 channels (the 3 rows included), cells 1 to 8');
  await cellsBox(page).getByRole('button', { name: 'Add 8 cells' }).click();
  await expect(page.getByRole('button', { name: /Cells 1 to 8/ })).toContainText('Red, Green, Blue each, 24 channels');
  await page.getByRole('button', { name: 'Save type' }).click();
  await patchSelected(page, 1);
  await selectAll(page);
  await full(page);
  await swatch(page, 'Green');
  await picker(page).getByLabel('Cells to pick').fill('8');
  await picker(page).getByLabel('Cells to pick').press('Enter');
  await swatch(page, 'Red');
  await expect.poll(async () => { const c = await channels(0, 25); return [c[0], c.slice(1, 4), c.slice(22, 25)]; }).toEqual([255, [0, 255, 0], [255, 0, 0]]);
});

test('the wizard: one LED found, the rest are more of the same', async ({ page }) => {
  await openConnected(page);
  await openEditor(page);
  await page.getByRole('button', { name: 'Find the channels on the fixture…' }).first().click();
  await page.locator('.modal input[type=number]').nth(1).fill('20');   // start address
  await page.locator('.modal input[type=number]').nth(2).fill('14');   // 14 channels: a dimmer, 4 x RGB, one more
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (const a of ['Dimmer', 'Red', 'Green', 'Blue']) await page.getByRole('button', { name: a, exact: true }).click();
  await page.getByRole('button', { name: 'The rest are more of the same (cells)…' }).click();
  const rep = page.getByLabel('The rest are cells');
  await expect(rep.getByLabel('The cell starts at channel')).toHaveValue('2');        // where the colours began
  await expect(rep).toContainText('4 cells of 3 channels up to channel 13, the last 1 channel as "something else"');
  await rep.getByRole('button', { name: 'Use 4 cells' }).click();
  await expect(page.getByRole('button', { name: /Cells 1 to 4/ })).toContainText('Red, Green, Blue each, 12 channels');
  await expect(page.getByLabel('Channel 14 function')).toHaveValue('raw');
  await expect.poll(async () => (await channels(0, 34)).slice(19)).toEqual(Array(15).fill(0));   // wizard closed: overlay gone
});

test('cells taken out of the type: the recorded looks follow the LEDs that are left', async ({ page }) => {
  await openConnected(page);
  // a bar of 4 RGB cells then 4 white ones, made by hand: two runs of cells
  await page.evaluate(() => {
    const a = (window as any).__luxdmx;
    const rgb = [0, 1, 2, 3].flatMap((c) => [{ name: `R${c + 1}`, attr: 'red', cell: c }, { name: `G${c + 1}`, attr: 'green', cell: c }, { name: `B${c + 1}`, attr: 'blue', cell: c }]);
    const w = [4, 5, 6, 7].map((c) => ({ name: `W${c + 1}`, attr: 'white', cell: c }));
    a.saveType({ id: 'user:twin-bar', manufacturer: 'Test', model: 'Twin bar', source: 'user', modes: [{ name: '16 ch', channels: [...rgb, ...w] }] });
    a.show.fixtures.push({ id: 'tb', name: 'Twin', typeId: 'user:twin-bar', mode: '16 ch', universe: 0, address: 1, x: 0.5, y: 0.3 });
    a.checkpoint();
    // a look: white cell 6 only, recorded
    a.selected = ['tb']; a.selectCells([5]); a.set({ intensity: 1, white: 1 });
  });
  await expect.poll(async () => (await channels(0, 16)).slice(12, 16)).toEqual([0, 255, 0, 0]);   // (on stage before it's recorded)
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.record(); a.clearProgrammer(); });
  await expect.poll(async () => (await channels(0, 16)).slice(12, 16)).toEqual([0, 255, 0, 0]);   // W5..W8: cell 6 on
  // take the RGB cells 1 to 4 out of the type: the white ones become cells 1 to 4
  await tab(page, 'Fixtures');
  await page.locator('.fl li[data-fixture="Twin"]').click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: 'Edit fixture type…' }).click();
  await page.getByRole('button', { name: 'Remove cells 1 to 4' }).click();
  await page.getByRole('button', { name: 'Save type' }).click();
  // the 4 channels left are W1..W4 now; the look is still on the same LED (now cell 2)
  const cue = await page.evaluate(() => { const a = (window as any).__luxdmx; return Object.keys(a.show.cueLists[0].cues[0].values.tb.cells); });
  expect(cue).toEqual(['1']);
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.go(a.show.cueLists[0].id); });
  await expect.poll(async () => (await channels(0, 4))).toEqual([0, 255, 0, 0]);
});
