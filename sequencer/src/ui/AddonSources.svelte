<script lang="ts">
  // Other people's add-on repositories (the effect library's add-ons, More sources): kept in this
  // browser, never shown up front. Each one's effects run in the same sandbox as ours, but what a
  // repository says about itself (names, descriptions, pictures) is its own: the warning says so
  // and adding one needs a tick that you trust it.
  import { addons, DEFAULT_REPO } from '../addons/store.svelte';

  let address = $state(''), trust = $state(false), busy = $state(false), err = $state('');
  async function add() {
    err = ''; busy = true;
    const r = await addons.addSource(address);
    busy = false;
    if (r.ok) { address = ''; trust = false; } else err = r.why;
  }
  const ours = new URL(DEFAULT_REPO, document.baseURI).href;
</script>

<section class="src" aria-labelledby="addon-src-h">
    <h3 id="addon-src-h">Add-on sources</h3>
    <p>Ours comes with the app and is always there. You can add someone else's repository by its address, and its effects show in the effect library under their own heading.</p>
    <p class="warn" role="note"><b>Only add sources you trust.</b> Anyone can put up a repository, and nobody checks what it says about its effects: their names, descriptions and pictures are its own. The effects themselves run in the same sandbox as ours: they can only light the lights they're played on, and nothing else.</p>
    <ul class="list" aria-label="Sources">
      <li><span><b>LuxDMX</b> <span class="faint">(ours)</span></span><span class="faint addr">{ours}</span></li>
      {#each addons.others as s (s.url)}
        <li data-source={s.url}>
          <span><b>{s.name}</b> <span class="faint">{s.state === 'loading' ? 'loading…' : s.state === 'failed' ? `can't be loaded: ${s.problems[0]}` : `${s.packages.length} effect${s.packages.length === 1 ? '' : 's'}${s.problems.length ? `, ${s.problems.length} left out` : ''}`}</span></span>
          <span class="faint addr">{s.url}</span>
          <button class="ghost x" aria-label="Remove {s.name}" title="Remove this source (shows that use its effects keep them)" onclick={() => addons.removeSource(s.url)}>×</button>
        </li>
      {/each}
    </ul>
    <label>Address of another source <input bind:value={address} placeholder="https://someone.example/luxdmx-addons/" aria-label="Address of another source" /></label>
    <label class="ck"><input type="checkbox" bind:checked={trust} /> I trust this source</label>
    {#if err}<p class="err" role="status">{err}</p>{/if}
    <div class="row"><button class="primary" onclick={add} disabled={!trust || !address.trim() || busy}>{busy ? 'Loading…' : 'Add it'}</button></div>
</section>

<style>
  .src { display: flex; flex-direction: column; gap: .6rem; max-width: 620px; border: 1px solid var(--line); border-radius: var(--radius); padding: .7rem .8rem; margin-top: .6rem; }
  h3 { margin: 0; font-size: .82rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  p { margin: 0; }
  .warn { border-left: 3px solid var(--orange); padding: .3rem .6rem; background: #ffaa1c10; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .3rem; }
  .list li { display: grid; grid-template-columns: 1fr auto; gap: .1rem .5rem; border: 1px solid var(--line); border-radius: var(--radius-s); padding: .35rem .5rem; }
  .addr { grid-column: 1; font-size: .78rem; word-break: break-all; }
  .x { grid-row: 1 / span 2; grid-column: 2; border: 0; background: none; color: var(--muted); padding: 0 .4rem; }
  label { display: flex; flex-direction: column; gap: .2rem; color: var(--muted); font-size: .85rem; }
  label input:not([type=checkbox]) { color: var(--text); }
  .ck { flex-direction: row; align-items: center; gap: .4rem; color: var(--text); }
  .err { color: var(--pink); }
  .row { display: flex; justify-content: flex-end; }
</style>
