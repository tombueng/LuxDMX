// The 3D stage's room and the band's name in a show file: kept when they're right, dropped when
// they aren't (a room this version doesn't know is the big stage; a name is words, at most 60
// characters), and the published schema agrees.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { emptyShow, parseShow, serializeShow } from './format';

const schema = JSON.parse(fs.readFileSync('schema/luxdmx-show.schema.json', 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const withSettings = (extra: Record<string, unknown>) => { const s = emptyShow('Gig') as any; Object.assign(s.settings, extra); return JSON.stringify(s); };

describe('the 3D room and the band name in the file', () => {
  it('a pub and a name come through untouched, without notes, and pass the schema', () => {
    const notes: string[] = [];
    const s = parseShow(withSettings({ stage3d: { room: 'pub', hideVenue: true }, bandName: 'The Rusty Nails' }), notes);
    expect(s.settings.stage3d).toEqual({ room: 'pub', hideVenue: true });
    expect(s.settings.bandName).toBe('The Rusty Nails');
    expect(notes).toEqual([]);
    expect(validate(JSON.parse(serializeShow(s))), JSON.stringify(validate.errors)).toBe(true);
    expect(parseShow(withSettings({ stage3d: { room: 'hall' } })).settings.stage3d?.room).toBe('hall');
  });
  it('left out: the big stage and the band\'s picture', () => {
    const s = parseShow(serializeShow(emptyShow('Gig')));
    expect(s.settings.stage3d?.room).toBeUndefined(); expect(s.settings.bandName).toBeUndefined();
  });
  it('a room it does not know, or not a room: dropped (the big stage), the rest of stage3d kept', () => {
    for (const room of ['stadium', 3, null, { a: 1 }]) {
      const s = parseShow(withSettings({ stage3d: { room, hideVenue: true } }));
      expect(s.settings.stage3d, JSON.stringify(room)).toEqual({ hideVenue: true });
    }
    expect(validate({ ...JSON.parse(withSettings({})), settings: { bpm: 120, stage3d: { room: 'stadium' } } })).toBe(false);
  });
  it('a name: trimmed, at most 60 characters; empty or not words: dropped', () => {
    expect(parseShow(withSettings({ bandName: '  Dogs  ' })).settings.bandName).toBe('Dogs');
    expect(parseShow(withSettings({ bandName: 'x'.repeat(200) })).settings.bandName).toBe('x'.repeat(60));
    for (const bandName of ['', '   ', 42, null, ['Dogs'], { name: 'Dogs' }]) expect(parseShow(withSettings({ bandName })).settings.bandName, JSON.stringify(bandName)).toBeUndefined();
    expect(validate({ ...JSON.parse(withSettings({})), settings: { bpm: 120, bandName: '' } })).toBe(false);
    expect(validate({ ...JSON.parse(withSettings({})), settings: { bpm: 120, bandName: 'x'.repeat(61) } })).toBe(false);
  });
});
