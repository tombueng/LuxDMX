// The trouble spots a usability test with a first-time user ("Sam", covers band, 4 PARs, a moving
// head, fog) ran into, each pinned so it stays fixed.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, channels, tab, selectAll, swatch, record, cues, test, expect, intensity, patch, selectFixtures, full, welcome } from './helpers';

const add = (page: Page) => page.getByRole('dialog', { name: 'Add fixtures' });
test.beforeEach(async () => { await resetFake(); });

test('the add dialog: one fog machine, two heads, the next free address shown, plain addresses', async ({ page }) => {
  await openConnected(page);
  await tab(page, 'Fixtures');
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  await add(page).locator('[data-type="gen-drgb"]').click();
  await expect(add(page).getByLabel('How many')).toHaveValue('4');
  await expect(add(page).getByLabel('Start address')).toHaveAttribute('placeholder', 'next free: 1');
  await add(page).getByRole('button', { name: /^Add 4 × / }).click();
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  await add(page).locator('[data-type="gen-mover8"]').click();
  await expect(add(page).getByLabel('How many')).toHaveValue('2');
  await add(page).getByLabel('How many').fill('1');
  await expect(add(page)).toContainText('They get 17 to 24');
  await add(page).getByRole('button', { name: /^Add 1 × / }).click();
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  await add(page).locator('[data-type="gen-fog"]').click();
  await expect(add(page).getByLabel('How many')).toHaveValue('1');
  await add(page).getByLabel('Start address').fill('25');
  await add(page).getByRole('button', { name: /^Add 1 × / }).click();
  await expect(page.locator('.fl li.oitem .addr')).toHaveText(['1', '5', '9', '13', '17', '25']);
  // the fog machine alone: no Intensity slider, its own Off / Half / Full
  await page.locator('.fl li[data-fixture="Fog"]').click();
  await expect(page.locator('.prog').getByLabel('Intensity', { exact: true })).toHaveCount(0);
  await page.locator('.prog .fogq').getByRole('button', { name: 'Full' }).click();
  await expect.poll(async () => (await channels(0, 25))[24]).toBe(255);
});

test('picking a colour for dark lights switches them on', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 2, 0, 'PAR');
  await selectAll(page);
  await swatch(page, 'Red');
  await expect.poll(() => channels(0, 8)).toEqual([255, 255, 0, 0, 255, 255, 0, 0]);
});

test('Update goes into the cue on stage, and says which', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 1, 0, 'D');
  for (const v of [0.2, 0.6]) { await selectAll(page); await intensity(page, v); await record(page); }
  await cues(page).first().click();                                   // selected: the first one ...
  await cues(page).nth(1).dblclick();                                 // ... on stage: the second one
  await selectAll(page); await intensity(page, 1);
  const upd = page.locator('.deck').getByRole('button', { name: 'Update' });
  await expect(upd).toContainText(await cues(page).nth(1).locator('.name').innerText());
  await upd.click();
  await expect(page.locator('.toast')).toContainText('updated with your changes');
  await cues(page).first().dblclick();
  await expect.poll(() => channels(0, 1), { timeout: 4000 }).toEqual([51]);           // the first is unchanged
  await cues(page).nth(1).dblclick();
  await expect.poll(() => channels(0, 1), { timeout: 4000 }).toEqual([255]);
});

test('an effect recorded on its own keeps its lights\' look, whatever played before', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 2, 0, 'P');
  await selectAll(page); await swatch(page, 'Blue'); await record(page);
  await selectAll(page);
  await tab(page, 'Effects');
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add an effect' }).locator('[data-effect="pulse"]').click();
  await record(page);
  await expect(cues(page).nth(1)).toContainText('2 lights');
});

test('Live GO plays the main list, not the list last opened in Program', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Band' }).click();
  await page.locator('.deck .tab', { hasText: 'Fog timer' }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('.strip .go')).toContainText('Songs');
});

test('Ctrl+S says it saved; templates are on the empty stage; help stays on screen', async ({ page }) => {
  await openConnected(page);
  await page.locator('body').press('Control+s');
  await expect(page.locator('.toast')).toContainText('Saved in this browser');
  await welcome(page);
  await expect(page.locator('.welcome .tpls').getByRole('button')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await page.locator('.deck').getByRole('button', { name: 'What is this?' }).click();
  const pop = (await page.locator('.deck .pop').boundingBox())!;
  expect(pop.x).toBeGreaterThanOrEqual(0);
  expect(pop.x + pop.width).toBeLessThanOrEqual(1400);
  await welcome(page);
  await page.locator('.welcome .tpls').getByRole('button', { name: 'Church' }).click();
  await expect(page.locator('.top .show .name')).toHaveText('Sunday service');
});

// ---- round 4: "Maria", church volunteer
test('warm/cool white lights take "Warm white", and say they cannot do purple', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-wwcw', 2, 0, 'Fresnel');                       // 1-2, 3-4
  await patch(page, 'gen-rgb', 1, 0, 'PAR');                            // 5-7
  await selectFixtures(page, ['Fresnel 1', 'Fresnel 2']);
  await full(page);
  await page.locator('.prog').getByRole('button', { name: 'Warm white' }).click();   // the White row: whites only
  await expect.poll(() => channels(0, 4)).toEqual([255, 0, 255, 0]);
  // everything purple: the PAR goes purple, the fresnels stay at their brightest white and the programmer says why
  await page.locator('.stage-wrap').getByRole('button', { name: 'Select all' }).click();
  await full(page);
  await page.locator('.prog .sw[aria-label="Purple"]').click();
  await expect(page.locator('.prog .note')).toContainText("Fresnel 1, Fresnel 2 can't make colours");
  await expect.poll(() => channels(0, 7)).toEqual([255, 255, 255, 255, 153, 0, 255]);
});

test('the selection follows GO; picking another card makes Update go there, and it warns', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 1, 0, 'D');
  for (const v of [0.2, 0.6]) { await selectAll(page); await intensity(page, v); await record(page); }
  await page.locator('.deck').getByRole('button', { name: /^GO/ }).click();       // Record left cue 2 playing: GO wraps or ends
  await cues(page).nth(1).dblclick();                                              // cue 2 on stage
  await expect(cues(page).nth(1)).toHaveClass(/\bsel\b/);                          // the selection came along
  const upd = page.locator('.deck').getByRole('button', { name: /Update/ });
  await expect(upd).not.toHaveClass(/elsewhere/);
  // Maria: picks "Cue 1", changes it, Update: it goes into cue 1, and the button said so in orange
  await cues(page).first().click();
  await selectAll(page); await intensity(page, 1);
  await expect(upd).toHaveClass(/elsewhere/);
  await expect(upd).toContainText(await cues(page).first().locator('.name').innerText());
  await upd.click();
  const clear = page.locator('.prog').getByRole('button', { name: 'Clear' });
  if (await clear.isVisible()) await clear.click();
  await cues(page).first().dblclick();
  await expect.poll(() => channels(0, 1), { timeout: 4000 }).toEqual([255]);
});

test('adapting a template: an 8-ch PAR card, a warning before overlapping, tidy removal, change a type', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Church$/ }) }).click();
  await page.locator('.fl').getByRole('button', { name: /Add/ }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Add fixtures' });
  await dlg.locator('[data-type="gen-drgbwsms"]').click();
  await dlg.getByLabel('How many').fill('6');
  await dlg.getByLabel('Start address').fill('1');
  await expect(dlg.locator('.err')).toContainText('would share channels with Front 1');
  await dlg.getByRole('button', { name: /next free one/ }).click();
  await expect(dlg.locator('.err')).toHaveCount(0);
  await dlg.getByRole('button', { name: /^Add 6 × / }).click();
  // the template's wash lights go: the cues lose them, and their now empty group goes too
  const washCues = await page.evaluate(() => { const s = (window as any).__luxdmx.show, g = s.groups.find((x: any) => x.name === 'Wash');
    return s.cueLists.reduce((n: number, l: any) => n + l.cues.filter((c: any) => g.fixtures.some((id: string) => c.values[id])).length, 0) as number; });
  await page.locator('.side .tabs').getByRole('tab', { name: 'Groups' }).click();
  await page.locator('.gp li[data-group="Wash"] .main').click();
  await page.locator('.side .tabs').getByRole('tab', { name: 'Fixtures' }).click();
  await page.locator('.fl').getByRole('button', { name: 'Remove fixtures' }).click();
  // (and the effect that ran on that group, with no lights left: said too)
  await expect(page.locator('.toast')).toContainText(`Removed 4 fixtures (they were in ${washCues} cues; 1 empty group went too; 1 effect with nothing left to work on went too)`);
  // and a front light becomes a warm/cool white, same address
  await page.locator('.fl li.oitem', { hasText: 'Front 1' }).dblclick();
  await page.getByRole('dialog', { name: 'Patch: Front 1' }).getByLabel('Fixture type').selectOption('gen-wwcw');
  expect(await page.evaluate(() => (window as any).__luxdmx.show.fixtures.find((f: any) => f.name === 'Front 1').typeId)).toBe('gen-wwcw');
});
