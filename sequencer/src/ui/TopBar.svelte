<script lang="ts">
  // the share sheet takes files here (phones, tablets, some desktops): offer to send the show with it
  const canShareFiles = (() => { try { return !!navigator.canShare?.({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] }); } catch { return false; } })();
  import Icon from './Icon.svelte';
  import Devices from './Devices.svelte';
  import { app } from '../app.svelte';
  import { tablist, ui } from './ui.svelte';

  // The dot blinks on every beat the microphone hears.
  let beatFlash = $state(false);
  let lastBeat = 0;
  $effect(() => {
    const b = app.music.beat;
    if (b && b !== lastBeat) { lastBeat = b; beatFlash = true; setTimeout(() => (beatFlash = false), 120); }
  });
  async function music() {
    try {
      await app.followMusic(!app.music.on);
      if (app.music.on && !app.show.effects.some((e) => e.kind === 'sound' || e.kind === 'vu'))
        ui.toast('Listening: tempo effects and Auto GO follow the beat. Lights that pulse with the bass: Effects, Add, Sound pulse or VU meter.', 7000);
    } catch (e) { ui.toast(`No microphone: ${(e as Error).message}`, 6000); }
  }
  // What goes to the stage (app.askOnStage asks first; blind is one click)
  function outputClick() { if (app.output === 'live') app.goBlind(); else void app.askOnStage(); }
  // Arming the machines that fire once or are dangerous: hold for a moment (a slip can't do it);
  // one click disarms. Only on stage (blind, nothing would go out). The click that ends the hold
  // that armed isn't a disarm; any new press is, however the hold ended (a finger slid off, a key).
  let holding = $state(false), holdTimer = 0, justArmed = false;
  function holdStart(e: Event) {
    justArmed = false;
    if (app.sfxArmed || holding) return;
    e.preventDefault();
    if (app.output !== 'live') { ui.toast('Blind: nothing goes to the stage, so there is nothing to arm. Go on stage first.', 5000); return; }
    holding = true;
    holdTimer = window.setTimeout(() => { holding = false; justArmed = true; arm(); }, 1200);
  }
  function arm() {
    app.armMachines(true);
    if (app.sfxArmed) ui.toast(`Armed: ${app.gatedMachines.map((f) => f.name).join(', ')} can fire now (one that's already on waits until it has been off). Click ARMED to make them safe again.`, 7000);
  }
  function holdEnd() { if (holding) { holding = false; clearTimeout(holdTimer); } }
  function armKey(e: KeyboardEvent) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (e.repeat) { e.preventDefault(); return; }       // (a held key repeats: none of those is a click)
    holdStart(e);
  }
  async function armClick(e: MouseEvent) {
    if (justArmed) { justArmed = false; return; }
    if (app.sfxArmed) { app.armMachines(false); ui.toast('Safe: confetti, flames, sparks and CO2 send nothing.'); return; }
    if (holding) return;
    // a click with no press behind it (a screen reader): ask instead of the hold
    if (e.detail === 0 && app.output === 'live') {
      if (await ui.confirm('Arm the machines?', `${app.gatedMachines.map((f) => f.name).join(', ')} can fire from now on.`, 'Arm', true)) arm();
      return;
    }
    if (app.output === 'live') ui.toast('Hold the button for a moment to arm the machines.');
  }
  function more(e: MouseEvent) {
    // on a phone the undo buttons don't fit the bar: they're the first thing in here
    // (on a tablet, following the music: the bar has it only while it's on)
    const phone = window.innerWidth <= 760, tablet = window.innerWidth <= 1100;
    ui.openMenu(e, [
      ...(phone ? [{ label: 'Undo', icon: 'undo', disabled: !app.canUndo, run: () => app.undo() }, { label: 'Redo', icon: 'redo', disabled: !app.canRedo, run: () => app.redo() }] : []),
      ...(tablet ? [{ label: app.music.on ? 'Stop following the music' : 'Follow the music', icon: 'music', run: () => void music() }, { sep: true }] : []),
      { label: 'Find anything…', icon: 'search', keys: 'Ctrl+K', run: () => (ui.modal = 'palette') },
      { heading: 'The rig' },
      { label: 'DMX output (every channel, live)', icon: 'grid', run: () => (ui.modal = 'monitor') },
      { label: 'Check the patch (one light at a time)', icon: 'sun', disabled: !app.show.fixtures.length, run: () => (ui.modal = 'patchCheck') },
      { label: app.remote.on ? `Phone as a remote (${app.remote.phones} connected)` : 'Phone as a remote…', icon: 'phone', run: () => (ui.modal = 'remote') },
      { label: 'Timetable (looks by the clock)…', icon: 'clock', run: () => (ui.modal = 'schedule') },
      { heading: 'Files and paper' },
      { label: 'Save the show as a file', icon: 'download', keys: 'Ctrl+Shift+S', run: () => app.exportShow() },
      ...(canShareFiles ? [{ label: 'Send the show to another device…', icon: 'upload', run: () => void app.shareShow() }] : []),
      { label: 'Print the patch (addresses, DIP switches)', icon: 'printer', run: () => { if (!app.printPatch()) ui.toast('The browser blocked the new tab: allow popups for this page'); } },
      { label: 'Print a cue sheet', icon: 'printer', run: () => { if (!app.printCueSheet()) ui.toast('The browser blocked the new tab: allow popups for this page'); } },
      { label: 'Cue sheet as CSV (spreadsheet)', icon: 'download', run: () => app.exportCsv() },
      { heading: 'Help and view' },
      { label: 'How it works', icon: 'help', run: () => (ui.modal = 'guide') },
      { label: 'Keyboard shortcuts', icon: 'keyboard', keys: '?', run: () => (ui.modal = 'shortcuts') },
      { label: ui.help ? 'Hide the hints' : 'Show the hints again', icon: 'note', run: () => (ui.help = !ui.help) },
      { label: 'Interface size', icon: 'search', stepper: { value: () => `${Math.round(ui.zoom * 100)}%`, minus: () => ui.setZoom(ui.zoom - 0.1), plus: () => ui.setZoom(ui.zoom + 0.1), reset: () => ui.setZoom(1), minusOff: () => ui.zoom <= 0.7, plusOff: () => ui.zoom >= 1.6 } },
    ]);
  }
  function key(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || app.locked) return;     // locked: no undo of the show behind the page
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) app.redo(); else app.undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); app.redo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (e.shiftKey) app.exportShow();
      else { app.checkpoint(); ui.toast('Saved in this browser (it saves by itself anyway). Ctrl+Shift+S saves a file.', 3500); }
    }
  }
</script>

<svelte:window onkeydown={key} />

<header class="top" class:witharm={app.gatedMachines.length > 0}>
  <h1 class="sr-only">LuxDMX Sequencer: {app.show.meta.name}</h1>
  <div class="brand" aria-hidden="true">Lux<span>DMX</span></div>
  {#if app.locked}
    <!-- Service mode: the show's name and a lock, nothing that edits or leaves the page. -->
    <span class="show lockedname" title="Locked for the show: hold the padlock on the page to unlock"><Icon name="lock" /><span class="name">{app.show.meta.name || 'Untitled'}</span></span>
  {:else}
  <button class="show" onclick={() => (ui.modal = 'shows')} title="Your shows: open, new, duplicate, templates">
    <Icon name="folder" /><span class="name">{app.show.meta.name || 'Untitled'}</span>
    <span class="saved" class:dirty={!app.saved} title={app.saved ? 'Saved in this browser' : 'Saving…'}>{app.saved ? 'saved' : '…'}</span>
  </button>

  {#if app.otherTab}<span class="chip orange warn" title="Another tab saved this show too. The last one to save wins: close one of them.">open in another tab</span>{/if}
  <div class="modes" role="tablist" aria-label="Mode" use:tablist>
    <button role="tab" aria-label="Program" aria-selected={app.view === 'program'} class:cur={app.view === 'program'} onclick={() => (app.view = 'program')}><Icon name="program" /><span class="lbl">Program</span></button>
    <button role="tab" aria-label="Live" aria-selected={app.view === 'live'} class:cur={app.view === 'live'} onclick={() => (app.view = 'live')}><Icon name="live" /><span class="lbl">Live</span></button>
    {#if !app.locked}<button role="tab" aria-label="Timeline" aria-selected={app.view === 'timeline'} class:cur={app.view === 'timeline'} onclick={() => (app.view = 'timeline')} title="A song with your cues on it"><Icon name="music" /><span class="lbl">Timeline</span></button>{/if}
  </div>
  {/if}

  <span class="grow"></span>

  <!-- not on a page locked for the service: a slip of the thumb would take the room dark -->
  {#if !app.locked}
  <label class="gm" title="Grand master: scales every light">
    <span class="lab">Master</span>
    <input type="range" min="0" max="1" step="0.01" bind:value={app.grandMaster} aria-label="Grand master" />
    <b>{Math.round(app.grandMaster * 100)}%</b>
  </label>
  {/if}
  <!-- in Live the GO bar has it -->
  {#if app.view !== 'live'}<button class="bo" class:on={app.blackout} aria-pressed={app.blackout} onclick={() => (app.blackout = !app.blackout)} title="Blackout: every light off, until you press it again">Blackout</button>{/if}
  {#if !app.locked || app.music.on}
  <button class="ghost music" class:on={app.music.on} onclick={music} title={app.music.on ? 'Following the music from the microphone. Click to stop.' : 'Follow the music: the microphone finds the beat and sets the tempo (nothing is recorded or sent anywhere)'}
          aria-label="Follow the music" aria-pressed={app.music.on}>
    <Icon name="music" />{#if app.music.on}<span class="pulse" class:beat={beatFlash}></span><b>{app.music.confidence >= 0.5 && app.music.bpm ? Math.round(app.music.bpm) : '…'}</b>{/if}
  </button>
  {/if}
  {#if !app.locked}
  <span class="bpm" title="Tempo: beat-based cues and effects follow it. Tap along to the music.">
    <!-- following the music: the tempo shown is the one everything runs at -->
    {#if app.bpm !== app.show.settings.bpm}<input type="number" value={app.bpm} readonly class="frommusic" aria-label="BPM" title="From the music (♪) or the song playing on the timeline. Your own tempo comes back when they stop." />
    {:else}<input type="number" min="20" max="300" bind:value={app.show.settings.bpm} aria-label="BPM" />{/if}<span class="lab">BPM</span>
    <button onclick={() => app.tap()} title="Tap along to the music to set the tempo">Tap</button>
  </span>
  <div class="toolbar">
    <button class="ghost" onclick={() => app.undo()} disabled={!app.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo" /></button>
    <button class="ghost" onclick={() => app.redo()} disabled={!app.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Icon name="redo" /></button>
    <button class="ghost" onclick={() => (ui.modal = 'palette')} title="Find anything (Ctrl+K)" aria-label="Find anything"><Icon name="search" /></button>
    <button class="ghost" onclick={more} title="More" aria-label="More"><Icon name="more" /></button>
  </div>
  {/if}
  <!-- what goes to the stage: blind (here only) or on stage; the machines that wait for arming. On a
       page locked for the service each only shows when it can make things safer or the page
       would otherwise do nothing (blind: put it on stage; armed: make them safe) -->
  {#if !app.locked || app.output !== 'live'}
  <button class="out" class:onair={app.output === 'live'} aria-pressed={app.output === 'live'} onclick={outputClick} aria-label="On stage"
          title={app.output === 'live' ? 'On stage: what you do goes out to the lights. Click for blind (they keep the look they have).' : 'Blind: you see it here, the lights don\'t get it. Click to send it to the stage.'}>
    <span class="dot"></span><span class="txt">{app.output === 'live' ? 'On stage' : 'Blind'}</span>
  </button>
  {/if}
  {#if app.gatedMachines.length && (!app.locked || app.sfxArmed)}
    <button class="arm" class:armed={app.sfxArmed} class:holding aria-pressed={app.sfxArmed} aria-label="Machines armed"
            title={app.sfxArmed ? 'Confetti, flames, sparks and CO2 can fire. Click to make them safe.' : app.output === 'live' ? 'Confetti, flames, sparks and CO2 send nothing (the stage view still shows them). Hold to arm.' : 'Confetti, flames, sparks and CO2 send nothing. Blind: go on stage first to arm them.'}
            onpointerdown={holdStart} onpointerup={holdEnd} onpointerleave={holdEnd} onpointercancel={holdEnd}
            onkeydown={armKey} onkeyup={holdEnd} onclick={armClick}>
      <Icon name="sfx" size={14} /><span class="txt">{app.sfxArmed ? 'ARMED' : 'Safe'}</span>
    </button>
  {/if}
  <Devices />
</header>


<style>
  .top { display: flex; align-items: center; gap: .6rem; padding: .45rem .7rem; background: var(--bg2); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .brand { font-weight: 800; letter-spacing: .02em; font-size: 1.05rem; } .brand span { color: var(--green); }
  .show { background: none; border-color: transparent; max-width: 280px; }
  .show .name { overflow: hidden; text-overflow: ellipsis; font-weight: 650; }
  .lockedname { display: inline-flex; align-items: center; gap: .35rem; padding: .32rem .6rem; color: var(--orange); }
  .lockedname .name { color: var(--text); }
  .saved { font-size: .76rem; color: var(--green); } .saved.dirty { color: var(--muted); }
  .modes { display: inline-flex; background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 2px; }
  .modes button { border: 0; background: none; border-radius: 999px; padding: .3rem .85rem; color: var(--muted); }
  .modes button.cur { background: var(--panel2); color: var(--text); box-shadow: inset 0 0 0 1px var(--line2); }
  .gm { display: inline-flex; align-items: center; gap: .35rem; color: var(--muted); } .gm input { width: 90px; } .gm b { width: 2.6rem; color: var(--text); font-size: .85rem; }
  .lab { color: var(--muted); font-size: .82rem; }
  .bpm { align-items: center; }
  .warn { cursor: help; }
  .music { gap: .3rem; }
  .music b { font-size: .82rem; color: var(--text); min-width: 1.6rem; }
  .pulse { width: .5rem; height: .5rem; border-radius: 50%; background: var(--line2); transition: background .05s; }
  .pulse.beat { background: var(--green); box-shadow: 0 0 8px var(--green); }
  .bo.on { background: var(--pink); border-color: var(--pink); color: #1a0010; font-weight: 700; }
  .bpm { display: inline-flex; gap: .25rem; } .bpm input { width: 5em; }
  .bpm .frommusic { color: var(--green); border-color: #45d85c66; }
  .grow { flex: 1; }
  .out { display: inline-flex; align-items: center; gap: .35rem; border-radius: 999px; padding: .25rem .65rem; font-weight: 650; color: var(--muted); }
  .out .dot { width: .6rem; height: .6rem; border-radius: 50%; background: #5b6676; box-shadow: inset 0 0 0 1px #0006; }
  .out.onair { color: #fff; background: #5a1418; border-color: #c4383f; }
  .out.onair .dot { background: #ff4d55; box-shadow: 0 0 8px #ff4d55; }
  .arm { display: inline-flex; align-items: center; gap: .3rem; border-radius: 999px; padding: .25rem .6rem; color: var(--muted); position: relative; overflow: hidden; }
  .arm.holding::before { content: ''; position: absolute; inset: 0; background: #ff8a1c55; transform-origin: left; animation: arm 1.2s linear forwards; }
  @keyframes arm { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  .arm.armed { color: #fff; background: #7a1d0c; border-color: #ff7a1c; font-weight: 750; animation: armed 1.2s ease-in-out infinite; }
  @keyframes armed { 50% { box-shadow: 0 0 0 3px #ff7a1c55; } }
  @media (prefers-reduced-motion: reduce) { .arm.armed { animation: none; } }
  /* touch: what goes to the stage and the machines are show controls (44 px) */
  @media (pointer: coarse) { .out, .arm { min-height: 44px; min-width: 44px; justify-content: center; } }
  /* Tablets: one row. The name, the explanations and search move out (the ⋯ menu has them). */
  @media (max-width: 1100px) {
    /* (room for Blind / On stage and the arm button: the tabs by name, no icons; Safe and ARMED
       written out, the machines' state is never just an icon) */
    .modes :global(svg) { display: none; }
    .bpm .lab { display: none; }
    .gm input { width: 64px; }
    .brand, .gm .lab, .gm b { display: none; }          /* (the slider shows the master; its title says it) */
    .music:not(.on) { display: none; }                   /* (in the ⋯ menu; shown while it listens) */
    .show { max-width: 110px; }
    .toolbar :global(button[aria-label="Explanations"]), .toolbar :global(button[aria-label="Find anything"]) { display: none; }
    .top { gap: .45rem; }
  }
  /* (after the tablets' rules: a phone is narrower than 1100 px too, and these win) */
  /* Narrow screens: one row. The grand master and tempo live on the Live page there. */
  @media (max-width: 760px) {
    .top { flex-wrap: nowrap; gap: .2rem; padding: .3rem .4rem; overflow-x: auto; }
    .brand, .gm, .bpm, .bo, .saved, .music, .out .txt, .arm .txt { display: none; }
    .out, .arm { padding: .3rem .45rem; }
    .toolbar { flex-wrap: nowrap; }
    .toolbar :global(button[aria-label="Undo"]), .toolbar :global(button[aria-label="Redo"]), .toolbar :global(button[aria-label="Explanations"]),
    .toolbar :global(button[aria-label="Find anything"]) { display: none; }      /* in the ⋯ menu */
    /* (the tabs as icons, the one you're on with its name too) */
    .modes button { padding: .3rem .42rem; gap: .25rem; }
    .modes button:not(.cur) .lbl { display: none; }
    .modes :global(svg) { display: inline-block; }        /* (the tablets' rule hides them; here they're the tabs) */
    /* (with the arm button there too: every tab as an icon) */
    .top.witharm .modes .lbl { display: none; }
    .show { max-width: 28vw; padding-inline: .3rem; }
  }
</style>
