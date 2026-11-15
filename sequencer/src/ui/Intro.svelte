<script lang="ts">
  // The intro over the demo show the app opens on: a few lines like a film's subtitles, under 20
  // seconds, each pointing at the button it talks about. Nothing to click away: it never covers
  // what's under it, it goes by itself, a × ends it sooner. Where it says the app should open next
  // time sits beside it. (ui/opening.ts starts the demo and this.)
  import { onMount } from 'svelte';
  import { app } from '../app.svelte';
  import { ui } from './ui.svelte';
  import { DEMO_SHOW, INTRO_SEEN, START_WITH } from '../store/kept';
  import { opening } from './opening';

  // what it says (about 70 words), and the button each line is about
  const LINES: { text: string; at?: string }[] = [
    { text: 'This is a demo show, played live in your browser: every beam and every colour is rendered from the DMX it sends.' },
    { text: 'So you can build and polish a show without the rig, then play it on the real lights.' },
    { text: 'Your own lights: Program, then Add lights.', at: '.top .modes [aria-label="Program"]' },
    { text: 'Your hardware: a LuxDMX box, or any Art-Net or sACN node through LuxDMX Link, connects here.', at: '.top button.boxes, .top button[aria-label="Add a LuxDMX"]' },
    { text: 'Space pauses the show. Live has the buttons for the night.', at: '.top .modes [aria-label="Live"]' },
  ];
  // (a line stays as long as it takes to read, a quarter of a second a word, 3 s at least: all of
  // them under 20 s)
  const secs = (t: string) => Math.max(3, Math.min(5.5, t.split(' ').length * 0.25));

  let i = $state(0), ring = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  // low over the stage's picture, like subtitles over a film (else low in the window)
  let at = $state('');
  let start = $state(START_WITH.get());

  onMount(() => { void opening(); });
  // a demo you've changed is yours: it stays in your shows when the next visit opens a new one
  $effect(() => { if (app.canUndo && DEMO_SHOW.get() === app.showId) DEMO_SHOW.remove(); });

  $effect(() => {
    if (!ui.intro) return;
    INTRO_SEEN.set(true);
    i = 0;
    let gone = false, timer = 0;
    const show = (k: number) => {
      if (gone) return;
      if (k >= LINES.length) { ui.intro = false; return; }
      i = k;
      const el = LINES[k].at ? document.querySelector<HTMLElement>(LINES[k].at!) : null, r = el?.getBoundingClientRect();
      ring = r && r.width ? { x: r.left - 4, y: r.top - 4, w: r.width + 8, h: r.height + 8 } : null;
      const st = (document.querySelector('.s3') ?? document.querySelector('.stage-wrap'))?.getBoundingClientRect();
      at = st && st.height > 200 ? `left:${st.left + st.width / 2}px;bottom:${window.innerHeight - st.bottom + 16}px;max-width:min(46rem, ${st.width - 32}px)` : '';
      timer = window.setTimeout(() => show(k + 1), secs(LINES[k].text) * 1000);
    };
    show(0);
    return () => { gone = true; clearTimeout(timer); ring = null; };
  });
  function choose(e: Event) {
    start = (e.target as HTMLSelectElement).value as typeof start;
    START_WITH.set(start);
  }
</script>

{#if ui.intro}
  {#if ring}<div class="ring" style="left:{ring.x}px;top:{ring.y}px;width:{ring.w}px;height:{ring.h}px" aria-hidden="true"></div>{/if}
  <div class="intro" style={at} role="status" aria-live="polite" aria-label="Intro">
    {#key i}<p class="line">{LINES[i].text}</p>{/key}
    <div class="foot">
      <label>When the app opens: <select value={start} onchange={choose} aria-label="When the app opens">
        <option value="demo">this demo</option><option value="empty">an empty show</option><option value="last">my last show</option>
      </select></label>
      <button class="ghost x" onclick={() => (ui.intro = false)} aria-label="End the intro" title="End the intro">×</button>
    </div>
  </div>
{/if}

<style>
  /* like a film's subtitles: low in the middle, over the picture, nothing behind it blocked */
  .intro { position: fixed; left: 50%; bottom: 7vh; transform: translateX(-50%); z-index: 60; max-width: min(46rem, 92vw);
    background: rgba(6, 8, 12, 0.78); border-radius: 10px; padding: .6rem 1rem .45rem; text-align: center; pointer-events: none; }
  .line { margin: 0; font-size: 1.12rem; line-height: 1.4; color: #f2f4f7; text-shadow: 0 1px 2px #000; animation: in .35s ease-out; }
  .foot { display: flex; justify-content: center; align-items: center; gap: .6rem; margin-top: .35rem; font-size: .76rem; color: var(--muted); pointer-events: auto; }
  .foot select { font-size: .76rem; padding: .1rem .3rem; }
  .x { padding: 0 .4rem; font-size: 1rem; line-height: 1; }
  .ring { position: fixed; z-index: 59; border: 2px solid var(--orange); border-radius: 10px; pointer-events: none; animation: pulse 1.2s ease-in-out infinite; }
  @keyframes in { from { opacity: 0; transform: translateY(4px); } }
  @keyframes pulse { 50% { box-shadow: 0 0 0 6px rgba(255, 170, 28, 0.25); } }
  @media (prefers-reduced-motion: reduce) { .line, .ring { animation: none; } }
</style>
