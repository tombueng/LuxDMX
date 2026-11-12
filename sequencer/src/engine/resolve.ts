// Values -> Resolved: look up every preset reference for one fixture. A preset can carry a value
// for all fixtures and overrides per fixture (each mover's own "on the singer" position).
import { CELL_ATTRS, CELL_MOVES, type Color, type NumAttr, type Preset, type PresetRef, type Resolved, type Values } from '../model/types';
// what a cell can have of its own: its light, and on a moving bar where its head points
const CELL_KEYS = [...CELL_ATTRS, ...CELL_MOVES];

const isRef = (v: unknown): v is PresetRef => !!v && typeof v === 'object' && 'preset' in (v as object);

export function resolveValues(v: Values | undefined, fixtureId: string, presets: Map<string, Preset>): Resolved {
  const out: Resolved = {};
  if (!v) return out;
  // (a position preset of a moving bar: each head's own pan and tilt come with it, under the cells
  // the values set themselves)
  let headsFrom: Record<string, Values> | undefined;
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined || k === '__proto__') continue;   // (a hostile file: never a prototype)
    if (k === 'raw') { out.raw = { ...(val as Record<string, number>) }; continue; }
    if (k === 'cells') {
      const cv: Record<string, Resolved> = {};
      for (const [ci, c] of Object.entries(val as Record<string, Values>)) {
        if (!c || typeof c !== 'object') continue;
        const { cells: _n, raw: _r, ...own } = c;   // (a cell has no cells or channels of its own)
        const r = resolveValues(own, fixtureId, presets);
        if (Object.keys(r).length) cv[ci] = r;
      }
      if (Object.keys(cv).length) out.cellVals = cv;
      continue;
    }
    if (isRef(val)) {
      const p = presets.get(val.preset);
      const pv = p ? (p.perFixture?.[fixtureId]?.[k as NumAttr] ?? p.values[k as NumAttr]) : undefined;
      if (p && (k === 'pan' || k === 'tilt')) { const hc = (p.perFixture?.[fixtureId] ?? p.values).cells; if (hc) headsFrom = { ...headsFrom, ...hc }; }
      if (pv === undefined || isRef(pv)) continue;          // presets don't nest
      (out as Record<string, unknown>)[k] = typeof pv === 'object' ? { ...(pv as Color) } : pv;
    } else {
      (out as Record<string, unknown>)[k] = typeof val === 'object' ? { ...(val as Color) } : val;
    }
  }
  if (headsFrom) {
    const cv: Record<string, Resolved> = { ...(out.cellVals ?? {}) };
    for (const [ci, c] of Object.entries(headsFrom)) {
      const h: Resolved = {};
      for (const a of ['pan', 'tilt'] as const) { const x = (v[a] !== undefined ? c?.[a] : undefined); if (typeof x === 'number') h[a] = x; }
      if (Object.keys(h).length) cv[ci] = { ...h, ...(cv[ci] ?? {}) };
    }
    if (Object.keys(cv).length) out.cellVals = cv;
  }
  return out;
}

// b on top of a, as a later cue sits on an earlier one: b's attributes win, single raw channels and
// single cells (and each of their attributes) add up, so a cue that sets channel 7 keeps the
// channel 3 an earlier cue set, and one that colours cell 2 keeps cell 5's.
// (cell objects are shared, never changed in place: only the maps holding them are new)
export function overlay(a: Resolved | undefined, b: Resolved): Resolved {
  if (!a) return { ...b, ...(b.cellVals ? { cellVals: { ...b.cellVals } } : {}) };
  const out: Resolved = { ...a, ...b };
  if (a.raw && b.raw) out.raw = { ...a.raw, ...b.raw };
  // a light-wide value set over earlier cell values takes those cells with it (a later "all blue"
  // turns the cell an earlier cue made red blue too)
  let cv = a.cellVals ? stripCells(a.cellVals, b) : undefined;
  if (b.cellVals) {
    cv ??= {};
    for (const k in b.cellVals) { const c = b.cellVals[k], was = cv[k]; cv[k] = was ? { ...was, ...c } : c; }
  }
  if (cv && Object.keys(cv).length) out.cellVals = cv; else delete out.cellVals;
  return out;
}
// cell values without what `over` sets for the whole light
// (a new map; a cell that keeps everything is the same object)
export function stripCells(cv: Record<string, Resolved>, over: Resolved): Record<string, Resolved> {
  const drop = [...CELL_KEYS.filter((k) => over[k] !== undefined), ...(over.color ? ['color' as const] : [])];
  if (!drop.length) return { ...cv };
  const out: Record<string, Resolved> = {};
  for (const k in cv) {
    const c = cv[k];
    if (!drop.some((d) => c[d] !== undefined)) { out[k] = c; continue; }
    const x: Resolved = { ...c };
    for (const d of drop) delete x[d];
    if (Object.keys(x).length) out[k] = x;
  }
  return out;
}

// How bright something is at its brightest: the light's own level or one of its cells'.
export function topLevel(r: Resolved | undefined, k: 'intensity' | 'white' | 'amber' | 'uv' = 'intensity'): number {
  if (!r) return 0;
  if (r.cells) { let v = 0; for (const c of r.cells) v = Math.max(v, c[k] ?? 0); return v; }   // (what goes out, cell by cell)
  if (k === 'intensity' && r.cellLvl) { let v = 0; for (const x of r.cellLvl) v = Math.max(v, x); return v; }
  let v = r[k] ?? 0;
  if (r.cellVals) for (const c of Object.values(r.cellVals)) v = Math.max(v, c[k] ?? 0);
  return v;
}

// A look's cells one by one, n of them: what effects and the live layer made (`cells`), else the
// cells' own values over the light's, each at its worked-out level. Undefined: no cell differs from
// the light. Worked out once per look object (a frame's stage is new every frame).
const spread = new WeakMap<Resolved, Resolved[]>();
export function cellsOf(l: Resolved | undefined, n: number): Resolved[] | undefined {
  if (!l || n < 1) return undefined;
  if (l.cells) return l.cells;
  if (!l.cellVals && !l.cellLvl) return undefined;
  let c = spread.get(l);
  if (!c || c.length !== n) { c = spreadCells(l, n); spread.set(l, c); }
  return c;
}
// (always new objects: for effects and the live layer to write into)
export function spreadCells(l: Resolved, n: number): Resolved[] {
  const out: Resolved[] = new Array(n), cv = l.cellVals, lv = l.cellLvl;
  for (let k = 0; k < n; k++) {
    const c = cv?.[k];
    const col = c?.color ?? l.color;
    out[k] = { intensity: lv ? lv[k] ?? 0 : c?.intensity ?? l.intensity, color: col ? { r: col.r, g: col.g, b: col.b } : undefined,
      white: c?.white ?? l.white, amber: c?.amber ?? l.amber, uv: c?.uv ?? l.uv, ...(l.draw ? { draw: l.draw } : {}) };
    // (a moving bar's head: where it points, its own else the light's; a winch among cells: its height)
    const pan = c?.pan ?? l.pan, tilt = c?.tilt ?? l.tilt, hoist = c?.hoist ?? l.hoist;
    if (pan !== undefined) out[k].pan = pan;
    if (tilt !== undefined) out[k].tilt = tilt;
    if (hoist !== undefined) out[k].hoist = hoist;
  }
  return out;
}
// what cell k shows (the light itself when it has no cells of its own)
export const cellLookAt = (l: Resolved | undefined, k: number, n: number): Resolved | undefined => cellsOf(l, n)?.[k] ?? l;

const NUM: NumAttr[] = ['intensity', 'white', 'amber', 'uv', 'cct', 'pan', 'tilt', 'strobe', 'zoom', 'focus', 'iris',
  'frost', 'prism', 'goboRotation', 'gobo', 'fog', 'haze', 'fan', 'speed', 'confetti', 'bubbles', 'flame', 'sparks', 'co2',
  'gobo2', 'gobo2Rotation', 'prismRotation', 'animation', 'animationRotation', 'effectMacro', 'effectSpeed', 'colorMacro',
  'goboShake', 'goboScroll', 'gobo2Shake', 'gobo2Scroll', 'panRotation', 'tiltRotation', 'roll', 'rollRotation', 'hoist'];
// Attributes that jump instead of fading (a gobo halfway between two slots is a different gobo,
// a macro halfway between two is another macro).
const SNAP_AT_START: NumAttr[] = ['gobo', 'prism', 'gobo2', 'effectMacro', 'colorMacro', 'goboShake', 'goboScroll', 'gobo2Shake', 'gobo2Scroll'];
const SNAP_AT_END: NumAttr[] = ['strobe'];

// Blend b over a by t (0 = a, 1 = b). Attributes only one side has are taken as they are.
// tIntensity: the light's level's own clock; tDown: the clock for a cell's level going down (the
// cue's fade-out), each cell by its own direction (unset: the light's).
// Which family an attribute's own fade time is (a cue's `times`); not listed: the cue's fade.
export const TIME_FAMILY: Partial<Record<string, 'color' | 'position' | 'beam'>> = {
  pan: 'position', tilt: 'position', panRotation: 'position', tiltRotation: 'position', roll: 'position', rollRotation: 'position', hoist: 'position',
  cct: 'color',
  zoom: 'beam', focus: 'beam', iris: 'beam', frost: 'beam', prism: 'beam', prismRotation: 'beam', gobo: 'beam', gobo2: 'beam',
  goboRotation: 'beam', gobo2Rotation: 'beam', animation: 'beam', animationRotation: 'beam',
  goboShake: 'beam', goboScroll: 'beam', gobo2Shake: 'beam', gobo2Scroll: 'beam',
};
// `tBy`: how far each family is (a cue with times of its own); not given: `t` for all
export function lerpResolved(a: Resolved, b: Resolved, t: number, tIntensity = t, tDown?: number, tBy?: { color: number; position: number; beam: number }): Resolved {
  const out: Resolved = { ...a };
  const tColor = tBy ? tBy.color : t;
  for (const k of NUM) {
    const x = a[k], y = b[k];
    if (y === undefined) continue;
    if (x === undefined) { out[k] = y; continue; }
    const fam = tBy ? TIME_FAMILY[k] : undefined;
    const tt = k === 'intensity' ? tIntensity : fam ? tBy![fam] : t;
    out[k] = SNAP_AT_START.includes(k) ? (tt > 0 ? y : x) : SNAP_AT_END.includes(k) ? (tt >= 1 ? y : x) : x + (y - x) * tt;
  }
  if (b.color) {
    const c = a.color ?? b.color;
    out.color = { r: c.r + (b.color.r - c.r) * tColor, g: c.g + (b.color.g - c.g) * tColor, b: c.b + (b.color.b - c.b) * tColor };
  }
  if (b.raw) {
    out.raw = { ...(a.raw ?? {}) };
    for (const [ch, v] of Object.entries(b.raw)) {
      const from = a.raw?.[ch] ?? 0;      // nothing underneath: fade from zero (a list fading in or out)
      out.raw[ch] = Math.round(from + (v - from) * t);
    }
  }
  // (done fading, nothing underneath with cells of its own: just b's cells, shared, nothing worked out)
  // (a moving bar's heads go at the position time: not done before that either)
  const done = t >= 1 && tIntensity >= 1 && (tDown === undefined || tDown >= 1) && tColor >= 1 && (tBy?.position ?? 1) >= 1;
  if (b.cellVals && !a.cellVals && done) out.cellVals = b.cellVals;
  // (done fading with cells on both sides, a pixel play holding a look: each cell is b's, with what
  // only a set taken over by b's whole-light value or kept; cells that need nothing are shared)
  else if (a.cellVals && b.cellVals && done) {
    const cv: Record<string, Resolved> = {};
    const settle = (ca: Resolved | undefined, cb: Resolved | undefined): Resolved | undefined => {
      if (!ca) return cb;
      let o: Resolved | undefined;
      for (const k of CELL_KEYS) if (ca[k] !== undefined && cb?.[k] === undefined) (o ??= { ...(cb ?? {}) })[k] = b[k] ?? ca[k];
      if (ca.color && !cb?.color) (o ??= { ...(cb ?? {}) }).color = b.color ?? ca.color;
      return o ?? cb ?? ca;
    };
    for (const key in a.cellVals) if (!(key in b.cellVals)) { const x = settle(a.cellVals[key], undefined); if (x) cv[key] = x; }
    for (const key in b.cellVals) { const x = settle(a.cellVals[key], b.cellVals[key]); if (x) cv[key] = x; }
    out.cellVals = cv;
  } else if (a.cellVals || b.cellVals) {
    // A cell goes from what it showed (its own value, else the light's) to what b gives it (its
    // own value, else b's for the whole light). Something neither side set for that cell stays
    // the light's; something only a set, that b doesn't touch at all, stays.
    const cv: Record<string, Resolved> = {};
    for (const key of new Set([...Object.keys(a.cellVals ?? {}), ...Object.keys(b.cellVals ?? {})])) {
      const ca = a.cellVals?.[key], cb = b.cellVals?.[key], o: Resolved = {};
      for (const k of CELL_KEYS) {
        if (ca?.[k] === undefined && cb?.[k] === undefined) continue;
        const from = ca?.[k] ?? a[k], to = cb?.[k] ?? b[k];
        // (a head's pan and tilt on the cue's position time, as the light's own)
        const tt = k === 'pan' || k === 'tilt' ? (tBy?.position ?? t) : k !== 'intensity' ? t : tDown === undefined ? tIntensity : (to ?? 0) < (from ?? 0) ? tDown : t;
        o[k] = to === undefined ? from : from === undefined ? to : from + (to - from) * tt;
      }
      if (ca?.color || cb?.color) {
        const from = ca?.color ?? a.color, to = cb?.color ?? b.color;
        const c = from ?? to!, d = to ?? from!;
        o.color = { r: c.r + (d.r - c.r) * tColor, g: c.g + (d.g - c.g) * tColor, b: c.b + (d.b - c.b) * tColor };
      }
      if (Object.keys(o).length) cv[key] = o;
    }
    if (Object.keys(cv).length) out.cellVals = cv; else delete out.cellVals;
  }
  return out;
}
