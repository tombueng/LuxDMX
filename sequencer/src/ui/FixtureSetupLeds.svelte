<script lang="ts">
  // A ring's or a matrix's LEDs (the patch dialog's LEDs tab): a test picture that shows at a glance
  // whether the real one is turned or mirrored, buttons that turn and mirror it, the same picture on
  // the real LEDs, and a finder: the first, second and last LED light up red, green and blue, you
  // click where you see them, and the wiring follows. A light can have its own wiring (two of the
  // same panel hung differently). The sums: model/pixelLayout.ts.
  import { onDestroy, untrack } from 'svelte';
  import { app } from '../app.svelte';
  import { clock } from './clock.svelte';
  import { fitLayout, insideOut, layoutCells, layoutOfLight, layoutWords, mirrorLayout, placesFor, placesOfLight, testPicture, turnLayout, type Places } from '../model/pixelLayout';
  import { firstLit } from '../model/ledCurve';
  import type { PixelLayout, Values } from '../model/types';

  type Rgb = [number, number, number];
  let { id }: { id: string } = $props();
  const f = $derived(app.show.fixtures.find((x) => x.id === id));
  const m = $derived(app.modeOf(id));
  const layout = $derived(f ? layoutOfLight(f, m) : undefined);
  const at = $derived(layout ? placesFor(layout) : undefined);
  const fx = (x: string) => app.show.fixtures.find((g) => g.id === x);

  // ---- which lights: this one, or every light of its type and mode (each gets this one's wiring)
  const same = $derived(f ? app.show.fixtures.filter((x) => x.typeId === f.typeId && x.mode === f.mode).map((x) => x.id) : []);
  let scope = $state<'one' | 'type'>('one');
  const ids = $derived(scope === 'type' ? same : [id]);
  const owns = $derived(ids.some((x) => !!fx(x)?.layout));

  // the type's own wiring? (then the light doesn't keep a copy of it)
  function isTypes(l: PixelLayout) {
    const b = m?.layout;
    if (!b) return false;
    const p = placesFor(l), q = placesFor(b);
    if (p.n !== q.n) return false;
    for (let i = 0; i < p.n; i++) if (Math.abs(p.x[i] - q.x[i]) > 1e-4 || Math.abs(p.y[i] - q.y[i]) > 1e-4) return false;
    return true;
  }
  function set(l: PixelLayout) {
    if (!f) return;
    const plain = JSON.parse(JSON.stringify(l)) as PixelLayout;
    app.checkpoint();
    for (const x of ids) {
      const g = fx(x);
      if (!g) continue;
      if (isTypes(plain)) delete g.layout; else g.layout = JSON.parse(JSON.stringify(plain));
    }
    app.markDirty(0);
  }
  const now = () => $state.snapshot(layout) as PixelLayout;
  const turn = (deg: number) => layout && set(turnLayout(now(), deg));
  const mirror = (axis: 'x' | 'y') => layout && set(mirrorLayout(now(), axis));

  // ---- the picture: the test picture, or the data order (first red, second green, last blue, the
  // start of every ring or run white, an orange dot walking along)
  let view = $state<'test' | 'order'>('test');
  let finding = $state(false);
  let picks = $state<number[]>([]);
  let said = $state('');
  const ORDER = { first: [1, 0, 0] as Rgb, second: [0, 1, 0] as Rgb, last: [0, 0.35, 1] as Rgb };
  function orderPicture(p: Places, starts: boolean): Rgb[] {
    const out = Array.from({ length: p.n }, (_, i): Rgb => (starts && p.first[i] ? [0.3, 0.3, 0.3] : [0, 0, 0]));
    out[p.n - 1] = ORDER.last; if (p.n > 1) out[1] = ORDER.second; out[0] = ORDER.first;
    return out;
  }
  $effect(() => clock.use());
  const walk = $derived(at && view === 'order' && !finding ? Math.floor(clock.t * 12) % at.n : -1);
  const css = (c: Rgb) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;
  const DARK = '#1f2630';
  const shown = $derived.by((): string[] => {
    if (!at) return [];
    if (finding) return Array.from({ length: at.n }, (_, i) => { const k = picks.indexOf(i); return k < 0 ? '#3a4452' : css([ORDER.first, ORDER.second, ORDER.last][k]); });
    const pic = view === 'test' ? testPicture(at) : orderPicture(at, true);
    return pic.map((c) => (c[0] + c[1] + c[2] > 0 ? css(c) : DARK));
  });

  // ---- the finder: red, green and blue on the real one, you click them in the picture
  const STEP = ['red', 'green', 'blue'];
  function startFind() { finding = true; picks = []; said = ''; }
  function stopFind() { finding = false; picks = []; }
  function pick(i: number) {
    if (!finding || !layout || picks.includes(i)) return;
    picks = [...picks, i];
    if (picks.length < 3) return;
    const l = fitLayout(now(), picks[0], picks[1], picks[2]);
    finding = false;
    if (l) {
      set(l);
      view = 'test';
      said = `Found it: ${layoutWords(l).toLowerCase()}. The test picture on the real one should look like the one here now.`;
    } else said = 'No wiring puts those three there. Look again which LEDs are red, green and blue, and try once more.';
    picks = [];
  }
  function clicked(e: MouseEvent) {
    const el = (e.target as Element).closest('[data-led]');
    if (el) pick(Number(el.getAttribute('data-led')));
  }

  // ---- on the real LEDs: in the programmer (so Blind and Blackout apply as to anything you do),
  // channel by channel; let go again when it's switched off or the dialog closes
  let real = $state(false);
  const sending = $derived(real || finding);
  const before = new Map<string, Values | undefined>();
  function letGo(keep: string[] = []) {
    for (const [x, v] of [...before]) {
      if (keep.includes(x)) continue;
      if (v) app.programmer[x] = v; else delete app.programmer[x];
      before.delete(x);
    }
  }
  function valuesFor(gid: string, cols: Rgb[]): Values {
    const raw: Record<string, number> = {};
    app.modeOf(gid)?.channels.forEach((c, i) => {
      if (c.attr === 'intensity') { raw[i] = 255; return; }
      if (c.cell === undefined) return;
      const col = cols[c.cell] ?? [0, 0, 0];
      raw[i] = Math.round((c.attr === 'red' ? col[0] : c.attr === 'green' ? col[1] : c.attr === 'blue' ? col[2] : 0) * 255);
    });
    return { raw };
  }
  $effect(() => {
    if (!sending) { untrack(() => letGo()); return; }
    const to = finding ? [id] : ids;
    const want = to.map((x) => {
      const g = fx(x), p = g ? placesOfLight(g, app.modeOf(x)) : undefined;
      if (!p) return [x, undefined] as const;
      return [x, valuesFor(x, finding ? orderPicture(p, false) : view === 'test' ? testPicture(p) : orderPicture(p, true))] as const;
    });
    untrack(() => {
      letGo(want.map((w) => w[0]));
      for (const [x, v] of want) {
        if (!v) continue;
        if (!before.has(x)) before.set(x, app.programmer[x] ? $state.snapshot(app.programmer[x]) as Values : undefined);
        app.programmer[x] = { ...(before.get(x) ?? {}), ...v };
      }
    });
  });
  onDestroy(() => letGo());

  // ---- by hand
  const mx = $derived(layout?.kind === 'matrix' ? layout : undefined);
  const rg = $derived(layout?.kind === 'rings' ? layout : undefined);
  let cols = $state(0), rows = $state(0), ringText = $state('');
  let hand = $state(false);
  $effect(() => {
    if (!hand) return;
    const l = layout;
    untrack(() => {
      if (l?.kind === 'matrix') { cols = l.cols; rows = l.rows; }
      if (l?.kind === 'rings') ringText = l.rings.join(', ');
    });
  });
  const sizeErr = $derived.by(() => {
    if (!at) return '';
    if (mx) return cols * rows === at.n ? '' : `${cols} × ${rows} is ${cols * rows} LEDs, this one has ${at.n}.`;
    const r = ringText.split(/[^0-9]+/).filter(Boolean).map(Number), n = r.reduce((a, b) => a + b, 0);
    return n === at.n && r.every((x) => x > 0) ? '' : `Those rings have ${n} LEDs, this one has ${at.n}.`;
  });
  function useSize() {
    if (sizeErr || !layout) return;
    if (mx) set({ ...mx, cols, rows });
    else if (rg) set({ ...rg, rings: ringText.split(/[^0-9]+/).filter(Boolean).map(Number) });
  }
  const sel = (e: Event) => (e.target as HTMLSelectElement).value;
  const num = (e: Event) => (e.target as HTMLInputElement).valueAsNumber;

  // ---- how its LEDs light (model/ledCurve.ts): the box's port, or set here
  const led = $derived((void app.bridgeRev, app.ledOf(id)));
  const owned = $derived(ids.some((x) => !!fx(x)?.led));
  function setLed(k: 'bright' | 'gamma' | 'maxMa' | 'maPerCh' | 'idleMa', v: number, lo: number, hi: number) {
    if (!Number.isFinite(v)) return;
    const val = Math.max(lo, Math.min(hi, k === 'bright' || k === 'maxMa' ? Math.round(v) : Math.round(v * 100) / 100));
    app.checkpoint();
    for (const x of ids) { const g = fx(x); if (g) g.led = { ...(g.led ?? {}), [k]: val }; }
    app.markDirty(0);
  }
  function resetLed() { app.checkpoint(); for (const x of ids) { const g = fx(x); if (g) delete g.led; } app.markDirty(0); }
</script>

{#if f && ((at && layout) || led)}
<div class="leds" class:only={!at}>
  {#if at && layout}
  <div class="pic">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events (only the finder takes clicks; turning, mirroring and the wiring by hand are buttons and fields) -->
    <svg viewBox="-1.12 -1.12 2.24 2.24" role="img" aria-label={finding ? `The LEDs: click the ${STEP[picks.length]} one` : view === 'test' ? 'The test picture' : 'The LEDs in data order'}
         class:finding onclick={clicked} data-testid="led-picture">
      {#each shown as c, i (i)}
        <circle data-led={i} cx={at.x[i]} cy={-at.y[i]} r={i === walk ? at.dot * 1.5 : at.dot} fill={i === walk ? '#ffaa1c' : c} />
      {/each}
    </svg>
    <p class="faint small">Seen from the front, the side the LEDs shine to.</p>
    <div class="seg" role="radiogroup" aria-label="Picture">
      <button role="radio" aria-checked={view === 'test'} class:on={view === 'test'} onclick={() => (view = 'test')} disabled={finding}>Test picture</button>
      <button role="radio" aria-checked={view === 'order'} class:on={view === 'order'} onclick={() => (view = 'order')} disabled={finding}>Data order</button>
    </div>
    {#if view === 'test'}
      <p class="faint small">{at.round ? 'An arrow pointing up, red at the top of the rim, green on its right.' : 'An F the right way round, the corners red (top left), green (top right), blue (bottom left) and yellow.'}
        If the real one shows it turned or mirrored, use the buttons until it looks like this.</p>
    {:else}
      <p class="faint small">The first LED red, the second green, the last blue, the start of each {at.round ? 'ring' : 'run'} grey. The orange dot walks the LEDs in data order.</p>
    {/if}
  </div>
  {/if}

  <div class="ctl">
    {#if same.length > 1}
      <label class="inl">Set up <select value={scope} aria-label="Set up" onchange={(e) => (scope = sel(e) as 'one' | 'type')}>
        <option value="one">{f.name} only</option><option value="type">All {same.length} of this type</option></select></label>
    {/if}

    {#if at && layout}
    <section aria-labelledby="led-h">
      <h3 id="led-h">How it's wired</h3>
      <p class="words" data-testid="led-words">{layoutWords(layout)}{at.round ? '' : ` (${mx?.cols} × ${mx?.rows})`}.
        <span class="faint">{f.layout && f.layout === layout ? 'Its own, not its type\'s.' : 'As its type says.'}</span></p>
      <div class="seg" role="group" aria-label="Turn and mirror">
        <button onclick={() => turn(at.round ? -90 : 270)} title="Turn it a quarter to the left">↺ Turn</button>
        <button onclick={() => turn(90)} title="Turn it a quarter to the right">Turn ↻</button>
        <button onclick={() => mirror('x')} title="Mirror it left to right">Mirror ↔</button>
        <button onclick={() => mirror('y')} title="Mirror it top to bottom">Mirror ↕</button>
        {#if rg && rg.rings.length > 1}<button onclick={() => rg && set(insideOut($state.snapshot(rg) as Extract<PixelLayout, { kind: 'rings' }>))} title="The data starts in the middle instead of at the rim, or the other way round">Inside out</button>{/if}
      </div>
      {#if rg}
        <div class="seg" role="group" aria-label="Turn a little">
          <button onclick={() => turn(-360 / Math.max(...rg.rings))} title="One LED to the left">↺ 1 LED</button>
          <button onclick={() => turn(360 / Math.max(...rg.rings))} title="One LED to the right">1 LED ↻</button>
        </div>
      {/if}
      {#if owns}<button class="ghost link" onclick={() => m?.layout && set(m.layout)}>Back to the type's wiring</button>{/if}
    </section>

    <section aria-labelledby="led-real-h">
      <h3 id="led-real-h">On the real LEDs</h3>
      <label class="ck"><input type="checkbox" bind:checked={real} disabled={finding} /> Show the picture on the real {ids.length > 1 ? `${ids.length} lights` : 'one'} too</label>
      {#if sending && app.output === 'blind'}
        <p class="note" role="status">Blind: nothing new goes out, the lights keep their look.
          <button class="ghost link" onclick={() => app.askOnStage()}>Go on stage</button></p>
      {:else if real}
        <p class="faint small" role="status">Closing this (or switching it off) gives {ids.length > 1 ? 'them' : 'it'} back what {ids.length > 1 ? 'they' : 'it'} had.</p>
      {/if}
      {#if finding}
        <p class="step" role="status" data-testid="led-step">On the real one, LED {picks.length === 0 ? '1 is red' : picks.length === 1 ? '2 is green' : `${at.n} is blue`}.
          Click the LED in the picture that sits where you see the <b>{STEP[picks.length]}</b> one.</p>
        <button class="ghost" onclick={stopFind}>Stop</button>
      {:else}
        <button onclick={startFind} title="The first, second and last LED light up red, green and blue: you click where they are">Find the wiring on the real one…</button>
      {/if}
      {#if said}<p class="said" role="status" data-testid="led-said">{said}</p>{/if}
    </section>

    <details bind:open={hand}>
      <summary>Wiring by hand</summary>
      <div class="hand">
        {#if mx}
          <div class="line">
            <label>Columns <input type="number" min="1" max="512" bind:value={cols} aria-label="Columns" /></label>
            <label>Rows <input type="number" min="1" max="512" bind:value={rows} aria-label="Rows" /></label>
            <button onclick={useSize} disabled={!!sizeErr || (cols === mx.cols && rows === mx.rows)}>Use</button>
          </div>
          <label class="inl">The data starts
            <select value={mx.from ?? 'tl'} aria-label="The data starts" onchange={(e) => mx && set({ ...mx, from: sel(e) as 'tl' })}>
              <option value="tl">top left</option><option value="tr">top right</option><option value="bl">bottom left</option><option value="br">bottom right</option>
            </select></label>
          <label class="inl">and runs
            <select value={mx.vertical ? 'cols' : 'rows'} aria-label="And runs" onchange={(e) => mx && set({ ...mx, vertical: sel(e) === 'cols' })}>
              <option value="rows">along the rows</option><option value="cols">along the columns</option>
            </select></label>
          <label class="ck"><input type="checkbox" checked={!!mx.zigzag} onchange={(e) => mx && set({ ...mx, zigzag: (e.target as HTMLInputElement).checked })} /> zigzag: every second line runs back</label>
        {:else if rg}
          <div class="line">
            <label class="grow">LEDs per ring, in data order <input bind:value={ringText} aria-label="LEDs per ring" /></label>
            <button onclick={useSize} disabled={!!sizeErr || ringText.replace(/\s/g, '') === rg.rings.join(',')}>Use</button>
          </div>
          <label class="ck"><input type="checkbox" checked={!!rg.ccw} onchange={(e) => rg && set({ ...rg, ccw: (e.target as HTMLInputElement).checked })} /> runs counter-clockwise</label>
          <label class="inl">The first LED turned by <input type="number" step="1" min="-360" max="360" value={rg.turn ?? 0} aria-label="Turned by"
            onchange={(e) => { const v = (e.target as HTMLInputElement).valueAsNumber; if (rg && Number.isFinite(v)) set({ ...rg, turn: v }); }} /> ° from the top</label>
        {/if}
        {#if sizeErr}<p class="note small">{sizeErr}</p>{/if}
        <p class="faint small">{layoutCells(layout)} LEDs. The number of LEDs is the type's: for another count, pick or make another type.</p>
      </div>
    </details>
    {/if}

    {#if led}
      <section aria-labelledby="led-curve-h">
        <h3 id="led-curve-h">How the LEDs light</h3>
        <p class="small" data-testid="led-from">
          {#if led.from === 'box' && led.port}From {led.port.box}: its pixel port on universe {led.port.uni}, brightness {led.port.bright}, gamma {led.port.gamma / 100}{led.port.maxMa ? `, a ${led.port.maxMa} mA cap` : ', no power cap'}.
          {:else if led.from === 'own'}Set here{#if led.port}; {led.port.box} has brightness {led.port.bright}, gamma {led.port.gamma / 100}{led.port.maxMa ? `, a ${led.port.maxMa} mA cap` : ''}{/if}.
          {:else}As a LuxDMX pixel port comes. A box that plays it (same universe and start channel) says its own once it's connected through its bridge or through LuxDMX Link 1.4 or later; until then set its brightness here if it isn't 255.{/if}</p>
        <div class="curve">
          <label>Brightness <input type="number" min="0" max="255" step="1" aria-label="Brightness" value={led.curve.bright} onchange={(e) => setLed('bright', num(e), 0, 255)} /></label>
          <label>Gamma <input type="number" min="1" max="4" step="0.1" aria-label="Gamma" value={led.curve.gamma} onchange={(e) => setLed('gamma', num(e), 1, 4)} /></label>
          <label title="0: none">Power cap mA <input type="number" min="0" step="50" aria-label="Power cap" value={led.curve.maxMa ?? 0} onchange={(e) => setLed('maxMa', num(e), 0, 200000)} /></label>
          <label title="What one colour of one pixel draws at full">mA per colour <input type="number" min="0" max="200" step="1" aria-label="mA per colour" value={led.curve.maPerCh ?? 20} onchange={(e) => setLed('maPerCh', num(e), 0, 200)} /></label>
          <label title="What a dark pixel draws anyway">mA dark <input type="number" min="0" max="20" step="0.1" aria-label="mA per dark pixel" value={led.curve.idleMa ?? 1} onchange={(e) => setLed('idleMa', num(e), 0, 20)} /></label>
        </div>
        <p class="small" data-testid="led-cut">{firstLit(led.curve) > 255 ? 'At this brightness the LEDs stay dark.' : `Below DMX ${firstLit(led.curve)} a colour is off on the real LEDs, so the stage shows it dark too.`}{led.curve.maxMa ? ' Over the cap everything is dimmed together, here as on the box.' : ''}</p>
        {#if owned}<button class="ghost link" onclick={resetLed}>{led.port ? 'As the box has it' : 'Back to how a port comes'}</button>{/if}
      </section>
    {/if}
  </div>
</div>
{/if}

<style>
  .leds { display: grid; grid-template-columns: minmax(220px, 300px) minmax(260px, 1fr); gap: 1rem; align-items: start; }
  .leds.only { grid-template-columns: minmax(260px, 1fr); }
  .curve { display: grid; grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr)); gap: .4rem .6rem; width: 100%; }
  .curve label { display: flex; flex-direction: column; gap: .15rem; color: var(--muted); font-size: .8rem; }
  .curve input { width: 100%; min-width: 0; color: var(--text); }
  @media (max-width: 700px) { .leds { grid-template-columns: 1fr; } }
  .pic { display: flex; flex-direction: column; gap: .4rem; }
  svg { width: 100%; aspect-ratio: 1; background: #0b0f15; border-radius: 8px; }
  svg.finding { cursor: crosshair; outline: 2px solid var(--orange); }
  svg.finding circle:hover { stroke: #fff; stroke-width: .02; }
  .ctl { display: flex; flex-direction: column; gap: .8rem; min-width: 0; }
  section { display: flex; flex-direction: column; gap: .45rem; align-items: flex-start; }
  h3 { margin: 0; font-size: .82rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .seg { display: flex; gap: .25rem; flex-wrap: wrap; }
  .seg button { padding: .25rem .6rem; font-size: .85rem; }
  .seg button.on { background: var(--orange); color: #1a1000; border-color: var(--orange); }
  .words { margin: 0; }
  .ck { display: flex; align-items: center; gap: .4rem; color: var(--text); font-size: .88rem; }
  .inl { display: flex; align-items: center; gap: .4rem; color: var(--muted); font-size: .85rem; flex-wrap: wrap; }
  .inl select, .inl input { color: var(--text); }
  .inl input { width: 5em; }
  .line { display: flex; gap: .5rem; align-items: flex-end; flex-wrap: wrap; }
  .line label { display: flex; flex-direction: column; gap: .15rem; color: var(--muted); font-size: .85rem; }
  .line input { width: 6em; color: var(--text); }
  .line .grow { flex: 1; } .line .grow input { width: 100%; }
  .hand { display: flex; flex-direction: column; gap: .5rem; margin-top: .5rem; }
  summary { cursor: pointer; font-size: .88rem; color: var(--muted); }
  .small { margin: 0; font-size: .8rem; }
  .note { margin: 0; font-size: .85rem; color: var(--orange); }
  .step { margin: 0; font-size: .9rem; }
  .said { margin: 0; font-size: .88rem; color: var(--green); }
  .link { padding: 0; color: var(--accent); text-decoration: underline; font-size: .85rem; min-height: 0; min-width: 0; }
</style>
