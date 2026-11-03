<script lang="ts">
  // The stage as you'd see it: every fixture where it hangs, drawn as what it is, in its live colour.
  // Moving heads throw a beam (pan turns it, tilt makes it longer), pixel bars show their cells,
  // fog puffs, a strobe flashes. Select by clicking, Shift/Ctrl-clicking or dragging a box; drag a
  // fixture to move it.
  import Icon from './Icon.svelte';
  import Help from './Help.svelte';
  import { load } from '../perf/load.svelte';
  import LoadMeter from './LoadMeter.svelte';
  import { app } from '../app.svelte';
  import { ui } from './ui.svelte';
  import { lookColor } from '../engine/cuelook';
  import { fixtureActions, fixtureMenu } from './actions';
  import { EFFECT_MAP } from '../engine/effects';
  import type { Resolved } from '../model/types';

  // compact: no toolbar. readonly: only to look at (the Live page): zoom and pan, no selecting or moving.
  // blindChip: says "Blind: only here" itself (the Live page has its own, one you can press)
  // the soft glows and pools: not at the lowest quality (perf/load.svelte.ts)
  const blur = $derived(load.level2d > 0);
  // the moving bits (fog puffs breathing, a strobe flashing): only at the best quality, they make the
  // browser redraw the whole plan every frame
  const moving = $derived(load.level2d > 1);
  let { compact = false, readonly = false, blindChip = true }: { compact?: boolean; readonly?: boolean; blindChip?: boolean } = $props();
  // The drawing is H units high and as wide as the panel's shape (so it fills it, no letterbox).
  // `px` is how many drawing units one screen pixel is: labels and symbols are sized in screen
  // pixels, so they stay readable whatever the panel size or zoom.
  const H = 560;
  let view = $state({ x: 0, y: 0, k: 1 });       // zoom and pan
  let box = $state({ w: 1000, h: 560 });
  const W = $derived(Math.max(300, Math.round(H * box.w / Math.max(1, box.h))));
  const px = $derived(H / Math.max(1, box.h) / view.k);
  let area = $state<HTMLDivElement>();
  $effect(() => {
    if (!area) return;
    const ro = new ResizeObserver(([e]) => { const r = e.contentRect; if (r.width > 0 && r.height > 0) box = { w: r.width, h: r.height }; });
    ro.observe(area);
    return () => ro.disconnect();
  });
  let svg = $state<SVGSVGElement>();
  let drag: { ids: string[]; start: { x: number; y: number }; orig: Record<string, { x: number; y: number }>; moved: boolean } | null = null;
  let band = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  let labels = $state(true), addrs = $state(false);

  // Screen -> stage coordinates (0..1), through the SVG's own transform: the drawing is letterboxed
  // inside the element, so the element's box isn't the stage's box.
  const pt = (e: PointerEvent) => {
    const m = svg!.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: q.x / W, y: q.y / H };
  };
  function downFixture(e: PointerEvent, id: string) {
    e.stopPropagation();
    if (e.button !== 0 || readonly) return;        // right-click: the menu, the selection stays; Live only looks
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const multi = e.shiftKey || e.ctrlKey || e.metaKey;
    if (multi) app.select(id, true);
    else if (!app.selected.includes(id)) app.select(id, false);
    const ids = app.selected.includes(id) ? [...app.selected] : [id];
    const orig: Record<string, { x: number; y: number }> = {};
    for (const f of app.show.fixtures) if (ids.includes(f.id)) orig[f.id] = { x: f.x, y: f.y };
    drag = { ids, start: pt(e), orig, moved: false };
  }
  // Dragging snaps to the lines of the other lights (same row, same column), like the guides in a
  // drawing program; Alt drags freely. The guides show while it snaps.
  let guides = $state<{ x?: number; y?: number }>({});
  function moveFixture(e: PointerEvent) {
    if (!drag || readonly) return;
    const p = pt(e);
    let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < 0.004) return;
    drag.moved = true;
    const g: { x?: number; y?: number } = {};
    if (!e.altKey) {
      const lead = drag.orig[drag.ids[0]], tx = lead.x + dx, ty = lead.y + dy;
      const others = app.show.fixtures.filter((f) => !drag!.ids.includes(f.id));
      const near = (v: number, key: 'x' | 'y', tol: number) => others.reduce<number | undefined>((best, f) => (Math.abs(f[key] - v) < tol && (best === undefined || Math.abs(f[key] - v) < Math.abs(best - v)) ? f[key] : best), undefined);
      // within 7 screen pixels
      const sx = near(tx, 'x', 7 * px / W), sy = near(ty, 'y', 7 * px / H);
      if (sx !== undefined) { dx += sx - tx; g.x = sx; }
      if (sy !== undefined) { dy += sy - ty; g.y = sy; }
    }
    guides = g;
    for (const id of drag.ids) app.moveFixture(id, drag.orig[id].x + dx, drag.orig[id].y + dy);
  }
  function upFixture(e: PointerEvent, id: string) {
    if (readonly) return;
    if (drag && !drag.moved && !(e.shiftKey || e.ctrlKey || e.metaKey)) app.select(id, false);
    drag = null; guides = {};
  }
  // Arrow keys nudge the selected lights on the stage (Shift: bigger steps), like any drawing tool.
  function stageKey(e: KeyboardEvent) {
    // like the lists: Esc clears the selection, Ctrl+A takes every light, Delete removes the selected
    if (!readonly && ui.modal !== 'patchCheck') {
      if (e.key === 'Escape' && app.selected.length) { e.preventDefault(); e.stopPropagation(); app.selectNone(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); app.selectAll(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && app.selected.length) { e.preventDefault(); fixtureActions.remove(); return; }
    }
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || readonly || ui.modal === 'patchCheck' || !app.selected.length || e.ctrlKey || e.metaKey || e.altKey) return;   // the check's arrows step it
    e.preventDefault();
    if (!e.repeat) app.checkpoint();                   // each press is an undo step (a held key, one)
    const step = e.shiftKey ? 0.05 : 0.01;
    for (const f of app.show.fixtures) if (app.selected.includes(f.id)) app.moveFixture(f.id, f.x + d[0] * step, f.y + d[1] * step);
    app.markDirty();
  }
  // ---- zoom and pan: wheel or pinch zooms around the pointer, middle button or two fingers pan.
  const vb = $derived(`${view.x.toFixed(1)} ${view.y.toFixed(1)} ${(W / view.k).toFixed(1)} ${(H / view.k).toFixed(1)}`);
  function zoomAt(px: number, py: number, k: number) {     // px, py in stage units (0..W, 0..H)
    k = Math.max(1, Math.min(8, k));
    const x = px - (px - view.x) * view.k / k, y = py - (py - view.y) * view.k / k;
    view = { k, x: Math.max(0, Math.min(W - W / k, x)), y: Math.max(0, Math.min(H - H / k, y)) };
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    const p = pt(e as unknown as PointerEvent);
    zoomAt(p.x * W, p.y * H, view.k * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0018)));
  }
  // Not onwheel: Svelte makes that listener passive, and the page would scroll while zooming.
  $effect(() => {
    const el = svg;
    if (!el) return;
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; k: number; cx: number; cy: number } | null = null;
  let pan: { x: number; y: number; vx: number; vy: number } | null = null;
  function panBy(dxPx: number, dyPx: number) {
    const r = svg!.getBoundingClientRect(), scale = Math.max(W / r.width, H / r.height) / view.k;
    view = { ...view, x: Math.max(0, Math.min(W - W / view.k, view.x - dxPx * scale)), y: Math.max(0, Math.min(H - H / view.k, view.y - dyPx * scale)) };
  }

  function downBg(e: PointerEvent) {
    if (e.button === 2) return;
    svg!.setPointerCapture(e.pointerId);
    if (e.pointerType === 'mouse') svg!.focus({ preventScroll: true });     // (its keys: Esc, Ctrl+A, Delete, arrows)
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {                 // second finger: pinch / pan instead of a selection box
        band = null;
        const [a, b] = [...touches.values()];
        const m = pt({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 } as PointerEvent);
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, cx: m.x * W, cy: m.y * H };
        return;
      }
    }
    if (e.button === 1) { e.preventDefault(); pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; return; }
    if (readonly) return;                          // Live: zoom and pan, no selecting
    const p = pt(e);
    band = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) app.selectNone();
  }
  function moveBg(e: PointerEvent) {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      const before = touches.get(e.pointerId)!;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size === 2) {
        const [a, b] = [...touches.values()];
        zoomAt(pinch.cx, pinch.cy, pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.d));
        panBy((e.clientX - before.x) / 2, (e.clientY - before.y) / 2);
        return;
      }
    }
    if (pan) { panBy(e.clientX - pan.x, e.clientY - pan.y); pan = { ...pan, x: e.clientX, y: e.clientY }; return; }
    if (band) { const p = pt(e); band = { ...band, x1: p.x, y1: p.y }; }
  }
  function upBg(e?: PointerEvent) {
    if (e) touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    pan = null;
    if (!band) return;
    const [xa, xb] = [Math.min(band.x0, band.x1), Math.max(band.x0, band.x1)], [ya, yb] = [Math.min(band.y0, band.y1), Math.max(band.y0, band.y1)];
    if (xb - xa > 0.005 || yb - ya > 0.005)
      app.selected = [...new Set([...app.selected, ...app.show.fixtures.filter((f) => f.x >= xa && f.x <= xb && f.y >= ya && f.y <= yb).map((f) => f.id)])];
    band = null;
  }
  // The Live stage only looks: its menus have the view items, and nothing at all while locked for
  // the show (a long press on a touch screen is a right-click, and must not lead out of the lock).
  const viewItems = () => [
    { label: labels ? 'Hide names' : 'Show names', icon: 'eye', run: () => { labels = !labels; } },
    { label: addrs ? 'Hide DMX addresses' : 'Show DMX addresses', icon: 'grid', run: () => { addrs = !addrs; } },
    { label: 'Show the whole stage', icon: 'eye', disabled: view.k === 1, run: () => { view = { x: 0, y: 0, k: 1 }; } },
  ];
  function fxMenu(e: MouseEvent, id: string) {
    e.stopPropagation();
    if (readonly) { e.preventDefault(); if (!app.locked) ui.openMenu(e, viewItems()); return; }
    const items = fixtureMenu(id);
    if (app.selected.length > 1) items.splice(1, 0, ...arrangeItems());
    ui.openMenu(e, items);
  }
  function bgMenu(e: MouseEvent) {
    if (readonly) { e.preventDefault(); if (!app.locked) ui.openMenu(e, viewItems()); return; }
    ui.openMenu(e, [
      { label: 'Select all', icon: 'check', keys: 'Ctrl+A', run: () => app.selectAll() },
      { label: 'Select none', icon: 'close', keys: 'Esc', run: () => app.selectNone() },
      { label: 'Invert the selection', icon: 'loop', run: invert },
      { sep: true },
      ...viewItems(),
      { sep: true },
      ...arrangeItems(),
      { sep: true },
      { label: app.show.settings.stage?.image ? 'Change the background picture…' : 'Background picture (a plan or photo of the room)…', icon: 'image', run: () => imgInput?.click() },
      ...(app.show.settings.stage?.image ? [{ label: 'Remove the background picture', icon: 'close', run: () => app.setStageImage(null) }] : []),
      { label: 'Add fixtures…', icon: 'plus', run: () => (ui.modal = 'addFixtures') },
    ]);
  }
  let imgInput = $state<HTMLInputElement>();
  const arrangeItems = () => {
    const off = app.selected.length < 2;
    return [
      { label: 'Line up the selected lights in a row', icon: 'right', disabled: off, run: () => app.arrange('row') },
      { label: '… in an arc', icon: 'update', disabled: off, run: () => app.arrange('arc') },
      { label: '… in a circle', icon: 'record', disabled: off, run: () => app.arrange('circle') },
      { label: '… in a grid', icon: 'live', disabled: off, run: () => app.arrange('grid') },
    ];
  };
  // A preset dragged from the Presets panel onto a light: that light (or, if it's selected, the
  // whole selection) gets it.
  let dropFx = $state<string | null>(null);
  const isPreset = (e: DragEvent) => e.dataTransfer?.types.includes('application/x-luxdmx-preset');
  function presetDrop(e: DragEvent, id: string) {
    const p = e.dataTransfer?.getData('application/x-luxdmx-preset');
    dropFx = null;
    if (!p) return;
    e.preventDefault();
    const to = app.selected.includes(id) ? app.selected : [id];
    const pre = app.show.presets.find((x) => x.id === p);
    if (!app.applyPreset(p, to)) return;
    // A running effect of the same kind paints over it: say so, or it looks like nothing happened.
    const cat = pre?.kind === 'position' ? 'move' : pre?.kind;
    const over = app.effectsOn(to).filter((e) => EFFECT_MAP.get(e.kind)?.category === cat);
    const byHand = over.filter((e) => app.liveFx.includes(e.id));
    ui.toast(`${pre?.name} on ${to.length > 1 ? `${to.length} lights` : app.show.fixtures.find((f) => f.id === id)?.name}${over.length ? `, but ${over.map((e) => e.name).join(', ')} ${over.length > 1 ? 'are' : 'is'} running over it` : ''}`,
      over.length ? 5000 : 2200, byHand.length ? { label: `Stop ${byHand.length > 1 ? 'them' : byHand[0].name}`, run: () => { for (const e of byHand) app.toggleEffect(e.id); } } : undefined);
  }
  const invert = () => { app.selected = app.show.fixtures.filter((f) => !app.selected.includes(f.id)).map((f) => f.id); };
  // Symbol radius in drawing units: 11-22 screen pixels (bigger on touch screens).
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  // Zooming in makes them a bit bigger too (not as much as the room: they'd overlap again).
  const size = $derived(Math.max(coarse ? 16 : 11, Math.min(22, 200 / Math.sqrt(app.show.fixtures.length + 3))) * px * Math.sqrt(view.k));
  const css = (l: Resolved | undefined) => lookColor(l);
  const cells = (id: string) => app.caps(id).cells;
  // one universe: addresses as plain numbers ("73", not "0.73", which reads like a decimal)
  const oneUni = $derived(new Set(app.show.fixtures.map((f) => f.universe)).size <= 1);

  // Names that don't run into each other: each label goes under its light, or above when that's
  // in the way (another name, another light), else beside it on the right or the left. One that
  // fits nowhere is left out (hover shows it; a selected light always gets its name). Like the
  // labels on a map.
  type At = { x: number; y: number; anchor: 'middle' | 'start' | 'end' };
  const labelAt = $derived.by(() => {
    const out = new Map<string, At | null>();
    if (!labels) return out;
    const fs = 12 * px;
    const halfW = (id: string) => { const k = app.kinds[id]; return size * (k === 'bar' ? 2.2 : k === 'mover' ? 0.9 : k === 'fog' || k === 'sfx' ? 0.8 : 0.72); };
    // Boxes (the lights' bodies, then each placed name) go into columns of the stage, so a name
    // only checks what's near it: a big rig stays quick while a light is dragged around.
    type Box = { x0: number; x1: number; y0: number; y1: number; id?: string };
    const G = 160 * px, grid = new Map<number, Box[]>();
    const cols = (b: Box) => { const out: number[] = []; for (let c = Math.floor(b.x0 / G); c <= Math.floor(b.x1 / G); c++) out.push(c); return out; };
    const put = (b: Box) => { for (const c of cols(b)) { const l = grid.get(c); if (l) l.push(b); else grid.set(c, [b]); } };
    const hits = (b: Box, self: string) => cols(b).some((c) => grid.get(c)?.some((o) => o.id !== self && o.x0 < b.x1 && b.x0 < o.x1 && o.y0 < b.y1 && b.y0 < o.y1));
    for (const f of app.show.fixtures) { const w = halfW(f.id), x = f.x * W, y = f.y * H; put({ id: f.id, x0: x - w, x1: x + w, y0: y - size * 0.7, y1: y + size * 0.7 }); }
    // the word "audience" at the front edge is in the way too
    put({ id: 'audience', x0: W / 2 - 34 * px, x1: W / 2 + 34 * px, y0: H - 30, y1: H - 12 });
    const sel = new Set(app.selected);
    const order = [...app.show.fixtures].sort((a, b) => Number(sel.has(b.id)) - Number(sel.has(a.id)));
    for (const f of order) {
      const x = f.x * W, y = f.y * H, half = f.name.length * fs * 0.3 + 2 * px, side = halfW(f.id) + 4 * px;
      const below = y + size * 1.15 + 13 * px, above = y - size * 1.1 - 4 * px, mid = y + fs * 0.35;
      const vert: At[] = (y > H * 0.86 ? [above, below] : [below, above]).map((by) => ({ x, y: by, anchor: 'middle' }));
      const tries: At[] = [...vert, { x: x + side, y: mid, anchor: 'start' }, { x: x - side, y: mid, anchor: 'end' }];
      let at: At | null = null;
      for (const t of tries) {
        const x0 = t.anchor === 'middle' ? t.x - half : t.anchor === 'start' ? t.x : t.x - 2 * half, x1 = x0 + 2 * half;
        const b: Box = { x0, x1, y0: t.y - fs * 0.9, y1: t.y + fs * 0.3, id: `label:${f.id}` };
        if (x0 >= 0 && x1 <= W && !hits(b, f.id)) { at = t; put(b); break; }
      }
      out.set(f.id, at ?? (sel.has(f.id) ? tries[0] : null));
    }
    return out;
  });
</script>

<div class="panel stage-wrap">
  <div class="row head">
    <h2>Stage</h2>
    <!-- the plan, or the stage in 3D (loaded when first asked for) -->
    <div class="dims" role="group" aria-label="View">
      <button class="ghost" class:on={!ui.stage3d} aria-pressed={!ui.stage3d} onclick={() => (ui.stage3d = false)}>2D</button>
      <button class="ghost" class:on={ui.stage3d} aria-pressed={ui.stage3d} onclick={() => (ui.stage3d = true)} title="The stage in 3D: beams, truss, the band; move, turn and aim lights">3D</button>
    </div>
    <!-- (blind with a box connected: what's here isn't what the lights do) -->
    {#if blindChip && app.output === 'blind' && app.bridges.length}<span class="chip blind" title="Blind: you see it here, the lights don't get it. Blind (top right) sends it to the stage.">Blind: only here</span>{/if}
    <Help>
      <p>Your rig from above. Every light shows what it's doing right now: colour, brightness, where a moving head points.</p>
      <p>Click a light to select it, Shift or Ctrl to add more, or drag a box around several. Drag a selected light to move it to where it hangs. Group chips select a whole group.</p>
    </Help>
    {#if app.selected.length && !readonly}<span class="chip">{app.selected.length} selected</span>{/if}
    <!-- the page's load, the DMX output's timing and the drawing quality -->
    <LoadMeter />
    <span class="grow"></span>
    {#if !compact}
    <div class="toolbar">
      {#each app.show.groups as g (g.id)}
        <button class="grp" onclick={(e) => app.selectGroup(g.id, e.shiftKey || e.ctrlKey || e.metaKey)} title="Select the group (Shift adds)">{g.name}</button>
      {/each}
      <span class="sep"></span>
      <button class="ghost" onclick={() => app.selectAll()} aria-label="Select all">All</button>
      <button class="ghost" onclick={() => app.selectNone()} aria-label="Select none">None</button>
      <button class="ghost" onclick={invert} title="Invert the selection">Invert</button>
      {#if !ui.stage3d}
      <span class="sep"></span>
      <button class="ghost" class:on={labels} onclick={() => (labels = !labels)} title="Show names">Aa</button>
      <button class="ghost" class:on={addrs} onclick={() => (addrs = !addrs)} title="Show DMX addresses">#</button>
      <span class="sep"></span>
      <button class="ghost" onclick={() => zoomAt(W / 2 / view.k + view.x, H / 2 / view.k + view.y, view.k * 1.4)} title="Zoom in (or the mouse wheel, or pinch)" aria-label="Zoom in"><Icon name="plus" size={14} /></button>
      <button class="ghost" onclick={() => { view = { x: 0, y: 0, k: 1 }; }} disabled={view.k === 1} title="Show the whole stage" aria-label="Fit the stage">{Math.round(view.k * 100)}%</button>
      {/if}
    </div>
    {/if}
  </div>

  <input type="file" accept="image/*" hidden bind:this={imgInput} onchange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (f) app.setStageImage(f).catch(() => ui.toast('That picture could not be read')); }} />
  <div class="area" bind:this={area}>
    {#if ui.stage3d}
      <div class="three">
        {#await import('../stage3d/Stage3D.svelte')}<p class="faint loading">Building the stage…</p>
        {:then m}<m.default {readonly} />
        {:catch}<p class="faint loading">The 3D stage needs WebGL, which this browser doesn't offer here.</p>{/await}
      </div>
    {/if}
    <!-- (not drawn under the 3D stage: hundreds of lights updated every frame for nobody) -->
    {#if !ui.stage3d}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (an application region: the stage handles its own keys) -->
    <svg bind:this={svg} viewBox={vb} preserveAspectRatio="none" role="application" aria-label="Stage" aria-describedby="stage-keys" tabindex="0" onkeydown={stageKey}
         onpointerdown={downBg} onpointermove={(e) => { moveBg(e); moveFixture(e); }} onpointerup={upBg} onpointercancel={upBg} oncontextmenu={bgMenu}>
      <desc id="stage-keys">Arrow keys move the selected lights (Shift: bigger steps). Ctrl+A selects every light, Escape none, Delete removes the selected. Drag on the floor to select with a box.</desc>
      <defs>
        <radialGradient id="floor" cx="50%" cy="0%" r="90%"><stop offset="0" stop-color="#1c2533" /><stop offset="1" stop-color="#090c11" /></radialGradient>
        <filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="9" /></filter>
        <filter id="pool" x="-60%" y="-120%" width="220%" height="340%"><feGaussianBlur stdDeviation="14" /></filter>
        <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".85" /><stop offset="1" stop-color="#fff" stop-opacity="0" /></linearGradient>
      </defs>
      <rect width={W} height={H} rx="10" fill="url(#floor)" />
      {#if app.show.settings.stage?.image}
        <image href={app.show.settings.stage.image} x="0" y="0" width={W} height={H} preserveAspectRatio="xMidYMid slice" opacity={app.show.settings.stage.opacity ?? 0.45} pointer-events="none" />
      {/if}
      <rect x="40" y={H - 30} width={W - 80} height="16" rx="4" fill="#ffffff05" stroke="#ffffff0d" />
      <text x={W / 2} y={H - 18} text-anchor="middle" class="edge" font-size={11 * px}>audience</text>

      <!-- Light on the floor first (under everything, names included): a soft pool in front of each
           lit PAR or bar (all blurred in one go), the beam of each moving head. -->
      <!-- (not at the lowest quality: blurring is the expensive part of drawing the plan) -->
      {#if blur}
      <g filter="url(#pool)" pointer-events="none">
        {#each app.show.fixtures as f (f.id)}
          {@const k = app.kinds[f.id]}
          {#if k === 'par' || k === 'bar' || k === 'dimmer'}
            {@const c = css(app.stage[f.id])}
            {#if c.glow > 0.04}
              <ellipse cx={f.x * W} cy={f.y * H + size * 1.5} rx={size * (k === 'bar' ? 3.4 : 2.2)} ry={size * 0.9} fill={c.css} opacity={0.18 * Math.min(1, c.glow)} />
            {/if}
          {/if}
        {/each}
      </g>
      {/if}
      {#each app.show.fixtures as f (f.id)}
        {@const k = app.kinds[f.id]}
        {#if k === 'mover'}
          {@const l = app.stage[f.id]}
          {@const c = css(l)}
          {#if c.glow > 0.02}
            {@const pan = ((l?.pan ?? 0.5) - 0.5) * 2.6}
            {@const len = 70 + 260 * (l?.tilt ?? 0.5)}
            <g transform="translate({f.x * W} {f.y * H}) rotate({(-pan * 180) / Math.PI})" opacity={0.15 + 0.6 * c.glow} pointer-events="none">
              <polygon points="-{size * 0.35},0 {size * 0.35},0 {size * 0.35 + len * 0.18},{len} -{size * 0.35 + len * 0.18},{len}" fill={c.css} style="mask:none" class="beam" data-for={f.name} />
            </g>
          {/if}
        {/if}
      {/each}
      {#each app.show.fixtures as f (f.id)}
        {@const l = app.stage[f.id]}
        {@const c = css(l)}
        {@const kind = app.kinds[f.id] ?? 'other'}
        {@const sel = !readonly && app.selected.includes(f.id)}
        {@const x = f.x * W}
        {@const y = f.y * H}
        <g class="fx" data-name={f.name} role="button" tabindex="-1" aria-label={f.name} aria-pressed={sel}
           class:dropping={dropFx === f.id} oncontextmenu={(e) => fxMenu(e, f.id)}
           ondragover={(e) => { if (isPreset(e)) { e.preventDefault(); dropFx = f.id; } }} ondragleave={() => { if (dropFx === f.id) dropFx = null; }} ondrop={(e) => presetDrop(e, f.id)}
           onpointerdown={(e) => downFixture(e, f.id)} onpointermove={moveFixture} onpointerup={(e) => upFixture(e, f.id)}>
          {#if kind === 'mover'}
            <circle cx={x} cy={y} r={size * 1.25} fill={c.css} opacity={c.glow * 0.45} filter={blur ? 'url(#glow)' : undefined} pointer-events="none" />
            <rect x={x - size * 0.9} y={y - size * 0.25} width={size * 1.8} height={size * 0.5} rx="3" fill="#2a313c" />
            <circle cx={x} cy={y} r={size * 0.62} fill={c.glow > 0.02 ? c.css : '#1a2029'} stroke={sel ? 'var(--orange)' : '#4a5463'} stroke-width={(sel ? 2.5 : 1.2) * px} />
          {:else if kind === 'bar'}
            {@const n = cells(f.id)}
            <rect x={x - size * 2.2} y={y - size * 0.55} width={size * 4.4} height={size * 1.1} rx="4" fill={c.css} opacity={c.glow * 0.4} filter={blur ? 'url(#glow)' : undefined} pointer-events="none" />
            <rect x={x - size * 2.2} y={y - size * 0.42} width={size * 4.4} height={size * 0.84} rx="4" fill="#1a2029" stroke={sel ? 'var(--orange)' : '#4a5463'} stroke-width={(sel ? 2.5 : 1.2) * px} />
            <!-- its cells (a long pixel strip: the pixels touch, no gaps) -->
            {#each Array(n) as _, i (i)}
              {@const cc = css(l?.cells?.[i] ?? l)}
              <rect x={x - size * 2.05 + (i * size * 4.1) / n} y={y - size * 0.28} width={Math.max(0.5, (size * 4.1) / n - (n > 24 ? 0 : 2))} height={size * 0.56} rx={n > 24 ? 0 : 2} fill={cc.glow > 0.02 ? cc.css : '#232a35'} />
            {/each}
          {:else if kind === 'sfx'}
            <!-- an effect machine: what it is, lit while it runs -->
            {@const at = (['confetti', 'bubbles', 'flame', 'sparks', 'co2'] as const).find((a) => app.modeOf(f.id)?.channels.some((ch) => ch.attr === a)) ?? 'confetti'}
            {@const on = ((l as Record<string, number> | undefined)?.[at] ?? 0) > 0.02}
            <rect x={x - size * 0.8} y={y - size * 0.5} width={size * 1.6} height={size} rx="5" fill={on ? '#3a2a10' : '#1a2029'} stroke={sel ? 'var(--orange)' : on ? 'var(--orange)' : '#4a5463'} stroke-width={(sel ? 2.5 : 1.2) * px} />
            <text x={x} y={y + size * 0.16} text-anchor="middle" class="glyph" font-size={size * 0.4}>{({ confetti: 'CONF', bubbles: 'BUBL', flame: 'FIRE', sparks: 'SPRK', co2: 'CO2' })[at]}</text>
          {:else if kind === 'fog'}
            {@const fog = l?.fog ?? l?.haze ?? 0}
            {@const hazer = !!app.modeOf(f.id)?.channels.some((ch) => ch.attr === 'haze') && !app.modeOf(f.id)?.channels.some((ch) => ch.attr === 'fog')}
            {#if fog > 0.02}
              {#each [0, 1, 2] as k (k)}<circle pointer-events="none" class="puff" class:still={!moving} style="animation-delay:{k * 0.5}s" cx={x - size * 0.3} cy={y} r={size * (0.9 + k * 0.5)} fill="#cfd8e3" opacity={0.18 * fog} />{/each}
            {/if}
            <rect x={x - size * 0.8} y={y - size * 0.5} width={size * 1.6} height={size} rx="5" fill="#1a2029" stroke={sel ? 'var(--orange)' : '#4a5463'} stroke-width={(sel ? 2.5 : 1.2) * px} />
            <text x={x} y={y + size * 0.18} text-anchor="middle" class="glyph" font-size={size * (hazer ? 0.45 : 0.55)}>{hazer ? 'HAZE' : 'FOG'}</text>
          {:else}
            {@const strobe = (l?.strobe ?? 0) > 0.02 && c.glow > 0.02}
            <circle cx={x} cy={y} r={size * 1.5} fill={c.css} opacity={c.glow * 0.5} filter={blur ? 'url(#glow)' : undefined} class:flash={strobe && moving} pointer-events="none"
                    style={strobe ? `animation-duration:${(0.5 - 0.42 * (l?.strobe ?? 0)).toFixed(2)}s` : ''} />
            <circle cx={x} cy={y} r={size * 0.72} fill={c.glow > 0.02 ? c.css : '#1a2029'} stroke={sel ? 'var(--orange)' : '#4a5463'} stroke-width={(sel ? 2.5 : 1.2) * px} />
            {#if kind === 'par'}<circle cx={x} cy={y} r={size * 0.38} fill="none" stroke="#00000055" stroke-width="1.5" />{/if}
            {#if kind === 'strobe'}<text x={x} y={y + size * 0.22} text-anchor="middle" class="glyph" font-size={size * 0.7}>⚡</text>{/if}
          {/if}
          <title>{f.name} · {oneUni ? `address ${f.address}` : `universe ${f.universe}, address ${f.address}`}</title>
        </g>
      {/each}
      <!-- names and addresses on top of every light, beam and glow, with a dark halo -->
      <g class="labels" pointer-events="none">
        {#each app.show.fixtures as f (f.id)}
          {@const x = f.x * W}
          {@const y = f.y * H}
          {@const sel = !readonly && app.selected.includes(f.id)}
          {@const at = labels ? labelAt.get(f.id) : null}
          {#if at}<text x={at.x} y={at.y} text-anchor={at.anchor} class="lbl" class:sel font-size={12 * px}>{f.name}</text>{/if}
          {#if addrs}<text x={x} y={y > H * 0.86 ? y + size * 1.1 + 11 * px : y - size * 0.95 - 4 * px} text-anchor="middle" class="adr" font-size={10.5 * px}>{oneUni ? f.address : `${f.universe}.${f.address}`}</text>{/if}
        {/each}
      </g>

      {#if guides.x !== undefined}<line class="snapguide" x1={guides.x * W} y1="0" x2={guides.x * W} y2={H} stroke-width={px} />{/if}
      {#if guides.y !== undefined}<line class="snapguide" x1="0" y1={guides.y * H} x2={W} y2={guides.y * H} stroke-width={px} />{/if}
      {#if band}
        <rect x={Math.min(band.x0, band.x1) * W} y={Math.min(band.y0, band.y1) * H} width={Math.abs(band.x1 - band.x0) * W} height={Math.abs(band.y1 - band.y0) * H}
              fill="#ffaa1c14" stroke="var(--orange)" stroke-dasharray="6 4" />
      {/if}
    </svg>
    {/if}

    <!-- an empty show: the way back to the welcome (a dialog over everything, the 3D stage too) -->
    {#if app.show.fixtures.length === 0}
      <div class="empty" class:compact class:low={ui.stage3d}>
        <span>Nothing on stage yet.</span>
        <button class="primary" onclick={() => (ui.modal = 'welcome')}><Icon name="play" />Get started</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .stage-wrap { flex: 1; display: flex; flex-direction: column; min-height: min(260px, 38vh); padding: .55rem; }
  .blind { font-size: .72rem; color: #9fc0ff; border-color: #6aa2ff66; white-space: nowrap; }
  .dims { display: inline-flex; border: 1px solid var(--line); border-radius: 7px; padding: 1px; }
  .dims button { padding: .05rem .5rem; font-size: .78rem; min-height: 0; }
  /* (finger sized where there's a finger) */
  @media (pointer: coarse) { .dims button { min-height: 44px; min-width: 44px; } }
  .three { position: absolute; inset: 0; z-index: 3; display: flex; }
  .loading { margin: auto; }
  .head { margin-bottom: .35rem; flex-wrap: wrap; }
  .grp { padding: .12rem .5rem; font-size: .8rem; border-radius: 999px; }
  .area { position: relative; flex: 1; min-height: 0; }
  svg { width: 100%; height: 100%; display: block; touch-action: none; user-select: none; }
  .fx { cursor: grab; }
  .fx:focus { outline: none; }
  .fx.dropping { filter: drop-shadow(0 0 6px var(--orange)); }
  .fx:active { cursor: grabbing; }
  .lbl { fill: var(--muted); pointer-events: none; paint-order: stroke; stroke: #0b0e13; stroke-width: 3px; stroke-linejoin: round; }
  .lbl.sel { fill: var(--orange); font-weight: 600; }
  .adr { fill: var(--faint); font-family: ui-monospace, monospace; pointer-events: none; paint-order: stroke; stroke: #0b0e13; stroke-width: 3px; stroke-linejoin: round; }
  .glyph { fill: var(--muted); font-weight: 700; pointer-events: none; }
  .edge { fill: var(--faint); letter-spacing: .25em; text-transform: uppercase; }
  .beam { filter: blur(2px); }
  .puff { animation: puff 1.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  .puff.still { animation: none; }
  @keyframes puff { 0%, 100% { transform: scale(.85); } 50% { transform: scale(1.12); } }
  .flash { animation: flash .2s steps(2, jump-none) infinite; }
  @keyframes flash { 50% { opacity: 0; } }
  /* over the 3D stage too (it sits at z-index 3) */
  .empty { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 4; display: flex; align-items: center; gap: .7rem; flex-wrap: wrap; justify-content: center;
    background: #0f141bee; border: 1px solid var(--line); border-radius: var(--radius); padding: .7rem 1rem; box-shadow: var(--shadow); color: var(--muted); max-width: 90%; }
  .empty.compact { padding: .4rem .6rem; font-size: .85rem; gap: .5rem; }
  /* (over the 3D stage: at the bottom, clear of its toolbar's panels at the top) */
  .empty.low { top: auto; bottom: 1rem; transform: translateX(-50%); }
  .snapguide { stroke: var(--cyan); stroke-dasharray: 4 3; opacity: .8; pointer-events: none; }
  svg:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
</style>
