<script lang="ts">
  // One knob of the effects on the timeline (speed, size...), under the Effects track when it's
  // opened: over each effect bar a line at the knob's value. Its own value is the effect's: drag the
  // line up or down. A click on it puts a point there and makes it a curve over that bar (the knob
  // changes along the bar while the song plays); drag a point to move it, double-click it to take it
  // away (one left: the curve goes, the effect's own value again).
  import { app } from '../app.svelte';
  import { KNOBS } from '../engine/fxkit';
  import { paramsOf } from '../engine/effects';
  import type { CurveKnob, TimelineItem } from '../model/timeline';

  let { knob, bars, x, scale, h = 34 }: { knob: CurveKnob; bars: TimelineItem[]; x: (t: number) => number; scale: number; h?: number } = $props();

  // the knob's range on the row: speed on a log scale (a quarter of a beat to 32 beats a round), the
  // rest from its lowest to its highest
  const SPEED: [number, number] = [0.25, 32];
  const range = $derived<[number, number]>(knob === 'speed' ? SPEED : [KNOBS[knob].lo, KNOBS[knob].hi]);
  const toY = (v: number) => {
    const [lo, hi] = range, k = knob === 'speed' ? (Math.log(Math.max(lo, Math.min(hi, v))) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) : (v - lo) / (hi - lo);
    return 3 + (1 - Math.max(0, Math.min(1, k))) * (h - 6);
  };
  const fromY = (y: number) => {
    const [lo, hi] = range, k = 1 - Math.max(0, Math.min(1, (y - 3) / (h - 6)));
    const v = knob === 'speed' ? Math.exp(Math.log(lo) + k * (Math.log(hi) - Math.log(lo))) : lo + k * (hi - lo);
    return Math.round(v * 100) / 100;
  };
  const effectOf = (it: TimelineItem) => (it.do.do === 'effect' ? app.show.effects.find((e) => e.id === (it.do as { effect: string }).effect) : undefined);
  const ownValue = (it: TimelineItem) => { const e = effectOf(it); return e ? (paramsOf(e.kind, e.params) as unknown as Record<string, number>)[knob] ?? 0 : 0; };
  const curveOf = (it: TimelineItem) => it.curves?.find((c) => c.knob === knob);
  const said = (v: number) => (knob === 'speed' ? `${v} beats a round` : `${Math.round(v * 100)} %`);

  // dragging: a point (its bar and index), or a bar's flat line (the effect's own value)
  let drag: { it: TimelineItem; i: number } | { it: TimelineItem; own: true } | null = null;
  function local(e: MouseEvent, it: TimelineItem) {
    const svg = (e.currentTarget as Element).closest('svg')!, r = svg.getBoundingClientRect();
    return { f: Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, it.len! * scale))), y: e.clientY - r.top };
  }
  // a point where it was clicked (a curve from the bar's own value when it had none); its index
  function addPoint(e: MouseEvent, it: TimelineItem) {
    const { f, y } = local(e, it), c = curveOf(it);
    const pts = c ? c.pts : [[0, ownValue(it)], [1, ownValue(it)]] as [number, number][];
    const at = pts.findIndex((p) => p[0] > f), i = at < 0 ? pts.length : at;
    pts.splice(i, 0, [Math.round(f * 1000) / 1000, fromY(y)]);
    if (!c) it.curves = [...(it.curves ?? []), { knob, pts }];
    return i;
  }
  // on the line: a curve's gets a point to drag; the effect's own value's is dragged as it is (Alt:
  // a point, as a double-click does)
  function lineDown(e: PointerEvent, it: TimelineItem) {
    e.stopPropagation(); e.preventDefault();
    app.checkpoint();
    drag = !curveOf(it) && !e.altKey ? { it, own: true } : { it, i: addPoint(e, it) };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function lineDouble(e: MouseEvent, it: TimelineItem) {
    if (curveOf(it)) return;
    e.stopPropagation();
    app.checkpoint(); addPoint(e, it); app.markDirty(0);
  }
  function pointDown(e: PointerEvent, it: TimelineItem, i: number) {
    e.stopPropagation(); e.preventDefault();
    app.checkpoint();
    drag = { it, i };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const { f, y } = local(e, drag.it);
    if ('own' in drag) { const ef = effectOf(drag.it); if (ef) ef.params = { ...ef.params, [knob]: fromY(y) }; return; }
    const c = curveOf(drag.it);
    if (!c) return;
    const lo = drag.i > 0 ? c.pts[drag.i - 1][0] : 0, hi = drag.i < c.pts.length - 1 ? c.pts[drag.i + 1][0] : 1;
    c.pts[drag.i] = [Math.round(Math.max(lo, Math.min(hi, f)) * 1000) / 1000, fromY(y)];
  }
  function up() { if (drag) { drag = null; app.markDirty(0); } }
  function remove(e: MouseEvent, it: TimelineItem, i: number) {
    e.stopPropagation();
    const c = curveOf(it);
    if (!c) return;
    app.checkpoint();
    c.pts.splice(i, 1);
    if (c.pts.length < 2) { it.curves = it.curves!.filter((x) => x !== c); if (!it.curves.length) delete it.curves; }
    app.markDirty(0);
  }
</script>

{#each bars as it (it.id)}
  {@const w = Math.max(10, it.len! * scale)}
  {@const c = curveOf(it)}
  {@const own = ownValue(it)}
  <svg class="curve" style="left:{x(it.at)}px" width={w} height={h} role="group" aria-label="{knob} over {app.show.effects.find((e) => e.id === (it.do as { effect?: string }).effect)?.name ?? 'the effect'}"
    onpointermove={move} onpointerup={up} onpointercancel={up}>
    {#if c}
      <polyline class="line" points={[[0, c.pts[0][1]], ...c.pts, [1, c.pts[c.pts.length - 1][1]]].map(([f, v]) => `${f * w},${toY(v)}`).join(' ')} />
      <!-- svelte-ignore a11y_no_static_element_interactions (a point is moved with the mouse; the value is said in its title) -->
      <polyline class="hit" points={[[0, c.pts[0][1]], ...c.pts, [1, c.pts[c.pts.length - 1][1]]].map(([f, v]) => `${f * w},${toY(v)}`).join(' ')} onpointerdown={(e) => lineDown(e, it)} />
      {#each c.pts as p, i (i)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <circle class="pt" cx={p[0] * w} cy={toY(p[1])} r="4" onpointerdown={(e) => pointDown(e, it, i)} ondblclick={(e) => remove(e, it, i)}><title>{said(p[1])}: drag to move, double-click to take it away</title></circle>
      {/each}
    {:else}
      <line class="line own" x1="0" x2={w} y1={toY(own)} y2={toY(own)} />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <line class="hit" x1="0" x2={w} y1={toY(own)} y2={toY(own)} onpointerdown={(e) => lineDown(e, it)} ondblclick={(e) => lineDouble(e, it)}><title>{said(own)} (the effect's own): drag up or down to change it, double-click (or Alt+click) for a curve along this bar</title></line>
    {/if}
  </svg>
{/each}

<style>
  .curve { position: absolute; top: 0; overflow: visible; }
  .line { fill: none; stroke: var(--c, #ffaa1c); stroke-width: 2; pointer-events: none; }
  .line.own { stroke-dasharray: 4 3; opacity: .75; }
  .hit { fill: none; stroke: transparent; stroke-width: 12; cursor: ns-resize; }
  .pt { fill: #0b0f15; stroke: var(--c, #ffaa1c); stroke-width: 2; cursor: grab; }
  .pt:hover { fill: var(--c, #ffaa1c); }
</style>
