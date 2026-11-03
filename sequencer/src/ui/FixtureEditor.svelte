<script lang="ts">
  // Make or adjust a fixture type: the channel table from the manual, or found live with the wizard.
  import { untrack } from 'svelte';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import ChannelWizard from './ChannelWizard.svelte';
  import { app, newId } from '../app.svelte';
  import { ATTR_GROUPS } from './attrs';
  import type { Channel, FixtureType } from '../model/types';

  let { type, onclose, onsaved }: { type?: FixtureType; onclose: () => void; onsaved: (id: string) => void } = $props();

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
  function save() {
    err = '';
    if (!t.model.trim()) { err = 'Give it a name.'; return; }
    if (t.modes.some((m) => !m.channels.length)) { err = 'Every mode needs at least one channel.'; return; }
    if (new Set(t.modes.map((m) => m.name)).size !== t.modes.length) { err = 'Two modes have the same name.'; return; }
    for (const m of t.modes) for (const c of m.channels) if (c.ranges && !c.ranges.length) delete c.ranges;
    app.saveType($state.snapshot(t) as FixtureType);
    onsaved(t.id);
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
      <thead><tr><th>#</th><th>Name</th><th>Does</th><th title="Low byte of a 16-bit pair">Fine</th><th>Default</th><th title="Named value ranges">Values</th><th><span class="sr-only">Move or remove</span></th></tr></thead>
      <tbody>
        {#each mode.channels as c, i (i)}
          <tr>
            <td class="muted">{i + 1}</td>
            <td><input bind:value={c.name} aria-label="Channel {i + 1} name" /></td>
            <td><select bind:value={c.attr} aria-label="Channel {i + 1} function">
              {#each ATTR_GROUPS as g (g.label)}<optgroup label={g.label}>{#each g.attrs as [a, l] (a)}<option value={a}>{l}</option>{/each}</optgroup>{/each}
            </select></td>
            <td><input type="checkbox" checked={!!c.fine} onchange={(e) => (c.fine = (e.target as HTMLInputElement).checked || undefined)} /></td>
            <td><input type="number" min="0" max="255" value={c.default ?? 0} oninput={(e) => (c.default = +(e.target as HTMLInputElement).value || undefined)} style="width:4.2em" /></td>
            <td><button class="ghost rg" onclick={() => (openRanges = openRanges === i ? null : i)} aria-expanded={openRanges === i}
                        title="Named value ranges: gobo slots, strobe, shutter open...">{c.ranges?.length ? `${c.ranges.length} named` : 'add'}<Icon name={openRanges === i ? 'down' : 'right'} size={12} /></button></td>
            <td class="tools"><button class="ghost x" onclick={() => move(i, -1)} disabled={i === 0} title="Move up" aria-label="Move channel {i + 1} up"><Icon name="up" size={14} /></button><button class="ghost x" onclick={() => move(i, 1)} disabled={i === mode.channels.length - 1} title="Move down" aria-label="Move channel {i + 1} down"><Icon name="down" size={14} /></button>
              <button class="ghost x danger" onclick={() => mode.channels.splice(i, 1)} title="Remove this channel" aria-label="Remove channel {i + 1}"><Icon name="trash" size={14} /></button></td>
          </tr>
          {#if openRanges === i}
            <tr><td></td><td colspan="6">
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
    {#if !mode.channels.length}
      <div class="start">
        <p><b>No channels yet.</b> Two ways to get them:</p>
        <ol>
          <li><b>Find them on the fixture</b>: patch it, then the app turns each channel up in turn and you say what the light did. No manual needed.</li>
          <li><b>From the manual</b>: add a channel per row of its DMX table and pick what each does.</li>
        </ol>
        <button class="primary" onclick={() => (wizard = true)}>Find the channels on the fixture…</button>
      </div>
    {/if}
    <div class="row foot">
      <button onclick={addChannel}>+ Channel</button>
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
  .start { border: 1px dashed var(--line2); border-radius: var(--radius); padding: .7rem .9rem; margin: .4rem 0; color: var(--muted); }
  .start ol { margin: .3rem 0 .6rem; padding-left: 1.2rem; }
</style>
