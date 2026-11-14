// What the programmer and Record do with a light's values: cells split off and merged, what a cue
// keeps of the stage, which presets values refer to. Plain functions over the show's data
// (app.svelte.ts uses them).
import { CELL_ATTRS, CELL_MOVES, type CellMove, type CellValues, type Color, type CueList, type Group, type Resolved, type Values } from './types';
import type { caps } from './library';
import { cueNum } from './cuenum';
import { rawCellMap } from './raw';

// What a group's flash puts on one of its lights: the whole light, or for a group of cells ("Rim")
// just those cells (the light itself left as it is)
export function groupFlash(g: Group, id: string, n: number, v: Values): Values {
  if (!g.cells?.length || n < 2) return v;
  const { intensity, color, strobe } = v;
  const cell: CellValues = { intensity: intensity ?? 1, ...(color ? { color } : {}) };
  return { ...(strobe ? { strobe } : {}), cells: Object.fromEntries(g.cells.filter((k) => k < n).map((k) => [k, { ...cell }])) };
}
// a light's values without cells past `n` (none at all when it has no cells)
export function trimCells(v: Values | undefined, n: number) {
  if (!v?.cells) return;
  if (n < 2) { delete v.cells; return; }
  if (Object.keys(v.cells).some((k) => +k >= n)) { const kept = Object.fromEntries(Object.entries(v.cells).filter(([k]) => +k < n)); if (Object.keys(kept).length) v.cells = rawCellMap(kept); else delete v.cells; }
}
// (a cue by its number in a list: its place, -1 if there's none)
export const cueAt = (l: CueList, n: number) => l.cues.findIndex((_, i) => Math.abs(cueNum(l, i) - n) < 1e-9);

// What a recorded cue keeps from the stage for one fixture: only the attributes it can do.
export function stripResolved(s: Resolved, c: ReturnType<typeof caps>): Values {
  const v: Values = { intensity: s.intensity ?? 0 };
  if (c.color && s.color) v.color = { ...s.color };
  if (c.white && s.white !== undefined) v.white = s.white;
  if (c.amber && s.amber !== undefined) v.amber = s.amber;
  if (c.uv && s.uv !== undefined) v.uv = s.uv;
  if (c.cct && s.cct !== undefined) v.cct = s.cct;
  if (c.position) { v.pan = s.pan; v.tilt = s.tilt; }
  for (const k of ['panRotation', 'tiltRotation', 'roll', 'rollRotation', 'hoist'] as const) if (s[k] !== undefined) v[k] = s[k];
  if (c.strobe && s.strobe !== undefined) v.strobe = s.strobe;
  // (no fog or haze: those are only recorded when set in the programmer; a cue recorded while an
  // earlier cue's haze runs mustn't take that haze with it)
  for (const k of BEAM_ATTRS) if (k !== 'strobe' && s[k] !== undefined) v[k] = s[k];
  if (s.raw) v.raw = { ...s.raw };
  // single cells: only where one shows something other than the light as a whole
  if ((s.cellVals || s.cellLvl) && c.cells > 1) {
    const cells: Record<string, CellValues> = {};
    const near = (a: number, b: number | undefined) => b !== undefined && Math.abs(a - b) < 0.002;
    const keys = new Set(Object.keys(s.cellVals ?? {}));
    if (s.cellLvl) s.cellLvl.forEach((x, k) => { if (!near(x, v.intensity as number)) keys.add(String(k)); });
    for (const k of keys) {
      if (+k >= c.cells) continue;
      const x = s.cellVals?.[k] ?? {}, lvl = s.cellLvl ? s.cellLvl[+k] : x.intensity;
      const o: CellValues = {};
      if (lvl !== undefined && !near(lvl, v.intensity as number)) o.intensity = lvl;
      if (c.color && x.color && !(s.color && near(x.color.r, s.color.r) && near(x.color.g, s.color.g) && near(x.color.b, s.color.b))) o.color = { ...x.color };
      for (const a of ['white', 'amber', 'uv'] as const) if (c[a] && x[a] !== undefined && !near(x[a]!, s[a])) o[a] = x[a];
      for (const a of c.cellMoves) if (x[a] !== undefined && !near(x[a]!, s[a] ?? (a === 'hoist' ? undefined : 0.5))) o[a] = x[a];
      if (Object.keys(o).length) cells[k] = o;
    }
    if (Object.keys(cells).length) v.cells = cells;
  }
  return v;
}
// what a beam preset holds and Record keeps of a light's beam (strobe: only in presets)
export const BEAM_ATTRS = ['strobe', 'zoom', 'focus', 'iris', 'frost', 'prism', 'gobo', 'goboRotation', 'gobo2', 'gobo2Rotation', 'prismRotation',
  'animation', 'animationRotation', 'effectMacro', 'effectSpeed', 'colorMacro', 'goboShake', 'goboScroll', 'gobo2Shake', 'gobo2Scroll'] as const;
// a colour as hue, saturation and value (0..1 each)
export function toHsv(c: Color): [number, number, number] {
  const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) h = mx === c.r ? ((c.g - c.b) / d + 6) % 6 : mx === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4;
  return [h / 6, mx > 0 ? d / mx : 0, mx];
}
// The presets a light's values refer to, its cells' included.
export function refsIn(v: Values): string[] {
  const out: string[] = [];
  const of = (o: object) => { for (const x of Object.values(o)) { const ref = x && typeof x === 'object' && (x as { preset?: string }).preset; if (ref) out.push(ref); } };
  of(v);
  for (const c of Object.values(v.cells ?? {})) of(c);
  return out;
}
// A light's whole look with the programmer on top, its cells merged cell by cell (Record, Update).
// What the programmer sets for the whole light takes the look's cells with it (all blue means
// every cell blue), even when the look is a frame older than the programmer's last change.
export function withProgrammer(look: Values, prog: Values | undefined): Values {
  const v: Values = { ...look, ...prog };
  if (look.cells || prog?.cells) {
    const wide = [...CELL_ATTRS, ...CELL_MOVES, 'color' as const].filter((k) => prog?.[k] !== undefined);
    const cells: Record<string, CellValues> = wide.length ? dropCellKeys(look.cells ?? {}, wide) : { ...(look.cells ?? {}) };
    for (const [k, c] of Object.entries(prog?.cells ?? {})) cells[k] = { ...(cells[k] ?? {}), ...c };
    if (Object.keys(cells).length) v.cells = cells; else delete v.cells;
  }
  return v;
}
// Values split into what a single cell can show (brightness, colour; on a moving bar where its head
// points too) and the rest.
export function splitCell(v: Values, moves: readonly CellMove[] = []): { cell?: CellValues; rest: Values } {
  const cell: CellValues = {}, rest: Values = { ...v };
  for (const k of [...CELL_ATTRS, ...moves, 'color'] as const) if (v[k] !== undefined) { (cell as Record<string, unknown>)[k] = v[k]; delete rest[k]; }
  return { cell: Object.keys(cell).length ? cell : undefined, rest };
}
// cell values without these attributes (cells left with nothing go)
export function dropCellKeys(cells: Record<string, CellValues>, keys: (keyof CellValues)[]): Record<string, CellValues> {
  const out: Record<string, CellValues> = {};
  for (const [k, c] of Object.entries(cells)) {
    const x = { ...c };
    for (const d of keys) delete x[d];
    if (Object.keys(x).length) out[k] = x;
  }
  return out;
}
