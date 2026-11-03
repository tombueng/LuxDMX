// The crowd from recordings: a loop goes round without a seam (no jump where its end meets its
// start, the MP3's padding cut off), and the files are chatter and cheering only: no applause, no
// clapping (they sounded ugly), and every one of them is there.
import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CROWD_DIR, CROWD_FILES, seamless } from './crowdReal';
import { rng } from './crowdKit';

describe('the crowd from recordings', () => {
  it('a loop without a seam: where its end meets its start, no bigger a step than anywhere inside', () => {
    const rate = 8000, n = rate * 6, r = rng(3);
    // a noisy recording with a slow swell, and junk at both ends (the padding)
    const x = new Float32Array(n).map((_, i) => 0.3 * Math.sin(i / 900) + 0.2 * (r() - 0.5));
    for (let i = 0; i < 400; i++) { x[i] = 0.9; x[n - 1 - i] = -0.9; }
    const [y] = seamless([x], rate, 1, 0.06);
    expect(y.length).toBe(n - 2 * 480 - 8000);
    expect(Math.max(...y.map(Math.abs))).toBeLessThan(0.75);          // (the junk is gone)
    let inside = 0;
    for (let i = 1; i < y.length; i++) inside = Math.max(inside, Math.abs(y[i] - y[i - 1]));
    expect(Math.abs(y[0] - y[y.length - 1])).toBeLessThanOrEqual(inside * 1.05);
  });
  it('chatter and cheering only: every file it loads is there, and none of them applause or claps', () => {
    const dir = new URL(`../../public/${CROWD_DIR}`, import.meta.url);
    const want = [CROWD_FILES.chatter, CROWD_FILES.roar, ...CROWD_FILES.cheers];
    for (const f of want) expect(existsSync(new URL(f, dir)), f).toBe(true);
    const there = readdirSync(dir);
    expect(there.filter((f) => /clap|applaus/i.test(f))).toEqual([]);
    expect(there.filter((f) => !want.includes(f))).toEqual([]);
  });
});
