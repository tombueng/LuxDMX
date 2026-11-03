<script lang="ts">
  // Every built-in effect as a moving picture. Pick what to run it on, click one, it starts.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import EffectPreview from './EffectPreview.svelte';
  import { EFFECTS, CATEGORY_LABEL, type EffectCategory } from '../engine/effects';
  import { app } from '../app.svelte';
  import { ui } from './ui.svelte';

  let { onclose, onadded }: { onclose: () => void; onadded?: (id: string) => void } = $props();

  const CAT_HINT: Record<EffectCategory, string> = {
    move: 'For moving heads. They move around where the heads point now, so aim them first.',
    color: 'Change colours. They also switch the lights on (turn that off in the effect if a cue should decide).',
    intensity: 'Brightness patterns. They work on any light, PARs, dimmers, pixel bars (every pixel on its own).',
    pixel: 'Shows for pixel strips and bars, colour and brightness together: chases, fire, twinkles, ripples, your own formula or picture. They work on rows of PARs too.',
  };
  // What to run it on: the selection, or a group.
  let target = $state<string>(app.selected.length ? 'sel' : app.show.groups[0]?.id ?? 'sel');
  const count = $derived(target === 'sel' ? app.selected.length : app.show.groups.find((g) => g.id === target)?.fixtures.length ?? 0);
  const movers = $derived((target === 'sel' ? app.selected : app.show.groups.find((g) => g.id === target)?.fixtures ?? []).filter((id) => app.kinds[id] === 'mover').length);
  // moves first when there are heads to move, else last (greyed out sections first look broken)
  const ORDER: Record<'movers' | 'none', EffectCategory[]> = { movers: ['move', 'color', 'pixel', 'intensity'], none: ['color', 'pixel', 'intensity', 'move'] };
  const cats = $derived(ORDER[movers ? 'movers' : 'none'].filter((c) => EFFECTS.some((d) => d.category === c)));

  function pick(kind: string) {
    if (!count) return ui.toast('Select some lights (or pick a group) first');
    const e = app.addEffect(kind, target === 'sel' ? { fixtures: [...app.selected] } : { group: target });
    if (!e) return;
    ui.toast(`${e.name} is running. Record puts it into a cue.`);
    onadded?.(e.id);
    onclose();
  }
</script>

<Modal title="Add an effect" {onclose} wide>
  <div class="row target">
    <span class="muted">Run it on</span>
    <button class:on={target === 'sel'} onclick={() => (target = 'sel')} disabled={!app.selected.length}>
      <Icon name="check" />the selected lights ({app.selected.length})</button>
    {#each app.show.groups as g (g.id)}
      <button class:on={target === g.id} onclick={() => (target = g.id)}><Icon name="group" />{g.name} ({g.fixtures.length})</button>
    {/each}
  </div>
  {#if !count}<p class="err">Nothing to run it on: close this, select lights on the stage (or make a group), then come back.</p>{/if}

  {#each cats as cat (cat)}
    <h2>{CATEGORY_LABEL[cat]}</h2>
    <p class="hint">{CAT_HINT[cat]}{cat === 'move' && count && !movers ? ' (None of these lights can move.)' : ''}</p>
    <div class="cards">
      {#each EFFECTS.filter((d) => d.category === cat) as d (d.id)}
        <button class="card" onclick={() => pick(d.id)} disabled={cat === 'move' && !!count && !movers} data-effect={d.id}>
          <EffectPreview kind={d.id} w={180} h={46} bpm={app.bpm} />
          <b>{d.name}</b>
          <span class="faint">{d.blurb}</span>
        </button>
      {/each}
    </div>
  {/each}
</Modal>

<style>
  .target { margin-bottom: .4rem; }
  .target button { border-radius: 999px; padding: .2rem .7rem; }
  h2 { margin: 1rem 0 .2rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); gap: .5rem; }
  .card { flex-direction: column; align-items: flex-start; text-align: left; white-space: normal; padding: .5rem; gap: .3rem; justify-content: flex-start; }
  .card:hover:not(:disabled) { border-color: var(--accent); }
</style>
