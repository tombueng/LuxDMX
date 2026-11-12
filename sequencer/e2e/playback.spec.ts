// Several cue lists at once, masters, auto-advance, cue actions, undo, files.
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import { openConnected, channels, history, resetFake, patch, selectAll, selectFixtures, intensity, swatch, record, full, cues, jumpTo, release, newList, fixturesOnStage , test, expect } from './helpers';

const level = (page: Page, v: number) => page.locator('.deck').getByLabel('List level').fill(String(v));
const inspector = (page: Page) => page.locator('.insp');

test.beforeEach(async () => { await resetFake(); });

test('two lists: intensity highest wins, colour latest wins, release fades back', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 1, 0, 'PAR');
  await selectAll(page); await intensity(page, 0.4); await swatch(page, 'Red'); await record(page);
  await newList(page);
  await selectAll(page); await intensity(page, 0.8); await swatch(page, 'Blue'); await record(page);
  await expect.poll(() => channels(0, 4)).toEqual([204, 0, 0, 255]);

  // the second list is the current one: release it, the first one shows again
  await release(page);
  await expect.poll(() => channels(0, 4), { timeout: 4000 }).toEqual([102, 255, 0, 0]);
});

test('list level, grand master and blackout', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 1, 0, 'Dim');
  await selectAll(page); await intensity(page, 1); await record(page);
  await expect.poll(() => channels(0, 1)).toEqual([255]);
  await level(page, 0.5);
  await expect.poll(() => channels(0, 1)).toEqual([128]);
  await page.locator('.top .gm input').fill('0.5');
  await expect.poll(() => channels(0, 1)).toEqual([64]);
  await page.locator('.top').getByRole('button', { name: 'Blackout' }).click();
  await expect.poll(() => channels(0, 1)).toEqual([0]);
  await page.locator('.top').getByRole('button', { name: 'Blackout' }).click();
  await expect.poll(() => channels(0, 1)).toEqual([64]);
});

test('a looping chase steps on its own at the set times', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await selectFixtures(page, ['D 1']); await intensity(page, 1); await record(page);
  await selectFixtures(page, ['D 1']); await intensity(page, 0);
  await selectFixtures(page, ['D 2']); await intensity(page, 1); await record(page);
  // both cues at once: 0 s fade, next after 0.5 s; the list loops
  await cues(page).nth(0).click();
  await cues(page).nth(1).click({ modifiers: ['Shift'] });
  await expect(inspector(page)).toContainText('2 cues selected');
  await inspector(page).getByLabel('Fade', { exact: true }).fill('0');
  await inspector(page).getByLabel('Next cue').selectOption('wait');
  await inspector(page).getByLabel('Advance time').fill('0.5');
  await page.locator('.deck').getByRole('button', { name: 'Loop' }).click();
  const t0 = Date.now();
  await jumpTo(page, 0);
  await page.waitForTimeout(3200);
  const h = (await history(0, 1)).filter(([t]) => t >= t0);
  const rises = h.filter(([, v], i) => i > 0 && v === 255 && h[i - 1][1] === 0).map(([t]) => t);
  expect(rises.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < rises.length; i++) {
    expect(rises[i] - rises[i - 1]).toBeGreaterThan(850);   // one full loop = 2 x 0.5 s
    expect(rises[i] - rises[i - 1]).toBeLessThan(1200);
  }
});

test('a cue action starts another list', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await selectFixtures(page, ['D 1']); await intensity(page, 0.1); await record(page);       // "House"
  await newList(page);
  await selectFixtures(page, ['D 2']); await intensity(page, 1); await record(page);         // "Preshow"
  await release(page);
  await expect.poll(() => channels(0, 2), { timeout: 4000 }).toEqual([26, 0]);
  // back to the first list, give its cue a "start List 2" action, fire it
  await page.locator('.deck .tab').first().click();
  await cues(page).first().click();
  await inspector(page).getByRole('button', { name: 'action' }).click();
  await expect(inspector(page).getByLabel('Action', { exact: true })).toHaveValue('start');
  await jumpTo(page, 0);
  await expect.poll(() => channels(0, 2), { timeout: 4000 }).toEqual([26, 255]);
});

test('undo and redo the patch', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 3);
  await expect(fixturesOnStage(page)).toHaveCount(3);
  await selectAll(page);
  await page.waitForTimeout(500);
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect(fixturesOnStage(page)).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Undone: 3 lights added');   // says what it undid
  expect(await page.evaluate(() => (window as any).__luxdmx.selected.length)).toBe(0);   // no selection of lights that are gone
  await page.getByTitle('Redo (Ctrl+Shift+Z)').click();
  await expect(fixturesOnStage(page)).toHaveCount(3);
  await expect(page.getByRole('status')).toContainText('Redone: 3 lights added');
  // and with the keys
  await page.locator('body').press('Control+z');
  await expect(fixturesOnStage(page)).toHaveCount(0);
  await page.locator('body').press('Control+Shift+z');
  await expect(fixturesOnStage(page)).toHaveCount(3);
});

test('save as file and open it again, with the format header', async ({ page }, info) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 2, 0, 'PAR');
  await selectAll(page); await swatch(page, 'Green'); await full(page); await record(page);
  const shows = page.locator('.top .show');
  await shows.click();
  const dlg = page.getByRole('dialog', { name: 'Shows' });
  const [dl] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Save current as file' }).click()]);
  const file = info.outputPath('show.luxdmx.json');
  await dl.saveAs(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(json.format).toBe('luxdmx-show');
  expect(json.formatVersion).toBe('1.2.0');
  expect(json.requiredFeatures).toEqual([]);                    // (no cells in this show: an older reader may open it)
  expect(json.fixtures).toHaveLength(2);
  expect(json.cueLists[0].cues).toHaveLength(1);
  // the cue keeps the colour preset by reference
  expect(Object.values(json.cueLists[0].cues[0].values)[0]).toMatchObject({ color: { preset: 'pc-green' } });
  // add a field from "the future" and make sure it survives open + save
  json.fromTheFuture = { keep: 'me' };
  fs.writeFileSync(file, JSON.stringify(json));

  await dlg.getByRole('button', { name: 'New blank show' }).click();
  await expect(fixturesOnStage(page)).toHaveCount(0);
  await shows.click();
  await dlg.locator('input[type=file]').setInputFiles(file);
  await expect(fixturesOnStage(page)).toHaveCount(2);
  await jumpTo(page, 0);
  await expect.poll(() => channels(0, 4)).toEqual([255, 0, 255, 0]);
  await shows.click();
  const [dl2] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Save current as file' }).click()]);
  const again = JSON.parse(fs.readFileSync(await dl2.path(), 'utf8'));
  expect(again.fromTheFuture).toEqual({ keep: 'me' });
});

test('a cue\'s own times: the colour at once, the head takes 4 s to get there (More timing)', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover16', 1, 0, 'Head');                     // pan 1 (+fine), dimmer 6, R 8, B 10
  await page.evaluate(() => {
    const a = (window as any).__luxdmx, id = a.show.fixtures[0].id;
    const l = a.newList('Moves');
    l.cues.push({ id: 'm1', name: 'Left red', fade: 0, advance: { mode: 'manual' }, values: { [id]: { intensity: 1, pan: 0, color: { r: 1, g: 0, b: 0 } } } },
      { id: 'm2', name: 'Right blue', fade: 0, advance: { mode: 'manual' }, values: { [id]: { intensity: 1, pan: 1, color: { r: 0, g: 0, b: 1 } } } });
    a.checkpoint(); a.markDirty(0);
  });
  await cues(page).nth(1).click();
  await inspector(page).getByText('More timing').click();
  await inspector(page).getByLabel('Position time').fill('4');
  expect(await page.evaluate(() => (window as any).__luxdmx.show.cueLists.at(-1).cues[1].times)).toEqual({ position: 4 });
  await jumpTo(page, 0);
  await expect.poll(async () => { const c = await channels(0, 12); return [c[0], c[7], c[9]]; }).toEqual([0, 255, 0]);
  const t0 = Date.now();
  await jumpTo(page, 1);
  await expect.poll(async () => { const c = await channels(0, 12); return [c[7], c[9]]; }, { timeout: 1500 }).toEqual([0, 255]);   // blue at once
  await page.waitForTimeout(1600);
  const mid = (await history(0, 1)).filter(([t]) => t >= t0 + 1200 && t <= t0 + 1800).map(([, v]) => v);
  expect(mid.some((v) => v > 30 && v < 200)).toBe(true);              // the head on its way, a second in
  await expect.poll(async () => (await channels(0, 2))[0], { timeout: 6000 }).toBe(255);
});
