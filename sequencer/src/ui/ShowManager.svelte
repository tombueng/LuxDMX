<script lang="ts">
  // Every show saved in this browser, as cards with a picture of the stage.
  import { tick } from 'svelte';
  import { svgImage } from './thumb';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { app } from '../app.svelte';
  import { storedOf } from '../store/bundle';
  import { ui, focusSelect } from './ui.svelte';

  let { onclose }: { onclose: () => void } = $props();
  let renaming = $state<string | null>(null);
  let name = $state('');
  let fileInput: HTMLInputElement;
  let err = $state('');

  $effect(() => { app.refreshShows(); });
  const ago = (iso: string) => {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(iso).toLocaleDateString();
  };
  async function open(id: string) { if (id !== app.showId) await app.openShow(id); onclose(); }
  // a new show: the start dialog (empty, a template, a demo, a file): one place to start a show from
  function fresh() { ui.welcomeNew = true; ui.modal = 'welcome'; }
  async function load() {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    try {
      const r = await app.importShow(f);
      onclose();
      if (r) {
        const skipped = Object.entries(r.skipped).map(([k, n]) => `${n} ${k}`).join(', ');
        ui.toast(`QLC+ workspace: ${r.fixtures} fixtures (${r.fromLibrary} from the library${r.unknown.length ? `, ${r.unknown.length} as raw channels` : ''}), ${r.scenes} scenes, ${r.lists} chasers, ${r.effects} EFX${skipped ? `. Not imported: ${skipped}` : ''}`, 9000);
      }
    } catch (e) { err = (e as Error).message; }
  }
  function startRename(id: string, n: string) { renaming = id; name = n; }
  // (Escape cancels, as everywhere: it closed the whole dialog and kept the name typed so far.
  // Either way the focus goes back to the show's name, not to the page)
  async function rename() { const id = renaming; renaming = null; if (id) { await app.renameShow(id, name.trim() || 'Untitled'); titleOf(id); } }
  function cancelRename(e: KeyboardEvent) { if (e.key !== 'Escape') return; e.preventDefault(); e.stopPropagation(); const id = renaming; renaming = null; if (id) titleOf(id); }
  const titleOf = (id: string) => tick().then(() => document.querySelector<HTMLElement>(`.card button.title[data-show="${CSS.escape(id)}"]`)?.focus());
</script>

<Modal title="Shows" {onclose} wide>
  <p class="hint">Shows are saved in this browser automatically. Save one as a file to move it to another computer or keep a backup.</p>
  <div class="row new">
    <button class="primary" onclick={fresh}><Icon name="plus" />New show…</button>
    <button onclick={() => fileInput.click()} title="A LuxDMX show (.json, or .zip with its songs) or a QLC+ workspace (.qxw)"><Icon name="upload" />Open a show file…</button>
    <button onclick={() => app.exportShow()}><Icon name="download" />Save as file</button>
    {#if storedOf(app.show).songs.length || storedOf(app.show).model}<button onclick={() => app.exportShowWithSongs()} title="The show and its songs' audio (and your own 3D venue) in one .zip, for another computer"><Icon name="download" />Save with its songs</button>{/if}
    <button onclick={() => app.shareShow()} title="The share sheet where there is one (tablet, phone), the download otherwise"><Icon name="upload" />Send to another device</button>
    <button onclick={() => { const s = app.exportQxw(); if (s.length) ui.toast(`Saved for QLC+. Not included: ${s.join(', ')}`, 8000); }} title="A QLC+ workspace: fixtures, a scene per cue, a chaser per cue list, moves as EFX"><Icon name="download" />Save for QLC+ (.qxw)</button>
    <input type="file" accept=".json,application/json,.qxw,.zip,application/zip" bind:this={fileInput} onchange={load} hidden />
    {#if err}<span class="err">{err}</span>{/if}
  </div>

  <h2>In this browser</h2>
  <div class="grid">
    {#each app.shows as s (s.id)}
      <div class="card" class:cur={s.id === app.showId}>
        <!-- (the picture opens it too, for a mouse; the keyboard and a screen reader have the name: twenty "Open"s read badly) -->
        <button class="pic" onclick={() => open(s.id)} title="Open" tabindex="-1" aria-hidden="true"><img src={svgImage(s.thumb)} alt="" draggable="false" /></button>
        {#if renaming === s.id}
          <form onsubmit={(e) => { e.preventDefault(); rename(); }} class="row"><!-- svelte-ignore a11y_autofocus -->
            <input bind:value={name} use:focusSelect onblur={rename} onkeydown={cancelRename} aria-label="Show name" style="flex:1" /></form>
        {:else}
          <!-- (the dialog starts on the open show, not on New blank show: one stray Enter made a new show) -->
          <!-- svelte-ignore a11y_autofocus -->
          <button class="title" data-show={s.id} autofocus={s.id === app.showId} ondblclick={() => startRename(s.id, s.name)} onclick={() => open(s.id)}>{s.name}</button>
        {/if}
        <div class="faint">{s.fixtures} fixtures · {s.cues} cues · {ago(s.modified)}{s.id === app.showId ? ' · open now' : ''}</div>
        <div class="toolbar">
          <button class="ghost" title="Rename" aria-label="Rename {s.name}" onclick={() => startRename(s.id, s.name)}><Icon name="edit" /></button>
          <button class="ghost" title="Duplicate" aria-label="Duplicate {s.name}" onclick={() => app.duplicateShow(s.id)}><Icon name="duplicate" /></button>
          <button class="ghost danger" title="Delete" aria-label="Delete {s.name}" onclick={async () => { if (await ui.confirm(`Delete "${s.name}"?`, 'It goes from this browser for good (files you saved are not affected). This can\'t be undone.')) app.deleteShow(s.id); }}><Icon name="trash" /></button>
        </div>
      </div>
    {/each}
    {#if !app.shows.length}<p class="muted">Nothing saved yet.</p>{/if}
  </div>
</Modal>

<style>
  h2 { margin: 1rem 0 .5rem; }
  .new { margin: .4rem 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: .7rem; }
  .card { border: 1px solid var(--line); border-radius: var(--radius); padding: .45rem; background: var(--bg2); display: flex; flex-direction: column; gap: .25rem; }
  .card.cur { border-color: #45d85c88; }
  .pic { padding: 0; border: 0; background: none; border-radius: 6px; overflow: hidden; }
  .pic img { width: 100%; height: auto; display: block; }
  .title { background: none; border: 0; justify-content: flex-start; padding: 0; font-weight: 650; white-space: normal; text-align: left; }
</style>
