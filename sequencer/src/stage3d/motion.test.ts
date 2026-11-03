// The heads' motors: never faster than a real head, there in about the time a real one takes, no
// overshoot, and a long gap puts them straight where they should be.
import { describe, expect, it } from 'vitest';
import { ACCEL, PAN_SPEED, TILT_SPEED, slew, type Axis } from './motion';

const run = (a: Axis, target: number | ((t: number) => number), seconds: number, speed = PAN_SPEED, dt = 1 / 60) => {
  const at: number[] = [];
  for (let t = 0; t < seconds; t += dt) at.push(slew(a, typeof target === 'number' ? target : target(t), dt, speed));
  return at;
};

describe('a moving head\'s motors', () => {
  it('a full pan (540°) takes about two seconds, never faster than the top speed, and stops on it', () => {
    const a: Axis = { at: -270, v: 0 };
    const at = run(a, 270, 3);
    for (let i = 1; i < at.length; i++) expect(Math.abs(at[i] - at[i - 1])).toBeLessThanOrEqual(PAN_SPEED / 60 + 1e-9);
    const there = at.findIndex((x) => Math.abs(x - 270) < 0.01) / 60;
    expect(there).toBeGreaterThan(540 / PAN_SPEED);           // (it has to speed up and brake)
    expect(there).toBeLessThan(540 / PAN_SPEED + PAN_SPEED / ACCEL + 0.1);
    expect(Math.max(...at)).toBeLessThanOrEqual(270);          // no overshoot
    expect(at.at(-1)).toBe(270); expect(a.v).toBe(0);
  });
  it('a small move is quick and lands exactly', () => {
    const a: Axis = { at: 10, v: 0 };
    const at = run(a, 12, 0.3, TILT_SPEED);
    expect(at.at(-1)).toBe(12);
    expect(at.findIndex((x) => x === 12) / 60).toBeLessThan(0.1);
  });
  it('a sweep too fast to follow comes out smaller and smooth, not as jumps', () => {
    // ±90° four times a second: 1440°/s at its fastest, far past any head
    const a: Axis = { at: 0, v: 0 };
    const at = run(a, (t) => 90 * Math.sin(2 * Math.PI * 4 * t), 3).slice(60);
    expect(Math.max(...at)).toBeLessThan(45);
    for (let i = 1; i < at.length; i++) expect(Math.abs(at[i] - at[i - 1])).toBeLessThanOrEqual(PAN_SPEED / 60 + 1e-9);
  });
  it('a slow move is followed exactly (a little behind)', () => {
    const a: Axis = { at: 0, v: 0 };
    const at = run(a, (t) => 20 * t, 2);                     // 20°/s
    expect(Math.abs(at.at(-1)! - 40)).toBeLessThan(1);
  });
  it('a long gap (a hidden tab) or the first frame: straight where it should be', () => {
    const a: Axis = { at: 0, v: 0 };
    expect(slew(a, 200, 1, PAN_SPEED)).toBe(200);
    expect(slew({ at: NaN, v: 0 }, 30, 1 / 60, PAN_SPEED)).toBe(30);
    expect(slew(a, 100, 0, PAN_SPEED)).toBe(200);              // no time: nowhere
  });
});
