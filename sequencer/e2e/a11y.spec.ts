// Accessibility, checked by axe-core on the main screens: names for every control, roles that
// fit, no ARIA misuse, readable contrast. Rules that don't fit a dark lighting console are listed
// with the reason.
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { lockPage, FAKE, fresh, openConnected, patch, test, expect, startTemplate } from './helpers';

const AXE = fs.readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');

async function audit(page: Page, what: string) {
  // contrast is measured on what's there: not halfway through a dialog's or toast's fade-in
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || (a.effect?.getComputedTiming().iterations ?? 1) === Infinity), undefined, { timeout: 3000 }).catch(() => {});
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    const res = await (window as any).axe.run(document, { resultTypes: ['violations'] });
    return res.violations.map((v: any) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n: any) => n.target.join(' ')).join(' | ')}`);
  });
  expect(r, what).toEqual([]);
}

test('program view, a template with everything', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await startTemplate(page, 'DJ / Party');
  await audit(page, 'program');
});

test('live view', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await startTemplate(page, 'DJ / Party');
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await audit(page, 'live');
});

test('a play on the live page (the cue list panel) and the phone remote dialog', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await startTemplate(page, 'Theatre');
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.keyboard.press('Space');
  await audit(page, 'theatre live');
  await page.locator('.live').getByRole('button', { name: 'Phone as a remote' }).click();
  await page.getByRole('dialog', { name: 'Phone as a remote' }).getByRole('button', { name: 'Switch the phone remote on' }).click();
  await audit(page, 'remote dialog');
});

test('the phone remote page: joining, and playing a show', async ({ page, browser }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await startTemplate(page, 'DJ / Party');
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.locator('.live').getByRole('button', { name: 'Phone as a remote' }).click();
  const dlg = page.getByRole('dialog', { name: 'Phone as a remote' });
  await dlg.getByRole('button', { name: 'Switch the phone remote on' }).click();
  const code = (await dlg.locator('.code').textContent())!.trim();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const phone = await ctx.newPage();
  await phone.goto(`http://${FAKE}/remote`);
  await audit(phone, 'phone join');
  await phone.locator('.join .code').fill(code);
  await phone.locator('.join').getByRole('button', { name: 'Join' }).click();
  // a button per look of the template's main list (the generated page shows up to 48)
  const looks = await page.evaluate(() => Math.min(48, (window as any).__luxdmx.show.cueLists[0].cues.length as number));
  await expect(phone.locator('#grid .tile.cue')).toHaveCount(looks);
  await audit(phone, 'phone playing');
  await ctx.close();
});

test('dialogs: add fixtures, show manager, monitor', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 2, 0, 'PAR');
  await page.locator('.top .show').click();
  await audit(page, 'show manager');
  await page.keyboard.press('Escape');
  await page.locator('.top').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /DMX output/ }).click();
  await audit(page, 'monitor');
});

test('the side tabs and their editors: presets, effects with the editor open, groups', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await startTemplate(page, 'DJ / Party');
  for (const name of ['Presets', 'Groups', 'Effects'] as const) {
    await page.locator('.side .tabs').getByRole('tab', { name }).click();
    if (name === 'Effects') await page.locator('.ep li.oitem').first().click();
    await audit(page, name);
  }
});

test('live edit with a control selected; add fixtures and the library', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await startTemplate(page, 'DJ / Party');
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.live .tile').first().click();
  await audit(page, 'live edit');
  await page.locator('.live').getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  await page.locator('.fl').getByRole('button', { name: /Add/ }).first().click();
  await audit(page, 'add fixtures');
  await page.getByLabel('Search fixtures').fill('cameo flat');            // (in the same dialog)
  await audit(page, 'library');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('program panes and live', async ({ page }) => {
    await openConnected(page);
    await page.locator('.top .show').click();
    await startTemplate(page, 'Band');
    await audit(page, 'phone stage');
    await page.getByRole('navigation', { name: 'Program panes' }).getByRole('button', { name: 'Cues' }).click();
    await audit(page, 'phone cues');
    await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
    await audit(page, 'phone live');
  });
});

test('the newer dialogs and rows: check the patch, fog timer, a context menu, a fixture row with DIP switches', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await startTemplate(page, 'DJ / Party');
  await page.locator('.fl').getByRole('button', { name: 'Check the patch' }).click();
  await audit(page, 'check the patch');
  await page.keyboard.press('Escape');
  await page.locator('.fl li.oitem').first().dblclick();
  await audit(page, 'fixture patch dialog with DIP switches');
  await page.keyboard.press('Escape');
  await page.locator('.fl li.oitem').nth(1).click({ button: 'right' });
  await audit(page, 'context menu');
  await page.keyboard.press('Escape');
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.live').getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('.ctx').getByRole('menuitem', { name: /Fog timer/ }).click();
  await audit(page, 'fog timer');
});

test('the timetable with entries, the locked page with greyed masters, the lights-not-getting-anything bar', async ({ page }) => {
  const popup = await openConnected(page);
  await page.locator('.top .show').click();
  await startTemplate(page, 'Bar');
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.locator('body').press('Control+k');
  await page.getByRole('dialog', { name: 'Find anything' }).getByRole('combobox').fill('schedule');
  await page.keyboard.press('Enter');
  const tt = page.getByRole('dialog', { name: 'Timetable' });
  await tt.getByRole('button', { name: 'Add a time' }).click();
  await tt.getByRole('button', { name: 'Add a time' }).click();
  await tt.getByRole('button', { name: 'Su' }).first().click();                // one day only
  await audit(page, 'timetable');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Space');
  await lockPage(page);
  await audit(page, 'locked live page');
  await popup.close();
  await expect(page.getByRole('alert').filter({ hasText: "aren't getting" })).toBeVisible({ timeout: 5000 });
  await audit(page, 'connection bar');
});

test('focus after a dialog closes: on the main view after the welcome, in the fixture list after Add (Ctrl+A takes the lights), on the next row after a timetable row goes', async ({ page }) => {
  await fresh(page, true);                                          // (with the welcome)
  await expect(page.getByRole('dialog').first()).toBeVisible();
  await page.getByRole('button', { name: /Start with an empty stage/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  // Add fixtures from the keyboard's point of view: the dialog closes, focus is in the list
  await page.locator('.fl').getByRole('button', { name: /Add/ }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Add fixtures' });
  await dlg.locator('[data-type="gen-rgb"]').click();
  await dlg.getByLabel('How many').fill('3');
  await dlg.getByRole('button', { name: /^Add 3 ×/ }).click();
  await expect(dlg).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('olist'))).toBe(true);
  await page.evaluate(() => { (window as any).__luxdmx.selected = []; });
  await page.keyboard.press('Control+a');
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.selected.length)).toBe(3);
  // the timetable: a row removed, the focus on the one after it
  await page.locator('body').press('Control+k');
  await page.getByRole('dialog', { name: 'Find anything' }).getByRole('combobox').fill('schedule');
  await page.keyboard.press('Enter');
  const tt = page.getByRole('dialog', { name: 'Timetable' });
  await tt.getByRole('button', { name: 'Add a time' }).click();
  await tt.getByRole('button', { name: 'Add a time' }).click();
  await tt.getByRole('button', { name: /^Remove / }).first().click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.hasAttribute('data-entry'))).toBe(true);
});

test('Add fixtures by keyboard: arrows between the types, Enter picks one and goes to How many, Enter there adds', async ({ page }) => {
  await openConnected(page);
  await page.locator('.fl').getByRole('button', { name: /Add/ }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Add fixtures' });
  const cards = dlg.locator('.tcard');
  await cards.first().focus();
  const first = await cards.first().getAttribute('data-type');
  await page.keyboard.press('ArrowRight');
  const second = await page.evaluate(() => document.activeElement?.getAttribute('data-type'));
  expect(second).toBeTruthy();
  expect(second).not.toBe(first);
  await page.keyboard.press('ArrowDown');
  const below = await page.evaluate(() => document.activeElement?.getAttribute('data-type'));
  expect(below).not.toBe(second);
  await page.keyboard.press('Enter');
  await expect(dlg.getByLabel('How many')).toBeFocused();
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();
  expect(await page.evaluate((t) => (window as any).__luxdmx.show.fixtures.filter((f: any) => f.typeId === t).length, below)).toBe(2);
});

// From a keyboard-only walk through the app (round 8 of the QA).
test('keyboard: Space presses a Live button reached by Tab; focus that falls goes on from its part of the app', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  const a = (fn: string) => page.evaluate(fn);
  await a(`(() => { const a = window.__luxdmx; a.selectAll(); for (const v of [0.2, 0.5, 0.9]) { a.set({ intensity: v }); a.record(); } a.programmer = {}; a.selected = []; })()`);
  await page.locator('.deck .card').first().dblclick();                     // cue 1 on stage
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  const tile = page.locator('.live .tile').filter({ hasText: 'Cue 3' }).first();
  await tile.focus();
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');   // (got there by keys)
  await expect(tile).toBeFocused();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => { const a = (window as any).__luxdmx; const l = a.show.cueLists[0]; return l.cues.findIndex((c: any) => c.id === a.engine.status(l.id).cue); })).toBe(2);   // (cue 3, not GO's cue 2)
  // Program: Record from the programmer's bar takes its button away; Tab goes on in the programmer
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  await a(`(() => { const a = window.__luxdmx; a.selectAll(); a.set({ intensity: 0.3 }); })()`);
  const rec = page.locator('.prog .foot .rec');
  await rec.focus();
  await page.keyboard.press('Enter');
  await expect(rec).toHaveCount(0);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.prog'))).toBe(true);
});

test('keyboard: Find anything gives the focus back, and its group command makes the group', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  const filter = page.locator('.side .tabs').getByRole('tab', { name: 'Fixtures' });
  await filter.focus();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Find anything' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(filter).toBeFocused();
  // the group: asked for its name, made
  await page.evaluate(() => (window as any).__luxdmx.selectAll());
  await page.keyboard.press('Control+k');
  await page.keyboard.type('group');
  await page.getByRole('dialog', { name: 'Find anything' }).getByRole('option', { name: /^Groups: make one/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Make the group' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.groups.length)).toBe(1);
});

test('keyboard: the Shows dialog starts on the open show, Escape cancels a rename', async ({ page }) => {
  await fresh(page);
  await patch(page, 'gen-dimmer', 1, 0, 'D');
  await page.locator('.top .show').click();
  const dlg = page.getByRole('dialog', { name: 'Shows' });
  const name = await page.evaluate(() => (window as any).__luxdmx.show.meta.name);
  await expect(dlg.locator('button.title', { hasText: name })).toBeFocused();         // (not New blank show)
  await dlg.getByRole('button', { name: `Rename ${name}` }).click();
  await page.keyboard.type('XYZ');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeVisible();                                                    // (the dialog stays)
  await expect(dlg.locator('button.title', { hasText: name })).toBeFocused();
  expect(await page.evaluate(() => (window as any).__luxdmx.show.meta.name)).toBe(name);
});

test('keyboard: a cue on the timeline moves a beat with the arrows; sliders read as percentages; a ring is called a ring', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 1, 0, 'D');
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.selectAll(); a.set({ intensity: 0.5 }); a.record(); a.programmer = {}; });
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  await page.locator('.tlv .chips button').first().click();                          // (a tap puts it at the playhead)
  const clip = page.locator('.tlv .it').first();
  await expect(clip).toBeVisible();
  const at = () => page.evaluate(() => (window as any).__luxdmx.show.timeline.items[0].at);
  const t0 = await at(), beat = 60 / (await page.evaluate(() => { const a = (window as any).__luxdmx; return a.show.timeline.bpm ?? a.show.settings.bpm; }));
  await clip.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(at).toBeCloseTo(t0 + beat, 2);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(at).toBeCloseTo(t0 + 5 * beat, 2);
  await expect(page.locator('.tlv').getByRole('slider', { name: 'Volume' })).toHaveAttribute('aria-valuetext', /^\d+ %$/);
  await expect(page.locator('.top').getByRole('slider', { name: 'Grand master' })).toHaveAttribute('aria-valuetext', '100 %');
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  await page.locator('.side .tabs').getByRole('tab', { name: 'Fixtures' }).click();
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Add fixtures' });
  await expect(dlg.locator('[data-type="gen-disc144"]')).toHaveAttribute('title', 'Pixel disc');
  await dlg.locator('[data-type="gen-dimmer"]').click();
  await expect(dlg.locator('[data-type="gen-dimmer"]')).toHaveAttribute('aria-pressed', 'true');
});

// Red-green colour blind (1 in 12 men): no state told by colour alone (from round 13 of the QA).
test('colour is never the only sign: ARMED and On stage in words on a phone, U0 says blind, a clash has its mark, a picked card is dashed', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await page.evaluate(() => (window as any).__luxdmx.addFixtures('gen-confetti', '', 1, 1, 'Confetti'));   // (a machine: the Arm button)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.armMachines(true); });
  await expect(page.locator('.top .arm .txt')).toBeVisible();
  await expect(page.locator('.top .arm .txt')).toHaveText('ARMED');
  await expect(page.locator('.top .out .short')).toBeVisible();
  await expect(page.locator('.top .out .short')).toHaveText('Live');
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.armMachines(false); });
  await expect(page.locator('.top .arm .txt')).toBeHidden();                 // (Safe: its icon is enough)
  // the boxes button's badge: a mark, and its state in the tooltip
  const boxes = page.locator('.top').getByRole('button', { name: /LuxDMX boxes/ });
  await expect(boxes.locator('.badge')).toHaveText('✓');
  await expect(boxes).toHaveAttribute('title', /connected/);
  await page.setViewportSize({ width: 1440, height: 900 });
  // U0 with a look while Blind: in words
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.selectAll(); a.set({ intensity: 0.6 }); a.output = 'blind'; });
  await expect(page.locator('.dmx .u', { hasText: 'U0' })).toContainText('blind');
  // a clash: a mark on the address, not only its pink
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.show.fixtures[1].address = 1; a.markDirty(0); });
  await expect(page.locator('.fl li.oitem.clash .addr').first()).toContainText('⚠');
  // a picked cue card: dashed (live is green and says LIVE)
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.record(); a.set({ intensity: 0.2 }); a.record(); a.programmer = {}; });
  await page.locator('.deck .card').first().click();
  await expect(page.locator('.deck .card.sel').first()).toHaveCSS('border-top-style', 'dashed');
  // placeholders and disabled buttons readable
  expect(await page.evaluate(() => { const i = document.createElement('input'); i.placeholder = 'x'; document.body.append(i); const c = getComputedStyle(i, '::placeholder').color; i.remove(); return c; })).not.toBe('rgb(117, 117, 117)');
});

test('the newest screens: the welcome\'s tiles with their music pickers, folded demos, the gallery, the 3D stage\'s Venue panel with its rooms', async ({ page }) => {
  test.setTimeout(150_000);
  await fresh(page, true);
  const w = page.getByRole('dialog', { name: "Let's get some light on stage" });
  await expect(w.getByRole('group', { name: 'Wedding' })).toBeVisible();
  await audit(page, 'welcome');
  await w.getByRole('button', { name: 'Hide the demos' }).click();
  await audit(page, 'welcome, demos folded');
  await w.getByRole('button', { name: 'Start Wedding', exact: true }).click();
  await expect(w).toBeHidden();
  await page.evaluate(() => { (window as any).__ui.modal = 'gallery'; });
  await expect(page.getByRole('dialog', { name: 'What the 3D stage draws' })).toBeVisible();
  await audit(page, 'gallery');
  await page.keyboard.press('Escape');
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45000 });
  await page.locator('.s3').getByRole('button', { name: 'Venue', exact: true }).click();
  await expect(page.locator('.s3').getByRole('group', { name: 'Room' })).toBeVisible();
  await audit(page, 'venue panel');
});
