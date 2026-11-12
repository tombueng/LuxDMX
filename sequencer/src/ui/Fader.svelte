<script lang="ts">
  // A desk fader for a screen: it moves from where it is, by how far the pointer moves (a finger
  // that lands on the track doesn't make it jump there, a swipe across the strips doesn't pull it
  // down), the mouse wheel and the keyboard (arrows, Page Up/Down, Home: 0, End: full). A mouse's
  // double-click goes to full and back (not a finger's double tap: a slip mustn't start a list).
  let { label, value, onset, height = 130, disabled = false, dblFull = true }:
    { label: string; value: number; onset: (v: number) => void; height?: number; disabled?: boolean; dblFull?: boolean } = $props();
  let lastPointer = 'mouse';

  let track = $state<HTMLDivElement>();
  let from: { y: number; v: number } | null = null;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  // (what it was last set to, for a moment: fast keys between two updates of `value` all count)
  let last = { v: 0, t: -1e9 };
  const now = () => (performance.now() - last.t < 400 ? last.v : value);
  const set = (v: number) => { last = { v, t: performance.now() }; onset(v); };
  function down(e: PointerEvent) {
    if (disabled || e.button !== 0) return;
    lastPointer = e.pointerType;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    (e.currentTarget as HTMLElement).focus();
    from = { y: e.clientY, v: now() };
  }
  function move(e: PointerEvent) {
    if (!from || !track) return;
    const h = track.clientHeight || height, k = e.shiftKey ? 0.2 : 1;
    set(clamp(from.v + ((from.y - e.clientY) / h) * k));
  }
  const up = () => (from = null);
  function wheel(e: WheelEvent) {
    if (disabled) return;
    e.preventDefault();
    // (a trackpad's small steps add up; a mouse wheel's notch is 5 %)
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    set(clamp(now() - (px / 100) * 0.05 * (e.shiftKey ? 0.2 : 1)));
  }
  function key(e: KeyboardEvent) {
    if (disabled) return;
    const d = ({ ArrowUp: 0.01, ArrowRight: 0.01, ArrowDown: -0.01, ArrowLeft: -0.01, PageUp: 0.1, PageDown: -0.1 } as Record<string, number>)[e.key];
    if (d !== undefined) { e.preventDefault(); set(clamp(now() + d * (e.shiftKey ? 0.1 : 1))); }
    else if (e.key === 'Home') { e.preventDefault(); set(0); }
    else if (e.key === 'End') { e.preventDefault(); set(1); }
  }
  let before = 0;
  function dbl() { if (disabled || !dblFull || lastPointer !== 'mouse') return; const v = now(); if (v < 0.999) { before = v; set(1); } else set(before); }
</script>

<div class="fader" class:off={disabled} style="height:{height}px" bind:this={track} role="slider" tabindex={disabled ? -1 : 0} aria-label={label}
     aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(value * 100)} aria-valuetext="{Math.round(value * 100)}%" aria-disabled={disabled}
     onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onwheel={wheel} onkeydown={key} ondblclick={dbl}>
  <div class="slot"></div>
  <div class="fill" style="height:{value * 100}%"></div>
  <div class="cap" style="bottom:calc({value * 100}% - 9px)"></div>
</div>

<style>
  .fader { position: relative; width: 34px; touch-action: none; cursor: ns-resize; border-radius: 6px; flex: none; }
  .fader:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .fader.off { opacity: .4; }
  .slot { position: absolute; left: 50%; top: 0; bottom: 0; width: 6px; margin-left: -3px; border-radius: 3px; background: #0b0f15; box-shadow: inset 0 0 0 1px #ffffff14; }
  .fill { position: absolute; left: 50%; bottom: 0; width: 6px; margin-left: -3px; border-radius: 3px; background: var(--accent); opacity: .7; }
  .cap { position: absolute; left: 2px; right: 2px; height: 18px; border-radius: 4px; background: linear-gradient(#3a4352, #252c37); box-shadow: 0 1px 3px #0009, inset 0 1px 0 #ffffff22; border: 1px solid #0006; }
  .cap::after { content: ''; position: absolute; left: 4px; right: 4px; top: 8px; height: 2px; background: #fff; opacity: .7; }
</style>
