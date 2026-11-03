// A bar's tablet (the bar persona): a lock staff can't get out of without the PIN, Blackout that
// takes holding, the lights-not-connected bar, and a fresh start that doesn't black out the room.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, frames, channels, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

async function bar(page: Page) {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
}

test('locked with a PIN: no master, no Release, Blackout by holding, the phone dialog only shows; the PIN unlocks', async ({ page }) => {
  await bar(page);
  await page.keyboard.press('Space');
  await page.locator('.live').getByRole('button', { name: 'Lock page' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Lock with a PIN…' }).click();
  const ask = page.getByRole('dialog', { name: 'Lock with a PIN' });
  await ask.getByLabel(/PIN/).fill('4711');
  await ask.getByRole('button', { name: 'Lock' }).click();
  await expect(page.locator('.live').getByRole('button', { name: /Unlock page/ })).toBeVisible();
  await expect(page.locator('.top input[aria-label="Grand master"]')).toHaveCount(0);
  await expect(page.locator('.strip').getByRole('button', { name: 'Release' })).toHaveCount(0);
  // a tap on Blackout only says how; holding it blacks out; a tap brings it back
  const bo = page.locator('.strip').getByRole('button', { name: 'Blackout' });
  await bo.click();
  await expect(page.locator('.toast')).toContainText('Hold Blackout');
  expect(await page.evaluate(() => (window as any).__luxdmx.blackout)).toBe(false);
  await bo.hover(); await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.blackout)).toBe(true);
  await bo.click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.blackout)).toBe(false);
  // from the keyboard: Space held on it does the same
  await bo.focus(); await page.keyboard.down(' '); await page.waitForTimeout(550); await page.keyboard.up(' ');
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.blackout)).toBe(true);
  await bo.click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.blackout)).toBe(false);
  // the phone dialog: nothing to change
  await page.locator('.live').getByRole('button', { name: 'Phone as a remote' }).click();
  const ph = page.getByRole('dialog', { name: 'Phone as a remote' });
  await expect(ph).toContainText('unlock to change this');
  await expect(ph.getByRole('button', { name: /Switch/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // holding the padlock asks for the PIN: a wrong one keeps it locked, the right one unlocks
  const lock = page.locator('.live').getByRole('button', { name: /Unlock page/ });
  const hold = async () => { await lock.hover(); await page.mouse.down(); await page.waitForTimeout(1200); await page.mouse.up(); };
  await hold();
  const pin = page.getByRole('dialog', { name: 'Unlock' });
  await pin.getByLabel('PIN').fill('1234');
  await pin.getByRole('button', { name: 'Unlock' }).click();
  await expect(pin).toContainText("That wasn't it");                 // still asking, still locked
  await expect(lock).toBeVisible();
  await pin.getByLabel('PIN').fill('4711');
  await pin.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('.live').getByRole('button', { name: 'Lock page' })).toBeVisible();
  await expect(page.locator('.top input[aria-label="Grand master"]')).toHaveCount(1);
});

test('when the lights stop getting anything a red bar says so, and Reconnect brings them back', async ({ page }) => {
  const popup = await openConnected(page);
  await page.evaluate(() => (window as any).__luxdmx.programmer = {});
  await expect(page.getByRole('alert').filter({ hasText: "aren't getting anything" })).toHaveCount(0);
  await popup.close();                                             // the cleaner closed the box's little window
  await page.evaluate(() => (window as any).__luxdmx.grandMaster = 0.9);   // something to send
  const bar = page.getByRole('alert').filter({ hasText: "aren't getting anything" });
  await expect(bar).toBeVisible({ timeout: 5000 });
  const [again] = await Promise.all([page.waitForEvent('popup'), bar.getByRole('button', { name: 'Reconnect' }).click()]);
  await again.waitForLoadState();
  await expect(bar).toHaveCount(0, { timeout: 5000 });
});

test('a fresh start sends nothing until something plays: the box keeps the look it had', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
  await page.waitForTimeout(1500);
  expect(Object.keys(await frames())).toEqual([]);                  // lights patched, nothing played: no frames
  await page.keyboard.press('Space');                                // the first GO: now it sends
  await expect.poll(async () => (await channels(0, 8)).some((v) => v > 0)).toBe(true);
});

test('a page with just the looks for staff, in one go: the looks with their keys, nothing else', async ({ page }) => {
  await bar(page);
  const looks = await page.evaluate(() => (window as any).__luxdmx.show.cueLists[0].cues.length);
  await page.locator('.live').getByRole('button', { name: 'New page' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Just the looks (for staff)' }).click();
  await expect(page.locator('.toast')).toContainText('just the looks');
  const w = await page.evaluate(() => { const a = (window as any).__luxdmx; return a.show.pages.find((p: any) => p.id === a.page).widgets.map((x: any) => x.type); });
  expect(w).toEqual(Array(looks).fill('cue'));
  await expect(page.locator('.strip').getByRole('button', { name: /^GO/ })).toHaveCount(0);   // tapped, not stepped into "All off"
  await page.keyboard.press('2');                                    // its keys play
  await expect.poll(() => page.evaluate(() => { const a = (window as any).__luxdmx; return a.engine.status(a.show.cueLists[0].id).index; })).toBe(1);
  // undo takes it away again; the page built from the show is still there
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.pages.length)).toBe(1);
});

test('a second tab doesn\'t start a second copy of the show; with the first one closed, a new one picks it up', async ({ page, context }) => {
  await bar(page);
  await page.keyboard.press('Space');
  const running = (p: typeof page) => p.evaluate(() => { const a = (window as any).__luxdmx; return a.show.cueLists.some((l: any) => a.engine.status(l.id).running); });
  await expect.poll(() => running(page)).toBe(true);
  await page.waitForTimeout(1200);                                  // (what plays is saved)
  const b = await context.newPage();
  await b.goto('/');
  await b.waitForTimeout(1200);
  expect(await running(b)).toBe(false);                               // the first tab holds the show: this one stays quiet
  await b.close();
  await page.close();                                                 // the tablet's tab is gone
  const c = await context.newPage();
  await c.goto('/');
  await expect.poll(() => running(c), { timeout: 5000 }).toBe(true);  // switched on again: what was playing is back
  await expect(c.locator('.toast')).toContainText('Back on as it was');
});
