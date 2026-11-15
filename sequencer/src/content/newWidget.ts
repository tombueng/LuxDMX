// A new control for a live page (its Add menu), made from what the show has: a cue list button for
// the list on Live, a scene for its first cue, the first effect, the first group, every fog machine.
// undefined when the show has nothing for it yet (no cues, no effect, no group). The set list's
// controls come as three: Play / pause and Next song big, Next part beside them.
import type { CueList, Show, Widget } from '../model/types';

export type NewKind = Widget['type'] | 'drop';

export function newWidget(show: Show, kind: NewKind, o: { list?: CueList; fog: string[]; id: () => string }): Widget | undefined {
  const l = o.list, fx = show.effects[0], base = { id: o.id() };
  switch (kind) {
    case 'list': return l ? { ...base, type: 'list', list: l.id, action: 'go' } : undefined;
    case 'cue': return l?.cues[0] ? { ...base, type: 'cue', list: l.id, cue: l.cues[0].id } : undefined;
    case 'effect': return fx ? { ...base, type: 'effect', effect: fx.id, action: 'toggle' } : undefined;
    case 'fader': return { ...base, type: 'fader', target: 'grand' };
    case 'group': return show.groups[0] ? { ...base, type: 'group', group: show.groups[0].id, level: 1 } : undefined;
    case 'fog': return { ...base, type: 'fog', fixtures: o.fog, level: 1, burst: 3, max: 10, label: 'Fog' };
    case 'special': return { ...base, type: 'special', do: 'blackout' };      // (no label: it follows what it does)
    case 'cuelist': return l ? { ...base, type: 'cuelist', list: l.id } : undefined;
    case 'drop': return { ...base, type: 'special', do: 'drop', label: 'Drop' };
    default: return { ...base, type: 'label', label: 'New section' };
  }
}

export const songWidgets = (id: () => string): Widget[] =>
  [{ id: id(), type: 'song', do: 'play', size: 2 }, { id: id(), type: 'song', do: 'next', size: 2 }, { id: id(), type: 'song', do: 'part' }];

// what to say when there's nothing for it yet
export const nothingFor = (kind: NewKind) => (kind === 'effect' ? 'Make an effect first (Program, Effects)' : kind === 'group' ? 'Make a group first (Program, Groups)' : 'Record some cues first');
