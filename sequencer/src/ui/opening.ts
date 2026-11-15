// What the app opens on (GUIDE, "When the app opens"). A visit starts with the big demo show
// playing and a short intro over it, unless the person chose an empty show or their last one. A
// reload opens what was open, and a show night (locked, or kept on stage) never gets another show.
import { app } from '../app.svelte';
import { ui } from './ui.svelte';
import { DEMO_SHOW, INTRO_SEEN, OPENED, OUTPUT_LOCKED_LIVE, START_WITH } from '../store/kept';
import { DEMO_SONG, startDemo } from './startDemo';

export async function opening() {
  if (OPENED.get()) return;
  OPENED.set(true);
  if (app.locked || OUTPUT_LOCKED_LIVE.get() || app.output === 'live') return;
  const how = START_WITH.get();
  if (how === 'last') return;
  if (how === 'empty') { if (!app.isBlank()) await app.newShow(); return; }
  await playDemo(!INTRO_SEEN.get());
}

// The big demo show playing, with the intro over it (the first visit, or asked for in Shows)
export async function playDemo(intro: boolean) {
  const was = DEMO_SHOW.get();
  await startDemo(DEMO_SONG, undefined, undefined, undefined, 'festival', !intro);
  // (the one from last time, nobody changed it: it goes, rather than a new copy every visit)
  if (was && was !== app.showId && app.shows.some((s) => s.id === was)) await app.deleteShow(was);
  DEMO_SHOW.set(app.showId);
  if (intro) ui.intro = true;
}
