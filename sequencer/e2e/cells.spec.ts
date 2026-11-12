// Single cells (a pixel bar's, a ring's LEDs), picked in the programmer like a desk's sub-fixtures:
// the brightness and colour go to just them, Record keeps them, a later cue for the whole light
// takes them with it. Measured on the wire (the fake box).
import type { Page } from '@playwright/test';
import { channels, cues, full, go, openConnected, patch, record, resetFake, selectAll, swatch, tab, test, expect } from './helpers';
import fs from 'node:fs';

const picker = (page: Page) => page.locator('.prog #pg-cells');
// where cell k is on the page (the picker draws on a canvas)
async function cellXY(page: Page, k: number) {
  await picker(page).locator('.pic').scrollIntoViewIfNeeded();
  const c = picker(page).locator('canvas'), box = (await c.boundingBox())!;
  const p = await c.evaluate((el, k) => (el as any).cellXY(k), k);
  return { x: box.x + p.x, y: box.y + p.y };
}
const clickCell = async (page: Page, k: number) => { const p = await cellXY(page, k); await page.mouse.click(p.x, p.y); };
const pickBtn = (page: Page, name: string) => picker(page).getByRole('button', { name, exact: true });
// RGB triples from a universe
const px = (c: number[], k: number) => c.slice(3 * k, 3 * k + 3);
const lit = (c: number[], n: number) => Array.from({ length: n }, (_, k) => px(c, k).some((v) => v > 0));

test.beforeEach(async () => { await resetFake(); });

test('pick cells on a pixel bar: brightness and colour go to just them, Record keeps them', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-bar8', 1, 0, 'Bar');
  await selectAll(page);
  // the bar as a whole: blue
  await full(page);
  await swatch(page, 'Blue');
  await expect.poll(async () => px(await channels(0, 24), 5)).toEqual([0, 0, 255]);
  // cells 2 and 3: red (a click on one, a drag onto the next)
  await expect(picker(page).locator('canvas')).toHaveAttribute('data-cells', '8');
  await expect(picker(page)).toContainText('whole light, 8 cells');
  const a = await cellXY(page, 2), b = await cellXY(page, 3);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await expect(picker(page).getByLabel('Cells to pick')).toHaveValue('3-4');
  await expect(picker(page)).toContainText('2 of 8 picked');
  await expect(page.locator('.prog .head .chip.orange')).toHaveText('1 selected, 2 cells');
  await swatch(page, 'Red');
  await expect.poll(async () => [px(await channels(0, 24), 2), px(await channels(0, 24), 3), px(await channels(0, 24), 4)])
    .toEqual([[255, 0, 0], [255, 0, 0], [0, 0, 255]]);
  // Odd, then Off: cells 1, 3, 5, 7 dark, the others as they were
  await pickBtn(page, 'Odd').click();
  await expect(picker(page)).toContainText('4 of 8 picked');
  await page.locator('.prog .quick').getByRole('button', { name: 'Off' }).click();
  await expect.poll(async () => lit(await channels(0, 24), 8)).toEqual([false, true, false, true, false, true, false, true]);
  await record(page);
  await expect(cues(page)).toHaveCount(1);
  const stored = await page.evaluate(() => (window as any).__luxdmx.show.cueLists[0].cues[0].values);
  const bar = Object.values(stored)[0] as any;
  expect(bar.cells['2'].color).toEqual({ preset: expect.any(String) });
  expect(bar.cells['0'].intensity).toBe(0);
  // gone dark and played again: the same picture
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.engine.stop(a.show.cueLists[0].id); });
  await expect.poll(async () => lit(await channels(0, 24), 8).filter(Boolean).length).toBe(0);
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.engine.jumpTo(a.show.cueLists[0].id, 0, 0); });
  await expect.poll(async () => [px(await channels(0, 24), 2), px(await channels(0, 24), 1), px(await channels(0, 24), 3)])
    .toEqual([[0, 0, 0], [0, 0, 255], [255, 0, 0]]);
});

test('a ring\'s rim in one tap; the next cue for the whole light takes the cells with it', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-disc37', 1, 0, 'Disc');      // rings of 16, 12, 8, 1: the rim is LEDs 1 to 16
  await selectAll(page);
  await full(page);
  await swatch(page, 'Blue');
  await pickBtn(page, 'Rim').click();
  await expect(picker(page)).toContainText('16 of 37 picked');
  await swatch(page, 'Red');
  await expect.poll(async () => { const c = await channels(0, 111); return [px(c, 0), px(c, 15), px(c, 16), px(c, 36)]; })
    .toEqual([[255, 0, 0], [255, 0, 0], [0, 0, 255], [0, 0, 255]]);
  await record(page);
  // a second cue: the whole disc green
  await pickBtn(page, 'Whole light').click();
  await expect(picker(page)).toContainText('whole light, 37 cells');
  await swatch(page, 'Green');
  await record(page);
  await expect(cues(page)).toHaveCount(2);
  // from the top: cue 1 is the red rim, cue 2 all green
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.engine.jumpTo(a.show.cueLists[0].id, 0, 0); });
  await expect.poll(async () => { const c = await channels(0, 111); return [px(c, 3), px(c, 20)]; }).toEqual([[255, 0, 0], [0, 0, 255]]);
  await go(page);
  await expect.poll(async () => { const c = await channels(0, 111); return [px(c, 3), px(c, 20)]; }, { timeout: 8000 }).toEqual([[0, 255, 0], [0, 255, 0]]);
});

test('Highlight on picked cells lights just them, and a reload keeps the cue\'s cells', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-bar8', 1, 0, 'Bar');
  await selectAll(page);
  await full(page);
  await swatch(page, 'Blue');
  await clickCell(page, 6);
  await page.locator('.prog').getByRole('button', { name: 'Highlight' }).click();
  await expect.poll(async () => [px(await channels(0, 24), 6), px(await channels(0, 24), 5)]).toEqual([[255, 255, 255], [0, 0, 0]]);
  await page.locator('.prog').getByRole('button', { name: 'Highlight' }).click();
  await expect.poll(async () => px(await channels(0, 24), 5)).toEqual([0, 0, 255]);
  await swatch(page, 'Red');
  await record(page);
  await page.reload();
  await expect(page.locator('.deck .card')).toHaveCount(1);
  const cells = await page.evaluate(() => { const v = (window as any).__luxdmx.show.cueLists[0].cues[0].values; return (Object.values(v)[0] as any).cells; });
  expect(Object.keys(cells)).toEqual(['6']);
});

test('Space on the cell picture picks a cell (it isn\'t GO), arrows move the ring', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-bar8', 1, 0, 'Bar');
  await selectAll(page);
  await full(page);
  await record(page);
  await expect(cues(page)).toHaveCount(1);
  const before = await page.evaluate(() => { const a = (window as any).__luxdmx; return a.status[a.show.cueLists[0].id]?.index; });
  await picker(page).locator('.pic').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(picker(page)).toContainText('1 of 8 picked');
  expect(await page.evaluate(() => { const a = (window as any).__luxdmx; return a.status[a.show.cueLists[0].id]?.index; })).toBe(before);
});

test('Alt-click a pixel on the stage plan picks that cell (Alt-drag still moves the light freely)', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-disc37', 1, 0, 'Disc');
  await selectAll(page);
  await full(page);
  const px = (k: number) => page.locator(`.stage-wrap .fx circle.px[data-cell="${k}"]`);
  await px(0).click({ modifiers: ['Alt'] });
  await px(1).click({ modifiers: ['Alt'] });
  await expect(picker(page)).toContainText('2 of 37 picked');
  await expect(px(0)).toHaveClass(/picked/);
  await px(0).click({ modifiers: ['Alt'] });                    // again: let go of it
  await expect(picker(page)).toContainText('1 of 37 picked');
  await swatch(page, 'Red');
  await expect.poll(async () => { const c = await channels(0, 111); return [px3(c, 1), px3(c, 0)]; }).toEqual([[255, 0, 0], [255, 255, 255]]);
});
const px3 = (c: number[], k: number) => c.slice(3 * k, 3 * k + 3);

test('a big matrix: Zoom makes its cells bigger, the picture scrolls, a tap picks one', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-matrix32x8', 1, 0, 'Wall');
  await selectAll(page);
  await picker(page).locator('.pic').scrollIntoViewIfNeeded();
  const w0 = (await picker(page).locator('canvas').boundingBox())!.width;
  await picker(page).getByRole('button', { name: /^Zoom the cells/ }).click();
  await expect(picker(page).getByRole('button', { name: /^Zoom the cells/ })).toHaveText('Zoom 2×');
  expect((await picker(page).locator('canvas').boundingBox())!.width).toBeGreaterThan(w0 * 1.9);
  // a cell that's in view (the picture scrolls): one tap picks it
  const pic = (await picker(page).locator('.pic').boundingBox())!;
  let at: { x: number; y: number } | null = null;
  for (let k = 0; k < 256 && !at; k++) { const p = await cellXY(page, k); if (p.x > pic.x + 6 && p.x < pic.x + pic.width - 6 && p.y > pic.y + 6 && p.y < pic.y + pic.height - 6) at = p; }
  await page.mouse.click(at!.x, at!.y);
  await expect(picker(page)).toContainText('1 of 256 picked');
});

test('an effect on picked cells, a group of them, its flash just them; Take out; the saved file says it has cells', async ({ page }, info) => {
  await openConnected(page);
  await patch(page, 'gen-bar8', 1, 0, 'Bar');                          // cell k: channels 3k..3k+2
  await selectAll(page);
  await full(page); await swatch(page, 'Blue');
  await picker(page).getByLabel('Cells to pick').fill('1-2');
  await picker(page).getByLabel('Cells to pick').press('Enter');
  await expect(picker(page)).toContainText('2 of 8 picked');
  // a chase on just those two: the other six stay blue all along, the two change
  await page.evaluate(() => { (window as any).__luxdmx.addEffect('chase'); });
  // (samples over two seconds: the box's own history holds less than a second)
  const seen = { c1: new Set<number>(), c3: new Set<number>() };
  for (let k = 0; k < 20; k++) { const c = await channels(0, 12); seen.c1.add(c[2]); seen.c3.add(c[8]); await page.waitForTimeout(100); }
  expect(seen.c1.size).toBeGreaterThan(1);                              // cell 1's blue goes up and down
  expect([...seen.c3]).toEqual([255]);                                  // cell 3's blue stays
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.stopAllEffects(); });
  // a group made from the picks: selecting it picks them again
  await page.locator('.fl li[data-fixture="Bar"]').click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: 'Make a group from the selection' }).click();
  const ask = page.getByRole('dialog', { name: 'New group' });
  await ask.getByLabel('Name').fill('Ends'); await ask.getByLabel('Name').press('Enter');
  await tab(page, 'Groups');
  await expect(page.locator('li[data-group="Ends"]')).toContainText('2 cells each');
  await page.locator('.stage-wrap').getByRole('button', { name: 'Select none' }).click();
  await page.locator('li[data-group="Ends"] .nm').click();
  await expect(picker(page)).toContainText('2 of 8 picked');
  // its flash on the console lights just those cells (the bar at half)
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.programmer = { [a.show.fixtures[0].id]: { intensity: 0.5, color: { r: 0, g: 0, b: 1 } } }; });
  await page.getByRole('tab', { name: 'Console' }).click();
  await page.locator('.console').getByRole('radio', { name: 'Groups' }).click();
  const flash = page.locator('.console .strip', { hasText: 'Ends' }).getByRole('button', { name: /^Flash/ });
  await flash.hover(); await page.mouse.down();
  await expect.poll(async () => { const c = await channels(0, 24); return [c[2], c[5], c[8], c[23]]; }).toEqual([255, 255, 128, 128]);
  await page.mouse.up();
  await expect.poll(async () => (await channels(0, 24))[2]).toBe(128);
  // Take out: a drag across picked cells takes them out instead
  await page.getByRole('tab', { name: 'Program' }).click();
  await page.locator('li[data-group="Ends"] .nm').click();
  await picker(page).getByRole('button', { name: 'Take out' }).click();
  const a = await cellXY(page, 0), b = await cellXY(page, 1);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
  await expect(picker(page)).toContainText('whole light');
  // a cue with cells: the saved file says a reader must know cells
  await picker(page).getByLabel('Cells to pick').fill('3'); await picker(page).getByLabel('Cells to pick').press('Enter');
  await swatch(page, 'Red'); await record(page);
  await page.locator('.top .show').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog', { name: 'Shows' }).getByRole('button', { name: 'Save current as file' }).click()]);
  const file = info.outputPath('cells.luxdmx.json'); await dl.saveAs(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(json.requiredFeatures).toEqual(['cells']);
  expect(json.formatVersion).toBe('1.2.0');
});

test('cells with a dimmer of their own (a 4-lite blinder): a picked lamp alone at full', async ({ page }) => {
  await openConnected(page);
  await page.evaluate(() => {
    const a = (window as any).__luxdmx;
    a.saveType({ id: 'user:blinder4', manufacturer: 'Test', model: 'Blinder 4', source: 'user', modes: [{ name: '4 ch',
      channels: [0, 1, 2, 3].map((c) => ({ name: `Lamp ${c + 1}`, attr: 'intensity', cell: c })) }] });
    a.show.fixtures.push({ id: 'bl', name: 'Blinder', typeId: 'user:blinder4', mode: '4 ch', universe: 0, address: 1, x: 0.5, y: 0.2 });
    a.checkpoint();
  });
  await selectAll(page);
  await picker(page).getByLabel('Cells to pick').fill('3'); await picker(page).getByLabel('Cells to pick').press('Enter');
  await full(page);
  await expect.poll(() => channels(0, 4)).toEqual([0, 0, 255, 0]);
  await pickBtn(page, 'Whole light').click();
  await full(page);
  await expect.poll(() => channels(0, 4)).toEqual([255, 255, 255, 255]);
});

test('Blackout and the grand master reach cells set in the programmer (no cue): the pixels and a blinder\'s lamps', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-bar8', 1, 0, 'Bar');
  await page.evaluate(() => {
    const a = (window as any).__luxdmx;
    a.saveType({ id: 'user:blinder4', manufacturer: 'Test', model: 'Blinder 4', source: 'user', modes: [{ name: '4 ch',
      channels: [0, 1, 2, 3].map((c) => ({ name: `Lamp ${c + 1}`, attr: 'intensity', cell: c })) }] });
    a.show.fixtures.push({ id: 'bl', name: 'Blinder', typeId: 'user:blinder4', mode: '4 ch', universe: 0, address: 25, x: 0.5, y: 0.2 });
    a.checkpoint();
  });
  // (one at a time: the picker picks on lights shaped like the first, a bar's cell 3 isn't a lamp)
  const only = (id: string) => page.evaluate((id) => { const a = (window as any).__luxdmx; a.selected = [id]; }, id);
  const pick3 = async () => { await picker(page).getByLabel('Cells to pick').fill('3'); await picker(page).getByLabel('Cells to pick').press('Enter'); };
  await only(await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].id));
  await pick3(); await full(page); await swatch(page, 'Red');
  await only('bl');
  await pick3(); await full(page);
  // bar cell 3 red, blinder lamp 3 full, nothing else
  await expect.poll(async () => { const c = await channels(0, 28); return [px(c, 2), c.slice(24, 28)]; }).toEqual([[255, 0, 0], [0, 0, 255, 0]]);
  // the grand master at half: both at about half
  const gm = page.locator('.top input[aria-label="Grand master"]');
  await gm.fill('0.5');
  const half = (v: number) => Math.abs(v - 128) <= 1;
  await expect.poll(async () => { const c = await channels(0, 28); return half(c[6]) && half(c[26]) && c[7] === 0 && c[24] === 0; }).toBe(true);
  await gm.fill('1');
  // Blackout: every channel of both at 0, and back when it's let go
  const bo = page.locator('.top').getByRole('button', { name: 'Blackout' });
  await bo.click();
  await expect.poll(async () => (await channels(0, 28)).every((v) => v === 0)).toBe(true);
  await bo.click();
  await expect.poll(async () => { const c = await channels(0, 28); return [px(c, 2), c.slice(24, 28)]; }).toEqual([[255, 0, 0], [0, 0, 255, 0]]);
});
