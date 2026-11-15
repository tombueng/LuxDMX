<script lang="ts">
  // A list's level over the song, under its track when it's opened: a line from the start of the show
  // to its end. None yet: a dashed line at full. A click in the row puts a point there (the first
  // one: that level all song long); drag a point to move it, double-click it to take it away (the last
  // one gone: full again). While the song plays it scales the list's fader (model/timeline.ts levels).
  // From the keyboard: Enter on the row puts a point at the playhead; on a point, up and down change
  // its level (5 %, Shift 1 %), left and right move it a beat (Shift a bar), Delete takes it away.
  import { tick } from 'svelte';
  import { app } from '../app.svelte';
  import { clockOf, levelAt } from '../model/timeline';

  let { list, name, x, span, sn, beat, playhead, h = 34 }: {
    list: string; name: string; x: (t: number) => number; span: { from: number; to: number };
    sn: (t: number, free?: boolean) => number; beat: number; playhead: number; h?: number;
  } = $props();
  let row = $state<SVGSVGElement>();

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
    const { t: raw, v } = local(e);
    return putPoint(sn(raw, e.altKey), v);
  }
  function putPoint(t: number, v: number): number {
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
  function remove(e: Event, i: number) {
    e.stopPropagation();
    if (!pts || !tl.levels) return;
    app.checkpoint();
    pts.splice(i, 1);
    if (!pts.length) { delete tl.levels[list]; if (!Object.keys(tl.levels).length) delete tl.levels; }
    app.markDirty(0);
  }
  // the keyboard: Enter on the row, a point at the playhead (at the level the line has there)
  async function rowKey(e: KeyboardEvent) {
    if (e.target !== row || (e.key !== 'Enter' && e.key !== 'Insert')) return;
    e.preventDefault();
    app.checkpoint();
    const t = Math.max(span.from, Math.min(span.to, sn(playhead)));
    const i = putPoint(t, pts ? levelAt(pts, t) : 1);
    app.markDirty(0);
    await tick();
    (row?.querySelectorAll('circle.pt')[i] as SVGElement | undefined)?.focus();
  }
  async function pointKey(e: KeyboardEvent, i: number) {
    if (!pts) return;
    const k = e.key, fine = e.shiftKey;
    if (k === 'Delete' || k === 'Backspace') { remove(e, i); e.preventDefault(); await tick(); row?.focus(); return; }
    const dv = k === 'ArrowUp' ? 1 : k === 'ArrowDown' ? -1 : 0, dt = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0;
    if (!dv && !dt) return;
    e.preventDefault(); e.stopPropagation();
    app.checkpoint();
    const [t, v] = pts[i];
    const lo = i > 0 ? pts[i - 1][0] + 0.05 : span.from, hi = i < pts.length - 1 ? pts[i + 1][0] - 0.05 : span.to;
    pts[i] = [Math.max(lo, Math.min(hi, Math.round((t + dt * beat * (fine ? 4 : 1)) * 1000) / 1000)),
      Math.round(Math.max(0, Math.min(1, v + dv * (fine ? 0.01 : 0.05))) * 100) / 100];
    app.markDirty(0);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Enter on it puts a point at the playhead; the points are sliders) -->
<svg class="level" style="left:{x(span.from)}px" width={w} height={h} role="group" aria-label="The level of {name} over the song" tabindex="0" bind:this={row}
  onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={rowKey}>
  <!-- (anywhere in the row: a point there) -->
  <!-- svelte-ignore a11y_no_static_element_interactions (a point is set with the mouse; each one says its level in its title) -->
  <rect class="area" x="0" y="0" width={w} height={h} onpointerdown={lineDown}><title>{pts ? 'Click to put a point here (Alt: off the beat)' : 'Full (the fader\'s level): click to put a point and set the level from there'}</title></rect>
  {#if pts}
    <polyline class="line" points={line} />
    {#each pts as p, i (i)}
      <circle class="pt" cx={x(p[0]) - x(span.from)} cy={toY(p[1])} r="4" role="slider" tabindex="0" aria-label="A point of {name}'s level"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p[1] * 100)} aria-valuetext="{said(p[1])} at {clockOf(p[0])}"
        onpointerdown={(e) => pointDown(e, i)} ondblclick={(e) => remove(e, i)} onkeydown={(e) => pointKey(e, i)}><title>{said(p[1])} at {clockOf(p[0])}: drag to move (or the arrow keys), double-click (or Delete) to take it away</title></circle>
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
  .pt:hover, .pt:focus-visible { fill: var(--c, #45d85c); }
  .pt:focus-visible { outline: none; stroke: var(--accent); stroke-width: 3; }
  .level:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
