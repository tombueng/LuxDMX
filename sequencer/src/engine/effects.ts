// Effects: chases, rainbows, circles... Every effect is a pure function of where we are in its
// cycle and which element (fixture, or pixel of a bar) it's looking at, so the preview on a card,
// the stage and the DMX output always agree, and tests can check exact values.
//
// The knobs every effect has (FORMAT.md, "Effects"):
//   speed      beats per cycle when following the tempo, seconds per cycle when not
//   size       how deep / how far it swings
//   spread     0 = every element together, 1 = spread evenly over one cycle along the group
//   direction  forward, backward, bounce, in (outside to centre), out (centre outwards), random
//   blocks     neighbours that move together (2 = pairs)
//   width      how much of a cycle a chase step is on (0 = one element's worth)
//   colors     the palette colour effects use
//   low, high  the intensity range
//   lightUp    a colour or move effect also turns its lights on (at its level)
//   level      the effect's own fader
import type { Resolved } from '../model/types';
import { spreadCells } from './resolve';
import { shapeH, shapeW, type Places } from '../model/pixelLayout';
import { CUSTOM_EFFECTS } from './custom';
import { PIXEL_EFFECTS } from './pixels';
import { SHAPE_EFFECTS } from './shapes';
import {
  PALETTES, TAU, WHITE, along, clamp01, cleanParams, frac, hash, hsv, lerpColor, mix, noise, range, sine, step, tri,
  type EffectCategory, type EffectDef, type EffectParams, type FxOut, withContrast,
} from './fxkit';
export * from './fxkit';

// ---------------------------------------------------------------- the built-in effects

const BASE: EffectParams = {
  speed: 4, tempo: true, size: 1, spread: 1, direction: 'forward', blocks: 1, width: 0,
  colors: PALETTES.Rainbow, low: 0, high: 1, lightUp: true, level: 1, contrast: 0, pixels: true, order: 'list',
  formula: '', picture: '', mapping: 'auto', text: '', script: '', vals: {},
};

export const EFFECTS: EffectDef[] = [
  // ---- moves (moving heads; offsets around where they point)
  { id: 'circle', name: 'Circle', category: 'move', blurb: 'Every head draws a circle around where it points.',
    defaults: { size: 0.25, spread: 0, speed: 4 },
    run: (e, p) => ({ pan: 0.5 * p.size * Math.sin(TAU * e.phase), tilt: 0.5 * p.size * Math.cos(TAU * e.phase) }) },
  { id: 'figure8', name: 'Figure eight', category: 'move', blurb: 'A lying eight: two loops side by side.',
    defaults: { size: 0.3, spread: 0, speed: 8 },
    run: (e, p) => ({ pan: 0.5 * p.size * Math.sin(TAU * e.phase), tilt: 0.25 * p.size * Math.sin(2 * TAU * e.phase) }) },
  { id: 'pan', name: 'Pan sweep', category: 'move', blurb: 'Left to right and back.',
    defaults: { size: 0.3, spread: 0, speed: 4 },
    run: (e, p) => ({ pan: 0.5 * p.size * Math.sin(TAU * e.phase) }) },
  { id: 'tilt', name: 'Tilt sweep', category: 'move', blurb: 'Nods up and down. With spread it becomes a wave.',
    defaults: { size: 0.25, spread: 0.5, speed: 2 },
    run: (e, p) => ({ tilt: 0.5 * p.size * Math.sin(TAU * e.phase) }) },
  { id: 'fan', name: 'Fan', category: 'move', blurb: 'The heads fan out from the middle and close again.',
    defaults: { size: 0.4, spread: 0, speed: 8 },
    run: (e, p) => ({ pan: (e.m > 1 ? e.k / (e.m - 1) - 0.5 : 0) * p.size * sine(e.cycle) }) },
  { id: 'cross', name: 'Cross', category: 'move', blurb: 'Left half and right half sweep against each other.',
    defaults: { size: 0.35, spread: 0, speed: 4 },
    run: (e, p) => ({ pan: 0.5 * p.size * Math.sin(TAU * e.cycle) * (e.x < 0.5 ? 1 : -1) }) },
  { id: 'swing', name: 'Swing', category: 'move', blurb: 'A pendulum: sweeps across and dips in the middle.',
    defaults: { size: 0.3, spread: 0.25, speed: 4 },
    run: (e, p) => ({ pan: 0.5 * p.size * Math.sin(TAU * e.phase), tilt: -0.2 * p.size * Math.abs(Math.cos(TAU * e.phase)) }) },
  { id: 'ballyhoo', name: 'Ballyhoo', category: 'move', blurb: 'Big, wild sweeps all over the room. Classic for a reveal.',
    defaults: { size: 0.5, spread: 1, speed: 8, direction: 'random' },
    run: (e, p) => ({
      pan: 0.5 * p.size * (0.65 * Math.sin(TAU * e.phase) + 0.35 * Math.sin(TAU * (2 * e.phase + e.seed))),
      tilt: 0.35 * p.size * (0.6 * Math.cos(TAU * (e.phase + 0.25)) + 0.4 * Math.sin(TAU * (3 * e.phase + e.seed))),
    }) },

  // ---- colour
  { id: 'rainbow', name: 'Rainbow', category: 'color', blurb: 'All the colours, rolling along the lights.',
    defaults: { spread: 1, speed: 8 },
    run: (e, p) => ({ color: hsv(e.phase, p.size, 1) }) },
  { id: 'colorChase', name: 'Colour chase', category: 'color', blurb: 'The palette steps along the lights, hard cuts.',
    defaults: { spread: 1, speed: 4, colors: PALETTES.Party },
    run: (e, p) => ({ color: step(p.colors, e.phase) }) },
  { id: 'colorFade', name: 'Colour fade', category: 'color', blurb: 'Every light fades slowly through the palette.',
    defaults: { spread: 0, speed: 16, colors: PALETTES.Sunset },
    run: (e, p) => ({ color: along(p.colors, e.phase) }) },
  { id: 'gradient', name: 'Gradient', category: 'color', blurb: 'A smooth colour gradient that drifts along.',
    defaults: { spread: 0.5, speed: 16, colors: PALETTES.Ocean },
    run: (e, p) => ({ color: along(p.colors, e.phase) }) },
  { id: 'random', name: 'Random colours', category: 'color', blurb: 'Every light jumps to a random palette colour on the beat.',
    defaults: { speed: 1, colors: PALETTES.Party, spread: 0 },
    run: (e, p) => ({ color: p.colors[Math.floor(hash(e.seed, Math.floor(e.total)) * p.colors.length)] ?? { r: 1, g: 1, b: 1 } }) },
  { id: 'police', name: 'Police', category: 'color', blurb: 'Red on one side, blue on the other, double flashes.',
    defaults: { speed: 1, colors: PALETTES.Police, spread: 0 },
    run: (e, p) => {
      const left = e.x < 0.5, half = left ? e.cycle : frac(e.cycle + 0.5);
      const on = half < 0.5 && (half % 0.25) < 0.14;
      return { color: (left ? p.colors[0] : p.colors[1] ?? p.colors[0]) ?? { r: 1, g: 0, b: 0 }, intensity: on ? p.high : p.low };
    } },
  { id: 'fire', name: 'Fire', category: 'color', blurb: 'Flickering reds, oranges and yellows.',
    defaults: { speed: 2, tempo: false, colors: PALETTES.Fire, low: 0.45 },
    run: (e, p) => {
      const t = e.total * 6;
      return { color: along(p.colors, noise(e.seed + 17, t * 0.7)), intensity: range(p, 0.35 + 0.65 * noise(e.seed, t)) };
    } },
  { id: 'ocean', name: 'Ocean', category: 'color', blurb: 'Calm blue and turquoise waves.',
    defaults: { speed: 6, tempo: false, colors: PALETTES.Ocean, spread: 0.7, low: 0.5 },
    run: (e, p) => ({ color: along(p.colors, e.phase + 0.3 * noise(e.seed, e.total * 2)), intensity: range(p, sine(e.phase)) }) },

  // ---- intensity
  { id: 'chase', name: 'Chase', category: 'intensity', blurb: 'One light after the other.',
    defaults: { spread: 1, speed: 2, lightUp: false },
    run: (e, p) => ({ intensity: e.phase < (p.width || 1 / Math.max(1, e.m)) ? p.high : p.low }) },
  { id: 'pingpong', name: 'Ping-pong', category: 'intensity', blurb: 'A light running back and forth (the Knight Rider).',
    defaults: { spread: 1, speed: 2, direction: 'bounce', lightUp: false },
    run: (e, p) => ({ intensity: e.phase < (p.width || 1 / Math.max(1, e.m)) ? p.high : p.low }) },
  { id: 'pulse', name: 'Pulse', category: 'intensity', blurb: 'All lights breathe together.',
    defaults: { spread: 0, speed: 2, lightUp: false },
    run: (e, p) => ({ intensity: range(p, sine(e.phase)) }) },
  { id: 'wave', name: 'Wave', category: 'intensity', blurb: 'A soft wave of light rolling along.',
    defaults: { spread: 1, speed: 4, lightUp: false },
    run: (e, p) => ({ intensity: range(p, sine(e.phase)) }) },
  { id: 'alternate', name: 'Alternate', category: 'intensity', blurb: 'Odd and even lights take turns.',
    defaults: { spread: 0, speed: 1, lightUp: false },
    run: (e, p) => ({ intensity: frac(e.cycle + (e.k % 2) * 0.5) < 0.5 ? p.high : p.low }) },
  { id: 'fill', name: 'Fill', category: 'intensity', blurb: 'Lights fill up one by one, then drain away.',
    defaults: { speed: 4, lightUp: false },
    run: (e, p) => {
      const pos = (e.k + 0.5) / Math.max(1, e.m), c2 = e.cycle * 2;
      return { intensity: (e.cycle < 0.5 ? pos < c2 : pos >= c2 - 1) ? p.high : p.low };
    } },
  { id: 'meteor', name: 'Meteor', category: 'intensity', blurb: 'A bright head with a fading tail. Great on pixel bars.',
    defaults: { speed: 2, width: 0.35, lightUp: false },
    run: (e, p) => {
      const d = frac(e.cycle - (e.k + 0.5) / Math.max(1, e.m)), tail = p.width || 0.35;
      return { intensity: d < tail ? range(p, 1 - d / tail) : p.low };
    } },
  { id: 'sparkle', name: 'Sparkle', category: 'intensity', blurb: 'Random lights twinkle. Size sets how many.',
    defaults: { speed: 0.5, size: 0.3, spread: 0, lightUp: false },
    run: (e, p) => {
      const slots = 4, s = e.total * slots, k = Math.floor(s);
      return { intensity: hash(e.seed, k) < p.size ? range(p, 1 - (s - k)) : p.low };
    } },
  { id: 'strobe', name: 'Strobe', category: 'intensity', blurb: 'Hard flashes, on any light (no strobe channel needed).',
    defaults: { speed: 0.25, spread: 0, width: 0.2, lightUp: false },
    run: (e, p) => ({ intensity: e.phase < (p.width || 0.2) ? p.high : p.low }) },
  // white strikes over whatever look is on (a dark blue one stays dark blue between them)
  { id: 'lightning', name: 'Lightning', category: 'intensity', blurb: 'Rare, random white double flashes over the look. Lovely over a dark blue one.',
    defaults: { speed: 3, tempo: false, size: 0.5, spread: 0, lightUp: false },
    run: (e, p) => {
      const k = Math.floor(e.total), at = hash(e.seed, k, 7) * 0.7, d = e.total - k - at;
      const strike = hash(e.seed, k, 3) < p.size;
      const v = !strike || d < 0 ? 0 : d < 0.03 ? 1 : d < 0.05 ? 0.15 : d < 0.08 ? 0.85 : Math.max(0, 0.5 - (d - 0.08) * 4);
      return { strike: v * p.high };
    } },
  { id: 'sound', name: 'Sound pulse', category: 'intensity', blurb: 'The lights pulse with the bass. Needs ♪ follow the music.',
    defaults: { spread: 0, lightUp: false, low: 0.1 },
    run: (e, p) => ({ intensity: range(p, (p.sound ?? 0) * p.size) }) },
  { id: 'vu', name: 'VU meter', category: 'intensity', blurb: 'Fills up with the loudness, like a level meter. Lovely on pixel bars. Needs ♪.',
    defaults: { spread: 0, lightUp: false, direction: 'out' },
    run: (e, p) => ({ intensity: (e.k + 0.5) / Math.max(1, e.m) <= (p.sound ?? 0) * (0.4 + p.size) ? p.high : p.low }) },
  { id: 'candle', name: 'Candle', category: 'intensity', blurb: 'A gentle, uneven flicker.',
    defaults: { speed: 1, tempo: false, low: 0.55, spread: 0, lightUp: false },
    run: (e, p) => ({ intensity: range(p, noise(e.seed, e.total * 7) * 0.7 + noise(e.seed + 3, e.total * 19) * 0.3) }) },
];
// the pixel shows and your own effects join the built-in ones
EFFECTS.push(...SHAPE_EFFECTS, ...PIXEL_EFFECTS, ...CUSTOM_EFFECTS);
export const EFFECT_MAP = new Map(EFFECTS.map((d) => [d.id, d]));
export const CATEGORY_LABEL: Record<EffectCategory, string> = { move: 'Moves', color: 'Colour', pixel: 'Pixels', intensity: 'Intensity' };

// Everything an effect needs, its stored params filled up with the effect's own and the general
// defaults. Unknown keys in a show file stay in the file; they're just not used.
const wrapClock = (x: number) => (Number.isFinite(x) ? x % 1e6 : 0);

export function paramsOf(kind: string, stored: Record<string, unknown> = {}): EffectParams {
  const def = EFFECT_MAP.get(kind);
  const p = { ...BASE, ...def?.defaults } as EffectParams;
  for (const k of Object.keys(BASE) as (keyof EffectParams)[]) {
    const v = stored[k];
    if (v === undefined || v === null) continue;
    if (typeof v === typeof BASE[k] || (k === 'colors' && Array.isArray(v))) (p as unknown as Record<string, unknown>)[k] = v;
  }
  p.speed = Math.max(0.05, p.speed);
  p.blocks = Math.max(1, Math.round(p.blocks));
  // (every knob in its range, whatever an old show or a slider left there: fxkit.ts)
  return cleanParams(p, { ...BASE, ...def?.defaults });
}

// ---------------------------------------------------------------- elements and phases

// The position of element i of n after direction and blocks.
export function arrange(i: number, n: number, p: EffectParams, seed: number, order?: number[]): { k: number; m: number } {
  let k = i, m = n;
  if (p.direction === 'random') k = (order ?? shuffled(n, seed))[i];
  if (p.direction === 'in' || p.direction === 'out') { k = Math.min(i, n - 1 - i); m = Math.ceil(n / 2); }
  if (p.blocks > 1) { k = Math.floor(k / p.blocks); m = Math.ceil(m / p.blocks); }
  if (p.direction === 'backward' || p.direction === 'out') k = m - 1 - k;
  return { k, m };
}
function shuffled(n: number, seed: number): number[] {
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(hash(seed, i, 99) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Run one effect for n elements at `total` cycles since it started.
// `where`: each element's light and place on it (from the engine; one row of lights otherwise);
// `clock`: beats and seconds since the effect started (from total and the speed otherwise).
// `at`, `cell`: its place on a ring or a matrix.
export interface Where { u: number; row: number; rows: number; at?: Places; cell?: number }
export function runEffect(def: EffectDef, p: EffectParams, n: number, total: number, seed = 1, where?: Where[], clock?: { beats: number; secs: number }): FxOut[] {
  // The clocks wrap after about eleven days (a whole number, so the cycle doesn't jump), and one that
  // isn't a number (a broken tempo) is 0: the pixel shows step through time in loops, and an
  // endless clock would hang the frame where no try/catch can help.
  total = wrapClock(total);
  if (clock) clock = { beats: wrapClock(clock.beats), secs: wrapClock(clock.secs) };
  const cycle = frac(total);
  const out: FxOut[] = [];
  const order = p.direction === 'random' ? shuffled(n, seed) : undefined;
  const beats = clock?.beats ?? total * p.speed, secs = clock?.secs ?? (p.tempo ? total * p.speed * 0.5 : total * p.speed);
  const flip = !!def.shape && !def.noFlip && p.direction === 'backward', zoom = def.zoom ? Math.max(0.1, p.size) : 1;
  for (let i = 0; i < n; i++) {
    const { k, m } = arrange(i, n, p, seed, order);
    // Bounce: the cycle runs there and back, landing on the first and last element.
    const cyc = p.direction === 'bounce' ? tri(cycle) * (m > 1 ? (m - 1) / m : 0) : cycle;
    const x = m > 1 ? k / m : 0;
    const phase = frac(cyc - p.spread * x);
    const w = where?.[i], xx = m > 1 ? k / (m - 1) : 0;
    const at = w?.at, ci = w?.cell ?? 0;
    // (not on a ring or a matrix: a line through the middle, along the light or along the group)
    const line = 2 * (w && m > w.rows ? w.u : xx) - 1;
    let sx = at ? at.x[ci] : line, sy = at ? at.y[ci] : 0, rad = at ? at.rad[ci] : Math.abs(line), ang = at ? at.ang[ci] : (line < 0 ? 0.75 : 0.25);
    let gx = at ? at.gx[ci] : k;
    // on a ring or a matrix: Back mirrors the picture (what turns, turns the other way), and Size
    // makes it smaller on the effects that don't use Size themselves
    if (at && flip) { sx = -sx; ang = frac(1 - ang); gx = at.gw - 1 - gx; }
    if (at && zoom !== 1) { sx /= zoom; sy /= zoom; rad /= zoom; }
    const o = def.run({
      phase, x: xx, cycle: cyc, total, k, m, seed: (seed * 131 + i) | 0, u: w?.u ?? xx, row: w?.row ?? 0, rows: w?.rows ?? 1, beats, secs,
      sx, sy, rad, ang,
      lane: at ? at.lane[ci] : 0, lanes: at ? at.lanes : 1, gx, gy: at ? at.gy[ci] : 0, gw: at ? at.gw : m, gh: at ? at.gh : 1,
      first: at ? at.first[ci] === 1 : k === 0, cell: w?.cell ?? i, cells: at ? at.n : n, onShape: !!at, sw: at ? shapeW(at) : 1, sh: at ? shapeH(at) : 1,
    }, p);
    // (between Dim to and Bright to, so those stay the ends; a copy: an effect may hand out a shared one)
    out.push(p.contrast && o.intensity !== undefined && p.high > p.low
      ? { ...o, intensity: p.low + (p.high - p.low) * withContrast((o.intensity - p.low) / (p.high - p.low), p.contrast) } : o);
  }
  return out;
}

// ---------------------------------------------------------------- applying to the stage

// `barPan`: a head of a moving bar whose heads only tilt: its pan moves the whole bar (`true` on the
// first head, `false` on the others; undefined: the head pans itself)
export interface Target { fixture: string; cell?: number; barPan?: boolean }

// Mix one effect's output into the stage, by factor f (its weight times its level).
// `held`: how firmly something else sets each light's level (0..1, see the engine); `base`: the
// level the lists and the programmer gave it, before any effect.
export function applyFx(stage: Record<string, Resolved>, targets: Target[], outs: FxOut[], def: EffectDef, p: EffectParams, f: number, cellsOf: (id: string) => number,
  held?: Map<string, number>, base?: Map<string, number>) {
  if (f <= 0) return;
  targets.forEach((t, i) => {
    const s = stage[t.fixture];
    const o = outs[i];
    if (!s || !o) return;
    // a light with cells of its own (an effect on its pixels, or cells a cue or the programmer set):
    // a look per cell from here on, and an effect on the whole light reaches every cell
    if (!s.cells && (t.cell !== undefined || s.cellVals || s.cellLvl)) { const n = cellsOf(t.fixture); if (n > 0) s.cells = spreadCells(s, n); }
    if (t.cell === undefined) {
      if (o.pan !== undefined) s.pan = clamp01((s.pan ?? 0.5) + o.pan * f);
      if (o.tilt !== undefined) s.tilt = clamp01((s.tilt ?? 0.5) + o.tilt * f);
    } else if ((o.pan !== undefined || o.tilt !== undefined) && s.cells?.[t.cell]) {
      // one head of a moving bar: from where it points (its own, else the light's)
      const c = s.cells[t.cell];
      if (o.pan !== undefined && t.barPan === undefined) c.pan = clamp01((c.pan ?? s.pan ?? 0.5) + o.pan * f);
      else if (o.pan !== undefined && t.barPan) s.pan = clamp01((s.pan ?? 0.5) + o.pan * f);
      if (o.tilt !== undefined) c.tilt = clamp01((c.tilt ?? s.tilt ?? 0.5) + o.tilt * f);
    }
    // how firmly something else sets it: the light, or that one cell (the programmer set it)
    const holdOf = (k?: number) => Math.max(held?.get(t.fixture) ?? 0, k === undefined ? 0 : held?.get(`${t.fixture}#${k}`) ?? 0);
    const apply = (dst: Resolved, k?: number) => {
      if (o.color) {
        // a dark light's colour doesn't matter: start from the effect's own (no pastel while it comes up)
        dst.color = (dst.intensity ?? 0) < 0.004 ? { ...o.color } : lerpColor(dst.color ?? o.color, o.color, f);
        if (dst.white !== undefined) dst.white = mix(dst.white, 0, f);
      }
      if (o.strike !== undefined) {
        const v = o.strike * f;
        if (v > 0) { dst.intensity = Math.max(dst.intensity ?? 0, v); dst.color = lerpColor(dst.color ?? WHITE, WHITE, v); if (dst.white !== undefined) dst.white = Math.max(dst.white, v); }
      } else if (o.intensity !== undefined) dst.intensity = mix(dst.intensity ?? 0, o.intensity, f);
      // Lights nothing else holds come up with the effect; one a cue or the programmer sets keeps that
      // level. In between it's a crossfade, what holds it plus the effect for the rest: a list fading
      // out hands the light to the effect, a cue fading in takes it over, and neither dips to black.
      else if (p.lightUp && def.category !== 'intensity') {
        const lift = Math.min(1, (base?.get(t.fixture) ?? 0) + f * (1 - holdOf(k)));
        dst.intensity = Math.max(dst.intensity ?? 0, lift);
      }
    };
    if (t.cell !== undefined) apply(s.cells?.[t.cell] ?? s, t.cell);
    else { apply(s); if (s.cells) s.cells.forEach((c, k) => apply(c, k)); }
  });
}
