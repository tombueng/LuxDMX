// The Formula effect's little language: one expression per pixel, like `hsv(x - c, 1, 1)`.
// Shows travel between people, so a formula must never be able to run code: it's read by our own
// parser into a tree of small closures (no eval, no new Function), it can only reach the names
// below, and it's bounded in length, nesting and size. A number result is a brightness, a colour
// result (hsv, rgb, pal) a colour with its brightness.
import type { Color } from '../model/types';
import { TAU, along, frac, hash, mix, tri } from './fxkit';

// What a formula can read, per pixel. One object, refilled for every pixel (no allocation).
// (sx ... cells: where it is on a ring or a matrix; vals, cols: an add-on's own knobs; work: what a
// program has done this frame, against its budget)
export interface FormulaCtx {
  x: number; u: number; i: number; n: number; row: number; rows: number;
  t: number; beat: number; c: number; phase: number; bass: number; rnd: number; size: number;
  sx: number; sy: number; rad: number; ang: number; lane: number; lanes: number; gx: number; gy: number; gw: number; gh: number; first: number; cell: number; cells: number;
  colors: Color[];
  vals: Record<string, number>; cols: Record<string, Float64Array>;
  work: number; budget: number; frame: number;
}
export const newCtx = (): FormulaCtx => ({ x: 0, u: 0, i: 0, n: 1, row: 0, rows: 1, t: 0, beat: 0, c: 0, phase: 0, bass: 0, rnd: 0, size: 1,
  sx: 0, sy: 0, rad: 0, ang: 0, lane: 0, lanes: 1, gx: 0, gy: 0, gw: 1, gh: 1, first: 0, cell: 0, cells: 1, colors: [], vals: Object.create(null), cols: Object.create(null), work: 0, budget: Infinity, frame: 0 });

type NumFn = (k: FormulaCtx) => number;
type ColFn = (k: FormulaCtx) => Float64Array;     // [r, g, b]: the node's own buffer, refilled each time
// (px: it's different for every LED; kv: it changes with a loop's counter; kept: worked out once
// a frame (or once a frame for each count) and kept, see hoist)
type Val = ({ t: 'n'; f: NumFn; k?: number } | { t: 'c'; f: ColFn }) & { px?: boolean; kv?: boolean; kept?: boolean };
export type Formula = { type: 'num'; num: NumFn; nodes: number } | { type: 'col'; col: ColFn; nodes: number };

export class FormulaError extends Error {
  // (part: in a program, which part the position is in)
  constructor(message: string, public pos: number, public part?: 'frame' | 'pixel') { super(message); }
}

export const LIMITS = { length: 500, depth: 24, nodes: 250 };

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
const PIXEL_VARS = new Set(['x', 'u', 'i', 'row', 'phase', 'rnd', 'sx', 'sy', 'rad', 'ang', 'lane', 'lanes', 'gx', 'gy', 'gw', 'gh', 'first', 'cell', 'cells']);
// What a function costs against the budget, beyond its one step (noise in layers is sixteen hashes)
const FN_COST: Record<string, number> = { fbm: 16, noise: 4, random: 2, dist: 2, hypot: 2, atan2: 2, exp: 1, log: 1, pow: 1 };
const VAR_FN: Record<string, NumFn> = {
  x: (k) => k.x, u: (k) => k.u, i: (k) => k.i, n: (k) => k.n, row: (k) => k.row, rows: (k) => k.rows,
  t: (k) => k.t, beat: (k) => k.beat, c: (k) => k.c, phase: (k) => k.phase, bass: (k) => k.bass, rnd: (k) => k.rnd, size: (k) => k.size,
  sx: (k) => k.sx, sy: (k) => k.sy, rad: (k) => k.rad, ang: (k) => k.ang, lane: (k) => k.lane, lanes: (k) => k.lanes,
  gx: (k) => k.gx, gy: (k) => k.gy, gw: (k) => k.gw, gh: (k) => k.gh, first: (k) => k.first, cell: (k) => k.cell, cells: (k) => k.cells,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, tau: TAU };

const clampN = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
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
const fin = (v: number) => (v > -BIG ? (v < BIG ? v : BIG) : v <= -BIG ? -BIG : 0);
const fin1 = (f: (a: number) => number) => (a: number) => fin(f(a));
const fin2 = (f: (a: number, b: number) => number) => (a: number, b: number) => fin(f(a, b));
const fin3 = (f: (a: number, b: number, c: number) => number) => (a: number, b: number, c: number) => fin(f(a, b, c));

// Number functions. `args` is [fewest, most]; missing ones take `fill`.
interface Fn { args: [number, number]; fill?: number[]; f: (...a: number[]) => number; help: string }
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
const has = (o: object, k: string) => Object.hasOwn(o, k);
const ALL_NAMES = [...Object.keys(VARIABLES), ...Object.keys(CONSTANTS), ...Object.keys(FUNCTIONS), ...Object.keys(COLOR_FUNCTIONS), ...Object.keys(LOOPS)];

// ---------------------------------------------------------------- reading the text

type Tok = ({ k: 'num'; v: number } | { k: 'name'; v: string } | { k: 'op'; v: string } | { k: 'end' }) & { pos: number; text: string };
const OPS2 = ['<=', '>=', '==', '!=', '&&', '||'];
const OPS1 = '+-*/%^()<>!?:,';

function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i, i + 40));
    if (num) { out.push({ k: 'num', v: parseFloat(num[0]), pos: i, text: num[0] }); i += num[0].length; continue; }
    const name = /^[a-z_][a-z0-9_]*/i.exec(src.slice(i, i + 40));
    if (name) { out.push({ k: 'name', v: name[0], pos: i, text: name[0] }); i += name[0].length; continue; }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) { out.push({ k: 'op', v: two, pos: i, text: two }); i += 2; continue; }
    if (OPS1.includes(ch)) { out.push({ k: 'op', v: ch, pos: i, text: ch }); i++; continue; }
    if (ch === '=') throw new FormulaError('To compare, write == (two of them)', i);
    if (ch === '&' || ch === '|') throw new FormulaError(`Write ${ch}${ch} (two of them)`, i);
    throw new FormulaError(`A formula can't have "${ch}"`, i);
  }
  out.push({ k: 'end', pos: src.length, text: '' });
  return out;
}

type Node =
  | { k: 'num'; v: number; pos: number }
  | { k: 'name'; v: string; pos: number }
  | { k: 'un'; op: string; a: Node; pos: number }
  | { k: 'bin'; op: string; a: Node; b: Node; pos: number }
  | { k: 'if'; c: Node; a: Node; b: Node; pos: number }
  | { k: 'call'; name: string; args: Node[]; pos: number };

const BIN_LEVELS: string[][] = [['||'], ['&&'], ['==', '!=', '<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];

function parse(src: string, lim: { length: number; depth: number; nodes: number } = LIMITS): { node: Node; count: number } {
  if (src.length > lim.length) throw new FormulaError(`Too long: ${src.length} characters, ${lim.length} at most`, lim.length);
  if (!src.trim()) throw new FormulaError('Type a formula, for example hsv(x - c, 1, 1)', 0);
  const ts = tokens(src);
  let p = 0, count = 0, depth = 0;
  const peek = () => ts[p];
  const isOp = (v: string) => { const t = ts[p]; return t.k === 'op' && t.v === v; };
  const made = <T extends Node>(n: T): T => {
    if (++count > lim.nodes) throw new FormulaError(`Too big: ${lim.nodes} parts at most`, n.pos);
    return n;
  };
  const deeper = (pos: number) => { if (++depth > lim.depth) throw new FormulaError(`Too many brackets inside each other (${lim.depth} at most)`, pos); };
  const what = (t: Tok) => (t.k === 'end' ? 'the end' : `"${t.text}"`);

  function ternary(): Node {
    const c = binary(0);
    if (!isOp('?')) return c;
    const pos = peek().pos; p++;
    deeper(pos);
    const a = ternary();
    if (!isOp(':')) throw new FormulaError('This "?" needs a ":" and the other choice', pos);
    p++;
    const b = ternary();
    depth--;
    return made({ k: 'if', c, a, b, pos });
  }
  function binary(level: number): Node {
    if (level >= BIN_LEVELS.length) return unary();
    let a = binary(level + 1);
    for (;;) {
      const t = peek();
      if (t.k !== 'op' || !BIN_LEVELS[level].includes(t.v)) return a;
      p++;
      a = made({ k: 'bin', op: t.v, a, b: binary(level + 1), pos: t.pos });
    }
  }
  function unary(): Node {
    const t = peek();
    if (t.k === 'op' && (t.v === '-' || t.v === '+' || t.v === '!')) {
      p++; deeper(t.pos);
      const a = unary();
      depth--;
      return t.v === '+' ? a : made({ k: 'un', op: t.v, a, pos: t.pos });
    }
    return power();
  }
  // a ^ b binds tighter than a minus in front (-2^2 is -4) and goes right to left (2^3^2 is 2^9)
  function power(): Node {
    const a = primary();
    if (!isOp('^')) return a;
    const pos = peek().pos; p++;
    deeper(pos);
    const b = unary();
    depth--;
    return made({ k: 'bin', op: '^', a, b, pos });
  }
  function primary(): Node {
    const t = peek();
    if (t.k === 'num') { p++; return made({ k: 'num', v: t.v, pos: t.pos }); }
    if (t.k === 'name') {
      p++;
      if (!isOp('(')) return made({ k: 'name', v: t.v, pos: t.pos });
      const open = peek().pos; p++;
      deeper(open);
      const args: Node[] = [];
      if (!isOp(')')) {
        for (;;) {
          args.push(ternary());
          if (isOp(',')) { p++; continue; }
          if (isOp(')')) break;
          throw new FormulaError(peek().k === 'end' ? `This "(" is never closed` : `Expected "," or ")" here, not ${what(peek())}`, peek().k === 'end' ? open : peek().pos);
        }
      }
      p++; depth--;
      return made({ k: 'call', name: t.v, args, pos: t.pos });
    }
    if (t.k === 'op' && t.v === '(') {
      p++; deeper(t.pos);
      const inner = ternary();
      if (!isOp(')')) throw new FormulaError(peek().k === 'end' ? 'This "(" is never closed' : `Expected ")" here, not ${what(peek())}`, peek().k === 'end' ? t.pos : peek().pos);
      p++; depth--;
      return inner;
    }
    if (t.k === 'end') throw new FormulaError('Something is missing at the end', t.pos);
    throw new FormulaError(`Expected a number, a name or "(" here, not ${what(t)}`, t.pos);
  }

  const node = ternary();
  const rest = peek();
  if (rest.k !== 'end') {
    throw new FormulaError(rest.k === 'op' && rest.v === ')' ? 'This ")" has no "(" before it' : `Expected an operator (+ - * / …) before ${what(rest)}`, rest.pos);
  }
  return { node, count };
}

// ---------------------------------------------------------------- turning the tree into closures

// The known name closest to a typo (or to a word people try first, like "time"), if it's close
// enough to be what was meant.
const MEANT: Record<string, string> = { time: 't', secs: 't', seconds: 't', beats: 'beat', cycle: 'c', index: 'i', count: 'n', loud: 'bass', level: 'bass', hue: 'hsv', color: 'rgb', colour: 'rgb', palette: 'pal', rand: 'random' };
function nearest(name: string): string | undefined {
  if (has(MEANT, name.toLowerCase())) return MEANT[name.toLowerCase()];
  const d = (a: string, b: string) => {
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) m[i][j] = Math.min(m[i][j], m[i - 2][j - 2] + 1);   // two letters swapped
    }
    return m[a.length][b.length];
  };
  let best: string | undefined, bd = Infinity;
  for (const n of ALL_NAMES) { const v = d(name.toLowerCase(), n); if (v < bd) { bd = v; best = n; } }
  return bd <= Math.max(1, Math.floor(name.length / 3)) ? best : undefined;
}

const num = (f: NumFn): Val => ({ t: 'n', f });
const deps = (vs: Val[]) => ({ px: vs.some((v) => v.px), kv: vs.some((v) => v.kv) });
const tag = <T extends Val>(v: T, d: { px?: boolean; kv?: boolean }): T => { if (d.px) v.px = true; if (d.kv) v.kv = true; return v; };
const konst = (v: number): Val => ({ t: 'n', f: () => v, k: v });
// a colour node: `fill` writes into its own buffer
function col(fill: (k: FormulaCtx, out: Float64Array) => void): Val {
  const out = new Float64Array(3);
  return { t: 'c', f: (k) => { fill(k, out); return out; } };
}
// A number where a colour is wanted (one side of `?:`): that brightness in the palette colour at x,
// the same as a whole formula that gives a number.
const asColor = (v: Val): Val & { t: 'c' } => (v.t === 'c' ? v : col((k, o) => {
  const b = v.f(k), p = along(k.colors, k.x);
  o[0] = p.r * b; o[1] = p.g * b; o[2] = p.b * b;
}) as Val & { t: 'c' });

const BIN: Record<string, (a: number, b: number) => number> = {
  '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b,
  // always the positive remainder for a positive divisor (like frac): -0.25 % 1 is 0.75
  '%': (a, b) => a - b * Math.floor(a / b),
  '^': Math.pow,
  '<': (a, b) => +(a < b), '<=': (a, b) => +(a <= b), '>': (a, b) => +(a > b), '>=': (a, b) => +(a >= b),
  '==': (a, b) => +(a === b), '!=': (a, b) => +(a !== b),
  '&&': (a, b) => +(!!a && !!b), '||': (a, b) => +(!!a || !!b),
};
const NUM_ONLY = new Set(['<', '<=', '>', '>=', '==', '!=', '&&', '||']);

// A number function over numbers, or channel by channel when a colour is among its values.
function apply(f: (...a: number[]) => number, args: Val[], env?: Env): Val {
  args = hoistAll(args, env);
  return tag(applyRaw(f, args), deps(args));
}
function applyRaw(f: (...a: number[]) => number, args: Val[]): Val {
  if (args.every((a) => a.t === 'n')) {
    const fs = args.map((a) => a.f as NumFn);
    if (args.every((a) => a.t === 'n' && a.k !== undefined)) return konst(f(...args.map((a) => (a as { k: number }).k)));
    if (fs.length === 1) { const [a] = fs; return num((k) => f(a(k))); }
    if (fs.length === 2) { const [a, b] = fs; return num((k) => f(a(k), b(k))); }
    if (fs.length === 3) { const [a, b, c] = fs; return num((k) => f(a(k), b(k), c(k))); }
    const vals = new Array<number>(fs.length);
    return num((k) => { for (let i = 0; i < fs.length; i++) vals[i] = fs[i](k); return f(...vals); });
  }
  const vals = new Array<number>(args.length), got: (number | Float64Array)[] = new Array(args.length);
  return col((k, o) => {
    for (let i = 0; i < args.length; i++) got[i] = args[i].f(k);
    for (let ch = 0; ch < 3; ch++) {
      for (let i = 0; i < args.length; i++) { const g = got[i]; vals[i] = typeof g === 'number' ? g : g[ch]; }
      o[ch] = f(...vals);
    }
  });
}

// What a program has named (its lets, its fns, its knobs, a loop's counter), and where it is: a
// `frame` part can't read what's different for every LED, a loop can't hold another loop.
// (loop: the one it's in; cache: keep what's the same for every LED (a program's pixel part);
// count: how much has been built, own functions put in place included, against a limit)
type Bound = { t: 'val'; val: Val } | { t: 'fn'; params: string[]; body: Node; env: Env; nodes: number; pos: number; part: 'frame' | 'pixel' };
interface Env { names: Map<string, Bound>; frame: boolean; inLoop: boolean; loop?: { slot: { v: number }; n: number }; cache?: boolean; count?: { n: number } }
const NO_ENV: Env = { names: new Map(), frame: false, inLoop: false };

// Kept: a value that's the same for every LED is worked out once a frame, one that changes only
// with a loop's counter once a frame for each count; the LEDs read it from there. (Where such a
// value meets one that's different for every LED: that's where it pays.)
function perFrame(v: Val): Val {
  if (v.t === 'n') { const f = v.f; let at = -1, val = 0; return { t: 'n', f: (k) => { if (at !== k.frame) { at = k.frame; val = f(k); } return val; }, kept: true }; }
  const f = v.f, buf = new Float64Array(3);
  let at = -1;
  return { t: 'c', f: (k) => { if (at !== k.frame) { at = k.frame; const c = f(k); buf[0] = c[0]; buf[1] = c[1]; buf[2] = c[2]; } return buf; }, kept: true };
}
function perCount(v: Val, lp: { slot: { v: number }; n: number }): Val {
  const at = new Float64Array(lp.n).fill(-1);
  if (v.t === 'n') {
    const f = v.f, vals = new Float64Array(lp.n);
    return { t: 'n', f: (k) => { const j = lp.slot.v; if (at[j] !== k.frame) { at[j] = k.frame; vals[j] = f(k); } return vals[j]; }, kv: true, kept: true };
  }
  const f = v.f, vals = new Float64Array(lp.n * 3), buf = new Float64Array(3);
  return { t: 'c', f: (k) => {
    const j = lp.slot.v;
    if (at[j] !== k.frame) { at[j] = k.frame; const c = f(k); vals[j * 3] = c[0]; vals[j * 3 + 1] = c[1]; vals[j * 3 + 2] = c[2]; }
    buf[0] = vals[j * 3]; buf[1] = vals[j * 3 + 1]; buf[2] = vals[j * 3 + 2];
    return buf;
  }, kv: true, kept: true };
}
function hoist(v: Val, env?: Env): Val {
  if (!env?.cache || v.px || v.kept || (v.t === 'n' && v.k !== undefined)) return v;
  if (v.kv) return env.loop ? perCount(v, env.loop) : v;
  return perFrame(v);
}
// (only where something different for every LED is among them: the others are kept)
const hoistAll = (vs: Val[], env?: Env) => (env?.cache && vs.some((v) => v.px) ? vs.map((v) => hoist(v, env)) : vs);
const BUILD_LIMIT = 40_000;

function build(n: Node, env: Env = NO_ENV): Val {
  if (env.count && ++env.count.n > BUILD_LIMIT) throw new FormulaError(`Too big once its own functions are put in place (${BUILD_LIMIT} parts at most)`, n.pos);
  switch (n.k) {
    case 'num': return konst(n.v);
    case 'name': {
      const b = env.names.get(n.v);
      if (b?.t === 'val') return b.val;
      if (b?.t === 'fn') throw new FormulaError(`${n.v} needs brackets: ${n.v}(…)`, n.pos);
      if (env.frame && PIXEL_VARS.has(n.v)) throw new FormulaError(`"${n.v}" is different for every LED: use it in the pixel part`, n.pos);
      if (has(VAR_FN, n.v)) return tag(num(VAR_FN[n.v]), { px: PIXEL_VARS.has(n.v) });
      if (has(CONSTANTS, n.v)) return konst(CONSTANTS[n.v]);
      if (has(FUNCTIONS, n.v) || has(COLOR_FUNCTIONS, n.v) || has(LOOPS, n.v)) throw new FormulaError(`${n.v} needs brackets: ${n.v}(…)`, n.pos);
      const near = nearest(n.v);
      throw new FormulaError(`Unknown name "${n.v}"${near ? `. Did you mean ${near}?` : ''}`, n.pos);
    }
    case 'un': {
      const a = build(n.a, env);
      if (n.op === '!') {
        if (a.t === 'c') throw new FormulaError('"!" works on numbers, not on a colour', n.pos);
        return apply((v) => +!v, [a], env);
      }
      return apply((v) => -v, [a], env);
    }
    case 'bin': {
      const a = build(n.a, env), b = build(n.b, env);
      if (NUM_ONLY.has(n.op) && (a.t === 'c' || b.t === 'c')) throw new FormulaError(`"${n.op}" works on numbers, not on colours`, n.pos);
      return apply(BIN[n.op], [a, b], env);
    }
    case 'if': {
      const c0 = build(n.c, env);
      if (c0.t === 'c') throw new FormulaError('A colour can\'t decide a "?": compare a number', n.pos);
      if (c0.k !== undefined) return c0.k ? build(n.a, env) : build(n.b, env);
      const [c, a, b] = hoistAll([c0, build(n.a, env), build(n.b, env)], env), cf = c.f as NumFn, d = deps([c, a, b]);
      if (a.t === 'n' && b.t === 'n') { const af = a.f, bf = b.f; return tag(num((k) => (cf(k) ? af(k) : bf(k))), d); }
      if (env.frame && (a.t === 'n') !== (b.t === 'n')) throw new FormulaError('In the frame part both sides of "?" are colours, or both numbers (there\'s no LED to colour a number by yet)', n.pos);
      const ac = asColor(a).f, bc = asColor(b).f;
      return tag({ t: 'c', f: (k) => (cf(k) ? ac(k) : bc(k)) }, { px: d.px || (a.t === 'n' || b.t === 'n'), kv: d.kv });
    }
    case 'call': {
      // a fn of the program's own: its body with the values given in place of its names
      const own = env.names.get(n.name);
      if (own?.t === 'val') throw new FormulaError(`${n.name} is a value, not a function: write ${n.name} * (…)`, n.pos);
      if (own?.t === 'fn') {
        if (n.args.length !== own.params.length) throw new FormulaError(`${n.name} takes ${own.params.length} value${own.params.length === 1 ? '' : 's'}, not ${n.args.length}`, n.pos);
        // each value given is worked out once per call, into a slot its name reads (used twice,
        // it isn't worked out twice: fns inside fns can't multiply the work)
        const names = new Map(own.env.names), sets: ((k: FormulaCtx) => void)[] = [], given: Val[] = [];
        own.params.forEach((q, i) => {
          const a = build(n.args[i], env);
          given.push(a);
          if (a.t === 'n' && a.k !== undefined) { names.set(q, { t: 'val', val: a }); return; }
          if (a.t === 'n') { const s = { v: 0 }, af = a.f; sets.push((k) => { s.v = af(k); }); names.set(q, { t: 'val', val: tag(num(() => s.v), a) }); return; }
          const s = new Float64Array(3), af = a.f;
          sets.push((k) => { const c = af(k); s[0] = c[0]; s[1] = c[1]; s[2] = c[2]; });
          names.set(q, { t: 'val', val: tag({ t: 'c', f: () => s }, a) });
        });
        // (an error in its body is said where the body is, not where it's called)
        let body: Val;
        try { body = build(own.body, { ...env, names }); } catch (e) {
          if (e instanceof FormulaError && e.part === undefined) throw new FormulaError(e.message, own.pos + e.pos, own.part);
          throw e;
        }
        if (!sets.length) return body;
        const d = deps([body, ...given]);
        if (body.t === 'n') { const bf = body.f; return tag(num((k) => { for (const s of sets) s(k); return bf(k); }), d); }
        const bf = body.f;
        return tag({ t: 'c', f: (k) => { for (const s of sets) s(k); return bf(k); } }, d);
      }
      if (has(LOOPS, n.name)) return loop(n, env);
      const cf = has(COLOR_FUNCTIONS, n.name) ? COLOR_FUNCTIONS[n.name] : undefined;
      const fn = has(FUNCTIONS, n.name) ? FUNCTIONS[n.name] : undefined;
      if (!cf && !fn) {
        if (has(VAR_FN, n.name) || has(CONSTANTS, n.name)) throw new FormulaError(`${n.name} is a value, not a function: write ${n.name} * (…)`, n.pos);
        const near = nearest(n.name);
        throw new FormulaError(`Unknown function "${n.name}"${near ? `. Did you mean ${near}?` : ''}`, n.pos);
      }
      const [lo, hi] = cf ? [cf.args, cf.args] : fn!.args;
      if (n.args.length < lo || n.args.length > hi) {
        const want = lo === hi ? `${lo} value${lo > 1 ? 's' : ''}` : `${lo} to ${hi} values`;
        throw new FormulaError(`${n.name} takes ${want}, not ${n.args.length}`, n.pos);
      }
      const args = n.args.map((a) => build(a, env));
      if (env.count && fn) env.count.n += FN_COST[n.name] ?? 0;
      if (cf) {
        if (args.some((a) => a.t === 'c')) throw new FormulaError(`${n.name} takes numbers, not a colour`, n.pos);
        const kept = hoistAll(args, env), d = deps(kept);
        const [a, b, c] = kept.map((v) => v.f as NumFn);
        if (n.name === 'pal') return tag(col((k, o) => { const p = along(k.colors, a(k)); o[0] = p.r; o[1] = p.g; o[2] = p.b; }), d);
        if (n.name === 'rgb') return tag(col((k, o) => { o[0] = a(k); o[1] = b(k); o[2] = c(k); }), d);
        if (n.name === 'heat') return tag(col((k, o) => { const v = a(k) * 3; o[0] = clampN(v); o[1] = clampN(v - 1); o[2] = clampN(v - 2); }), d);
        return tag(col((k, o) => hsvInto(a(k), b(k), c(k), o)), d);
      }
      for (let i = args.length; i < hi && fn!.fill; i++) args.push(konst(fn!.fill[i - lo]));
      return apply(fn!.f, args, env);
    }
  }
}

// sum, maxof, minof: n steps of a value with k counting (n a number written out, at most 64; not
// one inside another). Each step counts against the frame's budget.
function loop(n: Extract<Node, { k: 'call' }>, env: Env): Val {
  const L = LOOPS[n.name];
  if (!env.count) throw new FormulaError(`${n.name} is for an add-on's program (ADDONS.md), not a plain formula`, n.pos);
  if (n.args.length !== 3) throw new FormulaError(`${n.name} takes 3 values: ${n.name}(k, how many, value)`, n.pos);
  if (env.inLoop) throw new FormulaError(`A ${n.name} can't be inside another one`, n.pos);
  const [kn, cn, body] = n.args;
  if (kn.k !== 'name') throw new FormulaError(`${n.name}: first a name for the counter, like k`, kn.pos);
  if (env.names.has(kn.v) || has(VAR_FN, kn.v) || has(CONSTANTS, kn.v) || has(FUNCTIONS, kn.v)) throw new FormulaError(`"${kn.v}" is already a name: pick another for the counter`, kn.pos);
  const cnt = build(cn, env);
  if (cnt.t !== 'n' || cnt.k === undefined || !Number.isInteger(cnt.k) || cnt.k < 1 || cnt.k > PROGRAM_LIMITS.loop) throw new FormulaError(`${n.name}: how many is a whole number from 1 to ${PROGRAM_LIMITS.loop}, written out`, cn.pos);
  const slot = { v: 0 }, names = new Map(env.names), N = cnt.k;
  names.set(kn.v, { t: 'val', val: tag(num(() => slot.v), { kv: true }) });
  const was = env.count.n;
  const v = build(body, { ...env, names, inLoop: true, loop: { slot, n: N } });
  const size = env.count.n - was;
  if (v.t !== 'n') throw new FormulaError(`${n.name} works on numbers: take the brightness, colour it after`, body.pos);
  const f = v.f, start = L.start, op = L.f, cost = N * (1 + size);
  return tag(num((k) => {
    k.work += cost;
    if (k.work > k.budget) throw new FormulaError(`Too much to work out in one frame (${PROGRAM_LIMITS.work} steps at most)`, n.pos);
    let acc = start;
    for (let j = 0; j < N; j++) { slot.v = j; acc = op(acc, f(k)); }
    return fin(acc);
  }), { px: v.px });
}

// hsv into a buffer; anything odd (NaN, endless) becomes something sensible instead of breaking
function hsvInto(h: number, s: number, v: number, o: Float64Array) {
  h = Number.isFinite(h) ? frac(h) : 0; s = s > 0 ? (s < 1 ? s : 1) : 0; v = v > 0 ? (v < 1 ? v : 1) : 0;
  const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6);
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (i) {
    case 0: o[0] = v; o[1] = t; o[2] = p; break;
    case 1: o[0] = q; o[1] = v; o[2] = p; break;
    case 2: o[0] = p; o[1] = v; o[2] = t; break;
    case 3: o[0] = p; o[1] = q; o[2] = v; break;
    case 4: o[0] = t; o[1] = p; o[2] = v; break;
    default: o[0] = v; o[1] = p; o[2] = q;
  }
}

// Read a formula. Throws a FormulaError (a message and where in the text) when it can't.
export function compile(src: string): Formula {
  const { node, count } = parse(src);
  const v = build(node);
  return v.t === 'n' ? { type: 'num', num: v.f, nodes: count } : { type: 'col', col: v.f, nodes: count };
}

// Compiled once per distinct text: the engine asks every frame.
const cache = new Map<string, Formula | FormulaError>();
export function compileCached(src: string): Formula | FormulaError {
  if (src.length > LIMITS.length) return new FormulaError(`Too long: ${src.length} characters, ${LIMITS.length} at most`, LIMITS.length);
  let f = cache.get(src);
  if (!f) {
    try { f = compile(src); } catch (e) { f = e instanceof FormulaError ? e : new FormulaError(String(e), 0); }
    if (cache.size > 200) cache.clear();
    cache.set(src, f);
  }
  return f;
}
// The error in a formula, or null when it's fine (for the editor).
export function check(src: string): { message: string; pos: number } | null {
  const f = compileCached(src);
  return f instanceof FormulaError ? { message: f.message, pos: f.pos } : null;
}

// ---------------------------------------------------------------- programs (add-ons, ADDONS.md)
// Lines of `let name = value` and `fn name(a, b) = value`; a `frame` part that runs once a frame
// and a `pixel` part that runs per LED and ends with its colour. Read the same way as a formula
// (our own parser, closures, no eval), bounded in size, and in work per frame.
export const PROGRAM_LIMITS = { length: 4000, nodes: 1500, loop: 64, work: 20_000_000, ms: 30, statement: { length: 1200, depth: 24, nodes: 600 } };
export interface ProgramParam { id: string; type: 'number' | 'choice' | 'toggle' | 'colour' | 'text' }
export interface Program { frame: ((k: FormulaCtx) => void)[]; pixel: ((k: FormulaCtx) => void)[]; out: Val; nodes: number; cost: number }
type Stmt = { kind: 'let' | 'fn' | 'value'; name?: string; params?: string[]; text: string; pos: number };

function statements(src: string): Stmt[] {
  // comments out (spaces keep the positions), then cut at ";" and at line ends outside brackets
  const s = src.replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  const out: Stmt[] = [];
  let depth = 0, start = 0;
  const cut = (end: number) => {
    const raw = s.slice(start, end), text = raw.trim();
    if (text) out.push(stmtOf(text, start + raw.length - raw.trimStart().length));
    start = end + 1;
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if ((ch === ';' || ch === '\n') && depth === 0) cut(i);
  }
  cut(s.length);
  return out;
}
function stmtOf(text: string, pos: number): Stmt {
  let m = /^let\s+([A-Za-z_]\w*)\s*=(?!=)/.exec(text);
  if (m) return { kind: 'let', name: m[1], text: text.slice(m[0].length), pos: pos + m[0].length };
  m = /^fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=(?!=)/.exec(text);
  if (m) return { kind: 'fn', name: m[1], params: m[2].split(',').map((x) => x.trim()).filter(Boolean), text: text.slice(m[0].length), pos: pos + m[0].length };
  if (/^(let|fn)\b/.test(text)) throw new FormulaError(text.startsWith('let') ? 'Write it as: let name = value' : 'Write it as: fn name(a, b) = value', pos);
  return { kind: 'value', text, pos };
}
// a let's value, worked out once where it stands and read from there after
// (it keeps what its value depends on: one that's different for every LED stays that)
function slotOf(v: Val, steps: ((k: FormulaCtx) => void)[]): Val {
  const same = !v.px && !v.kv;
  if (v.t === 'n') {
    if (v.k !== undefined) return v;
    const s = { v: 0 }, f = v.f;
    steps.push((k) => { s.v = f(k); });
    return tag({ t: 'n', f: () => s.v, kept: same }, v);
  }
  const s = new Float64Array(3), f = v.f;
  steps.push((k) => { const c = f(k); s[0] = c[0]; s[1] = c[1]; s[2] = c[2]; });
  return tag({ t: 'c', f: () => s, kept: same }, v);
}

// Read a program. Throws a FormulaError (a message, the part and where in it) when it can't.
// `params`: the add-on's own knobs, read by their ids (k.vals, k.cols).
// (keep: false works every value out for every LED, for the tests that compare the two)
export function compileProgram(src: { frame?: string; pixel: string }, params: ProgramParam[] = [], opts: { keep?: boolean } = {}): Program {
  const keep = opts.keep !== false;
  const size = (src.frame ?? '').length + src.pixel.length;
  if (size > PROGRAM_LIMITS.length) throw new FormulaError(`Too long: ${size} characters, ${PROGRAM_LIMITS.length} at most`, 0, 'pixel');
  const names = new Map<string, Bound>();
  const taken = (nm: string, pos: number, part: 'frame' | 'pixel') => {
    if (names.has(nm) || has(VAR_FN, nm) || has(CONSTANTS, nm) || has(FUNCTIONS, nm) || has(COLOR_FUNCTIONS, nm) || has(LOOPS, nm) || nm === 'let' || nm === 'fn')
      throw new FormulaError(`"${nm}" is already a name: pick another`, pos, part);
  };
  for (const q of params) {
    if (q.type === 'text') continue;
    taken(q.id, 0, 'pixel');
    const id = q.id;
    names.set(id, { t: 'val', val: q.type === 'colour'
      ? col((k, o) => { const c = k.cols[id]; o[0] = c ? c[0] : 1; o[1] = c ? c[1] : 1; o[2] = c ? c[2] : 1; })
      : num((k) => k.vals[id] ?? 0) });
  }
  let nodes = 0, pixelNodes = 0;
  const count = { n: 0 };
  const part = (text: string, which: 'frame' | 'pixel', steps: ((k: FormulaCtx) => void)[]): Val | undefined => {
    const frame = which === 'frame';
    let list: Stmt[], out: Val | undefined;
    try { list = statements(text); } catch (e) { if (e instanceof FormulaError) e.part = which; throw e; }
    list.forEach((st, i) => {
      const at = <T>(f: () => T): T => {
        try { return f(); } catch (e) { if (e instanceof FormulaError && e.part === undefined) throw new FormulaError(e.message, st.pos + e.pos, which); throw e; }
      };
      if (st.kind === 'value') {
        if (frame) throw new FormulaError('The frame part only names values (let ...): the colour comes from the pixel part', st.pos, which);
        if (i !== list.length - 1) throw new FormulaError('Only the last line gives the colour: name this one with let', st.pos, which);
      }
      const parsed = at(() => parse(st.text, PROGRAM_LIMITS.statement));
      nodes += parsed.count;
      const builtBefore = count.n;
      if (nodes > PROGRAM_LIMITS.nodes) throw new FormulaError(`Too big: ${PROGRAM_LIMITS.nodes} parts at most`, st.pos, which);
      if (st.kind === 'fn') {
        taken(st.name!, st.pos, which);
        for (const q of st.params!) if (!/^[A-Za-z_]\w*$/.test(q)) throw new FormulaError(`"${q}" can't be a name`, st.pos, which);
        // (its own copy of the names so far: it can't call itself, or anything named after it)
        names.set(st.name!, { t: 'fn', params: st.params!, body: parsed.node, env: { names: new Map(names), frame, inLoop: false }, nodes: parsed.count, pos: st.pos, part: which });
        return;
      }
      let v = at(() => build(parsed.node, { names, frame, inLoop: false, cache: !frame && keep, count }));
      if (!frame) pixelNodes += count.n - builtBefore;
      // (a value in the pixel part that's the same for every LED: once a frame)
      if (keep && !frame && !v.px && !v.kept && !(v.t === 'n' && v.k !== undefined)) v = perFrame(v);
      if (st.kind === 'value') { out = v; return; }
      taken(st.name!, st.pos, which);
      names.set(st.name!, { t: 'val', val: slotOf(v, steps) });
    });
    return out;
  };
  const frame: ((k: FormulaCtx) => void)[] = [], pixel: ((k: FormulaCtx) => void)[] = [];
  part(src.frame ?? '', 'frame', frame);
  const out = part(src.pixel, 'pixel', pixel);
  if (!out) throw new FormulaError('The pixel part has to end with the colour (or the brightness) of the LED', src.pixel.length, 'pixel');
  return { frame, pixel, out, nodes, cost: Math.max(1, pixelNodes) };
}
// Compiled once per distinct program (the key: its text and its knobs)
const programs = new Map<string, Program | FormulaError>();
export function compileProgramCached(src: { frame?: string; pixel: string }, params: ProgramParam[] = []): Program | FormulaError {
  const key = JSON.stringify([src.frame ?? '', src.pixel, params.map((q) => [q.id, q.type])]);
  let p = programs.get(key);
  if (!p) {
    try { p = compileProgram(src, params); } catch (e) { p = e instanceof FormulaError ? e : new FormulaError(String(e), 0, 'pixel'); }
    if (programs.size > 200) programs.clear();
    programs.set(key, p);
  }
  return p;
}
// Once a frame, before the LEDs: the frame part, and the budget starts again.
export function runFrame(p: Program, k: FormulaCtx) { k.work = 0; k.frame++; for (const s of p.frame) s(k); }
// One LED: its colour ([r, g, b], the program's own buffer) or a brightness.
export function runPixel(p: Program, k: FormulaCtx): number | Float64Array {
  k.work += p.cost;
  if (k.work > k.budget) throw new FormulaError(`Too much to work out in one frame (${PROGRAM_LIMITS.work} steps at most)`, 0, 'pixel');
  for (const s of p.pixel) s(k);
  return p.out.f(k);
}

// Formulas to start from (the editor's examples; the first is the effect's default).
export const EXAMPLES: { name: string; formula: string }[] = [
  { name: 'Rainbow wave', formula: 'hsv(x - c, 1, 1)' },
  { name: 'Comet', formula: 'pow(1 - frac(c - x), 6)' },
  { name: 'Sparkle', formula: 'step(0.9, random(i, floor(t * 6))) * (1 - frac(t * 6))' },
  { name: 'Breathing', formula: '0.08 + 0.92 * wave(c)' },
  { name: 'Police', formula: 'x < 0.5 ? rgb(1, 0, 0) * square(c * 4, 0.3) * (c < 0.5) : rgb(0, 0.1, 1) * square(c * 4, 0.3) * (c >= 0.5)' },
  { name: 'Fire', formula: 'hsv(0.1 * noise(x * 9, t * 3), 1, 0.25 + 0.75 * noise(x * 12 + 5, t * 6))' },
  { name: 'Plasma', formula: 'hsv(wave(x + c) + 0.5 * wave(x * 2.3 - c * 1.7 + row * 0.3), 1, 0.6 + 0.4 * wave(x * 3 - c))' },
  { name: 'Beat flash', formula: 'frac(beat) < 0.15 ? rgb(1, 1, 1) : 0.15' },
  { name: 'Bass bar', formula: 'x < bass ? hsv(0.33 - 0.33 * x, 1, 1) : 0' },
];
