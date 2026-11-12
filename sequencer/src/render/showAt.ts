// The show on a clock of its own, for rendering a video: its own engine, the timeline's items on
// that clock, nothing sent anywhere. The live show (the app's engine, the output thread, the boxes)
// never hears of it: a render can run while the show goes on. It starts from the look as it is
// (the lists playing, the effects on, the masters), then the timeline's state at the start point,
// as Play does: from the top, lists the song has no cue for yet keep what they have.
import { Engine } from '../engine/engine';
import { due, stateAt, type BurstAttr, type Timeline, type TimelineAction, type TimelineItem } from '../model/timeline';
import type { Resolved, Show, Values } from '../model/types';

export interface ShowAtHost {
  readonly show: Show;                                           // a copy, as it was at the start
  burstValues(attr: BurstAttr): Record<string, Values>;          // what a burst on the timeline holds on
  // what the pictures draw from a frame (LED pixels as their port powers them)
  shown(stage: Record<string, Resolved>, frames: Map<number, Uint8Array>): Record<string, Resolved>;
}
export interface StartLook {
  lists: { id: string; index: number }[];   // the lists playing, in the order they were started
  fx: string[];                             // the effects on
  programmer?: Record<string, Values>;      // what's in the programmer (only when it's asked for)
  blackout: boolean;
  grandMaster: number;
  groupMasters: Record<string, number>;
}
export interface Moment { stage: Record<string, Resolved>; drawn: Record<string, Resolved>; beats: number }

export class ShowAt {
  readonly engine: Engine;
  private t: number;
  private last: number;
  private holds = new Map<string, { until: number; values: Record<string, Values> }>();
  constructor(private host: ShowAtHost, start: StartLook, from: number, private tl?: Timeline, top = false) {
    this.t = from;
    const e = (this.engine = new Engine(() => host.show, () => this.t));
    e.grandMaster = start.grandMaster; e.groupMasters = { ...start.groupMasters }; e.blackout = start.blackout;
    e.programmer = start.programmer ?? {};
    e.sound = 1;                                                    // (sound effects at full, as when nothing's listening)
    for (const l of start.lists) if (host.show.cueLists.some((x) => x.id === l.id)) e.jumpQuiet(l.id, l.index, 0, false);
    for (const id of start.fx) if (host.show.effects.some((x) => x.id === id)) e.startEffect(id);
    if (tl) this.putState(stateAt(tl.items, from), tl.items, top);
    // (a moment placed right at the start happens too)
    this.last = from - 1e-3;
  }
  get now() { return this.t; }
  // the show at t (seconds on the song's clock; never back in time)
  step(t: number): Moment {
    t = Math.max(t, this.t);
    this.t = t;
    const tl = this.tl;
    if (tl) {
      for (const i of due(tl.items, this.last, t)) this.act(i.do);
      if (tl.bpm) { this.engine.bpm = tl.bpm; this.engine.syncBeats((t - (tl.offset ?? 0)) * tl.bpm / 60); }
    }
    this.last = t;
    // bursts (fog, confetti, a blinder hit): on top while they last, as the live show holds them
    const live: Record<string, Values> = {};
    for (const [id, h] of this.holds) {
      if (t >= h.until) { this.holds.delete(id); continue; }
      for (const [f, v] of Object.entries(h.values)) live[f] = { ...live[f], ...v };
    }
    this.engine.live = live;
    const { frames, stage } = this.engine.tick();
    return { stage, drawn: this.host.shown(stage, frames), beats: this.engine.beatCount };
  }
  // what a timeline item does (the app's doTimeline, on this engine)
  private act(a: TimelineAction) {
    if (a.do === 'effect') { if (a.on) this.engine.startEffect(a.effect); else this.engine.stopEffect(a.effect); return; }
    if (a.do === 'burst') {
      const values = this.host.burstValues(a.attr);
      if (!Object.keys(values).length) return;
      const secs = Number.isFinite(a.seconds) ? Math.max(0.2, Math.min(30, a.seconds)) : 1;
      this.holds.set(`tl:${a.attr}`, { until: this.t + secs, values });
      return;
    }
    this.engine.act(a);
  }
  // the timeline's state at a point (the app's putTimelineState, on this engine)
  private putState(st: ReturnType<typeof stateAt>, items: TimelineItem[], soft: boolean) {
    const show = this.host.show, e = this.engine;
    const lists = new Set(items.filter((i) => i.lane.startsWith('list:')).map((i) => i.lane.slice(5)));
    for (const id of lists) {
      const a = st.cues.get(id)?.do, l = show.cueLists.find((x) => x.id === id);
      const i = a?.do === 'goto' ? l?.cues.findIndex((c) => c.id === a.cue) ?? -1 : -1;
      if (i >= 0) e.jumpQuiet(id, i, 0, false); else if (e.isOn(id) && !soft) e.release(id);
    }
    for (const id of new Set(items.flatMap((i) => (i.do.do === 'effect' ? [i.do.effect] : [])))) {
      if (st.fx.includes(id)) e.startEffect(id); else e.stopEffect(id, 0);
    }
    if (items.some((i) => i.do.do === 'blackout') && (!soft || !st.blackout)) e.blackout = st.blackout;
  }
}
