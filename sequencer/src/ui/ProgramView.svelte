<script lang="ts">
  // Program: build the show. Three layouts:
  //   desktop  lists | stage + DMX | programmer, the cues along the bottom
  //   tablet   stage | one panel with tabs (Set, Fixtures, Groups, Presets, Effects), cues below
  //   phone    one pane at a time, a tab bar at the bottom, Record and GO always in reach
  import Icon from './Icon.svelte';
  import FixtureList from './FixtureList.svelte';
  import GroupsPanel from './GroupsPanel.svelte';
  import PresetsPanel from './PresetsPanel.svelte';
  import EffectsPanel from './EffectsPanel.svelte';
  import StageView from './StageView.svelte';
  import Preview from './Preview.svelte';
  import Programmer from './Programmer.svelte';
  import CueDeck from './CueDeck.svelte';
  import { app } from '../app.svelte';
  import { dialogOpen, tablist, ui } from './ui.svelte';
  import { setContext } from 'svelte';

  // App.svelte keeps this view while another is shown. Hidden, it rests: the plan and the DMX line
  // aren't drawn (they'd change every frame for nobody), the 3D stage hands its world on (it reads
  // this context), the keys below are the shown view's.
  const shown = $derived(app.view === 'program');
  setContext('view-shown', () => app.view === 'program');

  const TABS = [
    { id: 'fixtures', label: 'Fixtures', icon: 'par' },
    { id: 'groups', label: 'Groups', icon: 'group' },
    { id: 'presets', label: 'Presets', icon: 'palette' },
    { id: 'effects', label: 'Effects', icon: 'effect' },
  ] as const;
  type Side = (typeof TABS)[number]['id'];

  let width = $state(typeof window !== 'undefined' ? window.innerWidth : 1400);
  const fits = $derived(width <= 760 ? 'phone' : width <= 1100 ? 'tablet' : 'desktop');
  // (while a video of the 3D stage is taken, the layout it started in: see ui.recording)
  let kept = $state<'phone' | 'tablet' | 'desktop'>('desktop');
  $effect(() => { if (!ui.recording) kept = fits; });
  const layout = $derived(ui.recording ? kept : fits);
  // Tablet: which panel the right column shows. Phone: which pane is on screen.
  let panel = $state<'set' | Side>('set');
  let pane = $state<'stage' | 'set' | 'lists' | 'cues'>('stage');
  // Panel sizes on a desktop: the gaps between them can be dragged; remembered in this browser.
  const SIZES_KEY = 'luxdmx.seq.panels', NORMAL = { side: 300, right: 300, foot: 0 };
  // the cues keep a whole row of cards, the stage keeps room to see the lights
  const FOOT_MIN = 210, CENTER_MIN = 350;
  let sizes = $state({ ...NORMAL });
  try { sizes = { ...NORMAL, ...JSON.parse(localStorage.getItem(SIZES_KEY) ?? '{}') }; } catch { /* normal sizes */ }
  let grid = $state<HTMLElement>();
  const save = () => { try { localStorage.setItem(SIZES_KEY, JSON.stringify(sizes)); } catch { /* not remembered */ } };
  function drag(e: PointerEvent, which: 'side' | 'right' | 'foot') {
    if (!grid || e.button !== 0) return;
    e.preventDefault();
    const r = grid.getBoundingClientRect();
    const move = (m: PointerEvent) => {
      if (which === 'side') sizes.side = Math.round(Math.max(220, Math.min(r.width * 0.4, m.clientX - r.left)));
      else if (which === 'right') sizes.right = Math.round(Math.max(240, Math.min(r.width * 0.4, r.right - m.clientX)));
      else sizes.foot = Math.round(Math.max(FOOT_MIN, Math.min(r.height - CENTER_MIN, r.bottom - m.clientY)));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); save(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  // the keyboard: arrows move a focused gap, Home puts it back
  function key(e: KeyboardEvent, which: 'side' | 'right' | 'foot') {
    if (e.key === 'Home') { e.preventDefault(); reset(which); return; }
    const d = { ArrowLeft: -20, ArrowRight: 20, ArrowUp: -20, ArrowDown: 20 }[e.key];
    if (!d || !grid) return;
    e.preventDefault();
    const r = grid.getBoundingClientRect();
    if (which === 'side') sizes.side = Math.max(220, Math.min(r.width * 0.4, sizes.side + d));
    else if (which === 'right') sizes.right = Math.max(240, Math.min(r.width * 0.4, sizes.right - d));
    else sizes.foot = Math.max(FOOT_MIN, Math.min(r.height - CENTER_MIN, (sizes.foot || r.height * 0.38) - d));
    save();
  }
  function reset(which: 'side' | 'right' | 'foot') { sizes[which] = NORMAL[which]; save(); }
  const sel = $derived(app.selected.length);
  // Keys in Program (not while typing): 1-9 = 10-90 %, 0 = off, F = full for the selection; R records.
  function keys(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    if (app.view !== 'program' || dialogOpen() || e.ctrlKey || e.metaKey || e.altKey || el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
    if (/^[0-9]$/.test(e.key) && app.selected.length) { e.preventDefault(); if (e.key === '0') app.off(); else app.set({ intensity: +e.key / 10 }); }
    else if (e.key.toLowerCase() === 'f' && app.selected.length) { e.preventDefault(); app.set({ intensity: 1 }); }
    else if (e.key.toLowerCase() === 'r' && !e.shiftKey) { e.preventDefault(); record(); }
  }
  function record() { ui.toast(app.record() ? 'Recorded' : 'Nothing to record: select lights and change something first'); }
</script>

<svelte:window bind:innerWidth={width} onkeydown={keys} />

{#snippet sideTabs(withSet: boolean)}
  <div class="tabs" class:five={withSet} role="tablist" aria-label="Panels" use:tablist>
    {#if withSet}
      <button role="tab" aria-selected={panel === 'set'} class:cur={panel === 'set'} onclick={() => (panel = 'set')} title="Set the selected lights">
        <Icon name="sun" size={17} /><span>Set{sel ? ` (${sel})` : ''}</span>
      </button>
    {/if}
    {#each TABS as t (t.id)}
      {@const on = withSet ? panel === t.id : app.sideTab === t.id}
      <button role="tab" aria-selected={on} class:cur={on} onclick={() => { app.sideTab = t.id; panel = t.id; }} title={t.label}>
        <Icon name={t.icon} size={17} /><span>{t.label}</span>
      </button>
    {/each}
  </div>
{/snippet}

{#snippet sideBody(tab: Side)}
  {#if tab === 'fixtures'}<FixtureList />
  {:else if tab === 'groups'}<GroupsPanel />
  {:else if tab === 'presets'}<PresetsPanel />
  {:else}<EffectsPanel />{/if}
{/snippet}

{#if layout === 'desktop'}
  <div class="prog desktop" bind:this={grid} style="--side-w:min({sizes.side}px, 40vw);--right-w:min({sizes.right}px, 40vw);--foot-h:{sizes.foot ? `min(${sizes.foot}px, 70vh)` : '38%'}">
    <aside class="side" aria-label="Fixtures, groups, presets, effects">
      {@render sideTabs(false)}
      <div class="tabbody">{@render sideBody(app.sideTab)}</div>
    </aside>
    <section class="center">{#if shown || ui.stage3d}<StageView />{/if}{#if shown}<Preview />{/if}</section>
    <aside class="right" aria-label="Programmer"><Programmer /></aside>
    <footer class="foot"><CueDeck /></footer>
    <!-- drag the gaps to resize the panels (double-click: back to normal). A focusable separator is
         a widget in ARIA (arrows move it), which Svelte's check doesn't know. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div class="split v sl" role="separator" aria-orientation="vertical" aria-label="Resize the lists" aria-valuenow={sizes.side} aria-valuemin={220} aria-valuemax={600} tabindex="0" onkeydown={(e) => key(e, 'side')} onpointerdown={(e) => drag(e, 'side')} ondblclick={() => reset('side')}></div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div class="split v sr" role="separator" aria-orientation="vertical" aria-label="Resize the programmer" aria-valuenow={sizes.right} aria-valuemin={240} aria-valuemax={600} tabindex="0" onkeydown={(e) => key(e, 'right')} onpointerdown={(e) => drag(e, 'right')} ondblclick={() => reset('right')}></div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div class="split h" role="separator" aria-orientation="horizontal" aria-label="Resize the cues" aria-valuenow={sizes.foot} aria-valuemin={0} aria-valuemax={800} tabindex="0" onkeydown={(e) => key(e, 'foot')} onpointerdown={(e) => drag(e, 'foot')} ondblclick={() => reset('foot')}></div>
  </div>
{:else if layout === 'tablet'}
  <div class="prog tablet">
    <section class="center">{#if shown || ui.stage3d}<StageView />{/if}{#if shown}<Preview />{/if}</section>
    <aside class="side" aria-label="Fixtures, groups, presets, effects">
      {@render sideTabs(true)}
      <div class="tabbody">{#if panel === 'set'}<div class="scroll"><Programmer /></div>{:else}{@render sideBody(panel)}{/if}</div>
    </aside>
    <footer class="foot"><CueDeck /></footer>
  </div>
{:else}
  <div class="prog phone">
    <div class="pane">
      {#if pane === 'stage'}{#if shown || ui.stage3d}<StageView />{/if}
      {:else if pane === 'set'}<div class="scroll"><Programmer /></div>
      {:else if pane === 'lists'}{@render sideTabs(false)}<div class="tabbody">{@render sideBody(app.sideTab)}</div>
      {:else}<CueDeck />{/if}
    </div>
    <div class="actionbar">
      <span class="muted">{sel ? `${sel} selected` : ''}</span>
      <span class="grow"></span>
      <button class="bo" class:on={app.blackout} onclick={() => (app.blackout = !app.blackout)} aria-label="Blackout" title="Blackout"><Icon name="moon" /></button>
      <button class="rec" onclick={record}><Icon name="record" />Record</button>
      <button class="go" onclick={() => app.go()} disabled={!app.list?.cues.length}>GO <Icon name="play" /></button>
    </div>
    <nav class="bottom" aria-label="Program panes">
      {#each [['stage', 'Stage', 'eye'], ['lists', 'Lights', 'par'], ['set', 'Set', 'sun'], ['cues', 'Cues', 'record']] as [id, label, icon] (id)}
        <button class:cur={pane === id} aria-current={pane === id} onclick={() => (pane = id as typeof pane)}><Icon name={icon} size={20} /><span>{label}</span></button>
      {/each}
    </nav>
  </div>
{/if}

<style>
  .prog { flex: 1; min-height: 0; display: grid; gap: .55rem; padding: .55rem; }
  .desktop { grid-template-columns: var(--side-w) minmax(0, 1fr) var(--right-w); grid-template-rows: minmax(0, 1fr) minmax(170px, var(--foot-h)); position: relative;
    grid-template-areas: 'side center right' 'foot foot foot'; }
  .tablet { grid-template-columns: minmax(0, 1fr) 320px; grid-template-rows: minmax(0, 1fr) minmax(230px, 36%);
    grid-template-areas: 'center side' 'foot foot'; }
  .side { grid-area: side; min-height: 0; display: flex; flex-direction: column; gap: .4rem; }
  .tabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 3px; }
  .tabs.five { grid-template-columns: repeat(5, 1fr); }
  .tabs button { border: 0; background: none; flex-direction: column; gap: .1rem; padding: .3rem .1rem; font-size: .76rem; color: var(--muted); border-radius: 7px; }
  .tabs button.cur { background: var(--panel2); color: var(--text); box-shadow: inset 0 0 0 1px var(--line2); }
  .tabbody { flex: 1; min-height: 0; }
  .scroll { height: 100%; overflow: auto; }
  .center { grid-area: center; min-height: 0; display: flex; flex-direction: column; gap: .55rem; }
  .right { grid-area: right; min-height: 0; overflow: auto; }
  .foot { grid-area: foot; min-height: 0; }
  .phone { display: flex; flex-direction: column; gap: 0; padding: 0; }
  .pane { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: .4rem; padding: .45rem; overflow: auto; }
  .pane > :global(*) { flex: 1; min-height: 0; }
  .pane > .tabs { flex: none; }
  .actionbar { display: flex; align-items: center; gap: .4rem; padding: .35rem .5rem; border-top: 1px solid var(--line); background: var(--bg2); }
  .actionbar .bo.on { background: var(--pink); border-color: var(--pink); color: #1a0010; }
  .actionbar .rec { background: #f33abc1a; border-color: #f33abc77; color: #ff7fd6; font-weight: 650; }
  .actionbar .rec :global(svg) { fill: currentColor; }
  .actionbar .go { background: var(--green); color: #07150b; border-color: var(--green); font-weight: 750; padding: .45rem 1.2rem; }
  .bottom { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid var(--line); background: var(--bg2); padding-bottom: env(safe-area-inset-bottom); }
  .bottom button { border: 0; background: none; border-radius: 0; flex-direction: column; gap: .1rem; padding: .4rem 0 .45rem; color: var(--muted); font-size: .76rem; min-height: 54px; }
  .bottom button.cur { color: var(--accent); }
  .split { position: absolute; z-index: 5; }
  .split.v { top: .55rem; width: 10px; cursor: col-resize; bottom: calc(var(--foot-h) + .55rem); }
  .split.sl { left: calc(var(--side-w) + .55rem - 2px); }
  .split.sr { right: calc(var(--right-w) + .55rem - 2px); }
  .split.h { left: .55rem; right: .55rem; height: 10px; cursor: row-resize; bottom: calc(var(--foot-h) + .55rem - 2px); }
  .split:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
  .split:hover, .split:active { background: linear-gradient(var(--accent), var(--accent)) center / 2px 100% no-repeat; }
  /* a small grip in the middle of each gap, so it's findable before hovering */
  .split::after { content: ''; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 4px; height: 28px; border-radius: 2px; background: var(--line2); }
  .split.h::after { width: 28px; height: 4px; }
  .split:hover::after, .split:focus-visible::after { background: var(--accent); }
  .split.h:hover, .split.h:active { background: linear-gradient(var(--accent), var(--accent)) center / 100% 2px no-repeat; }
</style>
