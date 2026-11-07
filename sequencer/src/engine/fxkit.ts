// The parts every effect is made of: the knobs (EffectParams), where an element is (Elem), what
// an effect gives back (FxOut), and the small maths and palettes the effects share. Effects live
// in effects.ts (the built-in ones), pixels.ts (pixel shows) and custom.ts (your own: a formula, a
// picture or a GIF); they all import from here, never from each other.
import type { Color } from '../model/types';

export type EffectCategory = 'move' | 'color' | 'pixel' | 'intensity';
export type Direction = 'forward' | 'backward' | 'bounce' | 'in' | 'out' | 'random';

export interface EffectParams {
  speed: number;
  tempo: boolean;
  size: number;
  spread: number;
  direction: Direction;
  blocks: number;
  width: number;
  colors: Color[];
  low: number;
  high: number;
  lightUp: boolean;
  level: number;
  contrast: number;       // -1..1: how hard the light falls between dark and bright (0: as the effect makes it)
  pixels: boolean;        // pixel bars: every cell is its own element
  order: 'list' | 'x' | 'y' | 'centre';   // run along the list, left to right, back to front, or from the centre out
  sound?: number;         // not stored: how loud the bass is right now (0..1), set by the engine
  formula: string;        // the Formula effect: its expression (engine/custom.ts)
  picture: string;        // the Picture effect: the picture or GIF, packed (engine/custom.ts)
  mapping: string;        // how a picture lies on the lights: 'auto', 'line' (scrolls through), 'wall' (one row per light)
  text: string;           // the Scrolling text effect's words
}

// Where one element is, for the shape functions.
export interface Elem {
  phase: number;          // 0..1, this element's position in the cycle (spread and direction applied)
  x: number;              // 0..1, its place along the group (direction applied, no spread)
  cycle: number;          // 0..1, where the whole effect is in its cycle
  total: number;          // cycles since the effect started (for random effects)
  k: number;              // its index after direction / blocks
  m: number;              // how many distinct positions there are
  seed: number;           // per element, stable
  u: number;              // 0..1, its place along its own light (a pixel of a bar; 0.5 for a light with one cell)
  row: number;            // which light of the group it belongs to (0..rows-1, in the effect's order)
  rows: number;           // how many lights the group has
  beats: number;          // beats since the effect started
  secs: number;           // seconds since the effect started
  // Where it is on a ring or a matrix (model/pixelLayout.ts). Anything else is a line through the
  // middle: a strip, or a row of lights, runs from sx -1 to 1 at sy 0.
  sx: number;             // -1..1 left to right (the longer side fills it, a wide matrix keeps its shape)
  sy: number;             // -1..1 bottom to top
  rad: number;            // 0 in the middle, 1 at the pixel furthest out
  ang: number;            // 0..1 clockwise from straight up
  lane: number;           // which ring (from the middle) or row (from the bottom)
  lanes: number;
  gx: number;             // on a grid, whole numbers: column, and row from the bottom
  gy: number;
  gw: number;             // the grid's size (a disc has one too: its width in LEDs)
  gh: number;
  first: boolean;         // the first LED of its ring or of its run along the matrix
  cell: number;           // its place in the data
  cells: number;
}
// pan/tilt are offsets; strike: a white flash over the look (it stays as it is between strikes)
export interface FxOut { intensity?: number; color?: Color; pan?: number; tilt?: number; strike?: number }

export interface EffectDef {
  id: string;
  name: string;
  category: EffectCategory;
  blurb: string;
  defaults: Partial<EffectParams>;
  run: (e: Elem, p: EffectParams) => FxOut;
  noColors?: boolean;     // a pixel show that brings its own colours (no palette in the editor)
  shape?: boolean;        // draws on a ring or a matrix (shapes.ts): the library shows it on those
}

// ---------------------------------------------------------------- small helpers
//
// These run for every pixel of every frame and must never throw (one exception in the frame and
// nothing goes out at all): a position or a level that isn't a number (1/0 in a formula, an endless
// number in a file) counts as 0, a missing palette colour as white.

export const TAU = Math.PI * 2;
// (NaN and endless give 0; so does the 1 that v - floor(v) can round to just below a whole number)
export const frac = (v: number) => { const f = v - Math.floor(v); return f >= 0 && f < 1 ? f : 0; };
export const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);                // NaN counts as 0
export const sine = (ph: number) => { const s = 0.5 - 0.5 * Math.cos(TAU * ph); return s >= 0 ? s : 0; };   // 0 -> 1 -> 0 over a cycle
export const tri = (ph: number) => (ph < 0.5 ? ph * 2 : ph <= 1 ? 2 - ph * 2 : 0);
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const range = (p: EffectParams, v: number) => mix(p.low, p.high, clamp01(v));
export const WHITE: Color = { r: 1, g: 1, b: 1 };

// A stable pseudo-random number in [0, 1) for a few integers.
export function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// Smooth random wobble over t (value noise), 0..1.
export function noise(seed: number, t: number): number {
  if (!Number.isFinite(t)) t = 0;
  const i = Math.floor(t), f = t - i, s = f * f * (3 - 2 * f);
  return mix(hash(seed, i), hash(seed, i + 1), s);
}

// Hue round the rainbow (0..1, wraps), saturation and value kept in 0..1.
export function hsv(h: number, s: number, v: number): Color {
  const x = frac(h) * 6, i = Math.floor(x), f = x - i;
  s = clamp01(s); v = clamp01(v);
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (i) {
    case 0: return { r: v, g: t, b: p };
    case 1: return { r: q, g: v, b: p };
    case 2: return { r: p, g: v, b: t };
    case 3: return { r: p, g: q, b: v };
    case 4: return { r: t, g: p, b: v };
    default: return { r: v, g: p, b: q };
  }
}
// (a missing colour counts as white)
export const lerpColor = (a: Color, b: Color, t: number): Color => { a ??= WHITE; b ??= WHITE; return { r: mix(a.r, b.r, t), g: mix(a.g, b.g, t), b: mix(a.b, b.b, t) }; };
// Smoothly along a palette (wraps around). A missing colour counts as white.
export function along(colors: Color[], ph: number): Color {
  const n = colors.length;
  if (!n) return { r: 1, g: 1, b: 1 };
  const x = frac(ph) * n, i = Math.floor(x);
  return lerpColor(colors[i % n], colors[(i + 1) % n], x - i);
}
export const step = (colors: Color[], ph: number): Color => (colors.length && colors[Math.floor(frac(ph) * colors.length) % colors.length]) || { r: 1, g: 1, b: 1 };

// Along the palette from its first colour to its last, without wrapping round (dark to bright).
export function ramp(cs: Color[], v: number): Color {
  if (cs.length < 2) return cs[0] ?? WHITE;
  const x = clamp01(v) * (cs.length - 1), i = Math.min(cs.length - 2, Math.floor(x));
  return lerpColor(cs[i], cs[i + 1], x - i);
}
// Colour and brightness the way the engine takes them: the colour at full (its brightest emitter
// at 1) and the brightness as intensity, so a dimmer or a plain white light follows the show too.
// An unlit pixel keeps the colour `dark`: that's what shows when "Dim to" lifts the floor.
export function shine(r: number, g: number, b: number, p: EffectParams, dark: Color): FxOut {
  const mx = Math.max(r, g, b);
  if (!(mx > 1e-4)) {
    const dm = Math.max(dark.r, dark.g, dark.b, 1e-6);
    return { color: { r: dark.r / dm, g: dark.g / dm, b: dark.b / dm }, intensity: p.low };
  }
  return { color: { r: r / mx, g: g / mx, b: b / mx }, intensity: range(p, Math.min(1, mx)) };
}

// Contrast: an S-curve round the middle of the light. Up, what's dim gets dimmer and what's bright
// gets brighter; down, the light falls off softly and more of the picture glows. Dark stays dark and
// full stays full either way, so it never lights what the effect left out.
export function withContrast(v: number, c: number): number {
  const x = clamp01(v);
  if (!c) return x;
  const g = Math.pow(4, c);    // from a quarter (soft) to four (hard)
  return x < 0.5 ? 0.5 * Math.pow(2 * x, g) : 1 - 0.5 * Math.pow(2 * (1 - x), g);
}

// ---------------------------------------------------------------- knobs that can't break a frame

// Each number knob's range (FORMAT.md) and what it falls back to when it isn't a number at all.
// The show file is mended on load (model/format.ts) with the same table.
export const TEXT_MAX = 200;   // the Scrolling text effect's words
export const KNOBS: Record<'speed' | 'size' | 'spread' | 'blocks' | 'width' | 'low' | 'high' | 'level' | 'contrast', { lo: number; hi: number; or: number }> = {
  contrast: { lo: -1, hi: 1, or: 0 },
  speed: { lo: 0.05, hi: 3600, or: 4 }, size: { lo: 0, hi: 1, or: 1 }, spread: { lo: 0, hi: 1, or: 1 },
  blocks: { lo: 1, hi: 512, or: 1 }, width: { lo: 0, hi: 1, or: 0 }, low: { lo: 0, hi: 1, or: 0 },
  high: { lo: 0, hi: 1, or: 1 }, level: { lo: 0, hi: 1, or: 1 },
};
// A colour with r, g and b each a number in 0..1.
export const isColor = (c: unknown): c is Color => !!c && typeof c === 'object'
  && (c as Color).r >= 0 && (c as Color).r <= 1 && (c as Color).g >= 0 && (c as Color).g <= 1 && (c as Color).b >= 0 && (c as Color).b <= 1;
// The usable colours of a palette, each channel kept in 0..1 (not a list, or none usable: []).
export function cleanColors(cs: unknown): Color[] {
  if (!Array.isArray(cs)) return [];
  const out: Color[] = [];
  for (const c of cs) {
    if (isColor(c)) { out.push(c); continue; }
    if (!c || typeof c !== 'object') continue;
    const { r, g, b } = c as Record<string, unknown>;
    if (typeof r === 'number' && typeof g === 'number' && typeof b === 'number' && Number.isFinite(r + g + b)) out.push({ r: clamp01(r), g: clamp01(g), b: clamp01(b) });
  }
  return out;
}
// Every knob in its range and every palette colour a colour, whatever the params were made from
// (a file, an old show, a typo): no effect can throw or put out NaN because of a knob. Changes p
// in place only where something is wrong (the usual case costs a few comparisons).
export function cleanParams(p: EffectParams, fallback: Partial<EffectParams> = {}): EffectParams {
  for (const k in KNOBS) {
    const key = k as keyof typeof KNOBS, { lo, hi, or } = KNOBS[key], v: unknown = p[key];
    if (typeof v === 'number' && v >= lo && v <= hi) continue;
    p[key] = typeof v !== 'number' || v !== v ? (fallback[key] ?? or) : v > hi ? hi : lo;
  }
  if (p.blocks !== Math.round(p.blocks)) p.blocks = Math.round(p.blocks);
  if (typeof p.text === 'string' && p.text.length > TEXT_MAX) p.text = p.text.slice(0, TEXT_MAX);
  if (p.sound !== undefined && !(p.sound >= 0 && p.sound <= 1)) p.sound = clamp01(p.sound);
  let ok = Array.isArray(p.colors);
  if (ok) for (const c of p.colors) if (!isColor(c)) { ok = false; break; }
  if (!ok) { const cs = cleanColors(p.colors); p.colors = cs.length ? cs : fallback.colors ?? PALETTES.Rainbow; }
  return p;
}

// ---------------------------------------------------------------- palettes

export const c = (hex: string): Color => {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
};
export const PALETTES: Record<string, Color[]> = {
  Rainbow: ['#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#8000ff', '#ff00ff'].map(c),
  Party: ['#ff00c8', '#00e5ff', '#ffe600', '#7a00ff'].map(c),
  Fire: ['#ff1a00', '#ff6a00', '#ffb000', '#ff3c00'].map(c),
  Ocean: ['#0030ff', '#00a8ff', '#00ffd0', '#0060c0'].map(c),
  Sunset: ['#ff4000', '#ff0060', '#a000ff', '#ff9000'].map(c),
  Forest: ['#00ff40', '#60ff00', '#00a060', '#c0ff40'].map(c),
  Ice: ['#ffffff', '#a0e0ff', '#40a0ff', '#e0f8ff'].map(c),
  Police: ['#ff0000', '#0010ff'].map(c),
  Warm: ['#ffb060', '#ff8020', '#ffd8a0'].map(c),
  // the pixel shows' own (pixels.ts); Heat and Matrix run dark to bright, for fire and trails
  Aurora: ['#00ff60', '#00ffb4', '#20ff40', '#00b4ff', '#7040ff', '#c040ff'].map(c),
  Heat: ['#ff0000', '#ff3300', '#ff6600', '#ff9900', '#ffcc00', '#ffff00', '#ffff99', '#ffffff'].map(c),
  Lava: ['#5a0000', '#a00000', '#ff1000', '#ff6a00', '#ffd080', '#c00000'].map(c),
  Matrix: ['#003b00', '#008f11', '#00ff41', '#b4ffc0'].map(c),
  Candy: ['#ff4fa3', '#ffd23f', '#3fd2ff', '#b14fff', '#4fff9a'].map(c),
  Neon: ['#ff10f0', '#00ffff', '#39ff14', '#ff3131', '#2040ff'].map(c),
};

