// What's left pointing at something that's gone, after lights, lists, effects or groups were
// deleted (a template trimmed down to the rig you have): removed, so no button says "its target is
// gone", no moment on the timeline plays a list that isn't there, no effect runs on no lights, no
// confetti moment waits for a cannon that went. Run after every delete (app.prune).
import type { CueAction, Show, Widget } from './types';
import { songsOf } from './timeline';

export interface Pruned { effects: number; buttons: number; moments: number; actions: number; entries: number }

// moments that only a machine of that kind does something with (strobe and blinder hits use any light)
const MACHINE_BURSTS = new Set(['fog', 'confetti', 'flame', 'sparks', 'co2', 'bubbles']);

// `can(attr)`: some light of the show still has that attribute (a fog machine for 'fog')
export function prune(s: Show, can: (attr: string) => boolean = () => true): Pruned {
  const n: Pruned = { effects: 0, buttons: 0, moments: 0, actions: 0, entries: 0 };
  const fixtures = new Set(s.fixtures.map((f) => f.id));
  const groups = new Map(s.groups.map((g) => [g.id, g]));
  // effects on no lights at all
  const dead = new Set(s.effects.filter((e) => (e.group ? !(groups.get(e.group)?.fixtures.some((id) => fixtures.has(id))) : !(e.fixtures ?? []).some((id) => fixtures.has(id)))).map((e) => e.id));
  if (dead.size) { s.effects = s.effects.filter((e) => !dead.has(e.id)); n.effects = dead.size; }
  const lists = new Map(s.cueLists.map((l) => [l.id, l])), effects = new Set(s.effects.map((e) => e.id));
  const actionOk = (a: CueAction) => !('list' in a) || (lists.has(a.list) && (a.do !== 'goto' || lists.get(a.list)!.cues.some((c) => c.id === a.cue)));
  // cues: the lists they start and the effects they run
  for (const l of s.cueLists) for (const c of l.cues) {
    if (c.actions) { const k = c.actions.filter(actionOk); n.actions += c.actions.length - k.length; if (k.length) c.actions = k; else delete c.actions; }
    if (c.effects?.some((id) => !effects.has(id))) { const k = c.effects.filter((id) => effects.has(id)); if (k.length) c.effects = k; else delete c.effects; }
  }
  // buttons (a fog button keeps the machines that are still there)
  const buttonOk = (w: Widget) => {
    switch (w.type) {
      case 'list': case 'cuelist': return lists.has(w.list);
      case 'cue': return !!lists.get(w.list)?.cues.some((c) => c.id === w.cue);
      case 'effect': return effects.has(w.effect);
      case 'group': return groups.has(w.group);
      case 'fader': return w.target === 'list' ? lists.has(w.ref ?? '') : w.target === 'effect' ? effects.has(w.ref ?? '') : true;
      case 'fog': return w.fixtures.some((id) => fixtures.has(id));
      default: return true;
    }
  };
  for (const p of s.pages) {
    const k = p.widgets.filter(buttonOk);
    n.buttons += p.widgets.length - k.length;
    if (k.length !== p.widgets.length) p.widgets = k;
    for (const w of p.widgets) if (w.type === 'fog' && w.fixtures.some((id) => !fixtures.has(id))) w.fixtures = w.fixtures.filter((id) => fixtures.has(id));
  }
  // the timeline, every song of the set
  for (const tl of songsOf(s)) {
    const k = tl.items.filter((i) => {
      const a = i.do;
      if (a.do === 'effect') return effects.has(a.effect);
      if (a.do === 'burst') return !MACHINE_BURSTS.has(a.attr) || can(a.attr);
      return actionOk(a);
    });
    n.moments += tl.items.length - k.length;
    if (k.length !== tl.items.length) tl.items = k;
  }
  // the timetable
  const sch = s.settings.schedule;
  if (sch) {
    const k = sch.filter((e) => actionOk(e.do));
    n.entries += sch.length - k.length;
    if (k.length !== sch.length) { if (k.length) s.settings.schedule = k; else delete s.settings.schedule; }
  }
  return n;
}

// "3 buttons, 5 moments on the timeline": what went with it, for the toast ('' for nothing)
export function prunedText(p: Pruned): string {
  const say = (k: number, one: string, many = `${one}s`) => (k ? `${k} ${k === 1 ? one : many}` : '');
  return [say(p.effects, 'effect'), say(p.buttons, 'button'), say(p.moments, 'moment on the timeline', 'moments on the timeline'),
    say(p.actions, 'cue action'), say(p.entries, 'timetable entry', 'timetable entries')].filter(Boolean).join(', ');
}
