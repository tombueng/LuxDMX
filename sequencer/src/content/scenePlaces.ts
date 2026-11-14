// Where the Cinema and Bar templates' lights are installed in their rooms (stage3d/scenes.ts): every
// light where it belongs, turned the way it works, by its name ("Wall 3" is the third wall washer).
// The plan follows: each light's plan place is where it is in the room.
import type { Fixture, Show } from '../model/types';
import { aimRot, roomOf, TRUSS_HANG, worldToPlan, type Rot, type V3 } from '../stage3d/geometry';
import { BAR, CHURCH, CINEMA, cinemaFloor, THEATRE } from '../stage3d/sceneSizes';
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

// ---- the theatre: the front-of-house bar, the electrics over the stage, the cyc bar, booms in the
// wings, footlights on the apron, a ground row before the cyc
const Th = THEATRE, hang = (y: number) => y - TRUSS_HANG;
const THEATRE_PLACES: Table = {
  Front: (i, n) => { const x = spread(i, n, -5, 5); return aim({ x, y: hang(10.4), z: 8.4 }, { x: x * 0.5, y: DECK + 1.6, z: 0.5 }); },
  Cyc: (i, n) => { const x = spread(i, n, -5.25, 5.25); return aim({ x, y: hang(9.0), z: -4.8 }, { x, y: DECK + 3.5, z: Th.cycZ }); },
  House: (i) => { const x = i ? 4 : -4; return aim({ x, y: Th.ceiling - 0.4, z: 9 }, { x, y: 0, z: 9.2 }); },
  Boom: (i) => { const sx = i < 2 ? -1 : 1, low = i % 2 === 1, z = low ? 1.0 : -1.2, x = sx * 7.2, y = DECK + (low ? 1.4 : 2.6); return aim({ x, y, z }, { x: -sx * 1.5, y: DECK + 1.4, z }); },
  Special: (i, n) => { const x = spread(i, n, -4.5, 4.5); return aim({ x, y: hang(7.8), z: -0.2 }, { x: x * 0.6, y: DECK, z: -1.5 }); },
  Spot: (i, n) => hung({ x: spread(i, n, -4.5, 4.5), y: hang(7.8), z: -2.6 }),
  Wash: (i, n) => hung({ x: [-6, -3, 3, 6][i] ?? spread(i, n, -6, 6), y: hang(7.8), z: -0.2 }),
  Footlight: (i, n) => { const x = spread(i, n, -4.5, 4.5); return aim({ x, y: DECK, z: Th.stage.z1 - 0.15 }, { x, y: DECK + 1.8, z: 0 }); },
  'Ground row': (i, n) => { const x = spread(i, n, -4, 4); return aim({ x, y: DECK, z: Th.cycZ + 0.5 }, { x, y: DECK + 5, z: Th.cycZ }); },
  Lightning: () => aim({ x: 0, y: hang(9.0), z: -4.8 }, { x: 0, y: DECK + 4, z: Th.cycZ }),
  Blinder: (i) => { const sx = i ? 1 : -1; return aim({ x: sx * 6.5, y: DECK + 5, z: Th.arch.z + 0.45 }, { x: sx * 3, y: 2, z: 12 }); },
  Fog: () => stand({ x: -6.5, y: DECK, z: -3.5 }, 90),
  Hazer: () => stand({ x: 6.5, y: DECK, z: -4.5 }, -90),
  Confetti: () => stand({ x: 0, y: DECK, z: 3.0 }),
  CO2: () => stand({ x: 6.8, y: DECK, z: 1.2 }),
  Sparks: (i) => stand({ x: i ? 5.5 : -5.5, y: DECK, z: 3.1 }),
  Flame: (i) => stand({ x: i ? 3 : -3, y: DECK, z: -4.2 }),
  Bubbles: () => stand({ x: -5.5, y: DECK, z: 2.6 }, 30),
};

// ---- the church: hung from the roof's beams (over the chancel, over the nave), uplights on the walls
// between the windows, battens behind the altar lighting the cross
const Chu = CHURCH, beam = Chu.ceiling - 0.8 - TRUSS_HANG;
const CHURCH_PLACES: Table = {
  Front: (i, n) => { const x = spread(i, n, -4.5, 4.5); return aim({ x, y: beam, z: 2.2 }, { x: x * 0.4, y: DECK + 1.6, z: -3.5 }); },
  Wash: (i, n) => { const x = spread(i, n, -4.5, 4.5); return aim({ x, y: beam, z: -1.8 }, { x: x * 0.6, y: DECK, z: -4 }); },
  Altar: (i) => aim({ x: i ? 2 : -2, y: beam, z: -1.8 }, { x: 0, y: DECK + 1, z: Chu.altarZ }),
  Lectern: () => aim({ x: -6, y: beam, z: -1.8 }, { x: Chu.lecternX, y: DECK + 1.3, z: -2.4 }),
  Choir: (i) => { const x = [-5.5, -3.5, 3.5, 5.5][i] ?? 0; return aim({ x, y: beam, z: -5.8 }, { x: Math.sign(x) * 4.3, y: DECK, z: -4.6 }); },
  Head: (i, n) => hung({ x: spread(i, n, -4.5, 4.5), y: beam, z: 6.2 }),
  Wall: (i, n) => { const sx = i < n / 2 ? -1 : 1, k = i % Math.ceil(n / 2), z = [3.75, 8.25, 12.75][k] ?? 3.75, x = sx * (Chu.wallX - 0.3); return aim({ x, y: 0.1, z }, { x: x * 0.98, y: 6, z }); },
  Blinder: (i) => { const sx = i ? 1 : -1; return aim({ x: sx * 3.2, y: DECK, z: Chu.chancel.z1 - 0.3 }, { x: sx * 2, y: 1.6, z: 10 }); },
  Batten: (i) => { const x = i ? 1.5 : -1.5; return aim({ x, y: DECK, z: Chu.chancel.z0 + 0.4 }, { x: x * 0.3, y: DECK + 5, z: Chu.chancel.z0 - 0.4 }); },
  Hazer: () => stand({ x: 5.5, y: DECK, z: -6.8 }, -150),
  Bubbles: () => stand({ x: 0, y: DECK, z: Chu.chancel.z1 - 0.4 }),
  Confetti: (i) => stand({ x: i ? 6.5 : -6.5, y: 0, z: 21 }, 180),
  Sparks: (i) => stand({ x: i ? 5.2 : -5.2, y: DECK, z: Chu.chancel.z1 - 0.3 }),
};

type SceneRoom = 'cinema' | 'bar' | 'theatre' | 'church';
const TABLES: Record<SceneRoom, Table> = { cinema: CINEMA_PLACES, bar: BAR_PLACES, theatre: THEATRE_PLACES, church: CHURCH_PLACES };

// every light of the show whose name the room has a place for: placed there (its 3D place and turn,
// and its plan place); returns how many
export function placeIn(s: Show, room: SceneRoom): number {
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
