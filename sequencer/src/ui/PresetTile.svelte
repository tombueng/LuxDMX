<script lang="ts">
  // One preset as a tile you can see: a colour swatch, a little pan/tilt map, a level bar.
  import { app } from '../app.svelte';
  import { focusSelect } from './ui.svelte';
  import type { Color, Preset } from '../model/types';

  let { id, renaming = false, dropping = false, onclick, oncontextmenu, ondone, ondragstart, ondragover, ondrop, ondragend }: {
    id: string; renaming?: boolean; dropping?: boolean; onclick: () => void; oncontextmenu: (e: MouseEvent) => void; ondone: () => void;
    ondragstart: (e: DragEvent) => void; ondragover: (e: DragEvent) => void; ondrop: (e: DragEvent) => void; ondragend: () => void;
  } = $props();
  const preset = $derived(app.show.presets.find((p) => p.id === id) as Preset);
  const css = (c: Color) => `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
  const col = $derived(preset.values.color && !('preset' in preset.values.color) ? preset.values.color as Color : undefined);
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const dots = $derived.by(() => {
    if (preset.kind !== 'position') return [];
    const per = Object.values(preset.perFixture ?? {});
    const all = per.length ? per : [preset.values];
    return all.map((v) => ({ x: num(v.pan) ?? 0.5, y: num(v.tilt) ?? 0.5 }));
  });
  // Is it on the selection right now (by reference)?
  const active = $derived(app.selected.length > 0 && app.selected.every((id) => Object.values(app.programmer[id] ?? {}).some((x) => !!x && typeof x === 'object' && (x as { preset?: string }).preset === preset.id)));
  const uses = $derived(app.presetUses.get(id) ?? 0);
  let was = '';                       // the name before a rename
</script>

<button class="tile {preset.kind}" class:active class:dropping draggable="true" {onclick} {oncontextmenu} {ondragstart} {ondragover} {ondrop} {ondragend}
        title="{preset.name}{uses ? ` · used in ${uses} cue${uses > 1 ? 's' : ''}` : ''}" aria-label="Preset {preset.name}" data-preset={preset.name}>
  {#if preset.kind === 'color'}
    <span class="sw" style="background:{col ? css(col) : 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)'}"></span>
  {:else if preset.kind === 'position'}
    <svg class="map" viewBox="0 0 40 26" aria-hidden="true">
      <rect width="40" height="26" rx="3" fill="#0b0f15" />
      <path d="M20 0v26M0 13h40" stroke="#2a313c" stroke-width=".6" />
      {#each dots as d, i (i)}<circle cx={3 + d.x * 34} cy={2 + d.y * 22} r="2.4" fill="#ffaa1c" />{/each}
    </svg>
  {:else if preset.kind === 'intensity'}
    <span class="lvl"><span style="width:{(num(preset.values.intensity) ?? 0) * 100}%"></span></span>
  {:else}
    <span class="beam">{num(preset.values.strobe) !== undefined ? ((num(preset.values.strobe) ?? 0) > 0 ? '⚡' : '○') : num(preset.values.zoom) !== undefined ? ((num(preset.values.zoom) ?? 0) > 0.5 ? '◁▷' : '▷◁') : '◎'}</span>
  {/if}
  {#if renaming}
    <!-- svelte-ignore a11y_autofocus -->
    <!-- Enter keeps the name, Esc puts the old one back; either way the focus goes back to the tile -->
    <input bind:value={preset.name} use:focusSelect onfocus={() => (was = preset.name)} onblur={() => { if (!preset.name.trim()) preset.name = was; ondone(); }} onclick={(e) => e.stopPropagation()} aria-label="Preset name"
           onkeydown={(e) => { if (e.key !== 'Enter' && e.key !== 'Escape') return; e.preventDefault(); e.stopPropagation(); if (e.key === 'Escape' || !preset.name.trim()) preset.name = was; const b = e.currentTarget.closest('button'); ondone(); queueMicrotask(() => b?.focus()); }} />
  {:else}
    <span class="name">{preset.name}</span>
  {/if}
  {#if uses}<span class="uses">{uses}</span>{/if}
</button>

<style>
  .tile { position: relative; flex-direction: column; gap: .2rem; padding: .3rem .2rem .25rem; font-size: .76rem; white-space: normal; line-height: 1.1; height: 62px; justify-content: flex-start; }
  /* every tile the same height: a long name gets two lines and an ellipsis */
  .name { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-align: center; word-break: break-word; }
  .tile.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .tile.dropping { box-shadow: -3px 0 0 var(--accent); }
  .sw { width: 30px; height: 30px; border-radius: 50%; border: 1px solid #0006; box-shadow: 0 0 10px #0008 inset; }
  .map { width: 46px; height: 30px; }
  .lvl { width: 46px; height: 12px; margin: 9px 0; border-radius: 3px; background: var(--line); overflow: hidden; display: block; }
  .lvl span { display: block; height: 100%; background: linear-gradient(90deg, #ffaa1c88, var(--orange)); }
  .beam { height: 30px; display: grid; place-items: center; font-size: 1rem; color: var(--muted); }
  .name { text-align: center; color: var(--text); overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  input { width: 100%; font-size: .76rem; padding: .05rem; }
  .uses { position: absolute; top: 2px; right: 3px; font-size: .76rem; color: var(--faint); }
</style>
