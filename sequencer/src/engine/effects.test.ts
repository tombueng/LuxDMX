import { describe, expect, it } from 'vitest';
import { EFFECTS, EFFECT_MAP, arrange, paramsOf, runEffect } from './effects';
import { withContrast } from './fxkit';
import { Engine } from './engine';
import { emptyShow } from '../model/format';
import type { Show } from '../model/types';

const def = (id: string) => EFFECT_MAP.get(id)!;
const lit = (id: string, n: number, total: number, extra: Record<string, unknown> = {}) =>
  runEffect(def(id), paramsOf(id, extra), n, total).map((o) => (o.intensity ?? 0) > 0.5 ? 1 : 0);

describe('effect maths', () => {
  it('chase walks one light along per step', () => {
    expect(lit('chase', 4, 0)).toEqual([1, 0, 0, 0]);
    expect(lit('chase', 4, 0.26)).toEqual([0, 1, 0, 0]);
    expect(lit('chase', 4, 0.8)).toEqual([0, 0, 0, 1]);
    expect(lit('chase', 4, 1.01)).toEqual([1, 0, 0, 0]);   // and around again
  });
  it('backward starts at the other end', () => {
    expect(lit('chase', 4, 0, { direction: 'backward' })).toEqual([0, 0, 0, 1]);
  });
  it('bounce lands on both ends and comes back', () => {
    expect(lit('pingpong', 4, 0)).toEqual([1, 0, 0, 0]);
    expect(lit('pingpong', 4, 0.5)).toEqual([0, 0, 0, 1]);
    expect(lit('pingpong', 4, 0.75)).toEqual([0, 1, 0, 0]);
  });
  it('in and out mirror the group', () => {
    expect(lit('chase', 4, 0, { direction: 'in' })).toEqual([1, 0, 0, 1]);
    expect(lit('chase', 4, 0, { direction: 'out' })).toEqual([0, 1, 1, 0]);
  });
  it('blocks move neighbours together', () => {
    expect(arrange(3, 4, paramsOf('chase', { blocks: 2 }), 1)).toEqual({ k: 1, m: 2 });
    expect(lit('chase', 4, 0, { blocks: 2 })).toEqual([1, 1, 0, 0]);
  });
  it('random direction is a stable shuffle', () => {
    const p = paramsOf('chase', { direction: 'random' });
    const ks = [0, 1, 2, 3, 4, 5].map((i) => arrange(i, 6, p, 42).k);
    expect([...ks].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect([0, 1, 2, 3, 4, 5].map((i) => arrange(i, 6, p, 42).k)).toEqual(ks);
  });
  it('spread 0 keeps every light together, spread 1 spaces them over a cycle', () => {
    const together = runEffect(def('pulse'), paramsOf('pulse'), 5, 0.3).map((o) => o.intensity);
    expect(new Set(together).size).toBe(1);
    const wave = runEffect(def('wave'), paramsOf('wave'), 4, 0).map((o) => +(o.intensity ?? 0).toFixed(3));
    expect(wave).toEqual([0, 0.5, 1, 0.5]);
  });
  it('low and high set the range', () => {
    const v = runEffect(def('pulse'), paramsOf('pulse', { low: 0.2, high: 0.6 }), 1, 0.5)[0].intensity!;
    expect(v).toBeCloseTo(0.6);
    expect(runEffect(def('pulse'), paramsOf('pulse', { low: 0.2, high: 0.6 }), 1, 0)[0].intensity).toBeCloseTo(0.2);
  });
  it('rainbow gives every light its own hue', () => {
    const cols = runEffect(def('rainbow'), paramsOf('rainbow'), 3, 0).map((o) => o.color!);
    expect(cols[0]).toEqual({ r: 1, g: 0, b: 0 });
    expect(new Set(cols.map((c) => JSON.stringify(c))).size).toBe(3);
  });
  it('circle stays within its size and goes round', () => {
    const p = paramsOf('circle', { size: 0.4 });
    const a = runEffect(def('circle'), p, 1, 0)[0], b = runEffect(def('circle'), p, 1, 0.25)[0];
    expect(a.pan).toBeCloseTo(0); expect(a.tilt).toBeCloseTo(0.2);
    expect(b.pan).toBeCloseTo(0.2); expect(b.tilt).toBeCloseTo(0);
  });
  it('every built-in runs and stays in range', () => {
    for (const d of EFFECTS) {
      for (const t of [0, 0.13, 0.5, 0.77, 3.4]) {
        for (const o of runEffect(d, paramsOf(d.id), 7, t)) {
          if (o.intensity !== undefined) { expect(o.intensity).toBeGreaterThanOrEqual(0); expect(o.intensity).toBeLessThanOrEqual(1); }
          if (o.color) for (const v of [o.color.r, o.color.g, o.color.b]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
          if (o.pan !== undefined) expect(Math.abs(o.pan)).toBeLessThanOrEqual(0.5);
        }
      }
    }
  });
  it('bad stored knobs fall back to defaults', () => {
    const p = paramsOf('chase', { speed: 'fast', blocks: 0, colors: 3 });
    expect(p.speed).toBe(2); expect(p.blocks).toBe(1); expect(Array.isArray(p.colors)).toBe(true);
  });
});

// A show with 4 RGB PARs, a pixel bar, a mover and a fog machine.
function rig(): Show {
  const s = emptyShow('fx');
  s.fixtures = [
    ...[0, 1, 2, 3].map((i) => ({ id: `p${i}`, name: `PAR ${i}`, typeId: 'gen-rgb', mode: '', universe: 0, address: 1 + i * 3, x: i / 4, y: 0.5 })),
    { id: 'bar', name: 'Bar', typeId: 'gen-bar8', mode: '', universe: 0, address: 20, x: 0.5, y: 0.2 },
    { id: 'mv', name: 'Head', typeId: 'gen-mover8', mode: '', universe: 0, address: 50, x: 0.5, y: 0.1 },
    { id: 'fog', name: 'Fog', typeId: 'gen-fog', mode: '', universe: 0, address: 60, x: 0.9, y: 0.9 },
  ];
  s.groups = [{ id: 'pars', name: 'PARs', fixtures: ['p0', 'p1', 'p2', 'p3'] }];
  return s;
}
function clockEngine(s: Show) {
  let t = 0;
  const e = new Engine(() => s, () => t);
  const at = (sec: number) => { while (t < sec - 1e-9) { t = Math.min(sec, t + 0.025); e.tick(); } return e.tick(); };
  return { e, at };
}
const rgbAt = (buf: Uint8Array, addr: number) => [buf[addr - 1], buf[addr], buf[addr + 1]];

describe('effects in the engine', () => {
  it('a chase started by hand walks along the PARs at the tempo', () => {
    const s = rig();
    s.effects = [{ id: 'fx1', name: 'Chase', kind: 'chase', group: 'pars', params: { speed: 4, tempo: true } }];
    const { e, at } = clockEngine(s);
    e.bpm = 120;                    // 4 beats = 2 s per cycle, 0.5 s per PAR
    e.startEffect('fx1');
    let f = at(0.6).frames.get(0)!; // 0.6 s: PAR 1 (fade-in done at 0.4 s)
    expect([0, 1, 2, 3].map((i) => f[i * 3])).toEqual([0, 255, 0, 0]);
    f = at(1.6).frames.get(0)!;
    expect([0, 1, 2, 3].map((i) => f[i * 3])).toEqual([0, 0, 0, 255]);
    e.stopEffect('fx1');
    f = at(2.5).frames.get(0)!;
    expect([...f.slice(0, 12)].every((v) => v === 0)).toBe(true);
    expect(e.fxWeights.size).toBe(0);
  });
  it('a rainbow on a pixel bar colours every cell differently and lights it up', () => {
    const s = rig();
    s.effects = [{ id: 'rb', name: 'Rainbow', kind: 'rainbow', fixtures: ['bar'], params: {} }];
    const { e, at } = clockEngine(s);
    e.startEffect('rb');
    const fr = at(0.5);
    const cells = [...Array(8).keys()].map((c) => rgbAt(fr.frames.get(0)!, 20 + c * 3).join(','));
    expect(new Set(cells).size).toBe(8);
    expect(fr.stage.bar.cells).toHaveLength(8);
    expect(fr.look.bar.cells).toBeUndefined();          // Record never sees effect output
  });
  it('a circle moves the head around where it points', () => {
    const s = rig();
    s.effects = [{ id: 'c', name: 'Circle', kind: 'circle', fixtures: ['mv', 'p0'], params: { size: 0.4, tempo: false, speed: 4 } }];
    const { e, at } = clockEngine(s);
    e.programmer = { mv: { pan: 0.5, tilt: 0.5, intensity: 1 } };
    e.startEffect('c');
    const pans = [0.5, 1.5, 2.5, 3.5].map((t) => at(t).stage.mv.pan!);
    expect(Math.max(...pans) - Math.min(...pans)).toBeGreaterThan(0.25);
    expect(at(4).stage.p0.pan).toBe(0.5);                // PARs don't move
  });
  it('effects in a cue run with it and fade out with the next cue', () => {
    const s = rig();
    s.effects = [{ id: 'pulse', name: 'Pulse', kind: 'pulse', group: 'pars', params: { speed: 1, tempo: false } }];
    s.cueLists = [{ id: 'l', name: 'L', end: 'stop', cues: [
      { id: 'a', name: 'A', values: { p0: { intensity: 1 } }, fade: 0, advance: { mode: 'manual' }, effects: ['pulse'] },
      { id: 'b', name: 'B', values: { p0: { intensity: 1 } }, fade: 1, advance: { mode: 'manual' } },
    ] }];
    const { e, at } = clockEngine(s);
    e.go('l');
    at(0.25);
    expect(e.fxWeights.get('pulse')).toBe(1);
    e.go('l');
    at(0.75);
    expect(e.fxWeights.get('pulse')).toBeCloseTo(0.5, 1);
    at(1.4);
    expect(e.fxWeights.has('pulse')).toBe(false);
  });
  it('the live layer drives fog on top, outside the look', () => {
    const s = rig();
    const { e, at } = clockEngine(s);
    e.live = { fog: { fog: 1 } };
    const fr = at(0.1);
    expect(fr.frames.get(0)![59]).toBe(255);
    expect(fr.look.fog.fog).toBeUndefined();
  });
  it('blackout and grand master reach pixel cells too', () => {
    const s = rig();
    s.effects = [{ id: 'rb', name: 'Rainbow', kind: 'rainbow', fixtures: ['bar'], params: {} }];
    const { e, at } = clockEngine(s);
    e.startEffect('rb');
    e.blackout = true;
    const f = at(0.5).frames.get(0)!;
    expect([...f.slice(19, 43)].every((v) => v === 0)).toBe(true);
  });
  it('handing live effects to a cue keeps them running', () => {
    const s = rig();
    s.effects = [{ id: 'w', name: 'Wave', kind: 'wave', group: 'pars', params: {} }];
    s.cueLists = [{ id: 'l', name: 'L', end: 'stop', cues: [] }];
    const { e, at } = clockEngine(s);
    e.startEffect('w');
    at(0.5);
    const ids = e.takeLiveEffects();
    s.cueLists[0].cues.push({ id: 'c', name: 'C', values: {}, fade: 0, advance: { mode: 'manual' }, effects: ids });
    e.jumpTo('l', 0, 0);
    at(0.55);
    expect(e.fxWeights.get('w')).toBe(1);
    expect(e.liveEffects()).toEqual([]);
  });
});

describe('effects in stage order', () => {
  it('left to right follows x, whatever the list order', () => {
    const s = rig();
    s.fixtures.find((f) => f.id === 'p0')!.x = 0.9;          // the first in the list stands on the right
    s.effects = [{ id: 'c', name: 'Chase', kind: 'chase', group: 'pars', params: { order: 'x', tempo: false, speed: 4 } }];
    const { e, at } = clockEngine(s);
    e.startEffect('c');
    const f = at(0.6).frames.get(0)!;                       // 0.6 s of a 4 s round: the first step
    // p1 is now the leftmost (x 0.25): lit; p0 (moved right) is last
    expect([0, 1, 2, 3].map((i) => f[i * 3])).toEqual([0, 255, 0, 0]);
  });
  it('back to front follows y, from the centre out starts in the middle', () => {
    const s = rig();
    s.fixtures.filter((f) => f.id.startsWith('p')).forEach((f, i) => { f.y = [0.8, 0.2, 0.5, 0.6][i]; f.x = [0.1, 0.5, 0.48, 0.95][i]; });
    s.effects = [{ id: 'c', name: 'Chase', kind: 'chase', group: 'pars', params: { order: 'y', tempo: false, speed: 4 } }];
    const { e, at } = clockEngine(s);
    e.startEffect('c');
    expect([0, 1, 2, 3].map((i) => at(0.6).frames.get(0)![i * 3])).toEqual([0, 255, 0, 0]);      // p1: y 0.2, the back
    s.effects[0].params = { order: 'centre', tempo: false, speed: 4 };
    // centre of the four: x 0.5075, y 0.525; p2 (0.48, 0.5) is nearest
    expect([0, 1, 2, 3].map((i) => at(4.6).frames.get(0)![i * 3])).toEqual([0, 0, 255, 0]);
  });
});

describe('colour effects and the lights\' levels', () => {
  // PAR 0 at 40% from a cue, a rainbow by hand on all four PARs
  function setup() {
    const s = rig();
    s.cueLists = [{ id: 'l', name: 'L', end: 'stop', releaseTime: 2, cues: [{ id: 'c', name: 'C', values: { p0: { intensity: 0.4 } }, fade: 0, advance: { mode: 'manual' } }] }];
    s.effects = [{ id: 'rb', name: 'Rainbow', kind: 'rainbow', group: 'pars', params: {} }];
    const ctx = clockEngine(s);
    ctx.e.go('l'); ctx.e.startEffect('rb');
    return ctx;
  }
  const level = (f: Uint8Array, i: number) => Math.max(f[i * 3], f[i * 3 + 1], f[i * 3 + 2]);
  it('a light a cue holds keeps its level; the others come up with the effect', () => {
    const { at } = setup();
    const f = at(1).frames.get(0)!;
    expect(level(f, 0)).toBeLessThanOrEqual(103);       // 40% (the brightest emitter of its colour)
    expect(level(f, 1)).toBe(255);
  });
  it('releasing the cue hands the light over to the effect without a jump', () => {
    const { e, at } = setup();
    at(1);
    e.release('l');
    let last = level(at(1.025).frames.get(0)!, 0), worst = 0;
    for (let t = 1.05; t < 3.5; t += 0.025) { const v = level(at(t).frames.get(0)!, 0); worst = Math.max(worst, Math.abs(v - last)); last = v; }
    expect(last).toBe(255);
    expect(worst).toBeLessThan(20);                      // no step from ~1% to full at the end
  });
  it('a cue with a fade taking a light over from the effect fades across, no dip to black', () => {
    const s = rig();
    s.cueLists = [{ id: 'l', name: 'L', end: 'stop', releaseTime: 2, cues: [{ id: 'c', name: 'C', values: { p1: { intensity: 0.8 } }, fade: 2, advance: { mode: 'manual' } }] }];
    s.effects = [{ id: 'rb', name: 'Rainbow', kind: 'rainbow', group: 'pars', params: {} }];
    const { e, at } = clockEngine(s);
    e.startEffect('rb');
    expect(level(at(1).frames.get(0)!, 1)).toBe(255);    // lit by the rainbow
    e.go('l');
    let low = 255;
    for (let t = 1.025; t < 3.2; t += 0.025) low = Math.min(low, level(at(t).frames.get(0)!, 1));
    expect(low).toBeGreaterThan(150);                    // full -> 80% across the fade, never near black
    expect(level(at(3.5).frames.get(0)!, 1)).toBeLessThanOrEqual(205);
  });
  it('a list pulled down on its master stays dimmed under a light-up effect (it still owns the light)', () => {
    const { e, at } = setup();
    e.setMaster('l', 0.5);
    expect(level(at(1.5).frames.get(0)!, 0)).toBeLessThanOrEqual(52);   // 40% at half: 20%
    expect(level(at(1.5).frames.get(0)!, 1)).toBe(255);                 // the others still come up
  });
});

describe('contrast', () => {
  const def = EFFECTS.find((d) => d.id === 'plasmaClouds')!, n = 64;
  const levels = (params: Record<string, unknown>) => runEffect(def, paramsOf('plasmaClouds', params), n, 1.3).map((o) => o.intensity!);
  it('0 is the effect as it is; up pushes towards the ends, down pulls towards the middle', () => {
    const plain = levels({}), hard = levels({ contrast: 1 }), soft = levels({ contrast: -1 });
    expect(levels({ contrast: 0 })).toEqual(plain);
    plain.forEach((v, i) => {
      if (v < 0.49) { expect(hard[i]).toBeLessThanOrEqual(v); expect(soft[i]).toBeGreaterThanOrEqual(v); }
      if (v > 0.51) { expect(hard[i]).toBeGreaterThanOrEqual(v); expect(soft[i]).toBeLessThanOrEqual(v); }
    });
  });
  it('dark stays dark and full stays full', () => {
    expect(withContrast(0, 1)).toBe(0); expect(withContrast(0, -1)).toBe(0);
    expect(withContrast(1, 1)).toBe(1); expect(withContrast(1, -1)).toBe(1);
    expect(withContrast(0.5, 0.7)).toBeCloseTo(0.5, 6);
    expect(withContrast(0.25, 1)).toBeCloseTo(0.5 * 0.5 ** 4, 6);
  });
  it('works between Dim to and Bright to, which stay its ends', () => {
    const v = levels({ contrast: 1, low: 0.2, high: 0.6 });
    for (const x of v) { expect(x).toBeGreaterThanOrEqual(0.2 - 1e-9); expect(x).toBeLessThanOrEqual(0.6 + 1e-9); }
  });
  it('a value from a file that isn\'t a contrast can\'t break a frame', () => {
    expect(paramsOf('plasmaClouds', { contrast: 9 }).contrast).toBe(1);
    expect(paramsOf('plasmaClouds', { contrast: -9 }).contrast).toBe(-1);
    expect(paramsOf('plasmaClouds', { contrast: 'hard' }).contrast).toBe(0);
    expect(paramsOf('plasmaClouds', { contrast: NaN }).contrast).toBe(0);
  });
  it('leaves effects without a level alone', () => {
    const d = EFFECTS.find((x) => x.id === 'circle')!;
    expect(runEffect(d, paramsOf('circle', { contrast: 1 }), 4, 0.3)).toEqual(runEffect(d, paramsOf('circle'), 4, 0.3));
  });
});
