// Where the Cinema and Bar templates' lights are installed in their rooms (stage3d/scenes.ts): every
// light where it belongs, turned the way it works, by its name ("Wall 3" is the third wall washer).
// The plan follows: each light's plan place is where it is in the room.
import type { Fixture, Show } from '../model/types';
import { aimRot, roomOf, TRUSS_HANG, worldToPlan, type Rot, type V3 } from '../stage3d/geometry';
import { BAR, CINEMA, cinemaFloor } from '../stage3d/sceneSizes';
import { DECK } from '../stage3d/geometry';

type Place = { p: V3; rot: Rot };
type Table = Record<string, (i: number, n: number) => Place>;
const aim = (p: V3, t: V3): Place => ({ p, rot: aimRot(p, t) });
const hung = (p: V3): Place => ({ p, rot: { yaw: 0, pitch: 0, roll: 180 } });           // (a moving head under a truss)
const stand = (p: V3, yaw = 0): Place => ({ p, rot: { yaw, pitch: 0, roll: 0 } });
const spread = (i: number, n: number, a: number, b: number) => (n === 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1));

// ---- the cinema
const C = CINEMA, stageT = 0.9, stageY = 8.2 - TRUSS_HANG, fohT = 6.4, fohY = 8.8 - TRUSS_HANG;
const CINEMA_PLACES: Table = {
  // downlights in the ceiling over the rows
  House: (i) => { const x = i % 2 ? 4.2 : -4.2, z = i < 2 ? 9 : 17; return aim({ x, y: C.ceiling - 0.25, z }, { x, y: 0, z: z + 0.2 }); },
  // washers low on the side walls, washing them up to the ceiling
  Wall: (i, n) => { const sx = i < n / 2 ? -1 : 1, k = i % Math.ceil(n / 2), z = 3 + k * 7, x = sx * (C.wallX - 0.3), y = cinemaFloor(z) + 0.35; return aim({ x, y, z }, { x: x * 0.98, y: y + 6, z }); },
  // over the screen, the marquee's bars shining out over the rows
  Marquee: (i, n) => { const x = spread(i, n, -4.5, 4.5), y = C.screenY + C.screenH + 0.25; return aim({ x, y, z: C.screenZ + 0.45 }, { x: x * 1.2, y: 3, z: 10 }); },
  // the stage's wash, from its truss
  Stage: (i, n) => { const x = spread(i, n, -4.5, 4.5); return aim({ x, y: stageY, z: stageT }, { x: x * 0.5, y: DECK, z: -0.6 }); },
  // the two spots on the bar over the front rows
  Spot: (i, n) => hung({ x: spread(i, n, -3, 3), y: fohY, z: fohT }),
  // step lights in the aisles, shining across the steps
  Step: (i, n) => { const ax = C.aisles[i % 2], k = Math.floor(i / 2), z = C.rowZ0 + (3 + k * 6) * C.rowD + 0.2, y = cinemaFloor(z) + 0.12, x = ax - 0.4 * Math.sign(ax || 1); void n; return aim({ x, y, z }, { x: ax + Math.sign(ax || 1) * 0.6, y: y - 0.1, z: z + 0.3 }); },
  // star bars flat on the ceiling, shining down
  Ceiling: (i) => { const x = i % 2 ? 5 : -5, z = i < 2 ? 8 : 16; return aim({ x, y: C.ceiling - 0.15, z }, { x, y: 0, z }); },
  Hazer: () => stand({ x: 6.2, y: DECK, z: -2.3 }, -30),
  Confetti: (i) => stand({ x: i ? 6.3 : -6.3, y: DECK, z: 1.2 }),
  CO2: (i) => stand({ x: i ? 6.6 : -6.6, y: DECK, z: -1.4 }),
  Sparks: (i) => stand({ x: i ? 2.2 : -2.2, y: DECK, z: 1.3 }),
  Bubbles: () => stand({ x: 0, y: DECK, z: -2.2 }),
};

// ---- the bar
const B = BAR, rail = B.rail - 0.18;
const BAR_PLACES: Table = {
  // colour PARs on the rails: three over the counter, three over the room
  PAR: (i, n) => { const front = i < n / 2, k = front ? i : i - Math.ceil(n / 2), x = spread(k, Math.ceil(n / 2), -4.5, 4.5), z = front ? -0.6 : 2.4; return aim({ x, y: rail, z }, front ? { x, y: B.counterH, z: B.counterZ } : { x, y: 0, z: z + 0.6 }); },
  // warm white over the counter, between the pendants
  Counter: (i, n) => { const x = spread(i, n, -2, 2); return aim({ x, y: 2.55, z: B.counterZ }, { x, y: 0, z: B.counterZ }); },
  // the back bar's uplights under the bottles
  Shelf: (i, n) => { const x = spread(i, n, -4.2, 4.2); return aim({ x, y: 1.08, z: B.backZ + 0.2 }, { x, y: 3.2, z: B.backZ - 0.1 }); },
  // the dance floor's wash
  Dance: (i, n) => { const x = spread(i, n, -2.7, 2.7); return aim({ x, y: rail, z: 5.0 }, { x: x * 0.6, y: 0, z: 4.6 }); },
  Head: (i, n) => hung({ x: spread(i, n, -2.5, 2.5), y: rail, z: 7.4 }),
  // pinspots on the mirror ball
  Pinspot: (i) => { const p = i ? { x: -5.4, y: rail, z: 5.0 } : { x: -1.2, y: rail, z: 2.4 }; return aim(p, { x: B.ball.x, y: B.ball.y, z: B.ball.z }); },
  Strobe: () => aim({ x: 0, y: rail, z: 5.0 }, { x: 0, y: 0, z: 5.0 }),
  Fog: () => stand({ x: -7.2, y: 0, z: 8.4 }, 140),
  Bubbles: () => stand({ x: 7.2, y: 0, z: 8.4 }, -140),
  Confetti: () => stand({ x: -4.2, y: 0, z: 7.6 }),
  CO2: () => stand({ x: 4.2, y: 0, z: 7.6 }),
  Sparks: (i) => stand({ x: i ? 3.9 : -3.9, y: 0, z: 2.7 }),
};

const TABLES: Record<'cinema' | 'bar', Table> = { cinema: CINEMA_PLACES, bar: BAR_PLACES };

// every light of the show whose name the room has a place for: placed there (its 3D place and turn,
// and its plan place); returns how many
export function placeIn(s: Show, room: 'cinema' | 'bar'): number {
  const table = TABLES[room], r = roomOf(room);
  const byKind = new Map<string, Fixture[]>();
  for (const f of s.fixtures) {
    const kind = f.name.replace(/\s+\d+$/, '');          // ("CO2" is a CO2, "Wall 3" a Wall)
    if (!table[kind]) continue;
    byKind.set(kind, [...(byKind.get(kind) ?? []), f]);
  }
  let n = 0;
  for (const [kind, fs] of byKind) fs.forEach((f, i) => {
    const pl = table[kind](i, fs.length);
    f.p3 = { x: +pl.p.x.toFixed(3), y: +pl.p.y.toFixed(3), z: +pl.p.z.toFixed(3) };
    f.rot = { yaw: Math.round(pl.rot.yaw), pitch: Math.round(pl.rot.pitch), roll: Math.round(pl.rot.roll) };
    const plan = worldToPlan(pl.p.x, pl.p.z, r);
    f.x = +plan.x.toFixed(3); f.y = +plan.y.toFixed(3);
    n++;
  });
  s.settings.stage3d = { ...s.settings.stage3d, room };
  return n;
}
