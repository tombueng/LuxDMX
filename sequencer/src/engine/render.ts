// Resolved values -> DMX bytes, through the fixture's channel layout.
//
// The show talks in colours and positions; this is the only place that knows about emitters,
// colour wheels, fine channels and shutter ranges.
import { isHeld } from '../model/safety';
import type { Channel, ChannelRange, Color, Fixture, FixtureMode, Resolved } from '../model/types';
import { topLevel } from './resolve';

export const DARK: Resolved = { intensity: 0, color: { r: 1, g: 1, b: 1 }, pan: 0.5, tilt: 0.5, strobe: 0 };
const WHITE: Color = { r: 1, g: 1, b: 1 };   // (read only)

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const CONTINUOUS = new Set(['intensity', 'pan', 'tilt', 'panRotation', 'tiltRotation', 'roll', 'rollRotation', 'hoist', 'cct', 'zoom', 'focus', 'iris', 'frost', 'speed', 'fog', 'haze', 'fan', 'goboRotation',
  'gobo2Rotation', 'prismRotation', 'animation', 'animationRotation', 'effectSpeed']);
// picked from the channel's ranges by position (a gobo, a built-in effect): see Values
export const SLOTTED = new Set(['gobo', 'gobo2', 'effectMacro', 'colorMacro']);
// a wheel's slots are its slot ranges; a macro channel's are all its ranges
export const slotsOf = (c: Channel) => (c.attr === 'gobo' || c.attr === 'gobo2' ? (c.ranges ?? []).filter((r) => r.kind === 'slot' || r.kind === undefined) : c.ranges ?? []);
const byte = (v: number) => Math.round(clamp01(v) * 255);
const word = (v: number) => Math.round(clamp01(v) * 65535);

// Middle of a range: the safest value to send for "this slot".
const mid = (r: { from: number; to: number }) => Math.round((r.from + r.to) / 2);

function hexToColor(h: string): Color {
  const n = parseInt(h.replace('#', ''), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

// Nearest colour-wheel slot to the wanted colour (plain distance in RGB, good enough for wheels
// that only have a handful of very different colours).
export function nearestSlot(c: Channel, want: Color): number | undefined {
  let best: number | undefined, bestD = Infinity;
  for (const r of c.ranges ?? []) {
    if (!r.color) continue;
    const s = hexToColor(r.color);
    const d = (s.r - want.r) ** 2 + (s.g - want.g) ** 2 + (s.b - want.b) ** 2;
    if (d < bestD) { bestD = d; best = mid(r); }
  }
  return best;
}

// The colour a fixture's emitters should show: white extraction for RGBW and friends. `cv`: a
// cell's own values over the light's (no copy made: a disc has hundreds of cells).
function emitters(hasWhite: boolean, v: Resolved, cv?: Resolved) {
  const c = cv?.color ?? v.color ?? WHITE;
  let { r, g, b } = c;
  let white = cv?.white ?? v.white;
  if (white === undefined && hasWhite) {   // nobody set white: move the common part of RGB onto it
    white = Math.min(r, g, b); r -= white; g -= white; b -= white;
  }
  return { r, g, b, white: white ?? 0, amber: cv?.amber ?? v.amber ?? 0, uv: cv?.uv ?? v.uv ?? 0 };
}

// What a fixture can actually show, so the stage draws the truth and the DMX follows the intent:
// - warm/cool white fixtures take a whitish colour as a colour temperature ("Warm white" makes
//   them warm, "Cool white" cool, "White" the middle); a real colour they can't make leaves them
//   where they are. Only when someone asked for a colour (`colored`): plain white is everyone's
//   starting point and mustn't move a CTO channel off its default.
// - plain dimmers glow like tungsten, white-only fixtures like white.
// The DMX path never reads `draw`; only the stage and the pictures do.
export const WARM: Color = { r: 1, g: 0.72, b: 0.42 }, COOL: Color = { r: 0.82, g: 0.9, b: 1 }, TUNGSTEN: Color = { r: 1, g: 0.8, b: 0.55 };
// The white a colour temperature makes (0 warm .. 1 cool), as a colour at full (for an RGB light).
export function cctColor(t: number): Color {
  const k = clamp01(t), c = { r: WARM.r + (COOL.r - WARM.r) * k, g: WARM.g + (COOL.g - WARM.g) * k, b: WARM.b + (COOL.b - WARM.b) * k };
  const m = Math.max(c.r, c.g, c.b);
  return { r: c.r / m, g: c.g / m, b: c.b / m };
}
// A whitish colour's place between warm (0), white (0.5) and cool (1), from its blue/red balance.
export function whiteTemperature(c: Color): number | undefined {
  const max = Math.max(c.r, c.g, c.b) || 1;
  if ((max - Math.min(c.r, c.g, c.b)) / max >= 0.6) return undefined;          // a real colour
  const k = (c.b / max) / Math.max(0.01, c.r / max);        // blue over red: warm white ~0.45, white 1, cool white ~1.2
  return k <= 1 ? clamp01((k - 0.5) / 0.5 * 0.5) : clamp01(0.5 + (k - 1) / 0.18 * 0.5);
}
export function fitLook(v: Resolved, caps: { color: boolean; cct: boolean; white?: boolean }, colored = true): void {
  if (caps.color) return;
  if (caps.cct) {
    if (v.cct === undefined && v.color && colored) { const t = whiteTemperature(v.color); if (t !== undefined) v.cct = t; }
    const t = v.cct ?? 0.5;
    v.draw = { r: WARM.r + (COOL.r - WARM.r) * t, g: WARM.g + (COOL.g - WARM.g) * t, b: WARM.b + (COOL.b - WARM.b) * t };
    return;
  }
  v.draw = caps.white ? { r: 1, g: 1, b: 1 } : TUNGSTEN;
  if (v.cells) for (const c of v.cells) c.draw = v.draw;
}

// What rendering needs to know about a mode, worked out once per mode (a fixture type is never
// edited in place: saving one makes a new object), so a frame of hundreds of lights doesn't scan
// every layout again.
const MIXING = new Set(['red', 'green', 'blue', 'cyan', 'magenta', 'yellow']);
interface Plan {
  hasMaster: boolean; // a dimmer for the whole light (not one cell's)
  cellDim: Set<number>;   // cells with a dimmer of their own (a 4-lite blinder's lamps)
  hasWhite: boolean;
  mixes: boolean;     // mixes colour (RGB or CMY): keeps its colour wheel open, or red would be red twice
  hi: boolean[];      // per channel: the coarse byte of a 16-bit attribute
  fixed: boolean[];   // per channel: the fine byte of a wheel or a shutter (sits at its default)
  barPan: boolean; barTilt: boolean;   // a moving bar that pans / tilts as a whole besides its heads
  open: (ChannelRange | undefined)[];      // shutter ranges
  strobe: (ChannelRange | undefined)[];
  slots: (ChannelRange[] | undefined)[];   // gobo slots
  hasCells: boolean;                        // channels that belong to cells (a pixel light)
}
const plans = new WeakMap<FixtureMode, Plan>();
function planOf(m: FixtureMode): Plan {
  let p = plans.get(m);
  if (p) return p;
  const ch = m.channels;
  // Attributes that have a fine channel here go out as 16 bit (coarse = high byte); everything
  // else is a plain rounded byte.
  const sixteen = new Set(ch.filter((c) => c.fine).map((c) => c.attr));
  p = {
    hasMaster: ch.some((c) => c.attr === 'intensity' && c.cell === undefined),
    cellDim: new Set(ch.filter((c) => c.attr === 'intensity' && c.cell !== undefined).map((c) => c.cell!)),
    hasWhite: ch.some((c) => c.attr === 'white' && !c.fine),
    mixes: ch.some((c) => MIXING.has(c.attr)),
    hi: ch.map((c) => sixteen.has(c.attr)),
    // A fine channel only means something for continuous attributes. The fine byte of a wheel or
    // a shutter (OFL lists some) sits at its default.
    fixed: ch.map((c) => !!c.fine && !CONTINUOUS.has(c.attr)),
    // (a moving bar with its own pan / tilt besides its heads')
    barPan: ch.some((c) => c.attr === 'pan' && c.cell === undefined) && ch.some((c) => c.attr === 'pan' && c.cell !== undefined),
    barTilt: ch.some((c) => c.attr === 'tilt' && c.cell === undefined) && ch.some((c) => c.attr === 'tilt' && c.cell !== undefined),
    open: ch.map((c) => (c.attr === 'shutter' ? c.ranges?.find((r) => r.kind === 'open') : undefined)),
    strobe: ch.map((c) => (c.attr === 'shutter' ? c.ranges?.find((r) => r.kind === 'strobe') : undefined)),
    slots: ch.map((c) => (SLOTTED.has(c.attr) ? slotsOf(c) : undefined)),
    hasCells: ch.some((c) => c.cell !== undefined),
  };
  plans.set(m, p);
  return p;
}

// A continuous value on its channel: a part of it (span), the low byte of 16 bit, the high byte,
// or a plain byte.
export function level(c: Channel, hi: boolean, x: number): number {
  if (c.span) return c.fine ? 0 : Math.round(c.span[0] + (c.span[1] - c.span[0]) * clamp01(x));   // only part of the channel is the control
  return c.fine ? word(x) & 0xff : hi ? word(x) >> 8 : byte(x);
}

type Emit = ReturnType<typeof emitters>;
// `out`: a universe, or a buffer of its own for a light too big for one (the engine splits that up).
export function renderFixture(f: Fixture, m: FixtureMode, v: Resolved, out: Uint8Array, base = f.address - 1) {
  const P = planOf(m), chs = m.channels;
  const { hasMaster } = P;
  // Per-pixel looks (an effect on a pixel bar, single cells from a cue): a master dimmer carries
  // the brightest cell; under it, a cell's own dimmer (or else its emitters) carries the rest.
  // (cells: one look each, from effects or the live layer; else the cells' own values, sparse, and
  // their levels worked out per cell)
  // (a light without cells ignores any: a cue's cells from before its type changed must never
  // drive its dimmer, past Blackout and the masters)
  const cells = P.hasCells ? v.cells : undefined, lv = cells || !P.hasCells ? undefined : v.cellLvl, cvs = cells || !P.hasCells ? undefined : v.cellVals;
  const own = v.intensity ?? 0;
  const dim = hasMaster && (cells || lv || cvs) ? topLevel(v) : own;   // (P.hasCells here: the engine trims cells past its count)
  // what the master dimmer sends (none: as if at full)
  const M = hasMaster ? dim : 1;
  // No dimmer channel: the emitters carry the intensity (virtual dimmer). Under a master that
  // carries a brighter cell, the light's own emitters (a pixel head's main beam) take their share.
  // (only when a cell is brighter than the light: a dark PAR keeps its colour, its dimmer is at 0)
  const k0 = hasMaster ? (M > own + 1e-9 ? own / M : 1) : dim;
  const e0 = emitters(P.hasWhite, v), color0 = v.color ?? WHITE;
  let cellLook: Map<number, { e: Emit; k: number; color: Color; ci: number }> | undefined;
  const cct = v.cct;
  // warm/cool pair: the middle is both at full (the brightest white it has), the ends one of them
  const ww = Math.min(1, 2 * (1 - (cct ?? 0.5))), cw = Math.min(1, 2 * (cct ?? 0.5));
  // (swapped first: invert, the range and the offsets are the motors' own, model/fixtureSetup.ts)
  const p0 = f.swapPanTilt ? v.tilt : v.pan, t0 = f.swapPanTilt ? v.pan : v.tilt;
  const pan = f.invertPan ? 1 - (p0 ?? 0.5) : (p0 ?? 0.5);
  const tilt = f.invertTilt ? 1 - (t0 ?? 0.5) : (t0 ?? 0.5);
  const strobe = v.strobe ?? 0;
  const raws = v.raw;
  // a head of its own among the cells (a moving bar): where it points, its own else the light's,
  // swapped and inverted as the light is
  // (a bar that pans or tilts as a whole as well: its heads' own motors at their middle unless set,
  // or the bar's angle would count twice)
  const headAt = (k: number) => {
    const cv = cells?.[k] ?? cvs?.[k], pp = cv?.pan ?? (P.barPan ? 0.5 : v.pan), tt = cv?.tilt ?? (P.barTilt ? 0.5 : v.tilt);
    const a = f.swapPanTilt ? tt : pp, b = f.swapPanTilt ? pp : tt;
    return { pan: f.invertPan ? 1 - (a ?? 0.5) : (a ?? 0.5), tilt: f.invertTilt ? 1 - (b ?? 0.5) : (b ?? 0.5) };
  };

  for (let i = 0; i < chs.length; i++) {
    const at = base + i;
    if (at < 0 || at >= out.length) continue;
    const c = chs[i];
    const raw = raws?.[i];
    // (never a winch's height: a raw number fades in from 0, its top; its height is set as a height)
    if (raw !== undefined && !isHeld(c.attr)) { out[at] = Math.max(0, Math.min(255, Math.round(raw))); continue; }
    if (P.fixed[i]) { out[at] = c.default ?? 0; continue; }
    const hi = P.hi[i];
    let e = e0, k = k0, color = color0, ci = dim;
    if (c.cell !== undefined) {
      let l = (cellLook ??= new Map()).get(c.cell);
      if (!l) {
        const cv = cells?.[c.cell] ?? cvs?.[c.cell];
        // its level: its own, else the light's
        const lvl = cells ? (cv?.intensity ?? own) : lv ? lv[c.cell] ?? 0 : cv?.intensity ?? own;
        const color = cv?.color ?? v.color ?? WHITE;
        // what's left for this cell under the master: on its own dimmer, else on its emitters
        const rel = M > 0 ? Math.min(1, lvl / M) : 0;
        l = { e: cv ? emitters(P.hasWhite, v, cv) : e0, k: P.cellDim.has(c.cell) ? 1 : rel, color, ci: rel };
        cellLook.set(c.cell, l);
      }
      ({ e, k, color, ci } = l);
    }
    let d: number | undefined;
    switch (c.attr) {
      case 'intensity': d = level(c, hi, c.cell !== undefined ? ci : dim); break;
      case 'red': d = byte(e.r * k); break;
      case 'green': d = byte(e.g * k); break;
      case 'blue': d = byte(e.b * k); break;
      case 'white': d = byte(e.white * k); break;
      case 'amber': d = byte(e.amber * k); break;
      case 'uv': d = byte(e.uv * k); break;
      case 'lime': d = 0; break;
      case 'cyan': d = byte((1 - color.r) * k); break;
      case 'magenta': d = byte((1 - color.g) * k); break;
      case 'yellow': d = byte((1 - color.b) * k); break;
      case 'cct': if (cct !== undefined) d = level(c, hi, cct); break;   // unset: the channel's default (a CTO filter: no filter)
      case 'warmWhite': d = byte(ww * k); break;
      case 'coolWhite': d = byte(cw * k); break;
      case 'colorWheel': d = nearestSlot(c, P.mixes ? WHITE : color); break;
      case 'pan': d = level(c, hi, c.cell !== undefined ? headAt(c.cell).pan : pan); break;
      case 'tilt': d = level(c, hi, c.cell !== undefined ? headAt(c.cell).tilt : tilt); break;
      case 'strobe': d = strobe > 0 ? level(c, hi, strobe) : (c.default ?? 0); break;   // 0 = the channel's 'no strobe' value
      case 'shutter': {
        const open = P.open[i], st = P.strobe[i];
        if (strobe > 0 && st) d = Math.round(st.from + (st.to - st.from) * clamp01(strobe));
        else if (open) d = mid(open);
        break;
      }
      case 'gobo': case 'gobo2': case 'effectMacro': case 'colorMacro': {
        const slots = P.slots[i]!, x = v[c.attr];
        // a gobo wheel's own functions first, on its channel's other ranges: the whole wheel running
        // round, or the gobo it's on shaking
        if (c.attr === 'gobo' || c.attr === 'gobo2') {
          const w = wheelByte(c, slots, x, v[`${c.attr}Scroll`], v[`${c.attr}Shake`]);
          if (w !== undefined) { d = w; break; }
        }
        if (x === undefined) break;
        // (no ranges to pick from: a plain level over the channel)
        d = slots.length ? mid(slots[Math.min(slots.length - 1, Math.round(clamp01(x) * (slots.length - 1)))]) : level(c, hi, x);
        break;
      }
      case 'enable': d = 0; break;   // (the engine sets it from the arming, last: engine.ts)
      // a winch: never past its soft limits, whatever the cue says (the engine holds it while safe)
      case 'hoist': {
        // (a winch among cells: its own height, else the light's)
        const x = (c.cell !== undefined ? (cells?.[c.cell] ?? cvs?.[c.cell])?.hoist : undefined) ?? v.hoist;
        if (x === undefined) break;
        const lim = f.hoistLimits; d = level(c, hi, lim ? Math.max(lim[0], Math.min(lim[1], x)) : x); break;
      }
      case 'goboRotation': case 'prism': case 'zoom': case 'focus': case 'iris': case 'frost':
      case 'gobo2Rotation': case 'prismRotation': case 'animation': case 'animationRotation': case 'effectSpeed':
      case 'panRotation': case 'tiltRotation': case 'roll': case 'rollRotation':
      case 'fog': case 'haze': case 'fan': case 'speed': case 'confetti': case 'bubbles': case 'flame': case 'sparks': case 'co2': {
        const x = v[c.attr];
        if (x !== undefined) d = level(c, hi, x);
        break;
      }
    }
    out[at] = d ?? c.default ?? 0;
  }
}

// A gobo wheel running round (scroll: -1..1, counter-clockwise .. clockwise) or its gobo shaking
// (0..1 how fast), as the channel's ranges have them ("Wheel rotation CW fast..slow", "Shake 3
// slow..fast"; a shake range is the gobo its number says, counting Open as 1). Undefined: the
// channel has no such range (or nothing asked for): the slot as it is.
const CCW = /ccw|counter|anti|gegen|left|links|reverse|\brev\b|backward|\bback\b|rückwärts|rueckwaerts|retour/i;
function wheelByte(c: Channel, slots: ChannelRange[], x: number | undefined, scroll?: number, shake?: number): number | undefined {
  const others = c.ranges?.filter((r) => r.kind === 'other' && r.label);
  if (!others?.length) return undefined;
  const at = (r: ChannelRange, speed: number) => {
    const k = clamp01(/fast.*slow|schnell.*langsam/i.test(r.label!) ? 1 - speed : speed);
    return Math.round(r.from + (r.to - r.from) * k);
  };
  if (scroll && Math.abs(scroll) > 1e-3) {
    const runs = others.filter((r) => /rotat|scroll|spin|dreh|cycl|lauf/i.test(r.label!) && !/shake|wackel/i.test(r.label!));
    const r = runs.find((q) => CCW.test(q.label!) === scroll < 0) ?? runs[0];
    if (r) return at(r, Math.abs(scroll));
  }
  if (shake && shake > 1e-3 && x !== undefined && slots.length) {
    const slot = Math.round(clamp01(x) * (slots.length - 1)) + 1;
    const r = others.find((q) => /shake|wackel|zitter|bounce|vibrat/i.test(q.label!) && +(/(\d+)/.exec(q.label!)?.[1] ?? NaN) === slot);
    if (r) return at(r, shake);
  }
  return undefined;
}

// The other way round, for the pictures only: channels set by hand (the programmer's "All
// channels", raw DMX values) go out as they are, so the stage draws what those bytes do, read back
// the way a visualizer reads DMX. Only what a raw channel controls changes; the rest of the look
// stays. `bytes`: what goes out on each of the light's channels (a raw coarse byte with the fine
// byte the engine made: both count). Cells are left to the pixels' own path (app.ledShown).
const EMITTING = new Set(['red', 'green', 'blue', 'white', 'amber', 'uv', 'cyan', 'magenta', 'yellow', 'warmWhite', 'coolWhite']);
const READ_BACK = new Set(['intensity', 'cct', 'panRotation', 'tiltRotation', 'roll', 'rollRotation', 'hoist', 'zoom', 'focus', 'iris', 'frost', 'prism', 'goboRotation', 'gobo2Rotation', 'prismRotation', 'animation',
  'animationRotation', 'effectSpeed', 'fog', 'haze', 'fan', 'speed', 'confetti', 'bubbles', 'flame', 'sparks', 'co2']);
export function rawLook(f: Fixture, m: FixtureMode, v: Resolved, bytes: ArrayLike<number>): Resolved {
  const raw = v.raw;
  if (!raw) return v;
  const chs = m.channels, P = planOf(m), hit = new Set<string>();
  for (const k in raw) { const c = chs[+k]; if (c && c.cell === undefined && raw[k] !== undefined) hit.add(c.attr); }
  if (!hit.size) return v;
  const out: Resolved = { ...v };
  const at = (attr: string, fine = false) => chs.findIndex((c) => c.attr === attr && !!c.fine === fine && c.cell === undefined);
  const b = (i: number) => (i >= 0 ? bytes[i] ?? 0 : 0);
  // a continuous attribute from its coarse (and fine) byte, or the part of the channel it uses
  const cont = (attr: string): number | undefined => {
    const i = at(attr);
    if (i < 0) return undefined;
    const c = chs[i];
    if (c.span) return clamp01((b(i) - c.span[0]) / Math.max(1, c.span[1] - c.span[0]));
    const j = P.hi[i] ? at(attr, true) : -1;
    return j >= 0 ? ((b(i) << 8) | b(j)) / 65535 : b(i) / 255;
  };
  const rangeOf = (i: number) => chs[i].ranges?.find((r) => b(i) >= r.from && b(i) <= r.to);
  const set = (attr: string, x: number | undefined) => { if (x !== undefined) (out as Record<string, unknown>)[attr] = x; };
  for (const attr of hit) {
    if (READ_BACK.has(attr)) { set(attr, cont(attr)); continue; }
    const i = at(attr);
    switch (attr) {
      case 'pan': case 'tilt': {
        const x = cont(attr);
        if (x === undefined) break;
        // (the motor's value: inverted back, and on a swapped head it's what a cue calls the other)
        const cue = (attr === 'pan' ? f.invertPan : f.invertTilt) ? 1 - x : x;
        set(f.swapPanTilt ? (attr === 'pan' ? 'tilt' : 'pan') : attr, cue);
        break;
      }
      case 'strobe': if (i >= 0) set('strobe', b(i) === (chs[i].default ?? 0) ? 0 : cont('strobe')); break;
      case 'shutter': {
        const r = i >= 0 ? rangeOf(i) : undefined;
        if (r?.kind === 'strobe') set('strobe', Math.max(0.05, (b(i) - r.from) / Math.max(1, r.to - r.from)));
        else if (r?.kind === 'closed') set('intensity', 0);
        else if (r?.kind === 'open') set('strobe', 0);
        break;
      }
      case 'gobo': case 'gobo2': case 'effectMacro': case 'colorMacro': {
        const slots = P.slots[i] ?? [];
        if (!slots.length) { set(attr, cont(attr)); break; }
        const k = slots.findIndex((r) => b(i) >= r.from && b(i) <= r.to);
        if (k >= 0) { set(attr, slots.length > 1 ? k / (slots.length - 1) : 0); break; }
        // a gobo wheel's other ranges: a slot shaking ("Shake 3 slow..fast"), the wheel running
        // through its slots ("Rotation CW slow..fast", "Scroll")
        const r = (attr === 'gobo' || attr === 'gobo2') && i >= 0 ? rangeOf(i) : undefined;
        const l = (r?.label ?? '').toLowerCase(), pos = r && r.to > r.from ? (b(i) - r.from) / (r.to - r.from) : 0;
        const fast = /fast.*slow|schnell.*langsam/.test(l) ? 1 - pos : pos;
        if (r && /shake|wackel|zitter|bounce|vibrat/.test(l)) {
          const n = /(\d+)/.exec(l);
          if (n) set(attr, slots.length > 1 ? Math.max(0, Math.min(slots.length - 1, +n[1] - 1)) / (slots.length - 1) : 0);
          set(`${attr}Shake`, Math.max(0.05, fast));
        } else if (r && /rotat|scroll|spin|dreh|rainbow|cycl|lauf/.test(l)) {
          set(`${attr}Scroll`, (CCW.test(l) ? -1 : 1) * Math.max(0.05, fast));
        }
        break;
      }
      case 'colorWheel': {
        const r = i >= 0 ? rangeOf(i) : undefined;
        if (!r?.color) break;
        // (the wheel's filter over what the light mixes; on a light that only has the wheel, its colour)
        const w = hexToColor(r.color), c = P.mixes ? out.color ?? WHITE : WHITE;
        out.color = { r: c.r * w.r, g: c.g * w.g, b: c.b * w.b };
        if (out.draw) out.draw = out.color;
        break;
      }
    }
  }
  // emitters: the colour they make together (and with no dimmer of its own, how bright)
  if ([...hit].some((a) => EMITTING.has(a))) {
    const e = (attr: string) => { const i = at(attr); return i < 0 ? undefined : b(i) / 255; };
    let r = e('red') ?? 0, g = e('green') ?? 0, bl = e('blue') ?? 0;
    const C = e('cyan'), M = e('magenta'), Y = e('yellow');
    if (C !== undefined || M !== undefined || Y !== undefined) { r = 1 - (C ?? 0); g = 1 - (M ?? 0); bl = 1 - (Y ?? 0); }   // (CMY flags over the lamp's white)
    const w = e('white') ?? 0, a = e('amber') ?? 0, ww = e('warmWhite') ?? 0, cw = e('coolWhite') ?? 0;
    r += w + a + ww * WARM.r + cw * COOL.r; g += w + a * 0.6 + ww * WARM.g + cw * COOL.g; bl += w + ww * WARM.b + cw * COOL.b;
    const top = Math.max(r, g, bl);
    if (top > 0) { out.color = { r: r / top, g: g / top, b: bl / top }; if (out.draw) out.draw = out.color; }
    if (!P.hasMaster) out.intensity = Math.min(1, top);
    const uv = e('uv');
    if (uv !== undefined) out.uv = uv;
  }
  // a colour temperature set by hand on a light that only has that: the white it makes
  if (hit.has('cct') && out.draw && out.cct !== undefined) {
    const t = out.cct;
    out.draw = { r: WARM.r + (COOL.r - WARM.r) * t, g: WARM.g + (COOL.g - WARM.g) * t, b: WARM.b + (COOL.b - WARM.b) * t };
  }
  return out;
}
