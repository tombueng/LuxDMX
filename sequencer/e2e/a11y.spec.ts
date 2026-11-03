// Accessibility, checked by axe-core on the main screens: names for every control, roles that
// fit, no ARIA misuse, readable contrast. Rules that don't fit a dark lighting console are listed
// with the reason.
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { FAKE, openConnected, patch, test, expect } from './helpers';

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
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
  await audit(page, 'program');
});

test('live view', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await audit(page, 'live');
});

test('a play on the live page (the cue list panel) and the phone remote dialog', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Theatre' }).click();
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
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
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
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
  for (const name of ['Presets', 'Groups', 'Effects'] as const) {
    await page.locator('.side .tabs').getByRole('tab', { name }).click();
    if (name === 'Effects') await page.locator('.ep li.oitem').first().click();
    await audit(page, name);
  }
});

test('live edit with a control selected; add fixtures and the library', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.live .tile').first().click();
  await audit(page, 'live edit');
  await page.locator('.live').getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  await page.locator('.fl').getByRole('button', { name: /Add/ }).first().click();
  await audit(page, 'add fixtures');
  await page.getByRole('dialog', { name: 'Add fixtures' }).getByRole('button', { name: /Search .* fixtures/ }).click();
  await page.getByLabel('Search fixtures').fill('cameo flat');
  await audit(page, 'library');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('program panes and live', async ({ page }) => {
    await openConnected(page);
    await page.locator('.top .show').click();
    await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Band' }).click();
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
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
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
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
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
  await page.locator('.live').getByRole('button', { name: 'Lock page' }).click();
  await audit(page, 'locked live page');
  await popup.close();
  await expect(page.getByRole('alert').filter({ hasText: "aren't getting" })).toBeVisible({ timeout: 5000 });
  await audit(page, 'connection bar');
});
