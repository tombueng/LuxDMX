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
// at(t, i, n): light i of n in a row (the gallery's fans): its own colour round the wheel, its
// moves a little later and fanned out
export interface MicroShow { len: number; at(t: number, i?: number, n?: number): Resolved; does: string[] }
// what a gallery tile shows off: everything, or one thing on its own
export type Focus = 'all' | 'gobo' | 'prism' | 'colour' | 'zoom' | 'move';

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

const SFX_ATTRS = ['confetti', 'bubbles', 'flame', 'sparks', 'co2'] as const;

export function microShow(rf: Pick<RigFixture, 'look' | 'cells' | 'gobos' | 'prism' | 'anim' | 'heads' | 'winch' | 'kind'>, m: FixtureMode | undefined, focus: Focus = 'all'): MicroShow {
  const attrs = new Set(m?.channels.map((c) => c.attr) ?? []);
  const has = (a: string) => attrs.has(a as never);
  const mixes = (has('red') && has('green') && has('blue')) || (has('cyan') && has('magenta') && has('yellow'));
  const wheel = !mixes && has('colorWheel');
  const coloured = mixes || wheel;
  const L = SHOW_LEN, look = rf.look, cells = Math.max(1, rf.cells);
  const does: string[] = [];
  // (light i of n: its own place round the wheel)
  const colourAt = (t: number, speed = 1, i = 0, n = 1): Color | undefined => (mixes ? hue(t / L * speed + i / n) : wheel ? WHEEL[(Math.floor((t / L) * 4 * speed) + i) % WHEEL.length] : undefined);
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
    const gobos = focus === 'all' || focus === 'gobo' || focus === 'prism', prismIn = (u: number) => pv !== null && (focus === 'prism' || (focus === 'all' && u >= L / 2));
    return {
      len: L, does,
      at(t, i = 0, k = 1) {
        const u = ((t % L) + L) % L, ph = (u / L) * Math.PI * 2 - i * 0.5, fan = k > 1 ? (i - (k - 1) / 2) / Math.max(1, k - 1) : 0;
        // the moves: a figure of eight (wide when that's what it shows, small under a prism)
        const big = focus === 'move' ? 2 : focus === 'prism' || focus === 'colour' ? 0.35 : 1;
        const v: Resolved = { intensity: 1, pan: 0.5 + fan * 0.12 + 0.16 * big * Math.sin(ph), tilt: 0.5 + 0.1 * big * Math.sin(ph * 2) };
        const c = colourAt(u, look === 'wash' || focus === 'colour' ? 1 : 0.5, i, k); if (c) v.color = c;
        if (zoom && (look === 'wash' || focus === 'zoom')) v.zoom = 0.5 + 0.5 * Math.sin(ph * 2 - Math.PI / 2);
        else if (zoom) v.zoom = focus === 'colour' ? 0.8 : 0.45;   // (a wider beam: its gobos big enough to see)
        if (gobos && slots.length && n > 1) {
          // a new gobo every two seconds, turning (under a prism: one gobo all along)
          const s = focus === 'prism' ? slots[Math.min(1, slots.length - 1)] : slots[(Math.floor(u / 2) + i) % slots.length];
          v[gw!.attr] = s / (n - 1);
          if (goboRot !== null) v[gw!.rotAttr] = goboRot;
        }
        if (prismIn(u)) { v.prism = pv!; if (prot !== null) v.prismRotation = prot; }
        if (rf.anim && focus === 'all' && u >= L * 0.75) { v.animation = 0.6; }
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
      at(t, j = 0) {
        const u = ((t % L) + L) % L;
        const list: Resolved[] = Array.from({ length: k }, (_, i) => ({ intensity: 1, tilt: 0.5 + 0.22 * Math.sin((u / L) * Math.PI * 4 + i * 0.9 + j * 0.6), color: coloured ? hue(u / L + i / k) : undefined }));
        return { intensity: 1, cells: list };
      },
    };
  }
  // ---- pixels: a bar, a strip, a ring, a matrix
  if (cells > 1) {
    does.push(`${cells} pixels`);
    return {
      len: L, does,
      at(t, j = 0, k = 1) {
        const u = ((t % L) + L) % L;
        const list: Resolved[] = Array.from({ length: cells }, (_, i) => {
          const x = i / cells + j / Math.max(1, k), wave = 0.5 + 0.5 * Math.sin((x * 2 - u / L * 4) * Math.PI * 2);
          return { intensity: 0.25 + 0.75 * wave, color: coloured || look === 'disc' || look === 'panel' ? hue(x + u / L) : undefined };
        });
        return { intensity: 1, cells: list };
      },
    };
  }
  // ---- a curtain: opening and closing; a drop: flying in and out
  if (look === 'curtain' || look === 'flybar') {
    does.push(look === 'curtain' ? 'opens and closes' : 'flies in and out');
    return { len: L, does, at: (t) => ({ hoist: 0.5 - 0.5 * Math.cos((t / L) * Math.PI * 2) }) };
  }
  // ---- a winch: up and down
  if (look === 'winch') {
    does.push('moves up and down');
    return { len: L, does, at: (t, i = 0, k = 1) => ({ intensity: 1, hoist: 0.5 + 0.45 * Math.sin((t / L) * Math.PI * 2 - (i / Math.max(1, k)) * Math.PI), ...(coloured ? { color: hue(t / L + i / Math.max(1, k)) } : {}) }) };
  }
  // ---- a strobe: bursts of flashes
  if (look === 'strobe' || (has('strobe') && !coloured && look !== 'par')) {
    does.push('strobe');
    return { len: L, does, at: (t, i = 0) => { const u = ((t % L) + L) % L; return { intensity: 1, strobe: (u + i) % 4 < 2 ? 0.7 : 0, ...(coloured ? { color: colourAt(u) } : {}) }; } };
  }
  // ---- a blinder: warm hits
  if (look === 'blinder') {
    does.push('hits');
    return { len: L, does, at: (t, i = 0) => { const u = ((t % L) + L) % L, b = (u + i * 0.25) % 2; return { intensity: b < 0.15 ? 1 : Math.max(0, 1 - (b - 0.15) * 1.4), color: { r: 1, g: 0.72, b: 0.38 } }; } };
  }
  // ---- machines: a burst every few seconds (one after the other along a row); fog on and off
  const sfx = SFX_ATTRS.find((a) => has(a));
  if (sfx || look === 'fog') {
    if (sfx) does.push(sfx === 'co2' ? 'CO2 jets' : sfx); else does.push(has('haze') ? 'haze' : 'fog');
    return {
      len: L, does,
      at(t, i = 0, k = 1) {
        const u = (((t - (i / Math.max(1, k)) * 0.6) % L) + L) % L;
        if (!sfx) return { intensity: 1, fog: u < L * 0.55 ? 1 : 0, haze: u < L * 0.55 ? 1 : 0, ...(has('fan') ? { fan: 0.8 } : {}) };
        const on = sfx === 'confetti' ? u % 4 < 0.3 : sfx === 'flame' ? u % 2.7 < 0.6 : sfx === 'bubbles' ? u < L * 0.7 : u % 4 < 1.5;
        return { intensity: 1, [sfx]: on ? 1 : 0, ...(has('fan') ? { fan: 0.8 } : {}) };
      },
    };
  }
  // ---- a PAR, a fresnel, a dimmer: the colours, or breathing
  if (has('strobe')) does.push('strobe');
  return {
    len: L, does,
    at(t, i = 0, k = 1) {
      const u = ((t % L) + L) % L;
      // (the colours, each light of a row its own place round them, and a burst of strobe at the end
      // when it has one)
      if (coloured) return { intensity: 1, ...(has('strobe') && u >= L - 1.2 ? { strobe: 0.6 } : {}), color: colourAt(u, 1, i, k) };
      return { intensity: 0.15 + 0.85 * (0.5 + 0.5 * Math.sin((u / L) * Math.PI * 4)) };
    },
  };
}
