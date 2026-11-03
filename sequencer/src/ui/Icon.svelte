<script lang="ts">
  import { ICONS } from './icons';
  let { name, size = 16, title = '' }: { name: string; size?: number; title?: string } = $props();
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden={title ? undefined : 'true'} role={title ? 'img' : undefined}>
  {#if title}<title>{title}</title>{/if}
  {@html ICONS[name] ?? ICONS.other}
</svg>

<style>.icon { flex: none; vertical-align: -0.18em; }</style>
