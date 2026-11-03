// The Formula effect's little language: one expression per pixel, like `hsv(x - c, 1, 1)`.
// Shows travel between people, so a formula must never be able to run code: it's read by our own
// parser into a tree of small closures (no eval, no new Function), it can only reach the names
// below, and it's bounded in length, nesting and size. A number result is a brightness, a colour
// result (hsv, rgb, pal) a colour with its brightness.
import type { Color } from '../model/types';
import { TAU, along, frac, hash, mix, tri } from './fxkit';

// What a formula can read, per pixel. One object, refilled for every pixel (no allocation).
export interface FormulaCtx {
  x: number; u: number; i: number; n: number; row: number; rows: number;
  t: number; beat: number; c: number; phase: number; bass: number; rnd: number; size: number;
  colors: Color[];
}
export const newCtx = (): FormulaCtx => ({ x: 0, u: 0, i: 0, n: 1, row: 0, rows: 1, t: 0, beat: 0, c: 0, phase: 0, bass: 0, rnd: 0, size: 1, colors: [] });

type NumFn = (k: FormulaCtx) => number;
type ColFn = (k: FormulaCtx) => Float64Array;     // [r, g, b]: the node's own buffer, refilled each time
type Val = { t: 'n'; f: NumFn; k?: number } | { t: 'c'; f: ColFn };
export type Formula = { type: 'num'; num: NumFn; nodes: number } | { type: 'col'; col: ColFn; nodes: number };

export class FormulaError extends Error {
  constructor(message: string, public pos: number) { super(message); }
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
};
const VAR_FN: Record<string, NumFn> = {
  x: (k) => k.x, u: (k) => k.u, i: (k) => k.i, n: (k) => k.n, row: (k) => k.row, rows: (k) => k.rows,
  t: (k) => k.t, beat: (k) => k.beat, c: (k) => k.c, phase: (k) => k.phase, bass: (k) => k.bass, rnd: (k) => k.rnd, size: (k) => k.size,
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
};
// Colour functions (they make a colour from numbers).
export const COLOR_FUNCTIONS: Record<string, { args: number; help: string }> = {
  hsv: { args: 3, help: 'hsv(hue, saturation, brightness): hue 0 to 1 goes round the rainbow' },
  rgb: { args: 3, help: 'rgb(red, green, blue), each 0 to 1' },
  pal: { args: 1, help: 'pal(p): the colour at p along the effect\'s palette' },
};
// own names only: "constructor" or "__proto__" are not names a formula can reach
const has = (o: object, k: string) => Object.hasOwn(o, k);
const ALL_NAMES = [...Object.keys(VARIABLES), ...Object.keys(CONSTANTS), ...Object.keys(FUNCTIONS), ...Object.keys(COLOR_FUNCTIONS)];

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

function parse(src: string): { node: Node; count: number } {
  if (src.length > LIMITS.length) throw new FormulaError(`Too long: ${src.length} characters, ${LIMITS.length} at most`, LIMITS.length);
  if (!src.trim()) throw new FormulaError('Type a formula, for example hsv(x - c, 1, 1)', 0);
  const ts = tokens(src);
  let p = 0, count = 0, depth = 0;
  const peek = () => ts[p];
  const isOp = (v: string) => { const t = ts[p]; return t.k === 'op' && t.v === v; };
  const made = <T extends Node>(n: T): T => {
    if (++count > LIMITS.nodes) throw new FormulaError(`Too big: ${LIMITS.nodes} parts at most`, n.pos);
    return n;
  };
  const deeper = (pos: number) => { if (++depth > LIMITS.depth) throw new FormulaError(`Too many brackets inside each other (${LIMITS.depth} at most)`, pos); };
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
function apply(f: (...a: number[]) => number, args: Val[]): Val {
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

function build(n: Node): Val {
  switch (n.k) {
    case 'num': return konst(n.v);
    case 'name': {
      if (has(VAR_FN, n.v)) return num(VAR_FN[n.v]);
      if (has(CONSTANTS, n.v)) return konst(CONSTANTS[n.v]);
      if (has(FUNCTIONS, n.v) || has(COLOR_FUNCTIONS, n.v)) throw new FormulaError(`${n.v} needs brackets: ${n.v}(…)`, n.pos);
      const near = nearest(n.v);
      throw new FormulaError(`Unknown name "${n.v}"${near ? `. Did you mean ${near}?` : ''}`, n.pos);
    }
    case 'un': {
      const a = build(n.a);
      if (n.op === '!') {
        if (a.t === 'c') throw new FormulaError('"!" works on numbers, not on a colour', n.pos);
        return apply((v) => +!v, [a]);
      }
      return apply((v) => -v, [a]);
    }
    case 'bin': {
      const a = build(n.a), b = build(n.b);
      if (NUM_ONLY.has(n.op) && (a.t === 'c' || b.t === 'c')) throw new FormulaError(`"${n.op}" works on numbers, not on colours`, n.pos);
      return apply(BIN[n.op], [a, b]);
    }
    case 'if': {
      const c = build(n.c);
      if (c.t === 'c') throw new FormulaError('A colour can\'t decide a "?": compare a number', n.pos);
      const a = build(n.a), b = build(n.b), cf = c.f as NumFn;
      if (c.k !== undefined) return c.k ? a : b;
      if (a.t === 'n' && b.t === 'n') { const af = a.f, bf = b.f; return num((k) => (cf(k) ? af(k) : bf(k))); }
      const ac = asColor(a).f, bc = asColor(b).f;
      return { t: 'c', f: (k) => (cf(k) ? ac(k) : bc(k)) };
    }
    case 'call': {
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
      const args = n.args.map(build);
      if (cf) {
        if (args.some((a) => a.t === 'c')) throw new FormulaError(`${n.name} takes numbers, not a colour`, n.pos);
        const [a, b, c] = args.map((v) => v.f as NumFn);
        if (n.name === 'pal') return col((k, o) => { const p = along(k.colors, a(k)); o[0] = p.r; o[1] = p.g; o[2] = p.b; });
        if (n.name === 'rgb') return col((k, o) => { o[0] = a(k); o[1] = b(k); o[2] = c(k); });
        return col((k, o) => hsvInto(a(k), b(k), c(k), o));
      }
      for (let i = args.length; i < hi && fn!.fill; i++) args.push(konst(fn!.fill[i - lo]));
      return apply(fn!.f, args);
    }
  }
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
