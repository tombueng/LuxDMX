<script lang="ts">
  // A gobo's pattern, small: on the programmer's gobo buttons, the picture the 3D stage shows
  // (stage3d/gobos.ts). null: open (an empty circle).
  import { drawGobo, GOBOS, goboSeed } from '../stage3d/gobos';
  import { loadGoboFonts } from '../stage3d/goboFonts';
  let { pattern, size = 20 }: { pattern: number | null; size?: number } = $props();
  let cv = $state<HTMLCanvasElement>();
  $effect(() => {
    const c = cv, p = pattern;
    if (!c) return;
    let gone = false;
    void loadGoboFonts().then(() => {
      if (gone) return;
      const k = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1))), px = size * k;
      c.width = c.height = px;
      const g = c.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, px, px);
      g.save(); g.translate(px / 2, px / 2);
      if (p === null || !GOBOS[p]) { g.strokeStyle = '#cfd6e0'; g.lineWidth = k; g.beginPath(); g.arc(0, 0, px * 0.42, 0, Math.PI * 2); g.stroke(); }
      else drawGobo(g, GOBOS[p], px, goboSeed(p));
      g.restore();
    });
    return () => { gone = true; };
  });
</script>

<canvas bind:this={cv} class="gi" style="width:{size}px;height:{size}px" aria-hidden="true"></canvas>

<style>.gi { flex: none; border-radius: 50%; vertical-align: middle; }</style>
