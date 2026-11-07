<script lang="ts">
  // Every show saved in this browser, as cards with a picture of the stage.
  import { svgImage } from './thumb';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { app } from '../app.svelte';
  import { ui, focusSelect } from './ui.svelte';
  import { ALL_TEMPLATES as TEMPLATES } from '../content/ringMatrix';

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
  async function fresh() { await app.newShow(); onclose(); }
  async function template(i: number) { await app.startShow(TEMPLATES[i].build()); onclose(); ui.toast(`Started from "${TEMPLATES[i].name}"`); }
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
  async function rename() { if (renaming) await app.renameShow(renaming, name.trim() || 'Untitled'); renaming = null; }
</script>

<Modal title="Shows" {onclose} wide>
  <p class="hint">Shows are saved in this browser automatically. Save one as a file to move it to another computer or keep a backup.</p>
  <div class="row new">
    <button class="primary" onclick={fresh}><Icon name="plus" />New blank show</button>
    <button onclick={() => fileInput.click()} title="A LuxDMX show (.json) or a QLC+ workspace (.qxw)"><Icon name="upload" />Open a file…</button>
    <button onclick={() => app.exportShow()}><Icon name="download" />Save current as file</button>
    <button onclick={() => app.shareShow()} title="The share sheet where there is one (tablet, phone), the download otherwise"><Icon name="upload" />Send to another device</button>
    <button onclick={() => { const s = app.exportQxw(); if (s.length) ui.toast(`Saved for QLC+. Not included: ${s.join(', ')}`, 8000); }} title="A QLC+ workspace: fixtures, a scene per cue, a chaser per cue list, moves as EFX"><Icon name="download" />Save for QLC+ (.qxw)</button>
    <input type="file" accept=".json,application/json,.qxw" bind:this={fileInput} onchange={load} hidden />
    {#if err}<span class="err">{err}</span>{/if}
  </div>

  <h2>Start from a template</h2>
  <div class="tpls">
    {#each TEMPLATES as t, i (t.name)}
      <button class="tpl" onclick={() => template(i)}>
        <span class="ti"><Icon name={t.icon} size={22} /></span>
        <b>{t.name}</b><span class="faint">{t.blurb}</span>
      </button>
    {/each}
  </div>

  <h2>In this browser</h2>
  <div class="grid">
    {#each app.shows as s (s.id)}
      <div class="card" class:cur={s.id === app.showId}>
        <button class="pic" onclick={() => open(s.id)} title="Open"><img src={svgImage(s.thumb)} alt="" draggable="false" /></button>
        {#if renaming === s.id}
          <form onsubmit={(e) => { e.preventDefault(); rename(); }} class="row"><!-- svelte-ignore a11y_autofocus -->
            <input bind:value={name} use:focusSelect onblur={rename} aria-label="Show name" style="flex:1" /></form>
        {:else}
          <button class="title" ondblclick={() => startRename(s.id, s.name)} onclick={() => open(s.id)}>{s.name}</button>
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
  .tpls { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: .5rem; }
  .tpl { flex-direction: column; align-items: flex-start; text-align: left; white-space: normal; padding: .6rem; gap: .2rem; min-height: 92px; justify-content: flex-start; }
  .ti { color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: .7rem; }
  .card { border: 1px solid var(--line); border-radius: var(--radius); padding: .45rem; background: var(--bg2); display: flex; flex-direction: column; gap: .25rem; }
  .card.cur { border-color: #45d85c88; }
  .pic { padding: 0; border: 0; background: none; border-radius: 6px; overflow: hidden; }
  .pic img { width: 100%; height: auto; display: block; }
  .title { background: none; border: 0; justify-content: flex-start; padding: 0; font-weight: 650; white-space: normal; text-align: left; }
</style>
