import { describe, expect, it } from 'vitest';
import { buskingPage, isMachineList, looksPage } from './busking';
import { emptyShow } from '../model/format';
import type { CueList } from '../model/types';

const list = (id: string, cues: CueList['cues']): CueList => ({ id, name: id, end: 'loop', cues });
const cue = (id: string, values: CueList['cues'][number]['values'], effects?: string[]) => ({ id, name: id, values, fade: 0, advance: { mode: 'manual' as const }, ...(effects ? { effects } : {}) });

describe('the generated live page', () => {
  it('a fog timer sits with the fog; a list of effect-only cues stays a cue list with its key', () => {
    const s = emptyShow();
    s.cueLists = [
      list('main', [cue('a', {})]),
      list('timer', [cue('on', { fog1: { fog: 1 } }), cue('off', { fog1: { fog: 0 } })]),
      list('fx', [cue('x', {}, ['e1'])]),
    ];
    const w = buskingPage(s).widgets;
    const ids = w.map((x) => x.id);
    expect(ids.indexOf('tog-timer')).toBeGreaterThan(ids.indexOf('h-sfx'));
    expect(ids.indexOf('tog-fx')).toBeGreaterThan(ids.indexOf('h-lists'));
    expect(ids.indexOf('tog-fx')).toBeLessThan(ids.indexOf('h-sfx'));
    expect(w.find((x) => x.id === 'tog-fx')?.key).toBe('q');
  });
});

describe('the staff page of looks', () => {
  it('the looks of the main list (not a fog timer), keys on the first ten, no GO on it', () => {
    const s = emptyShow();
    s.cueLists = [list('timer', [cue('on', { fog1: { fog: 1 } }), cue('off', { fog1: { fog: 0 } })]),
      list('moods', Array.from({ length: 12 }, (_, i) => cue(`m${i}`, { p: { intensity: i / 12 } })))];
    const pg = looksPage(s, 'pg1');
    expect(pg.go).toBe(false);
    expect(pg.widgets.map((w) => w.type)).toEqual(Array(12).fill('cue'));
    expect(pg.widgets.slice(0, 10).every((w) => w.key)).toBe(true);
    expect(pg.widgets[10].key).toBeUndefined();
  });
  it('every list of looks, each under its name; not the house lights over the others', () => {
    const s = emptyShow();
    s.cueLists = [list('church', [cue('a', { p: { intensity: 1 } })]), list('hall', [cue('b', { q: { intensity: 1 } })]),
      { ...list('house', [cue('h', { r: { intensity: 1 } })]), priority: 'high' }];
    const pg = looksPage(s, 'pg');
    expect(pg.widgets.map((w) => (w.type === 'label' ? w.label : w.type))).toEqual(['church', 'cue', 'hall', 'cue']);
  });
  it('more than 16 moods: the generated page has them all (up to 48)', () => {
    const s = emptyShow();
    s.cueLists = [list('moods', Array.from({ length: 20 }, (_, i) => cue(`m${i}`, { p: { intensity: 0.5 } })))];
    expect(buskingPage(s).widgets.filter((w) => w.type === 'cue').length).toBe(20);
  });
});

describe('the effect machines', () => {
  const shot = (id: string, values: CueList['cues'][number]['values']): CueList => ({ id, name: id, end: 'release', releaseTime: 0, cues: [{ id: `${id}1`, name: 'Shot', values, fade: 0, advance: { mode: 'wait', time: 0.5 } }] });
  it('a list that only fires machines is a shot: its own section, a tap fires it, no master fader, not a look for staff', () => {
    const s = emptyShow();
    s.cueLists = [shot('conf', { c1: { confetti: 1 } }), list('moods', [cue('a', { p: { intensity: 1 } })]), shot('bub', { b1: { bubbles: 1, fan: 1 } }), list('haze', [cue('h', { hz: { haze: 0.3, fan: 0.5 } })])];
    expect(s.cueLists.map(isMachineList)).toEqual([true, false, true, false]);
    const w = buskingPage(s).widgets, ids = w.map((x) => x.id);
    // the looks are the first list that isn't a machine's shot
    expect(w.find((x) => x.type === 'cue')).toMatchObject({ list: 'moods', key: '1' });
    expect(ids.indexOf('h-machines')).toBeLessThan(ids.indexOf('sfx-conf'));
    expect(w.find((x) => x.id === 'sfx-conf')).toMatchObject({ type: 'list', list: 'conf', action: 'toggle' });
    expect(w.find((x) => x.id === 'sfx-bub')).toMatchObject({ type: 'list', list: 'bub', action: 'toggle' });
    expect(ids).not.toContain('tog-conf');
    expect(ids).not.toContain('lvl-conf');
    expect(ids).toContain('lvl-moods');
    // haze with its fan sits with the fog, not with the cue lists
    expect(ids.indexOf('tog-haze')).toBeGreaterThan(ids.indexOf('h-sfx'));
    expect(ids).not.toContain('h-lists');
    expect(looksPage(s, 'pg').widgets.map((x) => (x.type === 'cue' ? x.list : x.type))).toEqual(['moods']);
  });
  it('a light that is not a machine, or a list with nothing in it, is not a shot', () => {
    expect(isMachineList(shot('x', { p: { intensity: 1, confetti: 1 } }))).toBe(false);
    expect(isMachineList(shot('y', {}))).toBe(false);
    expect(isMachineList(shot('z', { b: { fan: 1 } }))).toBe(false);
  });
});

describe('fog or haze', () => {
  it('a hazer is "Haze" on the generated page, a fog machine "Fog"', () => {
    const s = emptyShow();
    s.fixtures = [{ id: 'h', name: 'Hazer', typeId: 'gen-hazer', mode: '', universe: 0, address: 1, x: 0.5, y: 0.5 }];
    s.cueLists = [list('m', [cue('a', {})])];
    expect(buskingPage(s).widgets.find((w) => w.type === 'fog')?.label).toBe('Haze');
    s.fixtures[0].typeId = 'gen-fog';
    expect(buskingPage(s).widgets.find((w) => w.type === 'fog')?.label).toBe('Fog');
  });
});
