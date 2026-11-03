// The crowd's sound: what the crowd does at any moment comes from its track (moods that change over
// a time, cheers that swell and die away), the same whether played into or jumped to; the sounds
// are made here, the same every time, loops without a seam, and no clapping in them.
import { describe, expect, it } from 'vitest';
import { cheerEnv, crowdAt, loudness } from './crowd';
import { kitSteps, LOOP_RMS, makeKit, rng } from './crowdKit';
import type { CrowdItem } from '../model/timeline';

const mood = (id: string, at: number, m: 'chatter' | 'cheer', level: number, len?: number): CrowdItem => ({ id, at, do: { do: 'crowd', mood: m, level }, ...(len !== undefined ? { len } : {}) });
const cheer = (id: string, at: number, level: number, len = 4): CrowdItem => ({ id, at, do: { do: 'cheer', level }, len });

describe('what the crowd does', () => {
  const track = [mood('a', -30, 'chatter', 0.5), mood('b', -20, 'cheer', 0.6, 4), cheer('c', -20, 1, 5), mood('d', -10, 'cheer', 0.3, 2), mood('e', 0, 'cheer', 1, 1), mood('f', 10, 'cheer', 0, 10)];
  it('quiet with no track, and before its first moment', () => {
    expect(crowdAt(undefined, 5)).toEqual({ chatter: 0, cheer: 0, swell: 0 });
    expect(loudness(crowdAt(track, -31))).toBe(0);
  });
  it('a mood holds; a change takes its time, from wherever the crowd was', () => {
    expect(crowdAt(track, -25)).toMatchObject({ chatter: 0.5, cheer: 0 });
    const half = crowdAt(track, -18);                                       // half way from chatting to cheering
    expect(half.chatter).toBeCloseTo(0.25, 6); expect(half.cheer).toBeCloseTo(0.3, 6);
    expect(crowdAt(track, -12)).toMatchObject({ chatter: 0, cheer: 0.6 });
    expect(crowdAt(track, -9).cheer).toBeCloseTo(0.45, 6);                 // half way down to 0.3
    expect(crowdAt(track, -5)).toMatchObject({ chatter: 0, cheer: 0.3 });
    // a change in the middle of another goes on from where that one had got to
    const mid = crowdAt([mood('x', 0, 'cheer', 1, 10), mood('y', 5, 'cheer', 0, 5)], 7.5);
    expect(mid.cheer).toBeCloseTo(0.25, 6);                                 // (0.5 at 5 s, half way to 0)
    expect(crowdAt(track, 20).cheer).toBe(0);
  });
  it('a cheer swells up quickly and dies away by its end; the biggest one going counts', () => {
    expect(cheerEnv(0, 4)).toBe(0); expect(cheerEnv(0.35, 4)).toBeCloseTo(1, 6); expect(cheerEnv(4, 4)).toBe(0); expect(cheerEnv(-1, 4)).toBe(0);
    expect(cheerEnv(2, 4)).toBeGreaterThan(cheerEnv(3, 4));
    expect(crowdAt(track, -19.65).swell).toBeCloseTo(1, 6);
    expect(crowdAt(track, -14.9).swell).toBe(0);
    expect(crowdAt([cheer('p', 0, 0.4), cheer('q', 0.1, 0.9)], 1).swell).toBeCloseTo(0.9 * cheerEnv(0.9, 4), 6);
  });
  it('louder as they get going; the order of the track as a file has it does not matter', () => {
    const lv = (t: number) => loudness(crowdAt(track, t));
    expect(lv(-25)).toBeLessThan(lv(-19.6));
    expect(lv(0.5)).toBeGreaterThan(lv(-1));
    expect(lv(-19.6)).toBeLessThanOrEqual(1);
    expect(crowdAt([...track].reverse(), -5)).toEqual(crowdAt(track, -5));
  });
});

describe('the sounds', () => {
  const RATE = 8000;
  const kit = makeKit(RATE);
  const rms = (xs: Float32Array[]) => { let s = 0, n = 0; for (const x of xs) { for (const v of x) s += v * v; n += x.length; } return Math.sqrt(s / n); };
  it('the same every time (seeded), finite, never clipping', () => {
    const again = makeKit(RATE);
    expect(again.roar[0].slice(0, 2000)).toEqual(kit.roar[0].slice(0, 2000));
    let bad = 0, peak = 0;
    for (const xs of [kit.chatter, kit.roar, kit.woos, kit.whistles]) for (const x of xs) for (const v of x) { if (!Number.isFinite(v)) bad++; else peak = Math.max(peak, Math.abs(v)); }
    expect(bad).toBe(0); expect(peak).toBeLessThanOrEqual(1); expect(peak).toBeGreaterThan(0.3);
    expect(rng(3)()).toBe(rng(3)());
  });
  it('the loops as loud as the player expects, and without a click where they start over', () => {
    for (const k of ['chatter', 'roar'] as const) {
      expect(rms(kit[k]), k).toBeCloseTo(LOOP_RMS[k], 3);
      for (const x of kit[k]) {
        // the jump from the last sample to the first is no bigger than the steps inside the loop
        let step = 0;
        for (let i = 1; i < x.length; i++) step += Math.abs(x[i] - x[i - 1]);
        expect(Math.abs(x[0] - x[x.length - 1]), k).toBeLessThan((step / (x.length - 1)) * 6);
      }
    }
  });
  it('no applause, no clapping: the kit has neither', () => {
    expect(Object.keys(kit).sort()).toEqual(['chatter', 'rate', 'roar', 'whistles', 'woos']);
  });
  it('people talking sound like voices: most of it between 150 Hz and 3 kHz', () => {
    // (energy through a crude band split: a long moving average for the lows, the rest for the highs)
    const x = kit.chatter[0], n = x.length;
    let low = 0, mid = 0, high = 0, a1 = 0, a2 = 0;
    for (let i = 0; i < n; i++) { a1 += (x[i] - a1) * 0.11; a2 += (x[i] - a2) * 0.6; low += a1 * a1; mid += (a2 - a1) ** 2; high += (x[i] - a2) ** 2; }
    expect(mid).toBeGreaterThan(high);
    expect(mid + low).toBeGreaterThan(high * 3);
  });
  it('made a step at a time, every step short (a page without a worker makes it in slices)', () => {
    const g = kitSteps(RATE);
    let steps = 0, worst = 0;
    for (;;) { const t0 = performance.now(); const r = g.next(); worst = Math.max(worst, performance.now() - t0); steps++; if (r.done) break; }
    expect(steps).toBeGreaterThan(40);
    expect(worst).toBeLessThan(250);                // (8 kHz on a test runner; the worker does it all at once anyway)
  });
});
