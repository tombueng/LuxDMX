import { describe, expect, it } from 'vitest';
import { search, type Entry } from './catalog';

const e = (source: 'ofl' | 'qlc', manufacturer: string, name: string): Entry => ({ source, key: `${source}/${name}`, manufacturer, name });

describe('library search', () => {
  const all = [e('qlc', 'Cameo', 'Flat Pro 18'), e('ofl', 'Cameo', 'Flat PRO 18'), e('qlc', 'cameo', 'Flat Pro 7'), e('ofl', 'Robe', 'Robin 600E Spot')];
  it('a fixture in both libraries shows once, from the Open Fixture Library', () => {
    const r = search(all, 'cameo flat');
    expect(r.map((x) => `${x.source} ${x.name}`)).toEqual(['ofl Flat PRO 18', 'qlc Flat Pro 7']);
    expect(r[0].alt?.source).toBe('qlc');                   // the other one is still at hand
  });
  it('every word has to match, nothing for an empty search', () => {
    expect(search(all, 'robin spot').map((x) => x.name)).toEqual(['Robin 600E Spot']);
    expect(search(all, '  ')).toEqual([]);
  });
});
