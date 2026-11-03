// What every cue of a list looks like on its own, without playing it: for cue thumbnails and the
// show manager. In a play a cue keeps what the cues before it set for fixtures it doesn't mention,
// exactly like playback does, so each picture shows the real look at that point in the list. In a
// list of looks (`own`) a look is what it names, so that's its picture ("Hall": the hall).
import type { CueList, Preset, Resolved } from '../model/types';
import { resolveValues } from './resolve';

export function cueLooks(list: CueList, presets: Map<string, Preset>, own = false): Record<string, Resolved>[] {
  const out: Record<string, Resolved>[] = [];
  let cur: Record<string, Resolved> = {};
  for (const c of list.cues) {
    const next = own ? {} : { ...cur };
    for (const [id, v] of Object.entries(c.values)) next[id] = own ? resolveValues(v, id, presets) : { ...(cur[id] ?? {}), ...resolveValues(v, id, presets) };
    out.push(next);
    cur = next;
  }
  return out;
}

// How bright a light is right now: a pixel bar by its brightest cell (what its dimmer channel gets,
// render.ts), whatever its own intensity says (a pixel chase lights a bar that's at 0).
export function levelOf(l: Resolved | undefined): number {
  if (!l) return 0;
  if (!l.cells?.length) return l.intensity ?? 0;
  let d = 0;
  for (const c of l.cells) d = Math.max(d, c.intensity ?? 0);
  return d;
}

// The colour a look shows (for drawing it): colour times intensity, white added on top.
export function lookColor(l: Resolved | undefined): { css: string; glow: number } {
  if (!l) return { css: 'rgb(0,0,0)', glow: 0 };
  const d = levelOf(l), w = l.white ?? 0;
  const { r, g, b } = l.draw ?? l.color ?? { r: 1, g: 1, b: 1 };
  const c = (v: number) => Math.round(Math.min(1, (v + w) * d) * 255);
  return { css: `rgb(${c(r)},${c(g)},${c(b)})`, glow: d };
}
