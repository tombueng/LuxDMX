<script lang="ts">
  // Make or adjust a fixture type: the channel table from the manual, or found live with the wizard.
  import { untrack } from 'svelte';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import ChannelWizard from './ChannelWizard.svelte';
  import { app, newId, type CellMaps } from '../app.svelte';
  import { ATTR_GROUPS, ATTR_LABEL } from './attrs';
  import { CELL_PATTERNS, cellBlock, cellRuns, layoutProblem, nextCell, patternChannels, repeatRows, shapeFrom } from '../model/cellBlock';
  import { layoutCells, layoutWords } from '../model/pixelLayout';
  import type { Channel, FixtureType } from '../model/types';

  let { type, onclose, onsaved }: { type?: FixtureType; onclose: () => void; onsaved: (id: string, cellMaps?: CellMaps) => void } = $props();
  // where each cell of a mode went (runs taken out move the later ones down): the looks follow
  const moved = new WeakMap<object, Map<number, number | null>>();

  // Edit a copy. Built-in and library types become your own type when changed, so the original
  // stays what it was.
  const fresh = (): FixtureType => ({ id: newId('user:'), manufacturer: 'My fixtures', model: 'New fixture', source: 'user',
    modes: [{ name: 'Mode 1', channels: [] }] });
  // A copy, taken once when the editor opens.
  let t = $state<FixtureType>(untrack(() => {
    if (!type) return fresh();
    const c: FixtureType = JSON.parse(JSON.stringify(type));
    if (type.source !== 'user') { c.id = newId('user:'); c.source = 'user'; c.model = `${type.model} (edited)`; }
    return c;
  }));
  let mi = $state(0);
  const mode = $derived(t.modes[mi]);
  let openRanges = $state<number | null>(null);
  let wizard = $state(false);
  let err = $state('');

  // a channel still called "Channel 3" takes the name of what it does ("Red")
  function named(c: Channel) { if (/^Channel \d+$/.test(c.name) && c.attr !== 'raw') c.name = (ATTR_LABEL[c.attr] ?? c.name).split(' (')[0]; }
  function addChannel() { mode.channels.push({ name: `Channel ${mode.channels.length + 1}`, attr: 'raw' }); }
  function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= mode.channels.length) return;
    const c = mode.channels; [c[i], c[j]] = [c[j], c[i]];
  }
  function addMode() { t.modes.push({ name: `Mode ${t.modes.length + 1}`, channels: [] }); mi = t.modes.length - 1; }
  function addRange(c: Channel) {
    const last = c.ranges?.[c.ranges.length - 1];
    if (!c.ranges) c.ranges = [];
    c.ranges.push({ from: last ? Math.min(255, last.to + 1) : 0, to: 255, label: 'Range', kind: 'other' });
  }
  // ---- cells: a block of channels again for every LED, ring or lamp (a pixel head in one go)
  let cellsOpen = $state(false);
  let cellFrom = $state<'pattern' | 'rows'>('pattern');
  let pattern = $state('rgbw');
  let rowA = $state(1), rowB = $state(4);
  let cellCount = $state(8);
  let shapeKind = $state<'none' | 'rings' | 'matrix'>('none');
  let ringText = $state(''), shapeCols = $state(8), shapeRows = $state(8);
  const per = $derived(cellFrom === 'pattern' ? patternChannels(pattern).length : Math.abs(rowB - rowA) + 1);
  // cells the mode will have once the block is in (rows turned into a cell count as the first one)
  const cellsAfter = $derived.by(() => {
    if (cellFrom === 'pattern') return nextCell(mode.channels) + Math.max(0, cellCount | 0);
    const lo = Math.min(rowA, rowB) - 1, hi = Math.max(rowA, rowB) - 1;
    return nextCell(mode.channels.filter((_, i) => i < lo || i > hi)) + Math.max(0, cellCount | 0);
  });
  const shape = $derived(shapeFrom(shapeKind, ringText, shapeCols, shapeRows));
  const cellErr = $derived(
    !(cellCount >= 1 && cellCount <= 4096 && Number.isInteger(cellCount)) ? 'How many cells? 1 to 4096.'
    : cellFrom === 'rows' && (Math.min(rowA, rowB) < 1 || Math.max(rowA, rowB) > mode.channels.length) ? `The rows are 1 to ${mode.channels.length}.`
    : shapeKind !== 'none' && !shape ? (shapeKind === 'rings' ? 'Say how many LEDs each ring has, in the order the data runs through them (like 1, 6, 12, 18).' : 'Give it columns and rows.')
    : shape && layoutCells(shape) !== cellsAfter ? `That shape has ${layoutCells(shape)} LEDs, the light will have ${cellsAfter} cells: set How many cells to ${layoutCells(shape)}, or change the rings.` : '');
  function addCells() {
    if (cellErr) return;
    const n = cellCount | 0;
    mode.channels = cellFrom === 'pattern'
      ? [...mode.channels, ...cellBlock(patternChannels(pattern), n, nextCell(mode.channels))]
      : repeatRows(mode.channels, rowA - 1, rowB - 1, n);
    if (shape) mode.layout = shape;
    cellsOpen = false;
  }
  // long runs of cell channels show as one line until opened (a 244-row block)
  const runs = $derived(cellRuns(mode.channels).filter((r) => r.cells > 2));
  let openRuns = $state<Set<number>>(new Set());
  const runAt = (i: number) => runs.find((r) => i >= r.from && i <= r.to);
  const shown = (i: number) => { const r = runAt(i); return !r || openRuns.has(r.from); };
  function toggleRun(from: number) { const s = new Set(openRuns); if (s.has(from)) s.delete(from); else s.add(from); openRuns = s; }
  // (the cells after it move up: cell numbers stay without gaps)
  function removeRun(from: number, to: number) {
    const before = [...new Set(mode.channels.filter((c) => c.cell !== undefined).map((c) => c.cell!))];
    mode.channels.splice(from, to - from + 1);
    const used = [...new Set(mode.channels.filter((c) => c.cell !== undefined).map((c) => c.cell!))].sort((a, b) => a - b);
    const to0 = new Map(used.map((c, i) => [c, i]));
    for (const c of mode.channels) if (c.cell !== undefined) c.cell = to0.get(c.cell);
    // (composed with the runs taken out before: original cell -> where it is now)
    const key = mode;
    const m = moved.get(key) ?? new Map(before.map((c) => [c, c]));
    for (const [o, now] of m) m.set(o, now === null ? null : to0.get(now) ?? null);
    moved.set(key, m);
    if (mode.layout && nextCell(mode.channels) !== layoutCells(mode.layout)) delete mode.layout;
    openRuns = new Set(); openRanges = null;
  }

  function save() {
    err = '';
    if (!t.model.trim()) { err = 'Give it a name.'; return; }
    if (t.modes.some((m) => !m.channels.length)) { err = 'Every mode needs at least one channel.'; return; }
    if (new Set(t.modes.map((m) => m.name)).size !== t.modes.length) { err = 'Two modes have the same name.'; return; }
    const bad = t.modes.map(layoutProblem).find(Boolean);
    if (bad) { err = bad; return; }
    for (const m of t.modes) for (const c of m.channels) if (c.ranges && !c.ranges.length) delete c.ranges;
    // (only the cells that moved or went: per mode, by its name)
    const cellMaps: CellMaps = {};
    for (const m of t.modes) { const mv = moved.get(m); if (mv) { const out: Record<string, number | null> = {}; for (const [o, n] of mv) if (n !== o) out[o] = n; if (Object.keys(out).length) cellMaps[m.name] = out; } }
    const maps = Object.keys(cellMaps).length ? cellMaps : undefined;
    app.saveType($state.snapshot(t) as FixtureType, maps);
    onsaved(t.id, maps);
    onclose();
  }
</script>

{#if wizard}
  <ChannelWizard onclose={() => (wizard = false)} count={mode.channels.length || 8}
                 onfinish={(chs) => { mode.channels = chs; }} />
{:else}
  <Modal title={t.source === 'user' && type?.source === 'user' ? 'Edit fixture type' : type ? 'Adjust a copy' : 'New fixture type'} {onclose} wide>
    <div class="row">
      <label>Manufacturer <input bind:value={t.manufacturer} /></label>
      <label>Model <input bind:value={t.model} aria-label="Model" /></label>
    </div>
    <div class="row modes">
      {#each t.modes as m, i (i)}<button class:cur={i === mi} onclick={() => (mi = i)}>{m.name} <span class="faint">{m.channels.length} ch</span></button>{/each}
      <button onclick={addMode}><Icon name="plus" size={14} />Mode</button>
    </div>
    <div class="row">
      <label>Mode name <input bind:value={mode.name} style="width:10em" aria-label="Mode name" /></label>
      <button onclick={() => (wizard = true)} title="Try each channel on the real fixture and say what it does">Find the channels on the fixture…</button>
      {#if t.modes.length > 1}<button class="x" onclick={() => { t.modes.splice(mi, 1); mi = 0; }}>Delete mode</button>{/if}
    </div>

    <table>
      <thead><tr><th>#</th><th>Name</th><th>Does</th><th title="Low byte of a 16-bit pair">Fine</th><th>Default</th><th title="Named value ranges">Values</th><th title="Which cell (LED, ring, lamp) of a pixel light it belongs to: empty for the whole light">Cell</th><th><span class="sr-only">Move or remove</span></th></tr></thead>
      <tbody>
        {#each mode.channels as c, i (i)}
          {@const run = runAt(i)}
          {#if run && i === run.from}
            <tr class="run">
              <td class="muted">{run.from + 1}–{run.to + 1}</td>
              <td colspan="6"><button class="ghost rg" onclick={() => toggleRun(run.from)} aria-expanded={openRuns.has(run.from)}>
                <Icon name={openRuns.has(run.from) ? 'down' : 'right'} size={12} /><b>Cells {run.first + 1} to {run.last + 1}</b>&nbsp;<span class="muted">{run.per.join(', ')} each, {run.to - run.from + 1} channels</span></button></td>
              <td class="tools"><button class="ghost x danger" onclick={() => removeRun(run.from, run.to)} title="Remove these cells" aria-label="Remove cells {run.first + 1} to {run.last + 1}"><Icon name="trash" size={14} /></button></td>
            </tr>
          {/if}
          {#if shown(i)}
          <tr>
            <td class="muted">{i + 1}</td>
            <td><input bind:value={c.name} aria-label="Channel {i + 1} name" /></td>
            <td><select bind:value={c.attr} aria-label="Channel {i + 1} function" onchange={() => named(c)}>
              {#each ATTR_GROUPS as g (g.label)}<optgroup label={g.label}>{#each g.attrs as [a, l] (a)}<option value={a}>{l}</option>{/each}</optgroup>{/each}
            </select></td>
            <td><input type="checkbox" checked={!!c.fine} onchange={(e) => (c.fine = (e.target as HTMLInputElement).checked || undefined)} /></td>
            <td><input type="number" min="0" max="255" value={c.default ?? 0} oninput={(e) => (c.default = +(e.target as HTMLInputElement).value || undefined)} style="width:4.2em" /></td>
            <td><button class="ghost rg" onclick={() => (openRanges = openRanges === i ? null : i)} aria-expanded={openRanges === i}
                        title="Named value ranges: gobo slots, strobe, shutter open...">{c.ranges?.length ? `${c.ranges.length} named` : 'add'}<Icon name={openRanges === i ? 'down' : 'right'} size={12} /></button></td>
            <td><input type="number" min="1" max="4096" value={c.cell === undefined ? '' : c.cell + 1} placeholder="–" style="width:4.2em" aria-label="Channel {i + 1} cell"
                       oninput={(e) => { const v = (e.target as HTMLInputElement).value; c.cell = v === '' || +v < 1 ? undefined : Math.min(4096, Math.floor(+v)) - 1; }} /></td>
            <td class="tools"><button class="ghost x" onclick={() => move(i, -1)} disabled={i === 0} title="Move up" aria-label="Move channel {i + 1} up"><Icon name="up" size={14} /></button><button class="ghost x" onclick={() => move(i, 1)} disabled={i === mode.channels.length - 1} title="Move down" aria-label="Move channel {i + 1} down"><Icon name="down" size={14} /></button>
              <button class="ghost x danger" onclick={() => mode.channels.splice(i, 1)} title="Remove this channel" aria-label="Remove channel {i + 1}"><Icon name="trash" size={14} /></button></td>
          </tr>
          {/if}
          {#if openRanges === i}
            <tr><td></td><td colspan="7">
              {#each c.ranges ?? [] as r, ri (ri)}
                <div class="range row">
                  <input type="number" min="0" max="255" bind:value={r.from} style="width:4em" /> – <input type="number" min="0" max="255" bind:value={r.to} style="width:4em" />
                  <input bind:value={r.label} style="flex:1" />
                  <select bind:value={r.kind}>
                    <option value="other">other</option><option value="open">shutter open</option><option value="closed">shutter closed</option>
                    <option value="strobe">strobe</option><option value="slot">wheel slot</option>
                  </select>
                  {#if r.kind === 'slot'}<input type="color" value={r.color ?? '#ffffff'} oninput={(e) => (r.color = (e.target as HTMLInputElement).value)} />{/if}
                  <button class="ghost x" onclick={() => c.ranges!.splice(ri, 1)} title="Remove this range" aria-label="Remove range"><Icon name="close" size={12} /></button>
                </div>
              {/each}
              <button onclick={() => addRange(c)}><Icon name="plus" size={14} />Range</button>
            </td></tr>
          {/if}
        {/each}
      </tbody>
    </table>
    {#if mode.layout}
      <p class="shape faint">Shape: {mode.layout.kind === 'rings' ? `rings of ${mode.layout.rings.join(', ')}` : `a grid of ${mode.layout.cols} × ${mode.layout.rows}`} ({layoutCells(mode.layout)} LEDs). {layoutWords(mode.layout)}. <button class="ghost x" onclick={() => delete mode.layout} title="No shape: the cells in a row">remove</button></p>
    {/if}
    {#if cellsOpen}
      <section class="cellsbox" aria-label="Add cells">
        <p><b>Cells</b>: the same few channels again for every LED, ring or lamp of a pixel light. The manual's table usually shows them once ("channels 22 to 25: LED 1 red, green, blue, white") and says how many.</p>
        <div class="opt"><label><input type="radio" bind:group={cellFrom} value="pattern" /> New channels per cell</label>
          <select bind:value={pattern} aria-label="Channels per cell" disabled={cellFrom !== 'pattern'}>{#each CELL_PATTERNS as p (p.id)}<option value={p.id}>{p.label}</option>{/each}</select></div>
        <div class="opt"><label><input type="radio" bind:group={cellFrom} value="rows" disabled={!mode.channels.length} /> Rows of the table</label>
          <input type="number" min="1" max={mode.channels.length} bind:value={rowA} style="width:4.2em" aria-label="First row of the cell" disabled={cellFrom !== 'rows'} /> to
          <input type="number" min="1" max={mode.channels.length} bind:value={rowB} style="width:4.2em" aria-label="Last row of the cell" disabled={cellFrom !== 'rows'} /> <span class="muted">are the first cell</span></div>
        <div class="row">
          <label>How many cells <input type="number" min="1" max="4096" bind:value={cellCount} style="width:5em" aria-label="How many cells" /></label>
          <label>Shape <select bind:value={shapeKind} aria-label="Shape">
            <option value="none">none (in a row)</option><option value="rings">rings</option><option value="matrix">a grid</option></select></label>
          {#if shapeKind === 'rings'}<label>LEDs per ring <input bind:value={ringText} placeholder="1, 6, 12, 18" aria-label="LEDs per ring" style="width:10em" /></label>{/if}
          {#if shapeKind === 'matrix'}<label>Columns <input type="number" min="1" bind:value={shapeCols} style="width:4em" /></label><label>Rows <input type="number" min="1" bind:value={shapeRows} style="width:4em" /></label>{/if}
        </div>
        <div class="row">
          {#if cellErr}<span class="err">{cellErr}</span>{:else}<span class="faint">{cellCount} × {per} = {(cellCount | 0) * per} channels{cellFrom === 'rows' ? ` (the ${per} rows included)` : ''}, cells {cellsAfter - (cellCount | 0) + 1} to {cellsAfter}</span>{/if}
          <span style="flex:1"></span>
          <button onclick={() => (cellsOpen = false)}>Cancel</button>
          <button class="primary" onclick={addCells} disabled={!!cellErr}>Add {cellCount | 0} cells</button>
        </div>
      </section>
    {/if}
    {#if !mode.channels.length}
      <div class="start">
        <p><b>No channels yet.</b> Two ways to get them:</p>
        <ol>
          <li><b>Find them on the fixture</b>: patch it, then the app turns each channel up in turn and you say what the light did. No manual needed.</li>
          <li><b>From the manual</b>: add a channel per row of its DMX table and pick what each does. A pixel head's LEDs (the same few channels again and again) come in one go with <b>+ Cells</b>.</li>
        </ol>
        <button class="primary" onclick={() => (wizard = true)}>Find the channels on the fixture…</button>
      </div>
    {/if}
    <div class="row foot">
      <button onclick={addChannel}>+ Channel</button>
      <button onclick={() => { cellsOpen = !cellsOpen; if (mode.channels.length) { rowA = Math.max(1, mode.channels.length - 3); rowB = mode.channels.length; } }} aria-expanded={cellsOpen}
              title="The same channels again for every LED, ring or lamp (pixel heads, bars, blinders)">+ Cells…</button>
      <span style="flex:1"></span>
      {#if err}<span class="err">{err}</span>{/if}
      <button onclick={onclose}>Cancel</button>
      <button class="primary" onclick={save}>Save type</button>
    </div>
  </Modal>
{/if}

<style>
  label { color: var(--muted); font-size: .9rem; display: inline-flex; gap: .4rem; align-items: center; }
  .modes { margin: .6rem 0 .3rem; } .modes .cur { border-color: var(--green); }
  table { width: 100%; border-collapse: collapse; margin: .5rem 0; font-size: .9rem; }
  th { text-align: left; color: var(--muted); font-weight: normal; padding: .2rem; }
  td { padding: .15rem .2rem; } td input:not([type=checkbox]) { width: 100%; }
  .tools { white-space: nowrap; }
  .x { border: 0; background: none; color: var(--muted); padding: .1rem .3rem; }
  .range { margin: .15rem 0; }
  .foot { margin-top: .4rem; }
  .err { color: var(--pink); }
  .run td { background: #ffffff06; }
  .run .rg { display: inline-flex; align-items: center; gap: .3rem; }
  .cellsbox { border: 1px solid var(--line2); border-radius: var(--radius); padding: .6rem .8rem; margin: .4rem 0; display: flex; flex-direction: column; gap: .45rem; }
  .cellsbox p { margin: 0; color: var(--muted); font-size: .88rem; }
  .opt { display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; }
  .shape { margin: .2rem 0; font-size: .85rem; }
  .start { border: 1px dashed var(--line2); border-radius: var(--radius); padding: .7rem .9rem; margin: .4rem 0; color: var(--muted); }
  .start ol { margin: .3rem 0 .6rem; padding-left: 1.2rem; }
</style>
