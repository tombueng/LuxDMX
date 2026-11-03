// Finding a song's tempo, its first downbeat and its parts from the sound alone, for a song file of
// your own (the demo songs come with theirs, measured once). Pure: a mono signal in, numbers out, no
// dependencies, so the page, a worker and the tests run the same code.
//
// How: a short-time spectrum (46 ms windows every 11.6 ms) gives how much each band rises from one
// moment to the next (onsets: all bands, the kick under 160 Hz, the snare 1.5 to 6 kHz). The tempo is
// the steady grid that lines up with the onsets over the whole song: candidates from the
// autocorrelation, each tried as a grid to a hundredth of a BPM. Doubles and halves sound alike, so
// the level is picked in 70 to 180 BPM, and the faster of two when the slower one's half-way points
// are nearly as strong as its beats. The beats sit where kick and snare hit; the "one" is where the
// kick and the sound changes fall while the snare is on 2 and 4. Parts: the bars' loudness, colour and
// chords, a boundary where the bars before and after differ most, named by how loud they are (the
// loudest third choruses, much quieter ones breaks). How sure it is: the beat standing out of noise
// and holding through the song, the tempo beating its relatives, the octave call not a close one.
//
// `analyzeSteps` does it in small steps (a generator) so a page can run it in slices; `analyzeSong`
// all at once (a worker, the tests).

export interface FoundSection { name: string; at: number; energy: number }
export interface SongAnalysis {
  bpm: number;              // beats a minute, to a hundredth (0: no steady beat found)
  offset: number;           // seconds to the first downbeat
  confidence: number;       // 0..1: how sure the tempo and the bar lines are
  steady: number;           // 0..1: how well one tempo holds through the song (a band without a click drifts)
  sections: FoundSection[]; // the parts (empty when not sure enough to name any)
  // why it's unsure, in plain words ('' when it is sure)
  doubt: '' | 'no-beat' | 'weak-beat' | 'tempo' | 'double';
  seconds: number;          // how long the song is
}
// Parts are only named from this sure on; a tempo below SURE is still the best guess.
export const SURE = 0.45;
// The rate the browser hands over (higher works too, just slower).
export const RATE = 11025;

// ---- the spectrum

interface Features {
  fps: number; t0: number; frames: number; bands: number;
  onset: Float32Array; kick: Float32Array; snare: Float32Array;
  loud: Float32Array;       // dB a frame
  db: Float32Array;         // frames x bands, dB (80 dB under the loudest at least)
  chroma: Float32Array;     // frames x 12 (pitch classes, 250 Hz to 2.5 kHz)
}

function fftTables(m: number) {
  const rev = new Uint32Array(m), bits = Math.round(Math.log2(m));
  for (let i = 0; i < m; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const cos = new Float64Array(m / 2), sin = new Float64Array(m / 2);
  for (let i = 0; i < m / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / m); sin[i] = -Math.sin((2 * Math.PI * i) / m); }
  return { rev, cos, sin };
}
// in place, radix 2 (the first two stages at once: their twiddles are 1 and -i)
function fft(re: Float64Array, im: Float64Array, t: ReturnType<typeof fftTables>) {
  const m = re.length, rev = t.rev, cos = t.cos, sin = t.sin;
  for (let i = 0; i < m; i++) { const j = rev[i]; if (j > i) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; } }
  for (let s = 0; s < m; s += 4) {
    const a0r = re[s] + re[s + 1], a0i = im[s] + im[s + 1], a1r = re[s] - re[s + 1], a1i = im[s] - im[s + 1];
    const b0r = re[s + 2] + re[s + 3], b0i = im[s + 2] + im[s + 3], b1r = re[s + 2] - re[s + 3], b1i = im[s + 2] - im[s + 3];
    re[s] = a0r + b0r; im[s] = a0i + b0i; re[s + 2] = a0r - b0r; im[s + 2] = a0i - b0i;
    re[s + 1] = a1r + b1i; im[s + 1] = a1i - b1r; re[s + 3] = a1r - b1i; im[s + 3] = a1i + b1r;
  }
  for (let size = 8; size <= m; size <<= 1) {
    const half = size >> 1, step = m / size;
    for (let k = 0; k < half; k++) {
      const c = cos[k * step], d = sin[k * step];
      for (let a = k; a < m; a += size) {
        const b = a + half, xr = re[b] * c - im[b] * d, xi = re[b] * d + im[b] * c;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
}

function* features(x: Float32Array, rate: number): Generator<number, Features> {
  const hop = Math.max(32, Math.round(rate / 86));
  let n = 256; while (n < rate * 0.046) n <<= 1;
  const m = n / 2, fps = rate / hop;
  const frames = Math.max(0, Math.floor((x.length - n) / hop) + 1);
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  // bins to bands: quarter octaves from 30 Hz to 11 kHz (empty ones dropped)
  const raw = new Int32Array(m + 1).fill(-1);
  for (let k = 1; k <= m; k++) { const f = (k * rate) / n; if (f >= 30 && f < 11000) raw[k] = Math.floor(4 * Math.log2(f / 30)); }
  const ids = [...new Set(Array.from(raw).filter((v) => v >= 0))].sort((a, b) => a - b), B = ids.length;
  const band = new Int32Array(m + 1).fill(-1);
  for (let k = 0; k <= m; k++) if (raw[k] >= 0) band[k] = ids.indexOf(raw[k]);
  const isKick = ids.map((i) => 30 * 2 ** (i / 4) >= 35 && 30 * 2 ** ((i + 1) / 4) <= 160);
  const isSnare = ids.map((i) => 30 * 2 ** (i / 4) >= 1500 && 30 * 2 ** ((i + 1) / 4) <= 6500);
  const nk = isKick.filter(Boolean).length, ns = isSnare.filter(Boolean).length;
  const pc = new Int32Array(m + 1).fill(-1);
  for (let k = 1; k <= m; k++) { const f = (k * rate) / n; if (f >= 250 && f <= 2500) pc[k] = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12) % 12; }
  const t = fftTables(m), re = new Float64Array(m), im = new Float64Array(m);
  const tc = new Float64Array(m + 1), ts = new Float64Array(m + 1);
  for (let k = 0; k <= m; k++) { tc[k] = Math.cos((Math.PI * k) / m); ts[k] = Math.sin((Math.PI * k) / m); }
  const db = new Float32Array(frames * B), chroma = new Float32Array(frames * 12), loud = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    if ((f & 511) === 511) yield f / frames;
    // a real spectrum through a complex FFT of half the size (even samples real, odd imaginary)
    const o = f * hop;
    for (let i = 0; i < m; i++) { re[i] = x[o + 2 * i] * win[2 * i]; im[i] = x[o + 2 * i + 1] * win[2 * i + 1]; }
    fft(re, im, t);
    let tot = 0;
    for (let k = 0; k <= m; k++) {
      const a = k === m ? 0 : k, b = k === 0 ? 0 : m - k;
      const er = (re[a] + re[b]) / 2, ei = (im[a] - im[b]) / 2, or = (im[a] + im[b]) / 2, oi = (re[b] - re[a]) / 2;
      const xr = er + tc[k] * or + ts[k] * oi, xi = ei + tc[k] * oi - ts[k] * or, p = xr * xr + xi * xi;
      tot += p;
      if (band[k] >= 0) db[f * B + band[k]] += p;
      if (pc[k] >= 0) chroma[f * 12 + pc[k]] += Math.sqrt(p);
    }
    loud[f] = 10 * Math.log10(tot + 1e-12);
  }
  yield 0.5;
  let top = -Infinity;
  for (let i = 0; i < db.length; i++) { db[i] = 10 * Math.log10(db[i] + 1e-12); if (db[i] > top) top = db[i]; if ((i & 262143) === 262143) yield 0.52; }
  yield 0.55;
  for (let i = 0; i < db.length; i++) if (db[i] < top - 80) db[i] = top - 80;
  let ltop = -Infinity;
  for (let i = 0; i < frames; i++) if (loud[i] > ltop) ltop = loud[i];
  for (let i = 0; i < frames; i++) if (loud[i] < ltop - 80) loud[i] = ltop - 80;
  // how much each band rose since the frame before
  const onset = new Float32Array(frames), kick = new Float32Array(frames), snare = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    if ((f & 8191) === 8191) yield 0.58;
    let a = 0, k = 0, s = 0;
    for (let b = 0; b < B; b++) {
      const d = db[f * B + b] - db[(f - 1) * B + b];
      if (d > 0) { a += d; if (isKick[b]) k += d; if (isSnare[b]) s += d; }
    }
    onset[f] = a / B; kick[f] = nk ? k / nk : 0; snare[f] = ns ? s / ns : 0;
  }
  yield 0.6;
  const hp = [highpass(onset, fps), highpass(kick, fps), highpass(snare, fps)];
  yield 0.62;
  return { fps, t0: n / 2 / rate, frames, bands: B, onset: hp[0], kick: hp[1], snare: hp[2], loud, db, chroma };
}

// the envelope less its moving average over a second, never below 0
function highpass(e: Float32Array, fps: number): Float32Array {
  const w = Math.max(1, Math.round(fps * 0.5)), out = new Float32Array(e.length), pre = new Float64Array(e.length + 1);
  for (let i = 0; i < e.length; i++) pre[i + 1] = pre[i] + e[i];
  for (let i = 0; i < e.length; i++) { const a = Math.max(0, i - w), b = Math.min(e.length, i + w + 1); out[i] = Math.max(0, e[i] - (pre[b] - pre[a]) / (b - a)); }
  return out;
}

// ---- the tempo

// autocorrelation for lags 0..maxLag (mean removed), 1 at lag 0
function* acf(e: Float32Array, maxLag: number): Generator<number, Float64Array> {
  const n = e.length; let mean = 0;
  for (let i = 0; i < n; i++) mean += e[i];
  mean /= n || 1;
  const c = new Float64Array(n);
  for (let i = 0; i < n; i++) c[i] = e[i] - mean;
  const out = new Float64Array(maxLag + 1);
  for (let L = 0; L <= maxLag; L++) { let s = 0; for (let i = 0; i + L < n; i++) s += c[i] * c[i + L]; out[L] = s / Math.max(1, n - L); if (L % 32 === 31) yield 0; }
  const z = out[0] || 1;
  for (let L = 0; L <= maxLag; L++) out[L] /= z;
  return out;
}
const lerp = (a: ArrayLike<number>, x: number) => { const i = Math.floor(x), f = x - i; return i + 1 < a.length ? a[i] * (1 - f) + a[i + 1] * f : (a[i] ?? 0); };

// The envelope folded onto one period (frames, not whole), one bin a frame so a slow period isn't
// smeared more than a fast one, a little smoothed: its peak against its mean, and where the peak is.
function comb(e: Float32Array, period: number, from = 0, to = e.length): { c: number; phase: number; prof: Float64Array } {
  const bins = Math.max(12, Math.round(period)), sum = new Float64Array(bins), cnt = new Float64Array(bins);
  for (let i = from; i < to; i++) {
    const ph = ((i % period) / period) * bins, j = Math.floor(ph), f = ph - j, j2 = (j + 1) % bins;
    sum[j] += e[i] * (1 - f); cnt[j] += 1 - f; sum[j2] += e[i] * f; cnt[j2] += f;
  }
  const raw = new Float64Array(bins), prof = new Float64Array(bins);
  for (let j = 0; j < bins; j++) raw[j] = cnt[j] ? sum[j] / cnt[j] : 0;
  let bi = 0, mean = 0;
  for (let j = 0; j < bins; j++) {
    prof[j] = (raw[(j + bins - 1) % bins] + raw[j] + raw[(j + 1) % bins]) / 3;
    mean += prof[j]; if (prof[j] > prof[bi]) bi = j;
  }
  mean /= bins;
  // (the peak to a fraction of a bin)
  const a = prof[(bi + bins - 1) % bins], b = prof[bi], c = prof[(bi + 1) % bins], den = a - 2 * b + c;
  const frac = den < 0 ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * den))) : 0;
  return { c: mean > 0 ? b / mean : 0, phase: ((((bi + frac) / bins) * period) % period + period) % period, prof };
}
// how strong the half-way point is against the beat at this period (0: nothing between, 1: as strong)
function halfRatio(e: Float32Array, period: number): number {
  const { prof } = comb(e, period), n = prof.length;
  let bi = 0; for (let j = 1; j < n; j++) if (prof[j] > prof[bi]) bi = j;
  const base = Array.from(prof).sort((a, b) => a - b)[Math.floor(n / 4)], h = Math.round(n / 2);
  const s2 = Math.max(prof[(bi + h - 1) % n], prof[(bi + h) % n], prof[(bi + h + 1) % n]);
  return Math.max(0, (s2 - base) / ((prof[bi] - base) || 1));
}
// the steady grid near this tempo (+-span) that fits best, to a hundredth of a BPM
function* refine(e: Float32Array, fps: number, bpm: number, span = 0.015): Generator<number, { bpm: number; c: number }> {
  let best = { bpm, c: -1 }, k = 0;
  for (let b = bpm * (1 - span); b <= bpm * (1 + span); b += 0.1) { const c = comb(e, (fps * 60) / b).c; if (c > best.c) best = { bpm: b, c }; if (++k % 8 === 0) yield 0; }
  const mid = best.bpm;
  for (let b = mid - 0.12; b <= mid + 0.121; b += 0.01) { const c = comb(e, (fps * 60) / b).c; if (c > best.c) best = { bpm: b, c }; if (++k % 8 === 0) yield 0; }
  return best;
}

interface Tempo { bpm: number; c: number; classMargin: number; octave: 'one' | 'fast' | 'slow' | 'double'; octaveMargin: number; steady: number }
function* tempoOf(F: Features): Generator<number, Tempo | null> {
  const o = F.onset, ks = new Float32Array(F.frames);
  for (let i = 0; i < F.frames; i++) ks[i] = F.kick[i] + F.snare[i];
  const maxLag = Math.ceil((F.fps * 60) / 40);
  if (F.frames < maxLag * 4) return null;                       // (too short to say)
  const a = yield* acf(o, maxLag);
  const peaks: [number, number][] = [];
  for (let L = Math.max(2, Math.floor((F.fps * 60) / 250)); L < maxLag; L++) if (a[L] > a[L - 1] && a[L] >= a[L + 1] && a[L] > 0) {
    const den = 2 * (a[L - 1] - 2 * a[L] + a[L + 1]), d = den ? (a[L - 1] - a[L + 1]) / den : 0;
    peaks.push([(60 * F.fps) / (L + d), a[L]]);
  }
  if (!peaks.length) return null;
  peaks.sort((p, q) => q[1] - p[1]);
  // Tempo classes (a tempo with its doubles and halves), named by their level in 60..120. Each is
  // scored by its best grid fit times its best autocorrelation over its levels in 60..200: the true
  // one beats the 2/3 and 3/2 relatives on both.
  const base = (b: number) => { while (b >= 120) b /= 2; while (b < 60) b *= 2; return b; };
  const same = (x: number, y: number, tol: number) => { const d = Math.abs(Math.log2(x / y)) % 1; return d < tol || d > 1 - tol; };
  const bases: number[] = [];
  for (const [b] of peaks.slice(0, 5)) for (const m of [1, 1.5, 2 / 3]) { const t = base(b * m); if (!bases.some((x) => same(x, t, 0.012))) bases.push(t); }
  const acfAt = (b: number) => { let mx = -1; for (let d = -0.012; d <= 0.012; d += 0.002) mx = Math.max(mx, lerp(a, (F.fps * 60) / (b * (1 + d)))); return mx; };
  const classes: { lv: { bpm: number; c: number }[]; score: number }[] = [];
  for (const b of bases) {
    const lv: { bpm: number; c: number }[] = [];
    for (const t of [b, b * 2]) if (t >= 60 && t <= 200) lv.push(yield* refine(o, F.fps, t));
    if (!lv.length) continue;
    const C = Math.max(...lv.map((l) => l.c)), A = Math.max(...lv.map((l) => acfAt(l.bpm)));
    classes.push({ lv, score: C * (1 + Math.max(0, A)) });
  }
  classes.sort((p, q) => q.score - p.score);
  // (two names for one class once refined: the weaker goes)
  for (let i = classes.length - 1; i > 0; i--) if (classes.slice(0, i).some((c) => same(c.lv[0].bpm, classes[i].lv[0].bpm, 0.006))) classes.splice(i, 1);
  if (!classes.length) return null;
  const best = classes[0], classMargin = classes.length > 1 ? best.score / classes[1].score : 2;
  const ref = best.lv.reduce((p, q) => (q.c > p.c ? q : p));
  const lv: { bpm: number; c: number }[] = [];
  for (let m = 0.25; m <= 4; m *= 2) {
    const t = ref.bpm * m;
    if (t >= 50 && t <= 215) lv.push(m === 1 ? ref : yield* refine(o, F.fps, t, 0.004));
  }
  // the level in 70..180 (the slower one when two are); the faster one when the slower one's
  // half-way points are nearly as strong as its beats
  let pick = lv.find((l) => l.bpm >= 70 && l.bpm <= 180) ?? lv[0];
  const r = (b: number) => (halfRatio(o, (F.fps * 60) / b) + halfRatio(ks, (F.fps * 60) / b)) / 2;
  const slowR = r(pick.bpm), fast = lv.find((l) => Math.abs(l.bpm / (2 * pick.bpm) - 1) < 0.01);
  let octave: Tempo['octave'] = 'one', octaveMargin = 1;
  if (fast && fast.bpm <= 180) {
    octave = slowR >= HALF_STRONG ? 'fast' : 'slow';
    octaveMargin = Math.abs(slowR - HALF_STRONG);
    if (octave === 'fast') pick = fast;
  } else if (fast && slowR >= 0.8) { octave = 'double'; octaveMargin = 0; }
  return { bpm: pick.bpm, c: pick.c, classMargin, octave, octaveMargin, steady: yield* steadiness(o, pick.bpm, F.fps) };
}
// How steady the beat is: the tempo that fits each stretch of 20 s best (within 4 % of the song's),
// and how many of the stretches with a beat agree with the song's within 1 % (a band without a
// click drifts, a wandering beat is no grid to snap to).
function* steadiness(e: Float32Array, bpm: number, fps: number): Generator<number, number> {
  const w = Math.round(fps * 20), n = Math.floor(e.length / w);
  let beats = 0, agree = 0;
  for (let k = 0; k < n; k++) {
    let best = { b: bpm, c: 0 };
    for (let b = bpm * 0.96; b <= bpm * 1.04; b += bpm * 0.002) { const c = comb(e, (fps * 60) / b, k * w, (k + 1) * w).c; if (c > best.c) best = { b, c }; }
    yield 0;
    if (best.c < 1.5) continue;                 // (no beat in this stretch: a break)
    beats++;
    if (Math.abs(best.b / bpm - 1) <= 0.01) agree++;
  }
  return beats ? agree / beats : 1;
}

// the half-way points this strong against the beats: the faster level is the beat
const HALF_STRONG = 0.55;

// ---- the beats and the first downbeat

const peakNear = (e: Float32Array, x: number, r = 2) => {
  let m = 0;
  for (let i = Math.max(0, Math.round(x) - r), e2 = Math.min(e.length - 1, Math.round(x) + r); i <= e2; i++) if (e[i] > m) m = e[i];
  return m;
};
const zs = (v: number[]) => {
  const m = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
  return v.map((x) => (sd > 1e-9 ? (x - m) / sd : 0));
};
// The onsets peak a little before the attack (the log of a rising window): the beats are moved on
// by this much (measured against the demo songs' downbeats: a median of 20 ms).
const LAG = 0.02;

interface Grid { beat0: number; bar: number; offset: number; start: number; barSure: number }
function* gridOf(F: Features, bpm: number): Generator<number, Grid> {
  const P = (F.fps * 60) / bpm, ks = new Float32Array(F.frames);
  for (let i = 0; i < F.frames; i++) ks[i] = F.kick[i] + F.snare[i];
  // the beats: where kick and snare hit (the strongest onsets can be the off-beat: guitar, hats)
  const ph = comb(ks, P).phase;
  yield 0;
  const nb = Math.floor((F.frames - ph) / P);
  const B = F.bands, K: number[] = [], S: number[] = [], O: number[] = [];
  const timbre: Float64Array[] = [], chroma: Float64Array[] = [], loud: number[] = [];
  for (let j = 0; j < nb; j++) {
    if (j % 32 === 31) yield 0;
    const x = ph + j * P, a = Math.round(x), b = Math.min(F.frames, Math.round(x + P));
    K.push(peakNear(F.kick, x)); S.push(peakNear(F.snare, x)); O.push(peakNear(F.onset, x));
    const v = new Float64Array(B), c = new Float64Array(12);
    let l = 0, cs = 0;
    for (let f = a; f < b; f++) {
      for (let q = 0; q < B; q++) v[q] += F.db[f * B + q];
      for (let q = 0; q < 12; q++) { c[q] += F.chroma[f * 12 + q]; cs += F.chroma[f * 12 + q]; }
      l += F.loud[f];
    }
    for (let q = 0; q < B; q++) v[q] /= (b - a) || 1;
    for (let q = 0; q < 12; q++) c[q] /= cs || 1;
    timbre.push(v); chroma.push(c); loud.push(l / ((b - a) || 1));
  }
  // per beat of the bar (p = 0..3): kick on 1 and 3 (more on 1), snare on 2 and 4, and the sound,
  // the chords and the loudness changing on the 1 (two beats after against two before)
  const per = () => [[], [], [], []] as number[][];
  const cue = { kick: per(), snare: per(), onset: per(), timbre: per(), chroma: per(), loud: per() };
  const dist = (v: Float64Array[], i: number) => { let d = 0; for (let q = 0; q < v[i].length; q++) { const z = v[i][q] + v[i + 1][q] - v[i - 1][q] - v[i - 2][q]; d += z * z; } return Math.sqrt(d); };
  for (let j = 2; j + 2 < nb; j++) {
    const p = j % 4;
    cue.kick[p].push(K[j]); cue.snare[p].push(S[j]); cue.onset[p].push(O[j]);
    cue.timbre[p].push(dist(timbre, j)); cue.chroma[p].push(dist(chroma, j));
    cue.loud[p].push(Math.abs(loud[j] + loud[j + 1] - loud[j - 1] - loud[j - 2]));
  }
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
  const z = Object.fromEntries(Object.entries(cue).map(([n, v]) => [n, zs(v.map(mean))])) as Record<keyof typeof cue, number[]>;
  // the music starts: the first frame within 20 dB of the loud part
  const srt = Array.from(F.loud).sort((a, b) => a - b), p90 = srt[Math.floor(srt.length * 0.9)] ?? 0;
  let st = 0; while (st < F.frames && F.loud[st] < p90 - 20) st++;
  const start = F.t0 + st / F.fps;
  const beat = 60 / bpm, beat0 = F.t0 + ph / F.fps + LAG;
  // (a song that starts on its "one": a small nudge for the beat it starts on)
  const firstBeat = Math.max(0, Math.ceil((start - 0.05 - beat0) / beat)) % 4;
  const score = [0, 1, 2, 3].map((p) => 0.5 * (z.kick[p] + z.kick[(p + 2) % 4]) / 2 + 0.25 * (z.kick[p] - z.kick[(p + 2) % 4])
    + (z.snare[(p + 1) % 4] + z.snare[(p + 3) % 4]) + 1.5 * z.onset[p] + z.timbre[p] + 2 * z.chroma[p] + z.loud[p]
    + (p === firstBeat ? 1 : 0));
  let bar = 0; for (let p = 1; p < 4; p++) if (score[p] > score[bar]) bar = p;
  const second = Math.max(...score.filter((_, p) => p !== bar));
  const barS = 4 * beat;
  let off = beat0 + bar * beat;
  off -= Math.floor((off - start + 0.05) / barS) * barS;      // the first "one" once the music has started
  if (off < start - 0.05) off += barS;
  if (off < 0) off += barS;
  return { beat0, bar, offset: off, start, barSure: score[bar] - second };
}

// ---- the parts

interface Bar { at: number; v: number[]; power: number }
function* barsOf(F: Features, bpm: number, offset: number, seconds: number): Generator<number, Bar[]> {
  const barS = 240 / bpm, B = F.bands, out: Bar[] = [];
  // colour: the bands in eight groups (bass to air), chords (12), loudness
  const groups = 8, gOf = (b: number) => Math.min(groups - 1, Math.floor((b * groups) / B));
  for (let t = offset - Math.floor(offset / barS) * barS; t + barS * 0.5 < seconds; t += barS) {
    const a = Math.max(0, Math.round((t - F.t0) * F.fps)), b = Math.min(F.frames, Math.round((t + barS - F.t0) * F.fps));
    if (b <= a) break;
    if (out.length % 8 === 7) yield 0;
    const g = new Array<number>(groups).fill(0), gn = new Array<number>(groups).fill(0), c = new Array<number>(12).fill(0);
    let l = 0, pw = 0, cs = 0;
    for (let f = a; f < b; f++) {
      for (let q = 0; q < B; q++) { g[gOf(q)] += F.db[f * B + q]; gn[gOf(q)]++; }
      for (let q = 0; q < 12; q++) { c[q] += F.chroma[f * 12 + q]; cs += F.chroma[f * 12 + q]; }
      l += F.loud[f]; pw += 10 ** (F.loud[f] / 10);
    }
    out.push({ at: t, v: [...g.map((x, i) => x / (gn[i] || 1)), ...c.map((x) => x / (cs || 1)), l / (b - a)], power: pw / (b - a) });
  }
  return out;
}

function* partsOf(bars: Bar[], seconds: number): Generator<number, FoundSection[]> {
  const n = bars.length;
  if (n < 12) return [];
  // every feature as a z-score over the song; the chords count less a dimension (there are twelve),
  // the loudness more
  const dims = bars[0].v.length, w = Array.from({ length: dims }, (_, d) => (d >= 8 && d < 20 ? 0.2 : d === 20 ? 2 : 1));
  const z = bars.map(() => new Float64Array(dims));
  for (let d = 0; d < dims; d++) {
    const col = bars.map((b) => b.v[d]), m = col.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / n) || 1;
    for (let i = 0; i < n; i++) z[i][d] = ((bars[i].v[d] - m) / sd) * w[d];
  }
  // novelty at each bar line: how alike the bars are among themselves before and after it, against
  // across it (a checkerboard over six bars each side, softer further out)
  const W = 6, near = (i: number, j: number) => { let d = 0; for (let q = 0; q < dims; q++) d += (z[i][q] - z[j][q]) ** 2; return -Math.sqrt(d); };
  const nov = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    if (i % 32 === 31) yield 0;
    let t = 0, ws = 0;
    for (let a = -W; a < W; a++) for (let b = -W; b < W; b++) {
      const x = i + a, y = i + b;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const g = Math.exp(-2 * (((a + 0.5) / W) ** 2 + ((b + 0.5) / W) ** 2));
      t += ((a < 0) === (b < 0) ? g : -g) * near(x, y); ws += g;
    }
    nov[i] = Math.max(0, t / (ws || 1));
  }
  // boundaries: the peaks (the most within three bars either side) above the usual, four bars apart
  const vals = Array.from(nov).filter((v) => v > 0).sort((a, b) => a - b), med = vals[Math.floor(vals.length / 2)] ?? 0;
  const cuts: number[] = [];
  for (let i = 2; i <= n - 2; i++) {
    let peak = nov[i] > med * 1.15;
    for (let k = -3; k <= 3 && peak; k++) if (k && i + k >= 0 && i + k < n && nov[i + k] > nov[i]) peak = false;
    if (peak && (!cuts.length || i - cuts[cuts.length - 1] >= 4)) cuts.push(i);
  }
  // the parts: [0, first cut), then cut to cut; energy: the part's power against the loud bars
  const starts = [0, ...cuts], ref = bars.map((b) => b.power).sort((a, b) => a - b)[Math.floor(n * 0.95)] || 1;
  const info = starts.map((a, k) => {
    const b = k + 1 < starts.length ? starts[k + 1] : n;
    let pw = 0; for (let i = a; i < b; i++) pw += bars[i].power;
    return { a, b, energy: clamp01(pw / (b - a) / ref) };
  });
  // names: the loudest third of the parts in the middle are choruses, much quieter ones (under half
  // the power of the loud ones) breaks, the rest verses; a quieter or short first and last part are
  // the intro and the outro
  const last = info.length - 1, mid = info.map((s, k) => ({ e: s.energy, k })).filter((x) => x.k > 0 && x.k < last).sort((x, y) => y.e - x.e);
  const top = mid[Math.floor(mid.length / 4)]?.e ?? Math.max(...info.map((s) => s.energy));
  const cut = mid[Math.max(0, Math.round(mid.length / 3) - 1)]?.e ?? top;
  const loud = new Set(mid.filter((x) => x.e >= cut * 0.97 && x.e >= top * 0.75).map((x) => x.k));
  const names = info.map((s, k) => {
    if (k === 0 && last > 1 && (s.energy < top * 0.85 || s.b - s.a <= 8)) return 'Intro';
    if (k === last && last > 1 && (s.energy < top * 0.85 || s.b - s.a <= 8)) return 'Outro';
    return loud.has(k) ? 'Chorus' : s.energy < top * 0.5 ? 'Break' : 'Verse';
  });
  const seen = new Map<string, number>();
  return info.map((s, k) => {
    const c = (seen.get(names[k]) ?? 0) + 1;
    seen.set(names[k], c);
    return { name: c > 1 ? `${names[k]} ${c}` : names[k], at: k === 0 ? 0 : round2(bars[s.a].at), energy: round2(s.energy) };
  }).filter((s) => s.at < seconds);
}
const round2 = (x: number) => Math.round(x * 100) / 100 + 0;

// ---- all of it

// `allParts`: the parts even when unsure (for measuring)
export function* analyzeSteps(x: Float32Array, rate: number, o: { allParts?: boolean } = {}): Generator<number, SongAnalysis> {
  const seconds = x.length / rate;
  const none = (doubt: SongAnalysis['doubt']): SongAnalysis => ({ bpm: 0, offset: 0, confidence: 0, steady: 0, sections: [], doubt, seconds });
  if (!(rate > 4000) || seconds < 8) return none('no-beat');
  const F = yield* features(x, rate);
  const T = yield* tempoOf(F);
  // (noise lines up with its best grid about this well, better the shorter it is: no beat to speak of)
  const floor = 1.3 + 2.5 / Math.sqrt(seconds);
  if (!T || T.c < floor) return none('no-beat');
  const bpm = Math.round(T.bpm * 100) / 100;
  const g = yield* gridOf(F, bpm);
  // How sure: the beat stands out of the onsets (c) and holds through the song, the tempo beats its
  // relatives, the octave call wasn't a close one, and the "one" stood out of the four beats.
  const clear = Math.min(clamp01((T.c - Math.max(1.6, floor)) / 1.6), clamp01((T.steady - 0.5) / 0.35)), cls = clamp01((T.classMargin - 1) / 0.25);
  const oct = T.octave === 'double' ? 0.35 : T.octave === 'one' ? 1 : clamp01(0.3 + T.octaveMargin * 5);
  const confidence = round2(Math.min(clear, cls, oct) * (0.75 + 0.25 * clamp01(g.barSure / 2)));
  const doubt: SongAnalysis['doubt'] = confidence >= SURE ? '' : clear <= cls && clear <= oct ? 'weak-beat' : T.octave === 'double' && oct <= cls ? 'double' : 'tempo';
  const sections = confidence >= SURE || o.allParts ? yield* partsOf(yield* barsOf(F, bpm, g.offset, seconds), seconds) : [];
  return { bpm, offset: round3(g.offset), confidence, steady: round2(T.steady), sections, doubt, seconds };
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const round3 = (x: number) => Math.round(x * 1000) / 1000 + 0;

export function analyzeSong(x: Float32Array, rate: number, o: { allParts?: boolean } = {}): SongAnalysis {
  const it = analyzeSteps(x, rate, o);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}
