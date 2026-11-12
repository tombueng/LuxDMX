import { describe, expect, it } from 'vitest';
import { cellsText, parseCells } from './cellPick';

describe('cells by typing', () => {
  it('runs, single cells, steps, backwards, words for the dash, from 1 to 0-based', () => {
    expect(parseCells('1-4, 7', 10).cells).toEqual([0, 1, 2, 3, 6]);
    expect(parseCells('2-9/3', 10).cells).toEqual([1, 4, 7]);
    expect(parseCells('/4', 10).cells).toEqual([0, 4, 8]);
    expect(parseCells('5-2', 10).cells).toEqual([4, 3, 2, 1]);           // (the order a rainbow takes)
    expect(parseCells('1 thru 3 + 9 to 10', 10).cells).toEqual([0, 1, 2, 8, 9]);
    expect(parseCells('1-3, 2-4', 10).cells).toEqual([0, 1, 2, 3]);       // each once
    expect(parseCells('8-20', 10).cells).toEqual([7, 8, 9]);              // past the end: the ones it has
  });
  it('says what it can\'t read', () => {
    expect(parseCells('1-3, x, 0, -2', 10)).toEqual({ cells: [0, 1, 2], bad: ['x', '0', '-2'] });
  });
  it('and back to words, as short as they go', () => {
    expect(cellsText([0, 1, 2, 3, 6, 9, 8])).toBe('1-4, 7, 10-9');   // (in the order given)
    expect(cellsText([])).toBe('');
  });
});

describe('cells by typing (review cycle 2)', () => {
  it('a backwards run stays backwards in words; huge numbers stop at the last cell', () => {
    expect(cellsText([15, 14, 13, 12])).toBe('16-13');
    expect(cellsText([0, 1, 2, 9, 8, 7])).toBe('1-3, 10-8');
    expect(parseCells('1-9999999999', 5).cells).toEqual([0, 1, 2, 3, 4]);
    expect(parseCells('9999999999-4', 5).cells).toEqual([4, 3]);
  });
});
