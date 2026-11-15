// Lists of real objects: select like files, drag to reorder, copy / cut / paste / duplicate /
// delete with the keys and the context menu. Fixtures, cues and groups.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, patch, channels, selectAll, selectFixtures, intensity, record, cues, jumpTo, go, fixturesOnStage, tab, swatch, full , test, expect, startTemplate } from './helpers';

const items = (page: Page) => page.locator('.fl li.oitem');
const names = async (page: Page) => (await items(page).locator('.nm').allTextContents());
const menuItem = (page: Page, name: string | RegExp) => page.locator('.ctx').getByRole('menuitem', { name });

test.beforeEach(async () => { await resetFake(); });

test('fixtures: shift-select, drag to reorder, copy and paste to free addresses, delete', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 4, 0, 'D');
  expect(await names(page)).toEqual(['D 1', 'D 2', 'D 3', 'D 4']);
  // every item shows what it is and where it's patched
  await expect(items(page).first()).toContainText('Dimmer');
  await expect(items(page).nth(2).locator('.addr')).toHaveText('3');

  await items(page).nth(0).click();
  await items(page).nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.fl li.oitem.sel')).toHaveCount(2);
  await expect(page.locator('.stage-wrap .fx[aria-pressed="true"]')).toHaveCount(2);     // the stage follows

  // drag D 1 + D 2 below D 4
  await items(page).nth(0).dragTo(items(page).nth(3), { targetPosition: { x: 20, y: 30 } });
  expect(await names(page)).toEqual(['D 3', 'D 4', 'D 1', 'D 2']);

  // copy, paste: two new dimmers at the next free addresses (5, 6), selected
  await page.locator('.fl .olist').press('Control+c');
  await page.locator('.fl .olist').press('Control+v');
  await expect(items(page)).toHaveCount(6);
  expect(await names(page)).toEqual(['D 3', 'D 4', 'D 1', 'D 2', 'D 5', 'D 6']);
  await expect(page.locator('.fl li.oitem.sel .addr')).toHaveText(['5', '6']);
  await intensity(page, 1);
  await expect.poll(() => channels(0, 6)).toEqual([0, 0, 0, 0, 255, 255]);

  // Delete removes them at once; Undo in the message (or Ctrl+Z) brings them back
  await page.locator('.fl .olist').press('Delete');
  await expect(items(page)).toHaveCount(4);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(items(page)).toHaveCount(6);
  await items(page).nth(4).click();
  await page.locator('.fl .olist').press('Delete');
  await expect(items(page)).toHaveCount(5);
  await page.locator('body').press('Control+z');
  await expect(items(page)).toHaveCount(6);
});

test('fixtures: the context menu duplicates and groups; a group selects its lights', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 3, 0, 'PAR');
  await items(page).nth(0).click();                 // just PAR 1 (adding selects all new ones)
  await items(page).nth(0).click({ button: 'right' });
  await menuItem(page, 'Duplicate').click();
  await expect(items(page)).toHaveCount(4);
  await expect(items(page).last().locator('.addr')).toHaveText('10');

  await selectFixtures(page, ['PAR 1', 'PAR 3']);
  await items(page).nth(0).click({ button: 'right' });
  await menuItem(page, 'Make a group from the selection').click();
  const ask = page.getByRole('dialog', { name: 'New group' });
  await ask.getByLabel('Name').fill('Sides');
  await ask.getByLabel('Name').press('Enter');
  await tab(page, 'Groups');
  await expect(page.locator('li[data-group="Sides"]')).toContainText('2 lights');
  await page.locator('.stage-wrap').getByRole('button', { name: 'Select none' }).click();
  await page.locator('.stage-wrap .grp', { hasText: 'Sides' }).click();
  await expect(page.locator('.stage-wrap .fx[aria-pressed="true"]')).toHaveCount(2);
  await full(page); await swatch(page, 'Red');
  await expect.poll(() => channels(0, 9)).toEqual([255, 0, 0, 0, 0, 0, 255, 0, 0]);
});

test('cues: cards with their look, drag to reorder changes the GO order, copy/paste/duplicate/delete, update', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 3, 0, 'D');
  for (const n of ['D 1', 'D 2', 'D 3']) {
    await selectAll(page); await intensity(page, 0);
    await selectFixtures(page, [n]); await intensity(page, 1);
    await record(page);
  }
  await expect(cues(page)).toHaveCount(3);
  await expect(cues(page).first().locator('.pic img.look')).toBeVisible();      // a picture of the look
  await expect(cues(page).first()).toContainText('2 s');                        // fade
  await expect(cues(page).first()).toContainText('3 lights');                   // what it sets
  await expect(cues(page).first()).toContainText('GO');                         // waits for GO

  // drag cue 3 in front of cue 1
  await cues(page).nth(2).dragTo(cues(page).nth(0), { targetPosition: { x: 5, y: 30 } });
  await expect(cues(page).locator('.name')).toHaveText(['Cue 3', 'Cue 1', 'Cue 2']);
  await jumpTo(page, 0);
  await expect.poll(() => channels(0, 3)).toEqual([0, 0, 255]);
  await go(page);
  await expect.poll(() => channels(0, 3), { timeout: 4000 }).toEqual([255, 0, 0]);

  // Ctrl+C / Ctrl+V on the selected card: a copy right after it
  await cues(page).nth(0).click();
  await page.locator('.deck .cards').press('Control+c');
  await page.locator('.deck .cards').press('Control+v');
  await expect(cues(page).locator('.name')).toHaveText(['Cue 3', 'Cue 3', 'Cue 1', 'Cue 2']);
  await page.locator('.deck .cards').press('Control+d');
  await expect(cues(page)).toHaveCount(5);
  // Delete twice: the selection moves on to the next card, like in a file manager
  await page.locator('.deck .cards').press('Delete');
  await expect(cues(page)).toHaveCount(4);
  await page.locator('.deck .cards').press('Delete');
  await expect(cues(page).locator('.name')).toHaveText(['Cue 3', 'Cue 3', 'Cue 2']);

  // rename in the inspector, update the look with new changes
  await cues(page).nth(0).click();
  await page.locator('.insp').getByLabel('Cue name').fill('Right');
  await expect(cues(page).nth(0).locator('.name')).toHaveText('Right');
  await jumpTo(page, 0);                                                        // Update goes into the cue on stage
  await selectFixtures(page, ['D 2']); await intensity(page, 0.5);
  await expect(page.locator('.deck').getByRole('button', { name: 'Update' })).toContainText('"Right"');
  await page.locator('.deck').getByRole('button', { name: 'Update' }).click();
  await jumpTo(page, 0);
  await expect.poll(() => channels(0, 3), { timeout: 4000 }).toEqual([0, 128, 255]);

  // right-click: go to a cue, delete it
  await cues(page).nth(2).click({ button: 'right' });
  await menuItem(page, 'Go to this cue').click();
  await expect.poll(() => channels(0, 3), { timeout: 4000 }).toEqual([0, 255, 0]);
  await cues(page).nth(2).click({ button: 'right' });
  await menuItem(page, 'Delete').click();
  await expect(cues(page)).toHaveCount(2);
});

test('the stage: drag a box to select, drag a light to move it', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 4, 0, 'P');
  const svg = page.locator('.stage-wrap svg[aria-label="Stage"]');
  const box = (await svg.boundingBox())!;
  const fx = async (n: string) => (await page.locator(`.stage-wrap .fx[data-name="${n}"] circle`).last().boundingBox())!;
  const a = await fx('P 1'), b = await fx('P 2');
  // a rubber band around the first two
  await page.mouse.move(a.x - 20, a.y + a.height + 25);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 20, b.y - 25, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.stage-wrap .fx[aria-pressed="true"]')).toHaveCount(2);
  // move P 4 up
  const d = await fx('P 4');
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
  await page.mouse.down();
  await page.mouse.move(d.x + d.width / 2, box.y + box.height * 0.2, { steps: 6 });
  await page.mouse.up();
  const moved = await fx('P 4');
  expect(moved.y).toBeLessThan(d.y - 50);
  await expect(fixturesOnStage(page)).toHaveCount(4);
});

test('keyboard: arrows select, Shift extends, Alt moves; cues move with Alt+arrows and the menu', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 4, 0, 'D');
  const list = page.locator('.fl .olist');
  await items(page).nth(0).click();
  await list.press('ArrowDown');
  await expect(page.locator('.fl li.oitem.sel .nm')).toHaveText(['D 2']);
  await list.press('Shift+ArrowDown');
  await expect(page.locator('.fl li.oitem.sel .nm')).toHaveText(['D 2', 'D 3']);
  await list.press('Alt+ArrowDown');
  expect(await names(page)).toEqual(['D 1', 'D 4', 'D 2', 'D 3']);
  await list.press('Alt+ArrowUp');
  await list.press('Alt+ArrowUp');
  expect(await names(page)).toEqual(['D 2', 'D 3', 'D 1', 'D 4']);
  await list.press('Escape');
  await expect(page.locator('.fl li.oitem.sel')).toHaveCount(0);

  for (const n of ['D 1', 'D 2']) { await selectFixtures(page, [n]); await intensity(page, 1); await record(page); }
  await cues(page).nth(0).click();
  await page.locator('.deck .cards').press('Alt+ArrowRight');
  await expect(cues(page).locator('.name')).toHaveText(['Cue 2', 'Cue 1']);
  await cues(page).nth(1).click({ button: 'right' });
  await menuItem(page, 'Move earlier').click();
  await expect(cues(page).locator('.name')).toHaveText(['Cue 1', 'Cue 2']);
});

test('the stage zooms with the wheel and fits again', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 4, 0, 'P');
  const svg = page.locator('.stage-wrap svg[aria-label="Stage"]');
  const fit = page.locator('.stage-wrap').getByRole('button', { name: 'Fit the stage' });
  await expect(fit).toHaveCount(0);                    // (nothing to fit at 100 %: no button taking room)
  const whole = await svg.getAttribute('viewBox');
  const b = (await svg.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, -400);
  await expect(fit).toHaveText(/^\d+%$/);
  await expect(fit).not.toHaveText('100%');
  expect(await svg.getAttribute('viewBox')).not.toBe('0.0 0.0 1000.0 560.0');
  // selecting by clicking still hits the right light when zoomed
  await page.locator('.stage-wrap .fx[data-name="P 2"]').click();
  await expect(page.locator('.fl li.oitem.sel .nm')).toHaveText(['P 2']);
  await fit.click();
  await expect(fit).toHaveCount(0);
  expect(await svg.getAttribute('viewBox')).toBe(whole);
});

test('cue names: double-click renames, new cues are named after their presets', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 2, 0, 'PAR');
  await selectAll(page); await full(page); await swatch(page, 'Warm white');
  await record(page);
  await expect(cues(page).first().locator('.name')).toHaveText('Warm white');
  await cues(page).first().locator('.name').dblclick();
  await cues(page).first().getByLabel('Cue name').fill('Opening');
  await cues(page).first().getByLabel('Cue name').press('Enter');
  await expect(cues(page).first().locator('.name')).toHaveText('Opening');
  // double-click on the picture still goes to the cue
  await page.locator('.deck').getByRole('button', { name: 'Release', exact: true }).click();
  await expect.poll(() => channels(0, 1), { timeout: 4000 }).toEqual([0]);
  await cues(page).first().locator('.pic').dblclick();
  await expect.poll(() => channels(0, 1)).toEqual([255]);
});

test('the stage: arrow keys nudge the selected lights, dragging snaps to the others', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  const pos = (n: string) => page.evaluate((name) => { const f = (window as any).__luxdmx.show.fixtures.find((x: any) => x.name === name); return { x: f.x, y: f.y }; }, n);
  const before = await pos('D 1');
  await page.locator('.stage-wrap .fx[data-name="D 1"]').click();
  const svg = page.locator('.stage-wrap svg[aria-label="Stage"]');
  await svg.focus();
  for (let i = 0; i < 3; i++) await svg.press('ArrowRight');
  await svg.press('Shift+ArrowDown');
  const after = await pos('D 1');
  expect(after.x - before.x).toBeCloseTo(0.03, 3);
  expect(after.y - before.y).toBeCloseTo(0.05, 3);
  // drag D 2 to just off D 1's row: it lands exactly on it, with a guide while dragging
  const d1 = (await page.locator('.stage-wrap .fx[data-name="D 1"] circle').last().boundingBox())!;
  const d2 = (await page.locator('.stage-wrap .fx[data-name="D 2"] circle').last().boundingBox())!;
  await page.mouse.move(d2.x + d2.width / 2, d2.y + d2.height / 2);
  await page.mouse.down();
  await page.mouse.move(d2.x + d2.width / 2 + 10, d1.y + d1.height / 2 + 3, { steps: 6 });
  await expect(page.locator('.stage-wrap line.snapguide')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.stage-wrap line.snapguide')).toHaveCount(0);
  expect((await pos('D 2')).y).toBeCloseTo(after.y, 5);
});

test('keys on a DIP switch belong to the switch, not the list', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await page.locator('.fl li.oitem', { hasText: 'D 2' }).dblclick();
  const dlg = page.getByRole('dialog', { name: 'Patch: D 2' });
  const sw1 = dlg.locator('.dip').getByRole('button', { name: 'Switch 1 (1)' });
  await expect(sw1).toBeVisible();
  await sw1.press('Backspace');                                           // not "remove the light"
  await expect(page.locator('.fl li.oitem')).toHaveCount(2);
  await sw1.press('Space');                                               // flips it: 2 -> 3
  await expect(dlg.getByLabel('Fixture address')).toHaveValue('3');
  await expect(page.locator('.deck .card')).toHaveCount(0);
});

// A browser asks before a page may read the clipboard, and nothing says anyone answers: duplicate
// and paste must not stand waiting for that (they did, and looked broken).
test('a clipboard prompt nobody answers holds up nothing', async ({ page }) => {
  await page.addInitScript(() => {
    const never = () => new Promise<never>(() => {});
    Object.defineProperty(navigator, 'clipboard', { value: { readText: never, writeText: never }, configurable: true });
  });
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'Dim');
  const count = () => page.evaluate(() => (window as any).__luxdmx.show.fixtures.length);
  await page.locator('.fl li').first().click();
  await page.keyboard.press('Control+d');
  await expect.poll(count, { timeout: 3000 }).toBe(3);
  await page.keyboard.press('Control+x');
  await expect.poll(count, { timeout: 3000 }).toBe(2);
  await page.keyboard.press('Control+v');
  await expect.poll(count, { timeout: 3000 }).toBe(3);
  await page.locator('.fl').getByRole('button', { name: 'Duplicate fixtures' }).click();
  await expect.poll(count, { timeout: 3000 }).toBe(4);
});

test('a light dragged on the plan is one undo step back to where it started, even with a save in the middle of the drag', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 2, 0, 'P');
  const pos = () => page.evaluate(() => { const f = (window as any).__luxdmx.show.fixtures.find((x: any) => x.name === 'P 1'); return [f.x, f.y]; });
  const start = await pos();
  const body = page.locator('.stage-wrap .fx[data-name="P 1"] [stroke-width]').first();
  const b = (await body.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 40, b.y - 30, { steps: 6 });
  await page.evaluate(() => (window as any).__luxdmx.checkpoint(true));     // (the save timer, mid-drag)
  await page.mouse.move(b.x + 90, b.y - 60, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(await pos()).not.toEqual(start);
  await page.keyboard.press('Control+z');
  await expect.poll(pos).toEqual(start);
});

// A cue copied in one show and pasted into another finds its lights by name; the ones this show
// doesn't have (and the other show's effects) are left out, and the toast says so.
test('a cue pasted into another show says which of its lights this show doesn\'t have', async ({ page }) => {
  await openConnected(page);
  const tpl = async (name: string) => {
    await page.locator('.top .show').click();
    await startTemplate(page, name);
    await expect(page.getByRole('dialog', { name: 'Shows' })).toBeHidden();
  };
  await tpl('Band');
  await cues(page).filter({ hasText: 'Chorus' }).click();
  await page.locator('.deck .cards').press('Control+c');
  await tpl('Theatre');
  await expect(cues(page).first()).toBeVisible();
  const before = await cues(page).count();
  await cues(page).last().click();
  await page.locator('.deck .cards').press('Control+v');
  await expect(cues(page)).toHaveCount(before + 1);
  const toast = page.locator('.toast').filter({ hasText: 'Pasted 1 cue' });
  await expect(toast).toContainText("of its lights aren't in this show");
  await expect(toast).toContainText('left out');
  // the lights it did find: by name
  const names = await page.evaluate(() => { const a = (window as any).__luxdmx; const c = a.list.cues.at(-1); return Object.keys(c.values).map((id) => a.show.fixtures.find((f: any) => f.id === id)?.name); });
  expect(names).toContain('Front 1');
  expect(names.every((n: string | undefined) => !!n)).toBe(true);
});

test('a cue moved to another list from its menu stays itself: its Live button and its moment on the timeline go along', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  for (const n of ['D 1', 'D 2']) { await selectFixtures(page, [n]); await intensity(page, 1); await record(page); }
  const ids = await page.evaluate(() => {
    const a = (window as any).__luxdmx, l = a.list, c = l.cues[1], other = a.newList('Other');
    a.currentList = l.id;
    a.show.pages.push({ id: 'pg-e2e', name: 'Mine', widgets: [{ id: 'w-e2e', type: 'cue', list: l.id, cue: c.id }] });
    a.show.timeline = { duration: 60, items: [{ id: 't-e2e', at: 4, lane: `list:${l.id}`, do: { do: 'goto', list: l.id, cue: c.id } }] };
    a.checkpoint();
    return { list: l.id, cue: c.id, other: other.id };
  });
  await expect(cues(page)).toHaveCount(2);
  await cues(page).nth(1).click({ button: 'right' });
  await menuItem(page, 'Move to "Other"').click();
  const after = await page.evaluate((x) => {
    const a = (window as any).__luxdmx;
    return { from: a.show.cueLists.find((l: any) => l.id === x.list).cues.map((c: any) => c.id), to: a.show.cueLists.find((l: any) => l.id === x.other).cues.map((c: any) => c.id),
      button: a.show.pages.find((p: any) => p.id === 'pg-e2e')?.widgets[0], moment: a.show.timeline.items[0] };
  }, ids);
  expect(after.from).not.toContain(ids.cue);
  expect(after.to).toEqual([ids.cue]);
  expect(after.button).toMatchObject({ list: ids.other, cue: ids.cue });
  expect(after.moment).toMatchObject({ lane: `list:${ids.other}`, do: { list: ids.other, cue: ids.cue } });
  // the deck shows the list it went to, the cue picked there
  await expect(cues(page)).toHaveCount(1);
  // one Undo takes it back (the deck stays on the list it was showing)
  await page.locator('body').press('Control+z');
  await expect.poll(() => page.evaluate((x) => (window as any).__luxdmx.show.cueLists.map((l: any) => (l.id === x.list || l.id === x.other ? l.cues.length : -1)).filter((n: number) => n >= 0), ids)).toEqual([2, 0]);
});

test('the read-only plans (Timeline, Live) pan with the middle button even when it starts on a light', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 4, 0, 'P');
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  const svg = page.locator('.tlv svg[aria-label="Stage"]');
  await expect(svg).toBeVisible();
  const b = (await svg.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, -400);                      // (zoomed in: there's somewhere to pan to)
  await expect.poll(() => svg.getAttribute('viewBox')).not.toBe('0.0 0.0 1000.0 560.0');
  const before = await svg.getAttribute('viewBox');
  const picked = await page.evaluate(() => [...(window as any).__luxdmx.selected]);
  const light = (await page.locator('.tlv .fx[data-name="P 2"]').boundingBox())!;
  await page.mouse.move(light.x + light.width / 2, light.y + light.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(light.x + light.width / 2 + 120, light.y + light.height / 2 + 40, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(before);
  // and the selection isn't changed from here
  expect(await page.evaluate(() => [...(window as any).__luxdmx.selected])).toEqual(picked);
});
