// How the 3D stage feels: moving heads turn at a real head's speed (not a jump per frame), the
// world is handed on between Program, Timeline and Live (not built again) and let go in 2D, a
// light clicked in 3D shows selected in the list (scrolled to), the Haze slider acts at once, the
// drawing quality starts at High, a pixel bar lit by an effect reads its real level, and a Release
// says which effects go on running.
import type { Page } from '@playwright/test';
import { channels, full, openConnected, resetFake, patch, fresh, selectAll, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

const S = (page: Page) => page.evaluate(() => (window as any).__stage3d?.stats());
async function open3d(page: Page) {
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 30000 });
  await expect.poll(() => S(page).then((s) => s?.fixtures ?? -1), { timeout: 30000 }).toBeGreaterThan(-1);
}
const room = (page: Page) => page.evaluate(() => (window as any).__stage3d?.venue().group);

test('a moving head turns at a real head\'s speed: the whole way round takes it about two seconds, through the middle', async ({ page }) => {
  test.setTimeout(90_000);
  await openConnected(page);
  await patch(page, 'gen-mover8', 1, 0, 'Head');
  await open3d(page);
  const id = await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].id);
  const head = () => page.evaluate((id) => (window as any).__stage3d.head(id), id);
  const aim = (pan: number) => page.evaluate(([id, pan]) => { (window as any).__luxdmx.programmer[id as string] = { pan, tilt: 0.5, intensity: 1 }; }, [id, pan] as const);
  await aim(0);
  await expect.poll(async () => (await head())?.pan, { timeout: 15000 }).toBeCloseTo(-270, 0);
  // the whole way round (540°): sampled in the page as it goes (a busy machine draws the 3D less
  // often, and a look from outside comes late), it passes through the middle, not jumping there,
  // and takes a real head's time: 280°/s at most, about 2.1 s (a busy machine only makes it slower)
  const seen = await page.evaluate(async (id) => {
    const a = (window as any).__luxdmx, s = (window as any).__stage3d, out: { t: number; p: number }[] = [];
    a.programmer[id] = { pan: 1, tilt: 0.5, intensity: 1 };
    const t0 = performance.now();
    while (performance.now() - t0 < 12000) {
      await new Promise((r) => setTimeout(r, 30));
      const p = s.head(id)?.pan; out.push({ t: performance.now() - t0, p });
      if (p > 269) break;
    }
    return out;
  }, id);
  expect(seen.some(({ p }) => p > -265 && p < 200)).toBe(true);          // on its way at some point
  // (timed from the command to the first look that finds it there: a late look, a late start or a
  // slow frame only make that longer, so a head faster than a real one is the only way under it)
  const there = seen.find(({ p }) => p > 269);
  expect(there).toBeTruthy();
  expect(there!.t).toBeGreaterThan(1900);                                // not faster than a real head (~2.1 s)
  await expect.poll(async () => (await head())?.pan, { timeout: 15000 }).toBeCloseTo(270, 0);
});

test('switching Program, Timeline and Live hands the 3D world on; 2D lets it go', async ({ page }) => {
  test.setTimeout(120_000);
  await openConnected(page);
  await patch(page, 'gen-drgb', 2, 0, 'PAR');
  await open3d(page);
  const first = await room(page);
  expect(first).toBeTruthy();
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 30000 });
  await expect.poll(() => room(page), { timeout: 30000 }).toBe(first);
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 30000 });
  await expect.poll(() => room(page), { timeout: 30000 }).toBe(first);
  // 2D and back: the old one went back to the graphics chip, this is a new one
  await page.locator('.stage-wrap').getByRole('button', { name: '2D' }).click();
  await expect(page.locator('.s3')).toHaveCount(0);
  await open3d(page);
  await expect.poll(() => room(page), { timeout: 30000 }).not.toBe(first);
});

test('a light clicked in 3D is selected in the list too, scrolled into view', async ({ page }) => {
  test.setTimeout(90_000);
  await openConnected(page);
  await patch(page, 'gen-dimmer', 96, 0, 'D');
  await open3d(page);
  await expect.poll(() => S(page).then((s) => s?.fixtures), { timeout: 30000 }).toBe(96);
  const ids: string[] = await page.evaluate(() => (window as any).__luxdmx.show.fixtures.map((f: any) => f.id));
  const item = (id: string) => page.locator(`.fl li.oitem[data-id="${id}"]`);
  // (adding them selected all 96, and the list followed the last one: nothing selected, the list at its top)
  await page.evaluate(() => (window as any).__luxdmx.selectNone());
  await item(ids[0]).scrollIntoViewIfNeeded();
  await expect(item(ids[90])).not.toBeInViewport();          // (far down the list)
  const xy = await page.evaluate((id) => (window as any).__stage3d.screenOf(id), ids[90]);
  await page.mouse.click(xy.x, xy.y);
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.selected.length)).toBe(1);
  const picked: string = await page.evaluate(() => (window as any).__luxdmx.selected[0]);
  expect(ids.indexOf(picked)).toBeGreaterThan(70);           // one of the far ones (lights stand close in 3D)
  await expect(item(picked)).toHaveClass(/\bsel\b/);
  await expect(item(picked)).toBeInViewport();
});

test('the Haze slider acts at once, over its whole range', async ({ page }) => {
  test.setTimeout(90_000);
  await openConnected(page);
  await patch(page, 'gen-mover8', 1, 0, 'Head');
  await open3d(page);
  // (in the toolbar on a wide screen, under More on a narrow one: one of them is there once it's drawn)
  const slider = page.getByLabel('Haze in the air'), more = page.locator('.s3').getByRole('button', { name: 'More', exact: true });
  await expect(slider.or(more).first()).toBeVisible({ timeout: 30000 });
  if (!(await slider.isVisible())) { await more.click(); await expect(slider).toBeVisible(); }
  const haze = () => page.evaluate(() => (window as any).__stage3d.haze());
  await slider.fill('0');
  await expect.poll(haze, { timeout: 1000 }).toBeLessThan(0.15);
  await slider.fill('0.5');
  await expect.poll(haze, { timeout: 1000 }).toBeGreaterThan(0.4);
  await slider.fill('1');
  await expect.poll(haze, { timeout: 1000 }).toBeGreaterThan(0.85);
});

test('the drawing quality starts at High (glow on), and stays there while the DMX has its own thread', async ({ page }) => {
  await fresh(page);
  expect(await page.evaluate(() => (window as any).__luxload.quality)).toBe(2);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as any).__luxload.level)).toBe(2);
});

test('a pixel bar lit by an effect reads its real level; a Release says the effect goes on, and stops it', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-bar12', 1, 0, 'Bar');
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.addEffect('theater', { fixtures: [a.show.fixtures[0].id] }); a.selected = [a.show.fixtures[0].id]; });
  await expect(page.locator('.panel.prog')).toContainText(/out (100|[1-9]\d)%/);
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.release(a.show.cueLists[0]?.id); });
  const t = page.locator('.toast').filter({ hasText: 'keeps running' });
  await expect(t).toContainText('Theater');
  await t.getByRole('button', { name: 'Stop it' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.engine.liveEffects().length)).toBe(0);
});

test('the Ambient slider sets the room\'s own light: starts low, 0 is a dark venue, 1 a lit one', async ({ page }) => {
  test.setTimeout(90_000);
  await openConnected(page);
  await patch(page, 'gen-drgb', 1, 0, 'PAR');
  await open3d(page);
  const amb = () => page.evaluate(() => (window as any).__stage3d.ambient());
  // (its default: less than the room always had: 0.6 on the eye's curve)
  await expect.poll(async () => (await amb()).sky, { timeout: 10000 }).toBeCloseTo(0.35 * 1.25 * Math.pow(0.6, 2.2), 3);
  // the hall's walls and roof (unlit) go with it: near black at the default
  expect((await amb()).walls).toBeLessThan(0.04);
  // the dark end is fine-grained: a tenth of the slider from the bottom is under 1 % of the top
  await expect(page.getByLabel('Ambient light').or(page.locator('.s3').getByRole('button', { name: 'More', exact: true })).first()).toBeVisible({ timeout: 30000 });
  const slider = page.getByLabel('Ambient light'), more = page.locator('.s3').getByRole('button', { name: 'More', exact: true });
  await expect(slider.or(more).first()).toBeVisible({ timeout: 30000 });
  if (!(await slider.isVisible())) { await more.click(); await expect(slider).toBeVisible(); }
  await slider.fill('0.1');
  await expect.poll(async () => (await amb()).sky, { timeout: 5000 }).toBeLessThan(0.4375 * 0.01);
  await slider.fill('0');
  await expect.poll(amb, { timeout: 5000 }).toEqual({ sky: 0, key: 0, env: 0, walls: 0 });
  await slider.fill('1');
  await expect.poll(async () => (await amb()).sky, { timeout: 5000 }).toBeCloseTo(0.4375, 3);
  expect((await amb()).walls).toBeGreaterThan(0.1);
  // kept in this browser
  await page.reload();
  await open3d(page).catch(() => {});
  await expect.poll(async () => (await amb())?.sky, { timeout: 30000 }).toBeCloseTo(0.4375, 3);
});

test('the selection frame in 3D fades while the look is worked on, and is back on the stage, the lists or a new selection', async ({ page }) => {
  test.setTimeout(90_000);
  await openConnected(page);
  await patch(page, 'gen-mover8', 1, 0, 'Head');
  await patch(page, 'gen-mover8', 2, 0, 'Head');
  await open3d(page);
  await selectAll(page);
  const marks = () => page.evaluate(() => (window as any).__stage3d.marks() as { opacity: number; visible: boolean; framed: number });
  const shown = async () => { await expect.poll(async () => (await marks()).opacity, { timeout: 5000 }).toBeGreaterThan(0.85); expect((await marks()).framed).toBe(await page.evaluate(() => (window as any).__luxdmx.selected.length)); };
  const gone = () => expect.poll(async () => (await marks()).visible, { timeout: 5000 }).toBe(false);
  const canvas = page.locator('.stage-wrap canvas').first();
  await canvas.hover();
  await shown();
  // the programmer: the frame goes, so an effect or a colour shows as it is
  await page.locator('.panel.prog').hover();
  await gone();
  // onto the 3D stage: back
  await canvas.hover();
  await shown();
  // the effects list: gone; the fixture list: back
  await page.getByRole('tab', { name: 'Effects' }).click();
  await page.locator('.panel.ep').hover();
  await gone();
  await page.getByRole('tab', { name: 'Fixtures' }).click();
  await page.locator('.panel.fl').hover();
  await shown();
  // the keyboard counts too: Tab into the programmer
  await page.locator('.panel.prog button').first().focus();
  await gone();
  // a new selection shows it, wherever the pointer is
  await page.locator('.panel.prog').hover();
  await gone();
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.selectNone(); a.selectAll(); });
  await shown();
  // a Live page's stage is for looking: no frame there at all
  await page.getByRole('tab', { name: 'Live' }).click();
  await expect.poll(async () => (await marks()).framed, { timeout: 10000 }).toBe(0);
});

test('a channel set by hand under All channels moves the light on the stage too (pan, the dimmer), and letting go puts it back', async ({ page }) => {
  test.setTimeout(90_000);
  await openConnected(page);
  await patch(page, 'gen-mover8', 1, 0, 'Head');
  await open3d(page);
  await selectAll(page);
  await full(page);
  const id = await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].id);
  const head = () => page.evaluate((id) => (window as any).__stage3d.head(id)?.pan, id);
  const drawn = () => page.evaluate((id) => (window as any).__luxdmx.drawn[id], id);
  await expect.poll(head, { timeout: 15000 }).toBeCloseTo(0, 0);           // (pan in the middle)
  await page.getByText('All channels').click();
  const slider = (name: string) => page.locator(`#pg-all-ch input[type=range][aria-label="${name} value"]`);
  await slider('Pan').fill('255');
  await expect.poll(async () => (await channels(0, 1))[0]).toBe(255);       // on the wire
  await expect.poll(head, { timeout: 15000 }).toBeCloseTo(270, 0);         // and the 3D head all the way round
  expect((await drawn()).pan).toBe(1);                                      // (the plan draws it too)
  await slider('Dimmer').fill('0');
  await expect.poll(async () => (await drawn()).intensity).toBe(0);
  // letting go of pan: back to where the look has it
  await page.locator('#pg-all-ch .ch', { hasText: 'Pan' }).first().locator('button.x').click();
  await expect.poll(head, { timeout: 15000 }).toBeCloseTo(0, 0);
});

test('the Spill slider: how much the lights light up the room round them, lower than it was by default, 0 none, full as it was; remembered', async ({ page }) => {
  test.setTimeout(90_000);
  await openConnected(page);
  await patch(page, 'gen-mover8', 4, 0, 'Head');
  await open3d(page);
  await selectAll(page); await full(page);
  const spill = () => page.evaluate(() => (window as any).__stage3d.spill() as { spill: number; washes: number[] });
  const lit = async () => Math.max(...(await spill()).washes);
  expect((await spill()).spill).toBeCloseTo(0.45, 2);                      // (less than the full it always was)
  await expect.poll(lit, { timeout: 10000 }).toBeGreaterThan(0);
  const at45 = await lit();
  const slider = async (v: string) => {
    const s3 = page.locator('.s3'), input = s3.getByLabel('Spill from your lights');
    if (!(await input.isVisible())) await s3.getByRole('button', { name: 'More', exact: true }).click();
    await input.fill(v);
  };
  await slider('0');
  await expect.poll(lit).toBe(0);
  await slider('1');
  await expect.poll(lit).toBeGreaterThan(at45 * 1.8);
  await page.reload();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('luxdmx.seq.spill'))).toBe('1');
});

test('a beam as wide as the light\'s data says: a wash from the library 7° to 50° over its zoom; its own angle set in Mounting counts, cleared it\'s its type\'s again', async ({ page }) => {
  test.setTimeout(120_000);
  await openConnected(page);
  await patch(page, 'gen-wash', 1, 0, 'Wash');
  await open3d(page);
  await selectAll(page); await full(page);
  const id = await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].id);
  const beam = () => page.evaluate((id) => (window as any).__stage3d.beam(id), id);
  const zoom = (v: string) => page.locator('.prog input[type=range][aria-label="Zoom"]').fill(v);
  await zoom('0');
  await expect.poll(beam, { timeout: 10000 }).toBeCloseTo(7, 1);
  await zoom('1');
  await expect.poll(beam).toBeCloseTo(50, 1);
  // its own narrowest angle (the real one differs from its type)
  await page.locator('.fl li[data-fixture="Wash"]').dblclick();
  const dlg = page.getByRole('dialog', { name: 'Patch: Wash' });
  await dlg.getByRole('tab', { name: 'Mounting' }).click();
  await expect(dlg.getByLabel('Beam angle, narrowest')).toHaveAttribute('placeholder', '7 (its type)');
  await dlg.getByLabel('Beam angle, narrowest').fill('20');
  await dlg.getByLabel('Beam angle, narrowest').press('Tab');
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].beamDeg)).toEqual([20, 50]);
  await page.keyboard.press('Escape');
  await zoom('0');
  await expect.poll(beam).toBeCloseTo(20, 1);
  // cleared: its type's again
  await page.locator('.fl li[data-fixture="Wash"]').dblclick();
  await dlg.getByRole('tab', { name: 'Mounting' }).click();
  await dlg.getByLabel('Beam angle, narrowest').fill('');
  await dlg.getByLabel('Beam angle, narrowest').press('Tab');
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].beamDeg ?? null)).toBeNull();
  await page.keyboard.press('Escape');
  await expect.poll(beam).toBeCloseTo(7, 1);
});
