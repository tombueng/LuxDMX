// More than two axes on a head: endless pan, tilt or roll turn round and round while their turning
// channel says so, and come back to their position the short way when it stops; a plain move is a
// plain move (never "the short way" round when it never spun).
import { describe, expect, it } from 'vitest';
import { axisTo } from './rig';
import { PAN_SPEED } from './motion';

const R = [{ from: 0, to: 9, label: 'Off' }, { from: 10, to: 127, label: 'Rotation CW fast..slow' }, { from: 128, to: 137, label: 'Stop' }, { from: 138, to: 255, label: 'Rotation CCW slow..fast' }];
const run = (a: { at: number; v: number }, target: number, x: number | undefined, secs: number, ranges: typeof R | null | undefined = R) => {
  for (let t = 0; t < secs; t += 1 / 60) axisTo(a, target, 1 / 60, PAN_SPEED, ranges, x);
  return a.at;
};

describe('an endless axis', () => {
  it('turns round and round while a turning range is on: CW on, CCW back, past any range a position has', () => {
    const a = { at: 0, v: 0 };
    expect(run(a, 0, 20 / 255, 4)).toBeGreaterThan(400);          // fast CW: well past a full turn in 4 s
    const b = { at: 0, v: 0 };
    expect(run(b, 0, 250 / 255, 4)).toBeLessThan(-400);           // fast CCW
    const c = { at: 0, v: 0 };
    expect(run(c, 0, 120 / 255, 4)).toBeLessThan(run({ at: 0, v: 0 }, 0, 20 / 255, 4));   // slow CW slower than fast CW
  });
  it('stopped (Stop or Off): back to its position the short way round, from however far it went', () => {
    const a = { at: 0, v: 0 };
    run(a, 90, 20 / 255, 3.3);                                    // turned on a long way
    const turned = a.at;
    run(a, 90, 5 / 255, 3);                                       // Off: to its position
    expect(Math.abs(a.at - 90) % 360).toBeLessThan(1);
    // (never more than half a turn of travel back: the angle is the same place give or take whole turns)
    expect(Math.abs((((a.at - turned) % 360) + 540) % 360 - 180)).toBeLessThanOrEqual(181);
  });
  it('a plain move over more than half a turn is just a move (it never spun): no jump', () => {
    const a = { at: -200, v: 0 };
    axisTo(a, 250, 1 / 60, PAN_SPEED, R, 5 / 255);
    expect(a.at).toBeLessThan(-190);                              // (on its way from -200, not put at -110)
    expect(run(a, 250, 5 / 255, 3)).toBeCloseTo(250, 0);
  });
  it('a turning channel without ranges: 0 still, then faster one way', () => {
    const a = { at: 0, v: 0 };
    expect(run(a, 0, 0, 1, null)).toBe(0);
    expect(run(a, 0, 0.5, 1, null)).toBeGreaterThan(100);
  });
});
