// A show cued to a song's parts, for the club and the party demos (the festival has its own in
// demo.ts): a look per part, several taking turns in the long ones (every 8 bars at the least),
// the big moments where the kind of part asks for them (`moments`), haze all along, and at the end
// a last hit where the outro starts and the stage going dark as the music rings out. On a song from
// the catalog (its tempo, first downbeat and parts as measured) or, without one, on the demo beat.
import type { BurstAttr, Timeline, TimelineAction, TimelineItem } from '../model/timeline';
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
  return song
    ? { duration, bpm: song.bpm, offset: song.offset, items, sections: song.sections.map((x) => ({ name: x.name, at: x.at, ...(Number.isFinite(x.energy) ? { energy: x.energy } : {}) })) }
    : { demo: true, duration, bpm: DEMO_BPM, offset: 0, items };
}
