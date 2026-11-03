// The venue in 3D: a hall round the stage (the picture never drops to black when the lights go
// out), an audience of a few hundred people with their arms, phones and flags, the gear on stage,
// FOH and the follow spots, the crowd's shaders compiled, and all of it in a few dozen draws
// (everything that never moves is baked). Read through the dev hook window.__stage3d.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, test, expect, demo } from './helpers';

test.beforeEach(async () => { await resetFake(); });

async function open3d(page: Page) {
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => (window as any).__stage3d?.stats().fixtures ?? -1), { timeout: 20000 }).toBeGreaterThan(-1);
}
// what the venue is made of, and one frame drawn from a view: draws, and how much of the picture is black
const look = (page: Page, view: string) => page.evaluate((view) => {
  const { scene, renderer, camera, view: go } = (window as any).__stage3d.internals;
  go(view);
  const venue = scene.children.find((c: any) => c.children?.some((m: any) => m.name === 'baked'));
  const crowd = venue.children.find((c: any) => c.children?.some((m: any) => m.isInstancedMesh));
  const parts: Record<string, number> = {};
  for (const m of crowd.children) parts[m.name.replace('crowd ', '')] = m.count;
  renderer.info.autoReset = false; renderer.info.reset();
  renderer.render(scene, camera);
  const calls = renderer.info.render.calls; renderer.info.autoReset = true;
  const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let black = 0; for (let i = 0; i < px.length; i += 4) if (Math.max(px[i], px[i + 1], px[i + 2]) <= 8) black++;
  return { parts, baked: venue.children.filter((m: any) => m.name === 'baked').length, calls, black: black / (w * h) };
}, view);

test('the venue: a hall round the stage, a crowd of people, the gear, in a few dozen draws', async ({ page }) => {
  test.setTimeout(120_000);
  const shaderErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && /shader|program/i.test(m.text())) shaderErrors.push(m.text().slice(0, 300)); });
  await openConnected(page);
  // (the room's own light all the way up: by default it's a dark venue, the walls near black)
  await page.evaluate(() => localStorage.setItem('luxdmx.seq.ambient2', '1'));
  await open3d(page);
  const front = await look(page, 'front');
  // the crowd: bodies, heads, hair, hats, arms in their poses, phones, flags (420 people with a
  // graphics chip; this browser draws in software and gets a smaller crowd)
  expect(front.parts.torso).toBeGreaterThan(140);
  expect(front.parts.head).toBe(front.parts.torso);
  for (const k of ['legs', 'hair:short', 'hair:long', 'hat:cap', 'hat:beanie', 'arm:down:L', 'arm:up:R', 'phone:R', 'cloth:band', 'pole', 'arm:flag:L', 'legs:sit']) expect(front.parts[k], k).toBeGreaterThan(0);
  // ten flags, most of them the band's banner (their shaders wave them: no shader error below)
  expect(front.parts.pole).toBe(10);
  expect(front.parts['cloth:band']).toBeGreaterThan(front.parts.cloth ?? 0);
  // what never moves is in a few dozen meshes; a frame of the whole venue is a couple of hundred draws
  expect(front.baked).toBeGreaterThan(20);
  expect(front.baked).toBeLessThan(70);
  expect(front.calls).toBeLessThan(330);
  // no lights on, Ambient at 1: the hall still shows (walls, floor, the deck), not a black hole
  expect(front.black, 'black share of the front view, lights off').toBeLessThan(0.25);
  const top = await look(page, 'top');
  // from above you look into the hall through its roof
  expect(top.black).toBeLessThan(0.5);
  expect(shaderErrors).toEqual([]);
});

test('the crowd moves with the music: its shaders get the beat and the energy of the lights', async ({ page }) => {
  test.setTimeout(120_000);
  await openConnected(page);
  await demo(page);
  // (the big demo takes a while to open in the test browser, which draws without a graphics chip)
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45000 });
  // (the demo starts with its intro before the song: from the song's start here)
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(0));
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.position), { timeout: 15000 }).toBeGreaterThan(2);
  const motion = () => page.evaluate(() => {
    const m = (window as any).__stage3d.internals.scene.getObjectByName('crowd torso').material.userData.motion;
    return { beat: m.uBeat.value, energy: m.uEnergy.value, beatLen: m.uBeatLen.value, t: m.uTime.value };
  });
  const a = await motion();
  await page.waitForTimeout(3000);
  const b = await motion();
  // the beat runs on, and the crowd knows how long a beat takes (as the frames see it: in this
  // browser, drawing in software, the frames are far apart and the beat runs slower)
  expect(b.beat).toBeGreaterThan(a.beat + 1);
  const seen = (b.t - a.t) / (b.beat - a.beat);
  expect(Math.abs(b.beatLen - seen) / seen).toBeLessThan(0.4);
  await expect.poll(async () => (await motion()).energy, { timeout: 10000 }).toBeGreaterThan(0.05);
});

test("the LED screens beside the stage show the Broadcast camera, live; switched off in the Venue panel they show the band's name", async ({ page }) => {
  test.setTimeout(120_000);
  const shaderErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && /shader|program/i.test(m.text())) shaderErrors.push(m.text().slice(0, 300)); });
  await openConnected(page);
  await open3d(page);
  const scr = () => page.evaluate(() => (window as any).__stage3d.screens());
  await expect.poll(async () => (await scr())?.frames ?? 0, { timeout: 30000 }).toBeGreaterThan(5);
  const on = await scr();
  expect(on.live).toBe(true);
  expect(on.shot).not.toBe('');
  // off: the painted name again, and nothing more drawn for them
  const venueBtn = page.locator('.s3').getByRole('button', { name: 'Venue', exact: true }), more = page.locator('.s3').getByRole('button', { name: 'More', exact: true });
  await expect(venueBtn.or(more).first()).toBeVisible({ timeout: 30000 });
  if (!(await venueBtn.isVisible())) { await more.click(); }
  await venueBtn.click();
  const box = page.getByRole('group', { name: 'The venue' }).getByLabel('The live camera on the screens');
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect.poll(async () => (await scr()).live).toBe(false);
  const n = (await scr()).frames;
  await page.waitForTimeout(1000);
  expect((await scr()).frames).toBe(n);
  // (kept in this browser)
  await page.reload();
  await open3d(page).catch(() => {});
  await page.waitForTimeout(1500);
  expect((await scr()).live).toBe(false);
  expect(shaderErrors).toEqual([]);
});
