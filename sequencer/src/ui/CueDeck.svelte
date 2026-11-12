<script lang="ts">
  import { isLooks, isPlay } from '../model/library';
  import { cueRiskOf } from './risk';
  import { revealIn } from './reveal';
  import { cueNumber, numbered } from '../model/cuenum';
  // Cue lists as decks of cards. Every card shows a picture of the look at that cue, its timing and
  // what happens next. Select like files, drag to reorder, copy / cut / paste / duplicate, right-click
  // for everything else; the selected cue's details sit on the right.
  import Icon from './Icon.svelte';
  import Help from './Help.svelte';
  import CueInspector from './CueInspector.svelte';
  import { app } from '../app.svelte';
  import { dialogOpen, focusSelect, spaceIsGo, ui, listKeys, menuKey } from './ui.svelte';
  import { stageSvg, svgImage } from './thumb';
  import type { Advance, Cue } from '../model/types';
  import { whileShown } from './shown.svelte';

  const list = $derived(app.list);
  // what plays (held while the view is hidden; it's read again the moment it's shown)
  const status = whileShown(() => app.status);
  const st = $derived(list ? status()[list.id] : undefined);
  // the cue on stage stays in view as the show goes on (a long list in a short panel)
  const liveId = $derived(st?.running ? st.cue : '');
  $effect(() => {
    if (!liveId || !cardsEl || !app.followSel) return;
    revealIn(cardsEl, cardsEl.querySelector(`[data-id="${CSS.escape(liveId)}"]`) as HTMLElement | null);   // the cards only, not the page
  });
  const thumbs = $derived.by(() => {
    if (!list) return [];
    // From the plain copy of the show (refreshed after each burst of edits), not the live one:
    // dragging a light on the stage mustn't redraw every card on every mouse move.
    const looks = app.cueLooksOf.get(list.id) ?? [];
    const fixtures = app.plain?.fixtures ?? [];
    const own = isLooks(list);                // a look's card: what it names, the rest as outlines
    return looks.map((l) => stageSvg(fixtures, l, app.kinds, 160, 90, own, (id) => app.placesOf(id), (id) => app.caps(id).cells));
  });
  let settings = $state(false);
  let renaming = $state<string | null>(null);
  const fxNames = (ids: string[]) => ids.map((id) => app.show.effects.find((e) => e.id === id)?.name ?? '?').join(', ');
  let drag = $state<string[] | null>(null);
  let dropAt = $state<{ index: number; after: boolean } | null>(null);

  const adv = (a: Advance) => a.mode === 'manual' ? 'GO' : a.mode === 'wait' ? `auto ${a.time} s` : a.mode === 'follow' ? (a.time ? `then ${a.time} s` : 'follows') : `${a.beats} beats`;
  const advTitle = (a: Advance) => a.mode === 'manual' ? 'Waits for GO' : a.mode === 'wait' ? `Next cue ${a.time} s after this one starts`
    : a.mode === 'follow' ? (a.time ? `Next cue ${a.time} s after the fade` : 'The next cue follows by itself when the fade is done') : `Next cue after ${a.beats} beats`;

  function record() {
    if (!app.record()) ui.toast('Nothing to record: select lights and change something first');
    else ui.toast('Recorded');
  }
  // The selection follows playback (the app moves it on GO, Back, a jump), unless you picked a
  // card yourself. Update goes into the selected card (the last one picked of several): after a
  // GO that's the cue on stage; pick another and it goes there, with a warning that the stage
  // shows something else. The live cue by id: while cues are added or removed the index can be a
  // tick behind, the id never is.
  const liveCue = $derived(list && st?.running ? list.cues.find((c) => c.id === st.cue) : undefined);
  const updateTarget = $derived(list ? list.cues.find((c) => c.id === app.cueSel[app.cueSel.length - 1]) ?? liveCue : undefined);
  const updateElsewhere = $derived(!!updateTarget && !!liveCue && updateTarget.id !== liveCue.id);
  function update(on?: Cue) {
    const c = on ?? updateTarget;
    if (!c) return ui.toast('Play or select the cue to update first');
    ui.toast(app.updateCue(c.id) ? `"${c.name}" updated with your changes` : 'Nothing to update: change some lights first');
  }
  const copy = async () => { const n = await app.copyCues(); if (n) ui.toast(`Copied ${n} cue${n > 1 ? 's' : ''}`); };
  const cut = async () => { const n = await app.cutCues(); if (n) ui.toast(`Cut ${n} cue${n > 1 ? 's' : ''}`); };
  const paste = async () => { const n = await app.pasteCues(); ui.toast(n ? `Pasted ${n} cue${n > 1 ? 's' : ''}` : 'Nothing to paste'); };
  const dup = async () => { await app.duplicateCues(); };
  const del = () => { const n = app.cueSel.length; if (n) { app.deleteCues(); ui.toast(`Deleted ${n} cue${n > 1 ? 's' : ''} (Ctrl+Z brings ${n > 1 ? 'them' : 'it'} back)`); } };

  function click(e: MouseEvent, id: string) {
    app.selectCue(id, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'only');
    // the list keeps the keyboard focus (arrows move the selection), not the card that was clicked
    if (!(e.target as HTMLElement).closest('input')) cardsEl?.focus({ preventScroll: true });
  }
  function menu(e: MouseEvent, id: string, i: number) {
    if (!app.cueSel.includes(id)) app.selectCue(id, 'only');
    const others = app.show.cueLists.filter((l) => l.id !== list?.id);
    ui.openMenu(e, [
      { label: 'Go to this cue', icon: 'play', keys: 'Enter', run: () => app.jump(list!.id, i) },
      { label: 'Update with my changes', icon: 'update', run: () => update(list!.cues[i]) },
      { label: 'Rename', icon: 'edit', keys: 'F2', run: () => (renaming = id) },
      { sep: true },
      { label: 'Copy', icon: 'copy', keys: 'Ctrl+C', run: copy },
      { label: 'Cut', icon: 'cut', keys: 'Ctrl+X', run: cut },
      { label: 'Paste after', icon: 'paste', keys: 'Ctrl+V', run: paste },
      { label: 'Duplicate', icon: 'duplicate', keys: 'Ctrl+D', run: dup },
      { label: 'Move earlier', icon: 'left', keys: 'Alt+←', disabled: i === 0, run: () => app.moveCues(app.cueSel, Math.max(0, i - 1)) },
      { label: 'Move later', icon: 'right', keys: 'Alt+→', disabled: i === list!.cues.length - 1, run: () => app.moveCues(app.cueSel, i + 2) },
      ...others.map((l) => ({ label: `Move to "${l.name}"`, icon: 'folder', run: async () => { await app.cutCues(); app.currentList = l.id; await app.pasteCues(); } })),
      { sep: true },
      { label: 'Delete', icon: 'trash', keys: 'Del', danger: true, run: del },
    ]);
  }
  function tabMenu(e: MouseEvent, id: string) {
    const l = app.show.cueLists.find((x) => x.id === id)!;
    app.currentList = id;
    ui.openMenu(e, [
      { label: app.status[id]?.running ? 'Release (fade out)' : 'Start', icon: app.status[id]?.running ? 'stop' : 'play', run: () => (app.status[id]?.running ? app.release(id) : app.engine.start(id)) },
      { label: 'Rename…', icon: 'edit', run: async () => { const n = await ui.ask('Rename the list', l.name); if (n) { l.name = n; app.markDirty(0); } } },
      { label: 'Settings', icon: 'gear', run: () => { settings = true; } },
      { label: l.end === 'loop' ? 'Stop looping' : 'Loop', icon: 'loop', run: () => { l.end = l.end === 'loop' ? 'stop' : 'loop'; app.markDirty(0); } },
      ...(numbered(l) ? [{ label: 'Renumber the cues 1, 2, 3…', icon: 'note', run: () => { app.renumberCues(id); app.toastUndo('Renumbered the cues'); } }] : []),
      { sep: true },
      { label: 'Delete the list', icon: 'trash', danger: true, run: () => { const also = app.removeList(id); app.toastUndo(`Deleted the list "${l.name}"${also ? ` (and what played it: ${also})` : ''}`); } },
    ]);
  }
  let cardsEl = $state<HTMLElement>();
  function arrows(e: KeyboardEvent) {
    if (!list || !list.cues.length) return;
    if (menuKey(e, cardsEl, app.cueSel[app.cueSel.length - 1], (p, id) => menu(p as MouseEvent, id, list!.cues.findIndex((c) => c.id === id)))) return;
    if (e.key === 'F2' && app.cueSel.length) { e.preventDefault(); renaming = app.cueSel[app.cueSel.length - 1]; return; }
    const ids = list.cues.map((c) => c.id), cur = ids.indexOf(app.cueSel[app.cueSel.length - 1]);
    if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && app.cueSel.length) {
      e.preventDefault();
      const idx = app.cueSel.map((x) => ids.indexOf(x)), lo = Math.min(...idx), hi = Math.max(...idx);
      if (e.key === 'ArrowLeft' && lo > 0) app.moveCues(app.cueSel, lo - 1);
      else if (e.key === 'ArrowRight' && hi < ids.length - 1) app.moveCues(app.cueSel, hi + 2);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = Math.max(0, Math.min(ids.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)));
      app.selectCue(ids[n], e.shiftKey ? 'range' : 'only');
    } else if (e.key === 'Enter' && cur >= 0) { e.preventDefault(); app.jump(list.id, cur); }
    else listKeys({ copy, cut, paste, duplicate: dup, del, all: () => { app.cueSel = [...ids]; } })(e);
  }
  function dragStart(e: DragEvent, id: string) {
    if (!app.cueSel.includes(id)) app.selectCue(id, 'only');
    drag = [...app.cueSel];
    e.dataTransfer?.setData('text/plain', 'luxdmx-cues');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }
  // An effect dragged in from the Effects panel goes into the cue it's dropped on.
  let fxDrop = $state<string | null>(null);
  const isEffect = (e: DragEvent) => e.dataTransfer?.types.includes('application/x-luxdmx-effect');
  function dragOver(e: DragEvent, index: number) {
    if (isEffect(e) && list) { e.preventDefault(); fxDrop = list.cues[index]?.id ?? null; return; }
    if (!drag) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropAt = { index, after: e.clientX > r.left + r.width / 2 };
  }
  function drop(e: DragEvent) {
    e.preventDefault();
    const fx = e.dataTransfer?.getData('application/x-luxdmx-effect');
    if (fx && fxDrop) {
      const name = app.show.effects.find((x) => x.id === fx)?.name;
      ui.toast(app.addEffectToCue(fx, fxDrop) ? `${name} runs with this cue now` : `${name} is in this cue already`);
      fxDrop = null;
      return;
    }
    if (drag && dropAt) app.moveCues(drag, dropAt.index + (dropAt.after ? 1 : 0));
    drag = null; dropAt = null;
  }
  function global(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || !list || app.view !== 'program' || dialogOpen()) return;
    if (e.code === 'Space') { if (spaceIsGo(e)) { e.preventDefault(); app.go(); } else if (e.repeat) e.preventDefault(); }
    // F2 renames the cue just recorded (or picked), wherever the focus is (after R it's on the colour you set)
    else if (e.key === 'F2' && !e.defaultPrevented && app.cueSel.length && !(e.target as HTMLElement).closest?.('.olist, .gp, .pp, [role="listbox"]')) {
      e.preventDefault(); renaming = app.cueSel[app.cueSel.length - 1];
    }
  }
</script>

<svelte:window onkeydown={global} />

<div class="panel deck" data-marks="hide">
  <div class="row tabs">
    <h2>Cues</h2>
    <Help>
      <p>A <b>cue</b> is a look: how your lights are set at one moment, plus how long it takes to fade in. A <b>cue list</b> plays them in order: press <b>GO</b> (or Space) for the next one, or let them run on their own (a chase).</p>
      <p>Set some lights, press <b>Record</b>: only the lights you changed go into the cue, everything else is left alone. That's what lets several lists run at once, e.g. house lights and a fog timer next to the show.</p>
      <p><b>Update</b> puts your changes into the selected cue (after a GO, that's the one on stage); the button says which, and turns orange when the stage is showing a different cue.</p>
      <p>Cards: drag to reorder, Ctrl+C / X / V / D to copy, cut, paste, duplicate, Del to delete, right-click (or the Menu key) for more. Double-click a picture to go to that cue, a name to rename it.</p>
    </Help>
    {#each app.show.cueLists as l (l.id)}
      <button class="tab" class:cur={l.id === app.currentList} onclick={() => { app.currentList = l.id; app.cueSel = []; }} oncontextmenu={(e) => tabMenu(e, l.id)}
              ondblclick={async () => { const n = await ui.ask('Rename the list', l.name); if (n) { l.name = n; app.markDirty(0); } }} title="Double-click to rename, right-click for more">
        <span class="dot" class:on={status()[l.id]?.running} style={l.color ? `--c:${l.color}` : ''}></span>{l.name}
        <span class="faint">{l.cues.length}</span>
      </button>
    {/each}
    <button class="ghost" onclick={() => app.newList()} title="A separate cue list that can run at the same time (house lights, a fog timer, a chase)"><Icon name="plus" />List</button>
  </div>

  <div class="row bar">
    <button class="record" onclick={record} title="Store the lights you changed as a new cue{list ? ` in ${list.name}` : ''}"><Icon name="record" />Record{#if app.show.cueLists.length > 1 && list}<span class="tgt">into {list.name}</span>{/if}</button>
    <button class="upd" class:elsewhere={updateElsewhere} onclick={() => update()} disabled={!updateTarget}
            title={!updateTarget ? 'Play or select a cue first' : updateElsewhere ? `Put your changes into "${updateTarget.name}" (selected). The stage shows "${liveCue!.name}"` : `Put your changes into "${updateTarget.name}"`}>
      <Icon name="update" />Update{#if updateTarget}<span class="faint tgt">"{updateTarget.name}"</span>{/if}</button>
    <span class="sep"></span>
    <div class="toolbar">
      <button class="ghost" onclick={copy} disabled={!app.cueSel.length} title="Copy (Ctrl+C)" aria-label="Copy cues"><Icon name="copy" /></button>
      <button class="ghost" onclick={cut} disabled={!app.cueSel.length} title="Cut (Ctrl+X)" aria-label="Cut cues"><Icon name="cut" /></button>
      <button class="ghost" onclick={paste} title="Paste (Ctrl+V)" aria-label="Paste cues"><Icon name="paste" /></button>
      <button class="ghost" onclick={dup} disabled={!app.cueSel.length} title="Duplicate (Ctrl+D)" aria-label="Duplicate cues"><Icon name="duplicate" /></button>
      <button class="ghost danger" onclick={del} disabled={!app.cueSel.length} title="Delete (Del)" aria-label="Delete cues"><Icon name="trash" /></button>
    </div>
    <span class="grow"></span>
    {#if list}
      <label class="lvl" title="This list's level (scales its intensity)"><span class="faint">Level</span>
        <input type="range" min="0" max="1" step="0.01" value={st?.master ?? 1} oninput={(e) => app.setMaster(list.id, +(e.target as HTMLInputElement).value)} aria-label="List level" /></label>
      <button onclick={() => app.back()} disabled={!list.cues.length} title="Previous cue (Backspace)" aria-label="Back"><Icon name="back" /></button>
      <button class="go" onclick={() => app.go()} disabled={!list.cues.length} title="Next cue (Space)">GO <Icon name="play" /></button>
      <button onclick={() => app.release()} disabled={!st?.running} title="Fade this list out">Release</button>
      <button class="ghost" class:on={list.end === 'loop'} onclick={() => (list.end = list.end === 'loop' ? 'stop' : 'loop')} title="Loop: start over after the last cue" aria-label="Loop"><Icon name="loop" /></button>
      <button class="ghost" class:on={settings} onclick={() => (settings = !settings)} title="List settings" aria-label="List settings"><Icon name="gear" /></button>
    {/if}
  </div>

  {#if list && settings}
    <div class="row settings">
      <label>Name <input bind:value={list.name} aria-label="List name" /></label>
      <label>At the end <select bind:value={list.end} aria-label="At the end">
        <option value="stop">stay on the last cue</option><option value="loop">start over (loop)</option><option value="release">fade out</option></select></label>
      <label>Priority <select value={list.priority ?? 'normal'} onchange={(e) => (list.priority = (e.target as HTMLSelectElement).value as 'low' | 'normal' | 'high')} aria-label="Priority">
        <option value="low">low</option><option value="normal">normal</option><option value="high">high: wins over newer lists</option></select></label>
      <label>Release time <input type="number" min="0" max="60" step="0.5" value={list.releaseTime ?? 2} oninput={(e) => (list.releaseTime = +(e.target as HTMLInputElement).value)} style="width:4.5em" aria-label="Release time" /> s</label>
      <label title="The song's tempo: picking this list in Live (or with a set list button) sets the show to it">Tempo
        <input type="number" min="20" max="300" placeholder="keep" value={list.bpm ?? ''} style="width:4.5em" aria-label="List tempo"
          onchange={(e) => { const v = (e.target as HTMLInputElement).valueAsNumber; if (Number.isFinite(v) && v >= 20 && v <= 300) list.bpm = Math.round(v); else delete list.bpm; app.markDirty(0); }} /> BPM</label>
      <label class="ck" title="A play: Record goes after the cue on stage, and the live page shows the whole list (hold a cue to jump)">
        <input type="checkbox" checked={isPlay(list)} onchange={(e) => { list.play = (e.target as HTMLInputElement).checked; app.markDirty(0); }} aria-label="Run as a play" /> Run as a play</label>
      <label>Colour <input type="color" value={list.color ?? '#45d85c'} oninput={(e) => (list.color = (e.target as HTMLInputElement).value)} aria-label="List colour" /></label>
      <button class="ghost danger" onclick={() => { const id = list.id, name = list.name, also = app.removeList(id); app.toastUndo(`Deleted the list "${name}"${also ? ` (and what played it: ${also})` : ''}`); }}><Icon name="trash" />Delete list</button>
    </div>
  {/if}

  <div class="body">
    {#if !list || !list.cues.length}
      <div class="empty">
        {#if !app.show.fixtures.length}
          <p class="faint">The looks you record show up here as cards.</p>
        {:else}
          <Icon name="record" size={30} />
          <p><b>No cues yet.</b> Set up a look on the stage (select lights, pick a colour), then press <b>Record</b>.</p>
          <p class="hint">Each Record makes one card here. GO (or Space) steps from one to the next with a fade.</p>
          <button class="sm" onclick={() => { const n = app.makeStarterLooks(); if (n) app.toastUndo(`${n} starter looks for your rig. Change them, or keep the ones you like.`); }}>
            <Icon name="palette" size={14} />Or make starter looks for my rig</button>
        {/if}
      </div>
    {:else}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="cards" tabindex="0" role="listbox" aria-label="Cues" aria-multiselectable="true" onkeydown={arrows} bind:this={cardsEl}>
        {#each list.cues as c, i (c.id)}
          {@const cur = st?.running && st.index === i}
          {@const sel = app.cueSel.includes(c.id)}
          {@const next = !!st?.running && st.index + 1 === i}
          {@const n = Object.keys(c.values).length}
          {@const risk = cueRiskOf(app.show, c, app.showRev)}
          <!-- svelte-ignore a11y_click_events_have_key_events (the listbox handles the keys) -->
          <div class="card" class:sel class:cur class:next
               class:drop-before={dropAt?.index === i && !dropAt.after} class:drop-after={dropAt?.index === i && dropAt.after}
               class:fxdrop={fxDrop === c.id} ondragleave={() => { if (fxDrop === c.id) fxDrop = null; }}
               role="option" aria-selected={sel} tabindex="-1" draggable="true" data-cue={c.name} data-id={c.id}
               ondragstart={(e) => dragStart(e, c.id)} ondragover={(e) => dragOver(e, i)} ondrop={drop} ondragend={() => { drag = null; dropAt = null; }}
               onclick={(e) => click(e, c.id)} ondblclick={(e) => { if (!(e.target as HTMLElement).closest('.name')) app.jump(list.id, i); }} oncontextmenu={(e) => menu(e, c.id, i)}>
            <!-- a cue that sets nothing shows the look that carries on into it, faded -->
            <div class="pic" class:carry={!Object.keys(c.values).length && !c.effects?.length} title={!Object.keys(c.values).length && !c.effects?.length ? 'Sets nothing: the look before carries on (double-click to go to it)' : 'Double-click to go to this cue'}><img class="look" src={svgImage(thumbs[i])} alt="" draggable="false" />
              {#if c.effects?.length}
                <span class="fxbadge" title="Runs: {fxNames(c.effects)}"><Icon name="effect" size={12} /><span class="bt">{fxNames(c.effects)}</span></span>
              {/if}
            </div>
            <div class="meta">
              <span class="num">{cueNumber(list, i)}</span>
              {#if renaming === c.id}
                <!-- svelte-ignore a11y_autofocus -->
                <input class="rn" value={c.name} use:focusSelect aria-label="Cue name" onclick={(e) => e.stopPropagation()}
                       onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') renaming = null; if (e.key === 'Enter' || e.key === 'Escape') queueMicrotask(() => cardsEl?.focus({ preventScroll: true })); }}
                       onblur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (renaming === c.id && v) { c.name = v; app.markDirty(0); } renaming = null; }} />
              {:else}
                <!-- svelte-ignore a11y_no_static_element_interactions (F2 and the menu rename too) -->
                <span class="name" title="{c.name} (double-click to rename, or F2)" ondblclick={(e) => { e.stopPropagation(); renaming = c.id; }}>{c.name}</span>
              {/if}
              {#if cur}<span class="tag now">live</span>{:else if next}<span class="tag">next</span>{/if}
            </div>
            <div class="chips">
              <span class="chip" title="Fades in {c.fade} s">{c.fade} s</span>
              <span class="chip" class:blue={c.advance.mode !== 'manual'} title={advTitle(c.advance)}>{adv(c.advance)}</span>
              {#if risk === 'hazard'}<span class="chip orange" title="Fires a machine (flames, sparks or CO2): only while armed"><Icon name="warn" size={11} /><span class="bt">machine</span></span>
              {:else if risk === 'once'}<span class="chip orange" title="Fires confetti (once): only while armed">1×</span>{/if}
              {#if c.actions?.length}<span class="chip violet" title="Also does {c.actions.length} thing{c.actions.length > 1 ? 's' : ''} when it starts"><Icon name="bolt" size={11} />{c.actions.length}</span>{/if}
              {#if c.note}<span class="chip" title={c.note}><Icon name="note" size={11} /></span>{/if}
              <!-- how many lights it sets, by the chips (the picture stays clean) -->
              <!-- (a narrow card says it with a lamp and the number: "12 lights" cut to "1…" read as one) -->
              <span class="count" title={n ? `Sets ${n} light${n > 1 ? 's' : ''}` : c.effects?.length ? 'Only runs effects' : 'Sets nothing: the look before carries on'}>{#if n}<Icon name="par" size={11} />{n}<span class="w">&nbsp;light{n > 1 ? 's' : ''}</span>{:else}{c.effects?.length ? 'effects only' : 'carries on'}{/if}</span>
            </div>
            {#if cur}<div class="prog"><div style="width:{(st?.progress ?? 0) * 100}%"></div></div>{/if}
          </div>
        {/each}
      </div>
      <CueInspector />
    {/if}
  </div>
</div>

<style>
  .deck { height: 100%; display: flex; flex-direction: column; min-height: 0; gap: .35rem; padding: .55rem; }
  .tabs h2 { margin-right: .2rem; }
  .tab { padding: .2rem .6rem; border-radius: 999px; font-size: .86rem; }
  .tab.cur { border-color: var(--green); background: #45d85c12; }
  .dot { display: inline-block; width: .5rem; height: .5rem; border-radius: 50%; background: var(--line2); }
  .dot.on { background: var(--c, var(--green)); box-shadow: 0 0 6px var(--c, var(--green)); }
  .bar .sep { width: 1px; height: 1.4rem; background: var(--line); }
  .upd .tgt, .record .tgt { max-width: 9rem; overflow: hidden; text-overflow: ellipsis; }
  .record .tgt { font-weight: 400; opacity: .8; font-size: .8rem; }
  .record { background: #f33abc1a; border-color: #f33abc77; color: #ff7fd6; font-weight: 650; }
  .record :global(svg) { fill: currentColor; }
  .go { background: var(--green); color: #07150b; border-color: var(--green); font-weight: 750; padding: .35rem 1.3rem; }
  .go:hover:not(:disabled) { background: #5be070; border-color: #5be070; }     /* a GO that greys under the mouse looks disabled */
  .lvl { display: inline-flex; align-items: center; gap: .3rem; } .lvl input { width: 80px; accent-color: var(--green); }
  .settings { padding: .4rem .5rem; border: 1px dashed var(--line2); border-radius: var(--radius-s); font-size: .88rem; gap: .5rem .9rem; }
  .settings label { color: var(--muted); display: inline-flex; gap: .3rem; align-items: center; }
  .body { flex: 1; min-height: 0; display: flex; gap: .6rem; }
  .cards { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: .5rem; align-content: start; outline: none; padding: 2px; }
  .card { border: 1.5px solid var(--line); border-radius: var(--radius); background: var(--bg2); padding: .35rem; display: flex; flex-direction: column; gap: .25rem; position: relative; cursor: default; user-select: none; }
  .card:hover { border-color: var(--line2); }
  .card.sel { border-color: var(--orange); background: #ffaa1c0c; }
  .card.cur { border-color: var(--green); box-shadow: 0 0 0 1px var(--green), 0 0 14px #45d85c33; }
  .card:focus-visible { outline: none; }
  .tag { margin-left: auto; flex: none; font-size: .76rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted);
    border: 1px solid var(--line2); border-radius: 4px; padding: 0 .3rem; line-height: 1.35; }
  .tag.now { color: var(--green); border-color: #45d85c66; }
  .card.drop-before { box-shadow: -4px 0 0 var(--orange); }
  .card.fxdrop { border-color: var(--orange); background: #ffaa1c18; }
  .card.drop-after { box-shadow: 4px 0 0 var(--orange); }
  .pic { border-radius: 6px; overflow: hidden; line-height: 0; position: relative; }
  .fxbadge { position: absolute; left: 4px; bottom: 4px; right: 4px; display: flex; gap: .2rem; align-items: center; line-height: 1.2; font-size: .76rem; color: #ffd27a;
    background: #0b0f15cc; border-radius: 4px; padding: .1rem .3rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rn { flex: 1; min-width: 0; padding: .05rem .3rem; font-size: .85rem; }
  .pic > .look { width: 100%; height: auto; display: block; }
  .meta { display: flex; gap: .35rem; align-items: baseline; min-width: 0; }
  .num { font-weight: 800; color: var(--muted); font-variant-numeric: tabular-nums; }
  .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
  .chips { display: flex; gap: .2rem; flex-wrap: nowrap; align-items: center; overflow: hidden; height: 1.3rem; }
  .chips .chip { flex: none; }
  .count { margin-left: auto; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .76rem; color: var(--faint); display: inline-flex; align-items: center; gap: .15rem; }
  .count :global(svg) { display: none; }
  .card { container: card / inline-size; }
  @container card (max-width: 210px) { .count .w { display: none; } .count :global(svg) { display: inline; flex: none; } .count { flex: none; } }
  .bt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pic.carry > .look { opacity: .45; }
  .prog { position: absolute; left: 6px; right: 6px; bottom: 3px; height: 3px; border-radius: 2px; background: var(--line); overflow: hidden; }
  .prog div { height: 100%; background: var(--green); }
  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: var(--muted); gap: .3rem; }
  @media (max-width: 760px) {
    .body { flex-direction: column; }
    .cards { flex: none; max-height: 52vh; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }
    .bar { gap: .3rem; }
    .lvl { display: none; }
  }
  .upd.elsewhere { border-color: var(--orange); color: var(--orange); }
  .upd.elsewhere .tgt { color: var(--orange); }
</style>
