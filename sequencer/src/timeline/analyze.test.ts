// Finding the tempo, the first downbeat and the parts of a song from its sound: on made-up songs
// (drums, a bass note on the one, a chord pad) whose answers are known. The real songs are measured
// against the demo songs' catalog outside the tests (the numbers are in GUIDE.md).
import { describe, expect, it } from 'vitest';
import { analyzeSong, analyzeSteps, RATE, SURE } from './analyze';

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; }; }
interface Block { bars: number; kick?: number; snare?: number; hat?: number; pad?: number; chord?: number }
// kick on 1 and 3, snare on 2 and 4, hats on the eighths; blocks of bars, each as loud as it says
function song(bpm: number, first: number, blocks: Block[]) {
  const beat = 60 / bpm, bar = 4 * beat, bars = blocks.reduce((a, b) => a + b.bars, 0);
  const n = Math.ceil((first + bars * bar + 1) * RATE), x = new Float32Array(n), r = rng(1);
  const hit = (t: number, len: number, f: (s: number) => number) => { const a = Math.round(t * RATE); for (let i = 0; i < len * RATE && a + i < n; i++) x[a + i] += f(i / RATE); };
  let b0 = 0;
  for (const B of blocks) {
    for (let k = 0; k < B.bars; k++) {
      const t0 = first + (b0 + k) * bar, root = [110, 98, 87.3, 98][(b0 + k) % 4] * (B.chord ?? 1);
      for (let q = 0; q < 4; q++) {
        const t = t0 + q * beat;
        if (B.kick && q % 2 === 0) hit(t, 0.25, (s) => B.kick! * Math.sin(2 * Math.PI * 55 * s * (1 + 2 * Math.exp(-s * 40))) * Math.exp(-s * 12));
        if (B.snare && q % 2 === 1) hit(t, 0.18, (s) => B.snare! * (0.8 * r() * Math.exp(-s * 25) + 0.3 * Math.sin(2 * Math.PI * 190 * s) * Math.exp(-s * 30)));
        if (B.hat) for (const h of [0, 0.5]) hit(t + h * beat, 0.05, (s) => B.hat! * 0.3 * r() * Math.exp(-s * 90));
      }
      if (B.kick) hit(t0, bar * 0.9, (s) => B.kick! * 0.35 * Math.sin(2 * Math.PI * root * s) * Math.min(1, s * 50));
      if (B.pad) hit(t0, bar, (s) => B.pad! * 0.12 * (Math.sin(2 * Math.PI * root * 4 * s) + Math.sin(2 * Math.PI * root * 5 * s) + Math.sin(2 * Math.PI * root * 6 * s)));
    }
    b0 += B.bars;
  }
  return x;
}
const verse = { kick: 0.7, snare: 0.6, hat: 0.5 }, full = { kick: 1, snare: 1, hat: 1, pad: 1 }, quiet = { hat: 0.3, pad: 0.5 };

describe('the tempo and the first downbeat', () => {
  it('a steady beat: its tempo to a tenth of a BPM, the first downbeat where the music starts, sure', () => {
    const a = analyzeSong(song(128, 0.4, [{ bars: 32, ...verse, pad: 0.4 }]), RATE);
    expect(a.bpm).toBeCloseTo(128, 0);
    expect(Math.abs(a.bpm - 128)).toBeLessThan(0.1);
    expect(Math.abs(a.offset - 0.4)).toBeLessThan(0.03);
    expect(a.confidence).toBeGreaterThanOrEqual(SURE);
    expect(a.doubt).toBe('');
    expect(a.steady).toBe(1);
  });
  it('doubles and halves: drum & bass at 170 is 170 (the snare between the kicks), a slow groove at 80 stays 80', () => {
    const dnb = analyzeSong(song(170, 0.2, [{ bars: 48, kick: 1, snare: 1, hat: 0.4, pad: 0.3 }]), RATE);
    expect(Math.abs(dnb.bpm - 170)).toBeLessThan(0.2);
    expect(Math.abs(dnb.offset - 0.2)).toBeLessThan(0.03);
    const slow = analyzeSong(song(80, 0.3, [{ bars: 24, kick: 1, snare: 1, hat: 0.15, pad: 0.3 }]), RATE);
    expect(Math.abs(slow.bpm - 80)).toBeLessThan(0.2);
  });
  it('no beat to speak of: noise, a file too short, a beat that wanders all over: unsure, and no parts', () => {
    const r = rng(5), noise = new Float32Array(RATE * 30).map(() => r() * 0.5);
    expect(analyzeSong(noise, RATE)).toMatchObject({ bpm: 0, confidence: 0, sections: [], doubt: 'no-beat' });
    expect(analyzeSong(new Float32Array(RATE * 5), RATE)).toMatchObject({ bpm: 0, sections: [], doubt: 'no-beat' });
    // (clicks wandering between 100 and 140 BPM)
    const x = new Float32Array(RATE * 60);
    for (let t = 0.3, k = 0; t < 59; t += 60 / (120 + 20 * Math.sin(t / 6) + 6 * r()), k++) {
      const a = Math.round(t * RATE);
      for (let i = 0; i < 2000; i++) x[a + i] += (k % 2 ? 0.6 * r() : Math.sin((2 * Math.PI * 60 * i) / RATE)) * Math.exp(-i / 400);
    }
    const w = analyzeSong(x, RATE);
    expect(w.confidence).toBeLessThan(SURE);
    expect(w.steady).toBeLessThan(0.7);
    expect(w.doubt).toBe('weak-beat');
    expect(w.sections).toEqual([]);
  });
});

describe('the parts', () => {
  // 8 bars quiet, 16 of verse, 16 loud, 8 quiet, 16 loud, 8 of verse (120 BPM: a bar is 2 s)
  const x = song(120, 0.5, [{ bars: 8, ...quiet }, { bars: 16, ...verse }, { bars: 16, ...full, chord: 1.5 }, { bars: 8, ...quiet }, { bars: 16, ...full, chord: 1.5 }, { bars: 8, ...verse }]);
  const a = analyzeSong(x, RATE);
  it('a part starts on the bar line where the song changes (within a bar), the first at 0', () => {
    expect(a.sections[0]).toMatchObject({ name: 'Intro', at: 0 });
    for (const bar of [8, 24, 40, 48, 64]) expect(a.sections.some((s) => Math.abs(s.at - (0.5 + bar * 2)) <= 2.01), `bar ${bar}`).toBe(true);
    for (const s of a.sections.slice(1)) expect(Math.abs(((s.at - a.offset) / 2) - Math.round((s.at - a.offset) / 2))).toBeLessThan(0.01);
    for (let i = 1; i < a.sections.length; i++) expect(a.sections[i].at).toBeGreaterThan(a.sections[i - 1].at);
  });
  it('named by how loud they are: the loud ones choruses, a quiet one in the middle a break; repeats numbered', () => {
    const at = (bar: number) => a.sections.find((s) => Math.abs(s.at - (0.5 + bar * 2)) <= 2.01)!;
    expect(at(24).name).toBe('Chorus');
    expect(at(48).name).toBe('Chorus 2');
    expect(at(40).name).toMatch(/^Break/);
    for (const s of a.sections) { expect(s.energy).toBeGreaterThanOrEqual(0); expect(s.energy).toBeLessThanOrEqual(1); }
    expect(at(24).energy).toBeGreaterThan(at(40).energy);
    expect(new Set(a.sections.map((s) => s.name)).size).toBe(a.sections.length);
  });
});

describe('in small steps', () => {
  it('many steps (a page runs them in slices), the same answer as all at once', () => {
    const x = song(128, 0.4, [{ bars: 32, ...verse, pad: 0.4 }]);
    const it = analyzeSteps(x, RATE);
    let steps = 0, r = it.next();
    while (!r.done) { steps++; r = it.next(); }
    expect(steps).toBeGreaterThan(30);
    expect(r.value).toEqual(analyzeSong(x, RATE));
  });
});
