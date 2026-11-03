// Shows in the browser: templates, the show manager (open, rename, duplicate, delete), autosave
// across a reload.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, fixturesOnStage, cues, jumpTo, channels, fresh , test, expect } from './helpers';

const manager = (page: Page) => page.getByRole('dialog', { name: 'Shows' });
async function openManager(page: Page) {
  await page.locator('.top .show').click();
  await expect(manager(page)).toBeVisible();
}
const card = (page: Page, name: string) => manager(page).locator('.card').filter({ has: page.locator('.title', { hasText: new RegExp(`^${name}$`) }) });

test.beforeEach(async () => { await resetFake(); });

test('every template builds a working show', async ({ page }) => {
  await fresh(page);
  for (const name of ['Band', 'DJ / Party', 'Theatre', 'Church', 'Cinema', 'Bar']) {
    await openManager(page);
    await manager(page).locator('.tpl').filter({ has: page.locator('b', { hasText: new RegExp(`^${name.replace('/', '\\/')}$`) }) }).click();
    await expect(manager(page)).toBeHidden();
    expect(await fixturesOnStage(page).count()).toBeGreaterThan(3);
    expect(await cues(page).count()).toBeGreaterThan(3);
  }
  await openManager(page);
  // the first, empty show plus six templates
  await expect(manager(page).locator('.card')).toHaveCount(7);
});

// Every template on the box: a look goes out, the live page has a button for each effect machine
// (and Blinder, Drop, fog), and a tap on Confetti fires the cannons for a moment and lets go by
// itself. (The templates are single-universe rigs: universe 0 is everything.) The shot is read off
// the stage, what the 3D and 2D stages draw: pyro (confetti, flames, sparks, CO2) only reaches the
// wire once someone arms it, which isn't the templates' business.
test('every template plays on the box: its first look on the wire, a button per machine, a confetti shot that ends by itself', async ({ page }) => {
  test.setTimeout(150_000);
  await openConnected(page);
  for (const name of ['Band', 'DJ / Party', 'Theatre', 'Church', 'Cinema', 'Bar']) {
    await resetFake();
    await openManager(page);
    await manager(page).locator('.tpl').filter({ has: page.locator('b', { hasText: new RegExp(`^${name.replace('/', '\\/')}$`) }) }).click();
    await expect(manager(page)).toBeHidden();
    const rig = await page.evaluate(() => {
      const a = (window as any).__luxdmx, s = a.show;
      const has = (f: any, attr: string) => a.modeOf(f.id)?.channels.some((c: any) => c.attr === attr);
      const ids = (attr: string) => s.fixtures.filter((f: any) => has(f, attr)).map((f: any) => f.id);
      return { universes: [...new Set(s.fixtures.map((f: any) => f.universe))], n: s.fixtures.length, confetti: ids('confetti'),
        machines: ['confetti', 'co2', 'sparks', 'flame', 'bubbles'].filter((m) => ids(m).length).length };
    });
    expect(rig.universes, name).toEqual([0]);
    expect(rig.n, name).toBeGreaterThanOrEqual(25);
    await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
    await expect(page.locator('div.live')).toBeVisible();
    // the effect machines, each a button; fog or haze; Blinder and Drop unless it's a play
    const machines = page.locator('.live [data-widget^="sfx-"]');
    await expect(machines, name).toHaveCount(rig.machines);
    await expect(page.locator('.live [data-widget="fog"]'), name).toHaveCount(1);
    await expect(page.locator('.live [data-widget="blinder"], .live [data-widget="drop"]'), name).toHaveCount(name === 'Theatre' ? 0 : 2);
    // the first look (GO), on the wire
    await page.keyboard.press('Space');
    await expect.poll(async () => (await channels(0, 512)).some((v) => v > 0), { timeout: 6000, message: name }).toBe(true);
    // Confetti: a tap, the cannons fire (on the stage), and they're done a moment later with nobody
    // touching anything
    const conf = machines.filter({ hasText: 'Confetti' });
    const fired = () => page.evaluate((ids) => ids.map((id: string) => (window as any).__luxdmx.stage[id]?.confetti ?? 0), rig.confetti);
    await conf.scrollIntoViewIfNeeded();
    await conf.click();
    await expect.poll(fired, { timeout: 3000, message: name }).toEqual(rig.confetti.map(() => 1));
    await expect.poll(fired, { timeout: 3000, message: name }).toEqual(rig.confetti.map(() => 0));
    await expect(conf).not.toHaveClass(/\bon\b/);
    await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  }
});

test('a template plays on the box, survives a reload, and the manager can rename, duplicate and delete', async ({ page }) => {
  await openConnected(page);
  await openManager(page);
  await manager(page).locator('.tpl', { hasText: 'Theatre' }).click();
  await expect(page.locator('.top .show .name')).toHaveText('Play');
  // Theatre: 6 front dimmers at 1-6, preset cue at 30 %
  await page.locator('.deck .tab', { hasText: 'Show' }).click();
  await jumpTo(page, 0);
  await expect.poll(() => channels(0, 6), { timeout: 5000 }).toEqual([77, 77, 77, 77, 77, 77]);

  const lights = await page.evaluate(() => (window as any).__luxdmx.show.fixtures.length as number);
  await page.waitForTimeout(800);                     // autosave
  await page.reload();
  await expect(page.locator('.top .show .name')).toHaveText('Play');
  await expect(fixturesOnStage(page)).toHaveCount(lights);

  await openManager(page);
  await expect(card(page, 'Play')).toHaveClass(/cur/);
  await card(page, 'Play').getByRole('button', { name: 'Duplicate Play' }).click();
  await expect(card(page, 'Play \\(copy\\)')).toHaveCount(1);
  await card(page, 'Play \\(copy\\)').getByRole('button', { name: 'Rename Play (copy)' }).click();
  await manager(page).getByLabel('Show name').fill('Matinee');
  await manager(page).getByLabel('Show name').press('Enter');
  await expect(card(page, 'Matinee')).toHaveCount(1);
  // open the copy: it's a separate show
  await card(page, 'Matinee').locator('.pic').click();
  await expect(page.locator('.top .show .name')).toHaveText('Matinee');
  await expect(fixturesOnStage(page)).toHaveCount(lights);
  await openManager(page);
  await card(page, 'Play').getByRole('button', { name: 'Delete Play' }).click();
  await page.getByRole('dialog', { name: 'Delete "Play"?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(card(page, 'Play')).toHaveCount(0);
  await expect(card(page, 'Matinee')).toHaveCount(1);
});

test('renaming the open show from the manager renames it in the top bar', async ({ page }) => {
  await fresh(page);
  await openManager(page);
  await manager(page).locator('.card').first().getByRole('button', { name: /^Rename/ }).click();
  await manager(page).getByLabel('Show name').fill('Garage gig');
  await manager(page).getByLabel('Show name').press('Enter');
  await expect(page.locator('.top .show .name')).toHaveText('Garage gig');
});
