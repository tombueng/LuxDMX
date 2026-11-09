// Rings, discs and matrices: where each pixel is, and how a light too big for one universe is laid
// over several. Pure, and worked out once per mode (a fixture type is never edited in place).
import type { FixtureMode, PixelLayout } from './types';

type Matrix = Extract<PixelLayout, { kind: 'matrix' }>;
type Rings = Extract<PixelLayout, { kind: 'rings' }>;

export interface Places {
  n: number;
  round: boolean;       // a ring or a disc
  dot: number;          // how far a LED reaches round its place, on the same scale as x and y
  x: Float32Array;      // -1..1 left to right: the longer side fills it, the shape stays true
  y: Float32Array;      // -1..1 bottom to top
  rad: Float32Array;    // 0 in the middle, 1 at the pixel furthest out (a lone ring: part way out)
  ang: Float32Array;    // 0..1 clockwise from straight up
  lane: Uint16Array;    // ring (from the middle) or row (from the bottom)
  lanes: number;
  gx: Uint16Array;      // on a grid (a disc too, its width in LEDs): column
  gy: Uint16Array;      // row from the bottom
  gw: number;
  gh: number;
  first: Uint8Array;    // 1 on the first LED of a ring or of a run along the matrix
}

export const layoutCells = (l: PixelLayout) => (l.kind === 'rings' ? l.rings.reduce((a, b) => a + b, 0) : l.cols * l.rows);

const TAU = Math.PI * 2;
const LONE_RING = 0.72;
const frac = (v: number) => v - Math.floor(v);

function ringPlaces(l: Rings): Places {
  const n = layoutCells(l), m = l.rings.length;
  // a bigger ring is further out; the steps between rings are even, as on the real boards
  const rank = l.rings.map((_, i) => i).sort((a, b) => l.rings[a] - l.rings[b] || a - b);
  const hasCentre = m > 1 && l.rings[rank[0]] === 1;
  const stepOf = new Map(rank.map((ring, k) => [ring, k]));
  const out = blank(n, true, m), turn = (l.turn ?? 0) / 360;
  const widest = Math.max(...l.rings);
  out.gw = out.gh = Math.max(5, Math.ceil(widest / Math.PI));
  out.dot = m > 1 ? 0.42 / Math.max(1, m - (hasCentre ? 1 : 0)) : Math.min(0.42, Math.PI / Math.max(3, widest) * 0.75);
  let c = 0;
  l.rings.forEach((size, i) => {
    // (a lone ring sits part way out: what works from the middle outwards has something to show on it)
    const k = stepOf.get(i)!, rad = m === 1 ? LONE_RING : hasCentre ? k / (m - 1) : (k + 1) / m;
    for (let j = 0; j < size; j++, c++) {
      const a = frac((l.ccw ? -j : j) / size + turn);
      out.rad[c] = rad; out.ang[c] = a; out.lane[c] = k; out.first[c] = j === 0 ? 1 : 0;
      out.x[c] = rad * Math.sin(TAU * a); out.y[c] = rad * Math.cos(TAU * a);
      out.gx[c] = Math.round((out.x[c] + 1) / 2 * (out.gw - 1));
      out.gy[c] = Math.round((out.y[c] + 1) / 2 * (out.gh - 1));
    }
  });
  return out;
}

function matrixPlaces(l: Matrix): Places {
  const { cols, rows } = l, n = cols * rows, big = Math.max(cols, rows), from = l.from ?? 'tl';
  const out = blank(n, false, rows);
  out.gw = cols; out.gh = rows;
  out.dot = big > 1 ? 0.84 / (big - 1) : 0.8;
  const run = l.vertical ? rows : cols;
  const scale = big > 1 ? 2 / (big - 1) : 0;
  const far = Math.hypot(cols - 1, rows - 1) / 2 * scale || 1;
  for (let c = 0; c < n; c++) {
    const line = Math.floor(c / run);
    let along = c % run;
    if (l.zigzag && line % 2 === 1) along = run - 1 - along;
    let col = l.vertical ? line : along, down = l.vertical ? along : line;
    if (from === 'tr' || from === 'br') col = cols - 1 - col;
    if (from === 'bl' || from === 'br') down = rows - 1 - down;
    const up = rows - 1 - down;
    out.gx[c] = col; out.gy[c] = up; out.lane[c] = up; out.first[c] = c % run === 0 ? 1 : 0;
    const x = (col - (cols - 1) / 2) * scale, y = (up - (rows - 1) / 2) * scale;
    out.x[c] = x; out.y[c] = y;
    out.rad[c] = Math.hypot(x, y) / far;
    out.ang[c] = frac(Math.atan2(x, y) / TAU);
  }
  return out;
}

function blank(n: number, round: boolean, lanes: number): Places {
  return {
    n, round, dot: 0.1, lanes, gw: 1, gh: 1,
    x: new Float32Array(n), y: new Float32Array(n), rad: new Float32Array(n), ang: new Float32Array(n),
    lane: new Uint16Array(n), gx: new Uint16Array(n), gy: new Uint16Array(n), first: new Uint8Array(n),
  };
}

const byLayout = new WeakMap<PixelLayout, Places>();
export function placesFor(l: PixelLayout): Places {
  let p = byLayout.get(l);
  if (!p) { p = l.kind === 'rings' ? ringPlaces(l) : matrixPlaces(l); byLayout.set(l, p); }
  return p;
}
// A mode's places, if it has a shape and the shape fits its pixels (format.ts checks files too).
const byMode = new WeakMap<FixtureMode, { p: Places | undefined }>();
export function placesOf(m: FixtureMode | undefined): Places | undefined {
  if (!m?.layout) return undefined;
  let e = byMode.get(m);
  if (!e) {
    const cells = m.channels.reduce((a, c) => Math.max(a, (c.cell ?? -1) + 1), 0);
    e = { p: layoutCells(m.layout) === cells ? placesFor(m.layout) : undefined };
    byMode.set(m, e);
  }
  return e.p;
}

const count = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
export const MAX_PIXELS = 4096;
// A shape read from a file: mended where it's only a detail, undefined when it can't be used.
// (no `cells`: any size, for a light's own layout, which only counts when it fits its type's pixels)
export function cleanLayout(v: unknown, cells?: number): PixelLayout | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const l = v as Record<string, unknown>;
  if (l.kind === 'rings') {
    if (!Array.isArray(l.rings) || !l.rings.length || !l.rings.every((r) => count(r, 1, MAX_PIXELS))) return undefined;
    const out: PixelLayout = { kind: 'rings', rings: l.rings as number[] };
    if (l.ccw === true) out.ccw = true;
    if (typeof l.turn === 'number' && Number.isFinite(l.turn) && l.turn !== 0) out.turn = l.turn;
    return cells === undefined || layoutCells(out) === cells ? out : undefined;
  }
  if (l.kind === 'matrix') {
    if (!count(l.cols, 1, MAX_PIXELS) || !count(l.rows, 1, MAX_PIXELS)) return undefined;
    const out: PixelLayout = { kind: 'matrix', cols: l.cols as number, rows: l.rows as number };
    if (l.zigzag === true) out.zigzag = true;
    if (l.vertical === true) out.vertical = true;
    if (l.from === 'tr' || l.from === 'bl' || l.from === 'br') out.from = l.from;
    return cells === undefined || layoutCells(out) === cells ? out : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------- a light's own wiring
// Two of the same panel can be wired or hung differently: a light can have its own layout, with the
// same number of pixels as its type's. Turning and mirroring work on what you see from the front.

// The layout a light really has: its own when that fits its type's pixels, else its type's.
export function layoutOfLight(f: { layout?: PixelLayout }, m: FixtureMode | undefined): PixelLayout | undefined {
  const base = placesOf(m);
  if (!base) return undefined;
  return f.layout && layoutCells(f.layout) === base.n ? f.layout : m!.layout;
}
export function placesOfLight(f: { layout?: PixelLayout }, m: FixtureMode | undefined): Places | undefined {
  const base = placesOf(m);
  return base && f.layout && layoutCells(f.layout) === base.n ? placesFor(f.layout) : base;
}

const CORNERS = ['tl', 'tr', 'bl', 'br'] as const;
const tidyMatrix = (l: Matrix): Matrix => {
  const out: Matrix = { kind: 'matrix', cols: l.cols, rows: l.rows };
  if (l.zigzag) out.zigzag = true;
  if (l.vertical) out.vertical = true;
  if (l.from && l.from !== 'tl') out.from = l.from;
  return out;
};
const tidyRings = (l: Rings): Rings => {
  const out: Rings = { kind: 'rings', rings: [...l.rings] };
  if (l.ccw) out.ccw = true;
  const turn = Math.round(((((l.turn ?? 0) % 360) + 540) % 360 - 180) * 100) / 100;
  if (turn) out.turn = turn === -180 ? 180 : turn;
  return out;
};
// Every way a cols x rows panel can be wired: each corner, along the rows or the columns, zigzag or not.
export function matrixWirings(cols: number, rows: number): Matrix[] {
  const out: Matrix[] = [];
  for (const from of CORNERS) for (const vertical of [false, true]) for (const zigzag of [true, false])
    out.push(tidyMatrix({ kind: 'matrix', cols, rows, from, vertical, zigzag }));
  return out;
}
// The wiring that puts every LED where `to` says (column, row from the bottom), if there is one.
function matrixWhere(cols: number, rows: number, zigzag: boolean, to: (i: number) => [number, number]): Matrix | undefined {
  const fits = (l: Matrix) => { const p = placesFor(l); for (let i = 0; i < p.n; i++) { const [x, y] = to(i); if (p.gx[i] !== x || p.gy[i] !== y) return false; } return true; };
  const all = matrixWirings(cols, rows);
  return all.find((l) => !!l.zigzag === zigzag && fits(l)) ?? all.find(fits);
}

// Turned clockwise by 90 degrees (a matrix) or by `deg` (a ring), as seen from the front.
export function turnLayout(l: PixelLayout, deg = 90): PixelLayout {
  if (l.kind === 'rings') return tidyRings({ ...l, turn: (l.turn ?? 0) + deg });
  let out: Matrix = l;
  for (let k = 0; k < (((Math.round(deg / 90) % 4) + 4) % 4); k++) {
    const p = placesFor(out), { cols } = out;
    out = matrixWhere(out.rows, out.cols, !!out.zigzag, (i) => [p.gy[i], cols - 1 - p.gx[i]]) ?? out;
  }
  return out === l ? l : out;
}
// Mirrored left to right ('x') or top to bottom ('y'), as seen from the front.
export function mirrorLayout(l: PixelLayout, axis: 'x' | 'y'): PixelLayout {
  if (l.kind === 'rings') return tidyRings({ ...l, ccw: !l.ccw, turn: axis === 'x' ? -(l.turn ?? 0) : 180 - (l.turn ?? 0) });
  const p = placesFor(l), { cols, rows } = l;
  return matrixWhere(cols, rows, !!l.zigzag, (i) => (axis === 'x' ? [cols - 1 - p.gx[i], p.gy[i]] : [p.gx[i], rows - 1 - p.gy[i]])) ?? l;
}
// A disc whose data starts in the middle instead of at the rim (or the other way round).
export const insideOut = (l: Rings): Rings => tidyRings({ ...l, rings: [...l.rings].reverse() });

// Where the data really runs, from three LEDs someone found on the real thing: which LED of the
// picture lit up as the first (`first`), the second and the last. The picture is `l` as it is now.
// Undefined when no wiring puts them there.
export function fitLayout(l: PixelLayout, first: number, second: number, last: number): PixelLayout | undefined {
  const now = placesFor(l), n = now.n;
  if (n < 2) return l;
  if (l.kind === 'matrix') {
    const at = (i: number) => [now.gx[i], now.gy[i]];
    const want = [at(first), at(second), at(last)], idx = [0, 1, n - 1];
    const ok = matrixWirings(l.cols, l.rows).filter((c) => { const p = placesFor(c); return idx.every((i, k) => p.gx[i] === want[k][0] && p.gy[i] === want[k][1]); });
    return ok.find((c) => !!c.zigzag === !!l.zigzag) ?? ok[0];
  }
  // a ring or a disc: which end the data starts at, which way it runs, and where the first LED is
  const pts = [first, second, last].map((i) => [now.x[i], now.y[i]]);
  let best: { l: Rings; d: number } | undefined;
  for (const rings of [l.rings, [...l.rings].reverse()]) for (const ccw of [false, true]) {
    const flat: Rings = { kind: 'rings', rings, ccw }, p = placesFor(flat);
    // turned so the first LED of a ring with more than one lands on the LED that was found for it
    const lead = rings[0] > 1 ? 0 : 1, want = pts[lead === 0 ? 0 : 1];
    const turn = (Math.atan2(want[0], want[1]) - Math.atan2(p.x[lead], p.y[lead])) * 180 / Math.PI;
    const c = tidyRings({ ...flat, turn: Math.round(turn) }), q = placesFor(c);
    const d = [0, 1, n - 1].reduce((s, i, k) => s + Math.hypot(q.x[i] - pts[k][0], q.y[i] - pts[k][1]), 0);
    if (!best || d < best.d - 1e-6) best = { l: c, d };
  }
  // (each LED is within about one LED's width of where it was found)
  return best && best.d < 3 * Math.max(now.dot * 2.5, 0.05) ? best.l : undefined;
}

// What a layout says, in words: where the data starts and how it runs.
export function layoutWords(l: PixelLayout): string {
  if (l.kind === 'rings') {
    const where = l.rings.length > 1 ? (l.rings[0] >= l.rings[l.rings.length - 1] ? 'at the rim' : 'in the middle') : '';
    const turn = l.turn ? `, the first LED turned ${l.turn}°` : ', the first LED at the top';
    const runs = `runs ${l.ccw ? 'counter-clockwise' : 'clockwise'}${turn}`;
    return where ? `Starts ${where}, ${runs}` : runs[0].toUpperCase() + runs.slice(1);
  }
  const corner = { tl: 'top left', tr: 'top right', bl: 'bottom left', br: 'bottom right' }[l.from ?? 'tl'];
  return `Starts ${corner}, runs along the ${l.vertical ? 'columns' : 'rows'}${l.zigzag ? ', zigzag' : ''}`;
}

// The test picture on a ring or a matrix, per LED as [r, g, b] (0..1): it shows at a glance whether
// the real one is turned or mirrored. A matrix gets an F (it looks wrong whichever way it's off)
// and its four corners in four colours; a ring an arrow pointing up, red at 12 and green at 3 o'clock.
export const TEST_COLOURS = { tl: [1, 0, 0], tr: [0, 1, 0], bl: [0, 0.35, 1], br: [1, 0.85, 0], mark: [1, 1, 1], arrow: [1, 1, 1] } as const;
export function testPicture(at: Places): [number, number, number][] {
  const out: [number, number, number][] = Array.from({ length: at.n }, () => [0, 0, 0]);
  if (!at.round) {
    const W = at.gw, H = at.gh;
    // the F: a stem on the left, a full bar at the top, a shorter one in the middle, inside a margin
    const m = W >= 6 && H >= 6 ? 1 : 0, x0 = m, x1 = W - 1 - m, y1 = H - 1 - m, y0 = m;
    const stem = Math.max(1, Math.round((x1 - x0 + 1) / 5)), bar = Math.max(1, Math.round((y1 - y0 + 1) / 6));
    const midTop = Math.round((y0 + y1) / 2 + bar / 2), midEnd = x0 + Math.round((x1 - x0) * 0.7);
    for (let i = 0; i < at.n; i++) {
      const x = at.gx[i], y = at.gy[i];
      const inF = x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x < x0 + stem || y > y1 - bar || (y <= midTop && y > midTop - bar && x <= midEnd));
      if (inF) out[i] = [...TEST_COLOURS.mark];
      const corner = (x === 0 ? (y === H - 1 ? 'tl' : y === 0 ? 'bl' : '') : x === W - 1 ? (y === H - 1 ? 'tr' : y === 0 ? 'br' : '') : '') as keyof typeof TEST_COLOURS | '';
      if (corner) out[i] = [...TEST_COLOURS[corner]];
    }
    return out;
  }
  // a ring or a disc: an arrow up the middle with its head at the top, the rim's top red, its right green
  let rim = 0;
  for (let i = 0; i < at.n; i++) rim = Math.max(rim, at.rad[i]);
  const near = (a: number, b: number, w: number) => Math.abs(((a - b + 1.5) % 1) - 0.5) <= w;
  for (let i = 0; i < at.n; i++) {
    const x = at.x[i], y = at.y[i], r = at.rad[i] / (rim || 1);
    const shaft = Math.abs(x) <= Math.max(at.dot * 1.2, 0.08) && y < 0.55 * rim && y > -0.85 * rim;
    const head = y >= 0.2 * rim && Math.abs(x) <= (0.8 * rim - y) * 0.9 + at.dot * 0.5 && y <= 0.85 * rim;
    if (shaft || head || r < 0.05) out[i] = [...TEST_COLOURS.arrow];
    if (r > 0.97 && near(at.ang[i], 0, 0.03)) out[i] = [1, 0, 0];
    if (r > 0.97 && near(at.ang[i], 0.25, 0.03)) out[i] = [0, 1, 0];
  }
  return out;
}

// A likely set of rings for a disc when all you know is how many LEDs and rings it has: one in the
// middle, the rings growing with their radius. Rim first, as most discs are wired.
export function ringsFor(total: number, rings: number): number[] {
  if (rings <= 1 || total < rings) return [total];
  const per = (total - 1) / ((rings * (rings - 1)) / 2);
  const sizes = Array.from({ length: rings - 1 }, (_, k) => Math.max(1, Math.round(per * (k + 1))));
  sizes[sizes.length - 1] += total - 1 - sizes.reduce((a, b) => a + b, 0);
  return [...sizes.reverse(), 1];
}

// ---------------------------------------------------------------- more than one universe

// A light with more channels than a universe has runs on over the next ones, with whole pixels on
// each: 170 RGB or 128 RGBW, the way a LuxDMX box's pixel port and most pixel controllers read it.
export interface Span { universe: number; at: number; from: number; count: number }
export const isWide = (m: FixtureMode | undefined) => !!m && m.channels.length > 512;

export function spansOf(f: { universe: number; address: number }, m: FixtureMode | undefined): Span[] {
  const n = m?.channels.length ?? 1;
  if (!isWide(m)) return [{ universe: f.universe, at: f.address - 1, from: 0, count: n }];
  const cells = m!.channels.reduce((a, c) => Math.max(a, (c.cell ?? -1) + 1), 0);
  const per = cells > 0 ? Math.max(1, Math.round(n / cells)) : 1;
  const whole = (room: number) => Math.floor(room / per) * per;
  const out: Span[] = [];
  let from = 0, u = f.universe, at = f.address - 1;
  while (from < n) {
    const take = Math.min(n - from, whole(512 - at));
    if (take > 0) { out.push({ universe: u, at, from, count: take }); from += take; }
    u++; at = 0;
  }
  return out;
}
// Which universe and channel (0-based) one of a light's channels lands on.
export function channelAt(f: { universe: number; address: number }, m: FixtureMode | undefined, i: number): { universe: number; at: number } {
  if (!isWide(m)) return { universe: f.universe, at: f.address - 1 + i };
  for (const s of spansOf(f, m)) if (i < s.from + s.count) return { universe: s.universe, at: s.at + i - s.from };
  return { universe: f.universe, at: f.address - 1 + i };
}
// Do two lights use a channel in common?
export function sharesChannels(a: { universe: number; address: number }, ma: FixtureMode | undefined, b: { universe: number; address: number }, mb: FixtureMode | undefined): boolean {
  const sb = spansOf(b, mb);
  return spansOf(a, ma).some((x) => sb.some((y) => x.universe === y.universe && x.at < y.at + y.count && y.at < x.at + x.count));
}
// how much of a ring's or matrix's size its width and height are (a wide matrix keeps its shape)
export const shapeW = (at: Places) => (at.round ? 1 : (at.gw - 1) / Math.max(1, Math.max(at.gw, at.gh) - 1));
export const shapeH = (at: Places) => (at.round ? 1 : (at.gh - 1) / Math.max(1, Math.max(at.gw, at.gh) - 1));
// How big a ring or a matrix looks on the 3D stage, in metres (real ones are small: this is what
// reads from the back of a hall). A matrix keeps its LEDs 3 cm apart.
export const shapeSize = (at: Places) => (at.round ? (at.lanes > 1 ? 0.6 : 0.4) : Math.max(0.36, Math.max(at.gw, at.gh) * 0.03));
// Where one stands that hasn't been placed: up on its lower edge, facing the audience.
export const shapeStanding = <V extends { y: number }>(p: V, at: Places) => ({ p: { ...p, y: p.y + shapeSize(at) / 2 + 0.05 }, rot: { yaw: 0, pitch: 90, roll: 0 } });
