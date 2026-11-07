// Pixel shows, after the classics of LED-strip firmware (WLED's book): theater chase, fire, twinkles,
// juggling dots, bouncing balls, ripples, fireworks, matrix rain, aurora, plasma... Each one a pure
// function of where the pixel is and when (fxkit.ts), so the preview, the stage and the output agree.
//
// The originals keep state from frame to frame (a heat map, ball speeds, spark lists). Here nothing
// is remembered: what happens now and then (a drop, a rocket, a ball thrown up again) sits at a
// stable random moment in its own time slot, so any moment can be worked out from scratch, and the
// trails behind a moving dot come from when it last passed.
//
// Conventions: pixel 0 is the bottom (fire rises from it, rain falls towards it). Shows that run
// up each light use `lane()`: on a wall of strips every strip is its own lane, a row of PARs is one
// lane along the group. Size is each show's one extra knob, named in its blurb.
import type { Color } from '../model/types';
import {
  PALETTES, TAU, WHITE, along, c, clamp01, frac, hash, lerpColor, noise, ramp, shine, tri,
  type EffectDef, type EffectParams, type Elem,
} from './fxkit';

// ---------------------------------------------------------------- shared parts

// Seconds at the show's default pace: `total` counts the effect's rounds, so Speed and the tempo
// still set how fast, and at the default speed it moves like the original.
const secs = (e: Elem, d: number) => e.total * d;

// A palette colour by a stable random number (0..1).
const pick = (cs: Color[], h: number): Color => cs[Math.floor(h * cs.length) % cs.length] ?? WHITE;
const lit = (col: Color, v: number, p: EffectParams) => shine(col.r * v, col.g * v, col.b * v, p, col);

// Light adding up on one pixel: balls, sparks, drops or waves crossing the same spot.
class Glow {
  r = 0; g = 0; b = 0;
  add(c: Color, v: number) { if (v > 0) { this.r += c.r * v; this.g += c.g * v; this.b += c.b * v; } }
  // the brighter of the two per emitter (FastLED's |=): dots crossing don't burn out to white
  max(c: Color, v: number) {
    if (v <= 0) return;
    this.r = Math.max(this.r, c.r * v); this.g = Math.max(this.g, c.g * v); this.b = Math.max(this.b, c.b * v);
  }
  out(p: EffectParams, dark: Color) { return shine(this.r, this.g, this.b, p, dark); }
}

// How far apart two neighbouring pixels are along the group (0..1).
const pitchOf = (e: Elem) => 1 / Math.max(1, e.m - 1);
// A dot at `at`, drawn smoothly over the pixels nearest to it (`w` pixels wide each way), so it
// glides instead of jumping and never falls between two PARs.
function dot(y: number, at: number, pitch: number, w = 1): number {
  const d = Math.abs(y - at) / (pitch * w);
  return d < 1 ? 1 - d : 0;
}

interface Lane { y: number; id: number; pitch: number }
// Where a pixel sits for the shows that run up each light (fire rises, drops fall, balls bounce):
// along its own pixels when the lights have several, each light a lane of its own; a row of
// single-cell lights (PARs) is one lane along the group. Direction turns the lanes round
// (backward) or mirrors them (in: from both ends, out: from the middle).
function lane(e: Elem, p: EffectParams): Lane {
  if (e.rows > 1 && e.m > e.rows) {
    const u = e.u, d = p.direction;
    const y = d === 'backward' ? 1 - u : d === 'out' ? Math.abs(2 * u - 1) : d === 'in' ? 1 - Math.abs(2 * u - 1) : u;
    return { y, id: e.row + 1, pitch: 1 / Math.max(1, e.m / e.rows - 1) };
  }
  return { y: e.x, id: 0, pitch: pitchOf(e) };
}
// How many things to have in flight on a lane: `full` on a strip of 24 pixels or more, fewer on a
// short lane (8 PARs make a lane of 8: two balls there read better than five).
const howMany = (full: number, pitch: number) => Math.max(1, Math.round(full * Math.min(1, (1 / pitch + 1) / 24)));

// Things in flight (balls, sparks, drops, waves) are worked out once per frame and lane and shared
// by the lane's pixels, not again for every pixel. A small cache, emptied when the time, the
// layout or the knobs change (the engine makes `p` afresh for every effect and frame). It only
// saves work: the answer is the same without it.
const memo = { p: undefined as EffectParams | undefined, t: NaN, m: 0, rows: 0, size: NaN, colors: undefined as Color[] | undefined, map: new Map<number, unknown>() };
function perLane<T>(e: Elem, p: EffectParams, t: number, key: number, make: () => T): T {
  const c0 = memo;
  if (c0.p !== p || c0.t !== t || c0.m !== e.m || c0.rows !== e.rows || c0.size !== p.size || c0.colors !== p.colors) {
    c0.map.clear(); c0.p = p; c0.t = t; c0.m = e.m; c0.rows = e.rows; c0.size = p.size; c0.colors = p.colors;
  }
  let v = c0.map.get(key) as T | undefined;
  if (v === undefined) { v = make(); c0.map.set(key, v); }
  return v;
}
// A lit dot on a lane this frame: colour c at `at`, `w` pixels wide each way, brightness v.
interface Spot { at: number; w: number; c: Color; v: number }
function addSpots(g: Glow, spots: Spot[], y: number, pitch: number) {
  for (const s of spots) { const v = dot(y, s.at, pitch, s.w); if (v > 0) g.add(s.c, v * s.v); }
}

// Trails: how long ago (in turns of its swing) a dot last passed y, for a dot swinging as
// 0.5 + 0.5 sin(2 pi phi) (FastLED's beatsin) or there and back at an even speed (a scanner).
function sinceSine(phi: number, y: number): number {
  const a = Math.asin(Math.max(-1, Math.min(1, 2 * y - 1))) / TAU;
  return Math.min(frac(phi - a), frac(phi - 0.5 + a));
}
const sinceTri = (phi: number, y: number) => Math.min(frac(phi - y / 2), frac(phi - 1 + y / 2));

// FastLED's beatsin88: a slow swing between lo and hi at bpm88 / 256 beats a minute, and its
// running sum since the start (what the original adds up frame by frame).
const swing = (bpm88: number, lo: number, hi: number, t: number) => lo + (hi - lo) * (0.5 + 0.5 * Math.sin(TAU * bpm88 / 15360 * t));
function swingSum(bpm88: number, lo: number, hi: number, t: number): number {
  const w = TAU * bpm88 / 15360;
  return lo * t + (hi - lo) * (t / 2 + (1 - Math.cos(w * t)) / (2 * w));
}

// A bouncing ball's height (0..1) at t seconds: thrown up from the floor, every bounce keeping `d`
// of its speed; once the bounces are small (a fifth of the speed it was thrown with, as WLED's
// threshold) it is thrown up again. The throws sit on a jittered grid (throw j at
// (0.7 j + 0.3 (r - 0.5)) lmax, the first at 0), and a throw given L seconds gets the speed whose
// first K bounces take exactly L: bounce k starts at T (1 - d^k), T = L / (1 - d^K).
function ballHeight(t: number, d: number, G: number, s: number): number {
  const K = Math.ceil(Math.log(0.2) / Math.log(d)), cut = 1 - d ** K;
  const lmax = 2 * Math.sqrt(2 * G) / (G * (1 - d)) * cut;    // the throw that reaches the top
  const at = (j: number) => (j <= 0 ? 0.7 * j : 0.7 * j + 0.3 * (hash(s, j) - 0.5)) * lmax;
  let j = Math.floor(t / (0.7 * lmax));
  while (j > 0 && at(j) > t) j--;
  while (at(j + 1) <= t) j++;
  const t0 = at(j), T = (at(j + 1) - t0) / cut, tau = t - t0;
  const k = Math.min(K - 1, Math.floor(Math.log(1 - tau / T) / Math.log(d)));
  if (!(k >= 0)) return 0;
  const dk = d ** k, vk = (T * G * (1 - d) / 2) * dk, s0 = tau - T * (1 - dk);
  return Math.max(0, vk * s0 - G * s0 * s0 / 2);
}

const smooth = (v: number) => v * v * (3 - 2 * v);
// Smooth random wobble over a plane (value noise), 0..1: fire that boils instead of sliding.
function noise2(s: number, x: number, y: number): number {
  const i = Math.floor(x), j = Math.floor(y), fx = smooth(x - i), fy = smooth(y - j);
  const a = hash(s, i, j), b = hash(s, i + 1, j), c0 = hash(s, i, j + 1), d = hash(s, i + 1, j + 1);
  return a + (b - a) * fx + (c0 - a) * fy + (a - b - c0 + d) * fx * fy;
}
const ROCKET = c('#fff0c8'), EMBER = c('#ff8020'), NIGHT = c('#001040'), FW_G = 1.5;

// ---------------------------------------------------------------- what's in flight, per lane and frame

function balls(t: number, id: number, n: number, colors: Color[]): Spot[] {
  // one light: all balls thrown up together at the start; the lanes of a wall out of step
  const tt = t + (id ? 30 * hash(102, id) : 0), out: Spot[] = [];
  for (let i = 0; i < n; i++) {
    const d = 0.9 - i / (n * n);                        // WLED's damping: the later balls settle sooner
    out.push({ at: ballHeight(tt, d, 2.2, 101 + id * 31 + i), w: 1.5, c: colors[i % Math.max(1, colors.length)] ?? WHITE, v: 1 });
  }
  return out;
}

interface Drop { at: number; r: number; amp: number; a: number; c: Color }
function drops(t: number, id: number, size: number, colors: Color[]): Drop[] {
  const s = 200 + id * 13, every = 0.6 / (0.3 + 1.4 * clamp01(size)), life = 1.8, out: Drop[] = [];
  for (let j = Math.floor((t - life) / every) - 1; j <= Math.floor(t / every); j++) {
    const a = t - (j + 0.9 * hash(s, j, 1)) * every;
    if (a < 0 || a > life) continue;
    out.push({ at: hash(s, j, 2), r: 0.2 * a, amp: Math.min(1, a / 0.08) * (1 - a / life) ** 1.3, a, c: pick(colors, hash(s, j, 3)) });
  }
  return out;
}

interface Rocket { h: number; v0: number; a: number }
function fireworks(t: number, id: number, size: number, colors: Color[]): { spots: Spot[]; rockets: Rocket[] } {
  const s = 300 + id * 7, every = 3.4 - 2.2 * clamp01(size), G = FW_G, spots: Spot[] = [], rockets: Rocket[] = [];
  for (let j = Math.floor((t - 4) / every) - 1; j <= Math.floor(t / every); j++) {
    const a = t - (j + 0.5 * hash(s, j, 1)) * every;
    if (a < 0 || a > 4) continue;
    const H = 0.5 + 0.38 * hash(s, j, 2), v0 = Math.sqrt(2 * G * H), ta = v0 / G;
    if (a < ta) {
      // the rocket, slowing as it climbs (its embers are drawn per pixel)
      const h = v0 * a - G * a * a / 2;
      spots.push({ at: h, w: 1.2, c: ROCKET, v: 1 });
      rockets.push({ h, v0, a });
      continue;
    }
    // the burst: sparks thrown both ways (more up than down, as in WLED), slowed by the air,
    // white-hot first, then their colour, flickering out as they fall
    const b = a - ta, col = pick(colors, hash(s, j, 3));
    const col2 = hash(s, j, 4) < 0.35 ? pick(colors, hash(s, j, 5)) : col;
    if (b < 0.08) spots.push({ at: H, w: 4, c: WHITE, v: 1 - b / 0.08 });
    for (let k = 0; k < 20; k++) {
      const sk = j * 64 + k, life = 1.1 + 0.9 * hash(s, sk, 6);
      if (b > life) continue;
      const vk = (hash(s, sk, 7) * 2 - 0.9) * 0.75 * (0.6 + H), drag = 0.35, gs = 0.5;
      const at = H + drag * (vk + gs * drag) * (1 - Math.exp(-b / drag)) - gs * drag * b;
      const h = b / life, ck = k % 2 ? col2 : col;
      const flicker = h > 0.6 ? 0.4 + 0.6 * hash(s, sk, Math.floor(t * 24)) : 1;
      spots.push({ at, w: 1, c: h < 0.15 ? lerpColor(WHITE, ck, h / 0.15) : ck, v: (1 - h) ** 1.5 * flicker });
    }
  }
  return { spots, rockets };
}

interface Code { hy: number; len: number }
function code(t: number, id: number, size: number, step: number): Code[] {
  const s = 400 + id * 13, every = 1.6 - 1.2 * clamp01(size), out: Code[] = [];
  for (let j = Math.floor((t - 5) / every) - 1; j <= Math.floor(t / every); j++) {
    const a = t - (j + 0.85 * hash(s, j, 1)) * every;
    if (a < 0) continue;
    const speed = 0.35 + 0.45 * hash(s, j, 2), len = 0.25 + 0.35 * hash(s, j, 3);
    const hy = 1 - Math.floor(a * speed / step) * step;     // the head, a whole pixel at a time
    if (hy + len > -step) out.push({ hy, len });
  }
  return out;
}

interface Wave { at: number; w: number; v: number; c: Color }
function curtains(t: number, size: number, colors: Color[]): Wave[] {
  const s = 500, every = 1.6 - 1.1 * clamp01(size), out: Wave[] = [];
  for (let j = Math.floor((t - 10) / every) - 1; j <= Math.floor(t / every); j++) {
    const a = t - (j + hash(s, j, 1)) * every, life = 4 + 6 * hash(s, j, 2);
    if (a < 0 || a > life) continue;
    out.push({
      w: 0.1 + 0.25 * hash(s, j, 3), at: -0.1 + 1.2 * hash(s, j, 4) + (hash(s, j, 5) - 0.5) * 0.25 * a,
      // the first colours of the palette most often (the greens of the Aurora palette)
      v: 0.75 * Math.sin(Math.PI * a / life) ** 2, c: pick(colors, hash(s, j, 6) ** 2),
    });
  }
  return out;
}

interface Flash { from: number; len: number; v: number }
function storm(t: number, size: number, pitch: number): Flash[] {
  const s = 600, every = 1.2 + 4 * (1 - clamp01(size)), out: Flash[] = [];
  for (let j = Math.floor(t / every) - 1; j <= Math.floor(t / every); j++) {
    if (hash(s, j, 1) > 0.85) continue;                   // some storms rest a while
    let at = (j + 0.5 * hash(s, j, 2)) * every;
    const n = 3 + Math.floor(hash(s, j, 3) * 4);
    for (let i = 0; i <= n && at <= t; i++) {
      // a faint leader first, then strikes of full or half brightness; none shorter than about one
      // and a half DMX frames, and each dies away quickly rather than snapping off
      const f = j * 16 + i, lead = i === 0;
      const dur = lead ? 0.04 : 0.035 + 0.05 * hash(s, f, 4), bri = lead ? 0.2 : hash(s, f, 5) < 0.5 ? 1 : 0.5;
      if (t < at + dur + 0.1) {
        const from = hash(s, f, 6) * 0.85;
        out.push({ from, len: Math.max(1.01 * pitch, 0.1 + hash(s, f, 7) * (0.9 - from)), v: bri * (t < at + dur ? 1 : Math.exp(-(t - at - dur) / 0.025)) });
      }
      at += dur + (lead ? 0.2 : 0.05 + 0.1 * hash(s, f, 8));
    }
  }
  return out;
}

interface Streak { h: number; len: number; c: Color }
function rain(t: number, id: number, size: number, pitch: number, colors: Color[]): { spots: Spot[]; streaks: Streak[] } {
  const s = 700 + id * 11, G = 2.2, fall = Math.sqrt(2 / G), every = 2.2 - 1.6 * clamp01(size);
  const spots: Spot[] = [], streaks: Streak[] = [];
  for (let j = Math.floor((t - 3.5) / every) - 1; j <= Math.floor(t / every); j++) {
    const a = t - (j + 0.8 * hash(s, j, 1)) * every;
    if (a < 0) continue;
    const col = pick(colors, hash(s, j, 2)), swell = 0.5 + 0.7 * hash(s, j, 3);
    if (a < swell) { spots.push({ at: 1, w: 1.5, c: col, v: 0.7 * (a / swell) ** 2 }); continue; }   // forming at the top
    const f = a - swell;
    if (f < fall) {
      // falling: gravity, and a short streak above it that grows with its speed
      const h = 1 - G * f * f / 2;
      spots.push({ at: h, w: 1.2, c: col, v: 1 });
      streaks.push({ h, len: pitch + 0.05 * G * f, c: col });
      continue;
    }
    const b = f - fall;                                    // the splash, and two droplets jumping off
    if (b > 0.6) continue;
    if (b < 0.15) spots.push({ at: 0, w: 1.5, c: col, v: 1 - b / 0.15 });
    for (let k = 0; k < 2; k++) {
      const vk = 0.25 + 0.2 * hash(s, j * 4 + k, 4), hk = vk * b - G * b * b / 2;
      if (hk > 0) spots.push({ at: hk, w: 1, c: col, v: 0.5 });
    }
  }
  return { spots, streaks };
}

function kernels(t: number, id: number, n: number, colors: Color[]): Spot[] {
  const G = 2.4, slot = 2.2, out: Spot[] = [];
  for (let i = 0; i < n; i++) {
    // each kernel pops once in each of its slots, at a random moment, to a random height
    const s = 800 + id * 37 + i, off = hash(s, 0, 9) * slot, j = Math.floor((t + off) / slot);
    const H = 0.5 + 0.5 * hash(s, j, 1), v0 = Math.sqrt(2 * G * H), T = 2 * v0 / G;
    const a = t - (j * slot - off + hash(s, j, 2) * (slot - T));
    if (a >= 0 && a <= T) out.push({ at: v0 * a - G * a * a / 2, w: 1.2, c: pick(colors, hash(s, j, 3)), v: 1 });
  }
  return out;
}

// ---------------------------------------------------------------- the shows

export const PIXEL_EFFECTS: EffectDef[] = [
  { id: 'theater', name: 'Theater chase', category: 'pixel',
    blurb: 'Every third pixel lit, marching along like the bulbs round an old theatre sign. Size sets the gap.',
    defaults: { speed: 0.25, tempo: true, size: 0.25, spread: 1, colors: PALETTES.Rainbow },
    run: (e, p) => {
      const gap = 2 + Math.round(clamp01(p.size) * 4), s = Math.floor(e.total);
      const on = ((e.k - s) % gap + gap) % gap === 0;
      return lit(along(p.colors, e.x * p.spread + e.total * 0.008), on ? 1 : 0, p);
    } },

  { id: 'fire2012', name: 'Flames', category: 'pixel',
    blurb: 'Fire rising from the start of each light: white-hot at the bottom, red tongues licking up. Size sets how high.',
    defaults: { speed: 1, tempo: false, size: 0.6, colors: PALETTES.Heat },
    run: (e, p) => {
      const t = secs(e, 1);
      // single-cell lights (PARs) are each a flame of their own, seen a little above the base
      const L = e.m > e.rows ? lane(e, p) : { y: 0.3, id: e.row + 1 };
      const y = L.y, s = L.id * 17 + 5;
      const top = 0.15 + 0.9 * clamp01(p.size) * (0.7 + 0.3 * noise(s, t * 2.3));
      // two layers of turbulence rising (and changing as they rise), cooling with height
      const turb = 0.6 * noise2(s + 1, y * 6 - t * 7, t * 1.5) + 0.4 * noise2(s + 2, y * 14 - t * 15, t * 3);
      let heat = (0.06 + 0.86 * turb) * Math.max(0, 1 - y / top);
      if (y < 0.12) heat += (1 - y / 0.12) * 0.55 * noise(s + 3, t * 23);      // sparks at the base
      heat = clamp01(heat);
      // FastLED's heat colours: dark red, red, orange, yellow, white; brightness tops out a third up
      return lit(ramp(p.colors, heat * 1.25 - 0.25), Math.min(1, heat * 3), p);
    } },

  { id: 'twinkle', name: 'Twinkles', category: 'pixel',
    blurb: 'Pixels fading softly in and out in the palette colours, each at its own pace, like fairy lights. Size sets how many.',
    defaults: { speed: 4, tempo: false, size: 0.6, colors: PALETTES.Party },
    run: (e, p) => {
      // TwinkleFOX: every pixel has its own clock (1 to 2.9 twinkles a round) and start
      const s = e.seed, lc = e.total * (1 + 1.875 * hash(s, 11)) + 8 * hash(s, 12);
      const n = Math.floor(lc), f = lc - n;
      const v = hash(s, n, 13) >= p.size ? 0 : f < 1 / 3 ? smooth(f * 3) : (1 - (f - 1 / 3) * 1.5) ** 2;
      return lit(pick(p.colors, hash(s, n, 14)), v, p);
    } },

  { id: 'juggle', name: 'Juggle', category: 'pixel',
    blurb: 'Eight coloured dots swinging to and fro at different speeds, weaving in and out with glowing trails. Size sets the trails.',
    defaults: { speed: 8, tempo: false, size: 0.5, colors: PALETTES.Rainbow },
    run: (e, p) => {
      const y = e.x, pitch = pitchOf(e), tail = 0.003 + 0.025 * clamp01(p.size), g = new Glow();
      const cols = perLane(e, p, e.total, 8e5, () => Array.from({ length: 8 }, (_, i) => along(p.colors, i / 8)));
      for (let i = 0; i < 8; i++) {
        const rate = (i + 7) / 7, phi = e.total * rate;          // 7 to 14 swings while the first does 7
        const v = Math.max(Math.exp(-sinceSine(phi, y) / rate / tail), dot(y, 0.5 + 0.5 * Math.sin(TAU * phi), pitch));
        if (v > 0.004) g.max(cols[i], v);
      }
      return g.out(p, along(p.colors, y));
    } },

  { id: 'sinelon', name: 'Sinelon', category: 'pixel',
    blurb: 'One dot sweeping to and fro with a fading trail, slowly changing colour on the way. Size sets the trail.',
    defaults: { speed: 4, tempo: false, size: 0.5, colors: PALETTES.Rainbow },
    run: (e, p) => {
      const y = e.x, tail = 0.01 + 0.1 * clamp01(p.size), age = sinceSine(e.total, y);
      const v = Math.max(Math.exp(-age / tail), dot(y, 0.5 + 0.5 * Math.sin(TAU * e.total), pitchOf(e)));
      // the trail keeps the colour the dot had when it passed
      return lit(along(p.colors, (e.total - age) * 0.8), v, p);
    } },

  { id: 'pride', name: 'Colour waves', category: 'pixel',
    blurb: 'Pride 2015: rainbows that never repeat, waves of light rolling through them, always changing.',
    defaults: { speed: 10, tempo: false, colors: PALETTES.Rainbow },
    run: (e, p) => {
      const t = secs(e, 10);
      const sat = swing(87, 220, 250, t) / 255, depth = swing(341, 96, 224, t) / 255;
      const thetaInc = swing(203, 6400, 10240, t) / 65536, hueInc = swing(113, 1, 3000, t) / 65536;
      const pseudo = swingSum(147, 23, 60, t) * 1000 / 65536, hue0 = swingSum(400, 5, 9, t) * 1000 / 65536;
      const i = e.k + 1;
      const b = 0.5 + 0.5 * Math.sin(TAU * (pseudo - i * thetaInc));
      const col = along(p.colors, hue0 - i * hueInc);
      const w = 1 - sat;      // a touch of white, as the original's saturation swings
      return lit({ r: col.r * sat + w, g: col.g * sat + w, b: col.b * sat + w }, depth * b * b + 1 - depth, p);
    } },

  { id: 'bouncing', name: 'Bouncing balls', category: 'pixel',
    blurb: 'Balls dropping and bouncing up each light, lower every time, until they are thrown up again. Size sets how many.',
    defaults: { speed: 1, tempo: false, size: 0.5, colors: PALETTES.Candy },
    run: (e, p) => {
      const { y, id, pitch } = lane(e, p), t = secs(e, 1), g = new Glow();
      addSpots(g, perLane(e, p, t, 1e5 + id, () => balls(t, id, howMany(1 + Math.round(clamp01(p.size) * 7), pitch), p.colors)), y, pitch);
      return g.out(p, along(p.colors, y));
    } },

  { id: 'ripple', name: 'Ripples', category: 'pixel',
    blurb: 'Drops landing at random spots, rings of colour spreading out and fading, like rain on a pond. Size sets how many.',
    defaults: { speed: 1, tempo: false, size: 0.5, colors: PALETTES.Ocean },
    run: (e, p) => {
      const { y, id, pitch } = lane(e, p), t = secs(e, 1), w = Math.max(0.022, 0.8 * pitch), g = new Glow();
      for (const d of perLane(e, p, t, 2e5 + id, () => drops(t, id, p.size, p.colors))) {
        const x = Math.abs(y - d.at), q1 = (x - d.r) / w, q2 = (x - d.r + 3 * w) / w;
        let v = Math.exp(-q1 * q1) + (d.r > 3 * w ? 0.35 * Math.exp(-q2 * q2) : 0);   // the ring and an echo inside
        if (d.a < 0.15) v = Math.max(v, (1 - d.a / 0.15) * dot(y, d.at, pitch, 2));      // the splash
        g.add(d.c, d.amp * v);
      }
      return g.out(p, along(p.colors, y));
    } },

  { id: 'fireworks', name: 'Fireworks', category: 'pixel',
    blurb: 'A rocket climbs up the light, slows down and bursts into sparks that fly apart, fade and fall. Size sets how often.',
    defaults: { speed: 1, tempo: false, size: 0.5, colors: PALETTES.Rainbow },
    run: (e, p) => {
      const { y, id, pitch } = lane(e, p), t = secs(e, 1), g = new Glow();
      const fw = perLane(e, p, t, 3e5 + id, () => fireworks(t, id, p.size, p.colors));
      addSpots(g, fw.spots, y, pitch);
      // embers dropping off behind a climbing rocket, flickering
      for (const r of fw.rockets) {
        if (y >= r.h || y <= r.h - 0.15) continue;
        const passed = (r.v0 - Math.sqrt(Math.max(0, r.v0 * r.v0 - 2 * FW_G * y))) / FW_G;
        g.add(EMBER, 0.55 * Math.exp(-(r.a - passed) / 0.07) * (0.5 + 0.5 * hash(e.seed, Math.floor(t * 30))));
      }
      return g.out(p, along(p.colors, y));
    } },

  { id: 'matrix', name: 'Matrix rain', category: 'pixel',
    blurb: 'Green code raining down each light: bright heads with flickering trails, every lane at its own pace. Size sets how many.',
    defaults: { speed: 1, tempo: false, size: 0.5, colors: PALETTES.Matrix },
    run: (e, p) => {
      const { y, id, pitch } = lane(e, p), t = secs(e, 1), step = Math.max(pitch, 0.008);
      let v = 0, head = false;
      for (const d of perLane(e, p, t, 4e5 + id, () => code(t, id, p.size, step))) {
        const x = y - d.hy;
        if (x < -step / 2 || x > d.len) continue;
        if (x < step / 2) head = true;
        v = Math.max(v, (1 - x / d.len) ** 1.6);
      }
      if (head) return lit(p.colors[p.colors.length - 1] ?? WHITE, 1, p);
      v *= 0.65 + 0.35 * hash(e.seed, Math.floor(t * 9), 5);    // the code changing in the trail
      return lit(ramp(p.colors, v * 0.9), v, p);
    } },

  { id: 'aurora', name: 'Aurora', category: 'pixel',
    blurb: 'Soft curtains of green, teal and violet drifting and swelling like the northern lights. Size sets how many.',
    defaults: { speed: 1, tempo: false, size: 0.5, colors: PALETTES.Aurora },
    run: (e, p) => {
      const y = e.x, t = secs(e, 1), g = new Glow();
      g.add(NIGHT, 0.05);                                       // a faint night sky behind
      for (const w of perLane(e, p, t, 5e5, () => curtains(t, p.size, p.colors))) {
        const u = (y - w.at) / w.w;
        if (u > -1 && u < 1) g.add(w.c, w.v * (1 - u * u) ** 2);
      }
      const sh = 0.75 + 0.25 * noise(509, y * 14 + t * 0.7);   // fine rays shimmering
      g.r *= sh; g.g *= sh; g.b *= sh;
      return g.out(p, NIGHT);
    } },

  { id: 'plasma', name: 'Plasma', category: 'pixel',
    blurb: 'Two colour waves rolling through each other: soft blobs of colour sloshing to and fro with dark gaps. Size closes the gaps.',
    defaults: { speed: 1, tempo: false, size: 0.5, spread: 1, colors: PALETTES.Sunset },
    run: (e, p) => {
      const t = secs(e, 1), i = e.k * p.spread;
      // WLED's plasma: two phases swinging at 6 and 7 a minute, a cubic and a cosine wave, the
      // darker part cut away by a threshold that breathes; plus a slow drift so it keeps flowing
      const ph1 = 0.25 * Math.sin(TAU * t / 10) + 0.03 * t, ph2 = 0.25 * Math.sin(TAU * t * 7 / 60);
      const ci = 0.5 * smooth(tri(frac(i * 14 / 256 + ph1))) + 0.5 * (0.5 + 0.5 * Math.cos(TAU * (i * 9 / 256 + ph2)));
      const thr = 0.5 * (1 - clamp01(p.size)) * (0.5 + 0.5 * Math.sin(TAU * t * 7 / 60));
      return lit(along(p.colors, ci), clamp01((ci - thr) / (1 - thr)), p);
    } },

  { id: 'glitter', name: 'Rainbow with glitter', category: 'pixel',
    blurb: 'A rainbow rolling along with bright white glitter popping all over it. Size sets how much glitter.',
    defaults: { speed: 5, tempo: false, size: 0.5, spread: 1, colors: PALETTES.Rainbow },
    run: (e, p) => {
      const t = secs(e, 5), n = Math.floor(t / 0.045), q = 0.024 * clamp01(p.size);
      let gl = 0;
      for (let j = n - 1; j <= n; j++) if (hash(e.seed, j, 21) < q) gl = Math.max(gl, 1 - (t - j * 0.045) / 0.09);
      return lit(lerpColor(along(p.colors, e.phase), WHITE, clamp01(gl)), 1, p);
    } },

  { id: 'heartbeat', name: 'Heartbeat', category: 'pixel',
    blurb: 'A double thump, lub-dub, glowing out from the middle and fading away. Size sets how long it glows.',
    defaults: { speed: 1.1, tempo: false, size: 0.5, spread: 0.4, colors: [c('#ff0018'), c('#ff2a60')] },
    run: (e, p) => {
      const tau = frac(e.total - p.spread * 0.25 * Math.abs(2 * e.x - 1)), k = 0.12 + 0.45 * clamp01(p.size);
      const v = Math.max(Math.exp(-tau / k), tau < 1 / 3 ? 0 : 0.8 * Math.exp(-(tau - 1 / 3) / k));
      return lit(along(p.colors, e.x), v, p);
    } },

  { id: 'scanner', name: 'Dual scanner', category: 'pixel',
    blurb: 'Two scanner eyes sweeping in from both ends and crossing in the middle, with glowing trails. Size sets the trails.',
    defaults: { speed: 4, tempo: true, size: 0.5, colors: [c('#ff1000'), c('#00a8ff')] },
    run: (e, p) => {
      const y = e.x, pitch = pitchOf(e), tail = 0.01 + 0.12 * clamp01(p.size), at = tri(frac(e.total));
      const a = Math.max(Math.exp(-sinceTri(e.total, y) / tail), dot(y, at, pitch));
      const b = Math.max(Math.exp(-sinceTri(e.total, 1 - y) / tail), dot(y, 1 - at, pitch));
      const g = new Glow(), c0 = p.colors[0] ?? WHITE;
      g.max(c0, a); g.max(p.colors[1] ?? c0, b);
      return g.out(p, c0);
    } },

  { id: 'meteorRain', name: 'Meteor rain', category: 'pixel',
    blurb: 'A meteor shooting along with a sparkling tail that breaks up and fades at random. On a wall, one per light. Size sets the tail.',
    defaults: { speed: 4, tempo: true, size: 0.5, colors: [c('#5a00ff'), c('#1e78ff'), c('#a0e6ff'), c('#ffffff')] },
    run: (e, p) => {
      const { y, id, pitch } = lane(e, p);
      // every lane of a wall a little out of step and at its own speed
      const ph = e.total * (id ? 0.8 + 0.4 * hash(77, id) : 1) + (id ? hash(78, id) : 0);
      const d = frac(ph - y), head = Math.max(1.5 * pitch, 0.05);
      if (d < head) return lit(ramp(p.colors, 1), 1, p);
      // each pixel of the tail goes out at its own random rate (some linger as embers)
      const r = hash(e.seed, Math.floor(ph - y), 31), len = (0.05 + 0.5 * clamp01(p.size)) * (0.2 + 1.3 * (1 - r) ** 3);
      // (and whatever is left is gone before the head comes round again)
      const v = Math.exp(-(d - head) / len) * Math.min(1, 4 * (1 - d)) * (0.75 + 0.25 * hash(e.seed, Math.floor(e.total * 30), 32));
      return lit(ramp(p.colors, v), v, p);
    } },

  { id: 'lightning1d', name: 'Lightning along the strip', category: 'pixel',
    blurb: 'Storm flashes: a faint leader, then a few bright strikes, each on a random stretch of the lights. Size sets how often.',
    defaults: { speed: 1, tempo: false, size: 0.5, colors: [c('#ffffff'), c('#c8d6ff'), c('#e6dcff')] },
    run: (e, p) => {
      const y = e.x, t = secs(e, 1), pitch = pitchOf(e);
      let v = 0;
      for (const f of perLane(e, p, t, 9e5, () => storm(t, p.size, pitch))) if (y >= f.from && y <= f.from + f.len) v = Math.max(v, f.v);
      return lit(along(p.colors, y), v, p);
    } },

  { id: 'rain', name: 'Rain drips', category: 'pixel',
    blurb: 'Drops swelling at the top of each light, falling faster and faster and splashing at the bottom. Size sets how many.',
    defaults: { speed: 1, tempo: false, size: 0.5, colors: [c('#1e64ff'), c('#5ac8ff')] },
    run: (e, p) => {
      const { y, id, pitch } = lane(e, p), t = secs(e, 1), g = new Glow();
      const r = perLane(e, p, t, 6e5 + id, () => rain(t, id, p.size, pitch, p.colors));
      addSpots(g, r.spots, y, pitch);
      for (const s of r.streaks) if (y > s.h && y < s.h + s.len) g.add(s.c, 0.45 * (1 - (y - s.h) / s.len));
      return g.out(p, along(p.colors, y));
    } },

  { id: 'popcorn', name: 'Popcorn', category: 'pixel',
    blurb: 'Kernels popping up from the bottom of each light in bright colours and dropping back down. Size sets how many.',
    defaults: { speed: 1, tempo: false, size: 0.5, colors: PALETTES.Party },
    run: (e, p) => {
      const { y, id, pitch } = lane(e, p), t = secs(e, 1), g = new Glow();
      addSpots(g, perLane(e, p, t, 7e5 + id, () => kernels(t, id, howMany(2 + Math.round(clamp01(p.size) * 10), pitch), p.colors)), y, pitch);
      return g.out(p, along(p.colors, y));
    } },

  { id: 'gradientChase', name: 'Gradient chase', category: 'pixel',
    blurb: 'Bands of colour chasing along, each a smooth fade from dark to bright into the next palette colour. Spread sets how many bands.',
    defaults: { speed: 2, tempo: true, spread: 1, colors: PALETTES.Neon },
    run: (e, p) => {
      const bands = Math.max(1, Math.round(3 * p.spread)), pos = e.x * bands - e.total, f = frac(pos);
      const v = f < 0.88 ? (f / 0.88) ** 2 : (1 - f) / 0.12;
      return lit(along(p.colors, pos / Math.max(1, p.colors.length)), v, p);
    } },
];
