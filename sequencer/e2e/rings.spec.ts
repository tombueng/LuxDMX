// LED rings and matrices: one light with a shape, over several universes when it's big, with its own
// effects and a maker for your own. Measured on the wire.
import type { Page } from '@playwright/test';
import { FAKE, openConnected, patch, channels, frames, pixelPorts, resetFake, selectAll, tab, test, expect, fixturesOnStage } from './helpers';

const lib = (page: Page) => page.getByRole('dialog', { name: 'Add an effect' });
async function addEffect(page: Page, kind: string) {
  await tab(page, 'Effects');
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  await lib(page).locator(`[data-effect="${kind}"]`).click();
  await expect(lib(page)).toBeHidden();
  await page.locator('.ep li.oitem').first().click();          // its settings
}
const lit = (c: number[]) => c.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);

test.beforeEach(async () => { await resetFake(); });

test('a 241-pixel disc runs on over two universes, whole pixels on each', async ({ page }) => {
  await pixelPorts([[10, 2]]);
  await openConnected(page);
  await patch(page, 'gen-disc241', 1, 10, 'Disc');
  await expect(fixturesOnStage(page)).toHaveCount(1);
  await expect(page.locator('.stage-wrap .fx circle.px')).toHaveCount(241);      // drawn as what it is
  await selectAll(page);
  await addEffect(page, 'wiringTest');
  // every pixel has its colour: 170 on the first universe, the other 71 on the second
  const pixelsLit = (c: number[]) => { let n = 0; for (let i = 0; i + 2 < c.length; i += 3) if (c[i] || c[i + 1] || c[i + 2]) n++; return n; };
  await expect.poll(async () => pixelsLit(await channels(11, 213)), { timeout: 8000 }).toBe(71);
  const a = await channels(10, 512), b = await channels(11, 512);
  expect(pixelsLit(a.slice(0, 510))).toBe(170);
  expect(a.slice(510)).toEqual([0, 0]);                       // 170 pixels: the last two channels stay free
  expect(b.slice(213).every((v) => v === 0)).toBe(true);      // nothing past its last channel
  // the first LED of each ring is white: the rim's at channel 1, the next ring's at 60 pixels in
  // (white over the ring's colour: every emitter is on, where the others only have their hue)
  expect(Math.min(...a.slice(0, 3))).toBeGreaterThan(0);
  expect(Math.min(...a.slice(180, 183))).toBeGreaterThan(0);
  // the counter under the list knows both universes
  await tab(page, 'Fixtures');
  await expect(page.locator('.usage .chip').filter({ hasText: 'U10' })).toContainText('510/512');
  await expect(page.locator('.usage .chip').filter({ hasText: 'U11' })).toContainText('213/512');
});

test('rings and matrices have their own list in Add fixtures, the 144 and the 241 among them', async ({ page }) => {
  await openConnected(page);
  await tab(page, 'Fixtures');
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  const list = page.getByRole('dialog', { name: 'Add fixtures' }).locator('.types.shapes');
  for (const id of ['gen-ring60', 'gen-disc61', 'gen-disc93', 'gen-disc144', 'gen-disc241', 'gen-matrix16x16']) await expect(list.locator(`[data-type="${id}"]`)).toHaveCount(1);
  await list.locator('[data-type="gen-disc144"]').click();
  await expect(page.getByRole('dialog', { name: 'Add fixtures' }).getByLabel('Name', { exact: true })).toHaveValue('Disc');
  await expect(list.locator('[data-type="gen-disc144"]')).toContainText('Rings of 31, 28, 24, 20, 16, 12, 8, 4, 1');
});

test('the second disc takes the next free universes', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-disc241', 2, 4, 'Disc');
  const fx = await page.evaluate(() => (window as any).__luxdmx.show.fixtures.map((f: any) => [f.universe, f.address]));
  expect(fx).toEqual([[4, 1], [6, 1]]);
});

test('the library has them in their own section, drawn on a disc and a matrix', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-matrix16x16', 1, 2, 'Panel');
  await selectAll(page);
  await tab(page, 'Effects');
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(lib(page).locator('h2').nth(1)).toHaveText('Rings and matrices');   // first: a matrix is selected
  for (const k of ['eye', 'reactor', 'supernova', 'warp', 'campfire', 'codeRain', 'scrollText']) await expect(lib(page).locator(`[data-effect="${k}"] canvas`)).toBeVisible();
  // a preview really draws
  await expect.poll(() => lib(page).locator('[data-effect="plasmaClouds"] canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 200) n++;
    return n;
  })).toBeGreaterThan(50);
});

test('Scrolling text says your words on a matrix', async ({ page }) => {
  await pixelPorts([[3, 1]]);
  await openConnected(page);
  await patch(page, 'gen-matrix8x8', 1, 3, 'Panel');
  await selectAll(page);
  await addEffect(page, 'scrollText');
  const words = page.locator('.ed').getByLabel('Words');
  await expect(words).toHaveValue('LUXDMX');
  await words.fill('I');
  // an I, 5 wide and 7 high, keeps passing: pixels light and go out
  const seen = new Set<number>();
  await expect.poll(async () => { seen.add(lit(await channels(3, 192))); return seen.size; }, { timeout: 8000, intervals: [130] }).toBeGreaterThan(2);   // (not a whole second: that's its round, it would look the same each time)
  expect(Math.max(...seen)).toBeLessThan(60);                     // one letter: far from the whole panel (192 channels)
});

test('a ring of your own, worked out from its total, on the wire', async ({ page }) => {
  await pixelPorts([[5, 1]]);
  await openConnected(page);
  await tab(page, 'Fixtures');
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  const add = page.getByRole('dialog', { name: 'Add fixtures' });
  await add.getByRole('button', { name: 'Ring or matrix…' }).click();
  const maker = page.getByRole('dialog', { name: 'A LED ring or matrix' });
  await maker.getByLabel('LEDs in all').fill('144');
  await maker.getByLabel('How many rings').fill('9');
  await maker.getByRole('button', { name: 'Work it out' }).click();
  await expect(maker.getByLabel('LEDs per ring')).not.toHaveValue(/^60/);
  await expect(maker.getByText('144 pixels, 432 channels.')).toBeVisible();
  await expect.poll(() => maker.locator('canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  })).toBeGreaterThan(200);
  // no nonsense goes through
  await maker.getByLabel('LEDs per ring').fill('nothing');
  await expect(maker.getByText('Say how many LEDs each ring has')).toBeVisible();
  await expect(maker.getByRole('button', { name: 'Save' })).toBeDisabled();
  await maker.getByLabel('LEDs in all').fill('144');
  await maker.getByRole('button', { name: 'Work it out' }).click();
  await maker.getByRole('button', { name: 'Save' }).click();
  await expect(maker).toBeHidden();
  await add.getByLabel('How many').fill('1');
  await add.getByLabel('Universe').fill('5');
  await add.getByRole('button', { name: /^Add \d+ × / }).click();
  await expect(add).toBeHidden();
  await expect(page.locator('.stage-wrap .fx circle.px')).toHaveCount(144);
  await selectAll(page);
  await addEffect(page, 'mandala');
  await expect.poll(async () => lit(await channels(5, 432)), { timeout: 8000 }).toBeGreaterThan(20);
  // it's kept with the show as what it is
  const layout = await page.evaluate(() => (window as any).__luxdmx.show.fixtureTypes[0].modes[0].layout);
  expect(layout.kind).toBe('rings');
  expect(layout.rings.reduce((a: number, b: number) => a + b, 0)).toBe(144);
});

test('the Ring and matrix template plays its lists from universe 10 up', async ({ page }) => {
  await pixelPorts([[10, 2], [12, 2], [14, 1], [15, 2]]);
  await openConnected(page);
  await page.evaluate(async () => {
    const url = '/src/content/ringMatrix.ts';
    const { buildRingMatrix } = await import(/* @vite-ignore */ url);
    await (window as any).__luxdmx.startShow(buildRingMatrix());
  });
  await expect(fixturesOnStage(page)).toHaveCount(4);
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.engine.go(a.show.cueLists[0].id); });
  await expect.poll(async () => Object.keys(await frames()).map(Number).filter((u) => u >= 10).length, { timeout: 8000 }).toBeGreaterThanOrEqual(6);
  await expect.poll(async () => lit(await channels(10, 510)) + lit(await channels(12, 510)), { timeout: 40_000 }).toBeGreaterThan(100);
  const us = Object.keys(await frames()).map(Number);
  expect(us.filter((u) => u < 10)).toEqual([]);                  // the box's DMX universes stay out of it
});

test('on the 3D stage: a disc stands up facing the audience, its pixels on its board, and a click finds it', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-disc241', 1, 10, 'Disc');
  await selectAll(page);
  await addEffect(page, 'plasmaClouds');
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => (window as any).__stage3d?.stats()?.fixtures ?? -1), { timeout: 30000 }).toBe(1);
  // the pixels: one instance each, spread over a round board about as wide as it's meant to be, upright
  const cells = await page.evaluate(() => {
    const { scene, THREE } = (window as any).__stage3d.internals;
    let best: any = null;
    scene.traverse((o: any) => { if (o.isInstancedMesh && o.count === 241) best = o; });
    if (!best) return null;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), ps: number[][] = [];
    for (let i = 0; i < best.count; i++) { best.getMatrixAt(i, m); p.setFromMatrixPosition(m); ps.push([p.x, p.y, p.z]); }
    return ps;
  });
  expect(cells).not.toBeNull();
  const span = (k: number) => Math.max(...cells!.map((c) => c[k])) - Math.min(...cells!.map((c) => c[k]));
  expect(span(0)).toBeCloseTo(0.6, 1); expect(span(1)).toBeCloseTo(0.6, 1); expect(span(2)).toBeLessThan(0.05);
  // the data's first pixel is at the top of the rim, the last in the middle
  const my = (cells![0][1] + Math.min(...cells!.map((c) => c[1]))) / 2;
  expect(cells![0][1]).toBeGreaterThan(my + 0.25);
  expect(Math.abs(cells![240][1] - my)).toBeLessThan(0.02);
  const xy = await page.evaluate(() => (window as any).__stage3d.screenOf((window as any).__luxdmx.show.fixtures[0].id));
  await page.evaluate(() => { (window as any).__luxdmx.selected = []; });
  await page.mouse.click(xy.x, xy.y);
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.selected.length)).toBe(1);
});

test('Contrast: more of it, and the light falls harder between dark and bright', async ({ page }) => {
  await pixelPorts([[10, 2]]);
  await openConnected(page);
  await patch(page, 'gen-disc241', 1, 10, 'Disc');
  await selectAll(page);
  await addEffect(page, 'plasmaClouds');
  // how much of the picture sits in the middle, over a few moments
  const middling = async () => {
    let mid = 0, all = 0;
    for (let k = 0; k < 6; k++) {
      for (const v of await channels(10, 510)) { if (!v) continue; all++; if (v > 60 && v < 200) mid++; }
      await page.waitForTimeout(250);
    }
    return mid / Math.max(1, all);
  };
  await page.waitForTimeout(2000);        // (the effect has faded in)
  const plain = await middling();
  const knob = page.locator('.ed').getByLabel('Contrast');
  await expect(knob).toHaveValue('0');
  await knob.fill('1');
  await expect(page.locator('.ed .knob', { hasText: 'Contrast' })).toContainText('+100');
  await page.waitForTimeout(300);
  const hard = await middling();
  expect(hard).toBeLessThan(plain);
  const stored = await page.evaluate(() => (window as any).__luxdmx.show.effects[0].params.contrast);
  expect(stored).toBe(1);
  // a colour effect has no level to work on, so no knob
  await tab(page, 'Effects');
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  await lib(page).locator('[data-effect="colorFade"]').click();
  await expect(lib(page)).toBeHidden();
  await page.locator('.ep li.oitem').last().click();
  await expect(page.locator('.ed').getByLabel('Contrast')).toHaveCount(0);
});

// The fixtures as the app has them: name, universe, address.
const rig = (page: Page) => page.evaluate(() => (window as any).__luxdmx.show.fixtures.map((f: any) => [f.universe, f.address]));
const fixtureButton = (page: Page, name: string) => page.locator('.fl').getByRole('button', { name, exact: true });

test('duplicate, cut and paste a big ring: the copy finds a place of its own', async ({ page }) => {
  await pixelPorts([[10, 4]]);
  await openConnected(page);
  await patch(page, 'gen-disc241', 1, 10, 'Disc');
  await selectAll(page);
  await tab(page, 'Fixtures');
  await fixtureButton(page, 'Duplicate fixtures').click();
  await expect.poll(() => rig(page)).toEqual([[10, 1], [12, 1]]);      // 10 and 11 are the first's
  await expect(page.locator('.toast, .toasts').filter({ hasText: 'on universe 12' }).first()).toBeVisible();
  await expect(page.locator('.stage-wrap .fx circle.px')).toHaveCount(482);
  // cut the copy: gone, and pasted back it's where it was
  await fixtureButton(page, 'Cut fixtures').click();
  await expect.poll(() => rig(page)).toEqual([[10, 1]]);
  await fixtureButton(page, 'Paste fixtures').click();
  await expect.poll(() => rig(page)).toEqual([[10, 1], [12, 1]]);
  // and it plays there
  await selectAll(page);
  await addEffect(page, 'plasmaClouds');
  await expect.poll(async () => lit(await channels(12, 510)), { timeout: 8000 }).toBeGreaterThan(100);
  await expect.poll(async () => lit(await channels(13, 213)), { timeout: 8000 }).toBeGreaterThan(40);
});

test('a 144 fills most of a universe: the copy goes on the next one', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-disc144', 1, 10, 'Disc');
  await selectAll(page);
  await tab(page, 'Fixtures');
  await fixtureButton(page, 'Duplicate fixtures').click();
  await expect.poll(() => rig(page)).toEqual([[10, 1], [11, 1]]);
});

test('with the keys too; small lights still go on the same universe', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-ring24', 2, 3, 'Ring');
  await selectAll(page);
  await tab(page, 'Fixtures');
  await page.locator('.fl li').first().click();
  await page.keyboard.press('Control+d');
  await expect.poll(() => rig(page).then((a: unknown[]) => a.length)).toBe(3);
  expect((await rig(page))[2]).toEqual([3, 145]);
  await page.keyboard.press('Control+x');
  await expect.poll(() => rig(page).then((a: unknown[]) => a.length)).toBe(2);
  await page.keyboard.press('Control+v');
  await expect.poll(() => rig(page).then((a: unknown[]) => a.length)).toBe(3);
});

test('effects: duplicate, cut and paste, the knobs stay', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-disc241', 1, 10, 'Disc');
  await selectAll(page);
  await addEffect(page, 'scrollText');
  await page.locator('.ed').getByLabel('Words').fill('HELLO');
  await page.locator('.ed').getByLabel('Spread').fill('0.5');
  const fx = () => page.evaluate(() => (window as any).__luxdmx.show.effects.map((e: any) => [e.kind, e.params.text, e.params.spread]));
  await page.locator('.ep li.oitem').first().click();
  await page.keyboard.press('Control+d');
  await expect.poll(fx).toEqual([['scrollText', 'HELLO', 0.5], ['scrollText', 'HELLO', 0.5]]);
  await page.keyboard.press('Control+x');
  await expect.poll(() => fx().then((a: unknown[]) => a.length)).toBe(1);
  await page.keyboard.press('Control+v');
  await expect.poll(fx).toEqual([['scrollText', 'HELLO', 0.5], ['scrollText', 'HELLO', 0.5]]);
});

test('a box gets what it plays and nothing else; when nothing plays a pixel light, it says so', async ({ page }) => {
  await pixelPorts([[10, 2]]);
  await openConnected(page);
  // (the fake box's DMX outputs are universes 0 and 1, its one pixel port is on 10 and 11)
  await patch(page, 'gen-disc241', 1, 10, 'Disc');
  await patch(page, 'gen-disc241', 1, 20, 'Elsewhere');
  await selectAll(page);
  await addEffect(page, 'plasmaClouds');
  await expect.poll(async () => lit(await channels(11, 213)), { timeout: 8000 }).toBeGreaterThan(40);
  expect(Object.keys(await frames()).map(Number).filter((u) => u >= 20)).toEqual([]);      // not sent at all
  const note = page.getByTestId('pixels-unserved');
  await expect(note).toContainText('No box plays pixel universe 20, 21');
  // patched where the port listens, the note goes
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.show.fixtures[1].universe = 10; a.markDirty(0); });
  await expect(note).toHaveCount(0);
});

test('a box too old to name its pixel ports only gets its outputs, and the note says what to do', async ({ page }) => {
  await page.route('**/pixels.json', (r) => r.fulfill({ status: 404, body: '', headers: { 'access-control-allow-origin': '*' } }));
  await openConnected(page);
  await patch(page, 'gen-disc241', 1, 10, 'Disc');
  await patch(page, 'gen-drgb', 1, 0, 'PAR');
  await selectAll(page);
  await addEffect(page, 'plasmaClouds');
  await page.waitForTimeout(1500);
  expect(Object.keys(await frames()).map(Number).filter((u) => u >= 10)).toEqual([]);
  await expect(page.getByTestId('pixels-unserved')).toContainText('10, 11');
  await expect(page.getByTestId('pixels-unserved')).toContainText('update the box');
  // waved away it stays away, until the list changes
  await page.getByTestId('pixels-unserved').getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('pixels-unserved')).toHaveCount(0);
});

test('its pixel ports changed while it was away: the box says again when it comes back', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-disc241', 1, 10, 'Disc');
  await expect(page.getByTestId('pixels-unserved')).toContainText('10, 11');
  // a settings change restarts the box: its ports are set up now, and the socket drops
  await pixelPorts([[10, 2]]);
  await fetch(`http://${FAKE}/drop`, { method: 'POST' });
  await expect(page.getByTestId('pixels-unserved')).toHaveCount(0, { timeout: 8000 });
});

// ---------------------------------------------------------------- the LEDs tab
const light = (page: Page, name: string) => page.evaluate((n) => JSON.parse(JSON.stringify((window as any).__luxdmx.show.fixtures.find((f: any) => f.name === n))), name);
async function ledsTab(page: Page, name: string) {
  await tab(page, 'Fixtures');
  await page.locator(`.fl li[data-fixture="${name}"]`).dblclick();
  const dlg = page.getByRole('dialog', { name: `Patch: ${name}` });
  await dlg.getByRole('tab', { name: 'LEDs' }).click();
  return dlg;
}
// an 8 x 8 panel from the library: data in at the top left, along the rows, zigzag. LED n's colour
// on the wire: channels 3n to 3n + 2
const px = (c: number[], n: number) => c.slice(n * 3, n * 3 + 3);
const RED = [255, 0, 0], GREEN = [0, 255, 0], BLUE = [0, 89, 255], YELLOW = [255, 217, 0];

test("a matrix's LEDs tab: the test picture on the real one, turned and mirrored until it's right", async ({ page }) => {
  await pixelPorts([[12, 1]]);
  await openConnected(page);
  await patch(page, 'gen-matrix8x8', 1, 12, 'Matrix');
  const dlg = await ledsTab(page, 'Matrix');
  await expect(dlg.getByTestId('led-words')).toContainText('Starts top left, runs along the rows, zigzag (8 × 8)');
  await expect(dlg.getByTestId('led-picture').locator('circle')).toHaveCount(64);
  // on the real one: the corners in their colours (top left red, top right green, bottom right
  // yellow, bottom left blue: LED 56 is the bottom row's first, coming back from the right)
  await dlg.getByLabel('Show the picture on the real one too').check();
  await expect.poll(async () => px(await channels(12, 192), 0), { timeout: 6000 }).toEqual(RED);
  let c = await channels(12, 192);
  expect([px(c, 7), px(c, 56), px(c, 63)]).toEqual([GREEN, YELLOW, BLUE]);
  // it's mirrored on the real one: mirror it here, and the picture goes out the other way round
  await dlg.getByRole('button', { name: 'Mirror ↔' }).click();
  await expect(dlg.getByTestId('led-words')).toContainText('Starts top right, runs along the rows, zigzag');
  expect((await light(page, 'Matrix')).layout).toEqual({ kind: 'matrix', cols: 8, rows: 8, zigzag: true, from: 'tr' });
  await expect.poll(async () => px(await channels(12, 192), 0)).toEqual(GREEN);
  c = await channels(12, 192);
  expect([px(c, 7), px(c, 56), px(c, 63)]).toEqual([RED, BLUE, YELLOW]);
  // turned: a quarter to the right, then back; mirrored back: the type's wiring again, not a copy
  await dlg.getByRole('button', { name: 'Turn ↻' }).click();
  await expect(dlg.getByTestId('led-words')).toContainText('runs along the columns');
  await dlg.getByRole('button', { name: '↺ Turn' }).click();
  await dlg.getByRole('button', { name: 'Mirror ↔' }).click();
  await expect.poll(async () => (await light(page, 'Matrix')).layout).toBeUndefined();
  await expect(dlg.getByTestId('led-words')).toContainText('As its type says');
  // switched off: the light gets back what it had (nothing)
  await dlg.getByLabel('Show the picture on the real one too').uncheck();
  await expect.poll(async () => (await channels(12, 192)).some((v) => v > 0), { timeout: 6000 }).toBe(false);
  expect(await page.evaluate(() => (window as any).__luxdmx.programmer[(window as any).__luxdmx.show.fixtures[0].id])).toBeUndefined();
});

test('the finder: click where the first, second and last LED really are, and the wiring follows', async ({ page }) => {
  await pixelPorts([[12, 1]]);
  await openConnected(page);
  await patch(page, 'gen-matrix8x8', 1, 12, 'Matrix');
  const dlg = await ledsTab(page, 'Matrix');
  await dlg.getByRole('button', { name: 'Find the wiring on the real one…' }).click();
  // on the real one: LED 1 red, LED 2 green, LED 64 blue, nothing else
  await expect.poll(async () => px(await channels(12, 192), 0), { timeout: 6000 }).toEqual(RED);
  const c = await channels(12, 192);
  expect([px(c, 1), px(c, 63)]).toEqual([GREEN, BLUE]);
  expect(c.slice(6, 189).every((v) => v === 0)).toBe(true);
  // the real panel is wired from the bottom right, up the columns: red shows bottom right, green
  // above it, blue bottom left. In the picture (the library's wiring) those are LEDs 56, 55 and 63
  const pic = dlg.getByTestId('led-picture');
  await expect(dlg.getByTestId('led-step')).toContainText('red');
  await pic.locator('[data-led="56"]').click();
  await expect(dlg.getByTestId('led-step')).toContainText('green');
  await pic.locator('[data-led="55"]').click();
  await expect(dlg.getByTestId('led-step')).toContainText('blue');
  await pic.locator('[data-led="63"]').click();
  await expect(dlg.getByTestId('led-said')).toContainText('Found it: starts bottom right, runs along the columns, zigzag');
  expect((await light(page, 'Matrix')).layout).toEqual({ kind: 'matrix', cols: 8, rows: 8, zigzag: true, vertical: true, from: 'br' });
  // and three that no wiring puts there
  await dlg.getByRole('button', { name: 'Find the wiring on the real one…' }).click();
  for (const i of [0, 9, 27]) await pic.locator(`[data-led="${i}"]`).click();
  await expect(dlg.getByTestId('led-said')).toContainText('No wiring puts those three there');
  // the picture follows the light's own wiring: its first LED now sits bottom right, so it's yellow
  await dlg.getByLabel('Show the picture on the real one too').check();
  await expect.poll(async () => px(await channels(12, 192), 0), { timeout: 6000 }).toEqual(YELLOW);
  // undo: the type's wiring again
  await dlg.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await light(page, 'Matrix')).layout).toBeUndefined();
});

test('a ring: turned by one LED, mirrored, inside out; two of a type get the same wiring', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-disc37', 2, 12, 'Disc');
  const dlg = await ledsTab(page, 'Disc 1');
  await expect(dlg.getByTestId('led-words')).toContainText('Starts at the rim, runs clockwise, the first LED at the top');
  await dlg.getByLabel('Set up').selectOption('type');
  await dlg.getByRole('button', { name: '1 LED ↻' }).click();
  await dlg.getByRole('button', { name: 'Mirror ↔' }).click();
  await dlg.getByRole('button', { name: 'Inside out' }).click();
  await expect(dlg.getByTestId('led-words')).toContainText('Starts in the middle, runs counter-clockwise, the first LED turned -22.5°');
  const a = await light(page, 'Disc 1'), b = await light(page, 'Disc 2');
  expect(a.layout).toEqual({ kind: 'rings', rings: [1, 8, 12, 16], ccw: true, turn: -22.5 });
  expect(b.layout).toEqual(a.layout);
  // by hand: the first LED turned to 3 o'clock
  await dlg.getByText('Wiring by hand').click();
  await dlg.getByLabel('Turned by').fill('90');
  await dlg.getByLabel('Turned by').press('Enter');
  await expect(dlg.getByTestId('led-words')).toContainText('the first LED turned 90°');
  // kept with the show
  const saved = await page.evaluate(() => (window as any).__luxdmx.show.fixtures.map((f: any) => f.layout));
  expect(saved).toEqual([{ kind: 'rings', rings: [1, 8, 12, 16], ccw: true, turn: 90 }, { kind: 'rings', rings: [1, 8, 12, 16], ccw: true, turn: 90 }]);
});

// ---------------------------------------------------------------- how the LEDs really light
const litPixels = (page: Page) => page.locator('.stage-wrap .fx circle.px').evaluateAll((cs) => cs.filter((c) => c.getAttribute('fill') !== '#232a35').length);

test("the stage draws a disc as its LEDs light: at the box's brightness 150 a dim colour is dark there too", async ({ page }) => {
  await pixelPorts([[10, 2, 150]]);
  await openConnected(page);
  await patch(page, 'gen-disc241', 1, 10, 'Disc');
  // every pixel at DMX 20: on the wire, and the box turns that off at brightness 150
  await page.evaluate(() => { const a = (window as any).__luxdmx, id = a.show.fixtures[0].id; a.programmer[id] = { intensity: 1, color: { r: 20 / 255, g: 20 / 255, b: 20 / 255 } }; });
  await expect.poll(async () => (await channels(10, 6)), { timeout: 6000 }).toEqual([20, 20, 20, 20, 20, 20]);
  await expect.poll(() => litPixels(page)).toBe(0);
  const dlg = await ledsTab(page, 'Disc');
  await expect(dlg.getByTestId('led-from')).toContainText('From Fake LuxDMX: its pixel port on universe 10, brightness 150, gamma 2.2, no power cap');
  await expect(dlg.getByTestId('led-cut')).toContainText('Below DMX 25 a colour is off');
  // the port at full brightness (set here): DMX 20 lights, on the stage too
  await dlg.getByLabel('Brightness').fill('255');
  await dlg.getByLabel('Brightness').press('Tab');
  await expect(dlg.getByTestId('led-from')).toContainText('Set here; Fake LuxDMX has brightness 150');
  await expect(dlg.getByTestId('led-cut')).toContainText('Below DMX 15');
  await expect.poll(() => litPixels(page)).toBe(241);
  expect((await light(page, 'Disc')).led).toEqual({ bright: 255 });
  // back to what the box says
  await dlg.getByRole('button', { name: 'As the box has it' }).click();
  expect((await light(page, 'Disc')).led).toBeUndefined();
  await expect.poll(() => litPixels(page)).toBe(0);
  // brighter than the cut: lit at the box's brightness too
  await page.evaluate(() => { const a = (window as any).__luxdmx, id = a.show.fixtures[0].id; a.programmer[id] = { intensity: 1, color: { r: 60 / 255, g: 0, b: 0 } }; });
  await expect.poll(() => litPixels(page)).toBe(241);
});

test('a pixel strip has the LEDs tab for how its LEDs light, without a wiring to set', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-strip60', 1, 12, 'Strip');
  const dlg = await ledsTab(page, 'Strip');
  await expect(dlg.getByRole('heading', { name: 'How the LEDs light' })).toBeVisible();
  await expect(dlg.getByRole('heading', { name: "How it's wired" })).toHaveCount(0);
  await expect(dlg.getByTestId('led-from')).toContainText('As a LuxDMX pixel port comes');
  await dlg.getByLabel('Gamma').fill('1');
  await dlg.getByLabel('Gamma').press('Tab');
  await expect(dlg.getByTestId('led-cut')).toContainText('Below DMX 1 ');
  // a PAR has no LEDs tab
  await dlg.getByRole('button', { name: 'Done' }).click();
  await patch(page, 'gen-rgb', 1, 0, 'Par');
  await page.locator('.fl li[data-fixture="Par"]').dblclick();
  await expect(page.getByRole('dialog', { name: 'Patch: Par' }).getByRole('tab', { name: 'LEDs' })).toHaveCount(0);
});
