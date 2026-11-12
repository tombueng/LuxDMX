// Gobos in 3D: every pattern of the set is drawn (the symbol fonts that come with the app are in:
// none comes out empty), a head's gobo wheel shows the pattern its slot's name says (Stars, Flower;
// "Gobo 4" a pattern of its own; Open none), picked by name in the programmer and on the wire, and
// its rotation channel turns the pattern (an index range a fixed angle, a CW range on and on).
// Read through the dev hook window.__stage3d, not off the pixels.
import type { Page } from '@playwright/test';
import { GOBOS } from '../src/stage3d/gobos';
import { channels, fresh, full, openConnected, patch, resetFake, selectAll, test, welcomeDialog, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });
test.describe.configure({ timeout: 120_000 });

async function open3d(page: Page) {
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d?.venue), { timeout: 15000 }).toBe(true);
}
const idOf = (id: string) => GOBOS.findIndex((g) => g.id === id);
const sec = (page: Page, name: string) => page.locator('.prog').getByRole('region', { name, exact: true });

test('the gobo set is drawn whole, and a head shows the pattern its slot\'s name says, turning as its rotation channel says', async ({ page }) => {
  // (the beam and floor shaders with the gobo in them compile: WebGL only says so in the console)
  const shaderErrors: string[] = [];
  page.on('console', (m) => { if (/shader|WebGLProgram|GL_INVALID|glsl/i.test(m.text()) && m.type() !== 'debug') shaderErrors.push(m.text().slice(0, 300)); });
  await openConnected(page);
  await page.evaluate(() => {
    const a = (window as any).__luxdmx;
    a.addType({ id: 'Gobo Spot', manufacturer: 'Acme', model: 'Gobo Spot', source: 'user', modes: [{ name: '6 ch', channels: [
      { name: 'Pan', attr: 'pan' }, { name: 'Tilt', attr: 'tilt' }, { name: 'Dimmer', attr: 'intensity' },
      { name: 'Gobo', attr: 'gobo', ranges: [{ from: 0, to: 9, label: 'Open', kind: 'slot' }, { from: 10, to: 19, label: 'Stars', kind: 'slot' }, { from: 20, to: 29, label: 'Flower', kind: 'slot' }, { from: 30, to: 39, label: 'Gobo 4', kind: 'slot' }] },
      { name: 'Gobo rotation', attr: 'goboRotation', ranges: [{ from: 0, to: 63, label: 'Index 0..360deg' }, { from: 64, to: 255, label: 'Rotation slow CW..fast CW' }] },
      { name: 'Frost', attr: 'frost' },
    ] }] });
    a.show.fixtures.push({ id: 'gs', name: 'Gobo Spot', typeId: 'Gobo Spot', mode: '6 ch', universe: 0, address: 1, x: 0.5, y: 0.3 });
    a.checkpoint();
  });
  await open3d(page);
  // the whole set, nothing empty (the symbols came from the fonts that come with the app)
  await expect.poll(() => page.evaluate(() => (window as any).__stage3d.gobos()), { timeout: 15000 }).toEqual({ count: GOBOS.length, empty: [], size: 1408 });
  await selectAll(page); await full(page);
  const gobo = () => page.evaluate(() => (window as any).__stage3d.gobo('gs'));
  // the buttons show the patterns too: Stars drawn (its middle lit), Open an empty circle (its middle dark)
  const middle = (name: string) => sec(page, 'Gobo').getByRole('button', { name, exact: true }).locator('canvas.gi').evaluate((c: HTMLCanvasElement) => {
    if (!c.width) return -1;
    return c.getContext('2d')!.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data[0];
  });
  await expect.poll(() => middle('Stars')).toBeGreaterThan(200);
  await expect.poll(() => middle('Open')).toBe(0);
  await sec(page, 'Gobo').getByRole('button', { name: 'Stars' }).click();
  await expect.poll(async () => (await channels(0, 4))[3]).toBe(15);                 // the middle of "Stars" on the wire
  await expect.poll(async () => (await gobo())?.cells[0]).toBe(idOf('stars'));
  await sec(page, 'Gobo').getByRole('button', { name: 'Flower' }).click();
  await expect.poll(async () => (await gobo())?.cells[0]).toBe(idOf('flower'));
  await sec(page, 'Gobo').getByRole('button', { name: 'Gobo 4' }).click();
  const g4 = await expect.poll(async () => (await gobo())?.cells[0]).not.toBe(idOf('flower')).then(async () => (await gobo())!.cells[0]);
  expect(g4).toBeGreaterThanOrEqual(0);
  expect([idOf('stars'), idOf('flower')]).not.toContain(g4);
  await sec(page, 'Gobo').getByRole('button', { name: 'Open' }).click();
  await expect.poll(async () => (await gobo())?.cells[0]).toBe(-1);
  // rotation: an index range is an angle, a CW range turns it on
  await sec(page, 'Gobo').getByRole('button', { name: 'Stars' }).click();
  await page.getByText('All channels').click();
  const rot = page.locator('#pg-all-ch input[type=range][aria-label="Gobo rotation value"]');
  await rot.fill('32');
  await expect.poll(async () => (await gobo())?.turn[0], { timeout: 10000 }).toBeCloseTo((32 / 63) * Math.PI * 2, 1);
  await rot.fill('200');
  const a0 = (await gobo())!.turn[0];
  await expect.poll(async () => Math.abs((await gobo())!.turn[0] - a0), { timeout: 10000 }).toBeGreaterThan(0.3);
  // two frames with the gobo beam drawn, then no shader complained
  await page.waitForTimeout(500);
  expect(shaderErrors).toEqual([]);
});

test('a profile spot as touring rigs have it: glass gobos, prisms that turn, the animation wheel, a gobo shaking, the wheel running round, iris and focus', async ({ page }) => {
  const shaderErrors: string[] = [];
  page.on('console', (m) => { if (/shader|WebGLProgram|GL_INVALID|glsl/i.test(m.text()) && m.type() !== 'debug') shaderErrors.push(m.text().slice(0, 300)); });
  await openConnected(page);
  await patch(page, 'gen-profile', 1, 0, 'Profile');
  await open3d(page);
  await expect.poll(() => page.evaluate(() => (window as any).__stage3d.gobos()?.empty), { timeout: 15000 }).toEqual([]);
  await selectAll(page); await full(page);
  const id = await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].id);
  const gobo = () => page.evaluate((id) => (window as any).__stage3d.gobo(id), id);
  const prog = page.locator('.prog');
  const ranges = (name: string) => prog.getByRole('group', { name: `${name}: ranges`, exact: true });
  const dmx = async (ch: number) => (await channels(0, 22))[ch];
  // a glass gobo on the fixed wheel (its button shows it in colour)
  await sec(page, 'Gobo 2').getByRole('button', { name: 'Rainbow glass' }).click();
  await expect.poll(async () => (await gobo())?.cells[1]).toBe(idOf('rainbow'));
  // the prisms, from the prism channel's ranges: 3 round, 5 in a line, 8 round; on the wire their middles
  await ranges('Prism').getByRole('button', { name: '3-facet prism' }).click();
  await expect.poll(async () => (await gobo())?.prism).toMatchObject({ facets: 3, linear: false });
  await ranges('Prism').getByRole('button', { name: '5-facet linear prism' }).click();
  await expect.poll(async () => (await gobo())?.prism).toMatchObject({ facets: 5, linear: true });
  expect(await dmx(16)).toBe(130);
  await ranges('Prism').getByRole('button', { name: '8-facet prism' }).click();
  await expect.poll(async () => (await gobo())?.prism?.facets).toBe(8);
  // turning: an index is an angle, CW turns it on
  await ranges('Prism rotation').getByRole('button', { name: 'Rotation CW fast..slow' }).click();
  const p0 = (await gobo())!.prism.turn;
  await expect.poll(async () => Math.abs((await gobo())!.prism.turn - p0), { timeout: 10000 }).toBeGreaterThan(0.2);
  await ranges('Prism').getByRole('button', { name: 'Open' }).click();
  await expect.poll(async () => (await gobo())?.prism).toBeNull();
  // the animation wheel in, running
  await ranges('Animation wheel').getByRole('button', { name: 'In (how far)' }).click();
  await expect.poll(async () => (await gobo())?.anim).toBeGreaterThan(0.4);
  // a gobo shaking: Stars, then Shake (its shake range on the wire), then back to Stars
  await sec(page, 'Gobo').getByRole('button', { name: 'Stars' }).click();
  const wheel = prog.getByRole('group', { name: 'Gobo: shake and wheel' });
  await wheel.getByRole('button', { name: 'Shake' }).click();
  await expect.poll(async () => (await gobo())?.shake[0]).toBeGreaterThan(0);
  expect((await gobo())!.cells[0]).toBe(idOf('stars'));
  await expect.poll(() => dmx(11)).toBeGreaterThanOrEqual(72 + 3 * 15);       // Shake 5 (Stars): from 117
  await wheel.getByRole('button', { name: 'Shake' }).click();
  await expect.poll(async () => (await gobo())?.shake[0]).toBe(0);
  await expect.poll(() => dmx(11)).toBe(36);                                  // Stars again (the middle of 32..39)
  // the whole wheel running round: the gobo it shows changes as it goes
  await wheel.getByRole('button', { name: 'Wheel ↻' }).click();
  const seen = new Set<number>();
  await expect.poll(async () => { seen.add((await gobo())!.cells[0]); return seen.size; }, { timeout: 15000 }).toBeGreaterThanOrEqual(3);
  await wheel.getByRole('button', { name: 'Wheel ↻' }).click();
  await expect.poll(async () => (await gobo())?.cells[0]).toBe(idOf('stars'));
  // the iris narrows it; the focus is sharp only at one throw (the same throw: 0 and 1 differ)
  await prog.locator('input[type=range][aria-label="Iris"]').fill('0.8');
  await expect.poll(async () => (await gobo())?.iris).toBeCloseTo(0.8, 1);
  await prog.locator('input[type=range][aria-label="Focus"]').fill('0');
  await expect.poll(async () => (await gobo())?.soft).toBeGreaterThanOrEqual(0);
  const s0 = (await gobo())!.soft;
  await prog.locator('input[type=range][aria-label="Focus"]').fill('1');
  await expect.poll(async () => Math.abs((await gobo())!.soft - s0)).toBeGreaterThan(0.2);
  await page.waitForTimeout(500);
  expect(shaderErrors).toEqual([]);
});

// The demos wear their gobos: the festival's beams open the show on Dots, the test truss starts on
// its profile spots' Stars and has a cue for each gobo thing (a prism here)
test('the demos use gobos: the festival from its first look, the test truss with a cue for each gobo thing', async ({ page }) => {
  test.setTimeout(240_000);
  const start = async (name: string, music: boolean) => {
    await fresh(page, true);
    const w = welcomeDialog(page);
    await w.getByRole('radio', { name }).click();
    if (music) await w.getByLabel("The demo's music").selectOption('beat');
    await w.getByRole('button', { name: 'Show me a demo' }).click();
    await expect(w).toBeHidden({ timeout: 30000 });
    // (the demo opens on the timeline; its show plays on while the Program view shows the stage)
    await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
    if (!(await page.locator('.s3 canvas:visible').count())) await page.locator('.stage-wrap:visible').getByRole('button', { name: '3D' }).first().click();
    await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d?.gobos()), { timeout: 60000 }).toBe(true);
  };
  const goboOf = (name: string) => page.evaluate((name) => { const a = (window as any).__luxdmx, f = a.show.fixtures.find((x: any) => x.name === name); return (window as any).__stage3d.gobo(f.id); }, name);
  await start('Test truss', false);
  await expect.poll(async () => (await goboOf('Profile 1'))?.cells[0], { timeout: 60000 }).toBe(idOf('stars'));
  await page.evaluate(() => { const a = (window as any).__luxdmx, l = a.show.cueLists[0]; a.engine.jumpTo(l.id, l.cues.findIndex((c: any) => c.name === 'Profiles: 3-facet prism turning')); });
  await expect.poll(async () => (await goboOf('Profile 1'))?.prism?.facets, { timeout: 30000 }).toBe(3);
  await start('Festival stage', true);
  await expect.poll(async () => (await goboOf('Beam 1'))?.cells[0], { timeout: 60000 }).toBe(idOf('dots'));
});

// Turning backwards (CCW) shows as backwards: the gobo and the prism of the generic gobo spot, each
// by its rotation channel's ranges (index, CW, stop, CCW). The way it turns is read from two looks a
// moment apart (the angle wraps round at a full turn).
test('the gobo spot turns its gobo and its prism either way, and the 3D stage shows which way', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-spotgobo', 1, 0, 'Spot');
  await open3d(page);
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d.gobos()), { timeout: 30000 }).toBe(true);
  await selectAll(page); await full(page);
  const id = await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].id);
  const gobo = () => page.evaluate((id) => (window as any).__stage3d.gobo(id), id);
  const ranges = (name: string) => page.locator('.prog').getByRole('group', { name: `${name}: ranges`, exact: true });
  // which way it turns: + clockwise, - the other way (from two looks 400 ms apart)
  const way = async (read: (g: any) => number) => {
    const a = read(await gobo()); await page.waitForTimeout(400); const b = read(await gobo());
    const d = ((b - a + 3 * Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return Math.sign(Math.round(d * 100));
  };
  await sec(page, 'Gobo').getByRole('button', { name: 'Star' }).click();
  await ranges('Gobo rotation').getByRole('button', { name: 'Rotation CCW slow..fast' }).click();
  await expect.poll(() => way((g) => g.turn[0]), { timeout: 10000 }).toBe(-1);
  await ranges('Gobo rotation').getByRole('button', { name: 'Rotation CW fast..slow' }).click();
  await expect.poll(() => way((g) => g.turn[0]), { timeout: 10000 }).toBe(1);
  await ranges('Gobo rotation').getByRole('button', { name: 'Stop' }).click();
  await expect.poll(() => way((g) => g.turn[0]), { timeout: 10000 }).toBe(0);
  // the prism in (a plain channel: three round), turning backwards, then forwards
  await page.locator('.prog input[type=range][aria-label="Prism"]').fill('1');
  await expect.poll(async () => (await gobo())?.prism?.facets).toBe(3);
  await ranges('Prism rotation').getByRole('button', { name: 'Rotation CCW slow..fast' }).click();
  await expect.poll(() => way((g) => g.prism.turn), { timeout: 10000 }).toBe(-1);
  await ranges('Prism rotation').getByRole('button', { name: 'Rotation CW fast..slow' }).click();
  await expect.poll(() => way((g) => g.prism.turn), { timeout: 10000 }).toBe(1);
});
