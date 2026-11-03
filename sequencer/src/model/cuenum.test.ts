import { describe, expect, it } from 'vitest';
import { between, cueNumber, freezeNumbers, numbersFor, renumber } from './cuenum';
import type { Cue, CueList } from './types';

const cue = (name: string): Cue => ({ id: name, name, values: {}, fade: 0, advance: { mode: 'manual' } });
const list = (...names: string[]): CueList => ({ id: 'l', name: 'L', end: 'stop', cues: names.map(cue) });

describe('cue numbers', () => {
  it('in between: as round as it can be', () => {
    expect(between(20, 21)).toBe(20.5);
    expect(between(20, 20.5)).toBe(20.3);
    expect(between(20.5, 21)).toBe(20.8);
    expect(between(1, 5)).toBe(3);
    expect(between(20)).toBe(21);
    expect(between(20.5)).toBe(21);
  });
  it('a list is numbered by position until a cue goes in between; then the numbers stay', () => {
    const l = list('a', 'b', 'c');
    const added = cue('x');
    numbersFor(l, 3, [added]);                         // at the end: still by position
    expect(added.num).toBeUndefined();
    const ins = cue('y');
    numbersFor(l, 1, [ins]);
    l.cues.splice(1, 0, ins);
    expect(l.cues.map((_, i) => cueNumber(l, i))).toEqual(['1', '1.5', '2', '3']);
    const two = [cue('p'), cue('q')];
    numbersFor(l, 4, two);                             // at the end of a numbered list: the next whole ones
    expect(two.map((c) => c.num)).toEqual([4, 5]);
    renumber(l);
    expect(l.cues.map((_, i) => cueNumber(l, i))).toEqual(['1', '2', '3', '4']);
  });
  it('several pasted between two cues stay in order between them', () => {
    const l = list('a', 'b');
    const three = [cue('p'), cue('q'), cue('r')];
    numbersFor(l, 1, three);
    expect(three.map((c) => c.num)).toEqual([1.1, 1.2, 1.3]);
  });
  it('ten pasted between 20 and 21 stay apart and below 21', () => {
    const l = list(...Array.from({ length: 25 }, (_, i) => `c${i}`));
    const ten = Array.from({ length: 10 }, (_, i) => cue(`p${i}`));
    numbersFor(l, 20, ten);
    const n = ten.map((c) => c.num!);
    expect(n[0]).toBeGreaterThan(20); expect(n[9]).toBeLessThan(21);
    expect(new Set(n).size).toBe(10);
  });
  it('a cue moved out of order: the number comes from the next one above, never a duplicate', () => {
    const l = list('a', 'b', 'c', 'd');
    freezeNumbers(l);                                   // 1 2 3 4
    const moved = l.cues.splice(3, 1)[0]; l.cues.splice(1, 0, moved);   // 1 4 2 3
    const x = cue('x'); numbersFor(l, 3, [x]); l.cues.splice(3, 0, x);   // after "2": 2.5, not 3
    const y = cue('y'); numbersFor(l, 2, [y]); l.cues.splice(2, 0, y);   // after "4": 5
    const shown = l.cues.map((_, i) => cueNumber(l, i));
    expect(shown).toEqual(['1', '4', '5', '2', '2.5', '3']);
    expect(new Set(shown).size).toBe(shown.length);
  });
});
