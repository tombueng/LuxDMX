// The timeline's songs from the catalog, and the demo beat: a short listen (15 s, a song from its
// chorus, the beat from just before its first drop), and one taken onto the timeline, downloaded
// with its progress (one at a time, cancellable), kept in this browser like a file you load, its
// tempo, first downbeat, parts and credit coming with it. The timeline view, its song picker and its
// set list share one of these.
import { app } from '../../app.svelte';
import { ui } from '../ui.svelte';
import { clockOf } from '../../model/timeline';
import { BAR_S, playDemo, sectionStarts } from '../../timeline/beat';
import { SongError, creditOf, downloadSong } from '../../timeline/download';
import { ShowChanged } from '../../timeline/player.svelte';
import type { CatalogSong } from '../../timeline/catalog';

export class Songs {
  // what's being listened to ('demo' for the beat, else the song's id; '' none)
  listening = $state('');
  // the one coming down
  dl = $state<{ id: string; title: string; got: number; total: number; ctl: AbortController } | null>(null);
  private pv: { ctx?: AudioContext; stop?: () => void; timer?: ReturnType<typeof setTimeout> } = {};
  private P = app.timeline;

  listen(s: CatalogSong | null) {
    const P = this.P, id = s?.id ?? 'demo', again = this.listening === id;
    this.hush();
    if (again) return;
    if (P.playing) P.pause();
    this.listening = id;
    this.pv.timer = setTimeout(() => this.hush(), 15000);
    if (!s) {
      try { this.pv.ctx ??= new AudioContext(); } catch { this.hush(); ui.toast("This browser can't play sound here", 3500); return; }
      const ctx = this.pv.ctx, g = ctx.createGain();
      g.gain.value = P.volume; g.connect(ctx.destination); void ctx.resume();
      const stop = playDemo(ctx, g, sectionStarts().find((x) => x.name === 'Drop')!.at - 2 * BAR_S);
      this.pv.stop = () => { stop(); setTimeout(() => g.disconnect(), 500); };
      return;
    }
    const from = s.sections.find((x) => /chorus|drop|hook/i.test(x.name))?.at ?? s.duration / 3;
    const a = new Audio(), srcs = [s.url, s.mirror].filter((u): u is string => !!u);
    let n = 0;
    a.preload = 'auto'; a.volume = P.volume;
    a.onerror = () => {
      if (this.listening !== s.id) return;
      if (++n < srcs.length) a.src = srcs[n];
      else { this.hush(); ui.toast(`"${s.title}" can't be played right now (offline, or its site is blocked here)`, 4500); }
    };
    a.onloadedmetadata = () => { if (Number.isFinite(a.duration)) a.currentTime = Math.max(0, Math.min(from, a.duration - 16)); void a.play().catch(() => {}); };
    a.src = srcs[0];
    this.pv.stop = () => { a.onerror = null; a.pause(); a.removeAttribute('src'); };
  }
  hush() { clearTimeout(this.pv.timer); this.pv.stop?.(); this.pv.stop = undefined; this.listening = ''; }

  // a catalog song onto the timeline; true once it's there
  async take(s: CatalogSong): Promise<boolean> {
    const P = this.P;
    this.hush();
    this.dl?.ctl.abort();
    const ctl = new AbortController();
    this.dl = { id: s.id, title: s.title, got: 0, total: 0, ctl };
    const forShow = app.showId;                        // (the show it's for, whatever is open when it's done)
    let file: File;
    try { file = await downloadSong(s, (got, total) => { if (this.dl?.ctl === ctl) { this.dl.got = got; this.dl.total = total; } }, ctl.signal); }
    catch (e) {
      if (this.dl?.ctl !== ctl) return false;
      this.dl = null;
      if (!ctl.signal.aborted) ui.toast(e instanceof SongError ? e.message : `"${s.title}" can't be downloaded right now. Try again later.`, 6000);
      return false;
    }
    if (this.dl?.ctl !== ctl) return false;            // cancelled, or another one picked meanwhile
    try { await P.loadFile(file, forShow); }
    catch (e) {
      this.dl = null;
      ui.toast(e instanceof ShowChanged ? `"${s.title}" came down after another show was opened, so it isn't on this one. Pick it again in the show it was for.`
        : `"${s.title}" came down, but it doesn't play in this browser`, 7000);
      return false;
    }
    this.dl = null;
    const t = app.timeline.ensure();
    t.bpm = s.bpm; t.offset = s.offset;
    t.sections = s.sections.map((x) => ({ name: x.name, at: x.at, ...(Number.isFinite(x.energy) ? { energy: x.energy } : {}) }));
    if (t.audio) { t.audio.catalog = s.id; t.audio.credit = creditOf(s); }
    t.name = s.title;                // (the set list said the file's name: the artist first, cut off)
    app.markDirty(0);
    ui.toast(`"${s.title}" by ${s.artist} is the song now (${s.bpm} BPM, ${clockOf(P.duration, false)}). Its parts are on the ruler.`, 4000);
    return true;
  }
  cancel() { this.dl?.ctl.abort(); this.dl = null; }
  // the demo beat onto the timeline (it has its own parts)
  takeDemo() {
    this.hush(); this.cancel();
    this.P.useDemo();
    if (app.show.timeline?.sections) { delete app.show.timeline.sections; app.markDirty(0); }
    ui.toast('The demo beat: ten minutes, 126 BPM, with builds and drops');
  }
  // anything playing or coming down stops (the view went away, another song was picked)
  stop() { this.hush(); this.cancel(); }
  dispose() { this.hush(); void this.pv.ctx?.close().catch(() => {}); }
}
