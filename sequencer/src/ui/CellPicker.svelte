<script lang="ts">
  // Single cells of the selected lights (a pixel bar's, a ring's, each LED of a pixel head), like a
  // console's sub-fixtures: pick some, and the brightness and colour in the programmer go to just
  // them, and are recorded that way. Nothing picked: the whole light, as always. Drawn on a canvas
  // (a 64 x 64 matrix is 4096 LEDs): click a cell, drag across cells, drag a box from outside them,
  // type a range, or step through them one at a time with Next, the way desks do.
  import { app } from '../app.svelte';
  import { placesOfLight } from '../model/pixelLayout';
  import { cellLookAt } from '../engine/resolve';
  import { cellsText, parseCells } from '../model/cellPick';

  const sel = $derived(app.show.fixtures.filter((f) => app.selected.includes(f.id) && app.caps(f.id).cells > 1));
  const ref = $derived(sel[0]);
  const n = $derived(ref ? app.caps(ref.id).cells : 0);
  const at = $derived(ref ? placesOfLight(ref, app.modeOf(ref.id)) : undefined);
  // the lights the picks go to (same shape as the first) and the ones left alone
  const shape = $derived(ref ? app.cellShape(ref.id) : '');
  const same = $derived(sel.filter((f) => app.cellShape(f.id) === shape));
  const other = $derived(sel.filter((f) => app.cellShape(f.id) !== shape));
  // selected lights without cells (a PAR next to the bars): left alone while cells are picked
  const plain = $derived(app.show.fixtures.filter((f) => app.selected.includes(f.id) && app.caps(f.id).cells <= 1));
  // where each cell is drawn (x right, y down, about -1..1): its place on the shape, or, for a bar
  // with no shape, in data order in rows
  const pos = $derived.by(() => {
    if (at && at.n === n) return { x: Array.from(at.x), y: Array.from(at.y, (v) => -v), r: at.dot, grid: !at.round && at.gw > 1 && at.gh > 1 };
    const cols = n <= 32 ? n : Math.ceil(Math.sqrt(n * 2)), rows = Math.ceil(n / cols);
    const step = 2 / Math.max(cols, rows);
    const x: number[] = [], y: number[] = [];
    for (let k = 0; k < n; k++) { x.push(-1 + step * ((k % cols) + 0.5)); y.push(-((rows * step) / 2) + step * (Math.floor(k / cols) + 0.5)); }
    return { x, y, r: step * 0.38, grid: false };
  });
  const bounds = $derived.by(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < n; k++) { x0 = Math.min(x0, pos.x[k]); x1 = Math.max(x1, pos.x[k]); y0 = Math.min(y0, pos.y[k]); y1 = Math.max(y1, pos.y[k]); }
    const m = pos.r * 2.2;
    return n ? { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m } : { x: -1, y: -1, w: 2, h: 2 };
  });
  const order = $derived(ref ? app.cellsPicked(ref.id) : []);
  const picked = $derived(new Set(order));
  // cells the programmer holds something for (outlined: "Let go" frees them)
  const held = $derived(new Set(Object.keys((ref && app.programmer[ref.id]?.cells) || {}).map(Number)));

  const all = $derived(Array.from({ length: n }, (_, k) => k));
  const pick = (ks: number[], keepOrder = false) => app.selectCells(ks.length ? (keepOrder ? ks : [...ks].sort((a, b) => a - b)) : null);
  // quick picks the shape offers: rings (rim first), a matrix's border and checkerboard
  const rings = $derived.by(() => {
    if (!at || at.n !== n || !at.round || at.lanes < 2) return [];
    const out: { lane: number; cells: number[] }[] = [];
    for (let lane = at.lanes - 1; lane >= 0; lane--) out.push({ lane, cells: all.filter((k) => at!.lane[k] === lane) });
    return out.filter((r) => r.cells.length);
  });
  const border = $derived(pos.grid && at && at.gw > 2 && at.gh > 2 ? all.filter((k) => at!.gx[k] === 0 || at!.gy[k] === 0 || at!.gx[k] === at!.gw - 1 || at!.gy[k] === at!.gh - 1) : []);
  const checker = $derived(pos.grid && at ? all.filter((k) => (at!.gx[k] + at!.gy[k]) % 2 === 0) : []);
  const half = (side: 'l' | 'r' | 't' | 'b') => all.filter((k) => (side === 'l' ? pos.x[k] < -1e-6 : side === 'r' ? pos.x[k] > 1e-6 : side === 't' ? pos.y[k] < -1e-6 : pos.y[k] > 1e-6));
  const isSame = (ks: number[]) => ks.length === picked.size && ks.every((k) => picked.has(k));
  // one cell at a time, like a desk's Next: the one after the last picked (round the end)
  function step(d: 1 | -1) {
    const last = order.length ? order[order.length - 1] : d > 0 ? -1 : 0;
    pick([((last + d) % n + n) % n]);
  }

  // ---- typed: "1-16, 20, 30-40/2"
  let typed = $state(''), typedBad = $state(''), typing = $state(false), shownText = '';
  $effect(() => { const t = cellsText(order); if (!typing) { typed = t; shownText = t; } });
  function typedPick() {
    typing = false;
    if (typed === shownText) return;            // (not changed: a blur after Enter does nothing)
    shownText = typed;
    const r = parseCells(typed, n);
    // (a number past the end is said: "70" on a 61-cell light picks nothing)
    const past = Math.max(0, ...(typed.match(/\d+/g) ?? []).map(Number)) > n;
    typedBad = r.bad.length ? `Can't read "${r.bad.join(', ')}": try 1 thru 16, 20, 30-40/2` : past ? `This light has ${n} cells (1 to ${n})` : '';
    if (!r.bad.length) pick(r.cells, true);
  }

  // ---- the picture
  let canvas = $state<HTMLCanvasElement>();
  // (a big matrix's cells are a few pixels each: zoomed in, the picture scrolls, a tap picks one)
  let boxW = $state(300), zoom = $state(1);
  const cssW = $derived(boxW * zoom);
  const cssH = $derived(Math.min(220, Math.max(60, (boxW * bounds.h) / bounds.w)) * zoom);
  const tiny = $derived(pos.r * Math.min(boxW / bounds.w, Math.min(220, Math.max(60, (boxW * bounds.h) / bounds.w)) / bounds.h) < 5);
  $effect(() => { void ref?.id; zoom = 1; });
  const scale = $derived(Math.min(cssW / bounds.w, cssH / bounds.h));
  const ox = $derived((cssW - bounds.w * scale) / 2 - bounds.x * scale), oy = $derived((cssH - bounds.h * scale) / 2 - bounds.y * scale);
  // (for the e2e tests in development: where cell k is on the canvas, in CSS pixels)
  $effect(() => { if (import.meta.env.DEV && canvas) (canvas as HTMLCanvasElement & { cellXY?: (k: number) => { x: number; y: number } }).cellXY = (k) => ({ x: ox + pos.x[k] * scale, y: oy + pos.y[k] * scale }); });
  let cursor = $state(-1);
  let takeOut = $state(false);                     // (a finger has no Alt: this makes a drag take out)
  // (said for a screen reader as the ring moves)
  const cursorSaid = $derived(cursor >= 0 && cursor < n ? `Cell ${cursor + 1}${picked.has(cursor) ? ', picked' : ''}` : '');
  let box = $state<{ x0: number; y0: number; x1: number; y1: number; remove: boolean } | null>(null);
  $effect(() => {
    const c = canvas;
    if (!c || !n || cssW < 10) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0b0f15'; g.fillRect(0, 0, cssW, cssH);
    const s = app.stage[ref?.id ?? ''], R = Math.max(1.2, pos.r * scale);
    for (let k = 0; k < n; k++) {
      const x = ox + pos.x[k] * scale, y = oy + pos.y[k] * scale;
      const l = cellLookAt(s, k, n), col = l?.color ?? s?.color ?? { r: 1, g: 1, b: 1 };
      const lv = Math.max(0.12, Math.min(1, l?.intensity ?? 0));
      g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2);
      g.fillStyle = `rgb(${Math.round(col.r * lv * 255)},${Math.round(col.g * lv * 255)},${Math.round(col.b * lv * 255)})`; g.fill();
      if (picked.has(k)) { g.lineWidth = Math.max(1.5, R * 0.45); g.strokeStyle = '#ffaa1c'; g.stroke(); }
      else if (held.has(k)) { g.setLineDash([2, 2]); g.lineWidth = 1; g.strokeStyle = '#ffffff88'; g.stroke(); g.setLineDash([]); }
      if (k === cursor) { g.beginPath(); g.arc(x, y, R + 3, 0, Math.PI * 2); g.lineWidth = 1.5; g.strokeStyle = '#6aa2ff'; g.stroke(); }
    }
    if (box) {
      const x = Math.min(box.x0, box.x1), y = Math.min(box.y0, box.y1), w = Math.abs(box.x1 - box.x0), h = Math.abs(box.y1 - box.y0);
      g.fillStyle = box.remove ? '#ff6b9a22' : '#ffaa1c22'; g.fillRect(x, y, w, h); g.strokeStyle = box.remove ? '#ff6b9a' : '#ffaa1c'; g.lineWidth = 1; g.strokeRect(x, y, w, h);
    }
  });

  // which cell is under a point (the nearest within its dot, a little more for tiny ones)
  function cellAt(px: number, py: number): number {
    const R = Math.max(1.2, pos.r * scale), reach = Math.max(R * 1.25, 4);
    let best = -1, bd = reach * reach;
    for (let k = 0; k < n; k++) { const dx = ox + pos.x[k] * scale - px, dy = oy + pos.y[k] * scale - py, d = dx * dx + dy * dy; if (d <= bd) { bd = d; best = k; } }
    return best;
  }
  const local = (e: PointerEvent) => { const r = canvas!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  let paint: boolean | null = null;
  function apply(k: number) {
    if (k < 0 || paint === null || picked.has(k) === paint) return;
    const s = new Set(picked);
    if (paint) s.add(k); else s.delete(k);
    pick([...s]);
  }
  $effect(() => { void ref?.id; cursor = -1; });   // (another light: the keyboard ring starts again)
  function down(e: PointerEvent) {
    if (e.button !== 0) return;                    // (the left button, a finger, a pen)
    const p = local(e), k = cellAt(p.x, p.y);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (k >= 0) { paint = takeOut ? false : !picked.has(k); cursor = k; apply(k); }
    else box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, remove: e.altKey || takeOut };
  }
  function move(e: PointerEvent) {
    if (!(e.buttons & 1)) return;
    const p = local(e);
    if (box) { box = { ...box, x1: p.x, y1: p.y }; return; }
    if (paint !== null) apply(cellAt(p.x, p.y));
  }
  function up() {
    if (box) {
      const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1), y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
      if (x1 - x0 > 3 || y1 - y0 > 3) {
        const s = new Set(picked);
        for (let k = 0; k < n; k++) { const x = ox + pos.x[k] * scale, y = oy + pos.y[k] * scale; if (x >= x0 && x <= x1 && y >= y0 && y <= y1) { if (box.remove) s.delete(k); else s.add(k); } }
        pick([...s]);
      }
      box = null;
    }
    paint = null;
  }
  // the keyboard: arrows move the blue ring (to the nearest cell that way), Space or Enter picks
  function key(e: KeyboardEvent) {
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
    if (d) {
      e.preventDefault();
      if (cursor < 0 || cursor >= n) { cursor = order[0] ?? 0; return; }
      let best = cursor, bd = Infinity;
      for (let k = 0; k < n; k++) {
        const dx = pos.x[k] - pos.x[cursor], dy = pos.y[k] - pos.y[cursor], along = dx * d[0] + dy * d[1];
        if (along <= 1e-6) continue;
        const dist = along + 3 * Math.abs(dx * d[1] - dy * d[0]);
        if (dist < bd) { bd = dist; best = k; }
      }
      cursor = best;
    } else if ((e.key === ' ' || e.key === 'Enter') && cursor >= 0) {
      e.preventDefault();
      const s = new Set(picked);
      if (s.has(cursor)) s.delete(cursor); else s.add(cursor);
      pick([...s]);
    }
  }
</script>

{#if ref}
  <section id="pg-cells" class="cells" aria-label="Cells" data-marks="show">
    <div class="lab">
      <span>Cells</span>
      <span class="faint" aria-live="polite">{picked.size ? `${picked.size} of ${n} picked${same.length > 1 ? `, on ${same.length} lights` : ''}` : `whole light${sel.length > 1 ? 's' : ''}, ${n} cells`}</span>
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (a picture of cells: arrows and Space pick with the keyboard, the typed range and the buttons do the rest) -->
    <div class="pic" class:zoomed={zoom > 1} bind:clientWidth={boxW} tabindex="0" role="application" data-own-space
         aria-label="The cells of {ref.name}: click or drag across them to pick, drag a box from outside them, arrows and Space with the keyboard"
         onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key}>
      <canvas bind:this={canvas} style="width:{cssW}px;height:{cssH}px" data-cells={n}></canvas>
      <span class="sr-only" aria-live="polite">{cursorSaid}</span>
    </div>
    <p class="faint hint">Drag across cells, or a box from outside them. On the plan, Alt-click a pixel picks it.
      <button class="ghost link" class:on={takeOut} aria-pressed={takeOut} onclick={() => (takeOut = !takeOut)} title="Dragging takes cells out instead of adding them (Alt does the same with a mouse)">{takeOut ? 'Taking out' : 'Take out'}</button>
      {#if tiny || zoom > 1}<button class="ghost link" onclick={() => (zoom = zoom >= 4 ? 1 : zoom * 2)} title="Bigger cells: the picture scrolls, a tap picks one" aria-label="Zoom the cells, now {zoom} times">Zoom {zoom}×</button>{/if}</p>
    <div class="typed">
      <input id="cell-range" bind:value={typed} placeholder="1 thru 16, 20" aria-label="Cells to pick"
             onfocus={() => (typing = true)} onkeydown={(e) => { if (e.key === 'Enter') typedPick(); }} onblur={typedPick} />
      <button class="sm" onclick={() => step(-1)} title="The cell before (one at a time)" aria-label="Previous cell">◀</button>
      <button class="sm" onclick={() => step(1)} title="The next cell (one at a time, like a desk's Next)" aria-label="Next cell">▶</button>
    </div>
    {#if typedBad}<p class="err">{typedBad}</p>{/if}
    <div class="quick wrap" aria-label="Pick cells">
      <button class:on={!picked.size} onclick={() => pick([])} title="Brightness and colour go to the whole light">Whole light</button>
      <button class:on={picked.size === n} onclick={() => pick(all)} title="Every cell, one by one: a rainbow spreads across them">Each cell</button>
      <button class:on={isSame(all.filter((k) => k % 2 === 0))} onclick={() => pick(all.filter((k) => k % 2 === 0))} title="Cells 1, 3, 5 …">Odd</button>
      <button class:on={isSame(all.filter((k) => k % 2 === 1))} onclick={() => pick(all.filter((k) => k % 2 === 1))} title="Cells 2, 4, 6 …">Even</button>
      <button class:on={isSame(all.filter((k) => k % 3 === 0))} onclick={() => pick(all.filter((k) => k % 3 === 0))} title="Cells 1, 4, 7 …">Every 3rd</button>
      <button onclick={() => pick(all.filter((k) => !picked.has(k)))} disabled={!picked.size} title="The cells that aren't picked instead">Invert</button>
      <button class:on={isSame(half('l'))} onclick={() => pick(half('l'))} title="The left half">Left</button>
      <button class:on={isSame(half('r'))} onclick={() => pick(half('r'))} title="The right half">Right</button>
      {#if at || n > 32}
        <button class:on={isSame(half('t'))} onclick={() => pick(half('t'))} title="The top half">Top</button>
        <button class:on={isSame(half('b'))} onclick={() => pick(half('b'))} title="The bottom half">Bottom</button>
      {/if}
      {#if border.length}<button class:on={isSame(border)} onclick={() => pick(border)} title="The cells round the edge">Border</button>{/if}
      {#if checker.length}<button class:on={isSame(checker)} onclick={() => pick(checker)} title="Every other cell, like a chessboard">Checker</button>{/if}
    </div>
    {#if rings.length}
      <div class="quick wrap rings" aria-label="Pick a ring">
        {#each rings as r, i (r.lane)}
          <button class:on={isSame(r.cells)} onclick={() => pick(r.cells)} title="{i === 0 ? 'The rim' : r.lane === 0 ? 'The middle' : `Ring ${i + 1} from the rim`}: {r.cells.length} LED{r.cells.length > 1 ? 's' : ''}">{i === 0 ? 'Rim' : r.lane === 0 && r.cells.length === 1 ? 'Centre' : `Ring ${i + 1}`}</button>
        {/each}
      </div>
    {/if}
    {#if picked.size}
      <p class="faint note">Brightness and colour below go to the picked cells, and Record keeps them that way.{#if other.length + plain.length} {[...other, ...plain].map((f) => f.name).slice(0, 3).join(', ')}{other.length + plain.length > 3 ? ` and ${other.length + plain.length - 3} more` : ''} ({other.length && plain.length ? 'another shape, no cells' : other.length ? 'another shape' : 'no cells'}) {other.length + plain.length > 1 ? 'are' : 'is'} left alone.{/if}
        {#if held.size}<button class="ghost link" onclick={() => app.releaseCells()} title="The picked cells show the light again (what the programmer set for them goes)">Let go of these cells</button>{/if}</p>
    {/if}
  </section>
{/if}

<style>
  .cells { display: flex; flex-direction: column; gap: .3rem; scroll-margin-top: 3rem; }
  .lab { display: flex; justify-content: space-between; align-items: center; font-size: .86rem; }
  .pic { width: 100%; }
  /* (zoomed: it scrolls, so a finger drag moves the picture and a tap picks) */
  .pic.zoomed { overflow: auto; max-height: 280px; touch-action: pan-x pan-y; }
  .pic { touch-action: none; cursor: pointer; border-radius: 8px; }
  .pic:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .hint { margin: .15rem 0 0; font-size: .78rem; }
  .hint button.on { color: var(--pink); }
  canvas { display: block; border-radius: 8px; }
  .typed { display: flex; gap: .25rem; }
  .typed input { flex: 1; min-width: 0; font-size: .82rem; }
  .typed .sm { padding: .1rem .5rem; }
  .quick { display: flex; gap: .25rem; flex-wrap: wrap; }
  .quick button { flex: 1 0 18%; padding: .2rem .2rem; font-size: .78rem; }
  .quick button.on { border-color: var(--accent); color: var(--accent); }
  .note { margin: 0; font-size: .78rem; }
  .err { margin: 0; font-size: .78rem; color: var(--pink); }
  .link { padding: 0 .2rem; font-size: .78rem; }
</style>
