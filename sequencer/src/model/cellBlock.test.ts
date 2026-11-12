import { describe, expect, it } from 'vitest';
import { cellBlock, cellRuns, layoutProblem, nextCell, patternChannels, repeatRows, shapeFrom } from './cellBlock';
import type { Channel } from './types';

const ch = (name: string, attr: Channel['attr'], extra: Partial<Channel> = {}): Channel => ({ name, attr, ...extra });

describe('cell blocks for pixel heads', () => {
  it('a pattern n times: names numbered from 1, cells from the next free one', () => {
    const out = cellBlock(patternChannels('rgbw'), 2, 3);
    expect(out.map((c) => [c.name, c.attr, c.cell])).toEqual([
      ['Red 4', 'red', 3], ['Green 4', 'green', 3], ['Blue 4', 'blue', 3], ['White 4', 'white', 3],
      ['Red 5', 'red', 4], ['Green 5', 'green', 4], ['Blue 5', 'blue', 4], ['White 5', 'white', 4]]);
  });
  it('rows of the table become the first cell and the rest follow in their place, ranges and defaults copied', () => {
    const chs = [ch('Pan', 'pan'), ch('Red 1', 'red'), ch('Green', 'green', { default: 3 }), ch('Macro', 'raw', { ranges: [{ from: 0, to: 9, label: 'Off' }] })];
    const out = repeatRows(chs, 1, 2, 3);
    expect(out.map((c) => [c.name, c.cell])).toEqual([['Pan', undefined], ['Red 1', 0], ['Green 1', 0], ['Red 2', 1], ['Green 2', 1], ['Red 3', 2], ['Green 3', 2], ['Macro', undefined]]);
    expect(out[4].default).toBe(3);
    expect(out[7].ranges).toEqual([{ from: 0, to: 9, label: 'Off' }]);
    // the copies don't share objects with the template
    const r = repeatRows([ch('X', 'raw', { ranges: [{ from: 0, to: 255, label: 'a' }] })], 0, 0, 2);
    r[1].ranges![0].label = 'b';
    expect(r[0].ranges![0].label).toBe('a');
  });
  it('cell numbers go on from the rest of the table', () => {
    const chs = [ch('Red 1', 'red', { cell: 0 }), ch('Green 1', 'green', { cell: 0 }), ch('Dim', 'intensity')];
    expect(nextCell(chs)).toBe(1);
    expect(repeatRows(chs, 2, 2, 2).map((c) => c.cell)).toEqual([0, 0, 1, 2]);
  });
  it('a 244-row run shows as one line: its cells and what each has', () => {
    const chs = [ch('Pan', 'pan'), ...cellBlock(patternChannels('rgbw'), 61, 0), ch('Strobe', 'strobe')];
    expect(cellRuns(chs)).toEqual([{ from: 1, to: 244, cells: 61, first: 0, last: 60, per: ['Red', 'Green', 'Blue', 'White'] }]);
  });
  it('a shape must have as many LEDs as the mode has cells', () => {
    const m = { name: 'm', channels: cellBlock(patternChannels('rgb'), 37, 0), layout: shapeFrom('rings', '1, 6, 12, 18', 0, 0) };
    expect(layoutProblem(m)).toBe('');
    expect(layoutProblem({ ...m, layout: shapeFrom('matrix', '', 6, 6) })).toMatch(/36 LEDs, but its channels have 37 cells/);
    expect(shapeFrom('rings', 'x', 0, 0)).toBeUndefined();
    expect(shapeFrom('none', '1', 1, 1)).toBeUndefined();
  });
});

describe('runs of different cells', () => {
  it('RGB cells then white cells are two runs; channels interleaved by colour stay one', () => {
    const rgb = [0, 1].flatMap((c) => [{ name: `R${c + 1}`, attr: 'red' as const, cell: c }, { name: `G${c + 1}`, attr: 'green' as const, cell: c }, { name: `B${c + 1}`, attr: 'blue' as const, cell: c }]);
    const w = [2, 3].map((c) => ({ name: `W${c + 1}`, attr: 'white' as const, cell: c }));
    expect(cellRuns([...rgb, ...w]).map((r) => [r.from, r.to, r.first, r.last, r.per])).toEqual([[0, 5, 0, 1, ['R1', 'G1', 'B1']], [6, 7, 2, 3, ['W3']]]);
    const byColour = (['red', 'green', 'blue'] as const).flatMap((a) => [0, 1, 2].map((c) => ({ name: `${a} ${c + 1}`, attr: a, cell: c })));
    expect(cellRuns(byColour).length).toBe(1);
  });
});
