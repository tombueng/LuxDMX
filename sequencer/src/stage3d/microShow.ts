// A light's micro show: a few seconds that show off what it can do, played in a loop on its
// preview (preview.ts) in the library and the gallery. Built from what the light has, in the units
// the 3D stage draws (rig.ts): a spot sweeps, changes colour, runs through its gobos turning, then
// puts its prism in; a wash breathes its zoom through the colours; a PAR runs the colours; a strobe
// flashes; a bar or a ring chases a rainbow along its pixels; a moving bar waves its heads.
// Pure (no three.js): the same values every time for the same t, so it can be tested.
import type { Color, FixtureMode, Resolved } from '../model/types';
import type { RigFixture } from './rig';
import { prismOf, rotationOf } from './gobos';

export const SHOW_LEN = 8;          // seconds; the show loops

type Ranges = { from: number; to: number; label?: string }[] | undefined;
export interface MicroShow { len: number; at(t: number): Resolved; does: string[] }

// a colour from a hue (0..1, round the wheel), full and bright
export function hue(h: number): Color {
  const x = ((h % 1) + 1) % 1, i = Math.floor(x * 6), f = x * 6 - i;
  const q = 1 - f;
  return [{ r: 1, g: f, b: 0 }, { r: q, g: 1, b: 0 }, { r: 0, g: 1, b: f }, { r: 0, g: q, b: 1 }, { r: f, g: 0, b: 1 }, { r: 1, g: 0, b: q }][i % 6];
}
// a colour wheel's look: a few of the usual slot colours, one after the other (the engine knows the
// slots' real colours; a preview only needs it to look like a wheel stepping)
const WHEEL: Color[] = [{ r: 1, g: 0.08, b: 0.05 }, { r: 0.1, g: 0.35, b: 1 }, { r: 0.05, g: 1, b: 0.2 }, { r: 1, g: 0.75, b: 0.05 }, { r: 0.85, g: 0.1, b: 1 }, { r: 0.1, g: 0.95, b: 1 }];

// the value of a rotation channel that turns it at about this speed (radians a second), from its
// ranges; null when nothing on it turns
export function turnValue(ranges: Ranges, want = 1.4): number | null {
  let best: number | null = null, bd = Infinity;
  for (let i = 1; i <= 64; i++) {
    const x = i / 64, r = rotationOf(ranges, x);
    if (!('speed' in r) || Math.abs(r.speed) < 0.2) continue;
    const d = Math.abs(Math.abs(r.speed) - want);
    if (d < bd) { bd = d; best = x; }
  }
  return best;
}
// the value of a prism channel that puts it in (the most facets that are round), null: none
export function prismValue(ranges: Ranges): number | null {
  let best: number | null = null, bf = 0;
  for (let i = 1; i <= 64; i++) {
    const x = i / 64, p = prismOf(ranges, x);
    if (p && !p.linear && p.facets > bf) { bf = p.facets; best = x; }
  }
  if (best === null) for (let i = 1; i <= 64; i++) if (prismOf(ranges, i / 64)) return i / 64;
  return best;
}

export function microShow(rf: Pick<RigFixture, 'look' | 'cells' | 'gobos' | 'prism' | 'anim' | 'heads' | 'winch' | 'kind'>, m: FixtureMode | undefined): MicroShow {
  const attrs = new Set(m?.channels.map((c) => c.attr) ?? []);
  const has = (a: string) => attrs.has(a as never);
  const mixes = (has('red') && has('green') && has('blue')) || (has('cyan') && has('magenta') && has('yellow'));
  const wheel = !mixes && has('colorWheel');
  const coloured = mixes || wheel;
  const L = SHOW_LEN, look = rf.look, cells = Math.max(1, rf.cells);
  const does: string[] = [];
  const colourAt = (t: number, speed = 1): Color | undefined => (mixes ? hue(t / L * speed) : wheel ? WHEEL[Math.floor((t / L) * 4 * speed) % WHEEL.length] : undefined);
  if (mixes) does.push('colour mixing'); else if (wheel) does.push('colour wheel');

  // ---- moving heads
  if (look === 'spot' || look === 'wash') {
    const gw = rf.gobos?.[0], slots = gw ? gw.slots.map((s, i) => [s, i] as const).filter(([s]) => s !== null).map(([, i]) => i) : [];
    const goboRot = gw ? turnValue(gw.rot) : null;
    const pv = rf.prism ? prismValue(rf.prism.ranges) : null, prot = rf.prism ? turnValue(rf.prism.rot, 0.9) : null;
    const zoom = has('zoom');
    if (has('pan') || has('tilt')) does.push('pan and tilt');
    if (slots.length) does.push(goboRot !== null ? 'turning gobos' : 'gobos');
    if (pv !== null) does.push('prism');
    if (zoom) does.push('zoom');
    if (rf.anim) does.push('animation wheel');
    const n = gw ? gw.slots.length : 0;
    return {
      len: L, does,
      at(t) {
        const u = ((t % L) + L) % L, ph = (u / L) * Math.PI * 2;
        const v: Resolved = { intensity: 1, pan: 0.5 + 0.16 * Math.sin(ph), tilt: 0.5 + 0.1 * Math.sin(ph * 2) };
        const c = colourAt(u, look === 'wash' ? 1 : 0.5); if (c) v.color = c;
        if (look === 'wash' && zoom) v.zoom = 0.5 + 0.5 * Math.sin(ph * 2 - Math.PI / 2);
        else if (zoom) v.zoom = 0.45;                // (a wider beam: its gobos big enough to see)
        if (slots.length && n > 1) {
          // a new gobo every two seconds, turning
          const s = slots[Math.floor(u / 2) % slots.length];
          v[gw!.attr] = s / (n - 1);
          if (goboRot !== null) v[gw!.rotAttr] = goboRot;
        }
        if (pv !== null && u >= L / 2) { v.prism = pv; if (prot !== null) v.prismRotation = prot; }
        if (rf.anim && u >= L * 0.75) { v.animation = 0.6; }
        return v;
      },
    };
  }
  // ---- a moving bar: its heads wave, a colour chase along them
  if (look === 'headbar') {
    const k = Math.max(1, rf.heads ?? cells);
    does.push('heads tilt each on their own');
    return {
      len: L, does,
      at(t) {
        const u = ((t % L) + L) % L;
        const list: Resolved[] = Array.from({ length: k }, (_, i) => ({ intensity: 1, tilt: 0.5 + 0.22 * Math.sin((u / L) * Math.PI * 4 + i * 0.9), color: coloured ? hue(u / L + i / k) : undefined }));
        return { intensity: 1, cells: list };
      },
    };
  }
  // ---- pixels: a bar, a strip, a ring, a matrix
  if (cells > 1) {
    does.push(`${cells} pixels`);
    return {
      len: L, does,
      at(t) {
        const u = ((t % L) + L) % L;
        const list: Resolved[] = Array.from({ length: cells }, (_, i) => {
          const x = i / cells, wave = 0.5 + 0.5 * Math.sin((x * 2 - u / L * 4) * Math.PI * 2);
          return { intensity: 0.25 + 0.75 * wave, color: coloured || look === 'disc' || look === 'panel' ? hue(x + u / L) : undefined };
        });
        return { intensity: 1, cells: list };
      },
    };
  }
  // ---- a winch: up and down
  if (look === 'winch') {
    does.push('moves up and down');
    return { len: L, does, at: (t) => ({ intensity: 1, hoist: 0.5 + 0.45 * Math.sin((t / L) * Math.PI * 2) }) };
  }
  // ---- a strobe: bursts of flashes
  if (look === 'strobe' || (has('strobe') && !coloured && look !== 'par')) {
    does.push('strobe');
    return { len: L, does, at: (t) => { const u = ((t % L) + L) % L; return { intensity: 1, strobe: u % 4 < 2 ? 0.7 : 0, ...(coloured ? { color: colourAt(u) } : {}) }; } };
  }
  // ---- a blinder: warm hits
  if (look === 'blinder') {
    does.push('hits');
    return { len: L, does, at: (t) => { const u = ((t % L) + L) % L, b = u % 2; return { intensity: b < 0.15 ? 1 : Math.max(0, 1 - (b - 0.15) * 1.4), color: { r: 1, g: 0.72, b: 0.38 } }; } };
  }
  // ---- machines (fog, confetti, flames...): they stand there, ready
  if (look === 'fog' || look === 'confetti' || look === 'bubbles' || look === 'flame' || look === 'sparks' || look === 'co2') {
    return { len: L, does, at: () => ({ intensity: 1 }) };
  }
  // ---- a PAR, a fresnel, a dimmer: the colours, or breathing
  if (has('strobe')) does.push('strobe');
  return {
    len: L, does,
    at(t) {
      const u = ((t % L) + L) % L;
      // (the colours, and a burst of strobe at the end when it has one)
      if (coloured) return { intensity: 1, ...(has('strobe') && u >= L - 1.2 ? { strobe: 0.6 } : {}), color: colourAt(u) };
      return { intensity: 0.15 + 0.85 * (0.5 + 0.5 * Math.sin((u / L) * Math.PI * 4)) };
    },
  };
}
