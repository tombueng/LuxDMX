{#snippet addonCard(a: EffectPackage, ours: boolean)}
  {@const run = effectOfPackage(a)}
  <button class="card" onclick={() => pickAddon(a)} data-addon={a.id} onmouseenter={() => (live = a.id)} onfocus={() => (live = a.id)}>
    <!-- (someone else's code doesn't run just to be looked at: its own little animation if it brings
         one, else it plays only once you point at it) -->
    {#if ours || a.preview || live === a.id}
      <EffectPreview kind={run.kind} params={run.params} w={180} h={84} bpm={app.bpm} paused={live !== a.id} picture={a.preview ?? ''} />
    {:else}<span class="nopic faint" aria-hidden="true">point here to play it</span>{/if}
    <b>{a.name}</b>
    <span class="faint">{a.description}</span>
    <small class="faint by">{a.author.name} · {a.license}</small>
  </button>
{/snippet}

{#snippet addonCards()}
  <h2>Add-ons</h2>
  <p class="hint">Effects in packages, by theme: fire, rain, the sea, love and more, made for rings, discs and matrices. They come from our add-on repository and run in a sandbox: they see the light they play on and nothing else.
    <button class="ghost link" onclick={() => importFile?.click()}>Import an effect file…</button></p>
  <input type="file" accept=".luxfx,.json,application/json" hidden bind:this={importFile} onchange={importIt} />
  {#if addons.imported.length}
    <h3 class="sub">Imported</h3>
    <div class="cards">
      {#each addons.imported as a (a.id)}
        <div class="mine">
          {@render addonCard(a, false)}
          <button class="ghost forget" aria-label="Forget {a.name}" title="Forget it in this browser (shows that use it keep it)" onclick={() => addons.forget(a.id)}>×</button>
        </div>
      {/each}
    </div>
  {/if}
  {#if addons.state === 'loading' || addons.state === 'idle'}<p class="faint">Loading the add-ons…</p>
  {:else if addons.state === 'failed'}<p class="err">The add-ons couldn't be loaded ({addons.problems[0]}). Offline? <button class="ghost link" onclick={() => addons.load()}>Try again</button></p>
  {:else}
    <div class="row themes" role="radiogroup" aria-label="Theme">
      <button role="radio" aria-checked={theme === ''} class:on={theme === ''} onclick={() => (theme = '')}>All</button>
      {#each addons.themes as th (th.id)}<button role="radio" aria-checked={theme === th.id} class:on={theme === th.id} onclick={() => (theme = th.id)}>{th.name}</button>{/each}
    </div>
    <div class="cards">
      {#each addons.packages.filter((a) => !theme || a.tags.includes(theme)) as a (a.id)}
        {@render addonCard(a, true)}
      {/each}
    </div>
  {/if}
  {#each addons.others as s (s.url)}
    <h3 class="sub">From {s.name} <span class="faint">(not ours: added in this browser)</span></h3>
    {#if s.state === 'loading'}<p class="faint">Loading…</p>
    {:else if s.state === 'failed'}<p class="err">It can't be loaded: {s.problems[0]}</p>
    {:else}
      <div class="cards" data-source={s.url}>
        {#each s.packages.filter((a) => !theme || a.tags.includes(theme) || !addons.themes.some((th) => a.tags.includes(th.id))) as a (a.id)}{@render addonCard(a, false)}{/each}
      </div>
    {/if}
  {/each}
  <button class="ghost link more" onclick={() => (sources = !sources)} aria-expanded={sources}>{sources ? 'Fewer sources' : 'More sources…'}</button>
  {#if sources}<AddonSources />{/if}
{/snippet}

{#snippet shapes()}
  <h2>Rings and matrices</h2>
  <p class="hint">Pictures that know where every LED is: an eye, a reactor, a supernova, flames, code rain, your own words. Best on a LED ring, a disc or a matrix; on a strip or a row of lights you see a line through the middle.</p>
  <div class="cards">
    {#each SHAPES as d (d.id)}
      <button class="card" onclick={() => pick(d.id)} data-effect={d.id}>
        <EffectPreview kind={d.id} w={180} h={84} bpm={app.bpm} />
        <b>{d.name}</b>
        <span class="faint">{d.blurb}</span>
      </button>
    {/each}
  </div>
{/snippet}

<script lang="ts">
  // Every built-in effect as a moving picture. Pick what to run it on, click one, it starts.
  import { onMount } from 'svelte';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import EffectPreview from './EffectPreview.svelte';
  import { EFFECTS, CATEGORY_LABEL, type EffectCategory } from '../engine/effects';
  import { app } from '../app.svelte';
  import { placesOf } from '../model/pixelLayout';
  import { ui } from './ui.svelte';
  import { addons } from '../addons/store.svelte';
  import AddonSources from './AddonSources.svelte';
  import { effectOfPackage, readPackage, type EffectPackage } from '../addons/package';

  let { onclose, onadded }: { onclose: () => void; onadded?: (id: string) => void } = $props();

  const CAT_HINT: Record<EffectCategory, string> = {
    move: 'For moving heads. They move around where the heads point now, so aim them first.',
    color: 'Change colours. They also switch the lights on (turn that off in the effect if a cue should decide).',
    intensity: 'Brightness patterns. They work on any light, PARs, dimmers, pixel bars (every pixel on its own).',
    pixel: 'Shows for pixel strips and bars, colour and brightness together: chases, fire, twinkles, ripples, your own formula or picture. They work on rows of PARs too.',
  };
  // What to run it on: the selection, or a group.
  let target = $state<string>(app.selected.length ? 'sel' : app.show.groups[0]?.id ?? 'sel');
  const count = $derived(target === 'sel' ? app.selected.length : app.show.groups.find((g) => g.id === target)?.fixtures.length ?? 0);
  const movers = $derived((target === 'sel' ? app.selected : app.show.groups.find((g) => g.id === target)?.fixtures ?? []).filter((id) => app.kinds[id] === 'mover').length);
  // moves first when there are heads to move, else last (greyed out sections first look broken)
  const ORDER: Record<'movers' | 'none', EffectCategory[]> = { movers: ['move', 'color', 'pixel', 'intensity'], none: ['color', 'pixel', 'intensity', 'move'] };
  const cats = $derived(ORDER[movers ? 'movers' : 'none'].filter((c) => EFFECTS.some((d) => d.category === c)));
  const ids = $derived(target === 'sel' ? app.selected : app.show.groups.find((g) => g.id === target)?.fixtures ?? []);
  // (a ring or a matrix among them: their effects first)
  const shaped = $derived(ids.some((id) => placesOf(app.modeOf(id))));
  const SHAPES = EFFECTS.filter((d) => d.shape && !d.hidden);
  let theme = $state('');
  // (fifty add-ons each working out a program per LED, every frame, would make the page crawl:
  // they show a still, and the one under the mouse or the keyboard plays)
  let live = $state('');
  let sources = $state(false);
  let importFile = $state<HTMLInputElement>();
  async function importIt(e: Event) {
    const i = e.target as HTMLInputElement, f = i.files?.[0];
    i.value = '';
    if (!f) return;
    try {
      const p = readPackage(await f.text());
      const kept = addons.keep(p);
      ui.toast(`${p.name} by ${p.author.name} is in Imported${kept ? '' : ' (this browser can\'t keep it after a reload)'}`, 5000);
    } catch (err) { ui.toast(`That file can't be used: ${err instanceof Error ? err.message : String(err)}`, 8000); }
  }
  // (once when the library opens; after a failure only when asked: never in a loop)
  onMount(() => { void addons.load(); addons.loadOthers(); });
  function pickAddon(a: EffectPackage) {
    if (!count) return ui.toast('Select some lights (or pick a group) first');
    const run = effectOfPackage(a);
    const e = app.addEffect(run.kind, target === 'sel' ? { fixtures: [...app.selected] } : { group: target }, { params: run.params, name: a.name });
    if (!e) return;
    ui.toast(`${e.name} is running. Record puts it into a cue.`);
    onadded?.(e.id);
    onclose();
  }

  function pick(kind: string) {
    if (!count) return ui.toast('Select some lights (or pick a group) first');
    const e = app.addEffect(kind, target === 'sel' ? { fixtures: [...app.selected] } : { group: target });
    if (!e) return;
    ui.toast(`${e.name} is running. Record puts it into a cue.`);
    onadded?.(e.id);
    onclose();
  }
</script>

<Modal title="Add an effect" {onclose} wide>
  <div class="row target">
    <span class="muted">Run it on</span>
    <button class:on={target === 'sel'} onclick={() => (target = 'sel')} disabled={!app.selected.length}>
      <Icon name="check" />the selected lights ({app.selected.length})</button>
    {#each app.show.groups as g (g.id)}
      <button class:on={target === g.id} onclick={() => (target = g.id)}><Icon name="group" />{g.name} ({g.fixtures.length})</button>
    {/each}
  </div>
  {#if !count}<p class="err">Nothing to run it on: close this, select lights on the stage (or make a group), then come back.</p>{/if}

  {#if shaped}{@render shapes()}{@render addonCards()}{/if}
  {#each cats as cat (cat)}
    {#if cat === 'pixel' && !shaped}{@render shapes()}{@render addonCards()}{/if}
    <h2>{CATEGORY_LABEL[cat]}</h2>
    <p class="hint">{CAT_HINT[cat]}{cat === 'move' && count && !movers ? ' (None of these lights can move.)' : ''}</p>
    <div class="cards">
      {#each EFFECTS.filter((d) => d.category === cat && !d.shape && !d.hidden) as d (d.id)}
        <button class="card" onclick={() => pick(d.id)} disabled={cat === 'move' && !!count && !movers} data-effect={d.id}>
          <EffectPreview kind={d.id} w={180} h={46} bpm={app.bpm} />
          <b>{d.name}</b>
          <span class="faint">{d.blurb}</span>
        </button>
      {/each}
    </div>
  {/each}
</Modal>

<style>
  .nopic { display: grid; place-items: center; width: 180px; height: 84px; border-radius: 6px; background: #0b0f15; font-size: 0.8em; }
  .target { margin-bottom: .4rem; }
  .target button { border-radius: 999px; padding: .2rem .7rem; }
  h2 { margin: 1rem 0 .2rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); gap: .5rem; }
  .card { flex-direction: column; align-items: flex-start; text-align: left; white-space: normal; padding: .5rem; gap: .3rem; justify-content: flex-start; }
  .card:hover:not(:disabled) { border-color: var(--accent); }
  .themes { flex-wrap: wrap; gap: .25rem; margin: .2rem 0 .5rem; }
  .themes button { border-radius: 999px; padding: .15rem .65rem; font-size: .85rem; }
  .themes button.on { background: var(--orange); color: #1a1000; border-color: var(--orange); }
  .by { font-size: .72rem; }
  h3.sub { margin: .6rem 0 .2rem; font-size: .82rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .mine { position: relative; display: flex; }
  .mine .card { flex: 1; }
  .forget { position: absolute; top: .2rem; right: .2rem; padding: 0 .35rem; min-width: 0; }
  .more { margin-top: .6rem; font-size: .85rem; }
  .link { padding: 0; color: var(--accent); text-decoration: underline; font-size: inherit; min-height: 0; min-width: 0; }
</style>
