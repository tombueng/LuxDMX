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
import { enableValue, isGated, MAX_ON } from '../model/safety';
import type { CueAction, CueList, Effect, FixtureMode, Preset, Resolved, Show, Values } from '../model/types';
import { capsOf, modeOf, typeMap } from '../model/library';
import { isWide, placesOfLight, spansOf } from '../model/pixelLayout';
// fog, haze and the effect machines: highest wins across lists, like a level (a haze list runs all
// night whatever the moods say; two lists firing confetti fire it)
const SMOKE = ['fog', 'haze', 'confetti', 'bubbles', 'flame', 'sparks', 'co2'] as const;
import { ListPlayer, type PlayerStatus } from './player';
import { lerpResolved, resolveValues } from './resolve';
import { DARK, fitLook, renderFixture } from './render';
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
const gatedOf = new WeakMap<FixtureMode, { i: number; max: number }[]>();
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
function gatedChannels(m: FixtureMode | undefined): { i: number; max: number }[] {
  if (!m) return [];
  let g = gatedOf.get(m);
  if (!g) { g = m.channels.flatMap((c, i) => (isGated(c.attr) ? [{ i, max: MAX_ON[c.attr] ?? 5 }] : [])); gatedOf.set(m, g); }
  return g;
}

export class Engine {
  readonly players = new Map<string, ListPlayer>();
  programmer: Record<string, Values> = {};
  grandMaster = 1;
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
    const cue = this.player(id).jump(l, i, this.now(), this.presetMap(), ++this.seq, fade, this.lastStage, exact, this.fxLights());
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
  setMaster(id: string, v: number) { this.player(id).master = Math.max(0, Math.min(1, v)); }

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
    if (!p) { p = new ListPlayer(id); this.players.set(id, p); }
    return p;
  }
  private presetMap() { return new Map<string, Preset>(this.getShow().presets.map((p) => [p.id, p])); }

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
        if (v.intensity !== undefined) held.set(fid, Math.max(held.get(fid) ?? 0, w * p.hold(fid, now)));
        if (v.color) colored.add(fid);
        recorded[fid] = Math.max(recorded[fid] ?? 0, v.intensity ?? 0);   // what Record stores: not the level or a fade-out
        const { intensity: _i, fog, haze, confetti, bubbles, flame, sparks, co2, ...ltp } = v;
        // (most lights have none of these: one check, not seven)
        if (fog !== undefined || haze !== undefined || confetti !== undefined || bubbles !== undefined || flame !== undefined || sparks !== undefined || co2 !== undefined)
          for (const k of SMOKE) if (v[k] !== undefined && !(quiet && isGated(k))) { const m = (smoke[fid] ??= {}); m[k] = Math.max(m[k] ?? 0, v[k]! * w * p.master); }
        // (quiet: a machine's channel set by number in "All channels" stays quiet too)
        if (quiet && ltp.raw) ltp.raw = withoutChannels(ltp.raw, gatedChannels(modes.get(fid)));
        stage[fid] = lerpResolved(stage[fid], ltp, w * p.blend(fid, now));
      }
    }
    for (const [fid, m] of Object.entries(smoke)) Object.assign(stage[fid], m);

    const look: Record<string, Resolved> = {};
    for (const f of show.fixtures) {
      const s = stage[f.id];
      s.intensity = htp[f.id];
      const prog = this.programmer[f.id];
      if (prog) mergeInto(s, resolveValues(prog, f.id, presets));
      if (prog?.intensity !== undefined) held.set(f.id, 1);
      if (prog?.color) colored.add(f.id);
      look[f.id] = { ...s, color: s.color && { ...s.color } };
      if (prog?.intensity === undefined) look[f.id].intensity = recorded[f.id] ?? 0;
    }

    this.runEffects(show, order.map((o) => o.p), stage, modes, now, held, colored);
    // what the lists and effects made, before the live layer (Highlight, flashes, the patch
    // check), the masters and the fitting to each fixture: new cues fade from this
    // (without pixel cells: a cue fading in from the stage takes the fixture's own values only)
    this.lastStage = Object.fromEntries(Object.entries(stage).map(([k, { cells: _c, ...v }]) => [k, { ...v, color: v.color && { ...v.color } }]));

    // The live layer (held flash and fog buttons) wins, on pixel cells too.
    for (const [fid, v] of Object.entries(this.live)) {
      const s = stage[fid];
      if (!s) continue;
      const r = resolveValues(v, fid, presets);
      mergeInto(s, r);
      // (fog or a machine put to a value here wins over a raw number on its channel too: "stop the
      // fog" and the page closing mean it)
      if (s.raw && SMOKE.some((k) => r[k] !== undefined)) s.raw = withoutChannels(s.raw, smokeChannels(modes.get(fid), r));
      if (s.cells) for (const c of s.cells) {
        if (r.intensity !== undefined) c.intensity = r.intensity;
        if (r.color) c.color = { ...r.color };
      }
      // a strobing flash on a light with no strobe channel (a pixel strip, a plain PAR): its level
      // blinks instead, 2 to 12 times a second (the frames go out at 40 a second)
      const rate = typeof r.strobe === 'number' ? r.strobe : 0;
      if (rate > 0.02 && !capsOf(modes.get(fid)).strobe) {
        const hz = 2 + 10 * rate;
        if (Math.floor(now * hz * 2) % 2 === 1) { s.intensity = 0; if (s.cells) for (const c of s.cells) c.intensity = 0; }
      }
    }
    // Masters last, on everything that makes light: intensity, pixel cells, and raw channel
    // values on dimmer and emitter channels (set in "All channels").
    const gm = this.blackout ? 0 : this.grandMaster;
    for (const f of show.fixtures) {
      const s = stage[f.id];
      s.intensity = (s.intensity ?? 0) * gm;
      if (s.cells) for (const c of s.cells) c.intensity = (c.intensity ?? 0) * gm;
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
    return { frames, stage, look };
  }

  // The machines on the wire (the stage keeps showing them): 0 while safe; armed, a shot needs its
  // channel to have been off first, and ends after its longest time on.
  private gate(id: string, base: number, gated: { i: number; max: number }[], buf: Uint8Array, now: number) {
    for (const { i, max } of gated) {
      const at = base + i;
      if (at < 0 || at >= 512) continue;
      const key = `${id}:${i}`;
      if (!this.armed) { buf[at] = 0; this.shots.delete(key); continue; }
      const since = this.shots.get(key);
      if (buf[at] === 0) this.shots.set(key, -1);
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

export const seedOf = (id: string) => { let h = 7; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; return Math.floor(hash(h) * 1e6); };

// The fixtures (or pixels) an effect runs over, in order. Moves only go to fixtures that can move,
// colour to ones that do colour; pixel bars split into their cells unless `pixels` is off.
export function effectTargets(show: Show, e: Effect, def: EffectDef, p: EffectParams, modes: Map<string, FixtureMode | undefined>): Target[] {
  let ids = e.group ? show.groups.find((g) => g.id === e.group)?.fixtures ?? [] : e.fixtures ?? [];
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
    if (p.pixels && c.cells > 1 && def.category !== 'move') for (let i = 0; i < c.cells; i++) out.push({ fixture: id, cell: i });
    else out.push({ fixture: id });
  }
  return out;
}
