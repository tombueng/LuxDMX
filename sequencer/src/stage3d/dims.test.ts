// @vitest-environment happy-dom
// A light's own size (Fixture.dims, over its type's physical.dims): a strip or a bar its length (and
// its face across and depth), a ring or a matrix its width, any other light drawn that much bigger;
// kept in the show file only when it can be right. And a strip's colours in the order its chips want them.
import { describe, expect, it } from 'vitest';
import { GENERIC, kindOf, pixelShape } from '../model/library';
import { rigFixtureFull } from './rigOf';
import { HALL } from './geometry';
import { body, lookWidth } from './models';
import { BAR_DEPTH, BAR_FACE, FIXED_SIZE, barLength, fixedLookOf } from './lightSize';
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
  it('a bar without a layout: its face across and its depth too (a wide LED column); as it comes without', () => {
    const bar = generic('gen-bar12');
    expect(rf(bar, { dims: { w: 2.4, h: 0.4, d: 0.12 } })).toMatchObject({ barLen: 2.4, barFace: 0.4, barDepth: 0.12 });
    const plain = rf(bar);
    expect([plain.barLen, plain.barFace, plain.barDepth]).toEqual([undefined, undefined, undefined]);
    expect([BAR_FACE, BAR_DEPTH, barLength(12), barLength(60)]).toEqual([0.1, 0.08, 1, 2]);
    // (the body as it comes is that size: a face of its own is drawn so much wider)
    const g = body('bar').geo; g.computeBoundingBox();
    const bb = g.boundingBox!;
    expect(bb.max.z - bb.min.z).toBeCloseTo(BAR_FACE, 6); expect(bb.max.y - bb.min.y).toBeCloseTo(BAR_DEPTH, 6); expect(bb.max.y).toBeCloseTo(0, 6);
    // (a PAR has no face of its own: h and d are a bar's)
    expect(rf(generic('gen-drgbw'), { dims: { h: 0.4 } }).barFace).toBeUndefined();
  });
  it('a PAR, a fresnel, a blinder, a strobe: its own face (h) and depth (d) stretch it just that way, over its width', () => {
    const par = generic('gen-drgbw');
    expect(rf(par, { dims: { h: 0.56 } })).toMatchObject({ scaleZ: 2 });
    expect(rf(par, { dims: { h: 0.56 } }).scale).toBeUndefined(); expect(rf(par, { dims: { h: 0.56 } }).scaleY).toBeUndefined();
    const both = rf(par, { dims: { w: 0.56, d: 0.15 } });
    expect(both.scale).toBeCloseTo(2, 5); expect(both.scaleY).toBeCloseTo(0.5, 5); expect(both.scaleZ).toBeUndefined();
    // (each its own over its type's: the type's width, the light's own depth)
    const t = { ...par, id: 'p2', physical: { dims: { w: 0.56 } } } as FixtureType;
    const mixed = rf(t, { dims: { d: 0.6 } });
    expect(mixed.scale).toBeCloseTo(2, 5); expect(mixed.scaleY).toBeCloseTo(2, 5);
    // (a moving head grows all of a piece: no face or depth of its own)
    const head = rf(generic('gen-wash'), { dims: { h: 1, d: 1 } });
    expect([head.scaleY, head.scaleZ]).toEqual([undefined, undefined]);
  });
  it('the sizes as they come: a fixed light as wide as its model is drawn, its face and depth inside its model', () => {
    for (const [look, z] of Object.entries(FIXED_SIZE)) {
      expect(z.w, look).toBeCloseTo(lookWidth(look as never), 3);
      const g = body(look as never).geo; g.computeBoundingBox();
      const bb = g.boundingBox!;
      expect(z.h, look).toBeLessThanOrEqual(bb.max.z - bb.min.z + 1e-6); expect(z.d, look).toBeLessThanOrEqual(bb.max.y - bb.min.y + 1e-6);
      expect(rf(generic(look === 'par' ? 'gen-drgbw' : look === 'strobe' ? 'gen-strobe' : look === 'blinder' ? 'gen-blinder2' : 'gen-dimmer')).look, look).toBe(look);
    }
    expect([fixedLookOf('par'), fixedLookOf('strobe'), fixedLookOf('dimmer', 'Blinder, 2-lite'), fixedLookOf('dimmer', 'Dimmer'), fixedLookOf('mover'), fixedLookOf('bar')])
      .toEqual(['par', 'strobe', 'blinder', 'fresnel', undefined, undefined]);
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
