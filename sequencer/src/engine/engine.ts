// The engine: runs the cue lists, mixes them, renders DMX. Pure TypeScript, no DOM, so it can be
// unit-tested and moved into a Worker later.
//
// Mixing, per fixture:
//   - intensity: highest wins across lists (HTP), each scaled by its list master and weight
//   - fog and haze: highest wins too, by the list master like a level (a haze list runs all night whatever the moods say)
//   - everything else: the most recent action wins (LTP), lists ordered by priority then by when
//     they were last moved; a releasing list blends back toward what's underneath it
//   - the programmer (what you're editing) on top
//   - then the effects (from cues, or started by hand), then the live layer (fog buttons), then
//     the grand master and blackout
import { isHeld, enableValue, isGated, isMachine, MACHINE_PROGRAMS, MAX_ON, KINETIC_CTL, kineticOff } from '../model/safety';
import type { CueAction, CueList, Effect, FixtureMode, Preset, Resolved, Show, Values, Fixture } from '../model/types';
import { headCellsOf, capsOf, modeOf, typeMap } from '../model/library';
import { isWide, placesOfLight, spansOf } from '../model/pixelLayout';
// fog, haze and the effect machines: highest wins across lists, like a level (a haze list runs all
// night whatever the moods say; two lists firing confetti fire it)
const SMOKE = ['fog', 'haze', 'confetti', 'bubbles', 'flame', 'sparks', 'co2'] as const;
import { ListPlayer, type PlayerStatus } from './player';
import { lerpResolved, resolveValues, spreadCells, stripCells } from './resolve';
import { DARK, fitLook, renderFixture, level } from './render';
import { EFFECT_MAP, applyFx, hash, paramsOf, runEffect, type EffectDef, type EffectParams, type Target } from './effects';

const PRIO = { low: 0, normal: 1, high: 2 } as const;
const FX_FADE = 0.4;            // seconds an effect started or stopped by hand takes to fade
// the channels that make light (masters and Blackout scale them)
export const LIGHT = new Set(['intensity', 'red', 'green', 'blue', 'white', 'warmWhite', 'coolWhite', 'amber', 'uv', 'lime']);
const wide = new WeakMap<FixtureMode, Uint8Array>();   // a light too big for one universe, drawn whole
const FX_ORDER = { move: 0, color: 1, pixel: 1, intensity: 2 } as const;   // intensity effects get the last word

interface Ramp { from: number; to: number; start: number; dur: number }
const rampAt = (r: Ramp, now: number) => (r.dur <= 0 || now >= r.start + r.dur ? r.to : now <= r.start ? r.from : r.from + (r.to - r.from) * (now - r.start) / r.dur);

export interface Frame {
  frames: Map<number, Uint8Array>;
  stage: Record<string, Resolved>;     // what each fixture shows, after all masters
  look: Record<string, Resolved>;      // the same before grand master and blackout (what Record stores)
}

// a copy of raw channel values without these channels
function withoutChannels(raw: Record<string, number>, chs: { i: number }[]): Record<string, number> {
  if (!chs.length) return raw;
  const out = { ...raw };
  for (const { i } of chs) delete out[String(i)];
  return out;
}
// the channels of a mode that do one of the fog or machine attributes this look sets
function smokeChannels(m: FixtureMode | undefined, r: Resolved): { i: number }[] {
  return m ? m.channels.flatMap((c, i) => ((SMOKE as readonly string[]).includes(c.attr) && r[c.attr as (typeof SMOKE)[number]] !== undefined ? [{ i }] : [])) : [];
}
// which channels of a mode wait for the machines to be armed, and the longest each may stay on
// (worked out once per mode)
const gatedOf = new WeakMap<FixtureMode, { i: number; max: number; off: number }[]>();
// a machine's own safety / enable channels and the value that enables it (model/safety.ts)
const enableOf = new WeakMap<FixtureMode, { i: number; on: number; off: number }[]>();
function enableChannels(m: FixtureMode | undefined): { i: number; on: number; off: number }[] {
  if (!m) return [];
  let g = enableOf.get(m);
  if (!g) {
    g = m.channels.flatMap((c, i) => {
      if (c.attr !== 'enable') return [];
      const v = enableValue(c.ranges);
      return [{ i, on: v.on ?? v.off, off: v.off }];
    });
    enableOf.set(m, g);
  }
  return g;
}
const PROGRAM_OFF = /\b(off|no\s*function|none|nothing|closed?|stop(ped)?|standby|idle|disabled?|blackout|no\s*effect|manual)\b/i;
// A winch's height channels (model/safety.ts HELD), worked out once per mode: one group per winch
// (a cell of its own, or the n-th height channel of the light), its coarse and fine channel
interface HeldGroup { cell?: number; slot: number; co?: { i: number; def: number; span?: [number, number] }; fi?: { i: number; def: number } }
const heldOf = new WeakMap<FixtureMode, HeldGroup[]>();
function heldGroups(m: FixtureMode): HeldGroup[] {
  let g = heldOf.get(m);
  if (!g) {
    const gs: HeldGroup[] = [], nCo = new Map<string, number>(), nFi = new Map<string, number>();
    m.channels.forEach((c, i) => {
      if (!isHeld(c.attr)) return;
      const ck = String(c.cell ?? ''), cnt = c.fine ? nFi : nCo, slot = cnt.get(ck) ?? 0;
      cnt.set(ck, slot + 1);
      let x = gs.find((y) => y.cell === c.cell && y.slot === slot);
      if (!x) gs.push((x = { ...(c.cell !== undefined ? { cell: c.cell } : {}), slot }));
      if (c.fine) x.fi = { i, def: c.default ?? 0 }; else x.co = { i, def: c.default ?? 0, ...(c.span ? { span: c.span } : {}) };
    });
    heldOf.set(m, (g = gs));
  }
  return g;
}
// (kept by fixture, cell and which height channel: `id:hoist`, `id:hoist@2`, `id:hoist#1`, `...:fine`)
const heldKey = (id: string, g: HeldGroup) => `${id}:hoist${g.cell !== undefined ? `@${g.cell}` : ''}${g.slot ? `#${g.slot}` : ''}`;
// `off`: the highest value that's still off (0; for a machine's program, its first range when it
// says so, "Off" or "No function": a first range "Auto 1" is a program, not off)
function gatedChannels(m: FixtureMode | undefined): { i: number; max: number; off: number }[] {
  if (!m) return [];
  let g = gatedOf.get(m);
  // (a machine's own programs too: a flame projector's "Auto 1" fires it as surely as its fire channel)
  if (!g) {
    const machine = isMachine(m);
    // (a program may run as long as the machine's longest: a spark machine's show program like its sparks)
    const longest = Math.max(5, ...m.channels.filter((c) => isGated(c.attr)).map((c) => MAX_ON[c.attr] ?? 5));
    g = m.channels.flatMap((c, i) => (isGated(c.attr) ? [{ i, max: MAX_ON[c.attr] ?? 5, off: 0 }]
      : machine && (MACHINE_PROGRAMS as readonly string[]).includes(c.attr) ? [{ i, max: longest, off: c.ranges?.[0]?.from === 0 && PROGRAM_OFF.test(c.ranges[0].label ?? '') ? c.ranges[0].to : 0 }] : []));
    gatedOf.set(m, g);
  }
  return g;
}

export class Engine {
  readonly players = new Map<string, ListPlayer>();
  programmer: Record<string, Values> = {};
  grandMaster = 1;
  // keep each list's tracked look from one GO to the next: only where the show is a new copy after
  // every edit (the output thread), so an edit can never leave an old look in it
  cacheTracks = false;
  // a group's master (the console's group faders): its lights' levels times this, like the grand
  // master for just them (a light in two groups: both)
  groupMasters: Record<string, number> = {};
  blackout = false;
  bpm = 120;
  live: Record<string, Values> = {};          // fog buttons and the like: on top, never recorded
  // The machines that fire once or are dangerous (confetti, flames, sparks, CO2: model/safety.ts)
  // send 0 until a person arms them; the stage (the look) still has them, for the 2D and 3D view.
  armed = false;
  // Lists a timeline jump put on a cue: their confetti, flames, sparks and CO2 stay at 0 until the
  // list really moves on (GO, a follow-on, the timeline playing into its next cue). Scrubbing
  // never lights a machine, armed or not.
  readonly jumped = new Set<string>();
  // Each armed machine channel ('fixture:channel'): -1 = off and ready to fire, a time = on since
  // then. Missing = it was already on when the machines were armed (or it was cut off for staying
  // on too long): it stays at 0 until its source lets go of it once. Arming never fires anything
  // that was set while the machines were safe.
  private readonly shots = new Map<string, number>();
  sound = 0;                                  // the music's loudness (0..1), when following it
  fxWeights = new Map<string, number>();      // how strongly each effect ran last frame
  readonly broken = new Map<string, string>(); // effects that threw (id -> why), for the app to say
  overlay: { universe: number; address: number; values: number[] } | null = null;   // the channel wizard's test values
  private seq = 0;
  private depth = 0;                          // cue actions starting lists that start lists...
  private lastStage: Record<string, Resolved> = {};
  private liveFx = new Map<string, Ramp>();   // effects started by hand
  private fxFlash = new Set<string>();
  private fxSince = new Map<string, { beats: number; seconds: number }>();
  private beats = 0;
  private seconds = 0;
  private last = -1;

  constructor(private getShow: () => Show, readonly now: () => number = () => performance.now() / 1000) {}

  // ---- playback control (all by cue list id)
  go(id: string) {
    const l = this.list(id), p = this.player(id);
    if (!l) return;
    p.sync(l);
    const i = p.nextIndex(l);
    if (i >= 0) this.jumpTo(id, i);
    else if (l.end === 'release') p.release(l, this.now());
  }
  back(id: string) {
    const l = this.list(id), p = this.player(id);
    if (l) p.sync(l);
    // (without the cue's actions: going back to the preset doesn't bring the house lights up again)
    if (p.running && p.index > 0) this.jumpTo(id, p.index - 1, undefined, false);
  }
  // `exact`: only that cue's own values (see ListPlayer.jump)
  jumpTo(id: string, i: number, fade?: number, actions = true, exact = false) {
    const l = this.list(id);
    if (!l) return;
    this.jumped.delete(id);
    this.wake(id);
    const cue = this.player(id).jump(l, i, this.now(), this.presetMap(), ++this.seq, fade, this.lastStage, exact, this.fxLights(), this.getShow().presets);
    // Actions can start lists whose cues start lists: a few levels deep is a show, more is a loop.
    if (actions && cue?.actions && this.depth < 8) {
      this.depth++;
      try { for (const a of cue.actions) this.act(a, id); } finally { this.depth--; }
    }
  }
  // Start a list: from its first cue, or (restart: resume) where it was when it stopped.
  start(id: string) {
    const p = this.player(id), l = this.list(id);
    if (p.running && !this.isReleasing(id)) return;
    const at = l?.restart === 'resume' && p.lastIndex >= 0 && p.lastIndex < (l?.cues.length ?? 0) ? p.lastIndex : 0;
    this.jumpTo(id, at);
  }
  // an effect's lights (by its own pick or its group)
  private fxLights() {
    const show = this.getShow();
    return (eid: string) => { const e = show.effects.find((x) => x.id === eid); return !e ? [] : e.group ? show.groups.find((g) => g.id === e.group)?.fixtures ?? [] : e.fixtures ?? []; };
  }
  // The live cue of a list was edited (or a preset it uses): show the change.
  refresh(id?: string) {
    const presets = this.presetMap(), fxLights = this.fxLights();
    for (const [lid, p] of this.players) { const l = this.list(lid); if (l && (!id || id === lid)) p.refresh(l, presets, fxLights); }
  }
  toggle(id: string) { if (this.isOn(id)) this.release(id); else this.start(id); }
  release(id: string) { const l = this.list(id); if (l) this.player(id).release(l, this.now()); }
  stop(id: string) { this.player(id).stop(); }
  releaseAll() { for (const id of this.players.keys()) this.release(id); }
  // Flash: on at full while held, no fades, gone on release. Only for a list that isn't running.
  flash(id: string, down: boolean) {
    const p = this.player(id);
    if (down && !p.running) { this.jumpTo(id, 0, 0, false); p.flashing = true; }
    else if (!down && p.flashing) p.stop();
  }
  // A beat from the music: put the beat clock on it (tempo effects land on the beat).
  alignBeat() { this.beats = Math.round(this.beats); }
  // A song playing on the timeline: the beat clock is the song's (beat 0 on its first downbeat), so
  // tempo effects and Auto GO land on the band's beats. A jump in the song restarts the tempo
  // effects' count from there.
  syncBeats(b: number) {
    if (!Number.isFinite(b)) return;
    if (Math.abs(b - this.beats) > 0.5) this.fxSince.clear();
    this.beats = b;
  }
  get beatCount() { return this.beats; }
  releaseFlashes() { for (const p of this.players.values()) if (p.flashing) p.stop(); for (const id of this.fxFlash) this.liveFx.delete(id); this.fxFlash.clear(); }
  setMaster(id: string, v: number) { this.player(id).master = Math.max(0, Math.min(1, v)); if (v > 0.004) this.faderOut.delete(id); }
  // A list let go by the console's fader (pulled to 0, its level left there) plays at full when
  // anything starts it again: GO, a goto, a tile, the timeline, a cue's action (not dark while it
  // says it's running). A level set to 0 any other way (a cue's action, a live page's fader) stays.
  private faderOut = new Set<string>();
  faderReleased(id: string) { this.faderOut.add(id); }
  wake(id: string) {
    const p = this.player(id);
    if (!this.faderOut.has(id) || (p.running && !this.isReleasing(id))) return;
    this.faderOut.delete(id);
    if (p.master < 0.004) p.master = 1;
  }

  isOn(id: string) { const p = this.players.get(id); return !!p?.running && !this.isReleasing(id); }
  isReleasing(id: string) { return !!this.players.get(id)?.status(this.now()).releasing; }
  // How long ago the list's cue started (seconds), and backdating it (a reload picking the show up:
  // a wait or follow carries on where it was instead of starting over).
  startedAgo(id: string) { const p = this.players.get(id); return p?.running ? this.now() - p.startedAt() : 0; }
  backdate(id: string, ago: number) { this.players.get(id)?.since(ago); }
  // The looks played since the list started (a list of looks: a reload replays them to get the same stage).
  history(id: string): string[] { return [...(this.players.get(id)?.played ?? [])]; }
  // the cue on stage was jumped to with only its own values (a cue recorded into a list that wasn't playing)
  exactNow(id: string) { return !!this.players.get(id)?.exactNow; }
  status(id: string): PlayerStatus {
    return this.players.get(id)?.status(this.now()) ?? { running: false, index: -1, progress: 0, releasing: false, weight: 0, master: 1, flashing: false, stamp: 0, cue: '' };
  }

  // Forget a list's state (deleted, or a new show).
  forget(id?: string) { if (id) this.players.delete(id); else this.players.clear(); }

  // ---- effects started by hand (the Effects panel, live buttons)
  startEffect(id: string) { this.liveFx.set(id, { from: this.liveWeight(id), to: 1, start: this.now(), dur: FX_FADE }); }
  stopEffect(id: string, fade = FX_FADE) {
    if (this.liveFx.has(id)) this.liveFx.set(id, { from: this.liveWeight(id), to: 0, start: this.now(), dur: fade });
  }
  toggleEffect(id: string) { if (this.isEffectLive(id)) this.stopEffect(id); else this.startEffect(id); }
  flashEffect(id: string, down: boolean) {
    if (down && !this.isEffectLive(id)) { this.liveFx.set(id, { from: 1, to: 1, start: this.now(), dur: 0 }); this.fxFlash.add(id); }
    else if (!down && this.fxFlash.delete(id)) this.liveFx.delete(id);
  }
  isEffectLive(id: string) { const r = this.liveFx.get(id); return !!r && r.to > 0; }
  liveEffects(): string[] { return [...this.liveFx.keys()].filter((id) => this.isEffectLive(id)); }
  // Effects that are only on while a button is held.
  heldEffects(): string[] { return [...this.fxFlash]; }
  // Hand the running effects over (to a cue that was just recorded): gone from here without a fade.
  takeLiveEffects(): string[] { const ids = this.liveEffects(); for (const id of ids) this.liveFx.delete(id); return ids; }
  stopAllEffects() { for (const id of this.liveFx.keys()) this.stopEffect(id); }
  private liveWeight(id: string) { const r = this.liveFx.get(id); return r ? rampAt(r, this.now()) : 0; }

  // a cue action (also run by the timetable: `from` '' is nobody's list)
  // A jump that's quiet from the start (the timeline, the timetable, a catch-up): one command, so no
  // frame can go out between the jump and its quiet (an armed flame mustn't fire from scrubbing)
  jumpQuiet(id: string, i: number, fade?: number, actions = false) { this.jumpTo(id, i, fade, actions); this.jumped.add(id); }
  actQuiet(a: CueAction) { this.act(a); if (a.do === 'goto' || a.do === 'start' || a.do === 'go') this.jumped.add(a.list); }
  act(a: CueAction, from = '') {
    switch (a.do) {
      case 'start': if (a.list !== from) this.start(a.list); break;
      case 'go': if (a.list !== from) this.go(a.list); break;
      case 'stop': this.stop(a.list); break;
      case 'release': this.release(a.list); break;
      case 'master': this.setMaster(a.list, a.level); break;
      case 'goto': {
        const i = a.list === from ? -1 : this.list(a.list)?.cues.findIndex((c) => c.id === a.cue) ?? -1;
        if (i >= 0) this.jumpTo(a.list, i);
        break;
      }
      case 'blackout': this.blackout = a.on; break;
      case 'off': for (const l of this.getShow().cueLists) if (l.id !== from) this.release(l.id); this.stopAllEffects(); break;
    }
  }

  private list(id: string): CueList | undefined { return this.getShow().cueLists.find((l) => l.id === id); }
  private player(id: string) {
    let p = this.players.get(id);
    if (!p) { p = new ListPlayer(id); p.cacheTracks = this.cacheTracks; this.players.set(id, p); }
    return p;
  }
  private presetMap() {
    // (where the show is a new copy after every edit: one map per copy, not one per frame)
    const ps = this.getShow().presets;
    if (this.cacheTracks && this.pmFor === ps && this.pm) return this.pm;
    this.pm = new Map<string, Preset>(ps.map((p) => [p.id, p])); this.pmFor = ps;
    return this.pm;
  }
  private pm: Map<string, Preset> | undefined;
  private pmFor: unknown;
  // A light's programmer values worked out once while they and the presets stay the same objects
  // (the output thread: a thousand picked cells aren't resolved again every frame).
  private progMemo = new WeakMap<Values, { key: unknown; r: Resolved }>();
  private progResolved(v: Values, id: string, presets: Map<string, Preset>, key: unknown): Resolved {
    if (!this.cacheTracks) return resolveValues(v, id, presets);
    const m = this.progMemo.get(v);
    if (m && m.key === key) return m.r;
    const r = resolveValues(v, id, presets);
    this.progMemo.set(v, { key, r });
    return r;
  }

  // ---- one frame
  tick(): Frame {
    const now = this.now();
    const show = this.getShow();
    const presets = this.presetMap();
    // The effect clocks: seconds, and beats at the tempo (so a tempo change doesn't jump).
    const dt = this.last < 0 ? 0 : Math.max(0, Math.min(0.25, now - this.last));
    this.last = now;
    this.seconds += dt;
    this.beats += dt * this.bpm / 60;

    // Auto-advance (wait / follow / beats) and finished releases.
    for (const [id, p] of this.players) {
      const l = this.list(id);
      if (!l) { this.players.delete(id); continue; }
      p.sync(l);
      const next = p.update(l, now, this.bpm);
      // (a list the timeline jumped onto stays quiet through its own waits and follow-ons: only a
      // GO, or the timeline playing into it, wakes its machines)
      if (next >= 0) { const q = this.jumped.has(id); this.jumpTo(id, next); if (q) this.jumped.add(id); }
    }

    const order = [...this.players.values()].filter((p) => p.running)
      .map((p) => ({ p, prio: PRIO[this.list(p.id)?.priority ?? 'normal'] }))
      .sort((a, b) => a.prio - b.prio || a.p.stamp - b.p.stamp);

    const stage: Record<string, Resolved> = {};
    const htp: Record<string, number> = {};
    const recorded: Record<string, number> = {};
    // How firmly something sets each light's level (the strongest list, by its weight and how far
    // a light it just took over has faded in; 1 for the programmer): an effect lights up only what
    // nothing else holds, and hands over smoothly both ways. Not by the list's master: a list pulled
    // down still owns its lights, dimmer (Release hands them over). And who was asked for a colour
    // at all (white fixtures map only those).
    const held = new Map<string, number>(), colored = new Set<string>();
    const smoke: Record<string, Partial<Record<(typeof SMOKE)[number], number>>> = {};
    // Lights some list sets single cells of: each cell's level is its brightest list's (a list that
    // doesn't name cells lights them all at its level), by weight and master like the light's own.
    // `rec`: the same without them (what Record stores). `plain`: the lists that don't name cells.
    const cellLevels = new Map<string, { lvl: Float64Array; rec: Float64Array }>();
    const plain: Record<string, number> = {}, plainRec: Record<string, number> = {};
    for (const f of show.fixtures) { stage[f.id] = { ...DARK, color: { ...DARK.color! } }; htp[f.id] = 0; }
    const types = typeMap(show);
    const modes = new Map(show.fixtures.map((f) => [f.id, modeOf(types.get(f.typeId), f.mode)]));

    for (const { p } of order) {
      const w = p.weightAt(now);
      if (w <= 0) continue;
      const look = p.look(now), quiet = this.jumped.has(p.id);
      for (const [fid, v] of Object.entries(look)) {
        if (!stage[fid]) continue;
        htp[fid] = Math.max(htp[fid], (v.intensity ?? 0) * w * p.master);
        let setsLevel = v.intensity !== undefined;
        const n = v.cellVals ? capsOf(modes.get(fid)).cells : 0;
        if (n > 0) {
          let c = cellLevels.get(fid);
          if (!c) { c = { lvl: new Float64Array(n), rec: new Float64Array(n) }; cellLevels.set(fid, c); }
          for (let k = 0; k < n; k++) {
            const own = v.cellVals![k]?.intensity, x = own ?? v.intensity ?? 0;
            if (own !== undefined) setsLevel = true;
            c.lvl[k] = Math.max(c.lvl[k], x * w * p.master); c.rec[k] = Math.max(c.rec[k], x);
          }
          if (Object.values(v.cellVals!).some((x) => x.color)) colored.add(fid);
        } else {
          plain[fid] = Math.max(plain[fid] ?? 0, (v.intensity ?? 0) * w * p.master);
          plainRec[fid] = Math.max(plainRec[fid] ?? 0, v.intensity ?? 0);
        }
        if (setsLevel) held.set(fid, Math.max(held.get(fid) ?? 0, w * p.hold(fid, now)));
        if (v.color) colored.add(fid);
        recorded[fid] = Math.max(recorded[fid] ?? 0, v.intensity ?? 0);   // what Record stores: not the level or a fade-out
        const { intensity: _i, fog, haze, confetti, bubbles, flame, sparks, co2, ...ltp } = v;
        // (most lights have none of these: one check, not seven)
        if (fog !== undefined || haze !== undefined || confetti !== undefined || bubbles !== undefined || flame !== undefined || sparks !== undefined || co2 !== undefined)
          for (const k of SMOKE) if (v[k] !== undefined && !(quiet && isGated(k))) { const m = (smoke[fid] ??= {}); m[k] = Math.max(m[k] ?? 0, v[k]! * w * p.master); }
        // (quiet: a machine's channel set by number in "All channels" stays quiet too)
        if (quiet && ltp.raw) ltp.raw = withoutChannels(ltp.raw, gatedChannels(modes.get(fid)));
        // (and a winch: a jump never moves one, it stays where it is until the list is played on)
        if (quiet && ltp.hoist !== undefined) delete ltp.hoist;
        if (quiet && ltp.cellVals && Object.values(ltp.cellVals).some((c) => c.hoist !== undefined))
          ltp.cellVals = Object.fromEntries(Object.entries(ltp.cellVals).map(([k, c]) => { const { hoist: _h, ...r } = c; return [k, r]; }));
        // (and a machine's own programs: a jump on the timeline never starts a flame program)
        if (quiet && (ltp.effectMacro !== undefined || ltp.colorMacro !== undefined) && isMachine(modes.get(fid))) { delete ltp.effectMacro; delete ltp.colorMacro; }
        stage[fid] = lerpResolved(stage[fid], ltp, w * p.blend(fid, now));
      }
    }
    for (const [fid, m] of Object.entries(smoke)) Object.assign(stage[fid], m);

    const look: Record<string, Resolved> = {};
    for (const f of show.fixtures) {
      const s = stage[f.id];
      s.intensity = htp[f.id];
      // each cell's level: its brightest list's, or that of a list lighting the whole light
      const cl = cellLevels.get(f.id), p0 = plain[f.id] ?? 0;
      if (cl) { for (let k = 0; k < cl.lvl.length; k++) if (cl.lvl[k] < p0) cl.lvl[k] = p0; s.cellLvl = cl.lvl; }
      const prog = this.programmer[f.id];
      const pr = prog ? this.progResolved(prog, f.id, presets, show.presets) : undefined;
      if (pr) mergeProgrammer(s, pr, capsOf(modes.get(f.id)).cells);
      if (pr?.intensity !== undefined) held.set(f.id, 1);
      // Cells the light doesn't have (a cue recorded before its type changed, a file from another
      // rig): gone, so they can't drive its dimmer or slip past the masters. (copied when trimmed:
      // the look shares its cell objects)
      if (s.cellVals) {
        const nC = capsOf(modes.get(f.id)).cells;
        if (nC < 2) delete s.cellVals;
        else { let over = false; for (const k in s.cellVals) if (+k >= nC) { over = true; break; } if (over) s.cellVals = Object.fromEntries(Object.entries(s.cellVals).filter(([k]) => +k < nC)); }
      }
      // (a cell the programmer sets is held, not the rest of its light)
      if (pr?.cellVals) for (const [k, c] of Object.entries(pr.cellVals)) { if (c.intensity !== undefined) held.set(`${f.id}#${k}`, 1); if (c.color) colored.add(f.id); }
      if (pr?.color) colored.add(f.id);
      // what Record stores: what the cues set, not where the masters and fades have it
      const lk: Resolved = { ...s, color: s.color && { ...s.color } };
      // (the cells as they are: nothing changes them in place after this)
      if (s.cellVals) lk.cellVals = s.cellVals;
      if (prog?.intensity === undefined) {
        lk.intensity = recorded[f.id] ?? 0;
        if (cl && s.cellLvl) {
          const r0 = plainRec[f.id] ?? 0, rec = Float64Array.from(cl.rec, (x) => Math.max(x, r0));
          if (pr?.cellVals) for (const [k, c] of Object.entries(pr.cellVals)) if (c.intensity !== undefined && +k < rec.length) rec[+k] = c.intensity;
          lk.cellLvl = rec;
        }
      } else if (s.cellLvl) lk.cellLvl = Float64Array.from(s.cellLvl);
      look[f.id] = lk;
    }

    this.runEffects(show, order.map((o) => o.p), stage, modes, now, held, colored);
    // what the lists and effects made, before the live layer (Highlight, flashes, the patch
    // check), the masters and the fitting to each fixture: new cues fade from this (without the
    // cells an effect drew; with the cells' own colours, and their levels to tell a lit light)
    this.lastStage = Object.fromEntries(Object.entries(stage).map(([k, { cells: _c, cellLvl, cellVals, ...v }]) => [k, { ...v, color: v.color && { ...v.color },
      ...(cellVals ? { cellVals } : {}), ...(cellLvl ? { cellLvl: Float64Array.from(cellLvl) } : {}) }]));

    // The live layer (held flash and fog buttons) wins, on pixel cells too.
    for (const [fid, v] of Object.entries(this.live)) {
      const s = stage[fid];
      if (!s) continue;
      const { cellVals: lc, ...r } = resolveValues(v, fid, presets);
      mergeInto(s, r);
      // (fog or a machine put to a value here wins over a raw number on its channel too: "stop the
      // fog" and the page closing mean it)
      if (s.raw && SMOKE.some((k) => r[k] !== undefined)) s.raw = withoutChannels(s.raw, smokeChannels(modes.get(fid), r));
      // (a light with cells of its own: the live values reach every cell, then single cells on top)
      if ((lc || r.intensity !== undefined || r.color) && !s.cells && (s.cellVals || s.cellLvl || lc)) {
        const n = capsOf(modes.get(fid)).cells;
        if (n > 0) s.cells = spreadCells(s, n);
      }
      if (s.cells) for (const c of s.cells) {
        if (r.intensity !== undefined) c.intensity = r.intensity;
        if (r.color) c.color = { ...r.color };
      }
      // single cells (Highlight on picked cells): on the cells as they are now, over what the whole light got
      if (lc && s.cells) for (const [k, c] of Object.entries(lc)) { const d = s.cells[+k]; if (d) Object.assign(d, c, c.color ? { color: { ...c.color } } : {}); }
      // a strobing flash on a light with no strobe channel (a pixel strip, a plain PAR): its level
      // blinks instead, 2 to 12 times a second (the frames go out at 40 a second)
      const rate = typeof r.strobe === 'number' ? r.strobe : 0;
      if (rate > 0.02 && !capsOf(modes.get(fid)).strobe) {
        const hz = 2 + 10 * rate;
        if (Math.floor(now * hz * 2) % 2 === 1) { s.intensity = 0; if (s.cells) for (const c of s.cells) c.intensity = 0; if (s.cellLvl) s.cellLvl = new Float64Array(s.cellLvl.length); }
      }
    }
    // Masters last, on everything that makes light: intensity, pixel cells, and raw channel
    // values on dimmer and emitter channels (set in "All channels").
    const gm0 = this.blackout ? 0 : this.grandMaster;
    // (a group of cells, "Rim": its master scales just those cells of its lights)
    let byGroup: Map<string, number> | undefined, byCell: Map<string, Map<number, number>> | undefined;
    for (const [gid, v] of Object.entries(this.groupMasters)) {
      if (!(v < 1)) continue;
      const g = show.groups.find((x) => x.id === gid), k0 = Math.max(0, v);
      if (!g) continue;
      if (g.cells?.length) for (const id of g.fixtures) { const m = ((byCell ??= new Map()).get(id) ?? new Map<number, number>()); for (const k of g.cells) m.set(k, (m.get(k) ?? 1) * k0); byCell.set(id, m); }
      else for (const id of g.fixtures) (byGroup ??= new Map()).set(id, (byGroup.get(id) ?? 1) * k0);
    }
    for (const f of show.fixtures) {
      const s = stage[f.id], gm = gm0 * (byGroup?.get(f.id) ?? 1);
      const cm = byCell?.get(f.id);
      if (cm) {
        // (cell levels to scale: the light's own for every cell when it has none of its own yet)
        const n = capsOf(modes.get(f.id)).cells;
        if (n > 1 && !s.cells) {
          if (!s.cellLvl) s.cellLvl = new Float64Array(n).fill(s.intensity ?? 0);
          for (const [k, x] of cm) if (k < n) s.cellLvl[k] *= x;
        } else if (s.cells) for (const [k, x] of cm) if (s.cells[k]) s.cells[k].intensity = (s.cells[k].intensity ?? 0) * x;
      }
      s.intensity = (s.intensity ?? 0) * gm;
      if (s.cells) for (const c of s.cells) c.intensity = (c.intensity ?? 0) * gm;
      else if (s.cellLvl && gm < 1) for (let k = 0; k < s.cellLvl.length; k++) s.cellLvl[k] *= gm;
      if (s.raw && gm < 1) {
        const m = modes.get(f.id), raw: Record<string, number> = {};
        for (const [ch, v] of Object.entries(s.raw)) raw[ch] = LIGHT.has(m?.channels[+ch]?.attr ?? '') ? Math.round(v * gm) : v;
        s.raw = raw;
      }
    }

    const frames = new Map<number, Uint8Array>();
    for (const f of show.fixtures) {
      const m = modes.get(f.id);
      if (!m) continue;
      fitLook(stage[f.id], capsOf(m), colored.has(f.id) || !!this.live[f.id]?.color);
      // too big for one universe: drawn on its own, then whole pixels per universe
      if (isWide(m)) {
        let all = wide.get(m);
        if (!all) { all = new Uint8Array(m.channels.length); wide.set(m, all); }
        renderFixture(f, m, stage[f.id], all, 0);
        for (const s of spansOf(f, m)) {
          let b = frames.get(s.universe);
          if (!b) { b = new Uint8Array(512); frames.set(s.universe, b); }
          b.set(all.subarray(s.from, s.from + s.count), s.at);
        }
        continue;
      }
      let buf = frames.get(f.universe);
      if (!buf) { buf = new Uint8Array(512); frames.set(f.universe, buf); }
      renderFixture(f, m, stage[f.id], buf);
    }
    // the channel wizard's test values on top (a fixture that isn't patched yet)
    const ov = this.overlay;
    if (ov) {
      let buf = frames.get(ov.universe);
      if (!buf) { buf = new Uint8Array(512); frames.set(ov.universe, buf); }
      ov.values.forEach((v, i) => { if (ov.address - 1 + i < 512) buf![ov.address - 1 + i] = v; });
    }
    // the machines last: a light (or the wizard) on a machine's address mustn't fire it. Their own
    // safety / enable channels follow the arming (the person's Arm opens both locks), written
    // before any gate: an enable patched over another machine's fire channel can't fire it either
    for (const f of show.fixtures) {
      const m = modes.get(f.id), buf = frames.get(f.universe);
      if (m && buf) for (const { i, on, off } of enableChannels(m)) { const at = f.address - 1 + i; if (at >= 0 && at < 512) buf[at] = this.armed ? on : off; }
    }
    for (const f of show.fixtures) {
      const m = modes.get(f.id), buf = frames.get(f.universe);
      if (m && buf) this.gate(f.id, f.address - 1, gatedChannels(m), buf, now);
    }
    // (the winches after every gate: a machine patched over one can't put its height to 0)
    const kin = new Map<string, number>();
    for (const f of show.fixtures) {
      const m = modes.get(f.id);
      if (m) this.hold(f, m, frames, stage[f.id], kin);
    }
    this.keepOrphans(show, modes, frames, kin);
    return { frames, stage, look };
  }

  // A winch on the wire, last of all (over raw numbers and the channel wizard too):
  // - armed and the show says where (its height, or a number on its channel): there, within its
  //   soft limits, and that's where it's held from now on;
  // - safe, or armed with nothing saying where: where it was last sent armed, never 0 (its top);
  // - where it is not known at all (never sent armed here, nothing kept from before a reload): its
  //   channel's default, and its motion enable stays shut, armed or not, so it can't run anywhere.
  // `heldSeed`: where they were before a reload (the page keeps it). Kept by fixture and channel
  // kind (`id:hoist`, `id:hoist:fine`), not by number: a changed type doesn't move it.
  heldSeed: Record<string, number> = {};
  private readonly held = new Map<string, number>();
  heldOwn(): Record<string, number> { return Object.fromEntries(this.held); }
  // `kin`: every winch byte written ('universe:channel' -> value; an enable at its safe value), for
  // the ones that go (keepOrphans)
  private hold(f: Fixture, m: FixtureMode, frames: Map<number, Uint8Array>, look: Resolved | undefined, kin: Map<string, number>) {
    const gs = heldGroups(m);
    if (!gs.length) return;
    const spans = spansOf(f, m);
    // (where channel i of the light is: its universe and place, across universes for a wide one)
    const loc = (i: number): [Uint8Array, number, number] | undefined => {
      for (const s of spans) if (i >= s.from && i < s.from + s.count) {
        const at = s.at + i - s.from;
        if (at < 0 || at >= 512) return undefined;
        let b = frames.get(s.universe);
        if (!b) { b = new Uint8Array(512); frames.set(s.universe, b); }
        return [b, at, s.universe];
      }
      return undefined;
    };
    const put = (i: number, v: number, kept = v) => { const p = loc(i); if (p) { p[0][p[1]] = v; kin.set(`${p[2]}:${p[1]}`, kept); } };
    const lim = f.hoistLimits;
    let unknown = false;
    for (const g of gs) {
      const key = heldKey(f.id, g);
      const cl = g.cell !== undefined ? (look?.cells?.[g.cell] ?? look?.cellVals?.[g.cell]) : undefined;
      const want = cl?.hoist ?? look?.hoist;
      if (this.armed && typeof want === 'number') {
        // worked out from the look, not read back from the frame: nothing patched over it, no number
        // from the wizard, gets past its soft limits (they're parts of its travel, also on a span)
        const x = lim ? Math.max(lim[0], Math.min(lim[1], want)) : Math.max(0, Math.min(1, want));
        if (g.co) { const v = level(m.channels[g.co.i], !!g.fi, x); put(g.co.i, v); this.held.set(key, v); }
        if (g.fi) { const v = level(m.channels[g.fi.i], false, x); put(g.fi.i, v); this.held.set(`${key}:fine`, v); }
        continue;
      }
      for (const [c, k] of [[g.co, key], [g.fi, `${key}:fine`]] as const) {
        if (!c) continue;
        const h = this.held.get(k) ?? this.heldSeed[k];
        if (h !== undefined) put(c.i, h); else { put(c.i, c.def); unknown = true; }
      }
    }
    // its motion enable: open only while armed and its place is known; its own programs and control
    // channels at their off while safe
    for (const { i, on, off } of enableChannels(m)) put(i, this.armed && !unknown ? on : off, off);
    if (!this.armed) m.channels.forEach((c, i) => { if (KINETIC_CTL.includes(c.attr)) put(i, kineticOff(c)); });
  }
  // A winch that went from the patch (deleted, moved to another address, another show opened): its
  // channels keep what they had, its enable at safe, until something else is patched there. Never
  // 0 by itself: that's its top. (This page and its output thread only; a reload forgets them.)
  private orphans = new Map<string, number>();
  private kinWas = new Map<string, number>();
  private keepOrphans(show: Show, modes: Map<string, FixtureMode | undefined>, frames: Map<number, Uint8Array>, kin: Map<string, number>) {
    for (const [k, v] of this.kinWas) if (!kin.has(k)) this.orphans.set(k, v);
    for (const k of kin.keys()) this.orphans.delete(k);
    this.kinWas = kin;
    if (!this.orphans.size) return;
    // (what the patch uses now: an orphan under a light patched there gives way)
    const used = new Set<string>();
    for (const f of show.fixtures) for (const s of spansOf(f, modes.get(f.id))) for (let i = 0; i < s.count; i++) used.add(`${s.universe}:${s.at + i}`);
    for (const [k, v] of this.orphans) {
      if (used.has(k)) { this.orphans.delete(k); continue; }
      const [u, at] = k.split(':').map(Number);
      let b = frames.get(u);
      if (!b) { b = new Uint8Array(512); frames.set(u, b); }
      b[at] = v;
    }
  }
  // The winches' heights put into frames that are about to be frozen (Blind): where the wire held
  // them (`held`, the output thread's), not where this page's own copy of the engine had them.
  putHeld(frames: Map<number, Uint8Array>, held: Record<string, number>) {
    const show = this.getShow(), types = typeMap(show);
    for (const f of show.fixtures) {
      const m = modeOf(types.get(f.typeId), f.mode);
      if (!m) continue;
      const spans = spansOf(f, m);
      for (const g of heldGroups(m)) {
        const key = heldKey(f.id, g);
        for (const [c, k] of [[g.co, key], [g.fi, `${key}:fine`]] as const) {
          const v = held[k], s = c && spans.find((x) => c.i >= x.from && c.i < x.from + x.count);
          if (!c || !s || v === undefined) continue;
          const at = s.at + c.i - s.from, b = frames.get(s.universe);
          if (b && at >= 0 && at < 512) b[at] = v;
        }
      }
    }
  }
  // The machines on the wire (the stage keeps showing them): 0 while safe; armed, a shot needs its
  // channel to have been off first, and ends after its longest time on.
  private gate(id: string, base: number, gated: { i: number; max: number; off: number }[], buf: Uint8Array, now: number) {
    for (const { i, max, off } of gated) {
      const at = base + i;
      if (at < 0 || at >= 512) continue;
      const key = `${id}:${i}`;
      if (!this.armed) { buf[at] = 0; this.shots.delete(key); continue; }
      const since = this.shots.get(key);
      if (buf[at] <= off) this.shots.set(key, -1);
      else if (since === undefined) buf[at] = 0;                        // on since before arming, or cut: waits for an off
      else if (since < 0) this.shots.set(key, now);                     // a shot starts
      else if (now - since > max) { buf[at] = 0; this.shots.delete(key); }   // on too long: cut
    }
  }

  // Every effect that runs (from a cue, or by hand), mixed onto the stage.
  private runEffects(show: Show, players: ListPlayer[], stage: Record<string, Resolved>, modes: Map<string, FixtureMode | undefined>, now: number,
    held = new Map<string, number>(), colored = new Set<string>()) {
    const w = new Map<string, number>();
    const add = (id: string, v: number) => { if (v > 0) w.set(id, Math.min(1, Math.max(w.get(id) ?? 0, v))); };
    for (const [id, r] of this.liveFx) {
      const v = rampAt(r, now);
      if (v <= 0 && r.to === 0 && now >= r.start + r.dur) this.liveFx.delete(id); else add(id, v);
    }
    for (const p of players) {
      const pw = p.weightAt(now) * p.master;
      for (const [id, v] of p.effects(now)) add(id, v * pw);
    }
    const run: { e: Effect; def: EffectDef; p: EffectParams; f: number }[] = [];
    for (const e of show.effects) {
      const def = EFFECT_MAP.get(e.kind), f = w.get(e.id) ?? 0;
      if (!def || f <= 0) continue;
      run.push({ e, def, p: { ...paramsOf(e.kind, e.params), sound: this.sound }, f });
    }
    run.sort((a, b) => FX_ORDER[a.def.category] - FX_ORDER[b.def.category]);
    const base = run.some((r) => r.p.lightUp) ? new Map(Object.entries(stage).map(([id, s]) => [id, s.intensity ?? 0])) : undefined;
    for (const { e, def, p, f } of run) {
      let since = this.fxSince.get(e.id);
      // Tempo effects count from the last whole beat, so their steps land on the beat (and on the
      // music's kicks when the beat clock follows a microphone).
      if (!since) { since = { beats: Math.floor(this.beats), seconds: this.seconds }; this.fxSince.set(e.id, since); }
      const total = (p.tempo ? this.beats - since.beats : this.seconds - since.seconds) / p.speed;
      const targets = effectTargets(show, e, def, p, modes);
      // each element's light and its place on it (pixel shows and pictures use them)
      const rowOf = new Map<string, number>(), lightOf = new Map(show.fixtures.map((f) => [f.id, f]));
      for (const t of targets) if (!rowOf.has(t.fixture)) rowOf.set(t.fixture, rowOf.size);
      const where = targets.map((t) => {
        const m = modes.get(t.fixture)!, n = t.cell === undefined ? 1 : capsOf(m).cells;
        return { u: n > 1 ? t.cell! / (n - 1) : 0.5, row: rowOf.get(t.fixture)!, rows: rowOf.size, at: t.cell === undefined ? undefined : placesOfLight(lightOf.get(t.fixture) ?? {}, m), cell: t.cell };
      });
      const clock = { beats: this.beats - since.beats, secs: this.seconds - since.seconds };
      // one effect that can't run (a formula, a picture, a value from a file) stops itself, never
      // the frame: everything else goes on going out (the app says which one, from `broken`)
      try {
        applyFx(stage, targets, runEffect(def, p, targets.length, total, seedOf(e.id), where, clock), def, p, f * p.level, (id) => capsOf(modes.get(id)!).cells, held, base);
      } catch (err) {
        if (!this.broken.has(e.id)) this.broken.set(e.id, (err as Error)?.message ?? String(err));
        continue;
      }
      if (this.broken.size) this.broken.delete(e.id);          // (runs again: mended)
      if (def.category === 'color' || def.category === 'pixel') for (const t of targets) colored.add(t.fixture);
    }
    for (const id of this.fxSince.keys()) if (!w.has(id)) this.fxSince.delete(id);
    this.fxWeights = w;
  }
}

// Values on top of a look: like Object.assign, but channel-by-channel for raw values (setting one
// channel by hand mustn't drop the cue's other raw channels).
function mergeInto(s: Resolved, r: Resolved) {
  const raw = r.raw ? { ...(s.raw ?? {}), ...r.raw } : s.raw;
  Object.assign(s, r);
  if (raw) s.raw = raw;
}
// The programmer on top of a look: what it sets for the whole light wins over cells the cues set
// (all blue means every cell blue, a level for the light is every cell's level), what it sets for
// single cells wins over everything.
// (cell levels always end up in cellLvl, so the masters, Blackout and the strobe blink reach them)
function mergeProgrammer(s: Resolved, r: Resolved, n: number) {
  const { cellVals: pc, ...rest } = r;
  let cv = s.cellVals ? stripCells(s.cellVals, rest) : undefined;
  mergeInto(s, rest);
  if (rest.intensity !== undefined) s.cellLvl = undefined;
  if (pc) {
    cv = { ...(cv ?? {}) };
    let lv: Float64Array | undefined;
    for (const [k, c] of Object.entries(pc)) {
      cv[k] = { ...(cv[k] ?? {}), ...c };
      if (c.intensity === undefined || n < 1 || +k >= n) continue;
      lv ??= s.cellLvl ? Float64Array.from(s.cellLvl) : new Float64Array(n).fill(s.intensity ?? 0);
      lv[+k] = c.intensity;
    }
    if (lv) s.cellLvl = lv;
  }
  s.cellVals = cv && Object.keys(cv).length ? cv : undefined;
}

export const seedOf = (id: string) => { let h = 7; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; return Math.floor(hash(h) * 1e6); };

// The fixtures (or pixels) an effect runs over, in order. Moves only go to fixtures that can move,
// colour to ones that do colour; pixel bars split into their cells unless `pixels` is off.
export function effectTargets(show: Show, e: Effect, def: EffectDef, p: EffectParams, modes: Map<string, FixtureMode | undefined>): Target[] {
  const grp = e.group ? show.groups.find((g) => g.id === e.group) : undefined, groupCells = grp?.cells;
  let ids = grp ? grp.fixtures : e.fixtures ?? [];
  // On the stage instead of in list order: left to right, back to front, or from the centre out.
  if (p.order !== 'list') {
    const at = new Map(show.fixtures.map((f) => [f.id, f]));
    const cx = ids.reduce((a, id) => a + (at.get(id)?.x ?? 0.5), 0) / Math.max(1, ids.length);
    const cy = ids.reduce((a, id) => a + (at.get(id)?.y ?? 0.5), 0) / Math.max(1, ids.length);
    const key = (id: string) => { const f = at.get(id); return !f ? 0 : p.order === 'x' ? f.x : p.order === 'y' ? f.y : Math.hypot(f.x - cx, f.y - cy); };
    ids = [...ids].sort((a, b) => key(a) - key(b));
  }
  const out: Target[] = [];
  for (const id of ids) {
    const m = modes.get(id);
    if (!m) continue;
    const c = capsOf(m);
    if (def.category === 'move' ? !c.position : def.category === 'color' ? !c.color : !(c.intensity || c.color || c.white || c.cct)) continue;
    // (an effect on some cells only, its own or its group's: those, in their order)
    const only = e.cells?.length ? e.cells : e.group ? groupCells : undefined;
    // (a move on a moving bar: each of its heads, so a wave or a fan runs along them)
    if (def.category === 'move' && c.heads > 1) {
      // (heads that only tilt: the bar pans as one, with its first head's part of the move)
      const own = c.cellMoves.includes('pan');
      let first = true;
      for (const i of only?.length ? only : headCellsOf(m)) if (i >= 0 && i < c.cells) { out.push(own ? { fixture: id, cell: i } : { fixture: id, cell: i, barPan: first }); first = false; }
    }
    else if (only?.length && c.cells > 1 && def.category !== 'move') { for (const i of only) if (i >= 0 && i < c.cells) out.push({ fixture: id, cell: i }); }
    else if (p.pixels && c.cells > 1 && def.category !== 'move') for (let i = 0; i < c.cells; i++) out.push({ fixture: id, cell: i });
    else out.push({ fixture: id });
  }
  return out;
}
