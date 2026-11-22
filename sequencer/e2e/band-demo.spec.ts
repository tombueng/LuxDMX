// The small band's demo (src/content/band.ts): the festival's big stage with what a small band
// owns. It opens from the welcome on the hall's stage, the 3D stage draws every light (the ten LED
// columns four times as wide as a bar comes), its show puts light on both its universes and the
// live page has the fog and the blinders. Cut down to the PARs and the columns (no heads at all) it
// still plays: light on the wire from what's left. And a bar's or a PAR's face and depth are set in
// its setup (Mounting), kept with the light, the 3D stage drawing it so.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, channels, demoTile, welcome, test, expect, tab } from './helpers';

test.beforeEach(async () => { await resetFake(); });

const NAME = 'Band on a small rig';
async function play(page: Page) {
  const w = await welcome(page), t = demoTile(w, NAME);
  await expect(t.getByLabel(`Music for ${NAME}`)).toHaveValue('whiskey-hotel');    // (its own song, picked already)
  await t.getByLabel(`Music for ${NAME}`).selectOption('beat');                     // (no download in the test)
  await t.getByRole('button', { name: /^Play the show/ }).click();
  await expect(w).toBeHidden({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => (window as any).__stage3d?.venue()?.room), { timeout: 60000 }).toBe('hall');
}
const lit = async (u: number) => (await channels(u, 512)).some((x) => x > 0);
const ids = (page: Page, re: string) => page.evaluate((r) => (window as any).__luxdmx.show.fixtures.filter((f: any) => new RegExp(r).test(f.name)).map((f: any) => f.id), re);

test('the small band on the big stage: every light drawn, the columns wide, light on both universes, fog and blinders on the live page', async ({ page }) => {
  test.setTimeout(150_000);
  await openConnected(page);
  await play(page);
  const n = await page.evaluate(() => (window as any).__luxdmx.show.fixtures.length);
  expect(n).toBe(36);
  await expect.poll(() => page.evaluate(() => (window as any).__stage3d.stats().fixtures), { timeout: 20000 }).toBe(n);
  // the columns as the 3D stage draws them: 2.4 m tall, 40 cm across (a bar comes 10 cm)
  const col = (await ids(page, '^Column'))[0];
  expect(await page.evaluate((id) => (window as any).__stage3d.barSize(id), col)).toEqual({ len: 2.4, face: 0.4, depth: 0.08 });
  // it plays: the heads and the PARs (0) and the columns (1) on the wire, beams on the stage
  await page.evaluate(() => { const t = (window as any).__luxdmx.timeline; t.seek(40); t.play(); });
  for (const u of [0, 1]) await expect.poll(() => lit(u), { timeout: 20000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__stage3d.stats().beams), { timeout: 20000 }).toBeGreaterThan(0);
  const hdr = await page.evaluate(() => (window as any).__stage3d.hdr(240));
  expect(hdr.nan).toBe(0); expect(hdr.over).toBe(0);
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('div.live')).toBeVisible();
  await expect(page.locator('.live [data-widget="fog"]')).toHaveCount(1);
  await expect(page.locator('.live .tile', { hasText: 'Blinder' }).first()).toBeVisible();
});

test('the small band without any moving heads: the PARs and the columns still play every part', async ({ page }) => {
  test.setTimeout(150_000);
  await openConnected(page);
  await play(page);
  await page.evaluate(() => (window as any).__luxdmx.timeline.pause());
  const heads = await ids(page, '^(Front wash|Back head|Side head)');
  expect(heads).toHaveLength(12);
  await page.evaluate((h) => (window as any).__luxdmx.removeFixtures(h), heads);
  await expect.poll(() => page.evaluate(() => (window as any).__stage3d.stats().fixtures), { timeout: 20000 }).toBe(24);
  // every look still lights the PARs and the columns
  const looks = await page.evaluate(() => {
    const s = (window as any).__luxdmx.show, L = s.cueLists.find((l: any) => l.name === 'Show');
    const keep = new Set(s.fixtures.filter((f: any) => /^(PAR|Column)/.test(f.name)).map((f: any) => f.id));
    return L.cues.filter((c: any) => c.name !== 'The end').map((c: any) => Object.entries(c.values).filter(([id, v]: any) => keep.has(id) && v.intensity > 0).length);
  });
  expect(looks.length).toBeGreaterThan(10);
  for (const k of looks) expect(k).toBeGreaterThanOrEqual(8);
  // and on the wire, in a verse and in a chorus: the PARs' own channels (universe 0) and the columns (1)
  const parAt = await page.evaluate(() => (window as any).__luxdmx.show.fixtures.find((f: any) => f.name === 'PAR 1').address);
  for (const at of [20, 80]) {
    await resetFake();
    await page.evaluate((t) => { const tl = (window as any).__luxdmx.timeline; tl.seek(t); tl.play(); }, at);
    await expect.poll(async () => (await channels(0, 512)).slice(parAt - 1, parAt - 1 + 8 * 5).some((x) => x > 0), { timeout: 20000 }).toBe(true);
    await expect.poll(() => lit(1), { timeout: 20000 }).toBe(true);
    await page.evaluate(() => (window as any).__luxdmx.timeline.pause());
  }
});

test('a light\'s face and depth, set in its setup: a column\'s and a PAR\'s kept with the light and drawn so; a moving head has only its width', async ({ page }) => {
  test.setTimeout(360_000);
  await openConnected(page);
  // (straight from its builder, not playing: only the setup and the 3D stage are looked at here)
  await page.evaluate(async (url) => {
    const { DEMOS } = await import(url);
    await (window as any).__luxdmx.startShow(DEMOS.find((d: { id: string }) => d.id === 'band').build());
  }, '/src/content/demos.ts');
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__stage3d?.venue()?.room), { timeout: 60000 }).toBe('hall');
  await tab(page, 'Fixtures');
  await page.locator('.fl li[data-fixture="Column 1"]').dblclick();
  const dlg = page.getByRole('dialog', { name: 'Patch: Column 1' });
  await dlg.getByRole('tab', { name: 'Mounting' }).click();
  await expect(dlg.getByLabel('Width in metres')).toHaveValue('2.4');
  await expect(dlg.getByLabel('Face across in metres')).toHaveValue('0.4');
  await expect(dlg.getByLabel('Depth in metres')).toHaveValue('');
  await expect(dlg.getByLabel('Depth in metres')).toHaveAttribute('placeholder', '0.08');
  const dims = () => page.evaluate(() => (window as any).__luxdmx.show.fixtures.find((f: any) => f.name === 'Column 1').dims);
  const col = (await ids(page, '^Column 1$'))[0];
  await dlg.getByLabel('Face across in metres').fill('0.6');
  await dlg.getByLabel('Face across in metres').press('Tab');
  await dlg.getByLabel('Depth in metres').fill('0.15');
  await dlg.getByLabel('Depth in metres').press('Tab');
  await expect.poll(dims).toEqual({ w: 2.4, h: 0.6, d: 0.15 });
  await expect.poll(() => page.evaluate((id) => (window as any).__stage3d?.barSize(id), col), { timeout: 20000 }).toEqual({ len: 2.4, face: 0.6, depth: 0.15 });
  // emptied: as it comes again
  await dlg.getByLabel('Face across in metres').fill('');
  await dlg.getByLabel('Face across in metres').press('Tab');
  await dlg.getByLabel('Depth in metres').fill('');
  await dlg.getByLabel('Depth in metres').press('Tab');
  await expect.poll(dims).toEqual({ w: 2.4 });
  await dlg.press('Escape');
  await expect(dlg).toBeHidden();
  // a PAR: as it comes 0.28 across, 0.28 the other way, 0.3 deep; a flat one of its own
  await page.locator('.fl li[data-fixture="PAR 1"]').dblclick();
  const par = page.getByRole('dialog', { name: 'Patch: PAR 1' });
  await par.getByRole('tab', { name: 'Mounting' }).click();
  await expect(par.getByLabel('Face across in metres')).toHaveAttribute('placeholder', '0.28');
  await expect(par.getByLabel('Depth in metres')).toHaveAttribute('placeholder', '0.3');
  const pid = (await ids(page, '^PAR 1$'))[0];
  await par.getByLabel('Depth in metres').fill('0.12');
  await par.getByLabel('Depth in metres').press('Tab');
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.fixtures.find((f: any) => f.name === 'PAR 1').dims)).toEqual({ d: 0.12 });
  await expect.poll(() => page.evaluate((id) => (window as any).__stage3d?.fixedSize(id), pid), { timeout: 20000 }).toEqual({ w: 0.28, h: 0.28, d: 0.12 });
  await par.press('Escape');
  await expect(par).toBeHidden();
  // a moving head: its width only (it grows all of a piece)
  await page.locator('.fl li[data-fixture="Front wash 1"]').dblclick();
  const head = page.getByRole('dialog', { name: 'Patch: Front wash 1' });
  await head.getByRole('tab', { name: 'Mounting' }).click();
  await expect(head.getByLabel('Width in metres')).toBeVisible();
  await expect(head.getByLabel('Face across in metres')).toHaveCount(0);
});
