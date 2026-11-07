// Rings, discs and matrices: where each pixel is, and how a light too big for one universe is laid
// over several. Pure, and worked out once per mode (a fixture type is never edited in place).
import type { FixtureMode, PixelLayout } from './types';

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

function ringPlaces(l: Extract<PixelLayout, { kind: 'rings' }>): Places {
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

function matrixPlaces(l: Extract<PixelLayout, { kind: 'matrix' }>): Places {
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
export function cleanLayout(v: unknown, cells: number): PixelLayout | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const l = v as Record<string, unknown>;
  if (l.kind === 'rings') {
    if (!Array.isArray(l.rings) || !l.rings.length || !l.rings.every((r) => count(r, 1, MAX_PIXELS))) return undefined;
    const out: PixelLayout = { kind: 'rings', rings: l.rings as number[] };
    if (l.ccw === true) out.ccw = true;
    if (typeof l.turn === 'number' && Number.isFinite(l.turn) && l.turn !== 0) out.turn = l.turn;
    return layoutCells(out) === cells ? out : undefined;
  }
  if (l.kind === 'matrix') {
    if (!count(l.cols, 1, MAX_PIXELS) || !count(l.rows, 1, MAX_PIXELS)) return undefined;
    const out: PixelLayout = { kind: 'matrix', cols: l.cols as number, rows: l.rows as number };
    if (l.zigzag === true) out.zigzag = true;
    if (l.vertical === true) out.vertical = true;
    if (l.from === 'tr' || l.from === 'bl' || l.from === 'br') out.from = l.from;
    return layoutCells(out) === cells ? out : undefined;
  }
  return undefined;
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
// How big a ring or a matrix looks on the 3D stage, in metres (real ones are small: this is what
// reads from the back of a hall). A matrix keeps its LEDs 3 cm apart.
export const shapeSize = (at: Places) => (at.round ? (at.lanes > 1 ? 0.6 : 0.4) : Math.max(0.36, Math.max(at.gw, at.gh) * 0.03));
// Where one stands that hasn't been placed: up on its lower edge, facing the audience.
export const shapeStanding = <V extends { y: number }>(p: V, at: Places) => ({ p: { ...p, y: p.y + shapeSize(at) / 2 + 0.05 }, rot: { yaw: 0, pitch: 90, roll: 0 } });
