// Phase 2: fixtures from the libraries, from files, made by hand and found with the wizard; the
// all-channels view; re-patching. Library downloads are served from test/fixtures (same files the
// pinned commits hold), so this runs offline; values are read back from the fake LuxDMX.
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import { openConnected, channels, resetFake, selectAll, swatch, record, full, jumpTo, release, fixturesOnStage, tab, patch, test, expect } from './helpers';

async function offlineLibraries(page: Page) {
  await page.route('https://cdn.jsdelivr.net/gh/OpenLightingProject/**', (r) => {
    const key = decodeURIComponent(new URL(r.request().url()).pathname.split('/fixtures/')[1]).replace('.json', '');
    const f = `test/fixtures/ofl/${key.replace('/', '__')}.json`;
    return fs.existsSync(f) ? r.fulfill({ path: f, contentType: 'application/json' }) : r.fulfill({ status: 404 });
  });
  await page.route('https://raw.githubusercontent.com/mcallegari/qlcplus/**', (r) => {
    const f = `test/fixtures/qxf/${decodeURIComponent(r.request().url().split('/').pop()!)}`;
    return fs.existsSync(f) ? r.fulfill({ path: f, contentType: 'text/xml' }) : r.fulfill({ status: 404 });
  });
}
const addDialog = (page: Page) => page.getByRole('dialog', { name: 'Add fixtures' });
async function openAdd(page: Page) {
  await tab(page, 'Fixtures');
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(addDialog(page)).toBeVisible();
}
async function fromLibrary(page: Page, query: string, source: 'OFL' | 'QLC+', name: RegExp) {
  await openAdd(page);
  await addDialog(page).getByRole('button', { name: /Search .* fixtures/ }).click();
  await page.getByLabel('Search fixtures').fill(query);
  await page.locator('.results li[role=option]').filter({ has: page.locator('b', { hasText: name }) }).filter({ hasText: source }).first().click();
  // in both libraries: the row opens the OFL one, the other is a click away
  const want = source === 'OFL' ? 'ofl' : 'qlc';
  await expect(page.locator('.detail[data-source]')).toBeVisible();
  if (await page.locator('.detail').getAttribute('data-source') !== want) await page.getByRole('button', { name: `Use the ${source} definition instead` }).click();
  await expect(page.locator(`.detail[data-source="${want}"] .modes`)).toBeVisible();
  await page.getByRole('button', { name: 'Use this fixture' }).click();
}
async function patchSelected(page: Page, count: number, universe = 0, mode?: string) {
  const dlg = addDialog(page);
  if (mode) await dlg.getByLabel('Mode', { exact: true }).selectOption({ label: mode });
  await dlg.getByLabel('How many').fill(String(count));
  await dlg.getByLabel('Universe').fill(String(universe));
  await dlg.getByRole('button', { name: /^Add \d+ × / }).click();
  await expect(dlg).toBeHidden();
}

test.beforeEach(async ({ page }) => { await resetFake(); await offlineLibraries(page); });

test('a pro spot from the Open Fixture Library: CMY red, shutter open, 16-bit dimmer', async ({ page }) => {
  await openConnected(page);
  await fromLibrary(page, 'robin 600e spot', 'OFL', /Robin 600E Spot/);
  await patchSelected(page, 1, 0, '32-channel (32 ch)');
  await expect(fixturesOnStage(page)).toHaveCount(1);
  await selectAll(page);
  await full(page);
  await swatch(page, 'Red');
  await expect.poll(async () => (await channels(0, 32)).slice(8, 11)).toEqual([0, 255, 255]);   // cyan, magenta, yellow
  const ch = await channels(0, 32);
  expect([ch[30], ch[31]]).toEqual([255, 255]);                 // dimmer + fine
  expect(ch[29]).toBeGreaterThanOrEqual(32);                    // shutter in an open range, not closed (0..31)
});

test('a moving head from the QLC+ library: red comes from the colour wheel', async ({ page }) => {
  await openConnected(page);
  await fromLibrary(page, 'clay paky sharpy', 'QLC+', /^Sharpy$/);
  await patchSelected(page, 1);
  expect(await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].typeId)).toMatch(/^qlc:/);   // the QLC+ definition, not the OFL one
  await selectAll(page);
  await full(page);
  await swatch(page, 'Red');
  await page.getByText('All channels').click();
  await expect(page.locator('.ch').first()).toBeVisible();
  // The colour wheel channel's range list shows the slot that's being sent
  const wheel = page.locator('.ch', { hasText: /colou?r/i }).first();
  await expect(wheel.locator('select option').first()).toHaveText(/red/i);
});

test('import a GDTF file and drive it', async ({ page }) => {
  await openConnected(page);
  await openAdd(page);
  await addDialog(page).locator('input[type=file]').setInputFiles('test/fixtures/gdtf/BlenderDMX@LED_PAR_64_RGBW@v0.3.gdtf');
  await patchSelected(page, 2);
  await selectAll(page);
  await full(page);
  await swatch(page, 'Green');
  await expect.poll(() => channels(0, 5)).toEqual([255, 0, 255, 0, 0]);   // dimmer, R, G, B, W
});

test('all channels: pick a gobo by name, it is recorded and comes back', async ({ page }) => {
  await openConnected(page);
  await fromLibrary(page, 'robin 600e spot', 'OFL', /Robin 600E Spot/);
  await patchSelected(page, 1, 0, '32-channel (32 ch)');
  await selectAll(page);
  await full(page);
  await page.getByText('All channels').click();
  const gobo = page.locator('.ch').nth(14);                      // DMX 15: Static Gobo Wheel
  await expect(gobo).toContainText('Static Gobo Wheel');
  const opt = gobo.locator('select option').nth(3);
  const text = (await opt.textContent())!;
  const [from, to] = text.match(/\((\d+)–(\d+)\)/)!.slice(1).map(Number);
  await gobo.locator('select').selectOption({ index: 3 });
  await expect.poll(async () => (await channels(0, 15))[14]).toBe(Math.round((from + to) / 2));
  await record(page);
  await release(page);
  await expect.poll(async () => (await channels(0, 31))[30], { timeout: 4000 }).toBe(0);
  await jumpTo(page, 0);
  await expect.poll(async () => (await channels(0, 15))[14]).toBe(Math.round((from + to) / 2));
});

test('make a fixture type by hand', async ({ page }) => {
  await openConnected(page);
  await openAdd(page);
  await addDialog(page).getByRole('button', { name: 'Make my own…' }).click();
  await page.getByLabel('Model').fill('Cheap PAR');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '+ Channel' }).click();
  await page.getByLabel('Channel 1 function').selectOption('intensity');
  await page.getByLabel('Channel 2 function').selectOption('red');
  await page.getByLabel('Channel 3 function').selectOption('strobe');
  await page.getByLabel('Mode name').fill('3 ch');
  await page.getByRole('button', { name: 'Save type' }).click();
  await patchSelected(page, 1);
  await selectAll(page);
  await full(page);
  await swatch(page, 'Red');
  await expect.poll(() => channels(0, 3)).toEqual([255, 255, 0]);
});

test('the channel wizard drives the real channels one by one', async ({ page }) => {
  await openConnected(page);
  await openAdd(page);
  await addDialog(page).getByRole('button', { name: 'Make my own…' }).click();
  await page.getByRole('button', { name: 'Find the channels on the fixture…' }).first().click();
  await page.locator('.modal input[type=number]').nth(1).fill('10');   // start address
  await page.locator('.modal input[type=number]').nth(2).fill('3');    // 3 channels
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect.poll(async () => (await channels(0, 12)).slice(9, 12)).toEqual([255, 0, 0]);     // channel 1 under test
  await page.getByRole('button', { name: 'Dimmer', exact: true }).click();
  await expect.poll(async () => (await channels(0, 12)).slice(9, 12)).toEqual([255, 255, 0]);   // dimmer stays up, channel 2 tested
  await page.getByLabel('Test value').fill('100');
  await expect.poll(async () => (await channels(0, 12))[10]).toBe(100);
  await page.getByRole('button', { name: 'Red', exact: true }).click();
  await page.getByRole('button', { name: 'Nothing happens' }).click();
  await expect(page.getByLabel('Channel 1 function')).toHaveValue('intensity');
  await expect(page.getByLabel('Channel 2 function')).toHaveValue('red');
  await expect(page.getByLabel('Channel 3 function')).toHaveValue('raw');
  await expect.poll(async () => (await channels(0, 12)).slice(9, 12)).toEqual([0, 0, 0]);       // wizard closed: overlay gone
});

test('re-patch a fixture, and overlapping addresses are flagged', async ({ page }) => {
  await openConnected(page);
  await openAdd(page);
  await addDialog(page).locator('[data-type="gen-drgb"]').click();
  await patchSelected(page, 2);
  await page.locator('.fl li[data-fixture="PAR 2"]').dblclick();
  const dlg = page.getByRole('dialog', { name: 'Patch: PAR 2' });
  await dlg.getByLabel('Fixture address').fill('3');
  await dlg.getByLabel('Fixture address').press('Tab');
  await expect(page.locator('li.clash')).toHaveCount(2);
  await expect(dlg.locator('.err')).toContainText('Shares channels with PAR 1');
  await dlg.getByLabel('Fixture address').fill('20');
  await dlg.getByLabel('Fixture address').press('Tab');
  await expect(page.locator('li.clash')).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Done' }).click();
  await selectAll(page);
  await full(page);
  await expect.poll(async () => (await channels(0, 20))[19]).toBe(255);
});

test('the library from the keyboard, with the channels of each mode to compare with the manual', async ({ page }) => {
  await openConnected(page);
  await openAdd(page);
  await addDialog(page).getByRole('button', { name: /Search .* fixtures/ }).click();
  const lib = page.getByRole('dialog', { name: 'Fixture library' });
  await lib.getByLabel('Search fixtures').fill('robin 600e spot');
  await lib.getByLabel('Search fixtures').press('Enter');                   // loads the first hit
  await expect(lib.getByRole('radiogroup', { name: 'Mode' })).toBeVisible();
  await lib.getByRole('radio', { name: /32-channel/ }).click();
  await expect(lib.locator('.chs li')).toHaveCount(32);
  await expect(lib.locator('.chs')).toContainText('Pan');
  await lib.getByLabel('Search fixtures').press('Enter');                   // uses it, in that mode
  await expect(addDialog(page).getByLabel('Mode', { exact: true })).toHaveValue(/32-channel/);
});

test('the library search finds the built-in generic types too ("generic moving head")', async ({ page }) => {
  await openConnected(page);
  await page.locator('.side .tabs').getByRole('tab', { name: 'Fixtures' }).click();
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Add fixtures' });
  await dlg.getByRole('button', { name: /Search 2400/ }).click();
  const lib = page.getByRole('dialog', { name: 'Fixture library' });
  await lib.getByLabel('Search fixtures').fill('generic moving head');
  await lib.locator('.builtin').getByRole('button', { name: 'Moving head, 8 ch' }).click();
  await expect(lib).toBeHidden();
  await expect(dlg.locator('[data-type="gen-mover8"]')).toHaveClass(/\bcur\b|\bsel\b|\bon\b/);
});

test('several lights patched in one go: a universe for all, addresses one after the other, names numbered (one undo)', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 6, 0, 'Px');
  await page.locator('.side .tabs').getByRole('tab', { name: 'Fixtures' }).click();
  await page.locator('.fl li.oitem').first().click();
  await page.locator('.fl .olist').press('Control+a');
  await page.locator('.fl .olist').press('Enter');
  const dlg = page.getByRole('dialog', { name: 'Patch 6 lights' });
  await dlg.getByLabel('Universe for all').fill('1');
  await dlg.getByLabel('Start address').fill('10');
  await dlg.getByLabel('Names').fill('Strip');
  await expect(dlg.getByRole('status').first()).toContainText('10 to 27');
  await dlg.getByRole('button', { name: 'Patch them' }).click();
  const fx = () => page.evaluate(() => (window as any).__luxdmx.show.fixtures.map((f: any) => [f.name, f.universe, f.address]));
  expect(await fx()).toEqual([['Strip 1', 1, 10], ['Strip 2', 1, 13], ['Strip 3', 1, 16], ['Strip 4', 1, 19], ['Strip 5', 1, 22], ['Strip 6', 1, 25]]);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await fx())[5]).toEqual(['Px 6', 0, 16]);
});

test('exact values: the number next to a slider takes a typed value (intensity in %, a channel 0-255)', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 1, 0, 'P');
  await selectAll(page);
  await page.locator('.prog').getByRole('button', { name: /^Intensity: .*type a value/ }).click();
  await page.keyboard.type('37'); await page.keyboard.press('Enter');
  await expect.poll(() => channels(0, 1)).toEqual([94]);
  await page.getByText('All channels').click();
  await page.locator('.prog').getByRole('button', { name: /^Red value: .*type a value/ }).click();
  await page.keyboard.type('127'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await channels(0, 2))[1]).toBe(127);
});
