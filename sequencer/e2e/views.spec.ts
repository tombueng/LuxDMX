// Program, Live and Timeline: a view is built once (when it's first opened, or in a quiet moment
// after the start) and kept, hidden, while another one is shown. Going back is quick, and the view
// is as it was left: the timeline's zoom and scroll, the live page's control being changed and its
// scroll, the 3D camera. Hidden, a view is out of the way: one 3D stage on the page (in the view
// shown), nothing of a hidden view to focus, click or hear, its keys asleep (Delete, Space, P and
// the arrows act on the view shown only).
import type { Page } from '@playwright/test';
import { demo, fresh, openConnected, patch, test, expect } from './helpers';

// (the big demo with its 3D stage, drawn without a graphics card in the test browser: slow)
test.describe.configure({ timeout: 180_000 });
const app = (page: Page) => page.evaluate(() => (window as any).__luxdmx.view as string);
const to = (page: Page, name: 'Program' | 'Live' | 'Timeline') => page.locator('.top .modes').getByRole('tab', { name }).click();
// A switch, timed: `work` from the click to the end of the page's update after it (what the
// switch itself does: the view shown, the 3D world handed on, the layout), `paint` to the first
// frame drawn after it (a message after the animation frame runs once that frame is painted).
const switchMs = (page: Page, name: string) => page.evaluate((n) => new Promise<{ work: number; paint: number }>((res) => {
  const t0 = performance.now();
  let work = 0;
  (document.querySelector(`.top [role="tab"][aria-label="${n}"]`) as HTMLElement).click();
  queueMicrotask(() => queueMicrotask(() => { work = performance.now() - t0; }));
  requestAnimationFrame(() => { const ch = new MessageChannel(); ch.port1.onmessage = () => res({ work, paint: performance.now() - t0 }); ch.port2.postMessage(0); });
}), name);
async function bigDemo(page: Page) {
  await fresh(page);
  await demo(page);
  await expect(page.locator('.tlv')).toBeVisible();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d), { timeout: 30000 }).toBe(true);
  // (paused: the timeline doesn't follow the playhead, the stage holds still)
  await page.locator('.tlv .transport').getByRole('button', { name: 'Pause' }).click();
}
const cam = (page: Page) => page.evaluate(() => (window as any).__stage3d.internals.camera.position.toArray() as number[]);

test('a view is kept as it was left: the timeline zoomed and scrolled, the control being changed in Live, the 3D camera', async ({ page }) => {
  await bigDemo(page);
  // the timeline zoomed in and scrolled along
  for (let i = 0; i < 4; i++) await page.locator('.tlv .transport').getByRole('button', { name: 'Zoom in' }).click();
  const tracks = page.locator('.tlv .tracks');
  await tracks.evaluate((el) => { el.scrollLeft = 1200; });
  const scrolled = await tracks.evaluate((el) => el.scrollLeft);
  expect(scrolled).toBeGreaterThan(600);
  const width = await page.locator('.tlv .inner').evaluate((el) => el.clientWidth);
  // the 3D camera somewhere of its own
  await page.locator('.s3').getByRole('button', { name: 'FOH', exact: true }).click();
  await page.waitForTimeout(400);
  const there = await cam(page);

  // Live: Edit, a control picked (its settings open), the buttons scrolled down
  await to(page, 'Live');
  await expect(page.locator('.live .cell').first()).toBeVisible();
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.live .cell').nth(1).click();
  const ed = page.getByRole('complementary', { name: 'Control settings' });
  await expect(ed).toBeVisible();
  const editing = (await ed.locator('h2').textContent()) ?? '';
  await page.locator('.live .grid').evaluate((el) => { el.scrollTop = 120; });
  const down = await page.locator('.live .grid').evaluate((el) => el.scrollTop);

  // to Program and back to each
  await to(page, 'Program');
  await expect(page.locator('.prog.desktop')).toBeVisible();
  await expect(page.locator('div.live')).toBeHidden();
  await expect(page.locator('.tlv')).toBeHidden();
  await to(page, 'Live');
  await expect(ed).toBeVisible();
  await expect(ed.locator('h2')).toHaveText(editing);
  expect(await page.locator('.live .grid').evaluate((el) => el.scrollTop)).toBe(down);
  await page.locator('.live').getByRole('button', { name: 'Done', exact: true }).click();
  await to(page, 'Timeline');
  await expect(page.locator('.tlv')).toBeVisible();
  expect(await page.locator('.tlv .inner').evaluate((el) => el.clientWidth)).toBe(width);
  expect(await tracks.evaluate((el) => el.scrollLeft)).toBe(scrolled);
  // the camera came along through every view and is where it was put
  await expect(page.locator('.s3 canvas')).toBeVisible();
  const back = await cam(page);
  for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(there[i], 1);
});

test('hidden views are out of the way: one 3D stage, in the view shown; nothing hidden to focus or hear; the region says which view', async ({ page }) => {
  await bigDemo(page);
  await to(page, 'Live');
  await expect(page.locator('.live .cell').first()).toBeVisible();
  await to(page, 'Program');
  await expect(page.locator('main')).toHaveAttribute('aria-label', 'Program');
  // all three are there, two of them hidden and inert
  await expect(page.locator('main .pane')).toHaveCount(3);
  await expect(page.locator('main .pane[hidden][inert]')).toHaveCount(2);
  // one 3D stage on the page: the one in Program draws, the others wait without elements of their own
  await expect(page.locator('.s3')).toHaveCount(1);
  await expect(page.locator('.prog .s3 canvas')).toBeVisible();
  await expect(page.locator('.three canvas')).toHaveCount(1);
  // the timeline's Play and the live page's Edit aren't there for the keyboard or a screen reader
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
  await expect(page.locator('main').getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await page.keyboard.press('Tab');
  for (let i = 0; i < 25; i++) {
    expect(await page.evaluate(() => !!document.activeElement?.closest('.pane[hidden]'))).toBe(false);
    await page.keyboard.press('Tab');
  }
  // the region follows the view
  await to(page, 'Timeline');
  await expect(page.locator('main')).toHaveAttribute('aria-label', 'Timeline');
  await expect(page.locator('.tlv .s3 canvas')).toBeVisible();
  await expect(page.locator('.s3')).toHaveCount(1);
  // in 2D the plan is drawn in the view shown only
  await page.locator('.tlv .stage-wrap').getByRole('button', { name: '2D' }).click();
  await expect(page.locator('.s3')).toHaveCount(0);
  await to(page, 'Program');
  await expect(page.locator('svg[aria-label="Stage"]')).toHaveCount(1);
  await expect(page.locator('.prog svg[aria-label="Stage"]')).toBeVisible();
});

test('keys act on the view shown only: Delete, Space, P and the arrows in Program leave the timeline and the live page alone', async ({ page }) => {
  await bigDemo(page);
  const tl = () => page.evaluate(() => { const t = (window as any).__luxdmx.show.timeline; return { items: t.items.length, parts: (t.sections ?? []).length, playing: (window as any).__luxdmx.timeline.playing, at: (window as any).__luxdmx.timeline.position }; });
  // something picked on the tracks (by its left end: the demo's moments sit close together)
  await page.locator('.tlv .lane .it').first().click({ position: { x: 3, y: 8 } });
  await expect(page.locator('.tlv .lane .it.sel')).toHaveCount(1);
  // a control picked on the live page, in Edit
  await to(page, 'Live');
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.live .cell').nth(1).click();
  await expect(page.getByRole('complementary', { name: 'Control settings' })).toBeVisible();
  const controls = await page.locator('.live .cell').count();
  await to(page, 'Program');
  await expect(page.locator('.prog.desktop')).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const before = await tl();
  await page.keyboard.press('Delete');
  await page.keyboard.press('p');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Home');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  const after = await tl();
  expect(after.items).toBe(before.items);
  expect(after.parts).toBe(before.parts);
  expect(after.playing).toBe(false);
  expect(after.at).toBeCloseTo(before.at, 1);
  expect(await app(page)).toBe('program');
  await to(page, 'Live');
  await expect(page.locator('.live .cell')).toHaveCount(controls);
  // and on the view shown they work: Delete removes the control picked
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Delete');
  await expect(page.locator('.live .cell')).toHaveCount(controls - 1);
});

test('a switch is quick, also the first one once the others are built in the background', async ({ page }) => {
  await bigDemo(page);
  // the other two views are built a moment after the start, hidden
  await expect(page.locator('main .pane')).toHaveCount(3, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
  for (const d of ['3D', '2D'] as const) {
    if (d === '2D') { await page.locator('.tlv .stage-wrap').getByRole('button', { name: '2D' }).click(); await page.waitForTimeout(800); }
    const work: Record<string, number[]> = { Program: [], Live: [], Timeline: [] }, paint: Record<string, number[]> = { Program: [], Live: [], Timeline: [] };
    for (let i = 0; i < 3; i++) for (const v of ['Program', 'Live', 'Timeline'] as const) {
      const t = await switchMs(page, v);
      work[v].push(Math.round(t.work)); paint[v].push(Math.round(t.paint));
      await page.waitForTimeout(400);
    }
    console.log(`${d} switches (ms), the switch's own work:`, JSON.stringify(work), 'to the next frame drawn:', JSON.stringify(paint));
    // (generous: a desk computer does it in a frame or two. The test browser draws without a
    // graphics card, so only what the switch does itself is held to it there, with the 3D stage;
    // in 2D the plan is drawn again in the view shown)
    if (d === '3D') for (const v of ['Program', 'Live', 'Timeline'] as const) expect(med(work[v]), `${v}: ${work[v].join(', ')}`).toBeLessThan(150);
  }
});

test('a hidden view holds its lists still and catches up when it is shown: the fixture list\'s level behind Live', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  const lvl = page.locator('.fl li.oitem[data-fixture="D 1"] .lvl span');
  await expect(lvl).toHaveAttribute('style', /height: ?0%/);
  await to(page, 'Live');
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.programmer = { [a.show.fixtures[0].id]: { intensity: 1 } }; });
  await expect.poll(() => page.evaluate(() => { const a = (window as any).__luxdmx; return a.stage[a.show.fixtures[0].id]?.intensity; })).toBe(1);
  await page.waitForTimeout(400);
  // (on stage at full, the hidden list still shows what it last showed)
  await expect(lvl).toHaveAttribute('style', /height: ?0%/);
  await to(page, 'Program');
  await expect(lvl).toHaveAttribute('style', /height: ?100%/);
});
