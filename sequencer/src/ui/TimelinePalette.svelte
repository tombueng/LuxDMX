<script lang="ts">
  // The timeline's palette: what can go on the tracks, to drag there or tap (it goes where the
  // playhead is): the cues of each list, the effects, the moments the rig can do, the crowd.
  import { app } from '../app.svelte';
  import { cueNumber } from '../model/cuenum';
  import type { CueList } from '../model/types';
  import type { TimelineAction } from '../model/timeline';
  import Icon from './Icon.svelte';
  import { cueMarkOf } from './risk';
  import { ARMED_ONLY, BURSTS, CROWD, DT, type Chip } from './timeline/chips';

  let { lists, built, ontap }: { lists: CueList[]; built: boolean; ontap: (c: Chip) => void } = $props();

  // (the machine moments the rig can do: one for a confetti cannon it hasn't got did nothing. A strobe
  // or blinder hit uses any light)
  const bursts = $derived.by(() => {
    const attrs = new Set(app.show.fixtures.flatMap((f) => app.modeOf(f.id)?.channels.map((c) => c.attr) ?? []));
    const fog = app.show.fixtures.some((f) => app.caps(f.id).fog);
    return BURSTS.filter((b) => b.attr === 'strobe' || b.attr === 'blinder' || (b.attr === 'fog' ? fog : attrs.has(b.attr)));
  });
  function drag(e: DragEvent, c: Chip) { e.dataTransfer?.setData(DT, JSON.stringify(c)); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'; }
</script>

  {#each built ? lists : [] as l (l.id)}
    <h3>{l.name}</h3>
    <div class="chips">
      {#each l.cues as c, i (c.id)}
        {@const chip = { kind: 'cue', list: l.id, cue: c.id } as Chip}
        {@const risk = cueMarkOf(app.show, c, app.showRev)}
        <button class="chip" class:risky={!!risk} draggable="true" ondragstart={(e) => drag(e, chip)} onclick={() => ontap(chip)}
                title="{cueNumber(l, i)}. {c.name}: drag onto the timeline, or tap: at the playhead{risk === 'hazard' ? '. Fires a machine (flames, sparks or CO2) while armed' : risk === 'once' ? '. Fires confetti while armed' : risk === 'winch' ? '. Moves a winch (scenery) while armed' : ''}">{#if risk === 'hazard'}<Icon name="warn" size={11} />{:else if risk === 'once'}1× {:else if risk === 'winch'}⇅ {/if}<span class="t">{cueNumber(l, i)}. {c.name}</span></button>
      {/each}
      {#if !l.cues.length}<span class="faint">No cues yet</span>{/if}
    </div>
  {/each}
  {#if app.show.effects.length}
    <h3>Effects</h3>
    <div class="chips">
      {#each app.show.effects as e (e.id)}
        {@const chip = { kind: 'fx', effect: e.id } as Chip}
        <button class="chip fx" draggable="true" ondragstart={(ev) => drag(ev, chip)} onclick={() => ontap(chip)} title="{e.name}: a bar that runs it from where it starts to where it ends. Drag onto the timeline, or tap: at the playhead">{e.name}</button>
      {/each}
    </div>
  {/if}
  <h3>Moments</h3>
  <!-- (only the machines wait for Arm: a strobe, blinder, fog or bubble hit fires on Safe too; it said all of them did) -->
  <p class="note">Moments only fire while playing forward; confetti, flames, sparks and CO2 only with the machines armed.</p>
  <div class="chips">
    {#each bursts as b (b.attr)}
      {@const chip = { kind: 'burst', attr: b.attr, s: b.s } as Chip}
      <button class="chip mo" draggable="true" ondragstart={(e) => drag(e, chip)} onclick={() => ontap(chip)} title="{b.label} for {b.s} s{ARMED_ONLY.includes(b.attr) ? ', only while armed' : ''}. Drag onto the timeline, or tap: at the playhead">{b.label}</button>
    {/each}
    {#each [{ label: 'Blackout', a: { do: 'blackout', on: true } }, { label: 'Blackout off', a: { do: 'blackout', on: false } }, { label: 'Everything off', a: { do: 'off' } }] as m (m.label)}
      {@const chip = { kind: 'act', a: m.a as TimelineAction } as Chip}
      <button class="chip mo" draggable="true" ondragstart={(e) => drag(e, chip)} onclick={() => ontap(chip)} title="{m.label} at that moment. Drag onto the timeline, or tap: at the playhead">{m.label}</button>
    {/each}
  </div>
  <h3>Crowd</h3>
  <div class="chips">
    {#each CROWD as c (c.label)}
      {@const chip = { kind: 'crowd', a: c.a, len: c.len } as Chip}
      <button class="chip cr" draggable="true" ondragstart={(e) => drag(e, chip)} onclick={() => ontap(chip)} title="{c.tip}. Drag onto the timeline, or tap: at the playhead">{c.label}</button>
    {/each}
  </div>

<style>
  h3 { margin: .5rem 0 0; font-size: .74rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .note { margin: 0; font-size: .74rem; color: var(--faint); }
  .chips { display: flex; flex-wrap: wrap; gap: .25rem; }
  /* (a long name stops at the panel's edge, the whole of it in the title) */
  .chip { cursor: grab; font-size: .8rem; padding: .15rem .5rem; border-radius: 999px; border: 1px solid var(--line2); background: var(--panel2); color: var(--text); min-height: 0;
    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip .t { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .chip.fx { border-color: #ffaa1c66; } .chip.mo { border-color: #f33abc66; } .chip.cr { border-color: #7fc8ff66; }
  .chip.risky { color: var(--orange); display: inline-flex; align-items: center; gap: .2rem; }
</style>
