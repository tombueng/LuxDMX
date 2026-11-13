import { describe, expect, it } from 'vitest';
import { placeNew, ROOM, type Spot } from './place';

const gap = (a: Spot, b: Spot) => Math.hypot((a.x - b.x) * 1.6, a.y - b.y);
const nearest = (p: Spot, others: Spot[]) => Math.min(...others.map((o) => gap(p, o)));

describe('where new lights go on the plan', () => {
  it('an empty stage: a row across the middle, evenly spread', () => {
    expect(placeNew([], 3)).toEqual([{ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.75, y: 0.5 }]);
  });
  it('a row in the middle taken: the next row with room', () => {
    const there = [0.2, 0.4, 0.6, 0.8].map((x) => ({ x, y: 0.5 }));
    const got = placeNew(there, 2);
    expect(new Set(got.map((p) => p.y))).toEqual(new Set([0.35]));
  });
  it('a crowded stage (a light every 0.1 in a grid with gaps): each on a free spot, clear of the rest and of each other, named left to right', () => {
    const there: Spot[] = [];
    for (let x = 0.1; x < 0.95; x += 0.1) for (let y = 0.1; y < 0.95; y += 0.2) there.push({ x, y });
    const got = placeNew(there, 4);
    expect(got).toHaveLength(4);
    for (const p of got) expect(nearest(p, there)).toBeGreaterThanOrEqual(ROOM * 0.8);
    for (let i = 0; i < got.length; i++) expect(nearest(got[i], got.filter((_, j) => j !== i))).toBeGreaterThanOrEqual(ROOM * 0.8);
    expect(got.map((p) => p.x)).toEqual([...got.map((p) => p.x)].sort((a, b) => a - b));
  });
  it('more than fit in a row: spread out, not on top of each other', () => {
    const got = placeNew([], 20);
    for (let i = 0; i < got.length; i++) expect(nearest(got[i], got.filter((_, j) => j !== i))).toBeGreaterThan(0.08);
  });
  // (the way it was: every spot against every light, each time; the same answers, just slow)
  function before(there: Spot[], count: number): Spot[] {
    const placed: Spot[] = [], all = [...there];
    for (let i = 0; i < count; i++) {
      let best: Spot = { x: 0.5, y: 0.5 }, score = -Infinity;
      for (let x = 0.05; x <= 0.951; x += 0.025)
        for (let y = 0.08; y <= 0.921; y += 0.03) {
          const p = { x, y }, r = Math.min(1, ...all.map((f) => gap(f, p)));
          const s = Math.min(r, ROOM * 1.5) - Math.abs(x - 0.5) * 0.02 - Math.abs(y - 0.5) * 0.01;
          if (s > score) { score = s; best = p; }
        }
      placed.push(best); all.push(best);
    }
    return placed.sort((a, b) => a.x - b.x || a.y - b.y).map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
  }
  it('lands them where it always did, on stages full and empty', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [n, count] of [[0, 20], [5, 14], [30, 25], [80, 40], [150, 13]]) {
      const there = Array.from({ length: n }, () => ({ x: rnd(), y: rnd() }));
      expect(placeNew(there, count)).toEqual(before(there, count));
    }
  });
  it('a big rig gets 200 more without the page freezing (it took 12 s)', () => {
    const there = placeNew([], 175);
    const t = performance.now();
    expect(placeNew(there, 200)).toHaveLength(200);
    expect(performance.now() - t).toBeLessThan(1500);
    // and thousands of lights don't throw (Math.min over a spread of 100k distances did)
    expect(placeNew(Array.from({ length: 3000 }, (_, i) => ({ x: (i % 60) / 60, y: Math.floor(i / 60) / 50 })), 10)).toHaveLength(10);
  });
});
