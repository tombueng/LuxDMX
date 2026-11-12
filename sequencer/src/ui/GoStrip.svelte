<script lang="ts">
  import { cueNumber } from '../model/cuenum';
  // The part of the live view that never moves: GO for a cue list, what's on now and what's
  // next, Release and Blackout. Big enough to hit in the dark.
  import Icon from './Icon.svelte';
  import { app } from '../app.svelte';
  import { ui } from './ui.svelte';
  import { isFogTimer } from '../model/library';
  import { isMachineList } from '../content/busking';

  // the songs to pick for GO: not the fog timers
  const BO_HOLD = 400;
  const stepping = $derived(app.livePage?.go !== false);
  let boArm = $state(0), boFired = false;
  function boStop() { if (boArm) { clearTimeout(boArm); boArm = 0; } }
  // (not the fog timers, nor the machines' own shot lists: those are buttons, not looks)
  const lists = $derived(app.show.cueLists.filter((l) => !isFogTimer(l) && !isMachineList(l, app.isMachineFx)));
  const list = $derived(app.liveList);
  const st = $derived(list ? app.status[list.id] : undefined);
  const now = $derived(st?.running ? list?.cues[st.index] : undefined);
  const next = $derived.by(() => {
    if (!list?.cues.length) return undefined;
    if (!st?.running) return list.cues[0];
    const i = st.index + 1 < list.cues.length ? st.index + 1 : list.end === 'loop' ? 0 : -1;
    return i >= 0 ? list.cues[i] : undefined;
  });
</script>

{#if list}
  <div class="strip" class:looks={!stepping} role="group" aria-label="Playback">
    <!-- a staff page of looks is tapped, not stepped through: no GO into "All off", no Next, no Auto GO -->
    {#if stepping}
    <button class="go" onclick={() => app.go(list.id)} disabled={!list.cues.length} title="Next cue in {list.name} (Space)">
      <span class="gol">GO <Icon name="play" size={20} /></span><span class="gon">{list.name}</span></button>
    <button class="back" onclick={() => app.back(list.id)} disabled={!st?.running || st.index <= 0} title="Previous cue" aria-label="Back"><Icon name="back" size={18} /></button>
    {/if}
    <div class="info">
      <div class="lst">
        {#if lists.length > 1}
          <select value={list.id} onchange={(e) => app.chooseLiveList((e.target as HTMLSelectElement).value)} aria-label="Cue list for GO">
            {#each lists as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
          </select>
        {:else}<span class="muted">{list.name}</span>{/if}
      </div>
      <!-- (said when it changes: a GO from the keyboard says which cue is up) -->
      <div class="now" role="status"><span class="faint">Now</span> <b>{now ? `${cueNumber(list, st!.index)}. ${now.name}` : '(nothing)'}</b></div>
      {#if stepping}<div class="nxt"><span class="faint">Next</span> {next ? `${cueNumber(list, list.cues.indexOf(next))}. ${next.name}` : 'end of the list'}{#if next && now && now.advance.mode !== 'manual'}{' '}<span class="auto-next">goes by itself</span>{/if}</div>{/if}
      <!-- the next cue's note is the standby ("when the lamp goes off"): its own line, readable in a dark booth -->
      {#if next?.note}<div class="standby" title={next.note}>{next.note}</div>{/if}
      {#if st?.running}<div class="bar"><span style="width:{(st.progress ?? 0) * 100}%"></span></div>{/if}
    </div>
    {#if !app.locked && stepping}<button onclick={() => app.release(list.id)} disabled={!st?.running} title="Fade this list out">Release</button>{/if}
    {#if stepping && (!app.locked || app.autoGo > 0)}
    <label class="auto" class:on={app.autoGo > 0} title="GO by itself every few bars, on the beat (with ♪ follow the music, on the music's beat)">
      <span>Auto GO</span>
      <select value={String(app.autoGo)} onchange={(e) => (app.autoGo = +(e.target as HTMLSelectElement).value)} aria-label="Auto GO">
        <option value="0">off</option>{#each [1, 2, 4, 8, 16, 32] as b (b)}<option value={String(b)}>every {b} bar{b > 1 ? 's' : ''}</option>{/each}
      </select>
    </label>
    {/if}
    <span class="grow"></span>
    {@render bo()}
  </div>
{:else}
  <!-- no cue list yet: Blackout still has to be here (it's the only one in Live) -->
  <div class="strip" role="group" aria-label="Playback">
    <span class="faint empty">{app.show.cueLists.length ? 'Only fog timers so far' : 'No cue list yet'}: record a look in Program, and GO plays it here.</span>
    <span class="grow"></span>
    {@render bo()}
  </div>
{/if}

<!-- Blackout. On a page locked for the service it takes holding a moment to switch on (a stray tap
     behind the bar mustn't take the room dark); off is always one tap. -->
{#snippet bo()}
  <button class="bo" class:on={app.blackout} aria-pressed={app.blackout} class:arming={boArm > 0} style="--hold:{BO_HOLD}ms" title={app.locked ? 'Hold to black out, tap to come back' : 'Blackout (B)'}
    onclick={() => { if (boFired) { boFired = false; return; }       // (the click that ends a hold that fired, or a key handled below)
      if (!app.locked || app.blackout) app.blackout = !app.blackout; else ui.toast('Hold Blackout a moment to black out', 2500); }}
    onpointerdown={() => { boFired = false; if (app.locked && !app.blackout) { boArm = setTimeout(() => { boArm = 0; boFired = true; app.blackout = true; }, BO_HOLD) as unknown as number; } }}
    onpointerup={boStop} onpointerleave={boStop} onpointercancel={boStop}
    onkeydown={(e) => {
      if (!app.locked || (e.key !== 'Enter' && e.key !== ' ')) return;
      // locked: held Enter or Space blacks out, a press brings it back; a key's repeat does nothing
      e.preventDefault(); e.stopPropagation(); boFired = true;
      if (e.repeat || boArm) return;
      if (app.blackout) app.blackout = false;
      else boArm = setTimeout(() => { boArm = 0; app.blackout = true; }, BO_HOLD) as unknown as number;
    }}
    onkeyup={boStop}>Blackout</button>
{/snippet}

<style>
  .strip { display: flex; align-items: stretch; gap: .5rem; padding: .45rem; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); }
  .go { background: var(--green); border-color: var(--green); color: #07150b; font-weight: 800; font-size: 1.25rem; padding: .3rem 1.4rem; min-width: 8rem; letter-spacing: .03em; flex-direction: column; gap: 0; }
  .gol { display: inline-flex; align-items: center; gap: .35rem; }
  .gon { font-size: .76rem; font-weight: 600; letter-spacing: 0; opacity: .75; max-width: 9rem; overflow: hidden; text-overflow: ellipsis; }
  .go:hover:not(:disabled) { background: #5be070; }
  .back { padding: .4rem .8rem; }
  .info { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto auto; column-gap: .8rem; align-items: center; min-width: 0; position: relative; padding-bottom: .3rem; }
  .lst { grid-row: 1 / 3; } .lst select { max-width: 11rem; }
  .now, .nxt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .now b { font-size: 1.02rem; }
  .bar { grid-column: 1 / -1; height: 3px; background: var(--line); border-radius: 2px; overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--green); }
  .bo { font-weight: 650; padding: .4rem 1rem; }
  .auto { display: inline-flex; align-items: center; gap: .35rem; font-size: .8rem; color: var(--muted); border: 1px solid var(--line); border-radius: var(--radius-s); padding: 0 .3rem 0 .5rem; }
  .auto.on { border-color: var(--green); color: var(--green); }
  .auto select { border: 0; background: none; padding: .2rem; }
  .bo.on { background: var(--pink); border-color: var(--pink); color: #1a0010; }
  /* Phones: GO, Back and Blackout on the first row, what's on and the rest on the second. */
  @media (max-width: 700px) {
    .strip { flex-wrap: wrap; }
    .go { min-width: 0; flex: 1; }
    .info { order: 5; flex: 1 1 100%; grid-template-columns: auto 1fr; }
    .lst { grid-row: auto; } .lst select { max-width: 7rem; }
    .nxt { display: none; }
    .grow { display: none; }
    .auto { order: 6; }
  }
  .standby { grid-column: 2; color: var(--orange); font-size: .95rem; line-height: 1.25; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .auto-next { font-size: .75rem; color: var(--cyan); border: 1px solid currentColor; border-radius: 999px; padding: 0 .4rem; margin-left: .2rem; }
  .empty { align-self: center; font-size: .85rem; padding-left: .3rem; }
  .bo { position: relative; overflow: hidden; }
  .bo.arming::after { content: ''; position: absolute; left: 0; bottom: 0; height: 3px; width: 100%; background: var(--pink); transform-origin: left; animation: arm var(--hold) linear forwards; }
  @keyframes arm { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  /* a staff page of looks: what's on, big, and Blackout taking the room the GO had on a phone */
  .strip.looks .now { font-size: 1.15rem; }
  @media (max-width: 560px) { .strip.looks .bo { flex: 1; } }
</style>
