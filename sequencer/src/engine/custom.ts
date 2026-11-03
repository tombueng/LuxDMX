// Your own effects: a Formula (a small, safe expression per pixel) and a Picture (an image or an
// animated GIF laid over the lights). Shows travel between people, so nothing here runs code from a
// show file: formulas are parsed and evaluated by our own small interpreter (formula.ts).
import { unzlibSync } from 'fflate';
import type { Color } from '../model/types';
import { EXAMPLES, FormulaError, compileCached, newCtx, type Formula } from './formula';
import { frac, hash, along, range, tri, type EffectDef, type EffectParams, type FxOut } from './fxkit';

// ---------------------------------------------------------------- the formula

const ctx = newCtx();
const formulas = new WeakMap<EffectParams, Formula | null>();
// once per effect and frame (every pixel of the effect gets the same params object)
function formulaOf(p: EffectParams): Formula | null {
  let f = formulas.get(p);
  if (f === undefined) {
    const c = compileCached(p.formula);
    f = c instanceof FormulaError ? null : c;
    formulas.set(p, f);
  }
  return f;
}
const unit = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);     // NaN counts as 0
const BLACK: Color = { r: 0, g: 0, b: 0 };
// A colour with its brightness: the colour at full, the brightness on the intensity (so a light
// with a dimmer channel and one without show the same).
function lit(r: number, g: number, b: number, p: EffectParams): FxOut {
  const m = Math.max(r, g, b);
  return { intensity: range(p, m), color: m > 0 ? { r: r / m, g: g / m, b: b / m } : BLACK };
}

const formula: EffectDef = {
  id: 'formula', name: 'Formula', category: 'pixel',
  blurb: 'Write your own: a small formula gives every pixel its brightness or colour. Start from an example.',
  defaults: { formula: EXAMPLES[0].formula, speed: 4 },
  run: (e, p) => {
    const f = formulaOf(p);
    if (!f) return { intensity: 0 };
    ctx.x = e.x; ctx.u = e.u; ctx.i = e.k; ctx.n = e.m; ctx.row = e.row; ctx.rows = e.rows;
    ctx.t = e.secs; ctx.beat = e.beats; ctx.c = e.cycle; ctx.phase = e.phase;
    ctx.bass = p.sound ?? 0; ctx.rnd = hash(e.seed, 5); ctx.size = p.size; ctx.colors = p.colors;
    if (f.type === 'num') return { intensity: range(p, unit(f.num(ctx))), color: along(p.colors, e.x) };
    const o = f.col(ctx);
    return lit(unit(o[0]), unit(o[1]), unit(o[2]), p);
  },
};

// ---------------------------------------------------------------- the picture

// A picture as the effect keeps it: RGB frames (w x h, row by row) and each frame's time.
export interface Picture { w: number; h: number; frames: Uint8Array[]; delays: number[]; ends: number[]; total: number }
// What a picture may be at most once packed into a show (gif.ts scales it down to fit).
export const PICTURE_LIMITS = { w: 160, h: 120, frames: 64, chars: 400_000 };

// The packed form in `params.picture` (FORMAT.md, "The Picture effect"):
//   pic1:<w>x<h>:<ms of frame 1>,<ms of frame 2>,...:<base64 of zlib of the frames' RGB bytes>
// The first frame's bytes are stored as the difference to the pixel before (same colour channel),
// every later frame's as the difference to the frame before (mod 256), which packs flat areas and
// still backgrounds down to almost nothing. gif.ts packs (packPicture), this unpacks.
export function unpackPicture(s: string): Picture {
  // (the biggest one the format allows is about 5 MB of text; anything far bigger isn't one)
  if (s.length > 6_000_000) throw new Error('not a picture');
  const m = /^pic1:(\d{1,3})x(\d{1,3}):([\d,]{1,640}):([A-Za-z0-9+/=]+)$/.exec(s);
  if (!m) throw new Error('not a picture');
  const w = +m[1], h = +m[2], delays = m[3].split(',').map(Number);
  const n = delays.length;
  if (!w || !h || w > PICTURE_LIMITS.w || h > PICTURE_LIMITS.h || n > PICTURE_LIMITS.frames || delays.some((d) => !Number.isFinite(d))) throw new Error('not a picture');
  const size = w * h * 3, want = size * n;
  const bin = atob(m[4]), z = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) z[i] = bin.charCodeAt(i);
  // into a buffer of exactly the size it says (a damaged or hostile one can't make more)
  const raw = unzlibSync(z, { out: new Uint8Array(want) });
  if (raw.length !== want) throw new Error('not a picture');
  for (let i = 3; i < size; i++) raw[i] = (raw[i] + raw[i - 3]) & 255;
  for (let i = size; i < want; i++) raw[i] = (raw[i] + raw[i - size]) & 255;
  const frames = Array.from({ length: n }, (_, f) => raw.subarray(f * size, (f + 1) * size));
  return timed(w, h, frames, delays);
}
// Frame times: an animation's frames at least 20 ms each (a 0 would make it endless).
export function timed(w: number, h: number, frames: Uint8Array[], delays: number[]): Picture {
  const ds = frames.length > 1 ? delays.map((d) => Math.max(20, d)) : [0];
  const ends: number[] = [];
  let total = 0;
  for (const d of ds) { total += d; ends.push(total); }
  return { w, h, frames, delays: ds, ends, total };
}

// The picture the effect shows before one is loaded: a sunset over the sea, painted here.
let sample: Picture | undefined;
export function samplePicture(): Picture {
  if (sample) return sample;
  const w = 40, h = 30, px = new Uint8Array(w * h * 3), horizon = 17;
  const sky = [[10, 14, 60], [70, 20, 110], [200, 40, 90], [255, 110, 30], [255, 190, 60]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r: number, g: number, b: number;
    const dx = (x - (w - 1) / 2) / w;
    if (y < horizon) {
      const t = y / (horizon - 1) * (sky.length - 1), i = Math.min(sky.length - 2, Math.floor(t)), f = t - i;
      [r, g, b] = [0, 1, 2].map((k) => sky[i][k] + (sky[i + 1][k] - sky[i][k]) * f);
      const d = Math.hypot(dx * 1.4, (y - horizon + 3) / h);                        // the sun, sitting on the sea
      const sun = Math.max(0, 1 - d / 0.12), glow = Math.max(0, 1 - d / 0.4) ** 2 * 0.6;
      r += (255 - r) * Math.min(1, sun * 2 + glow); g += (230 - g) * Math.min(1, sun * 2 + glow * 0.7); b += (120 - b) * sun;
      if (y < 6 && hash(x, y, 3) > 0.93) r = g = b = 255;                            // stars
    } else {
      const deep = (y - horizon) / (h - horizon);
      [r, g, b] = [10 + 20 * (1 - deep), 30 + 40 * (1 - deep), 90 + 60 * (1 - deep)];
      // the sun's road on the water: broken bands, wider towards us
      const road = Math.max(0, 1 - Math.abs(dx) / (0.06 + 0.18 * deep)) * (hash(y, Math.floor(x / 3), 9) > 0.35 ? 1 : 0.3);
      r += (255 - r) * road * 0.9; g += (140 - g) * road * 0.8; b += (40 - b) * road * 0.5;
    }
    const o = (y * w + x) * 3;
    px[o] = r; px[o + 1] = g; px[o + 2] = b;
  }
  return (sample = timed(w, h, [px], [0]));
}

// Unpacked pictures by their packed text, the one used last at the end. Every picture of a show
// stays unpacked (seven Picture effects running or previewed must not unpack again every frame,
// about 80 ms a frame), up to `PIC_CACHE.bytes` of frames and text together; past that the one
// used longest ago goes. The biggest picture the format allows is 160 x 120 x 3 bytes x 64 frames
// = 3.7 MB, so 64 MB holds 17 of those, or about a thousand stills.
export const PIC_CACHE = { bytes: 64 * 1024 * 1024, entries: 256 };
const pics = new Map<string, Picture | null>();
let picBytes = 0;
const costOf = (key: string, pic: Picture | null) => key.length + (pic ? pic.w * pic.h * 3 * pic.frames.length : 0);
const picOf = new WeakMap<EffectParams, Picture | null>();
// Unpacked once per distinct picture, looked up once per effect and frame.
export function pictureOf(p: EffectParams): Picture | null {
  let pic = picOf.get(p);
  if (pic !== undefined) return pic;
  if (!p.picture) pic = samplePicture();
  else {
    const key = p.picture;
    pic = pics.get(key);
    if (pic !== undefined) { pics.delete(key); pics.set(key, pic); }      // used now: to the end
    else {
      try { pic = unpackPicture(key); } catch { pic = null; }
      pics.set(key, pic);
      picBytes += costOf(key, pic);
      // the ones used longest ago go first (never the one just made)
      for (const [k, old] of pics) {
        if ((picBytes <= PIC_CACHE.bytes && pics.size <= PIC_CACHE.entries) || k === key) break;
        pics.delete(k); picBytes -= costOf(k, old);
      }
    }
  }
  picOf.set(p, pic);
  return pic;
}
// How much the unpacked pictures take now (bytes), and how many there are.
export const pictureCache = () => ({ bytes: picBytes, count: pics.size });

// Which frame is on at `ms` into the animation.
function frameAt(pic: Picture, ms: number): number {
  let lo = 0, hi = pic.ends.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (pic.ends[mid] > ms) hi = mid; else lo = mid + 1; }
  return lo;
}

// The colour at (cx, cy) in pixels, between the four pixels around it. `wrap`: the last row runs
// on into the first (a picture scrolling round and round).
const S = [0, 0, 0];
export function sampleAt(pic: Picture, f: number, cx: number, cy: number, wrap: boolean, out = S): number[] {
  const { w, h } = pic, px = pic.frames[f] ?? pic.frames[0];
  cx = cx > 0 ? (cx < w - 1 ? cx : w - 1) : 0;                         // (NaN: the first column)
  const x0 = Math.floor(cx), x1 = Math.min(w - 1, x0 + 1), fx = cx - x0;
  let y0: number, y1: number, fy: number;
  if (wrap) { let y = ((cy % h) + h) % h; if (!(y >= 0 && y < h)) y = 0; y0 = Math.floor(y); fy = y - y0; y1 = (y0 + 1) % h; }
  else { const y = cy > 0 ? (cy < h - 1 ? cy : h - 1) : 0; y0 = Math.floor(y); fy = y - y0; y1 = Math.min(h - 1, y0 + 1); }
  const a = (y0 * w + x0) * 3, b = (y0 * w + x1) * 3, c = (y1 * w + x0) * 3, d = (y1 * w + x1) * 3;
  for (let k = 0; k < 3; k++) {
    const top = px[a + k] + (px[b + k] - px[a + k]) * fx, bottom = px[c + k] + (px[d + k] - px[c + k]) * fx;
    out[k] = (top + (bottom - top) * fy) / 255;
  }
  return out;
}

// Where an element looks in the picture. `line`: the lights are one line across the picture's
// width; a still picture scrolls through them one row per moment (a whole pass per round), an
// animation plays its frames on its middle row. `wall`: one picture row per light of the group,
// columns along each light. `auto`: a wall when the group is several lights with pixels each.
export function placeOf(pic: Picture, e: { x: number; u: number; row: number; rows: number; m: number; total: number }, p: EffectParams): { f: number; cx: number; cy: number; wrap: boolean } {
  const r = frac(e.total), there = p.direction === 'bounce' ? tri(r) : r;
  const anim = pic.frames.length > 1;
  const f = anim ? frameAt(pic, there * pic.total) : 0;
  const wall = p.mapping === 'wall' || (p.mapping !== 'line' && e.rows > 1 && e.m > e.rows);
  if (wall) return { f, cx: e.u * (pic.w - 1), cy: e.rows > 1 ? e.row / (e.rows - 1) * (pic.h - 1) : (pic.h - 1) / 2, wrap: false };
  const cx = e.x * (pic.w - 1);
  if (anim) return { f, cx, cy: (pic.h - 1) / 2, wrap: false };
  if (p.direction === 'bounce') return { f, cx, cy: there * (pic.h - 1), wrap: false };
  return { f, cx, cy: r * pic.h, wrap: true };
}

const picture: EffectDef = {
  id: 'picture', name: 'Picture', category: 'pixel', noColors: true,
  blurb: 'A picture or an animated GIF on your lights: it scrolls through a strip, or shows on a wall of bars.',
  defaults: { speed: 8, tempo: false, mapping: 'auto' },
  run: (e, p) => {
    const pic = pictureOf(p);
    if (!pic) return { intensity: 0 };
    const at = placeOf(pic, e, p);
    const c = sampleAt(pic, at.f, at.cx, at.cy, at.wrap);
    return lit(c[0], c[1], c[2], p);
  },
};

export const CUSTOM_EFFECTS: EffectDef[] = [formula, picture];
