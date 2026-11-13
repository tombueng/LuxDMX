<script lang="ts">
  // One line under the stage: how many channels are patched and whether anything goes out, per
  // universe. A click opens the DMX output monitor (every channel, live) on that universe.
  import Icon from './Icon.svelte';
  import { app } from '../app.svelte';
  import { ui } from './ui.svelte';

  const unis = $derived([...new Set([...app.show.fixtures.map((f) => f.universe), ...app.frames.keys()])].sort((a, b) => a - b));
  const patched = $derived(app.show.fixtures.reduce((n, f) => n + (app.modeOf(f.id)?.channels.length ?? 1), 0));
  // a universe is "live" when any channel is above zero
  const live = $derived(new Set([...app.frames].filter(([, d]) => d.some((v) => v > 0)).map(([u]) => u)));
  // ...and whether it goes anywhere: a connected box that plays it, and the output on stage (it said
  // "sending" with the box for it gone, or Blind)
  const served = (u: number) => (void app.bridgeRev, app.output === 'live' && app.bridges.some((b) => b.state === 'ready' && b.wants(u)));
  const say = (u: number) => !live.has(u) ? 'all at zero' : app.output !== 'live' ? 'blind: nothing goes out (the stages show it)' : served(u) ? 'sending' : 'nothing goes out: no connected box plays it';
  function open(u?: number) { ui.monitorUni = u ?? unis[0] ?? 0; ui.modal = 'monitor'; }
</script>

<div class="panel dmx">
  <button class="ghost tog" onclick={() => open()} title="Every DMX channel as it goes out, live">
    <Icon name="grid" size={14} /><h2>DMX output</h2><Icon name="right" size={12} />
  </button>
  {#each unis as u (u)}
    <button class="u" class:live={live.has(u) && served(u)} class:held={live.has(u) && !served(u)} onclick={() => open(u)} title="Universe {u}: {say(u)}"><span class="dot"></span>U{u}</button>
  {/each}
  <span class="faint">{unis.length ? `${patched} channels patched` : 'nothing patched yet'}</span>
</div>

<style>
  .dmx { padding: .25rem .5rem; display: flex; align-items: center; gap: .4rem; flex-wrap: nowrap; overflow: hidden; flex: none; }
  .tog { padding: .15rem .3rem; gap: .3rem; color: var(--muted); }
  .u { padding: .05rem .5rem; font-size: .78rem; gap: .3rem; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--line2); }
  .u.live .dot { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .u.held .dot { background: var(--orange); }
  .faint { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
