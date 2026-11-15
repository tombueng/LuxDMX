// The ruler's beat grid and the waveform's path.
import { describe, expect, it } from 'vitest';
import { gridOf, peaksPath } from './ruler';

describe('the beat grid', () => {
  it('zoomed in: a line per beat, every fourth a numbered bar, from the first downbeat', () => {
    const g = gridOf(120, 8, 100, 0.5);          // (a beat is 50 px)
    expect(g[0]).toEqual({ t: 0.5, bar: true, n: 1, label: true });
    expect(g[1]).toMatchObject({ t: 1, bar: false });
    expect(g.filter((x) => x.bar).map((x) => x.n)).toEqual([1, 2, 3, 4]);
    expect(g.at(-1)!.t).toBeLessThanOrEqual(8);
  });
  it('zoomed out: bars only, then every few bars; the numbers only as often as they fit', () => {
    const g = gridOf(120, 600, 2);                // (a bar is 4 px)
    expect(g.every((x) => x.bar)).toBe(true);
    const labelled = g.filter((x) => x.label).map((x) => x.n);
    expect(labelled[1] - labelled[0]).toBeGreaterThan(4);
  });
  it('a tempo that isn\'t one is 120 (a tempo of 0 would never end)', () => {
    expect(gridOf(0, 4, 100).length).toBe(gridOf(120, 4, 100).length);
    expect(gridOf(NaN, 4, 100).length).toBe(gridOf(120, 4, 100).length);
  });
});

describe('the waveform', () => {
  it('a closed path round the peaks, nothing without any', () => {
    expect(peaksPath([], 100)).toBe('');
    expect(peaksPath([0, 1], 100)).toBe('M0 22L25.0 22.0L75.0 2.0L75.0 42.0L25.0 22.0Z');
  });
});
