// The layouts people will actually use: a laptop, a tablet on a stand (touch), a phone in a hand.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, channels, patch, test, expect } from './helpers';

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.beforeEach(async () => { await resetFake(); });

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('one pane at a time: add lights, set them, record, GO, all from the bottom bar', async ({ page }) => {
    await openConnected(page);
    expect(await noSideScroll(page)).toBe(true);
    const nav = page.getByRole('navigation', { name: 'Program panes' });
    await nav.getByRole('button', { name: 'Lights' }).click();
    await page.getByRole('button', { name: 'Add your first lights' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add fixtures' });
    await dlg.locator('[data-type="gen-dimmer"]').click();
    await dlg.getByLabel('How many').fill('2');
    await dlg.getByRole('button', { name: /^Add 2 × / }).click();
    await nav.getByRole('button', { name: 'Set' }).click();
    await expect(page.locator('.actionbar')).toContainText('2 selected');
    await page.locator('.prog').getByLabel('Intensity', { exact: true }).fill('1');
    await expect.poll(() => channels(0, 2)).toEqual([255, 255]);
    await page.locator('.actionbar').getByRole('button', { name: 'Record' }).click();
    await nav.getByRole('button', { name: 'Cues' }).click();
    await expect(page.locator('.deck .card')).toHaveCount(1);
    // (one Record and one GO there: the deck's, not the bottom bar's as well)
    await expect(page.getByRole('button', { name: /^GO/ })).toHaveCount(1);
    await expect(page.locator('.actionbar').getByRole('button', { name: 'Record' })).toHaveCount(0);
    await nav.getByRole('button', { name: 'Stage' }).click();
    await expect(page.locator('.stage-wrap .fx')).toHaveCount(2);
    expect(await noSideScroll(page)).toBe(true);
    // Live works on the phone too
    await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
    await expect(page.locator('.strip').getByRole('button', { name: /^GO/ })).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
  });
});

test.describe('tablet', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  test('stage and the programmer side by side, the other lists one tab away', async ({ page }) => {
    await openConnected(page);
    await page.locator('.side .tabs').getByRole('tab', { name: 'Fixtures' }).click();
    await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Add fixtures' });
    await dlg.locator('[data-type="gen-rgb"]').click();
    await dlg.getByLabel('How many').fill('3');
    await dlg.getByRole('button', { name: /^Add 3 × / }).click();
    await page.locator('.side .tabs').getByRole('tab', { name: /^Set/ }).click();
    const stage = (await page.locator('.stage-wrap').boundingBox())!, prog = (await page.locator('.side').boundingBox())!;
    expect(prog.x).toBeGreaterThan(stage.x + stage.width - 5);          // next to each other
    expect(prog.y).toBeLessThan(stage.y + 40);
    await page.locator('.prog .sw[aria-label="Red"]').click();
    await page.locator('.prog .quick').getByRole('button', { name: 'Full' }).click();
    await expect.poll(() => channels(0, 3)).toEqual([255, 0, 0]);
    expect(await noSideScroll(page)).toBe(true);
  });
});

test.describe('touch', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  test('drag a fixture by its grip with a finger to reorder', async ({ page }) => {
    await openConnected(page);
    await page.locator('.side .tabs').getByRole('tab', { name: 'Fixtures' }).click();
    await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Add fixtures' });
    await dlg.locator('[data-type="gen-dimmer"]').click();
    await dlg.getByLabel('How many').fill('3');
    await dlg.getByLabel('Name', { exact: true }).fill('D');
    await dlg.getByRole('button', { name: /^Add 3 × / }).click();
    const items = page.locator('.fl li.oitem');
    await items.nth(0).click();
    const g = (await items.nth(0).locator('.grip').boundingBox())!, last = (await items.nth(2).boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const at = (x: number, y: number) => [{ x, y }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(g.x + g.width / 2, g.y + g.height / 2) });
    for (let k = 1; k <= 6; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(g.x + g.width / 2, g.y + (last.y + last.height - 4 - g.y) * k / 6) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(items.locator('.nm')).toHaveText(['D 2', 'D 3', 'D 1']);
  });
  test('holding a light on the stage with a finger opens its menu, like a right-click', async ({ page }) => {
    await openConnected(page);
    await patch(page, 'gen-dimmer', 1, 0, 'D');
    const g = (await page.locator('.stage-wrap g.fx').first().boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: g.x + g.width / 2, y: g.y + g.height / 2 }] });
    await page.waitForTimeout(800);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.ctx')).toBeVisible();
    await expect(page.locator('.ctx [role=menuitem]').first()).toBeVisible();
  });
});

test.describe('touch on the live page', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  test('Edit: a finger moves a control by its grip; Alt+arrows move the focused one', async ({ page }) => {
    await openConnected(page);
    await page.locator('.top .show').click();
    await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
    await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
    await page.locator('.live').getByRole('button', { name: 'Edit' }).click();
    const ids = () => page.evaluate(() => { const a = (window as any).__luxdmx; return a.livePage.widgets.map((w: any) => w.id); });
    const before = await ids();
    const grip = (await page.locator(`.live .cell[data-w="${before[2]}"] .grip`).boundingBox())!;
    const to = (await page.locator(`.live .cell[data-w="${before[0]}"]`).boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const t = (type: string, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await t('touchStart', grip.x + grip.width / 2, grip.y + grip.height / 2);
    for (let k = 1; k <= 6; k++) await t('touchMove', grip.x + (to.x + 20 - grip.x) * k / 6, grip.y + (to.y + 20 - grip.y) * k / 6);
    await t('touchEnd');
    await expect.poll(ids).toEqual([before[2], before[0], before[1], ...before.slice(3)]);
    // keys: Alt+Right moves it back one, the focus stays on it
    await page.locator(`.live .cell[data-w="${before[2]}"] [data-widget]`).focus();
    await page.keyboard.press('Alt+ArrowRight');
    await expect.poll(ids).toEqual([before[0], before[2], before[1], ...before.slice(3)]);
    await expect(page.locator(`.live .cell[data-w="${before[2]}"] [data-widget]`)).toBeFocused();
  });
  test('a swipe across a look does not fire it, a tap does; holding fog never opens a menu', async ({ page }) => {
    await openConnected(page);
    await page.locator('.top .show').click();
    await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
    await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
    const cdp = await page.context().newCDPSession(page);
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const look = page.locator('.live .tile.cue').nth(2);
    const b = (await look.boundingBox())!;
    // a swipe that starts on the look
    await touch('touchStart', b.x + b.width / 2, b.y + b.height / 2);
    for (let k = 1; k <= 5; k++) await touch('touchMove', b.x + b.width / 2, b.y + b.height / 2 - k * 30);
    await touch('touchEnd', 0, 0);
    await page.waitForTimeout(1200);                            // let the scroll come to rest (a tap would only stop it)
    await expect(look).not.toHaveClass(/\bon\b/);
    // a tap (the swipe scrolled the buttons: bring it back and find it again)
    await look.scrollIntoViewIfNeeded();
    const c = (await look.boundingBox())!;
    await touch('touchStart', c.x + c.width / 2, c.y + c.height / 2);
    await touch('touchEnd', 0, 0);
    await expect(look).toHaveClass(/\bon\b/);
    // hold fog for a second: fog runs, no menu
    await page.locator('.live [data-widget="fog"]').scrollIntoViewIfNeeded();
    const fog = (await page.locator('.live [data-widget="fog"]').boundingBox())!;
    await touch('touchStart', fog.x + fog.width / 2, fog.y + fog.height / 2);
    await page.waitForTimeout(1000);
    await expect.poll(async () => (await channels(0, 91))[90]).toBe(255);
    await expect(page.locator('.ctx')).toHaveCount(0);
    await touch('touchEnd', 0, 0);
    await expect.poll(async () => (await channels(0, 91))[90]).toBe(0);
    await expect(page.locator('.ctx')).toHaveCount(0);
  });
});

test.describe('faders on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('a swipe over a fader scrolls the page; hold it a moment and it moves', async ({ page }) => {
    await openConnected(page);
    await page.locator('.top .show').click();
    await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
    await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
    const cdp = await page.context().newCDPSession(page);
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const fader = page.locator('.live .tile.fader').first();
    await fader.scrollIntoViewIfNeeded();
    const value = async () => Number(await fader.getAttribute('aria-valuenow'));
    const before = await value();
    // a quick swipe down over it (it was scrolled into view, so the page can scroll back up)
    let b = (await fader.boundingBox())!;
    await touch('touchStart', b.x + b.width / 2, b.y + 10);
    for (let k = 1; k <= 6; k++) await touch('touchMove', b.x + b.width / 2, b.y + 10 + k * 25);
    await touch('touchEnd', 0, 0);
    await page.waitForTimeout(800);
    expect(await value()).toBe(before);
    expect((await fader.boundingBox())!.y).toBeGreaterThan(b.y + 40);        // the page moved, not the fader
    // hold still, then pull down: the fader follows
    await fader.scrollIntoViewIfNeeded();
    b = (await fader.boundingBox())!;
    await touch('touchStart', b.x + b.width / 2, b.y + 12);
    await page.waitForTimeout(300);
    await expect(fader).toHaveClass(/grabbed/);
    for (let k = 1; k <= 6; k++) await touch('touchMove', b.x + b.width / 2, b.y + 12 + k * 12);
    await touch('touchEnd', 0, 0);
    expect(await value()).toBeLessThan(before);
    await expect(fader).not.toHaveClass(/grabbed/);
  });
});

test.describe('a laptop (1366 x 768)', () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test('the top bar stays one row with a machine to arm and a box connected, and doesn\'t jump on save; a big rig\'s universes fold into one line', async ({ page }) => {
    await openConnected(page);
    // (on stage now: the "you are blind" note from connecting is gone)
    await expect(page.getByText('Connected. You are blind')).toHaveCount(0);
    await patch(page, 'gen-flame', 1, 0, 'Flame');
    for (const u of [1, 2, 3, 4, 5]) await patch(page, 'gen-dimmer', 2, u, `Dim U${u}`);
    const bar = page.locator('header.top');
    await expect(page.locator('.top .arm')).toBeVisible();
    const box = await bar.boundingBox();
    expect(box!.height).toBeLessThan(56);                                       // one row
    expect(await bar.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    for (const sel of ['.top .out', '.top .arm', '[role=tab][aria-label=Timeline]']) await expect(page.locator(sel)).toBeInViewport();
    // "saved" and "…" take the same room
    const w = await page.evaluate(async () => {
      const s = document.querySelector('.top .saved')!, b = document.querySelector('.top .show')!;
      const a = b.getBoundingClientRect().width, t = s.textContent;
      s.textContent = t === 'saved' ? '…' : 'saved';
      await new Promise((r) => requestAnimationFrame(r));
      const z = b.getBoundingClientRect().width; s.textContent = t; return Math.abs(a - z);
    });
    expect(w).toBeLessThan(1);
    // six universes: one line, the lights stay in view
    const fl = page.locator('.fl');
    await expect(fl.locator('.usage summary')).toHaveText(/^6 universes · \d+ channels/);
    await expect(fl.locator('.usage .unis')).toBeHidden();
    expect((await fl.locator('ul').first().boundingBox())!.height).toBeGreaterThan(120);   // (rows of lights, not a stub)
    await fl.locator('.usage summary').click();
    await expect(fl.locator('.usage .unis .chip')).toHaveCount(6);
  });
});

for (const width of [768, 834]) {
  test.describe(`a tablet held upright (${width} px)`, () => {
    test.use({ viewport: { width, height: 1024 }, hasTouch: true });
    test('every top bar control is on the screen with a machine to arm and a box connected; undo is in the ⋯ menu', async ({ page }) => {
      await openConnected(page);
      await patch(page, 'gen-flame', 1, 0, 'Flame');
      const bar = page.locator('header.top');
      await expect(page.locator('.top .arm')).toBeVisible();
      expect(await bar.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
      const off = await bar.evaluate((t) => [...t.querySelectorAll('button, input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5); }).map((e) => e.getAttribute('aria-label') ?? e.textContent));
      expect(off).toEqual([]);
      const bpm = page.getByLabel('BPM', { exact: true });
      expect(await bpm.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);        // (120 whole)
      await page.locator('.top').getByRole('button', { name: 'More' }).click();
      await expect(page.getByRole('menuitem', { name: 'Undo' })).toBeVisible();
    });
  });
}

test.describe('the 2D plan on a tablet held upright', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true });
  test('the Band stage\'s four pixel bars stay apart, from each other and from the machines beside them', async ({ page }) => {
    await openConnected(page);
    await page.locator('.top .show').click();
    await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Band' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.fixtures.length)).toBeGreaterThan(30);
    const stage = page.locator('.stage-wrap');
    const two = stage.getByRole('button', { name: '2D', exact: true });
    if (await two.isVisible()) await two.click();
    await expect(stage.locator('.fx[data-name="Bar 1"]')).toBeVisible();
    await page.waitForTimeout(500);
    const touching = await page.evaluate(() => {
      const bodies = [...document.querySelectorAll<SVGGElement>('.stage-wrap .fx')].flatMap((g) => { const b = g.querySelector('[stroke-width]'); return b ? [{ n: g.dataset.name ?? '', r: b.getBoundingClientRect() }] : []; });
      const out: string[] = [];
      for (const a of bodies.filter((x) => /^Bar /.test(x.n))) for (const b of bodies) {
        if (a === b) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 1 && h > 1) out.push(`${a.n}/${b.n}`);
      }
      return out;
    });
    expect(touching).toEqual([]);
  });
});
