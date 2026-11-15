// More shows for a matrix (and a disc, which has a grid too): ten with your words, from the five by
// seven font of Scrolling text (shapes.ts), and ten pictures. Like every effect, each one is worked out
// from where the LED is and when, nothing kept from one frame to the next; what's the same for every
// LED of a frame (where the snake's tail is, the lightning's path, which dots of a word are lit) is
// worked out once for that moment.
//
// The grid: gx across from the left, gy up from the bottom, gw x gh LEDs (Elem). The words: a word
// at a time where they come one by one, all of them where they type or scroll; a word too wide for
// the picture at the smallest size slides across while it's up.
import type { Color } from '../model/types';
import {
  PALETTES, TAU, WHITE, along, c, clamp01, frac, hash, noise, shine,
  type EffectDef, type EffectParams, type Elem, type FxOut,
} from './fxkit';
import { glyph, plainText } from './font';

const { sin, cos, exp, floor, round, min, max, abs, hypot, PI } = Math;
const ss = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- one LED's light, added up

let R = 0, G = 0, B = 0;
const start = () => { R = 0; G = 0; B = 0; };
const add = (col: Color, v: number) => { if (v > 0) { R += col.r * v; G += col.g * v; B += col.b * v; } };
const DARK: Color = { r: 0, g: 0, b: 0 };
const done = (p: EffectParams): FxOut => shine(min(1, R), min(1, G), min(1, B), p, DARK);
const pal = (p: EffectParams, i: number): Color => p.colors[((i % p.colors.length) + p.colors.length) % p.colors.length] ?? WHITE;

// where a light of the group is in its time (one light shifted against the next by Spread)
const rounds = (e: Elem, p: EffectParams) => e.total + p.spread * e.row / max(1, e.rows);
const gridW = (e: Elem) => max(1, e.gw), gridH = (e: Elem) => max(1, e.gh);

// ---------------------------------------------------------------- words

interface Word { cols: number[]; letters: number[] }       // its columns; which letter each column is
const wordCache = new Map<string, { words: Word[]; letters: number[][]; plain: string }>();
function wordsOf(text: string) {
  const key = text || 'LUXDMX';
  let w = wordCache.get(key);
  if (w) return w;
  const plain = plainText(key).trim() || 'LUXDMX';
  const words: Word[] = [], letters: number[][] = [];
  for (const part of plain.split(/\s+/).filter(Boolean)) {
    const cols: number[] = [], who: number[] = [];
    [...part].forEach((ch, k) => { const g = glyph(ch); if (k) { cols.push(0); who.push(-1); } cols.push(...g); who.push(k, k, k, k, k); letters.push(g); });
    words.push({ cols, letters: who });
  }
  w = { words, letters, plain };
  if (wordCache.size > 40) wordCache.clear();
  wordCache.set(key, w);
  return w;
}
// Is a font dot on: column cx (0 left), row ry (0 at the top)?
const dotOf = (cols: ArrayLike<number>, cx: number, ry: number) => cx >= 0 && cx < cols.length && ry >= 0 && ry < 7 && ((cols[cx] >> ry) & 1) === 1;
// A word placed on the grid: dots `s` LEDs big, centred; a word wider than the picture at the
// smallest size slides from its start to its end over `slide` (0..1).
// A word that doesn't fit with a gap between its letters goes without them ("LUXDMX" on a 32 wide
// banner: 35 columns with, 30 without); `pitch`: how many columns a letter takes then.
interface Placed { cols: number[]; pitch: number; s: number; x0: number; top: number }
const tightOf = new Map<number[], number[]>();
function placed(given: number[], W: number, H: number, slide = 0.5): Placed {
  let cols = given, pitch = 6;
  if (given.length > W && given.length - floor((given.length + 1) / 6) <= W) {
    cols = tightOf.get(given) ?? given.filter((_, k) => k % 6 !== 5);
    if (tightOf.size > 60) tightOf.clear();
    tightOf.set(given, cols); pitch = 5;
  }
  const s = max(1, floor(min(H / 7, W / max(1, cols.length))));
  const wide = cols.length * s, over = max(0, wide - W);
  const x0 = over ? -round(over * clamp01(slide)) : floor((W - wide) / 2);
  const top = floor((H - 7 * s) / 2) + 7 * s - 1;          // (the grid row of the font's top row)
  return { cols, pitch, s, x0, top };
}
// the font column under LED (x, y) of a placed word if its dot is on, or -1
function wordDot(at: Placed, x: number, y: number) {
  const cx = floor((x - at.x0) / at.s), ry = floor((at.top - y) / at.s);
  return dotOf(at.cols, cx, ry) ? cx : -1;
}

// Letter zoom: each letter in turn grows out of the middle to fill the picture, stays a moment, and
// flies past you. A letter a round (with the tempo: two beats each).
function letterZoom(e: Elem, p: EffectParams): FxOut {
  const { letters } = wordsOf(p.text), W = gridW(e), H = gridH(e), t = rounds(e, p);
  const i = floor(t), f = t - i, g = letters[((i % letters.length) + letters.length) % letters.length];
  const fit = min((H * 0.94) / 7, (W * 0.94) / 5);
  const k = f < 0.35 ? ss(0, 0.35, f) : f < 0.72 ? 1 + 0.04 * sin(TAU * (f - 0.35) * 2.7) : 1 + 2.6 * ss(0.72, 1, f) ** 1.6;
  const sc = fit * k, fade = 1 - ss(0.82, 1, f);
  start();
  if (sc > 0.08) {
    const lx = floor((e.gx - (W - 1) / 2) / sc + 2.5), ly = floor(((H - 1) / 2 - e.gy) / sc + 3.5);
    if (dotOf(g, lx, ly)) add(along(p.colors, i / max(1, letters.length) * 0.999), fade);
  }
  return done(p);
}

// Typewriter: the words typed a letter at a time with a blinking cursor, a line at a time; a full
// line stays a moment, then the next one. Speed: seconds per letter.
interface Page { text: string; cols: number[] }
const pageCache = new Map<string, { pages: Page[]; starts: number[]; total: number }>();
const HOLD = 6, BLANK = 1.5;
function pagesOf(text: string, perLine: number) {
  const key = `${text}|${perLine}`;
  let got = pageCache.get(key);
  if (got) return got;
  const { plain } = wordsOf(text), lines: string[] = [];
  let line = '';
  for (let word of plain.split(/\s+/).filter(Boolean)) {
    while (word.length > perLine) { if (line) { lines.push(line); line = ''; } lines.push(word.slice(0, perLine)); word = word.slice(perLine); }
    if (!word) continue;
    if (!line) line = word; else if (line.length + 1 + word.length <= perLine) line += ` ${word}`; else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  const pages = lines.map((l) => { const cols: number[] = []; [...l].forEach((ch, k) => { if (k) cols.push(0); cols.push(...glyph(ch)); }); return { text: l, cols }; });
  const starts: number[] = [];
  let total = 0;
  for (const pg of pages) { starts.push(total); total += pg.text.length + HOLD + BLANK; }
  got = { pages, starts, total: max(1, total) };
  if (pageCache.size > 40) pageCache.clear();
  pageCache.set(key, got);
  return got;
}
function lineAt(e: Elem, p: EffectParams) {
  const W = gridW(e), H = gridH(e), s = max(1, floor(H / 7)), perLine = max(1, floor((W + s) / (6 * s)));
  const pg = pagesOf(p.text, perLine), t = ((rounds(e, p) % pg.total) + pg.total) % pg.total;
  let k = 0;
  while (k + 1 < pg.starts.length && pg.starts[k + 1] <= t) k++;
  const page = pg.pages[k], local = t - pg.starts[k];
  const wide = page.text.length * 6 * s - s, x0 = max(0, floor((W - min(W, wide)) / 2)), top = floor((H - 7 * s) / 2) + 7 * s - 1;
  return { page, local, s, x0, top, k };
}
function typewriter(e: Elem, p: EffectParams): FxOut {
  const { page, local, s, x0, top } = lineAt(e, p), n = page.text.length, typed = min(n, floor(local));
  start();
  if (local < n + HOLD) {
    const cx = floor((e.gx - x0) / s), ry = floor((top - e.gy) / s), ch = floor(cx / 6);
    if (ch < typed && cx % 6 < 5 && dotOf(page.cols, cx, ry)) add(pal(p, 0), 1);
    // the cursor: a block where the next letter goes, blinking (still while it types)
    const blink = local < n ? 1 : frac(local * 1.2) < 0.55 ? 1 : 0;
    if (ch === typed && cx >= 0 && cx % 6 < 5 && ry >= 6 && ry < 7 && blink) add(pal(p, 1), 0.9);
  }
  return done(p);
}

// Wavy text: the words scrolling across, every column bobbing on a wave.
function wavyText(e: Elem, p: EffectParams): FxOut {
  const { plain } = wordsOf(p.text), W = gridW(e), H = gridH(e);
  // (letters as big as leave room for the wave: on a 16 high matrix 7 high, swinging two up and down)
  const amp = max(1, round(H * 0.12)), cols = colsOfLine(plain), bl = max(1, floor((H - 2 * amp) / 7)), width = cols.length * bl + W, t = rounds(e, p);
  const q = (((e.gx + floor(t * 14) - W) % width) + width) % width, col = floor(q / bl);
  const dy = round(amp * sin(TAU * (col * 0.07 - t * 0.6)));
  start();
  if (col < cols.length) {
    const top = floor((H - 7 * bl) / 2) + 7 * bl - 1 + dy, ry = floor((top - e.gy) / bl);
    if (dotOf(cols, col, ry)) add(along(p.colors, frac(col / 40 - t * 0.1)), 1);
  }
  return done(p);
}
const lineCache = new Map<string, number[]>();
function colsOfLine(plain: string) {
  let cols = lineCache.get(plain);
  if (cols) return cols;
  cols = [];
  for (const ch of plain) cols.push(...glyph(ch), 0);
  if (lineCache.size > 40) lineCache.clear();
  lineCache.set(plain, cols);
  return cols;
}

// Falling letters: a line's letters drop in one after the other and bounce into place, stay a
// moment, then all fall out at the bottom. Speed: seconds per round of four letters.
const bounceOut = (x: number) => {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};
const dropCache = new Map<string, { pages: Page[]; starts: number[]; total: number }>();
function fallingLetters(e: Elem, p: EffectParams): FxOut {
  const W = gridW(e), H = gridH(e), s = max(1, floor(H / 7)), perLine = max(1, floor((W + s) / (6 * s)));
  const key = `${p.text}|${perLine}`;
  let pg = dropCache.get(key);
  if (!pg) {
    const base = pagesOf(p.text, perLine), starts: number[] = [];
    let total = 0;
    for (const page of base.pages) { starts.push(total); total += page.text.length * 0.5 + 0.7 + 3 + 1.2; }
    pg = { pages: base.pages, starts, total: max(1, total) };
    if (dropCache.size > 40) dropCache.clear();
    dropCache.set(key, pg);
  }
  const t = (((rounds(e, p) * 4) % pg.total) + pg.total) % pg.total;
  let k = 0;
  while (k + 1 < pg.starts.length && pg.starts[k + 1] <= t) k++;
  const page = pg.pages[k], local = t - pg.starts[k], n = page.text.length;
  const wide = n * 6 * s - s, x0 = max(0, floor((W - min(W, wide)) / 2)), top = floor((H - 7 * s) / 2) + 7 * s - 1;
  const cx = floor((e.gx - x0) / s), ch = floor(cx / 6), away = local - (n * 0.5 + 0.7 + 3);
  start();
  if (cx >= 0 && cx % 6 < 5 && ch < n && page.text[ch] !== ' ') {
    const since = local - ch * 0.5;
    if (since > 0) {
      // (from above the picture onto its place, bouncing; at the end down and out, faster and faster)
      const lift = since < 0.7 ? (1 - bounceOut(since / 0.7)) * (H + 7 * s) : 0;
      const sink = away > 0 ? (away / 1.2) ** 2 * (H + 7 * s) * (0.8 + 0.4 * hash(ch, 7)) : 0;
      const ry = floor((top + round(lift - sink) - e.gy) / s);
      if (dotOf(page.cols, cx, ry)) add(along(p.colors, ch / max(1, n)), 1);
    }
  }
  return done(p);
}

// Word flip: a word at a time; at the change the word flips over like a sign turned on its axis.
function wordFlip(e: Elem, p: EffectParams): FxOut {
  const { words } = wordsOf(p.text), W = gridW(e), H = gridH(e), t = rounds(e, p);
  // (the flip in the last fifth of a round: squashed to a line half way, the next word unfolding)
  const i = floor(t), f = t - i, flip = ss(0.8, 1, f), next = flip > 0.5;
  const w = words[(((next ? i + 1 : i) % words.length) + words.length) % words.length];
  const at = placed(w.cols, W, H, next ? 0 : f / 0.8), sy = abs(cos(PI * flip));
  start();
  if (sy > 0.06) {
    const mid = at.top - (7 * at.s - 1) / 2, y = mid + (e.gy - mid) / sy;
    if (wordDot(at, e.gx, round(y)) >= 0) add(pal(p, next ? i + 1 : i), 0.35 + 0.65 * sy);
  }
  return done(p);
}

// Glitch text: the word sits there, and now and then it breaks: rows shift, the colours split, noise.
function glitchText(e: Elem, p: EffectParams): FxOut {
  const { words } = wordsOf(p.text), W = gridW(e), H = gridH(e), t = rounds(e, p);
  const i = floor(t), w = words[((i % words.length) + words.length) % words.length], at = placed(w.cols, W, H, frac(t));
  const slot = floor(t * 10), bad = hash(slot, 91) < 0.32, band = floor(e.gy / max(1, floor(H / 4)));
  const shift = bad && hash(slot, band, 5) < 0.5 ? round((hash(slot, band, 7) - 0.5) * 6) : 0;
  const split = bad ? 1 + floor(hash(slot, 13) * 2) : 0, x = e.gx - shift;
  start();
  if (split) {
    if (wordDot(at, x - split, e.gy) >= 0) add({ r: 1, g: 0.05, b: 0.2 }, 1);
    if (wordDot(at, x + split, e.gy) >= 0) add({ r: 0, g: 0.9, b: 1 }, 1);
    if (hash(slot, e.gx, e.gy) < 0.05) add(WHITE, 0.6);
  } else if (wordDot(at, x, e.gy) >= 0) add(pal(p, i), 1);
  return done(p);
}

// Word flash: a word on every beat, hit bright and a little big, settling and fading till the next.
function wordFlash(e: Elem, p: EffectParams): FxOut {
  const { words } = wordsOf(p.text), W = gridW(e), H = gridH(e), t = rounds(e, p);
  const i = floor(t), f = t - i, w = words[((i % words.length) + words.length) % words.length];
  const at = placed(w.cols, W, H, f), punch = 1.18 - 0.18 * ss(0, 0.25, f);
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  start();
  if (wordDot(at, round(cx + (e.gx - cx) / punch), round(cy + (e.gy - cy) / punch)) >= 0) add(pal(p, i), 0.15 + 0.85 * exp(-f * 2.4));
  return done(p);
}

// Sparkle text: the word comes together out of sparks, dot by dot, stays, and goes the same way;
// a few stars twinkle round it.
function sparkleText(e: Elem, p: EffectParams): FxOut {
  const { words } = wordsOf(p.text), W = gridW(e), H = gridH(e), t = rounds(e, p);
  const i = floor(t), f = t - i, w = words[((i % words.length) + words.length) % words.length], at = placed(w.cols, W, H, f);
  start();
  if (wordDot(at, e.gx, e.gy) >= 0) {
    const on = 0.05 + 0.35 * hash(e.gx, e.gy, i * 3 + 1), off = 0.72 + 0.22 * hash(e.gx, e.gy, i * 3 + 2);
    if (f >= on && f < off) {
      add(pal(p, i), 0.85);
      add(WHITE, exp(-(f - on) * 40) + exp(-(off - f) * 40));
    }
  } else if (hash(e.gx, e.gy, floor(t * 6)) < 0.025) add(WHITE, 0.25 * sin(PI * frac(t * 6)));
  return done(p);
}

// Spinning sign: the word turning round on its axis, the back of the sign in the second colour;
// the next word on the next turn.
function spinText(e: Elem, p: EffectParams): FxOut {
  const { words } = wordsOf(p.text), W = gridW(e), H = gridH(e), t = rounds(e, p);
  const i = floor(t), f = t - i;
  // (it rests facing you, then turns: the first half of a round still, the second a full turn)
  const a = TAU * ss(0.45, 1, f), sx = cos(a), w = words[((i % words.length) + words.length) % words.length], at = placed(w.cols, W, H, 0.5);
  const cx = (W - 1) / 2;
  start();
  if (abs(sx) > 0.08) {
    const x = round(cx + (e.gx - cx) / sx);
    if (wordDot(at, x, e.gy) >= 0) add(sx > 0 ? pal(p, 0) : pal(p, 1), 0.3 + 0.7 * abs(sx));
  }
  return done(p);
}

// Neon sign: the words as glass tubes with their glow round them; switched on with a stutter, and
// every so often one letter buzzes.
const neonCache = new Map<string, { lit: Uint8Array; who: Int16Array; glow: Float32Array; W: number; letters: number }>();
function neonText(e: Elem, p: EffectParams): FxOut {
  const W = gridW(e), H = gridH(e), { plain, words } = wordsOf(p.text);
  // (the whole text when it fits, else its first word)
  const all = colsOfLine(plain).slice(0, -1), cols = placed(all, W, H).cols.length <= W ? all : words[0].cols;
  const key = `${p.text}|${W}|${H}`;
  let n = neonCache.get(key);
  if (!n) {
    const at = placed(cols, W, H), lit = new Uint8Array(W * H), who = new Int16Array(W * H).fill(-1), glow = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const cx = wordDot(at, x, y); if (cx >= 0) { lit[y * W + x] = 1; who[y * W + x] = floor(cx / at.pitch); } }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let g = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && lit[Y * W + X]) g = max(g, exp(-(dx * dx + dy * dy) / 1.6)); }
      glow[y * W + x] = g;
    }
    n = { lit, who, glow, W, letters: Math.ceil(at.cols.length / at.pitch) };
    if (neonCache.size > 20) neonCache.clear();
    neonCache.set(key, n);
  }
  const t = rounds(e, p), r = floor(t), f = t - r, at = e.gy * W + e.gx;
  if (e.gx >= W || e.gy >= H) return shine(0, 0, 0, p, DARK);
  // switching on: a stutter in the first tenth of a round; then a hum; one letter buzzing a while
  const power = f < 0.1 ? (hash(floor(f * 120), r, 3) < 0.55 ? 1 : 0.1) : 0.92 + 0.08 * noise(r * 7 + 1, t * 40);
  const buzzing = n.who[at] >= 0 && n.who[at] === floor(hash(r, 17) * n.letters) && f > 0.55 && f < 0.7 && hash(floor(t * 60), 29) < 0.5;
  start();
  const col = along(p.colors, frac((n.who[at] >= 0 ? n.who[at] : floor(e.gx / 6)) / max(1, n.letters)));
  if (n.lit[at]) { add(col, buzzing ? 0.12 : power); add(WHITE, buzzing ? 0 : 0.25 * power); }
  else add(col, 0.3 * n.glow[at] * power);
  return done(p);
}

// ---------------------------------------------------------------- pictures

// Snake: a snake winding about the picture, its tail fading, a dot to catch blinking ahead of it.
const snakeAt = (t: number, W: number, H: number): [number, number] =>
  [(W - 1) / 2 * (1 + 0.9 * sin(t * 1.13) * cos(t * 0.37 + 0.5)), (H - 1) / 2 * (1 + 0.9 * sin(t * 0.89 + 1.1) * cos(t * 0.29))];
let snakeKey = '', snakeTail: [number, number][] = [];
function snake(e: Elem, p: EffectParams): FxOut {
  const W = gridW(e), H = gridH(e), t = rounds(e, p) * 3, len = round(5 + clamp01(p.size) * 30), key = `${t}|${W}|${H}|${len}`;
  if (key !== snakeKey) {
    snakeKey = key; snakeTail = [];
    // (the tail one LED apart along where the head has been)
    const step = 0.9 / max(1, (W + H) * 0.5);
    for (let k = 0; k < len; k++) snakeTail.push(snakeAt(t - k * step * 2.2, W, H));
  }
  start();
  for (let k = 0; k < snakeTail.length; k++) {
    const [x, y] = snakeTail[k], d = hypot(e.gx - x, e.gy - y);
    if (d < 0.75) { add(along(p.colors, k / snakeTail.length), (1 - d / 0.75) * (k === 0 ? 1 : 0.6 * (1 - k / snakeTail.length) + 0.4)); }
  }
  const [fx, fy] = snakeAt(t + 1.4, W, H);
  if (round(fx) === e.gx && round(fy) === e.gy && frac(t * 1.5) < 0.6) add(WHITE, 0.9);
  return done(p);
}

// Double helix: two strands winding round each other across the picture, rungs between them; the
// strand in front brighter. Size: how many turns fit across.
function dnaHelix(e: Elem, p: EffectParams): FxOut {
  const W = gridW(e), H = gridH(e), t = rounds(e, p), turns = 0.6 + clamp01(p.size) * 2.4;
  const ph = TAU * (e.gx / max(1, W) * turns - t), amp = (H - 1) / 2 * 0.82, mid = (H - 1) / 2;
  const y1 = mid + amp * sin(ph), y2 = mid - amp * sin(ph), front = cos(ph);
  start();
  add(pal(p, 0), clamp01(1 - abs(e.gy - y1) / 0.7) * (0.45 + 0.55 * (front > 0 ? 1 : 0.3)));
  add(pal(p, 1), clamp01(1 - abs(e.gy - y2) / 0.7) * (0.45 + 0.55 * (front < 0 ? 1 : 0.3)));
  if (e.gx % 3 === 0 && e.gy > min(y1, y2) + 0.6 && e.gy < max(y1, y2) - 0.6) add(WHITE, 0.18);
  return done(p);
}

// Confetti fall: coloured flakes tumbling down, fluttering side to side.
function confettiFall(e: Elem, p: EffectParams): FxOut {
  const H = gridH(e), t = rounds(e, p) * 4;
  start();
  for (let lane = e.gx - 1; lane <= e.gx + 1; lane++) for (let k = 0; k < 2; k++) {
    const h = hash(lane, k, 41), v = 0.5 + hash(lane, k, 43);
    const y = H + 1 - frac(t * v / (H + 3) * 3 + h) * (H + 3), x = lane + round(0.9 * sin(t * 2.1 + h * TAU));
    if (x === e.gx && abs(e.gy - y) < 0.6) add(pal(p, floor(hash(lane, k, 47) * 97)), 0.45 + 0.55 * abs(sin(t * 7 + h * 9)));
  }
  return done(p);
}

// Snowfall: soft flakes drifting down, the snow settling at the bottom, melting away at the end of
// the round. Size: how deep it gets.
function snowfall(e: Elem, p: EffectParams): FxOut {
  const H = gridH(e), r = rounds(e, p), f = r - floor(r), t = r * 20;
  const depth = (ss(0.05, 0.85, f) - ss(0.9, 1, f)) * H * (0.1 + 0.3 * clamp01(p.size)) * (0.75 + 0.5 * noise(e.gx + 11, 0.4 * e.gx));
  start();
  // (a row is snow when the snow is over its middle: a thin layer is none, melting goes all the way)
  if (e.gy + 0.5 < depth) add(pal(p, 0), 0.55 + 0.25 * (depth - e.gy > 1.5 ? 0 : 1));
  for (let lane = e.gx - 2; lane <= e.gx + 2; lane++) {
    const h = hash(lane, 61), v = 0.25 + 0.3 * hash(lane, 63);
    const y = H + 1 - frac(t * v / (H + 3) + h) * (H + 3), x = lane + 1.4 * sin(t * 0.7 + h * TAU);
    const d = hypot(e.gx - x, (e.gy - y) * 1.2);
    if (d < 1 && y > depth - 0.5) add(WHITE, min(1, (1 - d) * 1.6));
  }
  return done(p);
}

// Lightning storm: clouds rolling along the top, and now and then a bolt to the ground and the sky
// lit up with it.
let boltKey = '', boltX: number[] = [];
function lightningStorm(e: Elem, p: EffectParams): FxOut {
  const W = gridW(e), H = gridH(e), t = rounds(e, p) * 4, slot = floor(t), f = t - slot;
  const strikes = hash(slot, 71) < 0.7, when = 0.1 + 0.5 * hash(slot, 73), since = f - when;
  const flash = strikes && since > 0 && since < 0.22 ? (since < 0.06 || (since > 0.1 && since < 0.16) ? 1 : 0.35) : 0;
  const key = `${slot}|${W}|${H}`;
  if (flash && key !== boltKey) {
    boltKey = key; boltX = new Array(H);
    let x = floor(hash(slot, 79) * W);
    for (let y = H - 1; y >= 0; y--) { boltX[y] = x; x = max(0, min(W - 1, x + floor(hash(slot, y, 83) * 3) - 1)); }
  }
  // (the clouds over the top half, thicker higher up, rolling; lit from inside by a flash)
  const up = clamp01((e.gy - H * 0.45) / (H * 0.55)), cloud = up * (0.2 + 0.5 * noise(floor(e.gx * 0.5) + 5, t * 0.35 + e.gy * 0.15));
  start();
  add(pal(p, 0), cloud * (1 + 1.5 * flash) + 0.12 * flash);
  if (flash && boltX[e.gy] === e.gx) add(WHITE, flash);
  return done(p);
}

// Rising hearts: little hearts floating up and swaying, fading towards the top.
const HEART = [0b01010, 0b11111, 0b11111, 0b01110, 0b00100];   // (rows from the top, five wide)
function risingHearts(e: Elem, p: EffectParams): FxOut {
  const W = gridW(e), H = gridH(e), t = rounds(e, p) * 3, lanes = max(1, floor(W / 6));
  start();
  for (let l = 0; l < lanes; l++) for (let k = 0; k < 2; k++) {
    const h = hash(l, k, 101), v = 0.6 + 0.6 * hash(l, k, 103);
    const y0 = -6 + frac(t * v / (H + 6) + h + k * 0.5) * (H + 6), x0 = round(l * (W / lanes) + (W / lanes - 5) / 2 + 1.2 * sin(t * 1.3 + h * TAU));
    const cx = e.gx - x0, ry = round(y0 + 4) - e.gy;
    if (cx >= 0 && cx < 5 && ry >= 0 && ry < 5 && (HEART[ry] >> (4 - cx)) & 1) add(pal(p, l + k), 1 - ss(0.65, 1, y0 / max(1, H)));
  }
  return done(p);
}

// Vortex: colours swirling into the middle. Size: how tightly it's wound.
function vortex(e: Elem, p: EffectParams): FxOut {
  const t = rounds(e, p), twist = 1 + clamp01(p.size) * 5;
  const v = 0.5 + 0.5 * cos(TAU * (3 * e.ang + twist * e.rad + t));
  start();
  add(along(p.colors, frac(e.rad * 1.3 + t * 0.5)), (0.15 + 0.85 * v * v) * (0.35 + 0.65 * clamp01(e.rad * 1.4)));
  return done(p);
}

// Beat wipes: on every beat the next colour wipes over the picture, from a side, the top, the
// bottom or out of the middle, a different way each time.
function beatWipes(e: Elem, p: EffectParams): FxOut {
  const W = gridW(e), H = gridH(e), t = rounds(e, p), k = floor(t), f = t - k, way = floor(hash(k, 111) * 6);
  const x = e.gx / max(1, W - 1), y = e.gy / max(1, H - 1);
  const u = way === 0 ? x : way === 1 ? 1 - x : way === 2 ? y : way === 3 ? 1 - y : way === 4 ? clamp01(e.rad) : (x + y) / 2;
  const edge = ss(0, 0.45, f) * 1.15;
  // (brightest at the wipe's edge, a little less away from it: the way it goes shows in the light)
  start();
  add(u < edge ? pal(p, k) : pal(p, k - 1), 0.7 + 0.3 * cos(PI * clamp01(abs(u - edge))));
  return done(p);
}

// Block strobe: on every beat some squares of the picture flash white and die away. Size: how big
// the squares are.
function blockStrobe(e: Elem, p: EffectParams): FxOut {
  const t = rounds(e, p), k = floor(t), f = t - k, T = max(1, round(1 + clamp01(p.size) * 5));
  const on = hash(floor(e.gx / T), floor(e.gy / T), k * 7 + 3) < 0.3;
  start();
  if (on) add(pal(p, k), exp(-f * 6));
  return done(p);
}

// Rotozoom: a chequered floor turning and zooming in and out, the old demo trick.
function rotoZoom(e: Elem, p: EffectParams): FxOut {
  // (tiles a few LEDs big, two colours of the palette drifting through it: a floor, not noise)
  const t = rounds(e, p) * TAU, a = t * 0.25, z = 0.9 + 0.7 * sin(t * 0.17) + clamp01(p.size) * 1.5;
  const u = (e.sx * cos(a) - e.sy * sin(a)) * z + t * 0.15, v = (e.sx * sin(a) + e.sy * cos(a)) * z;
  const on = ((floor(u * 1.2) + floor(v * 1.2)) & 1) === 0, hue = frac(t * 0.02);
  start();
  add(along(p.colors, on ? hue : frac(hue + 0.5)), on ? 1 : 0.35);
  return done(p);
}

// ---------------------------------------------------------------- the list

const WORDS = new Set(['letterZoom', 'typewriter', 'wavyText', 'fallingLetters', 'wordFlip', 'glitchText', 'wordFlash', 'sparkleText', 'spinText', 'neonText']);
const fx = (id: string, name: string, blurb: string, run: EffectDef['run'], defaults: EffectDef['defaults']): EffectDef =>
  ({ id, name, category: 'pixel', shape: true, blurb, defaults: { tempo: false, spread: 0, ...defaults }, run, ...(WORDS.has(id) ? { noFlip: true } : {}) });
const TERMINAL = ['#40ff70', '#c8ffd0'].map(c), PINKS = ['#ff2d6f', '#ff7aa8', '#ff0040', '#ffb3c8'].map(c);

export const MATRIX_EFFECTS: EffectDef[] = [
  fx('letterZoom', 'Letter zoom', 'Your words a letter at a time: each one grows out of the middle, stays a moment and flies past you.', letterZoom, { speed: 2, tempo: true, text: 'LUXDMX', colors: PALETTES.Rainbow }),
  fx('typewriter', 'Typewriter', 'Your words typed a letter at a time with a blinking cursor, a line at a time. Speed: seconds per letter.', typewriter, { speed: 0.18, text: 'HELLO WORLD', colors: TERMINAL }),
  fx('wavyText', 'Wavy text', 'Your words scrolling across, every letter bobbing on a wave.', wavyText, { speed: 1, text: 'LUXDMX', colors: PALETTES.Rainbow }),
  fx('fallingLetters', 'Falling letters', 'The letters drop in one by one and bounce into place, then the line falls out at the bottom.', fallingLetters, { speed: 2, text: 'LET IT DROP', colors: PALETTES.Party }),
  fx('wordFlip', 'Word flip', 'A word at a time, flipping over like a sign turned on its axis to show the next.', wordFlip, { speed: 2, tempo: true, text: 'ONE TWO THREE FOUR', colors: PALETTES.Neon }),
  fx('glitchText', 'Glitch text', 'Your words, breaking up now and then: rows slip, the colours split, noise.', glitchText, { speed: 3, text: 'LUXDMX', colors: ['#ffffff', '#c0f0ff'].map(c) }),
  fx('wordFlash', 'Word flash', 'A word on every beat, hit bright and big, fading till the next. Made for a chant.', wordFlash, { speed: 1, tempo: true, text: 'PUT YOUR HANDS UP', colors: PALETTES.Party }),
  fx('sparkleText', 'Sparkle text', 'Each word comes together out of sparks dot by dot, stays, and sparkles away again.', sparkleText, { speed: 4, text: 'JUST MARRIED', colors: ['#ffd27a', '#ffffff', '#ffb3c8'].map(c) }),
  fx('spinText', 'Spinning sign', 'A sign with your words turning round on its axis, its back in the second colour.', spinText, { speed: 4, text: 'OPEN', colors: ['#ffb020', '#20a0ff'].map(c) }),
  fx('neonText', 'Neon sign', 'Your words as glowing glass tubes: switched on with a stutter, a letter buzzing now and then.', neonText, { speed: 8, text: 'BAR', colors: ['#ff2d95', '#29e6ff'].map(c) }),
  fx('snake', 'Snake', 'A snake winding about the picture after a blinking dot. Size: how long it is.', snake, { speed: 4, size: 0.4, colors: ['#60ff60', '#20c040'].map(c) }),
  fx('dnaHelix', 'Double helix', 'Two strands winding round each other with rungs between, the one in front brighter. Size: how many turns.', dnaHelix, { speed: 4, size: 0.4, colors: ['#29b6ff', '#ff3d8b'].map(c) }),
  fx('confettiFall', 'Confetti fall', 'Coloured flakes tumbling down and fluttering side to side.', confettiFall, { speed: 6, colors: PALETTES.Party }),
  fx('snowfall', 'Snowfall', 'Snow drifting down and settling at the bottom, melting away at the end of the round. Size: how deep.', snowfall, { speed: 40, size: 0.5, colors: ['#cfe6ff'].map(c) }),
  fx('lightningStorm', 'Lightning storm', 'Clouds rolling along the top, a bolt to the ground now and then, the sky lighting up with it.', lightningStorm, { speed: 6, colors: ['#7f8fd0'].map(c) }),
  fx('risingHearts', 'Rising hearts', 'Little hearts floating up and swaying, fading towards the top.', risingHearts, { speed: 6, colors: PINKS }),
  fx('vortex', 'Vortex', 'Colours swirling into the middle. Size: how tightly it is wound.', vortex, { speed: 4, size: 0.4, colors: PALETTES.Neon }),
  fx('beatWipes', 'Beat wipes', 'On every beat the next colour wipes over the picture, from a different side each time.', beatWipes, { speed: 1, tempo: true, colors: PALETTES.Party }),
  fx('blockStrobe', 'Block strobe', 'On every beat some squares flash and die away. Size: how big the squares are.', blockStrobe, { speed: 0.5, tempo: true, size: 0.3, colors: ['#ffffff'].map(c) }),
  fx('rotoZoom', 'Rotozoom', 'A chequered floor turning and zooming in and out, the old demo trick. Size zooms out.', rotoZoom, { speed: 8, size: 0.2, colors: PALETTES.Neon }),
];
