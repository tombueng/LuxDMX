<script lang="ts">
  import TopBar from './ui/TopBar.svelte';
  import ProgramView from './ui/ProgramView.svelte';
  import LiveView from './ui/LiveView.svelte';
  import TimelineView from './ui/TimelineView.svelte';
  import Overlays from './ui/Overlays.svelte';
  import Modals from './ui/Modals.svelte';
  import ConnectionBanner from './ui/ConnectionBanner.svelte';
  import { app } from './app.svelte';
  import { ui } from './ui/ui.svelte';
  import { onMount, tick } from 'svelte';
  type View = typeof app.view;
  // A view is built the first time it's opened and stays (hidden) when another one is shown, so
  // going back to it is instant and it is as it was left: the timeline's scroll, the live page,
  // the 3D camera. Hidden, it costs next to nothing a frame: each view knows whether it's shown
  // (`app.view`) and pauses its own drawing (the 3D stage, the plan, the playhead). The other two
  // are built in quiet moments after the start, so even the first switch finds them ready.
  const built = new Set<View>();
  let warm = $state<View[]>([]);
  const open = $derived.by(() => { built.add(app.view); for (const v of warm) built.add(v); return new Set(built); });
  // (focus never stays in a view that went away: it goes to the page, as when it was taken down)
  $effect(() => {
    const v = app.view;
    void tick().then(() => { const a = document.activeElement as HTMLElement | null; if (a?.closest('.pane[hidden]') && v === app.view) a.blur(); });
  });
  // Warming up: once the page has settled, in a quiet moment, the next view not built yet
  // is built hidden, a moment later laid out once (invisible: a hidden view keeps its layout, so
  // showing it is then as quick as any other time), then the next one. One at a time, so it never
  // takes much from the show running.
  let laying = $state<View | null>(null);
  onMount(() => {
    const idle = (f: () => void) => (window.requestIdleCallback ? window.requestIdleCallback(f, { timeout: 4000 }) : window.setTimeout(f, 300));
    let gone = false, timer = 0;
    const later = (ms: number, f: () => void) => { timer = window.setTimeout(() => idle(() => { if (!gone) f(); }), ms); };
    const next = () => {
      const v = (['program', 'live', 'timeline'] as const).find((x) => !open.has(x) && (x !== 'timeline' || !app.locked));
      if (!v) return;
      warm = [...warm, v];
      later(600, () => {
        if (app.view !== v) laying = v;
        requestAnimationFrame(() => requestAnimationFrame(() => { laying = null; later(1200, next); }));
      });
    };
    later(1500, next);
    return () => { gone = true; clearTimeout(timer); };
  });
  onMount(() => {
    if (app.loadError) ui.toast(app.loadError, 12000);
    // the way out of a forgotten PIN: the app's address with #unlock (opened, or typed onto the open tab)
    const unlock = () => { if (location.hash === '#unlock') { history.replaceState(null, '', location.pathname + location.search); void app.unlockByLink(); } };
    unlock();
    window.addEventListener('hashchange', unlock);
    return () => window.removeEventListener('hashchange', unlock);
  });
</script>

<div class="app" class:in-live={app.view === 'live'}>
  <TopBar />
  <ConnectionBanner />
  <!-- menus and messages sit in the main region too (they float, but a screen reader finds them) -->
  <main class="view" aria-label={app.view === 'program' ? 'Program' : app.view === 'timeline' ? 'Timeline' : 'Live'}>
    {#if open.has('program')}<div class="pane" class:laying={laying === 'program'} hidden={app.view !== 'program'} inert={app.view !== 'program'}><ProgramView /></div>{/if}
    {#if open.has('timeline')}<div class="pane" class:laying={laying === 'timeline'} hidden={app.view !== 'timeline'} inert={app.view !== 'timeline'}><TimelineView /></div>{/if}
    {#if open.has('live')}<div class="pane" class:laying={laying === 'live'} hidden={app.view !== 'live'} inert={app.view !== 'live'}><LiveView /></div>{/if}
    <Overlays /></main>
</div>
<Modals />
<!-- Blackout must never be missed: a frame round the whole screen while it's on. -->
{#if app.blackout}<div class="bo-frame" aria-hidden="true"><span>Blackout</span></div>{/if}

<style>
  .app { height: 100%; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .view { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
  .pane { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  /* A hidden view keeps its boxes laid out (content-visibility skips drawing and laying out what's
     inside, and keeps it): shown again, the browser doesn't build thousands of boxes anew. It sits
     under the shown one, invisible, out of the way of the mouse, the keys and screen readers. */
  .pane[hidden] { display: flex; position: absolute; inset: 0; visibility: hidden; content-visibility: hidden; pointer-events: none; }
  /* (warming up: laid out once, still invisible) */
  .pane[hidden].laying { content-visibility: visible; }
  /* Live in a very short window (400 % zoom, a phone on its side): the page scrolls as one, so the
     buttons don't get squeezed to nothing under the GO strip */
  @media (max-height: 420px) {
    .app.in-live { height: auto; min-height: 100%; overflow: visible; }
    .app.in-live .view, .app.in-live .pane:not([hidden]) { flex: none; }
  }
  .bo-frame { position: fixed; inset: 0; pointer-events: none; z-index: 90; box-shadow: inset 0 0 0 3px var(--pink), inset 0 0 40px #f33abc33; }
  .bo-frame span { position: absolute; left: 50%; bottom: 0; transform: translateX(-50%); background: var(--pink); color: #1a0010; font-weight: 800;
    font-size: .68rem; letter-spacing: .12em; text-transform: uppercase; padding: .1rem .7rem; border-radius: 6px 6px 0 0; }
</style>
