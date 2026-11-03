// A list of looks (the church persona): a look sets the lights it names and leaves the rest as they
// are, whatever order they're tapped in; its card shows just that. Locked, only the locked page
// shows and its masters are greyed. Measured on the wire.
import { openConnected, resetFake, channels, patch, selectFixtures, intensity, record, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

test('"Hall" lights the hall and leaves the church as it was, in any order', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'Church');
  await patch(page, 'gen-dimmer', 1, 0, 'Hall');
  // three looks: Service (church 100 %), Hall (only the hall at 80 %), Dim (church 30 %)
  await selectFixtures(page, ['Church 1', 'Church 2']); await intensity(page, 1); await record(page);
  await selectFixtures(page, ['Hall']); await intensity(page, 0.8); await record(page);
  await selectFixtures(page, ['Church 1', 'Church 2']); await intensity(page, 0.3); await record(page);   // (Record empties the programmer)
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  const tile = (i: number) => page.locator('.live .tile.cue').nth(i);
  await page.locator('.strip').getByRole('button', { name: 'Release' }).click();   // from dark
  await expect.poll(() => channels(0, 3), { timeout: 6000 }).toEqual([0, 0, 0]);
  await tile(2).click();                                                 // Dim: church 30 %
  await expect.poll(() => channels(0, 3)).toEqual([77, 77, 0]);
  await page.waitForTimeout(2600);
  await tile(1).click();                                                 // Hall: the church stays at 30 %
  await page.waitForTimeout(2600);
  expect(await channels(0, 3)).toEqual([77, 77, 204]);
  await tile(0).click();                                                 // Service: church up, the hall stays
  await page.waitForTimeout(2600);
  expect(await channels(0, 3)).toEqual([255, 255, 204]);
});

test('locked, only the locked page shows, its masters are greyed and stay put; the looks play', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  // a second page, then lock on the first (Main, with its masters)
  await page.locator('.live').getByRole('button', { name: 'New page' }).click();
  await page.locator('.live').getByRole('button', { name: /Done/ }).click();
  await page.locator('.live .pages').getByRole('tab').first().click();
  await expect(page.locator('.live .pages').getByRole('tab')).toHaveCount(2);
  await page.locator('.live').getByRole('button', { name: 'Lock page' }).click();
  await expect(page.locator('.live .pages').getByRole('tab')).toHaveCount(1);
  const gm = page.locator('.live .tile.fader', { hasText: 'Grand master' });
  await expect(gm).toHaveClass(/missing/);
  await gm.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('PageDown');
  expect(await page.evaluate(() => (window as any).__luxdmx.grandMaster)).toBe(1);
  await expect(page.locator('.strip').getByRole('button', { name: /^GO/ })).toHaveCount(1);   // (Main keeps GO: a DJ steps with Space)
  await page.locator('.live .tile.cue').nth(1).click();
  await expect.poll(() => page.evaluate(() => { const a = (window as any).__luxdmx; return a.engine.status(a.show.cueLists[0].id).index; })).toBe(1);
  // after a reload it's still that page, still locked
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('.live .pages').getByRole('tab')).toHaveCount(1);
  await expect(page.locator('.live .tile.fader', { hasText: 'Grand master' })).toHaveClass(/missing/);
});

test('locking with a click hands Space back to GO; unlocking stays on the page that was locked', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.locator('.live').getByRole('button', { name: 'Lock page' }).click();
  await page.keyboard.press('Space');                                   // straight after the click: GO, not the padlock's hint
  await expect.poll(() => page.evaluate(() => { const a = (window as any).__luxdmx; return a.engine.status(a.show.cueLists[0].id).running; })).toBe(true);
  // a second page, locked on it, unlocked: still on it
  await page.locator('.live').getByRole('button', { name: /Unlock page/ }).focus();
  await page.keyboard.down(' '); await page.waitForTimeout(1200); await page.keyboard.up(' ');
  await page.locator('.live').getByRole('button', { name: 'New page' }).click();
  await page.locator('.live').getByRole('button', { name: /Done/ }).click();
  const second = await page.evaluate(() => (window as any).__luxdmx.page);
  await page.locator('.live').getByRole('button', { name: 'Lock page' }).click();
  await page.locator('.live').getByRole('button', { name: /Unlock page/ }).focus();
  await page.keyboard.down(' '); await page.waitForTimeout(1200); await page.keyboard.up(' ');
  await expect(page.locator('.live').getByRole('button', { name: 'Lock page' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__luxdmx.page)).toBe(second);
});
