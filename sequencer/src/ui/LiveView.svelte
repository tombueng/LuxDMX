<script lang="ts">
  import { looksPage } from '../content/busking';
  import { whatsNew } from '../content/whatsNew';
  import { clockOf } from '../model/timeline';
  import { actionRisk, isGated } from '../model/safety';
  import { inWords, nextUp } from '../model/schedule';
  import { actionShort, actionText } from '../model/actions';
  // Live: play the show with big buttons. Starts with a page built from the show; Edit makes it
  // yours (add, move, change, remove controls; more pages). Keys on the buttons work as shortcuts,
  // Space is GO on the first cue list.
  import Icon from './Icon.svelte';
  import Help from './Help.svelte';
  import WidgetTile from './WidgetTile.svelte';
  import WidgetEditor from './WidgetEditor.svelte';
  import StageView from './StageView.svelte';
  import GoStrip from './GoStrip.svelte';
  import { fogTimer as makeFogTimer } from './actions';
  import { app, newId } from '../app.svelte';
  import { dialogOpen, spaceIsGo, tablist, ui } from './ui.svelte';
  import type { Widget } from '../model/types';
  import { enableMidi, midiReady, midiSupported, onMidiInputs } from '../input/midi';
  import { hhmm, pauseItems } from './schedulePause';
  import { SONG_NAME } from './widgetFace';
  import { setContext, untrack } from 'svelte';

  // App.svelte keeps this view while another is shown. Hidden, it rests: the stage isn't drawn
  // (the 3D one hands its world on), its keys are the shown view's, the screen may dim; leaving it
  // still lets go of everything held.
  const shown = $derived(app.view === 'live');
  setContext('view-shown', () => app.view === 'live');
  // the song's clock on the bar: hidden, it holds still (no update every frame for nobody)
  const songAt = $derived.by(() => (shown ? app.timeline.position : untrack(() => app.timeline.position)));
  // A first visit draws the frame (the bar, the pages) at once, the buttons and the GO strip a
  // moment later, in a task of their own once the frame is on screen (built hidden, the same)
  let built = $state(false);
  $effect(() => { const id = requestAnimationFrame(() => setTimeout(() => (built = true))); return () => cancelAnimationFrame(id); });

  const pages = $derived(app.pages);
  // locked for the service: the page it was locked on, and no other (also after a restart)
  const lockedOn = $derived(app.locked ? pages.find((p) => p.id === app.show.settings.lockPage) : undefined);
  const page = $derived(lockedOn ?? pages.find((p) => p.id === app.page) ?? pages[0]);
  const tabs = $derived(lockedOn ? [lockedOn] : pages);
  let selW = $state<string | null>(null);
  let drag = $state<string | null>(null);
  let dropAt = $state<string | null>(null);
  // the stage next to the buttons on a big screen; on a tablet the buttons get the room (the eye shows it)
  // the button size and the stage: remembered on this device (a reload by the cleaner keeps them)
  const VIEW_KEY = 'luxdmx.seq.liveview';
  let saved: { stage?: boolean; tile?: number } = {};
  try { saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}'); } catch { /* defaults */ }
  let showStage = $state(saved.stage ?? (typeof window === 'undefined' || window.innerWidth > 1100));
  let tile = $state(saved.tile ?? 130);
  $effect(() => { const v = JSON.stringify({ stage: showStage, tile }); try { localStorage.setItem(VIEW_KEY, v); } catch { /* not kept */ } });
  const selected = $derived(page?.widgets.find((w) => w.id === selW));
  const progHeld = $derived(Object.keys(app.programmer).length);
  // Look buttons name their list only when this page has looks from more than one list.
  const manyLists = $derived(new Set(page?.widgets.filter((x) => x.type === 'cue').map((x) => (x as { list: string }).list)).size > 1);
  // The editor goes to the left when the control being changed is on the right half.
  let editLeft = $state(false);
  $effect(() => {
    const id = selW;
    if (!id) return;
    queueMicrotask(() => {
      const el = document.querySelector(`.live [data-widget="${id}"]`), body = document.querySelector('.live .body');
      if (!el || !body) return;
      const r = el.getBoundingClientRect(), b = body.getBoundingClientRect();
      editLeft = r.left + r.width / 2 > b.left + b.width * 0.55;
    });
  });
  const held = new Map<string, Widget>();
  // Leaving the live page lets go of everything held (a flash or fog must never stay on): going to
  // another view, or the page going away.
  const letGo = () => { for (const w of held.values()) app.fireWidget(w, false); held.clear(); app.releaseHolds(); };
  let wasShown = false;
  $effect(() => { const on = shown; untrack(() => { if (wasShown && !on) letGo(); wasShown = on; }); });
  $effect(() => () => untrack(() => { if (wasShown) letGo(); }));
  // The screen stays on while playing (a tablet that dims mid-song is no fun). The browser drops
  // the lock when the tab is hidden, so it is taken again when the tab comes back.
  $effect(() => {
    if (!shown) return;
    let lock: WakeLockSentinel | null = null, gone = false;
    const take = () => { if (!gone && document.visibilityState === 'visible') navigator.wakeLock?.request('screen').then((l) => { if (gone) l.release(); else lock = l; }).catch(() => {}); };
    take();
    document.addEventListener('visibilitychange', take);
    return () => { gone = true; document.removeEventListener('visibilitychange', take); lock?.release().catch(() => {}); };
  });
  // MIDI: switched on by hand once (the browser asks), or quietly when it already may.
  let midiNames = $state<string[]>([]);
  let midiOn = $state(false);
  const usesMidi = $derived(pages.some((p) => p.widgets.some((w) => w.midi)));
  $effect(() => onMidiInputs((n) => { midiNames = n; midiOn = midiReady(); }));
  $effect(() => {
    if (!shown || !usesMidi || midiOn || !midiSupported()) return;      // (on the first visit, as it always was)
    navigator.permissions?.query({ name: 'midi' as PermissionName }).then((r) => { if (r.state === 'granted') midi(); }).catch(() => {});
  });
  async function midi() {
    try { await enableMidi(); midiOn = true; } catch (e) { ui.toast((e as Error).message); }
  }

  // Lock and unlock (the unlock needs a hold).
  const HOLD_MS = 1000;
  let unlockAt = $state(0);
  let unlockTimer: ReturnType<typeof setTimeout> | undefined;
  // the lock is for the whole show (every page), so another page tab can't be a way out
  // Locking is one tap. With a PIN set (Lock with a PIN…, so staff can't hold their way out)
  // unlocking asks for it.
  async function pinLock() { if (await app.pinLock()) selW = null; }
  // `keys`: locked from the keyboard (the focus stays on the padlock; after a click Space is GO again)
  async function setLocked(on: boolean, keys = false) {
    if (!on && app.show.settings.lockPin) {
      // a wrong PIN: the question again, saying so (no holding the padlock all over)
      for (let tries = 0; ; tries++) {
        const pin = await ui.ask('Unlock', '', { label: 'PIN', ok: 'Unlock', pin: true, body: tries ? "That wasn't it. Try again." : undefined });
        if (pin === null) return;
        if (pin.trim() === app.show.settings.lockPin) break;
        if (tries >= 4) { ui.toast('Wrong PIN', 2500); return; }
      }
    }
    app.lockShow(on);
    if (on) { selW = null; if (!keys && (document.activeElement as HTMLElement | null)?.closest?.('.lockbtn')) (document.activeElement as HTMLElement).blur(); }
    ui.toast(on ? 'Locked for the show: only playing. Hold the padlock to unlock.' : 'Unlocked', 3000);
  }
  let justUnlocked = false;            // the click that ends the hold mustn't lock it again
  function startUnlock(byPointer = true) {
    unlockAt = performance.now(); clearTimeout(unlockTimer);
    unlockTimer = setTimeout(() => { unlockAt = 0; justUnlocked = byPointer; try { navigator.vibrate?.(30); } catch { /* fine */ } setLocked(false); }, HOLD_MS);
  }
  function stopUnlock() { if (unlockAt) { clearTimeout(unlockTimer); unlockAt = 0; } }
  function edit() {
    if (page?.locked) return ui.toast('This page is locked. Unlock it first (padlock).');
    app.ownPages();
    app.editPage = !app.editPage;
    selW = null;
  }
  function add(kind: Widget['type'] | 'drop') {
    const p = app.ownPages().find((x) => x.id === (app.page || app.show.pages[0].id)) ?? app.show.pages[0];
    // the set list's three: Play / pause and Next song big, Next part next to them
    if (kind === 'song') {
      const at = selW ? p.widgets.findIndex((x) => x.id === selW) + 1 : p.widgets.length;
      const three: Widget[] = [{ id: newId('w'), type: 'song', do: 'play', size: 2 }, { id: newId('w'), type: 'song', do: 'next', size: 2 }, { id: newId('w'), type: 'song', do: 'part' }];
      p.widgets.splice(at, 0, ...three);
      selW = three[0].id;
      if (!app.show.timeline) ui.toast('Put a song on the Timeline (or a few: the set list) for these to play', 5000);
      return;
    }
    const l = app.liveList, fx = app.show.effects[0];
    const base = { id: newId('w') };
    const w: Widget | undefined =
      kind === 'list' ? (l ? { ...base, type: 'list', list: l.id, action: 'go' } : undefined)
      : kind === 'cue' ? (l?.cues[0] ? { ...base, type: 'cue', list: l.id, cue: l.cues[0].id } : undefined)
      : kind === 'effect' ? (fx ? { ...base, type: 'effect', effect: fx.id, action: 'toggle' } : undefined)
      : kind === 'fader' ? { ...base, type: 'fader', target: 'grand' }
      : kind === 'group' ? (app.show.groups[0] ? { ...base, type: 'group', group: app.show.groups[0].id, level: 1 } : undefined)
      : kind === 'fog' ? { ...base, type: 'fog', fixtures: app.show.fixtures.filter((f) => app.caps(f.id).fog).map((f) => f.id), level: 1, burst: 3, max: 10, label: 'Fog' }
      : kind === 'special' ? { ...base, type: 'special', do: 'blackout' }      // no label: it follows what it does
      : kind === 'cuelist' ? (l ? { ...base, type: 'cuelist', list: l.id } : undefined)
      : kind === 'drop' ? { ...base, type: 'special', do: 'drop', label: 'Drop' }
      : { ...base, type: 'label', label: 'New section' };
    if (!w) return ui.toast(kind === 'effect' ? 'Make an effect first (Program, Effects)' : kind === 'group' ? 'Make a group first (Program, Groups)' : 'Record some cues first');
    const at = selW ? p.widgets.findIndex((x) => x.id === selW) + 1 : p.widgets.length;
    p.widgets.splice(at, 0, w);
    selW = w.id;
  }
  function addMenu(e: MouseEvent) {
    ui.openMenu(e, [
      { label: 'Cue list button (GO, toggle, flash…)', icon: 'play', run: () => add('list') },
      { label: 'Scene button (one cue)', icon: 'record', run: () => add('cue') },
      { label: 'Effect button', icon: 'effect', run: () => add('effect') },
      { label: 'Flash a group', icon: 'bolt', run: () => add('group') },
      { label: 'Fader', icon: 'sun', run: () => add('fader') },
      { label: 'Fog (hold, with a maximum)', icon: 'fog', run: () => add('fog') },
      { label: 'Fog timer (a few seconds every few minutes)…', icon: 'fog', run: fogTimer },
      { label: 'Drop: white, strobe and fog while held', icon: 'bolt', run: () => add('drop') },
      { label: 'Blackout, tap, release all, blinder…', icon: 'moon', run: () => add('special') },
      { label: 'A whole cue list (for running a play)', icon: 'note', run: () => add('cuelist') },
      { label: 'Songs: play, next song, next part (the set list)', icon: 'music', run: () => add('song') },
      { label: 'Section heading', icon: 'note', run: () => add('label') },
    ]);
  }
  function fogTimer() { app.ownPages(); makeFogTimer(); }
  function removeW(id: string) {
    const p = app.show.pages.find((x) => x.id === page.id);
    if (p) p.widgets = p.widgets.filter((w) => w.id !== id);
    if (selW === id) selW = null;
  }
  // picked by the keyboard (Enter): straight into its settings; Esc there comes back to the control
  function pick(id: string, e?: MouseEvent) {
    selW = id;
    if (e?.detail === 0) setTimeout(() => document.querySelector<HTMLElement>('.live .float :is(input, select, textarea)')?.focus(), 0);
  }
  function closeEditor() {
    const id = selW;
    selW = null;
    if (id) queueMicrotask(() => document.querySelector<HTMLElement>(`.live .grid [data-widget="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
  }
  function tileMenu(e: MouseEvent, w: Widget) {
    if (page?.locked) return;
    const i = page?.widgets.findIndex((x) => x.id === w.id) ?? -1, n = page?.widgets.length ?? 0;
    ui.openMenu(e, [
      { label: 'Change this control…', icon: 'edit', run: () => { app.ownPages(); app.editPage = true; selW = w.id; } },
      { label: 'Move earlier', icon: 'left', keys: 'Alt+←', disabled: i <= 0, run: () => moveBy(w.id, -1) },
      { label: 'Move later', icon: 'right', keys: 'Alt+→', disabled: i < 0 || i >= n - 1, run: () => moveBy(w.id, 1) },
      { label: 'Remove it', icon: 'trash', danger: true, run: () => { app.ownPages(); app.checkpoint(); removeW(w.id); app.markDirty(0); app.toastUndo('Removed'); } },
    ]);
  }
  // A page made your own doesn't follow the show by itself: what's new there (a look, a list, an
  // effect, a group made since) is offered, and goes on this page in one tap (keys already taken
  // elsewhere left off). Nothing for the generated page: it follows anyway.
  const fresh = $derived(app.show.pages.length && !app.locked ? whatsNew(app.show, app.show.pages) : []);
  const nameOf = (w: Widget) => w.label || (w.type === 'cue' ? app.show.cueLists.find((l) => l.id === w.list)?.cues.find((c) => c.id === w.cue)?.name
    : w.type === 'list' || w.type === 'cuelist' ? app.show.cueLists.find((l) => l.id === w.list)?.name : w.type === 'effect' ? app.show.effects.find((e) => e.id === w.effect)?.name
    : w.type === 'group' ? app.show.groups.find((g) => g.id === w.group)?.name : w.type === 'song' ? SONG_NAME[w.do] : 'Fog') || '?';
  const freshNames = $derived(fresh.slice(0, 4).map(nameOf).join(', ') + (fresh.length > 4 ? ` and ${fresh.length - 4} more` : ''));
  function addNew() {
    const add = whatsNew(app.show, app.show.pages), p = app.show.pages.find((x) => x.id === page.id);
    if (!add.length || !p) return;
    app.checkpoint();
    const used = new Set(app.show.pages.flatMap((x) => x.widgets.map((w) => w.key).filter(Boolean)));
    p.widgets = [...p.widgets, ...add.map((w) => { const { key, ...rest } = w; return { ...rest, id: newId('w'), ...(key && !used.has(key) ? { key } : {}) } as Widget; })];
    app.markDirty(0);
    app.toastUndo(`Added to "${p.name}": ${add.slice(0, 4).map(nameOf).join(', ')}${add.length > 4 ? ` and ${add.length - 4} more` : ''}`);
  }
  // a page with just the looks, for staff (one tap instead of deleting everything else)
  function looksOnly() {
    app.ownPages();
    const p = looksPage(app.show, newId('pg'));
    if (!p.widgets.length) { ui.toast('No looks yet: record one in Program first'); return; }
    app.checkpoint();
    app.show.pages.push(p);
    app.page = p.id;
    app.markDirty(0);
    ui.toast('A page with just the looks. Lock it (the padlock) before you hand the tablet over.', 5000);
  }
  $effect(() => { const f = () => looksOnly(); window.addEventListener('luxdmx-looks-page', f); return () => window.removeEventListener('luxdmx-looks-page', f); });
  function newPage() {
    const p = { id: newId('pg'), name: `Page ${app.ownPages().length + 1}`, widgets: [] };
    app.show.pages.push(p);
    app.page = p.id;
    app.editPage = true;
  }
  function pageMenu(e: MouseEvent, id: string) {
    const p = pages.find((x) => x.id === id)!;
    ui.openMenu(e, [
      { label: 'Rename', icon: 'edit', run: async () => { const n = await ui.ask('Rename the page', p.name); if (n) { app.ownPages(); const q = app.show.pages.find((x) => x.id === id); if (q) q.name = n; app.markDirty(0); } } },
      { label: 'Duplicate', icon: 'duplicate', run: () => { app.ownPages(); const q = app.show.pages.find((x) => x.id === id)!; const c = { ...JSON.parse(JSON.stringify(q)), id: newId('pg'), name: `${q.name} (copy)`, locked: false }; c.widgets.forEach((w: Widget) => (w.id = newId('w'))); app.show.pages.push(c); app.page = c.id; } },
      { label: fresh.length ? `Add what's new from the show (${fresh.length})` : "Nothing new in the show for it", icon: 'plus', disabled: !fresh.length, run: addNew },
      { label: 'Rebuild from the show…', icon: 'update', disabled: !app.show.pages.length, run: async () => {
        if (!(await ui.confirm('Rebuild the pages?', 'Your pages are replaced by one built from the show (your own buttons, keys and MIDI go). Undo brings them back.', 'Rebuild', false))) return;
        const lock = app.show.pages.some((x) => x.locked);
        app.checkpoint(); app.show.pages = []; app.page = ''; app.editPage = false;
        if (lock) app.ownPages()[0].locked = true;                  // a locked show stays locked
        app.markDirty(0); app.toastUndo('Pages rebuilt from the show');
      } },
      { sep: true },
      { label: 'Delete page', icon: 'trash', danger: true, disabled: app.show.pages.length < 2, run: () => { app.show.pages = app.show.pages.filter((x) => x.id !== id); app.page = ''; } },
    ]);
  }
  function drop(e: DragEvent, target: string) {
    e.preventDefault();
    if (drag) moveTo(drag, target);
    drag = null; dropAt = null;
  }
  // a control goes where `target` is (the ones from there on move up one)
  function moveTo(id: string, target: string) {
    app.ownPages();
    const p = app.show.pages.find((x) => x.id === page.id);
    if (!p || id === target) return;
    const w = p.widgets.find((x) => x.id === id), rest = p.widgets.filter((x) => x.id !== id), at = rest.findIndex((x) => x.id === target);
    if (!w || at < 0) return;
    app.checkpoint();
    const from = p.widgets.indexOf(w);
    rest.splice(from <= at ? at + 1 : at, 0, w);
    p.widgets = rest;
    app.markDirty(0);
  }
  // one place earlier or later (the menu, Alt+arrows); the focus stays on it
  function moveBy(id: string, by: number) {
    app.ownPages();
    const p = app.show.pages.find((x) => x.id === page.id);
    const i = p?.widgets.findIndex((x) => x.id === id) ?? -1, j = i + by;
    if (!p || i < 0 || j < 0 || j >= p.widgets.length) return;
    app.checkpoint();
    const list = [...p.widgets];
    [list[i], list[j]] = [list[j], list[i]];
    p.widgets = list;
    app.markDirty(0);
    queueMicrotask(() => document.querySelector<HTMLElement>(`.live .grid [data-widget="${CSS.escape(id)}"]`)?.focus());
  }
  // A finger moves a control by its grip (touch screens send no drag and drop): over another
  // control, it goes there when let go.
  function gridGrip(e: PointerEvent, id: string) {
    if (e.pointerType === 'mouse') return;               // the mouse drags the control itself
    e.preventDefault(); e.stopPropagation();
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);
    drag = id;
    const move = (ev: PointerEvent) => {
      const cell = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('.live .grid .cell[data-w]');
      dropAt = cell && cell.dataset.w !== id ? cell.dataset.w! : null;
    };
    const end = (ok: boolean) => () => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', cancel);
      if (ok && dropAt) moveTo(id, dropAt);
      drag = null; dropAt = null;
    };
    const up = end(true), cancel = end(false);
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', cancel);
  }
  // Keyboard: a widget's key presses it (held keys hold flash and fog), Space is GO.
  function keydown(e: KeyboardEvent) {
    if (app.view !== 'live' || app.editPage || dialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'Enter' && (e.target as HTMLElement).closest?.('.tile')) return;   // Enter presses the focused button
    if (e.code === 'Space') {
      if (!spaceIsGo(e)) { if (e.repeat) e.preventDefault(); return; }
      e.preventDefault();
      const l = app.liveList;
      if (l && page?.go !== false) app.go(l.id);                    // (a staff page of looks: tapped, not stepped through)
      return;
    }
    const w = page?.widgets.find((x) => x.key && x.key.toLowerCase() === e.key.toLowerCase());
    // B is blackout (the button on the GO bar), unless a button of this page took B for itself
    if (!w && e.key.toLowerCase() === 'b' && !e.repeat) {
      e.preventDefault();
      if (app.locked && !app.blackout) { ui.toast('Locked for the show: hold the Blackout button to black out', 3000); return; }
      app.blackout = !app.blackout; return;
    }
    if (!w || e.repeat) return;
    e.preventDefault();
    held.set(e.code, $state.snapshot(w) as Widget);   // by key position (Shift can't change it on the way up); a copy, so an edit meanwhile still lets go
    app.fireWidget(w, true);
  }
  function keyup(e: KeyboardEvent) {
    const w = held.get(e.code);
    if (w) { held.delete(e.code); app.fireWidget(w, false); }
  }
  let winW = $state(typeof window === 'undefined' ? 1200 : window.innerWidth);
  const narrow = $derived(winW <= 560);
  // The timeline is playing towards a machine moment (confetti, flames, sparks, CO2) while they're
  // safe: said a minute and a half before it comes, so it isn't a surprise that nothing fires (or
  // there's time to arm them)
  const MACHINE_WORD: Record<string, string> = { confetti: 'Confetti', flame: 'Flames', sparks: 'Sparks', co2: 'CO2' };
  const shotAhead = $derived.by(() => {
    const tl = app.show.timeline, now = songAt;
    if (!tl || !app.timeline.playing || app.sfxArmed || app.output !== 'live') return undefined;
    let best: { at: number; what: string } | undefined;
    for (const i of tl.items) {
      if (i.at <= now || i.at - now > 90 || (best && i.at >= best.at)) continue;
      const d = i.do;
      if (d.do === 'burst') { if (isGated(d.attr)) best = { at: i.at, what: MACHINE_WORD[d.attr] ?? d.attr }; continue; }
      if (d.do === 'effect') continue;
      if (!('list' in d)) continue;
      const r = actionRisk(app.show, d);
      if (r === 'once' || r === 'hazard') {
        const l = app.show.cueLists.find((x) => x.id === d.list), c = d.do === 'goto' ? l?.cues.find((x) => x.id === d.cue) : undefined;
        best = { at: i.at, what: c?.name ?? l?.name ?? 'A machine' };
      }
    }
    return best;
  });
  const hazeOnly = $derived(app.hazing.every((id) => app.modeOf(id)?.channels.some((c) => c.attr === 'haze')));   // hazers: say haze
  // the timetable's next change, looked at twice a minute
  let nowMs = $state(Date.now());
  $effect(() => { const t = setInterval(() => (nowMs = Date.now()), 5000); return () => clearInterval(t); });
  // (paused: the first after the pause; off: none, the chip says it's off)
  const schedOff = $derived(!!app.show.settings.scheduleOff && !!app.show.settings.schedule?.length);
  const pausedTill = $derived((void nowMs, app.schedulePausedUntil));
  const upcoming = $derived(app.show.settings.schedule?.length && !schedOff ? nextUp(app.show.settings.schedule, new Date(Math.max(nowMs, pausedTill)), app.place) : undefined);
  const upAt = $derived(upcoming ? `${String(upcoming.when.getHours()).padStart(2, '0')}:${String(upcoming.when.getMinutes()).padStart(2, '0')}` : '');
  const touchy = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  function pageExtras(e: MouseEvent) {
    ui.openMenu(e, [
      ...(midiSupported() ? [{ label: midiOn ? `MIDI: ${midiNames[0] ?? 'nothing plugged in'}` : 'Use a MIDI controller', icon: 'live', disabled: midiOn, run: midi }] : []),
      { label: showStage ? 'Hide the stage' : 'Show the stage', icon: 'eye', run: () => (showStage = !showStage) },
      { label: app.remote.on ? `Phone as a remote (${app.remote.phones} connected)` : 'Phone as a remote…', icon: 'phone', run: () => (ui.modal = 'remote') },
      { label: 'Timetable (looks by the clock)…', icon: 'clock', run: () => (ui.modal = 'schedule') },
      ...(app.show.timeline ? [{ label: app.timeline.soundHere ? 'No sound here (the band plays live)' : 'Sound here again', icon: 'music', run: soundHere }] : []),
      ...(!app.locked ? [{ label: 'New page with just the looks (for staff)', icon: 'plus', run: looksOnly },
        { label: app.show.settings.lockPin ? 'Lock with the PIN…' : 'Lock with a PIN…', icon: 'lock', run: pinLock }] : []),
      { label: 'Full screen', icon: 'live', run: full },
      { label: 'How live pages work', icon: 'help', run: () => (ui.modal = 'guide') },
    ]);
  }
  function full() {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {});
  }
  // the song out of this device's speakers, or not (kept in this browser)
  function soundHere() {
    const on = !app.timeline.soundHere;
    app.timeline.setSoundHere(on);
    ui.toast(on ? 'Sound here: the song plays out of this device again' : "No sound here: the song's clock runs on silently, the lights follow it (a video of the 3D stage still gets the song). This browser remembers it.", 5000);
  }
  // Del removes the selected control while editing.
  function editKeys(e: KeyboardEvent) {
    if (app.view !== 'live' || !app.editPage || !selW || dialogOpen()) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeW(selW); }
  }
</script>

<svelte:window bind:innerWidth={winW} onkeydown={(e) => { keydown(e); editKeys(e); }} onkeyup={keyup} onblur={() => { for (const w of held.values()) app.fireWidget(w, false); held.clear(); }} />

<div class="live">
  <div class="bar row" class:unlocking={unlockAt > 0} style="--hold:{HOLD_MS}ms">
    <div class="pages" role="tablist" aria-label="Pages" use:tablist>
      {#each tabs as p (p.id)}
        <button role="tab" aria-selected={p.id === page?.id} class:cur={p.id === page?.id} onclick={() => { app.page = p.id; selW = null; }} oncontextmenu={(e) => { if (app.locked) e.preventDefault(); else pageMenu(e, p.id); }}
                ondblclick={async () => { if (app.locked) return; const n = await ui.ask('Rename the page', p.name); if (n) { app.ownPages(); const q = app.show.pages.find((x) => x.id === p.id); if (q) q.name = n; app.markDirty(0); } }} title="Double-click to rename, right-click for more">
          {#if p.locked}<Icon name="lock" size={12} />{/if}{p.name}</button>
      {/each}
    </div>
    {#if !app.locked}<button class="ghost" onclick={newPage} title="New page (right-click: one with just the looks)" aria-label="New page"
      oncontextmenu={(e) => { e.preventDefault(); ui.openMenu(e, [{ label: 'Empty page', icon: 'plus', run: newPage }, { label: 'Just the looks (for staff)', icon: 'plus', run: looksOnly }]); }}><Icon name="plus" /></button>{/if}
    <span class="grow"></span>
    {#if app.output === 'blind' && app.bridges.length}
      <!-- blind: said here too (on a phone the top bar only has a dot), one tap asks to go on stage -->
      <button class="chip nextup blind" onclick={() => void app.askOnStage()} title="Blind: you see it here, the lights don't get it. Click to send it to the stage.">
        <span class="bdot"></span>Blind{#if !narrow}: only here{/if}</button>
    {/if}
    {#if shotAhead}
      <!-- a machine moment coming while they're safe -->
      <span class="chip nextup shot" title="It won't fire: the machines are safe. Hold Arm (top right) if it should.">
        <Icon name="warn" size={14} />{shotAhead.what} at {clockOf(shotAhead.at, false)} · safe</span>
    {/if}
    {#if app.show.timeline?.items.length}
      <!-- the song show (Timeline): play and pause it from here too -->
      <button class="chip nextup song" class:on={app.timeline.playing} onclick={() => app.timeline.toggle()} aria-label={app.timeline.playing ? 'Pause the timeline' : 'Play the timeline'}
        title="The timeline: {app.timeline.playing ? 'pause' : 'play'} the song and what's on it">
        <Icon name={app.timeline.playing ? 'stop' : 'play'} size={14} />{clockOf(songAt, false)}{#if !narrow}<span class="faint">&nbsp;/ {clockOf(app.timeline.duration, false)}</span>{/if}</button>
    {/if}
    {#if app.show.timeline}
      <!-- the band plays live: no sound out of this device (the song's clock runs on) -->
      <button class="chip nextup sound" class:off={!app.timeline.soundHere} aria-pressed={app.timeline.soundHere} onclick={soundHere}
        title={app.timeline.soundHere ? "The song plays out of this device. Click for no sound here (the band plays live): the song's clock runs on" : 'No sound here: the song runs silently (a video of the 3D stage still gets it). Click for sound here'}>
        <Icon name="music" size={14} /><span class:sr-only={narrow}>Sound here</span></button>
    {/if}
    {#if fresh.length && !app.editPage}
      <!-- the page is behind the show (a look or an effect made since): said, one tap adds them -->
      <button class="chip nextup fresh" onclick={addNew} title="New in the show since this page was made: {freshNames}. Click to add them here (Undo takes them back)">
        <Icon name="plus" size={14} />{narrow ? fresh.length : `${fresh.length} new in the show`}</button>
    {/if}
    {#if schedOff || pausedTill}
      <!-- the timetable switched off or paused (a party tonight): said, so nobody wonders why 18:00 didn't come -->
      <button class="chip nextup paused" onclick={() => (ui.modal = 'schedule')} oncontextmenu={(e) => { e.preventDefault(); if (!app.locked) ui.openMenu(e, pauseItems()); }}
        title={schedOff ? 'The timetable is off (right-click to switch it on)' : `The timetable is paused until ${hhmm(pausedTill)} (right-click to play it again)`}>
        <Icon name="clock" size={14} />{schedOff ? 'Timetable off' : `Paused till ${hhmm(pausedTill)}`}</button>
    {:else if upcoming}
      <!-- the timetable's next change, said in clock time (a bar's 21:00, not "14400 s") -->
      <button class="chip nextup" onclick={() => (ui.modal = 'schedule')} oncontextmenu={(e) => { e.preventDefault(); if (!app.locked) ui.openMenu(e, pauseItems()); }} title="The timetable, next: {upAt}{upcoming.entry.sun ? ` (${upcoming.entry.sun === 'set' ? 'sunset' : 'sunrise'})` : ''} {actionText(app.show, upcoming.entry.do)} (right-click to pause it)">
        <Icon name="clock" size={14} />{#if narrow}{upAt}{:else}{actionShort(app.show, upcoming.entry.do)} · {inWords(upcoming.when, new Date(nowMs)).replace(/^at /, '')}{/if}</button>
    {/if}
    {#if app.hazing.length}
      <span class="chip haze" title="A fog or haze machine is running from a cue">
        <Icon name="fog" size={14} />{#if !narrow}<span>{app.hazing.length > 1 ? `${app.hazing.length} fog machines on` : hazeOnly ? 'Haze on' : 'Fog on'}</span>{/if}
        <button class="stop" onclick={() => { app.stopHaze(); ui.toast(`${hazeOnly ? 'Haze' : 'Fog'} stopped until the next cue that fogs.`, 4000); }}
          aria-label={hazeOnly ? 'Stop the haze' : 'Stop the fog'}>Stop</button></span>
    {/if}
    {#if narrow}
      {#if app.remote.on}<span class="chip" class:green={app.remote.phones > 0} title={app.remote.phones ? 'Phones playing this show' : 'The phone remote is on; no phone is connected yet'}>{app.remote.phones} <Icon name="phone" size={14} /><span class="sr-only">phone{app.remote.phones === 1 ? '' : 's'} connected</span></span>{/if}
      <!-- a phone: the extras in one menu, so the padlock and Edit / Done always fit -->
      <button class="ghost" onclick={pageExtras} aria-label="More for this page" title="More"><Icon name="more" /></button>
    {:else}
    <Help label="About live pages">
      <p><b>Live</b> is for playing the show: big buttons that work with a mouse, a touch screen or the keyboard (the small letter on a button is its key, Space is GO).</p>
      <p>The first page is built from your show. Press <b>Edit</b> to make it your own: add buttons for cue lists (GO, on/off, flash, solo), single scenes, effects, faders and fog; drag to rearrange; more pages for more songs.</p>
      <p>Fog only runs while you hold it, and never longer than its maximum.</p>
      <p>Songs on the Timeline (a set list): Play, Next song and Next part come first (keys <b>,</b> <b>.</b> <b>-</b>, or a MIDI pedal). Next song never darkens the stage; Sound here switches the song off on this device when the band plays live.</p>
    </Help>
    {#if midiSupported() && !app.locked}
      {#if midiOn}<span class="chip" class:green={midiNames.length > 0} title={midiNames.join(', ') || 'No MIDI controller plugged in'}>MIDI · {midiNames.length ? midiNames[0] : 'nothing plugged in'}</span>
      {:else}<button class="ghost" onclick={midi} title="Use a MIDI controller (pads, faders) with this page">MIDI</button>{/if}
    {/if}
    <button class="ghost" class:on={app.remote.on} onclick={() => (ui.modal = 'remote')} title="Play this show from a phone" aria-label="Phone as a remote"><Icon name="phone" /><span>{app.remote.on ? `Phone · ${app.remote.phones}` : 'Phone'}</span></button>
    {#if touchy}<button class="ghost" onclick={pageExtras} aria-label="More for this page" title="More: lock with a PIN, a page of just the looks, the timetable"><Icon name="more" /></button>{/if}
    {#if !app.locked}
    <label class="zoom" title="Button size"><Icon name="search" size={14} /><input type="range" min="96" max="220" step="2" bind:value={tile} aria-label="Button size" /></label>
    <button class="ghost" class:on={showStage} onclick={() => (showStage = !showStage)} title={showStage ? 'Hide the stage' : 'Show the stage'} aria-label="Show the stage" aria-pressed={showStage}><Icon name="eye" /><span>Stage</span></button>
    {/if}
    {/if}
    {#if page}
      <!-- Locking is one click; unlocking takes holding the padlock for a second (so a stray tap
           during the service can't do it). -->
      <button class="ghost lockbtn" class:holding={unlockAt > 0} style="--hold:{HOLD_MS}ms"
              onclick={(e) => { if (justUnlocked) { justUnlocked = false; return; } if (!page.locked) setLocked(true, e.detail === 0); else if (!unlockAt) ui.toast('Hold the padlock for a second to unlock', 2500); }}
              onpointerdown={() => { justUnlocked = false; if (page.locked) startUnlock(); }} onpointerup={stopUnlock} onpointerleave={stopUnlock} onpointercancel={stopUnlock}
              onkeydown={(e) => { if (page.locked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) startUnlock(false); } }} onkeyup={stopUnlock}
              oncontextmenu={(e) => { e.preventDefault(); if (!page.locked) ui.openMenu(e, [{ label: 'Lock', icon: 'lock', run: () => setLocked(true) }, { label: app.show.settings.lockPin ? 'Lock with the PIN…' : 'Lock with a PIN…', icon: 'lock', run: pinLock }]); }}
              title={page.locked ? 'Locked for the show: hold to unlock' : 'Lock the page for the show: only playing, no editing (right-click: with a PIN)'} aria-label={page.locked ? 'Unlock page (hold)' : 'Lock page'}>
        <Icon name={page.locked ? 'lock' : 'unlock'} /></button>
    {/if}
    {#if !narrow}<button class="ghost" onclick={full} title="Full screen" aria-label="Full screen"><Icon name="live" /></button>{/if}
    {#if app.editPage}<button onclick={addMenu} aria-label="Add"><Icon name="plus" />{#if !narrow}Add{/if}</button>{/if}
    {#if !app.locked}<button class:on={app.editPage} onclick={edit}><Icon name="edit" />{app.editPage ? 'Done' : 'Edit'}</button>{/if}
  </div>

  {#if built}<GoStrip />{/if}
  <!-- Changes made in Program that weren't recorded sit on top of everything: say so, one tap clears. -->
  {#if progHeld > 0}
    <div class="held" role="status">
      <Icon name="edit" size={16} />
      <span><b>{progHeld} light{progHeld > 1 ? 's' : ''}</b> you changed in Program {progHeld > 1 ? 'override' : 'overrides'} the show here. Not recorded yet.</span>
      {#if !app.locked}<button onclick={() => { const l = app.liveList; ui.toast(app.record(l?.id) ? `Recorded into ${l?.name ?? app.list?.name ?? 'the cue list'}` : 'Nothing to record'); }}>Record</button>{/if}
      <button onclick={() => { app.checkpoint(); const keep = $state.snapshot(app.programmer); app.clearProgrammer(); ui.toast('The show has its lights back', 4000, { label: 'Undo', run: () => (app.programmer = keep) }); }}>Clear</button>
    </div>
  {/if}

  <div class="body" class:with-stage={showStage} class:editing={app.editPage}>
    {#if showStage}<div class="stagebox">{#if shown || ui.stage3d}<StageView compact readonly blindChip={false} />{/if}</div>{/if}
    <div class="grid" style="--tile:{tile}px" role="list">
      {#each built ? (page?.widgets ?? []) : [] as w (w.id)}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Alt+arrows come from the control inside it) -->
        <div class="cell" class:wide={w.size === 2} class:full={w.type === 'label' || w.type === 'cuelist'} class:drop={dropAt === w.id} class:dragging={drag === w.id} role="listitem" data-w={w.id}
             draggable={app.editPage} ondragstart={() => (drag = w.id)} ondragover={(e) => { if (drag) { e.preventDefault(); dropAt = w.id; } }}
             ondrop={(e) => drop(e, w.id)} ondragend={() => { drag = null; dropAt = null; }}
             onkeydown={(e) => { if (app.editPage && e.altKey && /^Arrow/.test(e.key)) { e.preventDefault(); moveBy(w.id, e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1); } }}>
          <WidgetTile {w} {manyLists} editing={app.editPage} selected={selW === w.id} onselect={(e) => pick(w.id, e)} onmenu={(e) => tileMenu(e, w)} />
          {#if app.editPage}<span class="grip" onpointerdown={(e) => gridGrip(e, w.id)} aria-hidden="true" title="Drag to move"><Icon name="grip" size={14} /></span>{/if}
        </div>
      {/each}
      {#if built && !page?.widgets.length}
        <div class="empty">This page is empty. {app.editPage ? 'Add controls with the Add button.' : 'Press Edit to add buttons and faders.'}</div>
      {/if}
    </div>
    {#if app.editPage && shown}
      <!-- Floats over the page (the buttons don't move), on the side away from the one being changed. -->
      <div class="float" class:left={editLeft}>
        {#if selected}
          {#key selected.id}<WidgetEditor page={page.id} id={selected.id} onremove={() => removeW(selected.id)} onclose={closeEditor} />{/key}
        {:else}
          {#if fresh.length}<aside class="hint pick">New in the show, not on a page yet: {freshNames}. <button class="ghost" onclick={addNew}>Add them here</button></aside>{/if}
          <aside class="hint pick">{#if touchy}Tap a control to change it, drag its <Icon name="grip" size={12} /> to move it{:else}Click a control to change it, drag to move it (or Alt+arrows){/if}, <b>Add</b> for new ones.</aside>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .live { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: .55rem; gap: .5rem; }
  @media (max-height: 420px) {
    .live { flex: none; }
    .body { flex: none; min-height: max(12rem, 75vh); }
    .grid { overflow: visible; }
  }
  .bar { flex-wrap: wrap; }
  .pages { display: flex; gap: .25rem; flex-wrap: wrap; }
  .pages button { border-radius: 999px; padding: .25rem .8rem; }
  .pages button.cur { border-color: var(--green); background: #45d85c14; }
  .zoom { display: inline-flex; align-items: center; gap: .3rem; color: var(--muted); } .zoom input { width: 90px; }
  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr; gap: .6rem; position: relative; }
  .body.with-stage { grid-template-columns: minmax(260px, 34%) 1fr; }
  .float { position: absolute; top: 0; right: 0; z-index: 20; max-height: 100%; overflow: auto; border-radius: var(--radius);
    box-shadow: 0 10px 40px #000a, 0 0 0 1px var(--line2); background: var(--panel); }
  .float.left { right: auto; left: 0; }
  .float .pick { margin: 0; border: 0; max-width: 240px; }
  .stagebox { min-height: 0; display: flex; align-self: start; height: min(62vh, 460px); }
  .pick { align-self: start; padding: .8rem; border: 1px dashed var(--line2); border-radius: var(--radius); }
  .grid { min-height: 0; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--tile), 1fr)); gap: .5rem; align-content: start; padding: 2px; }
  .cell { display: grid; position: relative; }
  .cell.wide { grid-column: span 2; }
  .cell.full { grid-column: 1 / -1; }
  .cell.drop { box-shadow: -4px 0 0 var(--accent); border-radius: 12px; }
  .cell.dragging { opacity: .5; }
  /* a finger's handle in Edit (the tile itself still taps to change it) */
  .grip { position: absolute; top: 2px; right: 2px; width: 34px; height: 34px; display: grid; place-items: center; touch-action: none; cursor: grab;
    color: var(--muted); border-radius: 8px; background: #0b0f15aa; z-index: 1; }
  @media (pointer: fine) { .grip { display: none; } }
  .cell :global(.tile) { min-height: calc(var(--tile) * .72); }
  .empty { grid-column: 1 / -1; color: var(--muted); padding: 2rem; text-align: center; border: 1px dashed var(--line2); border-radius: var(--radius); }
  /* phones: the controls above the buttons in one row that scrolls sideways, no button-size slider */
  @media (max-width: 700px) {
    .bar { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
    .bar > :global(*) { flex: none; }             /* nothing squeezed under its neighbour */
    .pages { flex-wrap: nowrap; }
    .bar .zoom { display: none; }
    /* the bar scrolls: the hold-to-unlock line goes along the top of the screen instead */
    .bar.unlocking::after { position: fixed; top: 0; bottom: auto; z-index: 50; }
  }
  @media (max-width: 900px) {
    .body, .body.with-stage { grid-template-columns: 1fr; grid-auto-rows: auto; overflow: auto; }
    /* phones: the editor is a sheet at the bottom */
    .float, .float.left { position: fixed; left: .4rem; right: .4rem; top: auto; bottom: .4rem; max-height: 55vh; }
    .stagebox { height: 220px; align-self: stretch; }
    .grid { overflow: visible; }
  }
  .lockbtn { position: relative; overflow: hidden; }
  /* holding the padlock: a bar fills across the whole header, so a thumb on the button still sees it */
  .bar { position: relative; }
  .bar.unlocking::after { content: ''; position: absolute; left: 0; right: 0; bottom: -4px; height: 3px; background: var(--orange); transform-origin: left; animation: hold var(--hold) linear forwards; }
  .lockbtn.holding::after { content: ''; position: absolute; left: 0; bottom: 0; height: 3px; width: 100%; background: var(--orange); transform-origin: left; animation: hold var(--hold) linear forwards; }
  @keyframes hold { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  .held { display: flex; align-items: center; gap: .6rem; padding: .45rem .7rem; border-radius: var(--radius); border: 1px solid #ffaa1c66; background: #ffaa1c14; color: var(--text); font-size: .9rem; }
  .held span { flex: 1; min-width: 0; }
  /* sized like the buttons next to them */
  .chip.haze, .chip.nextup { font-size: .85rem; min-height: 29px; padding: .2rem .7rem; border-radius: 999px; display: inline-flex; gap: .35rem; align-items: center; background: none; }
  .chip.haze { border: 1px solid var(--orange); color: var(--orange); padding-right: .25rem; }
  .chip.haze .stop { min-height: 0; padding: .1rem .55rem; border-radius: 999px; border: 0; border-left: 1px solid #ffaa1c66; background: #ffaa1c1f; color: var(--orange); font-weight: 650; font-size: .8rem; }
  .chip.nextup { border: 1px solid var(--line2); color: var(--muted); }
  .chip.nextup.paused { border-style: dashed; }
  .chip.nextup.song { font-variant-numeric: tabular-nums; } .chip.nextup.song.on { color: var(--green); border-color: #45d85c66; }
  .chip.nextup.sound[aria-pressed='true'] { color: var(--text); }
  .chip.nextup.sound.off { border-style: dashed; text-decoration: line-through; }
  .chip.nextup.fresh { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
  .chip.nextup.blind { color: #9fc0ff; border-color: #6aa2ff66; }
  .chip.nextup.shot { color: var(--orange); border-color: color-mix(in srgb, var(--orange) 45%, transparent); }
  .bdot { width: .55rem; height: .55rem; border-radius: 50%; background: #5b6676; box-shadow: inset 0 0 0 1px #0006; }
  /* fingers: the Stop and the next-up chip as big as the buttons next to them */
  @media (pointer: coarse) { .chip.haze, .chip.nextup { min-height: 38px; } .chip.haze { padding-top: 0; padding-bottom: 0; } .chip.haze .stop { min-height: 38px; padding: .2rem .9rem; } }
</style>
