<script lang="ts">
  // An encoder, as on a desk: endless, it turns what it's on from where that is. Drag up or right
  // to turn it up (any pointer: mouse, pen, a finger), the mouse wheel, or the arrow keys when it
  // has focus; Shift for fine steps. Double-click (or Enter) types a value.
  // typeMax: what a typed value counts to (100: per cent; 360: degrees, for a hue)
  // detents: it clicks from one to the next (a gobo wheel's slots): onturn gets +1 or -1, one
  // per click (16 px of drag, a mouse wheel notch, an arrow key)
  let { label, value, onturn, onset, disabled = false, fmt = (v: number) => `${Math.round(v * 100)}%`, typeMax = 100, detents = false }:
    { label: string; value: number | undefined; onturn: (delta: number) => void; onset?: (v: number) => void; disabled?: boolean; fmt?: (v: number) => string; typeMax?: number; detents?: boolean } = $props();

  let last: { x: number; y: number } | null = null;
  let acc = 0;                                  // (detents: drag or scroll not yet a click)
  let typing = $state(false), typed = $state('');
  function down(e: PointerEvent) {
    if (disabled) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    last = { x: e.clientX, y: e.clientY };
  }
  function move(e: PointerEvent) {
    if (!last) return;
    // 200 px of drag: the whole way; Shift: a tenth of that
    const px = e.clientX - last.x - (e.clientY - last.y);
    last = { x: e.clientX, y: e.clientY };
    if (detents) { acc += px; while (Math.abs(acc) >= 16) { const s = Math.sign(acc); acc -= 16 * s; onturn(s); } return; }
    const d = px / 200 * (e.shiftKey ? 0.1 : 1);
    if (d) onturn(d);
  }
  const up = () => (last = null);
  function wheel(e: WheelEvent) {
    if (disabled) return;
    e.preventDefault();
    // (by how far it scrolled: a mouse notch is 2 %, a trackpad's small steps add up to the same)
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    // (detents: a mouse notch is one click, a trackpad's small steps add up to one)
    if (detents) { acc -= px; if (Math.abs(px) >= 40 || Math.abs(acc) >= 40) { onturn(Math.sign(acc)); acc = 0; } return; }
    onturn((-px / 100) * (e.shiftKey ? 0.002 : 0.02));
  }
  function key(e: KeyboardEvent) {
    if (disabled) return;
    const step = detents ? 1 : e.shiftKey ? 0.002 : 0.02;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); onturn(step); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); onturn(-step); }
    else if (e.key === 'PageUp') { e.preventDefault(); onturn(detents ? 1 : 0.1); }
    else if (e.key === 'PageDown') { e.preventDefault(); onturn(detents ? -1 : -0.1); }
    else if (e.key === 'Enter' && onset) { e.preventDefault(); startTyping(); }
  }
  function startTyping() { if (!onset || disabled) return; typed = value === undefined ? '' : String(Math.round(value * typeMax)); typing = true; }
  // (once: Enter, Escape and the blur that follows them don't apply it twice, Escape not at all)
  function done(apply: boolean) {
    if (!typing) return;
    typing = false;
    const v = parseFloat(typed);
    if (apply && Number.isFinite(v) && onset) onset(Math.max(0, Math.min(typeMax, v)) / typeMax);
  }
  const angle = $derived(-135 + 270 * Math.max(0, Math.min(1, value ?? 0)));
</script>

<div class="knob" class:off={disabled}>
  {#if typing}
    <!-- svelte-ignore a11y_autofocus (typed straight after asking for it) -->
    <input class="typed" type="number" min="0" max={typeMax} bind:value={typed} autofocus aria-label="{label} in {typeMax === 360 ? 'degrees' : '%'}"
           onkeydown={(e) => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); }} onblur={() => done(true)} />
  {:else}
    <div class="dial" role="slider" tabindex={disabled ? -1 : 0} aria-label={label} aria-disabled={disabled}
         aria-valuemin="0" aria-valuemax="100" aria-valuenow={value === undefined ? undefined : Math.round(value * 100)} aria-valuetext={value === undefined ? 'not set' : fmt(value)}
         onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onwheel={wheel} onkeydown={key} ondblclick={startTyping}>
      <svg viewBox="-1.2 -1.2 2.4 2.4" aria-hidden="true">
        <circle r="1" class="ring" />
        <path class="arc" d="M {Math.cos((-225) * Math.PI / 180)} {Math.sin((-225) * Math.PI / 180)} A 1 1 0 {angle + 135 > 180 ? 1 : 0} 1 {Math.cos((angle - 90) * Math.PI / 180)} {Math.sin((angle - 90) * Math.PI / 180)}" />
        <line x1="0" y1="0" x2={0.75 * Math.cos((angle - 90) * Math.PI / 180)} y2={0.75 * Math.sin((angle - 90) * Math.PI / 180)} class="tick" />
      </svg>
    </div>
  {/if}
  <span class="lbl">{label}</span>
  <!-- (a tap on the value types one: a double tap is unreliable on a phone) -->
  {#if onset && !disabled}<button class="val ghost" onclick={startTyping} title="Type a value" aria-label="Type a value for {label}, now {value === undefined ? 'not set' : fmt(value)}">{value === undefined ? '–' : fmt(value)}</button>
  {:else}<span class="val">{value === undefined ? '–' : fmt(value)}</span>{/if}
</div>

<style>
  .knob { display: flex; flex-direction: column; align-items: center; gap: .15rem; min-width: 64px; user-select: none; }
  .knob.off { opacity: .35; }
  .dial { width: 54px; height: 54px; border-radius: 50%; touch-action: none; cursor: ns-resize; background: radial-gradient(#2a323e, #151a22); box-shadow: inset 0 0 0 1px #ffffff1a; }
  .dial:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  svg { width: 100%; height: 100%; }
  .ring { fill: none; stroke: #ffffff14; stroke-width: .12; }
  .arc { fill: none; stroke: var(--accent); stroke-width: .14; stroke-linecap: round; }
  .tick { stroke: #fff; stroke-width: .12; stroke-linecap: round; }
  .lbl { font-size: .74rem; color: var(--muted); text-align: center; line-height: 1.1; }
  .val { font-size: .8rem; font-variant-numeric: tabular-nums; }
  button.val { padding: 0 .3rem; min-height: 0; border: 0; background: none; color: var(--text); }
  .typed { width: 54px; height: 54px; text-align: center; }
</style>
