import { describe, expect, it } from 'vitest';
import { byNum, numberFixtures } from './numbers';
import type { Fixture } from './types';

const f = (id: string, num?: number) => ({ id, name: id, typeId: 't', mode: 'm', universe: 0, address: 1, x: 0, y: 0, ...(num === undefined ? {} : { num }) }) as Fixture;

describe('fixture numbers', () => {
  it('a show without numbers gets them in list order', () => {
    const fs = [f('a'), f('b'), f('c')];
    expect(numberFixtures(fs)).toBe(true);
    expect(fs.map((x) => x.num)).toEqual([1, 2, 3]);
    expect(numberFixtures(fs)).toBe(false);
  });
  it('keeps the ones it has; new and doubled ones get the next after the highest', () => {
    const fs = [f('a', 5), f('b'), f('c', 5), f('d', 2)];
    numberFixtures(fs);
    expect(fs.map((x) => x.num)).toEqual([5, 6, 7, 2]);
    expect(byNum(fs, 2)?.id).toBe('d');
    expect(byNum(fs, 1)).toBeUndefined();
  });
  it('one deleted: the others keep theirs', () => {
    const fs = [f('a'), f('b'), f('c')];
    numberFixtures(fs);
    fs.splice(1, 1);
    numberFixtures(fs);
    expect(fs.map((x) => x.num)).toEqual([1, 3]);
    fs.push(f('d'));
    numberFixtures(fs);
    expect(fs.map((x) => x.num)).toEqual([1, 3, 4]);
  });
});

describe('renumbering', () => {
  it('numbers the lights from one on, in list order; a number in the way is said and nothing changes', async () => {
    const { renumber } = await import('./numbers');
    const fs = [f('a', 1), f('b', 2), f('c', 3), f('d', 4)];
    expect(renumber(fs, ['d', 'b'], 101)).toBe('');
    expect(fs.map((x) => x.num)).toEqual([1, 101, 3, 102]);
    expect(renumber(fs, ['a', 'c'], 101)).toMatch(/101 is b's, 102 is d's/);
    expect(fs.map((x) => x.num)).toEqual([1, 101, 3, 102]);
    expect(renumber(fs, ['a', 'b'], 1)).toBe('');                         // (their own numbers may swap among them)
    expect(fs.map((x) => x.num)).toEqual([1, 2, 3, 102]);
    expect(renumber(fs, ['a'], 0)).toMatch(/from 1/);
  });
});
