// The output thread keeps what an effect runs on and with per show copy (it gets a new copy after
// every edit). An edit (a new copy: another light in the effect) and the timeline's curves changing
// a knob must still reach the wire; the page's engine, whose show changes in place, keeps nothing.
import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { emptyShow } from '../model/format';
import type { Show } from '../model/types';

const show = (fixtures: string[]): Show => {
  const s = emptyShow();
  for (const [i, id] of ['a', 'b'].entries()) s.fixtures.push({ id, name: id, typeId: 'gen-dimmer', mode: '', universe: 0, address: i + 1, x: 0.5, y: 0.5 } as never);
  s.effects.push({ id: 'e', name: 'Pulse', kind: 'pulse', fixtures, params: { speed: 4, low: 0, high: 1 } } as never);
  return s;
};
const run = (thread: boolean) => {
  let s = show(['a']), now = 0;
  const eng = new Engine(() => s, () => now);
  eng.cacheTracks = thread;
  eng.startEffect('e', 0);
  const frames = (ch: number) => { const out: number[] = []; for (let k = 0; k < 80; k++) { now += 0.05; out.push(eng.tick().frames.get(0)![ch]); } return out; };
  return { eng, frames, swap: (next: Show) => { s = next; } };
};

describe('an effect\'s setup kept per show copy', () => {
  for (const thread of [true, false]) it(`${thread ? 'the thread' : 'the page'}: a new copy with another light in it, and a curve's knob, both reach the wire`, () => {
    const r = run(thread);
    expect(Math.max(...r.frames(1))).toBe(0);                   // b isn't in it yet
    r.swap(show(['a', 'b']));                                    // the edit: a new copy of the show
    expect(Math.max(...r.frames(1))).toBeGreaterThan(200);       // b pulses now
    r.eng.fxOver = { e: { low: 0.8 } };                          // the timeline's curve lifts its low
    expect(Math.min(...r.frames(0))).toBeGreaterThan(180);
    r.eng.fxOver = {};
    expect(Math.min(...r.frames(0))).toBeLessThan(40);
  });
});

// "Stop effects" holds until a cue comes on (a GO, a list started): another list stopping is no new
// cue, and it undid the stop
describe('cue effects stopped by hand', () => {
  it('stay stopped when another list stops; a GO brings them back', () => {
    const s = show(['a']);
    s.cueLists.push({ id: 'A', name: 'A', end: 'stop', cues: [
      { id: 'a1', name: 'Pulse', values: { a: { intensity: 1 } }, effects: ['e'], fade: 0, advance: { mode: 'manual' } },
      { id: 'a2', name: 'Pulse again', values: { a: { intensity: 1 } }, effects: ['e'], fade: 0, advance: { mode: 'manual' } }] } as never,
      { id: 'B', name: 'B', end: 'stop', cues: [{ id: 'b1', name: 'Other', values: { b: { intensity: 0.5 } }, fade: 0, advance: { mode: 'manual' } }] } as never);
    let now = 0;
    const eng = new Engine(() => s, () => now);
    const weight = () => { for (let k = 0; k < 30; k++) { now += 0.05; eng.tick(); } return eng.fxWeights.get('e') ?? 0; };
    eng.go('A'); eng.go('B');
    expect(weight()).toBeGreaterThan(0.9);
    eng.muteCueEffects();
    expect(weight()).toBe(0);
    eng.stop('B');                                   // another list goes: still stopped
    expect(weight()).toBe(0);
    eng.go('A');                                     // a GO: the cue's own effects again
    expect(weight()).toBeGreaterThan(0.9);
  });
});
