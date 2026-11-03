<script lang="ts">
  // Find out what a fixture's channels do by trying them on the real thing. Cheap fixtures ship
  // with wrong channel tables, so testing beats typing a PDF in.
  import { untrack } from 'svelte';
  import Modal from './Modal.svelte';
  import { app } from '../app.svelte';
  import { ATTR_GROUPS } from './attrs';
  import type { Channel, ChannelAttr } from '../model/types';

  let { onclose, onfinish, count: initialCount = 8, universe: u0 = 0, address: a0 = 1 }:
    { onclose: () => void; onfinish: (channels: Channel[]) => void; count?: number; universe?: number; address?: number } = $props();

  // Starting values only; the user edits them in the setup step.
  let universe = $state(untrack(() => u0)), address = $state(untrack(() => a0)), count = $state(untrack(() => initialCount));
  let step = $state(-1);                 // -1 = setup
  let level = $state(255);
  let found = $state<Channel[]>([]);
  // What every channel sends while testing: the one under test at the slider, identified dimmers
  // and shutters at the value that made the light visible, everything else at 0.
  let hold = $state<Record<number, number>>({});

  $effect(() => {
    if (step < 0) { app.testOverlay = null; return; }
    const v = Array.from({ length: count }, (_, i) => (i === step ? level : hold[i] ?? 0));
    app.testOverlay = { universe, address, values: v };
  });
  $effect(() => () => { app.testOverlay = null; });   // closing the wizard lets go of the fixture

  function start() { found = []; hold = {}; step = 0; level = 255; }
  function pick(attr: ChannelAttr | 'nothing') {
    const ch: Channel = { name: `Channel ${step + 1}`, attr: attr === 'nothing' ? 'raw' : attr };
    if (attr === 'nothing') ch.name = `Channel ${step + 1} (unused)`;
    // A shutter stays where the slider is when you pick it (where the light was on and steady).
    // Control and unknown channels rest at 0: on most fixtures that's "nothing special", while a
    // high value can mean reset, lamp off or a program running.
    if (ch.attr === 'shutter') { hold = { ...hold, [step]: level }; ch.default = level; }
    if (ch.attr === 'control' || (ch.attr === 'raw' && attr !== 'nothing')) { hold = { ...hold, [step]: 0 }; ch.default = 0; }
    if (ch.attr === 'intensity') hold = { ...hold, [step]: 255 };
    if (ch.attr === 'pan' || ch.attr === 'tilt') { ch.default = 128; hold = { ...hold, [step]: 128 }; }
    const named = (ATTR_GROUPS.flatMap((g) => g.attrs).find(([a]) => a === ch.attr)?.[1] ?? 'Channel').split(' (')[0];
    if (attr !== 'nothing') ch.name = named;
    found = [...found.slice(0, step), ch];
    next();
  }
  function next() {
    if (step + 1 >= count) { onfinish(found); onclose(); return; }
    step += 1; level = 255;
  }
  function back() { if (step > 0) { step -= 1; level = 255; found = found.slice(0, step); const h = { ...hold }; delete h[step]; hold = h; } }
</script>

<Modal title="Find the channels" {onclose}>
  {#if step < 0}
    <p>Set the fixture to DMX mode and note its start address. The wizard switches on one channel at a time, you say what the light does.</p>
    <div class="row">
      <label>Universe <input type="number" min="0" bind:value={universe} style="width:5em" /></label>
      <label>Start address <input type="number" min="1" max="512" bind:value={address} style="width:5em" /></label>
      <label>Channels <input type="number" min="1" max="64" bind:value={count} style="width:4em" /></label>
    </div>
    <p class="muted">The number of channels is in the manual, or on the fixture's display (e.g. "8CH"). The output goes to the boxes connected at the top.</p>
    <p class="warn">Not for fog machines, flames, sparks, CO2 or confetti: each channel goes to full while you try it. Their channel tables come from the manual.</p>
    {#if app.output !== 'live'}
      <p class="blindnote">You're blind: nothing reaches the fixture. <button onclick={() => void app.askOnStage()}>Send to the stage…</button></p>
    {/if}
    <button class="primary" onclick={start} disabled={!app.bridges.some((b) => b.state === 'ready') || app.output !== 'live'}>Start</button>
    {#if !app.bridges.some((b) => b.state === 'ready')}<span class="err">Connect a LuxDMX first (top bar).</span>{/if}
  {:else}
    <div class="row top">
      <b>Channel {step + 1} of {count}</b> <span class="muted">(DMX {address + step})</span>
      <span style="flex:1"></span>
      <button onclick={back} disabled={step === 0}>◀ Back</button>
    </div>
    <label class="lvl">Value <input type="range" min="0" max="255" bind:value={level} aria-label="Test value" /> <b>{level}</b></label>
    <p class="muted">Move the slider and watch the fixture. What does it do? (For a shutter: leave the slider where the light is on and steady, that's what it will rest at.)</p>
    <!-- (not the machines: the wizard isn't for them, their channels come from the manual) -->
    {#each ATTR_GROUPS.filter((g) => g.label !== 'Machines') as g (g.label)}
      <div class="grp"><span class="muted">{g.label}</span>
        {#each g.attrs as [a, label] (a)}<button onclick={() => pick(a)}>{label}</button>{/each}
      </div>
    {/each}
    <div class="grp"><button onclick={() => pick('nothing')}>Nothing happens</button></div>
    {#if found.length}<p class="muted">So far: {found.map((c) => c.name).join(', ')}</p>{/if}
  {/if}
</Modal>

<style>
  label { color: var(--muted); font-size: .9rem; }
  .warn { color: var(--orange); font-size: .9rem; }
  .blindnote { color: #9fc0ff; font-size: .9rem; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .top { margin-bottom: .5rem; }
  .lvl { display: flex; align-items: center; gap: .6rem; } .lvl input { flex: 1; accent-color: var(--orange); }
  .grp { display: flex; flex-wrap: wrap; gap: .3rem; align-items: center; margin: .35rem 0; }
  .grp .muted { width: 5.5rem; }
  .err { color: var(--pink); font-size: .85rem; margin-left: .5rem; }
</style>
