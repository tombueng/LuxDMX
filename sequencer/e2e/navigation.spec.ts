// Finding and doing things: the command palette (Ctrl+K), the shortcuts sheet (?), the interface
// size, and that the app keeps working with only a keyboard.
import { openConnected, resetFake, patch, channels, test, expect, welcome } from './helpers';

test.beforeEach(async () => { await resetFake(); });

test('Ctrl+K finds a light, a template and commands', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 4, 0, 'D');
  await page.locator('body').press('Control+k');
  const pal = page.getByRole('dialog', { name: 'Find anything' });
  await expect(pal).toBeVisible();
  await pal.getByRole('combobox').fill('d 3');
  await pal.getByRole('combobox').press('Enter');
  await expect(pal).toBeHidden();
  await expect(page.locator('.fl li.oitem.sel .nm')).toHaveText(['D 3']);
  // set it from the palette too: preset "Full"
  await page.locator('body').press('Control+k');
  await pal.getByRole('combobox').fill('full intensity');
  await pal.getByRole('combobox').press('Enter');
  await expect.poll(() => channels(0, 4)).toEqual([0, 0, 255, 0]);
  // a command: go to Live
  await page.locator('body').press('Control+k');
  await pal.getByRole('combobox').fill('go to live');
  await pal.getByRole('combobox').press('ArrowDown');
  await pal.getByRole('combobox').press('ArrowUp');
  await pal.getByRole('combobox').press('Enter');
  await expect(page.locator('.live')).toBeVisible();
  // nothing found says so
  await page.locator('body').press('Control+k');
  await pal.getByRole('combobox').fill('zzzzqq');
  await expect(pal).toContainText('Nothing found');
  await pal.getByRole('combobox').press('Escape');
  await expect(pal).toBeHidden();
});

test('? shows every shortcut; the interface size is adjustable and remembered', async ({ page }) => {
  await openConnected(page);
  await page.locator('body').press('?');
  const sheet = page.getByRole('dialog', { name: 'Keyboard and mouse' });
  await expect(sheet).toContainText('Alt+arrows');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  const size = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  expect(await size()).toBe('14px');
  await page.locator('.top').getByRole('button', { name: 'More' }).click();
  await page.locator('.ctx').getByRole('menuitem', { name: 'Interface size: bigger' }).click();
  expect(await size()).toBe('15.4px');
  await expect(page.locator('.ctx .sv')).toHaveText('110%');                       // the menu stays open and says so
  await page.keyboard.press('Escape');
  await page.reload();
  expect(await size()).toBe('15.4px');
  await page.locator('.top').getByRole('button', { name: 'More' }).click();
  await page.locator('.ctx').getByRole('menuitem', { name: /Interface size: 110%, back to normal/ }).click();
  expect(await size()).toBe('14px');
});

test('number keys set the selection, R records', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await page.locator('.stage-wrap').getByRole('button', { name: 'Select all' }).click();
  await page.locator('body').press('5');
  await expect.poll(() => channels(0, 2)).toEqual([128, 128]);
  await page.locator('body').press('f');
  await expect.poll(() => channels(0, 2)).toEqual([255, 255]);
  await page.locator('body').press('r');
  await expect(page.locator('.deck .card')).toHaveCount(1);
  await page.locator('body').press('0');
  await expect.poll(() => channels(0, 2)).toEqual([0, 0]);
});

test('"How it works" opens from the welcome card and the menu', async ({ page }) => {
  await openConnected(page);
  await welcome(page);
  await page.getByRole('button', { name: 'How it works, in two minutes' }).click();
  const g = page.getByRole('dialog', { name: 'How it works' });
  await expect(g).toContainText('Cues remember the preset, not the value');
  await page.keyboard.press('Escape');
  await expect(g).toBeHidden();
  await page.locator('.top').getByRole('button', { name: 'More' }).click();
  await page.locator('.ctx').getByRole('menuitem', { name: 'How it works' }).click();
  await expect(g).toBeVisible();
});

test('the context menu from the keyboard (Shift+F10)', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await page.locator('.fl li.oitem').first().click();
  await page.locator('.fl .olist').press('Shift+F10');
  await expect(page.locator('.ctx')).toBeVisible();
  await expect(page.locator('.ctx [role=menuitem]').first()).toBeFocused();          // the menu has the keys now
  // down to Duplicate, Enter: the arrows move in the menu, not the list behind it
  const labels = await page.locator('.ctx [role=menuitem]:not(:disabled)').allTextContents();
  const n = labels.findIndex((t) => t.startsWith('Duplicate'));
  for (let i = 0; i < n; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator('.ctx [role=menuitem]', { hasText: 'Duplicate' })).toBeFocused();
  await expect(page.locator('.fl li.oitem.sel')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('.fl li.oitem')).toHaveCount(3);
  // Escape closes it and the list has the focus again
  await page.locator('.fl .olist').press('Shift+F10');
  await page.keyboard.press('Escape');
  await expect(page.locator('.ctx')).toHaveCount(0);
  await expect(page.locator('.fl .olist')).toBeFocused();
});

test('hints: on at first, the × hides them all (remembered), the menu brings them back', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 1, 0, 'D');
  const hint = page.locator('.fl .tip');
  await expect(hint).toContainText('Your lights');
  await hint.getByRole('button', { name: 'Hide hints' }).click();
  await expect(page.locator('.tip')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Hints hidden');
  await page.reload();
  await expect(page.locator('.stage-wrap .fx')).toHaveCount(1);
  await expect(page.locator('.tip')).toHaveCount(0);
  await page.locator('.top').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Show the hints again' }).click();
  await expect(hint).toBeVisible();
});

test('with a dialog open, the page keys leave the show alone', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 1, 0, 'D');
  await page.locator('.stage-wrap').getByRole('button', { name: 'Select all' }).click();
  await page.locator('body').press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard and mouse' })).toBeVisible();
  await page.keyboard.press('f');                                    // would be "full" on the page
  await page.keyboard.press('r');                                    // would record
  await page.waitForTimeout(300);
  expect((await channels(0, 1))[0] ?? 0).toBe(0);                    // (nothing played yet: maybe no frame at all)
  await expect(page.locator('.deck .card')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('body').press('f');
  await expect.poll(async () => (await channels(0, 1))[0]).toBe(255);
});

test('dialogs take the focus, keep Tab inside, and give it back when they close', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 1, 0, 'D');
  const more = page.locator('.top').getByRole('button', { name: 'More' });
  await more.focus();
  await page.keyboard.press('Enter');                                       // the menu, by keys
  for (let i = 0; i < 8; i++) {
    if ((await page.evaluate(() => document.activeElement?.textContent ?? '')).startsWith('DMX output')) break;
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog', { name: 'DMX output' });
  await expect(dlg).toBeVisible();
  expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true);    // Tab stays inside
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(more).toBeFocused();                                                    // back where it started
});

test('Space on a menu item presses the item, it never fires GO', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 1, 0, 'D');
  await page.locator('.stage-wrap').getByRole('button', { name: 'Select all' }).click();
  await page.locator('.prog').getByRole('button', { name: 'Full' }).click();
  await page.locator('.deck').getByRole('button', { name: /^Record/ }).click();
  await page.locator('.deck').getByRole('button', { name: 'Release', exact: true }).click();
  await expect(page.locator('.deck .card.cur')).toHaveCount(0, { timeout: 5000 });
  await page.locator('.fl li.oitem').first().click();
  await page.locator('.fl .olist').press('Shift+F10');
  await expect(page.locator('.ctx [role=menuitem]').first()).toBeFocused();
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await expect(page.locator('.deck .card.cur')).toHaveCount(0);
});

test('Space: tabbed to a button it presses that button; after a click it is GO again', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  const idx = () => page.evaluate(() => { const a = (window as any).__luxdmx; const st = a.engine.status(a.liveList.id); return st.running ? st.index : -1; });
  const bo = () => page.evaluate(() => (window as any).__luxdmx.blackout);
  const before = await idx();
  // keyboard: Tab onto Blackout (from the button before it), Space presses it
  const blackout = page.locator('.strip').getByRole('button', { name: /Blackout/ });
  await blackout.focus();
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  await expect(blackout).toBeFocused();
  await page.keyboard.press('Space');
  await expect.poll(bo).toBe(true);
  expect(await idx()).toBe(before);
  await page.keyboard.press('Space');                                    // and off again
  await expect.poll(bo).toBe(false);
  // a click on a look, then Space: GO
  await page.locator('.live .tile.cue').first().click();
  const after = await idx();
  await page.keyboard.press('Space');
  await expect.poll(idx).not.toBe(after);
  expect(await bo()).toBe(false);
});

test('the stage takes the list keys: Ctrl+A every light, Esc none, Delete removes (Undo brings them back)', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 3, 0, 'D');
  const n = () => page.evaluate(() => (window as any).__luxdmx.show.fixtures.length);
  const sel = () => page.evaluate(() => (window as any).__luxdmx.selected.length);
  const svg = page.locator('.stage-wrap svg[role=application]');
  const b = (await svg.boundingBox())!;
  await page.mouse.click(b.x + 8, b.y + b.height - 8);                  // the empty floor
  await expect(svg).toBeFocused();
  await page.keyboard.press('Control+a');
  await expect.poll(sel).toBe(3);
  await page.keyboard.press('Escape');
  await expect.poll(sel).toBe(0);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await expect.poll(n).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(n).toBe(3);
});

test('tab rows take the arrows: one Tab stop, Right opens the next tab (Program to Live, the side panels)', async ({ page }) => {
  await openConnected(page);
  const program = page.locator('.top .modes').getByRole('tab', { name: 'Program' });
  await expect(page.locator('.top .modes').getByRole('tab', { name: 'Live' })).toHaveAttribute('tabindex', '-1');
  await program.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.live')).toBeVisible();
  await expect(page.locator('.top .modes').getByRole('tab', { name: 'Live' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.live')).toBeHidden();
  const side = page.locator('.side .tabs').getByRole('tab');
  await side.first().focus();
  await page.keyboard.press('End');
  await expect(side.last()).toHaveAttribute('aria-selected', 'true');
  await expect(side.last()).toBeFocused();
});
