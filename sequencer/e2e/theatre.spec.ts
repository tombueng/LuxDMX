// A school play (the theatre persona): house lights that come up at the end, "back to cue 9"
// showing cue 9, a nervous double GO, a cue added between two at the tech, and haze that stops.
// Measured on the wire (the fake box's frames).
import type { Page } from '@playwright/test';
import { openConnected, resetFake, channels, selectFixtures, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

async function theatre(page: Page) {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Theatre' }).click();
}
// the first DMX channel of a light, 0-based, and what's on it
const chan = (page: Page, name: string) => page.evaluate((n) => (window as any).__luxdmx.show.fixtures.find((f: any) => f.name === n).address - 1, name);
const level = async (page: Page, name: string) => (await channels(0, 64))[await chan(page, name)];
const lists = (page: Page) => page.evaluate(() => (window as any).__luxdmx.show.cueLists.map((l: any) => l.id) as string[]);
const status = (page: Page, i: number) => page.evaluate((i) => { const a = (window as any).__luxdmx; return a.engine.status(a.show.cueLists[i].id); }, i);
// the play's cues, and their numbers as the deck shows them (1 to n, with `at` replaced or put in)
const cueCount = (page: Page) => page.evaluate(() => (window as any).__luxdmx.show.cueLists[0].cues.length as number);
const nums = (n: number, edit: (a: string[]) => string[] = (a) => a) => edit(Array.from({ length: n }, (_, i) => String(i + 1)));

test('the house lights come up with the last cue and go out with the first scene, whatever they were on', async ({ page }) => {
  await theatre(page);
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.keyboard.press('Space');                                  // Preset: house full
  await expect.poll(() => level(page, 'House 1'), { timeout: 6000 }).toBe(255);
  await page.waitForTimeout(450);
  await page.keyboard.press('Space');                                  // Scene 1: house out (8 s)
  await expect.poll(() => level(page, 'House 1'), { timeout: 12000 }).toBe(0);
  const n = await cueCount(page);
  for (let i = 0; i < n - 2; i++) { await page.waitForTimeout(450); await page.keyboard.press('Space'); }   // to the End
  await expect(page.locator('.strip .now')).toContainText('End');
  await expect.poll(() => level(page, 'House 1'), { timeout: 6000 }).toBe(255);
});

test('back to a cue shows that cue; a double GO plays one cue and leaves nothing halfway', async ({ page }) => {
  await theatre(page);
  const [show] = await lists(page);
  // play to Sunrise (cyc orange), then jump back to Night: the cyc is Night's blue, not Sunrise's orange
  await page.evaluate((id) => (window as any).__luxdmx.jump(id, 3), show);
  await page.waitForTimeout(11000);
  const cyc = await chan(page, 'Cyc 1');
  const sunrise = (await channels(0, 64)).slice(cyc, cyc + 4);
  await page.evaluate((id) => (window as any).__luxdmx.jump(id, 2), show);
  await page.waitForTimeout(6500);
  const night = (await channels(0, 64)).slice(cyc, cyc + 4);
  expect(night).not.toEqual(sunrise);
  expect(night[2]).toBeGreaterThan(night[0]);                           // blue over red
  // two GOs a quarter of a second apart: one cue
  await page.evaluate((id) => (window as any).__luxdmx.jump(id, 0), show);
  await page.waitForTimeout(500);
  const goBtn = page.locator('.deck').getByRole('button', { name: /^GO/ });
  // a nervous double press, well under 0.3 s: both clicks in one go (two Playwright clicks wait for
  // the button to sit still in between, which on a busy page can take longer than the guard)
  await goBtn.evaluate((el: HTMLElement) => { el.click(); el.click(); });
  await expect.poll(async () => (await status(page, 0)).index).toBe(1);
  await page.waitForTimeout(500);
  expect((await status(page, 0)).index).toBe(1);
});

test('a cue recorded mid-show goes after the one on stage; GO carries on; undo puts the stage back on its cue', async ({ page }) => {
  await theatre(page);
  const [show] = await lists(page);
  await page.evaluate((id) => (window as any).__luxdmx.jump(id, 1, 0), show);           // Scene 1
  await selectFixtures(page, ['Front 1']);
  await page.locator('.prog .quick').getByRole('button', { name: 'Full' }).click();
  await page.locator('.deck').getByRole('button', { name: /^Record/ }).click();
  const names = await page.evaluate(() => (window as any).__luxdmx.show.cueLists[0].cues.map((c: any) => c.name) as string[]);
  expect(names[1]).toBe('Scene 1');
  expect(names[3]).toBe('Night');                                        // the new one goes between Scene 1 and Night...
  // ...numbered like the script: 2.5, and Night is still 3
  const n = names.length - 1;
  await expect(page.locator('.deck .card .num')).toHaveText(nums(n, (a) => [...a.slice(0, 2), '2.5', ...a.slice(2)]));
  // (the deck here in Program; the Live strip is kept hidden once Live has been built)
  await expect(page.locator('.strip .now, .deck').filter({ visible: true })).toContainText('2.5');
  expect((await status(page, 0)).index).toBe(2);
  await page.waitForTimeout(450);
  await page.locator('body').press('Control+z');
  await expect.poll(async () => (await status(page, 0)).index).toBe(1);   // back on Scene 1, not the last cue
  await expect(page.locator('.deck .card .num')).toHaveText(nums(n));
  await page.waitForTimeout(450);
  await page.locator('.deck').getByRole('button', { name: /^GO/ }).click();   // and GO carries on with what was next
  await expect.poll(async () => (await status(page, 0)).index).toBe(2);
  expect(await page.evaluate(() => { const a = (window as any).__luxdmx; return a.show.cueLists[0].cues[a.engine.status(a.show.cueLists[0].id).index].name; })).toBe('Night');
});

test('Off on a hazer stops its haze, Record keeps a running haze out of other cues, and Live offers to stop haze', async ({ page }) => {
  await openConnected(page);
  await page.locator('.side .tabs').getByRole('tab', { name: 'Fixtures' }).click();
  for (const [type, name] of [['gen-dimmer', 'D'], ['gen-haze1', 'Hazer']] as const) {
    await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Add fixtures' });
    await dlg.locator(`[data-type="${type}"]`).click();
    await dlg.getByLabel('How many').fill('1');
    await dlg.getByLabel('Name', { exact: true }).fill(name);
    await dlg.getByRole('button', { name: /^Add 1 × / }).click();
  }
  // the stage calls it what it is
  await expect(page.locator('.stage-wrap .fx[data-name="Hazer"] text.glyph')).toHaveText('HAZE');
  // cue 1: haze on
  await selectFixtures(page, ['Hazer']);
  await page.locator('.prog .fogq .quick').getByRole('button', { name: 'Full' }).click();
  await page.locator('.deck').getByRole('button', { name: /^Record/ }).click();
  // cue 2: only the dimmer, recorded with the haze still running: the cue doesn't take the haze
  await selectFixtures(page, ['D']);
  await page.locator('.prog .quick').first().getByRole('button', { name: 'Full' }).click();
  await page.locator('.deck').getByRole('button', { name: /^Record/ }).click();
  const c2 = await page.evaluate(() => (window as any).__luxdmx.show.cueLists[0].cues[1].values);
  expect(Object.values(c2).some((v: any) => 'haze' in v || 'fog' in v)).toBe(false);
  // haze runs only in the cue that sets it: on cue 2 it's off
  const hz0 = await chan(page, 'Hazer');
  await expect.poll(async () => (await channels(0, 8))[hz0]).toBe(0);
  // back on cue 1 it hazes; Live says so, and stops it until the next cue
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.jump(a.show.cueLists[0].id, 0); });
  await expect.poll(async () => (await channels(0, 8))[hz0]).toBe(255);
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  const chip = page.locator('.live').getByRole('button', { name: /Stop the (fog|haze)/ });
  await expect(chip).toBeVisible();
  await chip.click();
  const hz = await chan(page, 'Hazer');
  await expect.poll(async () => (await channels(0, 8))[hz]).toBe(0);
  await expect(chip).toHaveCount(0);
  // back in Program: Select all, Off: the hazer's haze is part of "off"
  // the stop sits on the live layer, not in the programmer: nothing to Clear, and the next cue's
  // haze would haze again
  expect(await page.evaluate(() => Object.keys((window as any).__luxdmx.programmer).length)).toBe(0);
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.selected = a.show.fixtures.map((f: any) => f.id); });   // (a fogging light's glow never stands still for a click)
  await page.locator('.prog .quick').first().getByRole('button', { name: 'Off' }).click();
  const prog = await page.evaluate(() => { const a = (window as any).__luxdmx; return a.programmer[a.show.fixtures.find((f: any) => f.name === 'Hazer').id]; });
  expect(prog).toMatchObject({ fog: 0, haze: 0 });
});

test('cue numbers: typed into a cue, on the cue sheet, Renumber puts 1, 2, 3 back', async ({ page }) => {
  await theatre(page);
  const n = await cueCount(page);
  await page.locator('.deck .card').nth(2).click();                     // Night
  await page.getByLabel('Cue number').fill('20');
  await page.getByLabel('Cue number').press('Enter');
  await expect(page.locator('.deck .card .num')).toHaveText(nums(n, (a) => [...a.slice(0, 2), '20', ...a.slice(3)]));
  // the cue sheet carries them
  const [sheet] = await Promise.all([page.waitForEvent('popup'), page.evaluate(() => (window as any).__luxdmx.printCueSheet())]);
  await expect(sheet.locator('table').first()).toContainText('20');
  await sheet.close();
  await page.locator('.deck .tab').first().click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: /Renumber/ }).click();
  await expect(page.locator('.deck .card .num')).toHaveText(nums(n));
});

test('a play\'s live page: the whole cue list, the cue on stage lit and next marked, hold a row to jump, no DJ buttons', async ({ page }) => {
  await theatre(page);
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  const panel = page.getByRole('region', { name: /Cue list Show/ });
  await expect(panel.locator('li')).toHaveCount(await cueCount(page));
  await expect(panel.locator('li .note').first()).toHaveText('Audience coming in');
  await expect(page.locator('.live [data-widget="blinder"], .live [data-widget="drop"], .live [data-widget="bpm"]')).toHaveCount(0);
  await expect(page.locator('.live .tile.cue')).toHaveCount(0);                 // no look buttons with number keys
  await page.keyboard.press('Space');
  await expect(panel.locator('li.live .nm')).toContainText('Preset');
  await expect(panel.locator('li.next .nm')).toContainText('Scene 1');
  // a tap on a row does nothing; holding it jumps there
  await panel.locator('li').nth(3).locator('.row').click();
  await page.waitForTimeout(300);
  await expect(panel.locator('li.live .nm')).toContainText('Preset');
  const row = panel.locator('li').nth(3).locator('.row');
  await row.hover(); await page.mouse.down(); await page.waitForTimeout(750); await page.mouse.up();
  await expect(panel.locator('li.live .nm')).toContainText('Sunrise');
  await expect(page.locator('.strip .now')).toContainText('4. Sunrise');
  // the house lights step with GO and Back
  await expect(page.locator('.live [data-widget^="go-"]')).toHaveCount(1);
  await expect(page.locator('.live [data-widget^="back-"]')).toHaveCount(1);
});
