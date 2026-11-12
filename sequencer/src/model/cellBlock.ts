// Pixel heads, bars and multi-lamp blinders in the fixture editor: the same few channels again for
// every cell (each LED, ring or lamp), made in one go instead of typing a 265-row table by hand.
import type { Channel, ChannelAttr, FixtureMode, PixelLayout } from './types';
import { layoutCells } from './pixelLayout';

// The usual channels per cell, in the order manuals list them.
export const CELL_PATTERNS: { id: string; label: string; attrs: [ChannelAttr, string][] }[] = [
  { id: 'rgb', label: 'Red, green, blue', attrs: [['red', 'Red'], ['green', 'Green'], ['blue', 'Blue']] },
  { id: 'rgbw', label: 'Red, green, blue, white', attrs: [['red', 'Red'], ['green', 'Green'], ['blue', 'Blue'], ['white', 'White']] },
  { id: 'rgba', label: 'Red, green, blue, amber', attrs: [['red', 'Red'], ['green', 'Green'], ['blue', 'Blue'], ['amber', 'Amber']] },
  { id: 'rgbwa', label: 'Red, green, blue, white, amber', attrs: [['red', 'Red'], ['green', 'Green'], ['blue', 'Blue'], ['white', 'White'], ['amber', 'Amber']] },
  { id: 'rgbwauv', label: 'Red, green, blue, white, amber, UV', attrs: [['red', 'Red'], ['green', 'Green'], ['blue', 'Blue'], ['white', 'White'], ['amber', 'Amber'], ['uv', 'UV']] },
  { id: 'grb', label: 'Green, red, blue (some pixel strips)', attrs: [['green', 'Green'], ['red', 'Red'], ['blue', 'Blue']] },
  { id: 'drgb', label: 'Dimmer, red, green, blue', attrs: [['intensity', 'Dimmer'], ['red', 'Red'], ['green', 'Green'], ['blue', 'Blue']] },
  { id: 'drgbw', label: 'Dimmer, red, green, blue, white', attrs: [['intensity', 'Dimmer'], ['red', 'Red'], ['green', 'Green'], ['blue', 'Blue'], ['white', 'White']] },
  { id: 'd', label: 'Dimmer only (a blinder\'s lamps)', attrs: [['intensity', 'Dimmer']] },
  { id: 'w', label: 'White only', attrs: [['white', 'White']] },
  { id: 'wwcw', label: 'Warm white, cool white', attrs: [['warmWhite', 'Warm white'], ['coolWhite', 'Cool white']] },
];

export const patternChannels = (id: string): Channel[] =>
  (CELL_PATTERNS.find((p) => p.id === id)?.attrs ?? []).map(([attr, name]) => ({ name, attr }));

// the next free cell number in a mode (cells count from 0)
export const nextCell = (chs: Channel[]) => chs.reduce((a, c) => Math.max(a, (c.cell ?? -1) + 1), 0);
// "Red 12" -> "Red": a channel's name without its cell number
const baseName = (s: string) => s.replace(/\s+\d+$/, '') || s;

// n cells of the same channels, numbered from `first` (names count from 1: "Red 1", "Red 2" ...)
export function cellBlock(template: Channel[], n: number, first = 0): Channel[] {
  const out: Channel[] = [];
  for (let k = 0; k < n; k++)
    for (const c of template) {
      const { cell: _c, ...rest } = c;
      out.push({ ...JSON.parse(JSON.stringify(rest)), name: `${baseName(c.name)} ${first + k + 1}`, cell: first + k });
    }
  return out;
}

// Rows from..to of a mode's table (0-based, inclusive) are one cell's channels: they become the
// first of n cells, followed by the other n - 1, in their place. Cell numbers go on from the ones
// the rest of the table already has.
export function repeatRows(chs: Channel[], from: number, to: number, n: number): Channel[] {
  const lo = Math.max(0, Math.min(from, to)), hi = Math.min(chs.length - 1, Math.max(from, to));
  if (hi < lo || n < 1) return chs;
  const others = [...chs.slice(0, lo), ...chs.slice(hi + 1)];
  return [...chs.slice(0, lo), ...cellBlock(chs.slice(lo, hi + 1), n, nextCell(others)), ...chs.slice(hi + 1)];
}

// Runs of a table that belong to cells, for showing a 244-row block as one line: consecutive rows
// that all have a cell. `per`: the channels of its first cell, by name.
export interface CellRun { from: number; to: number; cells: number; first: number; last: number; per: string[] }
export function cellRuns(chs: Channel[]): CellRun[] {
  const out: CellRun[] = [];
  let i = 0;
  while (i < chs.length) {
    if (chs[i].cell === undefined) { i++; continue; }
    let j = i;
    while (j + 1 < chs.length && chs[j + 1].cell !== undefined) j++;
    // (cells of another make next to each other, RGB ones then white ones, are runs of their own
    // when each kind's channels sit together: so each says what it is and can be taken out alone)
    for (const [a, b] of splitByKind(chs, i, j)) {
      const run = chs.slice(a, b + 1), ids = run.map((c) => c.cell!);
      const first = Math.min(...ids), last = Math.max(...ids);
      out.push({ from: a, to: b, cells: new Set(ids).size, first, last, per: run.filter((c) => c.cell === run[0].cell).map((c) => baseName(c.name)) });
    }
    i = j + 1;
  }
  return out;
}

// A block of cell channels (i..j) cut where the cells' make changes: each cell's attributes in
// order is its make; cells of one make whose channels are all together form a piece. When the
// makes interleave (all reds, then all greens), it stays one block.
function splitByKind(chs: Channel[], i: number, j: number): [number, number][] {
  const make = new Map<number, string[]>();
  for (let k = i; k <= j; k++) { const c = chs[k]; const m = make.get(c.cell!) ?? []; m.push(c.attr); make.set(c.cell!, m); }
  const key = (cell: number) => make.get(cell)!.join(',');
  const pieces: [number, number][] = [];
  let a = i;
  for (let k = i + 1; k <= j + 1; k++) if (k > j || key(chs[k].cell!) !== key(chs[a].cell!)) { pieces.push([a, k - 1]); a = k; }
  // (each make in one piece only, or the block is interleaved: keep it whole)
  const seen = new Set<string>();
  for (const [p] of pieces) { const kk = key(chs[p].cell!); if (seen.has(kk)) return [[i, j]]; seen.add(kk); }
  return pieces;
}

// A mode's shape, if it has one, must have as many LEDs as the mode has cells (or it's ignored).
export function layoutProblem(m: FixtureMode): string {
  if (!m.layout) return '';
  const cells = nextCell(m.channels), want = layoutCells(m.layout);
  return cells === want ? '' : `Mode "${m.name}": its shape has ${want} LEDs, but its channels have ${cells} cells. Fix the Cell column, or remove the shape under the table.`;
}
// a shape from a short description: "rings 1, 6, 12, 18, 24" or a matrix's columns and rows
export function shapeFrom(kind: 'none' | 'rings' | 'matrix', rings: string, cols: number, rows: number): PixelLayout | undefined {
  if (kind === 'rings') {
    const r = rings.split(/[^0-9]+/).filter(Boolean).map(Number).filter((x) => x > 0);
    return r.length ? { kind: 'rings', rings: r } : undefined;
  }
  if (kind === 'matrix' && cols >= 1 && rows >= 1 && Number.isInteger(cols) && Number.isInteger(rows)) return { kind: 'matrix', cols, rows };
  return undefined;
}
