// The welcome: a dialog over everything (the 3D stage too) when the app opens on an empty show,
// once per show, back with "Get started"; the big demo from it on a real song (it comes down first,
// the lights follow its parts, its credit shows) or on the demo beat when the song can't come down.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Locator, Page } from '@playwright/test';
import { openConnected, resetFake, channels, fresh, welcome, welcomeDialog, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

// a song for the demo: 24 s of a click track at 120 BPM as a WAV, sent slowly (the progress shows)
function clickTrack(seconds = 24, rate = 8000) {
  const n = seconds * rate, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const t = i / rate - 0.5, beat = t >= 0 ? t % 0.5 : 1;
    b.writeInt16LE(Math.round(beat < 0.05 ? Math.sin(2 * Math.PI * 880 * beat) * (1 - beat / 0.05) * 20000 : 0), 44 + i * 2); }
  return b;
}
let songs: http.Server, base = '';
test.beforeAll(async () => {
  const wav = clickTrack();
  songs = http.createServer((req, res) => {
    if (!req.url?.startsWith('/song.wav')) { res.writeHead(404, { 'access-control-allow-origin': '*' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length, 'access-control-allow-origin': '*' });
    let i = 0;
    const part = Math.ceil(wav.length / 16), next = () => { if (res.destroyed) return; res.write(wav.subarray(i * part, (i + 1) * part)); if (++i < 16) setTimeout(next, 100); else res.end(); };
    next();
  });
  await new Promise<void>((r) => songs.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(songs.address() as AddressInfo).port}`;
});
test.afterAll(() => { songs?.close(); });
// the catalog the app sees: one metal song (the artist's file gone, our copy there), or one that
// can't come down at all
async function catalog(page: Page, works = true) {
  const entry = { id: 'e2e-metal', title: 'Test Riff', artist: 'The Testers', genre: 'metal', vocals: true, license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    page: 'https://example.org/test-riff', url: `${base}/gone.wav`, mirror: `${base}/${works ? 'song.wav' : 'gone-too.wav'}`, bpm: 120, offset: 0.5, duration: 24,
    sections: [{ name: 'Intro', at: 0.5, energy: 0.3 }, { name: 'Verse', at: 4.5, energy: 0.5 }, { name: 'Chorus', at: 12.5, energy: 1 }, { name: 'Outro', at: 20.5, energy: 0.4 }] };
  await page.route('**/src/timeline/catalog.ts*', (r) => r.fulfill({ contentType: 'text/javascript',
    body: `export const GENRES = { metal: 'Metal' };\nexport const CATALOG = ${JSON.stringify([entry])};\n` }));
}
// what's on top at a point of a thing: that thing, not something drawn over it
const onTop = async (page: Page, l: Locator, sel: string) => {
  const b = (await l.boundingBox())!;
  return page.evaluate(([x, y, s]) => !!document.elementFromPoint(x as number, y as number)?.closest(s as string), [b.x + b.width / 2, b.y + Math.min(20, b.height / 2), sel]);
};
const cueOn = (page: Page) => page.evaluate(() => { const a = (window as any).__luxdmx; const l = a.show.cueLists[0]; const st = a.engine.status(l.id); return st.running ? l.cues[st.index].name : ''; });

test('the welcome comes up over everything, the 3D stage too; closed, "Get started" brings it back; a reload doesn\'t', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((r) => { const q = indexedDB.deleteDatabase('luxdmx-sequencer'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
    localStorage.setItem('luxdmx.seq.stage3d', '1');
  });
  await page.reload();
  const w = welcomeDialog(page);
  await expect(w).toBeVisible();
  await expect(page.locator('.three')).toHaveCount(1);
  expect(await onTop(page, w, '[role="dialog"]')).toBe(true);
  await w.getByRole('button', { name: 'Start with an empty stage' }).click();
  await expect(w).toBeHidden();
  // on the empty 3D stage, the way back: above the stage, not under it
  const go = page.getByRole('button', { name: 'Get started' });
  await expect(go).toBeVisible();
  expect(await onTop(page, go, '.empty')).toBe(true);
  await go.click();
  await expect(w).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(w).toBeHidden();
  // once per show: a reload doesn't bring it back
  await page.reload();
  await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(w).toBeHidden();
});

test('the demo on a real song: it comes down first, then the show plays to it, the lights cued to its parts', async ({ page }) => {
  test.setTimeout(120_000);
  await catalog(page);
  await openConnected(page);
  const w = await welcome(page);
  await w.getByLabel("The demo's music").selectOption('e2e-metal');
  await expect(w).toContainText('Test Riff by The Testers: Metal, 120 BPM, 0:24, CC BY');
  await w.getByRole('button', { name: 'Show me a demo' }).click();
  await expect(w.getByRole('button', { name: /Getting the song… \d+ %/ })).toBeVisible();
  await expect(w).toBeHidden({ timeout: 15000 });
  // (said as it starts playing, for six seconds: looked at first)
  await expect(page.locator('.toast').filter({ hasText: 'cued to its parts' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.top .show .name')).toHaveText('We Are Not The Band: live');
  // (the song goes onto the show as it opens)
  await expect.poll(() => page.evaluate(() => { const t = (window as any).__luxdmx.show.timeline; return { demo: t.demo ?? null, bpm: t.bpm, sections: t.sections.map((s: any) => s.name), catalog: t.audio?.catalog, credit: t.audio?.credit }; }), { timeout: 15000 })
    .toEqual({ demo: null, bpm: 120, sections: ['Intro', 'Verse', 'Chorus', 'Outro'], catalog: 'e2e-metal', credit: '"Test Riff" by The Testers, CC BY' });
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.playing), { timeout: 30000 }).toBe(true);
  await expect(page.locator('.tlv .credit')).toContainText('"Test Riff" by The Testers, CC BY');
  // the parts: the intro's look, then the chorus's (with its CO2 and flames on the timeline)
  await page.evaluate(() => { const t = (window as any).__luxdmx.timeline; t.pause(); t.seek(2); });
  await expect.poll(() => cueOn(page), { timeout: 15000 }).toBe('Intro: blue haze');
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(13));
  await expect.poll(() => cueOn(page), { timeout: 15000 }).toBe('Drop: full colour');
  const moments = await page.evaluate(() => (window as any).__luxdmx.show.timeline.items.filter((i: any) => i.do.do === 'burst' && i.at === 12.5).map((i: any) => i.do.attr).sort());
  expect(moments).toEqual(expect.arrayContaining(['co2', 'confetti', 'flame']));
  await expect.poll(async () => (await channels(0, 304)).some((v) => v > 0), { timeout: 8000 }).toBe(true);
});

test("a song that can't come down: the demo plays on the demo beat and says so; Cancel stops it", async ({ page }) => {
  test.setTimeout(120_000);
  await catalog(page, false);
  await fresh(page, true);
  const w = welcomeDialog(page);
  await w.getByLabel("The demo's music").selectOption('e2e-metal');
  await w.getByRole('button', { name: 'Show me a demo' }).click();
  await expect(w).toBeHidden({ timeout: 15000 });
  await expect(page.locator('.toast')).toContainText('The demo plays on the demo beat instead');
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.timeline.demo)).toBe(true);
});

test('the demo from the command palette opens the welcome (the music is picked there)', async ({ page }) => {
  await fresh(page);
  await page.locator('body').press('Control+k');
  await page.getByRole('combobox', { name: 'Find anything' }).fill('big demo');
  await page.keyboard.press('Enter');
  await expect(welcomeDialog(page)).toBeVisible();
  await expect(welcomeDialog(page).getByLabel("The demo's music")).toBeVisible();
});

test('the welcome offers four demo stages: each opens in its own room, the test truss without music to pick', async ({ page }) => {
  test.setTimeout(240_000);
  for (const [name, room, music] of [['Test truss', 'truss', false], ['DJ in a club', 'club', true], ['House party', 'party', true]] as const) {
    await fresh(page, true);
    const w = welcomeDialog(page);
    await w.getByRole('radio', { name }).click();
    await expect(w.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true');
    await expect(w.getByLabel("The demo's music")).toHaveCount(music ? 1 : 0);
    if (music) await w.getByLabel("The demo's music").selectOption('beat');      // (no download in the test)
    await w.getByRole('button', { name: 'Show me a demo' }).click();
    await expect(w).toBeHidden({ timeout: 30000 });
    await expect(page.locator('.toast').filter({ hasText: `${name}:` })).toBeVisible({ timeout: 30000 });
    await expect.poll(() => page.evaluate(() => (window as any).__stage3d?.venue().room), { timeout: 60000 }).toBe(room);
  }
});

test('on a phone the welcome fits the screen: every button and the music menu inside it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fresh(page, true);
  const w = welcomeDialog(page);
  await expect(w).toBeVisible();
  const r = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')!, vw = innerWidth;
    return { width: d.getBoundingClientRect().width, vw, outside: [...d.querySelectorAll('button, select')].filter((e) => (e as HTMLElement).offsetParent && (e.getBoundingClientRect().right > vw + 1 || e.getBoundingClientRect().left < -1)).length };
  });
  expect(r.width).toBeLessThanOrEqual(r.vw);
  expect(r.outside).toBe(0);
});

test('the demo stages are one radio group for the keyboard: arrow keys go round, one tab stop', async ({ page }) => {
  await fresh(page, true);
  const w = welcomeDialog(page), radios = w.getByRole('radio');
  await expect(radios).toHaveCount(4);
  await radios.first().click();
  await expect(radios.first()).toHaveAttribute('aria-checked', 'true');
  expect(await radios.evaluateAll((r) => r.map((x) => (x as HTMLElement).tabIndex))).toEqual([0, -1, -1, -1]);
  await page.keyboard.press('ArrowRight');
  await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(radios.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  await expect(radios.nth(3)).toHaveAttribute('aria-checked', 'true');      // (round from the first to the last)
  await expect(w.getByLabel("The demo's music")).toHaveCount(0);           // the test truss: no music
});
