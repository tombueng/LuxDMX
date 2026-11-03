// The crowd at the show: chatting while it waits, cheering, a cheer that swells up on a big moment
// (no applause, no clapping along: they sounded ugly). It follows the timeline's crowd track (model/timeline.ts, CrowdItem):
// what the crowd does at any moment is worked out from the track (crowdAt, a pure function of the
// time, so playing and jumping agree), and the song's player (timeline/player.svelte.ts) asks for it
// on its clock. So it plays with the 3D stage closed too, and as it goes into the player's sound bus
// it's in a recording of the stage with the song. The sounds are real recordings (crowdReal.ts), or,
// when those can't be had, made here (crowdKit.ts, in a worker); playing them is a few looping
// buffers and a handful of short ones at a time.
import type { CrowdItem, CrowdMood } from '../model/timeline';
import { KIT_RATE, kitSteps, type Kit } from './crowdKit';
import { loadRecorded } from './crowdReal';

// how much the crowd chats and cheers (0..1 each) and how far a cheer has swelled
export interface CrowdState { chatter: number; cheer: number; swell: number }
type Bed = Omit<CrowdState, 'swell'>;
const QUIET: Bed = { chatter: 0, cheer: 0 };
const bedOf = (m: CrowdMood, l: number): Bed => (m === 'chatter' ? { chatter: l, cheer: 0 } : { chatter: 0, cheer: l });
const mix = (a: Bed, b: Bed, u: number): Bed => ({ chatter: a.chatter + (b.chatter - a.chatter) * u, cheer: a.cheer + (b.cheer - a.cheer) * u });

// A cheer over its length: up in a third of a second, then dying away to nothing by its end
export function cheerEnv(u: number, len: number) {
  if (!(u >= 0 && u < len)) return 0;
  const up = Math.min(0.35, len * 0.2);
  if (u < up) { const k = u / up; return k * k * (3 - 2 * k); }
  return Math.pow((len - u) / (len - up), 1.4);
}

// What the crowd does at t (the song's clock): each mood moment takes it from where it was then to
// its mood and level over its `len`; cheers swell on top (the biggest one going counts).
export function crowdAt(items: readonly CrowdItem[] | undefined, t: number): CrowdState {
  let from = QUIET, to = QUIET, at = 0, len = 0, swell = 0;
  if (items?.length) {
    const list = items.every((x, i) => !i || x.at >= items[i - 1].at) ? items : [...items].sort((a, b) => a.at - b.at);
    for (const it of list) {
      if (it.at > t) break;
      const a = it.do;
      if (a.do === 'cheer') { swell = Math.max(swell, a.level * cheerEnv(t - it.at, it.len ?? 4)); continue; }
      from = mix(from, to, len > 0 ? Math.min(1, (it.at - at) / len) : 1);
      to = bedOf(a.mood, a.level); at = it.at; len = it.len ?? 0;
    }
  }
  return { ...mix(from, to, len > 0 ? Math.min(1, Math.max(0, (t - at) / len)) : 1), swell };
}
// how loud the crowd is, all in (0..1)
export const loudness = (s: CrowdState) => Math.min(1, 0.45 * s.chatter + s.cheer + 0.8 * s.swell);

// ---- the sounds, made once a page (a worker; without one, on the page in slices)
let kitP: Promise<Kit> | undefined;
export let kitMs = 0;                      // how long making them took (measured)
export function loadKit(): Promise<Kit> {
  return (kitP ??= (async () => {
    const t0 = performance.now();
    const k = (await loadRecorded(import.meta.env?.BASE_URL ?? '/')) ?? (await inWorker()) ?? (await inSlices());
    kitMs = performance.now() - t0;
    return k;
  })());
}
function inWorker(): Promise<Kit | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(null);
  let w: Worker;
  try { w = new Worker(new URL('./crowdKit.worker.ts', import.meta.url), { type: 'module' }); } catch { return Promise.resolve(null); }
  return new Promise((done) => {
    const end = (k: Kit | null) => { clearTimeout(timer); w.terminate(); done(k); };
    const timer = setTimeout(() => end(null), 20000);
    w.onmessage = (e: MessageEvent<{ ok: boolean; kit?: Kit }>) => end(e.data.ok && e.data.kit ? e.data.kit : null);
    w.onerror = () => end(null);
    w.postMessage({ rate: KIT_RATE });
  });
}
async function inSlices(): Promise<Kit> {
  const it = kitSteps(KIT_RATE);
  for (;;) {
    const t0 = performance.now();
    for (;;) {
      const r = it.next();
      if (r.done) return r.value;
      if (performance.now() - t0 > 10) break;
    }
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

// the kit as one context's buffers (made once per context)
interface Buffers { chatter: AudioBuffer; roar: AudioBuffer; woos: AudioBuffer[]; whistles: AudioBuffer[]; cheers: AudioBuffer[] }
const made = new WeakMap<BaseAudioContext, Buffers>();
function buffersFor(ctx: BaseAudioContext, k: Kit): Buffers {
  let b = made.get(ctx);
  if (b) return b;
  const buf = (chs: Float32Array[]) => { const a = ctx.createBuffer(chs.length, chs[0].length, k.rate); chs.forEach((c, i) => a.copyToChannel(c as Float32Array<ArrayBuffer>, i)); return a; };
  b = { chatter: buf(k.chatter), roar: buf(k.roar), woos: k.woos.map((x) => buf([x])), whistles: k.whistles.map((x) => buf([x])), cheers: (k.cheers ?? []).map(buf) };
  made.set(ctx, b);
  return b;
}

const AHEAD = 0.25;                        // seconds the cheers and shouts are set up ahead (a busy page doesn't stutter them)
const SHOTS = 18;                          // short sounds at once, at most (the cost stays small)

// The crowd's sound on one audio context. The player calls start() when the song starts playing
// (t: the song's clock now), update() every tick, stop() when it stops.
export class CrowdSound {
  state: CrowdState = { ...QUIET, swell: 0 };
  level = 0;                               // how loud it is now, all in (0..1)
  node: GainNode | undefined;              // the crowd's sound, into the player's bus
  cost = { ms: 0, calls: 0 };              // time spent in update() (measured)
  private ctx: BaseAudioContext | undefined;
  private b: Buffers | undefined;
  private loops: { src: AudioBufferSourceNode; gain: GainNode; v: number }[] = [];
  private shots = new Set<AudioBufferSourceNode>();
  private running = false;
  private until = 0;                       // the song's clock: cheers and shouts are set up to here
  private volume = 0.8;
  private on = true;
  private cheerNo = -1;

  // the sounds start coming (the first time a page wants them)
  prepare() { void loadKit().catch(() => undefined); }
  get ready() { return !!this.b; }

  setVolume(volume: number, on: boolean) {
    this.volume = volume; this.on = on;
    if (this.node && this.ctx) this.node.gain.setTargetAtTime(on ? volume : 0, this.ctx.currentTime, 0.05);
  }
  start(ctx: BaseAudioContext, out: AudioNode, t: number) {
    this.stop();
    if (this.ctx !== ctx || !this.node) {
      this.node?.disconnect();
      this.ctx = ctx; this.b = undefined;
      this.node = ctx.createGain();
      this.node.gain.value = this.on ? this.volume : 0;
      this.node.connect(out);
    }
    // (a cheer right where it starts comes too, as a moment there does)
    this.running = true; this.until = t - 1e-3;
    void loadKit().then((k) => { if (this.ctx === ctx) this.b = buffersFor(ctx, k); }).catch(() => undefined);
  }
  stop() {
    const ctx = this.ctx;
    this.running = false;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const l of this.loops) { l.gain.gain.setTargetAtTime(0, now, 0.08); try { l.src.stop(now + 0.6); } catch { /* done */ } }
    this.loops = [];
    for (const s of this.shots) { try { s.stop(now + 0.05); } catch { /* done */ } }
    this.shots.clear();
  }

  // every tick while the song plays (t: the song's clock, now: the context's): the loops' levels
  // follow the crowd, and the cheers and shouts of the next moment are set up
  update(items: readonly CrowdItem[] | undefined, t: number, now: number) {
    const t0 = performance.now();
    const s = (this.state = crowdAt(items, t + 0.05));
    this.level = loudness(s);
    if (this.running && this.ctx && this.b) {
      if (!this.loops.length) this.begin(now);
      this.levels(s, now);
      if (this.on && this.volume > 0) this.events(items, s, t, now);
      this.until = t + AHEAD;
    }
    this.cost.ms += performance.now() - t0; this.cost.calls++;
  }

  private begin(now: number) {
    const ctx = this.ctx!, b = this.b!;
    // (the cheering twice, a little apart and slower: more people at the loud end)
    for (const [buf, rate] of [[b.chatter, 1], [b.roar, 1], [b.roar, 0.93]] as const) {
      const src = ctx.createBufferSource(), gain = ctx.createGain();
      src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
      gain.gain.value = 0;
      src.connect(gain).connect(this.node!);
      src.start(now, Math.random() * buf.duration);
      this.loops.push({ src, gain, v: 0 });
    }
  }
  private levels(s: CrowdState, now: number) {
    const x = Math.min(1.2, s.cheer + 0.75 * s.swell);
    // (at its loudest about 0.15 RMS at full volume: under a loud song, never pushing it into clipping)
    const v = [
      0.9 * s.chatter * (1 - 0.6 * Math.min(1, x)),                             // chatting (drowned out by cheering)
      1.15 * Math.pow(x, 1.4),                                                   // cheering
      0.8 * Math.pow(Math.max(0, x - 0.45), 1.2),                                // and more of them, loud
    ];
    this.loops.forEach((l, i) => { if (Math.abs(v[i] - l.v) > 0.002) { l.v = v[i]; l.gain.gain.setTargetAtTime(v[i], now, 0.12); } });
  }
  private events(items: readonly CrowdItem[] | undefined, s: CrowdState, t: number, now: number) {
    const b = this.b!, from = this.until, to = t + AHEAD, at = (x: number) => now + (x - t);
    // a cheer: a real crowd's cheer swelling up (recorded), or a burst of shouts and whistles
    if (items) for (const it of items) {
      if (it.do.do !== 'cheer' || it.at <= from || it.at > to) continue;
      const l = it.do.level;
      if (b.cheers.length) { this.cheerNo = (this.cheerNo + 1) % b.cheers.length; this.shot(b.cheers[this.cheerNo], at(it.at), 0.45 + 0.75 * l, 0, 0.97 + Math.random() * 0.06); continue; }
      const n = Math.round(2 + 8 * l);
      for (let k = 0; k < n; k++) this.shout(at(it.at) + Math.random() * 1.4, 0.3 + 0.4 * l);
      for (let k = Math.round(3 * l); k > 0; k--) this.whistle(at(it.at) + 0.2 + Math.random() * 1.8, 0.25 + 0.3 * l);
    }
    // and now and then while they cheer, someone shouts or whistles (the sounds made by hand only:
    // the recorded cheering has its own)
    if (!b.woos.length) return;
    const rate = 3 * Math.pow(Math.max(0, s.cheer - 0.15), 1.3) + 3 * s.swell;
    for (let n = poisson(rate * Math.max(0, to - from)); n > 0; n--) {
      const when = at(from + Math.random() * (to - from));
      if (Math.random() < 0.75) this.shout(when, 0.2 + 0.25 * Math.min(1, s.cheer + s.swell)); else this.whistle(when, 0.15 + 0.2 * Math.min(1, s.cheer + s.swell));
    }
  }
  private shout(when: number, gain: number) { const w = this.b!.woos; this.shot(w[Math.floor(Math.random() * w.length)], when, gain, Math.random() * 1.6 - 0.8, 0.9 + Math.random() * 0.2); }
  private whistle(when: number, gain: number) { const w = this.b!.whistles; this.shot(w[Math.floor(Math.random() * w.length)], when, gain, Math.random() * 1.6 - 0.8, 0.95 + Math.random() * 0.1); }
  private shot(buf: AudioBuffer, when: number, gain: number, pan: number, rate: number) {
    if (this.shots.size >= SHOTS) return;
    const ctx = this.ctx!, src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.playbackRate.value = rate; g.gain.value = gain;
    let last: AudioNode = src.connect(g);
    if (pan && typeof ctx.createStereoPanner === 'function') { const p = ctx.createStereoPanner(); p.pan.value = pan; last = last.connect(p); }
    last.connect(this.node!);
    this.shots.add(src);
    src.onended = () => { this.shots.delete(src); src.disconnect(); };
    src.start(Math.max(ctx.currentTime, when));
  }
}

// how many things happen in a window where on average `m` do
function poisson(m: number) {
  if (m <= 0) return 0;
  let n = 0, p = Math.exp(-m), s = p;
  const u = Math.random();
  while (u > s && n < 20) { n++; p *= m / n; s += p; }
  return n;
}
