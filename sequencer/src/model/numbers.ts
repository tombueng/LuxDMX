// A light's number, the way desks have fixture IDs: what "5 @ full" and the console's strips go
// by. It stays when other lights come and go or the list is sorted (light 7 is light 7 until
// you renumber it), so a typed command, a sheet and a fader keep meaning the same light.

import type { Fixture } from './types';

export const MAX_NUM = 99999;

// Every light gets one: those without (an older show, a template, a new light) and the second of
// two with the same number get the next free ones after the highest, in list order. True if any
// changed.
export function numberFixtures(fixtures: Fixture[]): boolean {
  const seen = new Set<number>();
  let top = 0, changed = false;
  const ok = (n: number | undefined) => Number.isInteger(n) && n! >= 1 && n! <= MAX_NUM;
  for (const f of fixtures) if (ok(f.num)) top = Math.max(top, f.num!);
  for (const f of fixtures) {
    if (ok(f.num) && !seen.has(f.num!)) { seen.add(f.num!); continue; }
    // (past the top: the lowest free one)
    let n = top + 1;
    if (n > MAX_NUM) { n = 1; while (seen.has(n) || fixtures.some((x) => x !== f && x.num === n)) n++; }
    f.num = n; top = Math.max(top, n); seen.add(n); changed = true;
  }
  return changed;
}

// The lights `ids` numbered from `start` on, in list order (desks' "renumber"): '' when done, else
// what's in the way (a number another light has, or past the top). Nothing changes then.
export function renumber(fixtures: Fixture[], ids: string[], start: number): string {
  const these = fixtures.filter((f) => ids.includes(f.id));
  if (!these.length) return 'Select the lights to number';
  if (!Number.isInteger(start) || start < 1 || start + these.length - 1 > MAX_NUM) return `Numbers go from 1 to ${MAX_NUM}`;
  const want = new Set(these.map((_, i) => start + i));
  const inWay = fixtures.filter((f) => !ids.includes(f.id) && f.num !== undefined && want.has(f.num));
  if (inWay.length) return `${inWay.slice(0, 3).map((f) => `${f.num} is ${f.name}'s`).join(', ')}${inWay.length > 3 ? ` and ${inWay.length - 3} more` : ''}: start somewhere else, or number those first`;
  these.forEach((f, i) => { f.num = start + i; });
  return '';
}

// (a light by its number; none: undefined)
export const byNum = (fixtures: Fixture[], n: number) => fixtures.find((f) => f.num === n);
