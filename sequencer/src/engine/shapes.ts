// Effects that draw on a ring, a disc or a matrix: the place of every pixel comes from the light's
// shape (model/pixelLayout.ts), so a picture stays a picture whatever order the LEDs are wired in.
// On a strip or a row of lights they still run, as a line through the middle of the picture.
//
// Like every effect, each one is worked out from where the pixel is and when, nothing is kept from
// one frame to the next. What's the same for every pixel of a frame (an eye's pose, where the stars
// are) is worked out once for that moment. The stories (Eye, Reactor, Supernova, Radar) start and
// end dark and last one round: Speed is the length of the story in seconds.
//
// Spread shifts one light against the next when a group has several: 0 they all play the same.
import type { Color } from '../model/types';
import {
  PALETTES, TAU, TEXT_MAX, WHITE, along, c, clamp01, frac, hash, hsv, noise, ramp, shine,
  type EffectDef, type EffectParams, type Elem, type FxOut,
} from './fxkit';

const { sin, cos, exp, hypot, atan2, floor, round, min, max, abs, log } = Math;
const ss = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const near = (d: number, w: number) => exp(-(d / w) * (d / w));
// an angle's difference into -pi..pi
const turnDiff = (a: number) => a - TAU * round(a / TAU);
// soft organic noise from a few sines, about -1..1
const wob = (x: number, y: number, t: number, s = 0) =>
  (sin(2.1 * x + 1.3 * y + 0.9 * t + s) + sin(-3.3 * x + 2.7 * y + 0.6 * t + 2.1 * s) + sin(4.1 * x + 4.7 * y - 0.8 * t + 3.3 * s)) / 3;
const blob = (x: number, y: number, cx: number, cy: number, size: number) => exp(-((x - cx) * (x - cx) + (y - cy) * (y - cy)) / (size * size));
// value noise over a plane, 0..1
function noise2(s: number, x: number, y: number) {
  const ix = floor(x), iy = floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(s, ix, iy), b = hash(s, ix + 1, iy), d = hash(s, ix, iy + 1), e = hash(s, ix + 1, iy + 1);
  return a + (b - a) * u + (d - a) * v + (a - b - d + e) * u * v;
}

// What one light of the group is at: the effect's time, one light shifted against the next.
const rounds = (e: Elem, p: EffectParams) => e.total + p.spread * e.row / max(1, e.rows);
// Scale for pictures that want the shorter side filled (an eye on a wide matrix: in the middle).
const fitOf = (e: Elem) => (e.gh > 1 && e.gw > 1 ? max(e.gw, e.gh) / min(e.gw, e.gh) : 1);
// How far the picture reaches up and across.
const yMax = (e: Elem) => (e.gh > 1 ? (e.gh - 1) / max(1, max(e.gw, e.gh) - 1) : 0.001);
const xMax = (e: Elem) => (e.gw > 1 ? (e.gw - 1) / max(1, max(e.gw, e.gh) - 1) : 1);

// One pixel's light adding up, then out the way the engine takes it. A pixel past full burns
// towards white, as light does.
let R = 0, G = 0, B = 0;
const start = (r = 0, g = 0, b = 0) => { R = r; G = g; B = b; };
const add = (col: Color, v: number) => { if (v > 0) { R += col.r * v; G += col.g * v; B += col.b * v; } };
const scale = (v: number) => { R *= v; G *= v; B *= v; };
const DARK: Color = { r: 0, g: 0, b: 0 };
const done = (p: EffectParams, dark: Color = DARK): FxOut => shine(min(1, R), min(1, G), min(1, B), p, dark);

// ---------------------------------------------------------------- the eye

const AMBER = c('#ffb020'), IRIS = c('#35d070'), ANGER = c('#ff1408'), LID = c('#ff9a50');
//                 at     dur   x      y     pupil  lid   anger
const EYE_KEYS = [[0.0,  0.1,  0.0,  0.0,  0.30,  0.0,  0.0],
                  [1.0,  1.2,  0.0, -0.1,  0.30,  0.32, 0.0],   // half opens, half asleep
                  [2.8,  0.5,  0.0, -0.1,  0.30,  0.0,  0.0],   // nah
                  [3.8,  0.25, 0.0,  0.0,  0.30,  1.0,  0.0],   // awake
                  [4.2,  0.5,  0.0,  0.0,  0.16,  1.0,  0.0],   // too bright
                  [5.4,  0.09, -0.33, 0.0, 0.16,  1.0,  0.0],   // looks around
                  [6.6,  0.09, 0.33,  0.04, 0.18, 1.0,  0.0],
                  [7.8,  0.09, 0.0,   0.0, 0.18,  1.0,  0.0],
                  [9.0,  0.8,  0.0,   0.0, 0.34,  1.0,  0.0],   // oh, it's you
                  [11.0, 0.09, 0.0,   0.3, 0.26,  1.0,  0.0],
                  [12.0, 0.09, 0.0,  -0.3, 0.26,  1.0,  0.0],
                  [15.0, 0.12, 0.0,   0.0, 0.22,  1.0,  0.0],
                  [16.2, 0.4,  -0.3,  0.0, 0.2,   0.5,  0.0],   // suspicious, slowly
                  [17.5, 1.2,  0.3,   0.0, 0.2,   0.5,  0.0],
                  [19.2, 0.25, 0.0,   0.0, 0.12,  0.85, 1.0],   // angry
                  [23.0, 0.5,  0.0,   0.0, 0.26,  1.0,  0.0],   // all good
                  [26.5, 2.5,  0.0,  -0.05, 0.3,  0.0,  0.0]];  // sleepy
const EYE_BLINKS = [8.5, 15.6, 16.0, 23.8, 25.4];
let eyeT = NaN, eyeX = 0, eyeY = 0, eyePupil = 0, eyeLid = 0, eyeAnger = 0;
function eyeAt(t: number) {
  if (t === eyeT) return;
  eyeT = t;
  const s = EYE_KEYS[0].slice(2);
  for (let k = 1; k < EYE_KEYS.length; k++) {
    const K = EYE_KEYS[k], f = ss(0, K[1], t - K[0]);
    for (let i = 0; i < 5; i++) s[i] += (K[i + 2] - s[i]) * f;
  }
  [eyeX, eyeY, eyePupil, eyeLid, eyeAnger] = s;
  if (t >= 13 && t < 15) {                    // it rolls its eye
    const u = ss(0, 1, (t - 13) / 2) * TAU;
    eyeX = 0.3 * sin(u + Math.PI); eyeY = 0.3 * cos(u + Math.PI);
  }
  if (eyeAnger > 0.01) { eyeX += 0.015 * eyeAnger * sin(t * 71); eyeY += 0.015 * eyeAnger * sin(t * 57); }   // it trembles
  for (const b of EYE_BLINKS) eyeLid *= 1 - near(t - b, 0.075);
}
function eye(e: Elem, p: EffectParams): FxOut {
  const t = frac(rounds(e, p)) * 30;
  eyeAt(t);
  const k = fitOf(e), x = e.sx * k, y = e.sy * k, rr = hypot(x, y);
  const dx = x - eyeX, dy = y - eyeY, dist = hypot(dx, dy);
  const red = 1 - 0.5 * ss(0.65, 1, rr);       // the white of the eye goes a bit red at the edge
  start(0.2, 0.2 * red, 0.24 * red);
  const inner = ss(0.25, 0.55, dist), an = eyeAnger;
  const fibres = 0.62 + 0.38 * sin(11 * atan2(dy, dx) + 2.5 * wob(dx, dy, t * 0.2));
  const ir = ((AMBER.r * (1 - inner) + IRIS.r * inner) * (1 - an) + ANGER.r * an) * fibres;
  const ig = ((AMBER.g * (1 - inner) + IRIS.g * inner) * (1 - an) + ANGER.g * an) * fibres;
  const ib = ((AMBER.b * (1 - inner) + IRIS.b * inner) * (1 - an) + ANGER.b * an) * fibres;
  const out = ss(0.57, 0.69, dist);            // the iris's edge
  R = R * out + ir * (1 - out); G = G * out + ig * (1 - out); B = B * out + ib * (1 - out);
  scale(ss(eyePupil - 0.07, eyePupil + 0.07, dist));
  add(WHITE, blob(x, y, eyeX - 0.17, eyeY + 0.2, 0.09) * 0.85);     // the spark of light
  // the lids: an almond that opens, and tips down at one side when angry
  const h = eyeLid * 1.12 * (1 - 0.72 * x * x);
  const upper = h - an * (0.26 + 0.34 * x), lower = -h * 0.92;
  scale(ss(lower - 0.09, lower + 0.09, y) * (1 - ss(upper - 0.09, upper + 0.09, y)));
  add(LID, (near(y - upper, 0.09) + near(y - lower, 0.09)) * (1 - eyeLid * 0.8) * 0.3);   // a slit of warm light when shut
  scale(1 - ss(29.2, 30, t));
  return done(p);
}

// ---------------------------------------------------------------- a black hole

const HOT = ['#2a0500', '#b01800', '#ff6a00', '#ffc060', '#e8f0ff'].map(c);
const GAS = c('#fff0d8'), CLUMP = c('#ffd8a0'), WAVE = c('#ffb060');
function blackHole(e: Elem, p: EffectParams): FxOut {
  const t = rounds(e, p) * 32, r = e.rad, a = e.ang * TAU;
  if (r < 0.13) { start(); return done(p); }           // nothing comes out of the middle
  const s = hash(round(r * 8), 11) * TAU;
  const ph = a - (0.75 / max(r, 0.2) ** 1.5) * t;      // the inner gas runs faster, like orbits do
  const gas = clamp01(0.5 + 0.28 * sin(3 * ph + s) + 0.22 * sin(5 * ph + 2 * s + 0.3 * t)) ** 1.4;
  const depth = ss(0.18, 0.3, r) * (0.22 + 0.78 * (1 - r) ** 1.3);
  const beam = 1.05 + 0.8 * cos(a - 0.45 * t);         // the side coming at you is brighter
  const v = gas * depth * beam;
  start();
  add(ramp(HOT, (1 - r) * 0.72 + v * 0.34), clamp01(v * 1.5));
  const slot = floor(t / 7), u = t - slot * 7 - 1.5;
  let flash = 0;
  if (u >= 0 && u < 3.2) {                             // a clump spirals in
    const k = u / 3.2, rc = 1.05 * (1 - k ** 1.8) + 0.25 * k ** 1.8, ac = slot * 2.4 + 4.5 * k ** 2.2;
    add(CLUMP, blob(e.sx, e.sy, rc * sin(ac), rc * cos(ac), 0.13 + 0.05 * (1 - k)) * 0.9);
  } else if (u >= 3.2) {
    flash = exp(-(u - 3.2) / 0.45);
    add(WAVE, near(r - 0.25 - (u - 3.2) * 1.1, 0.1) * flash * 0.7);
  }
  add(GAS, near(r - 0.25, 0.05) * (0.5 + 0.2 * sin(4 * a + 3 * t) + 0.14 * beam) * (1 + 1.2 * flash));
  return done(p);
}

// ---------------------------------------------------------------- hyperspace

const WARP_N = 34;
const WARP_COLS = ['#ffffff', '#b0d0ff', '#60a0ff', '#c090ff', '#70ffe8'].map(c);
const warpAng = Float32Array.from({ length: WARP_N }, (_, i) => hash(i, 301) * TAU);
const warpSpd = Float32Array.from({ length: WARP_N }, (_, i) => 0.3 + 0.5 * hash(i, 302));
const warpPh = Float32Array.from({ length: WARP_N }, (_, i) => hash(i, 303));
const warpCol = Array.from({ length: WARP_N }, (_, i) => WARP_COLS[floor(hash(i, 304) * WARP_COLS.length)]);
const warpPos = new Float32Array(WARP_N), warpLen = new Float32Array(WARP_N), warpLit = new Float32Array(WARP_N);
let warpT = NaN, warpRush = 0;
function warpAt(t: number) {
  if (t === warpT) return;
  warpT = t;
  const slot = floor(t / 9), u = t - slot * 9, jump = ss(6, 9, u), q = t + 7 * (slot + jump);   // speeds up and settles
  warpRush = 4 * jump * (1 - jump);
  for (let i = 0; i < WARP_N; i++) {
    const s = frac(q * warpSpd[i] + warpPh[i]);
    warpPos[i] = s * s * 1.15;
    warpLen[i] = (0.1 + 0.25 * warpSpd[i]) * (1 + 1.9 * warpRush);
    warpLit[i] = 0.25 + 0.75 * s;
  }
}
const WARP_CORE = c('#1830a0'), WARP_FLASH = c('#c0d8ff');
function warp(e: Elem, p: EffectParams): FxOut {
  const t = rounds(e, p) * 28, r = e.rad, a = e.ang * TAU;
  warpAt(t);
  start();
  for (let i = 0; i < WARP_N; i++) {
    const al = (r - warpPos[i]) / warpLen[i];
    if (al < -1 || al > 0.15) continue;
    const perp = r * turnDiff(a - warpAng[i]);
    if (abs(perp) > 0.3) continue;
    add(warpCol[i], near(perp, 0.085) * ss(-1, -0.1, al) * (1 - ss(0, 0.15, al)) * warpLit[i]);
  }
  const core = near(r, 0.22);
  add(WARP_CORE, core * (0.5 + 0.2 * sin(t * 1.3)));
  add(WARP_FLASH, core * warpRush * 1.2);
  return done(p);
}

// ---------------------------------------------------------------- a reactor

const COLD = c('#20c8ff'), HOT_R = c('#ff6010'), EMBER = c('#ff4010'), BLAST = c('#ffb070');
function reactor(e: Elem, p: EffectParams): FxOut {
  const t = frac(rounds(e, p)) * 25, r = e.rad, a = e.ang * TAU;
  const step = round(r * 8), dashes = max(2, round(step * 0.75)), way = step % 2 === 0 ? 1 : -1;
  start();
  if (t >= 21) {                                       // blows, and drains into the middle
    const u = t - 21, flash = exp(-u / 0.14);
    start(flash, flash, flash);
    add(EMBER, near(r, max(0.05, 0.7 - u * 0.2)) * exp(-u / 1.1));
    add(BLAST, near(r - u * 2.2, 0.12) * exp(-u / 0.5));
    return done(p);
  }
  const heat = ss(16, 21, t);
  const lit = ss(0, 0.5, t - (0.8 + r * 5));           // ring by ring, from the middle out
  const late = max(0, t - 15.5), early = max(0, 3 - t);
  const spin = 1.8 * t + 0.42 * late * late - 1.2 * early * early;
  const tooth = ss(0, 0.5, cos(dashes * a - way * spin * (1.3 - 0.6 * r)));
  const pulse = near(r - frac(0.75 * t + 0.14 * late * late) * 1.2, 0.12);
  const cr = COLD.r + (HOT_R.r - COLD.r) * heat, cg = COLD.g + (HOT_R.g - COLD.g) * heat, cb = COLD.b + (HOT_R.b - COLD.b) * heat;
  const v = lit * (0.28 + 0.72 * tooth) * (0.55 + 0.3 * sin(t * 2.1)) + pulse * lit * 0.9;
  R = cr * v; G = cg * v; B = cb * v;
  const core = near(r, 0.13 + 0.12 * heat) * ss(0.2, 0.9, t) * (0.8 + 0.2 * sin(t * 9));
  R += core * (0.8 + cr * 0.4); G += core * (0.8 + cg * 0.4); B += core * (0.8 + cb * 0.4);
  if (t > 17 && sin(t * 61) * sin(t * 37) > 0.75 - 0.5 * heat) scale(0.45);   // it stutters
  return done(p);
}

// ---------------------------------------------------------------- a supernova

const SN_N = 30;
const snAng = Float32Array.from({ length: SN_N }, (_, i) => hash(i, 401) * TAU);
const snSpd = Float32Array.from({ length: SN_N }, (_, i) => 0.25 + 0.7 * hash(i, 402));
const SUN = ['#ffffff', '#ffe080', '#ff8020', '#c02000', '#400800'].map(c);
const FALL = ['#c02000', '#ffa040', '#ffffff'].map(c);
const SHOCK = ['#ffffff', '#60a8ff', '#8040ff'].map(c);
const SPARK = c('#ffd090'), NEB1 = c('#ff2090'), NEB2 = c('#10d0d8'), PULSAR = c('#d0e8ff');
function supernova(e: Elem, p: EffectParams): FxOut {
  const t = frac(rounds(e, p)) * 22, r = e.rad, a = e.ang * TAU, bang = 7;
  start();
  if (t < bang - 1.5) {                                // the old star swells and reddens
    const k = t / (bang - 1.5), big = 0.15 + 0.5 * k;
    const boil = 0.8 + 0.2 * wob(e.sx * 3, e.sy * 3, t * 2.5);
    const v = exp(-((r / big) ** 2.4)) * boil * (0.85 + 0.15 * sin(t * (1.5 + 3 * k)));
    add(ramp(SUN, 0.15 + 0.6 * k + 0.5 * r / big), v * ss(0, 1.2, t));
  } else if (t < bang - 0.25) {                        // falls in on itself
    const k = (t - (bang - 1.5)) / 1.25, big = 0.65 * (1 - k ** 2.2) + 0.03;
    add(ramp(FALL, k), exp(-((r / big) ** 2.4)) * (0.8 + k * 0.6));
  } else if (t >= bang) {
    const u = t - bang, flash = exp(-u / 0.12), front = 1 - exp(-u * 1.6);
    add(WHITE, flash);
    add(ramp(SHOCK, front), near(r - front * 1.35, 0.09 + 0.1 * front) * exp(-u / 1.6));
    // what's thrown out: sparks on straight lines
    const fade = exp(-u / 2.8), reach = (1 - exp(-u * 1.3)) * 1.5;
    if (fade > 0.01) for (let i = 0; i < SN_N; i++) {
      const dr = r - snSpd[i] * reach;
      if (abs(dr) > 0.25) continue;
      add(SPARK, near(r * turnDiff(a - snAng[i]), 0.08) * near(dr, 0.09) * fade);
    }
    // the cloud it leaves
    const env = ss(0.3, 2.5, u) * (1 - ss(10, 14.6, u)) * ss(0, 0.35, r) * ss(0, max(front, 1e-3), 1.2 * front - r + 0.25);
    if (env > 0) {
      add(NEB1, clamp01(0.55 + 0.75 * wob(e.sx * 2.4, e.sy * 2.4, u * 0.25, 1.7)) * env * 0.34);
      add(NEB2, clamp01(0.5 + 0.8 * wob(e.sx * 2, e.sy * 2, u * 0.2, 4.1)) * env * 0.3);
    }
    if (u > 2.2) {                                     // the pulsar: two beams going round fast
      const q = ss(2.2, 3.5, u) * (1 - ss(11, 14.6, u));
      const beams = near(turnDiff(2 * (a - u * 5.5)), 0.55) * exp(-r * 1.7);
      add(PULSAR, (beams * 0.95 + near(r, 0.1) * (0.75 + 0.25 * sin(u * 22))) * q);
    }
  }
  return done(p);
}

// ---------------------------------------------------------------- a radar

const BLIPS = Array.from({ length: 7 }, (_, i) => { const a = hash(i, 501) * TAU, r = 0.35 + 0.6 * hash(i, 502); return { a, x: r * sin(a), y: r * cos(a) }; });
const SCOPE = c('#00d840'), LIME = c('#b0ff70'), LOCK = c('#ff2010'), CONTACT = c('#ffe040');
function radar(e: Elem, p: EffectParams): FxOut {
  const t = frac(rounds(e, p)) * 26, r = e.rad, a = e.ang * TAU, x = e.sx, y = e.sy;
  const period = 2.8, w = TAU / period, sweep = (w * t) % TAU;
  const behind = ((sweep - a) % TAU + TAU) % TAU;
  const grid = near(frac(r * 4 + 0.5) - 0.5, 0.077) * (r > 0.1 ? 1 : 0);
  start();
  add(SCOPE, exp(-behind / 1.25) * (0.1 + 0.9 * r ** 0.3) * 0.8 + 0.035 * grid);
  if (behind < 0.14) add(LIME, 0.55);
  for (const b of BLIPS) {
    const since = (((sweep - b.a) % TAU + TAU) % TAU) / w;
    add(LIME, blob(x, y, b.x, b.y, 0.085) * exp(-since / 1.8));
  }
  // the contact comes in from the edge
  const rc = 1 - 0.75 * ss(1, 17, t), ac = 0.7 + 0.5 * sin(t * 0.2), cx = rc * sin(ac), cy = rc * cos(ac);
  const lock = ss(16.5, 17.5, t);
  if (lock < 1) add(CONTACT, blob(x, y, cx, cy, 0.1) * exp(-(((sweep - ac) % TAU + TAU) % TAU) / w / 1.8) * (1 - lock));
  if (lock > 0) {                                      // locked: red, and it pings
    scale(1 - 0.65 * lock);
    add(LOCK, blob(x, y, cx, cy, 0.14) * lock * (sin(t * 14) > 0 ? 1 : 0.35));
    add(LOCK, near(hypot(x - cx, y - cy) - frac(t * 0.85) * 1.7, 0.08) * lock * 0.5);
  }
  scale(1 - ss(25.2, 26, t));
  return done(p);
}

// ---------------------------------------------------------------- spirals and kaleidoscopes

const HYPNO = [['#ff10a0', '#10c8ff'], ['#ff7000', '#2040ff'], ['#60ff20', '#a020ff']].map((q) => q.map(c));
function hypno(e: Elem, p: EffectParams): FxOut {
  const t = rounds(e, p) * 24, r = e.rad, a = e.ang * TAU;
  const twist = 1.25 + 0.75 * sin(t * 0.33), spin = 2.3 * t + 1.4 * sin(t * 0.41);
  const a1 = cos(3 * a + TAU * twist * r - spin), a2 = cos(5 * a - TAU * twist * 0.8 * r + spin * 0.62);
  const k = t / 8, i = floor(k) % 3, f = ss(0.75, 1, frac(k)), P = HYPNO[(i + 3) % 3], Q = HYPNO[(i + 4) % 3];
  const va = ss(0.1, 0.65, a1) * 0.66, vb = ss(0.25, 0.75, a2) * 0.56;
  start();
  add({ r: P[0].r + (Q[0].r - P[0].r) * f, g: P[0].g + (Q[0].g - P[0].g) * f, b: P[0].b + (Q[0].b - P[0].b) * f }, va);
  add({ r: P[1].r + (Q[1].r - P[1].r) * f, g: P[1].g + (Q[1].g - P[1].g) * f, b: P[1].b + (Q[1].b - P[1].b) * f }, vb);
  add(WHITE, near(r, 0.16) * (0.5 + 0.5 * sin(t * 3)));
  return done(p);
}

const FOLDS = [3, 4, 6, 8, 12, 6];
function petals(k: number, t: number, r: number, ang: number, out: number) {
  const fa = abs(frac(ang * k + 0.05 * t) - 0.5) * 2;       // folded: 0 mid petal, 1 between
  const v = ss(0.15, 0.85, cos(TAU * (r * 1.6 - 0.22 * t) + 3.4 * fa)) * 0.9 + ss(0.4, 0.95, cos(TAU * (r * 2.8 + 0.13 * t) - 2.2 * fa + 1.3)) * 0.65;
  add(hsv(0.07 * t + 0.42 * r + 0.13 * fa, 0.88 - 0.3 * ss(0.8, 1.2, v), 1), clamp01(v) * 0.72 * out);
}
function mandala(e: Elem, p: EffectParams): FxOut {
  const t = rounds(e, p) * 24, r = e.rad, s = t / 4, i = floor(s) % FOLDS.length, f = ss(0.72, 1, frac(s));
  start();
  if (f < 1) petals(FOLDS[(i + FOLDS.length) % FOLDS.length], t, r, e.ang, 1 - f);
  if (f > 0) petals(FOLDS[(i + 1 + FOLDS.length) % FOLDS.length], t, r, e.ang, f);
  add(WHITE, near(r, 0.14) * (0.6 + 0.4 * sin(t * 2.2)));
  return done(p);
}

const ARM = c('#5070ff'), ARM2 = c('#c060ff'), BULGE = c('#ffd8a0');
function galaxy(e: Elem, p: EffectParams): FxOut {
  const t = rounds(e, p) * 40, r = max(e.rad, 0.02), a = e.ang * TAU;
  const wind = 2 * (a - log(r + 0.05) * (1.6 + clamp01(p.size) * 1.6) - t * 0.35);
  const arm = ss(0.05, 0.95, cos(wind)) * (0.2 + 0.8 * (1 - r) ** 0.6) * ss(1.02, 0.6, r);
  start();
  add(ARM, arm * 0.8);
  add(ARM2, ss(0.55, 1, cos(wind + 0.6)) * (1 - r) * 0.5);
  add(BULGE, near(r, 0.22) * (0.8 + 0.2 * sin(t * 0.7)));
  // a few stars that aren't in any arm
  if (hash(e.cell, 9) > 0.93) add(WHITE, 0.25 + 0.6 * noise(e.cell, t * 1.8) ** 3);
  return done(p);
}

function tunnel(e: Elem, p: EffectParams): FxOut {
  const t = rounds(e, p) * 2, r = e.rad;
  const spokes = max(2, round(2 + clamp01(p.size) * 10));
  const u = -log(r + 0.08) * 0.9 - t, v = e.ang * spokes + t * 0.12 * spokes;
  const on = (floor(u * 2) + floor(v)) % 2 === 0;
  const depth = ss(0.02, 0.4, r);
  start();
  add(along(p.colors, u * 0.08), (on ? 1 : 0.06) * depth);
  return done(p);
}

// ---------------------------------------------------------------- moving pictures in colour

function plasmaClouds(e: Elem, p: EffectParams): FxOut {
  const t = rounds(e, p) * 6, z = 1 + clamp01(p.size) * 2.4, x = e.sx * z, y = e.sy * z;
  const v = sin(x * 1.7 + t) + sin(y * 2.1 - t * 0.8) + sin((x + y) * 1.3 + t * 0.6) + sin(hypot(x, y) * 2.6 - t * 1.1);
  const q = (v + 4) / 8;
  start();
  add(along(p.colors, q + t * 0.03), 0.28 + 0.72 * ss(0.12, 0.72, q));
  return done(p);
}

const BALLS = Array.from({ length: 6 }, (_, i) => ({ fx: 0.31 + 0.5 * hash(i, 601), fy: 0.23 + 0.5 * hash(i, 602), px: hash(i, 603) * TAU, py: hash(i, 604) * TAU, r: 0.28 + 0.2 * hash(i, 605) }));
function lavaLamp(e: Elem, p: EffectParams): FxOut {
  const t = rounds(e, p) * 8, bx = xMax(e), by = yMax(e), z = 0.5 + clamp01(p.size);
  let field = 0;
  for (const b of BALLS) {
    const dx = e.sx - bx * 0.8 * sin(t * b.fx + b.px), dy = e.sy - by * 0.85 * sin(t * b.fy + b.py);
    field += (b.r * z) * (b.r * z) / (dx * dx + dy * dy + 0.012);
  }
  const body = ss(0.9, 1.5, field), halo = ss(0.35, 0.9, field);
  start();
  add(ramp(p.colors, 0.25 + 0.3 * e.sy + 0.45 * clamp01(field - 1)), body * 0.95 + halo * 0.12);
  return done(p);
}

function campfire(e: Elem, p: EffectParams): FxOut {
  const t = rounds(e, p) * 2, h = e.gh > 1 ? e.gy / (e.gh - 1) : clamp01((e.sx + 1) / 2);
  const x = e.gh > 1 ? e.sx : 0.3;
  const top = 0.3 + 0.95 * clamp01(p.size) * (0.75 + 0.25 * noise(11, t * 2.1));
  const turb = 0.6 * noise2(21, x * 3.2, h * 3 - t * 3.1) + 0.4 * noise2(22, x * 7, h * 7 - t * 6.3);
  let heat = (0.08 + 0.95 * turb) * max(0, 1 - h / top);
  if (h < 0.15) heat += (1 - h / 0.15) * 0.45 * noise2(23, x * 9, t * 9);    // embers at the base
  heat = clamp01(heat);
  start();
  add(ramp(p.colors, heat * 1.25 - 0.25), min(1, heat * 2.6));
  return done(p);
}

function codeRain(e: Elem, p: EffectParams): FxOut {
  const t = rounds(e, p) * 1.2, col = e.gx, L = max(2, e.gh), s = hash(col, 7);
  const span = L * (1.35 + s), pos = frac((t * (0.5 + s) * L * 0.5 + s * 17) / span) * span;
  const back = pos - (L - 1 - e.gy);                  // how far behind the head it is
  start();
  if (back >= 0) {
    const tail = L * (0.45 + 0.55 * clamp01(p.size)) * (0.7 + 0.5 * s);
    if (back < tail) {
      const k = 1 - back / tail, flick = 0.75 + 0.25 * hash(col, e.gy, floor(t * 12));
      add(back < 1 ? WHITE : ramp(p.colors, k), back < 1 ? 0.9 : k * k * flick);
    }
  }
  return done(p, p.colors[0]);
}

function raindrops(e: Elem, p: EffectParams): FxOut {
  const t = rounds(e, p) * 3.2, bx = xMax(e), by = yMax(e);
  start();
  for (let i = 0; i < 5; i++) {
    const q = t + i / 5, slot = floor(q), age = (q - slot) * 3.2;
    const cx = (hash(slot, i, 701) * 2 - 1) * bx * 0.8, cy = (hash(slot, i, 702) * 2 - 1) * by * 0.8;
    const d = hypot(e.sx - cx, e.sy - cy);
    const amp = exp(-age * 1.1);
    add(along(p.colors, hash(slot, i, 703)), (near(d - age * 0.75, 0.11) + 0.45 * near(d - age * 0.42, 0.08)) * amp);
    add(WHITE, near(d, 0.12) * exp(-age * 9) * 0.8);       // where it lands
  }
  return done(p);
}

function skyRockets(e: Elem, p: EffectParams): FxOut {
  const t = rounds(e, p) * 3, bx = xMax(e), by = yMax(e), x = e.sx, y = e.sy;
  start();
  for (let i = 0; i < 3; i++) {
    const q = t + i / 3, slot = floor(q), f = (q - slot) * 3;
    const cx = (hash(slot, i, 801) * 1.4 - 0.7) * bx, cy = (hash(slot, i, 802) * 0.8 + 0.1) * by;
    const col = along(p.colors, hash(slot, i, 803));
    if (f < 0.7) {                                     // goes up
      const k = f / 0.7, ry = -by + (cy + by) * (1 - (1 - k) * (1 - k));
      add(WHITE, blob(x, y, cx, ry, 0.09) * 0.8);
      add(col, near(x - cx, 0.05) * (y < ry ? exp(-(ry - y) * 3.5) : 0) * 0.35);
    } else {                                           // bursts, and falls a little as it fades
      const u = f - 0.7, R0 = (1 - exp(-u * 3.2)) * (0.55 + 0.35 * hash(slot, i, 804)) * max(bx, by);
      const dy = y - cy + u * u * 0.22, d = hypot(x - cx, dy);
      const k = max(5, floor(6 + hash(slot, i, 805) * 8)), a = atan2(x - cx, dy);
      const rays = 0.35 + 0.65 * ss(0.2, 0.9, cos(a * k));
      const fade = exp(-u * 1.5);
      add(col, near(d - R0, 0.1 + u * 0.03) * rays * fade * 1.2);
      add(WHITE, near(d, 0.14) * exp(-u * 10));
      if (u > 0.5) add(col, near(d - R0 * 0.6, 0.06) * rays * fade * 0.4 * (sin(u * 30 + cx * 9) > 0 ? 1 : 0.2));
    }
  }
  return done(p);
}

// ---------------------------------------------------------------- on the beat

function kickRings(e: Elem, p: EffectParams): FxOut {
  const t = rounds(e, p), r = e.rad, hit = floor(t), f = t - hit, kick = 1 + 0.6 * (p.sound ?? 0);
  start();
  for (let i = 0; i < 3; i++) {
    const age = f + i, big = 1 - exp(-age * 1.8);
    const n = max(1, p.colors.length), col = p.colors[((hit - i) % n + n) % n] ?? WHITE;
    add(col, near(r - big * 1.1, 0.11 + 0.06 * age) * exp(-age * 1.15) * kick);
  }
  add(WHITE, near(r, 0.24) * exp(-f * 7) * kick);
  return done(p);
}

function bigHeart(e: Elem, p: EffectParams): FxOut {
  const t = rounds(e, p), f = frac(t), k = fitOf(e);
  const beat = exp(-((f / 0.09) ** 2)) + 0.7 * exp(-(((f - 0.24) / 0.09) ** 2));
  const big = 0.66 + (0.04 + 0.12 * clamp01(p.size)) * beat;
  const X = (e.sx * k) / big, Y = ((e.sy * k) + 0.06) / big;
  const q = X * X + Y * Y - 1, v = q * q * q - X * X * Y * Y * Y;
  const inside = ss(0.04, -0.06, v);
  const glow = near(max(0, v), 0.5);
  start();
  add(ramp(p.colors, 0.15 + 0.6 * beat), inside * (0.72 + 0.28 * beat) + glow * 0.14);
  add(p.colors[0] ?? WHITE, near(hypot(e.sx * k, e.sy * k) - 0.45 - f * 1.1, 0.1) * exp(-f * 2.6) * 0.35);
  return done(p);
}

function equaliser(e: Elem, p: EffectParams): FxOut {
  const beats = e.beats + p.spread * e.row / max(1, e.rows), t = rounds(e, p), W = max(1, e.gw), H = max(2, e.gh);
  const bars = max(1, min(W, round(4 + clamp01(p.size) * 28)));
  const band = floor((e.gx / W) * bars);
  const kick = max(p.sound ?? 0, exp(-frac(beats) * 3.2));   // the bass if the mic hears it, else the beat
  const lift = 1 - 0.55 * band / max(1, bars - 1);           // the low end kicks the most
  const level = clamp01((0.18 + 0.82 * noise(band + 31, t * 2.2)) * (0.42 + 0.58 * kick * lift));
  const peak = clamp01(level + 0.1 + 0.25 * noise(band + 61, t * 0.9));
  const h = e.gy / (H - 1);
  start();
  if (h <= level) add(ramp(p.colors, h), 0.9);
  else if (abs(h - peak) < 0.5 / (H - 1)) add(WHITE, 0.35);
  return done(p);
}

// ---------------------------------------------------------------- words

// A 5 x 7 capital font: five columns of seven dots, the top row in the low bit.
const FONT = [
  '0000000000 00005f0000 0007000700 147f147f14 242a7f2a12 2313086462 3649552250 0005030000 001c224100 0041221c00 ',
  '14083e0814 08083e0808 0050300000 0808080808 0060600000 2010080402 3e5149453e 00427f4000 4261514946 2141454b31 ',
  '1814127f10 2745454539 3c4a494930 0171090503 3649494936 064949291e 0036360000 0056360000 0814224100 1414141414 ',
  '0041221408 0201510906 324979413e 7e1111117e 7f49494936 3e41414122 7f4141221c 7f49494941 7f09090901 3e4149497a ',
  '7f0808087f 00417f4100 2040413f01 7f08142241 7f40404040 7f020c027f 7f0408107f 3e4141413e 7f09090906 3e4151215e ',
  '7f09192946 4649494931 01017f0101 3f4040403f 1f2040201f 3f4038403f 6314081463 0708700807 6151494543',
].join('').split(' ');
// (one glyph per ASCII code from 32, as ten hex digits)
const GLYPHS: number[][] = FONT.map((g) => [0, 2, 4, 6, 8].map((k) => parseInt(g.slice(k, k + 2), 16)));
const columnsOf = new Map<string, Uint8Array>();
export function textColumns(text: string): Uint8Array {
  let cols = columnsOf.get(text);
  if (cols) return cols;
  // (accents dropped, small letters as capitals: what the five-by-seven has)
  const plain = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/ß/g, 'SS').slice(0, TEXT_MAX);
  const out: number[] = [];
  for (const ch of plain) {
    const g = GLYPHS[ch.charCodeAt(0) - 32] ?? GLYPHS[0];
    out.push(...g, 0);
  }
  cols = Uint8Array.from(out);
  if (columnsOf.size > 40) columnsOf.clear();
  columnsOf.set(text, cols);
  return cols;
}
function scrollText(e: Elem, p: EffectParams): FxOut {
  const cols = textColumns(p.text || 'LUXDMX'), W = max(1, e.gw), H = max(1, e.gh);
  const blocks = max(1, floor(H / 7)), width = cols.length * blocks + W;
  const off = floor(rounds(e, p) * 14);
  const q = ((e.gx + off - W) % width + width) % width;     // comes in from the right, leaves on the left
  start();
  const col = floor(q / blocks);
  if (col < cols.length) {
    const down = H - 1 - e.gy - floor((H - 7 * blocks) / 2), row = floor(down / blocks);
    if (row >= 0 && row < 7 && (cols[col] >> row) & 1) add(along(p.colors, col / max(1, cols.length) + rounds(e, p) * 0.04), 1);
  }
  return done(p);
}

// ---------------------------------------------------------------- checking the wiring

function wiringTest(e: Elem, p: EffectParams): FxOut {
  const t = e.secs;
  start();
  add(hsv(e.lane / max(1, e.lanes), 1, 1), 0.22);
  if (e.first) add(WHITE, 0.6);
  if (floor(t * 12) % max(1, e.cells) === e.cell) add(WHITE, 1);
  return done(p);
}

// ---------------------------------------------------------------- the list

// (Size makes the picture smaller on the ones that don't use it themselves; Back mirrors them, so
// what turns turns the other way, except text and the wiring test)
const ZOOM = new Set(['eye', 'reactor', 'supernova', 'radar', 'blackHole', 'warp', 'hypno', 'mandala', 'raindrops', 'skyRockets', 'kickRings']);
const fx = (id: string, name: string, blurb: string, run: EffectDef['run'], defaults: EffectDef['defaults'], own = true): EffectDef =>
  ({ id, name, category: 'pixel', shape: true, noColors: own, blurb, defaults: { tempo: false, spread: 0, ...defaults }, run,
    ...(ZOOM.has(id) ? { zoom: true } : {}), ...(id === 'scrollText' || id === 'wiringTest' ? { noFlip: true } : {}) });

export const SHAPE_EFFECTS: EffectDef[] = [
  fx('eye', 'Eye', 'An eye wakes up, looks around, rolls itself, gets angry and falls asleep again. A 30 s story that starts and ends dark.', eye, { speed: 30 }),
  fx('reactor', 'Reactor', 'A reactor starts up ring by ring, hums, overloads, blows and goes dark. A 25 s story.', reactor, { speed: 25 }),
  fx('supernova', 'Supernova', 'A star swells, collapses to a point, explodes and leaves a pulsar in a nebula. A 22 s story.', supernova, { speed: 22 }),
  fx('radar', 'Radar', 'A radar sweep with afterglow; a contact closes in until it locks on. A 26 s story.', radar, { speed: 26 }),
  fx('blackHole', 'Black hole', 'Hot gas shearing round a black hole, bright on one side, clumps falling in.', blackHole, { speed: 32 }),
  fx('warp', 'Warp', 'Hyperspace: stars streak out of the middle, and every so often it jumps.', warp, { speed: 28 }),
  fx('galaxy', 'Galaxy', 'A spiral galaxy turning slowly, with a few stars of its own. Size winds the arms tighter.', galaxy, { speed: 40, size: 0.5 }),
  fx('hypno', 'Hypno', 'Two spirals running through each other: the moire crawls and breathes.', hypno, { speed: 24 }),
  fx('mandala', 'Mandala', 'A kaleidoscope that keeps changing its symmetry: 3, 4, 6, 8, 12 fold.', mandala, { speed: 24 }),
  fx('tunnel', 'Tunnel', 'Flying down a checkered tunnel. Size sets how many spokes it has.', tunnel, { speed: 4, size: 0.5, colors: PALETTES.Neon }, false),
  fx('plasmaClouds', 'Plasma clouds', 'Slow clouds of colour rolling over the whole picture. Size zooms out.', plasmaClouds, { speed: 12, size: 0.4, colors: PALETTES.Party }, false),
  fx('lavaLamp', 'Lava lamp', 'Blobs that drift, merge and split. Size makes them bigger.', lavaLamp, { speed: 16, size: 0.5, colors: PALETTES.Lava }, false),
  fx('campfire', 'Campfire', 'Flames rising from the bottom of the picture. Size sets how high.', campfire, { speed: 2, size: 0.7, colors: PALETTES.Heat }, false),
  fx('codeRain', 'Code rain', 'Green code falling down in columns. Size sets how long the tails are.', codeRain, { speed: 1.5, size: 0.6, colors: PALETTES.Matrix }, false),
  fx('raindrops', 'Raindrops', 'Drops landing on water, the rings spreading and crossing.', raindrops, { speed: 6, colors: PALETTES.Ocean }, false),
  fx('skyRockets', 'Sky rockets', 'Rockets going up and bursting, a new one every second or so.', skyRockets, { speed: 6, colors: PALETTES.Party }, false),
  fx('kickRings', 'Kick rings', 'A ring goes out from the middle on every beat, harder when the microphone hears the bass.', kickRings, { speed: 1, tempo: true, colors: PALETTES.Neon }, false),
  fx('bigHeart', 'Big heart', 'A big heart beating twice per round, in time with the music. Size sets how hard.', bigHeart, { speed: 2, tempo: true, size: 0.6, colors: ['#a0001e', '#ff0030', '#ff5070'].map(c) }, false),
  fx('equaliser', 'Equaliser', 'Bars jumping to the bass (with the microphone on) or the beat. Size sets how many bars.', equaliser, { speed: 4, tempo: true, size: 0.4, colors: ['#00ff40', '#ffe000', '#ff1000'].map(c) }, false),
  fx('scrollText', 'Scrolling text', 'Your words running across a matrix, or through a disc. Speed sets how fast.', scrollText, { speed: 1, text: 'LUXDMX', colors: PALETTES.Rainbow }, false),
  fx('wiringTest', 'Wiring test', 'Is the shape right? A colour per ring or row, the first LED of each white, and a dot walking the LEDs in data order.', wiringTest, { speed: 1, level: 1 }),
];
