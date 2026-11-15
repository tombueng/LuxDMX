// A show cued to a song's parts, for the club and the party demos (the festival has its own in
// demo.ts): a look per part, several taking turns in the long ones (every 8 bars at the least),
// the big moments where the kind of part asks for them (`moments`), haze all along, and at the end
// a last hit where the outro starts and the stage going dark as the music rings out. On a song from
// the catalog (its tempo, first downbeat and parts as measured) or, without one, on the demo beat.
import type { BurstAttr, CrowdAction, CrowdItem, Timeline, TimelineAction, TimelineItem } from '../model/timeline';
import type { Show } from '../model/types';
import type { RoomId } from '../stage3d/geometry';
import { BAR_S, DEMO_BPM, DEMO_SECONDS, sectionStarts } from '../timeline/beat';
import { partKind, type DemoSong } from './demo';

export type PartKind = ReturnType<typeof partKind>;
// a part of the song as the cueing sees it: where it starts and ends (seconds), how many bars, what
// kind it is, the how-many-th of its kind (0: the first), whether it's the last chorus
export interface Part { name: string; at: number; end: number; bars: number; energy: number; kind: PartKind; n: number; lastChorus: boolean }
export interface Cuer {
  bar: number;                                     // seconds a bar
  duration: number;
  put: (t: number, lane: string, a: TimelineAction, len?: number) => void;
  cue: (t: number, key: string) => void;           // a look of the main list (by its key)
  burst: (t: number, attr: BurstAttr, seconds: number) => void;
  fx: (t: number, effect: string, bars: number) => void;   // an effect for so many bars (cut at the end)
}
export interface CueOpts {
  list: string;                                    // the main list's id
  looks: Record<string, string>;                   // its looks: key -> cue id
  sets: Record<PartKind, string[][]>;              // the looks for each kind of part, a set per time it comes round
  lastChorus: string[];                            // the biggest set, for the last chorus
  haze?: { list: string; cue: string };            // a haze list's cue, on from the start
  end: string;                                     // the key of the look the show ends on (dark)
  moments: (p: Part, c: Cuer) => void;             // the machines and the hits for a part
  crowd?: CrowdKind;                               // the audience on the crowd track (and SHOW_LEAD s of show before the song)
}
// a concert crowd cheers the band on and on every chorus; a party's on the drops; a theatre, church
// or cinema audience murmurs before, is quiet through it and cheers at the end; a bar chats all along
export type CrowdKind = 'concert' | 'party' | 'calm' | 'bar';
// seconds of show before the song (the audience waiting) and after it (cheering, then chatting)
export const SHOW_LEAD = 8, SHOW_TAIL = 6;

// The audience's sound for a show of `kind` on the song's parts (the crowd track, audio/crowd.ts
// plays it, and a render has it too)
export function crowdTrack(kind: CrowdKind, parts: Part[], duration: number): CrowdItem[] {
  const out: CrowdItem[] = [];
  const cr = (at: number, a: CrowdAction, len = 0) => out.push({ id: `tc${out.length + 1}`, at: +at.toFixed(3), do: a, ...(len ? { len } : {}) });
  const mood = (at: number, m: 'chatter' | 'cheer', level: number, len = 0) => cr(at, { do: 'crowd', mood: m, level }, len);
  const cheer = (at: number, level: number, len = 4) => cr(at, { do: 'cheer', level }, len);
  const lead = -SHOW_LEAD, choruses = parts.filter((p) => p.kind === 'chorus');
  // (a cheer swells up on its own; the crowd's mood follows a moment later, so the two never start
  // together: on the timeline's crowd lane they were clips on top of each other)
  const LAG = 1.6;
  // waiting: chatting (a bar's a little louder, a church's hushed)
  mood(lead, 'chatter', kind === 'bar' ? 0.55 : kind === 'calm' ? 0.4 : 0.5);
  if (kind === 'concert' || kind === 'party') {
    // the music starts: a cheer, cheering that dies away into the first part
    cheer(-0.3, kind === 'concert' ? 1 : 0.7, 6); mood(-0.3 + LAG, 'cheer', kind === 'concert' ? 0.8 : 0.55, 0.5); mood(5, 'cheer', 0, 8);
    // every chorus (a drop at the party) gets its cheer, the last one the biggest
    for (const p of choruses) { const big = p.lastChorus; cheer(p.at, big ? 0.9 : kind === 'party' ? 0.65 : 0.5, big ? 6 : 4); if (kind === 'party' || big) { mood(p.at + LAG, 'cheer', big ? 0.6 : 0.4, 0.5); mood(p.at + 6, 'cheer', 0, 6); } }
  } else if (kind === 'calm') {
    mood(-2, 'chatter', 0, 3);                      // (hushed as it starts)
  } else {
    // a bar: the chatting goes on under the music, someone cheers on a chorus
    mood(0, 'chatter', 0.4, 4);
    for (const p of choruses) cheer(p.at, p.lastChorus ? 0.5 : 0.3, 3);
  }
  // the end: cheering, then chatting as they get up
  const last = [...parts].reverse().find((p) => p.kind === 'outro');
  const end = Math.max(0, (last ? last.end : duration) - 0.5);
  cheer(end, kind === 'bar' ? 0.6 : 1, 6); mood(end + LAG, 'cheer', kind === 'bar' ? 0.5 : 0.8, 1); mood(end + 4.5, 'chatter', 0.4, 4);
  return out.sort((a, b) => a.at - b.at);
}


// The room the 3D stage shows the show in. (The show file's type names only the hall and the pub
// so far; the 3D stage knows every room in geometry.ts ROOMS.)
export function inRoom(s: Show, room: RoomId) {
  s.settings.stage3d = { ...s.settings.stage3d, room: room as NonNullable<Show['settings']['stage3d']>['room'] };
}

// the parts of a song, or of the demo beat
export function partsOf(song?: DemoSong): { parts: Part[]; bar: number; duration: number } {
  const bar = song ? (60 / song.bpm) * 4 : BAR_S, duration = song ? song.duration : DEMO_SECONDS;
  const raw = song
    ? song.sections.map((x, i, a) => ({ name: x.name, at: x.at, end: i + 1 < a.length ? a[i + 1].at : song.duration, energy: x.energy }))
    : sectionStarts().map((x) => ({ name: x.name, at: x.at, end: x.end, energy: x.energy }));
  const seen: Partial<Record<PartKind, number>> = {};
  const parts: Part[] = raw.map((x) => {
    const kind = partKind(x.name, Number.isFinite(x.energy) ? x.energy : undefined), n = seen[kind] ?? 0;
    seen[kind] = n + 1;
    return { ...x, energy: Number.isFinite(x.energy) ? (x.energy as number) : 0.7, kind, n, bars: Math.max(1, Math.round((x.end - x.at) / bar)), lastChorus: false };
  });
  const choruses = parts.filter((p) => p.kind === 'chorus');
  if (choruses.length > 1) choruses[choruses.length - 1].lastChorus = true;
  return { parts, bar, duration };
}

export function cueParts(song: DemoSong | undefined, o: CueOpts): Timeline {
  const { parts, bar, duration } = partsOf(song);
  const items: TimelineItem[] = [];
  let n = 0;
  const put: Cuer['put'] = (t, lane, a, len) => {
    const at = Math.max(0, Math.min(duration, t));
    items.push({ id: `ct${++n}`, at, lane, do: a, ...(len ? { len: Math.max(0.1, Math.min(len, duration - at)) } : {}) });
  };
  const c: Cuer = {
    bar, duration, put,
    cue: (t, key) => put(t, `list:${o.list}`, { do: 'goto', list: o.list, cue: o.looks[key] }),
    // (a burst is at most 30 s: machines never run on for longer than that from a file)
    burst: (t, attr, seconds) => put(t, 'special', { do: 'burst', attr, seconds: Math.min(30, Math.max(0.1, seconds)) }),
    fx: (t, effect, bars) => put(t, 'fx', { do: 'effect', effect, on: true }, bars * bar),
  };
  for (const p of parts) {
    const sets = o.sets[p.kind], looks = p.lastChorus ? o.lastChorus : sets[p.n % sets.length];
    const each = Math.max(8, Math.floor(p.bars / looks.length));
    looks.forEach((k, i) => { if (i * each < p.bars) c.cue(p.at + i * each * bar, k); });
    o.moments(p, c);
  }
  // the end: a last hit where the outro starts (or four bars before the end), then dark as it rings out
  const outro = [...parts].reverse().find((p) => p.kind === 'outro');
  const hit = outro ? outro.at : Math.max(0, duration - 4 * bar);
  c.burst(Math.max(0, hit - 0.05), 'blinder', 1.2);
  c.cue(Math.max(hit + bar, duration - 7), o.end);
  if (o.haze) {
    put(0, `list:${o.haze.list}`, { do: 'goto', list: o.haze.list, cue: o.haze.cue });
    put(Math.max(0, duration - 6), `list:${o.haze.list}`, { do: 'release', list: o.haze.list });
  }
  items.sort((a, b) => a.at - b.at);
  // the audience: waiting before the song, then as the room has it (crowdTrack)
  const crowd = o.crowd ? { lead: SHOW_LEAD, tail: SHOW_TAIL, crowd: crowdTrack(o.crowd, parts, duration) } : {};
  return song
    ? { duration, bpm: song.bpm, offset: song.offset, items, sections: song.sections.map((x) => ({ name: x.name, at: x.at, ...(Number.isFinite(x.energy) ? { energy: x.energy } : {}) })), ...crowd }
    : { demo: true, duration, bpm: DEMO_BPM, offset: 0, items, ...crowd };
}
