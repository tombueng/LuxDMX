<script lang="ts">
  // A "?" that explains a panel. The short line is always there; this holds the longer story.
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { dismiss } from './ui.svelte';
  let { children, label = 'What is this?' }: { children: Snippet; label?: string } = $props();
  let open = $state(false);
  let pop = $state<HTMLDivElement>();
  let shift = $state(0);              // px to move it so it stays on screen
  $effect(() => {
    if (!open || !pop) { shift = 0; return; }
    const r = pop.getBoundingClientRect();
    shift = r.left < 8 ? 8 - r.left : r.right > window.innerWidth - 8 ? window.innerWidth - 8 - r.right : 0;
  });
</script>

<span class="help">
  <button class="ghost q" aria-label={label} aria-expanded={open} onclick={() => (open = !open)} data-popover-toggle><Icon name="help" size={15} /></button>
  {#if open}
    <div class="pop" role="note" bind:this={pop} style="transform:translateX({shift}px)" use:dismiss={() => (open = false)}>{@render children()}</div>
  {/if}
</span>

<style>
  .help { position: relative; display: inline-flex; }
  .q { padding: .1rem; }
  .pop { position: absolute; z-index: 40; top: 1.6rem; right: 0; width: min(320px, 80vw); background: var(--panel2); border: 1px solid var(--line2);
         border-radius: var(--radius-s); box-shadow: var(--shadow); padding: .6rem .7rem; font-size: .84rem; line-height: 1.45; color: var(--text); }
</style>
