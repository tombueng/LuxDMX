// The timeline: a song (or the demo beat) with things placed on it: a cue of a list, an effect on
// or off, a special (blackout, a fog burst, confetti). Playing it does each thing when the song
// gets there; jumping to a point puts the stage where it would be by then (each list on the latest
// cue placed before it, the effects that would be running). The show can start before the song
// (`lead`: an intro, the walk-on; things placed there have times below 0) and go on after it
// (`tail`: the cheer, the house lights): the song keeps its own clock, 0 is where it starts.
import type { CueAction } from './types';

// a moment of the effect machines (or every light): fog, confetti, flames, sparks, CO2, bubbles,
// a strobe or a blinder hit, for so many seconds
export type BurstAttr = 'fog' | 'confetti' | 'flame' | 'sparks' | 'co2' | 'bubbles' | 'strobe' | 'blinder';
export type TimelineAction = CueAction | { do: 'effect'; effect: string; on: boolean } | { do: 'burst'; attr: BurstAttr; seconds: number };
export interface TimelineItem {
  id: string;
  at: number;              // seconds from the start of the song
  lane: string;            // 'list:<id>', 'fx', 'special'
  do: TimelineAction;
  len?: number;            // seconds an effect bar runs (on at `at`, off at at + len)
}
// The crowd's sound (audio/crowd.ts makes it), on its own track: from a mood moment on the crowd
// waits and chats or cheers, this loud (0..1), got to over `len` seconds; a cheer swells up and
// dies away over its `len`. (Clapping along is gone: it sounded ugly. A file's old `clap` moment
// is read as cheering at a third of its level, the crowd's voices without the claps.)
export type CrowdMood = 'chatter' | 'cheer';
export type CrowdAction = { do: 'crowd'; mood: CrowdMood; level: number } | { do: 'cheer'; level: number };
export interface CrowdItem { id: string; at: number; do: CrowdAction; len?: number }
export const CROWD_MOODS: CrowdMood[] = ['chatter', 'cheer'];
export const CHEER_MAX = 30;     // seconds a cheer lasts at most (a crowd mood's change: 60)
// a part of the song: where it starts (seconds) and, for a demo song, how hard it hits (0..1)
export interface TimelineSection { name: string; at: number; energy?: number }
export interface Timeline {
  name?: string;           // the song's name in the set (unset: its file's name)
  // a file kept in this browser (store: its key); a demo song also says which (catalog: its id, to
  // download it again elsewhere) and its credit, as its licence asks
  audio?: { name: string; duration: number; store?: string; catalog?: string; credit?: string };
  demo?: boolean;          // the built-in demo beat instead of a file
  sections?: TimelineSection[];   // the song's parts (intro, verse, chorus, drop...): on the ruler, cues snap to them
  duration: number;        // seconds (the song's, or as long as the things on it)
  bpm?: number;            // for the grid and snapping
  offset?: number;         // seconds before the first beat
  items: TimelineItem[];
  lead?: number;           // seconds of show before the song starts (things there at -lead..0)
  tail?: number;           // seconds of show after it ends (up to duration + tail)
  crowd?: CrowdItem[];     // the crowd's sound, in time order
}
// before and after the song: at most ten minutes each
export const AROUND_MAX = 600;
// Where the show on this timeline starts and ends, on the song's clock: the song is 0..duration.
export function spanOf(t: Pick<Timeline, 'duration' | 'lead' | 'tail'> | undefined) {
  const lead = Number.isFinite(t?.lead) ? Math.max(0, Math.min(AROUND_MAX, t!.lead!)) : 0;
  const tail = Number.isFinite(t?.tail) ? Math.max(0, Math.min(AROUND_MAX, t!.tail!)) : 0;
  return { from: lead ? -lead : 0, to: (t?.duration ?? 0) + tail };
}

// The things whose time comes in (from, to]: in time order (a jump back plays nothing). An effect
// bar's end comes as its own "off".
export function due(items: TimelineItem[], from: number, to: number): TimelineItem[] {
  if (to <= from) return [];
  const out: TimelineItem[] = [];
  for (const i of items) {
    if (i.at > from && i.at <= to) out.push(i);
    const a = i.do;
    if (a.do === 'effect' && a.on && i.len !== undefined && i.at + i.len > from && i.at + i.len <= to) {
      const end = i.at + i.len;
      // (not while the effect still runs then by the rest of the timeline, folded in order as a jump
      // there would: playing and jumping agree)
      if (!stateAt(items, end).fx.includes(a.effect)) out.push({ ...i, id: `${i.id}:end`, at: end, do: { do: 'effect', effect: a.effect, on: false } });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// What's on at time t: for each list the latest cue placed before (or at) it, the effects that
// are running then, and whether a blackout is on.
export function stateAt(items: TimelineItem[], t: number) {
  const cues = new Map<string, TimelineItem>();
  const fx = new Map<string, boolean>();
  let blackout = false;
  for (const i of [...items].sort((a, b) => a.at - b.at)) {
    if (i.at > t) break;
    const a = i.do;
    if (a.do === 'goto') cues.set(a.list, i);
    else if (a.do === 'release') cues.delete(a.list);
    else if (a.do === 'off') { cues.clear(); fx.clear(); }
    else if (a.do === 'blackout') blackout = a.on;
    // an effect: on while a bar of it covers t (an ended bar leaves it to the others), off when told
    else if (a.do === 'effect') { if (!a.on) fx.set(a.effect, false); else if (i.len === undefined || t < i.at + i.len) fx.set(a.effect, true); }
  }
  return { cues, fx: [...fx].filter(([, on]) => on).map(([id]) => id), blackout };
}

// Snap a time to the beat grid (div beats per step: 1 a beat, 4 a bar, 0.5 an eighth); never below
// `min` (the start of the time before the song).
export function snap(t: number, bpm: number | undefined, div = 1, offset = 0, min = 0) {
  if (!bpm || bpm <= 0) return Math.max(min, Math.round(t * 10) / 10);
  const step = (60 / bpm) * div;
  return Math.max(min, offset + Math.round((t - offset) / step) * step);
}

// "1:23.4" for the transport, "1:23" on the ruler; before the song "-0:12.0"
export function clockOf(t: number, tenths = true): string {
  if (t < 0) { const c = clockOf(-t, tenths); return /[1-9]/.test(c) ? `-${c}` : c; }
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${(tenths ? s.toFixed(1) : String(Math.floor(s))).padStart(tenths ? 4 : 2, '0')}`;
}

// A song's parts as a file has them: the ones that make sense, in time order, one per moment
export function cleanSections(v: unknown): TimelineSection[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: TimelineSection[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const { name, at, energy } = x as TimelineSection;
    if (typeof name !== 'string' || !name.trim() || name.length > 40 || !Number.isFinite(at) || at < 0) continue;
    out.push(Number.isFinite(energy) && energy! >= 0 && energy! <= 1 ? { name, at, energy } : { name, at });
  }
  out.sort((a, b) => a.at - b.at);
  return out.filter((x, i) => !i || x.at > out[i - 1].at);
}
export const validTimeline = (t: unknown): t is Timeline => !!t && typeof t === 'object' && Number.isFinite((t as Timeline).duration)
  && Array.isArray((t as Timeline).items);
// (a time below 0 is in the time before the song: the reader checks it against the timeline's `lead`)
export const validItem = (i: unknown): i is TimelineItem => {
  if (!i || typeof i !== 'object') return false;
  const it = i as TimelineItem, a = it.do as { do?: string; seconds?: unknown };
  if (typeof it.id !== 'string' || !Number.isFinite(it.at) || typeof it.lane !== 'string' || !a || typeof a !== 'object') return false;
  if (it.len !== undefined && !(Number.isFinite(it.len) && it.len >= 0)) return false;
  // a moment says how long (its machines must stop by themselves)
  return a.do !== 'burst' || (typeof a.seconds === 'number' && Number.isFinite(a.seconds) && a.seconds > 0 && a.seconds <= 30);
};

// The crowd's track as a file has it: the moments that make sense (from `from` on: not before the
// show starts), one per id, in time order; a level outside 0..1 brought inside, a length that can't
// be one left out (a cheer: 4 s). Nothing usable: undefined. The same objects, so a good file comes
// back as it was.
export function cleanCrowd(v: unknown, from = 0): CrowdItem[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: CrowdItem[] = [], seen = new Set<string>();
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const it = x as CrowdItem, a = it.do as { do?: unknown; mood?: unknown; level?: unknown } | undefined;
    if (typeof it.id !== 'string' || seen.has(it.id) || !Number.isFinite(it.at) || it.at < from || !a || typeof a !== 'object') continue;
    const clap = a.do === 'crowd' && a.mood === 'clap';
    if (a.do !== 'cheer' && !(a.do === 'crowd' && (clap || CROWD_MOODS.includes(a.mood as CrowdMood)))) continue;
    if (typeof a.level !== 'number' || !Number.isFinite(a.level)) continue;
    if (a.level < 0 || a.level > 1) a.level = Math.max(0, Math.min(1, a.level));
    if (clap) { a.mood = 'cheer'; a.level = Math.round((a.level as number) * 350) / 1000; }
    const max = a.do === 'cheer' ? CHEER_MAX : 60;
    if (it.len !== undefined && !(Number.isFinite(it.len) && it.len >= 0 && it.len <= max)) { if (a.do === 'cheer') it.len = 4; else delete it.len; }
    seen.add(it.id);
    out.push(it);
  }
  if (out.some((x, i) => i && x.at < out[i - 1].at)) out.sort((a, b) => a.at - b.at);
  return out.length ? out : undefined;
}

// ---- the set list: the songs of a gig in one show, in the order they're played. The song that's
// up is `show.timeline` (the Timeline screen shows it, Play plays it); the others sit around it, so
// the set is [...before, timeline, ...after]. Next song moves it along; nothing else in the show
// changes (the patch, the cues, the effects and the pages are the whole set's).
export interface SetList {
  before: Timeline[];      // the songs before the one that's up, in order
  after: Timeline[];       // and after it
  between?: { list: string; cue: string };   // the look a song that ends by itself goes to
  countIn?: number;        // bars of clicks before a song played from its start (0: none)
}
type WithSet = { timeline?: Timeline; setlist?: SetList };

export function songsOf(s: WithSet): Timeline[] {
  if (!s.timeline) return [];
  return [...(s.setlist?.before ?? []), s.timeline, ...(s.setlist?.after ?? [])];
}
// where the song that's up is in the set (-1: no song at all)
export const songIndex = (s: WithSet) => (s.timeline ? s.setlist?.before.length ?? 0 : -1);
// what a song is called: its own name, its file's, the demo beat, or its place in the set
export function songName(t: Timeline | undefined, i = 0): string {
  const n = t?.name?.trim() || t?.audio?.name?.replace(/\.[a-z0-9]{2,4}$/i, '').trim();
  return n || (t?.demo ? 'Demo beat' : `Song ${i + 1}`);
}
// The set in this order with song `cur` up. A set of one with nothing set for it needs no set list.
export function arrange(s: WithSet, songs: Timeline[], cur: number) {
  if (!songs.length) { delete s.timeline; if (s.setlist) { s.setlist.before = []; s.setlist.after = []; } return; }
  const i = Math.max(0, Math.min(songs.length - 1, Math.round(cur)));
  const keep = !!s.setlist && (s.setlist.between !== undefined || s.setlist.countIn !== undefined);
  if (songs.length === 1 && !keep) delete s.setlist;
  else if (s.setlist) { s.setlist.before = songs.slice(0, i); s.setlist.after = songs.slice(i + 1); }
  else s.setlist = { before: songs.slice(0, i), after: songs.slice(i + 1) };
  s.timeline = songs[i];
}
export const pickSong = (s: WithSet, i: number) => arrange(s, songsOf(s), i);
// a song into the set at `at` (the end when left out); the one that's up stays up
export function addSong(s: WithSet, t: Timeline, at?: number) {
  const songs = songsOf(s), cur = songIndex(s), k = Math.max(0, Math.min(songs.length, at ?? songs.length));
  songs.splice(k, 0, t);
  arrange(s, songs, cur < 0 ? k : cur + (k <= cur ? 1 : 0));
}
// song `from` to place `to`; the one that's up stays up, wherever it goes
export function moveSong(s: WithSet, from: number, to: number) {
  const songs = songsOf(s), cur = songs[songIndex(s)];
  if (from < 0 || from >= songs.length || to < 0 || to >= songs.length || from === to) return;
  const [t] = songs.splice(from, 1);
  songs.splice(to, 0, t);
  arrange(s, songs, songs.indexOf(cur));
}
// a song out of the set; when it was the one up, the next one is (or the one before, at the end)
export function removeSong(s: WithSet, i: number) {
  const songs = songsOf(s), cur = songIndex(s);
  if (i < 0 || i >= songs.length) return;
  songs.splice(i, 1);
  arrange(s, songs, i < cur ? cur - 1 : i === cur ? Math.min(i, songs.length - 1) : cur);
}
// The song's first look: for each list it plays, the first cue placed for it (whenever that comes)
export function firstLook(items: TimelineItem[]): Map<string, TimelineItem> {
  const out = new Map<string, TimelineItem>();
  for (const i of [...items].sort((a, b) => a.at - b.at)) if (i.do.do === 'goto' && !out.has(i.do.list)) out.set(i.do.list, i);
  return out;
}
// The set's own settings: the look between songs, the count-in (null: none). A set list with
// nothing in it any more goes.
export function setOptions(s: WithSet, o: { between?: SetList['between'] | null; countIn?: number | null }) {
  if (!s.setlist) s.setlist = { before: [], after: [] };
  const sl = s.setlist;                    // (read back: the object as the show holds it)
  if (o.between !== undefined) { if (o.between) sl.between = { list: o.between.list, cue: o.between.cue }; else delete sl.between; }
  if (o.countIn !== undefined) { if (o.countIn) sl.countIn = o.countIn; else delete sl.countIn; }
  if (!sl.before.length && !sl.after.length && sl.between === undefined && sl.countIn === undefined) delete s.setlist;
}
