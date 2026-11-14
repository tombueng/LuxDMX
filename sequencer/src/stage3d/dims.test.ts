// @vitest-environment happy-dom
// A light's own size (Fixture.dims, over its type's physical.dims): a strip or a bar its length, a
// ring or a matrix its width, any other light drawn that much bigger; kept in the show file only
// when it can be right. And a strip's colours in the order its chips want them.
import { describe, expect, it } from 'vitest';
import { GENERIC, kindOf, pixelShape } from '../model/library';
import { rigFixtureFull } from './rigOf';
import { HALL } from './geometry';
import { lookWidth } from './models';
import { shapeW } from '../model/pixelLayout';
import { emptyShow, parseShow, serializeShow } from '../model/format';
import type { Fixture, FixtureType } from '../model/types';

const rf = (t: FixtureType, own: Partial<Fixture> = {}) => {
  const m = t.modes[0];
  return rigFixtureFull({ id: 'x', name: 'x', typeId: t.id, mode: m.name, universe: 0, address: 1, x: 0.5, y: 0.5, ...own } as Fixture, m, kindOf(m), t, HALL);
};
const generic = (id: string) => GENERIC.find((g) => g.id === id)!;

describe('a light\'s own size on the 3D stage', () => {
  it('a bar or a strip without a layout: its length', () => {
    expect(rf(generic('gen-strip144')).barLen).toBeUndefined();                         // (as it comes: by its pixels)
    expect(rf(generic('gen-strip144'), { dims: { w: 11.3 } }).barLen).toBe(11.3);
  });
  it('a strip or a matrix with a layout: its width; its type\'s when it has none of its own', () => {
    const t = pixelShape('s', 'strip', { kind: 'matrix', cols: 144, rows: 1 }, false, 'user', 'GRB');
    t.physical = { dims: { w: 2.4 } };
    const r = rf(t);
    expect(r.size! * shapeW(r.shape!)).toBeCloseTo(2.4, 5);
    const own = rf(t, { dims: { w: 5 } });
    expect(own.size! * shapeW(own.shape!)).toBeCloseTo(5, 5);
  });
  it('any other light: drawn that much bigger (its width against its kind\'s)', () => {
    const par = generic('gen-drgbw'), r = rf(par, { dims: { w: lookWidth(rf(par).look) * 2 } });
    expect(r.scale).toBeCloseTo(2, 5);
    expect(rf(par).scale).toBeUndefined();
  });
});

describe('a pixel\'s colour order', () => {
  it('GRB: green, red, blue for each pixel; RGBW: a white after each; none: RGB', () => {
    const at = (o?: 'GRB' | 'RGBW') => pixelShape('p', 'p', { kind: 'matrix', cols: 2, rows: 1 }, o === 'RGBW', 'user', o).modes[0].channels.map((c) => `${c.attr}${c.cell}`);
    expect(at('GRB')).toEqual(['green0', 'red0', 'blue0', 'green1', 'red1', 'blue1']);
    expect(at('RGBW')).toEqual(['red0', 'green0', 'blue0', 'white0', 'red1', 'green1', 'blue1', 'white1']);
    expect(at()).toEqual(['red0', 'green0', 'blue0', 'red1', 'green1', 'blue1']);
  });
});

describe('in the show file', () => {
  it('kept when it can be right, said and left out when it can\'t', () => {
    const s = emptyShow();
    s.fixtures.push({ id: 'a', name: 'A', typeId: 'gen-strip144', mode: '', universe: 0, address: 1, x: 0.5, y: 0.5, dims: { w: 11.3 } } as Fixture,
      { id: 'b', name: 'B', typeId: 'gen-strip144', mode: '', universe: 1, address: 1, x: 0.5, y: 0.5, dims: { w: -2, h: 'big' } as never } as Fixture);
    const notes: string[] = [], back = parseShow(serializeShow(s), notes);
    expect(back.fixtures[0].dims).toEqual({ w: 11.3 });
    expect(back.fixtures[1].dims).toBeUndefined();
    expect(notes.join(' ')).toMatch(/size .* can't be right/);
  });
});
