// The parts every effect is made of never throw, whatever they're given: a NaN or an endless number
// (from 1/x in a formula, 1e999 in a file) or a palette with a hole in it. One throw in the frame
// and nothing goes out at all.
import { describe, expect, it } from 'vitest';
import type { Color } from '../model/types';
import { EFFECTS, paramsOf, runEffect, type Where } from './effects';
import { KNOBS, PALETTES, along, clamp01, cleanColors, cleanParams, frac, hsv, lerpColor, noise, sine, step, tri, type FxOut } from './fxkit';

const ODD = [NaN, Infinity, -Infinity, -5, 1e300, -1e300, 0, 1, 0.5, -1e-20];
const in01 = (v: number) => v >= 0 && v <= 1;
const isColor01 = (c: Color) => in01(c.r) && in01(c.g) && in01(c.b);

describe('fxkit: odd numbers in, sensible numbers out', () => {
  it('frac, clamp01, sine, tri and noise stay in 0..1', () => {
    for (const v of ODD) for (const f of [frac, clamp01, sine, (x: number) => tri(frac(x)), (x: number) => noise(7, x)]) expect(in01(f(v)), `${f}(${v})`).toBe(true);
    expect(frac(-1e-20)).toBe(0);           // (v - floor(v) rounds to 1 there: that's 0 again)
    expect(frac(2.25)).toBe(0.25);
    expect(tri(NaN)).toBe(0);
  });
  it('hsv, along and step give a colour in 0..1 for any number, and a missing colour is white', () => {
    const holes = [{ r: 1, g: 0, b: 0 }, null as unknown as Color, undefined as unknown as Color];
    for (const v of ODD) {
      expect(isColor01(hsv(v, v, v)), `hsv(${v})`).toBe(true);
      expect(isColor01(hsv(v, 1, 1)), `hsv(${v}, 1, 1)`).toBe(true);
      for (const cs of [PALETTES.Rainbow, holes, []]) {
        expect(isColor01(along(cs, v)), `along(${v})`).toBe(true);
        expect(isColor01(step(cs, v)), `step(${v})`).toBe(true);
      }
    }
    expect(along(holes, 0.5)).toEqual({ r: 1, g: 1, b: 1 });
    expect(lerpColor(null as unknown as Color, { r: 0, g: 0, b: 0 }, 0.5)).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
    expect(hsv(0, 1, 1)).toEqual({ r: 1, g: 0, b: 0 });              // (unchanged where it was right)
    expect(hsv(1 / 3, 1, 1)).toEqual({ r: 0, g: 1, b: 0 });
  });
  it('cleanParams: every knob back in its range, the palette only colours', () => {
    for (const [k, r] of Object.entries(KNOBS)) {
      for (const v of ODD) {
        const p = cleanParams(paramsOf('rainbow', {}));
        (p as unknown as Record<string, number>)[k] = v;
        cleanParams(p);
        const got = (p as unknown as Record<string, number>)[k];
        expect(got >= r.lo && got <= r.hi, `${k} ${v} -> ${got}`).toBe(true);
      }
    }
    const p = paramsOf('gradient', {});
    p.colors = [null, { r: NaN, g: 0, b: 0 }, { r: 2, g: -1, b: 0.5 }, 'red'] as unknown as Color[];
    expect(cleanParams(p).colors).toEqual([{ r: 1, g: 0, b: 0.5 }]);
    p.colors = 7 as unknown as Color[];
    expect(cleanParams(p).colors).toBe(PALETTES.Rainbow);
    expect(cleanColors([{ r: 0.2, g: 0.4, b: 0.6 }])).toEqual([{ r: 0.2, g: 0.4, b: 0.6 }]);
    // right ones stay as they are (the same objects: nothing copied every frame)
    const fine = paramsOf('gradient', {}), colors = fine.colors;
    expect(cleanParams(fine).colors).toBe(colors);
  });
});

// Every effect there is, with every knob set to something hostile, run over a strip on 3 lights
// at a few moments: nothing throws, every level and colour is in 0..1, moves stay finite.
describe('every effect with hostile knobs', () => {
  const n = 12, where: Where[] = Array.from({ length: n }, (_, i) => ({ u: (i % 4) / 3, row: Math.floor(i / 4), rows: 3 }));
  const okOut = (o: FxOut) => (o.intensity === undefined || in01(o.intensity)) && (o.strike === undefined || in01(o.strike))
    && (!o.color || isColor01(o.color)) && (o.pan === undefined || Math.abs(o.pan) <= 1) && (o.tilt === undefined || Math.abs(o.tilt) <= 1);
  const cases: [string, Record<string, unknown>][] = [];
  for (const k of [...Object.keys(KNOBS), 'sound']) for (const v of [NaN, Infinity, -Infinity, -5, 1e300]) cases.push([`${k} ${v}`, { [k]: v }]);
  cases.push(['colors with holes', { colors: [null, { r: NaN, g: 1, b: 0 }, { r: 1e300, g: -1, b: 0 }] }], ['no colours', { colors: [] }], ['colours not a list', { colors: 'red' }]);
  for (const def of EFFECTS) {
    it(def.id, () => {
      const bad: string[] = [];
      for (const [name, stored] of cases) {
        const p = cleanParams(paramsOf(def.id, stored));
        if (stored.sound !== undefined) { p.sound = stored.sound as number; cleanParams(p); }
        for (const t of [0, 0.37, 1.5, 40.2]) {
          const outs = runEffect(def, p, n, t, 5, where, { beats: t * 2, secs: t });
          const wrong = outs.find((o) => !okOut(o));
          if (wrong) bad.push(`${name} at ${t}: ${JSON.stringify(wrong)}`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});
