// Reading and writing show files. FORMAT.md explains the rules; in short:
//   - `formatVersion` is semver. A reader opens any file whose `minReaderVersion` it satisfies.
//   - A file listing a `requiredFeatures` entry the reader doesn't know is refused, everything
//     else unknown is kept and written back as it was (we never rebuild objects field by field).
//   - Older files are brought up to date by one migration step per version, in order.
import { validEntry } from './schedule';
import { AROUND_MAX, cleanCrowd, cleanSections, validItem, validTimeline } from './timeline';
import type { Show } from './types';
import { KNOBS, cleanColors, isColor } from '../engine/fxkit';

export const FORMAT = 'luxdmx-show';
export const FORMAT_VERSION = '1.1.0';
export const MIN_READER = '1.0.0';
export const KNOWN_FEATURES: string[] = [];
export const APP = 'LuxDMX Sequencer 0.2';

export function semverCmp(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0), pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  return 0;
}

export function emptyShow(name = 'New show'): Show {
  const now = new Date().toISOString();
  return {
    format: FORMAT, formatVersion: FORMAT_VERSION, minReaderVersion: MIN_READER, requiredFeatures: [],
    meta: { name, created: now, modified: now, app: APP },
    fixtureTypes: [], fixtures: [], groups: [], presets: [], cueLists: [], effects: [], pages: [],
    outputs: { devices: [] }, settings: { bpm: 120 }, extensions: {},
  };
}

export class FormatError extends Error {}

// Migrations from each version to the next. Each takes the file as parsed JSON and returns it one
// version newer. Add one entry per format change; never edit an old one.
const MIGRATIONS: { from: string; to: string; run: (s: any) => any }[] = [
  // 1.1.0 specified effects and pages; 1.0.0 files had none in use, nothing to change.
  { from: '1.0.0', to: '1.1.0', run: (s) => s },
];

// `notes`, when given, collects what had to be mended to open the file, in plain words (see mend).
export function parseShow(text: string, notes?: string[]): Show {
  let raw: any;
  try { raw = JSON.parse(text); } catch { throw new FormatError('not a show file (not JSON)'); }
  return upgrade(raw, notes);
}

export function upgrade(raw: any, notes: string[] = []): Show {
  if (!isObj(raw)) throw new FormatError('not a show file');
  if (raw.format !== FORMAT) {
    if (raw.version === 1 && Array.isArray(raw.fixtures) && Array.isArray(raw.cues)) raw = fromDev(raw);
    else throw new FormatError('not a LuxDMX show file');
  }
  const ver = (v: unknown) => (typeof v === 'string' ? v : '1.0.0');
  if (semverCmp(ver(raw.minReaderVersion), FORMAT_VERSION) > 0)
    throw new FormatError(`made with a newer version (needs format ${raw.minReaderVersion}, this app reads ${FORMAT_VERSION})`);
  if (!Array.isArray(raw.requiredFeatures)) raw.requiredFeatures = [];
  const unknown = raw.requiredFeatures.filter((f: unknown) => !KNOWN_FEATURES.includes(f as string));
  if (unknown.length) throw new FormatError(`needs features this version doesn't have: ${unknown.join(', ')}`);
  for (const m of MIGRATIONS) if (semverCmp(ver(raw.formatVersion), m.from) === 0) { raw = m.run(raw); raw.formatVersion = m.to; }
  return withDefaults(raw, notes);
}

// Fill in anything missing (a hand-written or partial file), without touching what's there, and
// mend what can't be used.
function withDefaults(s: any, notes: string[]): Show {
  const d = emptyShow(), note = noteTo(notes);
  for (const k of Object.keys(d) as (keyof Show)[]) if (s[k] === undefined) s[k] = d[k];
  if (!isObj(s.meta)) s.meta = {};
  for (const k of ['name', 'created', 'modified', 'app']) if (s.meta[k] !== undefined && typeof s.meta[k] !== 'string') delete s.meta[k];
  s.meta = { ...d.meta, ...s.meta };
  s.outputs = { devices: [], ...(isObj(s.outputs) ? s.outputs : {}) };
  s.outputs.devices = objects(s.outputs.devices, 'Devices', note).filter((x) => typeof x.host === 'string');
  if (!isObj(s.settings)) { note('The show settings couldn\'t be read: the defaults are used'); s.settings = {}; }
  s.settings = { ...d.settings, ...s.settings };
  if (!isObj(s.extensions)) s.extensions = {};
  mendSettings(s.settings, note);
  // a timetable written by hand: the entries that can run (one bad line mustn't stop the clock)
  if (s.settings.schedule !== undefined) s.settings.schedule = Array.isArray(s.settings.schedule) ? s.settings.schedule.filter(validEntry) : [];
  // your own 3D venue: numbers that are numbers, or it goes
  const vm = s.settings.stage3d?.model;
  if (vm && !(typeof vm.name === 'string' && typeof vm.store === 'string' && ['scale', 'x', 'y', 'z', 'yaw'].every((k) => Number.isFinite((vm as unknown as Record<string, number>)[k])))) delete s.settings.stage3d!.model;
  if (s.settings.scheduleOff !== undefined && typeof s.settings.scheduleOff !== 'boolean') delete s.settings.scheduleOff;
  if (s.settings.schedulePause !== undefined && !Number.isFinite(s.settings.schedulePause)) delete s.settings.schedulePause;
  if (s.settings.place !== undefined) { const p = s.settings.place; if (!p || !(Math.abs(p.lat) <= 90) || !(Math.abs(p.lon) <= 180)) delete s.settings.place; }
  mendTimeline(s, note);

  s.fixtureTypes = withIds(s.fixtureTypes, 'Fixture types', note, false);
  for (const t of s.fixtureTypes) mendType(t, note);
  s.fixtures = withIds(s.fixtures, 'Fixtures', note).filter((f) => mendFixture(f, note));
  s.groups = withIds(s.groups, 'Groups', note);
  for (const g of s.groups) g.fixtures = strings(g.fixtures);
  s.presets = withIds(s.presets, 'Presets', note);
  for (const p of s.presets) mendPreset(p, note);
  s.cueLists = withIds(s.cueLists, 'Cue lists', note);
  for (const l of s.cueLists) mendList(l, note);
  s.effects = withIds(s.effects, 'Effects', note).filter((e) => mendEffect(e, note));
  s.pages = withIds(s.pages, 'Live pages', note);
  for (const pg of s.pages) mendPage(pg, note);
  return s as Show;
}

// ---------------------------------------------------------------- mending what a file holds
//
// A show file can hold anything: written by hand or by a script, damaged on the way. Nothing in it
// may stop the frames going out (a null in a list, a word where a number goes, a palette colour
// that isn't one) or hang the page (a tempo of 0 or less, an endless number). What can't be used
// is mended or left out here, and the notes say what, in plain words. Unknown fields stay.

type Obj = Record<string, any>;
type Note = (msg: string) => void;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isRef = (v: unknown) => isObj(v) && typeof v.preset === 'string';
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const shown = (v: unknown) => (typeof v === 'string' ? `"${v.slice(0, 24)}"` : typeof v === 'number' ? String(v) : String(JSON.stringify(v) ?? v).slice(0, 24));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const MAX_NOTES = 40;
const noteTo = (notes: string[]): Note => (m) => {
  if (notes.length < MAX_NOTES) notes.push(m); else if (notes.length === MAX_NOTES) notes.push('...and more like these');
};

// A number from what the file has (a number written as text, "0", counts), brought into lo..hi;
// NaN when it isn't one.
function numIn(v: unknown, lo: number, hi: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : NaN;
}
// Field k of o as a number in lo..hi: brought into the range, or (not a number at all) set to
// `or`, or left out when there's no `or`. Missing: `or`, if there is one. Notes what it changed.
function fixNum(o: Obj, k: string, lo: number, hi: number, where: string, note: Note, or?: number, whole = false) {
  const v = o[k];
  if (v === undefined) { if (or !== undefined) o[k] = or; return; }
  let n = numIn(v, lo, hi);
  if (whole) n = Math.round(n);
  if (n === v) return;
  if (Number.isFinite(n)) { o[k] = n; note(`${where}: ${k} ${shown(v)} is now ${n}`); }
  else if (or !== undefined) { o[k] = or; note(`${where}: ${k} ${shown(v)} isn't a usable number, now ${or}`); }
  else { delete o[k]; note(`${where}: ${k} ${shown(v)} isn't a usable number, left out`); }
}
// Only the objects of a list (a null, a number or a word where an entry goes is left out); not a
// list at all: an empty one.
function objects(v: unknown, what: string, note: Note): Obj[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) { note(`${what}: not a list, left empty`); return []; }
  const out = v.filter(isObj);
  if (out.length < v.length) note(`${what}: ${plural(v.length - out.length, 'empty or broken entry', 'empty or broken entries')} left out`);
  return out;
}
// ...and of those, the ones with an id of their own (what everything else refers to them by; a
// second one with the same id would be a different thing under the same name). `named`: a name to
// show (the id, when it has none).
function withIds(v: unknown, what: string, note: Note, named = true): Obj[] {
  const all = objects(v, what, note), seen = new Set<string>();
  const out = all.filter((o) => typeof o.id === 'string' && o.id !== '' && !seen.has(o.id) && !!seen.add(o.id));
  if (out.length < all.length) note(`${what}: ${plural(all.length - out.length, 'entry', 'entries')} without an id of its own left out`);
  if (named) for (const o of out) if (typeof o.name !== 'string') o.name = o.id;
  return out;
}

function mendSettings(st: Obj, note: Note) {
  fixNum(st, 'bpm', 20, 300, 'The show\'s tempo', note, 120);
  if (st.stage !== undefined) {
    if (!isObj(st.stage)) delete st.stage;
    else { if (st.stage.image !== undefined && typeof st.stage.image !== 'string') delete st.stage.image; fixNum(st.stage, 'opacity', 0, 1, 'The stage picture', note); }
  }
  if (st.stage3d !== undefined && !isObj(st.stage3d)) delete st.stage3d;
  // the 3D stage's room: one it knows, or the big stage (a room from a newer version: that one)
  if (isObj(st.stage3d) && st.stage3d.room !== undefined && !['hall', 'pub', 'club', 'party', 'truss'].includes(st.stage3d.room as string)) delete st.stage3d.room;
  // the band's name: words, at most 60 characters, or none (their picture)
  if (st.bandName !== undefined) { if (typeof st.bandName === 'string' && st.bandName.trim()) st.bandName = st.bandName.trim().slice(0, 60); else delete st.bandName; }
  for (const k of ['lockPin', 'lockPage']) if (st[k] !== undefined && typeof st[k] !== 'string') delete st[k];
}

// the timeline: well-formed or gone; items that aren't, dropped. Its tempo and length bounded (the
// ruler draws a line per beat or bar: a tempo of 0 or less never ends)
// (the same for every song of a set list: the timeline is the song that's up, the others sit in
// setlist.before and setlist.after)
function mendTimeline(s: Obj, note: Note) {
  if (s.timeline !== undefined && !mendSong(s.timeline, 'The timeline', note)) { delete s.timeline; note('The timeline couldn\'t be read and was left out'); }
  mendSetlist(s, note);
}
// one song; false: it can't be used at all
function mendSong(tl: unknown, where: string, note: Note): boolean {
  if (isObj(tl)) fixNum(tl, 'duration', 0, 86400, where, note);
  if (!validTimeline(tl)) return false;
  // the time before and after the song (things before the show's start can't be played: left out)
  fixNum(tl as Obj, 'lead', 0, AROUND_MAX, where, note);
  fixNum(tl as Obj, 'tail', 0, AROUND_MAX, where, note);
  const seen = new Set<string>(), n = tl.items.length, from = -(tl.lead ?? 0);
  tl.items = tl.items.filter((i) => validItem(i) && i.at >= from && !seen.has(i.id) && !!seen.add(i.id));
  if (tl.items.length < n) note(`${where}: ${plural(n - tl.items.length, 'thing', 'things')} on it that couldn't be read left out`);
  if (tl.crowd !== undefined) {
    const k = Array.isArray(tl.crowd) ? tl.crowd.length : 0, c = cleanCrowd(tl.crowd, from);
    if ((c?.length ?? 0) < k) note(`${where}: ${plural(k - (c?.length ?? 0), 'crowd moment', 'crowd moments')} that couldn't be read left out`);
    if (c) tl.crowd = c; else delete tl.crowd;
  }
  fixNum(tl as Obj, 'bpm', 20, 300, where, note);
  fixNum(tl as Obj, 'offset', -60, 86400, where, note);
  if (tl.name !== undefined) { if (typeof tl.name !== 'string') delete tl.name; else if (tl.name.length > 80) tl.name = tl.name.slice(0, 80); }
  if (tl.sections !== undefined) { const c = cleanSections(tl.sections); if (c?.length) tl.sections = c; else delete tl.sections; }
  if (tl.demo !== undefined && typeof tl.demo !== 'boolean' && typeof tl.demo !== 'string') delete tl.demo;
  const a = tl.audio as Obj | undefined;
  if (a !== undefined) {
    if (!isObj(a)) { delete tl.audio; return true; }
    if (typeof a.name !== 'string') a.name = '';
    fixNum(a, 'duration', 0, 86400, 'The song', note, tl.duration);
    for (const k of ['store', 'catalog', 'credit']) if (a[k] !== undefined && typeof a[k] !== 'string') delete a[k];
  }
  return true;
}
// The rest of the set: the songs that can be used, in order; without a timeline, one of them is up.
// The look between songs names a cue; the count-in is 0 to 2 bars.
function mendSetlist(s: Obj, note: Note) {
  const sl = s.setlist;
  if (sl === undefined) return;
  if (!isObj(sl)) { delete s.setlist; note('The set list couldn\'t be read and was left out'); return; }
  const songs = (k: 'before' | 'after', first: number) => {
    if (sl[k] !== undefined && !Array.isArray(sl[k])) note(`The set list: its songs ${k} the one that's up couldn't be read`);
    const all: unknown[] = Array.isArray(sl[k]) ? sl[k] : [];
    // (said by its name, or its place in the set as the file has it)
    const ok = all.filter((t, i) => mendSong(t, isObj(t) && typeof t.name === 'string' && t.name.trim() ? `The song "${t.name.trim().slice(0, 40)}"` : `The set list, song ${first + i}`, note));
    if (ok.length < all.length) note(`The set list: ${plural(all.length - ok.length, 'song', 'songs')} that couldn't be read left out`);
    return ok;
  };
  sl.before = songs('before', 1);
  sl.after = songs('after', sl.before.length + 2);
  if (s.timeline === undefined) { const t = sl.after.shift() ?? sl.before.pop(); if (t) s.timeline = t; }
  if (sl.between !== undefined && !(isObj(sl.between) && typeof sl.between.list === 'string' && typeof sl.between.cue === 'string')) delete sl.between;
  fixNum(sl, 'countIn', 0, 2, 'The set list', note, undefined, true);
}

function mendType(t: Obj, note: Note) {
  const where = `Fixture type "${t.model ?? t.id}"`;
  for (const k of ['manufacturer', 'model']) if (typeof t[k] !== 'string') t[k] = k === 'model' ? t.id : '';
  t.modes = objects(t.modes, `${where}, modes`, note);
  t.modes.forEach((m: Obj, i: number) => {
    if (typeof m.name !== 'string') m.name = `Mode ${i + 1}`;
    m.channels = objects(m.channels, `${where}, mode "${m.name}"`, note);
    for (const c of m.channels) {
      if (typeof c.attr !== 'string') c.attr = 'raw';
      if (typeof c.name !== 'string') c.name = '';
      if (c.fine !== undefined && typeof c.fine !== 'boolean') delete c.fine;
      fixNum(c, 'default', 0, 255, where, note, undefined, true);
      // which pixel: one of this mode's channels at most (a huge one would make endless pixels)
      fixNum(c, 'cell', 0, Math.max(0, m.channels.length - 1), where, note, undefined, true);
      if (c.span !== undefined && !(Array.isArray(c.span) && c.span.length === 2 && c.span.every((x: unknown) => typeof x === 'number' && x >= 0 && x <= 255))) {
        delete c.span; note(`${where}: a channel's span couldn't be read, it uses the whole channel`);
      }
      if (c.ranges !== undefined) {
        const rs = objects(c.ranges, `${where}, channel "${c.name}"`, note);
        for (const r of rs) {
          fixNum(r, 'from', 0, 255, where, note); fixNum(r, 'to', 0, 255, where, note);
          if (typeof r.label !== 'string') r.label = '';
          if (r.color !== undefined && typeof r.color !== 'string') delete r.color;
        }
        c.ranges = rs.filter((r) => r.from !== undefined && r.to !== undefined);
      }
    }
  });
  if (t.physical !== undefined) {
    if (!isObj(t.physical)) delete t.physical;
    else for (const k of ['panDeg', 'tiltDeg']) fixNum(t.physical, k, 1, 1080, where, note);
  }
}

// A fixture is left out when it can't say where it is: a universe (0..32767) and an address
// (1..512) that are whole numbers. "0" (text) is 0; as text it would get a universe of its own.
function mendFixture(f: Obj, note: Note): boolean {
  const where = `Fixture "${f.name}"`;
  if (typeof f.typeId !== 'string') { note(`${where}: no fixture type, left out`); return false; }
  if (f.universe === undefined) { f.universe = 0; note(`${where}: no universe, now 0`); }
  for (const [k, lo, hi] of [['universe', 0, 32767], ['address', 1, 512]] as const) {
    const v = f[k], n = Math.round(numIn(v, -Infinity, Infinity));
    if (!(n >= lo && n <= hi)) { note(`${where}: ${k} ${shown(v)} can't be right, the fixture is left out`); return false; }
    if (n !== v) { f[k] = n; note(`${where}: ${k} ${shown(v)} is now ${n}`); }
  }
  if (typeof f.mode !== 'string') f.mode = 'default';
  fixNum(f, 'x', 0, 1, where, note, 0.5); fixNum(f, 'y', 0, 1, where, note, 0.5);
  for (const k of ['invertPan', 'invertTilt', 'swapPanTilt']) if (f[k] !== undefined && typeof f[k] !== 'boolean') delete f[k];
  // its own pan / tilt range (degrees): a number a head can have, or gone (the type's, or 540 / 270)
  for (const k of ['panDeg', 'tiltDeg']) if (f[k] !== undefined && !(typeof f[k] === 'number' && f[k] >= 1 && f[k] <= 1080)) { note(`${where}: ${k} ${shown(f[k])} can't be right, left out`); delete f[k]; }
  // the 3D place and turn: well-formed or gone (a hand-edited file mustn't break the 3D stage)
  const ok = (o: unknown, k: string[]) => !!o && typeof o === 'object' && k.every((x) => Number.isFinite((o as Record<string, number>)[x]));
  if (f.p3 !== undefined && !ok(f.p3, ['x', 'y', 'z'])) delete f.p3;
  if (f.rot !== undefined && !ok(f.rot, ['yaw', 'pitch', 'roll'])) delete f.rot;
  for (const k of ['panOffset', 'tiltOffset'] as const) if (f[k] !== undefined && !Number.isFinite(f[k])) delete f[k];
  // the real light it is (RDM): a well-formed UID or none
  if (f.uid !== undefined) { if (typeof f.uid === 'string' && /^[0-9A-Fa-f]{4}:[0-9A-Fa-f]{8}$/.test(f.uid)) f.uid = f.uid.toUpperCase(); else delete f.uid; }
  return true;
}

// Values (a cue's, a preset's): levels in 0..1, colours with r, g, b in 0..1, raw channels 0..255,
// or a preset reference. What isn't is left out (the light keeps what it had). Counts the changes.
const NUM_ATTRS = new Set(['intensity', 'white', 'amber', 'uv', 'cct', 'pan', 'tilt', 'strobe', 'zoom', 'focus', 'iris', 'frost', 'prism',
  'goboRotation', 'gobo', 'fog', 'haze', 'fan', 'speed', 'confetti', 'bubbles', 'flame', 'sparks', 'co2']);
function mendValues(v: Obj, bad: { n: number }) {
  // (a level a hair outside its range, from rounding, is put right without counting as a change)
  const off = (was: unknown, now: number) => !(typeof was === 'number' && Math.abs(was - now) < 1e-6);
  for (const [k, x] of Object.entries(v)) {
    if (k === 'color') {
      if (isRef(x) || isColor(x)) continue;
      const [c] = cleanColors([x]);
      if (c) v.color = c; else delete v.color;
      if (!c || off(x.r, c.r) || off(x.g, c.g) || off(x.b, c.b)) bad.n++;
    } else if (k === 'raw') {
      if (!isObj(x)) { delete v.raw; bad.n++; continue; }
      for (const [ch, d] of Object.entries(x)) {
        const n = numIn(d, 0, 255);
        if (n === d) continue;
        if (Number.isFinite(n)) x[ch] = Math.round(n); else delete x[ch];
        if (off(d, n)) bad.n++;
      }
    } else if (NUM_ATTRS.has(k) && !isRef(x)) {
      const n = numIn(x, 0, 1);
      if (n === x) continue;
      if (Number.isFinite(n)) v[k] = n; else delete v[k];
      if (off(x, n)) bad.n++;
    }
  }
}
// the values of each fixture (by id) in a cue or a preset's perFixture
function mendByFixture(o: unknown, bad: { n: number }): Obj {
  if (!isObj(o)) { bad.n++; return {}; }
  for (const [fid, v] of Object.entries(o)) { if (isObj(v)) mendValues(v, bad); else { delete o[fid]; bad.n++; } }
  return o;
}

function mendPreset(p: Obj, note: Note) {
  const bad = { n: 0 };
  if (typeof p.kind !== 'string') p.kind = 'color';
  if (!isObj(p.values)) { p.values = {}; bad.n++; } else mendValues(p.values, bad);
  if (p.perFixture !== undefined) p.perFixture = mendByFixture(p.perFixture, bad);
  if (bad.n) note(`Preset "${p.name}": ${plural(bad.n, 'value', 'values')} that couldn't be used left out or brought into range`);
}

const PRIOS = ['low', 'normal', 'high'], RESTARTS = ['first', 'resume'];
function mendList(l: Obj, note: Note) {
  const where = `Cue list "${l.name}"`, bad = { n: 0 };
  if (typeof l.end !== 'string') l.end = 'stop';
  if (l.priority !== undefined && !PRIOS.includes(l.priority)) delete l.priority;
  if (l.restart !== undefined && !RESTARTS.includes(l.restart)) delete l.restart;
  fixNum(l, 'releaseTime', 0, 3600, where, note);
  fixNum(l, 'bpm', 20, 300, where, note);
  if (l.play !== undefined && typeof l.play !== 'boolean') delete l.play;
  if (l.color !== undefined && typeof l.color !== 'string') delete l.color;
  l.cues = withIds(l.cues, `${where}, cues`, note);
  for (const c of l.cues) {
    const cw = `${where}, cue "${c.name}"`;
    c.values = mendByFixture(c.values ?? {}, bad);
    fixNum(c, 'fade', 0, 3600, cw, note, 0);
    fixNum(c, 'fadeOut', 0, 3600, cw, note); fixNum(c, 'delay', 0, 3600, cw, note);
    c.advance = mendAdvance(c.advance, cw, note);
    if (c.effects !== undefined) { if (Array.isArray(c.effects)) c.effects = strings(c.effects); else delete c.effects; }
    if (c.actions !== undefined) {
      c.actions = objects(c.actions, `${cw}, actions`, note).filter((a) => typeof a.do === 'string');
      for (const a of c.actions) if (a.do === 'master') fixNum(a, 'level', 0, 1, cw, note, 1);
    }
    if (c.num !== undefined && !Number.isFinite(c.num)) delete c.num;
    if (c.note !== undefined && typeof c.note !== 'string') delete c.note;
  }
  if (bad.n) note(`${where}: ${plural(bad.n, 'value', 'values')} that couldn't be used left out or brought into range`);
}
// what comes after a cue: a wait, a follow or a count of beats needs its time (else: on GO)
function mendAdvance(a: unknown, where: string, note: Note): Obj {
  if (!isObj(a) || typeof a.mode !== 'string') { if (a !== undefined) note(`${where}: what comes next couldn't be read, it waits for GO`); return { mode: 'manual' }; }
  const k = a.mode === 'wait' || a.mode === 'follow' ? 'time' : a.mode === 'beats' ? 'beats' : undefined;
  if (!k) return a;
  const n = numIn(a[k], 0, k === 'time' ? 86400 : 10000);
  if (Number.isFinite(n)) { if (n !== a[k]) { note(`${where}: ${k} ${shown(a[k])} is now ${n}`); a[k] = n; } return a; }
  note(`${where}: ${k} ${shown(a[k])} isn't a usable number, it waits for GO`);
  return { mode: 'manual' };
}

// An effect: its knobs in range (FORMAT.md), its palette only colours. A knob that isn't a number
// is left out, so the effect's own default plays.
function mendEffect(e: Obj, note: Note): boolean {
  const where = `Effect "${e.name}"`;
  if (typeof e.kind !== 'string') { note(`${where}: no kind of effect, left out`); return false; }
  if (e.group !== undefined && typeof e.group !== 'string') delete e.group;
  if (e.fixtures !== undefined) { if (Array.isArray(e.fixtures)) e.fixtures = strings(e.fixtures); else { delete e.fixtures; note(`${where}: its lights couldn't be read`); } }
  if (!isObj(e.params)) { if (e.params !== undefined) note(`${where}: its settings couldn't be read, it plays its defaults`); e.params = {}; }
  const p = e.params;
  for (const [k, r] of Object.entries(KNOBS)) fixNum(p, k, r.lo, r.hi, where, note, undefined, k === 'blocks');
  if (p.colors !== undefined) {
    const cs = cleanColors(p.colors);
    if (!cs.length) { delete p.colors; note(`${where}: its colours couldn't be read, it plays its own`); }
    else if (cs.length !== p.colors.length || cs.some((c, i) => c !== p.colors[i])) { p.colors = cs; note(`${where}: colours that couldn't be read left out`); }
  }
  return true;
}

function mendPage(pg: Obj, note: Note) {
  const where = `Live page "${pg.name}"`;
  if (pg.locked !== undefined && typeof pg.locked !== 'boolean') delete pg.locked;
  pg.widgets = withIds(pg.widgets, `${where}, buttons`, note, false).filter((w) => typeof w.type === 'string');
  // a song button does one of three things; one that says something else is left out
  const songs = pg.widgets.length;
  pg.widgets = pg.widgets.filter((w: Obj) => w.type !== 'song' || ['play', 'next', 'part'].includes(w.do));
  if (pg.widgets.length < songs) note(`${where}: ${plural(songs - pg.widgets.length, 'song button', 'song buttons')} that couldn't be read left out`);
  for (const w of pg.widgets) {
    const ww = `${where}, button "${w.label ?? w.id}"`;
    for (const k of ['label', 'color', 'key']) if (w[k] !== undefined && typeof w[k] !== 'string') delete w[k];
    if (w.size !== undefined && w.size !== 1 && w.size !== 2) delete w.size;
    const m = w.midi;
    if (m !== undefined && !(isObj(m) && (m.kind === 'note' || m.kind === 'cc') && Number.isInteger(m.ch) && m.ch >= 1 && m.ch <= 16 && Number.isInteger(m.num) && m.num >= 0 && m.num <= 127)) delete w.midi;
    if (w.type === 'fog') {
      // a fog button always stops by itself: without a usable maximum it gets one
      if (!(numIn(w.max, 1, 60) >= 1)) { w.max = 10; note(`${ww}: no usable time limit, now 10 s`); }
      w.fixtures = strings(w.fixtures);
      fixNum(w, 'level', 0, 1, ww, note, 1); fixNum(w, 'burst', 0, 60, ww, note, 3); fixNum(w, 'max', 1, 60, ww, note, 10);
    } else if (w.type === 'group') {
      fixNum(w, 'level', 0, 1, ww, note, 1); fixNum(w, 'strobe', 0, 1, ww, note);
      if (w.white !== undefined && typeof w.white !== 'boolean') delete w.white;
    } else if (w.type === 'special') fixNum(w, 'seconds', 0.5, 60, ww, note);
  }
}

// Pretty for files people may open; compact (pretty: false) for the browser's storage.
export function serializeShow(show: Show, pretty = true): string {
  show.format = FORMAT;
  show.formatVersion = FORMAT_VERSION;
  show.minReaderVersion = MIN_READER;
  show.meta.modified = new Date().toISOString();
  show.meta.app = APP;
  return JSON.stringify(show, null, pretty ? 2 : undefined);
}

// The format the first prototype saved (2026-10-26, never released): { version: 1, types,
// fixtures, cues, loop, devices }, attributes dim / color as an array.
function fromDev(old: any): any {
  const s: any = emptyShow();
  s.fixtureTypes = (Array.isArray(old.types) ? old.types.filter(isObj) : []).map((t: any) => ({
    id: t.id, manufacturer: 'Custom', model: t.name, source: 'user',
    modes: [{ name: 'default', channels: (t.channels ?? []).map((c: any) => ({ ...c, attr: c.attr === 'dimmer' ? 'intensity' : c.attr })) }],
  }));
  s.fixtures = old.fixtures.filter(isObj).map((f: any) => ({ ...f, typeId: devTypeId(f.typeId), mode: 'default' }));
  const vals = (l: any) => {
    const v: any = {};
    if (l.dim !== undefined) v.intensity = l.dim;
    if (l.color) v.color = { r: l.color[0], g: l.color[1], b: l.color[2] };
    for (const k of ['white', 'pan', 'tilt', 'strobe']) if (l[k] !== undefined) v[k] = l[k];
    return v;
  };
  const cues = old.cues.filter(isObj);
  if (cues.length) {
    s.cueLists = [{
      id: 'main', name: 'Main', end: old.loop ? 'loop' : 'stop',
      cues: cues.map((c: any) => ({
        id: c.id, name: c.name, fade: c.fade ?? 2, advance: { mode: 'manual' },
        values: Object.fromEntries(Object.entries(isObj(c.looks) ? c.looks : {}).filter(([, l]) => isObj(l)).map(([id, l]) => [id, vals(l)])),
      })),
    }];
  }
  s.outputs.devices = Array.isArray(old.devices) ? old.devices : [];
  return s;
}
// The prototype's generic ids map 1:1 onto the library's.
const devTypeId = (id: string) => id;
