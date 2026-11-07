<script lang="ts">
  // One light's patch: its name, where it sits in DMX (with the DIP switches for fixtures that set
  // their address that way), its type and mode, and what the real light says over RDM. Two more
  // tabs: its mode channel by channel (to hold next to the manual), and its mounting (how it hangs,
  // a 3D picture of just that light, test moves, pan and tilt set up against the real one). Opened
  // from the fixture list (double-click, Enter) or a light's menu.
  import Modal from './Modal.svelte';
  import DipSwitch from './DipSwitch.svelte';
  import FixtureSetup from './FixtureSetup.svelte';
  import FixtureSetupChannels from './FixtureSetupChannels.svelte';
  import FixtureSetupRdm from './FixtureSetupRdm.svelte';
  import { app } from '../app.svelte';
  import { isWide, sharesChannels, spansOf } from '../model/pixelLayout';
  import { tablist, ui } from './ui.svelte';
  import { typeLabel } from '../model/library';
  import { modeChange } from '../model/fixtureSetup';
  import type { FixtureType } from '../model/types';

  let { id, onclose }: { id: string; onclose: () => void } = $props();
  const f = $derived(app.show.fixtures.find((x) => x.id === id));
  const t = $derived(f ? app.types.get(f.typeId) : undefined);
  const n = $derived(f ? app.modeOf(f.id)?.channels.length ?? 1 : 1);
  // the show's own types first, then the generic ones; the channel count unless the name says it
  const typeChoices = $derived([...app.types.values()].sort((a, b) => Number(a.source === 'generic') - Number(b.source === 'generic')));
  // (every mode's count: a spot with a 9 and an 11 channel mode says 9/11)
  const typeName = (x: FixtureType) => (/\bch\b/.test(typeLabel(x)) ? typeLabel(x) : `${typeLabel(x)} (${[...new Set(x.modes.map((m) => m.channels.length))].join('/')} ch)`);
  const overlap = $derived(f ? app.show.fixtures.filter((x) => x.id !== f.id && sharesChannels(f, app.modeOf(f.id), x, app.modeOf(x.id))).map((x) => x.name) : []);
  const wide = $derived(f && isWide(app.modeOf(f.id)) ? spansOf(f, app.modeOf(f.id)) : null);
  const free = $derived(f ? app.nextFree(f.universe, n) : 0);
  // the lights after it that it runs into, moved up just enough (model/fixtureSetup.ts)
  const makeRoom = $derived(f && overlap.length ? modeChange(app.show.fixtures.map((x) => ({ id: x.id, name: x.name, universe: x.universe, address: x.address, channels: app.modeOf(x.id)?.channels.length ?? 1 })), f.id, n) : undefined);
  // (opened from a light's menu on its Mounting tab, or from anywhere else on the patch)
  let tab = $state<'patch' | 'channels' | 'mounting'>(ui.patchTab);
  // gone while open (undone, deleted elsewhere): the dialog closes, and a redo doesn't bring it back
  $effect(() => { if (!f) onclose(); });
  function setAddress(a: number) { if (f && a >= 1 && a <= 512) { app.checkpoint(); f.address = a; app.markDirty(0); } }
  function setMode(name: string) { if (f && name !== f.mode) { app.checkpoint(); f.mode = name; app.markDirty(0); } }
  function moveAfter() {
    // (taken first: once they've moved nothing is shared, and makeRoom is gone)
    const moves = makeRoom?.moves ?? [];
    if (!moves.length) return;
    app.checkpoint();
    for (const mv of moves) { const g = app.show.fixtures.find((x) => x.id === mv.id); if (g) g.address = mv.to; }
    app.markDirty(0);
    app.toastUndo(`Moved ${moves.map((mv) => `${mv.name} to ${mv.to}`).join(', ')}`);
  }
  const TABS = [['patch', 'Patch'], ['channels', 'Channels'], ['mounting', 'Mounting']] as const;
</script>

{#if f}
  <Modal title="Patch: {f.name}" {onclose} wide={tab === 'mounting'}>
    <div class="tabs" role="tablist" aria-label="Patch, channels or mounting" use:tablist>
      {#each TABS as [k, label] (k)}<button role="tab" id="fp-tab-{k}" aria-controls="fp-panel" aria-selected={tab === k} class:on={tab === k} onclick={() => (tab = k)}>{label}</button>{/each}
    </div>
    <div id="fp-panel" role="tabpanel" aria-labelledby="fp-tab-{tab}">
    {#if tab === 'patch'}
    <div class="fp">
      <label class="wide">Name <input bind:value={f.name} aria-label="Fixture name" /></label>
      <label>Universe <input type="number" min="0" max="32767" value={f.universe} aria-label="Fixture universe"
        onchange={(e) => { const v = (e.target as HTMLInputElement).valueAsNumber; if (Number.isFinite(v)) { app.checkpoint(); f.universe = Math.max(0, Math.min(32767, Math.round(v))); app.markDirty(0); } }} /></label>
      <label>Address <span class="addr"><input type="number" min="1" max="512" value={f.address} aria-label="Fixture address"
        onchange={(e) => { const v = (e.target as HTMLInputElement).valueAsNumber; if (Number.isFinite(v)) setAddress(Math.round(v)); }} />
        <span class="faint">{wide ? `${wide.length} universes` : n > 1 ? `uses ${f.address} to ${f.address + n - 1}` : 'one channel'}</span></span></label>
      {#if wide}
        <p class="faint wide" role="status">Too big for one universe, so it runs on over universes {wide[0].universe} to {wide[wide.length - 1].universe} with whole pixels on each. Set a box's pixel port to start at universe {wide[0].universe}.</p>
      {:else if f.address + n - 1 > 512}
        <p class="err wide" role="status">Its last {f.address + n - 1 - 512} channel{f.address + n - 1 - 512 > 1 ? 's run' : ' runs'} past 512, the end of the universe: {f.address + n - 1 - 512 > 1 ? 'they do' : 'it does'} nothing.
          {#if free > 0}<button class="ghost link" onclick={() => setAddress(free)}>Move it to {free}</button>{/if}</p>
      {/if}
      {#if overlap.length}
        <p class="err wide" role="status">Shares channels with {overlap.join(', ')}.
          {#if free > 0}<button class="ghost link" onclick={() => setAddress(free)}>Move it to {free}, the next free one</button>{/if}
          {#if makeRoom?.moves.length && !makeRoom.stuck}<button class="ghost link" onclick={moveAfter}>Move the {makeRoom.moves.length === 1 ? 'light' : `${makeRoom.moves.length} lights`} after it up instead</button>{/if}</p>
      {/if}
      <div class="wide dipwrap"><span class="faint">DIP switches (click one to flip it)</span>
        <DipSwitch address={f.address} onchange={setAddress} /></div>
      <!-- another type for this light (a template's PAR swapped for yours): address and place stay -->
      <label class="wide">Type <select value={f.typeId} aria-label="Fixture type" onchange={(e) => app.changeType(f.id, (e.target as HTMLSelectElement).value)}>
        {#each typeChoices as x (x.id)}<option value={x.id}>{typeName(x)}</option>{/each}
      </select></label>
      {#if t && t.modes.length > 1}
        <label class="wide">Mode <select value={f.mode} aria-label="Fixture mode" onchange={(e) => setMode((e.target as HTMLSelectElement).value)}>{#each t.modes as m (m.name)}<option value={m.name}>{m.name} ({m.channels.length} ch)</option>{/each}</select></label>
        <p class="wide faint small">The light must be in the same mode (its menu, DIP switches or RDM). <button class="ghost link" onclick={() => (tab = 'channels')}>Its channels, and what another mode changes</button></p>
      {/if}
      {#if app.kinds[f.id] === 'mover'}
        <p class="wide faint small">How it hangs, invert, swap and the offsets: <button class="ghost link" onclick={() => (tab = 'mounting')}>Mounting</button></p>
      {/if}
      <FixtureSetupRdm id={f.id} />
    </div>
    {:else if tab === 'channels'}
      <FixtureSetupChannels id={f.id} />
    {:else}
      <FixtureSetup id={f.id} />
    {/if}
    </div>
    <div class="row end done"><button class="primary" onclick={onclose}>Done</button></div>
  </Modal>
{/if}

<style>
  .tabs { display: flex; gap: .2rem; margin-bottom: .7rem; }
  .tabs button { padding: .25rem .8rem; font-size: .88rem; }
  .tabs button.on { background: var(--orange); color: #1a1000; border-color: var(--orange); }
  .fp { display: grid; grid-template-columns: 1fr 1fr; gap: .7rem .9rem; width: min(440px, 100%); }
  .wide { grid-column: 1 / -1; }
  label { display: flex; flex-direction: column; gap: .25rem; color: var(--muted); font-size: .85rem; min-width: 0; }
  label input, label select { width: 100%; min-width: 0; color: var(--text); }
  .addr { display: flex; align-items: center; gap: .5rem; } .addr input { width: 5.5em; flex: none; }
  .dipwrap { display: flex; flex-direction: column; align-items: flex-start; gap: .35rem; }
  .err { margin: 0; }
  .small { margin: 0; font-size: .8rem; }
  .link { padding: 0; color: var(--accent); text-decoration: underline; font-size: inherit; min-height: 0; min-width: 0; }
  .end { justify-content: flex-end; }
  .done { margin-top: .8rem; }
</style>
