// The Formula language's names (formula.ts): the variables a pixel can read, the functions and
// loops, the colour functions and the constants, with their help texts and what each costs.
import type { FormulaCtx } from './formula';
import { TAU, frac, hash, mix, tri } from './fxkit';

export type NumFn = (k: FormulaCtx) => number;

// ---------------------------------------------------------------- the names

export const VARIABLES: Record<string, string> = {
  x: 'where the pixel is along the group, 0 to 1',
  u: 'where it is along its own light (a pixel of a bar), 0 to 1',
  i: 'its number, 0, 1, 2…', n: 'how many there are',
  row: 'which light of the group it is on, 0, 1, 2…', rows: 'how many lights',
  t: 'seconds since the effect started', beat: 'beats since it started',
  c: 'where the effect is in its round, 0 to 1 (Speed sets how long a round is)',
  phase: 'c with Spread and Direction applied to this pixel',
  bass: 'how loud the bass is, 0 to 1 (with ♪)', rnd: 'a random number per pixel that stays',
  size: 'the Size knob, 0 to 1',
  sx: 'on a ring or a matrix: across, -1 (left) to 1 (right)', sy: 'up, -1 (bottom) to 1 (top)',
  rad: 'how far out, 0 in the middle to 1 at the edge', ang: 'which way round, 0 to 1 clockwise from the top',
  lane: 'which ring (from the middle) or row (from the bottom)', lanes: 'how many rings or rows',
  gx: 'column on a grid', gy: 'row on a grid, from the bottom', gw: 'columns', gh: 'rows',
  first: '1 on the first LED of a ring or a run', cell: 'which LED of its light, 0, 1, 2…', cells: 'how many LEDs it has',
};
// what's different for every LED: a program's `frame` part can't use these
// (lanes, gw, gh, cells: each light's own, and an effect can run on several different ones)
export const PIXEL_VARS = new Set(['x', 'u', 'i', 'row', 'phase', 'rnd', 'sx', 'sy', 'rad', 'ang', 'lane', 'lanes', 'gx', 'gy', 'gw', 'gh', 'first', 'cell', 'cells']);
// What a function costs against the budget, beyond its one step (noise in layers is sixteen hashes)
export const FN_COST: Record<string, number> = { fbm: 16, noise: 4, random: 2, dist: 2, hypot: 2, atan2: 2, exp: 1, log: 1, pow: 1 };
export const VAR_FN: Record<string, NumFn> = {
  x: (k) => k.x, u: (k) => k.u, i: (k) => k.i, n: (k) => k.n, row: (k) => k.row, rows: (k) => k.rows,
  t: (k) => k.t, beat: (k) => k.beat, c: (k) => k.c, phase: (k) => k.phase, bass: (k) => k.bass, rnd: (k) => k.rnd, size: (k) => k.size,
  sx: (k) => k.sx, sy: (k) => k.sy, rad: (k) => k.rad, ang: (k) => k.ang, lane: (k) => k.lane, lanes: (k) => k.lanes,
  gx: (k) => k.gx, gy: (k) => k.gy, gw: (k) => k.gw, gh: (k) => k.gh, first: (k) => k.first, cell: (k) => k.cell, cells: (k) => k.cells,
};
export const CONSTANTS: Record<string, number> = { pi: Math.PI, tau: TAU };

export const clampN = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
// smooth value noise in two dimensions, 0..1
function noise2(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, 77), b = hash(ix + 1, iy, 77), c = hash(ix, iy + 1, 77), d = hash(ix + 1, iy + 1, 77);
  return mix(mix(a, b, sx), mix(c, d, sx), sy);
}
// noise in layers, finer and fainter (clouds, fire, water), 0..1
function fbm2(x: number, y: number): number {
  let v = 0, a = 0.5, f = 1;
  for (let o = 0; o < 4; o++) { v += a * noise2(x * f, y * f); f *= 2.03; a *= 0.5; }
  return v / 0.9375;
}
// a stable random number for any number: the same number always gives the same one
const rand = (a: number, b: number) => hash(Math.floor(a), Math.floor(b), Math.round(frac(a) * 4096) * 4099 + Math.round(frac(b) * 4096));

// Every function gives a finite number, whatever it's given (1/x at 0, log(0), sqrt(-1), a power
// that overflows): NaN counts as 0, endless as ±1e9. So a palette, a colour or the brightness
// never sees one, and a formula that is fine except at one pixel only darkens that pixel.
const BIG = 1e9;
export const fin = (v: number) => (v > -BIG ? (v < BIG ? v : BIG) : v <= -BIG ? -BIG : 0);
const fin1 = (f: (a: number) => number) => (a: number) => fin(f(a));
const fin2 = (f: (a: number, b: number) => number) => (a: number, b: number) => fin(f(a, b));
const fin3 = (f: (a: number, b: number, c: number) => number) => (a: number, b: number, c: number) => fin(f(a, b, c));

// Number functions. `args` is [fewest, most]; missing ones take `fill`.
export interface Fn { args: [number, number]; fill?: number[]; f: (...a: number[]) => number; help: string }
export const FUNCTIONS: Record<string, Fn> = {
  sin: { args: [1, 1], f: fin1(Math.sin), help: 'sine, in radians' },
  cos: { args: [1, 1], f: fin1(Math.cos), help: 'cosine, in radians' },
  tan: { args: [1, 1], f: fin1(Math.tan), help: 'tangent, in radians' },
  wave: { args: [1, 1], f: fin1((v) => 0.5 - 0.5 * Math.cos(TAU * v)), help: '0 → 1 → 0 smoothly over one turn (1.0)' },
  triangle: { args: [1, 1], f: (v) => tri(frac(v)), help: '0 → 1 → 0 in straight lines over one turn' },
  square: { args: [1, 2], fill: [0.5], f: (v, d) => (frac(v) < d ? 1 : 0), help: 'square(v, on): 1 for the first part of each turn, else 0' },
  abs: { args: [1, 1], f: fin1(Math.abs), help: 'without the minus' },
  floor: { args: [1, 1], f: fin1(Math.floor), help: 'rounded down' },
  ceil: { args: [1, 1], f: fin1(Math.ceil), help: 'rounded up' },
  frac: { args: [1, 1], f: frac, help: 'the part after the point (always 0 to 1)' },
  min: { args: [2, 6], f: (...v) => fin(Math.min(...v)), help: 'the smallest' },
  max: { args: [2, 6], f: (...v) => fin(Math.max(...v)), help: 'the biggest' },
  clamp: { args: [1, 3], fill: [0, 1], f: fin3(clampN), help: 'clamp(v, lo, hi): kept between lo and hi (0 and 1)' },
  mix: { args: [3, 3], f: fin3(mix), help: 'mix(a, b, t): from a (t = 0) to b (t = 1); colours too' },
  step: { args: [2, 2], f: (e, v) => (v < e ? 0 : 1), help: 'step(edge, v): 0 below the edge, 1 from it' },
  smoothstep: { args: [3, 3], f: fin3((a, b, v) => { if (a === b) return v < a ? 0 : 1; const s = clampN((v - a) / (b - a)); return s * s * (3 - 2 * s); }), help: 'smoothstep(a, b, v): 0 at a, 1 at b, smooth between' },
  pow: { args: [2, 2], f: fin2(Math.pow), help: 'pow(a, b) = a ^ b' },
  sqrt: { args: [1, 1], f: fin1(Math.sqrt), help: 'square root' },
  exp: { args: [1, 1], f: fin1(Math.exp), help: 'e to the power' },
  log: { args: [1, 1], f: fin1(Math.log), help: 'natural logarithm' },
  noise: { args: [1, 2], fill: [0], f: fin2(noise2), help: 'noise(x, y): smooth random hills, 0 to 1' },
  random: { args: [1, 2], fill: [0], f: fin2(rand), help: 'random(a, b): a random number 0 to 1 that stays the same for the same a and b' },
  fbm: { args: [1, 2], fill: [0], f: fin2(fbm2), help: 'fbm(x, y): noise in layers, finer and fainter: clouds, fire, water' },
  atan2: { args: [2, 2], f: fin2(Math.atan2), help: 'atan2(y, x): the angle of a point, in radians' },
  hypot: { args: [2, 2], f: fin2(Math.hypot), help: 'hypot(a, b): the length of a and b together' },
  dist: { args: [4, 4], f: (a, b, c, d) => fin(Math.hypot(a - c, b - d)), help: 'dist(x1, y1, x2, y2): how far apart two points are' },
  gauss: { args: [1, 2], fill: [1], f: (v, w) => (w ? fin(Math.exp(-(v / w) * (v / w))) : +(v === 0)), help: 'gauss(v, w): 1 at 0, falling softly to 0 by about w' },
  sign: { args: [1, 1], f: (v) => (v > 0 ? 1 : v < 0 ? -1 : 0), help: '-1, 0 or 1' },
  round: { args: [1, 1], f: fin1(Math.round), help: 'rounded' },
};
// A few steps over a set (in a program): sum(k, n, value), maxof, minof, k = 0 ... n-1.
export const LOOPS: Record<string, { start: number; f: (a: number, b: number) => number; help: string }> = {
  sum: { start: 0, f: (a, b) => a + b, help: 'sum(k, n, value): value added up for k = 0, 1 … n-1 (n up to 64)' },
  maxof: { start: -BIG, f: (a, b) => (b > a ? b : a), help: 'maxof(k, n, value): the biggest value for k = 0 … n-1' },
  minof: { start: BIG, f: (a, b) => (b < a ? b : a), help: 'minof(k, n, value): the smallest value for k = 0 … n-1' },
};
// Colour functions (they make a colour from numbers).
export const COLOR_FUNCTIONS: Record<string, { args: number; help: string }> = {
  hsv: { args: 3, help: 'hsv(hue, saturation, brightness): hue 0 to 1 goes round the rainbow' },
  rgb: { args: 3, help: 'rgb(red, green, blue), each 0 to 1' },
  pal: { args: 1, help: 'pal(p): the colour at p along the effect\'s palette' },
  heat: { args: 1, help: 'heat(v): glowing, 0 black, then red, orange, yellow, 1 white' },
};
// own names only: "constructor" or "__proto__" are not names a formula can reach
export const has = (o: object, k: string) => Object.hasOwn(o, k);
export const ALL_NAMES = [...Object.keys(VARIABLES), ...Object.keys(CONSTANTS), ...Object.keys(FUNCTIONS), ...Object.keys(COLOR_FUNCTIONS), ...Object.keys(LOOPS)];
