// Setting a light up the way a lighting tech does at the rig (ui/FixtureSetup.svelte): how it's
// mounted (hung, standing, on its side, which way its front faces), its pan and tilt checked
// against the real light (invert, swap, range, offsets, a mark on the stage to point it at), one
// light's setup copied to a group, and what another mode does to the patch. Pure, no three.js
// (fixtureSetup.test.ts); the sums of where a light is and where it points are geometry.ts's.
import type { Channel, ChannelRange, Fixture, FixtureMode, FixtureType, StageMark } from './types';
import { capsOf, type FixtureKind } from './library';
import { placesOfLight, shapeH, shapeSize, shapeStanding, shapeW, type Places } from './pixelLayout';
import { aimAt, aimRot, calibrate, DECK, defaultPlace, groundAt, nearestTruss, norm, toWorld, TRUSS_HANG, type Optics, type Room, type Rot, type V3 } from '../stage3d/geometry';
import type { RigFixture, Sfx } from '../stage3d/rig';
import type { Look } from '../stage3d/models';

// ---- directions, as the audience sees the stage (+z is the audience, x runs left to right)
export type Dir = 'audience' | 'back' | 'left' | 'right' | 'up' | 'down';
export const DIRS: Record<Dir, V3> = {
  audience: { x: 0, y: 0, z: 1 }, back: { x: 0, y: 0, z: -1 }, left: { x: -1, y: 0, z: 0 },
  right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, down: { x: 0, y: -1, z: 0 },
};
export const DIR_LABEL: Record<Dir, string> = { audience: 'the audience', back: 'the back', left: 'the left', right: 'the right', up: 'up', down: 'down' };
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const UP: V3 = { x: 0, y: 1, z: 0 }, FRONT: V3 = { x: 0, y: 0, z: 1 };
const r1 = (v: number) => Math.round(v * 10) / 10 + 0;        // (+ 0: no -0 in the show file)
const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
// the one of the six a direction is (within about 10°), or none
export function dirOf(v: V3): Dir | undefined {
  const n = norm(v);
  return (Object.keys(DIRS) as Dir[]).find((k) => dot(n, DIRS[k]) > 0.984);
}
// where a light's own up (a moving head: from its base to its head; a fixed light: its beam) and
// its front (the side of the base with the display) point, for a turn
export const upOf = (r: Rot) => toWorld(UP, r);
export const frontOf = (r: Rot) => toWorld(FRONT, r);

// The turn (yaw, pitch, roll, in geometry.ts's order) that puts a light's own up along `up` and its
// front along `front` (made square to up first; along up itself, any front will do).
export function rotFrom(up: V3, front: V3): Rot {
  const u = norm(up);
  let f = { x: front.x - u.x * dot(front, u), y: front.y - u.y * dot(front, u), z: front.z - u.z * dot(front, u) };
  if (Math.hypot(f.x, f.y, f.z) < 1e-6) f = Math.abs(u.y) < 0.9 ? { x: -u.x * u.y, y: 1 - u.y * u.y, z: -u.z * u.y } : { x: 0, y: 0, z: 1 };
  f = norm(f);
  const x = cross(u, f);
  // the turn's matrix has x, u and f as its columns; yaw, pitch and roll out of it the way three.js
  // reads an 'YXZ' Euler (straight up or down its front has no yaw of its own: it goes in the roll)
  const pitch = Math.asin(Math.max(-1, Math.min(1, -f.y)));
  const flat = Math.abs(f.y) < 0.9999999;
  const yaw = flat ? Math.atan2(f.x, f.z) : Math.atan2(-x.z, x.x);
  const roll = flat ? Math.atan2(x.y, u.y) : 0;
  return { yaw: r1(yaw * 180 / Math.PI), pitch: r1(pitch * 180 / Math.PI), roll: r1(roll * 180 / Math.PI) };
}

// ---- mounting a moving head: where its head is from its base, and which way its front faces
export type MountId = 'hang' | 'stand' | 'left' | 'right' | 'back';
export type PlaceRule = 'truss' | 'ground' | 'keep';
export interface Mount { id: MountId; label: string; hint: string; head: Dir; place: PlaceRule }
export const MOUNTS: Mount[] = [
  { id: 'hang', label: 'Hung', hint: 'Clamped under a truss, the head hanging down (it goes onto the nearest truss)', head: 'down', place: 'truss' },
  { id: 'stand', label: 'Standing', hint: 'On its base, on the deck or the floor', head: 'up', place: 'ground' },
  { id: 'left', label: 'On its side, left', hint: 'Its base against a tower or a wall on the left (seen from the audience), the head towards the middle', head: 'right', place: 'keep' },
  { id: 'right', label: 'On its side, right', hint: 'Its base against a tower or a wall on the right (seen from the audience), the head towards the middle', head: 'left', place: 'keep' },
  { id: 'back', label: 'On its side, at the back', hint: 'Its base against the back wall or an upright truss, the head towards the audience', head: 'audience', place: 'keep' },
];
export const mountOf = (r: Rot): MountId | undefined => { const d = dirOf(upOf(r)); return MOUNTS.find((m) => m.head === d)?.id; };
// the fronts a mount can have (square to where its head is); the audience first
export const frontsFor = (head: V3): Dir[] => (['audience', 'down', 'up', 'left', 'right', 'back'] as Dir[]).filter((d) => Math.abs(dot(norm(head), DIRS[d])) < 0.1);
// a head mounted another way: its front stays where it faced if it can, else the first it can
export function mountRot(id: MountId, now: Rot): Rot {
  const m = MOUNTS.find((x) => x.id === id)!, head = DIRS[m.head], front = dirOf(frontOf(now));
  const can = frontsFor(head);
  return rotFrom(head, DIRS[front && can.includes(front) ? front : can[0]]);
}
// the same mount with its front facing another way
export const withFront = (now: Rot, front: Dir): Rot => rotFrom(upOf(now), DIRS[front]);

// ---- a fixed light (PAR, blinder, strobe, bar): where its beam goes
export type PointId = 'down' | 'stage' | 'audience' | 'up' | 'backdrop';
export interface Point { id: PointId; label: string; hint: string; place: PlaceRule }
export const POINTS: Point[] = [
  { id: 'down', label: 'Straight down', hint: 'Hung on a truss, lighting what is under it', place: 'truss' },
  { id: 'stage', label: 'At the stage', hint: 'Hung on a truss, tipped towards the middle of the stage', place: 'truss' },
  { id: 'audience', label: 'At the audience', hint: 'Tipped out over the crowd, the way blinders hang', place: 'keep' },
  { id: 'up', label: 'Straight up', hint: 'Standing on its own, lighting the roof or a truss', place: 'ground' },
  { id: 'backdrop', label: 'Up at the back', hint: 'On the floor, tipped back to light the backdrop', place: 'ground' },
];
// the middle of the stage a hung light tips towards (as a light without a place of its own does)
const stageTarget = (p: V3, room: Room): V3 => ({ x: p.x * 0.6, y: groundAt(p.x * 0.6, room.zc + 0.6, room), z: room.zc + 0.6 });
export function pointRot(id: PointId, p: V3, now: Rot, room: Room): Rot {
  switch (id) {
    case 'down': return { yaw: now.yaw, pitch: 180, roll: 0 };
    case 'up': return { yaw: now.yaw, pitch: 0, roll: 0 };
    case 'audience': return { yaw: 0, pitch: 100, roll: 0 };
    case 'backdrop': return { yaw: 0, pitch: -35, roll: 0 };
    case 'stage': { const r = aimRot(p, stageTarget(p, room)); return { yaw: r1(r.yaw), pitch: r1(r.pitch), roll: 0 }; }
  }
}
export function pointOf(p: V3, r: Rot, room: Room): PointId | undefined {
  const beam = upOf(r);
  return POINTS.find((x) => x.id === 'stage' ? dot(beam, upOf(pointRot('stage', p, r, room))) > 0.999 : dot(beam, upOf(pointRot(x.id, p, r, room))) > 0.995)?.id;
}

// where a light goes for a mount: onto the nearest truss, down on the deck or the floor, or where it is
export function placeFor(rule: PlaceRule, p: V3, room: Room): V3 {
  if (rule === 'truss') { const t = nearestTruss(p.z, room); return { x: r2(p.x), y: r2(t.y - TRUSS_HANG), z: r2(t.z) }; }
  if (rule === 'ground') return { x: r2(p.x), y: r2(groundAt(p.x, p.z, room)), z: r2(p.z) };
  return { x: r2(p.x), y: r2(p.y), z: r2(p.z) };
}
// where a light is and how it's turned now (its own 3D place, else where its kind puts it)
export function placeOf(f: Pick<Fixture, 'x' | 'y' | 'p3' | 'rot'>, kind: FixtureKind, room: Room): { p: V3; rot: Rot } {
  const d = defaultPlace(f, kind, room);
  return { p: f.p3 ? { ...f.p3 } : d.p, rot: f.rot ? { ...f.rot } : d.rot };
}

// ---- pan and tilt
// The head's optics: the light's own range when it has one, else its type's, else 540 / 270
// (a light whose pan or tilt turns the other way round from its type: its range counts backwards)
export function opticsOf(f: Pick<Fixture, 'panDeg' | 'tiltDeg' | 'panOffset' | 'tiltOffset' | 'invertPan' | 'invertTilt' | 'panReversed' | 'tiltReversed'>, t?: FixtureType): Optics {
  return { panDeg: (f.panDeg || t?.physical?.panDeg || 540) * (f.panReversed ? -1 : 1), tiltDeg: (f.tiltDeg || t?.physical?.tiltDeg || 270) * (f.tiltReversed ? -1 : 1), panOffset: f.panOffset ?? 0, tiltOffset: f.tiltOffset ?? 0, invertPan: !!f.invertPan, invertTilt: !!f.invertTilt };
}
// What the motors get for what a cue sends (pan and tilt swapped when the light says so; the same
// sum takes the motors' values back to a cue's). Invert, range and offsets are the motors' own.
export interface PanTilt { pan: number; tilt: number }
export const motors = (f: Pick<Fixture, 'swapPanTilt'>, v: PanTilt): PanTilt => (f.swapPanTilt ? { pan: v.tilt, tilt: v.pan } : { pan: v.pan, tilt: v.tilt });

// Marks on the stage to point a head at (a bit of tape on the real one): the middle, and the
// front corners a little in from the edge. `where` says how to find it on the real stage.
export interface Mark { id: 'centre' | 'left' | 'right'; label: string; where: string; p: V3 }
export function marksOf(room: Room): Mark[] {
  const front = room.deck.x > 0 ? room.deck.z1 : room.zc + room.D / 2, z = front - 1.5, x = Math.round(room.W * 3) / 10;
  const at = (px: number, pz: number): V3 => ({ x: px, y: groundAt(px, pz, room), z: pz });
  const cz = room.zc;
  return [
    { id: 'centre', label: 'Centre of the stage', where: room.deck.x > 0 ? `the middle of the stage, ${r1(front - cz)} m in from its front edge` : 'the middle of the room under the rig', p: at(0, cz) },
    { id: 'left', label: 'Front left', where: `${x} m left of the middle (seen from the audience), 1.5 m in from the front`, p: at(-x, z) },
    { id: 'right', label: 'Front right', where: `${x} m right of the middle (seen from the audience), 1.5 m in from the front`, p: at(x, z) },
  ];
}
// Marks for calibrating heads, the way the consoles suggest: a rectangle as big as the stage allows
// (four corners 1.5 m in from its edges) and its middle, on the deck. Each can be moved to where the
// tape really is.
export function calMarks(room: Room): StageMark[] {
  const deck = room.deck.x > 0, x = r1((deck ? room.deck.x : room.W / 2) * 0.6);
  const front = deck ? room.deck.z1 : room.zc + room.D / 2, back = deck ? room.deck.z0 : room.zc - room.D / 2;
  const at = (px: number, pz: number) => ({ x: px, y: groundAt(px, pz, room), z: r1(pz) });
  const fz = front - 1.5, bz = back + 1.5, cz = r1((fz + bz) / 2);
  return [
    { id: 'fl', name: 'Front left', p: at(-x, fz) }, { id: 'fr', name: 'Front right', p: at(x, fz) },
    { id: 'bl', name: 'Back left', p: at(-x, bz) }, { id: 'br', name: 'Back right', p: at(x, bz) },
    { id: 'c', name: 'Centre', p: at(0, cz) },
  ];
}
// How far a ring's or a matrix's board reaches below and above its middle the way it's turned (m):
// it stands on its lower edge and hangs by its top, instead of sitting half in the floor.
export function boardReach(at: Places, size: number, rot: Rot): { below: number; above: number } {
  const w = (size * shapeW(at) + 0.04) / 2, h = (size * shapeH(at) + 0.04) / 2;
  let lo = 0, hi = 0;
  for (const x of [-w, w]) for (const y of [0, 0.03]) for (const z of [-h, h]) { const v = toWorld({ x, y, z }, rot); lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); }
  return { below: -lo, above: hi };
}
// Where a light let go of in 3D comes to rest: on the truss it's close to (hung under it), on the
// deck or the floor it's close to (standing on it), else where it was let go. Close is a hand's
// width, not a metre: a light put up on a stand stays up. `reach`: a board's (0 for the others,
// whose origin is their base or clamp).
export function restAt(p: V3, kind: FixtureKind, reach: { below: number; above: number } | undefined, room: Room): { p: V3; on: 'truss' | 'deck' | 'floor' | 'air' } {
  const t = nearestTruss(p.z, room), hang = reach ? t.y - 0.08 - reach.above : t.y - TRUSS_HANG;
  if (Math.abs(p.y - hang) < 0.4 && Math.abs(p.z - t.z) < 0.4) return { p: { ...p, y: hang, z: t.z }, on: 'truss' };
  const below = reach?.below ?? 0;
  // (within the deck's area a light can't be inside the deck: below its top it comes up onto it)
  if (onDeckArea(p, room) && p.y < DECK + below + 0.3) return { p: { ...p, y: DECK + below }, on: 'deck' };
  if (!onDeckArea(p, room) && p.y < below + 0.3) return { p: { ...p, y: below }, on: 'floor' };
  return { p, on: 'air' };
}
const onDeckArea = (p: V3, room: Room) => room.deck.x > 0 && Math.abs(p.x) <= room.deck.x && p.z >= room.deck.z0 && p.z <= room.deck.z1;
// what a cue would send to point the head at a spot (from where it is now: no needless swing)
export function aimHead(f: Pick<Fixture, 'swapPanTilt'>, p: V3, rot: Rot, o: Optics, target: V3, now: PanTilt): PanTilt | undefined {
  const m = aimAt(p, rot, target, o, motors(f, now));
  return m && motors(f, m);
}
// The real head points at `target` with what a cue sends now: the offsets that make the model agree
export function offsetsFor(f: Pick<Fixture, 'swapPanTilt'>, p: V3, rot: Rot, o: Optics, target: V3, now: PanTilt) {
  const m = motors(f, now), c = calibrate(p, rot, target, m.pan, m.tilt, o);
  return { panOffset: r1(c.panOffset), tiltOffset: r1(c.tiltOffset) };
}

// ---- one light's setup for others: the same mount, pan and tilt; each keeps its own place.
// Mirrored for the lights on the other side of the stage's middle (a head on its side on the left
// is one on its side on the right there). Offsets only when asked: every head is a little different.
export const mirrorRot = (r: Rot): Rot => ({ yaw: -r.yaw + 0, pitch: r.pitch, roll: -r.roll + 0 });
export const sideOf = (x: number) => (Math.abs(x) < 0.25 ? 0 : Math.sign(x));
export const otherSide = (a: number, b: number) => sideOf(a) * sideOf(b) < 0;
type SetupKeys = 'invertPan' | 'invertTilt' | 'swapPanTilt' | 'panReversed' | 'tiltReversed' | 'panDeg' | 'tiltDeg' | 'panOffset' | 'tiltOffset';
export function copySetup(from: Pick<Fixture, SetupKeys>, rot: Rot, to: Pick<Fixture, SetupKeys | 'rot'>, o: { mirror?: boolean; offsets?: boolean; pan?: boolean }) {
  to.rot = o.mirror ? mirrorRot(rot) : { ...rot };
  if (o.pan === false) return;
  const keys: SetupKeys[] = ['invertPan', 'invertTilt', 'swapPanTilt', 'panReversed', 'tiltReversed', 'panDeg', 'tiltDeg', ...(o.offsets ? ['panOffset', 'tiltOffset'] as SetupKeys[] : [])];
  for (const k of keys) {
    const v = from[k];
    if (v === undefined || v === false || v === 0) delete to[k];
    else (to as Record<SetupKeys, unknown>)[k] = k === 'panOffset' && o.mirror ? -(v as number) + 0 : v;
  }
}

// ---- modes: what a mode's channels are, and what another mode does to the patch
export interface PatchedLight { id: string; name: string; universe: number; address: number; channels: number }
export interface ModeChange {
  channels: number; delta: number;          // its new count, and how many more (negative: fewer)
  end: number;                              // its last channel then
  past: number;                             // channels past 512 (0: none)
  moves: { id: string; name: string; from: number; to: number }[];   // the lights after it moved up so nothing is shared
  stuck?: string;                           // one that would then run past 512
  freed?: [number, number];                 // the channels it lets go of
}
// The lights after it on its universe move up only as far as they must (a gap that takes the extra
// channels stops it there); lights before it never move.
export function modeChange(all: PatchedLight[], id: string, channels: number): ModeChange {
  const f = all.find((x) => x.id === id);
  if (!f) return { channels, delta: 0, end: 0, past: 0, moves: [] };
  const end = f.address + channels - 1, delta = channels - f.channels;
  const after = all.filter((x) => x.id !== id && x.universe === f.universe && x.address > f.address).sort((a, b) => a.address - b.address);
  const moves: ModeChange['moves'] = [];
  let last = end, stuck: string | undefined;
  for (const g of after) {
    if (g.address > last) break;
    const to = last + 1;
    if (to + g.channels - 1 > 512) { stuck = g.name; break; }
    moves.push({ id: g.id, name: g.name, from: g.address, to });
    last = to + g.channels - 1;
  }
  return { channels, delta, end, past: Math.max(0, end - 512), moves, ...(stuck ? { stuck } : {}), ...(delta < 0 ? { freed: [end + 1, f.address + f.channels - 1] as [number, number] } : {}) };
}

export interface ChannelRow { n: number; dmx: number; name: string; attr: Channel['attr']; fineOf?: number; def: number; ranges: ChannelRange[]; span?: [number, number] }
// a mode's channels as the manual's table lists them: number, DMX address, what it does, which
// channel a fine one belongs to (its coarse one: the nearest before it with the same job), default
export function channelRows(m: FixtureMode, address: number): ChannelRow[] {
  return m.channels.map((c, i) => {
    let fineOf: number | undefined;
    if (c.fine) {
      for (let d = 1; d < m.channels.length && fineOf === undefined; d++)
        for (const j of [i - d, i + d]) if (j >= 0 && j < m.channels.length && !m.channels[j].fine && m.channels[j].attr === c.attr) { fineOf = j + 1; break; }
    }
    return { n: i + 1, dmx: address + i, name: c.name, attr: c.attr, ...(fineOf ? { fineOf } : {}), def: c.default ?? 0, ranges: c.ranges ?? [], ...(c.span ? { span: c.span } : {}) };
  });
}

// ---- the light as the 3D stage draws it (the same as Stage3D.svelte's list, with the light's own
// pan / tilt range)
const SFX: Sfx[] = ['confetti', 'bubbles', 'flame', 'sparks', 'co2'];
export function rigFixtureOf(f: Fixture, m: FixtureMode | undefined, k: FixtureKind, t: FixtureType | undefined, room: Room): RigFixture {
  const c = capsOf(m), at = placeOf(f, k, room), shape = placesOfLight(f, m);
  const sfx = m?.channels.find((ch) => (SFX as string[]).includes(ch.attr))?.attr as Sfx | undefined;
  const has = (a: string) => !!m?.channels.some((ch) => ch.attr === a);
  const look: Look = sfx ?? (c.fog ? 'fog' : k === 'mover' ? (/wash/i.test(t?.model ?? '') || (has('zoom') && !has('gobo')) ? 'wash' : 'spot')
    : shape ? (shape.round ? 'disc' : 'panel') : k === 'bar' ? 'bar' : k === 'strobe' ? 'strobe' : k === 'par' ? 'par' : /blinder/i.test(t?.model ?? '') ? 'blinder' : 'fresnel');
  const stood = shape && shapeStanding(at.p, shape);
  return {
    id: f.id, name: f.name, kind: k, look, cells: Math.max(1, c.cells), sfx, fog: c.fog, hazer: c.fog && has('haze') && !has('fog'),
    p: stood && !f.p3 ? stood.p : at.p, rot: stood && !f.rot ? stood.rot : at.rot, optics: opticsOf(f, t), shape, size: shape && shapeSize(shape),
  };
}
