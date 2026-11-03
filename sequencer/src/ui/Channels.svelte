<script lang="ts">
  // Every channel of the selected fixture(s), with its live value: the way to reach anything the
  // attribute controls don't cover (gobo shake, a macro, the lamp). Values set here go into the
  // programmer as raw channels and are recorded with the cue like everything else.
  import { app } from '../app.svelte';
  import ValueEdit from './ValueEdit.svelte';
  import { ATTR_LABEL } from './attrs';

  const sel = $derived(app.show.fixtures.filter((f) => app.selected.includes(f.id)));
  // Only when every selected fixture has the same layout: then channel N means the same everywhere.
  const same = $derived(sel.length > 0 && sel.every((f) => f.typeId === sel[0].typeId && f.mode === sel[0].mode));
  const mode = $derived(same ? app.modeOf(sel[0].id) : undefined);
  const first = $derived(sel[0]);
  const live = (i: number) => (first ? app.frames.get(first.universe)?.[first.address - 1 + i] ?? 0 : 0);
  const held = (i: number) => app.programmer[first?.id ?? '']?.raw?.[String(i)];
  let open = $state(false);
</script>

{#if sel.length}
  <details class="sec" id="pg-all-ch" bind:open>
    <summary>All channels {#if !same}<span class="muted">(select fixtures of one type)</span>{/if}</summary>
    {#if open && mode}
      <div class="chs">
        {#each mode.channels as c, i (i)}
          <div class="ch" class:held={held(i) !== undefined}>
            <span class="muted n">{first.address + i}</span>
            <span class="name" title={ATTR_LABEL[c.attr] ?? c.attr}>{c.name}</span>
            {#if c.ranges?.length}
              <select aria-label="{c.name} range" onchange={(e) => { const r = c.ranges![+(e.target as HTMLSelectElement).value]; if (r) app.setRaw(i, Math.round((r.from + r.to) / 2)); }}>
                <option value="">{c.ranges.find((r) => r.from <= live(i) && live(i) <= r.to)?.label ?? '…'}</option>
                {#each c.ranges as r, ri (ri)}<option value={ri}>{r.label} ({r.from}–{r.to})</option>{/each}
              </select>
            {/if}
            <input type="range" min="0" max="255" value={live(i)} aria-label="{c.name} value"
                   oninput={(e) => app.setRaw(i, +(e.target as HTMLInputElement).value)} />
            <b class="v"><ValueEdit text={String(live(i))} value={live(i)} min={0} max={255} unit="DMX" label="{c.name} value" onset={(v) => app.setRaw(i, Math.round(v))} /></b>
            {#if held(i) !== undefined}<button class="x" title="Let go of this channel" onclick={() => app.setRaw(i, undefined)}>×</button>{/if}
          </div>
        {/each}
      </div>
    {/if}
  </details>
{/if}

<style>
  summary { cursor: pointer; font-size: .9rem; margin-bottom: .3rem; }
  .chs { display: flex; flex-direction: column; gap: .15rem; max-height: 50vh; overflow: auto; }
  .ch { display: grid; grid-template-columns: 2.2rem 1fr auto; gap: .1rem .4rem; align-items: center; font-size: .82rem; padding: .1rem .2rem; border-radius: 4px; }
  .ch.held { background: #ffaa1c14; }
  .ch select { grid-column: 2 / 4; font-size: .78rem; padding: .1rem; }
  .ch input[type=range] { grid-column: 2; width: 100%; accent-color: var(--orange); padding: 0; }
  .n { grid-row: span 2; } .name { grid-column: 2 / 4; }
  .v { min-width: 2rem; text-align: right; }
  .x { border: 0; background: none; color: var(--muted); padding: 0 .2rem; }
</style>
