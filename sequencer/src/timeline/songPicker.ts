// What the song pickers (the welcome's tiles, the timeline's Demo songs) share: the catalog by
// genre in its own order, and a download's progress in words. (Not in catalog.ts: the timeline's
// e2e swaps that file for a one-song catalog with just its two lists.)
import { CATALOG, GENRES, type CatalogSong } from './catalog';

export function songsByGenre(): [string, CatalogSong[]][] {
  const m = new Map<string, CatalogSong[]>();
  for (const s of CATALOG) { const g = GENRES[s.genre] ?? s.genre; m.set(g, [...(m.get(g) ?? []), s]); }
  return [...m];
}

// "42 %" while the size is known (never 100 until it's done), else the megabytes so far
export const progressSaid = (d: { got: number; total: number }) => (d.total ? `${Math.min(99, Math.round((d.got / d.total) * 100))} %` : `${(d.got / 1e6).toFixed(1)} MB`);
