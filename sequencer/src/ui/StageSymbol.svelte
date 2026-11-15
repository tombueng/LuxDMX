<svelte:options namespace="svg" />
<script lang="ts">
  // One light on the 2D plan, drawn as what it is: a curtain or a drop as its cloth across the stage,
  // a moving head as a yoke with its lens, a bar or a matrix with its pixels where they really are, an
  // effect machine or a fog machine with its word (fog breathing while it runs), anything else as a
  // round light with its glow (a strobe flashing). StageView places it and handles the pointer.
  import { app } from '../app.svelte';
  import { lookColor } from '../engine/cuelook';
  import { cellLookAt } from '../engine/resolve';
  import type { Fixture, Resolved } from '../model/types';
  import type { Machinery } from '../model/library';

  let { f, l, c, kind, sel, x, y, size, px, blur, moving, mc, barW }: {
    f: Fixture; l: Resolved | undefined; c: { css: string; glow: number }; kind: string; sel: boolean;
    x: number; y: number; size: number; px: number; blur: boolean; moving: boolean;
    mc?: { how: Machinery; half: number }; barW?: number;
  } = $props();
  // (the cells picked on it, orange like any selection)
  const picked = $derived(sel ? new Set(app.cellsPicked(f.id)) : new Set<number>());
</script>

{#if mc}
  <!-- a curtain or a drop: its cloth across the stage, solid where it hangs in view (a curtain
       closed, a drop flown in), dashed where it's out of the way; a track's halves part -->
              {@const v = Math.max(0, Math.min(1, (l as { hoist?: number } | undefined)?.hoist ?? 0))}
  {@const shown = mc.how === 'flybar' ? v : 1 - v}
  {@const th = size * 0.36}
  {@const fill = mc.how === 'flybar' ? '#4f6a4a' : '#7a1420'}
  <rect class="cloth" x={x - mc.half} y={y - th} width={mc.half * 2} height={th * 2} rx="2" fill="none" stroke="#4a5463" stroke-width={1.2 * px} stroke-dasharray="{4 * px} {3 * px}" />
  {#if mc.how === 'curtain'}
    {@const part = mc.half * Math.max(0.08, 1 - v)}
    <rect x={x - mc.half} y={y - th} width={part} height={th * 2} rx="2" fill={fill} stroke={sel ? 'var(--orange)' : 'none'} stroke-width={2.5 * px} />
    <rect x={x + mc.half - part} y={y - th} width={part} height={th * 2} rx="2" fill={fill} stroke={sel ? 'var(--orange)' : 'none'} stroke-width={2.5 * px} />
  {:else}
    <rect x={x - mc.half} y={y - th} width={mc.half * 2} height={th * 2} rx="2" fill={fill} opacity={0.15 + 0.85 * shown} stroke={sel ? 'var(--orange)' : 'none'} stroke-width={2.5 * px} />
  {/if}
{:else if kind === 'mover'}
  <circle cx={x} cy={y} r={size * 1.25} fill={c.css} opacity={c.glow * 0.45} filter={blur ? 'url(#glow)' : undefined} pointer-events="none" />
  <rect x={x - size * 0.9} y={y - size * 0.25} width={size * 1.8} height={size * 0.5} rx="3" fill="#2a313c" />
  <circle cx={x} cy={y} r={size * 0.62} fill={c.glow > 0.02 ? c.css : '#1a2029'} stroke={sel ? 'var(--orange)' : '#4a5463'} stroke-width={(sel ? 2.5 : 1.2) * px} />
{:else if kind === 'bar' && app.placesOf(f.id)}
  {@const at = app.placesOf(f.id)!}
  {@const R = size * 2}
  {#if at.round}
    <circle cx={x} cy={y} r={R * 1.05} fill={c.css} opacity={c.glow * 0.4} filter={blur ? 'url(#glow)' : undefined} pointer-events="none" />
    <circle cx={x} cy={y} r={R * 1.04} fill="#1a2029" stroke={sel ? 'var(--orange)' : '#4a5463'} stroke-width={(sel ? 2.5 : 1.2) * px} />
  {:else}
    {@const w = R * (at.gw - 1) / Math.max(1, Math.max(at.gw, at.gh) - 1) + size * 0.2}
    {@const h = R * (at.gh - 1) / Math.max(1, Math.max(at.gw, at.gh) - 1) + size * 0.2}
    <rect x={x - w} y={y - h} width={w * 2} height={h * 2} rx="3" fill={c.css} opacity={c.glow * 0.4} filter={blur ? 'url(#glow)' : undefined} pointer-events="none" />
    <rect x={x - w} y={y - h} width={w * 2} height={h * 2} rx="3" fill="#1a2029" stroke={sel ? 'var(--orange)' : '#4a5463'} stroke-width={(sel ? 2.5 : 1.2) * px} />
  {/if}
  <!-- its pixels, where they really are -->
  {#each Array(at.n) as _, i (i)}
    {@const cc = lookColor(cellLookAt(l, i, at.n))}
    <circle class="px" class:picked={sel && picked.has(i)} data-cell={i} cx={x + at.x[i] * R} cy={y - at.y[i] * R} r={Math.max(0.6, at.dot * R)} fill={cc.glow > 0.02 ? cc.css : '#232a35'} />
  {/each}
{:else if kind === 'bar'}
  {@const n = app.caps(f.id).cells}
  {@const bw = barW ?? size * 2.2}
  <rect x={x - bw} y={y - size * 0.55} width={bw * 2} height={size * 1.1} rx="4" fill={c.css} opacity={c.glow * 0.4} filter={blur ? 'url(#glow)' : undefined} pointer-events="none" />
  <rect x={x - bw} y={y - size * 0.42} width={bw * 2} height={size * 0.84} rx="4" fill="#1a2029" stroke={sel ? 'var(--orange)' : '#4a5463'} stroke-width={(sel ? 2.5 : 1.2) * px} />
  <!-- its cells (a long pixel strip: the pixels touch, no gaps) -->
  {#each Array(n) as _, i (i)}
    {@const cc = lookColor(cellLookAt(l, i, n))}
    <rect class="px" class:picked={sel && picked.has(i)} data-cell={i} x={x - bw * 0.93 + (i * bw * 1.86) / n} y={y - size * 0.28} width={Math.max(0.5, (bw * 1.86) / n - (n > 24 ? 0 : 2))} height={size * 0.56} rx={n > 24 ? 0 : 2} fill={cc.glow > 0.02 ? cc.css : '#232a35'} />
  {/each}
{:else if kind === 'sfx'}
  <!-- an effect machine: what it is, lit while it runs -->
  {@const at = (['confetti', 'bubbles', 'flame', 'sparks', 'co2'] as const).find((a) => app.modeOf(f.id)?.channels.some((ch) => ch.attr === a)) ?? 'confetti'}
  {@const on = ((l as Record<string, number> | undefined)?.[at] ?? 0) > 0.02}
  <rect x={x - size * 0.8} y={y - size * 0.5} width={size * 1.6} height={size} rx="5" fill={on ? '#3a2a10' : '#1a2029'} stroke={sel ? 'var(--orange)' : on ? 'var(--orange)' : '#4a5463'} stroke-width={(sel ? 2.5 : 1.2) * px} />
  <text x={x} y={y + size * 0.16} text-anchor="middle" class="glyph" font-size={size * 0.4}>{({ confetti: 'CONF', bubbles: 'BUBL', flame: 'FIRE', sparks: 'SPRK', co2: 'CO2' })[at]}</text>
{:else if kind === 'fog'}
  {@const fog = l?.fog ?? l?.haze ?? 0}
  {@const hazer = !!app.modeOf(f.id)?.channels.some((ch) => ch.attr === 'haze') && !app.modeOf(f.id)?.channels.some((ch) => ch.attr === 'fog')}
  {#if fog > 0.02}
    {#each [0, 1, 2] as k (k)}<circle pointer-events="none" class="puff" class:still={!moving} style="animation-delay:{k * 0.5}s" cx={x - size * 0.3} cy={y} r={size * (0.9 + k * 0.5)} fill="#cfd8e3" opacity={0.18 * fog} />{/each}
  {/if}
  <rect x={x - size * 0.8} y={y - size * 0.5} width={size * 1.6} height={size} rx="5" fill="#1a2029" stroke={sel ? 'var(--orange)' : '#4a5463'} stroke-width={(sel ? 2.5 : 1.2) * px} />
  <text x={x} y={y + size * 0.18} text-anchor="middle" class="glyph" font-size={size * (hazer ? 0.45 : 0.55)}>{hazer ? 'HAZE' : 'FOG'}</text>
{:else}
  {@const strobe = (l?.strobe ?? 0) > 0.02 && c.glow > 0.02}
  <circle cx={x} cy={y} r={size * 1.5} fill={c.css} opacity={c.glow * 0.5} filter={blur ? 'url(#glow)' : undefined} class:flash={strobe && moving} pointer-events="none"
          style={strobe ? `animation-duration:${(0.5 - 0.42 * (l?.strobe ?? 0)).toFixed(2)}s` : ''} />
  <circle cx={x} cy={y} r={size * 0.72} fill={c.glow > 0.02 ? c.css : '#1a2029'} stroke={sel ? 'var(--orange)' : '#4a5463'} stroke-width={(sel ? 2.5 : 1.2) * px} />
  {#if kind === 'par'}<circle cx={x} cy={y} r={size * 0.38} fill="none" stroke="#00000055" stroke-width="1.5" />{/if}
  {#if kind === 'strobe'}<text x={x} y={y + size * 0.22} text-anchor="middle" class="glyph" font-size={size * 0.7}>⚡</text>{/if}
{/if}

<style>
  .px.picked { stroke: #ffaa1c; stroke-width: 1.5px; }   /* (picked: orange, as selection is everywhere) */
  .glyph { fill: var(--muted); font-weight: 700; pointer-events: none; }
  .puff { animation: puff 1.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  .puff.still { animation: none; }
  @keyframes puff { 0%, 100% { transform: scale(.85); } 50% { transform: scale(1.12); } }
  .flash { animation: flash .2s steps(2, jump-none) infinite; }
  @keyframes flash { 50% { opacity: 0; } }
</style>
