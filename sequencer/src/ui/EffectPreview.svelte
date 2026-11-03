<script lang="ts">
  // A little animated picture of an effect, computed with the same code the output uses: a row of
  // lights for colour and intensity effects, a strip of LEDs for pixel shows, a few heads tracing
  // their path for moves.
  import { EFFECT_MAP, paramsOf, runEffect, type Where } from '../engine/effects';
  import { clock } from './clock.svelte';

  // one light with n pixels (made once, not every frame)
  const strips = new Map<number, Where[]>();
  const strip = (n: number) => strips.get(n) ?? strips.set(n, Array.from({ length: n }, (_, i) => ({ u: i / (n - 1), row: 0, rows: 1 }))).get(n)!;

  let { kind, params = {}, w = 160, h = 48, n = 0, bpm = 120, paused = false }:
    { kind: string; params?: Record<string, unknown>; w?: number; h?: number; n?: number; bpm?: number; paused?: boolean } = $props();
  let canvas = $state<HTMLCanvasElement>();
  const def = $derived(EFFECT_MAP.get(kind));
  const p = $derived(paramsOf(kind, params));
  const count = $derived(n || (def?.category === 'move' ? 4 : 8));

  $effect(() => { if (!paused) return clock.use(); });

  $effect(() => {
    const t = paused ? 1.3 : clock.t;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !def) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas!.width !== w * dpr) { canvas!.width = w * dpr; canvas!.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const total = (p.tempo ? t * bpm / 60 : t) / p.speed;
    if (def.category === 'move') {
      const cw = w / count;
      // A short trail: the same heads a moment ago, fainter.
      for (let back = 7; back >= 0; back--) {
        const outs = runEffect(def, p, count, total - back * 0.025 / Math.max(0.05, p.speed / 4));
        outs.forEach((o, i) => {
          const cx = cw * (i + 0.5), cy = h * 0.5;
          const x = cx + (o.pan ?? 0) * cw * 1.6, y = cy + (o.tilt ?? 0) * h * 1.4;
          ctx.fillStyle = back ? `rgba(255,170,28,${0.08 + (7 - back) * 0.04})` : '#ffd27a';
          ctx.beginPath(); ctx.arc(x, y, back ? 2 : 3.2, 0, Math.PI * 2); ctx.fill();
          if (!back) {
            ctx.strokeStyle = '#ffaa1c55'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(cx, 2); ctx.lineTo(x, y); ctx.stroke();
            ctx.fillStyle = '#4a5463'; ctx.fillRect(cx - 4, 0, 8, 3);
          }
        });
      }
      return;
    }
    // The sound effects get a pretend kick drum in the preview.
    const sound = Math.abs(Math.sin(t * Math.PI * 2)) ** 3;
    if (def.category === 'pixel') {
      // A pixel show on a strip of small LEDs (as many as fit, up to 30), each with a little glow.
      const n = Math.max(8, Math.min(30, Math.floor(w / 6))), where = strip(n);
      const outs = runEffect(def, { ...p, sound }, n, total, 1, where, { beats: t * bpm / 60, secs: t });
      const pad = 4, step = (w - 2 * pad) / n, s = Math.max(2, Math.min(step * 0.6, h * 0.24)), cy = h / 2;
      ctx.fillStyle = '#141a22';
      ctx.fillRect(pad - 2, cy - s * 0.9, w - 2 * pad + 4, s * 1.8);
      const rgb = outs.map((o) => {
        const v = o.intensity ?? 0, c = o.color ?? { r: 1, g: 1, b: 1 };
        return [Math.round(c.r * v * 255), Math.round(c.g * v * 255), Math.round(c.b * v * 255), v] as const;
      });
      ctx.globalCompositeOperation = 'lighter';
      rgb.forEach(([r, g, b, v], i) => {
        if (v < 0.03) return;
        const cx = pad + step * (i + 0.5);
        ctx.fillStyle = `rgba(${r},${g},${b},0.16)`; ctx.fillRect(cx - s * 2, cy - s * 2, s * 4, s * 4);
        ctx.fillStyle = `rgba(${r},${g},${b},0.3)`; ctx.fillRect(cx - s, cy - s, s * 2, s * 2);
      });
      ctx.globalCompositeOperation = 'source-over';
      rgb.forEach(([r, g, b, v], i) => {
        ctx.fillStyle = v < 0.03 ? '#262e39' : `rgb(${r},${g},${b})`;
        ctx.fillRect(pad + step * (i + 0.5) - s / 2, cy - s / 2, s, s);
      });
      return;
    }
    const outs = runEffect(def, { ...p, sound }, count, total);
    const gap = 3, r = Math.min(h * 0.32, (w - gap * (count + 1)) / count / 2);
    outs.forEach((o, i) => {
      const cx = gap + r + i * ((w - 2 * gap - 2 * r) / Math.max(1, count - 1)), cy = h / 2;
      // (a strike flashes white over a dim blue look, as the effect's blurb suggests)
      const k = o.strike ?? 0;
      const c = o.strike !== undefined ? { r: 0.12 + 0.88 * k, g: 0.16 + 0.84 * k, b: 0.6 + 0.4 * k } : o.color ?? { r: 1, g: 0.86, b: 0.6 };
      const v = o.strike !== undefined ? 0.45 + 0.55 * k : o.intensity ?? (def.category === 'color' ? 1 : 0);
      const col = `rgb(${Math.round(c.r * 255 * v)},${Math.round(c.g * 255 * v)},${Math.round(c.b * 255 * v)})`;
      if (v > 0.05) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.1);
        g.addColorStop(0, col.replace('rgb', 'rgba').replace(')', `,${0.55 * v})`)); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(cx - r * 2.2, cy - r * 2.2, r * 4.4, r * 4.4);
      }
      ctx.fillStyle = v > 0.03 ? col : '#1c232d';
      ctx.strokeStyle = '#3b4450'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
  });
</script>

<canvas bind:this={canvas} style="width:{w}px;height:{h}px" aria-hidden="true"></canvas>

<style>canvas { display: block; border-radius: 6px; background: #0b0f15; }</style>
