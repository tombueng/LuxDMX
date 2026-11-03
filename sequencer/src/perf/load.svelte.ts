// How hard the page works, and whether the DMX output keeps its time.
//
// The output comes first. Every output frame (app.tick, due every 25 ms) is timed; when frames come
// late, the drawing gives way at once: the stage pictures (2D and 3D) get new values less often,
// then the 3D stage draws simpler (fewer pixels, no glow, fewer frames a second). When the output
// has been on time for a while, it comes back up to the quality chosen. The display shows the
// page's load (its own work on the main thread), the graphics card's time per 3D frame where the
// browser can measure it, and the output: frames a second and the longest gap.
export type Level = 0 | 1 | 2;                    // low, medium, high
export const LEVEL_NAME = ['Low', 'Medium', 'High'] as const;
const KEY = 'luxdmx.seq.quality';
const PERIOD = 25;                                // ms between output frames (40 a second)
const LATE = 10;                                  // a frame this much later than due is late
const WINDOW = 5000;                              // the display and the governor look back this far

export class Load {
  // the quality chosen (the most the drawing may do)
  // (nothing stored: High. Number(null) is 0, which made everyone's default Low: no glow, 20 frames)
  quality = $state<Level>((() => { try { const s = localStorage.getItem(KEY), v = s === null ? 2 : Number(s); return v === 0 || v === 1 ? v : 2; } catch { return 2; } })());
  // what's drawn now: the chosen quality, or lower while the output needs the time
  level = $state<Level>(2);
  // the stage pictures get new values every n-th output frame (1: every frame)
  uiEvery = $state(1);
  // the plan's (2D stage's) drawing: its blur and moving bits. The same as `level`, except with the
  // output on its own thread, where the 3D stage keeps the quality chosen and only this and the
  // panels give way when the page is overloaded (the plan's blur on a big rig is most of it)
  level2d = $state<Level>(2);
  // the DMX goes out from its own thread (output/thread.ts): this page's late frames can't make it
  // late, so the 3D stage keeps the quality chosen; the panels' updates and the plan give way (the
  // 3D stage reads every frame's values itself)
  outputSafe = false;
  // the display (updated twice a second)
  cpu = $state(0);                                // % of the main thread the page's own work took
  gpu = $state<number | null>(null);              // ms of graphics card time per 3D frame (null: can't tell)
  rate = $state(0);                               // output frames a second
  worst = $state(0);                              // the longest gap between two output frames (ms)
  late = $state(0);                               // output frames late in the last WINDOW
  get lowered() { return this.level < this.quality || this.level2d < this.quality || this.uiEvery > 1; }

  private ticks: number[] = [];                   // when each output frame ran
  private work: [number, number][] = [];          // [when, ms] of the page's own work
  private gpuMs: number[] = [];
  private calmSince = 0;
  private shownAt = 0;
  private lastStep = 0;

  setQuality(q: Level) {
    this.quality = q;
    if (this.level > q) this.level = q;
    if (this.level2d > q) this.level2d = q;
    try { localStorage.setItem(KEY, String(q)); } catch { /* this visit only */ }
  }
  // an output frame ran at t0 (ms, performance.now()) and took `ms`
  tick(t0: number, ms: number) {
    this.ticks.push(t0);
    this.work.push([t0, ms]);
    this.trim(t0);
    this.govern(t0);
    if (t0 - this.shownAt > 500) this.show(t0);
  }
  // other work on the main thread: a 3D frame, the pictures' update
  did(ms: number, t = performance.now()) { this.work.push([t, ms]); }
  gpuTime(ms: number) { this.gpuMs.push(ms); if (this.gpuMs.length > 60) this.gpuMs.shift(); }

  private trim(now: number) {
    while (this.ticks.length && now - this.ticks[0] > WINDOW) this.ticks.shift();
    while (this.work.length && now - this.work[0][0] > WINDOW) this.work.shift();
  }
  // late frames in the last `ms`
  private lateIn(now: number, ms: number) {
    let n = 0;
    for (let i = 1; i < this.ticks.length; i++) if (now - this.ticks[i] < ms && this.ticks[i] - this.ticks[i - 1] > PERIOD + LATE) n++;
    return n;
  }
  // Late frames: give way at once (a step every half second at most). On time for four seconds:
  // a step back up.
  private govern(now: number) {
    const late = this.lateIn(now, 1000);
    if (this.outputSafe && this.level < this.quality) this.level = this.quality;
    if (late >= 2) {
      this.calmSince = now;
      if (now - this.lastStep < 500) return;
      this.lastStep = now;
      if (this.uiEvery < 2) this.uiEvery = 2;
      else if (this.level2d > 0) { this.level2d = (this.level2d - 1) as Level; if (!this.outputSafe) this.level = this.level2d; }
      else if (this.uiEvery < (this.outputSafe ? 3 : 6)) this.uiEvery++;
      return;
    }
    if (late > 0) { this.calmSince = now; return; }
    if (!this.calmSince) this.calmSince = now;
    if (now - this.calmSince > 4000 && now - this.lastStep > 4000) {
      this.lastStep = now; this.calmSince = now;
      if (this.uiEvery > 2) this.uiEvery--;
      else if (this.level2d < this.quality) { this.level2d = (this.level2d + 1) as Level; if (!this.outputSafe) this.level = this.level2d; }
      else if (this.uiEvery > 1) this.uiEvery = 1;
    }
  }
  private show(now: number) {
    this.shownAt = now;
    const t = this.ticks, span = t.length > 1 ? t[t.length - 1] - t[0] : 0;
    this.rate = span > 500 ? Math.round(((t.length - 1) / span) * 1000) : 0;
    let worst = 0;
    for (let i = 1; i < t.length; i++) worst = Math.max(worst, t[i] - t[i - 1]);
    this.worst = Math.round(worst);
    this.late = this.lateIn(now, WINDOW);
    const from = this.work.length ? this.work[0][0] : now, busy = this.work.reduce((s, w) => s + w[1], 0);
    this.cpu = Math.min(100, Math.round((busy / Math.max(1000, now - from)) * 100));
    this.gpu = this.gpuMs.length ? Math.round((this.gpuMs.reduce((a, b) => a + b, 0) / this.gpuMs.length) * 10) / 10 : null;
    if (this.level > this.quality) this.level = this.quality;
    if (this.level2d > this.quality) this.level2d = this.quality;
  }
}
export const load = new Load();
// (dev builds: the measuring scripts and tests read it)
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __luxload: Load }).__luxload = load;
