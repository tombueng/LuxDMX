<script lang="ts">
  // The show's effects: start / stop them by hand, tune them, put them in cues (Record), reorder,
  // copy and paste. The selected one opens its knobs underneath.
  import Icon from './Icon.svelte';
  import Hint from './Hint.svelte';
  import Help from './Help.svelte';
  import EffectPreview from './EffectPreview.svelte';
  import EffectEditor from './EffectEditor.svelte';
  import { app } from '../app.svelte';
  import { ui, listKeys, navKeys, gripDrag, menuKey } from './ui.svelte';
  import { EFFECT_MAP, CATEGORY_LABEL } from '../engine/effects';
  import type { Effect } from '../model/types';

  let drag = $state<string[] | null>(null);
  let dropAt = $state<{ index: number; after: boolean } | null>(null);
  const open = $derived(ui.fxSel.length === 1 ? app.show.effects.find((e) => e.id === ui.fxSel[0]) : undefined);
  const usedIn = (id: string) => app.show.cueLists.reduce((n, l) => n + l.cues.filter((c) => c.effects?.includes(id)).length, 0);
  // The effects running on the lights you have selected stand out (a green fill and "on 3 selected"):
  // what you see those lights do may be them, not the values you set.
  const selSet = $derived(new Set(app.selected));
  const onSel = (e: Effect) => (e.group ? app.show.groups.find((g) => g.id === e.group)?.fixtures ?? [] : e.fixtures ?? []).filter((f) => selSet.has(f)).length;
  const onSelText = (n: number) => n >= selSet.size ? (n === 1 ? 'on the selected light' : 'on all selected') : `on ${n} selected`;
  const runningOnSel = $derived(selSet.size ? app.show.effects.filter((e) => (app.fx[e.id] ?? 0) > 0 && onSel(e) > 0).length : 0);
  const where = (id: string) => {
    const e = app.show.effects.find((x) => x.id === id)!;
    if (e.group) return app.show.groups.find((g) => g.id === e.group)?.name ?? 'missing group';
    const n = e.fixtures?.length ?? 0;
    return `${n} light${n === 1 ? '' : 's'}`;
  };

  let listEl = $state<HTMLElement>();
  const nav = navKeys({ ids: () => app.show.effects.map((e) => e.id), sel: () => ui.fxSel, set: (ids) => { ui.fxSel = ids; },
    open: (id) => app.toggleEffect(id), scope: () => listEl, move: (ids, to) => app.moveEffects(ids, to) });
  function click(e: MouseEvent, id: string) {
    if (e.ctrlKey || e.metaKey) ui.fxSel = ui.fxSel.includes(id) ? ui.fxSel.filter((x) => x !== id) : [...ui.fxSel, id];
    else if (e.shiftKey && ui.fxSel.length) {
      const ids = app.show.effects.map((x) => x.id), a = ids.indexOf(ui.fxSel[ui.fxSel.length - 1]), b = ids.indexOf(id);
      ui.fxSel = [...new Set([...ui.fxSel, ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)])];
    } else ui.fxSel = [id];
  }
  const copy = async () => { const n = await app.copyEffects(ui.fxSel); if (n) ui.toast(`Copied ${n} effect${n > 1 ? 's' : ''}`); };
  const cut = async () => { const n = await app.copyEffects(ui.fxSel); if (n) { app.removeEffects(ui.fxSel); ui.fxSel = []; ui.toast(`Cut ${n}`); } };
  const paste = async () => { const ids = await app.pasteEffects(); if (ids.length) { ui.fxSel = ids; ui.toast(`Pasted ${ids.length}`); } else ui.toast('Nothing to paste'); };
  const dup = async () => { if (await app.copyEffects(ui.fxSel)) { ui.fxSel = await app.pasteEffects(); } };
  function del() {
    if (!ui.fxSel.length) return;
    const uses = ui.fxSel.reduce((n, id) => n + usedIn(id), 0), n = ui.fxSel.length;
    const also = app.removeEffects(ui.fxSel); ui.fxSel = [];
    const parts = [uses ? `taken out of ${uses} cue${uses > 1 ? 's' : ''}` : '', also ? `${also} went too` : ''].filter(Boolean).join('; ');
    app.toastUndo(`Deleted ${n} effect${n > 1 ? 's' : ''}${parts ? ` (${parts})` : ''}`);
  }
  function menu(e: MouseEvent, id: string) {
    if (!ui.fxSel.includes(id)) ui.fxSel = [id];
    const live = app.liveFx.includes(id);
    ui.openMenu(e, [
      { label: live ? 'Stop' : 'Start', icon: live ? 'stop' : 'play', run: () => app.toggleEffect(id) },
      { label: 'Run on the selected lights', icon: 'check', disabled: !app.selected.length, run: () => {
        const fx = app.show.effects.find((x) => x.id === id)!;
        delete fx.group; fx.fixtures = app.show.fixtures.map((f) => f.id).filter((f) => app.selected.includes(f));
      } },
      { sep: true },
      { label: 'Copy', icon: 'copy', keys: 'Ctrl+C', run: copy },
      { label: 'Cut', icon: 'cut', keys: 'Ctrl+X', run: cut },
      { label: 'Paste', icon: 'paste', keys: 'Ctrl+V', run: paste },
      { label: 'Duplicate', icon: 'duplicate', keys: 'Ctrl+D', run: dup },
      { sep: true },
      { label: 'Delete', icon: 'trash', keys: 'Del', danger: true, run: del },
    ]);
  }
  function dragStart(e: DragEvent, id: string) {
    if (!ui.fxSel.includes(id)) ui.fxSel = [id];
    drag = [...ui.fxSel];
    e.dataTransfer?.setData('text/plain', 'luxdmx-effects');
    e.dataTransfer?.setData('application/x-luxdmx-effect', id);       // can be dropped on a cue card
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
  }
  function dragOver(e: DragEvent, index: number) {
    if (!drag) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropAt = { index, after: e.clientY > r.top + r.height / 2 };
  }
  function drop(e: DragEvent) {
    e.preventDefault();
    if (drag && dropAt) app.moveEffects(drag, dropAt.index + (dropAt.after ? 1 : 0));
    drag = null; dropAt = null;
  }
</script>

<div class="panel ep" data-marks="hide">
  <div class="row head">
    <h2>Effects</h2><span class="chip">{app.show.effects.length}</span><span class="grow"></span>
    <Help>
      <p><b>Effects</b> make lights move on their own: chases, rainbows, circles with moving heads, fire, lightning...</p>
      <p>Pick one from the library and it runs on the selected lights (or a group) right away, on top of everything. Press it again to stop. Press <b>Record</b> while it runs and it goes into the new cue: then it starts and stops with that cue.</p>
      <p>Speed follows the tempo (Tap in the top bar) unless you switch that off. Spread decides whether the lights do it together or one after the other.</p>
    </Help>
    <button class="primary" onclick={() => (ui.modal = 'effects')}><Icon name="plus" />Add</button>
  </div>
  {#if app.show.effects.length}<Hint>Running effects have a green edge. Click one to change its speed, size and colours.</Hint>{/if}
  {#if app.show.effects.length && selSet.size}
    <p class="selnote" class:some={runningOnSel > 0} data-testid="fx-on-selection">
      {runningOnSel ? `${runningOnSel} running on` : 'Nothing running on'} the {selSet.size === 1 ? 'selected light' : `${selSet.size} selected lights`}
    </p>
  {/if}

  {#if !app.show.effects.length}
    <div class="empty">
      <EffectPreview kind="rainbow" w={180} h={40} />
      <p>No effects yet. Select some lights and pick one: chase, rainbow, circle, fire...</p>
      <button class="primary" onclick={() => (ui.modal = 'effects')}><Icon name="effect" />Open the effect library</button>
    </div>
  {:else}
    <ul class="olist" tabindex="0" role="listbox" aria-label="Effects" aria-multiselectable="true" bind:this={listEl}
        onkeydown={(e) => { if (menuKey(e, listEl, ui.fxSel[ui.fxSel.length - 1], (p, id) => menu(p as MouseEvent, id))) return;
          if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey && !e.altKey && ui.fxSel.length) { e.preventDefault(); e.stopPropagation(); for (const id of ui.fxSel) app.toggleEffect(id); return; }
          if (!nav(e)) listKeys({ copy, cut, paste, duplicate: dup, del, all: () => { ui.fxSel = app.show.effects.map((x) => x.id); } })(e); }}>
      {#each app.show.effects as e, i (e.id)}
        {@const def = EFFECT_MAP.get(e.kind)}
        {@const live = app.liveFx.includes(e.id)}
        {@const w = app.fx[e.id] ?? 0}
        {@const hits = w > 0 && selSet.size ? onSel(e) : 0}
        <!-- svelte-ignore a11y_click_events_have_key_events (the listbox handles the keys) -->
        <li class="oitem" class:sel={ui.fxSel.includes(e.id)} class:running={w > 0} class:onsel={hits > 0} role="option" aria-selected={ui.fxSel.includes(e.id)} data-id={e.id}
            class:drop-before={dropAt?.index === i && !dropAt.after} class:drop-after={dropAt?.index === i && dropAt.after}
            draggable="true" ondragstart={(ev) => dragStart(ev, e.id)} ondragover={(ev) => dragOver(ev, i)} ondrop={drop}
            ondragend={() => { drag = null; dropAt = null; }} onclick={(ev) => click(ev, e.id)} oncontextmenu={(ev) => menu(ev, e.id)} data-effect={e.name}>
          <span class="grip" aria-hidden="true" onpointerdown={(ev) => {
            if (!ui.fxSel.includes(e.id)) ui.fxSel = [e.id];
            const ids = [...ui.fxSel];
            gripDrag(ev, { list: () => listEl, over: (index, after) => (dropAt = { index, after }),
              drop: () => { if (dropAt) app.moveEffects(ids, dropAt.index + (dropAt.after ? 1 : 0)); dropAt = null; }, cancel: () => (dropAt = null) });
          }}><Icon name="grip" size={14} /></span>
          <EffectPreview kind={e.kind} params={e.params} w={58} h={26} n={def?.category === 'move' ? 2 : 5} bpm={app.bpm} paused={w <= 0} />
          <span class="txt">
            <span class="nmrow"><span class="nm">{e.name}</span>{#if hits}<span class="onsel-tag">{onSelText(hits)}</span>{/if}</span>
            <span class="faint">{def ? CATEGORY_LABEL[def.category] : e.kind} · {where(e.id)}{usedIn(e.id) ? ` · ${usedIn(e.id)} cue${usedIn(e.id) > 1 ? 's' : ''}` : ''}</span>
          </span>
          <!-- Not a button inside the option (screen readers can't reach those): click it, or P from the keyboard. -->
          <span class="play" class:on={live} role="presentation" onclick={(ev) => { ev.stopPropagation(); app.toggleEffect(e.id); }}
                title={live ? 'Stop (P)' : w > 0 ? 'Running from a cue. Click to also run it by hand (P)' : 'Start (P)'} data-play={live ? 'stop' : 'start'}>
            <Icon name={live ? 'stop' : 'play'} size={14} />
          </span>
          {#if w > 0}<span class="sr-only">, running{hits ? `, ${onSelText(hits)}` : ''}</span>{/if}
        </li>
      {/each}
    </ul>
    <!-- The list and the editor scroll on their own: the editor is always in sight under the list. -->
    {#if open}<div class="editor">{#key open.id}<EffectEditor id={open.id} />{/key}</div>{:else if ui.fxSel.length > 1}<p class="muted">{ui.fxSel.length} effects selected.</p>{/if}
  {/if}
</div>


<style>
  .ep { display: flex; flex-direction: column; gap: .45rem; height: 100%; min-height: 0; }
  .head { flex-wrap: nowrap; }
  .olist { outline: none; flex: 0 1 auto; min-height: 3.5rem; overflow: auto; }
  .ep:has(.editor) .olist { max-height: 32%; }
  .editor { flex: 1 1 auto; min-height: 0; overflow: auto; border-top: 1px solid var(--line); padding-top: .4rem; }
  .oitem.running { box-shadow: inset 3px 0 0 var(--green); }
  .oitem.onsel { background: color-mix(in srgb, var(--green) 13%, transparent); box-shadow: inset 4px 0 0 var(--green); }
  .oitem.onsel:not(.sel) { border-color: color-mix(in srgb, var(--green) 45%, transparent); }
  .onsel-tag { flex: none; font-size: .72rem; font-weight: 600; padding: 0 .4rem; border-radius: 999px; background: var(--green); color: #07150b; white-space: nowrap; }
  .selnote { margin: 0; font-size: .8rem; color: var(--muted); }
  .selnote.some { color: var(--green); }
  .txt { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .nmrow { display: flex; align-items: center; gap: .35rem; min-width: 0; }
  .nm { font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .txt .faint { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .play { display: grid; place-items: center; border-radius: 50%; width: 28px; height: 28px; flex: none; border: 1px solid var(--line); background: var(--panel2); cursor: pointer; }
  .play:hover { border-color: var(--line2); }
  .play.on { background: var(--green); border-color: var(--green); color: #07150b; }
  @media (pointer: coarse) { .play { width: 38px; height: 38px; } }
  .empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: .5rem; padding: 1rem .5rem; color: var(--muted); }
</style>
