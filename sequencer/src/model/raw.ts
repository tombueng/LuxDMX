// Objects Svelte mustn't wrap in proxies (app.svelte.ts keeps the show in $state).
import type { Show, Values } from './types';

// Fixture types are big (a pro moving head is hundreds of channel ranges) and never edited in
// place (the editor works on a copy and saves a new object). Giving them their own prototype keeps
// Svelte from wrapping them in proxies, so reading them (every frame, every save) costs nothing.
const RawType = Object.create(Object.prototype);
export function rawType<T extends object>(t: T): T { return Object.getPrototypeOf(t) === RawType ? t : Object.setPrototypeOf(t, RawType); }
// A cue's cells the same way: a rainbow over a few matrices is thousands of small objects, and
// wrapping each one made every save (after every click) and every undo take seconds. A map of cells
// is replaced, never changed in place. (only before it goes into the show: a proxy can't be turned)
export function rawCells<T extends Values | undefined>(v: T): T {
  if (v?.cells) try { if (Object.getPrototypeOf(v.cells) !== RawType) Object.setPrototypeOf(v.cells, RawType); } catch { /* already the show's: stays as it is */ }
  return v;
}
export const rawCellMap = <T extends object>(m: T): T => { try { Object.setPrototypeOf(m, RawType); } catch { /* a proxy */ } return m; };
function rawCue<T extends { values: Record<string, Values> }>(c: T): T { for (const v of Object.values(c.values)) rawCells(v); return c; }
export function rawTypes(s: Show): Show {
  s.fixtureTypes = s.fixtureTypes.map(rawType);
  for (const l of s.cueLists) for (const c of l.cues) rawCue(c);
  for (const p of s.presets) { rawCells(p.values); for (const v of Object.values(p.perFixture ?? {})) rawCells(v); }
  return s;
}
