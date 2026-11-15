// A live page's Add menu: each kind of control made from what the show has, none when it has
// nothing for it, the set list's three.
import { describe, expect, it } from 'vitest';
import { newWidget, nothingFor, songWidgets } from './newWidget';
import { emptyShow } from '../model/format';
import type { CueList } from '../model/types';

let n = 0;
const id = () => `w${++n}`;

describe('a new control', () => {
  it('from an empty show: only what needs nothing', () => {
    const s = emptyShow();
    for (const k of ['list', 'cue', 'effect', 'group', 'cuelist'] as const) expect(newWidget(s, k, { fog: [], id }), k).toBeUndefined();
    expect(newWidget(s, 'fader', { fog: [], id })).toMatchObject({ type: 'fader', target: 'grand' });
    expect(newWidget(s, 'special', { fog: [], id })).toMatchObject({ type: 'special', do: 'blackout' });
    expect(newWidget(s, 'drop', { fog: [], id })).toMatchObject({ type: 'special', do: 'drop', label: 'Drop' });
    expect(newWidget(s, 'label', { fog: [], id })).toMatchObject({ type: 'label', label: 'New section' });
    expect(nothingFor('effect')).toMatch(/effect/); expect(nothingFor('cue')).toMatch(/cues/);
  });
  it('from a show with a list, an effect, a group and fog machines', () => {
    const s = emptyShow();
    const l: CueList = { id: 'L', name: 'Moods', end: 'stop', cues: [{ id: 'c1', name: 'Warm', values: {}, fade: 0, advance: { mode: 'manual' } }] };
    s.cueLists.push(l);
    s.effects.push({ id: 'e1', name: 'Pulse', kind: 'pulse', fixtures: [], params: {} } as never);
    s.groups.push({ id: 'g1', name: 'Front', fixtures: [] } as never);
    const o = { list: l, fog: ['f1', 'f2'], id };
    expect(newWidget(s, 'list', o)).toMatchObject({ type: 'list', list: 'L', action: 'go' });
    expect(newWidget(s, 'cue', o)).toMatchObject({ type: 'cue', list: 'L', cue: 'c1' });
    expect(newWidget(s, 'effect', o)).toMatchObject({ type: 'effect', effect: 'e1', action: 'toggle' });
    expect(newWidget(s, 'group', o)).toMatchObject({ type: 'group', group: 'g1', level: 1 });
    expect(newWidget(s, 'fog', o)).toMatchObject({ type: 'fog', fixtures: ['f1', 'f2'], max: 10 });
    expect(newWidget(s, 'cuelist', o)).toMatchObject({ type: 'cuelist', list: 'L' });
  });
  it("the set list's three, each its own id", () => {
    const w = songWidgets(id);
    expect(w.map((x) => (x as { do: string }).do)).toEqual(['play', 'next', 'part']);
    expect(new Set(w.map((x) => x.id)).size).toBe(3);
  });
});
