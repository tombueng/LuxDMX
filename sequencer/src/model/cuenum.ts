// Cue numbers like a script's. A list is numbered by position (1, 2, 3...) until a cue goes in
// between two others: then every cue keeps the number it has, and the new one gets one in between
// (20.5 between 20 and 21), so the numbers on the director's paper stay right. Moving cues keeps
// their numbers too; Renumber makes it 1, 2, 3 again.
import type { Cue, CueList } from './types';

export const fmtNum = (n: number) => String(Math.round(n * 1000) / 1000);
export const cueNum = (list: CueList, i: number): number => list.cues[i]?.num ?? i + 1;
export const cueNumber = (list: CueList, i: number): string => (list.cues[i] ? fmtNum(cueNum(list, i)) : '');
export const numbered = (list: CueList) => list.cues.some((c) => c.num !== undefined);

// Every cue keeps the number it shows now (before something goes in between).
export function freezeNumbers(list: CueList) { list.cues.forEach((c, i) => { if (c.num === undefined) c.num = i + 1; }); }
export function renumber(list: CueList) { for (const c of list.cues) delete c.num; }

// A number after `a` and before `b` (none: the next whole one), as round as it can be: 20.5
// between 20 and 21, 20.3 between 20 and 20.5, 3 between 1 and 5.
export function between(a: number, b?: number): number {
  if (b === undefined || b <= a) return Math.floor(a) + 1;
  const mid = (a + b) / 2;
  for (const d of [1, 10, 100, 1000]) { const r = Math.round(mid * d) / d; if (r > a && r < b) return r; }
  return mid;
}

// k numbers after `a` and before `b` (none: the next whole ones). One goes in the middle, as round
// as it can be (20.5); several go in a row from the first free tenth (20.1, 20.2, 20.3).
export function spread(a: number, b: number | undefined, k: number): number[] {
  if (b === undefined || b <= a) return Array.from({ length: k }, (_, j) => Math.floor(a) + 1 + j);
  if (k === 1) return [between(a, b)];
  for (const d of [10, 100, 1000]) {
    const lo = Math.floor(a * d + 1e-9) + 1, hi = Math.ceil(b * d - 1e-9) - 1;
    if (hi - lo + 1 >= k) return Array.from({ length: k }, (_, j) => (lo + j) / d);
  }
  return Array.from({ length: k }, (_, j) => a + ((b - a) * (j + 1)) / (k + 1));
}

// New cues go in at `at` (they're not in the list yet): numbers for them. A list still numbered by
// position stays so when they go at the end; anything in between freezes the numbers first. The
// number they go before is the next one above anywhere in the list (a moved cue can sit out of order).
export function numbersFor(list: CueList, at: number, cues: Cue[]) {
  if (at >= list.cues.length && !numbered(list)) return;
  freezeNumbers(list);
  const prev = at > 0 ? cueNum(list, at - 1) : 0;
  const above = list.cues.map((_, i) => cueNum(list, i)).filter((n) => n > prev);
  const nums = spread(prev, above.length ? Math.min(...above) : undefined, cues.length);
  cues.forEach((c, k) => { c.num = nums[k]; });
}

// Another cue in the list with this number (a typed one, or after moving things around).
export const takenBy = (list: CueList, cue: Cue, n: number) => list.cues.find((c, i) => c !== cue && Math.abs(cueNum(list, i) - n) < 1e-9);
