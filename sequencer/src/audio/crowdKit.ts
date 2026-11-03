// The crowd's sounds, made here from noise and simple voices (nothing recorded, nothing to download,
// no rights to clear). A voice is a buzz at its pitch through three resonances (the vowel's
// formants), shaped into syllables or shouts; a whistle is a gliding tone with a little breath. Many of them, spread left and right and put in a
// hall, are a crowd. Pure and seeded: the same kit every time, at any sample rate.
//
// The kit: two seamless loops (people chatting while they wait, a crowd cheering) and one-shots (a
// voice shouting "woo!", "yeah!", "hey!"; whistles) that audio/crowd.ts plays on top as the crowd
// gets going. No applause, no clapping.

export const KIT_RATE = 22050;            // (voices need no more; the browser resamples)
export interface Kit {
  rate: number;
  chatter: Float32Array[];                // [left, right], a loop
  roar: Float32Array[];                   // cheering, a loop
  woos: Float32Array[];                   // one voice shouting (mono)
  whistles: Float32Array[];               // a whistle (mono)
  cheers?: Float32Array[][];              // recorded cheers that swell up and die away (crowdReal.ts)
}
// how loud each loop is (RMS over both sides): the player's gains are set against these
export const LOOP_RMS = { chatter: 0.1, roar: 0.12 };

// a small seeded random source (mulberry32)
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A two-pole filter (the cookbook ones). Coefficients can change while it runs (a vowel gliding).
class Biquad {
  private b0 = 0; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  private set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number) { this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0; return this; }
  bandpass(f: number, q: number, rate: number) {
    const w = (2 * Math.PI * Math.min(f, rate * 0.45)) / rate, al = Math.sin(w) / (2 * q);
    return this.set(al, 0, -al, 1 + al, -2 * Math.cos(w), 1 - al);
  }
  highpass(f: number, q: number, rate: number) {
    const w = (2 * Math.PI * Math.min(f, rate * 0.45)) / rate, al = Math.sin(w) / (2 * q), c = Math.cos(w);
    return this.set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
  }
  lowpass(f: number, q: number, rate: number) {
    const w = (2 * Math.PI * Math.min(f, rate * 0.45)) / rate, al = Math.sin(w) / (2 * q), c = Math.cos(w);
    return this.set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
  }
  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// The vowels' first three formants (Hz, an average man's; a higher voice's are a little higher)
type Vowel = 'a' | 'e' | 'i' | 'o' | 'u' | 'ae';
const VOWELS: Record<Vowel, [number, number, number]> = {
  a: [730, 1090, 2440], e: [530, 1840, 2480], i: [300, 2250, 3000], o: [570, 840, 2410], u: [320, 870, 2240], ae: [660, 1720, 2410],
};
const TALK: Vowel[] = ['a', 'e', 'i', 'o', 'u', 'ae', 'a', 'e'];

// A sound a voice makes: from `t0` for `len` seconds, its pitch over the time (Hz, u from 0 to 1),
// gliding from one vowel to another, this loud, with so much breath in it, rising and falling in
// `attack` and `release` seconds.
interface Note { t0: number; len: number; pitch: (u: number) => number; from: Vowel; to: Vowel; amp: number; breath: number; attack: number; release: number; shift: number }

// One voice into a stereo pair, from its notes (in time order). `far`: a distance lowpass (Hz).
function voice(L: Float32Array, R: Float32Array, rate: number, notes: Note[], pan: number, far: number, noise: Float32Array, seed: number) {
  const f1 = new Biquad(), f2 = new Biquad(), f3 = new Biquad(), dist = new Biquad().lowpass(far, 0.7, rate);
  const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4);
  const STEP = 32, vib = 4.5 + (seed % 7) * 0.4, n = L.length;
  let phase = (seed % 97) / 97, ni = (seed * 7919) % noise.length;
  for (const nt of notes) {
    const s0 = Math.max(0, Math.round(nt.t0 * rate)), s1 = Math.min(n, Math.round((nt.t0 + nt.len) * rate));
    if (s1 <= s0) continue;
    let amp0 = 0;
    for (let c = s0; c < s1; c += STEP) {
      const u = (c - s0) / (s1 - s0), t = (c - s0) / rate, left = (s1 - c) / rate;
      const va = VOWELS[nt.from], vb = VOWELS[nt.to], k = u * u * (3 - 2 * u);
      f1.bandpass((va[0] + (vb[0] - va[0]) * k) * nt.shift, 5, rate);
      f2.bandpass((va[1] + (vb[1] - va[1]) * k) * nt.shift, 9, rate);
      f3.bandpass((va[2] + (vb[2] - va[2]) * k) * nt.shift, 14, rate);
      const f0 = nt.pitch(u) * (1 + 0.012 * Math.sin(2 * Math.PI * vib * (c / rate))), inc = f0 / rate;
      const env = Math.min(1, t / nt.attack, left / nt.release) * (1 - 0.25 * u);
      const amp1 = nt.amp * Math.max(0, env);
      const e = Math.min(s1, c + STEP);
      for (let i = c; i < e; i++) {
        phase += inc; if (phase >= 1) phase -= 1;
        const w = noise[ni]; ni = ni + 1 === noise.length ? 0 : ni + 1;
        const src = (2 * phase - 1) * (1 - nt.breath) + w * nt.breath * 2;
        const y = f1.run(src) + 0.55 * f2.run(src) + 0.25 * f3.run(src);
        const a = amp0 + ((amp1 - amp0) * (i - c)) / STEP;
        const o = dist.run(y * a);
        L[i] += o * gl; R[i] += o * gr;
      }
      amp0 = amp1;
    }
  }
}

// A hall: a few combs and all-passes (Schroeder), the wet part added to what's there (a side at a
// time: a step each)
function* hall(xs: Float32Array[], rate: number, wet: number, size = 1) {
  for (const [k, x] of xs.entries()) { reverb(x, rate, wet, size, k * 23); yield; }
}
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491], ALLS = [556, 441, 341];
function reverb(x: Float32Array, rate: number, wet: number, size: number, spread: number) {
  const sc = rate / 44100, nc = COMBS.length, na = ALLS.length;
  // (one buffer for every delay line, offsets into it: plain typed arrays keep the loop fast)
  const cl = new Int32Array(nc), co = new Int32Array(nc), ci = new Int32Array(nc), cs = new Float64Array(nc);
  const al = new Int32Array(na), ao = new Int32Array(na), ai = new Int32Array(na);
  let total = 0;
  for (let j = 0; j < nc; j++) { cl[j] = Math.max(1, Math.round((COMBS[j] + spread) * sc * size)); co[j] = total; total += cl[j]; }
  for (let j = 0; j < na; j++) { al[j] = Math.max(1, Math.round((ALLS[j] + spread) * sc)); ao[j] = total; total += al[j]; }
  const buf = new Float64Array(total), fb = 0.8 + 0.04 * Math.min(1, size), damp = 0.35, dry = 1 - wet * 0.4;
  for (let i = 0; i < x.length; i++) {
    const inp = x[i] * 0.12;
    let s = 0;
    for (let j = 0; j < nc; j++) {
      const p = co[j] + ci[j], y = buf[p];
      cs[j] = y * (1 - damp) + cs[j] * damp;
      buf[p] = inp + cs[j] * fb;
      if (++ci[j] === cl[j]) ci[j] = 0;
      s += y;
    }
    for (let j = 0; j < na; j++) {
      const p = ao[j] + ai[j], y = buf[p];
      buf[p] = s + y * 0.5;
      if (++ai[j] === al[j]) ai[j] = 0;
      s = y - s;
    }
    x[i] = x[i] * dry + s * wet;
  }
}

// a seamless loop of `len` seconds out of a longer take (its start crossfaded with what follows
// its end, equal power: the two are different people, not the same sound)
function loopOf(x: Float32Array, rate: number, len: number, fade: number) {
  const n = Math.round(len * rate), m = Math.round(fade * rate), out = x.slice(0, n);
  for (let i = 0; i < m; i++) { const p = (i / m) * (Math.PI / 2); out[i] = x[i] * Math.sin(p) + x[i + n] * Math.cos(p); }
  return out;
}
const rms = (xs: Float32Array[]) => { let s = 0, n = 0; for (const x of xs) { for (let i = 0; i < x.length; i++) s += x[i] * x[i]; n += x.length; } return Math.sqrt(s / Math.max(1, n)); };
const peak = (xs: Float32Array[]) => { let p = 0; for (const x of xs) for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i])); return p; };
// to this loudness (RMS), the odd peak rounded off so nothing clips
function level(xs: Float32Array[], target: number, byPeak = false) {
  const g = target / Math.max(1e-9, byPeak ? peak(xs) : rms(xs));
  for (const x of xs) for (let i = 0; i < x.length; i++) { const v = x[i] * g; x[i] = Math.abs(v) < 0.8 ? v : Math.sign(v) * (0.8 + 0.2 * Math.tanh((Math.abs(v) - 0.8) / 0.2)); }
}

// someone's voice: a man's, a woman's (pitch), how far the vowels sit up
function person(r: () => number, shout: boolean) {
  const woman = r() < 0.45;
  const f0 = woman ? (shout ? 290 + r() * 170 : 175 + r() * 70) : (shout ? 160 + r() * 100 : 95 + r() * 50);
  return { f0, shift: woman ? 1.12 + r() * 0.06 : 0.98 + r() * 0.06 };
}
const semis = (s: number) => Math.pow(2, s / 12);

// People talking while they wait: phrases of syllables, pauses between them
function talker(r: () => number, until: number): Note[] {
  const p = person(r, false), notes: Note[] = [];
  let t = -r() * 2;
  while (t < until) {
    const n = 4 + Math.floor(r() * 10), fall = 0.12 + r() * 0.15, rate = 3.6 + r() * 2.4;
    for (let k = 0; k < n && t < until; k++) {
      const len = (0.6 + r() * 0.7) / rate, a = p.f0 * (1 - (fall * k) / n) * (0.94 + r() * 0.12), b = a * (0.93 + r() * 0.12);
      notes.push({ t0: t, len, pitch: (u) => a + (b - a) * u, from: TALK[Math.floor(r() * TALK.length)], to: TALK[Math.floor(r() * TALK.length)],
        amp: 0.5 + r() * 0.5, breath: 0.12, attack: 0.025, release: 0.04, shift: p.shift });
      t += len + (r() < 0.25 ? 0.03 + r() * 0.06 : 0.01);
    }
    t += 0.25 + r() * 1.3;
  }
  return notes;
}
// A shout of joy: "woo" (rising, then falling away), "yeah", "hey", a long "aah"
type Shout = 'woo' | 'yeah' | 'hey' | 'aah';
function shout(r: () => number, kind: Shout, t0: number, f0: number, shift: number, amp: number): Note {
  const up = 2 + r() * 5, down = 4 + r() * 8;
  const len = kind === 'hey' ? 0.35 + r() * 0.3 : kind === 'yeah' ? 0.6 + r() * 0.6 : kind === 'woo' ? 0.8 + r() * 1.4 : 1 + r() * 1.2;
  const pitch = kind === 'hey' ? (u: number) => f0 * semis(up * Math.min(1, u * 3) - 2 * u)
    : (u: number) => f0 * semis(up * Math.sin((Math.PI / 2) * Math.min(1, u / 0.35)) - down * Math.pow(Math.max(0, (u - 0.55) / 0.45), 1.6));
  const [from, to]: [Vowel, Vowel] = kind === 'woo' ? ['u', 'o'] : kind === 'yeah' ? ['i', 'ae'] : kind === 'hey' ? ['e', 'i'] : ['a', 'o'];
  return { t0, len, pitch, from, to, amp, breath: 0.22, attack: kind === 'hey' ? 0.03 : 0.08, release: kind === 'hey' ? 0.08 : 0.25, shift };
}
const SHOUTS: Shout[] = ['woo', 'yeah', 'woo', 'aah', 'hey', 'yeah'];
function shouter(r: () => number, until: number): Note[] {
  const p = person(r, true), notes: Note[] = [];
  let t = -r() * 2.5;
  while (t < until) {
    const n = shout(r, SHOUTS[Math.floor(r() * SHOUTS.length)], t, p.f0 * (0.9 + r() * 0.2), p.shift, 0.4 + r() * 0.6);
    notes.push(n);
    t += n.len + 0.05 + r() * 0.9;
  }
  return notes;
}

// The kit, a step at a time (each step a few milliseconds of work): a worker runs it through, the
// page can run it in slices between frames. The last value is the kit.
export function* kitSteps(rate = KIT_RATE, seed = 7): Generator<undefined, Kit, undefined> {
  const r = rng(seed), noise = new Float32Array(1 << 16);
  for (let i = 0; i < noise.length; i++) noise[i] = r() * 2 - 1;
  const PRE = 1.5, FADE = 1;                        // (a hall filled before the loop starts; the crossfade at its seam)
  const take = (len: number) => { const n = Math.round((PRE + len + FADE) * rate); return [new Float32Array(n), new Float32Array(n)]; };
  const trim = (xs: Float32Array[], len: number) => xs.map((x) => loopOf(x.subarray(Math.round(PRE * rate)), rate, len, FADE));

  // people chatting: a couple of dozen voices, near and far, under a low rumble of the room
  const CH = 8.3, chat = take(CH);
  for (let k = 0; k < 22; k++) {
    voice(chat[0], chat[1], rate, talker(r, PRE + CH + FADE + 1), r() * 1.8 - 0.9, 1400 + r() * 3500, noise, 11 + k * 31);
    yield;
  }
  yield* rumble(chat, rate, r, 0.35, 180, 700);
  yield* hall(chat, rate, 0.55);
  const chatter = trim(chat, CH);
  level(chatter, LOOP_RMS.chatter);
  yield;

  // a crowd cheering: people shouting all over, and the wash of many more further back
  const RO = 9.7, ro = take(RO);
  for (let k = 0; k < 26; k++) {
    voice(ro[0], ro[1], rate, shouter(r, PRE + RO + FADE + 1), r() * 1.9 - 0.95, 1800 + r() * 4000, noise, 101 + k * 37);
    yield;
  }
  yield* rumble(ro, rate, r, 0.9, 350, 2400);
  yield* hall(ro, rate, 0.5);
  const roar = trim(ro, RO);
  level(roar, LOOP_RMS.roar);
  yield;

  // one voice shouting, closer
  const woos: Float32Array[] = [];
  for (let k = 0; k < 8; k++) {
    const n = Math.round(2.6 * rate), x = [new Float32Array(n), new Float32Array(n)], p = person(r, true);
    const kind: Shout = (['woo', 'yeah', 'hey', 'woo', 'yeah', 'aah', 'woo', 'hey'] as Shout[])[k];
    const notes = [shout(r, kind, 0.02, p.f0, p.shift, 1)];
    if (kind === 'woo' && r() < 0.6) notes.push(shout(r, 'woo', notes[0].len + 0.08, p.f0 * 1.1, p.shift, 0.8));     // "woo-hoo"
    if (kind === 'hey') notes.push(shout(r, 'hey', notes[0].len + 0.12, p.f0, p.shift, 0.9));                          // "hey! hey!"
    voice(x[0], x[1], rate, notes, 0, 5500, noise, 503 + k * 13);
    yield* hall(x, rate, 0.3);
    const m = new Float32Array(n);
    for (let i = 0; i < n; i++) m[i] = (x[0][i] + x[1][i]) / 2;
    level([m], 0.7, true);
    woos.push(m);
  }
  yield;

  // whistles: a long one with a wobble, a wolf whistle, short ones
  const whistles: Float32Array[] = [];
  for (let k = 0; k < 5; k++) {
    const n = Math.round(1.7 * rate), x = [new Float32Array(n), new Float32Array(n)];
    whistle(x[0], rate, k % 3, 2300 + r() * 1100, r);
    x[1].set(x[0]);
    yield* hall(x, rate, 0.3);
    const m = new Float32Array(n);
    for (let i = 0; i < n; i++) m[i] = (x[0][i] + x[1][i]) / 2;
    level([m], 0.6, true);
    whistles.push(m);
  }
  return { rate, chatter, roar, woos, whistles };
}
export function makeKit(rate = KIT_RATE, seed = 7): Kit {
  const g = kitSteps(rate, seed);
  for (;;) { const s = g.next(); if (s.done) return s.value; }
}

// the room full of people: pinkish noise in a band, swelling and settling slowly
function* rumble(xs: Float32Array[], rate: number, r: () => number, amount: number, lo: number, hi: number) {
  const ref = rms(xs) || 0.05;
  for (const [ci, x] of xs.entries()) {
    const h = new Biquad().highpass(lo, 0.7, rate), l = new Biquad().lowpass(hi, 0.7, rate);
    const w1 = 0.11 + r() * 0.2, w2 = 0.37 + r() * 0.3, ph = r() * 6, g = ref * amount * 0.5;
    let b0 = 0, b1 = 0, b2 = 0, swell = 0;
    for (let i = 0; i < x.length; i++) {
      if ((i & 63) === 0) { const t = i / rate; swell = g * (0.75 + 0.15 * Math.sin(2 * Math.PI * w1 * t + ph + ci) + 0.1 * Math.sin(2 * Math.PI * w2 * t + ph * 2)); }
      const w = r() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527;   // (pink, roughly)
      x[i] += l.run(h.run(b0 + b1 + b2 + w * 0.1855)) * swell;
    }
    yield;
  }
}
// a whistle: 0 a long one with a wobble, 1 a wolf whistle (up, then down), 2 two short ones
function whistle(x: Float32Array, rate: number, kind: number, f: number, r: () => number) {
  const bp = new Biquad().bandpass(f, 6, rate);
  let ph = 0;
  const parts: [number, number, (u: number) => number][] = kind === 0 ? [[0.02, 0.7 + r() * 0.5, (u) => f * (1 + 0.12 * Math.min(1, u * 6) - 0.05 * Math.max(0, u - 0.85) * 6)]]
    : kind === 1 ? [[0.02, 0.28, (u) => f * (0.55 + 0.5 * u)], [0.42, 0.55, (u) => f * (1.05 - 0.6 * Math.pow(u, 0.8))]]
      : [[0.02, 0.16, (u) => f * (0.95 + 0.1 * u)], [0.26, 0.16, (u) => f * (0.95 + 0.1 * u)]];
  for (const [t0, len, pitch] of parts) {
    const s0 = Math.round(t0 * rate), n = Math.round(len * rate);
    for (let k = 0; k < n && s0 + k < x.length; k++) {
      const u = k / n, t = k / rate, hz = pitch(u) * (1 + 0.015 * Math.sin(2 * Math.PI * 6 * t));
      ph += hz / rate; if (ph >= 1) ph -= 1;
      const env = Math.min(1, t / 0.025, (len - t) / 0.06);
      x[s0 + k] += (Math.sin(2 * Math.PI * ph) * 0.9 + bp.run(r() * 2 - 1) * 0.6) * env;
    }
  }
}
