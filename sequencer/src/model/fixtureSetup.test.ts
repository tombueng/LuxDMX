// A light's setup (fixtureSetup.ts): mounts give the turn they say (the head and the front where
// they're meant to be, and the beam with them), a fixed light points where it's told, the light's
// own range, swap and offsets agree with Aim and calibration, a group copy (mirrored on the other
// side), what another mode does to the addresses after it, a mode's channel table, and the new
// fixture fields in a file (kept, mended, an old file untouched).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { beamDir, HALL, ROOMS, DECK, TRUSS_HANG, onDeck, toWorld, type Rot, type V3 } from '../stage3d/geometry';
import { GENERIC, modeOf } from './library';
import { emptyShow, parseShow, serializeShow } from './format';
import type { Fixture } from './types';
import { placesFor, shapeSize } from './pixelLayout';
import {
  aimHead, channelRows, copySetup, DIRS, dirOf, frontOf, frontsFor, marksOf, modeChange, motors, mountOf, mountRot, MOUNTS, offsetsFor, opticsOf,
  placeFor, pointOf, pointRot, POINTS, rigFixtureOf, rotFrom, upOf, withFront, type Dir,
  boardReach, restAt,
} from './fixtureSetup';

const near = (a: V3, b: V3, eps = 1e-3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < eps;
const head = (f: Partial<Fixture> = {}): Fixture => ({ id: 'h', name: 'Head 1', typeId: 'gen-mover8', mode: '8 ch', universe: 0, address: 1, x: 0.3, y: 0.4, ...f });

describe('mounting a moving head', () => {
  it('every mount and every front it can have: the head and the front end up where they say', () => {
    for (const m of MOUNTS) for (const front of frontsFor(DIRS[m.head])) {
      const r = rotFrom(DIRS[m.head], DIRS[front]);
      expect(near(upOf(r), DIRS[m.head]), `${m.id} ${front}`).toBe(true);
      expect(near(frontOf(r), DIRS[front]), `${m.id} ${front}`).toBe(true);
      expect(mountOf(r)).toBe(m.id);
    }
  });
  it('any up and front at all (the front made square to the up first)', () => {
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 300; i++) {
      const up = { x: rnd(), y: rnd(), z: rnd() }, fr = { x: rnd(), y: rnd(), z: rnd() };
      const r = rotFrom(up, fr), l = Math.hypot(up.x, up.y, up.z), u = { x: up.x / l, y: up.y / l, z: up.z / l };
      expect(near(upOf(r), u, 5e-3)).toBe(true);
      // (the front square to up, and on the same side as asked)
      const f = frontOf(r);
      expect(Math.abs(f.x * u.x + f.y * u.y + f.z * u.z)).toBeLessThan(5e-3);
      expect(f.x * fr.x + f.y * fr.y + f.z * fr.z).toBeGreaterThan(-1e-6);
    }
  });
  it('hung is upside down with its front to the audience (roll 180, as the 3D stage hangs heads); its beam at Home points down, standing up', () => {
    const o = opticsOf(head());
    const hung = mountRot('hang', { yaw: 0, pitch: 0, roll: 0 });
    expect(hung).toEqual({ yaw: 0, pitch: 0, roll: 180 });
    expect(beamDir(0.5, 0.5, hung, o).y).toBeCloseTo(-1, 5);
    const stand = mountRot('stand', hung);
    expect(stand).toEqual({ yaw: 0, pitch: 0, roll: 0 });
    expect(beamDir(0.5, 0.5, stand, o).y).toBeCloseTo(1, 5);
    // on its side on the left: the head towards the middle (+x), at Home its beam goes there
    const left = mountRot('left', stand);
    expect(dirOf(upOf(left))).toBe('right');
    expect(beamDir(0.5, 0.5, left, o).x).toBeCloseTo(1, 5);
    expect(dirOf(upOf(mountRot('right', stand)))).toBe('left');
    expect(dirOf(upOf(mountRot('back', stand)))).toBe('audience');
  });
  it('the front kept when it can be, and turned: pan 50 % tilts towards where the front faces', () => {
    const hung = withFront(mountRot('hang', { yaw: 0, pitch: 0, roll: 0 }), 'left');
    expect(dirOf(frontOf(hung))).toBe('left');
    expect(dirOf(frontOf(mountRot('stand', hung)))).toBe('left');
    // (at the back its head is towards the audience, so its front can't be: it faces down)
    expect(dirOf(frontOf(mountRot('back', hung)))).toBe('left');
    expect(dirOf(frontOf(mountRot('back', { yaw: 0, pitch: 0, roll: 180 })))).toBe('down');
    const o = opticsOf(head());
    // tilted a quarter of its range from Home, a hung head facing left points down and to the left
    const d = beamDir(0.5, 0.5 + 45 / 270, hung, o);
    expect(d.x).toBeLessThan(-0.6); expect(d.y).toBeLessThan(-0.6);
  });
});

describe('a fixed light', () => {
  it('points where each preset says, and the preset is recognised again', () => {
    const p = { x: 2, y: 7.25, z: 0 };
    for (const pt of POINTS) {
      const r = pointRot(pt.id, p, { yaw: 30, pitch: 0, roll: 0 }, HALL);
      expect(pointOf(p, r, HALL), pt.id).toBe(pt.id);
    }
    expect(upOf(pointRot('down', p, { yaw: 0, pitch: 0, roll: 0 }, HALL)).y).toBeCloseTo(-1, 5);
    expect(upOf(pointRot('audience', p, { yaw: 0, pitch: 0, roll: 0 }, HALL)).z).toBeGreaterThan(0.9);
    // at the stage: its beam lands on the deck towards the middle
    const s = upOf(pointRot('stage', p, { yaw: 0, pitch: 0, roll: 0 }, HALL)), k = (DECK - p.y) / s.y;
    expect(onDeck(p.x + s.x * k, p.z + s.z * k)).toBe(true);
    expect(Math.abs(p.x + s.x * k)).toBeLessThan(Math.abs(p.x));
  });
  it('hung goes onto the nearest truss, standing onto the deck or the floor, the rest stays', () => {
    expect(placeFor('truss', { x: 1, y: 1.2, z: 0.4 }, HALL)).toEqual({ x: 1, y: +(7.6 - TRUSS_HANG).toFixed(2), z: 0 });
    expect(placeFor('ground', { x: 1, y: 7.25, z: 0 }, HALL)).toEqual({ x: 1, y: DECK, z: 0 });
    expect(placeFor('ground', { x: 1, y: 3, z: 8 }, HALL).y).toBe(0);
    expect(placeFor('ground', { x: 0, y: 5, z: 7.5 }, ROOMS.party).y).toBe(0);
    expect(placeFor('keep', { x: 1.234, y: 2.345, z: -0.5 }, HALL)).toEqual({ x: 1.23, y: 2.35, z: -0.5 });
  });
});

describe('pan and tilt', () => {
  it("the light's own range first, then its type's, then 540 / 270", () => {
    const t = { ...GENERIC.find((x) => x.id === 'gen-mover8')!, physical: { panDeg: 630, tiltDeg: 265 } };
    expect(opticsOf(head())).toMatchObject({ panDeg: 540, tiltDeg: 270 });
    expect(opticsOf(head(), t)).toMatchObject({ panDeg: 630, tiltDeg: 265 });
    expect(opticsOf(head({ panDeg: 360, tiltDeg: 180 }), t)).toMatchObject({ panDeg: 360, tiltDeg: 180 });
    const m = modeOf(t, '8 ch');
    expect(rigFixtureOf(head({ panDeg: 360 }), m, 'mover', t, HALL).optics.panDeg).toBe(360);
  });
  it('swap sends pan to the tilt motor and back', () => {
    expect(motors({ swapPanTilt: true }, { pan: 0.2, tilt: 0.7 })).toEqual({ pan: 0.7, tilt: 0.2 });
    expect(motors({}, { pan: 0.2, tilt: 0.7 })).toEqual({ pan: 0.2, tilt: 0.7 });
  });
  it('pointed at a mark by hand, the offsets worked out make Aim point it there with the same values (swapped and inverted too)', () => {
    const rot: Rot = { yaw: 0, pitch: 0, roll: 180 }, p = { x: -2, y: 7.25, z: 0 };
    for (const f of [head(), head({ swapPanTilt: true }), head({ invertPan: true, swapPanTilt: true }), head({ invertTilt: true, panDeg: 630 })]) {
      for (const mark of marksOf(HALL)) {
        const byHand = { pan: 0.47, tilt: 0.61 };
        // (the hand-pointed values must be ones that reach the floor: pick them by aiming first)
        const o0 = opticsOf(f), first = aimHead(f, p, rot, o0, mark.p, { pan: 0.5, tilt: 0.5 })!;
        const real = { pan: first.pan + (byHand.pan - 0.5) * 0.1, tilt: first.tilt + (byHand.tilt - 0.5) * 0.1 };
        const off = offsetsFor(f, p, rot, o0, mark.p, real);
        const o = opticsOf({ ...f, ...off });
        const again = aimHead(f, p, rot, o, mark.p, real)!;
        expect(Math.abs(again.pan - real.pan) * o.panDeg, `${mark.id}`).toBeLessThan(0.2);
        expect(Math.abs(again.tilt - real.tilt) * o.tiltDeg, `${mark.id}`).toBeLessThan(0.2);
      }
    }
  });
  it('the marks are on the stage in every room with one, on the floor in the party room', () => {
    for (const r of [HALL, ROOMS.pub, ROOMS.club]) for (const m of marksOf(r)) { expect(onDeck(m.p.x, m.p.z, r), `${r.id} ${m.id}`).toBe(true); expect(m.p.y).toBe(DECK); }
    for (const m of marksOf(ROOMS.party)) expect(m.p.y).toBe(0);
    expect(marksOf(HALL)[1].where).toContain('4.2 m left');
  });
});

describe('one light set up for a group', () => {
  it('the same turn, invert, swap and range; places stay; offsets only when asked', () => {
    const from = head({ invertPan: true, swapPanTilt: true, panDeg: 360, panOffset: 12, tiltOffset: -3 });
    const to = head({ id: 'h2', p3: { x: 3, y: 7.25, z: 0 }, invertTilt: true, tiltOffset: 4 });
    copySetup(from, { yaw: 0, pitch: 0, roll: 180 }, to, {});
    expect(to).toMatchObject({ rot: { yaw: 0, pitch: 0, roll: 180 }, invertPan: true, swapPanTilt: true, panDeg: 360, tiltOffset: 4, p3: { x: 3, y: 7.25, z: 0 } });
    expect(to.invertTilt).toBeUndefined();
    expect(to.panOffset).toBeUndefined();
    copySetup(from, { yaw: 0, pitch: 0, roll: 180 }, to, { offsets: true });
    expect([to.panOffset, to.tiltOffset]).toEqual([12, -3]);
  });
  it('mirrored on the other side: on its side on the left becomes on its side on the right, turned the other way', () => {
    const r = withFront(mountRot('left', { yaw: 0, pitch: 0, roll: 0 }), 'down');
    const to = head({ id: 'h2' });
    copySetup(head(), { ...r, yaw: r.yaw + 20 }, to, { mirror: true });
    expect(mountOf({ ...to.rot!, yaw: to.rot!.yaw + 20 })).toBe('right');
    // the beam at Home: the mirror image of the first one's
    const o = opticsOf(head()), a = beamDir(0.5, 0.5, { ...r, yaw: r.yaw + 20 }, o), b = beamDir(0.5, 0.5, to.rot!, o);
    expect(near(b, { x: -a.x, y: a.y, z: a.z })).toBe(true);
  });
});

describe('another mode', () => {
  const rig = [
    { id: 'a', name: 'Head 1', universe: 0, address: 1, channels: 8 },
    { id: 'b', name: 'Head 2', universe: 0, address: 9, channels: 8 },
    { id: 'c', name: 'Head 3', universe: 0, address: 17, channels: 8 },
    { id: 'd', name: 'Par', universe: 0, address: 40, channels: 4 },
    { id: 'e', name: 'Other', universe: 1, address: 9, channels: 8 },
  ];
  it('more channels: the lights right after it move up just enough, a gap stops it, other universes stay', () => {
    const c = modeChange(rig, 'a', 11);
    expect(c).toMatchObject({ channels: 11, delta: 3, end: 11, past: 0 });
    expect(c.moves).toEqual([{ id: 'b', name: 'Head 2', from: 9, to: 12 }, { id: 'c', name: 'Head 3', from: 17, to: 20 }]);
    // (the Par at 40 has room: it stays)
    expect(modeChange(rig, 'a', 30).moves.map((m) => [m.id, m.to])).toEqual([['b', 31], ['c', 39], ['d', 47]]);
  });
  it('fewer channels frees some and moves nothing; past 512 says so', () => {
    expect(modeChange(rig, 'b', 5)).toMatchObject({ delta: -3, moves: [], freed: [14, 16] });
    expect(modeChange([{ id: 'x', name: 'X', universe: 0, address: 500, channels: 8 }], 'x', 16).past).toBe(3);
    expect(modeChange([...rig, { id: 'z', name: 'Last', universe: 0, address: 505, channels: 8 }], 'd', 470).stuck).toBe('Last');
  });
  it("a mode's channels as the manual lists them: fine ones with their coarse channel, defaults, the gobo slots", () => {
    const spot = GENERIC.find((t) => t.id === 'gen-spotgobo')!, rows = channelRows(spot.modes[0], 20);
    expect(rows).toHaveLength(16);
    expect(rows[0]).toMatchObject({ n: 1, dmx: 20, name: 'Pan', attr: 'pan', def: 128 });
    expect(rows[1]).toMatchObject({ n: 2, dmx: 21, attr: 'pan', fineOf: 1 });
    expect(rows[3]).toMatchObject({ attr: 'tilt', fineOf: 3 });
    expect(rows[11].ranges.map((r) => r.label)).toEqual(['Open', 'Dots', 'Star', 'Ring', 'Bars', 'Flower', 'Triangles', 'Spiral']);
  });
});

describe('in the show file', () => {
  const schema = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(fs.readFileSync('schema/luxdmx-show.schema.json', 'utf8')));
  it("the light's own range and swap are kept, saved as they are and pass the schema", () => {
    const s = emptyShow();
    s.fixtures.push(head({ panDeg: 630, tiltDeg: 265, swapPanTilt: true, invertPan: true, rot: { yaw: -90, pitch: 0, roll: 180 } }));
    const text = serializeShow(s), back = parseShow(text);
    expect(back.fixtures[0]).toMatchObject({ panDeg: 630, tiltDeg: 265, swapPanTilt: true, invertPan: true, rot: { yaw: -90, pitch: 0, roll: 180 } });
    expect(schema(JSON.parse(text)), JSON.stringify(schema.errors)).toBe(true);
  });
  it('wrong ones are left out with a note; a file without them opens as it was', () => {
    const s: any = emptyShow();
    s.fixtures.push(head({ panDeg: 5000 as number, tiltDeg: 0, swapPanTilt: 'yes' as unknown as boolean }));
    const notes: string[] = [], back = parseShow(JSON.stringify(s), notes);
    expect(back.fixtures[0].panDeg).toBeUndefined();
    expect(back.fixtures[0].tiltDeg).toBeUndefined();
    expect(back.fixtures[0].swapPanTilt).toBeUndefined();
    expect(notes.join(' ')).toContain('panDeg');
    const old = emptyShow(); old.fixtures.push(head({ invertTilt: true, panOffset: 10 }));
    const n2: string[] = [], o2 = parseShow(serializeShow(old), n2);
    expect(o2.fixtures[0]).toEqual(old.fixtures[0]);
    expect(n2).toEqual([]);
  });
});

// (the directions the setup offers: every one is a unit vector of its own)
it('the six directions', () => {
  for (const d of Object.keys(DIRS) as Dir[]) expect(dirOf(DIRS[d])).toBe(d);
  expect(dirOf(toWorld({ x: 0, y: 1, z: 0 }, { yaw: 0, pitch: 30, roll: 0 }))).toBeUndefined();
});

describe('where a light let go of in 3D comes to rest', () => {
  const room = HALL;
  const disc = placesFor({ kind: 'rings', rings: [60, 48, 40, 32, 24, 16, 12, 8, 1] });
  const standing: Rot = { yaw: 0, pitch: 90, roll: 0 };
  const mid = { x: 0, z: (room.deck.z0 + room.deck.z1) / 2 };
  it('a ring standing on the deck rests on its lower edge, not half in the deck', () => {
    const size = shapeSize(disc), reach = boardReach(disc, size, standing);
    expect(reach.below).toBeCloseTo(size / 2 + 0.02, 3);
    const r = restAt({ x: mid.x, y: DECK, z: mid.z }, 'bar', reach, room);
    expect(r.on).toBe('deck');
    expect(r.p.y).toBeCloseTo(DECK + reach.below, 6);
    // lying flat it's only as thick as its board
    expect(boardReach(disc, size, { yaw: 0, pitch: 0, roll: 0 }).below).toBeLessThan(0.05);
  });
  it('close means a hand\'s width: 25 cm over the deck it lands, 50 cm over it it stays up', () => {
    expect(restAt({ x: 0, y: DECK + 0.25, z: mid.z }, 'mover', undefined, room).on).toBe('deck');
    expect(restAt({ x: 0, y: DECK + 0.5, z: mid.z }, 'mover', undefined, room)).toEqual({ p: { x: 0, y: DECK + 0.5, z: mid.z }, on: 'air' });
    // off the deck: the floor, only when close
    const off = room.deck.z1 + 2;
    expect(restAt({ x: 0, y: 0.2, z: off }, 'par', undefined, room).p.y).toBe(0);
    expect(restAt({ x: 0, y: 0.5, z: off }, 'par', undefined, room).on).toBe('air');
  });
  it('near a truss it hangs under it: a head by its clamp, a matrix by its top', () => {
    const t = room.truss[1];
    expect(restAt({ x: 1, y: t.y - TRUSS_HANG - 0.3, z: t.z + 0.2 }, 'mover', undefined, room).p).toEqual({ x: 1, y: t.y - TRUSS_HANG, z: t.z });
    expect(restAt({ x: 1, y: t.y - 1.2, z: t.z }, 'mover', undefined, room).on).not.toBe('truss');
    const size = shapeSize(disc), reach = boardReach(disc, size, standing);
    const r = restAt({ x: 0, y: t.y - 0.3 - reach.above, z: t.z }, 'bar', reach, room);
    expect(r.on).toBe('truss');
    expect(r.p.y + reach.above).toBeCloseTo(t.y - 0.08, 6);
  });
});
