// The micro shows of the library's previews: each light shows what it can do.
import { describe, expect, it } from 'vitest';
import { microShow, prismValue, turnValue, hue, SHOW_LEN } from './microShow';
import { GENERIC } from '../model/library';
import { rigFixtureFull } from './rigOf';
import { kindOf } from '../model/library';
import { HALL } from './geometry';
import type { Fixture } from '../model/types';
import { prismOf, rotationOf } from './gobos';

const show = (typeId: string) => {
  const t = GENERIC.find((x) => x.id === typeId)!, m = t.modes[0], k = kindOf(m);
  const f: Fixture = { id: 'f1', name: 'x', typeId, mode: m.name, universe: 0, address: 1, x: 0.5, y: 0.5 } as Fixture;
  const rf = rigFixtureFull(f, m, k, t, HALL);
  return { rf, s: microShow(rf, m) };
};
const over = <T>(s: { at(t: number): T }, n = 80) => Array.from({ length: n }, (_, i) => s.at((i / n) * SHOW_LEN));

describe('micro shows', () => {
  it('a gobo spot: sweeps, runs through its gobos turning, its prism in for the second half', () => {
    const { rf, s } = show('gen-spotgobo');
    expect(rf.look).toBe('spot');
    expect(s.does).toEqual(expect.arrayContaining(['pan and tilt', 'turning gobos', 'prism']));
    const vs = over(s);
    expect(new Set(vs.map((v) => v.gobo)).size).toBeGreaterThan(2);                  // several gobos
    expect(vs.every((v) => (v.intensity ?? 0) > 0.9)).toBe(true);
    const pans = vs.map((v) => v.pan!); expect(Math.max(...pans) - Math.min(...pans)).toBeGreaterThan(0.2);
    expect(vs.slice(0, 30).some((v) => v.prism !== undefined)).toBe(false);
    expect(vs.slice(45).every((v) => v.prism !== undefined)).toBe(true);
    // the gobo turns (a speed, not a fixed angle)
    const r = rotationOf(rf.gobos![0].rot, vs[0].goboRotation!); expect('speed' in r && Math.abs(r.speed) > 0.2).toBe(true);
  });
  it('a wash breathes its zoom through the colours', () => {
    const { rf, s } = show('gen-wash');
    expect(rf.look).toBe('wash');
    const vs = over(s), zs = vs.map((v) => v.zoom!);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.8);
    expect(new Set(vs.map((v) => `${v.color!.r.toFixed(1)}${v.color!.g.toFixed(1)}${v.color!.b.toFixed(1)}`)).size).toBeGreaterThan(5);
  });
  it('a PAR runs its colours (and a strobe burst when it has one); a dimmer breathes', () => {
    const par = over(show('gen-drgbws').s);
    expect(par.some((v) => v.strobe)).toBe(true);
    expect(new Set(par.map((v) => v.color!.r.toFixed(1) + v.color!.b.toFixed(1))).size).toBeGreaterThan(4);
    const dim = over(show('gen-dimmer').s).map((v) => v.intensity!);
    expect(Math.max(...dim) - Math.min(...dim)).toBeGreaterThan(0.7);
  });
  it('a pixel bar chases along its pixels; a moving bar waves its heads', () => {
    const bar = show('gen-bar8');
    expect(bar.s.at(1).cells).toHaveLength(bar.rf.cells);
    const hb = show('gen-headbar4');
    expect(hb.rf.look).toBe('headbar');
    const tilts = hb.s.at(1).cells!.map((c) => c.tilt!);
    expect(new Set(tilts.map((x) => x.toFixed(2))).size).toBe(4);                      // each its own
  });
  it('a strobe flashes', () => {
    expect(over(show('gen-strobe').s).some((v) => (v.strobe ?? 0) > 0.5)).toBe(true);
  });
  it('helpers: a turning value, a prism value, the colour wheel round', () => {
    expect(turnValue(undefined)).not.toBeNull();
    expect(turnValue([{ from: 0, to: 255, label: 'Stop' }])).toBeNull();
    const pr = [{ from: 0, to: 9, label: 'Open' }, { from: 10, to: 127, label: '3-facet prism' }, { from: 128, to: 255, label: '8-facet linear prism' }];
    const v = prismValue(pr)!; expect(prismOf(pr, v)).toEqual({ facets: 3, linear: false });
    expect(hue(0)).toEqual({ r: 1, g: 0, b: 0 });
    expect(hue(1 / 3).g).toBeCloseTo(1);
  });
  it('a row of colour PARs: each light its own place round the colours', async () => {
    const { GENERIC, kindOf } = await import('../model/library');
    const { rigFixtureFull } = await import('./rigOf');
    const { HALL } = await import('./geometry');
    const t = GENERIC.find((x) => x.id === 'gen-drgbw')!, m = t.modes[0];
    const rf = rigFixtureFull({ id: 'f', name: 'x', typeId: t.id, mode: m.name, universe: 0, address: 1, x: 0.5, y: 0.5 } as never, m, kindOf(m), t, HALL);
    const s = microShow(rf, m, 'colour'), cs = [0, 1, 2, 3].map((i) => JSON.stringify(s.at(1, i, 4).color));
    expect(new Set(cs).size).toBe(4);
  });
});
