// The risk marks on cards, tiles and the timeline, worked out once per cue (or list) per change of
// the show. cueRisk reads every value of every light in a cue: for a deck of tiles on a 300-light
// rig that was a quarter of a second on every render of Live.
import { untrack } from 'svelte';
import { cueRisk, isMachine, listRisk, MACHINE_PROGRAMS, MARK_SHORT, MARK_TITLE, riskOf, type MachineOf, type Mark, type Risk } from '../model/safety';
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

// (the machines' lookup once per show and revision, not once per cue: it builds the type map and
// finds lights by id; made for each of the festival's 67 cues it was most of their marks' time)
let mach: { show: Show; rev: number; of: MachineOf } | null = null;
const machinesAt = (show: Show, rev: number) => (mach && mach.show === show && mach.rev === rev ? mach.of : (mach = { show, rev, of: untrack(() => fastMachines(show)) }).of);
// as machines(), with the lights found by id in a map
function fastMachines(show: Show): MachineOf {
  const types = typeMap(show), byId = new Map(show.fixtures.map((f) => [f.id, f]));
  const modeFor = (fid: string) => { const f = byId.get(fid); return f ? modeOf(types.get(f.typeId), f.mode) : undefined; };
  const of: MachineOf = (fid) => { const m = modeFor(fid); return isMachine(m) ? riskOf(m!.channels.map((c) => c.attr)) : undefined; };
  of.channel = (fid, ch) => {
    const m = modeFor(fid), c = m?.channels[ch];
    if (!c) return undefined;
    const own = riskOf([c.attr]);
    if (own !== 'light') return own;
    return isMachine(m) && (MACHINE_PROGRAMS as readonly string[]).includes(c.attr) ? riskOf(m!.channels.map((x) => x.attr)) : undefined;
  };
  return of;
}

// Every cue's mark at once per revision, from the app's plain copy of the show (app.plain: no
// proxies to read through, ~20x quicker), when the app has said where it is (plainFrom)
let plainOf: (() => Show | undefined) | null = null;
export function plainFrom(f: () => Show | undefined) { plainOf = f; }
let all: { rev: number; risk: Map<string, Risk> } | null = null;
function allAt(rev: number): Map<string, Risk> | undefined {
  if (all?.rev === rev) return all.risk;
  const p = plainOf ? untrack(plainOf) : undefined;
  if (!p) return undefined;
  const of = fastMachines(p), risk = new Map<string, Risk>();
  for (const l of p.cueLists) for (const c of l.cues) risk.set(c.id, cueRisk(p, c, undefined, of));
  all = { rev, risk };
  return risk;
}

export { MARK_TITLE, MARK_SHORT, type Mark };
const winches = new WeakMap<object, { rev: number; mark: Mark }>();
// (a hazard that's gone with the winches left out: only scenery moves)
const markFor = (risk: Risk, still: () => Risk): Mark => (risk === 'hazard' ? (still() === 'hazard' ? 'hazard' : 'winch') : risk === 'once' ? 'once' : '');
export function cueMarkOf(show: Show, cue: Cue, rev: number): Mark {
  const risk = cueRiskOf(show, cue, rev);
  if (risk !== 'hazard') return markFor(risk, () => risk);
  const c = winches.get(cue);
  if (c && c.rev === rev) return c.mark;
  const mark = markFor(risk, () => untrack(() => cueRisk(show, cue, undefined, machinesAt(show, rev), true)));
  winches.set(cue, { rev, mark });
  return mark;
}
export function listMarkOf(show: Show, list: CueList, rev: number): Mark {
  const risk = listRiskOf(show, list, rev);
  if (risk !== 'hazard') return markFor(risk, () => risk);
  const c = winches.get(list);
  if (c && c.rev === rev) return c.mark;
  const mark = markFor(risk, () => untrack(() => listRisk(show, list.id, machinesAt(show, rev), true)));
  winches.set(list, { rev, mark });
  return mark;
}

const cues = new WeakMap<object, { rev: number; risk: Risk }>();
const lists = new WeakMap<object, { rev: number; risk: Risk }>();
// `rev`: the show's revision (app.showRev): read here, so a mark follows the edit that changes it
export function cueRiskOf(show: Show, cue: Cue, rev: number): Risk {
  const c = cues.get(cue);
  if (c && c.rev === rev) return c.risk;
  // (from the plain copy, all at once; a cue not in it yet, from the show itself)
  const risk = untrack(() => allAt(rev)?.get(cue.id)) ?? untrack(() => cueRisk(show, cue, undefined, machinesAt(show, rev)));
  cues.set(cue, { rev, risk });
  return risk;
}
export function listRiskOf(show: Show, list: CueList, rev: number): Risk {
  const c = lists.get(list);
  if (c && c.rev === rev) return c.risk;
  const risk = untrack(() => listRisk(show, list.id, machinesAt(show, rev)));
  lists.set(list, { rev, risk });
  return risk;
}
