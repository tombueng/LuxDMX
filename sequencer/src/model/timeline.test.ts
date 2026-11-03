import { describe, expect, it } from 'vitest';
import { clockOf, due, snap, stateAt, type TimelineItem } from './timeline';

const cue = (id: string, at: number, list: string, c: string): TimelineItem => ({ id, at, lane: `list:${list}`, do: { do: 'goto', list, cue: c } });
const items: TimelineItem[] = [
  cue('a', 0, 'L', 'intro'), cue('b', 16, 'L', 'build'), cue('c', 32, 'L', 'drop'),
  { id: 'f', at: 32, lane: 'fx', do: { do: 'effect', effect: 'rainbow', on: true }, len: 16 },
  { id: 'bo', at: 60, lane: 'special', do: { do: 'blackout', on: true } },
  cue('h', 20, 'H', 'haze'),
];

describe('the timeline', () => {
  it('plays what comes between two moments, in time order, nothing twice', () => {
    expect(due(items, 15, 33).map((i) => i.id)).toEqual(['b', 'h', 'c', 'f']);
    expect(due(items, 33, 33)).toEqual([]);
    expect(due(items, 40, 10)).toEqual([]);                  // a jump back plays nothing by itself
    expect(due(items, 47, 49).map((i) => [i.id, (i.do as { on: boolean }).on])).toEqual([['f:end', false]]);   // the effect bar ends
  });
  it('a jump puts the stage where it would be: the latest cue per list, the effects running then', () => {
    const s = stateAt(items, 40);
    expect(s.cues.get('L')?.id).toBe('c');
    expect(s.cues.get('H')?.id).toBe('h');
    expect(s.fx).toEqual(['rainbow']);
    expect(stateAt(items, 50).fx).toEqual([]);              // the effect bar is over
    expect(stateAt(items, 61).blackout).toBe(true);
    expect(stateAt(items, 10).cues.get('L')?.id).toBe('a');
  });
  it('two bars of one effect overlapping: playing and jumping agree (on till the later one ends)', () => {
    const two: TimelineItem[] = [
      { id: 'a', at: 0, lane: 'fx', do: { do: 'effect', effect: 'r', on: true }, len: 10 },
      { id: 'b', at: 5, lane: 'fx', do: { do: 'effect', effect: 'r', on: true }, len: 10 },
    ];
    expect(due(two, 9, 11).map((i) => i.id)).toEqual([]);            // the first bar's end isn't an off
    expect(due(two, 14, 16).map((i) => i.id)).toEqual(['b:end']);
    expect(stateAt(two, 12).fx).toEqual(['r']);
    expect(stateAt(two, 16).fx).toEqual([]);
  });
  it('a moment in a show file says how long, or it is dropped', async () => {
    const { validItem } = await import('./timeline');
    expect(validItem({ id: 'x', at: 1, lane: 'special', do: { do: 'burst', attr: 'flame', seconds: 1 } })).toBe(true);
    expect(validItem({ id: 'x', at: 1, lane: 'special', do: { do: 'burst', attr: 'flame' } })).toBe(false);
    expect(validItem({ id: 'x', at: 1, lane: 'special', do: { do: 'burst', attr: 'flame', seconds: 999 } })).toBe(false);
  });
  it('snaps to the beat grid and says times like a player', () => {
    expect(snap(1.1, 120)).toBeCloseTo(1, 6);
    expect(snap(1.1, 120, 4)).toBeCloseTo(2, 6);            // a bar at 120 = 2 s
    expect(snap(0.26, undefined)).toBeCloseTo(0.3, 6);
    expect(clockOf(83.44)).toBe('1:23.4');
    expect(clockOf(5, false)).toBe('0:05');
  });
});

describe("a song's parts in a show file", () => {
  it('kept in time order, one per moment; names that are names, times that are times', async () => {
    const { cleanSections } = await import('./timeline');
    expect(cleanSections([{ name: 'Chorus', at: 30, energy: 1 }, { name: 'Intro', at: 0.5 }, { name: 'Twice', at: 30 }, { name: '', at: 5 }, { name: 'Neg', at: -1 },
      { name: 'Nan', at: Number.NaN }, { name: 'Loud', at: 40, energy: 3 }, 'verse', null])).toEqual([{ name: 'Intro', at: 0.5 }, { name: 'Chorus', at: 30, energy: 1 }, { name: 'Loud', at: 40 }]);
    expect(cleanSections('intro')).toBeUndefined();
  });
  it('a show file keeps a demo song: its parts, which song it is and its credit; anything wrong goes', async () => {
    const { emptyShow, upgrade } = await import('./format');
    const load = (timeline: unknown) => { const s = emptyShow() as unknown as Record<string, unknown>; s.timeline = timeline; return upgrade(JSON.parse(JSON.stringify(s))).timeline; };
    const ok = load({ duration: 180, bpm: 120, offset: 0.5, items: [], audio: { name: 'a.mp3', duration: 180, store: 'k', catalog: 'night-bus', credit: '"Night Bus" by The Testers, CC BY' },
      sections: [{ name: 'Chorus', at: 30.5 }, { name: 'Intro', at: 0.5 }] });
    expect(ok?.sections?.map((x) => x.name)).toEqual(['Intro', 'Chorus']);
    expect(ok?.audio).toMatchObject({ catalog: 'night-bus', credit: '"Night Bus" by The Testers, CC BY' });
    const bad = load({ duration: 180, items: [], audio: { name: 'a.mp3', duration: 180, catalog: 7, credit: {} }, sections: 'intro' });
    expect(bad?.sections).toBeUndefined();
    expect(bad?.audio).toEqual({ name: 'a.mp3', duration: 180 });
    expect(load({ duration: 10, items: [], sections: [{ name: '', at: 1 }] })?.sections).toBeUndefined();
  });
});

// Before and after the song: the show can start before the song's 0 (an intro, the walk-on: things
// at times below 0) and go on after its end (the cheer, the house lights); the crowd's sound has a
// track of its own. Old files come through as they were.
describe('the time before and after the song', () => {
  it('the span runs from the start of the time before the song to the end of the time after it', async () => {
    const { spanOf } = await import('./timeline');
    expect(spanOf({ duration: 180 })).toEqual({ from: 0, to: 180 });
    expect(spanOf({ duration: 180, lead: 30, tail: 12 })).toEqual({ from: -30, to: 192 });
    expect(spanOf({ duration: 180, lead: -5, tail: Number.NaN })).toEqual({ from: 0, to: 180 });   // (nonsense: none)
    expect(spanOf(undefined)).toEqual({ from: 0, to: 0 });
  });
  it('things before the song play and jump like anywhere else', () => {
    const its: TimelineItem[] = [cue('w', -30, 'L', 'house'), cue('d', -20, 'L', 'dark'), { id: 'b', at: -5, lane: 'special', do: { do: 'burst', attr: 'blinder', seconds: 1 } }, cue('s', 0, 'L', 'song'), cue('t', 185, 'L', 'thanks')];
    expect(due(its, -31, -19).map((i) => i.id)).toEqual(['w', 'd']);
    expect(due(its, -6, 1).map((i) => i.id)).toEqual(['b', 's']);
    expect(stateAt(its, -25).cues.get('L')?.id).toBe('w');
    expect(stateAt(its, -1).cues.get('L')?.id).toBe('d');
    expect(stateAt(its, 186).cues.get('L')?.id).toBe('t');
  });
  it('a time before the song says so; snapping keeps to the start it is given', () => {
    expect(clockOf(-12.34)).toBe('-0:12.3');
    expect(clockOf(-75, false)).toBe('-1:15');
    expect(clockOf(-0.01)).toBe('0:00.0');                  // (no "-0:00.0")
    expect(snap(-1.1, 120, 1, 0, -30)).toBeCloseTo(-1, 6);
    expect(snap(-40, 120, 1, 0, -30)).toBe(-30);
    expect(snap(-1.1, 120)).toBe(0);                         // (without a start before 0: 0, as ever)
  });
  it('a show file: time before and after kept; what sits before the start left out, said; an old file as it was', async () => {
    const { emptyShow, upgrade } = await import('./format');
    const load = (timeline: unknown, notes: string[] = []) => { const s = emptyShow() as unknown as Record<string, unknown>; s.timeline = timeline; return upgrade(JSON.parse(JSON.stringify(s)), notes).timeline; };
    const old = { duration: 180, bpm: 120, offset: 0.5, items: [cue('a', 0, 'L', 'c1'), cue('b', 179, 'L', 'c2')] };
    const notes: string[] = [];
    expect(load(old, notes)).toEqual(old);
    expect(notes).toEqual([]);
    const ok = { duration: 180, lead: 30, tail: 10, items: [cue('w', -30, 'L', 'c0'), cue('a', 0, 'L', 'c1'), cue('t', 186, 'L', 'c2')],
      crowd: [{ id: 'k1', at: -30, do: { do: 'crowd', mood: 'chatter', level: 0.5 } }, { id: 'k2', at: -2, do: { do: 'cheer', level: 1 }, len: 4 }] };
    const n2: string[] = [];
    expect(load(ok, n2)).toEqual(ok);
    expect(n2).toEqual([]);
    const n3: string[] = [];
    const bad = load({ duration: 180, lead: 10, tail: 9999, items: [cue('x', -12, 'L', 'c0'), cue('a', -5, 'L', 'c1')],
      crowd: [{ id: 'k1', at: -20, do: { do: 'cheer', level: 1 } }, { id: 'k2', at: 3, do: { do: 'crowd', mood: 'sing', level: 1 } }, { id: 'k3', at: 5, do: { do: 'crowd', mood: 'clap', level: 7 }, len: 999 }, { id: 'k3', at: 6, do: { do: 'cheer', level: 1 } }] }, n3);
    expect(bad?.items.map((i) => i.id)).toEqual(['a']);                                       // (before the start: can't be played)
    expect(bad?.tail).toBe(600);
    // (an old file's clapping along: the crowd's voices without the claps, cheering at a third)
    expect(bad?.crowd).toEqual([{ id: 'k3', at: 5, do: { do: 'crowd', mood: 'cheer', level: 0.35 } }]);
    expect(n3.join(' | ')).toMatch(/1 thing .*left out/);
    expect(n3.join(' | ')).toMatch(/3 crowd moments .*left out/);
    // a file without time before the song: anything below 0 goes, as it always did
    expect(load({ duration: 10, items: [cue('x', -1, 'L', 'c0'), cue('a', 1, 'L', 'c1')] })?.items.map((i) => i.id)).toEqual(['a']);
  });
});
