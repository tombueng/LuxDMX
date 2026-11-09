// Effects, measured on the wire: a chase's period follows the tempo and its lights are spread
// evenly; a rainbow lights every pixel of a bar differently; a circle moves a head; effects go
// into cues with Record and stop with them; the ones running on the selected lights stand out.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, patch, channels, history, selectAll, selectFixtures, record, jumpTo, release, tab, cues, full, test, expect } from './helpers';

const lib = (page: Page) => page.getByRole('dialog', { name: 'Add an effect' });
async function addEffect(page: Page, kind: string) {
  await tab(page, 'Effects');
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  await lib(page).locator(`[data-effect="${kind}"]`).click();
  await expect(lib(page)).toBeHidden();
}
// Times (ms) a channel goes from dark to lit.
async function rises(uni: number, ch: number, since: number) {
  const h = (await history(uni, ch)).filter(([t]) => t >= since);
  return h.filter(([, v], i) => i > 0 && v > 127 && h[i - 1][1] <= 127).map(([t]) => t);
}
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

test.beforeEach(async () => { await resetFake(); });

test('a chase runs at the tempo, one light after the other, and the knobs change it', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 4, 0, 'D');
  await selectAll(page);
  await addEffect(page, 'chase');
  await expect(page.locator('.ep li.running')).toHaveCount(1);
  // 120 BPM, 2 beats a round: 1 s per round, 250 ms per light
  const t0 = Date.now();
  await page.waitForTimeout(3300);
  const r1 = await rises(0, 1, t0), r2 = await rises(0, 2, t0);
  expect(r1.length).toBeGreaterThanOrEqual(3);
  const period = median(r1.slice(1).map((t, i) => t - r1[i]));
  expect(period).toBeGreaterThan(900); expect(period).toBeLessThan(1100);
  const lag = median(r1.map((t) => r2.find((u) => u > t)! - t).filter((x) => !Number.isNaN(x)));
  expect(lag).toBeGreaterThan(190); expect(lag).toBeLessThan(310);

  // double the tempo: half the period
  await page.locator('.top .bpm input').fill('240');
  const t1 = Date.now() + 300;
  await page.waitForTimeout(2300);
  const r3 = await rises(0, 1, t1);
  const p2 = median(r3.slice(1).map((t, i) => t - r3[i]));
  expect(p2).toBeGreaterThan(420); expect(p2).toBeLessThan(580);

  // backward: light 4 now comes before light 3
  await page.locator('.ep li.oitem').first().click();
  await page.getByRole('radio', { name: 'Backward' }).click();
  // (measured from once it's backward, and over a few rounds: the moment it turns round lights 3
  // right after 4 once, which a busy machine can push past any fixed wait)
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.effects[0].params.direction)).toBe('backward');
  const t2 = Date.now() + 300;
  await page.waitForTimeout(1800);
  const r4 = await rises(0, 4, t2), r3b = await rises(0, 3, t2);
  const after4 = median(r4.map((t) => r3b.find((u) => u > t)! - t).filter((x) => !Number.isNaN(x)));
  expect(after4).toBeGreaterThan(80); expect(after4).toBeLessThan(200);       // 125 ms at 240 BPM

  // stop: everything dark again
  await page.locator('.ep [data-play="stop"]').first().click();
  await expect.poll(() => channels(0, 4), { timeout: 3000 }).toEqual([0, 0, 0, 0]);
});

test('Record puts the running effect into the cue; it stops and starts with the cue', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 4, 0, 'D');
  await selectAll(page);
  await addEffect(page, 'pulse');
  await record(page);
  await expect(cues(page).first().locator('.fxbadge')).toHaveText('Pulse');       // the cue runs the effect
  await expect(cues(page).first().locator('.name')).toHaveText('Pulse');          // and is named after it
  await expect(page.locator('.ep li.running')).toHaveCount(1);                    // still running, now from the cue
  await expect(page.locator('.ep li .play.on')).toHaveCount(0);                   // ...not by hand any more
  await release(page);
  await expect.poll(() => channels(0, 4), { timeout: 5000 }).toEqual([0, 0, 0, 0]);
  await expect(page.locator('.ep li.running')).toHaveCount(0);
  const t0 = Date.now();
  await jumpTo(page, 0);
  await page.waitForTimeout(3000);                                                // the effect fades in with the cue (2 s)
  const h = (await history(0, 1)).filter(([t]) => t >= t0).map(([, v]) => v);
  expect(Math.max(...h)).toBeGreaterThan(200);
  expect(Math.min(...h.slice(-20))).toBeLessThan(Math.max(...h.slice(-20)));      // it's moving
});

test('a rainbow colours every pixel of a bar differently', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-bar8', 1, 0, 'Bar');
  await selectAll(page);
  await addEffect(page, 'rainbow');
  await expect.poll(async () => {
    const c = await channels(0, 24);
    return new Set([0, 1, 2, 3, 4, 5, 6, 7].map((i) => c.slice(i * 3, i * 3 + 3).join())).size;
  }).toBe(8);
  // the stage draws the cells in their colours
  const fills = await page.locator('.stage-wrap .fx[data-name="Bar"] rect').evaluateAll((els) => els.map((e) => e.getAttribute('fill')));
  expect(new Set(fills.filter((f) => f?.startsWith('rgb'))).size).toBeGreaterThanOrEqual(8);
});

test('a pixel strip is one light: a rainbow runs along its 50 pixels', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-strip50', 1, 0, 'Strip');
  expect(await page.evaluate(() => (window as any).__luxdmx.show.fixtures.length)).toBe(1);
  await selectAll(page);
  await addEffect(page, 'rainbow');
  await expect.poll(async () => {
    const c = await channels(0, 150);
    return new Set(Array.from({ length: 50 }, (_, i) => c.slice(i * 3, i * 3 + 3).join())).size;
  }).toBeGreaterThan(25);
});

// The colours of the 30 pixels of a strip at address 1, as 'r,g,b' strings.
const pixels30 = async () => { const c = await channels(0, 90); return Array.from({ length: 30 }, (_, i) => c.slice(i * 3, i * 3 + 3).join()); };

test('pixel shows on a 30-pixel strip: each moves and differs along the strip', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-strip30', 1, 0, 'Strip');
  for (const kind of ['theater', 'fire2012', 'pride', 'bouncing', 'fireworks', 'twinkle']) {
    // (each round selects again: a reload in between, from the dev server, starts with none selected)
    await selectAll(page);
    await addEffect(page, kind);
    await page.waitForTimeout(600);                                  // past the fade-in
    const shots: string[][] = [];
    for (let k = 0; k < 6; k++) { shots.push(await pixels30()); await page.waitForTimeout(250); }
    expect(new Set(shots.map((s) => s.join('|'))).size, `${kind} moves`).toBeGreaterThanOrEqual(4);
    expect(Math.max(...shots.map((s) => new Set(s).size)), `${kind} differs along the strip`).toBeGreaterThanOrEqual(4);
    expect(shots.flat().some((p) => p.split(',').some((v) => +v > 200)), `${kind} lights up`).toBe(true);
    await tab(page, 'Effects');
    await page.locator('.ep [data-play="stop"]').first().click();
    await expect.poll(async () => (await channels(0, 90)).every((v) => v === 0), { timeout: 3000 }).toBe(true);
  }
  // fire rises from the start of the strip: the first pixels are lit, the last ones dark
  await selectAll(page);
  await addEffect(page, 'fire2012');
  await page.waitForTimeout(800);
  const f = await channels(0, 90);
  expect(f.slice(0, 9).reduce((a, b) => a + b)).toBeGreaterThan(600);
  expect(f.slice(78, 90).every((v) => v === 0)).toBe(true);
});

test('the Pixels section has the twenty shows as moving strips; a palette changes a show\'s colours', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-strip30', 1, 0, 'Strip');
  await selectAll(page);
  await tab(page, 'Effects');
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(lib(page).getByRole('heading', { name: 'Pixels' })).toBeVisible();
  const ids = ['theater', 'fire2012', 'twinkle', 'juggle', 'sinelon', 'pride', 'bouncing', 'ripple', 'fireworks', 'matrix', 'aurora',
    'plasma', 'glitter', 'heartbeat', 'scanner', 'meteorRain', 'lightning1d', 'rain', 'popcorn', 'gradientChase'];
  for (const id of ids) await expect(lib(page).locator(`[data-effect="${id}"]`)).toHaveCount(1);
  // the card's preview is a strip of LEDs that lights up (theater: a third of them at any time)
  const litLeds = () => lib(page).locator('[data-effect="theater"] canvas').evaluate((cv: HTMLCanvasElement) => {
    const ctx = cv.getContext('2d')!, d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 300) n++;
    return n;
  });
  await expect.poll(litLeds).toBeGreaterThan(20);
  await lib(page).locator('[data-effect="fire2012"]').click();
  await expect(lib(page)).toBeHidden();
  // the editor offers the palettes, the new ones too; Ocean turns the flames blue
  await page.locator('.ep li.oitem').first().click();
  const pal = page.getByLabel('Palette');
  for (const name of ['Aurora', 'Heat', 'Lava', 'Matrix', 'Candy', 'Neon']) await expect(pal.locator(`option[value="${name}"]`)).toHaveCount(1);
  await page.waitForTimeout(600);
  const warm = (c: number[]) => Array.from({ length: 30 }, (_, i) => c.slice(i * 3, i * 3 + 3)).filter((p) => Math.max(...p) > 60).every(([r, , b]) => r >= b);
  expect(warm(await channels(0, 90))).toBe(true);
  await pal.selectOption('Ocean');
  await expect.poll(async () => {
    const c = await channels(0, 90);
    const px = Array.from({ length: 30 }, (_, i) => c.slice(i * 3, i * 3 + 3)).filter((p) => Math.max(...p) > 60);
    return px.length > 3 && px.every(([r, , b]) => b > r);
  }).toBe(true);
});

test('a circle moves a moving head around where it points', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover8', 1, 0, 'Head');
  await selectAll(page); await full(page);
  await addEffect(page, 'circle');
  const t0 = Date.now();
  await page.waitForTimeout(2500);
  const pan = (await history(0, 1)).filter(([t]) => t >= t0).map(([, v]) => v);
  const tilt = (await history(0, 2)).filter(([t]) => t >= t0).map(([, v]) => v);
  expect(Math.max(...pan) - Math.min(...pan)).toBeGreaterThan(40);
  expect(Math.max(...tilt) - Math.min(...tilt)).toBeGreaterThan(40);
  expect(Math.max(...pan)).toBeLessThan(200); expect(Math.min(...pan)).toBeGreaterThan(55);   // around the centre
});

test('effects in the list: copy, paste, delete; the editor renames', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 3, 0, 'P');
  await selectAll(page);
  await addEffect(page, 'colorChase');
  const items = page.locator('.ep li.oitem');
  await items.first().click();
  await page.getByLabel('Effect name').fill('Party chase');
  await expect(items.first()).toContainText('Party chase');
  await page.locator('.ep .olist').press('Control+c');
  await page.locator('.ep .olist').press('Control+v');
  await expect(items).toHaveCount(2);
  await expect(items.nth(1)).toContainText('Party chase (copy)');
  await page.locator('.ep .olist').press('Delete');
  await expect(items).toHaveCount(1);
});

test('P starts and stops the selected effects from the keyboard', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 4, 0, 'D');
  await selectAll(page);
  await tab(page, 'Effects');
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add an effect' }).locator('[data-effect="pulse"]').click();
  const row = page.locator('.ep li.oitem').first();
  await expect(row.locator('[data-play="stop"]')).toBeVisible();       // running
  await row.click();
  await page.locator('.ep .olist').press('p');
  await expect(row.locator('[data-play="start"]')).toBeVisible();
  await page.locator('.ep .olist').press('p');
  await expect(row.locator('[data-play="stop"]')).toBeVisible();
});

test('the effects running on the selected lights stand out', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 4, 0, 'D');
  await selectFixtures(page, ['D 1', 'D 2']);
  await addEffect(page, 'chase');                                                 // runs on D 1 and D 2
  await addEffect(page, 'pulse');
  await page.locator('.ep li', { hasText: 'Pulse' }).locator('[data-play="stop"]').click();   // there, but stopped
  const chase = page.locator('.ep li', { hasText: 'Chase' }), pulse = page.locator('.ep li', { hasText: 'Pulse' });
  const note = page.getByTestId('fx-on-selection');
  await expect(chase).toHaveClass(/onsel/);
  await expect(chase.locator('.onsel-tag')).toHaveText('on all selected');
  await expect(pulse).not.toHaveClass(/onsel/);                                   // on the selection, but not running
  await expect(note).toHaveText('1 running on the 2 selected lights');

  await selectFixtures(page, ['D 3']);                                            // a light the chase doesn't touch
  await expect(chase).toHaveClass(/running/);
  await expect(chase).not.toHaveClass(/onsel/);
  await expect(note).toHaveText('Nothing running on the selected light');

  await selectFixtures(page, ['D 2', 'D 3', 'D 4']);
  await expect(chase.locator('.onsel-tag')).toHaveText('on 1 selected');
  await selectFixtures(page, ['D 1']);
  await expect(chase.locator('.onsel-tag')).toHaveText('on the selected light');

  await chase.locator('[data-play="stop"]').click();                               // stopped: nothing stands out
  await expect(page.locator('.ep li.onsel')).toHaveCount(0);
  await expect(note).toHaveText('Nothing running on the selected light');
  await page.locator('.stage-wrap').getByRole('button', { name: 'Select none' }).click();
  await expect(note).toBeHidden();                                                // nothing selected: no line
});

test('an effect shows only the knobs that change it: a random colour, a chase, the eye', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 4, 0, 'Par');
  await selectAll(page);
  await addEffect(page, 'random');
  await page.locator('.ep li.oitem').first().click();
  const ed = page.locator('.ed');
  // Random colour: how fast and which colours, nothing else
  await expect(ed.getByLabel(/^(Seconds|Beats) per cycle$/)).toBeVisible();
  await expect(ed.getByLabel('Colour 1', { exact: true })).toBeVisible();
  for (const k of ['Size', 'Spread', 'Contrast']) await expect(ed.getByLabel(k, { exact: true })).toHaveCount(0);
  await expect(ed.getByRole('radiogroup', { name: 'Direction' })).toHaveCount(0);
  await ed.getByRole('button', { name: 'More' }).click();
  for (const k of ['Low', 'High', 'Blocks', 'Order', 'Width']) await expect(ed.getByLabel(k, { exact: true })).toHaveCount(0);
  // a chase: its width and its spread
  await page.locator('.ed').getByLabel('Effect kind').selectOption('chase');
  await expect(ed.getByLabel('Spread', { exact: true })).toBeVisible();
  await expect(ed.getByLabel('Width', { exact: true })).toBeVisible();
  await expect(ed.getByLabel('Size', { exact: true })).toHaveCount(0);
  // the eye on a disc: Size, and Back or Forward only; no palette, no blocks
  await page.locator('.ed').getByLabel('Effect kind').selectOption('eye');
  await expect(ed.getByLabel('Size', { exact: true })).toBeVisible();
  await expect(ed.getByRole('radiogroup', { name: 'Direction' }).getByRole('radio')).toHaveCount(2);
  await expect(ed.getByLabel('Colour 1', { exact: true })).toHaveCount(0);
  await expect(ed.getByLabel('Blocks', { exact: true })).toHaveCount(0);
});
