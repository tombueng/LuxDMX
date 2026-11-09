// A head's place, turn and offsets worked out from where it was steered onto marks on the stage.
// The truth is made up; the "real" pan and tilt for each mark come from it, the solver starts from
// where the show thinks the light is and has to find the truth again.
import { describe, expect, it } from 'vitest';
import { aimAt, beamDir, pivotOf, type Optics, type V3 } from '../stage3d/geometry';
import { matOf, missOf, rotOf, solvePose, type Pose, type Sighting } from './calibrate';

const O: Optics = { panDeg: 540, tiltDeg: 270, panOffset: 0, tiltOffset: 0, invertPan: false, invertTilt: false };
const DECK = 1.2;
// a rectangle of tape on the deck and one in the middle, as the consoles suggest
const MARKS: V3[] = [{ x: -3, y: DECK, z: 1.5 }, { x: 3, y: DECK, z: 1.5 }, { x: -3, y: DECK, z: -2.5 }, { x: 3, y: DECK, z: -2.5 }, { x: 0, y: DECK, z: -0.5 }];
const optics = (p: Pose): Optics => ({ ...O, panOffset: p.panOffset, tiltOffset: p.tiltOffset, invertPan: p.invertPan, invertTilt: p.invertTilt,
  panDeg: O.panDeg * (p.panReversed ? -1 : 1), tiltDeg: O.tiltDeg * (p.tiltReversed ? -1 : 1) });
// what the real head needs to hit each mark (the person steering it there), with a little shake
function sight(truth: Pose, marks = MARKS, shake = 0, seed = 1): Sighting[] {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  return marks.map((m) => {
    const a = aimAt(truth.p, truth.rot, m, optics(truth))!;
    return { mark: m, pan: a.pan + rnd() * 2 * shake / O.panDeg, tilt: a.tilt + rnd() * 2 * shake / O.tiltDeg };
  });
}
const dist = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
// where a pose's beam lands, for DMX worked out with another pose: how far apart (m)
function aimedMiss(fit: Pose, truth: Pose, target: V3) {
  const a = aimAt(fit.p, fit.rot, target, optics(fit))!;
  return missOf(truth, optics(truth), { mark: target, pan: a.pan, tilt: a.tilt });
}

const hung: Pose = { p: { x: 2.1, y: 7.2, z: 3.3 }, rot: { yaw: 8, pitch: 4, roll: 180 }, panOffset: 12, tiltOffset: -3, invertPan: false, invertTilt: false };
// where the show thinks it is: on the front truss, straight, no offsets
const guess: Pose = { p: { x: 1.4, y: 6.65, z: 3.4 }, rot: { yaw: 0, pitch: 0, roll: 180 }, panOffset: 0, tiltOffset: 0, invertPan: false, invertTilt: false };

describe('turns as matrices', () => {
  it('a turn goes to a matrix and back', () => {
    for (const r of [{ yaw: 30, pitch: 20, roll: -50 }, { yaw: -120, pitch: -60, roll: 180 }, { yaw: 0, pitch: 0, roll: 180 }]) {
      const back = rotOf(matOf(r)), m1 = matOf(r), m2 = matOf(back);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(m2[i][j]).toBeCloseTo(m1[i][j], 9);
    }
    const g = matOf(rotOf(matOf({ yaw: 40, pitch: 90, roll: 10 })));   // straight up or down: yaw and roll merge
    const m = matOf({ yaw: 40, pitch: 90, roll: 10 });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(g[i][j]).toBeCloseTo(m[i][j], 9);
  });
});

describe('a head found from four marks', () => {
  it('a hung head 70 cm off and turned: its place, turn and offsets, and then it hits anything', () => {
    const fit = solvePose(guess, O, sight(hung, MARKS.slice(0, 4)))!;
    expect(fit.worst).toBeLessThan(0.005);
    expect(dist(fit.p, hung.p)).toBeLessThan(0.01);
    expect(fit.tiltOffset).toBeCloseTo(hung.tiltOffset, 1);
    // the same beams for any DMX: pointed at a new spot with the fit, the real one gets there
    for (const t of [{ x: 0, y: DECK, z: 0 }, { x: -5, y: 0, z: 6 }, { x: 4, y: DECK, z: -3 }]) expect(aimedMiss(fit, hung, t)).toBeLessThan(0.01);
    // and its beam for some DMX is the true one
    const d1 = beamDir(0.3, 0.7, fit.rot, optics(fit)), d2 = beamDir(0.3, 0.7, hung.rot, optics(hung));
    expect(Math.hypot(d1.x - d2.x, d1.y - d2.y, d1.z - d2.z)).toBeLessThan(1e-3);
    expect(dist(pivotOf(fit.p, fit.rot), pivotOf(hung.p, hung.rot))).toBeLessThan(0.01);
  });
  it('steered by eye (a third of a degree of shake): within a few centimetres on the stage', () => {
    const fit = solvePose(guess, O, sight(hung, MARKS, 0.3, 7))!;
    expect(fit.worst).toBeLessThan(0.08);
    expect(aimedMiss(fit, hung, { x: 0, y: DECK, z: 0 })).toBeLessThan(0.08);
    expect(aimedMiss(fit, hung, { x: -2, y: DECK, z: 2 })).toBeLessThan(0.08);
  });
  it('a head that pans the other way round from its type: its invert left alone, found turned over, and it points right', () => {
    // (the real one moves as if pan were inverted; the show's setting says it isn't)
    const truth = { ...hung, invertPan: true };
    const fit = solvePose(guess, O, sight(truth, MARKS.slice(0, 4)))!;
    expect(fit.invertPan).toBe(false);
    expect(fit.panReversed).toBe(true);
    expect(fit.worst).toBeLessThan(0.005);
    // what the show will send with the fit (invert off) puts the real beam where it's aimed
    for (const t of [{ x: 1, y: DECK, z: 0 }, { x: -3, y: 0, z: 5 }]) {
      const a = aimAt(fit.p, fit.rot, t, optics(fit))!;
      expect(missOf(truth, optics(truth), { mark: t, pan: a.pan, tilt: a.tilt })).toBeLessThan(0.01);
    }
  });
  it('marks all on the deck (one plane): a head standing there is found standing, not as its mirror image hung under the deck', () => {
    // the show has it hung on the truss; it really stands on the deck at the front
    const truth: Pose = { p: { x: 1.5, y: DECK, z: 3 }, rot: { yaw: 0, pitch: 0, roll: 0 }, panOffset: 4, tiltOffset: 0, invertPan: false, invertTilt: false };
    const fit = solvePose(guess, O, sight(truth, MARKS.slice(0, 4)))!;
    expect(fit.panReversed ?? false).toBe(false);
    expect(fit.worst).toBeLessThan(0.005);
    expect(dist(pivotOf(fit.p, fit.rot), pivotOf(truth.p, truth.rot))).toBeLessThan(0.02);
    // off the deck too: a spot in the air, and one on the back wall
    for (const t of [{ x: 0, y: DECK + 1.7, z: 0 }, { x: 2, y: 5, z: 1 }]) expect(aimedMiss(fit, truth, t)).toBeLessThan(0.02);
    // (and it says the marks could also mean its mirror image: one at another height settles it)
    expect(fit.twin).toBe(true);
    const settled = solvePose(guess, O, sight(truth, [...MARKS.slice(0, 4), { x: 0, y: DECK + 0.8, z: -0.5 }]))!;
    expect(settled.twin).toBeUndefined();
    expect(settled.panReversed ?? false).toBe(false);
  });
  it('and a hung one the show has standing on the floor: hung, not under the floor', () => {
    const start: Pose = { p: { x: 1.4, y: 0, z: 3.4 }, rot: { yaw: 0, pitch: 0, roll: 0 }, panOffset: 0, tiltOffset: 0, invertPan: false, invertTilt: false };
    const fit = solvePose(start, O, sight(hung, MARKS.slice(0, 4)))!;
    expect(fit.p.y).toBeGreaterThan(5);
    expect(fit.panReversed ?? false).toBe(false);
    expect(aimedMiss(fit, hung, { x: 0, y: DECK + 1.7, z: 0 })).toBeLessThan(0.02);
  });
  it('a head standing on the floor at the side, turned 25° the show doesn\'t know about', () => {
    const truth: Pose = { p: { x: -5.2, y: 0, z: 4.1 }, rot: { yaw: 25, pitch: 0, roll: 0 }, panOffset: -7, tiltOffset: 2, invertPan: false, invertTilt: false };
    const start: Pose = { p: { x: -4.5, y: 0, z: 4.5 }, rot: { yaw: 0, pitch: 0, roll: 0 }, panOffset: 0, tiltOffset: 0, invertPan: false, invertTilt: false };
    const fit = solvePose(start, O, sight(truth, MARKS.slice(0, 4)))!;
    expect(fit.worst).toBeLessThan(0.005);
    expect(aimedMiss(fit, truth, { x: 0, y: DECK, z: 0 })).toBeLessThan(0.01);
  });
  it('three marks: the tilt offset stays as it was, the rest is found', () => {
    const truth = { ...hung, tiltOffset: 0 };
    const fit = solvePose(guess, O, sight(truth, MARKS.slice(0, 3)))!;
    expect(fit.tiltOffset).toBe(0);
    expect(fit.worst).toBeLessThan(0.01);
    expect(aimedMiss(fit, truth, { x: 0, y: DECK, z: 0 })).toBeLessThan(0.03);
  });
  it('a mark it was steered to wrongly shows up as a big miss', () => {
    const seen = sight(hung, MARKS);
    seen[2] = { ...seen[2], pan: seen[2].pan + 8 / 540 };
    const fit = solvePose(guess, O, seen)!;
    expect(fit.worst).toBeGreaterThan(0.1);
    expect(fit.errs.indexOf(fit.worst)).toBeGreaterThanOrEqual(0);
  });
  it('two marks are not enough', () => {
    expect(solvePose(guess, O, sight(hung, MARKS.slice(0, 2)))).toBeUndefined();
  });
});
