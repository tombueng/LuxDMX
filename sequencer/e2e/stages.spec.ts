// The demos' stages: a DJ in a club, a house party under a square of truss, and the test truss.
// Each opens from its builder (src/content/demos.ts) on the fake box: the 3D stage builds its own
// room (a crowd and the DJ in the club and at the party, nobody in the test room), draws every
// light, its show puts light on the wire, and the live page has a button per machine and the fog.
// The test truss walks through its kinds, and its machines stay at 0 on the wire until armed
// (they fire from their one-shots, through the gate, like any other show's).
import type { Page } from '@playwright/test';
import { openConnected, resetFake, channels, history, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

// (the builder straight from the dev server's module, as the welcome will call it)
const start = (page: Page, id: string) => page.evaluate(async ([id, url]) => {
  const { DEMOS } = await import(url);
  await (window as any).__luxdmx.startShow(DEMOS.find((d: { id: string }) => d.id === id).build());
}, [id, '/src/content/demos.ts'] as const);
const venue = (page: Page) => page.evaluate(() => (window as any).__stage3d?.venue?.());
async function open3d(page: Page) {
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 30000 });
}

for (const [id, people] of [['club', true], ['party', true], ['truss', false]] as const) {
  test(`the ${id} demo: its own room in 3D, every light drawn, its show on the wire, a button per machine`, async ({ page }) => {
    test.setTimeout(150_000);
    await openConnected(page);
    await start(page, id);
    await open3d(page);
    await expect.poll(async () => (await venue(page))?.room, { timeout: 60000 }).toBe(id);
    const v = await venue(page);
    if (people) {
      expect(v.crowd).toBeGreaterThan(20);
      // the DJ booth's front shows the act: the band name, painted in place
      expect(v.band.surfaces.map((s: { what: string }) => s.what)).toEqual(['booth']);
      await page.evaluate(() => { (window as any).__luxdmx.show.settings.bandName = 'Night Owl'; });
      await expect.poll(async () => (await venue(page)).band.surfaces[0].shows).toBe('NIGHT OWL');
    } else expect(v.crowd).toBe(0);
    const n = await page.evaluate(() => (window as any).__luxdmx.show.fixtures.length);
    await expect.poll(() => page.evaluate(() => (window as any).__stage3d.stats().fixtures), { timeout: 20000 }).toBe(n);
    // the show plays (the demo beat): light on the wire, beams on the stage
    await page.evaluate(() => (window as any).__luxdmx.timeline.play());
    await expect.poll(async () => (await channels(0, 512)).some((x) => x > 0), { timeout: 20000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).__stage3d.stats().beams), { timeout: 20000 }).toBeGreaterThan(0);
    const hdr = await page.evaluate(() => (window as any).__stage3d.hdr(240));
    expect(hdr.nan).toBe(0); expect(hdr.over).toBe(0);
    // the live page: a button for each kind of machine in the rig, the fog
    const kinds = await page.evaluate(() => {
      const a = (window as any).__luxdmx;
      return ['confetti', 'co2', 'sparks', 'flame', 'bubbles'].filter((m) => a.show.fixtures.some((f: any) => a.modeOf(f.id)?.channels.some((c: any) => c.attr === m))).length;
    });
    await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
    await expect(page.locator('div.live')).toBeVisible();
    await expect(page.locator('.live [data-widget^="sfx-"]')).toHaveCount(kinds);
    await expect(page.locator('.live [data-widget="fog"]')).toHaveCount(1);
  });
}

test('the test truss: a cue per kind, and its machines wait for arming', async ({ page }) => {
  test.setTimeout(150_000);
  await openConnected(page);
  await start(page, 'truss');
  const rig = await page.evaluate(() => {
    const a = (window as any).__luxdmx, s = a.show, L = s.cueLists[0];
    const conf = s.fixtures.filter((f: any) => a.modeOf(f.id)?.channels.some((c: any) => c.attr === 'confetti'));
    return { list: L.id, names: L.cues.map((c: any) => c.name), confetti: conf.map((f: any) => ({ id: f.id, uni: f.universe, ch: f.address })),
      spot: s.fixtures.find((f: any) => f.name === 'Spot 1'), strip: s.fixtures.find((f: any) => f.name === 'Pixel strip 1') };
  });
  expect(rig.names).toContain('Spots: pan and tilt'); expect(rig.names).toContain('Washes: colour'); expect(rig.names).toContain('Confetti: one shot');
  const jump = (name: string) => page.evaluate(([l, i]) => (window as any).__luxdmx.jump(l, i), [rig.list, rig.names.indexOf(name)] as const);
  // the spots up: their dimmer on the wire (a spot's 6th channel), the strips on universe 1
  await jump('Spots: open white');
  await expect.poll(async () => (await channels(0, 512))[rig.spot.address - 1 + 5], { timeout: 15000 }).toBeGreaterThan(200);
  await jump('Pixel strips: rainbow');
  await expect.poll(async () => (await channels(1, 180)).filter((x) => x > 0).length, { timeout: 8000 }).toBeGreaterThan(30);
  // the confetti cue fires the cannons' one-shot: on the stage, but 0 on the wire, not armed
  const t0 = Date.now();
  await jump('Confetti: one shot');
  const onStage = () => page.evaluate((ids) => ids.map((id: string) => (window as any).__luxdmx.stage[id]?.confetti ?? 0), rig.confetti.map((c) => c.id));
  await expect.poll(onStage, { timeout: 4000 }).toEqual([1, 1]);
  await page.waitForTimeout(800);
  for (const c of rig.confetti) expect(Math.max(0, ...(await history(c.uni, c.ch)).filter(([at]) => at >= t0).map(([, x]) => x))).toBe(0);
  // armed (on stage, by a person): the next shot reaches the wire, and ends by itself
  await page.evaluate(() => (window as any).__luxdmx.armMachines(true));
  await jump('All off'); await page.waitForTimeout(400);
  const t1 = Date.now();
  await jump('Confetti: one shot');
  await expect.poll(async () => Math.max(0, ...(await history(rig.confetti[0].uni, rig.confetti[0].ch)).filter(([at]) => at >= t1).map(([, x]) => x)), { timeout: 5000 }).toBeGreaterThan(200);
  await expect.poll(async () => (await channels(rig.confetti[0].uni, 512))[rig.confetti[0].ch - 1], { timeout: 5000 }).toBe(0);
  await page.evaluate(() => (window as any).__luxdmx.armMachines(false));
});
