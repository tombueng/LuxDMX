<script lang="ts">
  // The lights aren't getting anything (the box's Wi-Fi went, someone closed the box's little
  // window, the tablet restarted and the box isn't connected yet): said loud and plain, with the one
  // tap that fixes it. A grey dot in the corner isn't enough for staff behind a bar. Shown for a box
  // that was live and dropped, and for one that isn't connected while the lights are expected on
  // (picked up after a restart, or the show is locked for the service) and something plays.
  import Icon from './Icon.svelte';
  import { app } from '../app.svelte';

  // (when: app.alarmed. Locked for the service: from the start, the timetable may play into nothing
  // at 09:30; after a restart that picked the show up: once something plays; never in a second tab)
  const lost = $derived((void app.bridgeRev, void app.status, app.bridges.filter((b) => app.alarmed(b))));
  const since = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
</script>

{#each lost as b (b.host)}
  <div class="lost" role="alert">
    <Icon name="warn" />
    {#if b.lostAt > 0}
      <span><b>The lights aren't getting anything</b> since {since(b.lostAt)}: {b.name || b.host}
        {b.state === 'reconnecting' ? 'lost its connection and is trying again by itself.' : b.state === 'closed' ? "isn't connected any more (its little window or tab was closed)." : 'is not answering.'}</span>
    {:else}
      <span><b>The lights aren't getting this yet</b>: {b.name || b.host} isn't connected (after a restart it needs one tap).</span>
    {/if}
    {#if b.state !== 'reconnecting' && b.state !== 'opening'}<button class="primary" onclick={() => b.open()}>{b.lostAt > 0 ? 'Reconnect' : 'Connect'}</button>{/if}
  </div>
{/each}

<style>
  .lost { display: flex; align-items: center; gap: .6rem; padding: .45rem .9rem; background: #3a1030; border-bottom: 1px solid var(--pink); color: var(--text); flex-wrap: wrap; }
  .lost > :global(svg) { color: var(--pink); flex: none; }
  .lost span { flex: 1; min-width: 12rem; }
</style>
