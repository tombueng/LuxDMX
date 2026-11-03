// Follow the music: listen to the microphone, find the kick drum, and from the time between kicks
// the tempo. Deliberately simple (a bass filter, the energy of each 20 ms slice compared with the
// last second, a minimum gap between beats), which is what works for dance music and most bands.
// Nothing leaves the computer; the audio isn't recorded.

export interface MusicState { bpm: number; confidence: number; level: number; beat: number }
type BeatFn = (t: number) => void;

const SLICE = 0.02;            // seconds between measurements
const HISTORY = 50;            // slices kept for the average (one second)
const MIN_GAP = 0.27;          // no two beats closer than this (about 220 BPM)

// Pure part (tested on its own): energies in, beats and tempo out.
export class BeatDetector {
  private hist: number[] = [];
  private beats: number[] = [];
  private last = -1;
  bpm = 0;
  confidence = 0;

  // One measurement (mean square of the bass) at time t. Returns true on a beat.
  push(t: number, energy: number): boolean {
    const h = this.hist;
    const avg = h.length ? h.reduce((a, b) => a + b, 0) / h.length : energy;
    const variance = h.length ? h.reduce((a, b) => a + (b - avg) ** 2, 0) / h.length : 0;
    h.push(energy);
    if (h.length > HISTORY) h.shift();
    // Louder than usual by a margin that's smaller when the music is steady (more variance, more margin).
    const c = Math.max(1.25, 1.55 - 0.0025 * variance / Math.max(1e-9, avg * avg));
    const beat = h.length > 10 && energy > avg * c && energy > 1e-5 && (this.last < 0 || t - this.last >= MIN_GAP);
    if (!beat) return false;
    this.last = t;
    this.beats.push(t);
    if (this.beats.length > 16) this.beats.shift();
    this.estimate();
    return true;
  }

  // Tempo from the gaps between beats: the median gap, folded into 70-180 BPM; confidence is how
  // many gaps agree with it (or with twice / half of it).
  private estimate() {
    const gaps: number[] = [];
    for (let i = 1; i < this.beats.length; i++) { const g = this.beats[i] - this.beats[i - 1]; if (g > 0.25 && g < 2) gaps.push(g); }
    if (gaps.length < 3) return;
    const med = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    let bpm = 60 / med;
    while (bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    const beat = 60 / bpm;
    const fits = gaps.filter((g) => [0.5, 1, 2].some((m) => Math.abs(g - beat * m) < beat * m * 0.12)).length;
    this.confidence = fits / gaps.length;
    // Smooth it, so one missed kick doesn't swing the tempo.
    this.bpm = this.bpm && Math.abs(this.bpm - bpm) < 8 ? this.bpm * 0.7 + bpm * 0.3 : bpm;
  }
}

// The microphone side.
export class MusicListener {
  state: MusicState = { bpm: 0, confidence: 0, level: 0, beat: 0 };
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private det = new BeatDetector();
  private starting: Promise<void> | null = null;
  private an: AnalyserNode | null = null;
  private buf = new Float32Array(0);

  constructor(private onBeat: BeatFn, private onChange: (s: MusicState) => void) {}

  get running() { return !!this.ctx; }

  // Twice in a row (a double click) is one listener.
  start(): Promise<void> {
    if (this.ctx) return Promise.resolve();
    this.starting ??= this.open().finally(() => { this.starting = null; });
    return this.starting;
  }
  private async open() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can\'t use a microphone here');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const ctx = new AudioContext();
    this.ctx = ctx;
    const src = ctx.createMediaStreamSource(this.stream);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass'; low.frequency.value = 140; low.Q.value = 0.8;
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    src.connect(low).connect(an);
    this.buf = new Float32Array(an.fftSize);
    this.an = an;
    this.det = new BeatDetector();
  }

  // One measurement; called by the output clock (40 times a second, also in a background tab).
  poll() {
    const an = this.an, ctx = this.ctx;
    if (!an || !ctx) return;
    an.getFloatTimeDomainData(this.buf);
    const n = Math.round(ctx.sampleRate * SLICE);
    let e = 0;
    for (let i = this.buf.length - n; i < this.buf.length; i++) e += this.buf[i] * this.buf[i];
    e /= n;
    const t = ctx.currentTime;
    const beat = this.det.push(t, e);
    this.state = { bpm: this.det.bpm, confidence: this.det.confidence, level: Math.min(1, Math.sqrt(e) * 8), beat: beat ? performance.now() : this.state.beat };
    if (beat) this.onBeat(t);
    this.onChange(this.state);
  }

  stop() {
    this.an = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.ctx = null; this.stream = null;
    this.state = { bpm: 0, confidence: 0, level: 0, beat: 0 };
    this.onChange(this.state);
  }
}
