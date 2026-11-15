// Starting the big demo, from the welcome or the command palette: on a real song when it comes down
// (the lights cued to its parts), on the demo beat when it doesn't (offline, its site blocked here)
// or when that's what was picked. The song comes down first, so the show starts with its music.
import { app } from '../app.svelte';
import { ui } from './ui.svelte';
import { CATALOG, GENRES } from '../timeline/catalog';
import { creditOf, downloadSong, SongError } from '../timeline/download';
import { DEMO_SONG } from '../timeline/beat';
import { keepDemoSongs } from '../store/songCache';

export { DEMO_SONG };
// the songs of the demos and the templates' shows
export async function demoSongIds(): Promise<string[]> {
  const [{ DEMOS }, { TEMPLATE_SHOWS }] = await Promise.all([import('../content/demos'), import('../content/templateShows')]);
  return [...new Set([...DEMOS.map((d) => d.song), ...Object.values(TEMPLATE_SHOWS).map((t) => t.song)].filter((x): x is string => !!x && !!demoSong(x)))];
}
async function keepTheDemoSongs() {
  const ids = await demoSongIds();
  // (after the show has had its start: the songs share the network with nothing it needs)
  await new Promise((r) => setTimeout(r, 8000));
  await keepDemoSongs(ids, (id) => downloadSong(demoSong(id)!, () => {}));
}
export const demoSong = (id: string | null) => (id ? CATALOG.find((s) => s.id === id) : undefined);

// `song`: a catalog id, or null for the demo beat. `ready`: the song is here (or isn't coming), the
// show is about to open. `stage`: which demo (content/demos.ts: festival, club, party, truss), or
// `t:` and a template's name: the template with its show (content/templateShows.ts).
// Thrown only when `signal` aborts it.
export async function startDemo(song: string | null = DEMO_SONG, progress: (got: number, total: number) => void = () => {}, signal?: AbortSignal, ready?: () => void, stage = 'festival', say = true) {
  const s = demoSong(song);
  let file: File | undefined, why = '';
  if (s) {
    try { file = await downloadSong(s, progress, signal); }
    catch (e) {
      if (signal?.aborted) throw e;
      why = e instanceof SongError ? e.message : `"${s.title}" can't be downloaded right now`;
    }
  }
  if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
  const { demoById } = await import('../content/demos');
  const tpl = stage.startsWith('t:') ? (await import('../content/templateShows')).templatePlayable(stage.slice(2)) : undefined;
  const d = tpl ?? demoById(stage) ?? demoById('festival')!;
  if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
  ready?.();
  await app.startShow(d.build(file ? s : undefined));
  ui.stage3d = true;
  // (on the timeline with its stage beside it; on a phone, where the timeline has no room for the
  // stage, on the stage itself: the show is what's to see)
  const phone = typeof window !== 'undefined' && window.innerWidth <= 760;
  app.view = phone ? 'program' : 'timeline';
  if (file && s) {
    try {
      await app.timeline.loadFile(file, app.showId);
      const t = app.timeline.ensure();
      if (t.audio) { t.audio.catalog = s.id; t.audio.credit = creditOf(s); }
      app.markDirty(0);
    } catch { why = `"${s.title}" came down, but it doesn't play in this browser: the show runs without sound`; }
  }
  // (the show as it came, its song on it, is where Undo stops)
  app.forgetUndo();
  await app.timeline.play();
  // a demo's song used: the other demos' and templates' songs come down too, in the background, so
  // they all play offline later (store/songCache.ts)
  if (file && s) void keepTheDemoSongs();
  const len = Math.round(app.timeline.duration / 60), what = `${d.name}: ${app.show.fixtures.length} lights`;
  if (why) ui.toast(`${why.replace(/\.$/, '')}. The demo plays on the demo beat instead (made here, nothing to download).`, 7000);
  else if (say) ui.toast(file && s ? `${what}, to "${s.title}" by ${s.artist} (${GENRES[s.genre]}), cued to its parts. Space pauses; Live (top) for the buttons; full screen on the 3D stage.`
    : `${what}, ${len} minute${len === 1 ? '' : 's'} on the demo beat. Space pauses; Live (top) for the buttons; full screen on the 3D stage.`, 6000);
}
