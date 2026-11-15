// The timeline: cues and moments placed on a song play on its clock (measured on the engine and the
// wire), a jump puts the stage where it would be, effects run as bars, the demo beat is ten minutes
// with its sections, a demo song downloads (with progress) and brings its parts, cues snap to them,
// and what's placed moves, goes with Del and comes back with Undo.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { openConnected, resetFake, channels, frames, history, patch, test, expect, startTemplate } from './helpers';

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
  await startTemplate(page, 'Bar');
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

test('cues tapped in a row without moving the playhead go one after the other, a bar apart, not on top of each other', async ({ page }) => {
  await bar(page);
  const chips = page.locator('.tlv .pal .chip');
  for (const i of [0, 1, 2]) await chips.nth(i).click();
  const at = await page.evaluate(() => { const t = (window as any).__luxdmx.show.timeline; return { at: t.items.map((i: any) => i.at), bpm: t.bpm ?? (window as any).__luxdmx.show.settings.bpm }; });
  const len = (60 / at.bpm) * 4;
  expect(at.at.length).toBe(3);
  expect(at.at[0]).toBe(0);
  expect(at.at[1]).toBeCloseTo(len, 1); expect(at.at[2]).toBeCloseTo(2 * len, 1);
});

test('the Moments offer the machines the rig has (and strobe and blinder hits, which any light does)', async ({ page }) => {
  await bar(page);                                                         // (the Bar: confetti, CO2, sparks, bubbles, fog; no flames)
  const mo = page.locator('.tlv .pal .chip.mo');
  await expect(mo.filter({ hasText: 'Confetti' })).toHaveCount(1);
  await expect(mo.filter({ hasText: 'Flames' })).toHaveCount(0);
  await expect(mo.filter({ hasText: 'Strobe hit' })).toHaveCount(1);
  // the confetti cannon gone: its moment goes from the list too
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.selected = a.show.fixtures.filter((f: any) => /^Confetti/.test(f.name)).map((f: any) => f.id); a.removeFixtures(); });
  await expect(mo.filter({ hasText: 'Confetti' })).toHaveCount(0);
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
  // (in the set it's called by its title, not its file's name with the artist first)
  expect(await page.evaluate(() => (window as any).__luxdmx.show.timeline.name)).toBe('Test Song');
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

test('Loop this part: the part plays over and over, its chip stops it; L loops the part the playhead is in', async ({ page }) => {
  test.setTimeout(90_000);
  await bar(page);
  await page.locator('.tlv').getByRole('button', { name: 'Demo songs…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Demo songs' });
  await dlg.getByRole('button', { name: 'Use Demo beat' }).click();
  await expect(dlg).toHaveCount(0);
  // (short parts, so it comes round quickly)
  await page.evaluate(() => { (window as any).__luxdmx.show.timeline.sections = [{ name: 'Intro', at: 0 }, { name: 'Drop', at: 2 }, { name: 'Outro', at: 4.5 }]; });
  // (zoomed in: on the whole ten minutes the part is a sliver)
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
  const drop = page.locator('.tlv .sec').filter({ hasText: /^Drop$/ });
  await expect(drop).toHaveCount(1);
  await drop.click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: 'Loop this part' }).click();
  const tr = page.getByRole('toolbar', { name: 'Transport' });
  await expect(tr.getByRole('status').filter({ hasText: 'Looping Drop' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.playing)).toBe(true);
  // over 6 s (more than two rounds): always inside the part, and it came round
  const seen = await page.evaluate(async () => {
    const P = (window as any).__luxdmx.timeline, out: number[] = [];
    for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 200)); out.push(P.position); }
    return out;
  });
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(2 - 0.05);
  expect(Math.max(...seen)).toBeLessThan(4.5 + 0.3);
  expect(seen.some((t, i) => i > 0 && t < seen[i - 1] - 1)).toBe(true);
  // the chip's ×: it plays on past the end
  await tr.getByRole('button', { name: 'Stop looping Drop' }).click();
  await expect(tr.getByRole('status').filter({ hasText: 'Looping' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.position), { timeout: 8000 }).toBeGreaterThan(4.6);
  await page.evaluate(() => (window as any).__luxdmx.timeline.pause());
  // L: the part the playhead is in (Intro), and L again stops it
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(0.5));
  await page.keyboard.press('l');
  await expect(tr.getByRole('status').filter({ hasText: 'Looping Intro' })).toBeVisible();
  await page.keyboard.press('l');
  await expect(tr.getByRole('status').filter({ hasText: 'Looping' })).toHaveCount(0);
  await page.evaluate(() => (window as any).__luxdmx.timeline.pause());
});

test('the Effects track opened: a row per knob; the line drags the effect\'s own value, a double-click makes a curve that plays along the bar; the wheel zooms', async ({ page }) => {
  await bar(page);
  const fx = page.locator('.tlv .pal .chip.fx').first();
  await fx.dragTo(page.locator('.tlv .tracks .lane').first(), { targetPosition: { x: 60, y: 15 } });
  const it0 = await page.evaluate(() => (window as any).__luxdmx.show.timeline.items[0]);
  const fxId = it0.do.effect;
  await page.locator('.tlv').getByRole('button', { name: /Open the effects/ }).click();
  await expect(page.locator('.tlv .nl.sub')).not.toHaveCount(0);
  const kinds = await page.locator('.tlv .nl.sub').allTextContents();
  expect(kinds).toContain('speed');
  const row = (k: string) => page.locator('.tlv .lane.sub').nth(kinds.indexOf(k)).locator('svg.curve').first();
  // the effect's own size, dragged up: the effect itself changes (every bar of it)
  if (kinds.includes('size')) {
    const s = await row('size').boundingBox(), line = await row('size').locator('line.hit').boundingBox();
    await page.mouse.move(s!.x + s!.width / 2, line!.y + line!.height / 2); await page.mouse.down();
    await page.mouse.move(s!.x + s!.width / 2, s!.y + s!.height * 0.75, { steps: 4 }); await page.mouse.up();
    await expect.poll(() => page.evaluate((e) => (window as any).__luxdmx.show.effects.find((x: any) => x.id === e).params.size, fxId)).toBeLessThan(0.7);
  }
  // a double-click on the speed line: a point there, a curve over this bar (its ends the effect's own)
  const sp = await row('speed').boundingBox(), sl = await row('speed').locator('line.hit').boundingBox();
  await page.mouse.dblclick(sp!.x + sp!.width / 2, sl!.y + sl!.height / 2);
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.timeline.items[0].curves?.[0]?.pts.length)).toBe(3);
  // dragged to the top: much slower there (the top of the speed row is 32 beats a round)
  const pt = row('speed').locator('circle.pt').nth(1), pb = await pt.boundingBox();
  await page.mouse.move(pb!.x + pb!.width / 2, pb!.y + pb!.height / 2); await page.mouse.down();
  await page.mouse.move(pb!.x + pb!.width / 2, sp!.y + 1, { steps: 4 }); await page.mouse.up();
  const curve = await page.evaluate(() => (window as any).__luxdmx.show.timeline.items[0].curves[0]);
  expect(curve.knob).toBe('speed'); expect(curve.pts[1][1]).toBeGreaterThan(16);
  // playing through the bar: the effect runs with the curve's speed where the song is, its own after
  const it = await page.evaluate(() => (window as any).__luxdmx.show.timeline.items[0]);
  await page.evaluate((t) => { const p = (window as any).__luxdmx.timeline; p.seek(t); void p.play(); }, it.at + it.len * curve.pts[1][0]);
  await expect.poll(() => page.evaluate((e) => (window as any).__luxdmx.engine.fxOver[e]?.speed ?? 0, fxId), { timeout: 8000 }).toBeGreaterThan(8);
  await page.evaluate(() => (window as any).__luxdmx.timeline.pause());
  await expect.poll(() => page.evaluate((e) => (window as any).__luxdmx.engine.fxOver[e], fxId)).toBeUndefined();
  // a double-click on a point takes it away; down to one, the curve goes (the playhead off it first)
  await page.evaluate((t) => (window as any).__luxdmx.timeline.seek(t), it.at + it.len + 2);
  await row('speed').locator('circle.pt').nth(1).dblclick();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.timeline.items[0].curves?.[0]?.pts.length)).toBe(2);
  await row('speed').locator('circle.pt').nth(0).dblclick();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.timeline.items[0].curves)).toBeUndefined();
  // the wheel zooms the tracks round the pointer
  const w0 = await page.locator('.tlv .it').first().boundingBox();
  const tr = await page.locator('.tlv .tracks').boundingBox();
  await page.mouse.move(tr!.x + 200, tr!.y + 60); await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await page.locator('.tlv .it').first().boundingBox())!.width).toBeGreaterThan(w0!.width * 1.3);
});

test('a list\'s track opened: its level over the song, a point put and moved dims the list while the song plays (on the wire too); the Moments track opened: how long each lasts, dragged and keyed', async ({ page }) => {
  await bar(page);
  await page.locator('.tlv .pal .chip').first().click();                   // the list's first cue at 0:00
  const { list, name } = await page.evaluate(() => { const a = (window as any).__luxdmx, id = a.show.timeline.items[0].lane.slice(5); return { list: id, name: a.show.cueLists.find((l: any) => l.id === id).name }; });
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(0));
  const lit = () => page.evaluate(() => Object.values((window as any).__luxdmx.stage as Record<string, any>).reduce((s, v) => s + (v.intensity ?? 0), 0));
  const wire = async () => Object.values(await frames()).reduce((s, f) => s + f.ch.reduce((a, b) => a + b, 0), 0);
  await expect.poll(lit).toBeGreaterThan(0.5);
  const full = await lit(), wireFull = await wire();
  // opened: a dashed line at full; a click low in the row puts a point there (that level all song long)
  await page.locator('.tlv').getByRole('button', { name: `Open ${name}'s level` }).click();
  const rows = page.locator('.tlv .lane.sub svg.level'), row = rows.first();
  await expect(rows).toHaveCount(1);
  await expect(row.locator('line.own')).toHaveCount(1);
  const r = await row.boundingBox();
  await page.mouse.click(r!.x + r!.width * 0.4, r!.y + r!.height * 0.75);
  const pts = () => page.evaluate((l) => (window as any).__luxdmx.show.timeline.levels?.[l], list);
  await expect.poll(async () => (await pts())?.length).toBe(1);
  expect((await pts())[0][1]).toBeGreaterThan(0.1); expect((await pts())[0][1]).toBeLessThan(0.35);
  // Undo takes it away, Redo puts it back
  await page.keyboard.press('Control+z');
  await expect.poll(pts).toBeUndefined();
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await pts())?.length).toBe(1);
  // another list's row, while this one has a point: one plain click puts its first point too
  await page.evaluate(() => (window as any).__luxdmx.newList('Second'));
  const levelOpeners = page.locator('.tlv .nl .open[aria-label$="\'s level"][aria-expanded="false"]');
  expect(await levelOpeners.count()).toBeGreaterThan(0);
  const label = (await levelOpeners.first().getAttribute('aria-label'))!;
  const other = label.replace(/^Open /, '').replace(/'s level$/, '');
  await levelOpeners.first().click();
  await expect(rows).toHaveCount(2);
  const r2 = await page.locator(`.tlv svg.level[aria-label="The level of ${other} over the song"]`).boundingBox();
  await page.mouse.click(r2!.x + r2!.width * 0.6, r2!.y + r2!.height * 0.5);
  await expect.poll(() => page.evaluate((n) => { const a = (window as any).__luxdmx; const id = a.show.cueLists.find((x: any) => x.name === n).id; return a.show.timeline.levels?.[id]?.length; }, other)).toBe(1);
  await expect(page.locator(`.tlv svg.level[aria-label="The level of ${other} over the song"] circle.pt`)).toHaveCount(1);
  await page.locator('.tlv').getByRole('button', { name: `Close ${other}'s level` }).click();
  await expect(rows).toHaveCount(1);
  // the point dragged further down: lower still
  const pt = await row.locator('circle.pt').boundingBox();
  await page.mouse.move(pt!.x + pt!.width / 2, pt!.y + pt!.height / 2); await page.mouse.down();
  await page.mouse.move(pt!.x + pt!.width / 2, r!.y + r!.height * 0.9, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => (await pts())[0][1]).toBeLessThan(0.15);
  const level = (await pts())[0][1];
  // paused nothing changes; playing, the list is at that level: the stage and the wire dimmer
  expect(await page.evaluate((l) => (window as any).__luxdmx.engine.levelOver[l], list)).toBeUndefined();
  await page.locator('.transport').getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => page.evaluate((l) => (window as any).__luxdmx.engine.levelOver[l], list)).toBeCloseTo(level, 2);
  await expect.poll(lit).toBeLessThan(full * 0.5);
  await expect.poll(wire).toBeLessThan(wireFull);
  await page.locator('.transport').getByRole('button', { name: 'Pause' }).click();
  await expect.poll(() => page.evaluate((l) => (window as any).__luxdmx.engine.levelOver[l], list)).toBeUndefined();
  await expect.poll(lit).toBeGreaterThan(full * 0.9);
  // a double-click on the point takes it away: the dashed line at full again
  await row.locator('circle.pt').dblclick();
  await expect.poll(pts).toBeUndefined();
  await expect(row.locator('line.own')).toHaveCount(1);
  // the keyboard: Enter on the row puts a point at the playhead (at full: there were none), the
  // arrows change it (5 %, Shift 1 %; a beat along), Delete takes it away
  const beat = await page.evaluate(() => { const a = (window as any).__luxdmx; return 60 / (a.show.timeline.bpm ?? a.show.settings.bpm); });
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(8));
  await row.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await pts())?.length).toBe(1);
  const t0 = (await pts())[0][0];
  expect(Math.abs(t0 - 8)).toBeLessThan(beat);
  expect((await pts())[0][1]).toBe(1);
  await expect(row.locator('circle.pt')).toBeFocused();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await pts())[0][1]).toBeCloseTo(0.84, 5);
  expect((await pts())[0][0]).toBeCloseTo(t0 + beat, 3);
  await expect(row.locator('circle.pt')).toHaveAttribute('aria-valuenow', '84');
  await page.keyboard.press('Delete');
  await expect.poll(pts).toBeUndefined();
  await expect(row).toBeFocused();

  // a strobe hit at 0:04; the Moments track opened: a bar as long as it lasts (2 s)
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(4));
  await page.locator('.tlv .pal .chip.mo').filter({ hasText: 'Strobe hit' }).click();
  const hit = () => page.evaluate(() => (window as any).__luxdmx.show.timeline.items.find((i: any) => i.do.do === 'burst').do.seconds);
  expect(await hit()).toBe(2);
  await page.locator('.tlv').getByRole('button', { name: "Open the moments' lengths" }).click();
  const len = page.locator('.tlv .lane.sub [role=slider]');
  await expect(len).toHaveCount(1);
  await expect(len).toHaveAttribute('aria-valuenow', '2');
  // its end dragged to the right: longer (zoomed in, the playhead off it)
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(0));
  for (let i = 0; i < 4; i++) await page.locator('.tlv').getByRole('button', { name: 'Zoom in' }).click();
  await len.scrollIntoViewIfNeeded();
  const e = await len.locator('.end').boundingBox(), b = await len.boundingBox();
  await page.mouse.move(e!.x + e!.width / 2, e!.y + e!.height / 2); await page.mouse.down();
  await page.mouse.move(e!.x + e!.width / 2 + b!.width, e!.y + e!.height / 2, { steps: 4 }); await page.mouse.up();
  await expect.poll(hit).toBeGreaterThan(3);
  const dragged = await hit();
  // the arrow keys on it: half a second each, Shift a tenth; Undo takes a step back
  await len.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(hit).toBeCloseTo(dragged - 0.5, 5);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(hit).toBeCloseTo(dragged - 0.4, 5);
  await page.keyboard.press('Control+z');
  await expect.poll(hit).toBeCloseTo(dragged - 0.5, 5);
  // a show file keeps it
  const saved = await page.evaluate(async () => { const f = await import('/src/model/format.ts'); return f.parseShow(JSON.stringify((window as any).__luxdmx.show)).timeline!.items.find((i: any) => i.do.do === 'burst')!.do; });
  expect((saved as any).seconds).toBeCloseTo(dragged - 0.5, 5);
});
