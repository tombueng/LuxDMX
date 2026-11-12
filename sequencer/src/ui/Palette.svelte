<script lang="ts">
  import { cueNumber } from '../model/cuenum';
  // Ctrl+K: type a few letters of anything (a light, a group, a preset, an effect, a cue, a
  // template or a command) and press Enter.
  import Icon from './Icon.svelte';
  import { app } from '../app.svelte';
  import { ui } from './ui.svelte';
  import { ALL_TEMPLATES as TEMPLATES } from '../content/ringMatrix';
  import { KIND_LABEL } from '../model/library';
  import { colorsFromPicture, fogTimer } from './actions';

  let { onclose }: { onclose: () => void } = $props();
  // `find`: extra words it's found by, not shown
  interface Item { label: string; hint: string; icon: string; run: () => unknown; keys?: string; find?: string }
  let q = $state('');
  let cur = $state(0);
  let listEl = $state<HTMLElement>();
  let input = $state<HTMLInputElement>();
  $effect(() => { input?.focus(); });

  const items = $derived.by((): Item[] => {
    const s = app.show, out: Item[] = [];
    const cmd = (label: string, icon: string, run: () => unknown, keys?: string, find?: string) => out.push({ label, hint: '', icon, run, keys, find });
    cmd('Add fixtures…', 'plus', () => (ui.modal = 'addFixtures'));
    cmd('Add an effect…', 'effect', () => (ui.modal = 'effects'));
    cmd('Shows: open, new, templates…', 'folder', () => (ui.modal = 'shows'));
    // (the welcome has the demo with its music to pick, and the song's progress as it comes down)
    cmd('The big demo show (3D, timeline, 230 lights)…', 'play', () => (ui.modal = 'welcome'), undefined, 'demo presentation festival example welcome start');
    cmd('Save the show as a file', 'download', () => app.exportShow(), 'Ctrl+Shift+S', 'export download backup json');
    cmd('Send the show to another device…', 'upload', () => void app.shareShow(), undefined, 'share tablet phone send airdrop nearby mail transfer');
    cmd('Print a cue sheet', 'printer', () => app.printCueSheet(), undefined, 'paper pdf');
    cmd('Cue sheet as CSV', 'download', () => app.exportCsv(), undefined, 'export spreadsheet excel');
    cmd('Save for QLC+ (.qxw)', 'download', () => app.exportQxw(), undefined, 'export qlcplus workspace');
    cmd('Record a cue', 'record', () => ui.toast(app.record() ? 'Recorded' : 'Nothing to record'));
    cmd('Clear the programmer', 'close', () => app.clearProgrammer());
    cmd(app.view === 'live' ? 'Go to Program' : 'Go to Live', app.view === 'live' ? 'program' : 'live', () => (app.view = app.view === 'live' ? 'program' : 'live'));
    if (app.view !== 'console' && !app.locked) cmd('Console: like a lighting desk (command line, faders, encoders)', 'sliders', () => (app.view = 'console'));
    cmd(app.show.settings.recordChanges ? 'Record whole looks again (each touched light as it looks)' : 'Record only changes (what the programmer holds, as desks do)', 'record', () => { app.checkpoint(); if (app.show.settings.recordChanges) delete app.show.settings.recordChanges; else app.show.settings.recordChanges = true; app.markDirty(0); });
    cmd(app.blackout ? 'Blackout off' : 'Blackout on', 'moon', () => (app.blackout = !app.blackout));
    cmd('Release everything', 'stop', () => app.releaseAll(), undefined, 'release all stop lists fade off');
    cmd('Stop all effects', 'stop', () => app.stopAllEffects(), undefined, 'stop effects chase rainbow off');
    cmd('Timetable: looks by the clock…', 'clock', () => (ui.modal = 'schedule'), undefined, 'schedule clock time timer opening hours every day evening 21:00 automatic');
    cmd('Phone as a remote…', 'phone', () => (ui.modal = 'remote'), undefined, 'mobile smartphone tablet qr code play from the crowd');
    out.push({ label: 'Make a fog timer…', hint: '', find: 'fog every few minutes automatic repeat loop haze', icon: 'fog', run: () => fogTimer() });
    cmd('Select all lights', 'check', () => app.selectAll());
    if (s.fixtures.length) cmd('Make starter looks for this rig (warm, cool, sunset, party...)', 'palette', () => { const n = app.makeStarterLooks(); if (n) { app.view = 'program'; app.toastUndo(`${n} starter looks for your rig`); } });
    cmd('Undo', 'undo', () => app.undo(), 'Ctrl+Z');
    cmd('Redo', 'redo', () => app.redo(), 'Ctrl+Shift+Z');
    cmd('DMX output: every channel, live (monitor)', 'grid', () => (ui.modal = 'monitor'));
    cmd('Print the patch: addresses and DIP switches', 'printer', () => app.printPatch(), undefined, 'dip setup sheet paper');
    cmd('MIDI controller: use pads and faders (learn them in Live, Edit)', 'live', () => { app.view = 'live'; ui.toast('In Live: MIDI (top) switches it on; Edit, pick a button, Learn, then touch the pad', 6000); });
    cmd('Colours from a picture', 'image', () => colorsFromPicture(), undefined, 'poster photo album cover image palette flyer');
    if (s.fixtures.length) cmd('Check the patch: light one fixture at a time', 'sun', () => (ui.modal = 'patchCheck'));
    cmd('The rig with RDM: find the real lights, check and fix them against the patch, watch them', 'search', () => (ui.modal = 'rig'), undefined, 'rdm scan discover rig devices health monitor address mode personality identify');
    cmd('Keyboard shortcuts', 'help', () => (ui.modal = 'shortcuts'), '?');
    cmd('How it works (a short guide)', 'help', () => (ui.modal = 'guide'));
    cmd(ui.help ? 'Hide the hints' : 'Show the hints again', 'help', () => (ui.help = !ui.help));
    for (const z of [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6]) cmd(`Interface size ${Math.round(z * 100)}%`, 'search', () => ui.setZoom(z), undefined, 'zoom bigger smaller text');
    if (app.view === 'live' && !app.locked) cmd('Lock the live page for the show', 'lock', () => { app.lockShow(true); ui.toast('Locked for the show: only playing. Hold the padlock to unlock.', 3000); }, undefined, 'service kiosk safe');
    if (app.view === 'live' && !app.locked) cmd('Lock with a PIN…', 'lock', () => void app.pinLock(), undefined, 'service kiosk staff pin code password safe');
    if (app.view === 'live' && !app.locked) cmd('New page with just the looks (for staff)', 'plus', () => window.dispatchEvent(new CustomEvent('luxdmx-looks-page')), undefined, 'staff simple moods only');
    for (const f of s.fixtures) out.push({ label: f.name, hint: `${KIND_LABEL[app.kinds[f.id] ?? 'other']} · ${f.universe}.${f.address}`, icon: app.kinds[f.id] ?? 'other',
      run: () => { app.view = 'program'; app.sideTab = 'fixtures'; app.selected = [f.id]; } });
    for (const g of s.groups) out.push({ label: g.name, hint: `Group · ${g.fixtures.length} lights`, icon: 'group', run: () => { app.view = 'program'; app.selectGroup(g.id); } });
    for (const p of s.presets) out.push({ label: p.name, hint: `${p.kind} preset${app.selected.length ? ' · put on the selection' : ''}`, icon: 'palette',
      run: () => { if (!app.applyPreset(p.id)) ui.toast('Select lights first'); } });
    for (const e of s.effects) out.push({ label: e.name, hint: `Effect · ${app.liveFx.includes(e.id) ? 'stop' : 'start'}`, icon: 'effect', run: () => app.toggleEffect(e.id) });
    for (const l of s.cueLists) l.cues.forEach((c, i) => out.push({ label: `${cueNumber(l, i)}. ${c.name}`, hint: `Cue in ${l.name} · go`, icon: 'play',
      run: () => { app.currentList = l.id; app.jump(l.id, i); } }));
    for (const t of TEMPLATES) out.push({ label: `New show: ${t.name}`, hint: 'Template', icon: t.icon, run: () => app.startShow(t.build()) });
    return out;
  });
  // Every word of the query has to appear; earlier and word-start matches rank higher.
  const hits = $derived.by(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return items.slice(0, 40);
    const scored: [number, Item][] = [];
    for (const it of items) {
      const text = `${it.label} ${it.hint} ${it.find ?? ''}`.toLowerCase();
      let score = 0, ok = true;
      for (const w of words) {
        const at = text.indexOf(w);
        if (at < 0) { ok = false; break; }
        score += at + (at === 0 || text[at - 1] === ' ' ? 0 : 20) + (it.label.toLowerCase().includes(w) ? 0 : 30);
      }
      if (ok) scored.push([score, it]);
    }
    return scored.sort((a, b) => a[0] - b[0]).slice(0, 40).map(([, it]) => it);
  });
  $effect(() => { void q; cur = 0; });
  function run(it: Item | undefined) { if (!it) return; onclose(); it.run(); }
  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(hits.length - 1, cur + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(0, cur - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(hits[cur]); }
    else if (e.key === 'Escape') { e.preventDefault(); onclose(); }
    else return;
    queueMicrotask(() => listEl?.querySelector('.cur')?.scrollIntoView({ block: 'nearest' }));
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose(); }} />
<div class="back" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <div class="pal" role="dialog" aria-modal="true" aria-label="Find anything">
    <div class="in">
      <Icon name="search" />
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:this={input} bind:value={q} onkeydown={key} autofocus placeholder="Find a light, cue, effect, preset, or a command…" aria-label="Find anything"
             role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant="pal-{cur}" />
      <span class="kbd">Esc</span>
    </div>
    <ul id="palette-list" role="listbox" bind:this={listEl}>
      {#each hits as it, i (i)}
        <!-- the option itself takes the click (no button inside an option); the keys are the search field's -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li id="pal-{i}" role="option" aria-selected={i === cur} class:cur={i === cur} onclick={() => run(it)} onmousemove={() => (cur = i)}>
          <Icon name={it.icon} /><span class="l">{it.label}</span><span class="h">{it.hint}</span>{#if it.keys}<span class="kbd">{it.keys}</span>{/if}
        </li>
      {:else}
        <li class="none">Nothing found for "{q}".</li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .back { position: fixed; inset: 0; background: #0008; z-index: 70; display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; }
  .pal { width: min(620px, 94vw); background: var(--panel2); border: 1px solid var(--line2); border-radius: 12px; box-shadow: var(--shadow); overflow: hidden; }
  .in { display: flex; align-items: center; gap: .5rem; padding: .6rem .8rem; border-bottom: 1px solid var(--line); color: var(--muted); }
  .in input { flex: 1; border: 0; background: none; font-size: 1.05rem; padding: .2rem 0; outline: none; }
  ul { list-style: none; margin: 0; padding: .3rem; max-height: 52vh; overflow: auto; }
  li[role="option"] { display: flex; align-items: center; width: 100%; padding: .45rem .55rem; border-radius: 7px; gap: .6rem; cursor: pointer; }
  @media (pointer: coarse) { li[role="option"] { min-height: 44px; } }
  li.cur { background: #ffaa1c1f; }
  .l { font-weight: 550; } .h { color: var(--muted); font-size: .82rem; margin-left: auto; }
  .none { padding: 1rem; color: var(--muted); text-align: center; }
</style>
