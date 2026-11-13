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
});
