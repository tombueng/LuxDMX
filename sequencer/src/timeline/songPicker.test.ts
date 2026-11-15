// The song pickers' shared bits: every catalog song once, under its genre's name, in the catalog's
// order; a download's progress in words.
import { describe, expect, it } from 'vitest';
import { CATALOG, GENRES } from './catalog';
import { progressSaid, songsByGenre } from './songPicker';

describe('the song pickers', () => {
  it('every song once, under its genre, in the catalog\'s order', () => {
    const g = songsByGenre();
    expect(g.flatMap(([, s]) => s).length).toBe(CATALOG.length);
    for (const [name, songs] of g) for (const s of songs) expect(GENRES[s.genre] ?? s.genre).toBe(name);
    const first = g[0][1][0];
    expect(first).toBe(CATALOG.find((s) => (GENRES[s.genre] ?? s.genre) === g[0][0]));
  });
  it('progress: percent while the size is known (never 100 before the end), else megabytes', () => {
    expect(progressSaid({ got: 50, total: 200 })).toBe('25 %');
    expect(progressSaid({ got: 200, total: 200 })).toBe('99 %');
    expect(progressSaid({ got: 2_500_000, total: 0 })).toBe('2.5 MB');
  });
});
