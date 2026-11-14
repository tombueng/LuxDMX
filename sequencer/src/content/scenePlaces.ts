// Where the Cinema, Bar, Theatre and Church templates' lights are installed in their rooms
// (stage3d/scenes.ts), and the DJ / Party template's in the club (the DJ demo's room): every light
// where it belongs, turned the way it works, by its name ("Wall 3" is the third wall washer).
// The plan follows: each light's plan place is where it is in the room.
import type { Fixture, Show } from '../model/types';
import { aimRot, roomOf, TRUSS_HANG, worldToPlan, type Rot, type V3 } from '../stage3d/geometry';
import { BALLROOM, BAR, CHURCH, CINEMA, cinemaFloor, THEATRE } from '../stage3d/sceneSizes';
import { DECK } from '../stage3d/geometry';

type Place = { p: V3; rot: Rot };
type Table = Record<string, (i: number, n: number) => Place>;
const aim = (p: V3, t: V3): Place => ({ p, rot: aimRot(p, t) });
const hung = (p: V3): Place => ({ p, rot: { yaw: 0, pitch: 0, roll: 180 } });           // (a moving head under a truss)
const stand = (p: V3, yaw = 0): Place => ({ p, rot: { yaw, pitch: 0, roll: 0 } });
const spread = (i: number, n: number, a: number, b: number) => (n === 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1));

// ---- the cinema
const C = CINEMA, stageT = C.stageTruss.z, stageY = C.stageTruss.y - TRUSS_HANG, fohT = C.foh.z, fohY = C.foh.y - TRUSS_HANG;
const CINEMA_PLACES: Table = {
  // downlights in the ceiling over the rows
  House: (i, n) => { const x = i % 2 ? 6.5 : -6.5, z = 12 + Math.floor(i / 2) * (n > 4 ? 6 : 12); return aim({ x, y: C.ceiling - 0.25, z }, { x, y: 0, z: z + 0.2 }); },
  // washers low on the side walls, washing them up to the ceiling
  // (tipped a little towards the wall: the wash runs up it from about a metre up)
  Wall: (i, n) => { const sx = i < n / 2 ? -1 : 1, k = i % Math.ceil(n / 2), m = Math.ceil(n / 2), z = 4 + k * (28 / Math.max(1, m - 1 || 1)), x = sx * (C.wallX - 0.3), y = cinemaFloor(z) + 0.35; return aim({ x, y, z }, { x: sx * C.wallX, y: y + 3, z }); },
  // over the screen, the marquee's bars shining out over the rows
  Marquee: (i, n) => { const x = spread(i, n, -7, 7), y = C.screenY + C.screenH + 0.25; return aim({ x, y, z: C.screenZ + 0.45 }, { x: x * 1.2, y: 3, z: 14 }); },
  // the stage's wash, from its truss
  Stage: (i, n) => { const x = spread(i, n, -7, 7); return aim({ x, y: stageY, z: stageT }, { x: x * 0.5, y: DECK, z: -1 }); },
  // the spots on the bar over the front rows
  Spot: (i, n) => hung({ x: spread(i, n, -4.5, 4.5), y: fohY, z: fohT }),
  // step lights in the aisles, shining across the steps
  Step: (i, n) => { const ax = C.aisles[i % 2], k = Math.floor(i / 2), z = C.rowZ0 + (3 + k * 6) * C.rowD + 0.2, y = cinemaFloor(z) + 0.12, x = ax - 0.4 * Math.sign(ax || 1); void n; return aim({ x, y, z }, { x: ax + Math.sign(ax || 1) * 0.6, y: y - 0.1, z: z + 0.3 }); },
  // star bars flat on the ceiling, shining down
  Ceiling: (i) => { const x = i % 2 ? 7 : -7, z = i < 2 ? 11 : 23; return aim({ x, y: C.ceiling - 0.15, z }, { x, y: 0, z }); },
  Hazer: () => stand({ x: 9, y: DECK, z: -3.5 }, -30),
  Confetti: (i) => stand({ x: i ? 9.5 : -9.5, y: DECK, z: 1.6 }),
  CO2: (i) => stand({ x: i ? 10 : -10, y: DECK, z: -2.2 }),
  Sparks: (i) => stand({ x: i ? 4.5 : -4.5, y: DECK, z: 1.8 }),
  Bubbles: () => stand({ x: 0, y: DECK, z: -3.4 }),
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
const E = Th.electrics, FOH = Th.foh, cycE = E[E.length - 1];
const THEATRE_PLACES: Table = {
  // (the front-of-house bar out over the stalls: on the plan out in the house, in front of the stage)
  Front: (i, n) => { const x = n === 6 ? [-7.5, -5, -2.5, 2.5, 5, 7.5][i] : spread(i, n, -7.5, 7.5); return aim({ x, y: hang(FOH.y), z: FOH.z }, { x: x * 0.5, y: DECK + 1.6, z: 0 }); },
  Cyc: (i, n) => { const x = spread(i, n, -8.5, 8.5); return aim({ x, y: hang(cycE.y), z: cycE.z }, { x, y: DECK + 6, z: Th.cycZ }); },
  // (over the stalls, behind the front-of-house bar)
  House: (i, n) => { const x = spread(i, n, -6, 6); return aim({ x, y: Th.ceiling - 0.4, z: 14 }, { x, y: 0, z: 14.2 }); },
  Boom: (i) => { const sx = i < 2 ? -1 : 1, low = i % 2 === 1, z = Th.booms.z[low ? 1 : 0], x = sx * Th.booms.x, y = DECK + (low ? 1.6 : 3.4); return aim({ x, y, z }, { x: -sx * 2, y: DECK + 1.6, z }); },
  Special: (i, n) => { const x = spread(i, n, -6, 6); return aim({ x, y: hang(E[0].y), z: E[0].z }, { x: x * 0.6, y: DECK, z: -2.5 }); },
  Spot: (i, n) => hung({ x: spread(i, n, -7, 7), y: hang(E[1].y), z: E[1].z }),
  Wash: (i, n) => hung({ x: [-9, -4.5, 4.5, 9][i] ?? spread(i, n, -9, 9), y: hang(E[2].y), z: E[2].z }),
  Footlight: (i, n) => { const x = spread(i, n, -7, 7); return aim({ x, y: DECK, z: Th.stage.z1 - 0.15 }, { x, y: DECK + 1.8, z: 0 }); },
  'Ground row': (i, n) => { const x = spread(i, n, -8, 8); return aim({ x, y: DECK, z: Th.cycZ + 0.6 }, { x, y: DECK + 8, z: Th.cycZ }); },
  Lightning: () => aim({ x: 0, y: hang(cycE.y), z: cycE.z }, { x: 0, y: DECK + 7, z: Th.cycZ }),
  // (on the proscenium, either side of the opening, turned out to the audience)
  Blinder: (i) => { const sx = i ? 1 : -1; return aim({ x: sx * (Th.arch.w / 2 - 0.6), y: DECK + 7, z: Th.arch.z + 0.45 }, { x: sx * 4, y: 2, z: 16 }); },
  Fog: () => stand({ x: -9, y: DECK, z: -6 }, 90),
  Hazer: () => stand({ x: 12, y: DECK, z: -9.5 }, -90),
  Confetti: () => stand({ x: 0, y: DECK, z: 3.2 }),
  // (the machines apart from the booms and each other: on the plan they sat on top of them)
  CO2: () => stand({ x: -9.5, y: DECK, z: -4.6 }),
  Sparks: (i) => stand({ x: i ? 8 : -8, y: DECK, z: 3.2 }),
  Flame: (i) => stand({ x: i ? 5 : -5, y: DECK, z: -9.5 }),
  Bubbles: () => stand({ x: 9.5, y: DECK, z: -4.6 }, -30),
};

// ---- the church: hung from the roof's beams (over the chancel, over the nave), uplights on the walls
// between the windows, battens behind the altar lighting the cross
const Chu = CHURCH, beam = Chu.ceiling - 0.8 - TRUSS_HANG;
const CHURCH_PLACES: Table = {
  Front: (i, n) => { const x = spread(i, n, -4.5, 4.5); return aim({ x, y: beam, z: 2.2 }, { x: x * 0.4, y: DECK + 1.6, z: -3.5 }); },
  Wash: (i, n) => { const x = spread(i, n, -4.5, 4.5); return aim({ x, y: beam, z: -1.8 }, { x: x * 0.6, y: DECK, z: -4 }); },
  // (from the beam over the chancel, either side of the altar: clear of the washes on the next beam)
  Altar: (i) => aim({ x: i ? 2.6 : -2.6, y: beam, z: -5.8 }, { x: 0, y: DECK + 1, z: Chu.altarZ }),
  Lectern: () => aim({ x: -6, y: beam, z: -1.8 }, { x: Chu.lecternX, y: DECK + 1.3, z: -2.4 }),
  Choir: (i) => { const x = [-5.5, -3.5, 3.5, 5.5][i] ?? 0; return aim({ x, y: beam, z: -5.8 }, { x: Math.sign(x) * 4.3, y: DECK, z: -4.6 }); },
  Head: (i, n) => hung({ x: spread(i, n, -4.5, 4.5), y: beam, z: 6.2 }),
  Wall: (i, n) => { const sx = i < n / 2 ? -1 : 1, k = i % Math.ceil(n / 2), z = [3.75, 8.25, 12.75][k] ?? 3.75, x = sx * (Chu.wallX - 0.3); return aim({ x, y: 0.1, z }, { x: sx * Chu.wallX, y: 3, z }); },
  Blinder: (i) => { const sx = i ? 1 : -1; return aim({ x: sx * 3.2, y: DECK, z: Chu.chancel.z1 - 0.3 }, { x: sx * 2, y: 1.6, z: 10 }); },
  Batten: (i) => { const x = i ? 1.5 : -1.5; return aim({ x, y: DECK, z: Chu.chancel.z0 + 0.4 }, { x: x * 0.3, y: DECK + 5, z: Chu.chancel.z0 - 0.4 }); },
  Hazer: () => stand({ x: 5.5, y: DECK, z: -6.8 }, -150),
  Bubbles: () => stand({ x: 0, y: DECK, z: Chu.chancel.z1 - 0.4 }),
  Confetti: (i) => stand({ x: i ? 6.5 : -6.5, y: 0, z: 21 }, 180),
  Sparks: (i) => stand({ x: i ? 5.2 : -5.2, y: DECK, z: Chu.chancel.z1 - 0.3 }),
};

// ---- the club (geometry.ts ROOMS.club, the DJ demo's room): beams and movers under the back truss,
// washes and blinders on the front one, PARs on the floor's truss lighting the stage, uplights along
// the drape behind the DJ, LED bars against the booth, battens either side of it leaning out to the
// crowd, the machines on the deck (spread out, so the plan stays readable)
const Cl = roomOf('club'), BACK = Cl.truss[0], FRONT = Cl.truss[1], FLOOR = Cl.truss[2];
const CLUB_PLACES: Table = {
  Beam: (i, n) => hung({ x: spread(i, n, -3.6, 3.6), y: hang(BACK.y), z: BACK.z }),
  Mover: (i) => hung({ x: i ? 5.2 : -5.2, y: hang(BACK.y), z: BACK.z }),
  Strobe: (i) => { const p = i === 0 ? { x: 0, y: hang(BACK.y), z: BACK.z } : { x: i === 1 ? -2.8 : 2.8, y: hang(FRONT.y), z: FRONT.z }; return aim(p, { x: p.x * 0.6, y: 1.6, z: 12 }); },
  Wash: (i, n) => hung({ x: spread(i, n, -4.2, 4.2), y: hang(FRONT.y), z: FRONT.z }),
  Blinder: (i) => { const x = i ? 5.4 : -5.4; return aim({ x, y: hang(FRONT.y), z: FRONT.z }, { x: x * 0.8, y: 1.6, z: 13 }); },
  PAR: (i, n) => { const x = spread(i, n, -5.6, 5.6); return aim({ x, y: hang(FLOOR.y), z: FLOOR.z }, { x: x * 0.5, y: DECK + 1.2, z: 1.0 }); },
  Bar: (i) => ({ p: { x: i ? 0.55 : -0.55, y: DECK + 0.05, z: 2.12 }, rot: { yaw: 0, pitch: 75, roll: 0 } }),
  Batten: (i) => ({ p: { x: [-5, -3, 3, 5][i] ?? 0, y: DECK + 0.05, z: 0.6 }, rot: { yaw: 0, pitch: 50, roll: 0 } }),
  Uplight: (i, n) => { const x = spread(i, n, -4.8, 4.8); return aim({ x, y: DECK, z: Cl.deck.z0 + 0.35 }, { x, y: DECK + 5, z: Cl.deck.z0 + 0.05 }); },
  Fog: () => stand({ x: -0.6, y: DECK, z: 0.15 }),
  Hazer: () => stand({ x: 2.6, y: DECK, z: -0.3 }),
  CO2: (i) => stand({ x: i ? 5.6 : -5.6, y: DECK, z: 2.1 }),
  Confetti: (i) => ({ p: { x: i ? 5.6 : -5.6, y: DECK, z: 3.0 }, rot: { yaw: 0, pitch: 20, roll: 0 } }),
  Sparks: (i) => stand({ x: i ? 0.5 : -0.5, y: DECK, z: 3.0 }),
  Flame: (i) => stand({ x: i ? 3 : -3, y: DECK, z: 3.5 }),
  Bubbles: () => stand({ x: -3.2, y: DECK, z: 2.5 }),
};

// ---- the ballroom (a wedding): uplights at the foot of the draped walls, washing them; pinspots in
// the ceiling over the tables' centrepieces; the gobo spots and the heads on the pipes over the
// dance floor; warm white on the head table, a spot on the cake, the chandeliers' own lamps; the
// machines round the dance floor
const Bl = BALLROOM, pipeHang = Bl.pipeY - TRUSS_HANG, ceil = Bl.ceiling - 0.15;
const BALLROOM_PLACES: Table = {
  // five up each side wall, four along the back wall beside the head table
  Uplight: (i) => {
    if (i < 10) { const sx = i < 5 ? -1 : 1, z = [0, 4, 8, 12, 16][i % 5], x = sx * (Bl.wallX - 0.3); return aim({ x, y: 0.1, z }, { x: sx * Bl.wallX, y: 3, z }); }
    const x = [-9.6, -5.6, 5.6, 9.6][i - 10] ?? 0, z = Bl.z0 + 0.3; return aim({ x, y: 0.1, z }, { x, y: 3, z: Bl.z0 });
  },
  Pinspot: (i) => { const [x, z] = Bl.tables[i % Bl.tables.length]; return aim({ x: x * 0.92, y: ceil, z: z - 0.4 }, { x, y: 0.9, z }); },
  Spot: (i) => hung({ x: i ? 2 : -2, y: pipeHang, z: Bl.pipes[0] }),
  Head: (i) => hung({ x: i % 2 ? 4 : -4, y: pipeHang, z: Bl.pipes[i < 2 ? 0 : 1] }),
  Dance: (i, n) => { const x = spread(i, n, -2.4, 2.4); return aim({ x, y: pipeHang, z: Bl.pipes[1] }, { x: x * 0.8, y: 0, z: 7.2 }); },
  'Head table': (i) => { const x = i ? 2.5 : -2.5; return aim({ x, y: ceil, z: -1.2 }, { x: x * 0.6, y: 1.0, z: Bl.head.z - 0.4 }); },
  // (from the ceiling over the head table's end, clear of the pinspot over the table beside it)
  Cake: () => aim({ x: Bl.cake.x - 1.6, y: ceil, z: -2.2 }, { x: Bl.cake.x, y: 1.3, z: Bl.cake.z }),
  Chandelier: (i) => { const [x, z] = Bl.chandeliers[i % Bl.chandeliers.length]; return aim({ x, y: Bl.ceiling - 1.62, z }, { x, y: 0, z }); },
  Hazer: () => stand({ x: 10.2, y: 0, z: 19.2 }, -135),
  // (round the dance floor's corners, clear of the heads over them: on the plan they were on top
  // of each other)
  'Low fog': () => stand({ x: -5.3, y: 0, z: 1.6 }, 45),
  Sparks: (i) => stand({ x: i ? 5.3 : -5.3, y: 0, z: 11.4 }),
  Bubbles: () => stand({ x: 5.3, y: 0, z: 1.6 }, -45),
  Confetti: () => stand({ x: -1.8, y: 0, z: 11.2 }, 180),
};

type SceneRoom = 'cinema' | 'bar' | 'theatre' | 'church' | 'club' | 'ballroom';
const TABLES: Record<SceneRoom, Table> = { cinema: CINEMA_PLACES, bar: BAR_PLACES, theatre: THEATRE_PLACES, church: CHURCH_PLACES, club: CLUB_PLACES, ballroom: BALLROOM_PLACES };

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
