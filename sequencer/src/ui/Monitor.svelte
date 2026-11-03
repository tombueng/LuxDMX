<script lang="ts">
  // DMX output: every channel of a universe as it goes out, live. For "why doesn't my PAR light
  // up?": you see whether its channels get anything, and which fixture sits where. Hover a channel
  // for its fixture and function, click it to select that fixture.
  import Modal from './Modal.svelte';
  import { app } from '../app.svelte';
  import { tablist, ui } from './ui.svelte';
  import { untrack } from 'svelte';

  let { onclose }: { onclose: () => void } = $props();
  let canvas = $state<HTMLCanvasElement>();
  let box = $state<HTMLElement>();
  let width = $state(0);                    // 0 until measured: nothing is drawn at a guessed size
  let pct = $state(false);
  let hover = $state(-1);

  const unis = $derived([...new Set([...app.show.fixtures.map((f) => f.universe), ...app.frames.keys()])].sort((a, b) => a - b));
  let uni = $state(untrack(() => unis.includes(ui.monitorUni) ? ui.monitorUni : unis[0] ?? 0));
  const cols = $derived(width >= 700 ? 32 : width >= 420 ? 16 : 8);
  const rows = $derived(512 / cols);
  const cell = $derived(Math.floor(width / cols));

  // Who owns each channel of this universe: [fixture index, channel index], or two owners = clash.
  const owners = $derived.by(() => {
    const own: ({ f: number; c: number; clash: boolean } | null)[] = new Array(512).fill(null);
    app.show.fixtures.forEach((f, fi) => {
      if (f.universe !== uni) return;
      const n = app.modeOf(f.id)?.channels.length ?? 1;
      for (let c = 0; c < n; c++) {
        const a = f.address - 1 + c;
        if (a < 0 || a > 511) continue;
        own[a] = own[a] ? { ...own[a]!, clash: true } : { f: fi, c, clash: false };
      }
    });
    return own;
  });
  const used = $derived(owners.filter(Boolean).length);
  let lastOwners: typeof owners | null = null;
  const ownersChanged = () => { const c = owners !== lastOwners; lastOwners = owners; return c; };

  $effect(() => {
    if (!box) return;
    width = box.clientWidth;
    // rounded to whole cells, and only on a real change (no resize loops with the scrollbar)
    const ro = new ResizeObserver(() => { const w = box!.clientWidth; if (Math.abs(w - width) > 8) width = w; });
    ro.observe(box);
    return () => ro.disconnect();
  });

  // Drawn when something on it changes: the bytes of this universe (frames arrive 40 times a
  // second, a still look sends the same bytes), the channel under the pointer, the layout.
  let shown = new Uint8Array(512), drawnKey = '';
  $effect(() => {
    const ctx = canvas?.getContext('2d');
    if (!ctx || !width) return;
    const data = app.frames.get(uni) ?? new Uint8Array(512);
    const key = `${uni}|${pct}|${hover}|${cols}|${cell}`;
    if (key === drawnKey && data.every((v, i) => v === shown[i]) && !ownersChanged()) return;
    drawnKey = key; shown = data.slice();
    const dpr = window.devicePixelRatio || 1, w = cols * cell, h = rows * cell;
    if (canvas!.width !== w * dpr || canvas!.height !== h * dpr) { canvas!.width = w * dpr; canvas!.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Two passes, so the fonts are set twice per frame, not twice per cell: the cells with their
    // channel numbers small in the corner, then the values big in the middle (nothing for 0), so a
    // "91" can never be mistaken for channel 91. Dark text on bright cells, light on dark.
    ctx.font = `${Math.max(7, Math.round(cell * 0.24))}px ui-monospace, monospace`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    for (let i = 0; i < 512; i++) {
      const x = (i % cols) * cell, y = Math.floor(i / cols) * cell, v = data?.[i] ?? 0, o = owners[i];
      // a patched channel sits on a band in its fixture's tint; free ones stay dark
      ctx.fillStyle = o?.clash ? '#5a1d2a' : o ? (o.f % 2 ? '#1d2834' : '#212b23') : '#11161d';
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      if (v) { ctx.fillStyle = `rgba(255,170,28,${0.12 + 0.6 * v / 255})`; ctx.fillRect(x + 1, y + 1 + (cell - 2) * (1 - v / 255), cell - 2, (cell - 2) * v / 255); }
      if (o && o.c === 0) { ctx.fillStyle = '#6aa2ff'; ctx.fillRect(x + 1, y + 1, 2, cell - 2); }   // a fixture starts here
      if (i === hover) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3); }
      ctx.fillStyle = v > 150 ? '#1a100099' : o ? '#6b7686' : '#3a4350';
      ctx.fillText(String(i + 1), x + 3, y + 3);
    }
    ctx.font = `600 ${Math.max(9, Math.round(cell * 0.36))}px ui-monospace, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < 512; i++) {
      const v = data?.[i] ?? 0;
      if (!v) continue;
      ctx.fillStyle = v > 150 ? '#1a1000' : '#fff';
      ctx.fillText(String(pct ? Math.round(v / 2.55) : v), (i % cols) * cell + cell / 2, Math.floor(i / cols) * cell + cell * 0.6);
    }
  });

  function at(e: PointerEvent) {
    const r = canvas!.getBoundingClientRect();
    const c = Math.floor((e.clientX - r.left) / cell), rr = Math.floor((e.clientY - r.top) / cell);
    return c >= 0 && c < cols && rr >= 0 && rr < rows ? rr * cols + c : -1;
  }
  const info = $derived.by(() => {
    if (hover < 0) return '';
    const o = owners[hover], v = app.frames.get(uni)?.[hover] ?? 0;
    const head = `Channel ${hover + 1}: ${v} (${Math.round(v / 2.55)}%)`;
    if (!o) return `${head}, nothing patched here`;
    const f = app.show.fixtures[o.f];
    return `${head}, ${f.name} · ${app.modeOf(f.id)?.channels[o.c]?.name ?? `channel ${o.c + 1}`}${o.clash ? ', and another fixture too!' : ''}`;
  });
  // For screen readers: the channel and whose it is, without the value that changes 40 times a second.
  let said = $state('');
  const what = (i: number) => {
    const o = owners[i];
    if (!o) return `Channel ${i + 1}, nothing patched`;
    const f = app.show.fixtures[o.f];
    return `Channel ${i + 1}, ${f.name}, ${app.modeOf(f.id)?.channels[o.c]?.name ?? `channel ${o.c + 1}`}`;
  };
  function pick() {
    const o = owners[hover];
    if (o) app.selected = [app.show.fixtures[o.f].id];
  }
  // Arrow keys move the highlighted channel, Enter selects its fixture.
  function key(e: KeyboardEvent) {
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (d) {
      e.preventDefault();
      hover = hover < 0 ? 0 : Math.max(0, Math.min(511, hover + d));   // the first press lands on channel 1
      said = what(hover);                                               // read out once per move, not per frame
    }
    else if (e.key === 'Enter' && hover >= 0) { e.preventDefault(); pick(); }
  }
</script>

<Modal title="DMX output" {onclose} wide>
  <div class="bar">
    {#if unis.length > 1}
      <div class="seg" role="tablist" aria-label="Universe" use:tablist>
        {#each unis as u (u)}<button role="tab" aria-selected={u === uni} class:on={u === uni} onclick={() => (uni = u)}>Universe {u}</button>{/each}
      </div>
    {:else}<span class="muted">Universe {uni}</span>{/if}
    <span class="muted">{used} of 512 channels patched</span>
    <div class="seg pct" role="group" aria-label="Values as">
      <button aria-pressed={!pct} class:on={!pct} onclick={() => (pct = false)}>0-255</button>
      <button aria-pressed={pct} class:on={pct} onclick={() => (pct = true)}>%</button>
    </div>
  </div>
  <div class="grid" bind:this={box}>
    <!-- One focusable surface: arrows move between channels, Enter selects the fixture. -->
    <button class="surface" aria-label="DMX values of universe {uni}. Arrow keys move, Enter selects the fixture." data-uni={uni}
      onpointermove={(e) => (hover = at(e))} onpointerleave={() => (hover = -1)} onclick={pick} onkeydown={key}>
      <canvas bind:this={canvas} style="width:{cols * cell}px;height:{rows * cell}px" aria-hidden="true"></canvas>
    </button>
  </div>
  <p class="info">{info || 'Hover a channel to see what it is; click to select its fixture. Blue marks where a fixture starts, red two fixtures on one channel.'}</p>
  <span class="sr" aria-live="polite">{said}</span>
</Modal>

<style>
  .bar { display: flex; align-items: center; gap: .8rem; flex-wrap: wrap; margin-bottom: .5rem; }
  .seg { display: flex; gap: .2rem; }
  .seg button { padding: .2rem .6rem; font-size: .82rem; }
  .seg button.on { background: var(--orange); color: #1a1000; border-color: var(--orange); }
  .pct { margin-left: auto; display: flex; gap: .3rem; align-items: center; font-size: .85rem; }
  .grid { width: 100%; }
  .surface { display: block; padding: 0; border: 0; background: none; border-radius: 6px; }
  canvas { display: block; border-radius: 6px; cursor: crosshair; touch-action: manipulation; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .info { min-height: 1.4em; margin: .5rem 0 0; font-size: .85rem; color: var(--muted); font-variant-numeric: tabular-nums; }
</style>
