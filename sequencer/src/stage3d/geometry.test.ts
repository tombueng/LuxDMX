import { describe, expect, it } from 'vitest';
import { aimAt, beamDir, defaultPlace, hitFloor, nearestTruss, onDeck, pivotOf, planToWorld, roomOf, ROOMS, tourAt, toLocal, toWorld, worldToPlan, BAND, D, DECK, TRUSS_HANG, type Optics } from './geometry';

const O: Optics = { panDeg: 540, tiltDeg: 270, panOffset: 0, tiltOffset: 0, invertPan: false, invertTilt: false };
const near = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, e = 1e-6) =>
  expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(e);

describe('3D stage geometry', () => {
  it('a standing head at 50/50 points straight up, a hanging one straight down', () => {
    near(beamDir(0.5, 0.5, { yaw: 0, pitch: 0, roll: 0 }, O), { x: 0, y: 1, z: 0 });
    near(beamDir(0.5, 0.5, { yaw: 0, pitch: 0, roll: 180 }, O), { x: 0, y: -1, z: 0 });
  });
  it('tilt goes towards the front at pan 50 %, pan turns it round', () => {
    const t90 = 0.5 + 90 / 270;
    near(beamDir(0.5, t90, { yaw: 0, pitch: 0, roll: 0 }, O), { x: 0, y: 0, z: 1 });
    near(beamDir(0.5 + 90 / 540, t90, { yaw: 0, pitch: 0, roll: 0 }, O), { x: 1, y: 0, z: 0 });
  });
  it('to its own frame and back', () => {
    const r = { yaw: 30, pitch: 20, roll: 180 }, v = { x: 0.3, y: -0.5, z: 0.8 };
    near(toLocal(toWorld(v, r), r), v);
  });
  it('"point here": the pan and tilt it finds point the beam at the spot, hanging or standing, calibrated or inverted', () => {
    const target = { x: 2, y: DECK, z: 1.5 };
    for (const rot of [{ yaw: 0, pitch: 0, roll: 180 }, { yaw: 40, pitch: 0, roll: 0 }, { yaw: -20, pitch: 10, roll: 180 }])
      for (const o of [O, { ...O, panOffset: 30, tiltOffset: -10 }, { ...O, invertPan: true, invertTilt: true }, { ...O, panDeg: 360, tiltDeg: 240 }, { ...O, swap: true, invertTilt: true }]) {
        const p = { x: -3, y: 6.8, z: 3.4 };
        const a = aimAt(rot.roll ? p : { x: -3, y: DECK, z: -2 }, rot, target, o)!;
        expect(a).toBeDefined();
        const from = pivotOf(rot.roll ? p : { x: -3, y: DECK, z: -2 }, rot);
        const d = beamDir(a.pan, a.tilt, rot, o), want = { x: target.x - from.x, y: target.y - from.y, z: target.z - from.z };
        const l = Math.hypot(want.x, want.y, want.z);
        near(d, { x: want.x / l, y: want.y / l, z: want.z / l }, 1e-6);
      }
  });
  it('the nearest pan of the two that reach (no swing round)', () => {
    const rot = { yaw: 0, pitch: 0, roll: 180 }, p = { x: 0, y: 7, z: 3.4 }, t = { x: 3, y: DECK, z: 0 };
    const a = aimAt(p, rot, t, O, { pan: 0.1, tilt: 0.5 })!, b = aimAt(p, rot, t, O, { pan: 0.9, tilt: 0.5 })!;
    expect(a.pan).toBeLessThan(0.5);
    expect(b.pan).toBeGreaterThan(0.5);
  });
  it('a beam meets the deck, or the floor in front of it, or nothing going up', () => {
    near(hitFloor({ x: 0, y: 7, z: 0 }, { x: 0, y: -1, z: 0 })!, { x: 0, y: DECK, z: 0 });
    expect(hitFloor({ x: 0, y: 7, z: 4 }, { x: 0, y: -0.5, z: 0.5 })!.y).toBe(0);
    expect(hitFloor({ x: 0, y: 2, z: 0 }, { x: 0, y: 1, z: 0 })).toBeUndefined();
  });
  it('default places: movers hang on the nearest truss, bars stand on the deck', () => {
    const m = defaultPlace({ x: 0.5, y: 0.9 }, 'mover');
    expect(m.rot.roll).toBe(180);
    expect(m.p.y).toBeGreaterThan(6);
    expect(defaultPlace({ x: 0.2, y: 0.1 }, 'bar').p.y).toBe(DECK);
    // a PAR on the truss points down at the deck
    const par = defaultPlace({ x: 0.3, y: 0.5 }, 'par');
    expect(beamDir(0.5, 0.5, par.rot, { ...O, panDeg: 0, tiltDeg: 0 }).y).toBeLessThan(-0.5);
  });
});

describe('calibration', () => {
  it('from where the real head points, the offsets that make the model point there too', async () => {
    const { calibrate } = await import('./geometry');
    const rot = { yaw: 0, pitch: 0, roll: 180 }, p = { x: -2, y: 6.8, z: 3.4 }, target = { x: 1, y: DECK, z: 0 };
    // the real head's 50 % is 30° of pan and -12° of tilt off from what the model thinks
    const truth = { ...O, panOffset: 30, tiltOffset: -12 };
    const v = aimAt(p, rot, target, truth)!;
    const c = calibrate(p, rot, target, v.pan, v.tilt, O);
    const o = pivotOf(p, rot), d = beamDir(v.pan, v.tilt, rot, { ...O, ...c }), want = { x: target.x - o.x, y: target.y - o.y, z: target.z - o.z }, l = Math.hypot(want.x, want.y, want.z);
    near(d, { x: want.x / l, y: want.y / l, z: want.z / l }, 1e-6);
    expect(Math.abs(c.panOffset)).toBeLessThanOrEqual(180);
  });
});

it('a fog machine stands on the deck with its nozzle towards the band, wherever it is', () => {
  for (const at of [{ x: 0.2, y: 0.95 }, { x: 0.8, y: 0.9 }, { x: 0.5, y: 0.98 }, { x: 0.05, y: 0.6 }]) {
    const { p, rot } = defaultPlace(at, 'fog');
    expect(p.y).toBe(DECK);
    const front = toWorld({ x: 0, y: 0, z: 1 }, rot), to = { x: BAND.x - p.x, z: BAND.z - p.z }, l = Math.hypot(to.x, to.z);
    expect(front.x * to.x / l + front.z * to.z / l).toBeGreaterThan(0.99);
  }
});

describe('the rooms', () => {
  const plan = [0, 0.25, 0.5, 0.75, 1];
  it('the hall is what it always was (its tour inside the walls); anything but "pub" is the hall', () => {
    expect(roomOf(undefined)).toBe(ROOMS.hall); expect(roomOf('stadium')).toBe(ROOMS.hall); expect(roomOf('pub')).toBe(ROOMS.pub);
    for (const x of plan) for (const y of plan) expect(defaultPlace({ x, y }, 'par')).toEqual(defaultPlace({ x, y }, 'par', ROOMS.hall));
    const want = [Math.sin(0.7) * 22, 5 + Math.sin(0.49) * 2.5, Math.cos(0.7) * 24 + 4];
    tourAt(ROOMS.hall, 10).forEach((v, i) => expect(v).toBeCloseTo(want[i], 9));
  });
  it('in the pub a light without a place of its own hangs on its little rig, inside the room, under the ceiling', () => {
    const r = ROOMS.pub;
    for (const x of plan) for (const y of plan) {
      for (const k of ['mover', 'par', 'strobe'] as const) {
        const { p } = defaultPlace({ x, y }, k, r), t = nearestTruss(p.z, r);
        expect(r.truss).toContain(t);
        expect(p.y).toBeCloseTo(t.y - TRUSS_HANG, 6); expect(p.y).toBeLessThan(r.ceiling - 0.5);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(r.deck.x);
      }
      // bars and machines stand on the pub's deck
      const bar = defaultPlace({ x, y }, 'bar', r).p;
      expect(bar.y).toBe(DECK); expect(onDeck(bar.x, bar.z, r)).toBe(true);
    }
    // a quarter across the plan is a quarter across this deck; and back
    expect(planToWorld(0.25, 0.5, r).x).toBeCloseTo(-r.W / 4, 6);
    const w = planToWorld(0.3, 0.8, r), back = worldToPlan(w.x, w.z, r);
    expect(back.x).toBeCloseTo(0.3, 6); expect(back.y).toBeCloseTo(0.8, 6);
    // the deck's front edge is where the hall's is: the audience floor starts there in both
    expect(r.deck.z1).toBe(D / 2);
  });
  it('a beam lands on the deck of the room shown, beside it on the floor', () => {
    const p = { x: 4.8, y: 4, z: 0 }, down = { x: 0, y: -1, z: 0 };
    expect(hitFloor(p, down, ROOMS.hall)!.y).toBe(DECK);
    expect(hitFloor(p, down, ROOMS.pub)!.y).toBe(0);
  });
  it('the demos\' rooms: their own ids, every view and the tour inside, a light without a place on their rig or their floor', () => {
    for (const id of ['club', 'party', 'truss'] as const) {
      const r = ROOMS[id], w = r.walls, inside = ([x, y, z]: number[]) => Math.abs(x) < w.x && y > 0 && y < r.ceiling && z > w.z0 && z < w.z1;
      expect(roomOf(id)).toBe(r);
      for (const [k, v] of Object.entries(r.views)) if (k !== 'top') expect(inside(v.pos), `${id} ${k}`).toBe(true);
      for (let t = 0; t < 100; t += 1.7) expect(inside(tourAt(r, t)), `${id} ${t}`).toBe(true);
      // every piece of truss inside the room, under the ceiling, its towers standing on the floor
      for (const [a, b] of r.frame!) for (const p of [a, b]) { expect(inside([p[0], Math.max(p[1], 0.01), p[2]]), `${id} truss`).toBe(true); expect(p[1]).toBeGreaterThanOrEqual(0); }
      for (const x of plan) for (const y of plan) {
        const hung = defaultPlace({ x, y }, 'mover', r).p, t = nearestTruss(hung.z, r);
        expect(hung.y).toBeCloseTo(t.y - TRUSS_HANG, 6);
        const bar = defaultPlace({ x, y }, 'bar', r).p;
        expect(bar.y).toBe(r.deck.x > 0 ? DECK : 0);
      }
    }
    // no stage at the party or in the test room: nothing is on a deck, beams land on the floor
    for (const id of ['party', 'truss'] as const) { expect(onDeck(0, 0, ROOMS[id])).toBe(false); expect(hitFloor({ x: 0, y: 4, z: 3 }, { x: 0, y: -1, z: 0 }, ROOMS[id])!.y).toBe(0); }
    // the club's deck is where the hall's front edge is
    expect(ROOMS.club.deck.z1).toBe(D / 2); expect(onDeck(0, 1, ROOMS.club)).toBe(true);
  });
  it('every view and the tour of the pub are inside the room', () => {
    const r = ROOMS.pub, inside = ([x, y, z]: number[]) => Math.abs(x) < 4.6 && y > 0 && y < r.ceiling && z > -1.8 && z < 14.6;
    for (const [k, v] of Object.entries(r.views)) if (k !== 'top') expect(inside(v.pos), k).toBe(true);
    for (let t = 0; t < 100; t += 1.7) expect(inside(tourAt(r, t)), String(t)).toBe(true);
  });
});

