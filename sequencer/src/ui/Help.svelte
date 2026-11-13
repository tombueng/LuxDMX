<script lang="ts">
  // A "?" that explains a panel. The short line is always there; this holds the longer story.
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { dismiss } from './ui.svelte';
  let { children, label = 'What is this?' }: { children: Snippet; label?: string } = $props();
  let open = $state(false);
  let pop = $state<HTMLDivElement>();
  let btn = $state<HTMLButtonElement>();
  // Placed on the window, not in its panel: a narrow panel (the timeline's list) cut it off on the
  // right. Under the "?", or over it when there's more room there (the cues' one, low down), kept
  // inside the window, and scrolling in what room there is.
  let pos = $state<{ left: number; top?: number; bottom?: number; maxH: number; w: number } | null>(null);
  $effect(() => {
    if (!open || !pop || !btn) { pos = null; return; }
    const q = btn.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(320, vw - 16), h = pop.scrollHeight;
    const below = vh - q.bottom - 12, above = q.top - 12, up = h > below && above > below;
    const left = Math.max(8, Math.min(vw - 8 - w, q.right - w));
    pos = up ? { left, bottom: vh - q.top + 4, maxH: Math.max(120, above), w } : { left, top: q.bottom + 4, maxH: Math.max(120, below), w };
  });
</script>

<span class="help">
  <button bind:this={btn} class="ghost q" aria-label={label} aria-expanded={open} onclick={() => (open = !open)} data-popover-toggle><Icon name="help" size={15} /></button>
  {#if open}
    <div class="pop" class:up={pos?.bottom !== undefined} role="note" bind:this={pop} use:dismiss={() => (open = false)}
         style:visibility={pos ? 'visible' : 'hidden'} style:left={pos ? `${pos.left}px` : null} style:top={pos?.top !== undefined ? `${pos.top}px` : null}
         style:bottom={pos?.bottom !== undefined ? `${pos.bottom}px` : null} style:max-height={pos ? `${pos.maxH}px` : null} style:width={pos ? `${pos.w}px` : null}>{@render children()}</div>
  {/if}
</span>

<style>
  .help { position: relative; display: inline-flex; }
  .q { padding: .1rem; }
  .pop { position: fixed; z-index: 60; top: 0; left: 0; width: min(320px, 80vw); background: var(--panel2); border: 1px solid var(--line2);
         border-radius: var(--radius-s); box-shadow: var(--shadow); padding: .6rem .7rem; font-size: .84rem; line-height: 1.45; color: var(--text); overflow: auto;
         text-align: left; font-weight: 400; text-transform: none; letter-spacing: normal; }
  .pop.up { top: auto; }
</style>
