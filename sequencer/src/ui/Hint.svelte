<script lang="ts">
  // A one-line hint at the top of a panel. Shown until someone hides them (the × hides them all;
  // the ⋯ menu brings them back). The longer story is behind each panel's "?".
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { ui } from './ui.svelte';
  let { children }: { children: Snippet } = $props();
  function hide() { ui.help = false; ui.toast('Hints hidden. The ⋯ menu (top right) brings them back.', 4000, { label: 'Undo', run: () => (ui.help = true) }); }
</script>

{#if ui.help}
  <p class="hint tip">{@render children()}<button class="ghost x" onclick={hide} title="Hide these hints" aria-label="Hide hints"><Icon name="close" size={11} /></button></p>
{/if}

<style>
  .tip { display: flex; align-items: flex-start; gap: .3rem; margin: 0; padding: .3rem .4rem .3rem .55rem; border-radius: var(--radius-s); background: #6aa2ff0d; border-left: 2px solid #6aa2ff55; }
  .x { margin-left: auto; padding: .25rem; min-width: 24px; min-height: 24px; flex: none; opacity: .6; }
  .x:hover { opacity: 1; }
</style>
