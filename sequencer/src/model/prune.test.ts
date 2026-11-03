// Trimming a template down to the rig you have: what pointed at the lights, lists and effects that
// went goes too (no "its target is gone" button, no moment playing a list that isn't there, no
// effect on no lights, no confetti moment without a cannon), and nothing else is touched.
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../content/templates';
import { buildDemo } from '../content/demo';
import { prune, prunedText } from './prune';
import { songsOf } from './timeline';
import { modeOf, typeMap } from './library';
import type { Show } from './types';

const band = () => TEMPLATES.find((t) => t.name === 'Band')!.build();
const canOf = (s: Show) => { const types = typeMap(s); return (attr: string) => s.fixtures.some((f) => modeOf(types.get(f.typeId), f.mode)?.channels.some((c) => c.attr === attr)); };
// every reference in the show still points at something
function dangling(s: Show): string[] {
  const lists = new Map(s.cueLists.map((l) => [l.id, l])), fx = new Set(s.effects.map((e) => e.id)), fixtures = new Set(s.fixtures.map((f) => f.id)), groups = new Set(s.groups.map((g) => g.id));
  const out: string[] = [];
  const act = (a: { do: string; list?: string; cue?: string }, where: string) => {
    if (a.list !== undefined && !lists.has(a.list)) out.push(`${where}: list`);
    if (a.do === 'goto' && !lists.get(a.list!)?.cues.some((c) => c.id === a.cue)) out.push(`${where}: cue`);
  };
  for (const e of s.effects) if (!(e.group ? groups.has(e.group) : e.fixtures?.some((id) => fixtures.has(id)))) out.push(`effect ${e.name}`);
  for (const l of s.cueLists) for (const c of l.cues) { for (const a of c.actions ?? []) act(a, `cue ${c.name}`); for (const id of c.effects ?? []) if (!fx.has(id)) out.push(`cue ${c.name}: effect`); }
  for (const p of s.pages) for (const w of p.widgets) {
    if ((w.type === 'list' || w.type === 'cuelist' || w.type === 'cue') && !lists.has(w.list)) out.push(`button ${w.label ?? w.type}`);
    if (w.type === 'effect' && !fx.has(w.effect)) out.push(`button ${w.label ?? 'effect'}`);
    if (w.type === 'fog' && w.fixtures.some((id) => !fixtures.has(id))) out.push('fog button');
  }
  for (const tl of songsOf(s)) for (const i of tl.items) { const a = i.do; if (a.do === 'effect') { if (!fx.has(a.effect)) out.push('moment: effect'); } else if (a.do !== 'burst') act(a, 'moment'); }
  for (const e of s.settings.schedule ?? []) act(e.do, 'timetable');
  return out;
}

describe('pruning what points at something gone', () => {
  it('a whole template, untouched: nothing goes', () => {
    for (const t of TEMPLATES) {
      const s = t.build(), before = JSON.stringify(s);
      expect(prune(s, canOf(s)), t.name).toEqual({ effects: 0, buttons: 0, moments: 0, actions: 0, entries: 0 });
      expect(JSON.stringify(s), t.name).toBe(before);
    }
  });
  it('the Band template without its lights of one kind and without a list: nothing left dangling', () => {
    const s = band();
    const types = typeMap(s);
    // every pixel bar goes (their effects with them), and the first list
    s.fixtures = s.fixtures.filter((f) => !types.get(f.typeId)?.id.startsWith('gen-bar'));
    const gone = s.cueLists[0];
    s.cueLists = s.cueLists.slice(1);
    for (const g of s.groups) g.fixtures = g.fixtures.filter((id) => s.fixtures.some((f) => f.id === id));
    const p = prune(s, canOf(s));
    expect(dangling(s)).toEqual([]);
    expect(p.buttons + p.effects + p.moments + p.actions).toBeGreaterThan(0);
    expect(s.pages.flatMap((pg) => pg.widgets).some((w) => 'list' in w && w.list === gone.id)).toBe(false);
  });
  it('the big demo without its confetti cannons: their moments go, the rest of the timeline stays', () => {
    const s = buildDemo(), can = canOf(s);
    const confetti = new Set(s.fixtures.filter((f) => modeOf(typeMap(s).get(f.typeId), f.mode)?.channels.some((c) => c.attr === 'confetti')).map((f) => f.id));
    expect(confetti.size).toBeGreaterThan(0);
    const items = s.timeline!.items.length, shots = s.timeline!.items.filter((i) => i.do.do === 'burst' && i.do.attr === 'confetti').length;
    s.fixtures = s.fixtures.filter((f) => !confetti.has(f.id));
    const p = prune(s, canOf(s));
    void can;
    expect(s.timeline!.items.filter((i) => i.do.do === 'burst' && i.do.attr === 'confetti')).toEqual([]);
    expect(s.timeline!.items.length).toBe(items - shots);
    expect(p.moments).toBe(shots);
    expect(dangling(s)).toEqual([]);
  });
  it('a fog button keeps the machines still there; the timetable loses entries for a list that went', () => {
    const s = band();
    const fogs = s.fixtures.filter((f) => modeOf(typeMap(s).get(f.typeId), f.mode)?.channels.some((c) => c.attr === 'fog' || c.attr === 'haze')).map((f) => f.id);
    s.pages.push({ id: 'pg', name: 'Live', widgets: [{ id: 'wfog', type: 'fog', label: 'Fog', fixtures: [...fogs, 'gone-1'], level: 1, burst: 3, max: 10 } as never] });
    s.settings.schedule = [{ id: 'e1', at: '20:00', do: { do: 'start', list: 'no-such-list' } }, { id: 'e2', at: '21:00', do: { do: 'start', list: s.cueLists[0].id } }];
    const p = prune(s, canOf(s));
    expect((s.pages.at(-1)!.widgets.find((w) => w.id === 'wfog') as unknown as { fixtures: string[] }).fixtures).toEqual(fogs);
    expect(s.settings.schedule!.map((e) => e.id)).toEqual(['e2']);
    expect(p.entries).toBe(1);
  });
  it('says what went', () => {
    expect(prunedText({ effects: 2, buttons: 1, moments: 5, actions: 0, entries: 1 })).toBe('2 effects, 1 button, 5 moments on the timeline, 1 timetable entry');
    expect(prunedText({ effects: 0, buttons: 0, moments: 0, actions: 0, entries: 0 })).toBe('');
  });
});
