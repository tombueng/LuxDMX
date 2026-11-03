<script lang="ts">
  // Several lights patched together: a universe for all of them, addresses one after the other from
  // a start, names numbered. What's left empty stays as it is. Opened from a light's menu (or
  // Enter) with more than one selected.
  import Modal from './Modal.svelte';
  import { app } from '../app.svelte';
  import { ui } from './ui.svelte';

  let { ids, onclose }: { ids: string[]; onclose: () => void } = $props();
  const list = $derived(app.show.fixtures.filter((f) => ids.includes(f.id)));
  const width = (id: string) => app.modeOf(id)?.channels.length ?? 1;
  const unis = $derived([...new Set(list.map((f) => f.universe))]);
  let universe = $state<number | null>(null);
  let start = $state<number | null>(null);
  let gap = $state(0);
  let name = $state('');
  // what it comes to: the run, past 512, and lights outside the set it would sit on
  const uni = $derived(universe ?? (unis.length === 1 ? unis[0] : null));
  const total = $derived(list.reduce((n, f) => n + width(f.id), 0) + gap * Math.max(0, list.length - 1));
  const end = $derived(start ? start + total - 1 : 0);
  const clash = $derived.by(() => {
    if (!start || uni === null) return [];
    return app.show.fixtures.filter((x) => !ids.includes(x.id) && x.universe === uni && x.address <= end && start! <= x.address + width(x.id) - 1).map((x) => x.name);
  });
  const free = $derived(uni === null ? -1 : app.show.fixtures.filter((x) => !ids.includes(x.id) && x.universe === uni).reduce((e, x) => Math.max(e, x.address - 1 + width(x.id)), 0) + 1);
  const can = $derived(universe !== null || !!start || !!name.trim());
  function apply() {
    if (!can) return;
    if (start && uni === null) { ui.toast('Pick a universe for them first: they are on different ones', 4000); return; }
    app.repatch(ids, { universe: universe ?? undefined, start: start ?? undefined, gap, name: name.trim() || undefined });
    app.toastUndo(`Patched ${list.length} lights${start ? ` from ${start}` : ''}${universe !== null ? ` on universe ${universe}` : ''}`);
    onclose();
  }
  const num = (e: Event) => { const v = (e.target as HTMLInputElement).valueAsNumber; return Number.isFinite(v) ? Math.round(v) : null; };
</script>

<Modal title="Patch {list.length} lights" {onclose}>
  <form class="pm" onsubmit={(e) => { e.preventDefault(); apply(); }}>
    <p class="faint">{list.slice(0, 3).map((f) => f.name).join(', ')}{list.length > 3 ? ` and ${list.length - 3} more` : ''}. Left empty: stays as it is.</p>
    <label>Universe <input type="number" min="0" max="32767" placeholder={unis.length === 1 ? String(unis[0]) : 'several'} value={universe ?? ''} aria-label="Universe for all"
      oninput={(e) => (universe = num(e))} /></label>
    <label>Start address <input type="number" min="1" max="512" placeholder={free > 0 && free <= 512 ? `next free: ${free}` : ''} value={start ?? ''} aria-label="Start address"
      oninput={(e) => (start = num(e))} /></label>
    <label>Gap between them <input type="number" min="0" max="64" value={gap} aria-label="Gap between them" oninput={(e) => (gap = Math.max(0, num(e) ?? 0))} /></label>
    <label>Names <input placeholder="keep their names" bind:value={name} aria-label="Names" /></label>
    {#if start}
      <p class="wide" role="status">{list.length} lights, {total} channels: {start} to {end}{name.trim() ? `, named ${name.trim()} 1 to ${name.trim()} ${list.length}` : ''}.</p>
      {#if end > 512}<p class="err wide" role="status">That runs {end - 512} channel{end - 512 > 1 ? 's' : ''} past 512, the end of the universe: put some on the next universe.</p>{/if}
      {#if clash.length}<p class="err wide" role="status">Shares channels with {clash.slice(0, 4).join(', ')}{clash.length > 4 ? ` and ${clash.length - 4} more` : ''}.
        {#if free > 0 && free + total - 1 <= 512}<button type="button" class="ghost link" onclick={() => (start = free)}>Start at {free}, the next free one</button>{/if}</p>{/if}
    {/if}
    <div class="row end wide"><button type="button" onclick={onclose}>Cancel</button><button type="submit" class="primary" disabled={!can}>Patch them</button></div>
  </form>
</Modal>

<style>
  .pm { display: grid; grid-template-columns: 1fr 1fr; gap: .7rem .9rem; min-width: min(460px, 86vw); }
  .pm > p { grid-column: 1 / -1; margin: 0; }
  .pm label { display: flex; flex-direction: column; gap: .3rem; color: var(--muted); }
  .wide { grid-column: 1 / -1; }
  .err { color: var(--pink); }
  .link { color: var(--accent); padding: 0 .2rem; }
  @media (max-width: 560px) { .pm { grid-template-columns: 1fr; } }
</style>
