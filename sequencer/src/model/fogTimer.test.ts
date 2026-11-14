// isFogTimer: a list of fog (and haze) and nothing else is a fog timer; one value of anything else
// and it isn't (said at the first such value, without going through the rest).
import { describe, expect, it } from 'vitest';
import { isFogTimer } from './library';

const list = (...cues: Record<string, Record<string, unknown>>[]) => ({ cues: cues.map((values) => ({ values })) });
describe('a fog timer list', () => {
  it('fog and haze only: yes; a look anywhere in it: no; nothing at all: no', () => {
    expect(isFogTimer(list({ f1: { fog: 1 } }, { f1: { fog: 0 }, f2: { haze: 0.5 } }))).toBe(true);
    expect(isFogTimer(list({ f1: { fog: 1 } }, { f2: {} }))).toBe(true);
    expect(isFogTimer(list({ f1: { fog: 1 } }, { f2: { intensity: 1 } }))).toBe(false);
    expect(isFogTimer(list({ f2: { intensity: 1, color: {} } }))).toBe(false);
    expect(isFogTimer(list())).toBe(false);
    expect(isFogTimer(list({ f1: {} }))).toBe(false);
  });
  it('a big list of looks is told at once', () => {
    const cue = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`f${i}`, { intensity: 1, color: { r: 1, g: 0, b: 0 } }]));
    const big = list(...Array.from({ length: 100 }, () => cue));
    const t0 = performance.now(); for (let i = 0; i < 1000; i++) isFogTimer(big);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
