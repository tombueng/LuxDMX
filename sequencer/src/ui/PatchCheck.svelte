<script lang="ts">
  // Walk through the rig at the venue: one light at a time goes full white (Highlight), with its
  // name, address and DIP switches on screen, so a wrong address shows at once ("that's not
  // PAR 3 lighting up"). Arrows or the buttons step, Auto steps by itself.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import DipSwitch from './DipSwitch.svelte';
  import { app } from '../app.svelte';
  import { typeLabel } from '../model/library';
  import { untrack } from 'svelte';

  let { onclose }: { onclose: () => void } = $props();
  const order = $derived([...app.show.fixtures].sort((a, b) => a.universe - b.universe || a.address - b.address));
  const before = { sel: [...app.selected], hl: app.highlight };
  let solo = $state(true);                       // the others dark, so only the right one lights
  $effect(() => { app.highlightSolo = solo; return () => { app.highlightSolo = false; }; });
  // the light on show, by id: fixing its address re-sorts the list, it stays the one shown
  let curId = $state(untrack(() => order[0]?.id ?? ''));
  let auto = $state(false);
  const i = $derived(Math.max(0, order.findIndex((x) => x.id === curId)));
  const f = $derived(order[i]);
  const t = $derived(f ? app.types.get(f.typeId) : undefined);
  const n = $derived(f ? app.modeOf(f.id)?.channels.length ?? 1 : 1);
  // The address can be fixed right here (what the DIP switches say if the wrong light came on).
  const overlap = $derived(f ? app.show.fixtures.filter((x) => x.id !== f.id && x.universe === f.universe && x.address <= f.address + n - 1 && f.address <= x.address + (app.modeOf(x.id)?.channels.length ?? 1) - 1).map((x) => x.name) : []);

  $effect(() => { if (f) { app.selected = [f.id]; app.highlight = true; } });
  // the dialog sits in a corner, the stage stays usable: a light clicked there becomes the one
  // checked, and the selection (what Highlight lights) is never anything but it
  $effect(() => {
    const sel = app.selected;
    untrack(() => {
      if (sel.length === 1 && sel[0] !== curId && order.some((x) => x.id === sel[0])) { auto = false; curId = sel[0]; }
      else if (f && (sel.length !== 1 || sel[0] !== f.id)) app.selected = [f.id];
    });
  });
  $effect(() => () => { app.selected = before.sel; app.highlight = before.hl; });   // back as it was
  $effect(() => {
    if (!auto) return;
    const t = setInterval(() => step(1, false), 1600);
    return () => clearInterval(t);
  });
  function step(d: number, stopAuto = true) { if (stopAuto) auto = false; if (order.length) curId = order[(i + d + order.length) % order.length].id; }
  // The arrows step through the lights wherever the focus is (also in the address field: an
  // arrow there must never quietly change an address). Space steps too, except on a button or a
  // switch, where it presses that.
  function key(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    // another dialog over this one, or a field elsewhere (a menu, the palette): their keys
    if (document.querySelectorAll('[aria-modal="true"]').length > 1 || (el.closest('input, select, textarea, [role="menu"]') && !el.closest('.pc'))) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === ' ' && el.tagName !== 'INPUT' && el.tagName !== 'BUTTON' && !el.closest('.dip')) { e.preventDefault(); step(1); }
  }
  // the address is only taken when typed and confirmed (Enter, or leaving the field)
  function setAddress(e: Event) {
    const el = e.target as HTMLInputElement, v = Number(el.value);
    if (!f || !Number.isInteger(v) || v < 1 || v > 512) { if (f) el.value = String(f.address); return; }
    if (v !== f.address) { app.checkpoint(); f.address = v; app.markDirty(0); }
  }
  let nextBtn = $state<HTMLButtonElement>();
  $effect(() => { if (nextBtn) queueMicrotask(() => nextBtn?.focus()); });      // not the address field
</script>

<svelte:window onkeydown={key} />

<Modal title="Check the patch" {onclose} dock>
  {#if f}
    <div class="pc">
      <p class="faint">Each light goes full white in turn. If a different one lights up, its address is off.</p>
      {#if app.output !== 'live'}
        <!-- blind, nothing would light: said, with the way out -->
        <p class="blindnote">You're blind: the lights don't get this. <button onclick={() => void app.askOnStage()}>Send to the stage…</button></p>
      {/if}
      <div class="big">
        <span class="k">{i + 1} / {order.length}</span>
        <h3>{f.name}</h3>
        <span class="faint">{t ? typeLabel(t) : f.typeId}{n > 1 ? ` · ${n} channels` : ''}</span>
        <span class="addr">Universe {f.universe} · address
          <input type="text" inputmode="numeric" value={f.address} aria-label="Address of {f.name}"
                 onchange={setAddress} onkeydown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />{#if n > 1}<span class="faint">uses {f.address} to {f.address + n - 1}</span>{/if}</span>
        <DipSwitch address={f.address} onchange={(a) => { app.checkpoint(); f.address = a; app.markDirty(0); }} />
        {#if overlap.length}<span class="err">Shares channels with {overlap.join(', ')}</span>{/if}
        {#if app.caps(f.id).fog}<span class="faint">A fog or haze machine isn't switched on here (it would fill the room): check it with the Fog button on the live page.</span>{/if}
      </div>
      <label class="ck"><input type="checkbox" bind:checked={solo} /> The other lights dark</label>
      <div class="row nav">
        <button onclick={() => step(-1)} aria-label="Previous light"><Icon name="left" />Back</button>
        <button class:on={auto} onclick={() => (auto = !auto)} aria-pressed={auto}><Icon name={auto ? 'stop' : 'play'} />Auto</button>
        <button class="primary" onclick={() => step(1)} aria-label="Next light" bind:this={nextBtn}>Next<Icon name="right" /></button>
      </div>
    </div>
  {:else}
    <p class="muted">No lights in the show yet.</p>
  {/if}
</Modal>

<style>
  .pc { display: flex; flex-direction: column; gap: .8rem; }
  .pc > .faint { margin: 0; }
  .blindnote { margin: 0; color: #9fc0ff; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .big { display: flex; flex-direction: column; align-items: center; gap: .35rem; padding: 1rem; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel2); text-align: center; }
  .big h3 { margin: 0; font-size: 1.6rem; }
  .k { font-size: .76rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .addr { font-size: 1rem; display: inline-flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .addr input { width: 4.6em; font-size: 1.15rem; font-weight: 700; text-align: center; }
  .ck { display: flex; align-items: center; gap: .4rem; justify-content: center; color: var(--muted); }
  .nav { justify-content: center; gap: .5rem; }
</style>
