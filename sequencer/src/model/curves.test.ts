// An effect bar's knobs over its length (model/timeline.ts curves): straight lines between the
// points, their values before the first and after the last; what the bars playing at a moment set
// their effects' knobs to; a curve from a file kept only when it can be one. The engine runs an
// effect with them over its own values, the show itself unchanged.
import { describe, expect, it } from 'vitest';
import { cleanCurve, curveAt, curvesAt, validItem, type TimelineItem } from './timeline';
import { Engine } from '../engine/engine';
import { emptyShow } from './format';

describe('a curve', () => {
  const c = { knob: 'speed' as const, pts: [[0.2, 1], [0.6, 3], [1, 2]] as [number, number][] };
  it('straight between its points, flat before the first and after the last', () => {
    expect(curveAt(c, 0)).toBe(1); expect(curveAt(c, 0.4)).toBeCloseTo(2, 6); expect(curveAt(c, 0.8)).toBeCloseTo(2.5, 6); expect(curveAt(c, 1)).toBe(2);
  });
  it('the bars playing at a moment: their effects\' knobs; outside a bar, nothing', () => {
    const items: TimelineItem[] = [{ id: 'a', at: 10, len: 10, lane: 'fx', do: { do: 'effect', effect: 'e1', on: true }, curves: [c] }];
    expect(curvesAt(items, 14)).toEqual({ e1: { speed: 2 } });
    expect(curvesAt(items, 9)).toEqual({}); expect(curvesAt(items, 20)).toEqual({});
  });
  it('from a file: a knob there is and two points or more, in order; else it goes, the bar stays', () => {
    expect(cleanCurve({ knob: 'size', pts: [[1, 0.5], [0, 0.2]] })).toEqual({ knob: 'size', pts: [[0, 0.2], [1, 0.5]] });
    expect(cleanCurve({ knob: 'colour', pts: [[0, 1], [1, 2]] })).toBeUndefined();
    expect(cleanCurve({ knob: 'size', pts: [[0, 1]] })).toBeUndefined();
    const it = { id: 'b', at: 0, len: 4, lane: 'fx', do: { do: 'effect', effect: 'e', on: true }, curves: [{ knob: 'size', pts: 'no' }] } as unknown as TimelineItem;
    expect(validItem(it)).toBe(true); expect(it.curves).toBeUndefined();
  });
});

describe('the engine', () => {
  it('runs an effect with the curves\' knobs over its own, the show unchanged', () => {
    const s = emptyShow();
    s.fixtures.push({ id: 'd', name: 'D', typeId: 'gen-dimmer', mode: '', universe: 0, address: 1, x: 0.5, y: 0.5 } as never);
    s.effects.push({ id: 'e', name: 'Pulse', kind: 'pulse', fixtures: ['d'], params: { speed: 4, low: 0, high: 1 } } as never);
    let now = 0;
    const eng = new Engine(() => s, () => now);
    eng.startEffect('e', 0);
    const levels = () => { const out: number[] = []; for (now = 0; now < 4; now += 0.05) out.push(eng.tick().frames.get(0)![0]); return out; };
    const own = levels();
    eng.fxOver = { e: { low: 0.8 } };
    const over = levels();
    expect(Math.min(...own)).toBeLessThan(40);
    expect(Math.min(...over)).toBeGreaterThan(180);               // (never below 80 %)
    expect(s.effects[0].params).toEqual({ speed: 4, low: 0, high: 1 });
  });
});
