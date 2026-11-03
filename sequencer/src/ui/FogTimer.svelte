<script lang="ts">
  // A fog timer in one small dialog: how often, how long, which machines. It becomes a looping cue
  // list (so a cue can start it too) with a button on the live page.
  import Modal from './Modal.svelte';
  import { app, fogPause, MAX_FOG, newId } from '../app.svelte';
  import { ui } from './ui.svelte';

  let { onclose }: { onclose: () => void } = $props();
  const machines = app.show.fixtures.filter((f) => app.caps(f.id).fog);
  // Not started by default: fog in a room is something to switch on knowingly.
  let minutes = $state(2), seconds = $state(3), start = $state(false);
  const burst = $derived(Math.max(0.5, Math.min(MAX_FOG, seconds || 0)));
  const pause = $derived(fogPause(minutes || 0, burst));
  let pick = $state<string[]>(ui.fogFor?.length ? [...ui.fogFor] : machines.map((f) => f.id));
  const ok = $derived(minutes > 0 && seconds > 0 && pick.length > 0);

  function make(e: Event) {
    e.preventDefault();
    if (!ok) return;
    const id = app.makeFogTimer(minutes, seconds, pick);
    if (!id) return;
    // a button for it: the generated page lists every cue list anyway; a page of your own gets one
    if (app.show.pages.length) {
      const p = app.show.pages.find((x) => x.id === app.page) ?? app.show.pages[0];
      // next to the fog button (or the flash and fog heading), not at the bottom of the page
      const at = Math.max(p.widgets.findIndex((w) => w.type === 'fog'), p.widgets.findIndex((w) => w.id === 'h-sfx'));
      p.widgets.splice(at >= 0 ? at + 1 : p.widgets.length, 0, { id: newId('w'), type: 'list', list: id, action: 'toggle', label: `Fog every ${minutes} min` });
    }
    if (start) app.engine.start(id);
    app.markDirty(0);
    onclose();
    ui.toast(start ? `Fogging ${burst} s every ${minutes} min. Its button on the live page stops it; it's a cue list, so a cue can start it too.`
      : `Fog timer made: ${burst} s every ${minutes} min. Switch it on with its button on the live page (or from a cue).`, 7000);
  }
</script>

<Modal title="Fog timer" {onclose}>
  <form class="ft" onsubmit={make} novalidate>
    <div class="two">
      <label>Every <span class="u"><input type="number" min="0.05" step="any" bind:value={minutes} aria-label="Every how many minutes" onblur={() => { if (!(minutes > 0)) minutes = 2; }} /> min</span></label>
      <label>Fog for <span class="u"><input type="number" min="0.5" max={MAX_FOG} step="any" bind:value={seconds} aria-label="Fog for how many seconds" onblur={() => { seconds = Math.max(0.5, Math.min(MAX_FOG, seconds || 3)); }} /> s</span></label>
    </div>
    {#if ok}<p class="sum" aria-live="polite">Fog {burst} s, then {Math.round(pause)} s off, over and over{seconds > MAX_FOG ? ` (never more than ${MAX_FOG} s at a time)` : ''}{pause > minutes * 60 - burst + 0.5 ? ' (a machine needs its pause: at least 15 s, and as long as the fog)' : ''}.</p>{/if}
    {#if machines.length > 1}
      <fieldset><legend>Machines</legend>
        {#each machines as f (f.id)}
          <label class="ck"><input type="checkbox" checked={pick.includes(f.id)} onchange={(e) => { pick = (e.target as HTMLInputElement).checked ? [...pick, f.id] : pick.filter((x) => x !== f.id); }} /> {f.name}</label>
        {/each}
      </fieldset>
    {/if}
    <label class="ck"><input type="checkbox" bind:checked={start} /> Start it now</label>
    <p class="faint">Fog machines need a few minutes to heat up; a short burst every couple of minutes keeps a light haze without filling the room.</p>
    <div class="row end">
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary" disabled={!ok}>Make the timer</button>
    </div>
  </form>
</Modal>

<style>
  .ft { display: flex; flex-direction: column; gap: .7rem; width: min(380px, 100%); }
  .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: .6rem; }
  label { display: flex; flex-direction: column; gap: .25rem; color: var(--muted); }
  .u { display: flex; align-items: center; gap: .3rem; color: var(--muted); } .u input { flex: 1; min-width: 0; }
  .ck { flex-direction: row; align-items: center; gap: .4rem; color: var(--text); }
  fieldset { border: 1px solid var(--line); border-radius: var(--radius-s); padding: .4rem .6rem; display: flex; flex-wrap: wrap; gap: .3rem 1rem; }
  legend { color: var(--muted); font-size: .82rem; padding: 0 .3rem; }
  .faint, .sum { margin: 0; }
  .sum { font-size: .88rem; }
  .end { justify-content: flex-end; }
</style>
