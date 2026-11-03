// Resolved values -> DMX bytes, through the fixture's channel layout.
//
// The show talks in colours and positions; this is the only place that knows about emitters,
// colour wheels, fine channels and shutter ranges.
import type { Channel, ChannelRange, Color, Fixture, FixtureMode, Resolved } from '../model/types';

export const DARK: Resolved = { intensity: 0, color: { r: 1, g: 1, b: 1 }, pan: 0.5, tilt: 0.5, strobe: 0 };
const WHITE: Color = { r: 1, g: 1, b: 1 };   // (read only)

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const CONTINUOUS = new Set(['intensity', 'pan', 'tilt', 'cct', 'zoom', 'focus', 'iris', 'frost', 'speed', 'fog', 'haze', 'fan', 'goboRotation']);
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

// The colour a fixture's emitters should show: white extraction for RGBW and friends.
function emitters(hasWhite: boolean, v: Resolved) {
  const c = v.color ?? WHITE;
  let { r, g, b } = c;
  let white = v.white;
  if (white === undefined && hasWhite) {   // nobody set white: move the common part of RGB onto it
    white = Math.min(r, g, b); r -= white; g -= white; b -= white;
  }
  return { r, g, b, white: white ?? 0, amber: v.amber ?? 0, uv: v.uv ?? 0 };
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
  hasDimmer: boolean;
  hasWhite: boolean;
  mixes: boolean;     // mixes colour (RGB or CMY): keeps its colour wheel open, or red would be red twice
  hi: boolean[];      // per channel: the coarse byte of a 16-bit attribute
  fixed: boolean[];   // per channel: the fine byte of a wheel or a shutter (sits at its default)
  open: (ChannelRange | undefined)[];      // shutter ranges
  strobe: (ChannelRange | undefined)[];
  slots: (ChannelRange[] | undefined)[];   // gobo slots
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
    hasDimmer: ch.some((c) => c.attr === 'intensity'),
    hasWhite: ch.some((c) => c.attr === 'white' && !c.fine),
    mixes: ch.some((c) => MIXING.has(c.attr)),
    hi: ch.map((c) => sixteen.has(c.attr)),
    // A fine channel only means something for continuous attributes. The fine byte of a wheel or
    // a shutter (OFL lists some) sits at its default.
    fixed: ch.map((c) => !!c.fine && !CONTINUOUS.has(c.attr)),
    open: ch.map((c) => (c.attr === 'shutter' ? c.ranges?.find((r) => r.kind === 'open') : undefined)),
    strobe: ch.map((c) => (c.attr === 'shutter' ? c.ranges?.find((r) => r.kind === 'strobe') : undefined)),
    slots: ch.map((c) => (c.attr === 'gobo' ? (c.ranges ?? []).filter((r) => r.kind === 'slot' || r.kind === undefined) : undefined)),
  };
  plans.set(m, p);
  return p;
}

// A continuous value on its channel: a part of it (span), the low byte of 16 bit, the high byte,
// or a plain byte.
function level(c: Channel, hi: boolean, x: number): number {
  if (c.span) return c.fine ? 0 : Math.round(c.span[0] + (c.span[1] - c.span[0]) * clamp01(x));   // only part of the channel is the control
  return c.fine ? word(x) & 0xff : hi ? word(x) >> 8 : byte(x);
}

type Emit = ReturnType<typeof emitters>;
export function renderFixture(f: Fixture, m: FixtureMode, v: Resolved, out: Uint8Array) {
  const P = planOf(m), chs = m.channels, base = f.address - 1;
  const { hasDimmer } = P;
  // Per-pixel looks (an effect on a pixel bar): a master dimmer carries the brightest cell, each
  // cell's emitters carry the rest.
  const cells = v.cells;
  let dim = v.intensity ?? 0;
  if (cells && hasDimmer) { dim = 0; for (const c of cells) dim = Math.max(dim, c.intensity ?? 0); }
  // No dimmer channel: the emitters carry the intensity (virtual dimmer).
  const k0 = hasDimmer ? 1 : dim;
  const e0 = emitters(P.hasWhite, v), color0 = v.color ?? WHITE;
  let cellLook: Map<number, { e: Emit; k: number; color: Color }> | undefined;
  const cct = v.cct;
  // warm/cool pair: the middle is both at full (the brightest white it has), the ends one of them
  const ww = Math.min(1, 2 * (1 - (cct ?? 0.5))), cw = Math.min(1, 2 * (cct ?? 0.5));
  // (swapped first: invert, the range and the offsets are the motors' own, model/fixtureSetup.ts)
  const p0 = f.swapPanTilt ? v.tilt : v.pan, t0 = f.swapPanTilt ? v.pan : v.tilt;
  const pan = f.invertPan ? 1 - (p0 ?? 0.5) : (p0 ?? 0.5);
  const tilt = f.invertTilt ? 1 - (t0 ?? 0.5) : (t0 ?? 0.5);
  const strobe = v.strobe ?? 0;
  const raws = v.raw;

  for (let i = 0; i < chs.length; i++) {
    const at = base + i;
    if (at < 0 || at >= 512) continue;
    const c = chs[i];
    const raw = raws?.[i];
    if (raw !== undefined) { out[at] = Math.max(0, Math.min(255, Math.round(raw))); continue; }
    if (P.fixed[i]) { out[at] = c.default ?? 0; continue; }
    const hi = P.hi[i];
    let e = e0, k = k0, color = color0;
    const cv = c.cell !== undefined ? cells?.[c.cell] : undefined;
    if (cv) {
      let l = (cellLook ??= new Map()).get(c.cell!);
      if (!l) {
        const ci = cv.intensity ?? 0;
        const merged = { ...v, ...cv };
        l = { e: emitters(P.hasWhite, merged), k: hasDimmer ? (dim > 0 ? ci / dim : 0) : ci, color: merged.color ?? WHITE };
        cellLook.set(c.cell!, l);
      }
      ({ e, k, color } = l);
    }
    let d: number | undefined;
    switch (c.attr) {
      case 'intensity': d = level(c, hi, dim); break;
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
      case 'pan': d = level(c, hi, pan); break;
      case 'tilt': d = level(c, hi, tilt); break;
      case 'strobe': d = strobe > 0 ? level(c, hi, strobe) : (c.default ?? 0); break;   // 0 = the channel's 'no strobe' value
      case 'shutter': {
        const open = P.open[i], st = P.strobe[i];
        if (strobe > 0 && st) d = Math.round(st.from + (st.to - st.from) * clamp01(strobe));
        else if (open) d = mid(open);
        break;
      }
      case 'gobo': {
        const slots = P.slots[i]!;
        if (slots.length && v.gobo !== undefined) d = mid(slots[Math.min(slots.length - 1, Math.round(clamp01(v.gobo) * (slots.length - 1)))]);
        break;
      }
      case 'enable': d = 0; break;   // (the engine sets it from the arming, last: engine.ts)
      case 'goboRotation': case 'prism': case 'zoom': case 'focus': case 'iris': case 'frost':
      case 'fog': case 'haze': case 'fan': case 'speed': case 'confetti': case 'bubbles': case 'flame': case 'sparks': case 'co2': {
        const x = v[c.attr];
        if (x !== undefined) d = level(c, hi, x);
        break;
      }
    }
    out[at] = d ?? c.default ?? 0;
  }
}
