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
  it('a slow frame counts the time that went by, as the real motors ran: no jump, no lag', () => {
    // 0.6 s in one frame (a busy machine) lands where 36 frames at 60 a second would
    const slow: Axis = { at: 0, v: 0 }, fast: Axis = { at: 0, v: 0 };
    slew(slow, 540, 0.6, PAN_SPEED);
    for (let i = 0; i < 36; i++) slew(fast, 540, 1 / 60, PAN_SPEED);
    expect(slow.at).toBeGreaterThan(100); expect(slow.at).toBeLessThan(200);   // on its way, not there
    expect(Math.abs(slow.at - fast.at)).toBeLessThan(3);
    expect(Math.abs(slow.v - fast.v)).toBeLessThan(5);
    // and 2.5 s in one go: there, as a real head would be
    expect(slew({ at: 0, v: 0 }, 540, 2.5, PAN_SPEED)).toBe(540);
  });
  it('a long gap (a hidden tab) or the first frame: straight where it should be', () => {
    const a: Axis = { at: 0, v: 0 };
    expect(slew(a, 20000, 5, PAN_SPEED)).toBe(20000);              // (far beyond what 5 s would reach)
    a.at = 200;
    expect(slew({ at: NaN, v: 0 }, 30, 1 / 60, PAN_SPEED)).toBe(30);
    expect(slew(a, 100, 0, PAN_SPEED)).toBe(200);              // no time: nowhere
  });
});
