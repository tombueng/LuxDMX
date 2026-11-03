// The timeline: cues and moments placed on a song play on its clock (measured on the engine and the
// wire), a jump puts the stage where it would be, effects run as bars, the demo beat is ten minutes
// with its sections, a demo song downloads (with progress) and brings its parts, cues snap to them,
// and what's placed moves, goes with Del and comes back with Undo.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { openConnected, resetFake, channels, history, patch, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

// A demo song for the tests: 24 s of a click track at 120 BPM (the first downbeat at 0.5 s), as a
// WAV, from a server of our own that sends it slowly (so the progress shows) and allows any page
// to read it, like the songs' real hosts. /gone.wav isn't there (the artist's file, say, moved).
function clickTrack(seconds = 24, rate = 8000) {
  const n = seconds * rate, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const t = i / rate - 0.5, beat = t >= 0 ? t % 0.5 : 1, f = Math.floor(t / 0.5) % 4 === 0 ? 1760 : 880;
    b.writeInt16LE(Math.round(beat < 0.05 ? Math.sin(2 * Math.PI * f * beat) * (1 - beat / 0.05) * 20000 : 0), 44 + i * 2); }
  return b;
}
let songs: http.Server, base = '';
test.beforeAll(async () => {
  const wav = clickTrack();
  songs = http.createServer((req, res) => {
    if (!req.url?.startsWith('/song.wav')) { res.writeHead(404, { 'access-control-allow-origin': '*' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length, 'access-control-allow-origin': '*' });
    let i = 0;
    const part = Math.ceil(wav.length / 16), next = () => { if (res.destroyed) return; res.write(wav.subarray(i * part, (i + 1) * part)); if (++i < 16) setTimeout(next, 120); else res.end(); };
    next();
  });
  await new Promise<void>((r) => songs.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(songs.address() as AddressInfo).port}`;
});
test.afterAll(() => { songs?.close(); });
// the catalog the app sees: this one song (the artist's file gone, our copy there), or none that works
async function catalog(page: Page, works = true) {
  const entry = { id: 'e2e-song', title: 'Test Song', artist: 'The Testers', genre: 'rock', vocals: true, license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    page: 'https://example.org/test-song', url: `${base}/gone.wav`, mirror: `${base}/${works ? 'song.wav' : 'gone-too.wav'}`, bpm: 120, offset: 0.5, duration: 24,
    sections: [{ name: 'Intro', at: 0.5, energy: 0.3 }, { name: 'Verse', at: 4.5, energy: 0.5 }, { name: 'Chorus', at: 12.5, energy: 1 }, { name: 'Outro', at: 20.75, energy: 0.4 }] };
  await page.route('**/src/timeline/catalog.ts*', (r) => r.fulfill({ contentType: 'text/javascript',
    body: `export const GENRES = { rock: 'Rock / punk' };\nexport const CATALOG = ${JSON.stringify([entry])};\n` }));
}

const cueOn = (page: Page) => page.evaluate(() => { const a = (window as any).__luxdmx; const l = a.show.cueLists[0]; const st = a.engine.status(l.id); return st.running ? l.cues[st.index].name : ''; });
async function bar(page: Page) {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.locator('.tlv')).toBeVisible();
}

test('cues tapped onto the timeline play on its clock; a jump puts the stage where it would be', async ({ page }) => {
  await bar(page);
  const names = await page.evaluate(() => (window as any).__luxdmx.show.cueLists[0].cues.slice(0, 2).map((c: any) => c.name));
  const chips = page.locator('.tlv .pal .chip');
  await chips.first().click();                                              // at the playhead: 0:00
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(2));
  await chips.nth(1).click();                                               // at 0:02 (snapped to the beat)
  const at = await page.evaluate(() => (window as any).__luxdmx.show.timeline.items.map((i: any) => i.at));
  expect(at[0]).toBe(0);
  expect(at[1]).toBeGreaterThan(1.5); expect(at[1]).toBeLessThan(2.5);
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(0));
  await expect.poll(() => cueOn(page)).toBe(names[0]);
  await page.locator('.transport').getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => cueOn(page), { timeout: 8000 }).toBe(names[1]);  // the song's clock got there
  await expect.poll(async () => (await channels(0, 16)).some((v) => v > 0)).toBe(true);
  await page.locator('.transport').getByRole('button', { name: 'Pause' }).click();
  // a jump back to the start: the first look again, at once
  await page.locator('.transport').getByRole('button', { name: 'Back to the start' }).click();
  await expect.poll(() => cueOn(page)).toBe(names[0]);
});

test('an effect dragged on runs as a bar; Del removes what is selected and Undo brings it back', async ({ page }) => {
  await bar(page);
  const fx = page.locator('.tlv .pal .chip.fx').first();
  await fx.dragTo(page.locator('.tlv .tracks .lane').first(), { targetPosition: { x: 60, y: 15 } });
  const it = await page.evaluate(() => (window as any).__luxdmx.show.timeline.items[0]);
  expect(it.lane).toBe('fx');
  expect(it.len).toBeGreaterThan(5);
  const id = it.do.effect;
  // inside the bar it runs, after it it doesn't
  await page.evaluate((t) => (window as any).__luxdmx.timeline.seek(t), it.at + 1);
  await expect.poll(() => page.evaluate((e) => (window as any).__luxdmx.liveFx.includes(e), id)).toBe(true);
  await page.evaluate((t) => (window as any).__luxdmx.timeline.seek(t), it.at + it.len + 1);
  await expect.poll(() => page.evaluate((e) => (window as any).__luxdmx.liveFx.includes(e), id)).toBe(false);
  await page.locator('.tlv .it').first().click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.tlv .it')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.tlv .it')).toHaveCount(1);
});

test('the demo beat: ten minutes with its sections on the ruler; a moment fires the machines', async ({ page }) => {
  await bar(page);
  await page.locator('.tlv').getByRole('button', { name: 'Demo songs…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Demo songs' });
  // a short listen first, and stopped again
  await dlg.getByRole('button', { name: 'Listen to Demo beat' }).click();
  await expect(dlg.getByRole('button', { name: 'Stop Demo beat' })).toHaveAttribute('aria-pressed', 'true');
  await dlg.getByRole('button', { name: 'Stop Demo beat' }).click();
  await dlg.getByRole('button', { name: 'Use Demo beat' }).click();
  await expect(dlg).toHaveCount(0);
  const d = await page.evaluate(() => (window as any).__luxdmx.show.timeline.duration);
  expect(d).toBeGreaterThan(560); expect(d).toBeLessThan(620);
  await expect(page.locator('.tlv .sec').first()).toHaveText('Intro');
  await expect(page.locator('.tlv .sec', { hasText: 'Drop' }).first()).toBeVisible();
  // a blinder hit placed and played: every light full white for a moment
  await page.locator('.tlv .pal .chip.mo', { hasText: 'Blinder hit' }).click();
  await page.evaluate(() => (window as any).__luxdmx.doTimeline({ do: 'burst', attr: 'blinder', seconds: 1 }, false));
  await expect.poll(() => page.evaluate(() => { const a = (window as any).__luxdmx, s = a.stage[a.show.fixtures[0].id]; return [s.intensity, s.color.r, s.color.g, s.color.b]; })).toEqual([1, 1, 1, 1]);
  await expect.poll(async () => (await channels(0, 16)).filter((v) => v === 255).length).toBeGreaterThan(0);
});

// (a review found a 2 px green line down the whole page at the left, the heading over a cue chip
// and the "?" over the Effects lane: the palette's heading row picked up the playhead's style)
for (const size of [{ width: 1400, height: 900 }, { width: 390, height: 844 }]) {
  test(`the timeline screen draws no stray line, nothing sits on anything (${size.width} px)`, async ({ page }) => {
    await page.setViewportSize(size);
    await bar(page);
    await page.locator('.tlv .pal .chip').first().click();                 // something on the tracks, a playhead to draw
    const found = await page.evaluate(() => {
      const vh = innerHeight, lines: string[] = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width >= 1.5 && r.width <= 3.5 && r.height > vh * 0.8 && r.left < 60) lines.push(`${el.tagName}.${el.className} ${Math.round(r.left)},${Math.round(r.top)} ${r.width}x${Math.round(r.height)}`);
      }
      const box = (el: Element | null) => el?.getBoundingClientRect();
      const meet = (a?: DOMRect, b?: DOMRect) => !!a && !!b && a.width > 0 && b.width > 0 && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const pal = document.querySelector('.tlv .pal')!, heading = box(pal.querySelector('h2')), help = box(pal.querySelector('.help'));
      const chips = [...pal.querySelectorAll('.chip, h3')].map((c) => c.getBoundingClientRect());
      const effectsLane = box([...document.querySelectorAll('.tlv .nl')].find((n) => n.textContent?.trim() === 'Effects') ?? null);
      return {
        lines,
        headingOnChip: chips.some((c) => meet(heading, c)), helpOnChip: chips.some((c) => meet(help, c)),
        helpOnLane: [...document.querySelectorAll('.tlv .nl, .tlv .nr')].some((n) => meet(help, n.getBoundingClientRect())),
        effectsLaneShown: !!effectsLane && effectsLane.width > 0,
        headingAbsolute: getComputedStyle(pal.querySelector('h2')!.parentElement!).position === 'absolute',
      };
    });
    expect(found.lines).toEqual([]);
    expect(found).toMatchObject({ headingOnChip: false, helpOnChip: false, helpOnLane: false, effectsLaneShown: true, headingAbsolute: false });
  });
}

test('a moment placed where the song starts happens when it starts (fog at 0:00, on the wire)', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-fog', 1, 0, 'Fog');
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  await page.locator('.tlv .pal .chip.mo', { hasText: /^Fog$/ }).click();            // at the playhead: 0:00
  expect(await page.evaluate(() => (window as any).__luxdmx.show.timeline.items[0].at)).toBe(0);
  await page.locator('.transport').getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => (await channels(0, 1))[0], { timeout: 5000 }).toBe(255);
});

test('a demo song: picked, it downloads with progress, brings its tempo and parts; a cue on a part fires on the wire', async ({ page }) => {
  await catalog(page);
  await bar(page);
  await page.locator('.tlv').getByRole('button', { name: 'Demo songs…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Demo songs' });
  await expect(dlg.getByRole('heading', { name: 'Rock / punk' })).toBeVisible();
  const row = dlg.locator('li', { hasText: 'Test Song' });
  await expect(row).toContainText('The Testers');
  await expect(row).toContainText('120 BPM');
  await expect(row).toContainText('0:24');
  await expect(row.getByRole('link', { name: 'CC BY' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
  await row.getByRole('button', { name: 'Listen to Test Song' }).click();
  await expect(row.getByRole('button', { name: 'Stop Test Song' })).toHaveAttribute('aria-pressed', 'true');
  await row.getByRole('button', { name: 'Stop Test Song' }).click();
  await row.getByRole('button', { name: 'Use Test Song' }).click();
  // the progress, part of the way (its own address is gone: it comes from our copy)
  const bar_ = row.getByRole('progressbar', { name: 'Downloading Test Song' });
  await expect.poll(async () => { const v = Number(await bar_.getAttribute('value')), m = Number(await bar_.getAttribute('max')); return v > 0 && v < m; }, { timeout: 4000, intervals: [50] }).toBe(true);
  await expect(dlg).toHaveCount(0, { timeout: 10_000 });
  const tl = await page.evaluate(() => { const t = (window as any).__luxdmx.show.timeline; return { bpm: t.bpm, offset: t.offset, duration: t.duration, demo: t.demo, audio: t.audio, sections: t.sections.map((s: any) => s.name) }; });
  expect(tl).toMatchObject({ bpm: 120, offset: 0.5, sections: ['Intro', 'Verse', 'Chorus', 'Outro'], audio: { catalog: 'e2e-song', credit: '"Test Song" by The Testers, CC BY' } });
  expect(tl.demo).toBeUndefined();
  expect(tl.duration).toBeGreaterThan(23.5); expect(tl.duration).toBeLessThan(24.5);
  await expect(page.locator('.tlv .sec')).toHaveText(['Intro', 'Verse', 'Chorus', 'Outro']);
  await expect(page.locator('.tlv .credit')).toContainText('"Test Song" by The Testers, CC BY');
  await expect(page.locator('.tlv .credit').getByRole('link', { name: 'the licence' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
  // the first cue at the start; a click on the Chorus goes there and the second cue lands on it
  const names = await page.evaluate(() => (window as any).__luxdmx.show.cueLists[0].cues.slice(0, 2).map((c: any) => c.name));
  const chips = page.locator('.tlv .pal .chip');
  await chips.first().click();
  await page.locator('.tlv').getByRole('button', { name: 'Go to Chorus (0:12)' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.position)).toBe(12.5);
  await chips.nth(1).click();
  // and near a part (a little before the Outro, which isn't on a beat), a cue snaps onto the part
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(20.68));
  await chips.nth(2).click();
  expect(await page.evaluate(() => (window as any).__luxdmx.show.timeline.items.map((i: any) => i.at))).toEqual([0, 12.5, 20.75]);
  // played from just before the chorus: its cue comes on with it, on the wire too
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(11));
  await expect.poll(() => cueOn(page)).toBe(names[0]);
  await page.locator('.transport').getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => cueOn(page), { timeout: 6000 }).toBe(names[1]);
  await expect.poll(async () => (await channels(0, 16)).some((v) => v > 0)).toBe(true);
  await page.locator('.transport').getByRole('button', { name: 'Pause' }).click();
});

test("a demo song that can't be downloaded says so in plain words, and nothing changes", async ({ page }) => {
  await catalog(page, false);
  await bar(page);
  await page.locator('.tlv').getByRole('button', { name: 'Demo songs…' }).click();
  await page.getByRole('dialog', { name: 'Demo songs' }).getByRole('button', { name: 'Use Test Song' }).click();
  await expect(page.getByText(`"Test Song" can't be downloaded right now`)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__luxdmx.show.timeline?.audio)).toBeUndefined();
});

// SAFETY: going through the song never fires a moment. With the machines armed, the playhead
// grabbed down over the lanes (anywhere along it) and swept back and forth over a flame moment,
// while paused and while playing, the arrow keys landing right on it: the flame channel stays 0 the
// whole time. Played through, it fires once.
test('scrubbing never fires anything: flames swept over many times stay off; played through, they fire once', async ({ page }) => {
  // a bar's rig with a flame machine added; its first look on from the start (so frames flow)
  await bar(page);
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  await patch(page, 'gen-flame', 1, 0, 'Flame');
  const addr = await page.evaluate(() => (window as any).__luxdmx.show.fixtures.find((f: any) => f.typeId === 'gen-flame').address);
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  await page.evaluate(() => { const p = (window as any).__luxdmx.timeline; p.ensure(); p.seek(0); });   // (a silent timeline, 4 min)
  await page.locator('.tlv .pal .chip').first().click();
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(4));
  await page.locator('.tlv .pal .chip.mo', { hasText: /^Flames$/ }).click();
  expect(await page.evaluate(() => (window as any).__luxdmx.show.timeline.items.map((i: any) => i.at))).toEqual([0, 4]);
  await expect(page.locator('.tlv .it .mark.hazard')).toHaveCount(1);
  await expect(page.locator('.tlv .it', { hasText: 'Flames' })).toHaveAttribute('aria-label', 'Flames at 0:04.0, fires a machine');
  const flame = async () => (await history(0, addr)).map(([, v]) => v);
  // armed from the start: if a scrub fired anything, the flame would show on the wire
  await expect(page.locator('.transport .armed')).toHaveText('Machines safe');
  await page.evaluate(() => (window as any).__luxdmx.armMachines(true));
  await expect(page.locator('.transport .armed')).toHaveText('Machines armed');
  // where a time is on the screen (from the playhead itself)
  const head = page.locator('.tlv .playhead'), lane = page.locator('.tlv .lane').last();
  const at = async (t: number) => { await page.evaluate(([t]) => (window as any).__luxdmx.timeline.seek(t), [t]); const b = (await head.boundingBox())!; return b.x + b.width / 2; };
  const x1 = await at(1), x8 = await at(8), laneY = (await lane.boundingBox())!.y + 19;
  await at(1);
  // the grab reaches down over the lanes: the playhead is what's under the pointer there, with its cursor
  expect(await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el?.classList.contains('playhead') ? getComputedStyle(el).cursor : el?.className; }, [x1 + 5, laneY])).toBe('ew-resize');
  async function sweep(from: number, times: number) {
    await page.mouse.move(from + 3, laneY);
    await page.mouse.down();
    for (let k = 0; k < times; k++) { await page.mouse.move(x8, laneY, { steps: 12 }); await page.mouse.move(x1, laneY, { steps: 12 }); }
    await page.mouse.move(x8, laneY, { steps: 12 });
    await page.mouse.up();
  }
  await sweep(x1, 6);
  expect(Math.abs((await page.evaluate(() => (window as any).__luxdmx.timeline.position)) - 8)).toBeLessThan(0.3);
  // on stage, the first drag says the real lights follow it (and that the machines never fire)
  await expect(page.locator('.toast')).toContainText('follow the playhead as you drag');
  // while playing (from 8 s: the flame is behind it), swept back over it and let go after it again
  await page.locator('.transport').getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.playing)).toBe(true);
  await sweep((await head.boundingBox())!.x + 1, 6);
  if (await page.evaluate(() => (window as any).__luxdmx.timeline.playing)) await page.locator('.transport').getByRole('button', { name: 'Pause' }).click();
  // the keys: back to the start, then a bar at a time (2 s at 120 BPM), landing right on the flame
  await page.locator('.tlv .tracks').click({ position: { x: 5, y: 120 } }).catch(() => {});
  await page.keyboard.press('Home');
  for (let k = 0; k < 4; k++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  expect((await flame()).length).toBeGreaterThan(10);                     // (frames were sent all along)
  expect(Math.max(...(await flame()))).toBe(0);                           // and the flames never came on
  // played through from 2 s: they fire, once
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.timeline.pause(); a.timeline.seek(2); });
  const before = (await flame()).length;
  await page.locator('.transport').getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => Math.max(...(await flame()).slice(before)), { timeout: 6000 }).toBe(255);
  await page.waitForTimeout(2500);
  await page.locator('.transport').getByRole('button', { name: 'Pause' }).click();
  const after = (await flame()).slice(before);
  expect(after.filter((v, i) => v > 0 && (i === 0 || after[i - 1] === 0)).length).toBe(1);
  expect(after.at(-1)).toBe(0);
});

// A demo song still coming down when another show is opened isn't put on that one: it says so.
test('a song that arrives after another show was opened stays off that show', async ({ page }) => {
  await catalog(page);
  await bar(page);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/song.wav', async (r) => { await held; await r.continue(); });
  await page.locator('.tlv').getByRole('button', { name: 'Demo songs…' }).click();
  await page.getByRole('dialog', { name: 'Demo songs' }).getByRole('button', { name: 'Use Test Song' }).click();
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as any).__luxdmx.newShow());
  release();
  await expect(page.locator('.toast')).toContainText('came down after another show was opened');
  expect(await page.evaluate(() => (window as any).__luxdmx.show.timeline?.audio)).toBeUndefined();
});
