<script lang="ts">
  // A number field that leaves you alone while you type: a comma or a point for the decimals
  // (whatever the browser's language), nothing rewritten under the cursor (9999 stays 9999 until
  // you leave the field, then it's 600 if that's the most), arrow keys step it.
  let { value, min = 0, max = Infinity, step = 1, onset, label, placeholder = '', title = '', width = '4.5em' }: {
    value: number | undefined; min?: number; max?: number; step?: number; onset: (v: number | undefined) => void;
    label: string; placeholder?: string; title?: string; width?: string;
  } = $props();
  let el = $state<HTMLInputElement>();
  let editing = $state(false);
  const fmt = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '' : String(Math.round(v * 1000) / 1000));
  const parse = (s: string) => { const t = s.trim().replace(',', '.'); return t === '' ? undefined : Number(t); };
  // (not while it's being typed in: what you type stays as you typed it)
  $effect(() => { const v = value; if (el && !editing) el.value = fmt(v); });
  function input() {
    const v = parse(el!.value);
    if (v === undefined || (Number.isFinite(v) && v >= min && v <= max)) onset(v);
  }
  function done() {
    editing = false;
    const v = parse(el!.value);
    const kept = v === undefined ? undefined : Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : value;
    if (kept !== value) onset(kept);
    el!.value = fmt(kept);
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'Enter') { el!.blur(); return; }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const v = parse(el!.value) ?? value ?? min, d = (e.shiftKey ? 10 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
    const n = Math.min(max, Math.max(min, Math.round((v + d) / step) * step));
    el!.value = fmt(n); onset(n);
  }
</script>

<input bind:this={el} type="text" inputmode="decimal" aria-label={label} {placeholder} {title} style:width={width}
  onfocus={() => (editing = true)} oninput={input} onblur={done} onkeydown={key} autocomplete="off" spellcheck="false" />
