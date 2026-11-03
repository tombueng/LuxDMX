// What changed between two versions of a show, in a few words ("light “Par 3” removed",
// "2 cues changed"), for Undo and Redo to say what they did. Worked out from the two snapshots,
// so every action gets it without having to name itself.
import type { Show } from './types';

interface Item { id: string; name?: string; label?: string }
interface Kind { one: string; many: string; items: (s: Show) => Item[] }

const KINDS: Kind[] = [
  { one: 'light', many: 'lights', items: (s) => s.fixtures },
  { one: 'cue', many: 'cues', items: (s) => s.cueLists.flatMap((l) => l.cues) },
  { one: 'cue list', many: 'cue lists', items: (s) => s.cueLists.map((l) => ({ ...l, cues: undefined })) },
  { one: 'effect', many: 'effects', items: (s) => s.effects },
  { one: 'preset', many: 'presets', items: (s) => s.presets },
  { one: 'group', many: 'groups', items: (s) => s.groups },
  { one: 'button', many: 'buttons', items: (s) => s.pages.flatMap((p) => p.widgets) as Item[] },
  { one: 'live page', many: 'live pages', items: (s) => s.pages.map((p) => ({ ...p, widgets: undefined })) },
  { one: 'fixture type', many: 'fixture types', items: (s) => s.fixtureTypes },
];

const say = (k: Kind, list: Item[], what: string) =>
  list.length === 1 && (list[0].name || list[0].label) ? `${k.one} “${list[0].name || list[0].label}” ${what}` : `${list.length === 1 ? k.one : `${list.length} ${k.many}`} ${what}`;

// `before` and `after` in the order the change happened (for an undo: the restored version first).
export function describeChange(before: Show, after: Show): string {
  const out: string[] = [];
  for (const k of KINDS) {
    const a = k.items(before), b = k.items(after);
    const ia = new Map(a.map((x) => [x.id, x])), ib = new Map(b.map((x) => [x.id, x]));
    const added = b.filter((x) => !ia.has(x.id)), removed = a.filter((x) => !ib.has(x.id));
    const changed: Item[] = [], moved: Item[] = [];
    for (const x of b) {
      const y = ia.get(x.id);
      if (!y || JSON.stringify(x) === JSON.stringify(y)) continue;
      // a light dragged on the stage is "moved", not "changed"
      if (k.one === 'light' && JSON.stringify({ ...x, x: 0, y: 0 }) === JSON.stringify({ ...y, x: 0, y: 0 })) moved.push(x); else changed.push(x);
    }
    if (added.length) out.push(say(k, added, 'added'));
    if (removed.length) out.push(say(k, removed, 'removed'));
    if (changed.length) out.push(say(k, changed, 'changed'));
    if (moved.length) out.push(say(k, moved, 'moved'));
    if (!added.length && !removed.length && !changed.length && !moved.length) {
      const order = (l: Item[]) => l.map((x) => x.id).join();
      if (order(a) !== order(b)) out.push(`${k.many} reordered`);
    }
    if (out.length >= 2) break;
  }
  if (!out.length) {
    if (before.meta.name !== after.meta.name) out.push(`show renamed to “${after.meta.name}”`);
    else if (JSON.stringify(before.settings.stage) !== JSON.stringify(after.settings.stage)) out.push('stage picture');
    else if (before.settings.bpm !== after.settings.bpm) out.push(`tempo ${after.settings.bpm} BPM`);
    else if (JSON.stringify(before.outputs) !== JSON.stringify(after.outputs)) out.push('boxes');
  }
  return out.slice(0, 2).join(', ') || 'a change';
}
