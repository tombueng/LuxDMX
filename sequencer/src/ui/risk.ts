// The risk marks on cards, tiles and the timeline, worked out once per cue (or list) per change of
// the show. cueRisk reads every value of every light in a cue: for a deck of tiles on a 300-light
// rig that was a quarter of a second on every render of Live.
import { untrack } from 'svelte';
import { cueRisk, listRisk, type Risk } from '../model/safety';
import type { Cue, CueList, Show } from '../model/types';

const cues = new WeakMap<object, { rev: number; risk: Risk }>();
const lists = new WeakMap<object, { rev: number; risk: Risk }>();
// `rev`: the show's revision (app.showRev): read here, so a mark follows the edit that changes it
export function cueRiskOf(show: Show, cue: Cue, rev: number): Risk {
  const c = cues.get(cue);
  if (c && c.rev === rev) return c.risk;
  const risk = untrack(() => cueRisk(show, cue));
  cues.set(cue, { rev, risk });
  return risk;
}
export function listRiskOf(show: Show, list: CueList, rev: number): Risk {
  const c = lists.get(list);
  if (c && c.rev === rev) return c.risk;
  const risk = untrack(() => listRisk(show, list.id));
  lists.set(list, { rev, risk });
  return risk;
}
