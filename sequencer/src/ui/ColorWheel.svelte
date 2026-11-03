<script lang="ts">
  // Pick any colour: angle is the hue, distance from the middle the saturation. Brightness is the
  // intensity fader's job, so the wheel is always at full brightness. Works with touch and keys.
  import { hsv } from '../engine/effects';
  import type { Color } from '../model/types';

  let { value, onpick }: { value?: Color; onpick: (c: Color) => void } = $props();
  let el = $state<HTMLDivElement>();

  // Colour -> where its dot sits on the wheel.
  const pos = $derived.by(() => {
    if (!value) return { x: 0.5, y: 0.5 };
    const max = Math.max(value.r, value.g, value.b), min = Math.min(value.r, value.g, value.b), d = max - min;
    let h = 0;
    if (d > 0) h = max === value.r ? ((value.g - value.b) / d + 6) % 6 : max === value.g ? (value.b - value.r) / d + 2 : (value.r - value.g) / d + 4;
    const s = max > 0 ? d / max : 0, a = (h / 6) * Math.PI * 2;
    return { x: 0.5 + Math.sin(a) * s * 0.5, y: 0.5 - Math.cos(a) * s * 0.5 };
  });
  function at(x: number, y: number) {
    const dx = x - 0.5, dy = y - 0.5;
    const s = Math.min(1, Math.hypot(dx, dy) * 2);
    let h = Math.atan2(dx, -dy) / (Math.PI * 2);
    if (h < 0) h += 1;
    onpick(hsv(h, s, 1));
  }
  function pointer(e: PointerEvent) {
    if (!el) return;
    if (e.type === 'pointerdown') el.setPointerCapture(e.pointerId);
    else if (!(e.buttons & 1)) return;
    const r = el.getBoundingClientRect();
    at((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }
  function key(e: KeyboardEvent) {
    const d: Record<string, [number, number]> = { ArrowLeft: [-0.03, 0], ArrowRight: [0.03, 0], ArrowUp: [0, -0.03], ArrowDown: [0, 0.03] };
    if (!d[e.key]) return;
    e.preventDefault();
    at(pos.x + d[e.key][0], pos.y + d[e.key][1]);
  }
</script>

<div class="wrap">
  <div class="wheel" bind:this={el} role="slider" tabindex="0" aria-label="Colour wheel" aria-valuenow={Math.round((Math.atan2(pos.x - 0.5, 0.5 - pos.y) / Math.PI * 180 + 360) % 360)} aria-valuemin={0} aria-valuemax={359} aria-valuetext={value ? `r ${Math.round(value.r * 255)} g ${Math.round(value.g * 255)} b ${Math.round(value.b * 255)}` : 'none'}
       onpointerdown={pointer} onpointermove={pointer} onkeydown={key}>
    <div class="dot" style="left:{pos.x * 100}%;top:{pos.y * 100}%;background:{value ? `rgb(${value.r * 255},${value.g * 255},${value.b * 255})` : 'transparent'}"></div>
  </div>
</div>

<style>
  .wrap { display: flex; justify-content: center; }
  .wheel { position: relative; width: min(180px, 100%); aspect-ratio: 1; border-radius: 50%; touch-action: none; cursor: crosshair;
    background: radial-gradient(circle closest-side, #fff, #fff0 100%), conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
    box-shadow: 0 0 0 1px var(--line), 0 6px 20px #0006; }
  .dot { position: absolute; width: 18px; height: 18px; margin: -9px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px #000a, 0 2px 6px #000a; pointer-events: none; }
</style>
