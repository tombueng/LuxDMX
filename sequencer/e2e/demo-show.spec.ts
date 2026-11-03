// The big demo on its own song ("Ready To Go", where it hits measured): a dead stop goes dark but
// for a few spots on the band (engine and wire), the last two beats flash in eighths, and where the
// band slams back in the look changes at once and the heads snap to a new shape on every beat of
// the bar. The song is the catalog's own (its tempo, parts and hits), its sound a silent file from
// a local server (nothing comes down from the internet).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { CATALOG } from '../src/timeline/catalog';
import { openConnected, resetFake, channels, welcome, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

const song = CATALOG.find((x) => x.id === 'ready-to-go')!;
let srv: http.Server, base = '';
test.beforeAll(async () => {
  // as long as the song, silent: 8-bit mono at 4 kHz
  const rate = 4000, n = Math.ceil(song.duration * rate), wav = Buffer.alloc(44 + n, 128);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(n, 40);
  srv = http.createServer((req, res) => {
    if (!req.url?.startsWith('/ready.wav')) { res.writeHead(404, { 'access-control-allow-origin': '*' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length, 'access-control-allow-origin': '*' });
    res.end(wav);
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
test.afterAll(() => { srv?.close(); });

async function catalog(page: Page) {
  const { sha256: _, ...entry } = { ...song, url: `${base}/gone.wav`, mirror: `${base}/ready.wav` };
  await page.route('**/src/timeline/catalog.ts*', (r) => r.fulfill({ contentType: 'text/javascript',
    body: `export const GENRES = { hardrock: 'Hard rock' };\nexport const CATALOG = ${JSON.stringify([entry])};\n` }));
}
// the cue a list is on, by the list's name
const on = (page: Page, list: string) => page.evaluate((n) => {
  const a = (window as any).__luxdmx, l = a.show.cueLists.find((x: any) => x.name === n), st = a.engine.status(l.id);
  return st.running ? l.cues[st.index].name : '';
}, list);
const level = async (page: Page, name: string) => {
  const f = await page.evaluate((n) => { const x = (window as any).__luxdmx.show.fixtures.find((y: any) => y.name === n); return { u: x.universe, a: x.address }; }, name);
  return (await channels(f.u, 512))[f.a - 1 + 5];        // (a head's level: the sixth channel)
};

test('the big demo on its own song: dark on a dead stop but for spots on the band, and on the slam a new look with the heads snapping on every beat', async ({ page }) => {
  test.setTimeout(120_000);
  await catalog(page);
  await openConnected(page);
  const w = await welcome(page);
  await expect(w.getByLabel("The demo's music")).toHaveValue('ready-to-go');      // (the demo's own song, picked already)
  await w.getByRole('button', { name: 'Show me a demo' }).click();
  await expect(w).toBeHidden({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.timeline.audio?.catalog), { timeout: 30000 }).toBe('ready-to-go');
  expect(await page.evaluate(() => (window as any).__luxdmx.show.cueLists.find((l: any) => l.name === 'Moves')?.priority)).toBe('high');

  // the band stops dead at 88.7 s: dark but for the spots on the band (on the wire too)
  await page.evaluate(() => { const t = (window as any).__luxdmx.timeline; t.pause(); t.seek(89.0); });
  await expect.poll(() => on(page, 'Show'), { timeout: 15000 }).toBe('Stop: on the band');
  await expect.poll(() => on(page, 'Moves')).toBe('Band');
  await expect.poll(() => level(page, 'Spot 10'), { timeout: 8000 }).toBe(255);
  // (the box here has universes 0 and 1: the back truss and the mid truss)
  expect(await level(page, 'Back beam 3')).toBe(0);
  expect(await level(page, 'Back wash 3')).toBe(0);
  expect(await level(page, 'Spot 2')).toBe(0);

  // the last two beats of the stop: the heads up, flashing in eighths
  const jump = async (t: number) => { await page.evaluate((x) => (window as any).__luxdmx.timeline.seek(x), t); return [await on(page, 'Show'), await on(page, 'Moves')]; };
  await expect.poll(() => jump(90.0), { timeout: 10000 }).toEqual(['Riser: eighths', 'Sky']);
  // the slam at 90.5 s: a new look at once, the heads on a new shape on every beat of its bar
  // (90.495, 90.943, 91.391, 91.838: a moment into each beat)
  const beats: string[][] = [];
  for (const t of [90.55, 91.0, 91.45, 91.9]) { await page.waitForTimeout(150); beats.push(await jump(t)); }
  for (const [look] of beats) expect(['Riser: eighths', 'Stop: on the band']).not.toContain(look);
  expect(beats.every(([, m], k) => m && m !== 'Sky' && (k === 0 || m !== beats[k - 1][1])), JSON.stringify(beats)).toBe(true);
  // and playing, the heads keep moving on the beat
  await page.evaluate(() => { const t = (window as any).__luxdmx.timeline; t.seek(93.2); void t.play(); });
  const first = await on(page, 'Moves');
  await expect.poll(() => on(page, 'Moves'), { timeout: 10000 }).not.toBe(first);
  await page.evaluate(() => (window as any).__luxdmx.timeline.pause());
});

test('the band only plays while the music does: still in the show\'s intro before the song, playing in it', async ({ page }) => {
  test.setTimeout(120_000);
  await catalog(page);
  await openConnected(page);
  const w = await welcome(page);
  await w.getByRole('button', { name: 'Show me a demo' }).click();
  await expect(w).toBeHidden({ timeout: 30000 });
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45000 });
  const hand = () => page.evaluate(() => (window as any).__stage3d?.band() as number[] | null);
  await expect.poll(hand, { timeout: 30000 }).not.toBeNull();
  const moved = async () => { const a = (await hand())!; await page.waitForTimeout(700); const b = (await hand())!; return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
  // the intro (before the song's 0): the clock runs, the band stands
  await page.evaluate(() => { const t = (window as any).__luxdmx.timeline; t.seek(-20); void t.play(); });
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.playing)).toBe(true);
  await page.waitForTimeout(500);
  expect(await moved()).toBeLessThan(1e-4);
  // in the song: they play
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(20));
  await expect.poll(moved, { timeout: 10000 }).toBeGreaterThan(0.01);
  await page.evaluate(() => (window as any).__luxdmx.timeline.pause());
});
