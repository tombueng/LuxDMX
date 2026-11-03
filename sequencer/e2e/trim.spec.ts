// Trimming a template to the rig you have: deleting lights and a list takes what pointed at them
// along (the toast says what), so no button on Live says "its target is gone" and no moment on the
// timeline plays a list that isn't there.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

const gone = (page: Page) => page.locator('.live').getByText('its target is gone');
async function band(page: Page) {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Band$/ }) }).click();
  // (Live makes its page from the show's lists, effects and machines)
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('.live')).toBeVisible();
  await expect(gone(page)).toHaveCount(0);
}

test('deleting every pixel bar takes their effects and buttons along: nothing on Live says its target is gone', async ({ page }) => {
  await band(page);
  const effectsBefore = await page.evaluate(() => (window as any).__luxdmx.show.effects.length);
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.selected = a.show.fixtures.filter((f: any) => f.typeId.startsWith('gen-bar')).map((f: any) => f.id); });
  expect(await page.evaluate(() => (window as any).__luxdmx.selected.length)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Remove fixtures' }).click();
  await expect(page.locator('.toast')).toContainText(/effects? .*went too/);
  expect(await page.evaluate(() => (window as any).__luxdmx.show.effects.length)).toBeLessThan(effectsBefore);
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('.live')).toBeVisible();
  await expect(gone(page)).toHaveCount(0);
});

test('deleting a list takes its buttons, the cues that start it and its moments on the timeline along', async ({ page }) => {
  await band(page);
  const id: string = await page.evaluate(() => (window as any).__luxdmx.show.cueLists[0].id);
  const name: string = await page.evaluate(() => (window as any).__luxdmx.show.cueLists[0].name);
  // a page of your own with a button for it (the generated page is made fresh from the lists), a
  // moment on the timeline that plays it, and a cue in another list that starts it
  await page.evaluate((id) => {
    const a = (window as any).__luxdmx, tl = a.timeline.ensure();
    a.show.pages.push({ id: 'pg-mine', name: 'Mine', widgets: [{ id: 'w-mine', type: 'list', list: id, action: 'go', label: 'Mine' }, { id: 'w-cue', type: 'cue', list: id, cue: a.show.cueLists[0].cues[0].id, label: 'One' }] });
    tl.items.push({ id: 'tm1', at: 1, lane: `list:${id}`, do: { do: 'start', list: id } });
    const other = a.show.cueLists.find((l: any) => l.id !== id && l.cues.length).cues[0]; other.actions = [...(other.actions ?? []), { do: 'start', list: id }];
    a.markDirty(0);
  }, id);
  const buttons = () => page.evaluate((id) => (window as any).__luxdmx.show.pages.flatMap((p: any) => p.widgets).filter((w: any) => w.list === id).length, id);
  expect(await buttons()).toBeGreaterThan(0);
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  await page.locator('.deck .tab', { hasText: name }).first().click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: 'Delete the list' }).click();
  await expect(page.locator('.toast')).toContainText('and what played it');
  expect(await buttons()).toBe(0);
  expect(await page.evaluate((id) => { const a = (window as any).__luxdmx; return [a.show.timeline.items.some((i: any) => i.do.list === id), a.show.cueLists.some((l: any) => l.cues.some((c: any) => c.actions?.some((x: any) => x.list === id)))]; }, id)).toEqual([false, false]);
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(gone(page)).toHaveCount(0);
  // Undo brings the list and all of it back
  await page.keyboard.press('Control+z');
  await expect.poll(buttons).toBeGreaterThan(0);
});
