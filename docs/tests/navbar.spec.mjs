// The shared navbar (src/pages/_nav.html): no stat may run into its neighbour, and the
// per-output chips (DMX FPS, In FPS, Style) list the outputs that are enabled.
//
// The bar used to give every stat a fixed width, sized when a box had one or two outputs. With
// the third output every frame carried three rates ("40.0 · 40.0 · 40.0") and the value ran
// 14 px into the next stat at every screen width. Now a stat has a minimum width and grows.
//
// Read-only. The live tests need no input (the /ws frame is pushed every 100 ms whether or not
// anything arrives); the worst-case tests replace the page's /ws with a mocked socket and feed
// it hand-built frames, so they run on the real page served by the device.
import { test, expect } from '@playwright/test';
import { info } from './lib/device.mjs';

const WIDTHS = [1920, 1280, 768, 390];
const PAGES = ['/', '/rdm', '/config'];

// Every visible stat, the brand and the tab buttons, as drawn: a stat's right edge is its value's
// if that is wider. Returns the pairs that overlap and the values that run out of their stat.
async function navCollisions(page) {
  return page.evaluate(() => {
    const box = (e) => e.getBoundingClientRect();
    const stats = [...document.querySelectorAll('.site-nav .nav-stat')].filter((e) => e.offsetParent);
    const parts = stats.map((s) => {
      const a = box(s), v = box(s.querySelector('.ns-val'));
      return { n: s.querySelector('.ns-label').textContent, l: a.left, r: Math.max(a.right, v.right), t: a.top, b: a.bottom };
    });
    for (const q of ['.brand', '.nav-links']) {
      const b = box(document.querySelector('.site-nav ' + q));
      parts.push({ n: q, l: b.left, r: b.right, t: b.top, b: b.bottom });
    }
    const overlaps = [];
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j];
      const x = Math.min(a.r, b.r) - Math.max(a.l, b.l), y = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (x > 0.5 && y > 0.5) overlaps.push(`${a.n} / ${b.n} by ${x.toFixed(1)} px`);
    }
    const spills = stats.filter((s) => box(s.querySelector('.ns-val')).right > box(s).right + 0.5)
      .map((s) => `${s.querySelector('.ns-label').textContent} "${s.querySelector('.ns-val').textContent}"`);
    return { overlaps, spills, sideways: document.documentElement.scrollWidth > innerWidth };
  });
}

// A /ws status frame as the firmware builds it (wsPush in main.cpp): 528 bytes of header + DMX,
// then per output fps(2) in-fps(2) style(1), then fixtures(2) RDM tx(4) RDM rx(4).
// Style bits: 1 delta, 2 set over Art-Net, 4 beat risk, 8 enabled, 16 = "bit 8 is there".
const MARK = 16, ON = 8 | 16;
function statusFrame({ out = [], inp = [], sty = [ON, ON, ON], rssi = -55, heapKB = 180, up = 3725,
                       jit = 0.4, fix = 12, tx = 123456, rx = 98765 } = {}) {
  const n = sty.length, b = Buffer.alloc(528 + 5 * n + 10);
  b.writeUInt16BE(400, 0); b.writeInt16BE(rssi, 2); b.writeUInt32BE(heapKB * 1024, 4);
  b.writeUInt32BE(up, 8); b.writeUInt16BE(Math.round(jit * 10), 14);
  for (let i = 0; i < n; i++) {
    b.writeUInt16BE(Math.round((out[i] ?? 40) * 10), 528 + 2 * i);
    b.writeUInt16BE(Math.round((inp[i] ?? 40) * 10), 528 + 2 * n + 2 * i);
    b.writeUInt8(sty[i], 528 + 4 * n + i);
  }
  const t = 528 + 5 * n;
  b.writeUInt16BE(fix, t); b.writeUInt32BE(tx, t + 2); b.writeUInt32BE(rx, t + 6);
  return b;
}

// Open `path` with the page's /ws mocked; every frame in `frames` is sent once it connects.
async function openMocked(page, path, frames) {
  await page.routeWebSocket(/\/ws$/, (ws) => { for (const f of frames) ws.send(f); });
  await page.goto(path);
}

test.describe('navbar', () => {
  for (const w of WIDTHS) {
    test(`live values: nothing overlaps at ${w} px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto('/');
      await expect(page.locator('#heap')).toHaveText(/KB/, { timeout: 10_000 });   // a real frame landed
      const r = await navCollisions(page);
      expect(r.overlaps, 'stats running into each other').toEqual([]);
      expect(r.spills, 'values wider than their stat').toEqual([]);
      expect(r.sideways, 'the page scrolls sideways').toBe(false);
    });
  }

  for (const path of PAGES) {
    test(`live values: nothing overlaps on ${path}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(path);
      await expect(page.locator('#heap')).toHaveText(/KB/, { timeout: 10_000 });
      const r = await navCollisions(page);
      expect(r.overlaps).toEqual([]);
      expect(r.spills).toEqual([]);
    });
  }

  test('the per-output chips list the enabled outputs', async ({ page, request }) => {
    const en = (await info(request)).outputs.map((o) => o.en);
    const k = en.lastIndexOf(true) + 1;
    await page.goto('/');
    await expect(page.locator('#heap')).toHaveText(/KB/, { timeout: 10_000 });
    if (!k) {
      for (const id of ['#ns-fps', '#ns-infps', '#ns-style']) {
        await expect(page.locator(id)).toHaveCount(1);
        await expect(page.locator(id)).toBeHidden();
      }
      return;
    }
    for (const id of ['#fps', '#infps']) {
      const parts = (await page.locator(id).textContent()).split(' · ');
      expect(parts.length, `${id}: one entry per output up to the last enabled one`).toBe(k);
      parts.forEach((p, i) => expect(p, `${id} output ${'ABC'[i]}`).toMatch(en[i] ? /^\d+\.\d$/ : /^–$/));
      expect(await page.locator(id).getAttribute('title')).toContain('Output A: ');
    }
    expect((await page.locator('#txstyle').textContent()).trim().split(/\s+/).length).toBe(k);
  });

  // Worst case on purpose: three outputs at triple-digit input rates, every style flag, and the
  // longest WiFi / heap / uptime / jitter / counter values the bar can be asked to show.
  const WORST = statusFrame({ inp: [100, 100, 100], sty: [ON | 7, ON | 7, ON | 7], rssi: -100,
                              heapKB: 8000, up: 99 * 3600 + 59 * 60 + 59, jit: 12.3, fix: 512, tx: 9.9e6, rx: 9.9e6 });
  for (const w of WIDTHS) {
    test(`worst-case values: nothing overlaps at ${w} px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await openMocked(page, '/', [WORST]);
      await expect(page.locator('#uptime')).toHaveText('99h 59m 59s');
      await expect(page.locator('#infps')).toHaveText('100.0 · 100.0 · 100.0');
      const r = await navCollisions(page);
      expect(r.overlaps).toEqual([]);
      expect(r.spills).toEqual([]);
      expect(r.sideways).toBe(false);
    });
  }

  test('a disabled output between two enabled ones shows as a dash', async ({ page }) => {
    await openMocked(page, '/', [statusFrame({ out: [40, 0, 33.3], sty: [ON, MARK, ON | 1] })]);
    await expect(page.locator('#fps')).toHaveText('40.0 · – · 33.3');
    await expect(page.locator('#txstyle')).toHaveText('C – D');
    expect(await page.locator('#fps').getAttribute('title')).toContain('Output B: off');
  });

  test('outputs after the last enabled one are left out', async ({ page }) => {
    await openMocked(page, '/', [statusFrame({ sty: [ON, MARK, MARK] })]);
    await expect(page.locator('#fps')).toHaveText('40.0');
    await expect(page.locator('#txstyle')).toHaveText('C');
  });

  test('no DMX output enabled: the three DMX chips hide', async ({ page }) => {
    await openMocked(page, '/', [statusFrame({ sty: [MARK, MARK, MARK] })]);
    await expect(page.locator('#heap')).toHaveText('180 KB');
    for (const id of ['#ns-fps', '#ns-infps', '#ns-style']) {
      await expect(page.locator(id)).toHaveCount(1);   // there, and hidden (not just missing)
      await expect(page.locator(id)).toBeHidden();
    }
  });

  test('a frame without the enable marks lists every output', async ({ page }) => {
    await openMocked(page, '/', [statusFrame({ sty: [0, 0, 1] })]);
    await expect(page.locator('#fps')).toHaveText('40.0 · 40.0 · 40.0');
    await expect(page.locator('#txstyle')).toHaveText('C C D');
  });
});
