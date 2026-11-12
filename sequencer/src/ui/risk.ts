// The risk marks on cards, tiles and the timeline, worked out once per cue (or list) per change of
// the show. cueRisk reads every value of every light in a cue: for a deck of tiles on a 300-light
// rig that was a quarter of a second on every render of Live.
import { untrack } from 'svelte';
import { cueRisk, isMachine, listRisk, MACHINE_PROGRAMS, riskOf, type MachineOf, type Risk } from '../model/safety';
import { modeOf, typeMap } from '../model/library';
import type { Cue, CueList, Show } from '../model/types';

// a fixture's risk when it's a machine (its own programs can fire it)
export function machines(show: Show): MachineOf {
  const types = typeMap(show);
  const modeFor = (fid: string) => { const f = show.fixtures.find((x) => x.id === fid); return f ? modeOf(types.get(f.typeId), f.mode) : undefined; };
  const of: MachineOf = (fid) => { const m = modeFor(fid); return isMachine(m) ? riskOf(m!.channels.map((c) => c.attr)) : undefined; };
  // (a channel set by number: its own risk, or the machine's when it's one of its programs)
  of.channel = (fid, ch) => {
    const m = modeFor(fid), c = m?.channels[ch];
    if (!c) return undefined;
    const own = riskOf([c.attr]);
    if (own !== 'light') return own;
    return isMachine(m) && (MACHINE_PROGRAMS as readonly string[]).includes(c.attr) ? riskOf(m!.channels.map((x) => x.attr)) : undefined;
  };
  return of;
}

const cues = new WeakMap<object, { rev: number; risk: Risk }>();
const lists = new WeakMap<object, { rev: number; risk: Risk }>();
// `rev`: the show's revision (app.showRev): read here, so a mark follows the edit that changes it
export function cueRiskOf(show: Show, cue: Cue, rev: number): Risk {
  const c = cues.get(cue);
  if (c && c.rev === rev) return c.risk;
  const risk = untrack(() => cueRisk(show, cue, undefined, machines(show)));
  cues.set(cue, { rev, risk });
  return risk;
}
export function listRiskOf(show: Show, list: CueList, rev: number): Risk {
  const c = lists.get(list);
  if (c && c.rev === rev) return c.risk;
  const risk = untrack(() => listRisk(show, list.id, machines(show)));
  lists.set(list, { rev, risk });
  return risk;
}
