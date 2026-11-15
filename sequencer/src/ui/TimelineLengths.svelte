<script lang="ts">
  // How long each moment lasts (fog, confetti, a strobe hit...), under the Moments track when it's
  // opened: a bar from the moment on, as long as it runs. Drag its end, or the arrow keys on it
  // (Shift: finer). The machines stop by themselves after it, so it stays within 30 s.
  import { app } from '../app.svelte';
  import { clockOf, type TimelineItem } from '../model/timeline';

  let { items, x, scale, labelOf, h = 34 }: {
    items: TimelineItem[]; x: (t: number) => number; scale: number; labelOf: (it: TimelineItem) => string; h?: number;
  } = $props();

  const MIN = 0.2, MAX = 30;
  const secondsOf = (it: TimelineItem) => (it.do.do === 'burst' ? it.do.seconds : 0);
  // (said to a tenth: a made show's 10.7466 s read as 10.7466 on its bar)
  const said = (s: number) => `${Math.round(s * 10) / 10} s`;
  function set(it: TimelineItem, s: number) {
    if (it.do.do !== 'burst') return;
    it.do.seconds = Math.round(Math.max(MIN, Math.min(MAX, s)) * 10) / 10;
  }
  let drag: { it: TimelineItem; left: number } | null = null;
  function endDown(e: PointerEvent, it: TimelineItem) {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    app.checkpoint();
    drag = { it, left: (e.currentTarget as Element).parentElement!.getBoundingClientRect().left };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) { if (drag) set(drag.it, (e.clientX - drag.left) / scale); }
  function up() { if (drag) { drag = null; app.markDirty(0); } }
  function key(e: KeyboardEvent, it: TimelineItem) {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    app.checkpoint();
    set(it, secondsOf(it) + d * (e.shiftKey ? 0.1 : 0.5));
    app.markDirty(0);
  }
</script>

{#each items as it (it.id)}
  {@const s = secondsOf(it)}
  {@const t = said(s)}
  <div class="len" style="left:{x(it.at)}px;width:{Math.max(6, s * scale)}px;height:{h - 10}px" role="slider" tabindex="0"
    aria-label="How long {labelOf(it)} at {clockOf(it.at)} lasts" aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={Math.round(s * 10) / 10} aria-valuetext={t}
    title="{labelOf(it)}: {t}. Drag the end (or the arrow keys, Shift: finer) to make it longer or shorter" onkeydown={(e) => key(e, it)}>
    <span class="t">{t}</span>
    <!-- svelte-ignore a11y_no_static_element_interactions (the arrow keys on the bar do the same) -->
    <span class="end" onpointerdown={(e) => endDown(e, it)} onpointermove={move} onpointerup={up} onpointercancel={up}></span>
  </div>
{/each}

<style>
  .len { position: absolute; top: 5px; min-width: 6px; border-radius: 4px; border: 1px solid var(--c, #f33abc); box-sizing: border-box;
    background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--c, #f33abc) 30%, transparent) 0 6px, color-mix(in srgb, var(--c, #f33abc) 14%, transparent) 6px 12px);
    display: flex; align-items: center; font-size: .7rem; color: var(--text); overflow: hidden; }
  .len:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .t { padding: 0 .35rem; white-space: nowrap; pointer-events: none; }
  .end { position: absolute; right: 0; top: 0; bottom: 0; width: 8px; cursor: ew-resize; background: color-mix(in srgb, var(--c, #f33abc) 55%, transparent); touch-action: none; }
</style>
