// The first visit (ui/opening.ts, ui/Intro.svelte): the big demo plays at once with a short intro
// over it like subtitles, each line pointing at its button, gone by itself in about 20 s. Who
// chose an empty show or their last one gets that; a reload opens what was open.
import type { Page } from '@playwright/test';
import { test, expect } from './helpers';

// (the other specs open on the last show: here the app opens as a visitor's does)
const asVisitor = (page: Page) => page.addInitScript(() => { if (!sessionStorage.getItem('intro.e2e')) { sessionStorage.setItem('intro.e2e', '1'); localStorage.removeItem('luxdmx.seq.startwith'); } });
const app = (page: Page) => page.evaluate(() => { const a = (window as any).__luxdmx; return { lights: a.show.fixtures.length as number, playing: a.timeline.playing as boolean, id: a.showId as string, shows: a.shows.length as number }; });
const intro = (page: Page) => page.getByRole('status', { name: 'Intro' });
// (the demo's song from this server's own copy: nothing from the internet)
const offline = (p: Page | import('@playwright/test').BrowserContext) => p.route(/jamendo\.com/, (r) => r.abort());

test('a first visit: the demo plays with its intro over the stage, the intro points at Program and goes by itself; a reload keeps the show', async ({ page }) => {
  test.setTimeout(150_000);
  await asVisitor(page); await offline(page);
  // (what the intro said and pointed at, written down as it goes: a busy machine's test may look late)
  await page.addInitScript(() => {
    const seen = ((window as any).__introSeen = { lines: [] as string[], rings: 0, over: 0 });
    new MutationObserver(() => {
      const l = document.querySelector('.intro .line')?.textContent?.trim();
      if (l && seen.lines.at(-1) !== l) seen.lines.push(l);
      if (document.querySelector('.ring')) seen.rings++;
      const bar = document.querySelector('.intro')?.getBoundingClientRect(), s3 = document.querySelector('.s3')?.getBoundingClientRect();
      if (bar && s3 && bar.bottom > s3.bottom + 1) seen.over++;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.goto('/');
  await expect(intro(page)).toBeVisible({ timeout: 60000 });
  await expect.poll(async () => (await app(page)).lights, { timeout: 20000 }).toBeGreaterThan(100);
  expect((await app(page)).playing).toBe(true);
  await expect(page.getByRole('dialog', { name: "Let's get some light on stage" })).toHaveCount(0);
  await expect(intro(page)).toBeHidden({ timeout: 40000 });
  const seen = await page.evaluate(() => (window as any).__introSeen);
  expect(seen.lines[0]).toContain('a demo show, played live in your browser');
  expect(seen.lines).toContain('Your own lights: Program, then Add lights.');
  expect(seen.lines.length).toBe(5);
  expect(seen.rings).toBeGreaterThan(0);
  expect(seen.over).toBe(0);                     // (never lower than the stage's picture)
  // a reload in the same tab: the same show, no new demo, no intro
  const id = (await app(page)).id;
  await page.reload();
  await expect.poll(async () => (await app(page)).id, { timeout: 20000 }).toBe(id);
  await page.waitForTimeout(1500);
  await expect(intro(page)).toHaveCount(0);
});

test('the next visit opens what was chosen: the last show, or an empty one; the demo again replaces its untouched copy', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext();
  await offline(ctx);
  const visit = async () => { const p = await ctx.newPage(); await p.goto('/'); return p; };
  // (the first visit, as a visitor: the demo)
  let page = await ctx.newPage();
  await asVisitor(page);
  await page.goto('/');
  await expect(intro(page)).toBeVisible({ timeout: 45000 });
  const first = (await app(page)).id;
  await intro(page).getByRole('button', { name: 'End the intro' }).click();
  await expect(intro(page)).toBeHidden();
  await page.close();
  // a visit again: another demo, the untouched one from last time gone, no intro this time
  page = await visit();
  await expect.poll(async () => (await app(page)).id, { timeout: 45000 }).not.toBe(first);
  await expect.poll(async () => (await app(page)).shows, { timeout: 20000 }).toBe(1);
  await expect(intro(page)).toHaveCount(0);
  // "the last show" chosen in Shows: the next visit stays on it
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).getByLabel('When the app opens').selectOption('last');
  const kept = (await app(page)).id;
  await page.close();
  page = await visit();
  await page.waitForTimeout(3000);
  expect((await app(page)).id).toBe(kept);
  // an empty show chosen: the next visit opens one
  await page.evaluate(() => localStorage.setItem('luxdmx.seq.startwith', JSON.stringify({ v: 1, data: 'empty' })));
  await page.close();
  page = await visit();
  await expect.poll(async () => (await app(page)).lights, { timeout: 15000 }).toBe(0);
  await expect(page.getByRole('dialog', { name: "Let's get some light on stage" })).toHaveCount(0);
  await ctx.close();
});
