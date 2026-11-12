// Where a moving head really hangs, worked out from where it points: it's steered by hand onto a few
// marks on the stage whose places are known (tape on the floor), and from the pan and tilt it took
// to reach each one this finds its place, how it's turned and its pan and tilt offsets, the way the
// big consoles do it (grandMA3's position calibration, Eos' fixture position estimation). Four
// marks, spread out, pin all of it down; three do when the tilt offset is left as it is.
//
// Unknowns: the place (x, y, z), two turns about the light's own sideways axes (a turn about its
// own up is the same as a pan offset, so that's the pan offset), the pan offset and the tilt
// offset. Each mark gives two equations (a direction). Solved by least squares
// (Levenberg-Marquardt), from several starts, keeping the best fit; the light's invert settings
// stay as they are.
import { headAngles, headLocal, pivotOf, toWorld, type Optics, type Rot, type V3 } from '../stage3d/geometry';

export interface Sighting { mark: V3; pan: number; tilt: number }   // the motors' pan and tilt, 0..1
// (panReversed, tiltReversed: the light's pan or tilt turns the other way round from its type's: the
// model's range counts backwards, the DMX stays)
export interface Pose { p: V3; rot: Rot; panOffset: number; tiltOffset: number; invertPan: boolean; invertTilt: boolean; panReversed?: boolean; tiltReversed?: boolean }
// errs: how far off each mark the model's beam lands (m); twin: the marks fit a quite different
// head just as well (its mirror image through the deck, when they're all at one height);
// panDeg / tiltDeg: how far pan and tilt really go, when there were marks enough to tell (six or
// more), else the ranges it was given
// rangeUnsure: the marks hint that the ranges are off, but not clearly enough to say how far (more
// marks, one at another height, would tell)
export interface Fit extends Pose { errs: number[]; worst: number; twin?: boolean; panDeg: number; tiltDeg: number; ranged: boolean; rangeUnsure?: boolean }

type M3 = number[][];
const RAD = Math.PI / 180;
const mul = (a: M3, b: M3): M3 => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
const rx = (a: number): M3 => { const c = Math.cos(a * RAD), s = Math.sin(a * RAD); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
const ry = (a: number): M3 => { const c = Math.cos(a * RAD), s = Math.sin(a * RAD); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
const rz = (a: number): M3 => { const c = Math.cos(a * RAD), s = Math.sin(a * RAD); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
// (geometry.ts' toWorld: roll, then pitch, then yaw)
export const matOf = (r: Rot): M3 => mul(ry(r.yaw), mul(rx(r.pitch), rz(r.roll)));
export function rotOf(m: M3): Rot {
  const sp = Math.max(-1, Math.min(1, -m[1][2])), pitch = Math.asin(sp) / RAD;
  if (Math.abs(sp) > 0.99999) return { yaw: (sp > 0 ? Math.atan2(m[0][1], m[0][0]) : Math.atan2(-m[0][1], m[0][0])) / RAD, pitch, roll: 0 };
  return { yaw: Math.atan2(m[0][2], m[2][2]) / RAD, pitch, roll: Math.atan2(m[1][0], m[1][1]) / RAD };
}

const sub3 = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len3 = (a: V3) => Math.hypot(a.x, a.y, a.z);
// q: [x, y, z, turn about own x, turn about own z, pan offset, tilt offset, pan range, tilt range]
// (the ranges as u: the range is the given one times e^tanh(u), so 0.37 to 2.7 times it, and 1 at 0)
const rangeOf = (u: number) => Math.exp(Math.tanh(u));
type Ranged = Pose & { ks?: [number, number] };
function poseOf(q: number[], r0: M3, inv: [boolean, boolean], rev: [boolean, boolean]): Ranged {
  return { p: { x: q[0], y: q[1], z: q[2] }, rot: rotOf(mul(r0, mul(rx(q[3]), rz(q[4])))), panOffset: q[5], tiltOffset: q[6], invertPan: inv[0], invertTilt: inv[1], panReversed: rev[0], tiltReversed: rev[1],
    ks: [rangeOf(q[7] ?? 0), rangeOf(q[8] ?? 0)] };
}
// (o's ranges as the light has them now, or as the fit has them; the pose says whether they count backwards)
function opticsFor(pose: Ranged, o: Optics): Optics {
  const [kp, kt] = pose.ks ?? [1, 1];
  return { ...o, panDeg: Math.abs(o.panDeg) * kp * (pose.panReversed ? -1 : 1), tiltDeg: Math.abs(o.tiltDeg) * kt * (pose.tiltReversed ? -1 : 1),
    panOffset: pose.panOffset, tiltOffset: pose.tiltOffset, invertPan: pose.invertPan, invertTilt: pose.invertTilt, swap: false };
}
function beamOf(pose: Ranged, o: Optics, s: Sighting): { from: V3; dir: V3 } {
  const a = headAngles(s.pan, s.tilt, opticsFor(pose, o));
  return { from: pivotOf(pose.p, pose.rot), dir: toWorld(headLocal(a.p, a.t), pose.rot) };
}
function residuals(pose: Ranged, o: Optics, seen: Sighting[]): number[] {
  const out: number[] = [];
  for (const s of seen) {
    const { from, dir } = beamOf(pose, o, s), to = sub3(s.mark, from), l = len3(to) || 1;
    out.push(dir.x - to.x / l, dir.y - to.y / l, dir.z - to.z / l);
  }
  return out;
}
// How far from the mark the model's beam goes by (m): the miss at the mark's distance.
export function missOf(pose: Ranged, o: Optics, s: Sighting): number {
  const { from, dir } = beamOf(pose, o, s), to = sub3(s.mark, from), along = to.x * dir.x + to.y * dir.y + to.z * dir.z;
  if (along <= 0) return len3(to) * 2;
  return len3(sub3(to, { x: dir.x * along, y: dir.y * along, z: dir.z * along }));
}

function solveLinear(a: number[][], b: number[]): number[] | undefined {
  const n = b.length, m = a.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-14) return undefined;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = m[r][c] / m[c][c];
      for (let j = c; j <= n; j++) m[r][j] -= k * m[c][j];
    }
  }
  return m.map((r, i) => r[n] / r[i]);
}

function lm(q0: number[], free: boolean[], cost: (q: number[]) => number[]): { q: number[]; ss: number } {
  let q = [...q0], r = cost(q), ss = r.reduce((s, v) => s + v * v, 0), lambda = 1e-3;
  const H = [1e-5, 1e-5, 1e-5, 1e-4, 1e-4, 1e-4, 1e-4, 1e-5, 1e-5];
  const idx = free.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
  for (let it = 0; it < 200; it++) {
    const J = idx.map((i) => { const a = [...q], b = [...q]; a[i] += H[i]; b[i] -= H[i]; const ra = cost(a), rb = cost(b); return ra.map((v, k) => (v - rb[k]) / (2 * H[i])); });
    const JtJ = idx.map((_, i) => idx.map((_, j) => J[i].reduce((s, v, k) => s + v * J[j][k], 0)));
    const Jtr = idx.map((_, i) => J[i].reduce((s, v, k) => s + v * r[k], 0));
    let stepped = false;
    for (let tries = 0; tries < 12 && !stepped; tries++) {
      const A = JtJ.map((row, i) => row.map((v, j) => (i === j ? v + lambda * (v || 1e-9) : v)));
      const d = solveLinear(A, Jtr.map((v) => -v));
      if (!d) { lambda *= 10; continue; }
      const qn = [...q];
      idx.forEach((i, k) => (qn[i] += d[k]));
      const rn = cost(qn), sn = rn.reduce((s, v) => s + v * v, 0);
      if (sn < ss) {
        const done = ss - sn < 1e-16 * (1 + ss) && Math.max(...d.map(Math.abs)) < 1e-9;
        q = qn; r = rn; ss = sn; lambda = Math.max(1e-9, lambda / 3); stepped = true;
        if (done) return { q, ss };
      } else lambda *= 8;
    }
    if (!stepped) break;
  }
  return { q, ss };
}

// The pose that explains the sightings best. `start` is where the show thinks the light is (it
// only needs to be roughly right: a few metres, a few tens of degrees). With fewer than four marks
// the tilt offset stays as it is; with six or more, one at least 40 cm off the others' height (and `ranges`), how far pan and tilt really go
// is worked out too, so a head whose manual (or profile) has it wrong still meets its marks.
// The ranges are only worked out from marks that can tell them from a moved head: six or more, at
// least one 40 cm higher or lower than the rest (with every mark in one plane a head's height and
// its tilt range trade off against each other).
export const RANGE_MARKS = 6, RANGE_HEIGHT = 0.4;
export function canMeasureRanges(marks: V3[]): boolean {
  if (marks.length < RANGE_MARKS) return false;
  const ys = marks.map((m) => m.y);
  return Math.max(...ys) - Math.min(...ys) >= RANGE_HEIGHT;
}
export function solvePose(start: Pose, o: Optics, seen: Sighting[], ranges = true): Fit | undefined {
  if (seen.length < 3) return undefined;
  const r0 = matOf(start.rot), tiltFree = seen.length >= 4, rangeFree = ranges && canMeasureRanges(seen.map((x) => x.mark));
  const fixed = [true, true, true, true, true, true, tiltFree, false, false];
  // Several starts (a head's pan offset can be anywhere round). The light's invert settings stay:
  // they turn the DMX and the model round together, so flipping one here would point it wrong. A
  // head whose pan or tilt really turns the other way round from its type (a mirror, which no turn
  // can make) is found as that: pan reversed, for the model only. (A reversed tilt is never needed:
  // to the beams it's the same as a pan offset of 180°.) Marks all on the deck lie in one plane,
  // and then a head's mirror image through it fits them just as well, and so does a head turned
  // over with its tilt offset near 180°. Among fits as good as the best (within a centimetre at the
  // marks): one under the floor is out, and one whose tilt is offset more than 60° (no real head's
  // is); then the one that changes fewer of its settings wins (a reversed head is rare, a show that
  // has it hung when it stands isn't), then the one nearest to how the show says it's mounted, then
  // the smaller offsets.
  type F = { q: number[]; rev: [boolean, boolean]; pose: Ranged; worst: number; turn: number; flips: number; offs: number; tilt: number };
  const inv: [boolean, boolean] = [start.invertPan, start.invertTilt];
  const was: [boolean, boolean] = [!!start.panReversed, !!start.tiltReversed];
  const off = (a: number) => Math.abs(((a % 360) + 540) % 360 - 180);
  const fitFrom = (q0: number[], rev: [boolean, boolean], free: boolean[], marks = seen): F => {
    // (with the ranges free: a small pull back to the given ones, so they only move when the marks need it)
    const { q } = lm(q0, free, (q) => { const r = residuals(poseOf(q, r0, inv, rev), o, marks); if (free[7]) r.push(1e-3 * q[7], 1e-3 * q[8]); return r; });
    const pose = poseOf(q, r0, inv, rev);
    return { q, rev, pose, worst: Math.max(...seen.map((s) => missOf(pose, o, s))), turn: off(q[3]) + off(q[4]),
      flips: Number(rev[0] !== was[0]), offs: off(q[5]) + off(q[6]), tilt: off(q[6]) };
  };
  const pick = (fits: F[]) => {
    const bestWorst = Math.min(...fits.map((f) => f.worst));
    // (each rule only when something is left after it)
    let good = fits.filter((f) => f.worst <= bestWorst + 0.01);
    for (const ok of [(f: F) => f.pose.p.y > -0.1, (f: F) => f.tilt <= 60]) { const g = good.filter(ok); if (g.length) good = g; }
    good.sort((a, b) => (a.flips !== b.flips ? a.flips - b.flips : Math.abs(a.turn - b.turn) > 1 ? a.turn - b.turn : a.offs - b.offs));
    return { best: good[0], good };
  };
  let fits: F[] = [];
  for (const rev of [was, [!was[0], was[1]]] as [boolean, boolean][])
    for (const dp of [0, 90, -90, 180]) for (const dt of tiltFree ? [0, 90, -90] : [0]) for (const tx of [0, 180])
      // (tx: from the show's mounting and from it turned over, which the fit can't reach on its own)
      fits.push(fitFrom([start.p.x, start.p.y, start.p.z, tx, 0, start.panOffset + dp, start.tiltOffset + dt, 0, 0], rev, fixed));
  let { best, good } = pick(fits);
  // The marks don't meet with the ranges it has (its manual or profile has them wrong): with six
  // marks or more, the best few fits go on with the ranges free too. Taken only when that's much
  // better (the ranges are worked out, not guessed into a twin).
  let ranged = false, rangeUnsure = false;
  if (rangeFree && best.worst > 0.01) {
    const seeds = [...fits].sort((a, b) => a.worst - b.worst).slice(0, 8);
    const ranges7 = [...fixed.slice(0, 7), true, true];
    const freed = seeds.map((f) => fitFrom(f.q, f.rev, ranges7));
    const r = pick(freed);
    const ks = r.best.pose.ks ?? [1, 1], differs = Math.abs(ks[0] - 1) > 0.03 || Math.abs(ks[1] - 1) > 0.03;
    if (r.best.worst < best.worst * 0.5 && differs) {
      // Leave one out: each mark worked out from the others, with the ranges free and with them as
      // given. Taken only when the measured ranges predict the marks clearly better (not just fit
      // the ones they were made from).
      const loo = (from: F, free: boolean[]) => seen.reduce((sum, s, i) => {
        const rest = seen.filter((_, j) => j !== i), f = fitFrom(from.q, from.rev, free, rest);
        return sum + missOf(f.pose, o, s);
      }, 0) / seen.length;
      const withRanges = loo(r.best, ranges7), without = loo(best, fixed);
      if (withRanges < without * 0.7) { ({ best, good } = r); fits = freed; ranged = true; } else rangeUnsure = true;
    } else if (differs) rangeUnsure = true;
  }
  // (a twin: pan the other way round, and its pivot elsewhere or it hangs where the other stands)
  const pv = (q: Pose) => pivotOf(q.p, q.rot), up = (q: Pose) => matOf(q.rot)[1][1];
  const twin = good.some((f) => { const a = pv(f.pose), b = pv(best.pose);
    return f.flips !== best.flips && (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 0.1 || up(f.pose) * up(best.pose) < 0); });
  const ks = best.pose.ks ?? [1, 1];
  const panDeg = r2(Math.abs(o.panDeg) * ks[0]), tiltDeg = r2(Math.abs(o.tiltDeg) * ks[1]);
  const { ks: _k, ...plain } = best.pose;
  const pose = tidy(plain);
  // (measured with the rounded ranges, as they'll be kept)
  const kept: Ranged = { ...pose, ks: [panDeg / Math.abs(o.panDeg), tiltDeg / Math.abs(o.tiltDeg)] };
  const errs = seen.map((s) => missOf(kept, o, s));
  return { ...pose, errs, worst: Math.max(...errs), ...(twin ? { twin } : {}), panDeg, tiltDeg, ranged, ...(rangeUnsure ? { rangeUnsure } : {}) };
}

const wrap = (a: number) => { const w = ((a % 360) + 540) % 360 - 180; return w === -180 ? 180 : w; };
const r3 = (v: number) => Math.round(v * 1000) / 1000 + 0;
const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
// Rounded to what a show file keeps (mm, a hundredth of a degree); the offsets within a turn.
function tidy(p: Pose): Pose {
  return {
    ...p, p: { x: r3(p.p.x), y: r3(p.p.y), z: r3(p.p.z) },
    rot: { yaw: r2(wrap(p.rot.yaw)), pitch: r2(p.rot.pitch), roll: r2(wrap(p.rot.roll)) },
    panOffset: r2(wrap(p.panOffset)), tiltOffset: r2(wrap(p.tiltOffset)),
  };
}
