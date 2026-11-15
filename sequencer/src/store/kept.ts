// The one place the app's small settings in the browser's storage (localStorage) are read, written
// and brought up to date. Each is kept as {"v": version, "data": value}; a value from before versions
// (a plain string or JSON) counts as version 0. Reading an older one runs its steps, one version at a
// time, and writes it back in the newest form at once; one that can't be read (or whose step fails)
// is put aside under `<key>.unreadable`, never thrown away, and the default is used. A value from a
// newer app is left as it is. At the start migrateKept() does this for every entry, so nothing reads
// an old form later. STORAGE.md has the rules and the list.

type Step = (old: unknown) => unknown;
export interface Kept<T> {
  readonly key: string;
  readonly version: number;
  get(): T;
  set(value: T): boolean;
  remove(): void;
}
type Where = 'local' | 'session';       // (session: this tab's, kept over its reloads only)
interface Entry { version: number; steps: Record<number, Step>; fallback: unknown; ok: (v: unknown) => boolean; where: Where }

// every entry, by key (a family: by its prefix, e.g. one per box)
const entries = new Map<string, Entry>();
const families = new Map<string, Entry>();

const store = (where: Where = 'local'): Storage | null => {
  try { return where === 'session' ? (typeof sessionStorage === 'undefined' ? null : sessionStorage) : typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};
const isWrapped = (j: unknown): j is { v: number; data: unknown } =>
  !!j && typeof j === 'object' && !Array.isArray(j) && Number.isInteger((j as { v?: unknown }).v) && 'data' in j && Object.keys(j).length === 2;

// what's stored under a key, as {version, data}; null when nothing is
function readRaw(key: string, where: Where): { v: number; data: unknown; raw: string } | null {
  const s = store(where);
  let raw: string | null = null;
  try { raw = s?.getItem(key) ?? null; } catch { return null; }
  if (raw === null) return null;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return { v: 0, data: raw, raw }; }     // (a plain string from before)
  return isWrapped(j) ? { v: j.v, data: j.data, raw } : { v: 0, data: j, raw };
}
// (false: the browser didn't keep it, its storage full or blocked)
function write(key: string, e: Entry, data: unknown): boolean {
  try { const s = store(e.where); s?.setItem(key, JSON.stringify({ v: e.version, data })); return !!s; } catch { return false; }
}
function aside(key: string, e: Entry, raw: string) {
  // (once: a value read again and again isn't written aside again and again)
  try { const s = store(e.where); if (s && s.getItem(`${key}.unreadable`) !== raw) s.setItem(`${key}.unreadable`, raw); } catch { /* full: at least it isn't overwritten */ }
}

// the value under a key, brought up to date (and written back) when it was older
function read(key: string, e: Entry): unknown {
  const r = readRaw(key, e.where);
  if (!r) return e.fallback;
  // (one of this version that isn't a good value: put aside too, before the next set overwrites it)
  if (r.v === e.version) { if (e.ok(r.data)) return r.data; aside(key, e, r.raw); return e.fallback; }
  if (r.v > e.version) return e.fallback;                                    // (a newer app's: left alone)
  let data = r.data;
  try { for (let k = r.v + 1; k <= e.version; k++) data = e.steps[k] ? e.steps[k](data) : data; }
  catch { aside(key, e, r.raw); return e.fallback; }
  if (!e.ok(data)) { aside(key, e, r.raw); return e.fallback; }
  write(key, e, data);
  return data;
}
function handle<T>(key: string, e: Entry): Kept<T> {
  return {
    key, version: e.version,
    get: () => read(key, e) as T,
    set: (value: T) => write(key, e, value),
    remove: () => { try { store(e.where)?.removeItem(key); } catch { /* blocked */ } },
  };
}

// One setting: its key, its version, its default, its steps (to version n from n - 1), and what a
// good value looks like (a value that isn't one is put aside, the default used)
export function kept<T>(key: string, version: number, fallback: T, steps: Record<number, Step> = {}, ok: (v: unknown) => boolean = () => true, where: Where = 'local'): Kept<T> {
  const e: Entry = { version, steps, fallback, ok, where };
  entries.set(`${where}:${key}`, e);
  return handle<T>(key, e);
}
// A family of settings, one per something (a box, a show): `of(name)` is the one for `name`
export function keptFamily<T>(prefix: string, version: number, fallback: T, steps: Record<number, Step> = {}, ok: (v: unknown) => boolean = () => true, where: Where = 'local') {
  const e: Entry = { version, steps, fallback, ok, where };
  families.set(`${where}:${prefix}`, e);
  return { prefix, of: (name: string) => handle<T>(prefix + name, e) };
}

// Everything kept, brought up to date: run once at the start, before anything reads
export function migrateKept() {
  for (const [id, e] of entries) read(id.slice(id.indexOf(':') + 1), e);
  for (const where of ['local', 'session'] as const) {
    const s = store(where);
    let keys: string[] = [];
    try { keys = s ? Array.from({ length: s.length }, (_, i) => s.key(i) ?? '') : []; } catch { continue; }
    for (const k of keys) {
      if (k.endsWith('.unreadable') || entries.has(`${where}:${k}`)) continue;
      for (const [id, e] of families) { const prefix = id.slice(id.indexOf(':') + 1); if (e.where === where && k.startsWith(prefix) && k.length > prefix.length) { read(k, e); break; } }
    }
  }
}

// the common checks
export const isBool = (v: unknown) => typeof v === 'boolean';
export const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
export const isStr = (v: unknown) => typeof v === 'string';
export const oneOf = (...xs: unknown[]) => (v: unknown) => xs.includes(v);
// a step for a value from before versions that was stored as text: "1"/"0", "true"/"false", a number
export const boolFromText: Step = (o) => o === true || o === 1 || o === '1' || o === 'true';
export const numFromText = (fallback: number): Step => (o) => { const n = typeof o === 'number' ? o : Number(o); return Number.isFinite(n) ? n : fallback; };

// ---- Everything the app keeps in the browser's storage, in one list (STORAGE.md). All at version
// 1: what was kept before versions (version 0: "1"/"0", "off", a number as text, plain JSON) comes
// along by step 1. A change of form later: version 2, a step 2, and this step 1 left as it is.

const isObj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
const clamp = (lo: number, hi: number, d: number) => (o: unknown) => { const n = Number(numFromText(d)(o)); return Math.max(lo, Math.min(hi, n)); };
// (a switch kept as "off" or "0" when off, nothing when on)
const onUnless = (off: string) => (o: unknown) => o !== off && o !== 0 && o !== false;

// the 3D stage
export const GLOW_3D = kept('luxdmx.seq.glow3', 1, 0.3, { 1: clamp(0, 0.8, 0.3) }, isNum);
export const HAZE_3D = kept('luxdmx.seq.haze', 1, 0.45, { 1: clamp(0, 1.5, 0.45) }, isNum);
export const AMBIENT_3D = kept('luxdmx.seq.ambient2', 1, 0.6, { 1: clamp(0, 1, 0.6) }, isNum);
export const SPILL_3D = kept('luxdmx.seq.spill', 1, 0.45, { 1: clamp(0, 1, 0.45) }, isNum);
export const SCREENS_LIVE = kept('luxdmx.seq.screensLive', 1, true, { 1: onUnless('0') }, isBool);
export const VIDEO_SIZE = kept<string>('luxdmx.seq.video3d', 1, '1080p', {}, isStr);
export const RENDER_OPTS = kept<Record<string, unknown>>('luxdmx.seq.render3d', 1, {}, {}, isObj);
export const SEL_PANEL_OPEN = kept('luxdmx.seq.sel3d', 1, true, { 1: (o) => o !== 'folded' }, isBool);
export const CAM_3D = kept<Record<string, unknown> | null>('luxdmx.seq.cam3d', 1, null, {}, (v) => v === null || isObj(v), 'session');
// the views
export const STAGE_3D = kept('luxdmx.seq.stage3d', 1, false, { 1: boolFromText }, isBool);
export const HINTS = kept('luxdmx.seq.hints', 1, true, { 1: onUnless('0') }, isBool);
export const ZOOM = kept('luxdmx.seq.zoom', 1, 1, { 1: clamp(0.7, 1.6, 1) }, isNum);
export const PANEL_SIZES = kept<Record<string, number>>('luxdmx.seq.panels', 1, {}, {}, isObj);
export const LIVE_VIEW = kept<{ stage?: boolean; tile?: number }>('luxdmx.seq.liveview', 1, {}, {}, isObj);
export const CONSOLE_STAGE = kept<boolean | null>('luxdmx.seq.console.stage', 1, null, { 1: (o) => (o === null ? null : boolFromText(o)) }, (v) => v === null || isBool(v));
export const WELCOMED = kept<string>('luxdmx.seq.welcomed', 1, '', {}, isStr);
// what the app opens on (a visit, not a reload): the demo show playing, an empty show, or the last one
export const START_WITH = kept<'demo' | 'empty' | 'last'>('luxdmx.seq.startwith', 1, 'demo', {}, oneOf('demo', 'empty', 'last'));
// the demo show it opened on, while nobody has changed it (it goes when the next one comes)
export const DEMO_SHOW = kept<string>('luxdmx.seq.demoshow', 1, '', {}, isStr);
// the short intro over the demo, seen
export const INTRO_SEEN = kept('luxdmx.seq.introseen', 1, false, {}, isBool);
// this tab has opened already (a reload opens what was open)
export const OPENED = kept('luxdmx.seq.opened', 1, false, {}, isBool, 'session');
export const WELCOME_DEMOS_HIDDEN = kept('luxdmx.seq.welcomeDemos', 1, false, { 1: (o) => o === 'hidden' }, isBool);
export const WELCOME_SONGS = kept<Record<string, string>>('luxdmx.seq.demoSongs', 1, {}, {}, isObj);
export const QUALITY = kept<0 | 1 | 2>('luxdmx.seq.quality', 1, 2, { 1: (o) => (Number(o) === 0 || Number(o) === 1 ? Number(o) : 2) }, oneOf(0, 1, 2));
// sound
export const VOLUME = kept('luxdmx.seq.volume', 1, 0.8, { 1: clamp(0, 1, 0.8) }, isNum);
export const SOUND_HERE = kept('luxdmx.seq.sound', 1, true, { 1: onUnless('off') }, isBool);
export const CROWD_VOLUME = kept('luxdmx.seq.crowdVol', 1, 0.8, { 1: clamp(0, 1, 0.8) }, isNum);
export const CROWD_ON = kept('luxdmx.seq.crowd', 1, true, { 1: onUnless('off') }, isBool);
// effects and add-ons
export const AUTHOR = kept<string>('luxdmx.seq.author', 1, '', {}, isStr);
export const ADDONS_IMPORTED = kept<unknown[]>('luxdmx.seq.addons.imported', 1, [], {}, Array.isArray);
export const ADDON_SOURCES = kept<string[]>('luxdmx.seq.addons.sources', 1, [], {}, (v) => Array.isArray(v) && v.every(isStr));
// the show and its playing (the show itself carries its formatVersion: model/format.ts)
export const CURRENT_SHOW = kept<string>('luxdmx.seq.current', 1, '', {}, isStr);
export const HELD = kept<Record<string, { v: number; at: number }>>('luxdmx.seq.held', 1, {}, {}, isObj);
export const OUTPUT_LOCKED_LIVE = kept('luxdmx.seq.output', 1, false, { 1: (o) => o === 'live' }, isBool);
export const OUTPUT_TAB = kept<'live' | 'blind'>('luxdmx.seq.output', 1, 'blind', { 1: (o) => (o === 'live' ? 'live' : 'blind') }, oneOf('live', 'blind'), 'session');
export const WAS_ARMED = kept('luxdmx.seq.wasArmed', 1, false, { 1: boolFromText }, isBool, 'session');
export const PLAYING_TAB = kept<Record<string, unknown> | null>('luxdmx.seq.playing', 1, null, {}, (v) => v === null || isObj(v), 'session');
export const LAST_PLAYED = keptFamily<Record<string, unknown> | null>('luxdmx.seq.lastplay.', 1, null, {}, (v) => v === null || isObj(v));
export const SCHEDULE_LOOKED = keptFamily('luxdmx.seq.sched.', 1, 0, { 1: numFromText(0) }, isNum);
export const UNDO_TAB = kept<{ id: string; top: number; steps: string[]; fv?: string } | null>('luxdmx.seq.undo', 1, null, {}, (v) => v === null || isObj(v), 'session');
// boxes and phones
export const BOX_NAME = keptFamily<string>('luxdmx.seq.boxname.', 1, '', {}, isStr);
export const BOX_INFO = keptFamily<Record<string, unknown> | null>('luxdmx.seq.box.', 1, null, {}, (v) => v === null || isObj(v), 'session');
export const REMOTE_CODE = kept<{ code: string; at: number } | null>('luxdmx.seq.remote.code', 1, null, {}, (v) => v === null || isObj(v));
export const REMOTE_KEEP = kept<{ code: string } | null>('luxdmx.seq.remote.keep', 1, null, {}, (v) => v === null || isObj(v));
export const REMOTE_TAB = kept<{ on: boolean; code: string } | null>('luxdmx.seq.remote', 1, null, {}, (v) => v === null || isObj(v), 'session');
// the app's updates
export const UPDATED_FROM = kept<string>('luxdmx.seq.updated', 1, '', {}, isStr, 'session');
