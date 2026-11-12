// What every cue of a list looks like on its own, without playing it: for cue thumbnails and the
// show manager. In a play a cue keeps what the cues before it set for fixtures it doesn't mention,
// exactly like playback does, so each picture shows the real look at that point in the list. In a
// list of looks (`own`) a look is what it names, so that's its picture ("Hall": the hall).
import type { Color, CueList, Preset, Resolved } from '../model/types';
import { overlay, resolveValues, topLevel } from './resolve';

export function cueLooks(list: CueList, presets: Map<string, Preset>, own = false): Record<string, Resolved>[] {
  const out: Record<string, Resolved>[] = [];
  let cur: Record<string, Resolved> = {};
  for (const c of list.cues) {
    const next = own ? {} : { ...cur };
    for (const [id, v] of Object.entries(c.values)) next[id] = own ? resolveValues(v, id, presets) : overlay(cur[id], resolveValues(v, id, presets));
    out.push(next);
    cur = next;
  }
  return out;
}

// How bright a light is right now: a pixel bar by its brightest cell (what its dimmer channel gets,
// render.ts), whatever its own intensity says (a pixel chase lights a bar that's at 0; a cue that
// lights only its rim lights a ring).
export function levelOf(l: Resolved | undefined): number {
  return l ? topLevel(l) : 0;
}

// A look as one light (a beam in 3D, a dot on a plan): lit by its cells more than by itself, at
// its brightest cell's level and colour.
export function wholeLook(l: Resolved | undefined): Resolved | undefined {
  if (!l || !(l.cellVals || l.cells || l.cellLvl)) return l;
  const d = topLevel(l);
  if (d <= (l.intensity ?? 0) + 1e-3) return l;
  let cell: Color | undefined, best = -1;
  if (l.cells) for (const c of l.cells) { if (c.color && (c.intensity ?? 0) > best) { best = c.intensity ?? 0; cell = c.color; } }
  else for (const k in l.cellVals ?? {}) { const c = l.cellVals![k]; const x = l.cellLvl?.[+k] ?? c.intensity ?? 1; if (c.color && x > best) { best = x; cell = c.color; } }
  return { ...l, intensity: d, ...(cell ? { color: cell } : {}) };
}

// The colour a look shows (for drawing it): colour times intensity, white added on top.
export function lookColor(l: Resolved | undefined): { css: string; glow: number } {
  if (!l) return { css: 'rgb(0,0,0)', glow: 0 };
  const d = levelOf(l), w = l.white ?? 0;
  // (a look lit by its cells more than by itself: the colour of its brightest cell)
  let cell: Color | undefined;
  if ((l.cellVals || l.cells) && d > (l.intensity ?? 0) + 1e-3) {
    let best = -1;
    if (l.cells) for (const c of l.cells) { if (c.color && (c.intensity ?? 0) > best) { best = c.intensity ?? 0; cell = c.color; } }
    else for (const k in l.cellVals) { const c = l.cellVals[k]; const x = l.cellLvl?.[+k] ?? c.intensity ?? 1; if (c.color && x > best) { best = x; cell = c.color; } }
  }
  const { r, g, b } = l.draw ?? cell ?? l.color ?? { r: 1, g: 1, b: 1 };
  const c = (v: number) => Math.round(Math.min(1, (v + w) * d) * 255);
  return { css: `rgb(${c(r)},${c(g)},${c(b)})`, glow: d };
}
