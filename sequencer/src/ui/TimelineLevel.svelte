<script lang="ts">
  // A list's level over the song, under its track when it's opened: a line from the start of the show
  // to its end. None yet: a dashed line at full. A click in the row puts a point there (the first
  // one: that level all song long); drag a point to move it, double-click it to take it away (the last
  // one gone: full again). While the song plays it scales the list's fader (model/timeline.ts levels).
  import { app } from '../app.svelte';
  import { clockOf } from '../model/timeline';

  let { list, name, x, span, sn, h = 34 }: {
    list: string; name: string; x: (t: number) => number; span: { from: number; to: number };
    sn: (t: number, free?: boolean) => number; h?: number;
  } = $props();

  // (the song that's up: the view shows this row only when there's one)
  const tl = $derived(app.show.timeline!);
  const pts = $derived(tl.levels?.[list]);
  const toY = (v: number) => 3 + (1 - Math.max(0, Math.min(1, v))) * (h - 6);
  const fromY = (y: number) => Math.round(Math.max(0, Math.min(1, 1 - (y - 3) / (h - 6))) * 100) / 100;
  const said = (v: number) => `${Math.round(v * 100)} %`;
  const w = $derived(Math.max(1, x(span.to) - x(span.from)));
  const line = $derived(pts ? [[span.from, pts[0][1]], ...pts, [span.to, pts[pts.length - 1][1]]].map(([t, v]) => `${x(t) - x(span.from)},${toY(v)}`).join(' ') : '');

  // where on the song a pointer is, and its level there
  function local(e: PointerEvent | MouseEvent) {
    const r = (e.currentTarget as Element).closest('svg')!.getBoundingClientRect();
    return { t: Math.max(span.from, Math.min(span.to, span.from + ((e.clientX - r.left) / w) * (span.to - span.from))), v: fromY(e.clientY - r.top) };
  }
  // a point where it was clicked (snapped to the beat, Alt: not); its index
  function addPoint(e: PointerEvent): number {
    const { t: raw, v } = local(e), t = sn(raw, e.altKey);
    // (assigned, then read back: `??=` hands back the plain object, not the state's proxy, and a
    // point put into that never shows)
    if (!tl.levels) tl.levels = {};
    if (!tl.levels[list]) tl.levels[list] = [];
    const p = tl.levels[list];
    const same = p.findIndex((q) => q[0] === t);
    if (same >= 0) { p[same] = [t, v]; return same; }
    const at = p.findIndex((q) => q[0] > t), i = at < 0 ? p.length : at;
    p.splice(i, 0, [t, v]);
    return i;
  }
  let drag: number | null = null;
  function lineDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    app.checkpoint();
    drag = addPoint(e);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function pointDown(e: PointerEvent, i: number) {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    app.checkpoint();
    drag = i;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  // (a point stays between its neighbours: the line never folds back)
  function move(e: PointerEvent) {
    if (drag === null || !pts) return;
    const { t: raw, v } = local(e), lo = drag > 0 ? pts[drag - 1][0] + 0.05 : span.from, hi = drag < pts.length - 1 ? pts[drag + 1][0] - 0.05 : span.to;
    pts[drag] = [Math.max(lo, Math.min(hi, sn(raw, e.altKey))), v];
  }
  function up() { if (drag !== null) { drag = null; app.markDirty(0); } }
  function remove(e: MouseEvent, i: number) {
    e.stopPropagation();
    if (!pts || !tl.levels) return;
    app.checkpoint();
    pts.splice(i, 1);
    if (!pts.length) { delete tl.levels[list]; if (!Object.keys(tl.levels).length) delete tl.levels; }
    app.markDirty(0);
  }
</script>

<svg class="level" style="left:{x(span.from)}px" width={w} height={h} role="group" aria-label="The level of {name} over the song"
  onpointermove={move} onpointerup={up} onpointercancel={up}>
  <!-- (anywhere in the row: a point there) -->
  <!-- svelte-ignore a11y_no_static_element_interactions (a point is set with the mouse; each one says its level in its title) -->
  <rect class="area" x="0" y="0" width={w} height={h} onpointerdown={lineDown}><title>{pts ? 'Click to put a point here (Alt: off the beat)' : 'Full (the fader\'s level): click to put a point and set the level from there'}</title></rect>
  {#if pts}
    <polyline class="line" points={line} />
    {#each pts as p, i (i)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <circle class="pt" cx={x(p[0]) - x(span.from)} cy={toY(p[1])} r="4" onpointerdown={(e) => pointDown(e, i)} ondblclick={(e) => remove(e, i)}><title>{said(p[1])} at {clockOf(p[0])}: drag to move, double-click to take it away</title></circle>
    {/each}
  {:else}
    <line class="line own" x1="0" x2={w} y1={toY(1)} y2={toY(1)} />
  {/if}
</svg>

<style>
  .level { position: absolute; top: 0; overflow: visible; }
  .line { fill: none; stroke: var(--c, #45d85c); stroke-width: 2; pointer-events: none; }
  .line.own { stroke-dasharray: 4 3; opacity: .75; }
  .area { fill: transparent; cursor: crosshair; }
  .pt { fill: #0b0f15; stroke: var(--c, #45d85c); stroke-width: 2; cursor: grab; }
  .pt:hover { fill: var(--c, #45d85c); }
</style>
