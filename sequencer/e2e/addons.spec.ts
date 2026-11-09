// Add-ons: the effect library loads our repository (public/addons/: ten themes, fifty effects), a
// fire one runs on a disc and reaches the wire; its editor shows only the knobs that change it;
// one with knobs of its own (Trefoil: its colour) changes on the wire; an effect shared as a file
// comes back in through Import and runs the same; a file that isn't one is refused and said.
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { openConnected, patch, channels, pixelPorts, resetFake, selectAll, tab, test, expect, FAKE } from './helpers';

test.beforeEach(async () => { await resetFake(); });
const lib = (page: Page) => page.getByRole('dialog', { name: 'Add an effect' });
async function openLibrary(page: Page) {
  await tab(page, 'Effects');
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(lib(page)).toBeVisible();
}
const pixelsLit = (c: number[]) => { let n = 0; for (let i = 0; i + 2 < c.length; i += 3) if (c[i] || c[i + 1] || c[i + 2]) n++; return n; };

test('the add-ons by theme; a fire one runs on a disc, with only its own knobs', async ({ page }) => {
  await pixelPorts([[10, 2]]);
  await openConnected(page);
  await patch(page, 'gen-disc241', 1, 10, 'Disc');
  await selectAll(page);
  await openLibrary(page);
  const themes = lib(page).getByRole('radiogroup', { name: 'Theme' }).getByRole('radio');
  await expect(themes).toHaveCount(11);
  await expect(lib(page).locator('[data-addon]')).toHaveCount(50);
  await lib(page).getByRole('radio', { name: 'Fire' }).click();
  await expect(lib(page).locator('[data-addon]')).toHaveCount(5);
  await lib(page).locator('[data-addon="luxdmx.embers"]').click();
  await expect(lib(page)).toBeHidden();
  const fx = await page.evaluate(() => JSON.parse(JSON.stringify((window as any).__luxdmx.show.effects[0])));
  expect(fx.kind).toBe('script');
  expect(fx.name).toBe('Embers on Disc');
  // on the wire: the disc glows, over both universes
  await expect.poll(async () => pixelsLit(await channels(10, 510)), { timeout: 8000 }).toBeGreaterThan(60);
  // its knobs: speed, contrast, mirrored; no size, no palette (it brings its own colours)
  await page.locator('.ep li.oitem').first().click();
  const ed = page.locator('.ed');
  await expect(ed.getByLabel('Effect kind')).toHaveValue('script');
  await expect(ed.getByLabel(/^(Seconds|Beats) per cycle$/)).toBeVisible();
  await expect(ed.getByLabel('Contrast', { exact: true })).toBeVisible();
  await expect(ed.getByRole('radiogroup', { name: 'Direction' }).getByRole('radio')).toHaveCount(2);
  await expect(ed.getByLabel('Size', { exact: true })).toHaveCount(0);
  await expect(ed.getByLabel('Colour 1', { exact: true })).toHaveCount(0);
});

test('an add-on\'s own knob (Trefoil\'s colour) changes it on the wire', async ({ page }) => {
  await pixelPorts([[10, 2]]);
  await openConnected(page);
  await patch(page, 'gen-disc241', 1, 10, 'Disc');
  await selectAll(page);
  await openLibrary(page);
  await lib(page).locator('[data-addon="luxdmx.trefoil"]').click();
  await page.locator('.ep li.oitem').first().click();
  const ed = page.locator('.ed');
  await expect(ed.getByLabel('Turning')).toBeVisible();
  // yellow: red and green on, blue off
  const blue = async () => { const c = await channels(10, 510); let b = 0, y = 0; for (let i = 0; i + 2 < c.length; i += 3) { if (c[i + 2] > 60 && c[i] < 10) b++; if (c[i] > 60 && c[i + 2] < 10) y++; } return { b, y }; };
  await expect.poll(async () => (await blue()).y, { timeout: 8000 }).toBeGreaterThan(40);
  await ed.getByLabel('Colour', { exact: true }).fill('#0000ff');
  await expect.poll(async () => (await blue()).b, { timeout: 8000 }).toBeGreaterThan(40);
  expect((await blue()).y).toBe(0);
});

test('shared as a file, imported again, it runs the same; a file that isn\'t one is refused', async ({ page }, info) => {
  await pixelPorts([[10, 2]]);
  await openConnected(page);
  await patch(page, 'gen-disc241', 1, 10, 'Disc');
  await selectAll(page);
  await openLibrary(page);
  await lib(page).locator('[data-addon="luxdmx.fireflies"]').click();
  await page.locator('.ep li.oitem').first().click();
  const ed = page.locator('.ed');
  await ed.getByLabel('Colour', { exact: true }).fill('#ff00ff');
  await ed.getByRole('button', { name: 'More' }).click();
  await ed.getByRole('button', { name: 'Share as a file…' }).click();
  await ed.getByRole('button', { name: 'Download the file' }).click();
  await expect(ed.getByText('Say who made it')).toBeVisible();
  await ed.getByLabel('Your name').fill('Test Person');
  await ed.getByLabel('What it is').fill('Pink fireflies');
  const [dl] = await Promise.all([page.waitForEvent('download'), ed.getByRole('button', { name: 'Download the file' }).click()]);
  expect(dl.suggestedFilename()).toBe('test-person.fireflies-on-disc.luxfx');
  const file = info.outputPath('shared.luxfx');
  await dl.saveAs(file);
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(pkg).toMatchObject({ format: 'luxdmx-effect', author: { name: 'Test Person' }, description: 'Pink fireflies', license: 'CC-BY-4.0', code: { lang: 'luxfx-1' } });
  expect(pkg.params[0]).toMatchObject({ id: 'glow', default: '#ff00ff' });
  expect(pkg.preview).toMatch(/^pic1:32x32:/);
  // in again through Import: it's under Imported, and picked it runs pink
  await openLibrary(page);
  await lib(page).locator('input[type=file][accept*=".luxfx"]').setInputFiles(file);
  await expect(lib(page).locator('.mine [data-addon="test-person.fireflies-on-disc"]')).toBeVisible();
  await lib(page).locator('.mine [data-addon="test-person.fireflies-on-disc"]').click();
  const effects = await page.evaluate(() => JSON.parse(JSON.stringify((window as any).__luxdmx.show.effects)));
  expect(effects.length).toBe(2);
  expect(effects[1].params.vals).toEqual({ glow: '#ff00ff' });
  // kept after a reload of the library
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('luxdmx.seq.addons.imported') ?? '[]').length)).toBe(1);
  // a file that isn't one
  const junk = info.outputPath('junk.luxfx');
  fs.writeFileSync(junk, JSON.stringify({ format: 'luxdmx-effect', formatVersion: 1, id: 'x.y', name: 'Bad', author: { name: 'X' }, code: { lang: 'luxfx-1', pixel: 'document.cookie' } }));
  await openLibrary(page);
  await lib(page).locator('input[type=file][accept*=".luxfx"]').setInputFiles(junk);
  await expect(page.locator('.toast').filter({ hasText: "That file can't be used" })).toContainText("Its code doesn't read");
});

test('another source, in the submenu: a warning, a tick that you trust it, its effects under its own name; gone again', async ({ page }) => {
  await pixelPorts([[10, 2]]);
  await openConnected(page);
  await patch(page, 'gen-disc241', 1, 10, 'Disc');
  await selectAll(page);
  await openLibrary(page);
  // not up front: behind More sources
  await expect(lib(page).getByRole('heading', { name: 'Add-on sources' })).toHaveCount(0);
  await lib(page).getByRole('button', { name: 'More sources…' }).click();
  const src = lib(page).locator('section.src');
  await expect(src).toContainText('Only add sources you trust');
  const address = src.getByLabel('Address of another source'), add = src.getByRole('button', { name: 'Add it' });
  // an address that can't be one, and one that isn't a repository
  await address.fill('ftp://example.org/x/');
  await src.getByLabel('I trust this source').check();
  await add.click();
  await expect(src.locator('.err')).toContainText("isn't an address a source can have");
  await address.fill(`http://${FAKE}/nothing-here/`);
  await add.click();
  await expect(src.locator('.err')).toContainText("index.json can't be reached");
  await address.fill(`http://${FAKE}/repo/not-a-repo/`);
  await add.click();
  await expect(src.locator('.err')).toContainText("isn't a LuxDMX add-on repository");
  // a real one: added only with the tick
  await src.getByLabel('I trust this source').uncheck();
  await address.fill(`http://${FAKE}/repo/`);
  await expect(add).toBeDisabled();
  await src.getByLabel('I trust this source').check();
  await add.click();
  await expect(src.getByRole('list', { name: 'Sources' }).locator('li')).toHaveCount(2);
  await expect(src).toContainText("A tester's effects");
  await expect(src).toContainText('1 effect');
  await expect(lib(page).getByRole('heading', { name: /From A tester's effects/ })).toBeVisible();
  // it brings no picture of its own: its code runs only once you point at it
  const card = lib(page).locator('[data-addon="tester.green-pulse"]');
  await expect(card.locator('.nopic')).toBeVisible();
  await expect(card.locator('canvas')).toHaveCount(0);
  await card.hover();
  await expect(card.locator('canvas')).toHaveCount(1);
  // its effect runs like ours: green on the wire
  await lib(page).locator('[data-addon="tester.green-pulse"]').click();
  const greens = async () => { const c = await channels(10, 510); let n = 0; for (let i = 0; i + 2 < c.length; i += 3) if (c[i + 1] > 40 && c[i] === 0) n++; return n; };
  await expect.poll(greens, { timeout: 8000 }).toBeGreaterThan(20);
  // kept in this browser; removed, gone
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('luxdmx.seq.addons.sources') ?? '[]'))).toEqual([`http://${FAKE}/repo/`]);
  await openLibrary(page);
  await expect(lib(page).getByRole('heading', { name: /From A tester's effects/ })).toBeVisible();
  await lib(page).getByRole('button', { name: 'More sources…' }).click();
  await lib(page).getByRole('button', { name: "Remove A tester's effects" }).click();
  await expect(lib(page).getByRole('heading', { name: /From A tester's effects/ })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('luxdmx.seq.addons.sources'))).toBe('[]');
});
