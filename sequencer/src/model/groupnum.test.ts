import { describe, expect, it } from 'vitest';
import { freezeGroupNumbers, groupByNumber, groupNumbers, nextGroupNumber } from './groupnum';
import type { Group } from './types';

const g = (id: string, num?: number): Group => ({ id, name: id, fixtures: [], ...(num ? { num } : {}) });

describe('group numbers', () => {
  it('a show from before (none have one): 1, 2, 3 by their place', () => {
    expect(groupNumbers([g('a'), g('b'), g('c')])).toEqual([1, 2, 3]);
  });
  it('frozen, then moved: each keeps its number, "group 2" is still b', () => {
    const gs = [g('a'), g('b'), g('c')];
    freezeGroupNumbers(gs);
    const moved = [gs[2], gs[0], gs[1]];
    expect(groupNumbers(moved)).toEqual([3, 1, 2]);
    expect(groupByNumber(moved, 2)?.id).toBe('b');
  });
  it('a new one gets one past the highest; one without a number takes the lowest free', () => {
    expect(nextGroupNumber([g('a', 1), g('b', 5)])).toBe(6);
    expect(groupNumbers([g('a', 2), g('b'), g('c', 1), g('d')])).toEqual([2, 3, 1, 4]);
  });
});
