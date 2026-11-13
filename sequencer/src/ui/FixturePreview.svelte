<script lang="ts">
  // A light's live preview: its micro show on the 3D stage's models (stage3d/preview.ts), drawn
  // while it's on the screen. three.js comes with the first one (it's big); until then, and where
  // there's no WebGL, the tile shows its dark room and an icon.
  import { onDestroy } from 'svelte';
  import type { FixtureType } from '../model/types';
  import type { PreviewHandle } from '../stage3d/preview';

  let { type, mode = '', hover = false, ondoes }: { type: FixtureType | undefined; mode?: string; hover?: boolean; ondoes?: (d: string[]) => void } = $props();
  let canvas = $state<HTMLCanvasElement>();
  let h: PreviewHandle | null = null, gone = false;
  let ro: ResizeObserver | undefined;

  // the picture at the canvas's size on the screen (a bit sharper on a sharp screen, not much: there are many)
  function fit() {
    if (!canvas) return;
    const r = Math.min(1.5, window.devicePixelRatio || 1), w = Math.max(1, Math.round(canvas.clientWidth * r)), hh = Math.max(1, Math.round(canvas.clientHeight * r));
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
  }
  $effect(() => {
    const c = canvas, t = type;
    if (!c || !t || h) return;
    fit();
    ro = new ResizeObserver(fit); ro.observe(c);
    void import('../stage3d/preview').then((m) => {
      if (gone || !canvas || !type) return;
      h = m.preview(canvas, { type, mode });
      ondoes?.(h.does);
    }).catch(() => {});
  });
  $effect(() => { const t = type, md = mode; if (h && t) { h.set({ type: t, mode: md }); ondoes?.(h.does); } });
  $effect(() => { h?.hover(hover); });
  onDestroy(() => { gone = true; ro?.disconnect(); h?.destroy(); });
</script>

<canvas class="pv" bind:this={canvas} aria-hidden="true"></canvas>

<style>
  .pv { display: block; width: 100%; height: 100%; background: radial-gradient(ellipse at 50% 30%, #161a22 0%, #07090d 70%); }
</style>
