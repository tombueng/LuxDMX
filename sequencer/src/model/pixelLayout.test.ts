// Where the pixels of a ring and a matrix are, and how a light too big for a universe is laid out.
import { describe, expect, it } from 'vitest';
import { GENERIC, modeOf } from './library';
import { channelAt, cleanLayout, fitLayout, insideOut, isWide, layoutCells, layoutOfLight, layoutWords, matrixWirings, mirrorLayout, placesFor, placesOf, placesOfLight, ringsFor, sharesChannels, spansOf, testPicture, turnLayout } from './pixelLayout';
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

// ---------------------------------------------------------------- a light's own wiring
// (column, row from the bottom) of every LED, in data order
const cellsAt = (l: PixelLayout) => { const p = placesFor(l); return Array.from({ length: p.n }, (_, i) => `${p.gx[i]},${p.gy[i]}`); };
const real: PixelLayout = { kind: 'matrix', cols: 16, rows: 16, zigzag: true, vertical: true, from: 'br' };

describe("a light's own wiring", () => {
  it('a light can have its own layout with the same number of pixels, else it has its type\'s', () => {
    const m = modeOf(GENERIC.find((t) => t.id === 'gen-matrix16x16'), '')!;
    const own: PixelLayout = { kind: 'matrix', cols: 16, rows: 16 };
    expect(layoutOfLight({ layout: own }, m)).toBe(own);
    expect(placesOfLight({ layout: own }, m)).toBe(placesFor(own));
    expect(layoutOfLight({}, m)).toBe(m.layout);
    expect(layoutOfLight({ layout: { kind: 'matrix', cols: 8, rows: 8 } }, m)).toBe(m.layout);   // 64 pixels don't fit 256
    expect(placesOfLight({ layout: own }, undefined)).toBeUndefined();
  });
  it('turning a matrix four times, or mirroring it twice, gives back the same wiring', () => {
    for (const l of matrixWirings(16, 16)) {
      expect(turnLayout(turnLayout(turnLayout(turnLayout(l))))).toEqual(l);
      expect(mirrorLayout(mirrorLayout(l, 'x'), 'x')).toEqual(l);
      expect(mirrorLayout(mirrorLayout(l, 'y'), 'y')).toEqual(l);
      expect(turnLayout(turnLayout(l))).toEqual(mirrorLayout(mirrorLayout(l, 'x'), 'y'));   // half a turn is both mirrors
    }
  });
  it('turned clockwise: what was in the top left is in the top right, a wide panel stands up', () => {
    const l: PixelLayout = { kind: 'matrix', cols: 8, rows: 4, zigzag: true };   // the first LED top left, along the rows
    const t = turnLayout(l) as Extract<PixelLayout, { kind: 'matrix' }>;
    expect([t.cols, t.rows]).toEqual([4, 8]);
    const p = placesFor(t);
    expect([p.gx[0], p.gy[0]]).toEqual([3, 7]);    // top right
    expect([p.gx[1], p.gy[1]]).toEqual([3, 6]);    // and down from there
  });
  it('mirrored left to right: the first LED goes to the other side, the rows stay', () => {
    const p = placesFor(mirrorLayout(real, 'x'));
    expect([p.gx[0], p.gy[0]]).toEqual([0, 0]); expect([p.gx[1], p.gy[1]]).toEqual([0, 1]);
    expect(layoutWords(mirrorLayout(real, 'x'))).toBe('Starts bottom left, runs along the columns, zigzag');
  });
  it('found on the real panel: red, green and blue where they lit give back its wiring, from any wrong guess', () => {
    const want = cellsAt(real), truth = placesFor(real);
    for (const guess of matrixWirings(16, 16)) {
      // the LEDs of the picture (drawn with the guess) that sit where the real first, second and last are
      const g = cellsAt(guess), pick = (i: number) => g.indexOf(`${truth.gx[i]},${truth.gy[i]}`);
      const fit = fitLayout(guess, pick(0), pick(1), pick(255))!;
      expect(cellsAt(fit)).toEqual(want);
    }
    // three LEDs that no wiring puts there
    expect(fitLayout(real, 0, 100, 255)).toBeUndefined();
  });
  it('a ring: turned, mirrored and inside out, and found from three LEDs', () => {
    const r = turnLayout(disc, 90) as Extract<PixelLayout, { kind: 'rings' }>;
    expect(r.turn).toBe(90);
    close(placesFor(r).ang[0], 0.25);
    expect(turnLayout(r, 270)).toEqual(disc);
    const m = mirrorLayout(r, 'x');
    expect(m).toEqual({ kind: 'rings', rings: disc.rings, ccw: true, turn: -90 });
    close(placesFor(m).x[0], -placesFor(r).x[0]); close(placesFor(m).x[5], -placesFor(r).x[5]); close(placesFor(m).y[5], placesFor(r).y[5]);
    const v = mirrorLayout(disc, 'y');
    close(placesFor(v).y[3], -placesFor(disc).y[3]); close(placesFor(v).x[3], placesFor(disc).x[3]);
    expect(insideOut(disc as Extract<PixelLayout, { kind: 'rings' }>).rings[0]).toBe(1);
    // the real one runs counter-clockwise from 3 o'clock, starting in the middle
    const truth: PixelLayout = { kind: 'rings', rings: [...(disc as { rings: number[] }).rings].reverse(), ccw: true, turn: 90 };
    const tp = placesFor(truth), dp = placesFor(disc);
    const nearest = (x: number, y: number) => { let b = 0; for (let i = 1; i < dp.n; i++) if (Math.hypot(dp.x[i] - x, dp.y[i] - y) < Math.hypot(dp.x[b] - x, dp.y[b] - y)) b = i; return b; };
    const fit = fitLayout(disc, nearest(tp.x[0], tp.y[0]), nearest(tp.x[1], tp.y[1]), nearest(tp.x[240], tp.y[240]))!;
    expect(fit).toEqual(truth);
    expect(layoutWords(fit)).toBe('Starts in the middle, runs counter-clockwise, the first LED turned 90°');
  });
  it('a light\'s own layout from a file: any size is kept, a broken one is not', () => {
    expect(cleanLayout({ kind: 'matrix', cols: 16, rows: 16, from: 'br', vertical: true, zigzag: true })).toEqual(real);
    expect(cleanLayout({ kind: 'matrix', cols: 0, rows: 16 })).toBeUndefined();
    expect(cleanLayout({ kind: 'matrix', cols: 4, rows: 4 }, 20)).toBeUndefined();
  });
});

describe('the test picture', () => {
  it('a matrix: four corners in four colours and an F that reads the right way round', () => {
    const at = placesFor({ kind: 'matrix', cols: 16, rows: 16 }), pic = testPicture(at);
    const px = (x: number, y: number) => pic[[...Array(at.n).keys()].find((i) => at.gx[i] === x && at.gy[i] === y)!];
    expect(px(0, 15)).toEqual([1, 0, 0]); expect(px(15, 15)).toEqual([0, 1, 0]);
    expect(px(0, 0)).toEqual([0, 0.35, 1]); expect(px(15, 0)).toEqual([1, 0.85, 0]);
    const lit = (x: number, y: number) => px(x, y).join() === '1,1,1';
    expect(lit(1, 8)).toBe(true);                       // the stem, on the left
    expect(lit(14, 8)).toBe(false);
    expect(lit(13, 14)).toBe(true);                     // the top bar reaches right
    expect(lit(13, 2)).toBe(false);                     // nothing at the bottom right
    // whatever way it's wired, the picture is the same on the LEDs (it's drawn where they are)
    const a = placesFor(real), pa = testPicture(a);
    for (let i = 0; i < a.n; i += 17) expect(pa[i]).toEqual(px(a.gx[i], a.gy[i]));
  });
  it('a disc: red at the top, green on the right, an arrow pointing up', () => {
    const at = placesFor(disc), pic = testPicture(at);
    expect(pic[0]).toEqual([1, 0, 0]);                  // the first LED is the top of the rim
    expect(pic[15]).toEqual([0, 1, 0]);                 // a quarter round the 60: 3 o'clock
    expect(pic[30].join()).toBe('0,0,0');               // the bottom of the rim stays dark
    expect(pic[240]).toEqual([1, 1, 1]);                // the middle
    const up = [...Array(at.n).keys()].filter((i) => pic[i].join() === '1,1,1' && at.y[i] > 0.3).length;
    const down = [...Array(at.n).keys()].filter((i) => pic[i].join() === '1,1,1' && at.y[i] < -0.3).length;
    expect(up).toBeGreaterThan(down);                   // the head is at the top
  });
});
