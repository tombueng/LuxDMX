import { describe, expect, it } from 'vitest';
import { BeatDetector } from './audio';

// Bass energy every 20 ms: quiet noise, a kick (decaying over 60 ms) every `period` seconds.
function feed(d: BeatDetector, bpm: number, seconds: number, noise = 0.0008, seed = 1) {
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const period = 60 / bpm;
  let beats = 0;
  for (let t = 0; t < seconds; t += 0.02) {
    const since = t % period;
    const kick = since < 0.06 ? 0.04 * Math.exp(-since / 0.03) : 0;
    if (d.push(t, noise * (0.5 + rnd()) + kick)) beats++;
  }
  return beats;
}

describe('beat detection', () => {
  it('finds 120 BPM in a steady kick', () => {
    const d = new BeatDetector();
    const n = feed(d, 120, 10);
    expect(n).toBeGreaterThan(17); expect(n).toBeLessThan(22);
    expect(d.bpm).toBeGreaterThan(117); expect(d.bpm).toBeLessThan(123);
    expect(d.confidence).toBeGreaterThan(0.8);
  });
  it('128 and 95 BPM too', () => {
    for (const bpm of [128, 95]) {
      const d = new BeatDetector();
      feed(d, bpm, 12);
      expect(Math.abs(d.bpm - bpm)).toBeLessThan(4);
    }
  });
  it('noise alone gives no tempo', () => {
    const d = new BeatDetector();
    let r = 7;
    for (let t = 0; t < 8; t += 0.02) d.push(t, 0.001 * (0.9 + 0.2 * ((r = (r * 16807) % 2147483647) / 2147483647)));
    expect(d.bpm).toBe(0);
  });
});
