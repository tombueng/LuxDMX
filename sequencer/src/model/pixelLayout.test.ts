// Where the pixels of a ring and a matrix are, and how a light too big for a universe is laid out.
import { describe, expect, it } from 'vitest';
import { GENERIC, modeOf } from './library';
import { channelAt, cleanLayout, isWide, layoutCells, placesFor, placesOf, ringsFor, sharesChannels, spansOf } from './pixelLayout';
import type { PixelLayout } from './types';

const disc: PixelLayout = { kind: 'rings', rings: [60, 48, 40, 32, 24, 16, 12, 8, 1] };
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 4);

describe('rings', () => {
  const at = placesFor(disc);
  it('the usual 241: rim first, up and clockwise, the last LED in the middle', () => {
    expect(at.n).toBe(241); expect(at.lanes).toBe(9); expect(at.round).toBe(true);
    close(at.rad[0], 1); close(at.ang[0], 0); close(at.x[0], 0); close(at.y[0], 1);
    close(at.ang[15], 0.25); close(at.x[15], 1); close(at.y[15], 0);          // a quarter round: right
    close(at.rad[60], 7 / 8);                                                 // the next ring in
    expect(at.first[0]).toBe(1); expect(at.first[1]).toBe(0); expect(at.first[60]).toBe(1);
    close(at.rad[240], 0); expect(at.lane[240]).toBe(0); expect(at.lane[0]).toBe(8);
  });
  it('wired from the middle: a bigger ring is still further out', () => {
    const p = placesFor({ kind: 'rings', rings: [1, 8, 12] });
    close(p.rad[0], 0); close(p.rad[1], 0.5); close(p.rad[9], 1);
  });
  it('counter-clockwise and turned', () => {
    const p = placesFor({ kind: 'rings', rings: [4, 1], ccw: true }), q = placesFor({ kind: 'rings', rings: [4, 1], turn: 90 });
    close(p.x[1], -1); close(p.y[1], 0);
    close(q.x[0], 1); close(q.y[0], 0);
  });
  it('a lone ring sits part way out, so the effects from the middle have something to show', () => {
    const p = placesFor({ kind: 'rings', rings: [24] });
    close(p.rad[0], 0.72); expect(p.lanes).toBe(1); expect(p.gw).toBe(8);
  });
  it('has a grid wide enough for its widest ring', () => {
    expect(at.gw).toBe(20); expect(Math.max(...at.gx)).toBe(19); expect(Math.min(...at.gx)).toBe(0);
    expect(at.gy[0]).toBe(19);                                                // the top LED: the top row
  });
});

describe('matrices', () => {
  const m = (l: Partial<Extract<PixelLayout, { kind: 'matrix' }>> = {}) => placesFor({ kind: 'matrix', cols: 4, rows: 3, ...l });
  const cell = (p: ReturnType<typeof m>, i: number) => [p.gx[i], p.gy[i]];
  it('from the top left along the rows', () => {
    const p = m();
    expect(cell(p, 0)).toEqual([0, 2]); expect(cell(p, 3)).toEqual([3, 2]); expect(cell(p, 4)).toEqual([0, 1]); expect(cell(p, 11)).toEqual([3, 0]);
    expect(p.first[4]).toBe(1); expect(p.first[5]).toBe(0);
  });
  it('zigzag: every second row runs back', () => {
    const p = m({ zigzag: true });
    expect(cell(p, 3)).toEqual([3, 2]); expect(cell(p, 4)).toEqual([3, 1]); expect(cell(p, 7)).toEqual([0, 1]); expect(cell(p, 8)).toEqual([0, 0]);
  });
  it('along the columns, from another corner', () => {
    const p = m({ vertical: true, from: 'br' });
    expect(cell(p, 0)).toEqual([3, 0]); expect(cell(p, 2)).toEqual([3, 2]); expect(cell(p, 3)).toEqual([2, 0]);
  });
  it('the longer side fills -1..1, the shape stays true, the corner is furthest out', () => {
    const p = placesFor({ kind: 'matrix', cols: 32, rows: 8, zigzag: true, vertical: true });
    close(Math.max(...p.x), 1); close(Math.min(...p.x), -1); close(Math.max(...p.y), 7 / 31);
    close(Math.max(...p.rad), 1);
  });
});

describe('over several universes', () => {
  const type = (id: string) => modeOf(GENERIC.find((t) => t.id === id), '');
  it('170 RGB pixels a universe, the way a box reads it', () => {
    const m = type('gen-disc241')!;
    expect(isWide(m)).toBe(true);
    expect(spansOf({ universe: 10, address: 1 }, m)).toEqual([
      { universe: 10, at: 0, from: 0, count: 510 }, { universe: 11, at: 0, from: 510, count: 213 },
    ]);
    expect(channelAt({ universe: 10, address: 1 }, m, 509)).toEqual({ universe: 10, at: 509 });
    expect(channelAt({ universe: 10, address: 1 }, m, 510)).toEqual({ universe: 11, at: 0 });
  });
  it('128 RGBW pixels a universe', () => {
    const m = { name: 'x', channels: Array.from({ length: 800 }, (_, i) => ({ name: '', attr: 'red' as const, cell: Math.floor(i / 4) })) };
    expect(spansOf({ universe: 0, address: 1 }, m).map((s) => s.count)).toEqual([512, 288]);
  });
  it('starting further up: whole pixels on the first universe too', () => {
    const m = type('gen-disc241')!;
    expect(spansOf({ universe: 0, address: 101 }, m)[0]).toEqual({ universe: 0, at: 100, from: 0, count: 411 });
  });
  it('a light that fits stays on its universe, even running past its end (as before: a mistake to point out)', () => {
    const m = type('gen-strip170')!;
    expect(spansOf({ universe: 3, address: 100 }, m)).toEqual([{ universe: 3, at: 99, from: 0, count: 510 }]);
  });
  it('knows who shares channels', () => {
    const m = type('gen-disc241')!, par = { name: 'p', channels: [{ name: 'r', attr: 'red' as const }] };
    expect(sharesChannels({ universe: 10, address: 1 }, m, { universe: 11, address: 200 }, par)).toBe(true);
    expect(sharesChannels({ universe: 10, address: 1 }, m, { universe: 11, address: 214 }, par)).toBe(false);
    expect(sharesChannels({ universe: 10, address: 1 }, m, { universe: 12, address: 1 }, par)).toBe(false);
  });
});

describe('the library and files', () => {
  it('every ring and matrix in the library has a shape that fits its pixels', () => {
    const shaped = GENERIC.filter((t) => t.modes[0].layout);
    expect(shaped.length).toBeGreaterThanOrEqual(10);
    for (const t of shaped) expect(placesOf(t.modes[0])?.n, t.id).toBe(layoutCells(t.modes[0].layout!));
    expect(GENERIC.find((t) => t.id === 'gen-disc241')!.modes[0].channels).toHaveLength(723);
    // (432 channels: a 144 fits one universe)
    expect(GENERIC.find((t) => t.id === 'gen-disc144')!.modes[0].channels).toHaveLength(432);
    expect(GENERIC.find((t) => t.id === 'gen-disc144')!.modes[0].layout).toEqual({ kind: 'rings', rings: ringsFor(144, 9) });
  });
  it('the 16 x 16 is wired like the real panel: up and down its columns from the bottom right', () => {
    const at = placesOf(GENERIC.find((t) => t.id === 'gen-matrix16x16')!.modes[0])!;
    expect([at.gx[0], at.gy[0]]).toEqual([15, 0]);        // the first LED: bottom right
    expect([at.gx[1], at.gy[1]]).toEqual([15, 1]);        // going up
    expect([at.gx[16], at.gy[16]]).toEqual([14, 15]);     // the next column: down from the top
    expect([at.gx[255], at.gy[255]]).toEqual([0, 0]);     // the last: bottom left
  });
  it('a shape that doesn\'t fit counts for nothing', () => {
    expect(placesOf({ name: 'x', channels: [{ name: '', attr: 'red', cell: 0 }], layout: disc })).toBeUndefined();
  });
  it('reads what it can from a file', () => {
    expect(cleanLayout({ kind: 'rings', rings: [8, 1], ccw: true, odd: 1 }, 9)).toEqual({ kind: 'rings', rings: [8, 1], ccw: true });
    expect(cleanLayout({ kind: 'matrix', cols: 2, rows: 2, zigzag: 'yes', from: 'nowhere' }, 4)).toEqual({ kind: 'matrix', cols: 2, rows: 2 });
    for (const bad of [null, 7, {}, { kind: 'star' }, { kind: 'rings', rings: [] }, { kind: 'rings', rings: [1.5] }, { kind: 'rings', rings: [8] }, { kind: 'matrix', cols: 2, rows: -2 }, { kind: 'matrix', cols: 3, rows: 3 }])
      expect(cleanLayout(bad, 4), JSON.stringify(bad)).toBeUndefined();
  });
  it('makes likely rings from a total', () => {
    expect(ringsFor(144, 9).reduce((a, b) => a + b, 0)).toBe(144);
    expect(ringsFor(144, 9)).toHaveLength(9); expect(ringsFor(144, 9).at(-1)).toBe(1); expect(ringsFor(144, 9)[0]).toBeGreaterThan(ringsFor(144, 9)[1]);
    expect(ringsFor(24, 1)).toEqual([24]);
    expect(ringsFor(3, 9)).toEqual([3]);
  });
});
