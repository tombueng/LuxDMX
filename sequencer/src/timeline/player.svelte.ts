// Plays the timeline: the song (a file, or the demo beat) and, on its clock, what's placed on it,
// and the crowd's sound. It lives with the app (not the Timeline view), so it keeps playing in Live
// or the 3D stage. The app's 40 Hz tick calls tick(): whatever's due since the last tick happens, in
// order. A jump (seek) puts the stage where it would be at that point, without fades. The song's
// clock runs from the start of the time before the song (`start`, below 0) to the end of the time
// after it (`end`); the song itself plays from 0 to its `duration`.
import type { Show } from '../model/types';
import { due, spanOf, stateAt, type Timeline, type TimelineAction, type TimelineItem } from '../model/timeline';
import { CrowdSound } from '../audio/crowd';
import { DEMO_BPM, DEMO_SECONDS, demoPeaks, playDemo } from './beat';
import { beatAfter, partAfter, partsOf, startOf, type Part } from './gig';
import { getSong, putSong } from '../store/audio';

export interface TimelineHost {
  readonly show: Show;
  readonly showId: string;
  checkpoint(): void;
  markDirty(delay?: number): void;
  doTimeline(a: TimelineAction, catchUp: boolean): void;
  // soft: lists without a cue there keep what they have (playing from the top: never a dark moment)
  putTimelineState(s: ReturnType<typeof stateAt>, items: TimelineItem[], soft?: boolean): void;
  songEnded?(): void;                 // the song played to its end by itself
}

// a song picked for one show that arrived after another was opened
export class ShowChanged extends Error { constructor() { super('another show is open now'); } }

export class TimelinePlayer {
  playing = $state(false);
  position = $state(0);
  peaks = $state.raw<number[]>([]);
  missing = $state('');               // a song this browser doesn't have (opened on another computer)
  // how loud (0..1), kept per browser
  volume = $state((() => { try { const v = Number(localStorage.getItem('luxdmx.seq.volume')); return Number.isFinite(v) && localStorage.getItem('luxdmx.seq.volume') !== null ? v : 0.8; } catch { return 0.8; } })());
  // "The band plays live": no sound out of this browser's speakers (kept per browser). The song's
  // clock runs on, and a recording of the stage still gets the song (it hangs off the bus).
  soundHere = $state((() => { try { return localStorage.getItem('luxdmx.seq.sound') !== 'off'; } catch { return true; } })());
  // The crowd (audio/crowd.ts): how loud against the song, and whether it's heard at all (kept per
  // browser). It goes into the same bus as the song: the speakers and a recording both get it.
  readonly crowd = new CrowdSound();
  crowdVolume = $state((() => { try { const v = Number(localStorage.getItem('luxdmx.seq.crowdVol')); return Number.isFinite(v) && localStorage.getItem('luxdmx.seq.crowdVol') !== null ? v : 0.8; } catch { return 0.8; } })());
  crowdOn = $state((() => { try { return localStorage.getItem('luxdmx.seq.crowd') !== 'off'; } catch { return true; } })());
  count = $state(0);                  // counting in: the click it's on (1, 2, 3, 4), else 0
  // Next part, waiting for its beat: when (on the song's clock) and where to
  pending = $state<{ at: number; to: Part } | null>(null);
  clock = 0;                          // the song's clock as the last tick had it (below 0 while counting in)
  private countTo = -Infinity;        // the first downbeat a count-in leads to
  private countN = 0;
  private gain: GainNode | undefined;
  private ctx: AudioContext | undefined;
  private buffer: AudioBuffer | undefined;
  private bufferFor = '';
  private stopSound: (() => void) | undefined;
  private starting = 0;               // the play() under way (0: none); a second Play meanwhile is the same one
  private token = 0;                  // every start and every stop counts up: a start that was overtaken gives up
  private loading: Promise<void> | undefined;
  private loadingFor = '';
  private startedAt = 0;              // where position 0 would have been, on the clock in use
  private perfClock = false;          // the AudioContext won't run (no sound device, a policy): the page's clock
  private last = 0;

  constructor(private app: TimelineHost) { this.crowd.setVolume(this.crowdVolume, this.crowdOn); }
  get tl(): Timeline | undefined { return this.app.show.timeline; }
  // the song's length; the show on the timeline runs from `start` (0, or below 0 with time before
  // the song) to `end` (the song's end, or later with time after it)
  get duration() { return this.tl?.duration ?? 0; }
  get start() { return spanOf(this.tl).from; }
  get end() { return spanOf(this.tl).to; }
  // stopped at the top (a show opened, another song up): Play starts from the very start
  private top = true;

  // a timeline for this show (empty), if it hasn't got one
  ensure(): Timeline {
    if (!this.app.show.timeline) this.app.show.timeline = { duration: 240, bpm: this.app.show.settings.bpm, items: [] };
    return this.app.show.timeline;
  }

  // ---- the sound
  // `forShow`: the show it was picked for (a download takes a while: if another show is open by
  // then, it isn't put on that one). `fresh`: another song than before, so the last one's tempo,
  // first downbeat and parts go with it (in the same undo step). Hands back the decoded song (a file
  // of your own: its tempo and parts are found from it).
  async loadFile(f: File, forShow = this.app.showId, fresh = false): Promise<AudioBuffer> {
    const ctx = this.audio(), data = await f.arrayBuffer();
    if (!ctx) throw new Error('This browser can\'t play sound here');
    const buf = await ctx.decodeAudioData(data.slice(0));
    if (this.app.showId !== forShow) throw new ShowChanged();
    this.stop();
    const tl = this.ensure(), key = `${this.app.showId}:${f.name}`;
    this.app.checkpoint();
    tl.audio = { name: f.name, duration: buf.duration, store: key };
    delete tl.demo;
    if (fresh) { delete tl.sections; delete tl.bpm; delete tl.offset; }
    tl.duration = buf.duration;
    this.buffer = buf; this.bufferFor = key;
    this.peaks = peaksOf(buf, 1600);
    this.missing = '';
    this.app.markDirty(0);
    try { await putSong(key, f); } catch { /* it plays now; next time it asks for the file again */ }
    return buf;
  }
  useDemo() {
    this.stop();
    const tl = this.ensure();
    this.app.checkpoint();
    delete tl.audio; tl.demo = true; tl.duration = DEMO_SECONDS; tl.bpm = DEMO_BPM; tl.offset = 0;
    this.buffer = undefined; this.bufferFor = '';
    this.peaks = demoPeaks(1600); this.missing = '';
    this.app.markDirty(0);
  }
  // the song of the show that's open (after a show is opened or the view comes up)
  // one decode per song, however many ask for it at once (the view, Play)
  prepare(): Promise<void> {
    // (at the top: the playhead where Play starts, before the song when there's time before it)
    if (this.top && !this.playing && this.position === 0) this.position = this.start;
    if (this.tl?.crowd?.length) this.crowd.prepare();
    const key = this.tl?.demo ? 'demo' : this.tl?.audio?.store ?? '';
    if (this.loading && this.loadingFor === key) return this.loading;
    this.loadingFor = key;
    const p = (this.loading = this.load().finally(() => { if (this.loading === p) this.loading = undefined; }));
    return p;
  }
  private async load() {
    const tl = this.tl;
    if (!tl) { this.peaks = []; this.buffer = undefined; this.bufferFor = ''; return; }
    if (tl.demo) { if (!this.peaks.length || this.bufferFor) { this.peaks = demoPeaks(1600); this.bufferFor = ''; this.buffer = undefined; } return; }
    if (!tl.audio?.store) { this.peaks = []; this.buffer = undefined; this.bufferFor = ''; return; }
    const key = tl.audio.store;
    if (this.bufferFor === key) return;
    // (the song before isn't this show's: never played under it while this one loads or is missing)
    this.buffer = undefined; this.bufferFor = '';
    try {
      const blob = await getSong(key);
      if (this.tl?.audio?.store !== key) return;            // another show meanwhile
      if (!blob) { this.missing = tl.audio.name; this.peaks = []; return; }
      const ac = this.audio();
      if (!ac) { this.missing = tl.audio.name; return; }
      const buf = await ac.decodeAudioData(await blob.arrayBuffer());
      if (this.tl?.audio?.store !== key) return;
      this.buffer = buf; this.bufferFor = key; this.peaks = peaksOf(buf, 1600); this.missing = '';
    } catch { if (this.tl?.audio?.store === key) this.missing = tl.audio.name; }
  }
  // the song, decoded (after prepare()); undefined for the demo beat or a missing file. For a render
  // (render/audio.ts): the mix is made from it, not from what the speakers play.
  get song(): AudioBuffer | undefined { return this.tl?.audio && this.bufferFor === this.tl.audio.store ? this.buffer : undefined; }
  // (undefined: this browser can't make sound here; the show plays on the page's clock)
  private audio(): AudioContext | undefined { try { return (this.ctx ??= new AudioContext()); } catch { return undefined; } }
  // Every sound goes into the bus: the speakers get it at the volume, a recording at full (a muted
  // laptop still records the song).
  private bus: GainNode | undefined;
  private out() {
    const ctx = this.audio()!;
    if (!this.bus || !this.gain) {
      this.bus = ctx.createGain(); this.gain = ctx.createGain();
      this.bus.connect(this.gain); this.gain.connect(ctx.destination);
      if (this.tap) this.bus.connect(this.tap);
    }
    this.gain.gain.value = this.soundHere ? this.volume : 0;
    return this.bus;
  }
  // the sound as a stream (for recording the stage with its music); undefined without sound. Asked
  // for on a click (Record): the sound wakes up then, and a silent source keeps the track going
  // while nothing plays (before the first Play, paused, between songs), or a recorder waits for
  // sound that never comes and the file stays empty.
  private tap: MediaStreamAudioDestinationNode | undefined;
  audioStream(): MediaStream | undefined {
    const ctx = this.audio();
    if (!ctx) return undefined;
    if (!this.tap) {
      this.tap = ctx.createMediaStreamDestination();
      this.bus?.connect(this.tap);
      try { const hush = ctx.createConstantSource(); hush.offset.value = 0; hush.connect(this.tap); hush.start(); } catch { /* an old browser: as before */ }
    }
    void ctx.resume().catch(() => undefined);
    return this.tap.stream;
  }
  setVolume(v: number) { this.volume = Math.max(0, Math.min(1, v)); if (this.gain) this.gain.gain.value = this.soundHere ? this.volume : 0; try { localStorage.setItem('luxdmx.seq.volume', String(this.volume)); } catch { /* not kept */ } }
  setCrowd(volume: number, on = this.crowdOn) {
    this.crowdVolume = Math.max(0, Math.min(1, volume)); this.crowdOn = on;
    this.crowd.setVolume(this.crowdVolume, on);
    try { localStorage.setItem('luxdmx.seq.crowdVol', String(this.crowdVolume)); if (on) localStorage.removeItem('luxdmx.seq.crowd'); else localStorage.setItem('luxdmx.seq.crowd', 'off'); } catch { /* this time only */ }
  }
  setSoundHere(on: boolean) {
    this.soundHere = on;
    if (this.gain) this.gain.gain.value = on ? this.volume : 0;
    try { if (on) localStorage.removeItem('luxdmx.seq.sound'); else localStorage.setItem('luxdmx.seq.sound', 'off'); } catch { /* this time only */ }
  }

  // ---- transport
  // `fresh`: Play pressed (a moment placed right where it starts happens); a restart after a
  // jump or a scrub fires nothing at the spot it lands on
  async play(fresh = true) {
    if (this.playing || this.starting) return;
    // (right where a jump or a scrub landed: a moment there was jumped to, not played into. Play
    // goes on from just after it: Go to a CO2 moment, Space, doesn't fire the CO2. Back at the very
    // start it's the song from the top: what's on the start happens.)
    if (this.landed > this.start + 1e-6 && Math.abs(this.position - this.landed) < 1e-6) fresh = false;
    this.landed = Number.NaN;
    const go = (this.starting = ++this.token);
    this.ensure();
    await this.prepare();
    if (this.starting !== go) return;                       // paused (or another show) meanwhile
    const ctx = this.audio();
    if (ctx) await Promise.race([ctx.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 400))]);
    if (this.starting !== go) return;
    this.starting = 0;
    const tl = this.ensure();                               // (this show's, as it is now)
    const span = spanOf(tl);
    if (this.position >= span.to - 0.05) { this.position = span.from; this.top = true; }
    // From the top (Play at the very start, after Next song, after the end): on the band's "one", a
    // beat before the first downbeat or after a bar of clicks (gig.ts). What's placed before that
    // point happens at the press, as if the silence played; nothing is released first (the look
    // that's up stays up: never a dark moment between songs). With time before the song, the show
    // starts there (the clicks, if any, still lead into the song).
    const atTop = this.position <= span.from + 1e-6 || (this.top && this.position === 0);
    const top = fresh && atTop ? startOf(tl, this.app.show.setlist?.countIn) : undefined;
    const from = top ? Math.min(span.from < 0 ? span.from : top.from, top.from) : this.position;
    this.top = false;
    // no running audio clock: the show still plays, on the page's own clock (and silently)
    this.perfClock = !ctx || ctx.state !== 'running';
    if (!ctx || this.perfClock) {
      this.stopSound = undefined; this.startedAt = performance.now() / 1000 - from;
    } else {
      const now = ctx.currentTime, stops: (() => void)[] = [];
      if (this.buffer && tl.audio) {
        const src = ctx.createBufferSource(); src.buffer = this.buffer; src.connect(this.out());
        if (from < 0) src.start(now - from, 0); else src.start(0, from);     // (counting in: it comes in after the clicks)
        stops.push(() => { try { src.stop(); } catch { /* already */ } src.disconnect(); });
      } else if (tl.demo) stops.push(playDemo(ctx, this.out(), from));
      // (the clicks are for the band: the speakers, not a recording of the stage)
      if (top?.clicks.length) { this.out(); stops.push(clicks(ctx, this.gain!, top.clicks.map((c) => now + c - from))); }
      // the crowd: on the same clock, into the same bus (only when the song has one)
      if (tl.crowd?.length) {
        try { this.crowd.start(ctx, this.out(), from); stops.push(() => this.crowd.stop()); } catch { /* no crowd here: the show plays on */ }
      }
      this.stopSound = stops.length ? () => { for (const s of stops) s(); } : undefined;
      this.startedAt = now - from;                    // (silent: the context's clock all the same)
    }
    // starting somewhere in the middle: the stage as it would be there; and a moment placed right
    // where it starts happens too (the next tick takes (last, now])
    if (top) this.putState(span.from < 0 ? from : 0, true); else this.putState(from);
    this.countTo = top?.clicks.length ? top.downbeat : -Infinity;
    this.countN = top?.clicks.length ?? 0;
    this.last = top ? Math.min(from, 0) - 1e-3 : fresh ? from - 1e-3 : from;
    this.clock = from; this.position = Math.max(span.from, from);
    this.playing = true;
  }
  pause() {
    this.starting = 0; this.token++;
    this.pending = null; this.count = 0; this.countTo = -Infinity;
    if (!this.playing) return;
    this.position = Math.max(this.start, Math.min(this.end, this.now()));
    this.stopSound?.(); this.stopSound = undefined;
    this.playing = false;
  }
  // another song is up: stopped at its very start, nothing waiting
  reset() { this.pause(); this.position = this.start; this.clock = this.position; this.landed = Number.NaN; this.missing = ''; this.top = true; }
  // (a show opened, another song file: Play starts from the top)
  stop() { this.pause(); this.top = true; }
  // after a reload: where the song was (and going on if it was playing). Without a click on the
  // page the browser may keep it silent: the first touch brings the sound in where it is.
  resumeAt(pos: number, playing: boolean) {
    if (!this.tl) return;
    this.position = Math.max(this.start, Math.min(this.end, pos));
    this.top = false;
    if (!playing || this.position >= this.end - 0.05) { this.putState(this.position); return; }
    void this.play(false).then(() => {
      if (!this.perfClock) return;
      const wake = () => { removeEventListener('pointerdown', wake, true); removeEventListener('keydown', wake, true); if (this.playing && this.perfClock) { this.pause(); void this.play(false); } };
      addEventListener('pointerdown', wake, true); addEventListener('keydown', wake, true);
    });
  }
  toggle() { if (this.playing) this.pause(); else void this.play(); }
  // A jump (a click on the ruler, Home, End, the arrows): the stage as it would be there (cues,
  // effects, blackout), never a moment: no confetti, flames, sparks, CO2 or fog burst from jumping.
  seek(t: number) {
    const was = this.playing;
    if (was) this.pause();
    this.position = Math.max(this.start, Math.min(this.end, t));
    this.top = false;
    this.putState(this.position);
    // (to the very end: it stays there, it doesn't start over)
    if (was && this.position < this.end - 0.05) void this.play(false);
    else this.landed = this.position;
  }
  private landed = Number.NaN;    // where the last jump or scrub stopped (see play)
  // Dragging the playhead: the same, all the way (and playing on from where it's let go)
  private scrubWas = false;
  scrubbing = $state(false);
  scrubStart() { this.scrubWas = this.playing || !!this.starting; this.pause(); this.scrubbing = true; this.top = false; }
  scrub(t: number) { this.position = Math.max(this.start, Math.min(this.end, t)); this.putState(this.position); }
  scrubEnd(t: number) {
    this.scrub(t); this.scrubbing = false;
    if (this.scrubWas && this.position < this.end - 0.05) void this.play(false);
    else this.landed = this.position;
    this.scrubWas = false;
  }
  private now() { return this.perfClock ? performance.now() / 1000 - this.startedAt : this.ctx ? this.ctx.currentTime - this.startedAt : this.position; }

  // every app tick: what's due since the last one
  tick() {
    if (!this.playing) return;
    const tl = this.tl;
    if (!tl) { this.pause(); return; }
    const t = this.now();
    // Next part, its beat come: what's placed before the beat plays, then the jump (what it jumps
    // over doesn't happen, like any jump)
    const p = this.pending;
    if (p && t >= p.at) {
      for (const i of due(tl.items, this.last, p.at)) this.app.doTimeline(i.do, false);
      this.pending = null;
      this.seek(Math.min(this.end, p.to.at + (t - p.at)));
      return;
    }
    for (const i of due(tl.items, this.last, t)) this.app.doTimeline(i.do, false);
    this.last = t; this.clock = t;
    this.count = t < this.countTo ? Math.max(1, this.countN - Math.ceil((this.countTo - t) * (tl.bpm ?? 120) / 60 - 1e-6) + 1) : 0;
    const span = spanOf(tl);
    this.position = Math.max(span.from, Math.min(t, span.to));
    if (tl.crowd?.length) { try { this.crowd.update(tl.crowd, t, this.ctx?.currentTime ?? 0); } catch { /* the crowd never stops the show */ } }
    if (t >= span.to) {
      // the show is over: effect bars that would run on past it stop with it
      for (const i of due(tl.items, t, Number.POSITIVE_INFINITY)) if (i.do.do === 'effect' && !i.do.on) this.app.doTimeline(i.do, false);
      this.pause(); this.position = span.to;
      this.app.songEnded?.();
    }
  }
  // Next part: on the song's next beat (at once while it's stopped), a jump to the start of the part
  // after the one it's in; pressed again while it waits, the part after that. What it jumps over
  // never fires. Undefined: there's no part after it. `cueName`: what a cue placed on a song
  // without parts is called.
  nextPart(cueName?: (i: TimelineItem) => string): Part | undefined {
    const tl = this.tl;
    if (!tl) return undefined;
    // (in the time before the song: the song's first part; counting in: the one after it)
    const to = partAfter(partsOf(tl, cueName), this.pending?.to.at ?? (this.playing ? Math.max(this.start, this.now()) : this.position));
    if (!to) return undefined;
    if (this.playing) this.pending = { at: this.pending?.at ?? beatAfter(tl, this.now()), to };
    else this.seek(to.at);
    return to;
  }
  // the stage as the timeline says it is at t (lists on their latest cue, its effects, blackout)
  private putState(t: number, soft = false) {
    const tl = this.tl;
    if (!tl?.items.length) return;
    this.app.putTimelineState(stateAt(tl.items, t), tl.items, soft);
  }
}

// A count-in: a short click on each beat at these times (the first of each bar higher)
function clicks(ctx: AudioContext, out: AudioNode, at: number[]): () => void {
  const osc = at.map((t, k) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = k % 4 === 0 ? 1760 : 1320;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.09);
    return o;
  });
  return () => { for (const o of osc) { try { o.stop(); } catch { /* done */ } o.disconnect(); } };
}

// how loud the song is over time (n buckets, 0..1), for the waveform
export function peaksOf(buf: AudioBuffer, n: number): number[] {
  const ch = buf.getChannelData(0), step = Math.max(1, Math.floor(ch.length / n)), out: number[] = [];
  let max = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step, e = Math.min(ch.length, j + step); j < e; j += 4) { const v = Math.abs(ch[j]); if (v > m) m = v; }
    out.push(m); if (m > max) max = m;
  }
  return out.map((v) => v / (max || 1));
}
