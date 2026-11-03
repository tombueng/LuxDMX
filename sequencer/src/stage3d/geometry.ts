// The 3D stage's sums, without three.js (so they're tested on their own): where a light is, how it
// hangs, where its head points for a pan and tilt, and the pan and tilt that point it at a spot.
//
// Metres, y up. The deck's top is at DECK. The 2D plan's x (0..1, left to right as the audience
// sees it) and y (0 at the back, 1 at the front) map onto the deck: x -> -W/2..W/2, y -> -D/2..D/2
// (the audience is at +z).
//
// A light's own frame: up is +y (where a standing moving head's base faces), front +z. Its head
// at tilt 0° points straight up its base; pan turns about up, 0° tilting towards the front. DMX
// 50 % is 0° unless calibrated (panOffset, tiltOffset). Mounting turns the frame: yaw about y,
// then pitch about x, then roll about z (hanging = roll 180: up is down, front still the audience).
import type { Fixture } from '../model/types';
import type { FixtureKind } from '../model/library';

export const W = 14, D = 9, DECK = 1.2;
export const TRUSS = [{ z: -3.3, y: 8.2 }, { z: 0, y: 7.6 }, { z: 3.4, y: 7.0 }];   // back, mid, front (bottom chord heights)
export const TRUSS_HANG = 0.35;                                                    // a hung light sits this far under the truss

export interface V3 { x: number; y: number; z: number }
export interface Rot { yaw: number; pitch: number; roll: number }
export const RAD = Math.PI / 180;
const len = (v: V3) => Math.hypot(v.x, v.y, v.z);
export const norm = (v: V3): V3 => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };

// ---- rotations (degrees)
function rx(v: V3, a: number): V3 { const c = Math.cos(a * RAD), s = Math.sin(a * RAD); return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c }; }
function ry(v: V3, a: number): V3 { const c = Math.cos(a * RAD), s = Math.sin(a * RAD); return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c }; }
function rz(v: V3, a: number): V3 { const c = Math.cos(a * RAD), s = Math.sin(a * RAD); return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z }; }
export const toWorld = (v: V3, r: Rot) => ry(rx(rz(v, r.roll), r.pitch), r.yaw);
export const toLocal = (v: V3, r: Rot) => rz(rx(ry(v, -r.yaw), -r.pitch), -r.roll);

// ---- the room round the stage
// The 3D stage shows the show in a big hall (the numbers above: what the templates and the demo are
// laid out for) or in a small club or pub: a smaller deck under a low ceiling with a small rig of
// two trusses. The deck's height and its front edge are the same in both (the audience floor
// starts at z = D / 2), so what stands on the deck's front or on the floor in front of it is right
// in either. A light without a 3D place of its own goes where its plan position puts it in the
// room shown (a quarter across the plan is a quarter across that deck); a light placed by hand
// keeps its place (metres), whatever the room.
//
// Three more rooms come with their own demos: a club (a DJ on a stage framed in truss and LEDs, a
// truss over the dance floor), a party room (no stage: a square of truss over the crowd on four
// legs, a DJ table on the floor at one end) and an empty room with one straight truss for trying
// lights out. Their truss is a list of pieces (`frame`); a room without a stage has no deck
// (deck.x < 0: nothing is on it, what's put down stands on the floor).
export type RoomId = 'hall' | 'pub' | 'club' | 'party' | 'truss';
export type ViewKey = 'front' | 'foh' | 'side' | 'top' | 'band';
type P3 = [number, number, number];
// a piece of truss: the middle line of the box from one end to the other
export type Seg = [P3, P3];
export interface Room {
  id: RoomId;
  W: number; D: number; zc: number;             // the plan's area on the deck: width, depth, its middle (z)
  truss: { z: number; y: number }[];            // the trusses (bottom chord heights), back to front
  deck: { x: number; z0: number; z1: number };  // the deck's top: -x..x, z0..z1, at DECK
  ceiling: number;
  band: { x: number; z0: number; z1: number };  // where the band and its backline are (a take frames them)
  views: Record<ViewKey, { pos: P3; at: P3 }>;
  // Tour: the camera goes round (x = sin a * rx, z = z0 + cos a * rz) looking at `at`
  tour: { rx: number; rz: number; z0: number; y: number; dy: number; at: P3 };
  // the inside of the room: side walls at -x and x, the back wall at z0, the far one at z1
  walls: { x: number; z0: number; z1: number };
  // every piece of its truss, towers and legs included (the rooms built from a list)
  frame?: Seg[];
}
// a 0.3 m box truss whose bottom chord is at y: its middle line is 0.15 m higher
const mid = (y: number) => y + 0.15;
// a span across the room at z (bottom chord at y) from -x to x, and the towers under its ends
const span = (x: number, y: number, z: number): Seg => [[-x, mid(y), z], [x, mid(y), z]];
const towers = (x: number, y: number, z: number): Seg[] => [[[-x, 0, z], [-x, mid(y) + 0.15, z]], [[x, 0, z], [x, mid(y) + 0.15, z]]];
export const ROOMS: Record<RoomId, Room> = {
  hall: {
    id: 'hall', W, D, zc: 0, truss: TRUSS, deck: { x: W / 2 + 2, z0: -D / 2, z1: D / 2 }, ceiling: 15, band: { x: 5.3, z0: -3.9, z1: 3.4 }, walls: { x: 24, z0: -10, z1: 31 },
    views: { front: { pos: [0, 4.2, 24], at: [0, 3.2, 0] }, foh: { pos: [0, 3.6, D / 2 + 17], at: [0, 3.4, 0] }, side: { pos: [-22, 6, 6], at: [0, 3, 0] }, top: { pos: [0, 30, 0.01], at: [0, 0, 0] }, band: { pos: [0, 3.2, -1.2], at: [0, 4.5, 14] } },
    tour: { rx: 22, rz: 24, z0: 4, y: 5, dy: 2.5, at: [0, 3.2, 0] },      // (rx: inside the side walls at 24)
  },
  // a pub's music room: 9.2 m wide, the stage across its end, the bar at the back 14 m away
  pub: {
    id: 'pub', W: 7.6, D: 5.6, zc: 1.45, truss: [{ z: -0.2, y: 4.4 }, { z: 3.2, y: 4.3 }], deck: { x: 4.55, z0: -1.6, z1: D / 2 }, ceiling: 5.1, band: { x: 3.6, z0: -1.45, z1: 4.1 }, walls: { x: 4.6, z0: -1.8, z1: 14.6 },
    views: { front: { pos: [0, 2.75, 13.4], at: [0, 2.75, 1.2] }, foh: { pos: [3.3, 2.3, 10.6], at: [0, 2.6, 1.6] }, side: { pos: [-3.9, 3.1, 8.6], at: [0.6, 2.5, 1.2] }, top: { pos: [0, 24, 6.01], at: [0, 0, 6] }, band: { pos: [0, 3.25, 0.9], at: [0, 2.4, 13] } },
    tour: { rx: 3.3, rz: 3.6, z0: 8.2, y: 2.9, dy: 0.35, at: [0, 2.7, 1.2] },
  },
  // a club: a 12 m stage across a 20 m room, the DJ booth in the middle of it, two trusses on four
  // towers over the stage (joined along the sides), one more hung over the dance floor; the bar at
  // the back, 24 m from the stage's back wall
  club: {
    id: 'club', W: 10, D: 5.6, zc: 1.6, truss: [{ z: -1.0, y: 5.8 }, { z: 3.8, y: 5.8 }, { z: 9.5, y: 6.2 }], deck: { x: 6, z0: -1.6, z1: D / 2 }, ceiling: 8,
    band: { x: 4, z0: -1.6, z1: 4.5 }, walls: { x: 10, z0: -2.4, z1: 22 },
    frame: [span(6.6, 5.8, -1.0), span(6.6, 5.8, 3.8), ...towers(6.6, 5.8, -1.0), ...towers(6.6, 5.8, 3.8),
      [[-6.6, mid(5.8), -1.0], [-6.6, mid(5.8), 3.8]], [[6.6, mid(5.8), -1.0], [6.6, mid(5.8), 3.8]], span(7.5, 6.2, 9.5)],
    views: { front: { pos: [0, 3.4, 18], at: [0, 3.0, 1.5] }, foh: { pos: [3.5, 2.9, 14.5], at: [0, 3.0, 1.5] }, side: { pos: [-8.6, 4.6, 9.5], at: [0, 2.8, 2] }, top: { pos: [0, 28, 8.01], at: [0, 0, 8] }, band: { pos: [0.9, 3.4, 0.2], at: [0, 2.4, 14] } },
    tour: { rx: 7, rz: 7.5, z0: 9, y: 3.6, dy: 1, at: [0, 3, 1.5] },
  },
  // a party room (a warehouse, no stage): a 12 x 12 m square of truss over the crowd on four legs,
  // a span across its middle, a speaker stack in each corner of the room, the DJ's table on the
  // floor at the end the crowd faces
  party: {
    id: 'party', W: 12, D: 12, zc: 7.5, truss: [{ z: 1.5, y: 5.5 }, { z: 7.5, y: 5.5 }, { z: 13.5, y: 5.5 }], deck: { x: -1, z0: -2.7, z1: -2.7 }, ceiling: 8,
    band: { x: 6, z0: -0.5, z1: 14 }, walls: { x: 10, z0: -3, z1: 18 },
    frame: [span(6, 5.5, 1.5), span(6, 5.5, 7.5), span(6, 5.5, 13.5), [[-6, mid(5.5), 1.5], [-6, mid(5.5), 13.5]], [[6, mid(5.5), 1.5], [6, mid(5.5), 13.5]],
      ...towers(6, 5.5, 1.5), ...towers(6, 5.5, 13.5)],
    views: { front: { pos: [0, 4.4, 17.4], at: [0, 2.6, 4] }, foh: { pos: [6.5, 3.2, 16.5], at: [0, 2.6, 6] }, side: { pos: [-9.4, 6.2, 7.5], at: [0, 2.4, 7.5] }, top: { pos: [0, 28, 7.51], at: [0, 0, 7.5] }, band: { pos: [0.8, 2.4, -0.7], at: [0, 2.0, 12] } },
    tour: { rx: 8, rz: 8.5, z0: 7.5, y: 4.4, dy: 1, at: [0, 2.4, 7.5] },
  },
  // an empty room with one straight truss on two towers: two of every kind of light on it, the
  // machines on the floor in front (for trying things out)
  truss: {
    id: 'truss', W: 11, D: 6, zc: 3, truss: [{ z: 1.5, y: 4.0 }], deck: { x: -1, z0: -1.7, z1: -1.7 }, ceiling: 6,
    band: { x: 6.5, z0: 0.5, z1: 5 }, walls: { x: 8, z0: -2, z1: 14 },
    frame: [span(6.2, 4.0, 1.5), ...towers(6.2, 4.0, 1.5)],
    views: { front: { pos: [0, 2.6, 12.6], at: [0, 2.4, 2] }, foh: { pos: [4.6, 2.2, 10.4], at: [0, 2.4, 2.5] }, side: { pos: [-7.4, 3.0, 8], at: [0, 2.2, 2.5] }, top: { pos: [0, 22, 4.01], at: [0, 0, 4] }, band: { pos: [0, 1.7, 6.5], at: [0, 3.6, 1.5] } },
    tour: { rx: 6.2, rz: 6.5, z0: 5.6, y: 2.6, dy: 0.6, at: [0, 2.5, 2.5] },
  },
};
export const HALL = ROOMS.hall;
// The DJ in the rooms that have one: where the booth's middle is (on the floor or the deck) and
// where the DJ stands behind it, facing the crowd (+z)
export const DJ_BOOTH: Partial<Record<RoomId, { booth: V3; dj: V3 }>> = {
  club: { booth: { x: 0, y: DECK, z: 1.6 }, dj: { x: 0, y: DECK, z: 1.05 } },
  party: { booth: { x: 0, y: 0, z: 0.6 }, dj: { x: 0, y: 0, z: 0.05 } },
};
// the room a show asks for (anything else: the hall)
export const roomOf = (id: unknown): Room => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(ROOMS, id) ? ROOMS[id as RoomId] : ROOMS.hall);
// The room the 3D stage shows now: where beams land (hitFloor). Only the 3D stage sets it.
let shown: Room = HALL;
export function showRoom(r: Room) { shown = r; }
export const shownRoom = () => shown;
// on the deck's top (x, z), in a room
export const onDeck = (x: number, z: number, r: Room = HALL) => Math.abs(x) <= r.deck.x && z >= r.deck.z0 && z <= r.deck.z1;
// the height of what's under (x, z) in the room shown: the deck's top or the floor (what lands
// there lands on it: fog, confetti)
export const floorAt = (x: number, z: number) => (onDeck(x, z, shown) ? DECK : 0);
// the same in a room (a room without a deck: the floor everywhere)
export const groundAt = (x: number, z: number, r: Room) => (onDeck(x, z, r) ? DECK : 0);
// Tour: where the camera is at time t (seconds) in a room
export function tourAt(r: Room, t: number): P3 {
  const a = t * 0.07, o = r.tour;
  return [Math.sin(a) * o.rx, o.y + Math.sin(a * 0.7) * o.dy, Math.cos(a) * o.rz + o.z0];
}

// ---- where a light is
export const planToWorld = (x: number, y: number, r: Room = HALL): { x: number; z: number } => ({ x: (x - 0.5) * r.W, z: r.zc + (y - 0.5) * r.D });
export const worldToPlan = (x: number, z: number, r: Room = HALL) => ({ x: Math.max(0, Math.min(1, x / r.W + 0.5)), y: Math.max(0, Math.min(1, (z - r.zc) / r.D + 0.5)) });
const HUNG: FixtureKind[] = ['mover', 'par', 'strobe', 'dimmer', 'other'];
export const hangs = (k: FixtureKind) => HUNG.includes(k);
export function nearestTruss(z: number, r: Room = HALL) { return r.truss.reduce((a, b) => (Math.abs(b.z - z) < Math.abs(a.z - z) ? b : a)); }

// Where a light without a 3D place goes: movers, PARs and strobes on the nearest truss (hanging),
// bars, fog and the effect machines on the deck (standing). Its plan position stays its x and z
// (in the room shown: see Room).
export function defaultPlace(f: Pick<Fixture, 'x' | 'y'>, k: FixtureKind, r: Room = HALL): { p: V3; rot: Rot } {
  const w = planToWorld(f.x, f.y, r);
  if (hangs(k)) {
    const t = nearestTruss(w.z, r), p = { x: w.x, y: t.y - TRUSS_HANG, z: t.z };
    // movers hang straight; fixed lights tip towards the middle of the deck (or the floor, without one)
    return { p, rot: k === 'mover' ? { yaw: 0, pitch: 0, roll: 180 } : aimRot(p, { x: w.x * 0.6, y: groundAt(w.x * 0.6, r.zc + 0.6, r), z: r.zc + 0.6 }) };
  }
  const p = { x: w.x, y: groundAt(w.x, w.z, r), z: w.z };
  // bars lean well out towards the audience (straight up they'd light the roof); machines stand; a
  // fog machine blows at the band
  if (k === 'fog') return { p, rot: { yaw: faceBand(p), pitch: 0, roll: 0 } };
  return { p, rot: k === 'bar' ? { yaw: 0, pitch: 45, roll: 0 } : { yaw: 0, pitch: 0, roll: 0 } };
}
// where the band stands (the drum riser, the singer in front of it)
export const BAND: V3 = { x: 0, y: DECK, z: -1.6 };
// the yaw (degrees) that turns a machine's front towards the band
export const faceBand = (p: V3) => Math.round(Math.atan2(BAND.x - p.x, BAND.z - p.z) / RAD);
// the turn that points a light's up (its beam, for a fixed light) along p -> target
export function aimRot(p: V3, target: V3): Rot {
  const d = norm({ x: target.x - p.x, y: target.y - p.y, z: target.z - p.z });
  return { yaw: Math.atan2(d.x, d.z) / RAD, pitch: Math.acos(Math.max(-1, Math.min(1, d.y))) / RAD, roll: 0 };
}

// ---- where the head points
// swap: what a cue sends as pan drives the tilt motor and the other way round (render.ts does the
// same to the DMX); invert, range and offsets are the motors' own
export interface Optics { panDeg: number; tiltDeg: number; panOffset: number; tiltOffset: number; invertPan: boolean; invertTilt: boolean; swap?: boolean }
export function headAngles(pan: number, tilt: number, o: Optics) {
  const a = o.swap ? tilt : pan, b = o.swap ? pan : tilt;
  const pv = o.invertPan ? 1 - a : a, tv = o.invertTilt ? 1 - b : b;
  return { p: (pv - 0.5) * o.panDeg + o.panOffset, t: (tv - 0.5) * o.tiltDeg + o.tiltOffset };
}
// the head's direction in the light's own frame for pan p and tilt t (degrees)
export const headLocal = (p: number, t: number): V3 => ({ x: Math.sin(t * RAD) * Math.sin(p * RAD), y: Math.cos(t * RAD), z: Math.sin(t * RAD) * Math.cos(p * RAD) });
export function beamDir(pan: number, tilt: number, rot: Rot, o: Optics): V3 {
  const a = headAngles(pan, tilt, o);
  return toWorld(headLocal(a.p, a.t), rot);
}

// The pan and tilt (0..1) that point the head from `p` at `target`, within the light's range,
// the one nearest to where it is now (no needless swing round); undefined if it can't reach.
// (`p` is where the light is clamped; the beam turns about the head's pivot above it)
export function aimAt(clamp: V3, rot: Rot, target: V3, o: Optics, now?: { pan: number; tilt: number }): { pan: number; tilt: number } | undefined {
  const p = pivotOf(clamp, rot);
  const d = toLocal(norm({ x: target.x - p.x, y: target.y - p.y, z: target.z - p.z }), rot);
  const t0 = Math.acos(Math.max(-1, Math.min(1, d.y))) / RAD, p0 = Math.atan2(d.x, d.z) / RAD;
  // (worked out for the motors; a swapped head's cue values are the other way round)
  if (o.swap && now) now = { pan: now.tilt, tilt: now.pan };
  let best: { pan: number; tilt: number } | undefined, bestD = Infinity;
  // the same direction: (p, t) or (p + 180, -t); and pan a turn either way
  for (const [pa, ta] of [[p0, t0], [p0 + 180, -t0]] as const) {
    const tv = (ta - o.tiltOffset) / o.tiltDeg + 0.5;
    if (tv < -1e-6 || tv > 1 + 1e-6) continue;
    for (const k of [-2, -1, 0, 1, 2]) {
      const pv = (pa + k * 360 - o.panOffset) / o.panDeg + 0.5;
      if (pv < -1e-6 || pv > 1 + 1e-6) continue;
      const v = { pan: Math.max(0, Math.min(1, o.invertPan ? 1 - pv : pv)), tilt: Math.max(0, Math.min(1, o.invertTilt ? 1 - tv : tv)) };
      const dist = now ? Math.abs(v.pan - now.pan) + Math.abs(v.tilt - now.tilt) : Math.abs(v.pan - 0.5) + Math.abs(v.tilt - 0.5);
      if (dist < bestD) { bestD = dist; best = v; }
    }
  }
  return best && o.swap ? { pan: best.tilt, tilt: best.pan } : best;
}

// Where a beam from p along d meets the deck (or the floor in front of it); undefined if it doesn't
export const PIVOT_UP = 0.42;     // a moving head's tilt axis above its clamp/base (models.ts PIVOT)
// where a moving head's beam really starts turning from: its pivot, up its base from the clamp
export function pivotOf(p: V3, rot: Rot): V3 { const o = toWorld({ x: 0, y: PIVOT_UP, z: 0 }, rot); return { x: p.x + o.x, y: p.y + o.y, z: p.z + o.z }; }
export function hitFloor(p: V3, d: V3, r: Room = shown): V3 | undefined {
  // (the hall's deck is 4 m wider than the playing area: the wings)
  for (const [y, inside] of [[DECK, (x: number, z: number) => onDeck(x, z, r)], [0, () => true]] as const) {
    if (d.y >= -1e-4 || p.y <= y) continue;
    const k = (y - p.y) / d.y, x = p.x + d.x * k, z = p.z + d.z * k;
    if (inside(x, z)) return { x, y, z };
  }
  return undefined;
}

// Calibration: the head really points at `target` with these DMX values; the pan and tilt
// offsets that make the model agree (the smaller pair of the two ways round).
export function calibrate(clamp: V3, rot: Rot, target: V3, pan: number, tilt: number, o: Optics): { panOffset: number; tiltOffset: number } {
  const p = pivotOf(clamp, rot);
  const d = toLocal(norm({ x: target.x - p.x, y: target.y - p.y, z: target.z - p.z }), rot);
  const t0 = Math.acos(Math.max(-1, Math.min(1, d.y))) / RAD, p0 = Math.atan2(d.x, d.z) / RAD;
  const raw = headAngles(pan, tilt, { ...o, panOffset: 0, tiltOffset: 0 });
  const wrap = (a: number) => ((a + 540) % 360) - 180;
  const opts = [[p0, t0], [p0 + 180, -t0]].map(([pa, ta]) => ({ panOffset: wrap(pa - raw.p), tiltOffset: ta - raw.t }));
  return opts.sort((a, b) => Math.abs(a.panOffset) + Math.abs(a.tiltOffset) - Math.abs(b.panOffset) - Math.abs(b.tiltOffset))[0];
}
