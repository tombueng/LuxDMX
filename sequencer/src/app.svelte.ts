// App state: the show, the engine, undo, devices, and the 40 Hz output loop.
//
// Record stores the fixtures you touched (the programmer), each with its full current look.
// Fixtures you didn't touch stay out of the cue, so playing it leaves them alone: that's what
// lets a fog timer or a house-light list run next to the show without being recorded into it.
import { emptyShow, parseShow, serializeShow, FormatError } from './model/format';
import { GENERIC, caps, capsOf, isFogTimer, isLooks, isPlay, kindOf, modeOf, typeMap, type FixtureKind } from './model/library';
import type { Color, Cue, CueList, Effect, Fixture, FixtureType, Page, Preset, PresetKind, Resolved, Show, Values, Widget } from './model/types';
import { EFFECT_MAP, hsv, paramsOf } from './engine/effects';
import { pictureOf } from './engine/custom';
import { isGated } from './model/safety';
import { addStandardPresets } from './content/presets';
import { buskingPage, isMachineList } from './content/busking';
import { fromQxw, type QxwReport } from './import/qxw';
import { toQxw } from './export/qxw';
import { cueSheetCsv, cueSheetHtml } from './export/cuesheet';
import { patchSheetHtml } from './export/patchsheet';
import { pictureColors } from './content/pictureColors';
import { starterLooks } from './content/looks';
import { findQlc } from './library/catalog';
import { onMidi, onMidiInputs, sameBinding, type MidiMsg } from './input/midi';
import { describeChange } from './model/diff';
import { cueNumber, numbersFor, renumber } from './model/cuenum';
import { current, passed, validEntry, whenSaid, type ScheduleEntry } from './model/schedule';
import { guessPlace, type Place } from './model/sun';
import { actionText } from './model/actions';
import { cctColor, fitLook, whiteTemperature } from './engine/render';
import { MusicListener, type MusicState } from './input/audio';
import { listShows, readShow, writeShow, deleteShow as dbDelete, listMyTypes, saveMyType, deleteMyType, setOnBlocked, type ShowMeta } from './store/shows';
import { ui } from './ui/ui.svelte';
import { copyClip, readClip } from './store/clipboard';
import { prune, prunedText } from './model/prune';
import { stageSvg } from './ui/thumb';
import { cueLooks } from './engine/cuelook';
import { untrack } from 'svelte';
import { Engine, LIGHT } from './engine/engine';
import { load } from './perf/load.svelte';
import { ATMOS_AND_MACHINES as ATMOS, machinesSafe, zeroedFrames } from './output/safe';
import { OutputThread } from './output/host.svelte';
import type { PlayerStatus } from './engine/player';
import { Bridge, listen } from './output/bridge';
import { LINK, LinkOutput } from './output/link';
import { RemoteHost } from './remote/host.svelte';
import { TimelinePlayer } from './timeline/player.svelte';
import type { BurstAttr, TimelineAction, TimelineItem } from './model/timeline';
import { firstLook, pickSong, songIndex, songName, songsOf, stateAt } from './model/timeline';

const KEY = 'luxdmx.seq.show';
const CUR = 'luxdmx.seq.current';   // id of the show that's open
const FPS = 40;
const UNDO_DEPTH = 100;
const UNDO_BYTES = 30_000_000;      // and never more than this much text in the undo history
const UNDO_KEY = 'luxdmx.seq.undo';
const PLAYBACK_KEY = 'luxdmx.seq.playing';
const RESUME_WITHIN = 60_000;       // ms: a reload, not a tab restored hours later
const OUTPUT_KEY = 'luxdmx.seq.output';  // 'live' or 'blind': this tab (session), or a locked show's browser
// runs after the current task and the screen updates it caused (a message to ourselves)
const pingAfter = (() => {
  if (typeof MessageChannel === 'undefined') return (f: () => void) => setTimeout(f, 0);
  const ch = new MessageChannel(), todo: (() => void)[] = [];
  ch.port1.onmessage = () => todo.shift()?.();
  return (f: () => void) => { todo.push(f); ch.port2.postMessage(0); };
})();
const WAS_ARMED_KEY = 'luxdmx.seq.wasArmed';   // this tab had the machines armed (a reload says they're safe now)
const ATMOS_AND_MACHINES = ATMOS;
const MACHINES_SAFE = machinesSafe;
const LASTPLAY_KEY = 'luxdmx.seq.lastplay.';   // + show id: what was playing, for a cold start
const hasLocks = () => typeof navigator !== 'undefined' && !!(navigator as unknown as { locks?: LockManager }).locks?.request;
const COLD_WITHIN = 3 * 3600_000;   // ms: a tablet restarted during the evening, not the next morning (the box may have been off)
export const GO_GUARD_MS = 300;     // a second GO this soon on the same list is a double press (a beat at 200 BPM still gets through)
const GROUP_FLASH_MAX = 30;         // seconds a held flash button stays on at most
export const MAX_FOG = 60;          // and a fog button, whatever its own maximum says
// A fog timer's pause is at least this long, and at least as long as its burst (machines reheat).
export const fogPause = (minutes: number, seconds: number) => Math.max(minutes * 60 - seconds, 15, seconds);
// A box every show without one gets (local setups: VITE_DEFAULT_DEVICE in .env.local).
const DEFAULT_DEVICE = (import.meta.env.VITE_DEFAULT_DEVICE as string | undefined)?.trim() || '';

// Fixture types are big (a pro moving head is hundreds of channel ranges) and never edited in
// place (the editor works on a copy and saves a new object). Giving them their own prototype keeps
// Svelte from wrapping them in proxies, so reading them (every frame, every save) costs nothing.
const RawType = Object.create(Object.prototype);
export function rawType<T extends object>(t: T): T { return Object.getPrototypeOf(t) === RawType ? t : Object.setPrototypeOf(t, RawType); }
export function rawTypes(s: Show): Show { s.fixtureTypes = s.fixtureTypes.map(rawType); return s; }

let seq = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

// The show that was open last time. IndexedDB is the real store (see init()); the copy in
// localStorage only gets the screen up straight away, and only when it belongs to the show that
// was open (it carries that show's id). One this version can't read (made by a newer version, or
// damaged) is left exactly where it is, and the app starts a new show next to it instead of
// saving over it.
const KEY_ID = 'luxdmx.seq.show.id';
let loadError = '';
let fromLocal = false;
function loadShow(): Show {
  let text: string | null = null;
  try {
    const cur = localStorage.getItem(CUR), owner = localStorage.getItem(KEY_ID);
    if (!owner || owner === cur) text = localStorage.getItem(KEY) ?? localStorage.getItem('luxdmx.seq.show.v1');
  } catch { /* storage blocked */ }
  if (text) {
    try { const s = parseShow(text); fromLocal = true; return s; } catch (e) {
      loadError = `The show that was open can't be opened by this version (${(e as Error).message}). It's still saved; this is a new show.`;
      try { localStorage.setItem(`${KEY}.unreadable`, text); localStorage.removeItem(CUR); } catch { /* keep going */ }
    }
  }
  const s = emptyShow();
  addStandardPresets(s);
  return s;
}
const storedId = () => { try { return loadError ? null : localStorage.getItem(CUR); } catch { return null; } };

class App {
  show = $state<Show>(rawTypes(loadShow()));
  showId = $state(storedId() ?? newId('s'));
  shows = $state<ShowMeta[]>([]);              // everything saved in this browser
  saved = $state(true);                        // the open show is in the browser's storage
  view = $state<'program' | 'live' | 'timeline'>('program');
  sideTab = $state<'fixtures' | 'groups' | 'presets' | 'effects'>('fixtures');
  cueSel = $state<string[]>([]);               // selected cues (in the current list)
  // What each fixture is (icon, how the stage draws it).
  kinds = $derived.by(() => {
    const k: Record<string, FixtureKind> = {};
    for (const f of this.show.fixtures) k[f.id] = kindOf(this.modes.get(f.id));
    return k;
  });
  // Every fixture type by id, and every fixture's mode by fixture id (rebuilt when they change).
  types = $derived(typeMap(this.show));
  modes = $derived(new Map(this.show.fixtures.map((f) => [f.id, modeOf(this.types.get(f.typeId), f.mode)])));
  selected = $state<string[]>([]);
  programmer = $state<Record<string, Values>>({});
  currentList = $state<string>('');
  // Replaced every frame: no deep proxies.
  stage = $state.raw<Record<string, Resolved>>({});
  // the same, every frame and not reactive: the 3D stage reads it as it draws (its movers move as
  // smoothly as it draws, whatever the panels' update rate: perf/load.svelte.ts)
  stageNow: Record<string, Resolved> = {};
  look = $state.raw<Record<string, Resolved>>({});     // before grand master / blackout
  frames = $state.raw<Map<number, Uint8Array>>(new Map());
  status = $state.raw<Record<string, PlayerStatus>>({});
  bridges = $state.raw<Bridge[]>([]);
  readonly remote: RemoteHost = new RemoteHost(this);     // phones playing this show (/remote on the box)
  readonly timeline: TimelinePlayer = new TimelinePlayer(this);   // the song and what's on it (Timeline)
  bridgeRev = $state(0);
  fx = $state.raw<Record<string, number>>({});        // effect id -> how strongly it runs right now
  liveFx = $state.raw<string[]>([]);                  // effects started by hand
  live = $state<Record<string, Values>>({});          // fog buttons: on top, never recorded
  fogUntil = $state.raw<Record<string, number>>({});  // fog widget id -> when it switches off (ms)
  page = $state('');                                  // live page on screen
  goList = $state('');                                // the list GO (and Space) plays in Live
  highlight = $state(false);                          // selected lights at full white, to find them in the room
  highlightSolo = $state(false);                      // ... and every other light dark (checking the patch)
  autoGo = $state(0);                                 // Live: GO by itself every this many bars (0 = off)
  private autoSkip = -1;                              // beat count before which Auto GO waits (a GO by hand just happened)
  private autoBar = -1;
  // Following the music: the tempo comes from the microphone instead of the BPM field (it isn't
  // saved into the show) and the beat clock snaps to the kicks.
  music = $state.raw<MusicState & { on: boolean }>({ on: false, bpm: 0, confidence: 0, level: 0, beat: 0 });
  private listener = new MusicListener(() => this.engine.alignBeat(), (s) => { this.music = { ...s, on: this.listener.running }; });
  editPage = $state(false);
  grandMaster = $state(1);
  // Fade out (a live button): the grand master ramps to 0, and back to where it was on the next
  // press. Moving the master by hand meanwhile ends the fade. `last`: what the fade itself set.
  gmFade = $state<{ from: number; to: number; start: number; dur: number; last: number } | null>(null);
  fadedOut = $state(false);                           // faded out and not back yet
  private gmBefore = 1;
  // Blackout belongs to the engine (cue actions switch it too); this mirrors it for the UI.
  private bo = $state(false);
  get blackout() { return this.bo; }
  set blackout(v: boolean) { this.engine.blackout = v; this.bo = v; this.thread.inputsNow(this.engine); }
  canUndo = $state(false);
  // The channel wizard drives one fixture's channels directly while you identify them. Applied on
  // top of the rendered output, never stored in the show.
  testOverlay = $state.raw<{ universe: number; address: number; values: number[] } | null>(null);
  canRedo = $state(false);

  readonly engine = new Engine(() => this.show);
  // The DMX output on a thread of its own (output/thread.ts): its frames go out on time whatever
  // this page draws. This page's engine is its mirror, for the screen.
  readonly thread = new OutputThread();
  private undoStack: string[] = [];
  private recentUnis = new Map<number, number>();   // universe -> last time something was patched/driven there
  private redoStack: string[] = [];
  private lastSnap = '';
  // A plain copy of the show, refreshed after every burst of edits (each checkpoint). Panels that
  // read the whole show (preset use counts, cue pictures) use it: reading through Svelte's
  // proxies costs ~20x more and would freeze the output with a big show.
  private rev = $state(0);
  // the show's revision: goes up with every change (what a cache of things worked out from the show keys on)
  get showRev() { return this.rev; }
  plain = $derived.by(() => { void this.rev; return untrack(() => JSON.parse(this.lastSnap || 'null')) as Show; });
  // How many cues use each preset, from the plain copy (one pass for all of them).
  presetUses = $derived.by(() => {
    const n = new Map<string, number>();
    for (const l of this.plain?.cueLists ?? []) for (const c of l.cues) {
      const seen = new Set<string>();
      for (const v of Object.values(c.values)) for (const x of Object.values(v)) { const ref = x && typeof x === 'object' && (x as { preset?: string }).preset; if (ref) seen.add(ref); }
      for (const r of seen) n.set(r, (n.get(r) ?? 0) + 1);
    }
    return n;
  });
  // What every cue of every list looks like (for pictures), from the plain copy.
  cueLooksOf = $derived.by(() => {
    const p = this.plain, m = new Map<string, Record<string, Resolved>[]>();
    if (!p) return m;
    const presets = new Map(p.presets.map((x) => [x.id, x]));
    const types = typeMap(p), capsById = new Map(p.fixtures.map((f) => [f.id, capsOf(modeOf(types.get(f.typeId), f.mode))]));
    for (const l of p.cueLists) {
      const looks = cueLooks(l, presets, isLooks(l));
      // fitted like the stage: a dimmer in a "Purple" cue looks like a dimmer on its card too
      for (const look of looks) for (const [id, v] of Object.entries(look)) { const c = capsById.get(id); if (c) fitLook(v, c, !!v.color); }
      m.set(l.id, looks);
    }
    return m;
  });
  private dirtyTimer: ReturnType<typeof setTimeout> | undefined;
  // a click or a key may have changed the show and its save hasn't run yet (markDirty(…, false))
  private savePending = false;
  private writes = 0;
  private channel: BroadcastChannel | null = null;
  readonly tabId = newId('t');
  loadError = loadError;

  constructor() {
    listen(() => this.bridges, () => this.started);
    // phones: say when one joins (a guest who scanned the code shows up here), and when one is
    // waiting for a remote that's off (this tab was closed and opened again)
    this.remote.onJoin = (p, n) => ui.toast(`${p.dev} joined the remote${n > 1 ? ` (${n} phones now)` : ''}`, 5000, { label: 'Phones', run: () => (ui.modal = 'remote') });
    this.remote.onWaiting = () => ui.toast('A phone is waiting for the remote. Switch it on?', 10000, { label: 'Switch on', run: () => this.remote.start() });
    if (DEFAULT_DEVICE && !this.show.outputs.devices.length) this.show.outputs.devices.push({ host: DEFAULT_DEVICE });
    this.bridges = this.show.outputs.devices.map((d) => this.makeBridge(d.host));
    this.currentList = this.show.cueLists[0]?.id ?? '';
    this.lastSnap = JSON.stringify(this.show);
    try { localStorage.setItem(CUR, this.showId); } catch { /* storage blocked */ }
    this.thread.start(this.engine, () => this.show);
    // (a command right after an edit in a form, a GO clicked after changing a cue's action: the
    // save that's due runs first, so the thread has the edit; a GO from the keyboard comes before
    // its key's own "maybe changed" and costs nothing)
    this.thread.beforeCommand = () => { if (this.savePending && !this.holdUndo) this.checkpoint(true); };
    this.startClock();
    onMidi((m) => this.midi(m));
    // A controller unplugged while a pad was down: what it held is let go.
    let inputs = 0;
    onMidiInputs((names) => { if (names.length < inputs) this.releaseMidi(); inputs = names.length; });
    this.refreshMyTypes();
    setOnBlocked(() => ui.toast('Another tab with an older version of the app is open: close it, so this one can save.', 10000));
    // Saving and undo: reading the whole show on every change is slow for big shows (it goes
    // through Svelte's proxies), so changes are noticed by what causes them instead: any input,
    // change, click, key or drop marks the show dirty, and a short pause later it's compared,
    // saved, and becomes an undo step. Code that changes the show on its own calls markDirty().
    // (only the save is booked: it compares, and hands a changed show to the output thread as text.
    // Telling the thread here would turn the whole show into text on every click, GO included.)
    for (const ev of ['input', 'change', 'pointerup', 'keyup', 'drop'])
      window.addEventListener(ev, () => this.markDirty(350, false), { capture: true, passive: true });
    // Closing the tab: save what's pending (the localStorage part is immediate). No "leave the
    // page?" question: a reload picks the show up where it was, the box holds the look meanwhile,
    // and fog goes to 0 first (fogSafe).
    // (and the machines made safe: a page kept in the browser's back/forward cache comes back safe)
    window.addEventListener('pagehide', () => { this.fogSafe(); this.armMachines(false, true); this.checkpoint(); this.saveUndo(true); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.saveUndo(true); });
    window.addEventListener('beforeunload', () => this.checkpoint());
    // A file dropped next to a drop target would make the browser open it and leave the show.
    window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    // ...and a show file dropped anywhere else opens it (from the other computer, a mail, a stick)
    window.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      const handled = e.defaultPrevented;
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (handled || !f || !/\.(json|luxdmx|qxw)$/i.test(f.name) || this.locked) return;
      const playing = !this.quiet;
      void (async () => {
        if (playing && !(await ui.confirm(`Open "${f.name}"?`, 'The show playing now stops (it stays in Shows).', 'Open it', false))) return;
        this.importShow(f).then(() => ui.toast(`Opened "${this.show.meta.name}" (the show you had is still in Shows)`, 5000), (x) => ui.toast((x as Error).message, 6000));
      })();
    });
    // Two tabs on the same show would overwrite each other's saves: say so.
    try {
      this.channel = new BroadcastChannel('luxdmx-sequencer');
      this.channel.onmessage = (e) => {
        if (e.data?.saved === this.showId && e.data.tab !== this.tabId) this.otherTab = true;
        // a tab starting cold asks whether this show is playing somewhere already
        if (e.data?.playing === this.showId && e.data.tab !== this.tabId && !this.quiet)
          this.channel?.postMessage({ isPlaying: this.showId, tab: this.tabId });
        if (e.data?.isPlaying === this.showId && e.data.tab !== this.tabId) this.othersPlay = true;
      };
    } catch { /* no BroadcastChannel: fine */ }
  }
  otherTab = $state(false);
  // Is what you do going to the stage? 'blind': the 2D and 3D stages show it, the boxes get nothing
  // new (they keep the look that was out, frozen, without fog and machines); 'live': everything goes
  // out. Live is kept over a reload of this tab; a new tab or browser starts blind, going live is a
  // deliberate step (the top bar says which). A show locked for the service keeps it in the
  // browser too: after a power cut its page carries on without anyone at the controls.
  output = $state<'live' | 'blind'>((() => {
    try { return sessionStorage.getItem(OUTPUT_KEY) === 'live' || localStorage.getItem(OUTPUT_KEY) === 'live' ? 'live' : 'blind'; } catch { return 'blind'; }
  })());
  private frozen: Map<number, Uint8Array> | null = null;
  private frozenDark: Map<number, Uint8Array> | null = null;   // the same with every light off (Blackout)
  private lastSent: Map<number, Uint8Array> | null = null;
  setOutput(o: 'live' | 'blind') {
    if (o === this.output) return;
    if (o === 'blind') {
      // the stage keeps the look it had, but nothing runs on by itself while what you do doesn't
      // go out: fog, haze and the machines stop (a fog burst frozen here would never end), and the
      // machines are made safe (going live again starts safe)
      this.armMachines(false);
      this.setFrozen(this.lastSent && this.zeroed(this.lastSent, (a) => ATMOS_AND_MACHINES.includes(a)));
    } else this.setFrozen(null);
    this.output = o;
    this.keepOutput();
  }
  // On stage is a deliberate step (asked once per switch); blind is one click.
  async askOnStage(): Promise<boolean> {
    if (this.output === 'live') return true;
    const n = this.bridges.length;
    const ok = await ui.confirm('Send to the stage?', `From now on what you do here goes out to ${n === 1 ? 'the box' : n ? `${n} boxes` : 'the boxes you connect'} and the lights. Blind takes it back.${this.gatedMachines.length ? ' Confetti, flames, sparks and CO2 stay safe until you arm them.' : ''}`, 'Go on stage', false);
    if (ok) this.setOutput('live');
    return ok;
  }
  goBlind() {
    if (this.output === 'blind') return;
    const machines = this.show.fixtures.some((f) => this.caps(f.id).fog || this.caps(f.id).sfx);
    this.setOutput('blind');
    ui.toast(`Blind: the stage here shows what you do, the lights keep the look they had${machines ? ' (fog, haze and the machines stop)' : ''}. Nothing new goes out.`, 6000);
  }
  private setFrozen(f: Map<number, Uint8Array> | null) { this.frozen = f; this.frozenDark = null; }
  private keepOutput() {
    try { sessionStorage.setItem(OUTPUT_KEY, this.output); } catch { /* this tab only */ }
    try {
      if (this.output === 'live' && this.show.pages.some((p) => p.locked)) localStorage.setItem(OUTPUT_KEY, 'live');
      else localStorage.removeItem(OUTPUT_KEY);
    } catch { /* this tab only */ }
  }
  // What a blind tab sends: the frozen look; with Blackout on, that look with every light off
  // (Blackout always reaches the stage).
  private blindFrames() {
    if (!this.frozen || !this.engine.blackout) return this.frozen;
    return (this.frozenDark ??= this.zeroed(this.frozen, (a) => LIGHT.has(a)));
  }
  // Machines that fire once or are dangerous (confetti, flames, sparks, CO2): 0 on the wire until a
  // person arms them (the stage still shows them). Only while live: blind, nothing would go out
  // anyway, and going live must never fire one. Never kept over a reload, a show change or going
  // blind; one that is already on when they're armed waits until it has been off (engine.ts).
  sfxArmed = $state(false);
  // (`leaving`: the page goes; the note that they were armed stays, for the reload to say so)
  armMachines(on: boolean, leaving = false) {
    if (on && this.output !== 'live') return;
    const was = this.sfxArmed;
    this.sfxArmed = on; this.engine.armed = on;
    this.thread.inputsNow(this.engine);              // (the output thread: at once)
    // (only to say so after a reload: arming itself is never kept)
    try { if (on) sessionStorage.setItem(WAS_ARMED_KEY, '1'); else if (!(leaving && was)) sessionStorage.removeItem(WAS_ARMED_KEY); } catch { /* not said */ }
    // (disarmed while blind: the frozen look loses them too)
    if (!on && this.frozen) this.setFrozen(this.zeroed(this.frozen, MACHINES_SAFE));
  }
  // the show's machines that wait for arming
  get gatedMachines() { return this.show.fixtures.filter((f) => this.modes.get(f.id)?.channels.some((c) => isGated(c.attr))); }
  // a copy of these frames with these attributes made safe (output/safe.ts)
  private zeroed(frames: Map<number, Uint8Array>, which: (attr: string) => boolean) {
    return zeroedFrames(frames, this.show.fixtures, (f) => this.modes.get(f.id), which);
  }
  // The page goes (closed, the browser restarted, a reload): the box holds the last frame it got,
  // so the fog machines get a 0 first (a burst mustn't stay stuck on if this page never comes
  // back). A reload puts back whatever should fog.
  private fogSafe() {
    // the output thread stops first: nothing from it may come after the safe look
    this.thread.final();
    if (this.quiet) return;
    const fog = this.show.fixtures.filter((f) => this.caps(f.id).fog || this.caps(f.id).sfx);
    if (!fog.length) return;
    const t = performance.now();
    // (blind: the frozen look goes out again, its machines off; nothing new)
    if (this.output === 'blind') {
      if (!this.frozen) return;
      const off = this.zeroed(this.frozen, (a) => ATMOS_AND_MACHINES.includes(a));
      for (const b of this.bridges) { if (b.sendFinal) b.sendFinal(off, t); else for (const [uni, data] of off) b.send(uni, data, t); }
      return;
    }
    this.engine.live = { ...this.engine.live, ...Object.fromEntries(fog.map((f) => [f.id, { fog: 0, haze: 0, confetti: 0, bubbles: 0, flame: 0, sparks: 0, co2: 0 }])) };
    // (and their channels at 0 whatever set them: a raw number in "All channels" too)
    const off = this.zeroed(this.engine.tick().frames, (a) => ATMOS_AND_MACHINES.includes(a));
    for (const b of this.bridges) { if (b.sendFinal) b.sendFinal(off, t); else for (const [uni, data] of off) b.send(uni, data, t); }
  }

  // The 40 Hz output clock. A Worker keeps time: timers in a background tab are slowed to once a
  // second (or once a minute), a Worker's messages are not, so the show keeps running when you
  // switch tabs.
  private startClock() {
    try {
      const src = `setInterval(() => postMessage(0), ${1000 / FPS});`;
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      let last = 0;
      // After a freeze the queued ticks would all run back to back: skip the ones that come too soon.
      w.onmessage = () => { const t = performance.now(); if (t - last < 15) return; last = t; this.tick(); };
      w.onerror = () => { w.terminate(); setInterval(() => this.tick(), 1000 / FPS); };
      return;
    } catch { /* no Workers (very old browser, or blocked): a plain timer */ }
    setInterval(() => this.tick(), 1000 / FPS);
  }

  // The list GO plays in Live: the one chosen there, else the first (the main show), never just
  // whatever was opened last in Program (that could be the fog timer).
  // The set list picks the song: GO plays it, and its tempo (when it has one) becomes the show's.
  chooseLiveList(id: string) {
    this.goList = id;
    const l = this.show.cueLists.find((x) => x.id === id);
    if (l?.bpm && l.bpm !== this.show.settings.bpm) { this.show.settings.bpm = l.bpm; this.markDirty(0); }
  }
  // A fog timer is never it, not even as the first list (made before any look): GO would start the fog.
  // Worked out once per change of the show (or of the GO list): looking at every cue's values
  // through the show's proxies is ~50 ms on the big demo, and the phone remote asks a few times a tick.
  get liveList(): CueList | undefined {
    const show = this.show, rev = this.rev, go = this.goList;
    const c = this.liveListOf;
    if (c && c.show === show && c.rev === rev && c.go === go) return c.list;
    const list = untrack(() => {
      const ls = show.cueLists;
      // (not a fog timer or the machine shots: GO, Space and Auto GO never step through those)
      const steps = (l: CueList) => !isFogTimer(l) && !isMachineList(l);
      return ls.find((l) => l.id === go && steps(l)) ?? ls.find(steps);
    });
    this.liveListOf = { show, rev, go, list };
    return list;
  }
  private liveListOf: { show: Show; rev: number; go: string; list: CueList | undefined } | null = null;
  // The tempo everything runs at right now.
  // (following the microphone wins; then a song playing on the timeline, at its own tempo)
  get bpm() {
    if (this.music.on && this.music.confidence >= 0.5 && this.music.bpm) return Math.round(this.music.bpm);
    const tb = this.show.timeline?.bpm;
    return this.timeline.playing && tb !== undefined && Number.isFinite(tb) && tb >= 20 && tb <= 300 ? tb : this.show.settings.bpm;
  }
  async followMusic(on: boolean) {
    if (on) await this.listener.start(); else this.listener.stop();
    this.music = { ...this.listener.state, on: this.listener.running };
  }

  // Startup, before the screen is drawn: the show from IndexedDB if it has one newer than the quick
  // localStorage copy (or there was no usable copy), so that copy can never overwrite it.
  async init() {
    let stored: string | undefined;
    try { stored = await readShow(this.showId); } catch { /* no IndexedDB (private mode): the localStorage copy is all there is */ }
    if (stored && !loadError) {
      try {
        const s = parseShow(stored);
        if (!fromLocal || (s.meta.modified ?? '') > (this.show.meta.modified ?? '')) {
          this.replaceShow(s);
          this.setLocal(stored);
          this.loadUndo();
          this.resumePlayback();
          return;
        }
      } catch (e) {
        // A show this version can't read (a newer version wrote it): leave it, start a new one.
        this.loadError = `The show that was open can't be opened by this version (${(e as Error).message}). It's still saved; this is a new show.`;
        this.setShowId(newId('s'));
      }
    }
    // Nothing better stored: this show goes into the list (a fresh one too). Settled first: that's
    // the show as it opens, not a change to undo.
    if (this.settlePlay()) this.lastSnap = JSON.stringify(this.show);
    await this.persist(this.lastSnap);
    if (this.show.pages.some((p) => p.locked)) this.view = 'live';
    this.loadUndo();
    this.resumePlayback();
  }

  // ---- a reload in the middle of a show picks up where it was
  // What's playing goes into sessionStorage (this tab only) a couple of times a second; a reload,
  // or Chrome bringing the tab back after a crash, starts the same cues again (without their fades
  // and actions, the lights are already there) and the box popups reconnect by themselves.
  private pbSaved = '';
  private pbAt = 0;
  // Held things (a flash, a strobe pad) are never saved: after a reload nobody is holding them.
  // Lists go in the order they were last played, so latest-takes-precedence comes out the same.
  private savePlayback(now: number) {
    if (!this.started || now - this.pbAt < 400) return;
    this.pbAt = now;
    const lists = this.show.cueLists.map((l) => [l.id, this.status[l.id]] as const)
      .filter(([, s]) => s?.running && !s.releasing && !s.flashing).sort(([, a], [, b]) => a!.stamp - b!.stamp)
      .map(([id, s]) => [id, s!.index, s!.master, Math.round(this.engine.startedAgo(id) * 10) / 10, this.engine.history(id), this.engine.exactNow(id) ? 1 : 0]);
    const held = new Set(this.engine.heldEffects());
    const state = JSON.stringify({ id: this.showId, lists, fx: this.liveFx.filter((id) => !held.has(id)), gm: this.grandMaster, bo: this.blackout,
      view: this.view, autoGo: this.autoGo, music: this.music.on, goList: this.goList, quiet: this.quiet, hz: this.hazeStopAt ? this.hazeStopped : undefined,
      live: this.output === 'live' ? 1 : undefined });
    if (state === this.pbSaved && now - this.pbStamped < (this.timeline.playing ? 1000 : 5000)) return;
    this.pbSaved = state; this.pbStamped = now;
    // `at`: a reload comes back within seconds; a tab restored the next morning must not
    // start last night's show (and a duplicated tab mustn't either: the key is read once).
    const saved = JSON.stringify({ ...JSON.parse(state), at: Date.now() });
    // (a reload also picks the song up where it was: only this tab's copy says where)
    // (and which song of the set: the show itself may not be saved yet after a Next song)
    const tl = this.timeline.playing || this.timeline.position > 0 ? { pos: Math.round(this.timeline.position * 100) / 100, playing: this.timeline.playing, song: songIndex(this.show) } : undefined;
    try { sessionStorage.setItem(PLAYBACK_KEY, tl ? JSON.stringify({ ...JSON.parse(saved), tl }) : saved); } catch { /* fine: no resume */ }
    // and for a cold start (the tablet switched off and on again): this show's, in localStorage
    if (!this.quiet) { try { localStorage.setItem(LASTPLAY_KEY + this.showId, saved); } catch { /* fine: a cold start is quiet */ } }
  }
  private pbStamped = 0;
  private started = false;          // the saved state was read (ticks before that mustn't overwrite it)
  quiet = true;                     // fresh start, nothing played yet: nothing goes out (see tick)
  coldStart = $state(false);        // picked up what was playing after a cold start: the lights are expected to be on
  // (read before anything disarms: the start opens the show, and that makes them safe)
  private wasArmed = (() => { try { return sessionStorage.getItem(WAS_ARMED_KEY) === '1'; } catch { return false; } })();
  private resumePlayback() {
    if (this.wasArmed && this.gatedMachines.length) ui.toast('The reload made the machines safe: confetti, flames, sparks and CO2 send nothing until you hold Arm again.', 8000);
    this.wasArmed = false;
    type Saved = { id: string; lists: [string, number, number, number?, (string | number)[]?, number?][]; fx: string[]; gm: number; bo: boolean; at?: number; view?: 'program' | 'live'; autoGo?: number; music?: boolean; goList?: string; quiet?: boolean; hz?: string[]; live?: number };
    let p: Saved | null = null;
    try { p = JSON.parse(sessionStorage.getItem(PLAYBACK_KEY) ?? 'null'); sessionStorage.removeItem(PLAYBACK_KEY); } catch { /* nothing */ }
    this.started = true;
    // A reload of this tab (or a crashed tab coming back). A duplicated tab gets a copy of the
    // session storage too, and must not start a second copy of the show.
    const nav = (performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined)?.type;
    if ((nav && nav !== 'reload') || !p || p.id !== this.showId || !(Date.now() - (p.at ?? 0) < RESUME_WITHIN)) p = null;
    // A cold start (the tablet switched off and on, the browser restarted): what was playing when
    // this show was last open comes back silently if that was this evening and no other tab is
    // playing it right now (they're asked). The box has been holding that look,
    // so the same look goes out, and a fog button or the master work on it, not on black.
    if (p) {
      this.applyPlayback(p, false);
      // the song goes on from where it would be by now (silently until the page is touched, if the
      // browser wants a click before it plays sound)
      const tl = (p as { tl?: { pos: number; playing: boolean; song?: number } }).tl;
      if (tl && Number.isInteger(tl.song) && tl.song !== songIndex(this.show) && tl.song! >= 0 && tl.song! < songsOf(this.show).length) { pickSong(this.show, tl.song!); this.markDirty(0); }
      if (tl && Number.isFinite(tl.pos)) this.timeline.resumeAt(tl.pos + (tl.playing ? (Date.now() - (p.at ?? Date.now())) / 1000 : 0), tl.playing);
      return;
    }
    let q: Saved | null = null;
    try { q = JSON.parse(localStorage.getItem(LASTPLAY_KEY + this.showId) ?? 'null'); } catch { /* nothing to pick up */ }
    if (!q || q.id !== this.showId || !(Date.now() - (q.at ?? 0) < COLD_WITHIN) || q.quiet || !(q.lists.length || q.fx.length)) return;
    // another tab may be playing this show right now (a second tab): then this one stays quiet. The
    // tab that sends holds the show's output lock; without Web Locks the other tabs are asked.
    this.coldPending = true; this.othersPlay = false;
    const id = this.showId;
    const go = () => { this.coldPending = false; if (!this.othersPlay && this.showId === id && this.quiet) this.applyPlayback(q!, true); };
    if (hasLocks()) this.takeOutput().then((got) => { if (!got) this.othersPlay = true; go(); });
    else { this.channel?.postMessage({ playing: this.showId, tab: this.tabId }); setTimeout(go, 300); }
  }
  // One tab plays a show to the box at a time: the one sending holds a lock named after the show (a
  // closed or crashed tab lets go of it by itself). False: another tab holds it.
  private outLock?: () => void;
  private outAsked = '';
  private outLockFor = '';
  private takeOutput(): Promise<boolean> {
    if (this.outLock && this.outLockFor === this.showId) return Promise.resolve(true);   // (already ours)
    this.outLock?.(); this.outLock = undefined;
    this.outAsked = this.showId;
    this.outLockFor = this.showId;
    if (!hasLocks()) return Promise.resolve(true);
    return new Promise((ok) => {
      (navigator as unknown as { locks: LockManager }).locks.request(`luxdmx.out.${this.showId}`, { ifAvailable: true }, (lock) => {
        if (!lock) { ok(false); return; }
        ok(true);
        return new Promise<void>((done) => (this.outLock = done));
      }).catch(() => ok(true));
    });
  }
  private coldPending = false;      // a cold start is asking the other tabs (the timetable waits)
  private schedAsking = false;      // the timetable is asking for the output (see runSchedule)
  othersPlay = $state(false);        // another tab plays this show (this one stays quiet)
  private applyPlayback(p: { id: string; lists: [string, number, number, number?, (string | number)[]?, number?][]; fx: string[]; gm: number; bo: boolean; at?: number; view?: 'program' | 'live'; autoGo?: number; music?: boolean; goList?: string; quiet?: boolean; hz?: string[]; live?: number }, cold: boolean) {
    // A cold start of a show that was playing on stage carries on on stage (a bar's tablet switched
    // off and on mustn't leave the chase frozen until someone finds the button); the machines stay
    // safe. A tab that was blind, or wasn't playing anything, starts blind.
    if (cold && p.live) this.setOutput('live');
    for (const [id, index, master, ago, history, exact] of p.lists) {
      const l = this.show.cueLists.find((x) => x.id === id);
      if (!l || index < 0 || index >= l.cues.length) continue;
      // a list of looks: the looks played before it too, by cue (each set only what it names; a look
      // moved or deleted since is found by its id, or left out)
      for (const h of (history ?? []).slice(0, -1)) {
        const k = typeof h === 'string' ? l.cues.findIndex((c) => c.id === h) : -1;
        if (k >= 0) this.engine.jumpTo(id, k, 0, false);
      }
      this.engine.jumpTo(id, index, 0, false, !!exact);
      this.engine.setMaster(id, master);
      // its wait or follow carries on (plus the time the reload took), not from the top
      if (!cold && typeof ago === 'number' && ago > 0) this.engine.backdate(id, ago + Math.max(0, (Date.now() - (p.at ?? Date.now())) / 1000));
    }
    for (const id of p.fx) if (this.show.effects.some((e) => e.id === id)) this.engine.startEffect(id);
    if (typeof p.gm === 'number') { this.grandMaster = p.gm; this.fadedOut = p.gm < 0.01; }
    if (p.bo) this.blackout = true;
    // fog stopped from Live stays stopped (until a cue that fogs those machines, as before)
    const hz = (p.hz ?? []).filter((id) => this.show.fixtures.some((f) => f.id === id));
    if (hz.length) {
      this.holdOn('haze-stop', Object.fromEntries(hz.map((id) => [id, { fog: 0, haze: 0 }])));
      this.hazeStopped = hz;
      this.hazeStopAt = Object.fromEntries(this.show.cueLists.map((l) => [l.id, this.engine.status(l.id).cue]));
    }
    // the hands-off parts too: the page you were on, Auto GO, listening to the music (the browser
    // remembers the microphone permission; if it asks again, the toast says so)
    // (a show locked for the service opens in Live whatever this tab was on)
    if (p.view) this.view = this.show.pages.some((x) => x.locked) ? 'live' : p.view;
    if (p.goList && this.show.cueLists.some((l) => l.id === p!.goList)) this.goList = p.goList;     // the song Auto GO and GO play
    if (p.autoGo) this.autoGo = p.autoGo;
    if (p.music && !cold) this.followMusic(true).catch(() => ui.toast('Following the music needs the microphone again: tap ♪ at the top', 6000));
    // the show goes on, so does its output (a tab that hadn't played anything stays quiet)
    if (!p.quiet) this.quiet = false;
    this.coldStart = cold;
    if (p.lists.length || p.fx.length) {
      const l = this.show.cueLists.find((x) => x.id === p!.lists[0]?.[0]);
      // said for the list GO plays (the show, not the house lights that happened to start last)
      const g = this.liveList, gs = g ? p.lists.find(([id]) => id === g.id) : undefined;
      const say = g && gs ? `: ${g.name}, ${cueNumber(g, gs[1])}. ${g.cues[gs[1]]?.name}` : l ? `: ${l.name}, ${l.cues[p!.lists[0][1]]?.name}` : '';
      const at = cold ? new Date(p.at ?? Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      // (a cold start has no box connected yet: says so, the red bar has the button)
      const unsent = cold && !this.bridges.some((b) => b.state === 'ready') ? '. Connect the box to send it' : '';
      queueMicrotask(() => ui.toast(cold ? `Back on as it was at ${at}${say}${unsent}` : `Picked up where it was${say}`, 6000));
    }
  }

  // ---- the timetable (model/schedule.ts), looked at every few seconds while the app is open.
  // It plays the latest entry whose time came since it last looked. When it last looked is kept per
  // show, so a tablet switched on again plays what came while it was off (and nothing else: a look
  // played by hand stays). Catching up (just started, or the tablet slept) puts the look on at once,
  // without its fade or actions: the box has been holding a look all along.
  private schedAt = -1e9;
  private schedLast = 0;            // when it last looked (ms since 1970); 0: not since the app started
  private schedKey() { return `luxdmx.seq.sched.${this.showId}`; }
  runSchedule(now = new Date()) {
    if (!this.started || this.coldPending) return;
    // One tab runs the timetable: the one holding the show's output. A second tab on the same show
    // only watches, and takes over once the first is closed (its red bar then works again too).
    if (hasLocks() && !(this.outLock && this.outLockFor === this.showId)) {
      if (this.schedAsking) return;
      this.schedAsking = true;
      const was = this.othersPlay;
      void this.takeOutput().then((got) => {
        this.schedAsking = false;
        this.othersPlay = !got;
        // taking over: from where the other tab got to (what it played isn't played again)
        if (got) { if (was) this.schedLast = 0; this.runSchedule(now); }
      });
      return;
    }
    const t = now.getTime();
    let from = this.schedLast;
    if (!from) { try { from = Number(localStorage.getItem(this.schedKey())) || 0; } catch { /* never looked */ } }
    this.schedLast = t;
    try { localStorage.setItem(this.schedKey(), String(t)); } catch { /* it looks again after a restart */ }
    // switched off, or paused (a party tonight): what comes meanwhile is skipped, not caught up later
    const st = this.show.settings;
    if (st.scheduleOff || (st.schedulePause ?? 0) > t) return;
    if (st.schedulePause) { delete st.schedulePause; this.markDirty(0); }
    const entries = (st.schedule ?? []).filter(validEntry);
    if (!entries.length) return;
    // never looked before (a new tablet, a new timetable): what should be on now, if nothing plays
    const idle = !this.show.cueLists.some((l) => this.engine.status(l.id).running);
    const place = this.place;
    const run = from ? passed(entries, new Date(from), now, place) : idle ? current(entries, now, place) : undefined;
    if (run) this.schedFire(run, !from || t - from > 60_000, now);
  }
  // The timetable switched off, or paused until a time (a party tonight in the room the window
  // show lights). `until` null: on again now.
  setScheduleOn(on: boolean) { this.checkpoint(); if (on) delete this.show.settings.scheduleOff; else this.show.settings.scheduleOff = true; delete this.show.settings.schedulePause; this.markDirty(0); }
  pauseSchedule(until: number | null) { this.checkpoint(); if (until === null) delete this.show.settings.schedulePause; else this.show.settings.schedulePause = until; this.markDirty(0); }
  get schedulePausedUntil() { const p = this.show.settings.schedulePause ?? 0; return p > Date.now() ? p : 0; }
  // where the show is, for sunrise and sunset: set in the timetable, or guessed from the time zone
  get place(): Place & { guessed?: boolean } { return this.show.settings.place ?? guessPlace(); }
  private schedFire(run: ScheduleEntry, catchUp: boolean, now: Date) {
    const a = run.do;
    if (a.do === 'goto' || a.do === 'start' || a.do === 'go') this.played(a.list);
    const i = a.do === 'goto' ? this.show.cueLists.find((l) => l.id === a.list)?.cues.findIndex((c) => c.id === a.cue) ?? -1 : -1;
    if (catchUp && a.do === 'goto' && i >= 0) this.engine.jumpTo(a.list, i, 0, false);
    else this.engine.act(a);
    // nobody may be there: a list the timetable plays never fires confetti, flames, sparks or CO2
    // (armed or not), until a person steps it on
    if (a.do === 'goto' || a.do === 'start' || a.do === 'go') this.engine.jumped.add(a.list);
    if (a.do === 'blackout') this.blackout = a.on;          // (the app's own state follows the engine's)
    ui.toast(`${whenSaid(run, now, this.place)}: ${actionText(this.show, a)} (the timetable${catchUp ? ', caught up' : ''})`, 6000);
  }

  // ---- shows in this browser
  // `thread`: the show did change (the output thread gets it with the next frame, and before any
  // command); false: it may have (a click, a key), the save finds out
  markDirty(delay = 350, thread = true) {
    if (thread) this.thread.showChanged();
    if (!thread) this.savePending = true;
    clearTimeout(this.dirtyTimer);
    this.dirtyTimer = setTimeout(() => this.checkpoint(true), delay);
  }
  private async persist(json: string) {
    const n = ++this.writes;
    this.saved = false;
    const text = serializeShow(JSON.parse(json), false);
    this.setLocal(text);
    try {
      await writeShow(this.metaOf(), text);
      if (n === this.writes) this.saved = true;          // an older write finishing late doesn't count
      this.channel?.postMessage({ saved: this.showId, tab: this.tabId });
      this.refreshShows();
    } catch { /* IndexedDB unavailable (private mode): the localStorage copy still holds the open show */ }
  }
  // The quick copy, labelled with its show. If it doesn't fit, there's no copy at all rather than an
  // old one (IndexedDB has the show either way).
  private setLocal(text: string) {
    try { localStorage.setItem(KEY_ID, this.showId); localStorage.setItem(KEY, text); }
    catch { try { localStorage.removeItem(KEY); localStorage.removeItem(KEY_ID); } catch { /* blocked */ } }
  }
  private metaOf(show = this.show, id = this.showId): ShowMeta {
    return {
      id, name: show.meta.name || 'Untitled', modified: new Date().toISOString(), fixtures: show.fixtures.length,
      cues: show.cueLists.reduce((n, l) => n + l.cues.length, 0), thumb: stageSvg(show.fixtures, this.fittedLook(), this.kinds),
    };
  }
  // The look without the masters, drawn the way each light can really show it (for pictures).
  private fittedLook() {
    const out: Record<string, Resolved> = {};
    for (const [id, v] of Object.entries(this.look)) { const c = { ...v }; fitLook(c, this.caps(id), !!v.color); out[id] = c; }
    return out;
  }
  async refreshShows() { try { this.shows = await listShows(); } catch { this.shows = []; } }
  async openShow(id: string) {
    this.checkpoint();                         // the last edits of the open show first
    const text = await readShow(id);
    if (!text) throw new Error('that show is gone');
    const notes: string[] = [];
    const s = parseShow(text, notes);          // throws (and nothing changes) if it can't be read
    this.replaceShow(s);
    this.setShowId(id);
    this.setLocal(text);
    this.sayRepaired(notes);
  }
  // what loading a show had to put right (format.ts), said once: nothing is fixed silently
  private sayRepaired(notes: string[]) {
    if (!notes.length) return;
    ui.toast(`Opened, with ${notes.length === 1 ? 'one thing' : `${notes.length} things`} put right: ${notes.slice(0, 3).join('; ')}${notes.length > 3 ? '; …' : ''}`, 10000);
  }
  // Save the current show first, then switch to a fresh one (blank or from a template).
  async startShow(s: Show, saveCurrent = true) {
    if (saveCurrent) this.checkpoint(); else clearTimeout(this.dirtyTimer);
    this.replaceShow(s);
    this.setShowId(newId('s'));
    await this.persist(this.lastSnap);
  }
  private setShowId(id: string) {
    this.showId = id;
    this.schedLast = Date.now();               // another show: its timetable goes on from now (no catching up)
    this.otherTab = false;
    try { localStorage.setItem(CUR, id); } catch { /* storage blocked */ }
  }
  async duplicateShow(id: string) {
    const text = id === this.showId ? serializeShow(JSON.parse(JSON.stringify(this.show))) : await readShow(id);
    if (!text) return;
    const s = parseShow(text);
    s.meta.name = `${s.meta.name} (copy)`;
    await writeShow({ ...(this.shows.find((x) => x.id === id) ?? this.metaOf(s)), id: newId('s'), name: s.meta.name, modified: new Date().toISOString() }, serializeShow(s));
    await this.refreshShows();
  }
  async renameShow(id: string, name: string) {
    if (id === this.showId) { this.show.meta.name = name; this.checkpoint(); return; }
    const text = await readShow(id);
    const m = this.shows.find((x) => x.id === id);
    if (!text || !m) return;
    const s = parseShow(text); s.meta.name = name;
    await writeShow({ ...m, name }, serializeShow(s));
    await this.refreshShows();
  }
  // Deleting the open show switches to a new one without saving the deleted one again.
  async deleteShow(id: string) {
    await dbDelete(id);
    if (id === this.showId) { const s = emptyShow(); addStandardPresets(s); await this.startShow(s, false); }
    await this.refreshShows();
  }
  modeOf(fixtureId: string) { return this.modes.get(fixtureId); }
  caps(fixtureId: string) { return capsOf(this.modes.get(fixtureId)); }

  // One frame. Nothing in a show may stop the output for good: when a frame throws, the look that
  // went out last goes out again with fog and the machines off (their timers can't run meanwhile),
  // and it says so once.
  private tick() {
    const t0 = performance.now();
    try { this.frame(); this.failing = false; } catch (e) {
      if (!this.failing) {
        this.failing = true;
        console.error(e);
        ui.toast(`Something in the show can't run (${(e as Error)?.message ?? e}). The lights keep their look; fog and the machines are off.`, 10000);
      }
      try {
        const last = this.output === 'live' ? this.lastSent : this.frozen;
        if (!last || this.quiet) return;
        const off = this.zeroed(last, (a) => ATMOS_AND_MACHINES.includes(a)), t = performance.now();
        for (const b of this.bridges) { if (this.thread.serves(b)) continue; for (const [uni, data] of off) b.send(uni, data, t); }
      } catch { /* nothing more to do: the boxes hold what they had */ }
    }
    load.tick(t0, performance.now() - t0);
  }
  private failing = false;
  private uiN = 0;
  private shownRev = -1;
  // The screen's copy of a frame (the stage pictures, the cards, the lists' state). Its cost (the
  // pictures redrawn right after) is measured: the governor in perf/load.svelte.ts weighs it.
  private publish(stage: Record<string, Resolved>, look: Record<string, Resolved>, frames: Map<number, Uint8Array>) {
    const t0 = performance.now();
    const fx: Record<string, number> = {};
    for (const [id, w] of this.engine.fxWeights) fx[id] = w;
    if (Object.keys(fx).join() !== Object.keys(this.fx).join() || Object.entries(fx).some(([k, v]) => Math.abs(v - (this.fx[k] ?? 0)) > 0.01)) this.fx = fx;
    const lf = this.engine.liveEffects();
    if (lf.join() !== this.liveFx.join()) this.liveFx = lf;
    this.stage = stage;
    this.look = look;
    this.frames = frames;
    const st: Record<string, PlayerStatus> = {};
    for (const l of this.show.cueLists) st[l.id] = this.engine.status(l.id);
    this.status = st;
    // the open list's cue on stage changed (GO, an auto-advance, a jump): the selection comes along
    const on = st[this.currentList]?.cue ?? '';
    if (on !== this.followed) { this.followed = on; if (on && this.followSel) this.cueSel = [on]; }
    if (this.engine.blackout !== this.bo) this.bo = this.engine.blackout;   // a cue action changed it
    // (the pictures update right after this task: timed from here to the next one)
    pingAfter(() => load.did(performance.now() - t0));
  }
  private saidBroken = new Set<string>();
  private frame() {
    this.engine.programmer = $state.snapshot(this.programmer) as Record<string, Values>;
    this.stepFade();
    this.engine.grandMaster = this.grandMaster;
    this.listener.poll();
    // Loudness for the sound effects: quick up, slower down (like a meter). Not listening: they sit
    // at full (a plain look), not dark.
    const lv = this.music.on ? this.music.level : 1;
    this.engine.sound = lv > this.engine.sound ? lv : this.engine.sound * 0.85 + lv * 0.15;
    this.engine.bpm = this.bpm;
    // a song playing (and not following the microphone): the beat clock is the song's
    const tl = this.show.timeline, tb = tl?.bpm;
    // (the clock, not the position: counting in, it runs before the song's start, and the beats with it)
    if (this.timeline.playing && tl && tb !== undefined && !(this.music.on && this.music.confidence >= 0.5) && this.bpm === tb)
      this.engine.syncBeats((this.timeline.clock - (tl.offset ?? 0)) * tb / 60);
    const live = $state.snapshot(this.live) as Record<string, Values>;
    if (this.highlight) for (const id of this.selected) live[id] = { ...live[id], intensity: 1, color: { r: 1, g: 1, b: 1 }, strobe: 0 };
    if (this.highlight && this.highlightSolo) for (const f of this.show.fixtures) if (!this.selected.includes(f.id)) live[f.id] = { ...live[f.id], intensity: 0, fog: 0, haze: 0 };
    this.engine.live = live;
    this.engine.overlay = this.testOverlay;      // (the channel wizard: under the machines' gate)
    // the output thread gets what changed (its own engine works out the frames that go out)
    this.thread.sync(this.engine, this.show, this.quiet, this.output === 'live' ? null : this.blindFrames(), this.bridges,
      this.show.outputs.devices.find((d) => d.host === LINK)?.proto ?? 'artnet');
    const { frames, stage, look } = this.engine.tick();
    this.stageNow = stage;
    load.outputSafe = this.thread.running;
    // ---- the output first: nothing the screen does comes before it
    // A universe nothing drives any more (last fixture removed, wizard closed) gets zeros for a
    // couple of seconds, so the box doesn't keep showing the last value until its source timeout.
    const t = performance.now();
    for (const u of frames.keys()) this.recentUnis.set(u, t);
    for (const [u, at] of this.recentUnis) {
      if (frames.has(u)) continue;
      if (t - at > 2000) this.recentUnis.delete(u); else frames.set(u, new Uint8Array(512));
    }
    // Changes go out at once, a static look as a 4 Hz heartbeat (the bridge decides). Not before
    // anything plays after a fresh start: the box keeps holding the look it had (a tablet switched
    // off and on again mustn't black out the bar it was lighting).
    if (this.quiet && ([...this.engine.players.values()].some((p) => p.running) || Object.keys(this.programmer).length || this.engine.liveEffects().length
      || Object.keys(this.live).length || this.testOverlay || this.highlight || this.blackout || this.grandMaster < 1)) this.quiet = false;
    if (!this.quiet && this.outAsked !== this.showId) void this.takeOutput();
    // live: this frame; blind: the look that was out when it went blind, nothing new
    const out = this.output === 'live' ? frames : this.blindFrames();
    // (not where the output thread sends: a late frame from here would put an older look back)
    if (!this.quiet && out) for (const b of this.bridges) { if (this.thread.serves(b)) continue; for (const [uni, data] of out) b.send(uni, data, t); }
    for (const b of this.bridges) b.watch?.();      // (a box's window shut: said at once, whoever sends to it)
    if (this.output === 'live' && !this.quiet) this.lastSent = frames;
    // ---- then the rest
    // an effect that can't run is left out (engine.ts): said once, by name
    for (const [id, why] of this.engine.broken) if (!this.saidBroken.has(id)) {
      this.saidBroken.add(id);
      ui.toast(`"${this.show.effects.find((e) => e.id === id)?.name ?? id}" can't run (${why}), so it's left out. Everything else goes on.`, 8000);
    }
    for (const id of this.saidBroken) if (!this.engine.broken.has(id)) this.saidBroken.delete(id);
    // Auto GO: on every n-th bar (4 beats) of the beat clock, GO on the list Live plays. Never on a
    // staff page of looks (no GO there: its looks are tapped, not stepped).
    if (this.autoGo > 0 && this.livePage?.go !== false) {
      const bar = Math.floor(this.engine.beatCount / (4 * this.autoGo));
      // Auto GO goes round: at the end of the list it starts over (a party doesn't stop on the last look)
      const l = this.liveList;
      // (not right after a GO by hand: the next one waits for the bar after, staying on the beat)
      if (this.autoBar >= 0 && bar !== this.autoBar && l && l.cues.length > 1 && this.engine.beatCount >= this.autoSkip) {      // one look has nowhere to go
        const st = this.engine.status(l.id);
        if (st.running && st.index >= l.cues.length - 1) this.engine.jumpTo(l.id, 0); else this.engine.go(l.id);
      }
      this.autoBar = bar;
    } else this.autoBar = -1;
    const nowMs = performance.now();
    for (const [w, until] of Object.entries(this.fogUntil)) if (nowMs >= until) this.expire(w);
    // ---- what the screen shows: every frame, or every n-th while the output needs the time
    // (perf/load.svelte.ts); a fresh start or a change of look shows at once
    if (++this.uiN >= load.uiEvery || !this.status || this.shownRev !== this.rev) { this.uiN = 0; this.shownRev = this.rev; this.publish(stage, look, frames); }
    if (this.hazeStopAt) this.hazeNext();
    this.remote.tick(t);
    this.timeline.tick();
    if (t - this.schedAt > 5000) { this.schedAt = t; this.runSchedule(); }
    this.savePlayback(t);
  }

  // ---- undo / redo (whole-show snapshots: shows are small, and this can't get out of sync)
  // Close the current undo step: whatever changed since the last one becomes a step of its own.
  // Called before every discrete action, so quick actions in a row stay separate steps.
  // Also saves the show (when it changed).
  // Called before a change (so undo has the state before it), and by the save timer. Before a
  // change it also books a save for the change that follows: the click's own save (booked on
  // pointerup, before the click handler ran) was just cancelled, and a browser killed before the
  // next click lost the change.
  holdUndo = false;                 // a drag in progress (the 3D gizmo): one undo step for all of it, at the end
  checkpoint(fromTimer = false) {
    // (before an action: what it changes comes right after this, so the output thread gets the show
    // with the next frame; from the save timer the text made here is the show as it is)
    if (!fromTimer) this.thread.showChanged();
    if (fromTimer && this.holdUndo) return;
    this.savePending = false;
    clearTimeout(this.dirtyTimer);
    if (!fromTimer) this.dirtyTimer = setTimeout(() => this.checkpoint(true), 350);
    const json = JSON.stringify(this.show);
    if (fromTimer) this.thread.showJsonIs(json, true);
    if (json === this.lastSnap) return;
    if (!fromTimer) this.thread.showJsonIs(json);  // (the text is made anyway: the thread gets it as it is)
    this.undoStack.push(this.lastSnap);
    let bytes = this.undoStack.reduce((n, x) => n + x.length, 0);
    while (this.undoStack.length > UNDO_DEPTH || (bytes > UNDO_BYTES && this.undoStack.length > 5)) bytes -= this.undoStack.shift()!.length;
    this.redoStack = [];
    this.lastSnap = json;
    this.rev++;
    this.canUndo = true; this.canRedo = false;
    this.persist(json);
    this.saveUndo();
  }
  // The last undo steps survive a reload in this tab (sessionStorage: per tab, gone with it).
  // Written when things are quiet (a big show's steps are megabytes, and the write blocks), and
  // right away when the tab is going away or hidden.
  private undoTimer: ReturnType<typeof setTimeout> | undefined;
  private saveUndo(now = false) {
    clearTimeout(this.undoTimer);
    if (!now) { this.undoTimer = setTimeout(() => this.saveUndo(true), 1500); return; }
    try {
      const keep: string[] = [];
      let bytes = 0;
      for (let i = this.undoStack.length - 1; i >= 0 && keep.length < 12; i--) { bytes += this.undoStack[i].length; if (bytes > 1_500_000) break; keep.unshift(this.undoStack[i]); }
      sessionStorage.setItem(UNDO_KEY, JSON.stringify({ id: this.showId, top: this.lastSnap.length, steps: keep }));
    } catch { /* too big or blocked: undo just doesn't survive a reload */ }
  }
  private loadUndo() {
    try {
      const u = JSON.parse(sessionStorage.getItem(UNDO_KEY) ?? 'null');
      if (u?.id === this.showId && u.top === this.lastSnap.length && Array.isArray(u.steps)) { this.undoStack = u.steps; this.canUndo = u.steps.length > 0; }
    } catch { /* nothing to restore */ }
  }
  undo() { this.checkpoint(); this.step(this.undoStack, this.redoStack, 'Undone'); }
  // "Done. [Undo]": the Undo undoes this, and only while nothing else has changed since.
  toastUndo(text: string) {
    this.checkpoint();
    const mark = this.lastSnap;
    ui.toast(text, 6000, { label: 'Undo', run: () => {
      if (JSON.stringify(this.show) === mark && this.lastSnap === mark) this.undo();
      else ui.toast('Something else changed since: Ctrl+Z steps back one change at a time', 4000);
    } });
  }
  redo() { this.checkpoint(); this.step(this.redoStack, this.undoStack, 'Redone'); }
  private step(from: string[], to: string[], verb: 'Undone' | 'Redone') {
    const prev = from.pop();
    if (prev === undefined) return;
    to.push(this.lastSnap);
    const now = this.plain;                  // the version being left, for saying what changed
    const back = JSON.parse(prev) as Show;
    let said = '';
    try { said = verb === 'Undone' ? describeChange(back, now) : describeChange(now, back); } catch { /* only the message */ }
    this.show = rawTypes(back);
    this.lastSnap = prev;
    this.rev++;
    this.canUndo = this.undoStack.length > 0; this.canRedo = this.redoStack.length > 0;
    // a selection can't point at things that are gone now
    const fx = new Set(this.show.fixtures.map((f) => f.id));
    if (this.selected.some((id) => !fx.has(id))) this.selected = this.selected.filter((id) => fx.has(id));
    const cues = new Set(this.show.cueLists.flatMap((l) => l.cues.map((c) => c.id)));
    if (this.cueSel.some((id) => !cues.has(id))) this.cueSel = this.cueSel.filter((id) => cues.has(id));
    for (const id of Object.keys(this.programmer)) if (!fx.has(id)) delete this.programmer[id];
    const effects = new Set(this.show.effects.map((e) => e.id));
    if (ui.fxSel.some((id) => !effects.has(id))) ui.fxSel = ui.fxSel.filter((id) => effects.has(id));
    // nor the open cue list, the list GO plays, or the live page
    const lists = this.show.cueLists;
    if (!lists.some((l) => l.id === this.currentList)) this.currentList = lists[0]?.id ?? '';
    if (this.goList && !lists.some((l) => l.id === this.goList)) this.goList = '';
    if (this.page && !this.pages.some((p) => p.id === this.page)) this.page = '';
    this.syncBridges();
    this.persist(prev);
    this.saveUndo();
    if (said) ui.toast(`${verb}: ${said}`, 2500);
  }
  // One bridge per box in the show; boxes that stay keep their connection.
  private syncBridges() {
    const hosts = this.show.outputs.devices.map((d) => d.host);
    for (const b of this.bridges) if (!hosts.includes(b.host)) b.close();
    this.bridges = hosts.map((h) => this.bridges.find((b) => b.host === h) ?? this.makeBridge(h));
  }

  // ---- patch
  addFixtures(typeId: string, mode: string, count: number, universe: number, name: string, start?: number): string {
    this.checkpoint();
    const t = this.types.get(typeId);
    if (!t) return 'unknown fixture type';
    if (t.source !== 'generic' && !this.show.fixtureTypes.some((x) => x.id === t.id)) this.show.fixtureTypes.push(rawType(JSON.parse(JSON.stringify(t))));
    const width = modeOf(t, mode)?.channels.length ?? 1;
    // A row of their own on the stage, clear of the lights already there: the middle first, then
    // spreading out; on a crowded stage the row with the most room.
    const xs = Array.from({ length: count }, (_, i) => (i + 1) / (count + 1));
    const room = (y: number) => Math.min(1, ...this.show.fixtures.flatMap((f) => xs.map((x) => Math.hypot((f.x - x) * 1.6, f.y - y))));
    const rows = [0.5, 0.35, 0.65, 0.25, 0.8, 0.42, 0.58, 0.15, 0.9, 0.3, 0.7, 0.2, 0.85, 0.1];
    const row = (rows.find((y) => room(y) >= 0.09) ?? rows.reduce((a, b) => (room(b) > room(a) ? b : a))) * 10;
    // more of a name already there carry on its numbering (Front 7 to 12, not a second Front 1)
    const same = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: (\\d+))?$`);
    const taken = this.show.fixtures.map((f) => same.exec(f.name)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1] ?? 1));
    const first = taken.length ? Math.max(...taken) + 1 : 1;
    for (let i = 0; i < count; i++) {
      // A given start address puts them back to back from there; otherwise after what's patched.
      const address = start ? start + i * width : this.nextFree(universe, width);
      if (address < 1 || address + width - 1 > 512) return `universe ${universe} is full`;
      this.show.fixtures.push({
        id: newId('f'), name: count > 1 || taken.length ? `${name} ${first + i}` : name, typeId, mode: modeOf(t, mode)?.name ?? mode,
        universe, address, x: xs[i], y: row / 10,
      });
    }
    return '';
  }
  // New lights do in every look what `like` does there: its values in every cue (not its raw
  // channels when the types differ), its groups, its effects, its own preset positions.
  playAlong(ids: string[], like: string) {
    const src = this.show.fixtures.find((f) => f.id === like);
    if (!src || !ids.length) return 0;
    const sameType = (id: string) => this.show.fixtures.find((f) => f.id === id)?.typeId === src.typeId;
    const copy = (v: Values, id: string): Values => { const c: Values = JSON.parse(JSON.stringify(v)); if (!sameType(id)) this.fitValues(c, this.caps(id)); return c; };
    let cues = 0;
    for (const l of this.show.cueLists) for (const c of l.cues) {
      const v = c.values[like];
      if (!v) continue;
      cues++;
      for (const id of ids) c.values[id] = copy(v, id);
    }
    for (const g of this.show.groups) if (g.fixtures.includes(like)) for (const id of ids) if (!g.fixtures.includes(id)) g.fixtures.push(id);
    for (const e of this.show.effects) if (e.fixtures?.includes(like)) for (const id of ids) if (!e.fixtures.includes(id)) e.fixtures.push(id);
    for (const p of this.show.presets) if (p.perFixture?.[like]) for (const id of ids) p.perFixture[id] = copy(p.perFixture[like], id);
    this.engine.refresh();                       // (a running look takes them in at once)
    return cues;
  }
  // Several lights patched in one go (a pixel run, the hall's bars): a universe for all, addresses
  // one after the other from `start` (each after the last one's channels, plus `gap`), names
  // numbered from `name`. Unset parts stay as they are. One undo step.
  repatch(ids: string[], o: { universe?: number; start?: number; gap?: number; name?: string }) {
    const list = this.show.fixtures.filter((f) => ids.includes(f.id));
    if (!list.length) return;
    this.checkpoint();
    let at = o.start;
    list.forEach((f, i) => {
      if (o.universe !== undefined) f.universe = o.universe;
      if (at !== undefined) { f.address = at; at += (this.modeOf(f.id)?.channels.length ?? 1) + (o.gap ?? 0); }
      if (o.name) f.name = `${o.name} ${i + 1}`;
    });
    this.markDirty(0);
  }
  nextFree(universe: number, width: number): number {
    let end = 0;
    for (const f of this.show.fixtures) {
      if (f.universe !== universe) continue;
      end = Math.max(end, f.address - 1 + (this.modeOf(f.id)?.channels.length ?? 1));
    }
    return end + width <= 512 ? end + 1 : -1;
  }
  removeFixture(id: string) {
    this.show.fixtures = this.show.fixtures.filter((f) => f.id !== id);
    this.selected = this.selected.filter((s) => s !== id);
    delete this.programmer[id];
    for (const l of this.show.cueLists) for (const c of l.cues) delete c.values[id];
    for (const g of this.show.groups) g.fixtures = g.fixtures.filter((f) => f !== id);
    for (const e of this.show.effects) if (e.fixtures) e.fixtures = e.fixtures.filter((f) => f !== id);
    for (const p of this.show.presets) if (p.perFixture) delete p.perFixture[id];
  }
  // Another type for a light (a template's PAR swapped for yours): address and place stay; raw
  // channel values go, they were for the old channel layout. A white the new type shows another
  // way comes over: a colour temperature becomes that white as a colour on an RGB PAR (and a
  // whitish colour a temperature on a white-only light), so the looks still light it the same.
  changeType(id: string, typeId: string) {
    const f = this.show.fixtures.find((x) => x.id === id), t = this.types.get(typeId);
    if (!f || !t) return;
    this.checkpoint();
    f.typeId = t.id; f.mode = t.modes[0]?.name ?? '';
    const c = capsOf(modeOf(t, f.mode));
    const fit = (v: Values | undefined) => { if (v) this.fitValues(v, c); };
    for (const l of this.show.cueLists) for (const q of l.cues) fit(q.values[id]);
    for (const p of this.show.presets) fit(p.perFixture?.[id]);
    fit(this.programmer[id]);
    this.engine.refresh();
    this.markDirty(0);
  }
  // Values made for another kind of light, for this one: raw channels go (another layout), and a
  // white comes over the way this one makes it (a colour temperature as that white on an RGB PAR, a
  // whitish colour as a temperature on a white-only light).
  private fitValues(v: Values, c: { color: boolean; cct: boolean }) {
    delete v.raw;
    if (c.color && !c.cct && typeof v.cct === 'number') { if (!v.color) v.color = cctColor(v.cct); delete v.cct; }
    else if (c.cct && !c.color && v.cct === undefined && v.color && 'r' in v.color) { const w = whiteTemperature(v.color); if (w !== undefined) v.cct = w; delete v.color; }
  }
  moveFixture(id: string, x: number, y: number) {
    const f = this.show.fixtures.find((g) => g.id === id);
    if (f) { f.x = Math.max(0.02, Math.min(0.98, x)); f.y = Math.max(0.04, Math.min(0.96, y)); }
  }

  // ---- fixture order, copy / paste
  moveFixtures(ids: string[], to: number) {
    this.checkpoint();
    const moving = this.show.fixtures.filter((f) => ids.includes(f.id));
    const rest = this.show.fixtures.filter((f) => !ids.includes(f.id));
    const at = Math.max(0, Math.min(rest.length, to - this.show.fixtures.slice(0, to).filter((f) => ids.includes(f.id)).length));
    this.show.fixtures = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  }
  async copyFixtures(ids = this.selected) {
    const items = this.show.fixtures.filter((f) => ids.includes(f.id));
    if (!items.length) return 0;
    const types = this.show.fixtureTypes.filter((t) => items.some((f) => f.typeId === t.id));
    await copyClip('fixtures', items, types);
    return items.length;
  }
  async cutFixtures() { this.checkpoint(); const n = await this.copyFixtures(); for (const id of [...this.selected]) this.removeFixture(id); return n; }
  // Paste: new fixtures at the next free addresses on the same universes, a bit lower on the stage.
  async pasteFixtures(): Promise<number> {
    this.checkpoint();
    const clip = await readClip('fixtures');
    if (!clip) return 0;
    const typeIds = new Map((clip.types ?? []).map((t) => [t.id, this.addType(t)]));
    const added: string[] = [];
    for (const raw of clip.items as Fixture[]) {
      const f = { ...raw, typeId: typeIds.get(raw.typeId) ?? raw.typeId };
      const width = modeOf(this.types.get(f.typeId), f.mode)?.channels.length ?? 1;
      const address = this.nextFree(f.universe, width);
      if (address < 0) continue;
      const id = newId('f');
      this.show.fixtures.push({ ...f, id, name: this.uniqueName(f.name), address, y: Math.min(0.96, f.y + 0.08) });
      added.push(id);
    }
    this.selected = added;
    this.markDirty();
    return added.length;
  }
  duplicateFixtures() { this.copyFixtures().then(() => this.pasteFixtures()); }
  // Removes the lights; groups that only had them go too (and their live buttons). Says how many
  // cues lose them, so a template's lights don't vanish from its looks without a word.
  // what points at something deleted goes too (model/prune.ts): said in the delete's toast
  prune(): string {
    const can = (attr: string) => this.show.fixtures.some((f) => this.modeOf(f.id)?.channels.some((c) => c.attr === attr));
    const p = prune(this.show, can);
    for (const id of this.engine.liveEffects()) if (!this.show.effects.some((e) => e.id === id)) this.engine.stopEffect(id, 0);
    this.liveFx = this.engine.liveEffects();
    return prunedText(p);
  }
  removeFixtures(ids = this.selected): { cues: number; groups: number; also: string } {
    this.checkpoint();
    const gone = new Set(ids);
    const cues = this.show.cueLists.flatMap((l) => l.cues).filter((c) => Object.keys(c.values).some((id) => gone.has(id))).length;
    const emptied = new Set(this.show.groups.filter((g) => g.fixtures.length && g.fixtures.every((f) => gone.has(f))).map((g) => g.id));
    for (const id of [...ids]) this.removeFixture(id);
    if (emptied.size) {
      for (const e of this.show.effects) if (e.group && emptied.has(e.group)) { delete e.group; e.fixtures = []; }
      this.show.groups = this.show.groups.filter((g) => !emptied.has(g.id));
      for (const p of this.show.pages) p.widgets = p.widgets.filter((w) => !(w.type === 'group' && emptied.has(w.group)));
    }
    return { cues, groups: emptied.size, also: this.prune() };
  }
  private uniqueName(name: string) {
    const names = new Set(this.show.fixtures.map((f) => f.name));
    if (!names.has(name)) return name;
    const m = /^(.*?)(\d+)$/.exec(name);
    let base = m ? m[1] : name + ' ', n = m ? +m[2] : 1;
    while (names.has(`${base}${n}`)) n++;
    return `${base}${n}`;
  }

  // A fog timer: a looping list that fogs for `seconds` every `minutes`. Returns its id.
  makeFogTimer(minutes: number, seconds: number, fixtures = this.show.fixtures.filter((f) => this.caps(f.id).fog).map((f) => f.id)): string | undefined {
    if (!fixtures.length) return undefined;
    this.checkpoint();
    const on = Object.fromEntries(fixtures.map((id) => [id, { fog: 1, haze: 1 }])), off = Object.fromEntries(fixtures.map((id) => [id, { fog: 0, haze: 0 }]));
    seconds = Math.max(0.5, Math.min(MAX_FOG, seconds));
    const pause = fogPause(minutes, seconds);
    const l: CueList = { id: newId('l'), name: `Fog every ${minutes} min`, end: 'loop', color: '#8a94a3', play: false, cues: [
      { id: newId('c'), name: `Fog ${seconds} s`, values: on, fade: 0, advance: { mode: 'wait', time: seconds } },
      { id: newId('c'), name: 'Pause', values: off, fade: 0, advance: { mode: 'wait', time: pause } },
    ] };
    this.show.cueLists.push(l);
    this.markDirty(0);
    return l.id;
  }

  // ---- the stage: arrange the selection, a picture of the venue underneath
  arrange(how: 'row' | 'arc' | 'circle' | 'grid') {
    const fs = this.show.fixtures.filter((f) => this.selected.includes(f.id));
    if (fs.length < 2) return;
    this.checkpoint();
    const xs = fs.map((f) => f.x), ys = fs.map((f) => f.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), cy = ys.reduce((a, b) => a + b, 0) / fs.length;
    const span = Math.max(0.3, x1 - x0), cx = (x0 + x1) / 2, n = fs.length;
    fs.forEach((f, i) => {
      const u = n > 1 ? i / (n - 1) : 0.5;
      if (how === 'row') { f.x = cx - span / 2 + span * u; f.y = cy; }
      else if (how === 'arc') { const a = Math.PI * (0.15 + 0.7 * u); f.x = cx - Math.cos(a) * span / 2; f.y = cy + Math.sin(a) * 0.18 - 0.09; }
      else if (how === 'circle') { const a = (2 * Math.PI * i) / n - Math.PI / 2; f.x = cx + Math.cos(a) * Math.min(0.35, span / 2); f.y = cy + Math.sin(a) * 0.3; }
      else { const cols = Math.ceil(Math.sqrt(n)), r = Math.floor(i / cols), c = i % cols; f.x = cx - span / 2 + (cols > 1 ? (span * c) / (cols - 1) : span / 2); f.y = cy - 0.1 + r * 0.14; }
      f.x = Math.max(0.03, Math.min(0.97, f.x)); f.y = Math.max(0.05, Math.min(0.95, f.y));
    });
    this.markDirty(0);
  }
  // A picture under the stage (a plan or a photo of the room), shrunk to a sensible size.
  async setStageImage(file: File | null) {
    this.checkpoint();
    if (!file) { if (this.show.settings.stage) delete this.show.settings.stage.image; this.markDirty(0); return; }
    const img = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    this.show.settings.stage = { opacity: 0.45, ...this.show.settings.stage, image: c.toDataURL('image/jpeg', 0.82) };
    this.markDirty(0);
  }

  // ---- groups
  groupFromSelection(name: string, ids = this.selected) {
    this.checkpoint();
    const g = { id: newId('g'), name, fixtures: this.show.fixtures.map((f) => f.id).filter((id) => ids.includes(id)) };
    this.show.groups.push(g);
    return g.id;
  }
  selectGroup(id: string, add = false) {
    const g = this.show.groups.find((x) => x.id === id);
    if (!g) return;
    this.selected = add ? [...new Set([...this.selected, ...g.fixtures])] : [...g.fixtures];
  }
  // Effects on the group keep running on its fixtures; flash buttons for it go.
  removeGroup(id: string): string {
    this.checkpoint();
    const g = this.show.groups.find((x) => x.id === id);
    if (!g) return '';
    for (const e of this.show.effects) if (e.group === id) { delete e.group; e.fixtures = [...g.fixtures]; }
    for (const p of this.show.pages) p.widgets = p.widgets.filter((w) => !(w.type === 'group' && w.group === id));
    this.show.groups = this.show.groups.filter((x) => x.id !== id);
    return this.prune();
  }
  groupUse(id: string) {
    return this.show.effects.filter((e) => e.group === id).length + this.show.pages.reduce((n, p) => n + p.widgets.filter((w) => w.type === 'group' && w.group === id).length, 0);
  }
  moveGroup(id: string, to: number) {
    this.checkpoint();
    const g = this.show.groups.find((x) => x.id === id);
    if (!g) return;
    const rest = this.show.groups.filter((x) => x.id !== id);
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, g);
    this.show.groups = rest;
  }

  // ---- selection + programmer
  select(id: string, add: boolean) {
    if (!add) this.selected = [id];
    else this.selected = this.selected.includes(id) ? this.selected.filter((s) => s !== id) : [...this.selected, id];
  }
  selectAll() { this.selected = this.show.fixtures.map((f) => f.id); }
  selectNone() { this.selected = []; }
  set(partial: Values) {
    for (const id of this.selected) this.programmer[id] = { ...this.programmer[id], ...partial };
    if ([partial.fog, partial.haze].some((v) => typeof v === 'number' && v > 0)) this.letHazeGo();   // fog asked for by hand: a Live "Stop" doesn't sit on it
  }
  // Off (the button, the 0 key) means off: a fog or haze machine in the selection stops making fog
  // too. (Not the intensity slider passing 0 on its way somewhere.)
  off() {
    for (const id of this.selected) this.programmer[id] = { ...this.programmer[id], intensity: 0, ...(this.caps(id).fog ? { fog: 0, haze: 0 } : {}) };
  }
  // Fog and haze machines making fog right now that no held fog button is behind (a cue left them
  // on): Live says so, with a way to stop them.
  get hazing(): string[] {
    return this.show.fixtures.filter((f) => this.caps(f.id).fog && !this.live[f.id]
      && ((this.stage[f.id]?.fog ?? 0) > 0.01 || (this.stage[f.id]?.haze ?? 0) > 0.01)).map((f) => f.id);
  }
  // Held off on the live layer until a cue that fogs one of them comes on (not in the programmer: a
  // later haze cue still hazes, and a Record doesn't write "hazer off" into whatever cue it makes).
  stopHaze() {
    const ids = this.hazing;
    this.holdOn('haze-stop', Object.fromEntries(ids.map((id) => [id, { fog: 0, haze: 0 }])));
    this.hazeStopped = ids;
    this.hazeStopAt = Object.fromEntries(this.show.cueLists.map((l) => [l.id, this.status[l.id]?.cue ?? '']));
  }
  private letHazeGo() { this.holdOff('haze-stop'); this.hazeStopAt = null; }
  // the cue on stage of each list when fog was stopped, and which machines: the stop lasts until a
  // cue that fogs one of them comes on (by GO or by itself; a chase stepping or a release doesn't)
  private hazeStopAt: Record<string, string> | null = null;
  private hazeStopped: string[] = [];
  private hazeNext() {
    for (const l of this.show.cueLists) {
      const cue = this.status[l.id]?.cue ?? '';
      if (!this.hazeStopAt || cue === this.hazeStopAt[l.id]) continue;
      this.hazeStopAt[l.id] = cue;
      const c = cue ? l.cues.find((x) => x.id === cue) : undefined;
      if (c && this.hazeStopped.some((id) => [c.values[id]?.fog, c.values[id]?.haze].some((v) => typeof v === 'number' && v > 0))) { this.letHazeGo(); return; }
    }
  }
  clearProgrammer() { this.programmer = {}; }
  // Picking a colour for lights that are off would show nothing: switch them on too.
  lightUpIfDark(ids = this.selected) {
    for (const id of ids) {
      const c = this.caps(id);
      if (!(c.intensity || c.color || c.white) || this.programmer[id]?.intensity !== undefined || (this.look[id]?.intensity ?? 0) > 0) continue;
      this.programmer[id] = { ...this.programmer[id], intensity: 1 };
    }
  }
  // Spread over the selection, in fixture order: pan around the middle (a fan), or colours.
  fan(amount: number) {
    const ids = this.show.fixtures.map((f) => f.id).filter((id) => this.selected.includes(id) && this.caps(id).position);
    if (ids.length < 2) return;
    const mid = ids.reduce((a, id) => a + (this.look[id]?.pan ?? 0.5), 0) / ids.length;
    ids.forEach((id, i) => { this.programmer[id] = { ...this.programmer[id], pan: Math.max(0, Math.min(1, mid + (i / (ids.length - 1) - 0.5) * amount)) }; });
  }
  spreadColors(from: Color | 'rainbow', to?: Color) {
    const ids = this.show.fixtures.map((f) => f.id).filter((id) => this.selected.includes(id) && this.caps(id).color);
    ids.forEach((id, i) => {
      const u = ids.length > 1 ? i / (ids.length - 1) : 0;
      const c = from === 'rainbow' ? hsv(u * 0.85, 1, 1) : { r: from.r + (to!.r - from.r) * u, g: from.g + (to!.g - from.g) * u, b: from.b + (to!.b - from.b) * u };
      this.programmer[id] = { ...this.programmer[id], color: c };
    });
    this.lightUpIfDark(ids);
  }
  // One raw channel (by its index in the mode) on the selected fixtures; undefined lets go of it.
  setRaw(index: number, value: number | undefined) {
    for (const id of this.selected) {
      const raw = { ...(this.programmer[id]?.raw ?? {}) };
      if (value === undefined) delete raw[String(index)]; else raw[String(index)] = Math.max(0, Math.min(255, Math.round(value)));
      this.programmer[id] = { ...this.programmer[id], raw };
    }
  }

  // ---- fixture types
  // Add a type to the show (library, file, editor). Returns its id; a type already there is kept.
  // Add a type to the show. The same type again is reused; a changed one (an edited file imported
  // again) is added next to it, so fixtures already patched keep theirs.
  addType(t: FixtureType): string {
    this.checkpoint();
    this.remember(t);
    const same = this.show.fixtureTypes.find((x) => x.id === t.id);
    if (!same) { this.show.fixtureTypes.push(rawType(JSON.parse(JSON.stringify(t)))); return t.id; }
    if (JSON.stringify(same.modes) === JSON.stringify(t.modes)) return same.id;
    let n = 2;
    while (this.show.fixtureTypes.some((x) => x.id === `${t.id}#${n}`)) n++;
    this.show.fixtureTypes.push(rawType({ ...JSON.parse(JSON.stringify(t)), id: `${t.id}#${n}`, model: `${t.model} (${n})` }));
    return `${t.id}#${n}`;
  }
  // My fixtures: types from outside the built-in set are kept in the browser for other shows.
  myTypes = $state.raw<FixtureType[]>([]);
  async refreshMyTypes() { try { this.myTypes = await listMyTypes(); } catch { this.myTypes = []; } }
  private remember(t: FixtureType) { if (t.source !== 'generic') saveMyType(t).then(() => this.refreshMyTypes()).catch(() => {}); }
  async forgetMyType(id: string) { await deleteMyType(id); await this.refreshMyTypes(); }
  saveType(t: FixtureType) {
    this.remember(t);
    this.checkpoint();
    const i = this.show.fixtureTypes.findIndex((x) => x.id === t.id);
    const raw = rawType(JSON.parse(JSON.stringify(t)));
    if (i >= 0) this.show.fixtureTypes[i] = raw; else this.show.fixtureTypes.push(raw);
    for (const f of this.show.fixtures) if (f.typeId === t.id && !t.modes.some((m) => m.name === f.mode)) f.mode = t.modes[0]?.name ?? '';
  }

  // ---- cue lists
  get list(): CueList | undefined { return this.show.cueLists.find((l) => l.id === this.currentList); }
  newList(name = `List ${this.show.cueLists.length + 1}`): CueList {
    this.checkpoint();
    const l: CueList = { id: newId('l'), name, cues: [], end: 'stop', play: false };
    this.show.cueLists.push(l);
    this.currentList = l.id;
    return this.show.cueLists[this.show.cueLists.length - 1];
  }
  removeList(id: string): string {
    this.checkpoint();
    this.engine.stop(id); this.engine.forget(id);
    this.show.cueLists = this.show.cueLists.filter((l) => l.id !== id);
    if (this.currentList === id) this.currentList = this.show.cueLists[0]?.id ?? '';
    return this.prune();
  }

  // Store the programmer's fixtures, each with its full current look, as a new cue.
  // `into`: a list other than the one open in Program (Live records into the list GO plays).
  record(into?: string): boolean {
    this.checkpoint();
    const ids = Object.keys(this.programmer);
    if (!ids.length && !this.engine.liveEffects().length) return false;
    const list = (into ? this.show.cueLists.find((l) => l.id === into) : undefined) ?? this.list ?? this.newList('Main');
    const values: Record<string, Values> = {};
    for (const id of ids) {
      const s = this.look[id];
      if (!s) continue;
      // Store references the programmer used (presets), plain values for everything else.
      values[id] = { ...stripResolved(s, this.caps(id)), ...this.programmer[id] };
    }
    // A cue that runs effects keeps the look of their lights too, so it looks the same whatever
    // played before it.
    for (const eid of this.engine.liveEffects()) {
      const e = this.show.effects.find((x) => x.id === eid);
      for (const fid of e ? (e.group ? this.show.groups.find((g) => g.id === e.group)?.fixtures ?? [] : e.fixtures ?? []) : [])
        if (!values[fid] && this.look[fid]) values[fid] = stripResolved(this.look[fid], this.caps(fid));
    }
    // In a list that's playing, the new cue goes right after the one on stage (a cue between 20 and
    // 21 at the tech, a fix mid-show): GO carries on with what was next. Otherwise at the end.
    // (only in a play: in a list of moods a new look goes at the end, the keys of the others stay)
    const st = this.engine.status(list.id);
    const at = isPlay(list) && st.running && st.index >= 0 && st.index < list.cues.length - 1 ? st.index + 1 : list.cues.length;
    const named = this.suggestName(values, this.engine.liveEffects());   // (before the cue takes the effects over)
    const cue: Cue = { id: newId('c'), name: '', values, fade: 2, advance: { mode: 'manual' } };
    // Effects running by hand go into the cue too, and the cue takes them over.
    const fx = this.engine.takeLiveEffects();
    if (fx.length) cue.effects = fx;
    this.liveFx = [];
    numbersFor(list, at, [cue]);                  // 20.5 when it goes between 20 and 21
    list.cues.splice(at, 0, cue);
    cue.name = named || `Cue ${cueNumber(list, at)}`;
    // A page of your own with buttons for this list's looks gets one for the new look too, next
    // to the others (the generated page follows the list by itself).
    for (const pg of this.show.pages) {
      const last = pg.widgets.reduce((at, w, i) => (w.type === 'cue' && w.list === list.id ? i : at), -1);
      if (last >= 0) pg.widgets.splice(last + 1, 0, { id: newId('w'), type: 'cue', list: list.id, cue: cue.id });
    }
    // The new cue takes over what's on stage, then the programmer lets go: nothing changes on
    // stage, but the cue list owns it now.
    this.engine.programmer = {};
    this.programmer = {};
    // a list that was playing shows the new cue as it plays (its look is what's on stage); one that
    // wasn't takes just this cue's own values: nothing changes on stage either way
    this.engine.jumpTo(list.id, at, 0, true, !st.running);
    this.cueSel = [cue.id];                    // its settings are the ones on the right now
    this.markDirty(30);                        // its picture right away
    return true;
  }
  // A name from what's in a cue: the presets it uses most, the effects it runs, the machines it
  // fires ("Warm white + Rainbow + Flames"), or "Off" for a blackout. Empty when there's nothing to say.
  suggestName(values: Record<string, Values>, effects: string[] = []): string {
    const count = new Map<string, number>();
    let lit = 0, off = 0;
    for (const v of Object.values(values)) {
      for (const x of Object.values(v)) { const ref = x && typeof x === 'object' && (x as { preset?: string }).preset; if (ref) count.set(ref, (count.get(ref) ?? 0) + 1); }
      if (typeof v.intensity === 'number') { if (v.intensity > 0) lit++; else off++; }
    }
    // Fog or Haze, by the machines that make it (a fog machine on next to a hazer switched off is fog)
    const making = Object.entries(values).filter(([, v]) => [v.fog, v.haze].some((x) => typeof x === 'number' && x > 0)).map(([id]) => id);
    const hazer = (id: string) => !!this.modeOf(id)?.channels.some((c) => c.attr === 'haze') && !this.modeOf(id)?.channels.some((c) => c.attr === 'fog');
    const smoke = !making.length ? '' : making.every(hazer) ? 'Haze' : 'Fog';
    const parts = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => this.show.presets.find((p) => p.id === id)?.name).filter(Boolean) as string[];
    for (const id of effects.slice(0, 2)) { const e = this.show.effects.find((x) => x.id === id); if (e) parts.push(e.name); }
    // the machines it fires, by name (a cue with flames in it says so, whatever else it does)
    const MACHINE_NAME = { flame: 'Flames', sparks: 'Sparks', co2: 'CO2', confetti: 'Confetti', bubbles: 'Bubbles' } as const;
    for (const [k, name] of Object.entries(MACHINE_NAME)) if (Object.values(values).some((v) => typeof v[k as keyof Values] === 'number' && (v[k as keyof Values] as number) > 0)) parts.push(name);
    if (!parts.length && smoke && !lit) return smoke;            // a haze cue is "Haze", not "Off"
    if (!parts.length && off && !lit) return 'Off';
    return parts.join(' + ');
  }
  // The list numbered 1, 2, 3 again (after cues went in between: 20.5...).
  renumberCues(listId: string) {
    const l = this.show.cueLists.find((x) => x.id === listId);
    if (!l) return;
    this.checkpoint();
    renumber(l);
  }
  removeCue(listId: string, i: number) {
    this.checkpoint();
    const l = this.show.cueLists.find((x) => x.id === listId);
    if (l) l.cues.splice(i, 1);
  }

  // ---- cue selection, order, clipboard (all on the current list)
  selectCue(id: string, how: 'only' | 'toggle' | 'range') {
    const l = this.list;
    if (!l) return;
    this.followSel = false;
    if (how === 'only') this.cueSel = [id];
    else if (how === 'toggle') this.cueSel = this.cueSel.includes(id) ? this.cueSel.filter((x) => x !== id) : [...this.cueSel, id];
    else {
      const ids = l.cues.map((c) => c.id), last = this.cueSel[this.cueSel.length - 1];
      const a = ids.indexOf(last), b = ids.indexOf(id);
      if (a < 0) { this.cueSel = [id]; return; }
      this.cueSel = [...new Set([...this.cueSel, ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)])];
    }
  }
  moveCues(ids: string[], to: number) {
    this.checkpoint();
    const l = this.list;
    if (!l) return;
    const moving = l.cues.filter((c) => ids.includes(c.id)), rest = l.cues.filter((c) => !ids.includes(c.id));
    const at = Math.max(0, Math.min(rest.length, to - l.cues.slice(0, to).filter((c) => ids.includes(c.id)).length));
    l.cues = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  }
  async copyCues(ids = this.cueSel) {
    const items = this.list?.cues.filter((c) => ids.includes(c.id)) ?? [];
    const names = Object.fromEntries(this.show.fixtures.map((f) => [f.id, f.name]));
    if (items.length) await copyClip('cues', items, undefined, { show: this.showId, names });
    return items.length;
  }
  async cutCues() { const n = await this.copyCues(); this.deleteCues(); return n; }
  // Paste after the last selected cue (or at the end). Cues pasted from another show keep values
  // only for fixtures that exist here.
  async pasteCues(): Promise<number> {
    this.checkpoint();
    const clip = await readClip('cues');
    if (!clip) return 0;
    const l = this.list ?? this.newList('Main');
    const sel = l.cues.map((c) => c.id).filter((id) => this.cueSel.includes(id));
    let at = sel.length ? l.cues.findIndex((c) => c.id === sel[sel.length - 1]) + 1 : l.cues.length;
    // From another show: find the lights by name (ids mean nothing there); drop references to
    // effects and lists this show doesn't have.
    const foreign = clip.show !== undefined && clip.show !== this.showId;
    const byName = new Map(this.show.fixtures.map((f) => [f.name, f.id]));
    const known = new Set(this.show.fixtures.map((f) => f.id));
    const target = (id: string) => (foreign ? byName.get(clip.names?.[id] ?? '\u0000') : known.has(id) ? id : undefined);
    const fxIds = new Set(this.show.effects.map((e) => e.id)), listIds = new Set(this.show.cueLists.map((x) => x.id));
    const added: string[] = [], made: Cue[] = [];
    for (const c of clip.items as Cue[]) {
      const values: Record<string, Values> = {};
      for (const [id, v] of Object.entries(c.values)) { const t = target(id); if (t) values[t] = v; }
      const { num: _n, ...rest } = c;                                    // a number of its own, here
      const cue: Cue = { ...rest, id: newId('c'), values };
      if (cue.effects) { cue.effects = cue.effects.filter((x) => fxIds.has(x)); if (!cue.effects.length) delete cue.effects; }
      if (cue.actions) { cue.actions = cue.actions.filter((a) => !('list' in a) || listIds.has(a.list)); if (!cue.actions.length) delete cue.actions; }
      made.push(cue);
      added.push(cue.id);
    }
    numbersFor(l, at, made);
    l.cues.splice(at, 0, ...made);
    this.cueSel = added;
    this.markDirty();
    return added.length;
  }
  async duplicateCues() { if (await this.copyCues()) await this.pasteCues(); }
  deleteCues(ids = this.cueSel) {
    this.checkpoint();
    const l = this.list;
    if (!l) return;
    const first = l.cues.findIndex((c) => ids.includes(c.id));
    l.cues = l.cues.filter((c) => !ids.includes(c.id));
    // Like a file manager: the selection moves on to what's now in that place.
    const next = l.cues[Math.min(first, l.cues.length - 1)];
    this.cueSel = first >= 0 && next ? [next.id] : [];
  }
  // Re-record a cue: the programmer's fixtures, with their current look, replace what the cue had
  // for them. Everything else in the cue stays.
  updateCue(id: string): boolean {
    this.checkpoint();
    const c = this.list?.cues.find((x) => x.id === id);
    const ids = Object.keys(this.programmer);
    const fx = this.engine.liveEffects();
    if (!c || (!ids.length && !fx.length)) return false;
    for (const fid of ids) {
      const s = this.look[fid];
      if (!s) continue;
      // the cue's own fog and haze stay unless the programmer sets them (the look never has them)
      const old = c.values[fid] ?? {}, foggy = Object.fromEntries((['fog', 'haze'] as const).filter((k) => old[k] !== undefined).map((k) => [k, old[k]]));
      c.values[fid] = { ...stripResolved(s, this.caps(fid)), ...foggy, ...this.programmer[fid] };
    }
    if (fx.length) { c.effects = [...new Set([...(c.effects ?? []), ...this.engine.takeLiveEffects()])]; this.liveFx = []; }
    this.programmer = {};
    this.engine.programmer = {};
    this.engine.refresh();                     // if it's on stage, it shows the update right away
    this.markDirty(30);
    return true;
  }

  // ---- effects
  // A new effect on the selection (or a group), started at once so you see it.
  addEffect(kind: string, target: { group?: string; fixtures?: string[] } = { fixtures: [...this.selected] }): Effect | undefined {
    this.checkpoint();
    const def = EFFECT_MAP.get(kind);
    if (!def) return undefined;
    const fixtures = target.group ? undefined : this.show.fixtures.map((f) => f.id).filter((id) => target.fixtures?.includes(id));
    // Named after what it runs on (two chases on the live page shouldn't both say "Chase"): the
    // group, a group with exactly those lights, or what their names share ("Strip A 1".."Strip A
    // 50": Strip A); and numbered if that name is taken.
    const ids = fixtures ?? [], names = this.show.fixtures.filter((f) => ids.includes(f.id)).map((f) => f.name);
    const same = this.show.groups.find((g) => g.fixtures.length === ids.length && g.fixtures.every((id) => ids.includes(id)))?.name;
    let pre = names[0] ?? '';
    for (const n of names) while (pre && !n.startsWith(pre)) pre = pre.slice(0, -1);
    pre = names.length > 1 ? pre.replace(/[\s\d#.\-_]+$/, '') : pre;
    const where = target.group ? this.show.groups.find((g) => g.id === target.group)?.name : same ?? (pre.length >= 2 ? (names.length > 1 && !/s$/i.test(pre) ? `${pre}s` : pre) : undefined);
    let name = where ? `${def.name} on ${where}` : def.name;
    for (let k = 2, base = name; this.show.effects.some((x) => x.name === name); k++) name = `${base} ${k}`;
    const e: Effect = { id: newId('e'), name, kind, ...(target.group ? { group: target.group } : { fixtures }), params: {} };
    this.show.effects.push(e);
    this.engine.startEffect(e.id);
    return this.show.effects[this.show.effects.length - 1];
  }
  // A cue list of moods made for this rig (warm, cool, sunset, ocean... and a party look), as a
  // start to change from. Returns how many looks.
  makeStarterLooks(): number {
    const caps = (id: string) => { const c = this.caps(id); return { color: c.color, position: c.position, cct: c.cct, light: !c.fog && (c.intensity || c.color || c.white || c.cct) }; };
    if (!this.show.fixtures.some((f) => caps(f.id).light)) return 0;
    this.checkpoint();
    const { list, effects } = starterLooks($state.snapshot(this.show) as Show, caps, newId);
    this.show.effects.push(...effects);
    // into the open list when it's still empty, else a list of their own
    const open = this.list;
    if (open && !open.cues.length) open.cues.push(...list.cues);
    else { list.play ??= false; this.show.cueLists.push(list); this.currentList = list.id; }
    this.cueSel = [];
    this.markDirty(0);
    return list.cues.length;
  }
  // The main colours of a picture (a poster, an album cover) as colour presets. Returns them.
  async colorsFromPicture(file: Blob, name = 'Picture'): Promise<Color[]> {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas');
    c.width = 72; c.height = Math.max(1, Math.round(72 * bmp.height / Math.max(1, bmp.width)));
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const cols = pictureColors(ctx.getImageData(0, 0, c.width, c.height).data, 5);
    if (!cols.length) return cols;
    this.checkpoint();
    const base = name.replace(/\.[^.]+$/, '').slice(0, 18) || 'Picture';
    cols.forEach((color, i) => this.show.presets.push({ id: newId('p'), name: `${base} ${i + 1}`, kind: 'color', values: { color } }));
    this.markDirty(0);
    return cols;
  }
  // A slow colour fade through some colours on the selected lights (a picture's, say).
  colorFadeWith(colors: Color[], name: string) {
    const e = this.addEffect('colorFade');
    if (e) { e.name = name; e.params = { colors, speed: 16 }; this.markDirty(0); }
    return e;
  }
  // An effect dropped on a cue: it runs with that cue from now on.
  addEffectToCue(effect: string, cue: string) {
    const c = this.show.cueLists.flatMap((l) => l.cues).find((x) => x.id === cue);
    if (!c || c.effects?.includes(effect)) return false;
    this.checkpoint();
    c.effects = [...(c.effects ?? []), effect];
    this.engine.refresh();
    this.markDirty(0);
    return true;
  }
  toggleEffect(id: string) { this.engine.toggleEffect(id); this.liveFx = this.engine.liveEffects(); }
  flashEffect(id: string, down: boolean) { this.engine.flashEffect(id, down); }
  stopAllEffects() { this.engine.stopAllEffects(); this.liveFx = []; }
  removeEffects(ids: string[]) {
    this.checkpoint();
    for (const id of ids) this.engine.stopEffect(id, 0);
    this.show.effects = this.show.effects.filter((e) => !ids.includes(e.id));
    for (const l of this.show.cueLists) for (const c of l.cues) if (c.effects) { c.effects = c.effects.filter((x) => !ids.includes(x)); if (!c.effects.length) delete c.effects; }
    for (const p of this.show.pages) p.widgets = p.widgets.filter((w) => !(w.type === 'effect' && ids.includes(w.effect)) && !(w.type === 'fader' && w.target === 'effect' && ids.includes(w.ref ?? '')));
    return this.prune();
  }
  moveEffects(ids: string[], to: number) {
    this.checkpoint();
    const moving = this.show.effects.filter((e) => ids.includes(e.id)), rest = this.show.effects.filter((e) => !ids.includes(e.id));
    const at = Math.max(0, Math.min(rest.length, to - this.show.effects.slice(0, to).filter((e) => ids.includes(e.id)).length));
    this.show.effects = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  }
  async copyEffects(ids: string[]) { const items = this.show.effects.filter((e) => ids.includes(e.id)); if (items.length) await copyClip('effects', items); return items.length; }
  // Pasted effects keep their knobs; targets that don't exist here fall back to the selection.
  async pasteEffects(): Promise<string[]> {
    this.checkpoint();
    const clip = await readClip('effects');
    if (!clip) return [];
    const added: string[] = [];
    for (const e of clip.items as Effect[]) {
      const ok = e.group ? this.show.groups.some((g) => g.id === e.group) : (e.fixtures ?? []).some((id) => this.show.fixtures.some((f) => f.id === id));
      const n: Effect = { ...e, id: newId('e'), name: this.show.effects.some((x) => x.name === e.name) ? `${e.name} (copy)` : e.name,
        ...(ok ? {} : { group: undefined, fixtures: [...this.selected] }) };
      this.show.effects.push(n);
      added.push(n.id);
    }
    this.markDirty();
    return added;
  }
  effectParams(e: Effect) { return paramsOf(e.kind, e.params); }
  // Effects running right now on any of these fixtures.
  effectsOn(ids: string[]): Effect[] {
    return this.show.effects.filter((e) => (this.fx[e.id] ?? 0) > 0 &&
      (e.group ? this.show.groups.find((g) => g.id === e.group)?.fixtures ?? [] : e.fixtures ?? []).some((f) => ids.includes(f)));
  }
  effectTargetCount(e: Effect) { return e.group ? this.show.groups.find((g) => g.id === e.group)?.fixtures.length ?? 0 : e.fixtures?.length ?? 0; }

  // ---- presets (cues keep references, so changing one changes every cue that uses it)
  applyPreset(id: string, to = this.selected) {
    const p = this.show.presets.find((x) => x.id === id);
    if (!p || !to.length) return false;
    const keys = new Set([...Object.keys(p.values), ...Object.values(p.perFixture ?? {}).flatMap((v) => Object.keys(v))]);
    const v: Values = {};
    for (const k of keys) if (k !== 'raw') (v as Record<string, unknown>)[k] = { preset: id };
    for (const fid of to) this.programmer[fid] = { ...this.programmer[fid], ...v };
    if (p.kind === 'color') this.lightUpIfDark(to);
    return true;
  }
  // A preset from what the selected lights show now: one value for all, and per fixture where
  // they differ (each head's own position).
  presetFromSelection(kind: PresetKind, name: string): Preset | undefined {
    this.checkpoint();
    const ids = this.selected.filter((id) => this.look[id]);
    if (!ids.length) return undefined;
    const p: Preset = { id: newId('p'), name, kind, values: {} };
    this.fillPreset(p, ids);
    this.show.presets.push(p);
    return p;
  }
  updatePreset(id: string) {
    this.checkpoint();
    const p = this.show.presets.find((x) => x.id === id);
    const ids = this.selected.filter((x) => this.look[x]);
    if (!p || !ids.length) return false;
    this.fillPreset(p, ids);
    // The selection now shows the preset, by reference.
    this.applyPreset(id);
    return true;
  }
  private fillPreset(p: Preset, ids: string[]) {
    const pick = (l: Resolved): Values => {
      if (p.kind === 'color') return { ...(l.color ? { color: { ...l.color } } : {}), ...(l.white !== undefined ? { white: l.white } : {}) };
      if (p.kind === 'position') return { pan: l.pan ?? 0.5, tilt: l.tilt ?? 0.5 };
      if (p.kind === 'intensity') return { intensity: l.intensity ?? 0 };
      const v: Values = {};
      for (const k of ['strobe', 'zoom', 'focus', 'iris', 'frost', 'prism', 'gobo', 'goboRotation'] as const) if (l[k] !== undefined) v[k] = l[k];
      return v;
    };
    const per = ids.map((id) => [id, pick(this.look[id])] as const);
    // Fixtures that had their own value and aren't selected keep it (updating one head of a fan
    // mustn't fold the others onto it).
    const kept: Record<string, Values> = {};
    for (const [fid, v] of Object.entries(p.perFixture ?? {})) if (!ids.includes(fid)) kept[fid] = v;
    p.values = per[0][1];
    const own = Object.fromEntries(per.filter(([, v]) => JSON.stringify(v) !== JSON.stringify(p.values)));
    const all = { ...kept, ...own };
    if (Object.keys(all).length) p.perFixture = all; else delete p.perFixture;
    delete p.auto;
    this.engine.refresh();
  }
  // Deleting a preset: cues that used it keep the look, as plain values.
  removePresets(ids: string[]) {
    this.checkpoint();
    const presets = new Map(this.show.presets.map((p) => [p.id, p]));
    for (const l of this.show.cueLists) for (const c of l.cues) for (const [fid, v] of Object.entries(c.values)) {
      for (const [k, x] of Object.entries(v)) {
        const ref = x && typeof x === 'object' && (x as { preset?: string }).preset;
        if (!ref || !ids.includes(ref)) continue;
        const p = presets.get(ref)!;
        const val = (p.perFixture?.[fid] as Record<string, unknown> | undefined)?.[k] ?? (p.values as Record<string, unknown>)[k];
        if (val === undefined) delete (v as Record<string, unknown>)[k]; else (v as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(val));
      }
    }
    for (const prog of Object.values(this.programmer)) for (const [k, x] of Object.entries(prog))
      if (x && typeof x === 'object' && ids.includes((x as { preset?: string }).preset ?? '')) delete (prog as Record<string, unknown>)[k];
    this.show.presets = this.show.presets.filter((p) => !ids.includes(p.id));
  }
  movePreset(id: string, before: string | null) {
    this.checkpoint();
    const p = this.show.presets.find((x) => x.id === id);
    if (!p) return;
    const rest = this.show.presets.filter((x) => x.id !== id);
    const at = before ? rest.findIndex((x) => x.id === before) : rest.length;
    rest.splice(at < 0 ? rest.length : at, 0, p);
    this.show.presets = rest;
  }
  duplicatePreset(id: string) {
    this.checkpoint();
    const p = this.show.presets.find((x) => x.id === id);
    if (!p) return;
    const copy: Preset = { ...JSON.parse(JSON.stringify(p)), id: newId('p'), name: `${p.name} (copy)` };
    delete copy.auto;
    this.show.presets.splice(this.show.presets.indexOf(p) + 1, 0, copy);
  }
  addStandardPresets() { return addStandardPresets(this.show); }

  // ---- live pages
  // A show without a page of its own gets the generated one, built once per change of the show:
  // through the show's proxies that's ~100 ms on the big demo, and the phone remote reads `pages`
  // (and `livePage`) several times a tick. Built on every read, a phone on the demo froze the laptop.
  get pages(): Page[] {
    if (this.show.pages.length) return this.show.pages;
    const show = this.show, rev = this.rev, c = this.generated;
    if (c && c.show === show && c.rev === rev) return c.pages;
    const pages = [untrack(() => buskingPage(show))];
    this.generated = { show, rev, pages };
    return pages;
  }
  private generated: { show: Show; rev: number; pages: Page[] } | null = null;
  // A locked live page is the service mode for the whole show: only playing, nothing that edits
  // or leaves it (other pages can still be played, they're locked too).
  // Pages first: with nothing locked this never reads the view, so switching views doesn't rebuild Live's GO strip.
  get locked() { return this.show.pages.some((p) => p.locked) && this.view === 'live'; }
  // Lock (or unlock) every page for the service; locking also leaves Edit mode, whoever asks.
  lockShow(on: boolean) {
    const pages = this.ownPages();
    for (const p of pages) p.locked = on;
    if (on) {
      this.editPage = false; this.show.settings.lockPage = pages.some((p) => p.id === this.page) ? this.page : pages[0].id;
      if (this.livePage?.go === false) this.autoGo = 0;      // a staff page: its looks stay as tapped
    }
    else { if (this.show.settings.lockPage && pages.some((p) => p.id === this.show.settings.lockPage)) this.page = this.show.settings.lockPage; delete this.show.settings.lockPage; }
    this.keepOutput();
    this.markDirty(0);
  }
  // A forgotten PIN (or a show someone else locked): open the app with #unlock and confirm.
  async unlockByLink() {
    if (!this.show.pages.some((p) => p.locked)) return;
    if (!(await ui.confirm('Unlock this show?', 'For a forgotten PIN: the show is unlocked and its PIN removed. Lock it again (and set a new PIN) from the padlock in Live.', 'Unlock', false))) return;
    this.lockShow(false);
    delete this.show.settings.lockPin;
    ui.toast('Unlocked, the PIN is gone');
  }
  // Lock with a PIN: asks for it (empty: none), keeps it with the show, locks. False: cancelled.
  async pinLock(): Promise<boolean> {
    const pin = await ui.ask('Lock with a PIN', this.show.settings.lockPin ?? '', { label: 'PIN', ok: 'Lock', digits: true, empty: true,
      hint: '3 to 8 digits. Empty: no PIN, holding the padlock unlocks.',
      body: 'This page only, for playing: no other pages, no editing, no masters. Holding the padlock asks for the PIN.' });
    if (pin === null) return false;
    const p = pin.trim();
    if (p && !/^\d{3,8}$/.test(p)) { ui.toast('A PIN is 3 to 8 digits'); return false; }
    if (p) this.show.settings.lockPin = p; else delete this.show.settings.lockPin;
    this.lockShow(true);
    ui.toast(p ? 'Locked for the show. Hold the padlock and type the PIN to unlock.' : 'Locked for the show: only playing. Hold the padlock to unlock.', 4000);
    return true;
  }
  // A box the red bar speaks for: it was live and dropped, or it isn't connected while the lights
  // are expected on (the show locked for the service, not in a second tab; or picked up after a
  // restart and playing). The box's pill then leaves the button to the bar.
  alarmed(b: Bridge): boolean {
    if (b.state === 'ready') return false;
    if (b.lostAt > 0) return true;
    const playing = Object.values(this.status).some((s) => s?.running);
    return ((this.locked && !this.othersPlay) || (playing && this.coldStart)) && b.state !== 'opening' && b.state !== 'asking';
  }
  // The live page on screen: the locked one while locked, else the one picked.
  get livePage(): Page | undefined {
    const pages = this.pages, lp = this.locked ? this.show.settings.lockPage : undefined;
    return (lp && pages.find((p) => p.id === lp)) || pages.find((p) => p.id === this.page) || pages[0];
  }
  // The generated page becomes a real one the moment you edit it.
  ownPages() {
    if (!this.show.pages.length) { this.show.pages.push(buskingPage(this.show)); this.page = this.show.pages[0].id; }
    return this.show.pages;
  }
  // On a page locked for the service the masters are out of reach: a slip of the thumb mustn't take
  // the room dark or stop the show (Blackout: holding the one at the top).
  lockedOut(w: Widget) {
    return this.locked && ((w.type === 'fader' && (w.target === 'grand' || w.target === 'list' || w.target === 'bpm'))
      || (w.type === 'special' && (w.do === 'fadeOut' || w.do === 'releaseAll' || w.do === 'tap' || w.do === 'blackout')));
  }
  fireWidget(w: Widget, down: boolean) {
    if (this.lockedOut(w)) {
      if (down) ui.toast(w.type === 'special' && w.do === 'blackout' ? 'Locked for the show: hold Blackout at the top' : 'Locked for the show: this one is out of reach until you unlock', 2500);
      return;
    }
    // a machine's shot that won't come out: it plays (the stage shows it), and says why (blind:
    // nothing goes out; safe: confetti, flames, sparks and CO2 wait for arming; bubbles just blow)
    if (down && w.type === 'list' && (!this.sfxArmed || this.output !== 'live')) {
      const l = this.show.cueLists.find((x) => x.id === w.list);
      const gated = !!l && isMachineList(l) && l.cues.some((c) => Object.values(c.values).some((v) => Object.keys(v).some(isGated)));
      if (l && this.output !== 'live' && isMachineList(l)) ui.toast(`${l.name}: blind, so nothing goes out (the stage here shows it).`, 5000);
      else if (gated) ui.toast(`${l!.name}: the machines are safe, so nothing fires (the stage here shows it). Hold Arm at the top to arm them.`, 5000);
    }
    switch (w.type) {
      case 'list': {
        if (w.action === 'flash') { const list = w.list; this.engine.flash(list, down); this.capHold(w.id, down, () => this.engine.flash(list, false)); return; }
        if (!down) return;
        if (w.action === 'select') { this.chooseLiveList(w.list); return; }
        if (w.action === 'go') this.go(w.list);                       // (the double-press guard: tiles, pads, phones)
        else if (w.action === 'back') this.back(w.list);
        else if (w.action === 'toggle') { if (!this.engine.isOn(w.list)) this.played(w.list); this.engine.toggle(w.list); }   // (switching one off isn't a look going up)
        else if (w.action === 'release') this.engine.release(w.list);
        else if (w.action === 'solo') {
          this.played(w.list);
          for (const l of this.show.cueLists) if (l.id !== w.list && (l.priority ?? 'normal') !== 'high' && this.engine.isOn(l.id)) this.engine.release(l.id);
          this.engine.start(w.list);
        }
        return;
      }
      case 'cue': {
        if (!down) return;
        const l = this.show.cueLists.find((x) => x.id === w.list);
        const i = l?.cues.findIndex((c) => c.id === w.cue) ?? -1;
        const st = this.engine.status(w.list);
        // the look that's already on (or fading in): a second tap leaves it alone, no restart, no jump
        // (but it does what any look tap does: ends a blackout, brings a faded-out master back)
        if (i < 0) return;
        if (st.running && !st.releasing && st.index === i) { if (this.blackout || this.fadedOut) this.played(); return; }
        this.played(w.list);
        this.engine.jumpTo(w.list, i);
        return;
      }
      case 'effect':
        if (w.action === 'flash') { const fx = w.effect; this.flashEffect(fx, down); this.capHold(w.id, down, () => this.flashEffect(fx, false)); }
        else if (down) this.toggleEffect(w.effect);
        return;
      case 'fog':
        if (down) this.fogOn(w.id, w.fixtures, w.level, w.max); else this.fogOff(w.id);
        return;
      case 'group': {
        const g = this.show.groups.find((x) => x.id === w.group);
        if (!g) return;
        if (down) {
          this.holdOn(w.id, Object.fromEntries(g.fixtures.map((id) => [id, { intensity: w.level, ...(w.strobe ? { strobe: w.strobe } : {}), ...(w.white ? { color: { r: 1, g: 1, b: 1 } } : {}) }])));
          this.fogUntil = { ...this.fogUntil, [w.id]: performance.now() + GROUP_FLASH_MAX * 1000 };   // never stuck on
        } else this.fogOff(w.id);
        return;
      }
      case 'song':
        // the set list on stage: Play / pause, Next song, Next part (a tap, a key, a pedal)
        if (!down) return;
        if (w.do === 'next') this.nextSong(); else if (w.do === 'part') this.nextPart(); else this.songPlay();
        return;
      case 'special':
        // Blinder: every light full white while held. Drop: that, plus the strobes going and a fog
        // burst (fog with its usual hard maximum). Both let go on release, and never stay on.
        if (w.do === 'blinder' || w.do === 'drop') {
          if (!down) { this.fogOff(w.id); this.fogOff(`${w.id}:fog`); return; }
          const light = this.show.fixtures.filter((f) => { const c = this.caps(f.id); return !c.fog && (c.intensity || c.color || c.white || c.cct); });
          // Drop: the strobes strobe; a rig without any strobes the whole rig (a light with no strobe
          // channel blinks its level, see the engine)
          const own = w.do === 'drop' ? light.filter((f) => this.kinds[f.id] === 'strobe' || (this.caps(f.id).strobe && !this.caps(f.id).color)) : [];
          const strobes = w.do === 'drop' && !own.length ? light : own;
          this.holdOn(w.id, Object.fromEntries([
            ...light.map((f) => [f.id, { intensity: 1, color: { r: 1, g: 1, b: 1 }, strobe: 0 }]),
            ...strobes.map((f) => [f.id, { intensity: 1, ...(own.length ? {} : { color: { r: 1, g: 1, b: 1 } }), strobe: 0.85 }]),
          ]));
          this.fogUntil = { ...this.fogUntil, [w.id]: performance.now() + GROUP_FLASH_MAX * 1000 };
          const fog = this.show.fixtures.filter((f) => this.caps(f.id).fog).map((f) => f.id);
          if (w.do === 'drop' && fog.length) this.fogOn(`${w.id}:fog`, fog, 1, 10);
          return;
        }
        if (!down) return;
        if (w.do === 'blackout') this.blackout = !this.blackout;
        else if (w.do === 'fadeOut') this.fadeOut(w.seconds ?? 5);
        else if (w.do === 'releaseAll') this.releaseAll();
        else if (w.do === 'tap') this.tap();
        else if (w.do === 'stopEffects') {
          // the ones started by hand stop; the ones a playing cue runs go with their cue, say which
          const fromCues = Object.keys(this.fx).filter((id) => !this.liveFx.includes(id));
          this.stopAllEffects();
          if (fromCues.length) {
            const names = fromCues.map((id) => this.show.effects.find((e) => e.id === id)?.name).filter(Boolean);
            const lists = this.show.cueLists.filter((l) => this.status[l.id]?.running && l.cues[this.status[l.id].index]?.effects?.some((e) => fromCues.includes(e))).map((l) => l.name);
            ui.toast(`${names.join(', ')} ${names.length > 1 ? 'run' : 'runs'} from a cue${lists.length ? ` in ${lists.join(', ')}` : ''}: release that to stop ${names.length > 1 ? 'them' : 'it'}`, 6000,
              lists.length ? { label: `Release ${lists.join(', ')}`, run: () => { for (const l of this.show.cueLists) if (lists.includes(l.name)) this.engine.release(l.id); } } : undefined);
          }
        }
        return;
    }
  }
  // A MIDI note or control: the controls on the live page on screen (or the first page) that
  // learned it. Faders follow a knob or fader; buttons press on note on (or CC above half).
  // What each MIDI control is holding down right now (by the control, not by the button: a button
  // removed or re-learned while held is still released when the pad comes up).
  private midiDown = new Map<string, Widget[]>();
  private midiHintAt = -1e9;
  midi(m: MidiMsg) {
    const key = `${m.kind}:${m.ch}:${m.num}`;
    const down = m.value > 0.5 || (m.kind === 'note' && m.value > 0);
    if (!down) {
      for (const w of this.midiDown.get(key) ?? []) this.fireWidget(w, false);
      this.midiDown.delete(key);
    }
    const page = this.pages.find((p) => p.id === this.page) ?? this.pages[0];
    // a pad nothing listens to: say so once in a while, with how to give it a job
    if (down && !(page?.widgets ?? []).some((w) => sameBinding(w.midi, m)) && performance.now() - this.midiHintAt > 8000) {
      this.midiHintAt = performance.now();
      ui.toast(`${m.kind === 'note' ? 'Pad' : 'Control'} ${m.num} isn't on a button of this page yet: Live, Edit, pick a button, Learn, then touch it.`, 5000);
    }
    for (const w of page?.widgets ?? []) {
      if (!sameBinding(w.midi, m)) continue;
      if (w.type === 'fader') { this.setFader(w, m.value); continue; }
      if (down && !this.midiDown.get(key)?.some((x) => x.id === w.id)) {
        // a copy: a button edited while the pad is down still lets go of what it pressed
        this.midiDown.set(key, [...(this.midiDown.get(key) ?? []), $state.snapshot(w) as Widget]);
        this.fireWidget(w, true);
      }
    }
  }
  // A controller went away: let go of everything it held.
  releaseMidi() { for (const ws of this.midiDown.values()) for (const w of ws) this.fireWidget(w, false); this.midiDown.clear(); }
  setFader(w: Widget, v: number) {
    if (w.type !== 'fader' || this.lockedOut(w)) return;
    if (w.target === 'bpm' || w.target === 'effect') this.markDirty();
    v = Math.max(0, Math.min(1, v));
    if (w.target === 'grand') this.grandMaster = v;
    else if (w.target === 'bpm') this.show.settings.bpm = Math.round(40 + v * 160);
    else if (w.target === 'list' && w.ref) this.setMaster(w.ref, v);
    else if (w.target === 'effect') { const fx = this.show.effects.find((e) => e.id === w.ref); if (fx) fx.params = { ...fx.params, level: v }; }
  }

  // Held buttons (flash, fog) put values on the live layer: on top of everything, never recorded,
  // gone when let go. Several can hold the same fixture; the last one pressed wins until released.
  private holds = new Map<string, Record<string, Values>>();
  holdOn(widget: string, values: Record<string, Values>) {
    this.holds.delete(widget);
    this.holds.set(widget, values);
    this.rebuildLive();
  }
  holdOff(widget: string) { if (this.holds.delete(widget)) this.rebuildLive(); }
  private rebuildLive() {
    const live: Record<string, Values> = {};
    for (const v of this.holds.values()) for (const [id, x] of Object.entries(v)) live[id] = { ...live[id], ...x };
    this.live = live;
  }
  // Anything held lets go by itself after GROUP_FLASH_MAX, however it's held (a finger, a stuck
  // MIDI pad, a phone): fogUntil carries the deadline, expire() lets go of what the widget pressed.
  // What to let go of is taken when it's pressed: the button edited or removed meanwhile still lets go.
  private capped = new Map<string, () => void>();
  private capHold(id: string, down: boolean, letGo: () => void) {
    if (down) { this.capped.set(id, letGo); this.fogUntil = { ...this.fogUntil, [id]: performance.now() + GROUP_FLASH_MAX * 1000 }; }
    else { this.capped.delete(id); this.fogOff(id); }
  }
  private expire(id: string) {
    const letGo = this.capped.get(id);
    this.capped.delete(id);
    letGo?.();
    this.fogOff(id);
  }
  // Fog: on while held (or for a burst), never longer than the widget's hard maximum.
  fogOn(widget: string, fixtures: string[], level: number, maxSeconds: number) {
    this.holdOn(widget, Object.fromEntries(fixtures.map((id) => [id, this.caps(id).fog ? { fog: level, haze: level } : { intensity: level }])));
    // (a time that isn't a number would never come: such a button fogs 10 s)
    const secs = Number.isFinite(maxSeconds) ? maxSeconds : 10;
    this.fogUntil = { ...this.fogUntil, [widget]: performance.now() + Math.max(0.5, Math.min(MAX_FOG, secs)) * 1000 };
  }
  fogBurst(w: Widget & { type: 'fog' }) { this.fogOn(w.id, w.fixtures, w.level, Math.min(w.burst, w.max)); }
  fogOff(widget: string) {
    this.holdOff(widget);
    const { [widget]: _gone, ...rest } = this.fogUntil;
    this.fogUntil = rest;
  }

  // GO, Back and a jump make the selection follow playback again (like a playhead); picking a
  // card yourself stops that until the next one.
  followSel = true;
  private followed = '';
  // A second GO within GO_GUARD_MS on the same list is a nervous double press, not a wish for two
  // cues (Auto GO and follow cues don't come through here).
  private lastGo = { id: '', at: -1e9 };
  go(id = this.currentList) {
    const now = performance.now();
    if (id === this.lastGo.id && now - this.lastGo.at < GO_GUARD_MS) return;
    this.lastGo = { id, at: now };
    this.played(id);
    this.followSel = true; this.engine.go(id);
  }
  // A look goes up by hand or by the clock: a blackout ends (the look you asked for shows), a
  // faded-out master comes back, and fog stopped by hand comes again if that look fogs (looked at
  // on the next tick, also when it's the cue that was on: haze from another list stays stopped).
  private played(list?: string) {
    if (this.blackout) this.blackout = false;
    if (this.autoGo > 0) this.autoSkip = this.engine.beatCount + 2 * this.autoGo;   // Auto GO: not half a beat later
    if (list && this.hazeStopAt) this.hazeStopAt[list] = '\u0000';
    if (this.fadedOut && !(this.gmFade && this.gmFade.to !== 0)) this.fadeOut(2);
  }
  back(id = this.currentList) { this.played(id); this.followSel = true; this.engine.back(id); }
  jump(id: string, i: number) { this.played(id); this.followSel = true; this.engine.jumpTo(id, i); }
  toggle(id: string) { this.engine.toggle(id); }
  release(id = this.currentList) {
    this.engine.release(id);
    // effects started on their own (on Live, by the timeline) aren't the list's and go on lighting
    // what they run on: said, with the way to stop them
    const on = this.engine.liveEffects().map((e) => this.show.effects.find((x) => x.id === e)?.name).filter(Boolean);
    if (on.length) ui.toast(`${on.join(', ')} ${on.length > 1 ? 'keep' : 'keeps'} running: ${on.length > 1 ? 'they were' : 'it was'} started on ${this.timeline.playing || this.show.timeline ? 'the timeline or Live' : 'Live'}, not by this list`, 6000,
      { label: on.length > 1 ? 'Stop them' : 'Stop it', run: () => this.stopAllEffects() });
  }
  // Fade everything out over `seconds` (the end of a song), or back in if it's out or on its way.
  fadeOut(seconds = 5) {
    const now = performance.now(), dur = Math.max(0.1, Math.min(60, seconds)) * 1000;
    // out or back is decided by the master itself (a hand on it in between counts), or by where a
    // running fade is going; the level to come back to is only taken when nothing is fading
    const out = this.gmFade ? this.gmFade.to !== 0 : this.grandMaster > 0.01;
    if (out && !this.gmFade && this.grandMaster > 0.01) this.gmBefore = this.grandMaster;
    this.fadedOut = out;
    const to = out ? 0 : this.gmBefore || 1;
    this.gmFade = { from: this.grandMaster, to, start: now, dur: dur * Math.abs(to - this.grandMaster) / Math.max(0.01, out ? this.gmBefore : to), last: this.grandMaster };
  }
  private stepFade() {
    const f = this.gmFade;
    if (!f) { if (this.fadedOut && this.grandMaster > 0.01) this.fadedOut = false; return; }   // brought up by hand
    if (Math.abs(this.grandMaster - f.last) > 1e-6) { this.gmFade = null; this.fadedOut = this.grandMaster < 0.01; return; }   // moved by hand
    const t = Math.min(1, (performance.now() - f.start) / Math.max(1, f.dur));
    const v = f.from + (f.to - f.from) * t;
    this.grandMaster = v; f.last = v;
    if (t >= 1) this.gmFade = null;
  }
  releaseAll() {
    this.engine.releaseAll(); this.programmer = {}; this.stopAllEffects(); this.highlight = false;
    this.autoGo = 0;                  // or it starts the list again on the next bar
    this.releaseHolds();
  }
  // Let go of every held button (flash, fog), e.g. when the live page goes away.
  releaseHolds() {
    for (const w of Object.keys(this.fogUntil)) this.fogOff(w);
    // fog stopped from Live ("Fog on · Stop") stays stopped until the next cue, not until you leave Live
    const hazeStop = this.holds.get('haze-stop');
    this.holds.clear(); this.live = {};
    if (hazeStop) this.holdOn('haze-stop', hazeStop);
    this.releaseMidi();
    this.engine.releaseFlashes();
  }
  setMaster(id: string, v: number) { this.engine.setMaster(id, v); }

  tapTimes: number[] = [];
  tap() {
    const now = performance.now() / 1000;
    this.tapTimes = [...this.tapTimes.filter((t) => now - t < 3), now].slice(-6);
    if (this.tapTimes.length >= 2) {
      const d = (this.tapTimes[this.tapTimes.length - 1] - this.tapTimes[0]) / (this.tapTimes.length - 1);
      this.show.settings.bpm = Math.round(Math.max(20, Math.min(300, 60 / d)));
      this.markDirty();
    }
  }

  // ---- devices
  private makeBridge(host: string) {
    // (the first box that connects while blind says why the lights don't follow)
    let b: Bridge | LinkOutput | undefined;
    const changed = () => {
      this.bridgeRev++;
      if (b?.state === 'ready' && this.output === 'blind' && !this.toldBlind && !this.locked) {
        this.toldBlind = true;
        ui.toast('Connected. You are blind: the lights don\'t follow yet. Press Blind at the top to send what you do to the stage.', 8000);
      }
    };
    // LuxDMX Link on this computer: Art-Net / sACN to any node (output/link.ts)
    const out = host === LINK ? new LinkOutput(changed, () => this.show.outputs.devices.find((d) => d.host === LINK)?.proto) : new Bridge(host, changed);
    b = out;
    out.onRelay = (d) => this.remote.handle(out, d);
    return out;
  }
  private toldBlind = false;
  addDevice(host: string) {
    this.checkpoint();
    host = host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!host || this.show.outputs.devices.some((d) => d.host === host)) return;
    this.show.outputs.devices.push({ host });
    this.bridges = [...this.bridges, this.makeBridge(host)];
  }
  // what LuxDMX Link sends: Art-Net, sACN or both (kept with the show)
  setLinkProto(p: 'artnet' | 'sacn' | 'both') {
    const d = this.show.outputs.devices.find((x) => x.host === LINK);
    if (d) { this.checkpoint(); d.proto = p; this.markDirty(0); }
    (this.bridges.find((b) => b.host === LINK) as LinkOutput | undefined)?.setProto(p);   // (now; the next frame would too)
  }
  removeDevice(host: string) {
    this.checkpoint();
    this.bridges.find((b) => b.host === host)?.close();
    this.bridges = this.bridges.filter((b) => b.host !== host);
    this.show.outputs.devices = this.show.outputs.devices.filter((d) => d.host !== host);
  }

  // ---- files
  exportShow() {
    ui.toast(`Saved ${fileName(this.show)}.luxdmx.json in your downloads. On a tablet or another computer: open the app, "Open a show file" (or drop the file on it).`, 6000);
    download(new Blob([serializeShow(JSON.parse(JSON.stringify(this.show)))], { type: 'application/json' }), `${fileName(this.show)}.luxdmx.json`);
  }
  // To the tablet (or anyone): the device's share sheet with the show file (Nearby Share, AirDrop,
  // mail, a messenger); where there's none (most desktop browsers), the download.
  async shareShow() {
    const file = new File([serializeShow(JSON.parse(JSON.stringify(this.show)))], `${fileName(this.show)}.luxdmx.json`, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: this.show.meta.name }); return; }
    } catch (e) { if ((e as Error).name === 'AbortError') return; }     // (closed the sheet: nothing else)
    this.exportShow();
  }
  // The cue sheet, in a new tab ready to print (or save as PDF from the print dialog).
  printCueSheet() {
    const w = window.open('', '_blank');
    if (!w) return false;
    w.document.write(cueSheetHtml($state.snapshot(this.show) as Show));
    w.document.close();
    return true;
  }
  printPatch() {
    const w = window.open('', '_blank');
    if (!w) return false;
    w.document.write(patchSheetHtml($state.snapshot(this.show) as Show));
    w.document.close();
    return true;
  }
  exportCsv() { download(new Blob([cueSheetCsv($state.snapshot(this.show) as Show)], { type: 'text/csv' }), `${fileName(this.show)}-cues.csv`); }
  // The show as a QLC+ workspace. Returns what couldn't go over.
  exportQxw(): string[] {
    const { xml, skipped } = toQxw($state.snapshot(this.show) as Show);
    download(new Blob([xml], { type: 'application/xml' }), `${fileName(this.show)}.qxw`);
    return skipped;
  }
  // A show file, or a QLC+ workspace (converted; the report says what came over).
  async importShow(file: File): Promise<QxwReport | undefined> {
    const text = await file.text();
    if (/\.qxw$/i.test(file.name) || /<Workspace[\s>]/.test(text.slice(0, 500))) {
      const { show, report } = await fromQxw(text, findQlc, file.name.replace(/\.qxw$/i, ''));
      addStandardPresets(show);
      await this.startShow(show);
      return report;
    }
    let s: Show;
    const notes: string[] = [];
    try { s = parseShow(text, notes); } catch (e) { throw e instanceof FormatError ? e : new Error('could not read the file'); }
    // a show someone locked opens unlocked here (its PIN stays with it for locking again)
    for (const pg of s.pages) pg.locked = false;
    delete s.settings.lockPage;
    await this.startShow(s);          // a show of its own in the browser, next to the one that was open
    this.sayRepaired(notes);
    return undefined;
  }
  newShow() { const s = emptyShow(); addStandardPresets(s); return this.startShow(s); }
  // A play or a list of looks: settled when a show comes in (older files: guessed once, from notes
  // and follow-ons), so a note typed later doesn't turn looks into a play.
  private settlePlay(s = this.show) {
    let changed = false;
    for (const l of s.cueLists) if (l.play === undefined) { l.play = isPlay(l); changed = true; }
    return changed;
  }
  // ---- the timeline (timeline/player.svelte.ts plays the song and calls these on its clock)
  doTimeline(a: TimelineAction, _catchUp: boolean) {
    if (a.do === 'effect') { if (a.on) this.engine.startEffect(a.effect); else this.engine.stopEffect(a.effect); this.liveFx = this.engine.liveEffects(); return; }
    if (a.do === 'burst') { this.burst(a.attr, a.seconds); return; }
    if (a.do === 'goto' || a.do === 'start' || a.do === 'go') this.played(a.list);
    this.engine.act(a);
    if (a.do === 'blackout') this.blackout = a.on;
  }
  // the stage as the timeline has it at a point (a jump, or playing from the middle): each list
  // it drives on its latest cue (or out), its effects on or off, the blackout. `soft` (a song played
  // from its top): a list without a cue yet keeps what it has, and a blackout is only ended, so the
  // look that's up stays up until the song's first cue comes.
  putTimelineState(st: ReturnType<typeof stateAt>, items: TimelineItem[], soft = false) {
    const lists = new Set(items.filter((i) => i.lane.startsWith('list:')).map((i) => i.lane.slice(5)));
    for (const id of lists) {
      const it = st.cues.get(id), a = it?.do, l = this.show.cueLists.find((x) => x.id === id);
      const i = a?.do === 'goto' ? l?.cues.findIndex((c) => c.id === a.cue) ?? -1 : -1;
      // (a jump: the list's machines stay quiet until it really moves on)
      if (i >= 0) { this.engine.jumpTo(id, i, 0, false); this.engine.jumped.add(id); } else if (this.engine.isOn(id) && !soft) this.engine.release(id);
    }
    for (const id of new Set(items.flatMap((i) => (i.do.do === 'effect' ? [i.do.effect] : [])))) {
      if (st.fx.includes(id)) this.engine.startEffect(id); else this.engine.stopEffect(id, 0);
    }
    this.liveFx = this.engine.liveEffects();
    if (items.some((i) => i.do.do === 'blackout') && (!soft || !st.blackout)) this.blackout = st.blackout;
  }

  // ---- the set list (model/timeline.ts): the songs of a gig in one show. Going to another song is
  // not another show: the patch, the cues, haze, the lists running, Blind or On stage and whether the
  // machines are armed all stay as they are, and nothing goes dark.
  private songAt = -1e9;                       // when Next song was last pressed (a double tap is one)
  // Song i of the set up next: stopped at its start, the stage on its first look (each list it
  // plays on the first cue placed for it, with that cue's fade, quiet like any jump); effects the
  // song before put on that this one doesn't start with fade out. Lists it doesn't play, haze,
  // fog and the blackout are left alone.
  pickSong(i: number) {
    const songs = songsOf(this.show);
    if (i < 0 || i >= songs.length) return;
    const was = this.show.timeline;
    this.timeline.reset();
    if (i !== songIndex(this.show)) { this.checkpoint(); pickSong(this.show, i); this.markDirty(0); }
    const tl = this.show.timeline!;
    for (const [id, it] of firstLook(tl.items)) {
      const a = it.do, l = this.show.cueLists.find((x) => x.id === id), k = a.do === 'goto' ? l?.cues.findIndex((c) => c.id === a.cue) ?? -1 : -1;
      if (k < 0) continue;
      this.engine.jumpTo(id, k, undefined, false); this.engine.jumped.add(id);
    }
    const start = stateAt(tl.items, 0).fx, theirs = new Set((was?.items ?? []).flatMap((x) => (x.do.do === 'effect' ? [x.do.effect] : [])));
    for (const id of theirs) if (!start.includes(id)) this.engine.stopEffect(id);
    for (const id of start) this.engine.startEffect(id);
    this.liveFx = this.engine.liveEffects();
    void this.timeline.prepare();
  }
  // Next song (a live button, a key, a pedal): the next one up and ready, or says it was the last
  nextSong() {
    const now = performance.now();
    if (now - this.songAt < 800) return;              // (a nervous double tap mustn't skip a song)
    this.songAt = now;
    const songs = songsOf(this.show), i = songIndex(this.show);
    if (i + 1 >= songs.length) { ui.toast(songs.length > 1 ? 'That was the last song of the set' : 'There is one song: add more on the Timeline (Set list)', 3500); return; }
    this.pickSong(i + 1);
    ui.toast(`Up next: ${songName(this.show.timeline, i + 1)}. Its first look is on; Play starts it.`, 3000);
  }
  // Play / pause the song that's up (a live button)
  private playAt = -1e9;
  songPlay() {
    const now = performance.now();
    if (now - this.playAt < GO_GUARD_MS) return;      // (a double press is one, like GO)
    this.playAt = now;
    if (!this.show.timeline) { ui.toast('No song yet: put one on the Timeline', 3000); return; }
    this.timeline.toggle();
  }
  // Next part: on the next beat, a jump to the next part of the song (a longer solo, a chorus
  // left out). Nothing it jumps over fires.
  nextPart() {
    const tl = this.show.timeline;
    if (!tl) { ui.toast('No song yet: put one on the Timeline', 3000); return; }
    const to = this.timeline.nextPart((it) => (it.do.do === 'goto' ? this.cueLabel(it.do.list, it.do.cue) : ''));
    if (!to) ui.toast('That is the last part of this song', 2500);
  }
  private cueLabel(list: string, cue: string) {
    const l = this.show.cueLists.find((x) => x.id === list), k = l?.cues.findIndex((c) => c.id === cue) ?? -1;
    return l && k >= 0 ? l.cues[k].name : '';
  }
  // A song that played to its end stays on its last look; the set's look between songs (when it
  // has one) fades in, quiet like a jump (it never fires a machine).
  songEnded() {
    const b = this.show.setlist?.between, l = b && this.show.cueLists.find((x) => x.id === b.list), k = l ? l.cues.findIndex((c) => c.id === b!.cue) : -1;
    if (!l || k < 0) return;
    this.engine.jumpTo(l.id, k, undefined, false); this.engine.jumped.add(l.id);
  }
  // A moment of the effect machines (or every light) for so many seconds: confetti, flames, sparks,
  // CO2, bubbles, fog, a strobe or a blinder hit. Gone by itself (never longer than 30 s).
  burst(attr: BurstAttr, seconds: number) {
    const lights = this.show.fixtures.filter((f) => { const c = this.caps(f.id); return !c.fog && !c.sfx && (c.intensity || c.color || c.white || c.cct); });
    const has = (id: string, a: string) => !!this.modeOf(id)?.channels.some((c) => c.attr === a);
    const values: Record<string, Values> = attr === 'blinder' ? Object.fromEntries(lights.map((f) => [f.id, { intensity: 1, color: { r: 1, g: 1, b: 1 }, strobe: 0 }]))
      : attr === 'strobe' ? Object.fromEntries(lights.map((f) => [f.id, { intensity: 1, color: { r: 1, g: 1, b: 1 }, strobe: 0.85 }]))
      : attr === 'fog' ? Object.fromEntries(this.show.fixtures.filter((f) => this.caps(f.id).fog).map((f) => [f.id, { fog: 1, haze: 1 }]))
      : Object.fromEntries(this.show.fixtures.filter((f) => has(f.id, attr)).map((f) => [f.id, { [attr]: 1 }]));
    if (!Object.keys(values).length) return;
    const id = `tl:${attr}`;
    this.holdOn(id, values);
    // (a show file may leave the seconds out or say nonsense: a moment, never longer than 30 s)
    const secs = Number.isFinite(seconds) ? Math.max(0.2, Math.min(30, seconds)) : 1;
    this.fogUntil = { ...this.fogUntil, [id]: performance.now() + secs * 1000 };
  }

  private replaceShow(s: Show) {
    this.thread.showChanged();
    // another show starts safe (said, when they were armed: a confetti cue later mustn't surprise)
    if (this.sfxArmed) ui.toast('Another show: the machines are safe again. Hold Arm to arm them for this one.', 7000);
    this.armMachines(false);
    this.timeline.stop(); this.timeline.position = 0;
    this.settlePlay(s);
    this.cueSel = [];
    this.engine.stopAllEffects(); this.engine.takeLiveEffects(); this.liveFx = [];
    for (const w of Object.keys(this.fogUntil)) this.fogOff(w);
    this.holds.clear(); this.live = {};
    this.page = ''; this.editPage = false; this.highlight = false;
    // The boxes are your hardware, not part of a look: a show without any keeps the ones you have,
    // and a box that stays connected isn't asked again.
    if (!s.outputs.devices.length) s.outputs.devices = this.show.outputs.devices.length ? JSON.parse(JSON.stringify(this.show.outputs.devices)) : DEFAULT_DEVICE ? [{ host: DEFAULT_DEVICE }] : [];
    const keep = new Set(s.outputs.devices.map((d) => d.host));
    for (const b of this.bridges) if (!keep.has(b.host)) b.close();
    this.engine.forget();
    this.show = rawTypes(s);
    this.bridges = s.outputs.devices.map((d) => this.bridges.find((b) => b.host === d.host) ?? this.makeBridge(d.host));
    this.currentList = s.cueLists[0]?.id ?? '';
    this.selected = []; this.programmer = {};
    this.undoStack = []; this.redoStack = []; this.canUndo = false; this.canRedo = false;
    this.lastSnap = JSON.stringify(s);
    this.rev++;
    if (s.pages.some((p) => p.locked)) this.view = 'live';     // a show locked for the service opens on its page
    this.keepOutput();
    // pictures of Picture effects unpacked now, in the background (not on the frame they first run:
    // a big one takes tens of milliseconds, a DMX frame or two)
    setTimeout(() => { for (const e of s.effects) if (e.kind === 'picture' && typeof e.params.picture === 'string' && e.params.picture) pictureOf(paramsOf('picture', e.params)); }, 0);
  }
}

const fileName = (s: Show) => (s.meta.name || 'show').replace(/[^\w-]+/g, '_');
function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// What a recorded cue keeps from the stage for one fixture: only the attributes it can do.
function stripResolved(s: Resolved, c: ReturnType<typeof caps>): Values {
  const v: Values = { intensity: s.intensity ?? 0 };
  if (c.color && s.color) v.color = { ...s.color };
  if (c.white && s.white !== undefined) v.white = s.white;
  if (c.amber && s.amber !== undefined) v.amber = s.amber;
  if (c.uv && s.uv !== undefined) v.uv = s.uv;
  if (c.cct && s.cct !== undefined) v.cct = s.cct;
  if (c.position) { v.pan = s.pan; v.tilt = s.tilt; }
  if (c.strobe && s.strobe !== undefined) v.strobe = s.strobe;
  // (no fog or haze: those are only recorded when set in the programmer; a cue recorded while an
  // earlier cue's haze runs mustn't take that haze with it)
  for (const k of ['zoom', 'focus', 'iris', 'frost', 'prism', 'gobo', 'goboRotation'] as const) if (s[k] !== undefined) v[k] = s[k];
  if (s.raw) v.raw = { ...s.raw };
  return v;
}

export const app = new App();
export { GENERIC };
