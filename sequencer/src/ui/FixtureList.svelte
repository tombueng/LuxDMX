<script lang="ts">
  // The patch as a list of real objects: icon in its live colour, what it is, where it's patched,
  // how bright it is right now. Select like a file manager, drag to reorder, copy / paste / duplicate.
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import Hint from './Hint.svelte';
  import Help from './Help.svelte';
  import FixtureEditor from './FixtureEditor.svelte';
  import { app } from '../app.svelte';
  import { spansOf } from '../model/pixelLayout';
  import { KIND_LABEL, typeLabel } from '../model/library';
  import { RISK_HINT, RISK_LABEL, riskOf } from '../model/safety';
  import { levelOf, lookColor } from '../engine/cuelook';
  import { ui, listKeys, navKeys, gripDrag, menuKey } from './ui.svelte';
  import { fixtureActions, fixtureMenu } from './actions';
  import { whileShown } from './shown.svelte';
  import type { FixtureType } from '../model/types';

  let editType = $state<FixtureType | null>(null);
  let anchor = $state<string | null>(null);       // last clicked, for Shift ranges
  let drag = $state<string[] | null>(null);
  let dropAt = $state<{ index: number; after: boolean } | null>(null);

  const width = (id: string) => app.modeOf(id)?.channels.length ?? 1;
  const clash = $derived.by(() => {
    const used = new Map<string, string>(), bad = new Set<string>();
    for (const f of app.show.fixtures)
      for (let c = 0; c < width(f.id); c++) {
        const k = `${f.universe}.${f.address + c}`, o = used.get(k);
        if (o && o !== f.id) { bad.add(f.id); bad.add(o); } else used.set(k, f.id);
      }
    return bad;
  });
  const groupsOf = $derived(Object.fromEntries(app.show.fixtures.map((f) => [f.id, app.show.groups.filter((g) => g.fixtures.includes(f.id)).map((g) => g.name).join(', ')])));
  // A big rig gets a filter: by name, type, group or address ("17" finds the light at 17).
  let filter = $state('');
  const shown = (f: { id: string; name: string; typeId: string; address: number; universe: number }) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    if (/^\d+$/.test(q)) return f.address === +q || (f.address <= +q && +q < f.address + width(f.id));
    const t = app.types.get(f.typeId);
    return `${f.name} ${t ? typeLabel(t) : ''} ${groupsOf[f.id] ?? ''}`.toLowerCase().includes(q);
  };
  const oneUni = $derived(new Set(app.show.fixtures.map((f) => f.universe)).size <= 1);
  // each row's live colour (held while the view is hidden: hundreds of rows redrawn for nobody)
  const stage = whileShown(() => app.stage);
  const usage = $derived.by(() => {
    const u = new Map<number, number>();
    for (const f of app.show.fixtures) for (const s of spansOf(f, app.modeOf(f.id))) u.set(s.universe, (u.get(s.universe) ?? 0) + s.count);
    return [...u.entries()].sort((a, b) => a[0] - b[0]);
  });

  let listEl = $state<HTMLElement>();
  // A light selected on the stage (2D or 3D; on a big rig often far down this list): the list scrolls
  // to it, so the selection shows here too. Not when the list did the selecting (it's in view).
  $effect(() => {
    const sel = app.selected, id = sel[sel.length - 1];
    if (!id || !listEl) return;
    untrack(() => {
      if (listEl!.contains(document.activeElement)) return;
      listEl!.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  });
  const nav = navKeys({ ids: () => app.show.fixtures.filter((f) => shown(f)).map((f) => f.id), sel: () => app.selected, set: (ids) => { app.selected = ids; },
    open: (id) => { if (app.selected.length > 1 && app.selected.includes(id)) ui.patchMany = [...app.selected]; else ui.patch = id; }, scope: () => listEl, move: (ids, to) => app.moveFixtures(ids, to) });
  // While filtered, select-all and Shift ranges take the rows you can see, nothing hidden.
  const visible = () => app.show.fixtures.filter((f) => shown(f)).map((f) => f.id);
  const keys = listKeys({ copy: () => copy(), cut: () => cut(), paste: () => paste(), duplicate: () => dup(), del: () => del(), all: () => { app.selected = visible(); } });
  function click(e: MouseEvent, id: string) {
    if (e.shiftKey && anchor && visible().includes(anchor)) {
      const ids = visible(), a = ids.indexOf(anchor), b = ids.indexOf(id);
      app.selected = [...new Set([...app.selected, ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)])];
    } else app.select(id, e.ctrlKey || e.metaKey);
    anchor = id;
  }
  const { copy, cut, paste, duplicate: dup, remove: del, group } = fixtureActions;
  function menu(e: MouseEvent, id: string) {
    const t = app.types.get(app.show.fixtures.find((x) => x.id === id)!.typeId);
    const items = fixtureMenu(id, [
      { label: t?.source === 'user' ? 'Edit fixture type…' : 'Change the channel layout (a copy)…', icon: 'wizard', run: () => (editType = t ?? null) },
    ]);
    items.splice(items.length - 2, 0, { label: 'Move up', icon: 'up', keys: 'Alt+↑', run: () => moveBy(-1) }, { label: 'Move down', icon: 'down', keys: 'Alt+↓', run: () => moveBy(1) });
    ui.openMenu(e, items);
  }
  // A saved copy of a type: the selected fixtures of the old type use the new one.
  function retype(id: string) {
    const old = editType?.id;
    if (!old || old === id) return;
    const t = app.types.get(id);
    for (const f of app.show.fixtures) if (f.typeId === old && app.selected.includes(f.id)) { f.typeId = id; f.mode = t?.modes.find((m) => m.name === f.mode)?.name ?? t?.modes[0]?.name ?? f.mode; }
    app.markDirty(0);
    ui.toast('The selected fixtures use the adjusted type now');
  }
  function moveBy(d: number) {
    const ids = app.show.fixtures.map((f) => f.id), idx = app.selected.map((x) => ids.indexOf(x));
    const lo = Math.min(...idx), hi = Math.max(...idx);
    if (d < 0 && lo > 0) app.moveFixtures(app.selected, lo - 1);
    else if (d > 0 && hi < ids.length - 1) app.moveFixtures(app.selected, hi + 2);
  }
  function dragStart(e: DragEvent, id: string) {
    if (!app.selected.includes(id)) app.select(id, false);
    drag = [...app.selected];
    e.dataTransfer?.setData('text/plain', 'luxdmx-fixtures');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }
  function dragOver(e: DragEvent, index: number) {
    if (!drag) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropAt = { index, after: e.clientY > r.top + r.height / 2 };
  }
  function drop(e: DragEvent) {
    e.preventDefault();
    if (drag && dropAt) app.moveFixtures(drag, dropAt.index + (dropAt.after ? 1 : 0));
    drag = null; dropAt = null;
  }
</script>

<div class="panel fl">
  <div class="row head">
    <h2>Fixtures</h2>
    <span class="chip">{app.show.fixtures.length}</span>
    <span class="grow"></span>
    <Help>
      <p><b>Fixtures</b> are your lights. Add them from the generic types (most cheap PARs fit one), the library of 2400+ fixtures, a GDTF / QLC+ file, or make your own type, even by trying the channels on the real fixture.</p>
      <p>Click to select, Shift for a range, Ctrl for single ones. Drag to reorder: the order is the order effects run in. Right-click for more.</p>
    </Help>
    <button class="primary" onclick={() => (ui.modal = 'addFixtures')}><Icon name="plus" />Add</button>
  </div>
  {#if app.show.fixtures.length}<Hint>Your lights: select them here or on the stage, then set them in the programmer.</Hint>{/if}

  <!-- Always there (buttons greyed out without a selection), so the list never jumps under the mouse. -->
  {#if app.show.fixtures.length}
    <div class="toolbar selbar" class:none={!app.selected.length}>
      {#if app.selected.length}<span class="muted">{app.selected.length} selected</span>{/if}<span class="grow"></span>
      <button class="ghost" title="Copy (Ctrl+C)" aria-label="Copy fixtures" onclick={copy} disabled={!app.selected.length}><Icon name="copy" /></button>
      <button class="ghost" title="Cut (Ctrl+X)" aria-label="Cut fixtures" onclick={cut} disabled={!app.selected.length}><Icon name="cut" /></button>
      <button class="ghost" title="Paste (Ctrl+V)" aria-label="Paste fixtures" onclick={paste}><Icon name="paste" /></button>
      <button class="ghost" title="Duplicate (Ctrl+D)" aria-label="Duplicate fixtures" onclick={dup} disabled={!app.selected.length}><Icon name="duplicate" /></button>
      <button class="ghost" title="Make a group" aria-label="Group fixtures" onclick={group} disabled={!app.selected.length}><Icon name="group" /></button>
      <button class="ghost danger" title="Remove (Del)" aria-label="Remove fixtures" onclick={del} disabled={!app.selected.length}><Icon name="trash" /></button>
    </div>
  {/if}

  {#if app.show.fixtures.length === 0}
    <!-- quiet: the stage's welcome card is where a first-timer starts -->
    <div class="empty">
      <p class="muted">No lights yet.</p>
      <button onclick={() => (ui.modal = 'addFixtures')}><Icon name="plus" />Add your first lights</button>
    </div>
  {:else}
    {#if app.show.fixtures.length > 12 || filter}
      <input class="filter" type="search" bind:value={filter} placeholder="Filter: name, type or address" aria-label="Filter fixtures" />
    {/if}
    <ul class="olist" tabindex="0" role="listbox" aria-label="Fixtures" aria-multiselectable="true" bind:this={listEl}
        onkeydown={(e) => { if (menuKey(e, listEl, app.selected[app.selected.length - 1], (p, id) => menu(p as MouseEvent, id))) return; if (!nav(e)) keys(e); }}>
      {#each app.show.fixtures as f, i (f.id)}
        {#if shown(f)}
        {@const l = stage()[f.id]}
        {@const lc = lookColor(l)}
        {@const kind = app.kinds[f.id] ?? 'other'}
        {@const t = app.types.get(f.typeId)}
        {@const risk = riskOf(app.modeOf(f.id)?.channels.map((c) => c.attr) ?? [])}
        <!-- svelte-ignore a11y_click_events_have_key_events (the listbox handles the keys) -->
        <li class="oitem" class:sel={app.selected.includes(f.id)} class:clash={clash.has(f.id)} role="option" aria-selected={app.selected.includes(f.id)} data-id={f.id}
            class:drop-before={dropAt?.index === i && !dropAt.after} class:drop-after={dropAt?.index === i && dropAt.after}
            draggable="true" ondragstart={(e) => dragStart(e, f.id)} ondragover={(e) => dragOver(e, i)} ondrop={drop}
            ondragend={() => { drag = null; dropAt = null; }}
            onclick={(e) => click(e, f.id)} ondblclick={() => (ui.patch = f.id)} oncontextmenu={(e) => menu(e, f.id)}
            data-fixture={f.name}>
          <span class="grip" aria-hidden="true" onpointerdown={(e) => {
            if (!app.selected.includes(f.id)) app.select(f.id, false);
            const ids = [...app.selected];
            gripDrag(e, { list: () => listEl, over: (index, after) => (dropAt = { index, after }),
              drop: () => { if (dropAt) app.moveFixtures(ids, dropAt.index + (dropAt.after ? 1 : 0)); dropAt = null; }, cancel: () => (dropAt = null) });
          }}><Icon name="grip" size={14} /></span>
          <span class="ico" style="color:{lc.glow > 0.02 ? lc.css : 'var(--muted)'};background:{lc.glow > 0.02 ? lc.css.replace('rgb', 'rgba').replace(')', ',.16)') : 'transparent'}" title={KIND_LABEL[kind]}>
            <Icon name={kind} size={18} />
          </span>
          <span class="txt">
            <span class="nm">{f.name}</span>
            <span class="faint">{t ? typeLabel(t) : f.typeId}{t && t.modes.length > 1 ? ` · ${f.mode}` : ''}{groupsOf[f.id] ? ` · ${groupsOf[f.id]}` : ''}</span>
          </span>
          {#if risk !== 'light'}<span class="chip risk {risk}" title="{RISK_LABEL[risk]}: {RISK_HINT[risk]}{(risk === 'once' || risk === 'hazard') ? (app.sfxArmed ? ' Armed right now.' : ' Safe right now (not armed).') : ''}">{RISK_LABEL[risk]}{#if risk === 'once' || risk === 'hazard'} · {app.sfxArmed ? 'armed' : 'safe'}{/if}</span>{/if}
          <span class="chip addr" title={clash.has(f.id) ? 'Overlaps another fixture!' : `Universe ${f.universe}, DMX ${f.address} to ${f.address + width(f.id) - 1}`}>{oneUni ? f.address : `U${f.universe} · ${f.address}`}</span>
          <span class="lvl" title="Intensity right now"><span style="height:{Math.round(levelOf(l) * 100)}%"></span></span>
        </li>
        {/if}
      {/each}
    </ul>
    <div class="usage">
      {#each usage as [u, n] (u)}
        <span class="chip" class:orange={n > 512} title="Channels used on universe {u}">U{u}: {n}/512</span>
      {/each}
      <button class="ghost sm check" onclick={() => (ui.modal = 'patchCheck')} title="Light one fixture at a time to check the addresses in the room"><Icon name="sun" size={13} />Check the patch</button>
    </div>
  {/if}
</div>

{#if editType}<FixtureEditor type={editType} onclose={() => (editType = null)} onsaved={retype} />{/if}

<style>
  .fl { display: flex; flex-direction: column; gap: .4rem; min-height: 0; height: 100%; }
  .head { flex-wrap: nowrap; }
  .selbar { padding: .2rem .3rem; background: #ffaa1c0d; border-radius: var(--radius-s); flex-wrap: nowrap; min-height: 2.1rem; }
  .selbar.none { background: none; }
  .selbar .muted { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .olist { overflow: auto; min-height: 0; flex: 1; outline: none; }
  .ico { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; flex: none; transition: background .1s; }
  .txt { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 550; }
  .txt .faint { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .addr { font-variant-numeric: tabular-nums; }
  .clash .addr { color: var(--pink); border-color: var(--pink); }
  .lvl { width: 5px; height: 26px; background: var(--line); border-radius: 3px; display: flex; align-items: flex-end; overflow: hidden; flex: none; }
  .lvl span { width: 100%; background: var(--orange); }
  .check { margin-left: auto; font-size: .78rem; padding: .1rem .4rem; }
  .filter { width: 100%; padding: .3rem .5rem; font-size: .85rem; }
  .usage { display: flex; gap: .3rem; flex-wrap: wrap; align-items: center; }
  .empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: .5rem; padding: 1.5rem .5rem; color: var(--muted); }
  .risk { font-size: .7rem; white-space: nowrap; }
  .risk.atmosphere { color: #9fb4c8; }
  .risk.once { color: #e8c44a; border-color: #e8c44a55; }
  .risk.hazard { color: #ff8a5c; border-color: #ff7a1c88; font-weight: 650; }
</style>
