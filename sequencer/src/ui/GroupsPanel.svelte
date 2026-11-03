<script lang="ts">
  // Groups: named, ordered sets of fixtures. One click selects them; effects run along their order.
  import Icon from './Icon.svelte';
  import Help from './Help.svelte';
  import { app, newId } from '../app.svelte';
  import { focusSelect, ui } from './ui.svelte';
  import { lookColor } from '../engine/cuelook';
  import { whileShown } from './shown.svelte';
  const stage = whileShown(() => app.stage);       // (held while the view is hidden)

  let renaming = $state<string | null>(null);
  let was = '';                       // the name before a rename
  let drag = $state<string | null>(null);
  let dropAt = $state<number | null>(null);

  async function make() {
    if (!app.selected.length) return ui.toast('Select some lights first, then make a group of them');
    const name = await ui.ask('New group', `Group ${app.show.groups.length + 1}`, { ok: 'Make the group' });
    if (name) app.groupFromSelection(name);
  }
  function auto() {
    // One group per fixture kind and per type, for everything not grouped yet.
    const byType = new Map<string, string[]>();
    for (const f of app.show.fixtures) byType.set(f.typeId, [...(byType.get(f.typeId) ?? []), f.id]);
    let n = 0;
    for (const [typeId, ids] of byType) {
      if (ids.length < 2 || app.show.groups.some((g) => g.fixtures.length === ids.length && ids.every((i) => g.fixtures.includes(i)))) continue;
      const t = app.types.get(typeId);
      app.show.groups.push({ id: newId('g'), name: `All ${t?.model ?? 'fixtures'}`, fixtures: ids, auto: true });
      n++;
    }
    ui.toast(n ? `Made ${n} group${n > 1 ? 's' : ''}` : 'Every fixture type is grouped already');
  }
  function del(id: string) {
    const n = app.groupUse(id), name = app.show.groups.find((g) => g.id === id)?.name;
    app.removeGroup(id);
    app.toastUndo(n ? `Deleted "${name}". Its effects keep running on its lights, its flash buttons are gone.` : `Deleted "${name}"`);
  }
  function menu(e: MouseEvent, id: string) {
    const g = app.show.groups.find((x) => x.id === id)!;
    ui.openMenu(e, [
      { label: 'Select', icon: 'check', run: () => app.selectGroup(id) },
      { label: 'Add to selection', icon: 'plus', run: () => app.selectGroup(id, true) },
      { label: 'Set to the selected lights', icon: 'update', disabled: !app.selected.length, run: () => { g.fixtures = app.show.fixtures.map((f) => f.id).filter((x) => app.selected.includes(x)); } },
      { label: 'Rename', icon: 'edit', run: () => (renaming = id) },
      { sep: true },
      { label: 'Delete group', icon: 'trash', danger: true, run: () => del(id) },
    ]);
  }
</script>

<div class="panel gp">
  <div class="row head">
    <h2>Groups</h2><span class="chip">{app.show.groups.length}</span><span class="grow"></span>
    <Help><p>A <b>group</b> is a named set of lights, like "Front" or "Movers". Click it to select them all at once. Effects run along the group's order, so a chase goes left to right if the group is ordered that way: drag lights in the fixture list to change it.</p></Help>
    <button class="primary" onclick={make} title="Group the selected lights"><Icon name="plus" />From selection</button>
  </div>
  {#if !app.show.groups.length}
    <div class="empty">
      <Icon name="group" size={30} />
      <p>No groups yet. Select lights and press <b>From selection</b>, or let the app group them by type.</p>
      <button onclick={auto} disabled={!app.show.fixtures.length}>Group by fixture type</button>
    </div>
  {:else}
    <!-- A plain list: each group is a button (select it; F2 renames, Delete removes) plus its ⋯. -->
    <ul class="olist" aria-label="Groups">
      {#each app.show.groups as g, i (g.id)}
        {@const allSel = g.fixtures.length > 0 && g.fixtures.every((id) => app.selected.includes(id))}
        <li class="oitem" class:sel={allSel} class:drop-before={dropAt === i} draggable="true"
            ondragstart={() => (drag = g.id)} ondragover={(e) => { if (drag) { e.preventDefault(); dropAt = i; } }}
            ondrop={(e) => { e.preventDefault(); if (drag) app.moveGroup(drag, i); drag = null; dropAt = null; }} ondragend={() => { drag = null; dropAt = null; }}
            oncontextmenu={(e) => menu(e, g.id)} data-group={g.name}>
          <span class="grip" aria-hidden="true"><Icon name="grip" size={14} /></span>
          <span class="ico"><Icon name="group" size={18} /></span>
          {#if renaming === g.id}
            <!-- svelte-ignore a11y_autofocus -->
            <!-- Enter keeps the name, Esc puts the old one back; the focus goes back to the group -->
            <input bind:value={g.name} use:focusSelect onfocus={() => (was = g.name)} onblur={() => { if (!g.name.trim()) g.name = was; renaming = null; app.markDirty(0); }} onclick={(e) => e.stopPropagation()} aria-label="Group name"
                   onkeydown={(e) => { if (e.key !== 'Enter' && e.key !== 'Escape') return; e.preventDefault(); e.stopPropagation(); if (e.key === 'Escape' || !g.name.trim()) g.name = was; const row = e.currentTarget.closest('li'); renaming = null; queueMicrotask(() => row?.querySelector<HTMLElement>('button.main')?.focus()); }} />
          {:else}
            <button class="main" aria-pressed={allSel} title="Select {g.name} (Shift or Ctrl adds)"
                    onclick={(e) => app.selectGroup(g.id, e.shiftKey || e.ctrlKey || e.metaKey)}
                    onkeydown={(e) => { if (e.key === 'F2') { e.preventDefault(); renaming = g.id; } else if (e.key === 'Delete') del(g.id); }}>
              <span class="txt"><span class="nm">{g.name}</span><span class="faint">{g.fixtures.length} light{g.fixtures.length === 1 ? '' : 's'}</span></span>
              <span class="dots">
                {#each g.fixtures.slice(0, 12) as id (id)}{@const lc = lookColor(stage()[id])}<span class="d" style="background:{lc.glow > 0.02 ? lc.css : 'var(--line)'}"></span>{/each}
              </span>
            </button>
          {/if}
          <button class="ghost" onclick={(e) => { e.stopPropagation(); menu(e, g.id); }} aria-label="More for {g.name}"><Icon name="more" /></button>
        </li>
      {/each}
    </ul>
    <button class="ghost" onclick={auto}><Icon name="group" />Group the rest by type</button>
  {/if}
</div>

<style>
  .gp { display: flex; flex-direction: column; gap: .45rem; height: 100%; min-height: 0; }
  .head { flex-wrap: nowrap; }
  .olist { overflow: auto; }
  .ico { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; color: var(--cyan); background: #36d6e714; flex: none; }
  .txt { display: flex; flex-direction: column; flex: 1; min-width: 0; } .nm { font-weight: 550; }
  .dots { display: flex; gap: 2px; flex-wrap: wrap; max-width: 70px; }
  .d { width: 7px; height: 7px; border-radius: 50%; }
  .empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: .5rem; padding: 1.2rem .5rem; color: var(--muted); }
  .main { flex: 1; min-width: 0; display: flex; align-items: center; gap: .45rem; justify-content: flex-start; background: none; border: 0; padding: 0; text-align: left; }
  .main:hover:not(:disabled) { background: none; }
</style>
