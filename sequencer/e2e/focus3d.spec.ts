// The camera to the selected lights: the 3D stage's "Selected", and "Show it in 3D" in a light's
// menu (it opens the 3D stage too). The light ends up in the middle of the picture, near enough to
// see, and grabbing the stage stops the flight.
import type { Page } from '@playwright/test';
import { openConnected, patch, startTemplate, test, expect } from './helpers';

// where a light is in the 3D picture, from the middle of it (0: the middle, 1: the edge)
const offCentre = (page: Page, name: string) => page.evaluate((name) => {
  const a = (window as any).__luxdmx, s = (window as any).__stage3d;
  const f = a.show.fixtures.find((x: any) => x.name === name), p = s.screenOf(f.id), r = document.querySelector('.s3 canvas')!.getBoundingClientRect();
  return Math.hypot((p.x - (r.left + r.width / 2)) / (r.width / 2), (p.y - (r.top + r.height / 2)) / (r.height / 2));
}, name);
const camTo = (page: Page, name: string) => page.evaluate((name) => {
  const a = (window as any).__luxdmx, s = (window as any).__stage3d, f = a.show.fixtures.find((x: any) => x.name === name);
  const c = s.internals.camera.position, t = s.internals.controls.target, p = s.screenOf(f.id);
  return { dist: Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z), flying: s.flying(), p };
}, name);

test('the camera flies to the selected lights: "Selected" on the 3D stage, "Show it in 3D" in a light\'s menu', async ({ page }) => {
  test.setTimeout(120_000);
  await openConnected(page);
  await patch(page, 'gen-mover8', 6, 0, 'Head');
  // from the fixture list, the 3D stage closed: it opens and the camera goes to the light
  await page.locator('.fl li[data-fixture="Head 5"]').click();
  await page.locator('.fl li[data-fixture="Head 5"]').click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: 'Show it in 3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45000 });
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d?.internals), { timeout: 30000 }).toBe(true);
  await expect.poll(() => camTo(page, 'Head 5').then((c) => c.flying), { timeout: 20000 }).toBe(false);
  await expect.poll(() => offCentre(page, 'Head 5'), { timeout: 20000 }).toBeLessThan(0.25);
  const near = await camTo(page, 'Head 5');
  expect(near.dist).toBeLessThan(8);                                      // (near: the hall's front view is 24 m off)
  // the front view, then "Selected" with two lights: both in the picture, their middle in its middle
  const cam = page.locator('.s3').getByRole('group', { name: 'Camera' });
  await cam.getByRole('button', { name: 'Front', exact: true }).click();
  await page.locator('.fl li[data-fixture="Head 1"]').click();
  await page.locator('.fl li[data-fixture="Head 2"]').click({ modifiers: ['Shift'] });
  await cam.getByRole('button', { name: 'Selected', exact: true }).click();
  await expect.poll(() => camTo(page, 'Head 1').then((c) => c.flying), { timeout: 20000 }).toBe(false);
  for (const n of ['Head 1', 'Head 2']) expect(await offCentre(page, n)).toBeLessThan(0.8);
  // nothing selected: nothing to fly to
  await page.locator('.stage-wrap').getByRole('button', { name: 'Select none' }).click();
  await expect(cam.getByRole('button', { name: 'Selected', exact: true })).toBeDisabled();
});

test('Measure on the 3D stage: two points and how far apart; one light: how high it hangs and where its beam lands; Esc clears', async ({ page }) => {
  test.setTimeout(120_000);
  await openConnected(page);
  await patch(page, 'gen-mover8', 1, 0, 'Head');
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d?.internals), { timeout: 45000 }).toBe(true);
  const s3 = page.locator('.s3'), canvas = s3.locator('canvas').first();
  await s3.getByRole('group', { name: 'Camera' }).getByRole('button', { name: 'Front', exact: true }).click();
  // (in the toolbar, or in More when the toolbar has no room for it: a head selected brings Calibrate)
  const inRow = s3.locator('.tools').getByRole('button', { name: 'Measure', exact: true });
  if (await inRow.count()) await inRow.click();
  else { await s3.getByRole('button', { name: 'More', exact: true }).click(); await s3.getByRole('group', { name: 'More for the 3D stage' }).getByRole('button', { name: 'Measure', exact: true }).click(); }
  await expect(s3.locator('.aimhint')).toContainText('Click two points');
  const said = () => page.evaluate(() => (window as any).__stage3d.measure());
  const box = (await canvas.boundingBox())!;
  // the light: where it is in the picture (a few tries round it: its body is small)
  const at = await page.evaluate(() => { const a = (window as any).__luxdmx; return (window as any).__stage3d.screenOf(a.show.fixtures[0].id); });
  let hit = false;
  for (const dy of [6, 10, 2, 14, -2]) {
    await page.mouse.click(at.x, at.y + dy);
    const m = await said();
    if (m?.a?.id) { hit = true; break; }
    await page.keyboard.press('Escape');
  }
  expect(hit).toBe(true);
  const one = await said();
  expect(one.said.big).toMatch(/^Head: \d+\.\d\d m above the (deck|floor)$/);
  expect(one.said.small).toMatch(/Its beam reaches the (deck|floor) \d+\.\d\d m away, \d+\.\d\d m wide there/);
  await expect(s3.locator('.meas')).toBeVisible();
  // a second point on the stage: the distance between the two, as the numbers say
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.6);       // (above the selected lights' panel)
  const two = await said();
  const d = Math.hypot(two.b.p.x - two.a.p.x, two.b.p.y - two.a.p.y, two.b.p.z - two.a.p.z);
  expect(two.said.big).toBe(`${d.toFixed(2)} m`);
  expect(two.said.small).toMatch(/^Head to the (deck|floor): \d+\.\d\d m across, \d+\.\d\d m down$/);
  await expect(s3.locator('.meas')).toContainText(`${d.toFixed(2)} m`);
  // Esc clears; another tool too
  await page.keyboard.press('Escape');
  await expect(s3.locator('.meas')).toHaveCount(0);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.6);
  await expect(s3.locator('.meas')).toBeVisible();
  await s3.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(s3.locator('.meas')).toHaveCount(0);
});

test('"Selected" never puts the camera inside the room\'s things: a cinema wall washer seen from a clear spot, not from inside the raked seats', async ({ page }) => {
  test.setTimeout(120_000);
  await openConnected(page);
  await startTemplate(page, 'Cinema');
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__stage3d?.venue?.()?.room), { timeout: 45000 }).toBe('cinema');
  const cam = page.locator('.s3').getByRole('group', { name: 'Camera' });
  for (const name of ['Wall 2', 'Wall 6', 'Step 3', 'House 3']) {
    await page.locator(`.fl li[data-fixture="${name}"]`).click();
    await cam.getByRole('button', { name: 'Selected', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__stage3d.flying()), { timeout: 20000 }).toBe(false);
    const where = await page.evaluate(async () => {
      const { blocked, spaceOf, castOf } = await import('/src/stage3d/director.ts');
      const { ROOMS } = await import('/src/stage3d/geometry.ts');
      const c = (window as any).__stage3d.internals.camera.position, r = ROOMS.cinema;
      return { in: Math.abs(c.x) < r.walls.x && c.z > r.walls.z0 && c.z < r.walls.z1 && c.y > 0 && c.y < r.ceiling, hit: blocked(spaceOf(r, castOf('cinema')), { x: c.x, y: c.y, z: c.z }) };
    });
    expect(where, name).toEqual({ in: true, hit: '' });
    expect(await offCentre(page, name), name).toBeLessThan(0.4);
  }
});

test('"Selected" on every light of the bar (a low room, a rail of lights under its ceiling): the camera always somewhere clear', async ({ page }) => {
  test.setTimeout(150_000);
  await openConnected(page);
  await startTemplate(page, 'Bar');
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__stage3d?.venue?.()?.room), { timeout: 45000 }).toBe('bar');
  const bad = await page.evaluate(async () => {
    const a = (window as any).__luxdmx, s3 = (window as any).__stage3d;
    const btn = [...document.querySelectorAll<HTMLButtonElement>('.s3 [role=group][aria-label=Camera] button')].find((b) => b.textContent?.trim() === 'Selected')!;
    const { blocked, spaceOf, castOf } = await import('/src/stage3d/director.ts');
    const { ROOMS } = await import('/src/stage3d/geometry.ts');
    const r = ROOMS.bar, sp = spaceOf(r, castOf('bar')), out: string[] = [];
    for (const f of a.show.fixtures) {
      a.selected = [f.id];
      await new Promise((x) => setTimeout(x, 60));
      btn.click();
      for (let k = 0; k < 40 && (k < 2 || s3.flying()); k++) await new Promise((x) => setTimeout(x, 50));
      const c = s3.internals.camera.position, hit = blocked(sp, { x: c.x, y: c.y, z: c.z });
      if (hit) out.push(`${f.name}: ${hit}`);
    }
    return out;
  });
  expect(bad).toEqual([]);
});

test('"Selected" on a boom in the theatre\'s wings: the camera sees the light, not the proscenium\'s wall in front of it', async ({ page }) => {
  test.setTimeout(120_000);
  await openConnected(page);
  await startTemplate(page, 'Theatre');
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__stage3d?.venue?.()?.room), { timeout: 45000 }).toBe('theatre');
  for (const name of ['Boom 2', 'Boom 4', 'Spot 1']) {
    await page.evaluate((n) => { const a = (window as any).__luxdmx; a.selected = [a.show.fixtures.find((f: any) => f.name === n).id]; }, name);
    await page.locator('.s3').getByRole('group', { name: 'Camera' }).getByRole('button', { name: 'Selected', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__stage3d.flying()), { timeout: 20000 }).toBe(false);
    const between = await page.evaluate(async (n) => {
      const { blocked, spaceOf, castOf } = await import('/src/stage3d/director.ts');
      const { ROOMS, pivotOf } = await import('/src/stage3d/geometry.ts');
      const a = (window as any).__luxdmx, f = a.show.fixtures.find((x: any) => x.name === n), c = pivotOf(f.p3, f.rot), cam = (window as any).__stage3d.internals.camera.position;
      const sp = spaceOf(ROOMS.theatre, castOf('theatre')), steps = 30;
      for (let i = 2; i < steps - 2; i++) { const t = i / steps, p = { x: cam.x + (c.x - cam.x) * t, y: cam.y + (c.y - cam.y) * t, z: cam.z + (c.z - cam.z) * t }; const b = blocked(sp, p); if (b === 'the proscenium' || b === 'the balcony' || b === 'the deck') return b; }
      return '';
    }, name);
    expect(between, name).toBe('');
  }
});
