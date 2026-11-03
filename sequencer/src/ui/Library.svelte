<script lang="ts">
  import Modal from './Modal.svelte';
  import { app } from '../app.svelte';
  import { ATTR_LABEL } from './attrs';
  import { fetchType, loadCatalog, POPULAR_MAKERS, search, type Entry } from '../library/catalog';
  import type { FixtureType } from '../model/types';
  import { typeLabel } from '../model/library';

  let { onclose, onpick }: { onclose: () => void; onpick: (typeId: string, mode?: string) => void } = $props();
  let cur = $state(0);                      // keyboard cursor in the results
  let modeName = $state('');                // the mode whose channels are shown
  let listEl = $state<HTMLElement>();
  let all = $state.raw<Entry[]>([]);
  let q = $state('');
  let err = $state('');
  let loading = $state.raw<Entry | null>(null);
  let chosen = $state.raw<Entry | null>(null);
  let picked = $state<FixtureType | null>(null);
  const results = $derived(search(all, q));
  // The app's own generic types answer too ("generic moving head"), no download needed.
  const builtIn = $derived.by(() => {
    const words = q.toLowerCase().replace(/\bgeneric\b/g, '').split(/\s+/).filter((w) => w.length > 1);
    if (!words.length) return [];
    return [...app.types.values()].filter((t) => t.source === 'generic')
      .filter((t) => { const text = `${typeLabel(t)} ${t.modes[0]?.channels.map((c) => c.attr).join(' ')}`.toLowerCase(); return words.every((w) => text.includes(w) || text.includes(w.replace(/s$/, ''))); })
      .slice(0, 6);
  });

  $effect(() => { loadCatalog().then((e) => (all = e)).catch(() => (err = "Couldn't load the fixture library index.")); });

  // Two quick picks: only the last one's answer counts.
  let pickNo = 0;
  async function choose(e: Entry) {
    const no = ++pickNo;
    err = ''; loading = e; picked = null; chosen = e;
    try {
      const t = await fetchType(e);
      if (no !== pickNo) return;
      picked = t; modeName = t.modes[0]?.name ?? '';
    } catch (x) { if (no === pickNo) err = (x as Error).message + ' (needs an internet connection the first time)'; }
    if (no === pickNo) loading = null;
  }
  // The row under the keyboard cursor is the one loaded (or its other-library twin, picked on purpose).
  const isLoaded = (r: Entry | undefined) => !!r && !!chosen && !!picked && (chosen === r || chosen === r.alt || chosen.key === r.key);
  function use() {
    if (!picked) return;
    onpick(app.addType(picked), modeName);
    onclose();
  }
  $effect(() => { void q; cur = 0; });
  // Up / Down move through the results, Enter loads one, Enter again uses it.
  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      cur = Math.max(0, Math.min(results.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
      queueMicrotask(() => listEl?.querySelector('.kb')?.scrollIntoView({ block: 'nearest' }));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[cur];
      if (isLoaded(r)) use(); else if (r) choose(r);
    }
  }
  const mode = $derived(picked?.modes.find((m) => m.name === modeName) ?? picked?.modes[0]);
</script>

<Modal title="Fixture library" {onclose} wide>
  <div class="row">
    <!-- svelte-ignore a11y_autofocus -->
    <input class="q" placeholder="Search: manufacturer, model, e.g. 'cameo flat' or 'robin spot'" bind:value={q} autofocus aria-label="Search fixtures" onkeydown={key}
      role="combobox" aria-expanded={results.length > 0} aria-controls="lib-results" aria-autocomplete="list" aria-activedescendant={results.length ? `lib-r${cur}` : undefined} />
    <span class="muted">{all.length ? `${all.length} fixtures` : 'loading…'}</span>
  </div>
  {#if err}<p class="err">{err}</p>{/if}
  <div class="cols">
    <div class="left">
    <ul class="results" bind:this={listEl} id="lib-results" role="listbox" aria-label="Fixtures found">
      {#each results as e, i (e.source + e.key)}
        <!-- svelte-ignore a11y_click_events_have_key_events (the search box drives the list: arrows, Enter) -->
        <li role="option" id="lib-r{i}" aria-selected={i === cur} tabindex="-1" class="row" class:cur={loading === e || isLoaded(e)} class:kb={i === cur} onclick={() => { cur = i; choose(e); }}>
          <span class="man">{e.manufacturer}</span> <b>{e.name}</b>
          <span class="src {e.source}">{e.source === 'ofl' ? 'OFL' : 'QLC+'}</span>{#if e.alt}<span class="src {e.alt.source}">{e.alt.source === 'ofl' ? 'OFL' : 'QLC+'}</span>{/if}
          {#if e.modes?.length}<span class="muted cat">{e.modes.length} mode{e.modes.length > 1 ? 's' : ''}, {Math.min(...e.modes.map((m) => m[1]))}{e.modes.length > 1 ? `-${Math.max(...e.modes.map((m) => m[1]))}` : ''} ch</span>{/if}
          {#if e.categories?.length}<span class="muted cat">{e.categories[0]}</span>{/if}
        </li>
      {/each}
    </ul>
    {#if !q.trim()}
      <div class="makers"><span class="faint">Type a maker or a model. Or start with a maker:</span>
        {#each POPULAR_MAKERS as m (m)}<button class="sm" onclick={() => (q = m + ' ')}>{m}</button>{/each}</div>
    {/if}
    {#if builtIn.length}
      <div class="builtin"><span class="faint">Built in, no download:</span>
        {#each builtIn as t (t.id)}<button class="sm" onclick={() => { onpick(t.id); onclose(); }}>{typeLabel(t)}</button>{/each}</div>
    {/if}
    {#if q && !results.length && !builtIn.length && all.length}<p class="muted">Nothing found. Not every fixture is in a library: "Make my own…" (next to the search) makes one in a minute.</p>{/if}
    </div>
    <div class="detail" data-source={picked && chosen ? chosen.source : undefined}>
      {#if loading}<p class="muted">Loading {loading.name}…</p>
      {:else if picked}
        <h3>{picked.manufacturer} {picked.model}</h3>
        <p class="muted">{picked.modes.length} mode{picked.modes.length === 1 ? '' : 's'}. Pick the one your fixture is set to (its menu or DIP switches say which).</p>
        {#if chosen?.alt}
          <p class="faint">Both libraries have this one; this is the {chosen.source === 'ofl' ? 'Open Fixture Library' : 'QLC+'} one{chosen.source === 'ofl' ? ' (usually more detailed)' : ''}.
            <button class="ghost link" onclick={() => choose(chosen!.alt!)}>Use the {chosen.alt.source === 'qlc' ? 'QLC+' : 'OFL'} definition instead</button></p>
        {/if}
        <div class="modes" role="radiogroup" aria-label="Mode">
          {#each picked.modes as m (m.name)}
            <button role="radio" aria-checked={m.name === mode?.name} class:on={m.name === mode?.name} onclick={() => (modeName = m.name)}>{m.name} <span class="faint">{m.channels.length} ch</span></button>
          {/each}
        </div>
        {#if mode}
          <p class="faint">Compare with the DMX table in the manual:</p>
          <ol class="chs">{#each mode.channels as c, i (i)}{@const what = c.fine ? 'fine' : ATTR_LABEL[c.attr] ?? c.attr}<li><span class="n">{i + 1}</span>{c.name}{#if !what.toLowerCase().startsWith(c.name.toLowerCase()) && !c.name.toLowerCase().startsWith(what.toLowerCase())}<span class="faint">{what}</span>{/if}</li>{/each}</ol>
        {/if}
        <button class="primary" onclick={use}>Use this fixture{picked.modes.length > 1 ? ` (${mode?.name})` : ''}</button>
      {:else}
        <p class="muted">Pick a fixture to see its modes. Libraries: Open Fixture Library (MIT) and QLC+ (Apache 2.0).</p>
      {/if}
    </div>
  </div>
</Modal>

<style>
  .q { flex: 1; }
  .cols { display: grid; grid-template-columns: 1.4fr 1fr; gap: 1rem; margin-top: .6rem; min-height: 340px; }
  .left { min-width: 0; }
  .results { list-style: none; margin: 0; padding: 0; max-height: 60vh; overflow: auto; }
  .results .row { display: flex; flex-wrap: wrap; align-items: baseline; gap: .1rem .3rem; border: 1px solid transparent; border-radius: var(--radius-s); padding: .35rem .45rem; cursor: pointer; }
  .results .row:hover, .results .row.cur { border-color: var(--line); background: #ffffff08; }
  .man { color: var(--muted); }
  .src { font-size: .76rem; border-radius: 4px; padding: 0 .3rem; margin-left: .3rem; }
  .src.ofl { background: #3a8ef333; color: #8ab8ff; } .src.qlc { background: #45d85c22; color: var(--green); }
  .cat { margin-left: .3rem; }
  .detail h3 { margin: 0 0 .3rem; font-size: 1rem; }
  .modes { display: flex; flex-wrap: wrap; gap: .25rem; margin: .3rem 0 .5rem; }
  .modes button { padding: .15rem .5rem; font-size: .8rem; border-radius: 999px; }
  .modes button.on { background: var(--orange); color: #1a1000; border-color: var(--orange); }
  .modes button.on .faint { color: #1a1000b0; }
  .chs { list-style: none; margin: 0 0 .6rem; padding: 0; max-height: 34vh; overflow: auto; font-size: .82rem; columns: 2; column-gap: 1rem; }
  .chs li { display: flex; gap: .4rem; align-items: baseline; break-inside: avoid; padding: .05rem 0; }
  .chs .n { width: 1.6rem; text-align: right; color: var(--faint); font-variant-numeric: tabular-nums; }
  .chs .faint { margin-left: auto; font-size: .76rem; }
  .results .row.kb { border-color: var(--line2); background: #ffffff0a; }
  .link { padding: 0; color: var(--accent); text-decoration: underline; font-size: inherit; }
  .makers { display: flex; flex-wrap: wrap; gap: .3rem; align-items: center; padding: .3rem 0; }
  .makers .faint { flex-basis: 100%; }
  .makers button.sm { padding: .15rem .55rem; font-size: .82rem; border-radius: 999px; }
  .err { color: var(--pink); }
  @media (max-width: 700px) { .cols { grid-template-columns: 1fr; } }
  .builtin { display: flex; flex-wrap: wrap; gap: .3rem; align-items: center; padding: .4rem 0; }
</style>
