import { describe, expect, it } from 'vitest';
import { starterLooks } from './looks';
import { emptyShow } from '../model/format';
import { addStandardPresets } from './presets';
import type { Color, Fixture } from '../model/types';

let n = 0;
const id = (p: string) => `${p}${++n}`;
const fx = (i: string, x: number, typeId: string): Fixture => ({ id: i, name: i, typeId, mode: '', universe: 0, address: 1, x, y: 0.5 });

describe('starter looks', () => {
  const show = emptyShow();
  show.fixtures = [fx('p2', 0.9, 'rgb'), fx('p1', 0.1, 'rgb'), fx('d1', 0.5, 'dim'), fx('fog', 0.95, 'fog')];
  addStandardPresets(show);
  const caps = (fid: string) => ({ color: fid.startsWith('p'), position: false, cct: false, light: fid !== 'fog' });
  const { list, effects } = starterLooks(show, caps, id);
  const cue = (name: string) => list.cues.find((c) => c.name === name)!;

  it('makes the moods, the fog machine stays out of them', () => {
    expect(list.cues.map((c) => c.name)).toEqual(['Warm wash', 'Cool wash', 'Sunset', 'Ocean', 'Red and blue', 'Purple haze', 'Forest', 'Party']);
    expect(Object.keys(cue('Warm wash').values).sort()).toEqual(['d1', 'p1', 'p2']);
  });
  it('a gradient runs left to right on the stage, whatever the patch order', () => {
    const left = cue('Sunset').values.p1.color as Color, right = cue('Sunset').values.p2.color as Color;
    expect(left.g).toBeGreaterThan(right.g);          // orange on the left
    expect(right.b).toBeGreaterThan(left.b);          // magenta on the right
  });
  it('uses the colour presets where there are some, plain dimmers only get a level', () => {
    const red = show.presets.find((p) => p.name === 'Red')!.id;
    expect(cue('Red and blue').values.p1.color).toEqual({ preset: red });
    expect(cue('Sunset').values.d1).toEqual({ intensity: 0.9 });
  });
  it('the party look brings a rainbow on the colour lights', () => {
    expect(cue('Party').effects).toEqual([effects[0].id]);
    expect(effects[0]).toMatchObject({ kind: 'rainbow', fixtures: ['p1', 'p2'] });
  });
});
