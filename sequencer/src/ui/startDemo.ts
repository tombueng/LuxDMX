// Starting the big demo, from the welcome or the command palette: on a real song when it comes down
// (the lights cued to its parts), on the demo beat when it doesn't (offline, its site blocked here)
// or when that's what was picked. The song comes down first, so the show starts with its music.
import { app } from '../app.svelte';
import { ui } from './ui.svelte';
import { CATALOG, GENRES } from '../timeline/catalog';
import { creditOf, downloadSong, SongError } from '../timeline/download';
import { DEMO_SONG } from '../timeline/beat';

export { DEMO_SONG };
export const demoSong = (id: string | null) => (id ? CATALOG.find((s) => s.id === id) : undefined);

// `song`: a catalog id, or null for the demo beat. `ready`: the song is here (or isn't coming), the
// show is about to open. `stage`: which demo (content/demos.ts: festival, club, party, truss).
// Thrown only when `signal` aborts it.
export async function startDemo(song: string | null = DEMO_SONG, progress: (got: number, total: number) => void = () => {}, signal?: AbortSignal, ready?: () => void, stage = 'festival') {
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
  const d = demoById(stage) ?? demoById('festival')!;
  if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
  ready?.();
  await app.startShow(d.build(file ? s : undefined));
  ui.stage3d = true;
  app.view = 'timeline';
  if (file && s) {
    try {
      await app.timeline.loadFile(file, app.showId);
      const t = app.timeline.ensure();
      if (t.audio) { t.audio.catalog = s.id; t.audio.credit = creditOf(s); }
      app.markDirty(0);
    } catch { why = `"${s.title}" came down, but it doesn't play in this browser: the show runs without sound`; }
  }
  await app.timeline.play();
  const len = Math.round(app.timeline.duration / 60), what = `${d.name}: ${app.show.fixtures.length} lights`;
  if (why) ui.toast(`${why}. The demo plays on the demo beat instead (made here, nothing to download).`, 7000);
  else ui.toast(file && s ? `${what}, to "${s.title}" by ${s.artist} (${GENRES[s.genre]}), cued to its parts. Space pauses; Live (top) for the buttons; full screen on the 3D stage.`
    : `${what}, ${len} minute${len === 1 ? '' : 's'} on the demo beat. Space pauses; Live (top) for the buttons; full screen on the 3D stage.`, 6000);
}
