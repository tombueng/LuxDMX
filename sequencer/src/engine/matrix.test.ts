// The twenty more matrix shows (matrix.ts): ten with your words, ten pictures. The checks every shape
// effect gets (in range, never NaN, lit and moving on a disc and a matrix) are in shapes.test.ts;
// here: that the words say what they're given, letter by letter where they go letter by letter, fit
// where they can, and that the pictures do what their names say.
import { describe, expect, it } from 'vitest';
import { EFFECT_MAP, EFFECTS, paramsOf, runEffect, type Where } from './effects';
import { MATRIX_EFFECTS } from './matrix';
import { glyph } from './shapes';
import { placesFor, type Places } from '../model/pixelLayout';
import type { PixelLayout } from '../model/types';

const on = (l: PixelLayout): Where[] => { const at = placesFor(l); return Array.from({ length: at.n }, (_, i) => ({ u: i / (at.n - 1), row: 0, rows: 1, at, cell: i })); };
const BANNER = on({ kind: 'matrix', cols: 32, rows: 8, zigzag: true }), SQUARE = on({ kind: 'matrix', cols: 16, rows: 16, zigzag: true });
// a frame at a number of the effect's rounds (beats and seconds alike)
const frame = (id: string, where: Where[], rounds: number, own: Record<string, unknown> = {}) => {
  const p = { ...paramsOf(id, own), sound: 0 };
  return runEffect(EFFECT_MAP.get(id)!, p, where.length, rounds, 1, where, { beats: rounds * p.speed, secs: rounds * p.speed });
};
const litSet = (fr: ReturnType<typeof frame>, at: Places, over = 0.5) => new Set(fr.flatMap((o, i) => ((o.intensity ?? 0) > over ? [`${at.gx[i]},${at.gy[i]}`] : [])));
const dots = (ch: string) => glyph(ch).reduce((n, c) => n + [...c.toString(2)].filter((b) => b === '1').length, 0);
const WORDS = MATRIX_EFFECTS.filter((d) => d.defaults.text !== undefined).map((d) => d.id);

it('twenty, ten of them with words; each a shape show with a name and a plain blurb; the words aren\'t mirrored', () => {
  expect(MATRIX_EFFECTS.length).toBe(20);
  expect(WORDS.length).toBe(10);
  for (const d of MATRIX_EFFECTS) {
    expect(EFFECTS).toContain(d);
    expect(d.shape).toBe(true); expect(d.category).toBe('pixel');
    expect(d.blurb.length).toBeGreaterThan(30); expect(d.blurb).not.toMatch(/—/);
    expect(!!d.noFlip).toBe(WORDS.includes(d.id));
  }
});

describe.each(WORDS)('%s', (id) => {
  it('shows what it is given: other words, another picture', () => {
    const at = SQUARE[0].at as Places;
    const differs = [0.5, 1.5, 2.5, 3.3, 5.5, 8.5].some((r) => {
      const a = [...litSet(frame(id, SQUARE, r, { text: 'HI' }), at)].sort().join(), b = [...litSet(frame(id, SQUARE, r, { text: 'WOW' }), at)].sort().join();
      return a !== b && (a.length > 0 || b.length > 0);
    });
    expect(differs).toBe(true);
  });
});

it('Letter zoom: a letter at a time, filling the picture in the middle of its round, then the next', () => {
  const at = SQUARE[0].at as Places, i1 = litSet(frame('letterZoom', SQUARE, 0.5, { text: 'IO' }), at), o = litSet(frame('letterZoom', SQUARE, 1.5, { text: 'IO' }), at);
  const i2 = litSet(frame('letterZoom', SQUARE, 2.5, { text: 'IO' }), at);
  expect([...i1].sort()).toEqual([...i2].sort());                         // (round 3 is the I again)
  expect([...i1].sort()).not.toEqual([...o].sort());
  // (an I: lit in the middle column all the way up, the O: lit at its sides, dark in its middle)
  expect(i1.has('8,8') || i1.has('7,8')).toBe(true);
  expect(o.has('8,8') || o.has('7,8')).toBe(false);
  expect(o.size).toBeGreaterThan(i1.size);
});

it('Typewriter: one more letter each round, the cursor ahead of them; a full line stays, then it starts again', () => {
  const at = BANNER[0].at as Places, n = (r: number) => litSet(frame('typewriter', BANNER, r, { text: 'HI' }), at).size;
  expect(n(0.5)).toBeLessThan(6);                                        // (only the cursor)
  expect(n(1.5)).toBeGreaterThanOrEqual(dots('H'));
  expect(n(2.5)).toBeGreaterThanOrEqual(dots('H') + dots('I'));
  expect(n(4)).toBeGreaterThanOrEqual(dots('H') + dots('I'));           // (it stays a moment)
  expect(n(2 + 6 + 0.7)).toBe(0);                                        // (then it's cleared)
});

it('a word that is a little too wide fits without the gaps between its letters: LUXDMX whole on a 32 wide banner', () => {
  const at = BANNER[0].at as Places, want = [...'LUXDMX'].reduce((s, ch) => s + dots(ch), 0);
  // (Glitch text at a moment it isn't glitching: the word as it is)
  const calm = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55].map((r) => litSet(frame('glitchText', BANNER, r, { text: 'LUXDMX' }), at, 0.9).size);
  expect(calm).toContain(want);
  // and the neon sign: every dot of BAR on a 16 x 16
  const neon = frame('neonText', SQUARE, 0.4, { text: 'BAR' }), lit = neon.filter((o) => (o.intensity ?? 0) > 0.7).length;
  expect(lit).toBe(dots('B') + dots('A') + dots('R'));
});

it('Word flash: a new word on every beat, bright on the beat and fading till the next', () => {
  const at = BANNER[0].at as Places, bright = (r: number) => Math.max(...frame('wordFlash', BANNER, r, { text: 'GO NOW' }).map((o) => o.intensity ?? 0));
  expect(bright(0.02)).toBeGreaterThan(0.9); expect(bright(0.9)).toBeLessThan(0.4);
  expect([...litSet(frame('wordFlash', BANNER, 0.1, { text: 'GO NOW' }), at, 0.3)].sort()).not.toEqual([...litSet(frame('wordFlash', BANNER, 1.1, { text: 'GO NOW' }), at, 0.3)].sort());
});

it('Lightning storm: now and then a bolt from the clouds right down to the bottom row', () => {
  const at = SQUARE[0].at as Places;
  let bolts = 0;
  for (let r = 0; r < 20; r += 0.01) {
    const fr = frame('lightningStorm', SQUARE, r), white = fr.flatMap((o, i) => ((o.intensity ?? 0) > 0.95 && o.color!.b > 0.95 ? [at.gy[i]] : []));
    if (white.includes(0) && white.includes(15)) bolts++;
  }
  expect(bolts).toBeGreaterThan(10);
});

it('Rising hearts go up, fading towards the top; Snowfall settles at the bottom and melts at the end of its round', () => {
  const at = SQUARE[0].at as Places;
  // (a heart's lowest point a little later: higher up. Follow the first lane's first heart: its
  // rows as it rises, a round at a time, until it starts again at the bottom)
  const low = (r: number) => Math.min(...frame('risingHearts', SQUARE, r).flatMap((o, i) => ((o.intensity ?? 0) > 0.05 && at.gx[i] < 8 ? [at.gy[i]] : [99])));
  const rises = Array.from({ length: 40 }, (_, k) => low(k * 0.25 + 0.25) - low(k * 0.25)).filter((d) => d > 0 && d < 8).length;
  const falls = Array.from({ length: 40 }, (_, k) => low(k * 0.25 + 0.25) - low(k * 0.25)).filter((d) => d < 0 && d > -3).length;
  expect(rises).toBeGreaterThan(falls * 2);
  // (dimmer near the top than half way up, over many moments)
  let top = 0, nTop = 0, mid = 0, nMid = 0;
  for (let r = 0; r < 30; r += 0.13) frame('risingHearts', SQUARE, r).forEach((o, i) => { const v = o.intensity ?? 0; if (v < 0.05) return; if (at.gy[i] >= 14) { top += v; nTop++; } else if (at.gy[i] >= 6 && at.gy[i] <= 9) { mid += v; nMid++; } });
  expect(top / Math.max(1, nTop)).toBeLessThan(mid / Math.max(1, nMid));
  const bottom = (r: number) => frame('snowfall', SQUARE, r).filter((o, i) => at.gy[i] === 0 && (o.intensity ?? 0) > 0.3).length;
  expect(bottom(0.02)).toBe(0); expect(bottom(0.8)).toBeGreaterThan(12); expect(bottom(0.999)).toBeLessThan(4);
});

it('Beat wipes: a new colour every beat, wiping in from a side', () => {
  const c = (r: number) => JSON.stringify(frame('beatWipes', SQUARE, r)[0].color);
  const shown = new Set([0.9, 1.9, 2.9, 3.9].map(c));
  expect(shown.size).toBeGreaterThan(2);
});
