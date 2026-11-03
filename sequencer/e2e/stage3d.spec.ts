// The 3D stage: it opens next to the 2D one, shows the lights as they are (beams for lit lights),
// a click selects a light, Hang / On the deck mount the selection, Aim points the selected moving
// heads at the spot clicked (measured on the wire), and the effect machines throw particles.
// The page offers a small hook in dev (window.__stage3d) for what can't be read off pixels.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, channels, patch, selectAll, full, test, expect, demo } from './helpers';

test.beforeEach(async () => { await resetFake(); });

const s3 = (page: Page) => page.evaluate(() => (window as any).__stage3d?.stats());
async function open3d(page: Page) {
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 30000 });
  await expect.poll(() => s3(page).then((s) => s?.fixtures ?? -1), { timeout: 30000 }).toBeGreaterThan(-1);
}

test('the 3D stage opens, draws the rig, and lit lights have beams', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover8', 2, 0, 'Head');
  await patch(page, 'gen-drgb', 2, 0, 'PAR');
  await open3d(page);
  await expect.poll(() => s3(page).then((s) => s.fixtures)).toBe(4);
  expect((await s3(page)).beams).toBe(0);
  await selectAll(page); await full(page);
  await expect.poll(() => s3(page).then((s) => s.beams)).toBe(4);
  // back to 2D and in again: still there
  await page.locator('.stage-wrap').getByRole('button', { name: '2D' }).click();
  await expect(page.locator('.s3')).toHaveCount(0);
  await open3d(page);
});

test('a click selects a light; Hang and On the deck mount the selection', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 1, 0, 'PAR');
  await open3d(page);
  const xy = await page.evaluate(() => (window as any).__stage3d.screenOf((window as any).__luxdmx.show.fixtures[0].id));
  await page.mouse.click(xy.x, xy.y);
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.selected.length)).toBe(1);
  await page.locator('.s3 .sel').getByRole('button', { name: 'On the deck' }).click();
  expect(await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].p3.y)).toBeCloseTo(1.2, 2);
  await page.locator('.s3 .sel').getByRole('button', { name: 'Hang' }).click();
  expect(await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].p3.y)).toBeGreaterThan(6);
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].p3?.y)).toBeCloseTo(1.2, 2);
});

test('Aim: the selected moving heads point at the spot clicked, on the wire', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover8', 2, 0, 'Head');
  await open3d(page);
  await selectAll(page);
  const before = await channels(0, 2);
  await page.locator('.s3').getByRole('button', { name: 'Aim' }).click();
  const xy = await page.evaluate(() => (window as any).__stage3d.screenOfPoint({ x: 3, y: 1.2, z: 1 }));
  await page.mouse.click(xy.x, xy.y);
  await expect(page.locator('.toast')).toContainText('pointed there');
  await expect.poll(() => channels(0, 2)).not.toEqual(before);
  // the beam really goes there: the hook says where each head's beam meets the deck
  const miss = await page.evaluate(() => (window as any).__stage3d.aimError({ x: 3, y: 1.2, z: 1 }));
  expect(miss).toBeLessThan(0.15);
});

test('effect machines: a confetti cannon fires once per rise, sparks run while up', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-confetti', 1, 0, 'Confetti');
  await patch(page, 'gen-sparks', 1, 0, 'Sparks');
  await open3d(page);
  expect((await s3(page)).particles).toBe(0);
  await page.evaluate(() => { const a = (window as any).__luxdmx; for (const f of a.show.fixtures) a.programmer[f.id] = f.name.startsWith('Confetti') ? { confetti: 1 } : { sparks: 1 }; });
  await expect.poll(() => s3(page).then((s) => s.particles), { timeout: 8000 }).toBeGreaterThan(500);
  // on the wire too: the cannon's channel and the sparks' height
  // the machines are safe until armed: 0 on the wire, the 3D stage shows them all the same
  await page.waitForTimeout(500);
  expect(await channels(0, 2)).toEqual([0, 0]);
  await page.evaluate(() => (window as any).__luxdmx.armMachines(true));
  // (they were on before arming: they wait until they have been off, then fire)
  await page.waitForTimeout(400);
  expect(await channels(0, 2)).toEqual([0, 0]);
  const set = (v: number) => page.evaluate((v) => { const a = (window as any).__luxdmx; for (const f of a.show.fixtures) a.programmer[f.id] = f.name.startsWith('Confetti') ? { confetti: v } : { sparks: v }; }, v);
  await set(0); await page.waitForTimeout(200); await set(1);
  await expect.poll(() => channels(0, 2)).toEqual([255, 255]);
});

test('a fog machine blasts towards the band: thousands of puffs, travelling upstage from the nozzle', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-fog', 1, 0, 'Fog');
  // down at the front, right of centre (where the plan puts a machine): its own place in 3D faces the band
  await page.evaluate(() => { const f = (window as any).__luxdmx.show.fixtures[0]; f.x = 0.72; f.y = 0.96; delete f.p3; delete f.rot; });
  await open3d(page);
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.programmer[a.show.fixtures[0].id] = { fog: 1 }; });
  await expect.poll(() => channels(0, 1)).toEqual([255]);
  // 390 puffs a second at full (by the clock: a slow software renderer gets as many),
  // and the cloud moves off the nozzle towards the drum riser
  await expect.poll(() => s3(page).then((s) => s.fog.count), { timeout: 15000 }).toBeGreaterThan(800);
  const fog = await page.evaluate(() => (window as any).__stage3d.stats().fog);
  expect(fog.z).toBeLessThan(3.2);                                       // the machine is at z 4.1, the band at -1.6
  expect(fog.x).toBeLessThan(2.6);                                       // and it heads in, towards the middle
});

test('fog rolls back out towards the audience, fills the room, and is gone about half a minute after the machine stops', async ({ page }) => {
  test.setTimeout(150_000);
  await openConnected(page);
  await patch(page, 'gen-fog', 1, 0, 'Fog');
  await page.evaluate(() => { const f = (window as any).__luxdmx.show.fixtures[0]; f.x = 0.72; f.y = 0.96; delete f.p3; delete f.rot; });
  await open3d(page);
  type Fog = { count: number; room: number; x: number; z: number };
  const fog = (): Promise<Fog> => page.evaluate(() => (window as any).__stage3d.stats().fog);
  const set = (v: number) => page.evaluate((v) => { const a = (window as any).__luxdmx; a.programmer[a.show.fixtures[0].id] = { fog: v }; }, v);
  // a 3 s burst
  await set(1);
  await expect.poll(() => fog().then((f) => f.count), { timeout: 15000 }).toBeGreaterThan(300);
  await page.waitForTimeout(3000);
  await set(0);
  const stopped = Date.now();
  // the jet has gone (it lasts a second or so): what's left is the cloud, carried up near the band
  await expect.poll(() => fog().then((f) => f.count), { timeout: 10000 }).toBeLessThan(400);
  await page.waitForTimeout(1500);
  const landed = await fog();
  expect(landed.z).toBeLessThan(1.5);
  // it spreads and drifts back out over the stage towards the audience, and the room gets foggy
  await expect.poll(() => fog().then((f) => f.z), { timeout: 40000 }).toBeGreaterThan(landed.z + 1.2);
  expect((await fog()).room).toBeGreaterThan(0.03);
  // and it's gone: nothing left, the room clear again, within 40 s of the stop (by the 3D stage's clock)
  await expect.poll(() => fog().then((f) => f.count), { timeout: 60000, intervals: [1000] }).toBe(0);
  expect((await fog()).room).toBe(0);
  expect(Date.now() - stopped).toBeGreaterThan(25000);                  // (not popped away early)
});

test('the picture stays finite while the big demo plays: no NaN, nothing past the half-float buffers', async ({ page }) => {
  // (a NaN or an overflow there is what the bloom smears into big black blocks)
  test.setTimeout(120_000);
  await openConnected(page);
  await demo(page);
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 30000 });
  // (the demo starts with its intro before the song: from the song's start here)
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(0));
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.position), { timeout: 15000 }).toBeGreaterThan(2);
  for (const v of ['front', 'foh', 'side', 'top', 'band', 'front']) {
    const h = await page.evaluate((v) => { const S = (window as any).__stage3d; S.internals.view(v); return S.hdr(200); }, v);
    expect(h, v).toMatchObject({ nan: 0, over: 0 });
    expect(h.max, `${v}: the picture was read (not all zeros)`).toBeGreaterThan(0.01);
    await page.waitForTimeout(700);
  }
});

test('Calibrate: the real head points at a spot, a click there sets its offsets, and the model agrees', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover8', 1, 0, 'Head');
  await open3d(page);
  await selectAll(page);
  // "the real head" points somewhere the model doesn't expect (the pad set by hand)
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.programmer[a.show.fixtures[0].id] = { intensity: 1, pan: 0.42, tilt: 0.71 }; });
  await page.locator('.s3').getByRole('button', { name: 'Calibrate' }).click();
  const spot = { x: -1.5, y: 1.2, z: 1.2 };
  const xy = await page.evaluate((p) => (window as any).__stage3d.screenOfPoint(p), spot);
  await page.mouse.click(xy.x, xy.y);
  await expect(page.locator('.toast')).toContainText('calibrated');
  const f = await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0]);
  expect(Math.abs(f.panOffset ?? 0) + Math.abs(f.tiltOffset ?? 0)).toBeGreaterThan(0);
  expect(await page.evaluate((p) => (window as any).__stage3d.aimError(p), spot)).toBeLessThan(0.25);
});

test('a selection in 3D: one height for all, − / + turns each by a step, "mixed" when they differ', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 3, 0, 'PAR');
  await open3d(page);
  await selectAll(page);
  const panel = page.locator('.s3 .sel');
  const height = panel.getByLabel('Height m', { exact: true });
  await height.fill('5'); await height.press('Enter');
  const fx = () => page.evaluate(() => (window as any).__luxdmx.show.fixtures.map((f: any) => f.p3 && [f.p3.y, f.rot.yaw]));
  await expect.poll(async () => (await fx()).map((v: number[]) => v[0])).toEqual([5, 5, 5]);
  const yaw0 = (await fx()).map((v: number[]) => v[1]);
  await panel.getByRole('button', { name: 'Turn ° more' }).click();
  expect((await fx()).map((v: number[]) => v[1])).toEqual(yaw0.map((y: number) => Math.round((y + 5) * 10) / 10));
  // the X of three lights in a row differs: the field says so
  await expect(panel.getByLabel('X m', { exact: true })).toHaveValue('');
  await expect(panel.getByLabel('X m', { exact: true })).toHaveAttribute('placeholder', 'mixed');
  await page.keyboard.press('Control+z');
  expect((await fx()).map((v: number[]) => v[1])).toEqual(yaw0);
});

test('Aim turns fixed lights to face the spot (their beams go there)', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 2, 0, 'PAR');
  await open3d(page);
  await selectAll(page);
  await page.locator('.s3').getByRole('button', { name: 'Aim' }).click();
  const spot = { x: 2, y: 1.2, z: 0.5 };
  const xy = await page.evaluate((p) => (window as any).__stage3d.screenOfPoint(p), spot);
  await page.mouse.click(xy.x, xy.y);
  await expect(page.locator('.toast')).toContainText('turned to face it');
  // each PAR's up (its beam) points from where it hangs to the spot
  const miss = await page.evaluate((p) => (window as any).__luxdmx.show.fixtures.map((f: any) => {
    const R = Math.PI / 180, y = f.rot.yaw * R, pt = f.rot.pitch * R;
    const d = { x: Math.sin(pt) * Math.sin(y), y: Math.cos(pt), z: Math.sin(pt) * Math.cos(y) }, k = (p.y - f.p3.y) / d.y;
    return Math.hypot(f.p3.x + d.x * k - p.x, f.p3.z + d.z * k - p.z);
  }), spot);
  for (const m of miss) expect(m).toBeLessThan(0.1);
});

test('your own venue: a .glb loads into the 3D stage, the built-in stage can go', async ({ page }) => {
  await openConnected(page);
  await open3d(page);
  await page.locator('.s3').getByRole('button', { name: 'Venue' }).click();
  // a tiny but real glTF binary: one triangle, 2000 units across (millimetres: scaled down)
  const json = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [3000, 2500, 0] }] });
  const jb = Buffer.from(json + ' '.repeat((4 - (json.length % 4)) % 4)), bin = Buffer.from(new Float32Array([0, 0, 0, 3000, 0, 0, 0, 2500, 0]).buffer);
  const glb = Buffer.concat([Buffer.from(new Uint32Array([0x46546c67, 2, 12 + 8 + jb.length + 8 + bin.length]).buffer), Buffer.from(new Uint32Array([jb.length, 0x4e4f534a]).buffer), jb, Buffer.from(new Uint32Array([bin.length, 0x004e4942]).buffer), bin]);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.s3 .venue').getByRole('button', { name: /Load a 3D model/ }).click();
  await (await chooser).setFiles({ name: 'hall.glb', mimeType: 'model/gltf-binary', buffer: glb });
  await expect(page.locator('.toast')).toContainText('"hall.glb" is in the 3D stage (scaled 0.001');
  const m = await page.evaluate(() => (window as any).__luxdmx.show.settings.stage3d.model);
  expect(m).toMatchObject({ name: 'hall.glb', scale: 0.001, y: 0 });
  await page.locator('.s3 .venue').getByLabel('The built-in stage').uncheck();
  expect(await page.evaluate(() => (window as any).__luxdmx.show.settings.stage3d.hideVenue)).toBe(true);
});

test('a reload keeps the 3D view where it was, and the song playing on from where it would be', async ({ page }) => {
  test.setTimeout(90_000);
  await openConnected(page);
  await demo(page);
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 30000 });
  // (the demo starts with its intro before the song: from the song's start here)
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(0));
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.position), { timeout: 15000 }).toBeGreaterThan(2);
  // somewhere unusual: from the side, low down
  await page.evaluate(() => { const { camera, controls } = (window as any).__stage3d.internals; camera.position.set(-9, 2.5, 6); controls.target.set(1, 2, -1); controls.update(); controls.dispatchEvent({ type: 'change' }); });
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => (window as any).__luxdmx.timeline.position);
  await page.reload();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => { const p = (window as any).__stage3d?.internals.camera.position; return p ? Math.hypot(p.x + 9, p.y - 2.5, p.z - 6) : 99; }), { timeout: 15000 }).toBeLessThan(0.3);
  // still playing, further on than before the reload (not back at 0:00)
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.playing), { timeout: 8000 }).toBe(true);
  expect(await page.evaluate(() => (window as any).__luxdmx.timeline.position)).toBeGreaterThan(before);
});
