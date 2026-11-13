<script lang="ts">
  // The lights aren't getting anything (the box's Wi-Fi went, someone closed the box's little
  // window, the tablet restarted and the box isn't connected yet): said loud and plain, with the one
  // tap that fixes it. A grey dot in the corner isn't enough for staff behind a bar. Shown for a box
  // that was live and dropped, and for one that isn't connected while the lights are expected on
  // (picked up after a restart, or the show is locked for the service) and something plays.
  import Icon from './Icon.svelte';
  import { app } from '../app.svelte';
  import type { Bridge } from '../output/bridge';

  // (when: app.alarmed. Locked for the service: from the start, the timetable may play into nothing
  // at 09:30; after a restart that picked the show up: once something plays; never in a second tab)
  const lost = $derived((void app.bridgeRev, void app.status, app.bridges.filter((b) => app.alarmed(b))));
  // Pixel lights no connected box says it plays: they'd stay dark without a word. Quieter than the
  // above (a show with more pixel universes than this box has is fine to rehearse), and it can be
  // waved away until the list changes.
  const unserved = $derived((void app.bridgeRev, app.locked ? [] : app.unservedPixels()));
  let waved = $state('');
  const unservedKey = $derived(unserved.join());
  const unservedText = $derived(unserved.length > 6 ? `${unserved.slice(0, 6).join(', ')} and ${unserved.length - 6} more` : unserved.join(', '));
  const since = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // (two boxes left with the same name: which one, by its address too)
  const nameOf = (b: Bridge) => !b.name ? b.host : app.bridges.some((x) => x !== b && x.name === b.name) ? `${b.name} (${b.host})` : b.name;
  // With another box still playing, it's only this box's universes that get nothing, not "the lights"
  const unisOf = (b: Bridge) => [...new Set([...b.outputs.filter((o) => o.en).map((o) => o.uni), ...b.pixels])].sort((x, y) => x - y);
  const othersFine = (b: Bridge) => app.bridges.some((x) => x !== b && x.state === 'ready');
  function headline(b: Bridge) {
    const u = unisOf(b);
    return othersFine(b) && u.length ? `Universe${u.length > 1 ? 's' : ''} ${u.join(', ')} ${u.length > 1 ? "aren't" : "isn't"} getting anything` : "The lights aren't getting anything";
  }
  // Connected but slow or hardly answering (venue Wi-Fi): it looked healthy while the lights got a
  // look every few seconds. Said in orange, with what gets through.
  const slow = $derived((void app.bridgeRev, app.output === 'live' ? app.bridges.filter((b) => b.slow) : []));
  // Back after being lost: the bar stays a while, green, so a link that drops and comes back every
  // few seconds doesn't push the page up and down under the operator's finger each time.
  const BACK_MS = 15000;
  let now = $state(Date.now());
  const back = $derived((void app.bridgeRev, void now, app.bridges.filter((b) => b.state === 'ready' && b.backAt && Date.now() - b.backAt < BACK_MS && !b.slow)));
  $effect(() => { if (!back.length) return; const t = setTimeout(() => (now = Date.now()), Math.max(200, BACK_MS - (Date.now() - Math.max(...back.map((b) => b.backAt))) + 50)); return () => clearTimeout(t); });
</script>

{#each lost as b (b.host)}
  <div class="lost" role="alert">
    <Icon name="warn" />
    {#if b.lostAt > 0}
      <span><b>{headline(b)}</b> since {since(b.lostAt)}: {nameOf(b)}
        {b.state === 'reconnecting' ? 'lost its connection and is trying again by itself.' : b.state === 'closed' ? "isn't connected any more (its little window or tab was closed)." : 'is not answering.'}</span>
    {:else}
      <span><b>The lights aren't getting this yet</b>: {nameOf(b)} isn't connected (after a restart it needs one tap).</span>
    {/if}
    {#if b.state !== 'reconnecting' && b.state !== 'opening'}<button class="primary" onclick={() => b.open()}>{b.lostAt > 0 ? 'Reconnect' : 'Connect'}</button>{/if}
  </div>
{/each}
{#each slow as b (b.host)}
  <div class="lost slow" role="alert">
    <Icon name="warn" />
    <span><b>{nameOf(b)} {b.slow === 'stalled' ? 'hardly answers' : 'answers slowly'}</b>: the lights get {b.slow === 'stalled' ? 'almost nothing' : `about ${Math.max(1, Math.round(b.sentRate))} looks a second`}, the network to it is slow or busy (its Wi-Fi?). A cable, or the box nearer the router, helps.</span>
  </div>
{/each}
{#each back as b (b.host)}
  <div class="lost back" role="status">
    <Icon name="check" />
    <span><b>{nameOf(b)} is back</b> since {since(b.backAt)}: the lights get everything again.</span>
  </div>
{/each}
{#if unserved.length && waved !== unservedKey}
  <div class="note" role="status" data-testid="pixels-unserved">
    <Icon name="warn" />
    <span><b>No box plays universe {unservedText}</b> (lights with cells are on it). Set a box's DMX output or pixel port to it (its settings), or update the box: one on v1.0.293 or older doesn't say what its ports listen to.</span>
    <button class="ghost" onclick={() => (waved = unservedKey)}>OK</button>
  </div>
{/if}

<style>
  .lost { display: flex; align-items: center; gap: .6rem; padding: .45rem .9rem; background: #3a1030; border-bottom: 1px solid var(--pink); color: var(--text); flex-wrap: wrap; }
  .lost > :global(svg) { color: var(--pink); flex: none; }
  .lost.slow { background: #3a2a10; border-bottom-color: var(--orange); } .lost.slow > :global(svg) { color: var(--orange); }
  .lost.back { background: #10301a; border-bottom-color: var(--green); } .lost.back > :global(svg) { color: var(--green); }
  .lost span, .note span { flex: 1; min-width: 12rem; }
  .note { display: flex; align-items: center; gap: .6rem; padding: .3rem .9rem; border-bottom: 1px solid var(--line); color: var(--muted); font-size: .86rem; flex-wrap: wrap; }
  .note b { color: var(--text); font-weight: 600; }
  .note > :global(svg) { color: var(--orange); flex: none; }
</style>
