<script lang="ts">
  // A value you can also type: the number next to a slider is a button; a click (or Enter) turns it
  // into a field, Enter sets what you typed, Esc leaves it. For exact values ("127", "pan 50 %")
  // that a slider makes fiddly.
  let { text, value, min = 0, max = 100, unit = '%', label, onset }: {
    text: string; value: number | undefined; min?: number; max?: number; unit?: string; label: string; onset: (v: number) => void;
  } = $props();
  let editing = $state(false);
  let field = $state<HTMLInputElement>();
  $effect(() => { if (editing) queueMicrotask(() => { field?.focus(); field?.select(); }); });
  function done(keep: boolean) {
    if (!editing) return;
    const v = field?.valueAsNumber;
    editing = false;
    if (keep && v !== undefined && Number.isFinite(v)) onset(Math.max(min, Math.min(max, v)));
  }
</script>

{#if editing}
  <input bind:this={field} class="ve" type="number" {min} {max} step="1" value={value === undefined ? '' : Math.round(value)} aria-label="{label} ({unit === '%' ? 'percent' : unit})"
         onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } }}
         onblur={() => done(true)} />
{:else}
  <button type="button" class="vb" onclick={() => (editing = true)} title="Type a value" aria-label="{label}: {text}, type a value">{text}</button>
{/if}

<style>
  .vb { background: none; border: 1px dashed transparent; padding: 0 .25rem; min-height: 0; font: inherit; font-weight: 700; color: inherit; border-radius: 4px; cursor: text; }
  .vb:hover { border-color: var(--line2); }
  .ve { width: 5.2em; padding: .05rem .3rem; font: inherit; font-weight: 700; text-align: right; }
  @media (pointer: coarse) { .vb { min-height: 32px; min-width: 3rem; } }
</style>
