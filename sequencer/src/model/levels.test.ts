// A list's level over the song (model/timeline.ts levels, its track opened on the timeline):
// straight lines between the points, theirs before the first and after the last; every list's level
// at a moment; from a file only the points that can be one, for the show's lists. The engine scales
// the list's own master with it (the fader still pulls it down), its effects too.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import { cleanLevels, levelAt, levelsAt } from './timeline';
import { emptyShow, parseShow } from './format';
import { Engine } from '../engine/engine';
import type { Cue, CueList, Show } from './types';

describe('a list\'s level over the song', () => {
  const pts: [number, number][] = [[10, 1], [20, 0.2], [30, 0.6]];
  it('straight between its points, flat before the first and after the last; one point: all song long', () => {
    expect(levelAt(pts, 0)).toBe(1); expect(levelAt(pts, 15)).toBeCloseTo(0.6, 6); expect(levelAt(pts, 25)).toBeCloseTo(0.4, 6); expect(levelAt(pts, 99)).toBe(0.6);
    expect(levelAt([[40, 0.3]], -5)).toBe(0.3); expect(levelAt([[40, 0.3]], 500)).toBe(0.3);
  });
  it('every list with points, at a moment', () => {
    expect(levelsAt({ a: pts, b: [[0, 0.5]], c: [] }, 30)).toEqual({ a: 0.6, b: 0.5 });
  });
  it('from a file: points that are [time, level] in order, one per time, the level inside 0..1, for the show\'s lists', () => {
    expect(cleanLevels({ a: [[30, 2], [10, 0.5], [10, 0.7], ['x', 1], [20]], b: 'no', gone: [[0, 1]] }, new Set(['a', 'b'])))
      .toEqual({ a: [[10, 0.5], [30, 1]] });
    expect(cleanLevels({ a: [] })).toBeUndefined();
    expect(cleanLevels([[0, 1]])).toBeUndefined();
    expect(cleanLevels('loud')).toBeUndefined();
  });
  it('a show file keeps a song\'s levels for its lists, in the set list too; a list it hasn\'t got loses them', () => {
    const s = emptyShow() as Show & Record<string, unknown>;
    s.cueLists.push({ id: 'L', name: 'Moods', cues: [], end: 'stop' });
    s.timeline = { duration: 60, items: [], levels: { L: [[5, 0.4]], X: [[5, 0.1]] } };
    (s as Record<string, unknown>).setlist = { before: [{ duration: 30, items: [], levels: { L: [[1, 2]] } }], after: [] };
    const back = parseShow(JSON.stringify(s)) as Show & { setlist: { before: { levels?: unknown }[] } };
    expect(back.timeline!.levels).toEqual({ L: [[5, 0.4]] });
    expect(back.setlist.before[0].levels).toEqual({ L: [[1, 1]] });
    // (and the published schema says the same)
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(fs.readFileSync('schema/luxdmx-show.schema.json', 'utf8')));
    expect(validate(back), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...back, timeline: { ...back.timeline, levels: { L: [[5, 4]] } } })).toBe(false);
  });
});

describe('the engine', () => {
  const cue = (values: Cue['values']): Cue => ({ id: 'c', name: 'c', values, fade: 0, advance: { mode: 'manual' } });
  const rig = () => {
    const s: Show = { ...emptyShow(), fixtures: [{ id: 'a', name: 'a', typeId: 'gen-dimmer', mode: '', universe: 0, address: 1, x: 0, y: 0 }],
      cueLists: [{ id: 'L', name: 'L', cues: [cue({ a: { intensity: 1 } })], end: 'stop' } as CueList] };
    const e = new Engine(() => s, () => 0);
    e.go('L');
    return { e, out: () => e.tick().frames.get(0)![0] };
  };
  it('scales the list\'s master with its level on the timeline; the fader still pulls it down', () => {
    const { e, out } = rig();
    expect(out()).toBe(255);
    e.levelOver = { L: 0.5 };
    expect(out()).toBe(128);
    e.setMaster('L', 0.5);
    expect(out()).toBe(64);
    e.levelOver = { other: 0 };
    expect(out()).toBe(128);
  });
});
