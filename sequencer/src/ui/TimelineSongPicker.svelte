<script lang="ts">
  // The timeline's Demo songs: the demo beat made in the app, and real songs by genre (free to use
  // under their licences), each with a short listen and Use (it downloads, with its progress, and
  // comes onto the timeline with its tempo and parts). `onpicked`: one is on the timeline now.
  import { app } from '../app.svelte';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import { clockOf } from '../model/timeline';
  import { DEMO_SECONDS } from '../timeline/beat';
  import type { CatalogSong } from '../timeline/catalog';
  import { progressSaid, songsByGenre } from '../timeline/songPicker';
  import type { Songs } from './timeline/songs.svelte';

  let { songs, onclose, onpicked }: { songs: Songs; onclose: () => void; onpicked: () => void } = $props();

  const P = app.timeline;
  const tl = $derived(app.show.timeline);
  const byGenre = songsByGenre();
  async function use(s: CatalogSong) { if (await songs.take(s)) onpicked(); }
  function useDemo() { songs.takeDemo(); onpicked(); }
</script>

{#snippet listenButton(s: CatalogSong | null, name: string)}
  {@const on = songs.listening === (s?.id ?? 'demo')}
  <button class="ghost listen" class:on aria-pressed={on} onclick={() => songs.listen(s)} aria-label="{on ? 'Stop' : 'Listen to'} {name}" title="A short listen (15 s)"><Icon name={on ? 'stop' : 'play'} />{on ? 'Stop' : 'Listen'}</button>
{/snippet}

<Modal title="Demo songs" {onclose} wide>
  <p class="hint">Real songs with vocals, free to use under their Creative Commons licences (the credit stays with your show). Picking one downloads it into this browser; its tempo and its parts come with it, and cues snap to the parts.</p>
  <h3 class="genre">Made in the app</h3>
  <ul class="songs">
    <li class:cur={!!tl?.demo && !tl.audio}>
      {@render listenButton(null, 'Demo beat')}
      <div class="info"><b>Demo beat</b> <span class="meta">Club · 126 BPM · {clockOf(DEMO_SECONDS, false)}</span><span class="blurb">Ten minutes with builds and drops, made in the app: nothing to download. The big demo show runs on it.</span></div>
      {#if tl?.demo && !tl.audio}<span class="chip green">On the timeline</span>{:else}<button class="primary" onclick={useDemo} aria-label="Use Demo beat">Use</button>{/if}
    </li>
  </ul>
  {#each byGenre as [genre, list] (genre)}
    <h3 class="genre">{genre}</h3>
    <ul class="songs">
      {#each list as s (s.id)}
        {@const cur = tl?.audio?.catalog === s.id && !P.missing}
        {@const dl = songs.dl?.id === s.id ? songs.dl : null}
        <li class:cur>
          {@render listenButton(s, s.title)}
          <div class="info">
            <b>{s.title}</b> <span>{s.artist}</span> <span class="meta">{s.bpm} BPM · {clockOf(s.duration, false)}</span>
            <span class="blurb"><a href={s.licenseUrl} target="_blank" rel="noopener noreferrer">{s.license}</a> · <a href={s.page} target="_blank" rel="noopener noreferrer">where it's from</a></span>
            {#if dl}<span class="dl"><progress max={dl.total || undefined} value={dl.total ? dl.got : undefined} aria-label="Downloading {s.title}"></progress>{progressSaid(dl)}</span>{/if}
          </div>
          {#if cur}<span class="chip green">On the timeline</span>
          {:else if dl}<button onclick={() => songs.cancel()} aria-label="Stop downloading {s.title}">Cancel</button>
          {:else}<button class="primary" onclick={() => use(s)} aria-label="Use {s.title}">Use</button>{/if}
        </li>
      {/each}
    </ul>
  {/each}
</Modal>

<style>
  .songs { list-style: none; margin: .4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .3rem; }
  .songs li { display: flex; align-items: center; gap: .6rem; padding: .4rem .5rem; border: 1px solid var(--line); border-radius: var(--radius-s); background: var(--panel2); }
  .songs li.cur { border-color: #45d85c66; }
  .songs .info { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 .5rem; }
  .songs .meta { color: var(--muted); font-size: .8rem; font-variant-numeric: tabular-nums; }
  .songs .blurb { flex-basis: 100%; color: var(--faint); font-size: .8rem; }
  .songs .listen { min-width: 5.6rem; justify-content: flex-start; }
  .songs .blurb a { color: var(--muted); }
  .genre { margin: .8rem 0 0; font-size: .74rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .dl { display: flex; align-items: center; gap: .4rem; margin: .2rem 0 0; font-size: .8rem; color: var(--muted); flex-basis: 100%; }
  .dl progress { flex: 1; max-width: 12rem; accent-color: var(--accent); }
</style>
