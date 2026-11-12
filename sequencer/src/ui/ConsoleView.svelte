<script lang="ts">
  // The console: the app laid out like a lighting desk (a compact one, the size of a ChamSys
  // QuickQ), for a mouse, a keyboard or a touch screen. A command line ("1 thru 4 @ 50", "group 2
  // @ full", "1.3 thru 1.16", "go 2"), a fader with a select and a flash button for every light or
  // group, encoders for what the selection can do (intensity, position, colour as hue and
  // saturation, beam, effects), a fader with GO, Flash and Release for every cue list, and the
  // grand master. Everything goes through the programmer and the lists like anywhere else.
  import { app } from '../app.svelte';
  import { dialogOpen, spaceIsGo, ui } from './ui.svelte';
  import Knob from './Knob.svelte';
  import Help from './Help.svelte';
  import { cueNumber } from '../model/cuenum';
  import { bindingLabel, enableMidi, learnMidi, midiSupported, sameBinding } from '../input/midi';
  import Fader from './Fader.svelte';
  import { listRiskOf } from './risk';
  import { isMachine, RISK_LABEL } from '../model/safety';
  import type { ChannelAttr, Color, NumAttr } from '../model/types';
  import { slotsOf } from '../engine/render';
  import StageView from './StageView.svelte';
  import Icon from './Icon.svelte';

  // ---- the command line
  let cmd = $state(''), said = $state(''), bad = $state(false), line = $state<HTMLInputElement>();
  // The stage beside the desk (the plan, or 3D with its button): a click on a light selects it, as
  // a desk's visualiser does. Hidden with its button; remembered in the browser.
  const STAGE_KEY = 'luxdmx.seq.console.stage';
  let showStage = $state((() => { try { const v = localStorage.getItem(STAGE_KEY); return v === null ? typeof window === 'undefined' || window.innerWidth > 1100 : v === '1'; } catch { return true; } })());
  $effect(() => { try { localStorage.setItem(STAGE_KEY, showStage ? '1' : '0'); } catch { /* not kept */ } });
  const history: string[] = [];
  let back = -1;
  function run() {
    const t = cmd.trim();
    if (!t) return;
    const r = app.runCommand(t);
    said = r.said; bad = !r.ok;
    if (r.ok) { history.unshift(t); history.splice(30); cmd = ''; back = -1; }
  }
  function lineKey(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); run(); }
    else if (e.key === 'ArrowUp' && history.length) { e.preventDefault(); back = Math.min(history.length - 1, back + 1); cmd = history[back]; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); back = Math.max(-1, back - 1); cmd = back < 0 ? '' : history[back]; }
    else if (e.key === 'Escape') { cmd = ''; said = ''; }
  }
  const keypad = ['7', '8', '9', 'thru', '4', '5', '6', '+', '1', '2', '3', '-', '0', '.', '@', 'full'];
  const KEY_NAME: Record<string, string> = { '+': 'plus (add)', '-': 'minus (take out)', '.': 'point (a cell: 1.3)', '@': 'at (a level)' };
  // (the last word or digit typed)
  const rubOut = () => { padTyping = true; const t = cmd.trimEnd(); cmd = /\d$/.test(t) ? t.slice(0, -1) : t.replace(/\S+$/, ''); line?.focus(); };
  // (from the keypad on a touch screen the phone's own keyboard stays down: the keypad is the keyboard)
  let padTyping = $state(false);
  const press = (k: string) => { padTyping = true; cmd = /^[0-9.]$/.test(k) ? cmd + k : `${cmd.trimEnd()} ${k} `; line?.focus(); };
  // typing anywhere on the console (not in a field) goes to the command line; Space is GO
  // (a fader or an encoder keeps only its own keys: arrows, Page Up/Down, Home/End, Enter)
  const OWN = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Enter']);
  function anyKey(e: KeyboardEvent) {
    if (app.view !== 'console' || e.ctrlKey || e.metaKey || e.altKey || dialogOpen()) return;
    const t = e.target as HTMLElement;
    if (t.closest('input:not([type=range]), textarea, select, [contenteditable], .modal')) return;
    if (t.closest('[role="slider"], input[type=range]') && OWN.has(e.key)) return;
    // Space is GO, on the list Live plays (as there: not while it repeats; a focused button too, a
    // Flash button excepted, so Space never presses the last button clicked again)
    if (e.code === 'Space') { if (spaceIsGo(e)) { e.preventDefault(); const l = app.liveList; if (l) app.go(l.id); } else if (e.repeat) e.preventDefault(); return; }
    if (e.key.length === 1 && /[0-9a-z@+\-.>]/i.test(e.key)) { line?.focus(); }
  }

  // ---- lights and groups: a fader, a select and a flash button each, 20 at a time
  let mode = $state<'lights' | 'groups'>('lights'), bank = $state(0);
  const PER = 20;
  const strips = $derived(mode === 'lights'
    // (lights that make light: a fog machine or a flame projector has no level fader here)
    // (in the order of their numbers, as a desk's fixture faders: fader 7 is light 7 after a sort too)
    // (no machines: fog, flames, sparks, CO2, confetti have their buttons on Live, not a level here)
    ? app.show.fixtures.flatMap((f, i) => { const c = app.caps(f.id); return c.fog || isMachine(app.modeOf(f.id)) || !(c.intensity || c.color || c.white || c.cct) ? [] : [{ key: f.id, num: f.num ?? i + 1, name: f.name, ids: [f.id] }]; }).sort((a, b) => a.num - b.num)
    : app.show.groups.map((g, i) => ({ key: g.id, num: i + 1, name: g.name, ids: g.fixtures })));
  const banks = $derived(Math.max(1, Math.ceil(strips.length / PER)));
  const shown = $derived(strips.slice(bank * PER, bank * PER + PER));
  $effect(() => { if (bank >= banks) bank = banks - 1; });
  const levelOf = (ids: string[]) => (ids.length ? ids.reduce((a, id) => a + (app.look[id]?.intensity ?? 0), 0) / ids.length : 0);
  const isSel = (ids: string[]) => ids.length > 0 && ids.every((id) => app.selected.includes(id));
  // ---- MIDI: with MIDI on, a fader's MIDI button waits for a control to be moved, and from then
  // on that control moves the fader (in every view). The button again: its control is let go.
  let midiMode = $state(false), learning = $state<string | null>(null);
  const boundTo = (to: string) => app.show.settings.consoleMidi?.find((b) => b.to === to)?.midi;
  async function midiOnOff() {
    if (midiMode) { midiMode = false; learning = null; learnMidi(null); return; }
    try { await enableMidi(); midiMode = true; } catch (e) { ui.toast((e as Error).message); }
  }
  function learnFor(to: string) {
    if (learning === to) { learning = null; learnMidi(null); return; }
    if (boundTo(to) && learning === null) { app.unbindConsoleMidi(to); return; }
    learning = to;
    learnMidi((m) => {
      learning = null; app.bindConsoleMidi(to, m);
      // (the console has it first: a live page's button or fader on the same control stops answering it)
      const on = app.show.pages.flatMap((p) => p.widgets.filter((w) => sameBinding(w.midi, m)).map((w) => w.label || p.name));
      ui.toast(`${m.kind === 'note' ? 'Note' : 'Control'} ${m.num} moves it now${on.length ? `. It was on ${on.slice(0, 2).join(', ')} on a live page: that one doesn't answer it any more` : ''}`, on.length ? 7000 : 2200);
    });
  }
  $effect(() => () => learnMidi(null));
  // (Add: a tap adds to the selection or takes out, as Shift does with a mouse; a finger has no Shift)
  let addMode = $state(false);
  function pick(ids: string[], e: MouseEvent) {
    if (e.shiftKey || e.ctrlKey || e.metaKey || addMode) app.selected = isSel(ids) ? app.selected.filter((x) => !ids.includes(x)) : [...new Set([...app.selected, ...ids])];
    else app.selected = [...ids];
  }

  // ---- encoders: the attributes the selection has, a page at a time
  const sel = $derived(app.show.fixtures.filter((f) => app.selected.includes(f.id)));
  const attrs = $derived.by(() => { const a = new Set<ChannelAttr>(); for (const f of sel) for (const c of app.modeOf(f.id)?.channels ?? []) a.add(c.attr); return a; });
  type Enc = { k: NumAttr | 'hue' | 'sat'; label: string; need: ChannelAttr[] };
  const PAGES: { id: string; label: string; enc: Enc[] }[] = [
    { id: 'int', label: 'Intensity', enc: [{ k: 'intensity', label: 'Intensity', need: ['intensity', 'red', 'green', 'blue', 'white', 'cyan', 'colorWheel', 'cct', 'warmWhite'] }, { k: 'strobe', label: 'Strobe', need: ['strobe', 'shutter'] }] },
    { id: 'pos', label: 'Position', enc: [{ k: 'pan', label: 'Pan', need: ['pan'] }, { k: 'tilt', label: 'Tilt', need: ['tilt'] }, { k: 'roll', label: 'Roll', need: ['roll'] },
      { k: 'panRotation', label: 'Pan spin', need: ['panRotation'] }, { k: 'tiltRotation', label: 'Tilt spin', need: ['tiltRotation'] }, { k: 'rollRotation', label: 'Roll spin', need: ['rollRotation'] },
      { k: 'speed', label: 'Move speed', need: ['speed'] }] },
    { id: 'col', label: 'Colour', enc: [{ k: 'hue', label: 'Hue', need: ['red', 'cyan', 'colorWheel'] }, { k: 'sat', label: 'Saturation', need: ['red', 'cyan'] },
      { k: 'white', label: 'White', need: ['white'] }, { k: 'amber', label: 'Amber', need: ['amber'] }, { k: 'uv', label: 'UV', need: ['uv'] }, { k: 'cct', label: 'Colour temperature', need: ['cct', 'warmWhite', 'coolWhite'] }] },
    { id: 'beam', label: 'Beam', enc: [{ k: 'zoom', label: 'Zoom', need: ['zoom'] }, { k: 'focus', label: 'Focus', need: ['focus'] }, { k: 'iris', label: 'Iris', need: ['iris'] }, { k: 'frost', label: 'Frost', need: ['frost'] },
      { k: 'prism', label: 'Prism', need: ['prism'] }, { k: 'prismRotation', label: 'Prism rotation', need: ['prismRotation'] }, { k: 'goboRotation', label: 'Gobo rotation', need: ['goboRotation'] }, { k: 'gobo2Rotation', label: 'Gobo 2 rotation', need: ['gobo2Rotation'] }] },
    // (the light's own programs, not the app's effects)
    { id: 'fx', label: 'Built-in', enc: [{ k: 'effectSpeed', label: 'Effect speed', need: ['effectSpeed'] }, { k: 'animation', label: 'Animation wheel', need: ['animation'] }, { k: 'animationRotation', label: 'Animation rotation', need: ['animationRotation'] }] },
    { id: 'fog', label: 'Fog', enc: [{ k: 'fog', label: 'Fog', need: ['fog'] }, { k: 'haze', label: 'Haze', need: ['haze'] }] },
  ];
  const pages = $derived(PAGES.map((p) => ({ ...p, enc: p.enc.filter((e) => e.need.some((a) => attrs.has(a))) })).filter((p) => p.enc.length || SLOT_ENC.some((e) => e.page === p.id && attrs.has(e.k))));
  let page = $state('int');
  const cur = $derived(pages.find((p) => p.id === page) ?? pages[0]);
  // what an encoder shows: the first selected light's value (its first picked cell's)
  const first = $derived.by(() => {
    const f = sel[0];
    return f ? app.lookFor(f.id) : undefined;
  });
  function hsvOf(c: Color | undefined): [number, number] {
    const x = c ?? { r: 1, g: 1, b: 1 }, mx = Math.max(x.r, x.g, x.b), mn = Math.min(x.r, x.g, x.b), d = mx - mn;
    let h = 0;
    if (d > 1e-9) h = mx === x.r ? ((x.g - x.b) / d + 6) % 6 : mx === x.g ? (x.b - x.r) / d + 2 : (x.r - x.g) / d + 4;
    return [h / 6, mx > 0 ? d / mx : 0];
  }
  // Encoders that click from slot to slot: a gobo wheel, a built-in effect, a colour program. The
  // first selected light that has it says where it is (what you just set, not the last frame); each
  // light gets the one by that name (app.setSlot).
  type SlotK = 'gobo' | 'gobo2' | 'effectMacro' | 'colorMacro';
  const SLOT_ENC: { k: SlotK; label: string; page: string }[] = [
    { k: 'gobo', label: 'Gobo', page: 'beam' }, { k: 'gobo2', label: 'Gobo 2', page: 'beam' },
    { k: 'effectMacro', label: 'Built-in effect', page: 'fx' }, { k: 'colorMacro', label: 'Colour program', page: 'fx' },
  ];
  function slotInfo(k: SlotK) {
    for (const f of sel) {
      const c = app.modeOf(f.id)?.channels.find((x) => x.attr === k && !x.fine);
      const slots = c ? slotsOf(c) : [];
      if (!slots.length) continue;
      // (what was just set, when it's a number; a palette's reference: what it shows)
      const p = app.programmer[f.id]?.[k], v = (typeof p === 'number' ? p : typeof app.look[f.id]?.[k] === 'number' ? app.look[f.id]![k] : 0) as number;
      return { slots, at: Math.max(0, Math.min(slots.length - 1, Math.round(v * (slots.length - 1)))) };
    }
  }
  const slotEncs = $derived(cur ? SLOT_ENC.filter((e) => e.page === cur.id && attrs.has(e.k)) : []);
  function stepSlot(k: SlotK, d: number) {
    const s = slotInfo(k);
    if (!s) return;
    const i = Math.max(0, Math.min(s.slots.length - 1, s.at + Math.sign(d)));
    if (i !== s.at) app.setSlot(k, s.slots[i].label, i);
  }
  // the page's palettes (presets of its kind), a tap puts one on the selection, as on a desk
  const KIND: Record<string, 'intensity' | 'color' | 'position' | 'beam'> = { int: 'intensity', col: 'color', pos: 'position', beam: 'beam' };
  const palettes = $derived(cur && KIND[cur.id] ? app.show.presets.filter((p) => p.kind === KIND[cur.id]) : []);
  const swatchOf = (p: { values: { color?: unknown } }) => { const c = p.values.color as Color | undefined; return c && 'r' in c ? `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})` : ''; };
  const valueOf = (k: Enc['k']) => (k === 'hue' ? hsvOf(first?.color)[0] : k === 'sat' ? hsvOf(first?.color)[1] : (first?.[k] as number | undefined));
  // (the selection's lights at different values, a fan: the encoder says from where to where)
  const spanOf = (k: Enc['k']) => {
    if (sel.length < 2 || k === 'hue' || k === 'sat') return undefined;
    let lo = Infinity, hi = -Infinity;
    for (const f of sel) { const v = app.lookFor(f.id)?.[k] as number | undefined; if (v === undefined) continue; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    return hi - lo > 0.005 ? [lo, hi] : undefined;
  };
  const fmtOf = (k: Enc['k']) => {
    if (k === 'hue') return (v: number) => `${Math.round(v * 360)}°`;
    const sp = spanOf(k);
    return sp ? () => `${Math.round(sp[0] * 100)}–${Math.round(sp[1] * 100)}%` : undefined;
  };
  function setAbs(k: Enc['k'], v: number) {
    if (k === 'hue' || k === 'sat') { const now = valueOf(k) ?? 0; app.nudge(k, v - now); return; }
    app.set({ [k]: v } as Record<string, number>);
  }

  async function recordPalette(kind: 'intensity' | 'color' | 'position' | 'beam') {
    const name = await ui.ask(`New ${cur?.label.toLowerCase() ?? ''} palette`, '', { body: 'Made from what the selected lights show now.', ok: 'Save palette' });
    if (!name) return;
    if (app.presetFromSelection(kind, name)) ui.toast(`Saved "${name}"`); else ui.toast('Select the lights to take it from first');
  }

  // ---- playbacks: every cue list, 10 at a time
  let pbank = $state(0);
  const PPER = 10;
  const lists = $derived(app.show.cueLists);
  const pbanks = $derived(Math.max(1, Math.ceil(lists.length / PPER)));
  const pshown = $derived(lists.slice(pbank * PPER, pbank * PPER + PPER));
  $effect(() => { if (pbank >= pbanks) pbank = pbanks - 1; });
  const st = (id: string) => app.status[id];
  // a list that fires machines (flames, sparks, CO2, confetti): marked, and said when it's safe
  const riskOf = (l: (typeof app.show.cueLists)[number]) => listRiskOf(app.show, l, app.showRev);
  function cuesOf(l: (typeof app.show.cueLists)[number], e: MouseEvent) {
    const on = st(l.id)?.running ? st(l.id)!.index : -1;
    ui.openMenu(e, [{ heading: `${l.name}: go to a cue` },
      ...l.cues.map((c, i) => ({ label: `${i === on ? '▶ ' : ''}${cueNumber(l, i)}  ${c.name}`, run: () => playing(l, () => app.jump(l.id, i)) })),
      ...(l.cues.length ? [] : [{ label: 'No cues yet', disabled: true, run: () => {} }])]);
  }
  function playing(l: (typeof app.show.cueLists)[number], what: () => void) {
    const r = riskOf(l);
    if ((r === 'hazard' || r === 'once') && !app.sfxArmed) ui.toast(`${l.name}: safe, nothing fires (not armed). Hold Arm, top right, to fire them.`, 4000);
    what();
  }
  // leaving the console lets go of anything still held here (a flash held while the view changed)
  const onScreen = $derived(app.view === 'console');
  $effect(() => { if (!onScreen) app.releaseConsoleHolds(); });

  // flash buttons: held with a pointer (any: mouse, finger) or Space/Enter on the button
  // (the handler can change with every redraw: kept up to date, the press goes on)
  function holdBtn(node: HTMLElement, first: (down: boolean) => void) {
    let held = false, on = first;
    const d = (e: Event) => { if (e instanceof KeyboardEvent && e.key !== ' ' && e.key !== 'Enter') return; if (held) return; held = true; e.preventDefault(); on(true); };
    const u = (e: Event) => { if (e instanceof KeyboardEvent && e.key !== ' ' && e.key !== 'Enter') return; if (!held) return; held = false; on(false); };
    node.addEventListener('pointerdown', d); node.addEventListener('pointerup', u); node.addEventListener('pointercancel', u); node.addEventListener('pointerleave', u);
    node.addEventListener('keydown', d); node.addEventListener('keyup', u); node.addEventListener('blur', u);
    return { update(next: (down: boolean) => void) { on = next; }, destroy() { if (held) on(false); for (const [n, f] of [['pointerdown', d], ['pointerup', u], ['pointercancel', u], ['pointerleave', u], ['keydown', d], ['keyup', u], ['blur', u]] as const) node.removeEventListener(n, f); } };
  }
  const changed = $derived(Object.keys(app.programmer).length);
  // (Clear can be taken back for a moment, as on Live: a slip mustn't lose a half-built look)
  function clearUndo() { const keep = $state.snapshot(app.programmer); app.clearProgrammer(); ui.toast('Cleared: the cues have their lights back', 4000, { label: 'Undo', run: () => (app.programmer = keep) }); }
  function step(d: 1 | -1) { const r = app.runCommand(d > 0 ? 'next' : 'prev'); said = r.said; bad = !r.ok; }
  function record() { const l = app.liveList, ok = app.record(l?.id); ui.toast(ok ? `Recorded as a new cue in ${l?.name ?? app.list?.name ?? 'a new list'}` : 'Nothing to record: set some lights first (5 @ full)'); }
</script>

<svelte:window onkeydown={anyKey} />

<!-- (with MIDI on: a fader's control, or a button to give it one) -->
{#snippet midiBtn(to: string, name: string)}
  {#if midiMode}
    {@const b = boundTo(to)}
    <button class="midi" class:on={learning === to} class:bound={!!b} aria-label="MIDI for {name}" onclick={() => learnFor(to)}
            title={learning === to ? 'Move a fader or knob on the controller (again: cancel)' : b ? `${bindingLabel(b)} moves it (click: let go of it)` : 'Learn: then move a fader or knob on the controller'}>{learning === to ? '…' : b ? `${b.kind === 'note' ? 'N' : 'CC'}${b.num}` : 'Learn'}</button>
  {/if}
{/snippet}

<div class="console" class:with-stage={showStage} aria-label="Console">
  {#if showStage}
    <section class="stage" aria-label="Stage">{#if onScreen || ui.stage3d}<StageView compact blindChip={false} />{/if}</section>
  {/if}
  <section class="cmd" aria-label="Command line" data-marks="show">
    <div class="line">
      <input bind:this={line} bind:value={cmd} onkeydown={lineKey} inputmode={padTyping ? 'none' : undefined} onpointerdown={() => (padTyping = false)} placeholder="1 thru 4 @ 50 · group 2 @ full · 1.3 thru 1.16 · go 2 · clear" aria-label="Command" spellcheck="false" autocomplete="off" />
      <button class="primary" onclick={run}>Enter</button>
      <button class="ghost stagebtn" class:on={showStage} aria-pressed={showStage} onclick={() => (showStage = !showStage)} aria-label="Show the stage" title={showStage ? 'Hide the stage' : 'Show the stage (the plan, or 3D)'}><Icon name="eye" /></button>
      <Help label="About the console">
        <p>The app as a small lighting desk. Type, or use the keypad:</p>
        <p><b>5 @ full</b> light 5 at full · <b>1 thru 4 @ 50</b> four lights at half · <b>@ 5</b> is 50 %, <b>@ 05</b> is 5 % · <b>1 - 3</b> is light 1 without 3 · <b>group 2 @ out</b> · <b>1.3 thru 1.8</b> cells 3 to 8 of light 1.</p>
        <p><b>record</b> a new cue in the list Live plays, <b>record cue 5</b>, <b>update</b>, <b>goto cue 5</b>, <b>cue 5 time 3</b>, <b>go</b>, <b>back</b>, <b>clear</b>, <b>next</b> / <b>prev</b> one light of the selection at a time.</p>
        <p>The numbers are the lights' own (grey, in front of their names in the fixture list; on the plan with its # button). The faders under the encoders set a light's level, or scale a group (its master). Space is GO.</p>
      </Help>
    </div>
    <p class="said" class:bad role="status" aria-live="polite">{said || `${app.selected.length} selected${changed ? `, ${changed} changed` : ''}`}</p>
    <div class="pad" aria-label="Keypad">
      {#each keypad as k (k)}<button onclick={() => press(k)} aria-label={KEY_NAME[k]}>{k}</button>{/each}
      <button onclick={rubOut} aria-label="Rub out the last" title="Rub out the last digit or word">⌫</button>
      <button onclick={() => { cmd = ''; said = ''; }} aria-label="Empty the command line" title="Empty the command line">Esc</button>
      <button class="wide" onclick={() => press('group')}>Group</button>
    </div>
    <div class="acts">
      <button class="rec" onclick={record} title="Record what's changed as a new cue in {app.liveList?.name ?? 'a new list'} (the list Live and GO play)">Record{app.liveList ? ` into ${app.liveList.name}` : ''}</button>
      <button onclick={() => { const r = app.updateOnStage(); ui.toast(r.said); }} disabled={!changed && !app.liveFx.length} title="Update the cue on stage in the list Live plays">Update</button>
      <button class:on={!!app.show.settings.recordChanges} aria-pressed={!!app.show.settings.recordChanges} onclick={() => { app.checkpoint(); if (app.show.settings.recordChanges) delete app.show.settings.recordChanges; else app.show.settings.recordChanges = true; app.markDirty(0); }}
              title="Record and Update keep only what you changed (as desks do: in a play, what earlier cues set carries on through). Off: each light you touched with its whole look.">Only changes</button>
      <button onclick={clearUndo} disabled={!changed} title="Let go of your changes: the cues take over again">Clear</button>
      <button class:on={app.highlight} aria-pressed={app.highlight} onclick={() => (app.highlight = !app.highlight)} disabled={!app.selected.length && !app.highlight}>Highlight</button>
    </div>
    <!-- one light of the selection at a time (Highlight on: each one lights up to focus it) -->
    <div class="acts step" aria-label="Step through the selection">
      <button onclick={() => step(-1)} title="The light before (of the selection; one or none selected: by number)">◀ Prev</button>
      <button onclick={() => step(1)} title="The next light (of the selection; one or none selected: by number)">Next ▶</button>
      {#if app.stepAll}<button onclick={() => { app.stepBack(); said = `${app.selected.length} selected again`; bad = false; }} title="The whole selection again">All {app.stepAll.length}</button>{/if}
      <button class:on={app.lowlight > 0} aria-pressed={app.lowlight > 0} disabled={!app.highlight} onclick={() => (app.lowlight = app.lowlight > 0 ? 0 : 0.15)} title="With Highlight on, stepping: the rest of the selection faintly on (15 %), so you see where they are">Lowlight</button>
      <button onclick={() => app.undo()} disabled={!app.canUndo} title="Undo the last change to the show (a recorded cue, a patch change); Clear lets go of the programmer">Undo</button>
    </div>
  </section>

  <section class="enc" aria-label="Encoders" data-marks="hide">
    <div class="tabs" role="tablist" aria-label="Encoder page">
      {#each pages as p (p.id)}<button role="tab" aria-selected={cur?.id === p.id} class:cur={cur?.id === p.id} onclick={() => (page = p.id)}>{p.label}</button>{/each}
      {#if !pages.length}<span class="faint">Select lights (a strip's button, or type 1 thru 4) and their encoders show up here.</span>{/if}
    </div>
    {#if cur}
      <div class="knobs">
        {#each cur.enc as e (e.k)}
          <Knob label={e.label} value={valueOf(e.k)} fmt={fmtOf(e.k)} typeMax={e.k === 'hue' ? 360 : 100} onturn={(d) => app.nudge(e.k, d)} onset={(v) => setAbs(e.k, v)} />
        {/each}
        <!-- (these click from slot to slot, showing its name) -->
        {#each slotEncs as e (e.k)}
          {@const s = slotInfo(e.k)}
          {#if s}<Knob label={e.label} detents value={s.slots.length > 1 ? s.at / (s.slots.length - 1) : 0} fmt={() => s.slots[s.at]?.label ?? ''} onturn={(d) => stepSlot(e.k, d)} />{/if}
        {/each}
      </div>
      {#if cur && KIND[cur.id]}
        <div class="pals" aria-label="Palettes">
          {#each palettes as p (p.id)}
            <button class:on={app.usesPreset(p.id)} onclick={() => app.applyPreset(p.id)} title="{p.name}: on the selection">{#if swatchOf(p)}<span class="dot" style="background:{swatchOf(p)}"></span>{/if}{p.name}</button>
          {/each}
          <!-- (record a palette from what the selection shows now, as a desk's Record Preset) -->
          <button class="ghost" onclick={() => recordPalette(KIND[cur.id])} disabled={!app.selected.length} title="A new {cur.label.toLowerCase()} palette from what the selected lights show now">+ Palette</button>
        </div>
      {/if}
    {/if}
  </section>

  <section class="gm" aria-label="Grand master">
    {@render midiBtn('grand', 'the grand master')}
    <Fader label="Grand master" value={app.grandMaster} height={260} onset={(v) => (app.grandMaster = v)} />
    <span class="faint">Master {Math.round(app.grandMaster * 100)}%</span>
    <button class="bo" class:on={app.blackout} aria-pressed={app.blackout} onclick={() => (app.blackout = !app.blackout)}>Blackout</button>
  </section>

  <section class="faders" aria-label={mode === 'lights' ? 'Light faders' : 'Group faders'} data-marks="hide">
    <div class="bar">
      <div class="seg" role="radiogroup" aria-label="Faders for">
        <button role="radio" aria-checked={mode === 'lights'} class:on={mode === 'lights'} onclick={() => { mode = 'lights'; bank = 0; }}>Lights</button>
        <button role="radio" aria-checked={mode === 'groups'} class:on={mode === 'groups'} onclick={() => { mode = 'groups'; bank = 0; }}>Groups</button>
      </div>
      <div class="seg">
        <button class:on={addMode} aria-pressed={addMode} onclick={() => (addMode = !addMode)} title="A tap on a strip's name adds it to the selection or takes it out (Shift-click does the same)">Add</button>
        {#if midiSupported()}<button class:on={midiMode} aria-pressed={midiMode} onclick={midiOnOff} title="Put faders on a MIDI controller: then a fader's MIDI button, then move a fader or knob on the controller">MIDI</button>{/if}
      </div>
      {#if banks > 1}<span class="faint">{bank * PER + 1}–{Math.min(strips.length, bank * PER + PER)} of {strips.length}</span>
        <button onclick={() => (bank = Math.max(0, bank - 1))} disabled={bank === 0} aria-label="Previous faders">◀</button>
        <button onclick={() => (bank = Math.min(banks - 1, bank + 1))} disabled={bank >= banks - 1} aria-label="Next faders">▶</button>{/if}
    </div>
    <div class="strips">
      {#each shown as s (s.key)}
        <div class="strip" class:sel={isSel(s.ids)} data-strip={s.name}>
          <span class="num">{s.num}</span>
          {@render midiBtn(`${mode === 'groups' ? 'group' : 'light'}:${s.key}`, s.name)}
          {#if mode === 'groups'}
            <!-- a group's fader is its master: it scales what the cues give its lights (it doesn't set them) -->
            <Fader label="{s.name} master" value={app.groupMasters[s.key] ?? 1} onset={(v) => (app.groupMasters = { ...app.groupMasters, [s.key]: v })} />
          {:else}
            <Fader label="{s.name} level" value={levelOf(s.ids)} onset={(v) => app.setLevelOf(s.ids, v)} />
          {/if}
          <span class="pct">{Math.round((mode === 'groups' ? app.groupMasters[s.key] ?? 1 : levelOf(s.ids)) * 100)}</span>
          <!-- (a group: as the groups panel selects it, a group of cells picks its cells) -->
          <button class="selb" aria-pressed={isSel(s.ids)} onclick={(e) => (mode === 'groups' && !(e.shiftKey || e.ctrlKey || e.metaKey || addMode) ? app.selectGroup(s.key) : pick(s.ids, e))} title="Select (Shift: add or take out)">{s.name}</button>
          <button class="flash" data-own-space use:holdBtn={(down) => app.flashLights(s.key, s.ids, down, mode === 'groups' ? app.show.groups.find((g) => g.id === s.key) : undefined)} aria-label="Flash {s.name}">Flash</button>
        </div>
      {/each}
      {#if !shown.length}<p class="faint">{mode === 'lights' ? 'No lights patched yet (Program, Fixtures, Add).' : 'No groups yet.'}</p>{/if}
    </div>
  </section>

  <section class="playbacks" aria-label="Cue lists" data-marks="hide">
    <div class="bar"><b>Cue lists</b>
      {#if pbanks > 1}<button onclick={() => (pbank = Math.max(0, pbank - 1))} disabled={pbank === 0} aria-label="Previous playbacks">◀</button>
        <button onclick={() => (pbank = Math.min(pbanks - 1, pbank + 1))} disabled={pbank >= pbanks - 1} aria-label="Next playbacks">▶</button>{/if}
    </div>
    <div class="strips">
      {#each pshown as l, i (l.id)}
        {@const s = st(l.id)}
        {@const risk = riskOf(l)}
        {@const nextCue = s?.running ? l.cues[s.index + 1] ?? (l.end === 'loop' ? l.cues[0] : undefined) : l.cues[0]}
        <div class="strip pb" class:on={s?.running && !s?.releasing} data-list={l.name} style="--c:{l.color ?? 'var(--green)'}">
          <span class="num">{pbank * PPER + i + 1}</span>
          {@render midiBtn(`list:${l.id}`, l.name)}
          {#if risk !== 'light'}<span class="chip risk {risk}" title="{RISK_LABEL[risk]}{risk === 'hazard' || risk === 'once' ? (app.sfxArmed ? ': armed' : ': safe, not armed') : ''}">{RISK_LABEL[risk]}</span>{/if}
          <Fader label="{l.name} fader" dblFull={false} value={s?.running ? s.master : 0} onset={(v) => (v > 0.03 && !s?.running ? playing(l, () => app.playbackFader(l.id, v)) : app.playbackFader(l.id, v))} />
          <!-- (its cues, numbered: one tapped goes there, as the cue list window on a desk) -->
          <button class="name ghost" onclick={(e) => cuesOf(l, e)} title="{l.name}: its cues (pick one to go to it)" aria-label="Cues of {l.name}">{l.name}</button>
          <span class="cue faint" title="On stage">{s?.running ? (l.cues[s.index]?.name ?? '') : ''}</span>
          <!-- (what GO plays next, to see on a touch screen too) -->
          <span class="cue next faint" title="Next on GO">{nextCue ? `▸ ${nextCue.name}` : ''}</span>
          <button class="go" onclick={() => playing(l, () => app.go(l.id))} aria-label="GO {l.name}" title={nextCue ? `GO: ${nextCue.name}` : 'GO'}>GO</button>
          <button class="flash" data-own-space use:holdBtn={(down) => (down ? playing(l, () => app.flashList(l.id, true)) : app.flashList(l.id, false))} aria-label="Flash {l.name}">Flash</button>
          <span class="two">
            <button onclick={() => app.back(l.id)} disabled={!s?.running || s.index < 1} aria-label="Back {l.name}" title="Back: the cue before">◀</button>
            <button onclick={() => app.release(l.id)} disabled={!s?.running} aria-label="Release {l.name}" title="Release: let go of this list">■</button>
          </span>
        </div>
      {/each}
      {#if !pshown.length}<p class="faint">No cue lists yet: select lights, set them, Record.</p>{/if}
    </div>
  </section>
</div>

<style>
  .console { flex: 1; min-height: 0; overflow: auto; display: grid; gap: .6rem; padding: .6rem;
    grid-template-columns: minmax(260px, 340px) 1fr auto; grid-template-areas: 'cmd enc gm' 'cmd faders gm' 'pb pb gm'; align-content: start; }
  @media (max-width: 900px) { .console { grid-template-columns: 1fr; grid-template-areas: 'cmd' 'enc' 'faders' 'pb' 'gm'; } }
  /* the stage on the right of the encoders and faders; on a narrow screen under the command line */
  .console.with-stage { grid-template-columns: minmax(260px, 340px) minmax(0, 1fr) minmax(320px, 38%) auto; grid-template-areas: 'cmd enc stage gm' 'cmd faders stage gm' 'pb pb pb gm'; }
  @media (max-width: 1100px) { .console.with-stage { grid-template-columns: minmax(240px, 320px) 1fr auto; grid-template-areas: 'cmd stage gm' 'enc enc gm' 'faders faders gm' 'pb pb gm'; } }
  @media (max-width: 900px) { .console.with-stage { grid-template-columns: 1fr; grid-template-areas: 'cmd' 'stage' 'enc' 'faders' 'pb' 'gm'; } }
  .stage { grid-area: stage; padding: 0; overflow: hidden; display: flex; height: min(58vh, 520px); min-height: 280px; }
  .stage :global(.stage-wrap) { flex: 1; min-width: 0; border: 0; }
  .stagebtn.on { border-color: var(--accent); color: var(--accent); }
  section { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: .5rem; min-width: 0; }
  .cmd { grid-area: cmd; display: flex; flex-direction: column; gap: .4rem; }
  .line { display: flex; gap: .3rem; }
  .line input { flex: 1; min-width: 0; font-family: ui-monospace, monospace; font-size: .95rem; }
  .said { margin: 0; font-size: .82rem; color: var(--muted); min-height: 1.1em; }
  .said.bad { color: var(--pink); }
  .pad { display: grid; grid-template-columns: repeat(4, 1fr); gap: .25rem; }
  .pad button { min-height: 40px; font-size: .95rem; }
  .pad .wide { grid-column: span 2; }
  .acts { display: flex; flex-wrap: wrap; gap: .25rem; }
  .acts button { flex: 1 0 30%; min-height: 36px; }
  .acts .on, .seg .on { border-color: var(--accent); color: var(--accent); }
  .rec { background: #f33abc1a; border-color: #f33abc77; color: #ff7fd6; font-weight: 650; }
  .enc { grid-area: enc; display: flex; flex-direction: column; gap: .4rem; }
  .tabs { display: flex; gap: .25rem; flex-wrap: wrap; }
  .tabs .cur { border-color: var(--accent); color: var(--accent); }
  .knobs { display: flex; gap: .8rem; flex-wrap: wrap; padding: .3rem 0; }
  .pals { display: flex; gap: .25rem; flex-wrap: wrap; }
  .pals button { display: inline-flex; align-items: center; gap: .3rem; min-height: 34px; font-size: .8rem; }
  .pals button.on { border-color: var(--accent); color: var(--accent); }
  .pals .dot { width: .8rem; height: .8rem; border-radius: 50%; border: 1px solid #0006; }
  .gm { grid-area: gm; display: flex; flex-direction: column; align-items: center; gap: .4rem; }
  .bo { min-height: 40px; }
  .bo.on { background: #f33abc33; border-color: var(--pink); }
  .faders { grid-area: faders; }
  .playbacks { grid-area: pb; }
  .bar { display: flex; gap: .4rem; align-items: center; margin-bottom: .35rem; flex-wrap: wrap; }
  .seg { display: inline-flex; gap: .2rem; }
  .strips { display: flex; gap: .35rem; overflow-x: auto; padding-bottom: .3rem; }
  .strip { display: flex; flex-direction: column; align-items: center; gap: .2rem; min-width: 64px; max-width: 80px; padding: .3rem .2rem; border-radius: var(--radius-s); border: 1px solid var(--line); }
  .strip.sel { border-color: var(--orange); background: #ffaa1c10; }
  .strip.pb.on { border-color: var(--c); box-shadow: inset 0 3px 0 var(--c); }
  .num { font-size: .72rem; color: var(--muted); }
  .pct { font-size: .74rem; font-variant-numeric: tabular-nums; }
  .flash { touch-action: none; }
  @media (pointer: coarse) { .strip button, .pad button, .acts button { min-height: 44px; } }
  .selb, .flash, .go, .strip button { width: 100%; font-size: .74rem; padding: .25rem .1rem; min-height: 32px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .strip.sel .selb { border-color: var(--orange); color: var(--orange); }
  .go { font-weight: 700; }
  .name { font-size: .76rem; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button.name { padding: 0 .2rem; min-height: 0; border: 0; color: var(--text); text-decoration: underline dotted; text-underline-offset: 3px; }
  .cue { font-size: .68rem; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-height: 1em; }
  .two { display: flex; gap: .45rem; width: 100%; }
  .cue.next { font-size: .68rem; } .two button { flex: 1 1 0; min-width: 0; padding-inline: .2rem; }
  .midi { font-size: .66rem; padding: .05rem .2rem; min-height: 0 !important; width: 100%; }
  .midi.bound { color: var(--green); border-color: var(--green); }
  .midi.on { color: var(--orange); border-color: var(--orange); }
</style>
