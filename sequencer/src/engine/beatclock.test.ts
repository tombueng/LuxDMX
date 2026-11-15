// The beat clock while a song plays: the page puts it on the song's beat every frame, and the frame
// works out the look right after. It counts on from that moment, not from the last frame: it added
// the whole frame's time on top, a frame ahead of the song, and with uneven frames (a busy page:
// 50 ms, then 20) it went back and forth: every tempo effect two steps on, one back.
import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { emptyShow } from '../model/format';

describe('the beat clock on a song', () => {
  it('right after the song set it, the frame takes it as it is', () => {
    let t = 0;
    const e = new Engine(() => emptyShow(), () => t);
    e.bpm = 120;
    e.tick();
    t = 0.05; e.syncBeats(10); e.tick();
    expect(e.beatCount).toBeCloseTo(10, 9);
  });
  it('uneven frames, the song even: the beat never steps back', () => {
    let t = 0;
    const e = new Engine(() => emptyShow(), () => t);
    e.bpm = 120;
    e.tick();
    const gaps = [0.025, 0.06, 0.02, 0.055, 0.015, 0.025, 0.07, 0.01];
    let last = -Infinity;
    for (const g of gaps) {
      t += g;
      e.syncBeats(t * 2);               // (the song's beat at 120: two a second)
      e.tick();
      expect(e.beatCount).toBeGreaterThanOrEqual(last);
      expect(e.beatCount).toBeCloseTo(t * 2, 9);
      last = e.beatCount;
    }
  });
  it('no song: on by the time between frames, as before', () => {
    let t = 0;
    const e = new Engine(() => emptyShow(), () => t);
    e.bpm = 120;
    e.tick();
    t = 0.5; e.tick();
    t = 1.25; e.tick();
    expect(e.beatCount).toBeCloseTo(2.5, 9);
  });
});
