// Values -> Resolved: look up every preset reference for one fixture. A preset can carry a value
// for all fixtures and overrides per fixture (each mover's own "on the singer" position).
import type { Color, NumAttr, Preset, PresetRef, Resolved, Values } from '../model/types';

const isRef = (v: unknown): v is PresetRef => !!v && typeof v === 'object' && 'preset' in (v as object);

export function resolveValues(v: Values | undefined, fixtureId: string, presets: Map<string, Preset>): Resolved {
  const out: Resolved = {};
  if (!v) return out;
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined) continue;
    if (k === 'raw') { out.raw = { ...(val as Record<string, number>) }; continue; }
    if (isRef(val)) {
      const p = presets.get(val.preset);
      const pv = p ? (p.perFixture?.[fixtureId]?.[k as NumAttr] ?? p.values[k as NumAttr]) : undefined;
      if (pv === undefined || isRef(pv)) continue;          // presets don't nest
      (out as Record<string, unknown>)[k] = typeof pv === 'object' ? { ...(pv as Color) } : pv;
    } else {
      (out as Record<string, unknown>)[k] = typeof val === 'object' ? { ...(val as Color) } : val;
    }
  }
  return out;
}

const NUM: NumAttr[] = ['intensity', 'white', 'amber', 'uv', 'cct', 'pan', 'tilt', 'strobe', 'zoom', 'focus', 'iris',
  'frost', 'prism', 'goboRotation', 'gobo', 'fog', 'haze', 'fan', 'speed', 'confetti', 'bubbles', 'flame', 'sparks', 'co2'];
// Attributes that jump instead of fading (a gobo halfway between two slots is a different gobo).
const SNAP_AT_START: NumAttr[] = ['gobo', 'prism'];
const SNAP_AT_END: NumAttr[] = ['strobe'];

// Blend b over a by t (0 = a, 1 = b). Attributes only one side has are taken as they are.
export function lerpResolved(a: Resolved, b: Resolved, t: number, tIntensity = t): Resolved {
  const out: Resolved = { ...a };
  for (const k of NUM) {
    const x = a[k], y = b[k];
    if (y === undefined) continue;
    if (x === undefined) { out[k] = y; continue; }
    const tt = k === 'intensity' ? tIntensity : t;
    out[k] = SNAP_AT_START.includes(k) ? (tt > 0 ? y : x) : SNAP_AT_END.includes(k) ? (tt >= 1 ? y : x) : x + (y - x) * tt;
  }
  if (b.color) {
    const c = a.color ?? b.color;
    out.color = { r: c.r + (b.color.r - c.r) * t, g: c.g + (b.color.g - c.g) * t, b: c.b + (b.color.b - c.b) * t };
  }
  if (b.raw) {
    out.raw = { ...(a.raw ?? {}) };
    for (const [ch, v] of Object.entries(b.raw)) {
      const from = a.raw?.[ch] ?? 0;      // nothing underneath: fade from zero (a list fading in or out)
      out.raw[ch] = Math.round(from + (v - from) * t);
    }
  }
  return out;
}
