import { describe, expect, it } from 'vitest';
import { cueSheetCsv, cueSheetHtml } from './cuesheet';
import { emptyShow } from '../model/format';

describe('the cue sheet', () => {
  const s = emptyShow();
  s.fixtures = [
    { id: 'f1', name: 'Front 1', typeId: 'gen-dimmer', mode: '', universe: 0, address: 1, x: 0.2, y: 0.5 },
    { id: 'f2', name: 'Front 2', typeId: 'gen-dimmer', mode: '', universe: 0, address: 2, x: 0.4, y: 0.5 },
    { id: 'b1', name: 'Back 1', typeId: 'gen-dimmer', mode: '', universe: 0, address: 3, x: 0.6, y: 0.5 },
  ];
  s.cueLists = [
    { id: 'show', name: 'Show', end: 'stop', cues: [{ id: 'c1', name: 'Preset', values: { f1: { intensity: 0.3 } }, fade: 2, advance: { mode: 'manual' } }] },
    { id: 'play', name: 'The Play', end: 'stop', cues: [{ id: 'p1', name: 'Dawn', values: { f1: { intensity: 0.5 }, f2: { intensity: 0.5 }, b1: { intensity: 1 } }, fade: 3, advance: { mode: 'manual' } }] },
  ];
  it('says each light\'s level, by level ("Front 1, Front 2 @ 50 %")', () => {
    const html = cueSheetHtml(s);
    expect(html).toContain('Front 1, Front 2 @ 50 % · Back 1 @ full');
  });
  it('one list only, from its own menu', () => {
    const html = cueSheetHtml(s, 'play');
    expect(html).toContain('The Play');
    expect(html).not.toContain('Preset');
  });
  it('as CSV for a German spreadsheet: ; between the columns, 2,5 for the times, a name with ; kept whole', () => {
    const t = structuredClone(s);
    t.cueLists[0].cues[0] = { ...t.cueLists[0].cues[0], fade: 2.5, delay: 1, name: 'Größe; Übung' };
    const de = cueSheetCsv(t, ',').split('\r\n');
    expect(de[0]).toBe('List;Cue;Name;Fade (s);Delay (s);Fade out (s);Then;Lights;Effects;Also;Note');
    expect(de[1].startsWith('Show;1;"Größe; Übung";2,5;1;;')).toBe(true);
    expect(cueSheetCsv(t).split('\r\n')[1].startsWith('Show,1,Größe; Übung,2.5,1,,')).toBe(true);
  });
});
