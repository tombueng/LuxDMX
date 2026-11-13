<script lang="ts">
  // A "?" that explains a panel. The short line is always there; this holds the longer story.
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { dismiss } from './ui.svelte';
  let { children, label = 'What is this?' }: { children: Snippet; label?: string } = $props();
  let open = $state(false);
  let pop = $state<HTMLDivElement>();
  let shift = $state(0);              // px to move it so it stays on screen
  // (a "?" low on the screen, like the cues' one: the note opens upwards, or scrolls in what room
  // there is, instead of running off the bottom)
  let up = $state(false), maxH = $state<number | null>(null);
  $effect(() => {
    if (!open || !pop) { shift = 0; up = false; maxH = null; return; }
    // (worked out in locals and only written at the end: reading `up` here made the effect depend on
    // what it writes, run again on the moved note and put it back off the screen)
    const r = pop.getBoundingClientRect();
    const s = r.left < 8 ? 8 - r.left : r.right > window.innerWidth - 8 ? window.innerWidth - 8 - r.right : 0;
    const q = pop.parentElement!.getBoundingClientRect();
    const below = window.innerHeight - q.bottom - 12, above = q.top - 12, short = r.height > below, goUp = short && above > below;
    shift = s; up = goUp; maxH = short ? Math.max(120, goUp ? above : below) : null;
  });
</script>

<span class="help">
  <button class="ghost q" aria-label={label} aria-expanded={open} onclick={() => (open = !open)} data-popover-toggle><Icon name="help" size={15} /></button>
  {#if open}
    <div class="pop" class:up role="note" bind:this={pop} style="transform:translateX({shift}px)" style:max-height={maxH ? `${maxH}px` : null} use:dismiss={() => (open = false)}>{@render children()}</div>
  {/if}
</span>

<style>
  .help { position: relative; display: inline-flex; }
  .q { padding: .1rem; }
  .pop { position: absolute; z-index: 40; top: 1.6rem; right: 0; width: min(320px, 80vw); background: var(--panel2); border: 1px solid var(--line2);
         border-radius: var(--radius-s); box-shadow: var(--shadow); padding: .6rem .7rem; font-size: .84rem; line-height: 1.45; color: var(--text); overflow: auto; }
  .pop.up { top: auto; bottom: 1.6rem; }
</style>
