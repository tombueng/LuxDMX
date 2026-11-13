// What anyone sees at a glance, found by clicking through the app (sim/qa): the usual lights first
// when adding fixtures, effects that suit the selection first, no on-state that hides its own text,
// a plan that stays whole on a phone.
import type { Page } from '@playwright/test';
import { openConnected, patch, resetFake, selectAll, tab, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

// buttons whose text is the colour of their background (orange on orange)
const unreadable = (page: Page, root: string) => page.evaluate((root) => {
  const bgOf = (e: Element | null): string => { for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (c && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(c)) return c; } return 'rgb(0, 0, 0)'; };
  return [...document.querySelectorAll(`${root} button`)].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 2 && [...b.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && getComputedStyle(b).color === bgOf(b);
  }).map((b) => (b as HTMLElement).innerText.trim());
}, root);

test('adding fixtures: the generic lights come before the WS2812 rings, every built-in type says what it is', async ({ page }) => {
  await openConnected(page);
  await tab(page, 'Fixtures');
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Add fixtures' });
  const heads = await dlg.locator('h3.mh').allTextContents();
  expect(heads[0]).toMatch(/^Generic lights/);
  expect(heads.findIndex((h) => /^LED rings and matrices/.test(h))).toBeGreaterThan(0);
  await expect(dlg.locator('.tcard .faint', { hasText: 'from the built-in ones' })).toHaveCount(0);
  // the Add panel stays in view with the list scrolled down
  await dlg.locator('.body').evaluate((b) => { b.scrollTop = b.scrollHeight; });
  await expect(dlg.getByRole('button', { name: /^Add \d+ ×/ })).toBeInViewport();
});

test('the effect library: with PARs selected the ring and matrix pictures come last', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 4, 0, 'PAR');
  await selectAll(page);
  await tab(page, 'Effects');
  await page.getByRole('button', { name: 'Open the effect library' }).click();
  const lib = page.getByRole('dialog', { name: 'Add an effect' });
  const h = await lib.locator('.body h2').allTextContents();
  expect(h.slice(-2)).toEqual(['Rings and matrices', 'Add-ons']);
  expect(h[0]).toBe('Colour');
});

test('the console: a selected fader page and Lowlight show their names (not orange on orange)', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 4, 0, 'PAR');
  await page.locator('[role=tab][aria-label=Console]').click();
  await expect(page.getByRole('radio', { name: 'Lights' })).toBeVisible();
  expect(await unreadable(page, 'body')).toEqual([]);
});

test.describe('a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('the plan stays whole: lights at the edges of the stage are inside its frame', async ({ page }) => {
    await openConnected(page);
    await page.locator('.top .show').click();
    await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Band' }).click();
    const svg = page.locator('svg[role=application]').first();
    await expect(svg.locator('g[role=button]').first()).toBeVisible();
    const out = await svg.evaluate((s) => {
      const r = s.getBoundingClientRect();
      return [...s.querySelectorAll('g[role=button]')].map((n) => n.getBoundingClientRect()).filter((b) => b.width)
        .filter((b) => b.left < r.left - 1 || b.right > r.right + 1).length;
    });
    expect(out).toBe(0);
  });
});

test.describe('a laptop (1366 x 768)', () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test('the stage gets the room: the cues take a smaller share and still show a whole row of cards', async ({ page }) => {
    await openConnected(page);
    await page.locator('.top .show').click();
    await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Band' }).click();
    await page.locator('[role=tab][aria-label=Program]').click();
    const stage = await page.locator('.stage-wrap').boundingBox(), deck = await page.locator('.prog.desktop .foot').boundingBox();
    expect(stage!.height).toBeGreaterThan(400);
    const card = page.locator('.deck .card').first();
    await expect(card).toBeVisible();
    const c = await card.boundingBox();
    expect(c!.y + c!.height).toBeLessThanOrEqual(deck!.y + deck!.height);
  });
});

test('a box address that can\'t be one is said and not added; the text stays to put right', async ({ page }) => {
  await openConnected(page);
  const add = page.getByRole('button', { name: 'Add a LuxDMX' });
  const boxes = page.getByRole('button', { name: /^LuxDMX boxes/ });
  if (await boxes.isVisible()) await boxes.click(); else await add.click();
  await page.getByLabel('LuxDMX address').fill('not a host!!');
  await page.getByRole('button', { name: 'Add LuxDMX' }).click();
  await expect(page.getByText(/isn't an address: type the box's IP/)).toBeVisible();
  await expect(page.getByLabel('LuxDMX address')).toHaveValue('not a host!!');
  expect(await page.evaluate(() => (window as any).__luxdmx.show.outputs.devices.length)).toBe(1);
});

test('a cue\'s fade field takes what you type: 9999 stays until you leave it (then 600), 1,5 and 1.5 both are 1.5 s', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 1, 0, 'D');
  await selectAll(page);
  await page.locator('.prog').getByRole('button', { name: 'Full' }).click();
  await page.locator('.deck .record').click();
  await page.locator('.deck .card').first().click();
  const fade = page.locator('.insp').getByLabel('Fade', { exact: true });
  const stored = () => page.evaluate(() => (window as any).__luxdmx.show.cueLists[0].cues[0].fade);
  await fade.click(); await fade.press('Control+a'); await page.keyboard.type('9999');
  await expect(fade).toHaveValue('9999');                                  // (nothing rewritten while typing)
  await fade.press('Tab');
  await expect(fade).toHaveValue('600');
  expect(await stored()).toBe(600);
  for (const typed of ['1,5', '1.5']) {
    await fade.click(); await fade.press('Control+a'); await page.keyboard.type(typed); await fade.press('Tab');
    expect(await stored()).toBe(1.5);
  }
  await fade.click(); await fade.press('ArrowUp'); expect(await stored()).toBe(2);
});
