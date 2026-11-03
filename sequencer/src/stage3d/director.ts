// The camera crews of the 3D stage. Tour goes round the room by itself; the other five film the show
// the way a real crew does: Broadcast (a TV director cutting between cameras on the bar lines),
// Crane (a jib over the crowd up to the stage and back), Steadicam (an operator walking along the
// front of the stage and round the band), Drone (big arcs high up, diving in on a drop) and Band cam
// (close-ups cut on the beat). Each one works from the time, the room, the music (the beat count,
// how hard the lights hit, the song's part when the timeline plays) and where the people are, and
// gives back where the camera is, what it looks at, its lens and its roll. No three.js and nothing
// read from the scene: the same inputs give the same pictures, so a take records what you see.
//
// What a crew remembers from one frame to the next (Broadcast's last cut, how loud it has been, how
// far the drone has dived) is a plain record (`Memory`) the 3D stage hands back every frame. Every
// place a camera goes is checked against the room (`Space`: the walls, the ceiling, the deck, the
// truss and the lights under it, the band, the DJ, the crowd, the big gear): the tests walk every
// mode through every room, and every frame `clear` keeps it out of anything as a last resort.
import { DECK, DJ_BOOTH, tourAt, TRUSS, W, type Room, type RoomId, type Seg, type V3 } from './geometry';

export type CamMode = 'tour' | 'broadcast' | 'crane' | 'steadicam' | 'drone' | 'bandcam';
// the modes as the toolbar offers them: a short name, a line under it, the longer title
export const CAM_MODES: { id: CamMode; name: string; line: string; says: string }[] = [
  { id: 'tour', name: 'Tour', line: 'Round the room, slowly', says: 'The camera goes slowly round the room by itself (for a presentation)' },
  { id: 'broadcast', name: 'Broadcast', line: 'A TV director cutting between cameras', says: 'Like live TV: cuts on the bar lines between the whole stage from out front (from the back of the room, front left, front right, high up, over the crowd), a crane and now and then a close-up or a handheld at the side of the stage. Faster cuts when it\'s loud, the wide shot on a drop' },
  { id: 'crane', name: 'Crane', line: 'Sweeps over the crowd to the stage', says: 'A crane arm sweeping over the crowd up to the stage and back, rising and falling, slow and smooth' },
  { id: 'steadicam', name: 'Steadicam', line: 'Walks along the stage, round the band', says: 'A camera operator walking along the front of the stage and round the band (or the DJ), swaying a little with each step' },
  { id: 'drone', name: 'Drone', line: 'Big arcs up high, dives in on a drop', says: 'A drone high over the room in big arcs: it dives in towards the stage on a drop and pulls back out when it\'s quiet' },
  { id: 'bandcam', name: 'Band cam', line: 'Close-ups cut on the beat', says: 'Close-ups of the people on stage cut on the beat: hands on the guitars, the drummer, the singer at the mic, the keys (the DJ\'s hands and the crowd in the club; the lights one kind after another on the test truss)' },
];
export const isCamMode = (m: unknown): m is CamMode => typeof m === 'string' && CAM_MODES.some((c) => c.id === m);
// the normal lens (degrees, up and down, for a wide picture): shots give theirs against it
export const LENS = 42;

// ---- small sums
type P3 = [number, number, number];
const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
const P = (p: P3): V3 => ({ x: p[0], y: p[1], z: p[2] });
const add = (a: V3, b: V3, k = 1): V3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const mix = (a: V3, b: V3, k: number): V3 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const clamp01 = (x: number) => clamp(x, 0, 1);
const smooth = (x: number) => { const k = clamp01(x); return k * k * (3 - 2 * k); };
const ease = (a: number, b: number, x: number) => smooth((x - a) / (b - a));
const TAU = Math.PI * 2;
// a number 0..1 for an integer (the same every time)
export function hash(n: number) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// a hand's tremble: a few slow sines that never line up (-1..1)
const tremble = (t: number, s: number) => 0.55 * Math.sin(t * 1.31 + s) + 0.3 * Math.sin(t * 2.71 + s * 2.3) + 0.15 * Math.sin(t * 4.37 + s * 3.7);

// ---- the music, as a camera crew hears it
export interface Part { name: string; at: number; energy?: number }
export interface Music {
  t: number;              // seconds, on a clock that runs on smoothly
  beat: number;           // the beat count (4 to a bar)
  energy: number;         // how hard the lights hit now (0..1)
  part?: Part | null;     // the song's part, while the timeline plays
}
// a drop or a chorus (where the director goes wide and the drone dives); a quiet part
const isBig = (p: Part) => /drop|chorus|refrain|hook/i.test(p.name) || (p.energy ?? 0) >= 0.88;
const isQuiet = (p: Part) => /intro|break|outro|interlude|ambient|calm/i.test(p.name) || (p.energy ?? 1) < 0.42;
// the part of a song at time t (sections in time order)
export function partAt(parts: readonly Part[], t: number): Part | null {
  let cur: Part | null = null;
  for (const p of parts) { if (p.at <= t + 0.05) cur = p; else break; }
  return cur;
}

// ---- who's where (the venue's own numbers: director.test.ts checks them against the built rooms)
export type Who = 'singer' | 'guitar' | 'bass' | 'keys' | 'drums' | 'dj';
// `at`: between the feet (the drums: the kit's middle on the riser)
export interface Light3 { p: V3; kind: string }
export interface Cast { people: { who: Who; at: V3 }[]; booth?: V3; lights: Light3[] }
const BAND: Record<'hall' | 'pub', Record<Exclude<Who, 'dj'>, P3>> = {
  hall: { singer: [0, DECK, 2.0], guitar: [-3.6, DECK, 1.2], bass: [3.6, DECK, 1.2], keys: [-4.6, DECK, -1.6], drums: [0, DECK + 0.4, -2.4] },
  pub: { singer: [0, DECK, 2.7], guitar: [-2.5, DECK, 2.1], bass: [2.5, DECK, 2.1], keys: [-3.15, DECK, -0.8], drums: [0, DECK + 0.4, -0.15] },
};
export function castOf(id: RoomId, lights: Light3[] = []): Cast {
  if (id === 'hall' || id === 'pub') return { people: (Object.entries(BAND[id]) as [Who, P3][]).map(([who, p]) => ({ who, at: P(p) })), lights };
  const dj = DJ_BOOTH[id];
  return dj ? { people: [{ who: 'dj', at: { ...dj.dj } }], booth: { ...dj.booth }, lights } : { people: [], lights };
}
const whoIs = (c: Cast, w: Who) => c.people.find((p) => p.who === w)?.at;

// ---- what's in the way: the room as a camera sees it
// Boxes and capsules already have the camera's clearance in them (CLEAR from anything solid).
const CLEAR = 0.3;
interface Box { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; what: string }
interface Cap { a: V3; b: V3; r: number; what: string }
// where the crowd stands (crowd.ts areas, as venue.ts and rooms.ts build them): their heads and hands
// up to `top` (arms up, jumping), higher in `high` (people on shoulders, flags), `half` the width
interface CrowdArea { z0: number; z1: number; half: (z: number) => number; top: number; high?: [number, number, number] }
export const CROWDS: Partial<Record<RoomId, CrowdArea>> = {
  hall: { z0: 9 / 2 + 2.6, z1: 9 / 2 + 15.8, half: (z) => Math.min(14.5, 6 + (z - 9 / 2) * 0.6), top: 2.6, high: [9 / 2 + 4.6, 9 / 2 + 11.6, 3.7] },
  pub: { z0: 9 / 2 + 1.2, z1: 14.6 - 3.0, half: () => 4.6 - 0.7, top: 2.6 },
  club: { z0: 9 / 2 + 1.0, z1: 22 - 3.4, half: () => 10 - 1.4, top: 2.6, high: [9 / 2 + 3, 9 / 2 + 10, 2.9] },
  party: { z0: 2.2, z1: 14.8, half: () => 10 - 1.6, top: 2.6, high: [4.2, 11.2, 2.9] },
};
export interface Space { room: Room; lo: V3; hi: V3; deck: Box | null; boxes: Box[]; caps: Cap[]; crowd?: CrowdArea }
const bx = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, what: string, c = CLEAR): Box =>
  ({ x0: x0 - c, x1: x1 + c, y0: y0 - c, y1: y1 + c, z0: z0 - c, z1: z1 + c, what });
// the same box on both sides of the room (x0..x1 on the right, mirrored on the left)
const both = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, what: string) => [bx(x0, x1, y0, y1, z0, z1, what), bx(-x1, -x0, y0, y1, z0, z1, what)];
const cap = (a: P3, b: P3, r: number, what: string): Cap => ({ a: P(a), b: P(b), r: r + CLEAR, what });
// the big things in each room that a camera could fly into (metres, as venue.ts / rooms.ts build them)
const GEAR: Record<RoomId, Box[]> = {
  hall: [
    ...both(4.55, 5.45, DECK, DECK + 1.7, -0.85, -0.15, 'an amp'), ...both(6.5, 7.4, DECK, DECK + 1.6, 0.9, 1.8, 'a side fill'),
    bx(7.5, 9.0, DECK, DECK + 1.9, 0.2, 1.5, 'monitor world'), bx(8.2, 8.9, DECK, DECK + 1.2, -0.7, 0, 'the in-ear rack'),
    bx(-8.7, -8.0, DECK, DECK + 1.2, 0.5, 2.1, 'spare guitars'), bx(-8.8, -8.0, DECK, DECK + 0.9, 2.4, 3.0, 'a case'),
    bx(-1.7, 1.7, DECK, DECK + 0.4 + 1.7, -3.9, -1.3, 'the drums'), bx(-5.2, -4.0, DECK, DECK + 1.1, -1.4, -0.8, 'the keyboard'),
    bx(-8, 8, 0, 8.6, -4.9, -4.7, 'the backdrop'), bx(-12.6, 12.6, 0, 1.1, 6.25, 7.2, 'the barricade'),
    ...both(4.3, 6.8, 0, 1.3, 4.85, 5.75, 'the subs'), ...both(8.9, 14.3, 4.4, 15, 3.0, 4.8, 'an LED wall'), ...both(8.7, 10.3, 8.2, 15, 4.2, 5.4, 'the PA'),
    bx(-3.3, 3.3, 0, 2.2, 19.4, 23.6, 'FOH'), ...both(9.2, 12.0, 0, 4.6, 23.3, 26.2, 'a follow spot'),
    ...both(9.7, 11.0, 0, 1.7, -3.1, -0.8, 'road cases'), bx(-3.8, 4.0, 0, 1.7, -7.6, -6.2, 'road cases'), bx(9.0, 10.3, 0, DECK, 2.7, 4.2, 'the steps'),
  ],
  pub: [
    bx(-1.4, 1.4, DECK, DECK + 0.4 + 1.7, -1.45, 0.75, 'the drums'), bx(-3.75, -2.55, DECK, DECK + 1.1, -0.6, 0, 'the keyboard'),
    bx(3.5, 4.6, DECK, DECK + 1.2, -1.4, 0.5, 'a guitar and a case'), ...both(3.4, 4.6, 0, 2.5, 4.6, 5.6, 'the PA'),
    bx(-4.6, 2.6, 0, 2.6, 11.9, 14.6, 'the bar'), bx(3.0, 4.3, 0, 2.2, 10.6, 12.1, 'the laptop'),
  ],
  club: [
    bx(-6, 6, 0, 7.2, -1.7, -1.4, 'the drapes'), ...both(7.4, 8.8, 0, 2.8, 3.7, 5.1, 'the PA'), bx(-8, 3, 0, 1.8, 18.9, 22, 'the bar'),
  ],
  party: [
    ...both(8.2, 9.6, 0, 2.8, -2.8, -1.4, 'the PA'), ...both(8.2, 9.6, 0, 2.8, 16.4, 17.8, 'the PA'), bx(-2.9, -1.9, 0, 1.7, -2.75, -2.1, 'road cases'),
  ],
  truss: [bx(6.2, 7.0, 0, 1.0, 6.2, 7.8, 'the table'), bx(-7.4, -6.6, 0, 1.7, 7.4, 9.9, 'road cases')],
};
// the truss pieces of a room (the hall's and the pub's are built in venue.ts from `truss`)
function trussOf(r: Room): Seg[] {
  if (r.frame) return r.frame;
  if (r.id === 'pub') return r.truss.map((t) => [[-r.walls.x, t.y + 0.15, t.z], [r.walls.x, t.y + 0.15, t.z]] as Seg);
  const xl = -W / 2 - 0.9, xr = W / 2 + 0.9, segs: Seg[] = [];
  for (const t of TRUSS) {
    segs.push([[xl, t.y + 0.15, t.z], [xr, t.y + 0.15, t.z]]);
    for (const x of [xl, xr]) segs.push([[x, 0, t.z], [x, t.y + 0.3, t.z]]);
  }
  for (const x of [xl, xr]) segs.push([[x, TRUSS[0].y + 0.6, TRUSS[0].z], [x, TRUSS[2].y + 0.6, TRUSS[2].z]]);
  return segs;
}
const spaces = new WeakMap<Cast, Map<RoomId, Space>>();
export function spaceOf(r: Room, c: Cast): Space {
  let m = spaces.get(c);
  if (!m) spaces.set(c, (m = new Map()));
  let s = m.get(r.id);
  if (s) return s;
  const w = r.walls, caps: Cap[] = [], boxes: Box[] = [...GEAR[r.id]];
  for (const [a, b] of trussOf(r)) {
    caps.push(cap(a, b, 0.15, 'the truss'));
    // a level piece has lights under it (a head hangs about a metre and a quarter below its middle)
    if (Math.abs(a[1] - b[1]) < 0.01) {
      const lo = a[1] - 1.25, x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[2], b[2]), z1 = Math.max(a[2], b[2]);
      boxes.push(bx(x0 - 0.45, x1 + 0.45, lo, a[1], z0 - 0.45, z1 + 0.45, 'the lights on the truss'));
    }
  }
  for (const p of c.people) {
    const { x, y, z } = p.at;
    if (p.who === 'drums') continue;              // (the kit's box has him)
    caps.push(cap([x, y + 0.3, z], [x, y + 1.6, z], 0.32, `the ${p.who === 'dj' ? 'DJ' : p.who === 'singer' ? 'singer' : `${p.who} player`}`));
    // a guitar's neck out to the player's left (+x), the mic stand in front of the singer
    if (p.who === 'guitar' || p.who === 'bass') caps.push(cap([x - 0.25, y + 1.0, z + 0.2], [x + 0.75, y + 1.35, z + 0.2], 0.12, `the ${p.who}`));
    if (p.who === 'singer') caps.push(cap([x, y, z + 0.36], [x, y + 1.7, z + 0.36], 0.1, 'the mic stand'));
  }
  if (c.booth) { const b = c.booth; boxes.push(bx(b.x - 1.2, b.x + 1.2, b.y, b.y + 1.45, b.z - 0.35, b.z + 0.35, 'the DJ booth')); }
  for (const l of c.lights) caps.push({ a: l.p, b: l.p, r: 0.6, what: 'a light' });
  if (r.id === 'club') caps.push(cap([0, 6.55, 12], [0, r.ceiling, 12], 0.35, 'the mirror ball'));
  const deck = r.deck.x > 0 ? bx(-r.deck.x, r.deck.x, 0, DECK + 0.6, r.deck.z0 - (r.id === 'hall' ? 0.4 : 0), r.deck.z1, 'the deck') : null;
  // inside the walls (half a metre off them), under the ceiling's beams, over what stands on the floor
  s = { room: r, lo: v3(-w.x + 0.5, 1.3, w.z0 + 0.5), hi: v3(w.x - 0.5, r.ceiling - 0.8, w.z1 - 0.5), deck, boxes, caps, crowd: CROWDS[r.id] };
  m.set(r.id, s);
  return s;
}
const inBox = (b: Box, p: V3) => p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1 && p.z > b.z0 && p.z < b.z1;
function capDist(c: Cap, p: V3) {
  const ab = { x: c.b.x - c.a.x, y: c.b.y - c.a.y, z: c.b.z - c.a.z }, l2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const k = l2 > 0 ? clamp01(((p.x - c.a.x) * ab.x + (p.y - c.a.y) * ab.y + (p.z - c.a.z) * ab.z) / l2) : 0;
  const q = add(c.a, ab, k);
  return { d: Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z), q };
}
// (the same without making anything: hundreds of lights are checked every frame)
function capNear(c: Cap, p: V3) {
  const ax = c.a.x, ay = c.a.y, az = c.a.z, bx = c.b.x - ax, by = c.b.y - ay, bz = c.b.z - az, l2 = bx * bx + by * by + bz * bz;
  const px = p.x - ax, py = p.y - ay, pz = p.z - az;
  if (l2 === 0) return px * px + py * py + pz * pz < c.r * c.r;
  const k = clamp01((px * bx + py * by + pz * bz) / l2), dx = px - bx * k, dy = py - by * k, dz = pz - bz * k;
  return dx * dx + dy * dy + dz * dz < c.r * c.r;
}
// the crowd's height at (x, z) with the camera's clearance (0: nobody there)
function crowdTop(a: CrowdArea | undefined, x: number, z: number) {
  if (!a || z < a.z0 - 0.4 || z > a.z1 + 0.4 || Math.abs(x) > a.half(clamp(z, a.z0, a.z1)) + 0.4) return 0;
  const high = a.high && z > a.high[0] - 0.4 && z < a.high[1] + 0.4 ? a.high[2] : a.top;
  return high + 0.35;
}
// What a camera at p would be in ('' for nothing): the room's walls, ceiling or floor, the deck, a
// piece of truss or the lights under it, someone in the band, the crowd, the gear
export function blocked(s: Space, p: V3): string {
  if (!Number.isFinite(p.x + p.y + p.z)) return 'nowhere';
  if (p.x < s.lo.x || p.x > s.hi.x || p.z < s.lo.z || p.z > s.hi.z) return 'the walls';
  if (p.y > s.hi.y) return 'the ceiling';
  if (p.y < s.lo.y) return 'the floor';
  if (s.deck && inBox(s.deck, p)) return 'the deck';
  for (const b of s.boxes) if (inBox(b, p)) return b.what;
  for (const c of s.caps) if (capNear(c, p)) return c.what;
  if (p.y < crowdTop(s.crowd, p.x, p.z)) return 'the crowd';
  return '';
}
// The camera moved out of anything it's in (the shortest way out), and inside the room: the last
// resort for a room or a light placed where no crew expects it. `n` counts the frames it acted.
export function clear(s: Space, p0: V3, mem?: Memory): V3 {
  let p = { ...p0 };
  for (let pass = 0; pass < 4; pass++) {
    const why = blocked(s, p);
    if (!why) break;
    if (mem && pass === 0) mem.nudged++;
    if (!Number.isFinite(p.x + p.y + p.z)) { p = v3((s.lo.x + s.hi.x) / 2, s.hi.y, (s.lo.z + s.hi.z) / 2); continue; }
    p = v3(clamp(p.x, s.lo.x, s.hi.x), clamp(p.y, s.lo.y, s.hi.y), clamp(p.z, s.lo.z, s.hi.z));
    const out = (b: Box) => {
      // (the nearest face; never down through the floor)
      const opts: [number, V3][] = [[p.x - b.x0, v3(b.x0 - 0.01, p.y, p.z)], [b.x1 - p.x, v3(b.x1 + 0.01, p.y, p.z)], [b.y1 - p.y, v3(p.x, b.y1 + 0.01, p.z)],
        [p.z - b.z0, v3(p.x, p.y, b.z0 - 0.01)], [b.z1 - p.z, v3(p.x, p.y, b.z1 + 0.01)]];
      if (b.y0 > s.lo.y) opts.push([p.y - b.y0, v3(p.x, b.y0 - 0.01, p.z)]);
      return opts.sort((a, c) => a[0] - c[0])[0][1];
    };
    if (s.deck && inBox(s.deck, p)) { p = out(s.deck); continue; }
    const box = s.boxes.find((b) => inBox(b, p));
    if (box) { p = out(box); continue; }
    const c = s.caps.find((k) => capNear(k, p));
    if (c) {
      const { d, q } = capDist(c, p), n = d > 1e-6 ? v3((p.x - q.x) / d, (p.y - q.y) / d, (p.z - q.z) / d) : v3(0, 1, 0);
      p = add(q, n, c.r + 0.01); continue;
    }
    const top = crowdTop(s.crowd, p.x, p.z);
    if (p.y < top) p = v3(p.x, top + 0.01, p.z);
  }
  return p;
}

// ---- the crews' places in each room
// A camera that stays where it is: `pos` looking at `at` through `fov`; over a shot it drifts by
// `move` and pans by `pan` (half each way of where it is), zooms to `zoom` times its lens, shakes
// by `shake` metres (a handheld)
interface Fixed { pos: P3; at: P3; fov: number; move?: P3; pan?: P3; zoom?: number; shake?: number }
interface Crew {
  wide: Fixed; high: Fixed; left: Fixed; right: Fixed; crowd: Fixed; back: Fixed;
  // the whole stage from out front on the left (and, mirrored, on the right): Broadcast's mainstay
  front: Fixed;
  // the close-up camera in front of the act (the pit, or the deck in front of the DJ)
  pit: { z: number; y: number; x: number };
  // a crane: its pivot; the camera at `a` over the crowd and `b` at the stage (the arm swings and
  // telescopes between), rising `rise` m in between; looking at lookA then lookB; there and back in `period` s
  crane: { pivot: P3; a: P3; b: P3; rise: number; lookA: P3; lookB: P3; period: number };
  // the steadicam's way (x, z) at camera height y, there and back; what it looks at along it
  walk: { y: number; way: [number, number][]; look: P3[] };
  // a drone: arcs about (0, zc) (rx, rz, up to `arc` either side of straight out) at height y
  // (`bob` up and down); dived in it's at near (x spread, y, z). On the way in it first comes down
  // to `gate` (y0..y1 of the dive), flies in (x0..x1), then down to near's height (n0..n1).
  drone: { zc: number; rx: number; rz: number; y: number; bob: number; arc: number; gate: number; near: P3; phase: [number, number, number, number, number, number]; lookFar: P3; lookNear: P3 };
}
const mirror = (f: Fixed): Fixed => ({ ...f, pos: [-f.pos[0], f.pos[1], f.pos[2]], at: [-f.at[0], f.at[1], f.at[2]], move: f.move && [-f.move[0], f.move[1], f.move[2]], pan: f.pan && [-f.pan[0], f.pan[1], f.pan[2]] });
const side = (f: Fixed): { left: Fixed; right: Fixed } => ({ left: f, right: mirror(f) });
export const CREW: Record<RoomId, Crew> = {
  hall: {
    wide: { pos: [0, 4.6, 23.9], at: [0, 3.4, 0.5], fov: 30, pan: [1.6, 0, 0], zoom: 0.8 },
    high: { pos: [-15, 10.5, 16], at: [0, 2.8, 0.5], fov: 36, move: [3, 0, 0] },
    ...side({ pos: [-6.5, 2.95, 3.1], at: [-1.0, 2.75, 1.6], fov: 32, move: [0.8, 0, -0.2], pan: [0.8, 0, 0], shake: 0.025 }),
    crowd: { pos: [-2.0, 3.1, 18.4], at: [0, 2.7, 2.0], fov: 34, move: [1.0, 0, 1.0], pan: [0.8, 0, 0], shake: 0.02 },
    front: { pos: [-9.5, 4.8, 14.5], at: [0, 3.6, 0], fov: 40, move: [1.5, 0, 0], pan: [0.8, 0, 0] },
    back: { pos: [2.0, 4.3, -4.25], at: [0, 2.4, 13], fov: 50, move: [-2.4, 0, 0], pan: [-2, 0, 0] },
    pit: { z: 5.5, y: 2.05, x: 3.4 },
    crane: { pivot: [-12.5, 3.0, 11.0], a: [-3.5, 6.2, 13.5], b: [-2.2, 3.6, 5.7], rise: 1.4, lookA: [0, 2.0, 6.0], lookB: [0, 3.0, 1.0], period: 40 },
    walk: {
      y: DECK + 1.5, way: [[-2.3, 0.2], [-5.4, 1.0], [-5.3, 3.4], [-2.2, 3.7], [0, 3.8], [2.2, 3.7], [5.3, 3.4], [5.4, 1.0], [2.3, 0.2]],
      look: [[0, 2.7, -2.8], [-3.6, 2.4, 1.2], [-2.5, 2.6, 1.6], [-0.8, 2.8, 2.0], [0, 2.8, 2.0], [0.8, 2.8, 2.0], [2.5, 2.6, 1.6], [3.6, 2.4, 1.2], [0, 2.7, -2.8]],
    },
    drone: { zc: 2, rx: 17, rz: 17, y: 10.5, bob: 1, arc: 1.15, gate: 10.5, near: [4, 4.4, 7.6], phase: [0, 0, 0, 0.85, 0.1, 1], lookFar: [0, 3.0, 0.5], lookNear: [0, 2.8, 1.5] },
  },
  pub: {
    wide: { pos: [2.4, 3.2, 12.4], at: [0, 2.6, 1.5], fov: 34, pan: [-0.6, 0, 0], zoom: 0.85 },
    high: { pos: [-3.6, 4.1, 9.0], at: [0.3, 2.3, 1.8], fov: 42, move: [0, 0, 1.2] },
    ...side({ pos: [-3.8, 2.7, 4.15], at: [-0.6, 2.6, 2.2], fov: 32, move: [0.5, 0, 0], pan: [0.6, 0, 0], shake: 0.02 }),
    crowd: { pos: [-1.3, 3.2, 11.2], at: [0, 2.6, 2.2], fov: 34, move: [0.6, 0, 0.8], pan: [0.6, 0, 0], shake: 0.02 },
    front: { pos: [-3.0, 3.1, 9.6], at: [0, 2.5, 1.8], fov: 44, move: [0.5, 0, 0], pan: [0.4, 0, 0] },
    back: { pos: [1.8, 3.85, -1.2], at: [0, 2.2, 9], fov: 52, move: [-1.0, 0, 0], pan: [-1, 0, 0] },
    pit: { z: 5.05, y: 2.05, x: 2.2 },
    crane: { pivot: [-3.9, 2.4, 9.5], a: [-0.8, 3.9, 10.2], b: [-0.8, 3.0, 5.0], rise: 0.25, lookA: [0, 1.8, 6.5], lookB: [0, 2.7, 2.2], period: 34 },
    walk: {
      y: DECK + 1.4, way: [[-2.0, 1.25], [-3.75, 1.5], [-3.6, 4.05], [-1.6, 4.1], [0, 4.1], [1.6, 4.1], [3.6, 4.05], [3.75, 1.5], [2.0, 1.25]],
      look: [[0, 2.6, -0.7], [-2.5, 2.4, 2.1], [-1.6, 2.6, 2.5], [-0.6, 2.75, 2.7], [0, 2.75, 2.7], [0.6, 2.75, 2.7], [1.6, 2.6, 2.5], [2.5, 2.4, 2.1], [0, 2.6, -0.7]],
    },
    drone: { zc: 2.5, rx: 3.2, rz: 8.5, y: 3.95, bob: 0.12, arc: 0.95, gate: 3.95, near: [1.2, 3.1, 5.05], phase: [0, 0, 0, 0.85, 0.1, 1], lookFar: [0, 2.5, 1.5], lookNear: [0, 2.6, 2.2] },
  },
  club: {
    wide: { pos: [-1.5, 4.2, 20.6], at: [0, 3.0, 1.5], fov: 32, pan: [1, 0, 0], zoom: 0.82 },
    high: { pos: [-8.6, 6.0, 14.8], at: [0, 2.6, 2.0], fov: 40, move: [0, 0, 1.5] },
    ...side({ pos: [-4.0, 2.8, 3.6], at: [0, 2.6, 1.2], fov: 32, move: [0.6, 0, 0], pan: [0.5, 0, 0], shake: 0.025 }),
    crowd: { pos: [1.4, 3.3, 16.0], at: [0, 2.6, 2.0], fov: 34, move: [-0.8, 0, 1.0], pan: [-0.6, 0, 0], shake: 0.02 },
    front: { pos: [-6.5, 3.8, 14.0], at: [0, 2.9, 1.2], fov: 40, move: [1.0, 0, 0], pan: [0.6, 0, 0] },
    back: { pos: [1.2, 3.4, -0.9], at: [0, 2.2, 10], fov: 52, move: [-1.2, 0, 0], pan: [-1.5, 0, 0] },
    pit: { z: 3.3, y: DECK + 1.55, x: 1.2 },
    crane: { pivot: [-9.0, 2.8, 8.0], a: [-3.0, 5.2, 7.9], b: [-1.8, 3.4, 5.2], rise: 0.4, lookA: [0, 2.0, 6.5], lookB: [0, 2.8, 1.3], period: 36 },
    walk: {
      y: DECK + 1.5, way: [[-1.7, 0.1], [-2.5, 1.5], [-1.7, 3.0], [0, 3.4], [1.7, 3.0], [2.5, 1.5], [1.7, 0.1]],
      look: [[0.5, 2.5, 3.2], [0, 2.7, 1.1], [0, 2.6, 1.0], [0, 2.75, 0.6], [0, 2.6, 1.0], [0, 2.7, 1.1], [-0.5, 2.5, 3.2]],
    },
    drone: { zc: 2.5, rx: 7.8, rz: 16, y: 6.6, bob: 0.3, arc: 0.95, gate: 4.55, near: [2.0, 3.4, 6.4], phase: [0, 0.35, 0.3, 0.88, 0.84, 1], lookFar: [0, 2.8, 2.0], lookNear: [0, 2.7, 1.3] },
  },
  party: {
    wide: { pos: [0, 4.0, 17.0], at: [0, 1.9, 0.6], fov: 32, pan: [1, 0, 0], zoom: 0.82 },
    high: { pos: [-9.0, 6.7, 8.25], at: [0, 1.8, 1.5], fov: 44, move: [0, 0, 2.5] },
    ...side({ pos: [-2.9, 2.5, 1.3], at: [0, 1.5, 0.3], fov: 32, move: [0.4, 0, 0], pan: [0.4, 0, 0], shake: 0.025 }),
    crowd: { pos: [1.9, 3.4, 11.9], at: [0, 1.9, 0.6], fov: 34, move: [-0.6, 0, 1.0], pan: [-0.6, 0, 0], shake: 0.02 },
    front: { pos: [-5.5, 3.3, 10.5], at: [0, 1.9, 0.6], fov: 42, move: [0.8, 0, 0], pan: [0.5, 0, 0] },
    back: { pos: [1.0, 2.6, -1.3], at: [0, 1.6, 9], fov: 52, move: [-1.2, 0, 0], pan: [-1.5, 0, 0] },
    pit: { z: 1.55, y: 1.85, x: 1.0 },
    crane: { pivot: [-9.0, 2.4, 0.0], a: [-2.2, 5.0, 4.5], b: [-1.5, 3.0, 1.5], rise: 0.3, lookA: [0.5, 1.6, 6.5], lookB: [0, 1.4, 0.4], period: 34 },
    walk: {
      y: 1.6, way: [[-1.9, -1.1], [-2.2, 0.6], [-1.3, 1.5], [0, 1.5], [1.3, 1.5], [2.2, 0.6], [1.9, -1.1]],
      look: [[0.5, 1.7, 2.4], [0, 1.6, 0.1], [0, 1.5, -0.2], [0, 1.6, -0.6], [0, 1.5, -0.2], [0, 1.6, 0.1], [-0.5, 1.7, 2.4]],
    },
    drone: { zc: 1, rx: 8, rz: 14, y: 6.65, bob: 0.3, arc: 0.9, gate: 6.65, near: [1.2, 3.4, 2.5], phase: [0, 0, 0, 0.75, 0.55, 1], lookFar: [0, 1.8, 4], lookNear: [0, 1.6, 0.3] },
  },
  truss: {
    wide: { pos: [0, 2.5, 12.5], at: [0, 2.9, 1.5], fov: 34, pan: [1, 0, 0], zoom: 0.82 },
    high: { pos: [-6.0, 4.8, 9.0], at: [0, 2.6, 2.0], fov: 42, move: [2.0, 0, 0] },
    ...side({ pos: [-4.6, 1.9, 5.6], at: [-1.0, 3.4, 1.5], fov: 34, move: [0.8, 0, 0], pan: [0.8, 0, 0], shake: 0.02 }),
    crowd: { pos: [0.8, 1.45, 6.0], at: [0, 3.8, 1.5], fov: 38, move: [0, 0, 0.8], pan: [0.8, 0, 0], shake: 0.015 },
    front: { pos: [-4.0, 2.4, 9.0], at: [0, 2.9, 1.5], fov: 42, move: [0.8, 0, 0], pan: [0.5, 0, 0] },
    back: { pos: [1.2, 2.6, -1.0], at: [0, 1.4, 4.5], fov: 52, move: [-1.6, 0, 0], pan: [-1.5, 0, 0] },
    pit: { z: 5.4, y: 1.8, x: 2 },
    crane: { pivot: [-7.2, 1.8, 7.5], a: [-2.0, 4.7, 6.2], b: [-0.6, 2.2, 4.8], rise: 0.3, lookA: [0, 1.0, 4.0], lookB: [0, 3.6, 1.5], period: 32 },
    walk: {
      y: 1.6, way: [[-5.0, 5.4], [-2.5, 5.2], [0, 5.3], [2.5, 5.2], [5.0, 5.4]],
      look: [[-5.0, 3.5, 1.5], [-2.5, 3.6, 1.5], [0, 3.6, 1.5], [2.5, 3.6, 1.5], [5.0, 3.5, 1.5]],
    },
    drone: { zc: 1.5, rx: 7, rz: 10, y: 4.7, bob: 0.25, arc: 0.95, gate: 4.7, near: [1.5, 2.7, 5.0], phase: [0, 0, 0, 0.85, 0.15, 1], lookFar: [0, 3.0, 1.5], lookNear: [0, 3.3, 1.5] },
  },
};

// ---- what a crew remembers between frames
export interface Memory {
  t: number;                    // the last frame's clock (NaN: none yet)
  fast: number; slow: number;   // the lights' energy, smoothed a little (strobes don't count) and over a few bars
  loud: number; loudV: number;  // how loud it is, as the crews feel it (0..1, a spring)
  dive: number; diveV: number;  // the drone: 0 out high, 1 dived in
  dropAt: number;               // the beat a drop started (-Infinity: none yet)
  dropDue: boolean;             // a drop the director hasn't cut to yet
  partKey: string; partBig: boolean; partQuiet: boolean;
  tick: number;                 // the last bar (Broadcast) or beat (Band cam) seen
  cutAt: number; cutT: number;  // the bar / beat of the last cut, and its time
  cam: number; prev: number;    // the camera (or subject) on now, and the one before
  hold: number;                 // how long this shot is meant to stay (bars or beats)
  seed: number;                 // this shot's own way of moving (0..1)
  cuts: number;                 // cuts so far (for the tests)
  nudged: number;               // frames the last resort had to move the camera (for the tests: 0)
  visits: number[];             // Band cam: how often each subject has come up
}
export function newMemory(): Memory {
  return { t: NaN, fast: 0, slow: 0, loud: 0, loudV: 0, dive: 0, diveV: 0, dropAt: -Infinity, dropDue: false, partKey: '', partBig: false, partQuiet: false,
    tick: NaN, cutAt: 0, cutT: 0, cam: -1, prev: -1, hold: 4, seed: 0, cuts: 0, nudged: 0, visits: [] };
}
// a critically damped spring towards `to` (rate w): no overshoot, no jump, smooth speed
function spring(x: number, v: number, to: number, w: number, dt: number): [number, number] {
  const d = x - to, e = Math.exp(-w * dt), k = v + w * d;
  return [to + (d + k * dt) * e, (v - w * k * dt) * e];
}
// the music, heard once a frame: how loud, a drop, the part
function listen(m: Music, mem: Memory) {
  const first = !Number.isFinite(mem.t), dt = first ? 0 : clamp(m.t - mem.t, 0, 0.25);
  mem.t = m.t;
  const e = clamp01(Number.isFinite(m.energy) ? m.energy : 0);
  // (starting in the middle of a loud part isn't a drop: the crew comes in hearing what's on)
  if (first) mem.fast = mem.slow = mem.loud = e;
  mem.fast += (e - mem.fast) * (1 - Math.exp(-dt / 0.3));
  mem.slow += (mem.fast - mem.slow) * (1 - Math.exp(-dt / 8));
  const p = m.part ?? null, key = p ? `${p.name}@${p.at}` : '';
  if (key !== mem.partKey) {
    const was = mem.partBig;
    mem.partKey = key; mem.partBig = !!p && isBig(p); mem.partQuiet = !!p && isQuiet(p);
    if (mem.partBig && !was && key) { mem.dropAt = m.beat; mem.dropDue = true; }
  }
  // no song parts: a drop is the lights hitting much harder than they have for a while
  if (!p && mem.fast > 0.55 && mem.fast - mem.slow > 0.25 && m.beat - mem.dropAt > 32) { mem.dropAt = m.beat; mem.dropDue = true; }
  const want = p?.energy !== undefined ? 0.5 * p.energy + 0.5 * mem.fast : mem.fast;
  [mem.loud, mem.loudV] = spring(mem.loud, mem.loudV, clamp01(want), 1.1, dt);
  return dt;
}
const dropping = (m: Music, mem: Memory) => m.beat - mem.dropAt < 32 && m.beat >= mem.dropAt;
const quiet = (mem: Memory) => mem.partQuiet || (!mem.partKey && mem.loud < 0.25);

// ---- a shot
export interface Shot { pos: V3; at: V3; fov: number; roll: number; cut: boolean; cam: string }
const shotOf = (pos: V3, at: V3, fov: number, roll = 0, cam = ''): Shot => ({ pos, at, fov, roll, cut: false, cam });

// a fixed camera s seconds into its shot (its own way of moving: seed)
function fixedAt(f: Fixed, s: number, seed: number, t: number, cam: string): Shot {
  const k = smooth(s / 16) - 0.5, dir = seed < 0.5 ? -1 : 1;
  let pos = P(f.pos), at = P(f.at);
  if (f.move) pos = add(pos, P(f.move), k * dir);
  if (f.pan) at = add(at, P(f.pan), k * dir);
  let roll = 0;
  if (f.shake) {
    const sd = seed * 40;
    pos = add(pos, v3(tremble(t, sd), tremble(t * 1.1, sd + 3) * 0.7, tremble(t * 0.9, sd + 7) * 0.5), f.shake);
    at = add(at, v3(tremble(t * 0.8, sd + 11), tremble(t * 0.7, sd + 13), 0), f.shake * 3);
    roll = tremble(t * 0.6, sd + 17) * 0.8;
  }
  return shotOf(pos, at, f.fov * (1 + ((f.zoom ?? 1) - 1) * (k + 0.5)), roll, cam);
}

// ---- Crane: an arm from the pivot, swinging and telescoping from over the crowd (a) to the stage (b)
function sph(c: V3, p: V3) { const d = add(p, c, -1), r = Math.hypot(d.x, d.y, d.z); return { r, yaw: Math.atan2(d.x, d.z), pitch: Math.asin(clamp(d.y / r, -1, 1)) }; }
function craneAt(r: Room, t: number, loud: number): Shot {
  const c = CREW[r.id].crane, piv = P(c.pivot), A = sph(piv, P(c.a)), B = sph(piv, P(c.b));
  // out and back: slowing to a stop at each end (s 0 over the crowd, 1 at the stage)
  const s = 0.5 - 0.5 * Math.cos((TAU * t) / c.period);
  const rr = A.r + (B.r - A.r) * s, yaw = A.yaw + (B.yaw - A.yaw) * s;
  // rising in the middle of the sweep (a little more when it's loud), at its own pace
  const lift = c.rise * Math.sin(Math.PI * s) * (0.75 + 0.15 * Math.sin((TAU * t) / (c.period * 1.618)) + 0.1 * loud);
  const pitch = A.pitch + (B.pitch - A.pitch) * s + lift / rr;
  const pos = add(piv, v3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)), rr);
  const at = add(mix(P(c.lookA), P(c.lookB), smooth(s)), v3(0.6 * Math.sin((TAU * t) / (c.period * 0.77)), 0, 0));
  return shotOf(pos, at, 40 - 6 * s, 0, 'crane');
}

// ---- Steadicam: a Catmull-Rom path through the walk's points, measured along its length
interface Path { pts: V3[]; cum: Float64Array; us: Float64Array; len: number; look: Float64Array }
// (what it looks at, every LOOK_STEP metres along the way, averaged over a few metres: an operator
// turns smoothly from the drummer to the singer, not as fast as the points change)
const LOOK_STEP = 0.1, LOOK_SPAN = 2.4;
const paths = new Map<RoomId, Path>();
function cr(a: number, b: number, c: number, d: number, u: number) {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (3 * b - a - 3 * c + d) * u3);
}
function along(list: V3[], u: number): V3 {
  const n = list.length - 1, k = Math.min(n - 1, Math.floor(u)), f = u - k;
  const a = list[Math.max(0, k - 1)], b = list[k], c = list[k + 1], d = list[Math.min(n, k + 2)];
  return v3(cr(a.x, b.x, c.x, d.x, f), cr(a.y, b.y, c.y, d.y, f), cr(a.z, b.z, c.z, d.z, f));
}
function pathOf(r: Room): Path {
  let p = paths.get(r.id);
  if (p) return p;
  const w = CREW[r.id].walk, pts = w.way.map(([x, z]) => v3(x, w.y, z)), looks = w.look.map(P);
  const N = 48 * (pts.length - 1), cum = new Float64Array(N + 1), us = new Float64Array(N + 1);
  let last = along(pts, 0);
  for (let i = 1; i <= N; i++) { const u = (i / N) * (pts.length - 1), q = along(pts, u); cum[i] = cum[i - 1] + Math.hypot(q.x - last.x, q.y - last.y, q.z - last.z); us[i] = u; last = q; }
  const len = cum[N], n = Math.ceil(len / LOOK_STEP) + 1, raw = new Float64Array(n * 3), look = new Float64Array(n * 3);
  const tmp = { pts, cum, us, len, look };
  for (let i = 0; i < n; i++) { const q = along(looks, uAt(tmp, Math.min(len, i * LOOK_STEP))); raw[i * 3] = q.x; raw[i * 3 + 1] = q.y; raw[i * 3 + 2] = q.z; }
  // (a box average twice over: about a bell curve; the ends hold what they look at)
  const box = (src: Float64Array, dst: Float64Array, h: number) => {
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
      let sum = 0; for (let j = i - h; j <= i + h; j++) sum += src[clamp(j, 0, n - 1) * 3 + k];
      dst[i * 3 + k] = sum / (2 * h + 1);
    }
  };
  const h = Math.round(LOOK_SPAN / 2 / LOOK_STEP), mid = new Float64Array(n * 3);
  box(raw, mid, h); box(mid, look, h);
  p = tmp;
  paths.set(r.id, p);
  return p;
}
function lookAt(p: Path, d: number): V3 {
  const f = clamp(d / LOOK_STEP, 0, p.look.length / 3 - 1), i = Math.min(p.look.length / 3 - 2, Math.floor(f)), k = f - i, L = p.look;
  return v3(L[i * 3] + (L[i * 3 + 3] - L[i * 3]) * k, L[i * 3 + 1] + (L[i * 3 + 4] - L[i * 3 + 1]) * k, L[i * 3 + 2] + (L[i * 3 + 5] - L[i * 3 + 2]) * k);
}
// the path's parameter at a distance along it
function uAt(p: Pick<Path, 'cum' | 'us'>, d: number) {
  let lo = 0, hi = p.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p.cum[m] < d) lo = m; else hi = m; }
  const f = (d - p.cum[lo]) / Math.max(1e-9, p.cum[hi] - p.cum[lo]);
  return p.us[lo] + (p.us[hi] - p.us[lo]) * clamp01(f);
}
// a walking pace: 1.2 m/s at the most, slowing to a stop at each end of the way, then back
export const WALK = 1.2;
function steadicamAt(r: Room, t: number): Shot {
  const p = pathOf(r), T = (Math.PI * p.len) / WALK, ph = (((t / T) % 1) + 1) % 1;
  const d = (0.5 - 0.5 * Math.cos(TAU * ph)) * p.len, speed = Math.abs(Math.sin(TAU * ph)), u = uAt(p, d);
  const pos = along(p.pts, u), ahead = along(p.pts, Math.min(p.pts.length - 1, u + 0.05)), back = along(p.pts, Math.max(0, u - 0.05));
  // the operator's steps: the camera dips a little with each one and sways from foot to foot
  const step = (TAU * d) / 1.5, sx = ahead.z - back.z, sz = back.x - ahead.x, sl = Math.hypot(sx, sz) || 1;
  const sway = 0.016 * speed * Math.sin(step), bob = 0.011 * speed * Math.sin(2 * step) + 0.004 * Math.sin(t * 1.6);
  const cam = v3(pos.x + (sx / sl) * sway, pos.y + bob, pos.z + (sz / sl) * sway);
  const at = add(lookAt(p, d), v3(0.05 * Math.sin(t * 0.7), 0.04 * Math.sin(t * 0.9 + 1), 0));
  return shotOf(cam, at, 38, 0.7 * speed * Math.sin(step), 'steadicam');
}

// ---- Drone: big arcs out high, diving in on a drop
function droneAt(r: Room, t: number, dive: number): Shot {
  const c = CREW[r.id].drone, [g0, g1, x0, x1, n0, n1] = c.phase;
  const w1 = TAU / 72, w2 = TAU / 27, a = c.arc * (0.75 * Math.sin(w1 * t) + 0.25 * Math.sin(w2 * t + 1.3));
  const da = c.arc * (0.75 * w1 * Math.cos(w1 * t) + 0.25 * w2 * Math.cos(w2 * t + 1.3));
  const far = v3(c.rx * Math.sin(a), c.y + c.bob * Math.sin((TAU * t) / 37), c.zc + c.rz * Math.cos(a));
  const near = v3(c.near[0] * Math.sin(a), c.near[1], c.near[2]);
  const ex = ease(x0, x1, dive), e1 = g1 > g0 ? ease(g0, g1, dive) : 0, e2 = ease(n0, n1, dive);
  const y = far.y + (c.gate - far.y) * e1 + (near.y - (g1 > g0 ? c.gate : far.y)) * e2;
  const pos = v3(far.x + (near.x - far.x) * ex, y, far.z + (near.z - far.z) * ex);
  const at = mix(P(c.lookFar), P(c.lookNear), smooth(dive));
  // banking into the turn: about 2.5° for each m/s sideways
  const side = c.rx * Math.cos(a) * da * (1 - ex);
  return shotOf(pos, at, 44 - 8 * smooth(dive), clamp(-side * 2.5, -8, 8), 'drone');
}

// ---- close shots of the act
interface Close { pos: V3; at: V3; fov: number; cam: string }
// Band cam's subjects in a room (hands on the guitars, the drummer, the singer at the mic, the keys;
// the DJ and the crowd; the lights, one kind after another)
function subjects(r: Room, c: Cast): ((k: number) => Close)[] {
  const out: ((k: number) => Close)[] = [];
  const at = (w: Who) => whoIs(c, w);
  const s = at('singer'), g = at('guitar'), b = at('bass'), d = at('drums'), k = at('keys'), dj = at('dj'), booth = c.booth;
  if (s) out.push((n) => { const f = add(s, v3(0, 1.62, 0.05)); return n % 2 ? { pos: add(f, v3(1.25, -0.05, 0.75)), at: f, fov: 26, cam: 'the singer' } : { pos: add(f, v3(-0.35, -0.25, 1.45)), at: f, fov: 24, cam: 'the singer' }; });
  if (g) out.push(() => { const f = add(g, v3(0.15, 1.12, 0.25)); return { pos: add(f, v3(-0.75, 0.45, 1.05)), at: f, fov: 28, cam: 'the guitar' }; });
  if (d) out.push(() => ({ pos: add(d, v3(1.7, 2.05, 1.6)), at: add(d, v3(0.15, 0.85, -0.2)), fov: 34, cam: 'the drums' }));
  if (b) out.push(() => { const f = add(b, v3(0.15, 1.12, 0.25)); return { pos: add(f, v3(0.8, 0.45, 1.0)), at: f, fov: 28, cam: 'the bass' }; });
  if (k) out.push(() => { const f = add(k, v3(0, 1.0, 0.5)); return { pos: add(f, v3(0.95, 0.55, 0.75)), at: f, fov: 30, cam: 'the keys' }; });
  if (dj && booth) {
    const front = r.id === 'party' ? 1.55 : 1.65;
    out.push(() => { const f = add(booth, v3(0, 1.1, -0.06)); return { pos: add(f, v3(0.55, 0.6, 0.85)), at: f, fov: 30, cam: 'the DJ\'s hands' }; });
    out.push(() => { const f = add(dj, v3(0, 1.66, 0.05)); return { pos: add(f, v3(-0.45, -0.2, front)), at: f, fov: 24, cam: 'the DJ' }; });
    out.push(() => (r.id === 'club' ? { pos: v3(-1.3, 3.0, 4.2), at: v3(0.5, 2.3, 9), fov: 34, cam: 'the crowd' } : { pos: v3(2.5, 2.0, 1.3), at: v3(0, 2.0, 7), fov: 38, cam: 'the crowd' }));
    out.push(() => ({ pos: add(dj, v3(0.45, 1.95, r.id === 'club' ? -0.95 : -0.9)), at: v3(0, dj.y + 1.1, 9), fov: 40, cam: 'over the DJ\'s shoulder' }));
  }
  // the test truss (or any room without people): its lights, kind by kind
  if (!out.length) {
    const kinds = [...new Set(c.lights.map((l) => l.kind))];
    for (const kind of kinds) {
      const ls = c.lights.filter((l) => l.kind === kind);
      out.push((n) => {
        const l = ls[n % ls.length].p, sx = l.x > 0 ? -1 : 1;
        return l.y > 1.8 ? { pos: add(l, v3(sx * 0.7, -1.35, 1.9)), at: add(l, v3(0, -0.1, 0)), fov: 28, cam: kind } : { pos: add(l, v3(sx * 0.6, 1.4, 2.0)), at: add(l, v3(0, 0.35, 0)), fov: 30, cam: kind };
      });
    }
    if (!out.length) out.push(() => ({ pos: v3(1.5, 2.0, 5.5), at: v3(0, 3.6, 1.5), fov: 34, cam: 'the truss' }));
  }
  return out;
}
// a close shot s seconds in: a slow push in, a hand's tremble
function closeAt(c: Close, s: number, t: number, seed: number): Shot {
  const toward = add(c.at, c.pos, -1), dist = Math.hypot(toward.x, toward.y, toward.z) || 1, push = Math.min(0.22, 0.25 * dist) * smooth(s / 8);
  const sd = seed * 50;
  const pos = add(add(c.pos, toward, push / dist), v3(tremble(t * 1.2, sd), tremble(t * 1.4, sd + 2), tremble(t, sd + 5) * 0.5), 0.01);
  return shotOf(pos, add(c.at, v3(tremble(t * 0.9, sd + 9), tremble(t * 0.8, sd + 4), 0), 0.012), c.fov, tremble(t * 0.5, sd + 6) * 0.6, c.cam);
}
// Broadcast's long lens from the pit (or from in front of the DJ, or on a light)
function pitShot(r: Room, c: Cast, pick: number): Close {
  const crew = CREW[r.id];
  const ppl = c.people.filter((p) => p.who !== 'drums' || r.id !== 'hall');
  if (!ppl.length) { const s = subjects(r, c); return s[pick % s.length](pick); }
  // (the singer or the DJ half the time)
  const lead = c.people.find((p) => p.who === 'singer' || p.who === 'dj');
  const who = lead && hash(pick * 7 + 1) < 0.5 ? lead : ppl[Math.floor(hash(pick * 3 + 2) * ppl.length) % ppl.length];
  const head = who.who === 'drums' ? add(who.at, v3(0, 1.25, -0.65)) : add(who.at, v3(0, who.who === 'dj' ? 1.66 : 1.6, 0.05));
  const pos = v3(clamp(head.x * 0.6 + (hash(pick) - 0.5) * 1.2, -crew.pit.x, crew.pit.x), crew.pit.y, crew.pit.z);
  const dist = Math.hypot(head.x - pos.x, head.y - pos.y, head.z - pos.z);
  return { pos, at: head, fov: clamp((2 * Math.atan(0.5 / dist) * 180) / Math.PI, 10, 30), cam: `close on the ${who.who === 'dj' ? 'DJ' : who.who === 'drums' ? 'drummer' : who.who}` };
}

// ---- Broadcast: the director's cameras, and the cut
const CAMS = ['wide', 'high', 'crane', 'left', 'right', 'close', 'crowd', 'back', 'frontL', 'frontR'] as const;
type Cam = typeof CAMS[number];
const WIDE = CAMS.indexOf('wide'), HIGH = CAMS.indexOf('high');
// how many bars a shot stays at this loudness: 8 when it's quiet down to 2 when it's loud
export const holdFor = (loud: number, bar: number) => clamp(Math.round(8 - 6 * ease(0.15, 0.7, loud) + (hash(bar * 13 + 5) - 0.5) * 2), 2, 8);
function nextCam(mem: Memory, bar: number): number {
  const L = mem.loud, q = 1 - L;
  // (mostly the whole stage from out front, at different angles; the band close up now and then)
  const weight: Record<Cam, number> = {
    wide: 1 + 2 * q, high: 0.8 + 0.6 * q, crane: 1.2, frontL: 1.4 + L, frontR: 1.4 + L, crowd: 1 + 0.8 * L, back: 0.3 + 0.6 * L,
    left: 0.2 + 0.4 * L, right: 0.2 + 0.4 * L, close: 0.2 + 0.4 * L,
  };
  const list = CAMS.map((c, i) => (i === mem.cam ? 0 : i === mem.prev ? weight[c] * 0.4 : weight[c]));
  let r = hash(bar * 31 + 7) * list.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) { if ((r -= list[i]) <= 0 && list[i] > 0) return i; }
  return list.findIndex((w) => w > 0);
}
function cut(mem: Memory, at: number, t: number, cam: number, hold: number) {
  mem.prev = mem.cam; mem.cam = cam; mem.cutAt = at; mem.cutT = t; mem.hold = hold; mem.seed = hash(at * 17 + cam); mem.cuts++;
}
function broadcast(r: Room, m: Music, c: Cast, mem: Memory, crane: () => Shot): Shot {
  const bar = Math.floor(m.beat / 4);
  let did = false;
  if (!Number.isFinite(mem.tick) || bar < mem.tick || bar > mem.tick + 16) {
    // the start, or the music jumped: the wide shot
    cut(mem, bar, m.t, mem.cam === WIDE ? HIGH : WIDE, 4); mem.dropDue = false; did = true;
  } else if (bar !== mem.tick) {
    // a bar line: cut when this shot has had its bars (fewer when it's loud), to the wide shot on a drop
    const since = bar - mem.cutAt, want = holdFor(mem.loud, bar);
    if (mem.dropDue && m.beat - mem.dropAt > 16) mem.dropDue = false;
    if (mem.dropDue && since >= 2) { cut(mem, bar, m.t, mem.cam === WIDE ? HIGH : WIDE, 4 + Math.round(hash(bar) * 4)); mem.dropDue = false; did = true; }
    else if (since >= 8 || (since >= 2 && since >= Math.min(mem.hold, want))) { cut(mem, bar, m.t, nextCam(mem, bar), want); did = true; }
  }
  mem.tick = bar;
  const s = Math.max(0, m.t - mem.cutT), crew = CREW[r.id], name = CAMS[mem.cam];
  const shot = name === 'crane' ? crane() : name === 'close' ? closeAt(pitShot(r, c, mem.cutAt), s, m.t, mem.seed)
    : name === 'frontL' || name === 'frontR' ? fixedAt(name === 'frontL' ? crew.front : mirror(crew.front), s, mem.seed, m.t, name) : fixedAt(crew[name], s, mem.seed, m.t, name);
  shot.cut = did;
  return shot;
}

// ---- Band cam: a close shot per subject, cut on the beat
function bandcam(r: Room, m: Music, c: Cast, mem: Memory): Shot {
  const list = subjects(r, c), beat = Math.floor(m.beat);
  let did = false;
  const pick = (b: number) => {
    // the next subject: not the one on now; the singer (or the DJ) a little more often
    const w = list.map((_, i): number => (i === mem.cam ? 0 : i === 0 ? 1.6 : 1));
    let x = hash(b * 29 + 3) * w.reduce((a, q) => a + q, 0);
    for (let i = 0; i < w.length; i++) if ((x -= w[i]) <= 0 && w[i] > 0) return i;
    return list.length > 1 ? (mem.cam + 1) % list.length : 0;
  };
  const go = (b: number, hold: number) => { const i = pick(b); cut(mem, b, m.t, i, hold); mem.visits[i] = (mem.visits[i] ?? 0) + 1; did = true; };
  // (4 beats when it's lively, 2 when it's loud, 8 when it's quiet)
  const want = mem.loud > 0.62 ? 2 : mem.loud > 0.3 ? 4 : 8;
  if (!Number.isFinite(mem.tick) || beat < mem.tick || beat > mem.tick + 64 || mem.cam >= list.length) go(beat, want);
  else if (beat !== mem.tick) {
    const since = beat - mem.cutAt;
    if (mem.dropDue && since >= 2) { mem.dropDue = false; go(beat, want); }
    else if (since >= 8 || (since >= 2 && since >= Math.min(mem.hold, want))) go(beat, want);
  }
  mem.tick = beat;
  const shot = closeAt(list[mem.cam]((mem.visits[mem.cam] ?? 1) - 1), Math.max(0, m.t - mem.cutT), m.t, mem.seed);
  shot.cut = did;
  return shot;
}

// ---- the crew at work: where the camera is this frame
export function direct(mode: CamMode, r: Room, m: Music, c: Cast, mem: Memory): Shot {
  const first = !Number.isFinite(mem.t), dt = listen(m, mem);
  // the drone dives in on a drop (for eight bars), pulls out when it's quiet
  const want = dropping(m, mem) || mem.partBig ? 1 : quiet(mem) ? 0 : 0.55 * ease(0.3, 0.8, mem.loud);
  [mem.dive, mem.diveV] = spring(mem.dive, mem.diveV, want, 0.8, dt);
  let shot: Shot;
  switch (mode) {
    case 'broadcast': shot = broadcast(r, m, c, mem, () => craneAt(r, m.t, mem.loud)); break;
    case 'crane': shot = craneAt(r, m.t, mem.loud); break;
    case 'steadicam': shot = steadicamAt(r, m.t); break;
    case 'drone': shot = droneAt(r, m.t, mem.dive); break;
    case 'bandcam': shot = bandcam(r, m, c, mem); break;
    default: { const p = tourAt(r, m.t); shot = shotOf(P(p), P(r.tour.at), LENS, 0, 'tour'); }
  }
  if (first) shot.cut = true;
  if (mode !== 'tour') shot.pos = clear(spaceOf(r, c), shot.pos, mem);
  return shot;
}
