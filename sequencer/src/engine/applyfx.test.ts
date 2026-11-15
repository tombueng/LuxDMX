// applyFx, the effect's output mixed onto the stage: every branch on a light, on its cells and on one
// cell (a colour from dark and over a colour, a strike, a level, a light the effect brings up while a
// cue holds it, a head's pan). Pinned numbers: it was rewritten without the closures it made per
// element (1900 elements a frame on the festival demo), and must mix exactly as before.
import { describe, expect, it } from 'vitest';
import { EFFECT_MAP, applyFx, paramsOf, type Target } from './effects';
import type { FxOut } from './fxkit';
import type { Resolved } from '../model/types';

const RED = { r: 1, g: 0, b: 0 }, BLUE = { r: 0, g: 0, b: 1 };
const close = (a: unknown, b: unknown) => expect(JSON.parse(JSON.stringify(a, (_k, v) => typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v))).toEqual(b);

describe('applyFx', () => {
  it('a colour: from dark it takes the effect\'s own, over a lit colour it fades by the weight', () => {
    const stage: Record<string, Resolved> = { a: { intensity: 0 }, b: { intensity: 1, color: BLUE, white: 1 } };
    const outs: FxOut[] = [{ color: RED }, { color: RED }];
    applyFx(stage, [{ fixture: 'a' }, { fixture: 'b' }], outs, EFFECT_MAP.get('rainbow')!, paramsOf('rainbow', { lightUp: false }), 0.25, () => 0);
    close(stage.a.color, RED);
    expect(stage.a.color).not.toBe(RED);   // (a copy: the effect's colour isn't shared with the stage)
    close(stage.b, { intensity: 1, color: { r: 0.25, g: 0, b: 0.75 }, white: 0.75 });
  });

  it('a strike flashes up to white, a level mixes in', () => {
    const stage: Record<string, Resolved> = { a: { intensity: 0.2, color: BLUE, white: 0 }, b: { intensity: 0.8 } };
    applyFx(stage, [{ fixture: 'a' }, { fixture: 'b' }], [{ strike: 1 }, { intensity: 0 }], EFFECT_MAP.get('chase')!, paramsOf('chase'), 0.5, () => 0);
    close(stage.a, { intensity: 0.5, color: { r: 0.5, g: 0.5, b: 1 }, white: 0.5 });
    close(stage.b, { intensity: 0.4 });
  });

  it('brings a light up by what nothing else holds of it, a cell by the light and that cell', () => {
    const stage: Record<string, Resolved> = { a: { intensity: 0 }, p: { intensity: 0, cellLvl: new Float64Array(3) } };
    const held = new Map([['a', 0.5], ['p#1', 0.75]]), base = new Map([['a', 0.1]]);
    const t: Target[] = [{ fixture: 'a' }, { fixture: 'p' }, { fixture: 'p', cell: 1 }];
    applyFx(stage, t, [{ color: RED }, { color: BLUE }, { color: RED }], EFFECT_MAP.get('rainbow')!, paramsOf('rainbow'), 0.8, (id) => (id === 'p' ? 3 : 0), held, base);
    expect(stage.a.intensity).toBeCloseTo(0.1 + 0.8 * 0.5);
    // the light and the cells nothing holds: all the way to the weight; cell 1, held at 0.75, by a quarter
    expect(stage.p.intensity).toBeCloseTo(0.8);
    close(stage.p.cells!.map((c) => c.intensity), [0.8, 0.2, 0.8]);
    // cell 1's own element on top: its colour now red over blue
    close(stage.p.cells![1].color, { r: 0.8, g: 0, b: 0.2 });
    close(stage.p.cells![0].color, BLUE);
  });

  it('pan and tilt: the light, one head of a bar, a bar that pans as one', () => {
    const stage: Record<string, Resolved> = { m: { pan: 0.5, tilt: 0.5 }, bar: { pan: 0.4, tilt: 0.5, cellLvl: Float64Array.of(1, 1) } };
    const t: Target[] = [{ fixture: 'm' }, { fixture: 'bar', cell: 0 }, { fixture: 'bar', cell: 1, barPan: true }];
    applyFx(stage, t, [{ pan: 0.2, tilt: -0.2 }, { pan: 0.1, tilt: 0.1 }, { pan: 0.2 }], EFFECT_MAP.get('circle')!, paramsOf('circle', { lightUp: false }), 0.5, () => 2);
    close([stage.m.pan, stage.m.tilt], [0.6, 0.4]);
    close([stage.bar.cells![0].pan, stage.bar.cells![0].tilt], [0.45, 0.55]);
    expect(stage.bar.pan).toBeCloseTo(0.5);
  });

  it('nothing at weight 0, and an element without a light is skipped', () => {
    const stage: Record<string, Resolved> = { a: { intensity: 0.3 } };
    applyFx(stage, [{ fixture: 'a' }], [{ intensity: 1 }], EFFECT_MAP.get('chase')!, paramsOf('chase'), 0, () => 0);
    expect(stage.a.intensity).toBe(0.3);
    expect(() => applyFx(stage, [{ fixture: 'gone' }, { fixture: 'a' }], [{ intensity: 1 }, { intensity: 1 }], EFFECT_MAP.get('chase')!, paramsOf('chase'), 1, () => 0)).not.toThrow();
    expect(stage.a.intensity).toBe(1);
  });
});
