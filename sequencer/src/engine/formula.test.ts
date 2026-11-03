import { describe, expect, it } from 'vitest';
import { EXAMPLES, FUNCTIONS, FormulaError, LIMITS, check, compile, compileCached, newCtx, type FormulaCtx } from './formula';
import { PALETTES } from './fxkit';
import { EFFECT_MAP, paramsOf, runEffect } from './effects';

const at = (vars: Partial<FormulaCtx> = {}): FormulaCtx => ({ ...newCtx(), colors: PALETTES.Rainbow, ...vars });
const num = (src: string, vars: Partial<FormulaCtx> = {}) => {
  const f = compile(src);
  if (f.type !== 'num') throw new Error('not a number');
  return f.num(at(vars));
};
const col = (src: string, vars: Partial<FormulaCtx> = {}) => {
  const f = compile(src);
  if (f.type !== 'col') throw new Error('not a colour');
  return [...f.col(at(vars))].map((v) => +v.toFixed(4));
};
const error = (src: string) => {
  try { compile(src); } catch (e) { if (e instanceof FormulaError) return { message: e.message, pos: e.pos }; throw e; }
  throw new Error(`no error for ${src}`);
};

describe('formula: reading and working out', () => {
  it('does arithmetic with the usual order', () => {
    expect(num('1 + 2 * 3')).toBe(7);
    expect(num('(1 + 2) * 3')).toBe(9);
    expect(num('2 ^ 3 ^ 2')).toBe(512);          // right to left
    expect(num('-2 ^ 2')).toBe(-4);              // the power first
    expect(num('2 ^ -1')).toBe(0.5);
    expect(num('10 - 4 - 3')).toBe(3);           // left to right
    expect(num('7 % 3')).toBe(1);
    expect(num('-0.25 % 1')).toBe(0.75);         // always positive, like frac
    expect(num('1.5e1 + .5')).toBe(15.5);
  });
  it('compares and decides (1 or 0)', () => {
    expect(num('2 > 1')).toBe(1);
    expect(num('2 <= 1')).toBe(0);
    expect(num('1 == 1 && 2 != 3')).toBe(1);
    expect(num('0 || 0')).toBe(0);
    expect(num('!0 + !5')).toBe(1);
    expect(num('x < 0.5 ? 10 : 20', { x: 0.2 })).toBe(10);
    expect(num('x < 0.5 ? 10 : x < 0.8 ? 20 : 30', { x: 0.7 })).toBe(20);
    expect(num('1 + 2 > 2 ? 1 : 0')).toBe(1);    // arithmetic before comparing
  });
  it('reads every variable', () => {
    const v = { x: 0.1, u: 0.2, i: 3, n: 8, row: 1, rows: 4, t: 2.5, beat: 5, c: 0.3, phase: 0.6, bass: 0.7, rnd: 0.42, size: 0.9 };
    for (const [k, val] of Object.entries(v)) expect(num(k, v)).toBe(val);
    expect(num('pi')).toBeCloseTo(Math.PI);
    expect(num('tau')).toBeCloseTo(Math.PI * 2);
  });
  it('has the functions, in turns where it says so', () => {
    expect(num('sin(pi / 2)')).toBeCloseTo(1);
    expect(num('wave(0)')).toBeCloseTo(0);
    expect(num('wave(0.5)')).toBeCloseTo(1);
    expect(num('wave(1.25)')).toBeCloseTo(0.5);
    expect(num('triangle(0.25)')).toBeCloseTo(0.5);
    expect(num('triangle(0.5)')).toBeCloseTo(1);
    expect(num('square(0.4)')).toBe(1);
    expect(num('square(0.6)')).toBe(0);
    expect(num('square(0.2, 0.25)')).toBe(1);
    expect(num('frac(-0.25)')).toBe(0.75);
    expect(num('min(3, 1, 2)')).toBe(1);
    expect(num('max(3, 1, 2)')).toBe(3);
    expect(num('clamp(1.5)')).toBe(1);
    expect(num('clamp(5, 2, 4)')).toBe(4);
    expect(num('mix(10, 20, 0.25)')).toBe(12.5);
    expect(num('step(0.5, 0.4)')).toBe(0);
    expect(num('smoothstep(0, 1, 0.5)')).toBe(0.5);
    expect(num('pow(2, 10) + sqrt(16) + abs(-1) + floor(1.7) + ceil(1.2)')).toBe(1024 + 4 + 1 + 1 + 2);
    expect(num('log(exp(2))')).toBeCloseTo(2);
  });
  it('noise and random stay the same for the same input and stay in 0..1', () => {
    expect(num('noise(3.3, 1.2)')).toBe(num('noise(3.3, 1.2)'));
    expect(num('random(4)')).toBe(num('random(4)'));
    expect(num('random(4)')).not.toBe(num('random(5)'));
    expect(num('random(4, 1)')).not.toBe(num('random(4, 2)'));
    expect(num('random(0.5)')).not.toBe(num('random(0.25)'));
    for (let k = 0; k < 200; k++) {
      const a = num('noise(x * 13.7, t)', { x: k / 7, t: k / 3 }), b = num('random(x)', { x: k * 0.37 });
      expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThan(1);
    }
    // smooth: close inputs, close values
    expect(Math.abs(num('noise(2.5)') - num('noise(2.501)'))).toBeLessThan(0.01);
  });
  it('makes colours, and does maths on them channel by channel', () => {
    expect(col('rgb(1, 0.5, 0)')).toEqual([1, 0.5, 0]);
    expect(col('hsv(0, 1, 1)')).toEqual([1, 0, 0]);
    expect(col('hsv(1/3, 1, 1)')).toEqual([0, 1, 0]);
    expect(col('hsv(2/3, 1, 0.5)')).toEqual([0, 0, 0.5]);
    expect(col('rgb(1, 0.5, 0) * 0.5')).toEqual([0.5, 0.25, 0]);
    expect(col('rgb(1, 0, 0) + rgb(0, 0, 1)')).toEqual([1, 0, 1]);
    expect(col('mix(rgb(1, 0, 0), rgb(0, 0, 1), 0.25)')).toEqual([0.75, 0, 0.25]);
    expect(col('pal(0)')).toEqual([1, 0, 0]);                            // the palette's first colour
    expect(col('pal(1 / 8)')).toEqual([1, 0.502, 0]);                    // its second (Rainbow: orange)
    expect(col('-rgb(1, 0, 0) + 1')).toEqual([0, 1, 1]);
  });
  it('a number on one side of a colour choice is that brightness in the palette colour at x', () => {
    expect(col('x < 0.5 ? rgb(0, 0, 1) : 0.5', { x: 0 })).toEqual([0, 0, 1]);
    expect(col('x < 0.5 ? rgb(0, 0, 1) : 0.5', { x: 0.5 })).toEqual([0, 0.5, 0.5]);    // Rainbow at 0.5: cyan, at half
  });
  it('odd values never break it (NaN, endless)', () => {
    expect(num('1 / 0')).toBe(Infinity);             // (an operator; the effect takes it as full)
    expect(num('sqrt(-1)')).toBe(0);                 // a function: NaN counts as 0
    expect(num('log(0)')).toBe(-1e9);                // endless as ±1e9
    expect(num('exp(1000)')).toBe(1e9);
    expect(num('sin(1 / 0)')).toBe(0);
    expect(col('hsv(sqrt(-1), 1, 1 / 0)')).toEqual([1, 0, 0]);
    expect(col('hsv(1 / 0, 2, -1)')).toEqual([0, 0, 0]);
    expect(col('pal(1 / x)', { x: 0 })).toEqual([1, 0, 0]);     // the palette's start, not a throw
    expect(col('pal(log(x))', { x: 0 })).toEqual([1, 0, 0]);
  });
  it('every function gives a finite number, whatever it is given', () => {
    const odd = [NaN, Infinity, -Infinity, 0, -0, -1, 1e308, -1e308, 5e-324, 0.5];
    for (const [name, fn] of Object.entries(FUNCTIONS)) {
      for (let n = fn.args[0]; n <= fn.args[1]; n++) {
        for (let k = 0; k < 200; k++) {
          const args = Array.from({ length: n }, (_, j) => odd[(k * (j + 3) + j * 7) % odd.length]);
          expect(Number.isFinite(fn.f(...args)), `${name}(${args.join(', ')})`).toBe(true);
        }
      }
    }
  });
  it('a formula that divides by zero, takes log(0) or sqrt(-1) or overflows never throws, and lights stay in range', () => {
    const def = EFFECT_MAP.get('formula')!;
    const bad = ['1 / x', 'log(x)', 'sqrt(-1)', 'x / 0', '0 / 0', '2 ^ 2000', 'pow(10, 400)', 'exp(1e6)', '-1 / x', 'tan(pi / 2) * 1e300',
      'pal(1 / x)', 'pal(log(x))', 'pal(c / x)', 'pal(sqrt(x - 0.5))', 'hsv(1 / x, log(x), sqrt(-1))', 'rgb(1 / x, -1 / x, 0 / 0)',
      'hsv(x, 1, 1) * (1 / x)', 'mix(rgb(1, 0, 0), pal(1 / x), log(x))', 'x / 0 % 0', 'noise(1 / x, log(x))', 'random(1 / x, 0 / 0)',
      'frac(1 / x) + triangle(log(x)) + square(1 / x, 0 / 0)', 'min(1 / x, log(x), 0 / 0)', '(1 / x) ? pal(log(x)) : 0 / 0'];
    for (const f of bad) {
      const p = paramsOf('formula', { formula: f });
      expect(check(f), f).toBeNull();
      for (const t of [0, 0.5, 1.25]) {
        for (const o of runEffect(def, p, 8, t)) {
          expect(o.intensity, f).toBeGreaterThanOrEqual(0); expect(o.intensity, f).toBeLessThanOrEqual(1);
          for (const v of [o.color!.r, o.color!.g, o.color!.b]) { expect(v, f).toBeGreaterThanOrEqual(0); expect(v, f).toBeLessThanOrEqual(1); }
        }
      }
    }
  });
  it('folds what is fixed (a constant formula is one value)', () => {
    expect(compile('2 * pi * 3 + sin(1)').type).toBe('num');
    expect(num('2 * pi * 3')).toBeCloseTo(6 * Math.PI);
  });
});

describe('formula: errors say what and where', () => {
  it('an unknown name, with a guess', () => {
    expect(error('x + bet')).toEqual({ message: 'Unknown name "bet". Did you mean beat?', pos: 4 });
    expect(error('time')).toEqual({ message: 'Unknown name "time". Did you mean t?', pos: 0 });
    expect(error('hvs(x, 1, 1)')).toEqual({ message: 'Unknown function "hvs". Did you mean hsv?', pos: 0 });
    expect(error('foobarbaz')).toEqual({ message: 'Unknown name "foobarbaz"', pos: 0 });
    expect(error('X')).toEqual({ message: 'Unknown name "X". Did you mean x?', pos: 0 });
  });
  it('brackets', () => {
    expect(error('sin(x')).toEqual({ message: 'This "(" is never closed', pos: 3 });
    expect(error('(x + 1')).toEqual({ message: 'This "(" is never closed', pos: 0 });
    expect(error('x + 1)')).toEqual({ message: 'This ")" has no "(" before it', pos: 5 });
    expect(error('sin(x 2)').pos).toBe(6);
    expect(error('sin').message).toBe('sin needs brackets: sin(…)');
    expect(error('x(2)').message).toBe('x is a value, not a function: write x * (…)');
  });
  it('how many values a function takes', () => {
    expect(error('sin(1, 2)')).toEqual({ message: 'sin takes 1 value, not 2', pos: 0 });
    expect(error('1 + hsv(1, 2)')).toEqual({ message: 'hsv takes 3 values, not 2', pos: 4 });
    expect(error('clamp()').message).toBe('clamp takes 1 to 3 values, not 0');
  });
  it('characters and operators it does not know', () => {
    expect(error('x # 2')).toEqual({ message: 'A formula can\'t have "#"', pos: 2 });
    expect(error('x = 1')).toEqual({ message: 'To compare, write == (two of them)', pos: 2 });
    expect(error('x & 1')).toEqual({ message: 'Write && (two of them)', pos: 2 });
    expect(error('2x')).toEqual({ message: 'Expected an operator (+ - * / …) before "x"', pos: 1 });
    expect(error('x +')).toEqual({ message: 'Something is missing at the end', pos: 3 });
    expect(error('x ? 1')).toEqual({ message: 'This "?" needs a ":" and the other choice', pos: 2 });
    expect(error('* 2').pos).toBe(0);
    expect(error('').message).toMatch(/^Type a formula/);
  });
  it('colours where numbers belong', () => {
    expect(error('rgb(1, 0, 0) > 0.5')).toEqual({ message: '">" works on numbers, not on colours', pos: 13 });
    expect(error('hsv(rgb(1, 0, 0), 1, 1)').message).toBe('hsv takes numbers, not a colour');
    expect(error('rgb(1, 0, 0) ? 1 : 0').message).toMatch(/A colour can't decide/);
    expect(error('!rgb(1, 1, 1)').message).toBe('"!" works on numbers, not on a colour');
  });
  it('limits: length, nesting and size', () => {
    expect(error('x+'.repeat(300) + 'x').message).toMatch(/^Too long: 601 characters, 500 at most/);
    expect(error('('.repeat(30) + 'x' + ')'.repeat(30)).message).toMatch(/^Too many brackets inside each other/);
    expect(error('-'.repeat(40) + 'x').message).toMatch(/^Too many brackets inside each other/);
    expect(error(Array.from({ length: 140 }, () => 'x').join('+')).message).toBe(`Too big: ${LIMITS.nodes} parts at most`);
    expect(() => compile('('.repeat(20) + 'x' + ')'.repeat(20))).not.toThrow();
  });
  it('reaches nothing outside its own names', () => {
    for (const src of ['constructor', 'toString(1)', '__proto__', 'valueOf()', 'hasOwnProperty(1)', 'window', 'globalThis', 'this', 'eval(1)', 'Function(1)', 'alert(1)', 'fetch(1)', 'process']) {
      expect(() => compile(src), src).toThrow(FormulaError);
    }
    expect(() => compile('"x"')).toThrow(FormulaError);
    expect(() => compile('x.y')).toThrow(FormulaError);
    expect(() => compile('x[0]')).toThrow(FormulaError);
    expect(() => compile('x; 1')).toThrow(FormulaError);
  });
  it('check() gives the error or null; compiled once per text', () => {
    expect(check('hsv(x, 1, 1)')).toBeNull();
    expect(check('hsv(x, 1')).toEqual({ message: 'This "(" is never closed', pos: 3 });
    expect(compileCached('x * 2')).toBe(compileCached('x * 2'));
  });
  it('every example reads, and stays in range for a strip over time', () => {
    for (const ex of EXAMPLES) {
      const f = compile(ex.formula);
      for (let k = 0; k < 300; k++) {
        const v = at({ x: (k % 60) / 59, u: (k % 60) / 59, i: k % 60, n: 60, t: k / 37, beat: k / 18, c: (k / 97) % 1, phase: (k / 31) % 1, rnd: (k * 0.618) % 1, bass: (k % 10) / 10 });
        const out = f.type === 'num' ? [f.num(v)] : [...f.col(v)];
        for (const o of out) { expect(Number.isFinite(o), ex.name).toBe(true); expect(o).toBeGreaterThanOrEqual(-1e-9); expect(o).toBeLessThanOrEqual(1 + 1e-9); }
      }
    }
  });
});
