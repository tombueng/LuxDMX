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
// (the search is in the Add dialog itself: a library tile picked is the one Add adds)
async function fromLibrary(page: Page, query: string, source: 'OFL' | 'QLC+', name: RegExp) {
  await openAdd(page);
  const dlg = addDialog(page);
  await dlg.getByLabel('Search fixtures').fill(query);
  await dlg.locator('.tcard.lib').filter({ has: page.locator('b', { hasText: name }) }).filter({ hasText: source }).first().click();
  // in both libraries: the tile opens the OFL one, the other is a click away
  const want = source === 'OFL' ? 'ofl' : 'qlc';
  await expect(dlg.locator('.side[data-source]')).toBeVisible();
  if (await dlg.locator('.side').getAttribute('data-source') !== want) await dlg.getByRole('button', { name: `Use the ${source} definition instead` }).click();
  await expect(dlg.locator(`.side[data-source="${want}"]`)).toBeVisible();
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
  // its rotating gobo wheel came in as Gobo 2 (with its rotation), the prism's rotation and the
  // effect speed as sliders: each moves its own channel
  const prog = page.locator('.prog');
  await expect(prog.getByRole('region', { name: 'Gobo 2', exact: true })).toBeVisible();
  await prog.getByLabel('Gobo 2 rotation', { exact: true }).fill('1');
  await prog.getByLabel('Prism rotation', { exact: true }).fill('1');
  await prog.getByLabel('Effect speed', { exact: true }).fill('0.5');
  // (the two rotations within the rotating ranges of their channels; the speed at half)
  await expect.poll(async () => { const c = await channels(0, 32); return [c[17] > 0, c[20] > 0, c[13]]; }).toEqual([true, true, 128]);
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

test('a broken fixture file says so in plain words, and the note goes once a good one comes in', async ({ page }) => {
  await openConnected(page);
  await openAdd(page);
  const file = addDialog(page).locator('input[type=file]');
  await file.setInputFiles({ name: 'broken.qxf', mimeType: 'application/xml', buffer: Buffer.from('<FixtureDefinition><Model>x</Model><Mode Name="a"></FixtureDefinition>') });
  const note = addDialog(page).locator('p.err');
  await expect(note).toHaveText(/^broken\.qxf: not valid XML.*the file is damaged, or isn't a fixture file$/);
  await expect(note).not.toContainText('error on line');                 // (not the browser parser's own text)
  await file.setInputFiles('test/fixtures/qxf/Stairville-LED-PAR-36-COB-RGBW-12W.qxf');
  await expect(addDialog(page).getByRole('button', { name: /^Add \d+ × .*PAR 36/ })).toBeVisible();
  await expect(note).toHaveCount(0);
});

test('the fixture editor\'s Save notes go away as soon as what they say is put right', async ({ page }) => {
  await openConnected(page);
  await openAdd(page);
  await addDialog(page).getByRole('button', { name: 'Make my own…' }).click();
  const ed = page.getByRole('dialog', { name: 'New fixture type' });
  const note = ed.locator('.err');
  await ed.getByLabel('Model').fill('');
  await ed.getByRole('button', { name: 'Save type' }).click();
  await expect(note).toHaveText('Give it a name.');
  await ed.getByLabel('Model').fill('Cheap PAR');
  await expect(note).toHaveCount(0);
  await ed.getByRole('button', { name: 'Save type' }).click();
  await expect(note).toHaveText('Every mode needs at least one channel.');
  await ed.getByRole('button', { name: '+ Channel' }).click();
  await expect(note).toHaveCount(0);
  // (every field of the row has a name a screen reader can say)
  await expect(ed.getByRole('checkbox', { name: 'Channel 1 is the fine one' })).toBeVisible();
  await expect(ed.getByRole('spinbutton', { name: 'Channel 1 default' })).toBeVisible();
});

test('a GDTF matrix panel comes in laid out as a grid: Top picks its top row', async ({ page }) => {
  const { zipSync, strToU8 } = await import('fflate');
  // 4 x 2 pixels, red only, numbered along the rows from the top left
  const at = [...Array(8).keys()].map((i) => [(i % 4) * 0.1 - 0.15, i < 4 ? 0.05 : -0.05]);
  const geo = at.map(([x, z], i) => `<Geometry Name="Px${i + 1}" Position="{1,0,0,${x}}{0,1,0,0}{0,0,1,${z}}{0,0,0,1}"/>`).join('');
  const chs = at.map((_, i) => `<DMXChannel DMXBreak="1" Offset="${i + 1}" Geometry="Px${i + 1}"><LogicalChannel Attribute="ColorAdd_R"><ChannelFunction Attribute="ColorAdd_R" DMXFrom="0/1"/></LogicalChannel></DMXChannel>`).join('');
  const xml = `<?xml version="1.0"?><GDTF DataVersion="1.1"><FixtureType Name="Panel 8" LongName="Panel 8" Manufacturer="LuxTest">
    <Geometries><Geometry Name="Body" Position="{1,0,0,0}{0,1,0,0}{0,0,1,1}{0,0,0,1}">${geo}</Geometry></Geometries>
    <DMXModes><DMXMode Name="8ch" Geometry="Body"><DMXChannels>${chs}</DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`;
  await openConnected(page);
  await openAdd(page);
  await addDialog(page).locator('input[type=file]').setInputFiles({ name: 'LuxTest@Panel8.gdtf', mimeType: 'application/octet-stream', buffer: Buffer.from(zipSync({ 'description.xml': strToU8(xml) })) });
  await patchSelected(page, 1);
  await selectAll(page);
  const cells = page.locator('.prog #pg-cells');
  await cells.scrollIntoViewIfNeeded();
  await cells.getByRole('button', { name: 'Top', exact: true }).click();
  await expect(cells).toContainText('4 of 8 picked');
  await swatch(page, 'Red');
  await expect.poll(() => channels(0, 8)).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
});

test('an Open Fixture Library matrix panel file comes in laid out as a grid too', async ({ page }) => {
  const ofl = { name: 'Panel 4x2', categories: ['Matrix'], matrix: { pixelCount: [4, 2, 1] },
    templateChannels: { 'Red $pixelKey': { capability: { type: 'ColorIntensity', color: 'Red' } } },
    modes: [{ name: '8ch', channels: [{ insert: 'matrixChannels', repeatFor: 'eachPixel', channelOrder: 'perPixel', templateChannels: ['Red $pixelKey'] }] }] };
  await openConnected(page);
  await openAdd(page);
  await addDialog(page).locator('input[type=file]').setInputFiles({ name: 'panel-4x2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(ofl)) });
  await patchSelected(page, 1);
  await selectAll(page);
  const cells = page.locator('.prog #pg-cells');
  await cells.scrollIntoViewIfNeeded();
  await cells.getByRole('button', { name: 'Top', exact: true }).click();
  await expect(cells).toContainText('4 of 8 picked');
  await swatch(page, 'Red');
  await expect.poll(() => channels(0, 8)).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
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
  const dlg = addDialog(page), box = dlg.getByLabel('Search fixtures');
  await expect(box).toBeFocused();                                         // (the dialog starts in its search box)
  await box.fill('robin 600e spot');
  await box.press('Enter');                                                // takes the first one found
  const mode = dlg.getByLabel('Mode', { exact: true });
  await expect(mode).toBeVisible();
  await mode.selectOption((await mode.locator('option', { hasText: '32-channel' }).first().getAttribute('value'))!);
  await expect(dlg.locator('.chs li')).toHaveCount(32);
  await expect(dlg.locator('.chs')).toContainText('Pan');
  await box.press('Enter');                                                // again: on to How many, in that mode
  await expect(dlg.getByLabel('How many')).toBeFocused();
  await expect(mode).toHaveValue(/32-channel/);
});

test('the library search finds the built-in generic types too ("generic moving head")', async ({ page }) => {
  await openConnected(page);
  await page.locator('.side .tabs').getByRole('tab', { name: 'Fixtures' }).click();
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Add fixtures' });
  await dlg.getByLabel('Search fixtures').fill('generic moving head');
  await dlg.locator('.builtin [data-type="gen-mover8"]').click();
  await expect(dlg.locator('[data-type="gen-mover8"]')).toHaveClass(/\bcur\b/);
  await expect(dlg.getByRole('button', { name: /^Add 2 × Head/ })).toBeVisible();
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

test('one dialog: the search is live as you type over the built-in types and the libraries, each tile plays its light, a pick shows big beside it', async ({ page }) => {
  await openConnected(page);
  await openAdd(page);
  const dlg = addDialog(page), box = dlg.getByLabel('Search fixtures');
  // how much light there is in a tile's picture, and a fingerprint of it
  const look = (l: ReturnType<Page['locator']>) => l.locator('canvas').first().evaluate((c: HTMLCanvasElement) => {
    const x = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let lit = 0, sum = 0;
    for (let i = 0; i < x.length; i += 4) { const v = x[i] + x[i + 1] + x[i + 2]; if (v > 150) lit++; sum = (sum * 31 + v) % 1e9; }
    return { lit, sum };
  });
  // a gobo spot plays: light in its picture, and the picture changes (it moves)
  const spot = dlg.locator('[data-type="gen-spotgobo"]');
  await spot.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await look(spot)).lit, { timeout: 30000 }).toBeGreaterThan(15);
  const a = await look(spot);
  await expect.poll(async () => (await look(spot)).sum, { timeout: 10000 }).not.toBe(a.sum);
  // live as you type, in this dialog (no second one)
  await box.pressSequentially('robin 600e', { delay: 40 });
  await expect(dlg.locator('.tcard.lib').first()).toContainText('Robin 600E');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  // a library tile plays a built-in one of its kind until its own has come down; picked, its own
  const tile = dlg.locator('.tcard.lib').filter({ hasText: 'Robin 600E Spot' }).first();
  await expect(tile).toContainText('like this');
  await tile.click();
  await expect(dlg.locator('.side h2')).toContainText('Robin 600E Spot');
  await expect(tile).not.toContainText('like this');
  await expect(tile).toContainText('gobos');                               // (what it can do, from its channels)
  await expect.poll(async () => (await look(dlg.locator('.bigpv'))).lit, { timeout: 30000 }).toBeGreaterThan(15);
  await expect(dlg.locator('.side .chs li').first()).toBeVisible();
  // Add puts it in
  await dlg.getByLabel('How many').fill('1');
  await dlg.getByRole('button', { name: /^Add 1 × / }).click();
  await expect(dlg).toBeHidden();
  expect(await page.evaluate(() => (window as any).__luxdmx.show.fixtures.map((f: any) => f.typeId))).toEqual([expect.stringMatching(/robe/i)]);
});
