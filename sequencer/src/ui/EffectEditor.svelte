<script lang="ts">
  // The knobs of one effect. Plain words first; the finer ones under "More".
  import Icon from './Icon.svelte';
  import EffectPreview from './EffectPreview.svelte';
  import CustomEffectFields from './CustomEffectFields.svelte';
  import { app } from '../app.svelte';
  import { EFFECTS, EFFECT_MAP, PALETTES, paramsOf, type Direction } from '../engine/effects';
  import type { Color } from '../model/types';

  // By id, looked up in the show: the editor changes the show's own object.
  let { id }: { id: string } = $props();
  const fx = $derived(app.show.effects.find((e) => e.id === id)!);
  const def = $derived(EFFECT_MAP.get(fx.kind));
  const p = $derived(paramsOf(fx.kind, fx.params));
  const set = (k: string, v: unknown) => { fx.params = { ...fx.params, [k]: v }; };
  const num = (k: string) => (e: Event) => set(k, +(e.target as HTMLInputElement).value);
  const BEATS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
  const DIRS: [Direction, string, string][] = [
    ['forward', '→ Forward', 'Forward'], ['backward', '← Back', 'Backward'], ['bounce', '↔ Bounce', 'There and back'],
    ['in', '→← In', 'From the outside in'], ['out', '←→ Out', 'From the centre out'], ['random', '⤨ Random', 'Random order'],
  ];
  const hex = (c: Color) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  const fromHex = (h: string): Color => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
  const usesColors = $derived(['colorChase', 'colorFade', 'gradient', 'random', 'police', 'fire', 'ocean'].includes(fx.kind) || (def?.category === 'pixel' && !def.noColors));
  const usesWidth = $derived(['chase', 'pingpong', 'strobe', 'meteor'].includes(fx.kind));
  const hasBars = $derived((fx.group ? app.show.groups.find((g) => g.id === fx.group)?.fixtures ?? [] : fx.fixtures ?? []).some((id) => app.kinds[id] === 'bar'));
  const pct = (v: number) => Math.round(v * 100);
  let more = $state(false);
</script>

<div class="ed" aria-label="Effect settings">
  <div class="top">
    <EffectPreview kind={fx.kind} params={fx.params} w={250} h={def?.category === 'move' ? 64 : 40} bpm={app.bpm} />
  </div>
  <label class="full">Name <input bind:value={fx.name} aria-label="Effect name" /></label>
  <div class="two">
    <label>Effect <select value={fx.kind} onchange={(e) => (fx.kind = (e.target as HTMLSelectElement).value)} aria-label="Effect kind">
      {#each EFFECTS as d (d.id)}<option value={d.id}>{d.name}</option>{/each}</select></label>
    <label>Runs on <select value={fx.group ?? ''} aria-label="Runs on" onchange={(e) => {
      const v = (e.target as HTMLSelectElement).value;
      if (v === '__sel') { delete fx.group; fx.fixtures = app.show.fixtures.map((f) => f.id).filter((id) => app.selected.includes(id)); }
      else if (v) { fx.group = v; delete fx.fixtures; }
    }}>
      {#if !fx.group}<option value="">{fx.fixtures?.length ?? 0} lights</option>{/if}
      {#each app.show.groups as g (g.id)}<option value={g.id}>{g.name}</option>{/each}
      <option value="__sel" disabled={!app.selected.length}>the selected lights ({app.selected.length})</option>
    </select></label>
  </div>

  <div class="knob">
    <span class="lab">Speed</span>
    <label class="tempo" title="Follow the show tempo (Tap)"><input type="checkbox" checked={p.tempo} onchange={(e) => set('tempo', (e.target as HTMLInputElement).checked)} /> tempo</label>
    {#if p.tempo}
      <select value={String(p.speed)} onchange={(e) => set('speed', +(e.target as HTMLSelectElement).value)} aria-label="Beats per cycle">
        {#each BEATS as b (b)}<option value={String(b)}>{b < 1 ? `1/${1 / b}` : b} beat{b === 1 ? '' : 's'}</option>{/each}
        {#if !BEATS.includes(p.speed)}<option value={String(p.speed)}>{p.speed} beats</option>{/if}
      </select>
    {:else}
      <span class="row"><input type="number" min="0.05" max="600" step="0.1" value={p.speed} onchange={(e) => { const v = (e.target as HTMLInputElement).valueAsNumber; if (Number.isFinite(v)) set('speed', Math.max(0.05, v)); }} aria-label="Seconds per cycle" style="width:5em" /> s</span>
    {/if}
    <span class="faint">per round{#if p.tempo} · {Math.round(p.speed * 60 / app.bpm * 10) / 10} s at {app.bpm} BPM{/if}</span>
  </div>
  <CustomEffectFields {fx} {p} {set} />
  <label class="knob" title="How far it moves, or how deep the colour or brightness swings"><span class="lab">Size</span><input type="range" min="0" max="1" step="0.01" value={p.size} oninput={num('size')} aria-label="Size" /><b>{pct(p.size)}</b></label>
  <label class="knob" title="0: all lights together. 100: spread evenly, one after the other"><span class="lab">Spread</span><input type="range" min="0" max="1" step="0.01" value={p.spread} oninput={num('spread')} aria-label="Spread" /><b>{pct(p.spread)}</b></label>
  <div class="knob"><span class="lab">Direction</span>
    <div class="seg" role="radiogroup" aria-label="Direction">
      {#each DIRS as [d, sym, title] (d)}<button role="radio" aria-checked={p.direction === d} class:on={p.direction === d} {title} aria-label={title} onclick={() => set('direction', d)}>{sym}</button>{/each}
    </div>
  </div>
  {#if usesColors}
    <div class="knob col"><span class="lab">Colours</span>
      <div class="pal">
        {#each p.colors as c, i (i)}
          <span class="pc"><input type="color" value={hex(c)} aria-label="Colour {i + 1}" oninput={(e) => { const cs = [...p.colors]; cs[i] = fromHex((e.target as HTMLInputElement).value); set('colors', cs); }} />
            {#if p.colors.length > 1}<button class="ghost x" aria-label="Remove colour {i + 1}" onclick={() => set('colors', p.colors.filter((_, j) => j !== i))}><Icon name="close" size={10} /></button>{/if}</span>
        {/each}
        {#if p.colors.length < 8}<button class="ghost" onclick={() => set('colors', [...p.colors, { r: 1, g: 1, b: 1 }])} aria-label="Add colour"><Icon name="plus" size={14} /></button>{/if}
      </div>
      <select onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) set('colors', PALETTES[v]); (e.target as HTMLSelectElement).value = ''; }} aria-label="Palette">
        <option value="">palette…</option>{#each Object.keys(PALETTES) as name (name)}<option value={name}>{name}</option>{/each}
      </select>
    </div>
  {/if}
  <label class="knob" title="How much of the effect is mixed over the look underneath: 100% is all effect, 0% is the look alone. Brightness is the lights' own intensity."><span class="lab">Strength</span><input type="range" min="0" max="1" step="0.01" value={p.level} oninput={num('level')} aria-label="Effect level" /><b>{pct(p.level)}</b></label>

  <button class="ghost morebtn" onclick={() => (more = !more)} aria-expanded={more}>{more ? '▾' : '▸'} More</button>
  {#if more}
    <label class="knob" title="Which light comes first: the order of the list, or where they are on the stage"><span class="lab">Order</span>
      <select value={p.order} onchange={(e) => set('order', (e.target as HTMLSelectElement).value)} aria-label="Order">
        <option value="list">as in the list</option><option value="x">left to right on the stage</option>
        <option value="y">back to front</option><option value="centre">from the centre out</option>
      </select></label>
    <label class="knob" title="Neighbours that move together: 2 = pairs"><span class="lab">Blocks</span><input type="number" min="1" max="32" value={p.blocks} oninput={num('blocks')} aria-label="Blocks" style="width:4.5em" /></label>
    {#if usesWidth}
      <label class="knob" title="How long each step is on. 0 = one light's worth"><span class="lab">Width</span><input type="range" min="0" max="1" step="0.01" value={p.width} oninput={num('width')} aria-label="Width" /><b>{p.width ? pct(p.width) : 'auto'}</b></label>
    {/if}
    {#if def?.category !== 'move'}
      <label class="knob"><span class="lab">Dim to</span><input type="range" min="0" max="1" step="0.01" value={p.low} oninput={num('low')} aria-label="Low" /><b>{pct(p.low)}</b></label>
      <label class="knob"><span class="lab">Bright to</span><input type="range" min="0" max="1" step="0.01" value={p.high} oninput={num('high')} aria-label="High" /><b>{pct(p.high)}</b></label>
    {/if}
    {#if def?.category !== 'intensity'}
      <label class="check"><input type="checkbox" checked={p.lightUp} onchange={(e) => set('lightUp', (e.target as HTMLInputElement).checked)} /> switch the lights on (otherwise the cue decides how bright)</label>
    {/if}
    {#if hasBars}
      <label class="check"><input type="checkbox" checked={p.pixels} onchange={(e) => set('pixels', (e.target as HTMLInputElement).checked)} /> every pixel of a bar on its own</label>
    {/if}
    <button class="ghost" onclick={() => { fx.params = {}; }}><Icon name="update" />Back to the defaults</button>
  {/if}
</div>

<style>
  .ed { border-top: 1px solid var(--line); padding-top: .5rem; display: flex; flex-direction: column; gap: .4rem; font-size: .86rem; }
  .top { display: flex; justify-content: center; }
  label { color: var(--muted); }
  .full { display: flex; flex-direction: column; gap: .15rem; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: .4rem; }
  .two label { display: flex; flex-direction: column; gap: .15rem; } .two select { width: 100%; }
  .knob { display: grid; grid-template-columns: 4.6rem 1fr auto; align-items: center; gap: .35rem; }
  .knob > :global(*:nth-child(n+2)) { min-width: 0; }
  .lab { color: var(--muted); }
  .knob b { width: 2.2rem; text-align: right; font-size: .8rem; color: var(--text); font-weight: 600; }
  .knob input[type=range] { width: 100%; }
  .knob:has(.tempo) { grid-template-columns: 4.6rem auto 1fr auto; }
  .tempo { display: inline-flex; gap: .2rem; align-items: center; font-size: .8rem; }
  .seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; grid-column: 2 / 4; }
  .seg button { padding: .15rem 0; font-size: .76rem; }
  .col { grid-template-columns: 4.6rem 1fr; }
  .col select { grid-column: 2; }
  .pal { display: flex; gap: .25rem; flex-wrap: wrap; align-items: center; }
  .pc { position: relative; }
  .pc input { width: 28px; height: 24px; padding: 0; border-radius: 5px; }
  .pc .x { position: absolute; top: -7px; right: -7px; padding: 1px; background: var(--panel2); border-radius: 50%; }
  .check { display: flex; gap: .35rem; align-items: center; font-size: .82rem; }
  .morebtn { align-self: flex-start; }
</style>
