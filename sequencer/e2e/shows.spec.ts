// Shows in the browser: templates, the show manager (open, rename, duplicate, delete), autosave
// across a reload.
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openConnected, resetFake, fixturesOnStage, cues, jumpTo, channels, fresh , test, expect, startTemplate, newBlankShow } from './helpers';

const manager = (page: Page) => page.getByRole('dialog', { name: 'Shows' });
async function openManager(page: Page) {
  await page.locator('.top .show').click();
  await expect(manager(page)).toBeVisible();
}
const card = (page: Page, name: string) => manager(page).locator('.card').filter({ has: page.locator('.title', { hasText: new RegExp(`^${name}$`) }) });

test.beforeEach(async () => { await resetFake(); });

test('every template builds a working show', async ({ page }) => {
  await fresh(page);
  for (const name of ['Band', 'DJ / Party', 'Theatre', 'Church', 'Cinema', 'Bar', 'Wedding']) {
    await openManager(page);
    await startTemplate(page, name);
    await expect(manager(page)).toBeHidden();
    expect(await fixturesOnStage(page).count()).toBeGreaterThan(3);
    expect(await cues(page).count()).toBeGreaterThan(3);
  }
  await openManager(page);
  // the seven templates (the first, empty show went when the first template opened)
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
  for (const name of ['Band', 'DJ / Party', 'Theatre', 'Church', 'Cinema', 'Bar', 'Wedding']) {
    await resetFake();
    await openManager(page);
    await startTemplate(page, name);
    await expect(manager(page)).toBeHidden();
    const rig = await page.evaluate(() => {
      const a = (window as any).__luxdmx, s = a.show;
      const has = (f: any, attr: string) => a.modeOf(f.id)?.channels.some((c: any) => c.attr === attr);
      const ids = (attr: string) => s.fixtures.filter((f: any) => has(f, attr)).map((f: any) => f.id);
      return { universes: [...new Set(s.fixtures.map((f: any) => f.universe))], n: s.fixtures.length, confetti: ids('confetti'),
        machines: ['confetti', 'co2', 'sparks', 'flame', 'bubbles'].filter((m) => ids(m).length).length };
    });
    // (the big ones spread over more universes, the first is 0)
    expect(rig.universes, name).toContain(0);
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
  await startTemplate(page, 'Theatre');
  await expect(page.locator('.top .show .name')).toHaveText('Opening night');
  // Theatre: 6 front dimmers at 1-6, the preset cue at 18 % (30 % of a front light kept soft, x0.6)
  await page.locator('.deck .tab', { hasText: 'Show' }).click();
  await jumpTo(page, 0);
  await expect.poll(() => channels(0, 6), { timeout: 5000 }).toEqual([46, 46, 46, 46, 46, 46]);

  const lights = await page.evaluate(() => (window as any).__luxdmx.show.fixtures.length as number);
  await page.waitForTimeout(800);                     // autosave
  await page.reload();
  await expect(page.locator('.top .show .name')).toHaveText('Opening night');
  await expect(fixturesOnStage(page)).toHaveCount(lights);

  await openManager(page);
  await expect(card(page, 'Opening night')).toHaveClass(/cur/);
  await card(page, 'Opening night').getByRole('button', { name: 'Duplicate Opening night' }).click();
  await expect(card(page, 'Opening night \\(copy\\)')).toHaveCount(1);
  await card(page, 'Opening night \\(copy\\)').getByRole('button', { name: 'Rename Opening night (copy)' }).click();
  await manager(page).getByLabel('Show name').fill('Matinee');
  await manager(page).getByLabel('Show name').press('Enter');
  await expect(card(page, 'Matinee')).toHaveCount(1);
  // open the copy: it's a separate show
  await card(page, 'Matinee').locator('.pic').click();
  await expect(page.locator('.top .show .name')).toHaveText('Matinee');
  await expect(fixturesOnStage(page)).toHaveCount(lights);
  await openManager(page);
  await card(page, 'Opening night').getByRole('button', { name: 'Delete Opening night' }).click();
  await page.getByRole('dialog', { name: 'Delete "Opening night"?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(card(page, 'Opening night')).toHaveCount(0);
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

test('the blank show a first start makes goes when a template or another show takes over; one with something in it stays', async ({ page }) => {
  await fresh(page);
  const manager = async () => { await page.locator('.top .show').click(); return page.getByRole('dialog', { name: 'Shows' }); };
  // a template over the blank first show: the list has the template only
  let dlg = await manager();
  await startTemplate(page, 'Bar');
  await expect(page.locator('.top .show .name')).toHaveText('Bar');
  dlg = await manager();
  await expect(dlg.getByRole('button', { name: 'New show', exact: true })).toHaveCount(0);
  await expect(dlg.getByRole('button', { name: 'Bar', exact: true })).toHaveCount(1);
  // a new blank show that gets a light: kept when another template comes
  await newBlankShow(page);
  await expect(page.locator('.top .show .name')).toHaveText('New show');
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.show.fixtures.push({ id: 'k', name: 'Kept', typeId: 'gen-dimmer', mode: '', universe: 0, address: 1, x: 0.5, y: 0.5 }); a.checkpoint(); });
  dlg = await manager();
  await startTemplate(page, 'Church');
  await expect(page.locator('.top .show .name')).toHaveText('Sunday service');
  dlg = await manager();
  await expect(dlg.getByRole('button', { name: 'New show', exact: true })).toHaveCount(1);
});

test('one place to start a show: New show… in Shows is the start dialog (no second template list); its demos are one click away even folded; its empty stage is a new show', async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => localStorage.setItem('luxdmx.seq.welcomeDemos', 'hidden'));
  await startTemplate(page, 'Bar');                                         // (from the empty stage's "or start from a template")
  await page.locator('.top .show').click();
  const shows = page.getByRole('dialog', { name: 'Shows' });
  await expect(shows.locator('.tpl')).toHaveCount(0);
  await expect(shows.getByRole('button', { name: 'Demo shows…' })).toHaveCount(0);
  await shows.getByRole('button', { name: 'New show…' }).click();
  const w = page.getByRole('dialog', { name: "Let's get some light on stage" });
  await expect(w.getByRole('group', { name: 'Festival stage' })).toHaveCount(0);           // (folded away, as asked)
  await w.getByRole('button', { name: 'Show the 5 demos' }).click();
  await expect(w.getByRole('group', { name: 'Festival stage' }).getByRole('button', { name: /^Play the show/ })).toBeVisible();
  // the empty stage: a new show (it used to only close the dialog, the Bar show still open)
  await w.getByRole('button', { name: 'Start with an empty stage' }).click();
  await expect(page.locator('.top .show .name')).toHaveText('New show');
  expect(await page.evaluate(() => (window as any).__luxdmx.show.fixtures.length)).toBe(0);
  // an empty show: one way in, on the stage; the fixture list and the programmer only say it
  await expect(page.locator('.stage-wrap').getByRole('button', { name: 'Add lights' })).toBeVisible();
  await expect(page.locator('.fl .empty button, .panel.prog .empty button')).toHaveCount(0);
});

test('a show file opened twice: the second is "(2)", so the two can be told apart', async ({ page }) => {
  await openConnected(page);
  const text = await readFile(new URL('./data/gig-song.luxdmx.json', import.meta.url), 'utf8');
  const name = JSON.parse(text).meta.name as string;
  for (let i = 0; i < 2; i++) await page.evaluate(async (t) => { await (window as any).__luxdmx.importShow(new File([t], 'gig-song.luxdmx.json')); }, text);
  await expect(page.locator('.top .show .name')).toHaveText(`${name} (2)`);
  await openManager(page);
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await expect(card(page, esc(name))).toHaveCount(1);
  await expect(card(page, esc(`${name} (2)`))).toHaveCount(1);
});

test('a template started twice makes "Bar" and "Bar 2", not two shows of the same name', async ({ page }) => {
  await fresh(page);
  await page.locator('.top .show').click();
  await startTemplate(page, 'Bar');
  await expect(page.locator('.top .show .name')).toHaveText('Bar');
  await startTemplate(page, 'Bar');
  await expect(page.locator('.top .show .name')).toHaveText('Bar 2');
  await page.locator('.top .show').click();
  const dlg = page.getByRole('dialog', { name: 'Shows' });
  await expect(dlg.getByRole('button', { name: 'Bar', exact: true })).toHaveCount(1);
  await expect(dlg.getByRole('button', { name: 'Bar 2', exact: true })).toHaveCount(1);
});
