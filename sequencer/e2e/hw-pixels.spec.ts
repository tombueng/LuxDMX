// A ring on a real box's pixel port: what the app patches over two universes arrives whole, read
// back from the box's own framebuffer (/pixels/frame). It changes what the port shows and it needs
// a port set up for the ring: a bench box only.
//   LUXDMX_HOST=192.168.1.59 npx playwright test e2e/hw-pixels.spec.ts
import { openConnected, patch, selectAll, swatch, full, tab, test, expect } from './helpers';

const HOST = process.env.LUXDMX_HOST ?? '';
const get = async (path: string) => (await fetch(`http://${HOST}${path}`, { signal: AbortSignal.timeout(4000) })).json();
test.skip(!HOST, 'set LUXDMX_HOST to run against a real box');

interface Port { idx: number; en: boolean; count: number; uni: number; inFps: number; outFps: number; latches: number; partials: number; lost: boolean; bright: number; gamma: number }
const port = async (): Promise<Port | undefined> => ((await get('/pixels.json')).ports as Port[]).find((p) => p.en && p.count === 241);
const pixel = async (idx: number, i: number) => { const f = await get(`/pixels/frame?port=${idx}`); return (f.px as string).slice(i * 6, i * 6 + 6); };

test('a 241-pixel disc reaches the port whole, over both universes', async ({ page }) => {
  const p = await port();
  test.skip(!p, 'no enabled pixel port with 241 pixels');
  await openConnected(page, HOST);
  await patch(page, 'gen-disc241', 1, p!.uni, 'Disc');
  // the box said this port plays it, so nothing to warn about
  await expect(page.getByTestId('pixels-unserved')).toHaveCount(0);
  await selectAll(page); await full(page); await swatch(page, 'Red');
  // the first pixel, the last on the first universe, the first on the next one, the very last
  for (const i of [0, 169, 170, 240]) await expect.poll(() => pixel(p!.idx, i), { timeout: 6000, message: `pixel ${i}` }).toBe('ff0000');
  await swatch(page, 'Blue');
  for (const i of [0, 169, 170, 240]) await expect.poll(() => pixel(p!.idx, i), { timeout: 6000, message: `pixel ${i}` }).toBe('0000ff');
  // an effect, running: both universes keep coming, frames latch whole
  await tab(page, 'Effects');
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  const lib = page.getByRole('dialog', { name: 'Add an effect' });
  await lib.locator('[data-effect="plasmaClouds"]').click();
  await expect(lib).toBeHidden();
  await page.waitForTimeout(1500);
  const a = await port(), t0 = Date.now();
  const firstPx = new Set<string>();
  while (Date.now() - t0 < 4000) { firstPx.add(await pixel(p!.idx, 200)); await page.waitForTimeout(250); }
  const b = await port(), secs = (Date.now() - t0) / 1000;
  console.log(`port ${p!.idx + 1}: in ${b!.inFps} fps, out ${b!.outFps} fps, ${b!.latches - a!.latches} latches, ${b!.partials - a!.partials} partial in ${secs.toFixed(1)} s, pixel 200 had ${firstPx.size} values`);
  expect(firstPx.size).toBeGreaterThan(4);                       // it moves, past the first universe
  expect(b!.lost).toBe(false);
  expect((b!.latches - a!.latches) / secs).toBeGreaterThan(20);
  expect(b!.partials - a!.partials).toBeLessThan((b!.latches - a!.latches) * 0.1);
});

test("the LEDs tab on the real disc: the finder's three LEDs, then the test picture, then let go", async ({ page }) => {
  const p = await port();
  test.skip(!p, 'no enabled pixel port with 241 pixels');
  await openConnected(page, HOST);
  await patch(page, 'gen-disc241', 1, p!.uni, 'Disc');
  await tab(page, 'Fixtures');
  await page.locator('.fl li[data-fixture="Disc"]').dblclick();
  const dlg = page.getByRole('dialog', { name: 'Patch: Disc' });
  await dlg.getByRole('tab', { name: 'LEDs' }).click();
  // the finder: the first LED red, the second green, the last blue (on the second universe), nothing else
  await dlg.getByRole('button', { name: 'Find the wiring on the real one…' }).click();
  await expect.poll(() => pixel(p!.idx, 0), { timeout: 6000 }).toBe('ff0000');
  expect(await pixel(p!.idx, 1)).toBe('00ff00');
  expect(await pixel(p!.idx, 240)).toMatch(/^00[0-9a-f]{2}ff$/);
  expect(await pixel(p!.idx, 100)).toBe('000000');
  await dlg.getByRole('button', { name: 'Stop', exact: true }).click();
  // the test picture: red at the top of the rim, green at 3 o'clock, the middle white, the bottom dark
  await dlg.getByLabel('Show the picture on the real one too').check();
  await expect.poll(() => pixel(p!.idx, 15), { timeout: 6000 }).toBe('00ff00');
  expect(await pixel(p!.idx, 0)).toBe('ff0000');
  expect(await pixel(p!.idx, 240)).toBe('ffffff');
  expect(await pixel(p!.idx, 30)).toBe('000000');
  await dlg.getByLabel('Show the picture on the real one too').uncheck();
  await expect.poll(() => pixel(p!.idx, 0), { timeout: 6000 }).toBe('000000');
  // how its LEDs light: what this box's port says (its own brightness, gamma and cap)
  const cfg = await port();
  await expect(dlg.getByTestId('led-from')).toContainText(`its pixel port on universe ${cfg!.uni}, brightness ${cfg!.bright}, gamma ${cfg!.gamma / 100}`);
});
