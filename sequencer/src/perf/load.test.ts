// @vitest-environment happy-dom
// The governor: the DMX output comes first. Late output frames make the drawing give way at once
// (the pictures every other frame, then simpler); four calm seconds bring it back up, a step at a time.
import { describe, expect, it } from 'vitest';
import { Load } from './load.svelte';

// output frames from `from` to `to` (ms), `gap` apart, each taking 2 ms
function run(l: Load, from: number, to: number, gap: number) { for (let t = from; t < to; t += gap) l.tick(t, 2); return to; }

describe('the drawing gives way to the DMX output', () => {
  it('on time: nothing changes', () => {
    const l = new Load(); l.setQuality(2);
    run(l, 0, 10_000, 25);
    expect([l.level, l.uiEvery, l.lowered]).toEqual([2, 1, false]);
    expect(l.rate).toBeGreaterThan(38); expect(l.late).toBe(0);
  });
  it('late frames: the pictures every other frame, then simpler, down to the lowest; the display says so', () => {
    const l = new Load(); l.setQuality(2);
    let t = run(l, 0, 2000, 25);
    t = run(l, t, t + 600, 50);
    expect(l.uiEvery).toBe(2);
    t = run(l, t, t + 3000, 50);
    expect(l.level).toBe(0);
    expect(l.lowered).toBe(true);
    expect(l.late).toBeGreaterThan(10);
    expect(l.worst).toBeGreaterThanOrEqual(50);
  });
  it('four calm seconds: back up a step at a time, never above the quality chosen', () => {
    const l = new Load(); l.setQuality(1);
    let t = run(l, 0, 4000, 60);               // late for a while
    expect(l.level).toBe(0);
    const before = { level: l.level, every: l.uiEvery };
    t = run(l, t, t + 6000, 25);              // (the last late frame leaves the one-second window, then four calm seconds)
    expect(l.level > before.level || l.uiEvery < before.every).toBe(true);   // a first step up
    t = run(l, t, t + 30_000, 25);
    expect([l.level, l.uiEvery]).toEqual([1, 1]);   // the chosen Medium, not High
  });
  it('with the DMX on its own thread: late page frames keep the 3D at the quality chosen but draw it less often first; the panels (to every 3rd) and the plan give way, and all come back', () => {
    const l = new Load(); l.setQuality(2); l.outputSafe = true;
    const plan = l.level2d;
    let t = run(l, 0, 700, 60);
    expect([l.uiEvery, l.slow3d]).toEqual([2, 0]);
    t = run(l, t, t + 600, 60);
    // (the 3D's frames before the plan: it's the most the page does)
    expect([l.slow3d, l.level2d]).toEqual([1, plan]);
    t = run(l, t, t + 6000, 60);
    expect(l.level).toBe(2);
    expect(l.slow3d).toBe(2);
    expect(l.level2d).toBe(0);
    expect(l.uiEvery).toBe(3);
    expect(l.lowered).toBe(true);
    t = run(l, t, t + 40_000, 25);
    expect([l.level, l.level2d, l.uiEvery, l.slow3d]).toEqual([2, 2, 1, 0]);
    expect(l.lowered).toBe(false);
  });
  it('the 3D held back, then the thread itself late: the level steps down instead, not both', () => {
    const l = new Load(); l.setQuality(2); l.outputSafe = true;
    let t = run(l, 0, 3000, 60);
    expect(l.slow3d).toBeGreaterThan(0);
    l.threadLate = 6;
    t = run(l, t, t + 600, 60);
    expect(l.slow3d).toBe(0);
  });
  it('the thread itself late (the same computer, busy): the 3D gives way to it too, and comes back when it\'s on time', () => {
    const l = new Load(); l.setQuality(2); l.outputSafe = true; l.threadLate = 6;
    let t = run(l, 0, 6000, 25);              // (the page's own frames on time)
    expect(l.level).toBeLessThan(2);
    l.threadLate = 0;
    t = run(l, t, t + 40_000, 25);
    expect([l.level, l.level2d, l.uiEvery]).toEqual([2, 2, 1]);
  });
  it('starts at the quality chosen (not at High and brought down later)', () => {
    localStorage.setItem('luxdmx.seq.quality', '1');
    const l = new Load();
    expect([l.quality, l.level, l.level2d]).toEqual([1, 1, 1]);
    localStorage.removeItem('luxdmx.seq.quality');
  });
  it('nothing chosen yet: High (not Low)', () => {
    localStorage.removeItem('luxdmx.seq.quality');
    expect(new Load().quality).toBe(2);
    localStorage.setItem('luxdmx.seq.quality', '0');
    expect(new Load().quality).toBe(0);
    localStorage.removeItem('luxdmx.seq.quality');
  });
});
