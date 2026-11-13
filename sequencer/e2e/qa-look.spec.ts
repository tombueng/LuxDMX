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
    // the interface at 130 %: the cards grow, the cues' share with them
    await page.evaluate(() => { document.documentElement.style.fontSize = `${87.5 * 1.3}%`; });
    await page.waitForTimeout(400);
    const d2 = (await page.locator('.prog.desktop .foot').boundingBox())!, c2 = (await card.boundingBox())!;
    expect(c2.y + c2.height).toBeLessThanOrEqual(d2.y + d2.height + 1);
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

test('Mounting: angles show rounded; a beam angle typed into a filled field replaces it, a wrong one shows what was kept', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 1, 0, 'Par');
  await page.locator('.fl li[data-fixture="Par"]').dblclick();
  const dlg = page.getByRole('dialog', { name: 'Patch: Par' });
  await dlg.getByRole('tab', { name: 'Mounting' }).click();
  for (const a of ['Turn', 'Tip', 'Roll']) expect(await dlg.getByLabel(a, { exact: true }).inputValue()).toMatch(/^-?\d+(\.\d)?$/);
  const narrow = dlg.getByLabel('Beam angle, narrowest'), wide = dlg.getByLabel('Beam angle, widest');
  await narrow.click(); await page.keyboard.type('40');
  await wide.click();                                                      // (the mouse: from one field into the next)
  await expect(wide).toHaveValue('40');
  await page.keyboard.type('10'); await wide.press('Tab');
  await expect(wide).toHaveValue('40');                                    // (10 and 40: the narrowest is 10 now)
  await expect(narrow).toHaveValue('10');
  expect(await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].beamDeg)).toEqual([10, 40]);
  await narrow.click(); await wide.click(); await page.keyboard.type('4010'); await wide.press('Tab');
  await expect(wide).not.toHaveValue('4010');
});

test.describe('machines in the fixture list on a laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test('their names keep their room: a short mark (⚠, 1×, fog), safe or armed in its label and colour', async ({ page }) => {
    await openConnected(page);
    await patch(page, 'gen-flame', 1, 0, 'Flame');
    await patch(page, 'gen-confetti', 1, 0, 'Confetti');
    await patch(page, 'gen-fog', 1, 0, 'Fog');
    for (const [name, mark] of [['Flame', '⚠'], ['Confetti', '1×'], ['Fog', 'fog']] as const) {
      const row = page.locator(`.fl li[data-fixture="${name}"]`);
      await expect(row.locator('.risk')).toHaveText(mark);
      expect(await row.locator('.nm').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    }
    await expect(page.locator('.fl li[data-fixture="Flame"] .risk')).toHaveAttribute('aria-label', /safe$/);
  });
});

test.describe('the fixture library on a laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test('Robe before strobes, a 35-channel mode stays inside the dialog, the search box stays put, nothing found leads to Make my own', async ({ page }) => {
    await openConnected(page);
    await tab(page, 'Fixtures');
    await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
    await page.getByRole('button', { name: /^Search 2400/ }).click();
    const lib = page.getByRole('dialog', { name: 'Fixture library' });
    const box = lib.getByLabel('Search fixtures');
    await box.fill('robe');
    await expect(lib.getByRole('option').first()).toContainText('Robe');
    await expect(lib.locator('.builtin')).toHaveCount(0);                  // (no "Generic Strobe" for robe)
    const y1 = (await box.boundingBox())!.y;
    await box.fill('LEDBeam 100');
    await expect(lib.getByRole('option')).toHaveCount(2);
    expect(Math.abs((await box.boundingBox())!.y - y1)).toBeLessThan(2);   // (the box doesn't jump as the list shrinks)
    await lib.getByRole('option', { name: /Robin LEDBeam 100 OFL/ }).click();
    await lib.getByRole('radio', { name: /^RGBW Pixel/ }).click();
    const d = (await lib.boundingBox())!;
    const outside = await lib.locator('.chs li').evaluateAll((els, d) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.right > d.x + d.width + 1; }).length, d);
    expect(outside).toBe(0);
    await box.fill('zzqqxx nothing');
    await lib.getByRole('button', { name: 'Make my own…' }).click();
    await expect(page.getByRole('dialog', { name: /fixture/i }).getByLabel('Model')).toBeVisible();
  });
});

test('a start address that runs past 512 is said in the preview, with where they would fit; Add puts in none of them', async ({ page }) => {
  await openConnected(page);
  await tab(page, 'Fixtures');
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Add fixtures' });
  await dlg.locator('.tcard', { hasText: 'Dimmer + RGBW + Strobe' }).first().click();     // (6 channels)
  await dlg.getByLabel('How many').fill('2');
  await dlg.getByLabel('Start address').fill('510');
  await expect(dlg.getByText(/510 to 521 runs past 512/)).toBeVisible();
  await dlg.getByRole('button', { name: /^Add 2 ×/ }).click();
  await expect(dlg.getByText(/would run past channel 512 of universe 0: start at 501 at most/)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__luxdmx.show.fixtures.length)).toBe(0);
  await dlg.getByRole('button', { name: 'Start at 501' }).click();
  await dlg.getByRole('button', { name: /^Add 2 ×/ }).click();
  await expect(dlg).toBeHidden();
  expect(await page.evaluate(() => (window as any).__luxdmx.show.fixtures.map((f: { address: number }) => f.address))).toEqual([501, 507]);
});

test('four heads added to the full Band stage land clear of the lights there and of each other', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Band' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.fixtures.length)).toBeGreaterThan(30);
  const before = await page.evaluate(() => (window as any).__luxdmx.show.fixtures.map((f: { id: string }) => f.id));
  await tab(page, 'Fixtures');
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Add fixtures' });
  await dlg.locator('.tcard', { hasText: 'Moving head' }).first().click();
  await dlg.getByLabel('How many').fill('4');
  await dlg.getByLabel('Name').fill('MH-X25');
  await dlg.getByRole('button', { name: /^Add 4 ×/ }).click();
  await expect(dlg).toBeHidden();
  const near = await page.evaluate((old: string[]) => {
    const all = (window as any).__luxdmx.show.fixtures as { id: string; x: number; y: number }[];
    const fresh = all.filter((f) => !old.includes(f.id));
    return Math.min(...fresh.map((f) => Math.min(...all.filter((o) => o !== f).map((o) => Math.hypot((f.x - o.x) * 1.6, f.y - o.y)))));
  }, before);
  expect(near).toBeGreaterThanOrEqual(0.1);
});

test.describe('the boxes list folded on a laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test('removing the only box keeps the list open (it says there is none now); closed, the bar looks again', async ({ page }) => {
    await openConnected(page);
    const boxes = page.locator('.top').getByRole('button', { name: /LuxDMX boxes/ });
    await expect(boxes).toBeVisible();                                   // (folded: the pills don't fit at 1366)
    if (!(await page.locator('.pop.list').isVisible())) await boxes.click();
    const list = page.locator('.pop.list');
    await list.getByRole('button', { name: /^Remove / }).click();
    await expect(list).toBeVisible();
    await expect(list).toContainText('No LuxDMX in this show yet');
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(page.getByRole('button', { name: 'Add a LuxDMX' })).toBeVisible();   // (room again: back on the bar)
  });
});

test('Find anything says "colour preset", like the rest of the app', async ({ page }) => {
  await openConnected(page);
  await page.locator('body').press('Control+k');
  const find = page.getByRole('dialog', { name: 'Find anything' });
  await find.getByRole('combobox').fill('red');
  await expect(find.getByRole('option', { name: /colour preset/ }).first()).toBeVisible();
  await expect(find).not.toContainText('color preset');
});

test('a programmer chip clicked stays lit after its scroll, even for a part that cannot reach the top', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover8', 1, 0, 'Head');
  await selectAll(page);
  const chips = page.getByRole('navigation', { name: 'Programmer parts' });
  await chips.getByRole('button', { name: 'Position' }).click();
  await page.waitForTimeout(900);                                         // (the smooth scroll done)
  await expect(chips.getByRole('button', { name: 'Position' })).toHaveAttribute('aria-current', 'true');
  await chips.getByRole('button', { name: 'Colour' }).click();
  await page.waitForTimeout(900);
  await expect(chips.getByRole('button', { name: 'Colour' })).toHaveAttribute('aria-current', 'true');
});

test.describe('the 2D plan on a laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test('every name shown stays inside the plan (the back row\'s too), and the toolbar keeps one row', async ({ page }) => {
    await openConnected(page);
    await page.locator('.top .show').click();
    await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Band' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.fixtures.length)).toBeGreaterThan(30);
    const stage = page.locator('.stage-wrap');
    if (await stage.getByRole('button', { name: '2D', exact: true }).isVisible()) await stage.getByRole('button', { name: '2D', exact: true }).click();
    const svg = stage.locator('svg[aria-label="Stage"]');
    await expect(svg).toBeVisible();
    await page.waitForTimeout(500);
    const out = await svg.evaluate((s) => {
      const r = s.getBoundingClientRect();
      return [...s.querySelectorAll('text')].filter((t) => { const b = t.getBoundingClientRect(); return b.width > 0 && (b.top < r.top - 0.5 || b.bottom > r.bottom + 0.5 || b.left < r.left - 0.5 || b.right > r.right + 0.5); }).map((t) => t.textContent);
    });
    expect(out).toEqual([]);
    const tops = await stage.locator('.head button:visible').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top / 8))).size);
    expect(tops).toBeLessThanOrEqual(2);                                   // (the title row and one row of tools)
    // each name reads as its own light's (none nearer to another light), and none overlap, also
    // with the numbers and addresses on
    const check = () => svg.evaluate((s) => {
      const body = (n: string) => s.querySelector(`.fx[data-name="${n}"] [stroke-width]`)!.getBoundingClientRect();
      const names = [...s.querySelectorAll('.fx')].map((g) => (g as SVGGElement).dataset.name!);
      const lbl = [...s.querySelectorAll<SVGTextElement>('text.lbl')].map((t) => ({ n: t.dataset.for!, r: t.getBoundingClientRect() }));
      const wrong: string[] = [], over: string[] = [];
      // (a name under its light or beside it goes by where names go; one above it sits under the
      // row before, so that one has to be nearest its own)
      for (const l of lbl) {
        const c = { x: l.r.x + l.r.width / 2, y: l.r.y + l.r.height / 2 };
        if (c.y >= body(l.n).top) continue;
        // (to the edge of its symbol: a long bar's name at its end is next to it)
        const d = (n: string) => { const r = body(n); return Math.hypot(Math.max(r.left - c.x, 0, c.x - r.right), Math.max(r.top - c.y, 0, c.y - r.bottom)); };
        const near = names.reduce((a, b) => (d(b) < d(a) ? b : a));
        if (near !== l.n) wrong.push(`${l.n} reads as ${near}`);
      }
      for (let i = 0; i < lbl.length; i++) for (let j = i + 1; j < lbl.length; j++) {
        const a = lbl[i].r, b = lbl[j].r;
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) over.push(`${lbl[i].n}/${lbl[j].n}`);
      }
      return { n: lbl.length, wrong, over };
    });
    const names = await check();
    expect(names.wrong).toEqual([]);
    expect(names.over).toEqual([]);
    expect(names.n).toBeGreaterThan(20);
    await stage.getByRole('button', { name: 'Numbers and DMX addresses' }).click();
    const both = await check();
    expect(both.wrong).toEqual([]);
    expect(both.over).toEqual([]);
  });
});

test.describe('help notes on a laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test('every "?" note opens on the screen and whole, the cues\' one low down too (upwards), the timeline\'s in its narrow panel', async ({ page }) => {
    await openConnected(page);
    await page.locator('.top .show').click();
    await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Band' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.fixtures.length)).toBeGreaterThan(30);
    for (const view of ['Program', 'Timeline', 'Live', 'Console']) {
      await page.locator('.top .modes').getByRole('tab', { name: view }).click();
      const qs = page.locator('.help > button.q:visible');                 // (every "?", whatever it's called: "About the timeline")
      const n = await qs.count();
      expect(n).toBeGreaterThanOrEqual(view === 'Program' ? 4 : 1);
      for (let i = 0; i < n; i++) {
        await qs.nth(i).click();
        const note = page.locator('.help .pop');
        await expect(note).toBeVisible();
        const r = (await note.boundingBox())!;
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.y + r.height).toBeLessThanOrEqual(768);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(1366);
        // (not cut off by its panel: its right edge is what's there)
        expect(await note.evaluate((p) => { const b = p.getBoundingClientRect(); return p.contains(document.elementFromPoint(b.right - 6, b.top + 12)); }), `${view} ?${i}`).toBe(true);
        await page.keyboard.press('Escape');
        await expect(note).toBeHidden();
      }
    }
  });
});

test.describe('the 2D plan on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('no zoom button alone on a toolbar row (a phone pinches); the plan has the room', async ({ page }) => {
    await openConnected(page);
    await page.evaluate(() => (window as any).__luxdmx.addFixtures('gen-rgb', '', 4, 0, 'P'));
    const stage = page.locator('.stage-wrap');
    await expect(stage.locator('svg[aria-label="Stage"]')).toBeVisible();
    await expect(stage.getByRole('button', { name: 'Zoom in' })).toBeHidden();
    await expect(stage.getByRole('button', { name: 'Invert' })).toBeVisible();
  });
});

test('every chip on the timeline\'s palette says what it does on hover (effects and moments too)', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Band' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.effects.length)).toBeGreaterThan(2);
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  const chips = page.locator('.tlv .pal .chip');
  await expect(chips.first()).toBeVisible();
  const bare = await chips.evaluateAll((els) => els.filter((e) => !e.getAttribute('title')).map((e) => e.textContent));
  expect(bare).toEqual([]);
});

test.describe('a crowded plan on a small laptop screen', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test('the DJ stage: the names go a size smaller so more of them fit, still none over another', async ({ page }) => {
    await openConnected(page);
    await page.locator('.top .show').click();
    await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^DJ \/ Party$/ }) }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.fixtures.length)).toBeGreaterThan(40);
    const stage = page.locator('.stage-wrap');
    const two = stage.getByRole('button', { name: '2D', exact: true });
    if (await two.isVisible()) await two.click();
    await expect(stage.locator('text.lbl').first()).toBeVisible();
    await page.waitForTimeout(400);
    const r = await stage.locator('text.lbl').evaluateAll((els) => {
      const box = els.map((e) => e.getBoundingClientRect());
      let over = 0;
      for (let i = 0; i < box.length; i++) for (let j = i + 1; j < box.length; j++) if (Math.min(box[i].right, box[j].right) - Math.max(box[i].left, box[j].left) > 1 && Math.min(box[i].bottom, box[j].bottom) - Math.max(box[i].top, box[j].top) > 1) over++;
      return { n: els.length, over };
    });
    expect(r.over).toBe(0);
    expect(r.n).toBeGreaterThanOrEqual(18);                        // (14 of 48 at the one size)
  });
});

test('a note added to the cue on stage: its row in the Live cue list stays in view, name and all', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Theatre' }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  const panel = page.getByRole('region', { name: /Cue list Show/ });
  await expect(panel.locator('li').first()).toBeVisible();
  await page.keyboard.press('Space');
  await expect(panel.locator('li.live')).toHaveCount(1);
  const i = await panel.locator('li').evaluateAll((els) => els.findIndex((e) => e.classList.contains('live')));
  await page.evaluate((k) => { const a = (window as any).__luxdmx; const l = a.show.cueLists.find((x: any) => x.name === 'Show'); l.cues[k].note = 'Wait for the singer to walk on, then a slow fade up from the wings'; a.checkpoint(); }, i);
  await expect(panel.locator('li.live .note')).toBeVisible();
  await page.waitForTimeout(700);
  const r = await panel.locator('ol').evaluate((ol) => { const b = ol.getBoundingClientRect(), row = ol.querySelector('li.live .nm')!.getBoundingClientRect(); return { rowTop: row.top, boxTop: b.top }; });
  expect(r.rowTop).toBeGreaterThanOrEqual(r.boxTop - 1);
});

test.describe('the Live page on a phone with its stage shown', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('the stage keeps to its box: the heading under it isn\'t covered', async ({ page }) => {
    await openConnected(page);
    await page.evaluate(() => (window as any).__luxdmx.addFixtures('gen-rgb', '', 4, 0, 'PAR'));
    await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
    await page.getByRole('button', { name: 'More for this page' }).click();
    await page.getByRole('menuitem', { name: 'Show the stage' }).click();
    const box = page.locator('.stagebox');
    await expect(box.locator('.stage-wrap')).toBeVisible();
    const r = await box.evaluate((b) => ({ box: b.getBoundingClientRect().bottom, wrap: b.querySelector('.stage-wrap')!.getBoundingClientRect().bottom }));
    expect(r.wrap).toBeLessThanOrEqual(r.box + 1);
  });
});

test('the Loop button says whether it\'s on', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 2, 0, 'P');
  await selectAll(page);
  await page.locator('.prog').getByLabel('Intensity', { exact: true }).fill('1');
  await page.locator('.deck').getByRole('button', { name: /^Record/ }).click();
  const loop = page.locator('.deck').getByRole('button', { name: 'Loop', exact: true });
  await expect(loop).toHaveAttribute('aria-pressed', 'false');
  await loop.click();
  await expect(loop).toHaveAttribute('aria-pressed', 'true');
});

test.describe('Live page tabs on a laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test('a long page name ends in … (the bar keeps one row); pages move left and right from their menu', async ({ page }) => {
    await openConnected(page);
    await patch(page, 'gen-rgb', 2, 0, 'P');
    await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
    await page.evaluate(() => {
      const a = (window as any).__luxdmx, own = a.ownPages();
      own[0].name = 'A very long page name for the encore section of the show';
      own.push({ ...JSON.parse(JSON.stringify(own[0])), id: 'pg-qa2', name: 'Second' });
      a.checkpoint();
    });
    const tabs = page.getByRole('tablist', { name: 'Pages' }).getByRole('tab');
    await expect(tabs).toHaveCount(2);
    const first = tabs.first();
    expect(await first.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);              // (cut, …)
    await expect(first).toHaveAttribute('title', /^A very long page name for the encore section of the show:/);
    const tops = await tabs.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
    expect(tops).toBe(1);
    await tabs.nth(1).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move left' }).click();
    await expect(tabs.first()).toHaveText('Second');
  });
});

test('the programmer says which effects run on the selected lights, by what they work on (a pixel effect too, no "undefined")', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Band' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.effects.length)).toBeGreaterThan(2);
  await page.evaluate(() => { const a = (window as any).__luxdmx, e = a.show.effects.find((x: any) => x.name === 'Bar twinkles'); a.toggleEffect(e.id); a.selected = [a.show.fixtures.find((f: any) => f.name === 'Bar 1').id]; });
  const note = page.locator('.prog .fxnote');
  await expect(note).toContainText('Bar twinkles (cells) is running on these lights');
  await expect(note).not.toContainText('undefined');
});

test('the effect editor: the beats choice shows what it is, seconds and blocks keep to what they can be', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Band' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.effects.length)).toBeGreaterThan(2);
  await page.locator('.side').getByRole('tab', { name: 'Effects' }).click();
  await page.locator('.side .ep li', { hasText: 'Back wave' }).first().click();
  const beats = page.getByLabel('Beats per cycle');
  await expect(beats).toBeVisible();
  expect((await beats.boundingBox())!.width).toBeGreaterThan(60);                                    // (it was 19 px, its arrow only)
  const tempo = page.locator('label.tempo input');
  if (await tempo.isChecked()) await tempo.uncheck();
  const secs = page.getByLabel('Seconds per cycle');
  await secs.fill('-3'); await secs.press('Tab');
  await expect(secs).toHaveValue('0.05');                                    // (it showed -3 with 0.05 kept)
  await page.locator('.ed .morebtn').click();                                                         // (Blocks is under More)
  const blocks = page.getByLabel('Blocks');
  await expect(blocks).toBeVisible();
  await blocks.fill('0'); await blocks.press('Tab'); await expect(blocks).toHaveValue('1');
});

test('Find anything knows calibrate, aim and channels; "All channels" opens the programmer\'s channel list', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover8', 2, 0, 'Head');
  const find = page.getByRole('dialog', { name: 'Find anything' });
  for (const [q, want] of [['calibrate', /Focus and calibrate/], ['aim', /Aim the heads/], ['channels', /All channels/]] as const) {
    await page.locator('body').press('Control+k');
    await find.getByRole('combobox').fill(q);
    await expect(find.getByRole('option', { name: want }).first()).toBeVisible();
    if (q !== 'channels') await page.keyboard.press('Escape');
  }
  await find.getByRole('option', { name: /All channels/ }).first().click();
  await expect(page.locator('#pg-all-ch')).toHaveAttribute('open', '');
});

test('a song part moves to the playhead from its menu (on the bar), and the parts stay in order', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  await page.locator('.tlv').getByRole('button', { name: 'Demo songs…' }).click();
  await page.getByRole('dialog', { name: 'Demo songs' }).getByRole('button', { name: 'Use Demo beat' }).click();
  const secs = page.locator('.tlv .sec');
  await expect(secs.first()).toBeVisible();
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(20));
  const name = (await secs.nth(1).textContent())!.trim();
  await secs.nth(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Move it to the playhead/ }).click();
  const parts = await page.evaluate(() => (window as any).__luxdmx.show.timeline.sections.map((s: any) => [s.name, s.at]));
  const moved = parts.find(([n]: [string]) => n === name);
  expect(moved).toBeTruthy();
  expect(Math.abs(moved[1] - 20)).toBeLessThan(2.1);                    // (on the bar nearest 20 s)
  const ats = parts.map((p: [string, number]) => p[1]);
  expect(ats).toEqual([...ats].sort((x: number, y: number) => x - y));
  const errs: string[] = [];
  page.on('console', (m) => { if (/assignment_value_stale/.test(m.text())) errs.push(m.text()); });
  await page.keyboard.press('p');
  expect(errs).toEqual([]);
});

test('small things: the remote says when there\'s no address; a pasted effect lands next to the one copied; a new timeline says how long it runs before Play', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 2, 0, 'P');
  // the timeline of a new show: as long as it's drawn (it said "/ 0:00" until Play, then "/ 4:00")
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.locator('.tlv .clock')).toContainText('/ 4:00');
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  // two effects, the first copied and pasted: the copy right after it
  await page.evaluate(() => {
    const a = (window as any).__luxdmx, ids = a.show.fixtures.map((f: any) => f.id);
    a.show.effects.push({ id: 'qe1', name: 'First', kind: 'rainbow', fixtures: ids, params: {} }, { id: 'qe2', name: 'Second', kind: 'rainbow', fixtures: ids, params: {} });
    a.checkpoint();
  });
  await page.locator('.side').getByRole('tab', { name: 'Effects' }).click();
  await page.locator('.side .olist li', { hasText: 'First' }).first().click();
  await page.locator('.side .olist').press('Control+c');
  await page.locator('.side .olist').press('Control+v');
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.effects.map((e: any) => e.name))).toEqual(['First', 'First (copy)', 'Second']);
  // the remote: Add with no address says what to type
  await page.locator('body').press('Control+k');
  await page.getByRole('dialog', { name: 'Find anything' }).getByRole('combobox').fill('phone as a remote');
  await page.keyboard.press('Enter');
  const rem = page.getByRole('dialog', { name: /Phone as a remote/ });
  const add = rem.getByRole('button', { name: /^Add/ }).first();
  if (await add.isVisible()) { await add.click(); await expect(page.locator('.toast')).toContainText("Type your LuxDMX box's address first"); }
});

test.describe('the padlock on a tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true });
  test('a tap gives the choice: with a PIN or without (the PIN was only on a right-click)', async ({ page }) => {
    await openConnected(page);
    await page.evaluate(() => (window as any).__luxdmx.addFixtures('gen-rgb', '', 2, 0, 'P'));
    await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
    await page.locator('.live').getByRole('button', { name: 'Lock page' }).tap();
    await expect(page.getByRole('menuitem', { name: /a page with just the looks/ })).toBeVisible();   // (for staff: no machines, no Blackout)
    await page.getByRole('menuitem', { name: /^Lock with a PIN/ }).tap();
    const ask = page.getByRole('dialog', { name: 'Lock with a PIN' });
    await ask.getByLabel(/PIN/).fill('2468');
    await ask.getByRole('button', { name: 'Lock' }).tap();
    await expect(page.locator('.live').getByRole('button', { name: /Unlock page/ })).toBeVisible();
  });
});

test('an effect put on a part of the song runs to the end of that part', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 2, 0, 'P');
  await page.evaluate(() => { const a = (window as any).__luxdmx, ids = a.show.fixtures.map((f: any) => f.id); a.show.effects.push({ id: 'qfx', name: 'Rainbow', kind: 'rainbow', fixtures: ids, params: {} }); a.checkpoint(); });
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  await page.locator('.tlv').getByRole('button', { name: 'Demo songs…' }).click();
  await page.getByRole('dialog', { name: 'Demo songs' }).getByRole('button', { name: 'Use Demo beat' }).click();
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.show.timeline.sections = [{ name: 'Intro', at: 0 }, { name: 'Verse', at: 8 }, { name: 'Chorus', at: 21.9 }, { name: 'Outro', at: 40 }]; a.checkpoint(); });
  await expect(page.locator('.tlv .sec')).toHaveCount(4);
  await page.locator('.tlv .sec', { hasText: 'Verse' }).click();                     // (the playhead on the verse)
  await page.locator('.tlv .pal .chip.fx', { hasText: 'Rainbow' }).click();
  const it = await page.evaluate(() => (window as any).__luxdmx.show.timeline.items.find((i: any) => i.do.do === 'effect'));
  expect(it.at).toBeCloseTo(8, 1);
  expect(it.at + it.len).toBeCloseTo(21.9, 1);                                        // (to the chorus, not 8 bars)
});

test.describe('selecting several on a tablet', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  test('+ Add: taps add lights and groups to the selection (a finger has no Shift)', async ({ page }) => {
    await openConnected(page);
    await page.evaluate(() => { const a = (window as any).__luxdmx; a.addFixtures('gen-rgb', '', 3, 0, 'P'); a.selected = []; });
    const stage = page.locator('.stage-wrap');
    await stage.locator('.fx[data-name="P 1"] [stroke-width]').first().tap();
    await stage.locator('.fx[data-name="P 2"] [stroke-width]').first().tap();
    expect(await page.evaluate(() => (window as any).__luxdmx.selected.length)).toBe(1);          // (a tap picks just that one)
    await stage.getByRole('button', { name: '+ Add' }).tap();
    await stage.locator('.fx[data-name="P 3"] [stroke-width]').first().tap();
    await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.selected.length)).toBe(2);
    await stage.locator('.fx[data-name="P 3"] [stroke-width]').first().tap();                     // (again: out)
    await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.selected.length)).toBe(1);
  });
});

test('an empty show says what to do next, the same way everywhere, with a button where the next step is elsewhere', async ({ page }) => {
  await openConnected(page);
  await expect(page.locator('.deck')).toContainText('No cues yet');
  await expect(page.locator('.prog').getByRole('button', { name: 'Add lights' })).toBeVisible();          // (the programmer)
  // Groups: lights first; Live: where its buttons come from
  await page.locator('.side .tabs').getByRole('tab', { name: 'Groups' }).click();
  await expect(page.locator('.gp')).toContainText('No lights yet: add them first');
  await expect(page.locator('.gp').getByRole('button', { name: 'Add lights' })).toBeVisible();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('.live .grid .empty')).toContainText('Nothing to play yet');
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  // the effects with no lights at all
  await page.locator('.side .tabs').getByRole('tab', { name: 'Effects' }).click();
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  const lib = page.getByRole('dialog', { name: 'Add an effect' });
  await expect(lib).toContainText('No lights yet: add them first');
  await expect(lib.locator('button.on', { hasText: 'the selected lights' })).toHaveCount(0);          // (no "✓ … (0)")
  await page.keyboard.press('Escape');
  // the timeline: no cues to drag yet
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.locator('.tlv .hint.empty')).toContainText('No cues yet: record some in Program');
  await page.locator('.tlv .hint.empty').getByRole('button', { name: 'Go to Program' }).click();
  await expect(page.locator('.top .modes').getByRole('tab', { name: 'Program' })).toHaveAttribute('aria-selected', 'true');
});

test('Find anything goes to every view by name, finds "add light" and "group"', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 2, 0, 'P');
  const find = page.getByRole('dialog', { name: 'Find anything' });
  for (const [q, want] of [['timeline', /^Go to Timeline/], ['add light', /^Add fixtures/], ['group', /^Groups: make one/]] as const) {
    await page.locator('body').press('Control+k');
    await find.getByRole('combobox').fill(q);
    await expect(find.getByRole('option', { name: want }).first()).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await page.locator('body').press('Control+k');
  await find.getByRole('combobox').fill('go to timeline');
  await page.keyboard.press('Enter');
  await expect(page.locator('.top .modes').getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true');
});

test('a laptop at 140 % interface size: the fixture list still shows lights, the show keeps its name', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openConnected(page);
  await patch(page, 'gen-dimmer', 24, 0, 'Front');                       // (over 12: the list has its filter too)
  await page.evaluate(async () => { const m = await import('/src/ui/ui.svelte.ts'); m.ui.help = true; m.ui.setZoom(1.4); });
  await page.waitForTimeout(400);
  const list = page.locator('.fl');
  // at least one light's row whole in view inside the panel
  expect(await list.evaluate((fl) => {
    const ol = fl.querySelector('.olist')!; ol.scrollTop = 0;
    const p = ol.getBoundingClientRect();         // (the list's own window: rows it clips don't count)
    return [...fl.querySelectorAll('li.oitem')].filter((r) => { const b = r.getBoundingClientRect(); return b.height > 20 && b.top >= p.top && b.bottom <= p.bottom; }).length;
  })).toBeGreaterThan(0);
  // the name: more than a letter
  const name = page.locator('.top .show .name');
  expect(await name.evaluate((n) => n.getBoundingClientRect().width)).toBeGreaterThan(60);
});

test('the timeline at 140 % on a laptop: Fit and Zoom in on the screen, the transport wraps', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openConnected(page);
  await page.evaluate(async () => { const m = await import('/src/ui/ui.svelte.ts'); m.ui.setZoom(1.4); });
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  const tr = page.locator('.tlv .transport');
  for (const name of ['Zoom in', 'Zoom out']) {
    const b = (await tr.getByRole('button', { name }).boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(1366);
  }
  const fit = (await tr.getByRole('button', { name: 'Fit' }).boundingBox())!;
  expect(fit.x + fit.width).toBeLessThanOrEqual(1366);
  // and a wide window at 100 % keeps it on one row
  await page.evaluate(async () => { const m = await import('/src/ui/ui.svelte.ts'); m.ui.setZoom(1); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect.poll(() => tr.evaluate((t) => getComputedStyle(t).flexWrap)).toBe('nowrap');
});
