// One running cue list.
//
// A list holds a look per fixture that it fades between as cues come and go. Fixtures a cue
// doesn't mention keep what the list had for them (so a colour cue doesn't switch anything off).
// Two kinds of list: in a play a cue is what the list adds up to at that point (back to 9 shows
// cue 9, whatever came before); in a list of looks (moods, a bar's buttons) a look sets what it
// names and leaves the rest as it is ("Hall" lights the hall, the church stays as it was).
// On top sits a weight (0..1): it's how releasing fades the whole list back to what's underneath,
// and how a flash snaps it in and out. The mixer (engine.ts) combines all lists.
import { CELL_ATTRS, type CellAttr, type Cue, type CueList, type CueTimes, type Preset, type Resolved } from '../model/types';
import { isLooks } from '../model/library';
import { lerpResolved, overlay, resolveValues, topLevel } from './resolve';

interface Ramp { from: number; to: number; start: number; dur: number }
// One light's fade: each light has its own, so a GO only re-times the lights whose target changed
// (the others carry on with their own fade, even when the new cue is faster or delayed).
// `blend`: a light going out of a list that was fading out when a look was tapped: its colour and
// position stay blended with what's underneath as they were, and hand over the rest of the way.
// `times`: the cue's own fades for colour, position, beam (none: the fade for all of them)
// `done`: the look once the fade is over, worked out once (what only `from` had stays: a light
// that kept its pan or colour through the fade keeps it after); set again when `to` changes
interface Track { from: Resolved; to: Resolved; at: number; fade: number; fadeOut: number; out?: boolean; taken?: boolean; blend?: number; times?: CueTimes; done?: Resolved }
// level-like attributes: what makes light or fog. One the light has now and the cue it goes to
// doesn't set goes to 0 (back to cue 9 switches off what cue 10 switched on).
const LEVELS = ['intensity', 'white', 'amber', 'uv', 'fog', 'haze', 'confetti', 'bubbles', 'flame', 'sparks', 'co2'] as const;
// what belongs to its cue (a look's fog, a confetti shot, a flame): the next look stops it
const FOGGY = ['fog', 'haze', 'confetti', 'bubbles', 'flame', 'sparks', 'co2'] as const;
// a level at its highest: the light's own, or one of its cells' (a ring with only its rim lit is lit)
const CELLY = new Set<string>(CELL_ATTRS);
const lv = (r: Resolved | undefined, k: (typeof LEVELS)[number]) => (!r ? 0 : CELLY.has(k) ? topLevel(r, k as CellAttr) : (r[k] ?? 0));
// the same look with every cell's levels at 0 (colours stay, like the light's own)
function zeroCells(r: Resolved) {
  if (r.cellVals) r.cellVals = Object.fromEntries(Object.entries(r.cellVals).map(([k, c]) => {
    const x = { ...c };
    for (const a of CELL_ATTRS) if (x[a] !== undefined) x[a] = 0;
    return [k, x];
  }));
}
const t01 = (now: number, at: number, dur: number) => (dur <= 0 ? (now >= at ? 1 : 0) : Math.max(0, Math.min(1, (now - at) / dur)));
const same = (a: Resolved, b: Resolved) => JSON.stringify(a) === JSON.stringify(b);
const rampAt = (r: Ramp, now: number) => (r.dur <= 0 || now >= r.start + r.dur ? r.to : now <= r.start ? r.from : r.from + (r.to - r.from) * (now - r.start) / r.dur);

export interface PlayerStatus {
  running: boolean;
  index: number;          // cue on stage (or fading in), -1 none
  progress: number;       // 0..1 of the current cue's fade
  releasing: boolean;
  weight: number;
  master: number;
  flashing: boolean;      // only on while a button is held
  cue: string;            // id of the cue on stage ('' none): stays right while the list is edited
  stamp: number;          // order of its last cue, for latest-takes-precedence
}

export class ListPlayer {
  // Where the show is a fresh copy after every edit (the output thread): the tracked look is kept
  // from one GO to the next, so a GO costs one cue, not every cue before it (a pixel play of rainbows).
  cacheTracks = false;
  private trackCache: { list: CueList; presets: unknown; ids: string[]; at: number; base: Record<string, Resolved> } | null = null;
  // the look of cue i played from the top (trackedLook), from the cache when it can be
  private tracked(list: CueList, i: number, presets: Map<string, Preset>, key: unknown): Record<string, Resolved> {
    if (!this.cacheTracks || key === undefined) return trackedLook(list, i, presets);
    let c = this.trackCache;
    // (the same show copy, the same cues up to where it was, and not going back)
    if (!c || c.list !== list || c.presets !== key || i < c.at || c.ids.some((id, k) => list.cues[k]?.id !== id)) c = { list, presets: key, ids: [], at: 0, base: {} };
    // base: cues 0 .. at-1 laid over each other, fog and haze gone (they run only in their own cue)
    for (let k = c.at; k < i && k < list.cues.length; k++) {
      for (const [id, v] of Object.entries(list.cues[k].values)) { const r = overlay(c.base[id], resolveValues(v, id, presets)); for (const f of FOGGY) delete r[f]; c.base[id] = r; }
      c.ids.push(list.cues[k].id);
    }
    c.at = Math.max(c.at, Math.min(i, list.cues.length));
    this.trackCache = c;
    const out: Record<string, Resolved> = { ...c.base };
    const cue = list.cues[i];
    if (cue) for (const [id, v] of Object.entries(cue.values)) out[id] = overlay(out[id], resolveValues(v, id, presets));
    return out;
  }
  running = false;
  index = -1;             // where the live cue is in the list (looked up by id: the list can change)
  cueId = '';
  lastIndex = -1;         // where it was when it stopped (restart: resume)
  stamp = 0;              // order of the last action, for "latest takes precedence"
  master = 1;
  flashing = false;
  private tracks: Record<string, Track> = {};
  private cueAt = 0;      // when the current cue was triggered
  private fade = 0;
  private fadeOut = 0;
  private times: CueTimes | undefined;
  private delay = 0;
  private weight: Ramp = { from: 0, to: 0, start: 0, dur: 0 };
  private releasing = false;
  private held = false;   // reached the end of a 'stop' list: stays on the last cue
  private fxFrom: string[] = [];   // effects of the cue we're fading away from
  private fxTo: string[] = [];     // effects of the cue on stage
  private keptFx: string[] = [];   // ...and, in a list of looks, ones carried on from looks before (their lights weren't named)
  private exact = false;           // the cue on stage was jumped to with only its own values
  private own = false;             // ...or as a look of a list of looks (see the top)
  // the looks played since the list started, by cue id, each once (its last time), oldest first: a
  // reload plays them again in that order and gets the same stage (each look set what it names)
  played: string[] = [];
  get exactNow() { return this.exact; }

  constructor(readonly id: string) {}

  // ---- what the list shows
  look(now: number): Record<string, Resolved> {
    const out: Record<string, Resolved> = {};
    for (const [id, tr] of Object.entries(this.tracks)) {
      const t = t01(now, tr.at, tr.fade), td = t01(now, tr.at, tr.fadeOut);
      // (colour, position and beam on fades of their own, when the cue has them)
      const tm = tr.times, tBy = tm ? { color: t01(now, tr.at, tm.color ?? tr.fade), position: t01(now, tr.at, tm.position ?? tr.fade), beam: t01(now, tr.at, tm.beam ?? tr.fade) } : undefined;
      // a light that went out is let go once it's out: it mustn't hold its colour over other lists
      if (tr.out && td >= 1) { delete this.tracks[id]; continue; }
      // Intensity going down uses the fade-out time (advanced; same as fade unless set).
      // (done: its target as it is, nothing to work out; nothing downstream changes a look in place)
      if (t >= 1 && td >= 1 && (!tBy || (tBy.color >= 1 && tBy.position >= 1 && tBy.beam >= 1))) { out[id] = tr.done ??= lerpResolved(tr.from, tr.to, 1, 1, 1); continue; }
      const down = (tr.to.intensity ?? tr.from.intensity ?? 0) < (tr.from.intensity ?? 0);
      out[id] = lerpResolved(tr.from, tr.to, t, down ? td : t, td, tBy);   // (each cell by its own direction)
    }
    return out;
  }
  weightAt(now: number) { return this.running ? rampAt(this.weight, now) : 0; }
  // The cue's effects, crossfading with the cue: new ones fade in, gone ones fade out.
  effects(now: number): Map<string, number> {
    const out = new Map<string, number>();
    if (!this.running) return out;
    const t = this.fadeT(now, this.fade);
    for (const id of this.fxTo) out.set(id, this.fxFrom.includes(id) ? 1 : t);
    for (const id of this.fxFrom) if (!this.fxTo.includes(id) && t < 1) out.set(id, 1 - t);
    return out;
  }
  progress(now: number) { return this.fadeT(now, Math.max(this.fade, this.fadeOut, ...Object.values(this.times ?? {}).filter((x): x is number => typeof x === 'number'))); }
  // How firmly this list sets a light's level now, 0..1 (before the list's weight and master): a
  // light it only just took over is still fading in, so whatever lit it before (an effect) has to
  // fade out at the same pace, or it goes dark first.
  hold(fid: string, now: number) { const tr = this.tracks[fid]; return tr?.taken ? t01(now, tr.at, tr.fade) : 1; }
  // How much of this list's colour, position and so on shows over what's underneath (times its weight).
  blend(fid: string, now: number) { const tr = this.tracks[fid]; return tr?.blend === undefined ? 1 : tr.blend * (1 - t01(now, tr.at, tr.fadeOut)); }
  status(now: number): PlayerStatus {
    return { running: this.running, index: this.index, progress: this.progress(now), releasing: this.releasing, weight: this.weightAt(now), master: this.master, flashing: this.flashing, stamp: this.stamp, cue: this.running ? this.cueId : '' };
  }

  private fadeT(now: number, dur: number) {
    const t0 = this.cueAt + this.delay;
    return dur <= 0 ? (now >= t0 ? 1 : 0) : Math.max(0, Math.min(1, (now - t0) / dur));
  }

  // ---- moving through the list
  // Find the live cue again after the list changed (cues moved, added, deleted). A deleted live
  // cue leaves the list where it was: the next GO plays what's now in its place.
  sync(list: CueList) {
    if (!this.running) return;
    const i = list.cues.findIndex((c) => c.id === this.cueId);
    if (i >= 0) this.index = i;
    else if (this.index >= 0) {
      this.index = Math.min(this.index, list.cues.length) - 1; this.cueId = list.cues[this.index]?.id ?? '';
      // the look stays (no jump), but effects that only the deleted cue ran stop with it (ones kept
      // from the looks before carry on, as they did)
      const keep = [...(list.cues[this.index]?.effects ?? []), ...this.keptFx];
      this.fxTo = this.fxTo.filter((id) => keep.includes(id)); this.fxFrom = this.fxFrom.filter((id) => keep.includes(id));
    }
  }

  // Start cue i. Returns the cue so the engine can run its actions. `stage` is what's on stage
  // now: a fixture this list hasn't touched yet fades from there instead of jumping (its
  // intensity from zero: that's the list's own contribution).
  //
  // The cue fades to the look it has when the list is played from the top (what the cards show):
  // "back to 9" shows cue 9, not cue 9's changes on top of whatever is on now. Light and fog that
  // only a later cue switched on go to 0; a light the list doesn't set at all any more fades out
  // and is let go. Each light has its own fade: one whose target doesn't change carries on with
  // its own (a fast or delayed GO in the middle of a long fade leaves it alone). A light coming up
  // from dark takes its colour, position and so on at once: only its level fades (no detour
  // through white). `exact`: only this cue's own values (a cue just recorded into a list that
  // wasn't playing: the stage stays as the programmer had it).
  // `fxLights`: an effect's lights (in a list of looks an effect on lights the new look doesn't name
  // keeps running, like those lights do).
  // (`presetsKey`: what the presets came from, for the tracked-look cache; none: no cache)
  jump(list: CueList, i: number, now: number, presets: Map<string, Preset>, stamp: number, fadeOverride?: number, stage?: Record<string, Resolved>, exact = false,
    fxLights?: (effect: string) => string[], presetsKey?: unknown): Cue | undefined {
    const cue = list.cues[i];
    if (!cue) return undefined;
    // a list fading out (released): what's visible is its look times its fading weight; a look
    // tapped now starts from there (nothing pops back up), and what it doesn't name goes on out
    const fading = this.running && this.releasing, w = fading ? this.weightAt(now) : 1;
    const cur = this.running ? this.look(now) : {};
    if (fading) for (const [id, v] of Object.entries(cur)) {
      const x = { ...v };
      for (const k of LEVELS) if (x[k] !== undefined) x[k] = (x[k] as number) * w;
      // (its cells too: a tapped look mustn't pop them back up)
      if (x.cellVals) x.cellVals = Object.fromEntries(Object.entries(x.cellVals).map(([ci, c]) => { const y = { ...c }; for (const a of CELL_ATTRS) if (y[a] !== undefined) y[a] = (y[a] as number) * w; return [ci, y]; }));
      cur[id] = x;
    }
    const own = !exact && isLooks(list);
    const target = exact || own ? ownLook(cue, presets) : this.tracked(list, i, presets, presetsKey);
    const fade = fadeOverride ?? cue.fade, fadeOut = fadeOverride ?? cue.fadeOut ?? cue.fade;
    const times = fadeOverride === undefined && cue.times && Object.keys(cue.times).length ? cue.times : undefined;
    const at = now + (fadeOverride !== undefined ? 0 : (cue.delay ?? 0));
    const tracks: Record<string, Track> = {};
    for (const id of new Set([...Object.keys(cur), ...Object.keys(target)])) {
      const c = cur[id], old = this.tracks[id];
      let to = target[id], out = false;
      if (!to && own && !fading) {
        // a look leaves what it doesn't name as it is; only fog and haze stop (they're their look's)
        if (!c) continue;
        if (old && !FOGGY.some((k) => (c[k] ?? 0) > 0.002)) { tracks[id] = old; continue; }
        to = { ...(old?.to ?? c) };
        for (const k of FOGGY) if (to[k] !== undefined) to[k] = 0;
      } else if (own && c && to) {
        const set = to;
        to = overlay(old && !old.out && !fading ? old.to : c, set);
        for (const k of FOGGY) if (set[k] === undefined && (c[k] ?? 0) > 0.002) to[k] = 0;
      } else if (!to) {
        if (!c || !LEVELS.some((k) => lv(c, k) > 0.002)) continue;     // nothing to take out
        to = { ...(old?.to ?? c) };
        for (const k of LEVELS) if (to[k] !== undefined || c[k] !== undefined || lv(c, k) > 0.002) to[k] = 0;
        zeroCells(to);
        out = true;
      } else if (c) {
        to = { ...to };
        for (const k of LEVELS) if (to[k] === undefined && lv(c, k) > 0.002) to[k] = 0;
      }
      if (c && old && !old.out && !fading && same(old.to, to)) { tracks[id] = old; continue; }   // its own fade carries on
      let from: Resolved;
      // fading out, the colour and position on stage are a blend with what's underneath: a light
      // the tapped look names fades on from that blend (no pop to the list's own colour first)
      if (c && fading && !out && stage?.[id]) {
        from = { ...c };
        for (const k of new Set([...Object.keys(c), ...Object.keys(to)]) as Set<keyof Resolved>) {
          const v = stage[id][k];
          if (k !== 'intensity' && k !== 'cells' && k !== 'cellVals' && k !== 'cellLvl' && !FOGGY.includes(k as never) && v !== undefined) (from as Record<string, unknown>)[k] = typeof v === 'object' ? structuredClone(v) : v;
        }
      } else if (c) from = c;
      else if (stage?.[id]) {
        // (from what's on stage, its cells' colours too; levels from 0: that's this list's own part)
        const { cells: _c, cellLvl: _l, cellVals: scv, ...st } = stage[id];
        from = { ...st, color: st.color && { ...st.color }, intensity: 0 };
        if (scv) from.cellVals = Object.fromEntries(Object.entries(scv).map(([ci, x]) => { const y: Resolved = { ...x, intensity: 0 }; if (x.color) y.color = { ...x.color }; return [ci, y]; }));
      }
      else from = { intensity: 0 };
      // dark: on stage, not just in this list (a colour or position list over a light another list
      // lights isn't dark: its colour and moves fade). Without a stage to go by, this list's level.
      const dark = (stage?.[id] ? topLevel(stage[id]) : lv(c, 'intensity')) <= 0.002;
      if (dark && !out) {
        const was = from;
        from = { ...to, intensity: was.intensity ?? 0, ...Object.fromEntries(FOGGY.filter((k) => was[k] !== undefined).map((k) => [k, was[k]])) };
        // (its cells take their colours at once too, and come up from where they were)
        if (to.cellVals) from.cellVals = Object.fromEntries(Object.entries(to.cellVals).map(([k, cv]) => [k, { ...cv, intensity: was.cellVals?.[k]?.intensity ?? was.intensity ?? 0 }]));
      }
      tracks[id] = { from, to, at, fade, fadeOut, out, taken: !c, ...(out && fading ? { blend: w } : {}), ...(times ? { times } : {}) };
    }
    this.tracks = tracks;
    this.exact = exact;
    this.own = own;
    if (!this.running || this.releasing) this.played = [];
    this.played = [...this.played.filter((x) => x !== cue.id), cue.id].slice(-200);
    const own_ = cue.effects ?? [];
    this.keptFx = own && this.running && !this.releasing && fxLights
      ? this.fxTo.filter((e) => !own_.includes(e) && fxLights(e).every((f) => !(f in cue.values))) : [];
    this.fxFrom = this.running && !this.releasing ? this.fxTo : [];
    this.fxTo = [...own_, ...this.keptFx];
    this.cueAt = now;
    this.fade = fade;
    this.fadeOut = fadeOut;
    this.times = times;
    this.delay = at - now;
    this.index = i;
    this.cueId = cue.id;
    this.lastIndex = i;
    this.stamp = stamp;
    this.held = false;
    if (!this.running || this.releasing) {
      this.running = true;
      this.releasing = false;
      this.weight = { from: 1, to: 1, start: now, dur: 0 };
    }
    return cue;
  }
  // A cue that started `ago` seconds before now (a reload picking the show up: its wait or follow
  // carries on where it was instead of starting over).
  since(ago: number) {
    if (!this.running || ago <= 0) return;
    this.cueAt -= ago;
    for (const tr of Object.values(this.tracks)) tr.at -= ago;
  }
  startedAt() { return this.cueAt; }

  // A cue changed (Update, an earlier cue edited, a preset): show the live cue's look as it now is,
  // keep each light's timing.
  refresh(list: CueList, presets: Map<string, Preset>, fxLights?: (effect: string) => string[]) {
    const i = this.running ? list.cues.findIndex((c) => c.id === this.cueId) : -1;
    if (i < 0) return;
    this.trackCache = null;                    // (a cue changed: from the top again)
    const target = this.exact || this.own ? ownLook(list.cues[i], presets) : trackedLook(list, i, presets);
    if (this.own) {
      // a look: what it names now (the rest stays as it is)
      for (const [id, v] of Object.entries(target)) {
        const tr = this.tracks[id];
        if (tr) { tr.to = overlay(tr.to, v); tr.out = false; delete tr.done; } else this.tracks[id] = { from: v, to: v, at: this.cueAt, fade: 0, fadeOut: 0 };
      }
      // an effect kept from before gives way once the look names its lights (as a jump would)
      const fx = list.cues[i].effects ?? [], named = list.cues[i].values;
      if (fxLights) this.keptFx = this.keptFx.filter((e) => fxLights(e).every((f) => !(f in named)));
      this.fxTo = [...fx, ...this.keptFx.filter((e) => !fx.includes(e))];
      return;
    }
    for (const [id, tr] of Object.entries(this.tracks)) {
      const v = target[id];
      if (!v) {
        if (tr.out) continue;
        const to = { ...tr.to };
        for (const k of LEVELS) if (to[k] !== undefined) to[k] = 0;
        zeroCells(to);
        tr.to = to; tr.out = true; delete tr.done;
        continue;
      }
      const to = { ...v };
      for (const k of LEVELS) if (to[k] === undefined && (tr.to[k] !== undefined || lv(tr.to, k) > 0.002)) to[k] = 0;
      tr.to = to; tr.out = false; delete tr.done;
    }
    for (const [id, v] of Object.entries(target)) if (!this.tracks[id]) this.tracks[id] = { from: v, to: v, at: this.cueAt, fade: 0, fadeOut: 0 };
    this.fxTo = list.cues[i].effects ?? [];
  }

  // The next cue index for GO, or -1 at the end of a list that doesn't loop.
  nextIndex(list: CueList): number {
    if (!this.running) return list.cues.length ? 0 : -1;
    if (this.index + 1 < list.cues.length) return this.index + 1;
    return list.end === 'loop' && list.cues.length ? 0 : -1;
  }

  release(list: CueList, now: number) {
    if (!this.running) return;
    const dur = list.releaseTime ?? 2;
    this.weight = { from: this.weightAt(now), to: 0, start: now, dur };
    this.releasing = true;
  }

  stop() {
    this.running = false; this.releasing = false; this.flashing = false;
    this.index = -1; this.cueId = ''; this.tracks = {}; this.fxFrom = []; this.fxTo = []; this.keptFx = []; this.played = [];
  }

  // Keeps auto-advance and releases moving. Returns the cue index to jump to, or -1.
  update(list: CueList, now: number, bpm: number): number {
    if (!this.running) return -1;
    if (this.releasing && now >= this.weight.start + this.weight.dur) { this.stop(); return -1; }
    if (this.releasing || this.flashing || this.held) return -1;
    const cue = list.cues[this.index];
    if (!cue) return -1;
    const a = cue.advance;
    const fadeEnd = this.cueAt + (cue.delay ?? 0) + Math.max(cue.fade, cue.fadeOut ?? cue.fade);
    let due = Infinity;
    // Never faster than 20 steps a second, whatever the numbers say (a 0 typed by accident must not
    // turn a loop into a 40 Hz strobe).
    if (a.mode === 'wait') due = this.cueAt + Math.max(0.05, a.time);
    else if (a.mode === 'follow') due = fadeEnd + Math.max(0, a.time);
    else if (a.mode === 'beats') due = this.cueAt + Math.max(0.25, a.beats) * 60 / Math.max(1, bpm);
    due = Math.max(due, this.cueAt + 0.05);
    if (now < due) return -1;
    const next = this.nextIndex(list);
    if (next >= 0) return next;
    if (list.end === 'release') this.release(list, now);
    else this.held = true;               // 'stop': hold the last cue, no more advancing
    return -1;
  }
}

// The look of cue i when the list is played from the top: every cue up to it, each one's values
// over what came before (like the cue cards show it).
// Fog and haze are the exception: they run only in the cue that sets them (haze that one cue
// started mustn't drift on into every cue after it).
export function trackedLook(list: CueList, i: number, presets: Map<string, Preset>): Record<string, Resolved> {
  const out: Record<string, Resolved> = {};
  for (let k = 0; k <= i && k < list.cues.length; k++)
    for (const [id, v] of Object.entries(list.cues[k].values)) {
      const r = overlay(out[id], resolveValues(v, id, presets));
      if (k < i) for (const f of FOGGY) delete r[f];
      out[id] = r;
    }
  return out;
}
// Only what the cue itself sets.
export function ownLook(cue: Cue, presets: Map<string, Preset>): Record<string, Resolved> {
  return Object.fromEntries(Object.entries(cue.values).map(([id, v]) => [id, resolveValues(v, id, presets)]));
}
