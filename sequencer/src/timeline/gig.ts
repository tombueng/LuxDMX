// Playing a song live with a band: where Play from the start begins (on the band's "one"), the
// parts of a song to jump on to, and the beat a jump waits for. Plain functions of the song, so the
// player, the live buttons and the tests agree.
import type { Timeline, TimelineItem } from '../model/timeline';
import { sectionStarts } from './beat';

const beatOf = (tl: Timeline) => (tl.bpm !== undefined && Number.isFinite(tl.bpm) && tl.bpm >= 20 && tl.bpm <= 300 ? 60 / tl.bpm : 0);
const offsetOf = (tl: Timeline) => (Number.isFinite(tl.offset) ? Math.max(0, tl.offset!) : 0);

// Play from the start: a beat before the first downbeat (the silence before it is skipped), so
// pressed on the drummer's "four" the song's "one" comes with the band's. With a count-in, a bar of
// clicks (on the song's clock: `clicks`) and the song comes in on its first downbeat; the clock
// then starts before 0. Without a tempo: from the very start.
export function startOf(tl: Timeline, countIn = 0): { from: number; downbeat: number; clicks: number[] } {
  const beat = beatOf(tl), downbeat = offsetOf(tl);
  if (!beat || downbeat >= tl.duration) return { from: 0, downbeat: 0, clicks: [] };
  const bars = Math.max(0, Math.min(2, Math.round(countIn || 0)));
  if (!bars) return { from: Math.max(0, downbeat - beat), downbeat, clicks: [] };
  const from = downbeat - bars * 4 * beat;
  return { from, downbeat, clicks: Array.from({ length: bars * 4 }, (_, k) => from + k * beat) };
}

// The parts of a song to go on to: its sections (the demo beat has its own); a song without any:
// the cues placed on it, each a part. In time order, one per moment.
export interface Part { name: string; at: number }
export function partsOf(tl: Timeline, cueName?: (i: TimelineItem) => string): Part[] {
  const raw: Part[] = tl.sections?.length ? tl.sections.map((s) => ({ name: s.name, at: s.at }))
    : tl.demo && !tl.audio ? sectionStarts().map((s) => ({ name: s.name, at: s.at }))
      : tl.items.filter((i) => i.do.do === 'goto').map((i) => ({ name: cueName?.(i) ?? '', at: i.at }));
  raw.sort((a, b) => a.at - b.at);
  return raw.filter((p, i) => p.at < tl.duration && (!i || p.at > raw[i - 1].at + 0.01));
}
// the part that comes after time t (not one starting right there: that's the one it's in)
export const partAfter = (parts: Part[], t: number) => parts.find((p) => p.at > t + 0.05);
// the part t is in
export function partAt(parts: Part[], t: number): Part | undefined {
  let cur: Part | undefined;
  for (const p of parts) { if (p.at <= t + 0.05) cur = p; else break; }
  return cur;
}
// The next beat of the song after t (its grid starts at the first downbeat). No tempo: t itself.
export function beatAfter(tl: Timeline, t: number): number {
  const beat = beatOf(tl);
  if (!beat) return t;
  const o = offsetOf(tl), k = Math.floor((t - o) / beat + 1e-6) + 1;
  return o + k * beat;
}
