<script lang="ts">
  // How hard the page works and whether the DMX output keeps its time, as one small chip; open, the
  // numbers and the drawing's quality (perf/load.svelte.ts: the output always comes first, the
  // drawing gives way when it would make the output late).
  import { load, LEVEL_NAME, type Level } from '../perf/load.svelte';
  import { app } from '../app.svelte';
  import { dismiss } from './ui.svelte';

  let open = $state(false);
  // the DMX output's timing: the output thread's own (output/thread.ts), or this page's frames when
  // it sends itself (no thread: an old browser)
  const threaded = $derived(app.thread.running);
  const out = $derived(threaded ? app.thread.stats : { rate: load.rate, worst: load.worst, late: load.late });
  // the output's state in a word: on time, a few late frames, or struggling
  const ok = $derived(out.late === 0 ? 'ok' : out.late <= 3 ? 'some' : 'late');
  const sending = $derived(app.bridges.length > 0);
</script>

<span class="lm">
  <button class="ghost chip {ok}" data-popover-toggle aria-expanded={open} onclick={() => (open = !open)}
          aria-label="Load and drawing quality" title="How hard this page works, and whether the DMX output keeps its time. Click for the drawing quality.">
    <span class="dot"></span>{load.cpu}%{#if load.lowered}<span class="down" aria-hidden="true">▾</span>{/if}
  </button>
  {#if open}
    <div class="pop" role="dialog" aria-label="Load and quality" use:dismiss={() => (open = false)}>
      <dl>
        <dt>DMX output</dt>
        <dd class={ok}>{out.rate} frames a second{#if out.worst}, longest gap {out.worst} ms{/if}{#if out.late} · {out.late} late in 5 s{/if}{#if !sending} (no box: worked out all the same){/if}</dd>
        <dt></dt>
        <dd class="faint">{threaded ? 'On a thread of its own: drawing can\'t hold it up.' : 'Sent by this page (no thread here): drawing gives way to it.'}</dd>
        <dt>This page</dt>
        <dd>{load.cpu}% of its time</dd>
        <dt>Graphics card</dt>
        <dd>{load.gpu === null ? 'this browser doesn\'t say' : `${load.gpu} ms a 3D frame`}</dd>
      </dl>
      <label class="q">Drawing quality <b>{LEVEL_NAME[load.quality]}</b>
        <input type="range" min="0" max="2" step="1" value={load.quality} oninput={(e) => load.setQuality(+(e.target as HTMLInputElement).value as Level)}
               aria-valuetext={LEVEL_NAME[load.quality]} />
      </label>
      <p class="faint">{#if load.lowered}Drawn at {LEVEL_NAME[load.level]}{load.level2d < load.level ? ` (the plan at ${LEVEL_NAME[load.level2d]})` : ''}{load.uiEvery > 1 ? `, the stage pictures every ${load.uiEvery}th frame` : ''} right now: the DMX output comes first.{:else}The DMX output always comes first: when drawing would make it late, the stage pictures update less often and draw simpler, and come back up after.{/if}</p>
    </div>
  {/if}
</span>

<style>
  .lm { position: relative; display: inline-flex; }
  .chip { display: inline-flex; align-items: center; gap: .3rem; font-size: .76rem; font-variant-numeric: tabular-nums; padding: .1rem .5rem; border-radius: 999px; border: 1px solid var(--line2); color: var(--muted); min-height: 0; }
  .dot { width: .5rem; height: .5rem; border-radius: 50%; background: var(--green); }
  .chip.some .dot { background: var(--orange); }
  .chip.late .dot { background: var(--pink, #ff4d6d); }
  .down { color: var(--orange); }
  .pop { position: absolute; left: 0; top: 1.9rem; z-index: 60; width: 290px; display: flex; flex-direction: column; gap: .5rem; padding: .7rem; background: var(--panel2); border: 1px solid var(--line2); border-radius: var(--radius); box-shadow: var(--shadow); }
  dl { display: grid; grid-template-columns: auto 1fr; gap: .2rem .6rem; margin: 0; font-size: .85rem; }
  dt { color: var(--muted); } dd { margin: 0; font-variant-numeric: tabular-nums; }
  dd.some { color: var(--orange); } dd.late { color: var(--pink, #ff4d6d); }
  .q { display: flex; flex-direction: column; gap: .25rem; font-size: .85rem; color: var(--muted); }
  .q b { color: var(--text); }
  .faint { margin: 0; font-size: .78rem; }
  @media (pointer: coarse) { .chip { min-height: 44px; } }
</style>
