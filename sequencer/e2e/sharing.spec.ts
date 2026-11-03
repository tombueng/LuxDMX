// Getting a show onto the tablet and your own lights into a template's looks (the bar and church
// personas): new lights play along like one that's there, a show file dropped on the window opens,
// and the share sheet sends the show (the download where there is none).
import type { Page } from '@playwright/test';
import { openConnected, resetFake, channels, tab, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

async function template(page: Page, name: string) {
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) }).click();
}

test('new lights play along in every look like one that is there, and on the wire', async ({ page }) => {
  await openConnected(page);
  await template(page, 'Bar');
  const before = await page.evaluate(() => { const a = (window as any).__luxdmx; const f = a.show.fixtures.find((x: any) => x.typeId === 'gen-drgb') ?? a.show.fixtures[0]; return { id: f.id, name: f.name, type: f.typeId, n: a.show.fixtures.length }; });
  await tab(page, 'Fixtures');
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Add fixtures' });
  await dlg.locator(`[data-type="${before.type}"]`).click();
  await dlg.getByLabel('How many').fill('2');
  await dlg.getByLabel('In the looks').selectOption({ label: `like ${before.name}` });
  await dlg.getByRole('button', { name: /^Add 2 × / }).click();
  await expect(page.locator('.toast')).toContainText(`they do what ${before.name} does`);
  const r = await page.evaluate((src) => {
    const a = (window as any).__luxdmx, news = a.show.fixtures.slice(src.n).map((f: any) => f.id);
    const cues = a.show.cueLists.flatMap((l: any) => l.cues).filter((c: any) => c.values[src.id]);
    return { cues: cues.length, same: cues.every((c: any) => news.every((id: string) => JSON.stringify(c.values[id]) === JSON.stringify(c.values[src.id]))),
      groups: a.show.groups.filter((g: any) => g.fixtures.includes(src.id)).every((g: any) => news.every((id: string) => g.fixtures.includes(id))),
      addr: a.show.fixtures.slice(src.n).map((f: any) => f.address), srcAddr: a.show.fixtures.find((f: any) => f.id === src.id).address };
  }, before);
  expect(r.cues).toBeGreaterThan(0);
  expect(r.same).toBe(true);
  expect(r.groups).toBe(true);
  // on the wire: a look with that light lit lights the new ones the same
  await page.evaluate((src) => { const a = (window as any).__luxdmx; const l = a.show.cueLists[0]; const i = l.cues.findIndex((c: any) => (c.values[src.id]?.intensity ?? 0) > 0); a.jump(l.id, Math.max(0, i), 0); }, before);
  // (both read from the same frame: the look may still be on its way when the poll starts)
  await expect.poll(async () => { const ch = await channels(0, 512); const a = ch.slice(r.addr[0] - 1, r.addr[0] + 3), b = ch.slice(r.srcAddr - 1, r.srcAddr + 3); return a.some((v) => v > 0) && a.join() === b.join(); }, { timeout: 5000 })
    .toBe(true);
  // undo: the lights and their part in the looks go together
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.fixtures.length)).toBe(before.n);
});

test('lights on another universe (the hall next to the church) aren\'t put into the looks unless you pick it', async ({ page }) => {
  await openConnected(page);
  await template(page, 'Bar');
  await tab(page, 'Fixtures');
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Add fixtures' });
  const type = await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].typeId);
  await dlg.locator(`[data-type="${type}"]`).click();
  await expect(dlg.getByLabel('In the looks')).not.toHaveValue('');      // same universe: suggested
  await dlg.getByLabel('Universe').fill('1');
  await expect(dlg.getByLabel('In the looks')).toHaveValue('');          // another universe: not yet
});

test('a show file dropped on the window opens; the one you had stays in Shows', async ({ page }) => {
  await openConnected(page);
  await template(page, 'Theatre');
  const json = await page.evaluate(() => { const a = (window as any).__luxdmx; const s = JSON.parse(JSON.stringify(a.show)); s.meta.name = 'From the laptop'; return JSON.stringify(s); });
  await template(page, 'Bar');
  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'from-the-laptop.luxdmx.json', { type: 'application/json' }));
    document.querySelector('.stage-wrap')!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, json);
  await expect(page.locator('.toast')).toContainText('Opened "From the laptop"');
  await expect(page.locator('.top .show')).toContainText('From the laptop');
});

test('Send to another device: the share sheet gets the show file; without one it downloads', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__shared = [];
    (navigator as any).canShare = (d: any) => !!d?.files?.length;
    (navigator as any).share = async (d: any) => { for (const f of d.files) (window as any).__shared.push({ name: f.name, text: await f.text(), title: d.title }); };
  });
  await openConnected(page);
  await template(page, 'Bar');
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).getByRole('button', { name: 'Send to another device' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__shared.length)).toBe(1);
  const got = await page.evaluate(() => (window as any).__shared[0]);
  expect(got.name).toMatch(/\.luxdmx\.json$/);
  expect(JSON.parse(got.text).cueLists.length).toBeGreaterThan(0);
});

test('Send to another device where there is no share sheet: the download', async ({ page }) => {
  await openConnected(page);
  await template(page, 'Bar');
  await page.locator('.top .show').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog', { name: 'Shows' }).getByRole('button', { name: 'Send to another device' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.luxdmx\.json$/);
});
