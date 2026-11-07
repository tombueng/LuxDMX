<script lang="ts">
  // A LED ring, disc or matrix of your own: how many LEDs where, and which way the data runs through
  // them, with a picture to compare against the real thing (a dot walks the LEDs in data order).
  import Modal from './Modal.svelte';
  import { clock } from './clock.svelte';
  import { app, newId } from '../app.svelte';
  import { pixelShape } from '../model/library';
  import { layoutCells, MAX_PIXELS, placesFor, ringsFor } from '../model/pixelLayout';
  import type { PixelLayout } from '../model/types';

  let { onclose, onsaved }: { onclose: () => void; onsaved: (id: string) => void } = $props();

  let kind = $state<'rings' | 'matrix'>('rings');
  let ringText = $state('60, 48, 40, 32, 24, 16, 12, 8, 1');
  let ccw = $state(false), turn = $state(0);
  let total = $state(144), ringCount = $state(9);
  let cols = $state(16), rows = $state(16), zigzag = $state(true), vertical = $state(false);
  let from = $state<'tl' | 'tr' | 'bl' | 'br'>('tl');
  let white = $state(false);
  let named = $state('');

  const rings = $derived(ringText.split(/[^0-9]+/).filter(Boolean).map(Number));
  const layout = $derived.by((): PixelLayout | null => {
    if (kind === 'rings') {
      if (!rings.length || rings.some((r) => r < 1)) return null;
      return { kind: 'rings', rings: [...rings], ...(ccw ? { ccw } : {}), ...(turn ? { turn } : {}) };
    }
    if (!(cols >= 1 && rows >= 1) || !Number.isInteger(cols) || !Number.isInteger(rows)) return null;
    return { kind: 'matrix', cols, rows, ...(zigzag ? { zigzag } : {}), ...(vertical ? { vertical } : {}), ...(from !== 'tl' ? { from } : {}) };
  });
  const count = $derived(layout ? layoutCells(layout) : 0);
  const err = $derived(!layout ? (kind === 'rings' ? 'Say how many LEDs each ring has, like 24, 16, 12, 8, 1.' : 'Give it columns and rows.')
    : count > MAX_PIXELS ? `That's ${count} LEDs: ${MAX_PIXELS} is the most one light can have.` : '');
  const auto = $derived(kind === 'rings' ? (rings.length > 1 ? `LED disc, ${count} pixels on ${rings.length} rings` : `LED ring, ${count} pixels`) : `LED matrix, ${cols} x ${rows}`);
  const width = $derived(count * (white ? 4 : 3));
  const universes = $derived(width > 512 ? Math.ceil(count / (white ? 128 : 170)) : 1);

  function work() { ringText = ringsFor(Math.max(1, total | 0), Math.max(1, ringCount | 0)).join(', '); }
  function save() {
    if (!layout || err) return;
    const t = pixelShape(newId('user:'), named.trim() || auto, $state.snapshot(layout) as PixelLayout, white, 'user');
    t.manufacturer = 'My fixtures';
    app.saveType(t);
    onsaved(t.id);
    onclose();
  }

  // the picture: every LED where it is, the first of each ring or run white, a dot walking along
  let canvas = $state<HTMLCanvasElement>();
  const SIZE = 220;
  $effect(() => clock.use());
  $effect(() => {
    const t = clock.t, ctx = canvas?.getContext('2d');
    if (!ctx || !layout || err) return;
    const at = placesFor($state.snapshot(layout) as PixelLayout), dpr = window.devicePixelRatio || 1;
    if (canvas!.width !== SIZE * dpr) { canvas!.width = SIZE * dpr; canvas!.height = SIZE * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    const R = SIZE / 2 - 8, r = Math.max(1, at.dot * R), walk = Math.floor(t * 12) % at.n;
    for (let i = 0; i < at.n; i++) {
      ctx.fillStyle = i === walk ? '#ffaa1c' : at.first[i] ? '#ffffff' : `hsl(${Math.round(at.lane[i] / Math.max(1, at.lanes) * 300)} 70% 38%)`;
      ctx.beginPath(); ctx.arc(SIZE / 2 + at.x[i] * R, SIZE / 2 - at.y[i] * R, i === walk ? r * 1.5 : r, 0, Math.PI * 2); ctx.fill();
    }
  });
</script>

<Modal title="A LED ring or matrix" {onclose} wide>
  <div class="grid">
    <div class="form">
      <div class="seg" role="radiogroup" aria-label="Shape">
        <button role="radio" aria-checked={kind === 'rings'} class:on={kind === 'rings'} onclick={() => (kind = 'rings')}>Ring or disc</button>
        <button role="radio" aria-checked={kind === 'matrix'} class:on={kind === 'matrix'} onclick={() => (kind = 'matrix')}>Matrix</button>
      </div>
      {#if kind === 'rings'}
        <label>LEDs per ring, in the order the data runs through them
          <input bind:value={ringText} aria-label="LEDs per ring" /></label>
        <div class="row">
          <label>Only know the total? <input type="number" min="1" max={MAX_PIXELS} bind:value={total} aria-label="LEDs in all" /></label>
          <label>on rings <input type="number" min="1" max="30" bind:value={ringCount} aria-label="How many rings" /></label>
          <button class="ghost" onclick={work}>Work it out</button>
        </div>
        <p class="faint">Starts at the middle? Write the rings the other way round: 1, 8, 12...</p>
        <label class="check"><input type="checkbox" bind:checked={ccw} /> runs counter-clockwise</label>
        <label>Turned by (degrees) <input type="number" step="15" bind:value={turn} aria-label="Turned by" /></label>
      {:else}
        <div class="row">
          <label>Columns <input type="number" min="1" max="512" bind:value={cols} aria-label="Columns" /></label>
          <label>Rows <input type="number" min="1" max="512" bind:value={rows} aria-label="Rows" /></label>
        </div>
        <label>The data starts
          <select bind:value={from} aria-label="The data starts">
            <option value="tl">top left</option><option value="tr">top right</option><option value="bl">bottom left</option><option value="br">bottom right</option>
          </select></label>
        <label>And runs
          <select value={vertical ? 'cols' : 'rows'} aria-label="And runs" onchange={(e) => (vertical = (e.target as HTMLSelectElement).value === 'cols')}>
            <option value="rows">along the rows</option><option value="cols">along the columns</option>
          </select></label>
        <label class="check"><input type="checkbox" bind:checked={zigzag} /> zigzag: every second line runs back (most flexible panels)</label>
      {/if}
      <label class="check"><input type="checkbox" bind:checked={white} /> has a white LED too (RGBW, SK6812)</label>
      <label>Name <input bind:value={named} placeholder={auto} aria-label="Name" /></label>
      {#if err}<p class="err" role="status">{err}</p>{/if}
      <p class="faint">{count} pixels, {width} channels{universes > 1 ? `, ${universes} universes` : ''}.</p>
      <div class="row end"><button class="ghost" onclick={onclose}>Cancel</button><button class="primary" onclick={save} disabled={!!err}>Save</button></div>
    </div>
    <div class="pic">
      <canvas bind:this={canvas} style="width:{SIZE}px;height:{SIZE}px" aria-label="The LEDs, with a dot walking them in data order"></canvas>
      <p class="faint">Compare it with the real one: the orange dot walks the LEDs in data order. Once it's patched, the Wiring test effect does the same on the LEDs.</p>
    </div>
  </div>
</Modal>

<style>
  .grid { display: grid; grid-template-columns: 1fr 240px; gap: 1rem; }
  .form { display: flex; flex-direction: column; gap: .55rem; min-width: 0; }
  .form > label:not(.check) { display: flex; flex-direction: column; gap: .15rem; }
  .row { display: flex; gap: .5rem; align-items: flex-end; flex-wrap: wrap; }
  .row label { display: flex; flex-direction: column; gap: .15rem; }
  .row input { width: 6.5rem; }
  .end { justify-content: flex-end; }
  .check { display: flex; gap: .4rem; align-items: center; }
  .seg { display: flex; gap: 2px; }
  .seg button { flex: 1; }
  .pic { display: flex; flex-direction: column; gap: .4rem; }
  canvas { background: #0b0f15; border-radius: 8px; }
  p { margin: 0; }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } .pic { order: -1; align-items: center; } }
</style>
