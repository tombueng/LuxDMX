// Layout guarantees measured in the browser (no screenshots): nothing runs off the screen, and on
// touch screens everything is big enough for a finger.
import { readFile } from 'node:fs/promises';
import { openConnected, test, expect, patch } from './helpers';

test.describe('phone', () => {
  test.use({ viewport: { width: 360, height: 760 }, hasTouch: true, isMobile: true });     // a small Android

  test('the top bar fits, and the box status folds into one button', async ({ page }) => {
    await openConnected(page);
    const top = page.locator('.top');
    const over = await top.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    const boxes = top.getByRole('button', { name: /LuxDMX boxes/ });
    await expect(boxes).toBeVisible();
    await boxes.tap();
    await expect(page.locator('.pop.list .dev')).toHaveCount(1);              // the box's pill, with its state
    await expect(page.getByLabel('LuxDMX address')).toBeVisible();
    // the list is on screen, not clipped by the bar
    const r = await page.locator('.pop.list').boundingBox();
    expect(r!.x).toBeGreaterThanOrEqual(0);
    expect(r!.x + r!.width).toBeLessThanOrEqual(360);
    expect(await page.locator('.pop.list').evaluate((el) => { const b = el.getBoundingClientRect(); return document.elementFromPoint(b.left + b.width / 2, b.bottom - 8)?.closest('.pop.list') === el; })).toBe(true);
  });
});

test.describe('tablet with touch', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  test('buttons and fields are at least finger sized', async ({ page }) => {
    await openConnected(page);
    await page.locator('.top .show').click();
    await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
    const measure = () => page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('button, select, input:not([type=checkbox]):not([type=radio]), [role=tab]')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;    // not on screen
        if (el.closest('[aria-hidden="true"], .stage-wrap svg')) continue;
        if (Math.min(r.height, el.matches('input[type=range]') ? 99 : r.width) < 32) out.push(`${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    expect(await measure()).toEqual([]);
    const topH = await page.locator('.top').evaluate((el) => el.getBoundingClientRect().height);
    console.log('top bar height at 1024 touch', topH);
    expect(topH).toBeLessThan(60);                                        // one row
    await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
    await expect(page.locator('.live')).toBeVisible();
    expect(await measure()).toEqual([]);
  });
});

test.describe('the timeline on a tablet', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  // a show with every lane in use and a song's parts: the stage picture and the lanes keep to their
  // own room, Play and the volume are what a finger finds (the picture used to spill over them)
  test('Play and the volume are never covered, with every lane full', async ({ page }) => {
    await openConnected(page);
    // a band's show from a test at the gig (data/gig-song.luxdmx.json): a trimmed rig, a demo song
    // that isn't in this browser, cues on the parts (the stage picture spilled over the transport)
    const text = await readFile(new URL('./data/gig-song.luxdmx.json', import.meta.url), 'utf8');
    await page.evaluate(async (t) => { await (window as any).__luxdmx.importShow(new File([t], 'gig-song.luxdmx.json')); }, text);
    await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
    for (const view of ['2D', '3D']) {
      if (view === '3D') { await page.locator('.tlv .preview').getByRole('button', { name: '3D' }).click(); await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45_000 }); }
      for (const name of [/^(Play|Pause)$/, /Volume/]) {
        const el = page.locator('.transport').getByRole(name.source.includes('Volume') ? 'slider' : 'button', { name }).first();
        await expect(el).toBeVisible();
        const ok = await el.evaluate((e) => { const b = e.getBoundingClientRect(), top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!top && (top === e || e.contains(top)); });
        expect(ok, `${view} ${name}`).toBe(true);
      }
    }
  });
});

test.describe('the stage', () => {
  test('names never run into each other, in any template', async ({ page }) => {
    await openConnected(page);
    for (const t of ['Band', 'DJ / Party', 'Theatre', 'Church', 'Cinema', 'Bar']) {
      await page.locator('.top .show').click();
      await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: new RegExp(`^${t.replace('/', '\\/')}$`) }) }).click();
      await expect(page.getByRole('dialog', { name: 'Shows' })).toBeHidden();
      await expect(page.locator('.stage-wrap .fx').first()).toBeVisible();
      const clash = await page.evaluate(() => {
        // (the names, and the word "audience" at the front edge)
        const boxes = [...document.querySelectorAll('.stage-wrap text.lbl, .stage-wrap text.edge')].map((el) => ({ n: el.textContent, r: el.getBoundingClientRect() }));
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].r, b = boxes[j].r;
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) return `${boxes[i].n} / ${boxes[j].n}`;
        }
        return '';
      });
      expect(clash, t).toBe('');
      // most names are shown (a crowded stage may leave a few out)
      const shown = await page.locator('.stage-wrap text.lbl').count(), all = await page.locator('.stage-wrap .fx').count();
      expect(shown, t).toBeGreaterThanOrEqual(Math.ceil(all * 0.75));
    }
  });

  test('new lights land in free space, not on the ones already there', async ({ page }) => {
    await openConnected(page);
    await page.locator('.top .show').click();
    await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
    await patch(page, 'gen-mover16', 2, 0, 'Spot');
    const near = await page.evaluate(() => {
      const fx = [...document.querySelectorAll<SVGGElement>('.stage-wrap .fx')].map((g) => { const r = g.querySelector('circle, rect')!.getBoundingClientRect(); return { n: g.dataset.name, x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      let worst = 1e9;
      for (const a of fx.filter((f) => f.n?.startsWith('Spot'))) for (const b of fx) if (a !== b) worst = Math.min(worst, Math.hypot(a.x - b.x, a.y - b.y));
      return worst;
    });
    expect(near).toBeGreaterThan(40);
  });
});

test.describe('live edit', () => {
  test('the buttons stay where they are, and the editor never covers the one being changed', async ({ page }) => {
    await openConnected(page);
    await page.locator('.top .show').click();
    await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
    await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
    // where each button sits in the grid (scrolling the grid to reach one isn't moving it)
    const spots = () => page.locator('.live .grid .cell').evaluateAll((els) => els.slice(0, 12).map((e) => { const r = e.getBoundingClientRect(); const st = e.parentElement!.scrollTop; return `${Math.round(r.x)},${Math.round(r.y + st)},${Math.round(r.width)}`; }));
    const before = await spots();
    await page.locator('.live .bar').getByRole('button', { name: 'Edit' }).click();
    expect(await spots()).toEqual(before);
    const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (const which of ['first', 'last'] as const) {
      const tile = page.locator('.live .grid .tile')[which]();
      await tile.click();
      const ed = page.locator('.live .float');
      await expect(ed.getByLabel('Colour')).toBeVisible();
      expect(overlap((await tile.boundingBox())!, (await ed.boundingBox())!), which).toBe(false);
      // every field fits inside the editor
      const e = (await ed.boundingBox())!;
      for (const box of await ed.locator('input, select, button').evaluateAll((els) => els.map((x) => { const r = x.getBoundingClientRect(); return { l: r.left, r: r.right }; })))
        expect(box.r).toBeLessThanOrEqual(e.x + e.width + 1);
    }
    expect(await spots()).toEqual(before);
  });
});

test.describe('a small laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test('clicking an effect shows its editor without scrolling', async ({ page }) => {
    await openConnected(page);
    await page.locator('.top .show').click();
    await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
    await page.locator('.side .tabs').getByRole('tab', { name: 'Effects' }).click();
    await page.locator('.ep li.oitem').last().click();
    // the editor's top (its name and what it runs on) is right there under the list, not below the fold
    const head = page.locator('.ep .editor input').first();
    await expect(head).toBeVisible();
    expect(await head.evaluate((el) => { const b = el.getBoundingClientRect(); const top = document.elementFromPoint(b.left + 6, b.top + b.height / 2); return !!top && (el === top || el.contains(top)); })).toBe(true);
  });
});

test.describe('a desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('the panels can be resized by their gaps, and stay that way', async ({ page }) => {
    await openConnected(page);
    const side = page.locator('.prog .side');
    const w0 = (await side.boundingBox())!.width;
    const g = (await page.locator('.split.sl').boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + 100);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 + 80, g.y + 100, { steps: 5 });
    await page.mouse.up();
    expect((await side.boundingBox())!.width).toBeGreaterThan(w0 + 60);
    const foot = page.locator('.prog .foot');
    const h0 = (await foot.boundingBox())!.height;
    const s = (await page.locator('.split.h').boundingBox())!;
    await page.mouse.move(s.x + 300, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(s.x + 300, s.y + s.height / 2 - 90, { steps: 5 });
    await page.mouse.up();
    expect((await foot.boundingBox())!.height).toBeGreaterThan(h0 + 70);
    await page.reload();
    expect((await side.boundingBox())!.width).toBeGreaterThan(w0 + 60);
    await page.locator('.split.sl').dblclick();
    expect(Math.abs((await side.boundingBox())!.width - w0)).toBeLessThan(2);
  });
  test('the gaps stop where the stage and the cues still work; the programmer\'s chips jump and say where you are', async ({ page }) => {
    await openConnected(page);
    await page.locator('.top .show').click();
    await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
    const s = (await page.locator('.split.h').boundingBox())!;
    await page.mouse.move(s.x + 300, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(s.x + 300, 20, { steps: 8 });                 // all the way up
    await page.mouse.up();
    expect((await page.locator('.prog .center').boundingBox())!.height).toBeGreaterThan(310);
    const s2 = (await page.locator('.split.h').boundingBox())!;
    await page.mouse.move(s2.x + 300, s2.y + s2.height / 2);
    await page.mouse.down();
    await page.mouse.move(s2.x + 300, 895, { steps: 8 });               // all the way down
    await page.mouse.up();
    expect((await page.locator('.prog .foot').boundingBox())!.height).toBeGreaterThan(200);
    await page.locator('.split.h').dblclick();
    // a moving head selected: Channels opens the channel list and lights up
    await page.locator('.stage-wrap .fx[data-name="Head 1"], .stage-wrap .fx[data-name^="Mover"]').first().click();
    const chips = page.getByRole('navigation', { name: 'Programmer parts' });
    await chips.getByRole('button', { name: 'Channels' }).click();
    await expect(page.locator('#pg-all-ch')).toHaveAttribute('open', '');
    await expect(chips.getByRole('button', { name: 'Channels' })).toHaveAttribute('aria-current', 'true');
  });
});
