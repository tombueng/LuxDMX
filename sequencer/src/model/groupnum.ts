// A group's number on the console ("group 5"). It keeps the number it was given, so moving it up
// the list or removing another group doesn't make "group 5" a different group (it did: groups
// counted by their place). A show from before has none: its groups count by their place, and the
// first change that would move them (a reorder, a group removed or added) writes those numbers
// down first.
import type { Group } from './types';

// The number of each group, in list order: its own, else the lowest one not taken, in order.
export function groupNumbers(groups: Group[]): number[] {
  const taken = new Set(groups.flatMap((g) => (g.num ? [g.num] : [])));
  let next = 1;
  return groups.map((g) => {
    if (g.num) return g.num;
    while (taken.has(next)) next++;
    taken.add(next);
    return next;
  });
}
// Every group gets the number it shows now (before the list changes around it).
export function freezeGroupNumbers(groups: Group[]) {
  const nums = groupNumbers(groups);
  groups.forEach((g, i) => { g.num = nums[i]; });
}
// For a new group: one past the highest.
export function nextGroupNumber(groups: Group[]): number {
  return Math.max(0, ...groupNumbers(groups)) + 1;
}
export function groupByNumber(groups: Group[], n: number): Group | undefined {
  const nums = groupNumbers(groups), i = nums.indexOf(n);
  return i >= 0 ? groups[i] : undefined;
}
