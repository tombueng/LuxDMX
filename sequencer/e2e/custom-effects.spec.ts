// Your own effects, measured on the wire: a formula on a 30-pixel strip gives exact channels, a typo
// is shown where it is and leaves the lights on the last formula that worked, an example replaces
// it; a PNG and an animated GIF loaded from files play on the strip (the GIF at its own pace, and
// Speed stretches it). The pictures are made here (src/engine/gif.testkit.ts); the same files are
// in investigations/sequencer-agents/B-custom/ to look at.
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { openConnected, resetFake, patch, channels, history, selectAll, tab, test, expect } from './helpers';
import { encodeGif, encodePng } from '../src/engine/gif.testkit';

const AXE = fs.readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const lib = (page: Page) => page.getByRole('dialog', { name: 'Add an effect' });
async function addEffect(page: Page, kind: string) {
  await tab(page, 'Effects');
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  await lib(page).locator(`[data-effect="${kind}"]`).click();
  await expect(lib(page)).toBeHidden();
  await page.locator('.ep li.oitem').first().click();          // its settings
}
async function strip(page: Page, kind: string) {
  await openConnected(page);
  await patch(page, 'gen-strip30', 1, 0, 'Strip');
  await selectAll(page);
  await addEffect(page, kind);
}
const ed = (page: Page) => page.locator('.ed');
// the strip's 30 pixels as [r, g, b]
const pixels = async () => { const c = await channels(0, 90); return Array.from({ length: 30 }, (_, k) => c.slice(k * 3, k * 3 + 3)); };
async function audit(page: Page, what: string, where = '.ed') {
  // (colours mid-transition aren't what anyone reads: wait for them to settle, like a11y.spec)
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || (a.effect?.getComputedTiming().iterations ?? 1) === Infinity), undefined, { timeout: 3000 }).catch(() => {});
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async (sel) => {
    const res = await (window as any).axe.run(document.querySelector(sel), { resultTypes: ['violations'] });
    return res.violations.map((v: any) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n: any) => n.target.join(' ')).join(' | ')}`);
  }, where);
  expect(r, what).toEqual([]);
}
// Times (ms) a channel goes from dark to lit.
async function rises(ch: number, since: number) {
  const h = (await history(0, ch)).filter(([t]) => t >= since);
  return h.filter(([, v], i) => i > 0 && v > 127 && h[i - 1][1] <= 127).map(([t]) => t);
}
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

test.beforeEach(async () => { await resetFake(); });

test('the library has Formula and Picture under Pixels, each with a moving preview', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-strip30', 1, 0, 'Strip');
  await selectAll(page);
  await tab(page, 'Effects');
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  const pixelCards = lib(page).locator('h2:text-is("Pixels") ~ .cards').first();
  for (const kind of ['formula', 'picture']) {
    const card = pixelCards.locator(`[data-effect="${kind}"]`);
    await expect(card).toBeVisible();
    // the preview draws something (the rainbow wave, the sample sunset)
    await expect.poll(() => card.locator('canvas').evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) lit++;
      return lit;
    })).toBeGreaterThan(20);
  }
  await expect(pixelCards.locator('[data-effect="formula"]')).toContainText('Write your own');
  await audit(page, 'the library', '[role="dialog"]');
});

test('a formula: exact channels on a strip, a typo shown where it is, the examples', async ({ page }) => {
  await strip(page, 'formula');
  // the default, a rainbow wave, runs at once
  await expect.poll(async () => new Set((await pixels()).map(String)).size).toBeGreaterThan(20);
  const field = ed(page).getByLabel('Formula', { exact: true });
  await expect(field).toHaveValue('hsv(x - c, 1, 1)');

  await field.fill('rgb(x, 0, 1 - x)');
  const want = Array.from({ length: 30 }, (_, k) => [Math.round(k / 29 * 255), 0, Math.round((1 - k / 29) * 255)]);
  await expect.poll(pixels).toEqual(want);
  expect(await page.evaluate(() => (window as any).__luxdmx.show.effects[0].params.formula)).toBe('rgb(x, 0, 1 - x)');

  // half typed: the error under the field, the spot marked; the lights keep what worked
  await field.fill('rgb(x, 0, 1 - x');
  await expect(ed(page).locator('.msg .err')).toHaveText('This "(" is never closed. The lights keep the last formula that worked.');
  await expect(ed(page).locator('.where mark')).toHaveText('(');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await page.waitForTimeout(400);
  expect(await pixels()).toEqual(want);
  await field.fill('rgb(x, 0, 1 - x) * tme');
  await expect(ed(page).locator('.msg .err')).toContainText('Unknown name "tme"');

  // the reference and the error pass axe
  await ed(page).getByText('What can I write?').click();
  await expect(ed(page).locator('details dl')).toContainText('seconds since the effect started');
  await audit(page, 'formula editor with an error');

  // an example takes over (and the error is gone)
  await ed(page).getByLabel('Formula examples').selectOption('Police');
  await expect(field).toHaveValue(/^x < 0.5 \? rgb\(1, 0, 0\)/);
  await expect(ed(page).locator('.msg .err')).toHaveCount(0);
  await expect.poll(async () => {
    const h = (await history(0, 1)).slice(-60).map(([, v]) => v);
    return new Set(h).size > 1 && Math.max(...h) === 255;       // pixel 1, left half: red flashes
  }, { timeout: 4000 }).toBe(true);
});

test('a picture and an animated GIF from files play on the strip', async ({ page }) => {
  await strip(page, 'picture');
  // the sample sunset runs until one is loaded
  await expect(ed(page).getByText('The sample sunset')).toBeVisible();
  await expect.poll(async () => Math.max(...(await pixels()).flat())).toBeGreaterThan(0);

  // a still: 30 x 1, one colour per pixel: the strip shows it exactly
  const stripes = Array.from({ length: 30 }, (_, k) => [k * 8, 255 - k * 8, (k % 3) * 100]);
  const png = encodePng(30, 1, stripes.flatMap((c) => [...c, 255]));
  await ed(page).getByLabel('Picture or GIF file').setInputFiles({ name: 'stripes.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(ed(page).getByTestId('picture-size')).toContainText('30 × 1 px');
  await expect(ed(page).getByText('stripes.png')).toBeVisible();
  await expect.poll(pixels).toEqual(stripes);
  expect(await page.evaluate(() => (window as any).__luxdmx.show.effects[0].params.picture.slice(0, 12))).toBe('pic1:30x1:0:');

  // a GIF: red, then green and blue, 600 ms each; it plays at its own pace (Speed 1.2 s)
  const gif = encodeGif(30, 1, [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]], [
    { w: 30, h: 1, indices: Array(30).fill(1), delay: 600 },
    { w: 30, h: 1, indices: Array.from({ length: 30 }, (_, k) => 2 + (k % 2)), delay: 600 },
  ]);
  await ed(page).getByLabel('Picture or GIF file').setInputFiles({ name: 'blink.gif', mimeType: 'image/gif', buffer: Buffer.from(gif) });
  await expect(ed(page).getByTestId('picture-size')).toContainText('30 × 1 px · 2 frames · 1.2 s');
  await expect(ed(page).getByLabel('Seconds per cycle')).toHaveValue('1.2');
  const red = Array.from({ length: 30 }, () => [255, 0, 0]), gb = Array.from({ length: 30 }, (_, k) => (k % 2 ? [0, 0, 255] : [0, 255, 0]));
  await expect.poll(pixels, { timeout: 3000, intervals: [50] }).toEqual(red);
  await expect.poll(pixels, { timeout: 3000, intervals: [50] }).toEqual(gb);
  // its timing, measured: red comes back every 1.2 s
  let t0 = Date.now();
  await page.waitForTimeout(4000);
  let r = await rises(1, t0);
  expect(r.length).toBeGreaterThanOrEqual(2);
  let period = median(r.slice(1).map((t, i) => t - r[i]));
  expect(period).toBeGreaterThan(1050); expect(period).toBeLessThan(1350);

  // Speed stretches it: 2.4 s a round, every frame twice as long
  await ed(page).getByLabel('Seconds per cycle').fill('2.4');
  await ed(page).getByLabel('Seconds per cycle').press('Enter');
  await expect(ed(page).getByRole('button', { name: 'back to it' })).toBeVisible();
  t0 = Date.now() + 300;
  await page.waitForTimeout(6000);
  r = await rises(1, t0);
  period = median(r.slice(1).map((t, i) => t - r[i]));
  expect(period).toBeGreaterThan(2200); expect(period).toBeLessThan(2600);

  // how it lies on the lights is kept in the show
  await ed(page).getByRole('radio', { name: 'Wall' }).click();
  await expect(ed(page).getByRole('radio', { name: 'Wall' })).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => (window as any).__luxdmx.show.effects[0].params.mapping)).toBe('wall');
  await audit(page, 'picture editor');

  // not a picture: said plainly, the GIF stays
  await ed(page).getByLabel('Picture or GIF file').setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not a picture at all') });
  await expect(ed(page).locator('p.err')).toHaveText(/could not be read/);
  await expect(ed(page).getByTestId('picture-size')).toContainText('2 frames');

  // Remove: back to the sample
  await ed(page).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(ed(page).getByText('The sample sunset')).toBeVisible();
});
