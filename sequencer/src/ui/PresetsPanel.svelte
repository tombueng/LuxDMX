<script lang="ts">
  // Presets: named colours, positions, intensities and beam looks. Click one to put it on the
  // selected lights. Cues remember the preset, not the value, so changing a preset changes every
  // cue that uses it.
  import Icon from './Icon.svelte';
  import Hint from './Hint.svelte';
  import Help from './Help.svelte';
  import PresetTile from './PresetTile.svelte';
  import { colorsFromPicture } from './actions';
  import { app } from '../app.svelte';
  import { ui } from './ui.svelte';
  import type { PresetKind } from '../model/types';

  const KINDS: { kind: PresetKind; label: string; hint: string }[] = [
    { kind: 'color', label: 'Colours', hint: 'For anything that does colour.' },
    { kind: 'position', label: 'Positions', hint: 'Where moving heads point. Aim them, then right-click a position and Update.' },
    { kind: 'intensity', label: 'Intensity', hint: '' },
    { kind: 'beam', label: 'Beam', hint: 'Strobe, zoom and the like, for fixtures that have them.' },
  ];
  let renaming = $state<string | null>(null);
  let drag = $state<string | null>(null);
  let dropOn = $state<string | null>(null);

  function apply(id: string) {
    if (!app.selected.length) return ui.toast('Select lights first, then click a preset');
    app.applyPreset(id);
  }
  async function save(kind: PresetKind) {
    if (!app.selected.length) return ui.toast('Select the lights to take it from first');
    const label = KINDS.find((k) => k.kind === kind)!.label.replace(/s$/, '').toLowerCase();
    const name = await ui.ask(`New ${label} preset`, '', { body: 'Made from what the selected lights show now.', ok: 'Save preset' });
    if (!name) return;
    app.presetFromSelection(kind, name);
    ui.toast(`Saved "${name}"`);
  }
  // Colours from a picture: chosen with the button, or an image dropped on the panel.
  let picInput = $state<HTMLInputElement>();
  let picOver = $state(false);
  function fromPicture(file: File | undefined) { if (file) colorsFromPicture(file); }
  function menu(e: MouseEvent, id: string) {
    const p = app.show.presets.find((x) => x.id === id)!;
    const uses = app.presetUses.get(id) ?? 0;
    ui.openMenu(e, [
      { label: 'Put on the selected lights', icon: 'check', disabled: !app.selected.length, run: () => apply(id) },
      { label: 'Update from the selected lights', icon: 'update', disabled: !app.selected.length, run: () => {
        app.updatePreset(id);
        ui.toast(uses ? `Updated. ${uses} cue${uses > 1 ? 's' : ''} using it changed too.` : 'Updated');
      } },
      { label: 'Rename', icon: 'edit', run: () => (renaming = id) },
      { label: 'Duplicate', icon: 'duplicate', run: () => app.duplicatePreset(id) },
      { sep: true },
      { label: uses ? `Delete (${uses} cue${uses > 1 ? 's keep' : ' keeps'} the look)` : 'Delete', icon: 'trash', danger: true, run: () => app.removePresets([p.id]) },
    ]);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions (dropping a picture is extra; the button does the same) -->
<div class="panel pp" data-marks="hide" class:picover={picOver}
     ondragover={(e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); picOver = true; } }}
     ondragleave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) picOver = false; }}
     ondrop={(e) => { if (e.dataTransfer?.files.length) { e.preventDefault(); picOver = false; fromPicture(e.dataTransfer.files[0]); } }}>
  <div class="row head">
    <h2>Presets</h2><span class="chip">{app.show.presets.length}</span><span class="grow"></span>
    <Help>
      <p><b>Presets</b> are named looks: a colour, a position, a brightness. Select lights and click one.</p>
      <p>Cues remember the preset, not the value. So if "Warm white" turns out too orange on the night, change the preset once and every cue that uses it follows.</p>
      <p>Right-click a preset to update it from the selected lights, rename or delete it. Drag to reorder, or drag one onto a light on the stage.</p>
    </Help>
  </div>
  <Hint>Select lights, then click a preset. Drag one onto a light. Right-click to update one from what's on stage.</Hint>
  {#if !app.show.presets.length}
    <div class="empty">
      <Icon name="palette" size={30} />
      <p>No presets in this show.</p>
      <button class="primary" onclick={() => { const n = app.addStandardPresets(); ui.toast(`Added ${n} presets`); }}>Add the standard presets</button>
    </div>
  {:else}
    {#each KINDS as k (k.kind)}
      {@const list = app.show.presets.filter((p) => p.kind === k.kind)}
      <section>
        <div class="row sh">
          <span class="lab">{k.label}</span><span class="faint">{list.length}</span><span class="grow"></span>
          {#if k.kind === 'color'}
            <button class="ghost" onclick={() => picInput?.click()} title="Colours from a picture: a poster, an album cover, the room (or drop one here)" aria-label="Colours from a picture"><Icon name="image" size={14} /></button>
          {/if}
          <button class="ghost" onclick={() => save(k.kind)} title="Save what the selected lights show as a new {k.label.toLowerCase()} preset" aria-label="New {k.label} preset"><Icon name="plus" size={14} /></button>
        </div>
        {#if k.hint && ui.help}<p class="faint">{k.hint}</p>{/if}
        <div class="tiles" class:wide={k.kind !== 'color'}>
          {#each list as p (p.id)}
            <PresetTile id={p.id} renaming={renaming === p.id} dropping={dropOn === p.id}
              onclick={() => apply(p.id)} oncontextmenu={(e) => menu(e, p.id)} ondone={() => (renaming = null)}
              ondragstart={(e) => { drag = p.id; e.dataTransfer?.setData('application/x-luxdmx-preset', p.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove'; }} ondragover={(e) => { if (drag && drag !== p.id) { e.preventDefault(); dropOn = p.id; } }}
              ondrop={(e) => { e.preventDefault(); if (drag) app.movePreset(drag, p.id); drag = null; dropOn = null; }}
              ondragend={() => { drag = null; dropOn = null; }} />
          {/each}
        </div>
      </section>
    {/each}
    <input type="file" accept="image/*" hidden bind:this={picInput} onchange={(e) => { const i = e.target as HTMLInputElement; fromPicture(i.files?.[0]); i.value = ''; }} />
    <button class="ghost" onclick={() => { const n = app.addStandardPresets(); ui.toast(n ? `Added ${n} missing standard presets` : 'All standard presets are there'); }}>
      <Icon name="plus" />Add missing standard presets</button>
  {/if}
</div>

<style>
  .pp { display: flex; flex-direction: column; gap: .5rem; height: 100%; min-height: 0; overflow: auto; }
  .head { flex-wrap: nowrap; }
  .pp.picover { box-shadow: inset 0 0 0 2px var(--accent); }
  .sh { gap: .3rem; }
  .lab { font-size: .8rem; color: var(--text); font-weight: 600; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap: .3rem; margin-top: .2rem; }
  .tiles.wide { grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); }
  .empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: .5rem; padding: 1.2rem .5rem; color: var(--muted); }
</style>
