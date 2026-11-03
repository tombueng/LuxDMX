// The set list: the songs of a gig in one show. The song that's up is `timeline`, the others sit
// in `setlist.before` and `setlist.after`; old files with one timeline are a set of one.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { emptyShow, parseShow, serializeShow, upgrade } from './format';
import { addSong, arrange, firstLook, moveSong, pickSong, removeSong, setOptions, songIndex, songName, songsOf, type Timeline, type TimelineItem } from './timeline';
import { buskingPage } from '../content/busking';
import type { Show } from './types';

const song = (name: string, items: TimelineItem[] = []): Timeline => ({ name, duration: 180, bpm: 120, items });
const cue = (id: string, at: number, list: string, c: string): TimelineItem => ({ id, at, lane: `list:${list}`, do: { do: 'goto', list, cue: c } });
const names = (s: { timeline?: Timeline; setlist?: Show['setlist'] }) => songsOf(s).map((t, i) => songName(t, i));
const load = (extra: Record<string, unknown>, notes: string[] = []) => upgrade(JSON.parse(JSON.stringify({ ...emptyShow(), ...extra })), notes);

describe('an old file with one timeline', () => {
  it('opens as a set of one: the song is up, nothing else to move to', () => {
    const s = load({ timeline: { duration: 190, bpm: 155.8, offset: 1.765, items: [cue('a', 0, 'l1', 'c1')], audio: { name: 'Gli Shakers - Ragazzi retrò.mp3', duration: 190, store: 'k' } } });
    expect(songsOf(s)).toHaveLength(1);
    expect(songIndex(s)).toBe(0);
    expect(s.setlist).toBeUndefined();
    expect(names(s)).toEqual(['Gli Shakers - Ragazzi retrò']);       // (its file's name, without the ending)
    expect(s.timeline!.items).toHaveLength(1);
  });
  it('without any song: an empty set', () => {
    const s = load({});
    expect(songsOf(s)).toEqual([]);
    expect(songIndex(s)).toBe(-1);
  });
});

describe('a set list in a file', () => {
  it('keeps the songs in order, the one that was up still up, and its settings', () => {
    const s = load({ timeline: song('Whiskey'), setlist: { before: [song('Ragazzi')], after: [song('Going to Hell'), song('Encore')], between: { list: 'l1', cue: 'c9' }, countIn: 1 } });
    expect(names(s)).toEqual(['Ragazzi', 'Whiskey', 'Going to Hell', 'Encore']);
    expect(songIndex(s)).toBe(1);
    expect(s.setlist).toMatchObject({ between: { list: 'l1', cue: 'c9' }, countIn: 1 });
    // and saved and opened again, the same
    const again = parseShow(serializeShow(s));
    expect(names(again)).toEqual(names(s));
    expect(songIndex(again)).toBe(1);
  });
  it('mends what it can: a broken song left out (said), bad settings dropped, a song up when none was', () => {
    const notes: string[] = [];
    const s = load({ setlist: { before: [song('A'), null, { duration: 'x' }], after: [song('B'), { ...song('C'), bpm: -5, name: 7 }], between: { list: 3 }, countIn: 9 } }, notes);
    expect(names(s)).toEqual(['A', 'B', 'Song 3']);                  // (no timeline: the first after it is up; a name that isn't one goes)
    expect(songIndex(s)).toBe(1);
    expect(s.timeline?.name).toBe('B');
    expect(songsOf(s)[2].bpm).toBe(20);
    expect(songsOf(s)[2].name).toBeUndefined();
    expect(s.setlist?.between).toBeUndefined();
    expect(s.setlist?.countIn).toBe(2);
    expect(notes.join('\n')).toMatch(/The set list: 2 songs that couldn't be read left out/);
    expect(notes.join('\n')).toMatch(/The set list, song \d: bpm -5 is now 20/);
    expect(notes.join('\n')).not.toMatch(/The song "A"/);                 // (A was fine: nothing said about it)
    expect(load({ setlist: 'yes' }).setlist).toBeUndefined();
  });
  it('a song button that does something unknown is left out; the three that exist stay', () => {
    const notes: string[] = [];
    const s = load({ pages: [{ id: 'p', name: 'Gig', widgets: [{ id: 'a', type: 'song', do: 'play' }, { id: 'b', type: 'song', do: 'next' }, { id: 'c', type: 'song', do: 'part' }, { id: 'd', type: 'song', do: 'encore' }] }] }, notes);
    expect(s.pages[0].widgets.map((w) => w.id)).toEqual(['a', 'b', 'c']);
    expect(notes.join()).toMatch(/1 song button that couldn't be read left out/);
  });
  it('passes the published JSON Schema, with its song buttons', () => {
    const schema = JSON.parse(fs.readFileSync('schema/luxdmx-show.schema.json', 'utf8'));
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    const s = load({ timeline: song('Whiskey', [cue('a', 1, 'l1', 'c1')]), setlist: { before: [song('Ragazzi')], after: [song('Going to Hell')], between: { list: 'l1', cue: 'c1' }, countIn: 1 } });
    s.pages = [buskingPage(s)];
    expect(s.pages[0].widgets.filter((w) => w.type === 'song').length).toBe(3);
    const ok = validate(JSON.parse(serializeShow(s)));
    expect(ok ? [] : validate.errors!.map((e) => `${e.instancePath} ${e.message}`)).toEqual([]);
    // (and the schema says what can't be played)
    const bad = JSON.parse(serializeShow(s));
    bad.setlist.countIn = 5; bad.setlist.after[0].items = [{ id: 'x', at: 1, lane: 'special', do: { do: 'burst', attr: 'flame' } }];
    expect(validate(bad)).toBe(false);
  });
});

describe('the set list', () => {
  const set = () => { const s: { timeline?: Timeline; setlist?: Show['setlist'] } = {}; arrange(s, [song('1'), song('2'), song('3')], 0); return s; };
  it('Next song moves along it, the songs stay in order and in one place each', () => {
    const s = set();
    expect(names(s)).toEqual(['1', '2', '3']);
    pickSong(s, songIndex(s) + 1);
    expect(s.timeline?.name).toBe('2');
    expect(s.setlist?.before.map((t) => t.name)).toEqual(['1']);
    expect(s.setlist?.after.map((t) => t.name)).toEqual(['3']);
    pickSong(s, 2);
    expect(names(s)).toEqual(['1', '2', '3']);
    expect(songIndex(s)).toBe(2);
    // every song once (no song held in two places of the file)
    const all = [...(s.setlist?.before ?? []), s.timeline, ...(s.setlist?.after ?? [])];
    expect(new Set(all).size).toBe(3);
  });
  it('adding, moving and removing keep the one that is up', () => {
    const s = set();
    pickSong(s, 1);
    addSong(s, song('0'), 0);
    expect(names(s)).toEqual(['0', '1', '2', '3']);
    expect(s.timeline?.name).toBe('2');
    addSong(s, song('4'));
    expect(names(s)).toEqual(['0', '1', '2', '3', '4']);
    moveSong(s, 2, 4);                                   // the one up goes last: still up
    expect(names(s)).toEqual(['0', '1', '3', '4', '2']);
    expect(s.timeline?.name).toBe('2');
    moveSong(s, 0, 1);
    expect(names(s)).toEqual(['1', '0', '3', '4', '2']);
    removeSong(s, 0);
    expect(names(s)).toEqual(['0', '3', '4', '2']);
    expect(s.timeline?.name).toBe('2');
    removeSong(s, 3);                                    // the one up goes: the one before it is up (it was last)
    expect(names(s)).toEqual(['0', '3', '4']);
    expect(s.timeline?.name).toBe('4');
    removeSong(s, 0); removeSong(s, 0);
    expect(names(s)).toEqual(['4']);
    expect(s.setlist).toBeUndefined();                   // a set of one with nothing set: no set list
  });
  it('the first song added to a show without one is up', () => {
    const s: { timeline?: Timeline; setlist?: Show['setlist'] } = {};
    addSong(s, song('First'));
    expect(s.timeline?.name).toBe('First');
    expect(s.setlist).toBeUndefined();
  });
  it('its settings: a count-in and the look between songs; a set of one keeps them', () => {
    const s = set();
    setOptions(s, { countIn: 1, between: { list: 'L', cue: 'c' } });
    expect(s.setlist).toMatchObject({ countIn: 1, between: { list: 'L', cue: 'c' } });
    removeSong(s, 0); removeSong(s, 0);
    expect(s.setlist).toMatchObject({ before: [], after: [], countIn: 1 });
    setOptions(s, { countIn: null, between: null });
    expect(s.setlist).toBeUndefined();
  });
  it('names: its own, its file\'s, the demo beat, or its place', () => {
    expect(songName({ duration: 1, items: [], name: '  Encore ' })).toBe('Encore');
    expect(songName({ duration: 1, items: [], audio: { name: 'Night Bus.mp3', duration: 1 } })).toBe('Night Bus');
    expect(songName({ duration: 1, items: [], demo: true })).toBe('Demo beat');
    expect(songName({ duration: 1, items: [] }, 4)).toBe('Song 5');
  });
  it("a song's first look: the first cue placed for each list it plays, whenever it comes", () => {
    const f = firstLook([cue('b', 30, 'L', 'chorus'), cue('a', 14, 'L', 'verse'), cue('h', 2, 'H', 'haze'), { id: 'x', at: 0, lane: 'special', do: { do: 'burst', attr: 'confetti', seconds: 1 } }]);
    expect([...f].map(([l, i]) => [l, i.id])).toEqual([['H', 'h'], ['L', 'a']]);
  });
});
