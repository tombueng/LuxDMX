<script lang="ts">
  // The gallery: what the 3D stage draws, a big tile each (content/gallery.ts), playing live on the
  // stage's own models (stage3d/preview.ts). The one under the pointer plays at full speed; "Add"
  // takes that light to Add fixtures.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import FixturePreview from './FixturePreview.svelte';
  import { GALLERY } from '../content/gallery';
  import { GENERIC, modeOf } from '../model/library';
  import { ui } from './ui.svelte';

  let { onclose }: { onclose: () => void } = $props();
  const typeOf = (id: string) => GENERIC.find((t) => t.id === id);
  let hot = $state('');
  let big = $state<string | null>(null);        // one tile full size
  const bigItem = $derived(GALLERY.find((g) => g.id === big));
  function add(id: string) { ui.addType = id; ui.modal = 'addFixtures'; }
</script>

<Modal title="What the 3D stage draws" {onclose} wide xl top>
  <p class="intro">Every light here is the 3D stage's own, playing live in your browser: the same models, beams, gobos and machines your show gets. Point at one to see it at full speed.</p>
  {#if bigItem}
    {@const t = typeOf(bigItem.type)}
    <div class="big">
      <div class="pv"><FixturePreview type={t} copies={bigItem.copies ?? 1} focus={bigItem.focus ?? 'all'} extra={bigItem.extra ? typeOf(bigItem.extra) : undefined} hover /></div>
      <div class="bt">
        <h3>{bigItem.title}</h3><p>{bigItem.says}</p>
        <div class="row acts">
          <button onclick={() => (big = null)}><Icon name="back" />All of them</button>
          {#if t}<button class="primary" onclick={() => add(bigItem.type)}><Icon name="plus" />Add {t.model.split(',')[0]}</button>{/if}
        </div>
      </div>
    </div>
  {:else}
    <div class="grid">
      {#each GALLERY as g (g.id)}
        {@const t = typeOf(g.type)}
        <div class="tile" role="group" aria-label={g.title} data-item={g.id}
             onpointerenter={() => (hot = g.id)} onpointerleave={() => { if (hot === g.id) hot = ''; }}>
          <button class="pv" onclick={() => (big = g.id)} aria-label="{g.title}, bigger" onfocus={() => (hot = g.id)} onblur={() => { if (hot === g.id) hot = ''; }}>
            <FixturePreview type={t} copies={g.copies ?? 1} focus={g.focus ?? 'all'} extra={g.extra ? typeOf(g.extra) : undefined} hover={hot === g.id} />
          </button>
          <div class="tt">
            <b>{g.title}</b>
            <p>{g.says}</p>
            <div class="foot">
              {#if t}<span class="chip">{t.model.split(' (')[0]}</span><span class="chip">{modeOf(t, '')?.channels.length} ch</span>{/if}
              <button class="ghost sm" onclick={() => add(g.type)} aria-label="Add {g.title}"><Icon name="plus" size={14} />Add</button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</Modal>

<style>
  .intro { margin: 0 0 .7rem; color: var(--muted); font-size: .88rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: .7rem; }
  .tile { display: flex; flex-direction: column; border: 1px solid var(--line2); border-radius: var(--radius); overflow: hidden; background: var(--panel2); }
  .tile:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--line2)); }
  .pv { display: block; aspect-ratio: 16 / 9; padding: 0; border: 0; border-radius: 0; background: #07090d; cursor: zoom-in; width: 100%; min-height: 0; }
  .tt { padding: .55rem .7rem .6rem; display: flex; flex-direction: column; gap: .25rem; flex: 1; }
  .tt b { color: var(--text); font-size: .95rem; }
  .tt p { margin: 0; color: var(--muted); font-size: .82rem; line-height: 1.4; flex: 1; }
  .foot { display: flex; align-items: center; gap: .3rem; flex-wrap: wrap; margin-top: .2rem; }
  .foot .chip { font-size: .72rem; }
  .foot .sm { margin-left: auto; padding: .2rem .55rem; font-size: .82rem; display: inline-flex; align-items: center; gap: .25rem; }
  .big { display: grid; grid-template-columns: minmax(0, 2.2fr) minmax(220px, 1fr); gap: 1rem; align-items: start; }
  .big .pv { aspect-ratio: 16 / 9; border-radius: var(--radius); overflow: hidden; border: 1px solid var(--line2); cursor: default; }
  .bt h3 { margin: 0 0 .3rem; font-size: 1.1rem; color: var(--text); }
  .bt p { margin: 0 0 .8rem; color: var(--muted); font-size: .9rem; line-height: 1.45; }
  .acts { gap: .4rem; flex-wrap: wrap; }
  @media (max-width: 760px) { .big { grid-template-columns: 1fr; } }
</style>
