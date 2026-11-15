// @vitest-environment happy-dom
// What a pixel light gives the rest of the room (rig.lit: the washes, the crowd light, the fog's
// colour, the mirror-ball dots): its cells' colours, each by how bright it is. It was the colour
// the cell loop left behind: a bar its last cell's, a ring its own (white when unset), a matrix
// head black when only its cells were lit. (Review 5, R5-B2.)
import { describe, expect, it } from 'vitest';
import { Rig, type RigFixture } from './rig';
import { PROFILES } from './profiles';
import { placesFor } from '../model/pixelLayout';
import { Particles } from './particles';
import type { Resolved } from '../model/types';

const optics = { panDeg: 540, tiltDeg: 270, panOffset: 0, tiltOffset: 0, invertPan: false, invertTilt: false };
const light = (o: Partial<RigFixture> & Pick<RigFixture, 'id' | 'kind' | 'look' | 'cells'>): RigFixture =>
  ({ name: o.id, p: { x: 0, y: 6, z: 0 }, rot: { yaw: 0, pitch: 180, roll: 0 }, optics, ...o });
const RED = { r: 1, g: 0, b: 0 }, BLUE = { r: 0, g: 0, b: 1 };
const rgb = (c: { r: number; g: number; b: number }) => [c.r, c.g, c.b].map((v) => +v.toFixed(2));
const head = PROFILES.find((p) => p.head && p.cells.cols * p.cells.rows > 1)!;

function litOf(stage: Record<string, Resolved>) {
  const list = [light({ id: 'bar', kind: 'bar', look: 'bar', cells: 4 }),
    light({ id: 'ring', kind: 'bar', look: 'disc', cells: 12, shape: placesFor({ kind: 'rings', rings: [12] }), size: 0.3 }),
    light({ id: 'head', kind: 'mover', look: 'matrixhead', cells: head.cells.cols * head.cells.rows, profile: head })];
  const rig = new Rig();
  rig.build(list);
  rig.update(stage, 1, 0.5, new Set());
  return Object.fromEntries(rig.lit.map((l) => [list[l.key].id, { level: +l.level.toFixed(2), c: rgb(l.c) }]));
}

describe('the room lit by pixel lights', () => {
  it('a chase, all pixels red, a head lit only by its cells: each red', () => {
    const n = head.cells.cols * head.cells.rows;
    const got = litOf({
      // the first cell red at full, the rest blue and dark
      bar: { cells: [{ intensity: 1, color: RED }, { intensity: 0, color: BLUE }, { intensity: 0, color: BLUE }, { intensity: 0, color: BLUE }] },
      // every pixel red at full, the light's own colour and level unset
      ring: { cells: Array.from({ length: 12 }, () => ({ intensity: 1, color: RED })) },
      head: { cells: Array.from({ length: n }, () => ({ intensity: 1, color: RED })) },
    });
    expect(got.bar.c).toEqual([1, 0, 0]);
    expect(got.ring.c).toEqual([1, 0, 0]);
    expect(got.head.c).toEqual([1, 0, 0]);
    expect(got.head.level).toBe(1);
  });

  it('half red, half blue at the same level: the mix; a dimmer half counts less', () => {
    const got = litOf({
      bar: { cells: [{ intensity: 1, color: RED }, { intensity: 1, color: RED }, { intensity: 1, color: BLUE }, { intensity: 1, color: BLUE }] },
      ring: { cells: Array.from({ length: 12 }, (_, i) => (i < 6 ? { intensity: 1, color: RED } : { intensity: 0.5, color: BLUE })) },
      head: { intensity: 1, color: BLUE },
    });
    expect(got.bar.c).toEqual([0.5, 0, 0.5]);
    expect(got.ring.c).toEqual([0.67, 0, 0.33]);
    // (a head without cells of its own: every cell its colour)
    expect(got.head.c).toEqual([0, 0, 1]);
  });
});

// A moving bar's heads each have a key in `lit` of their own, after all the lights. They were
// 64 * place + head: with 65 lights or more a head shared its key with another light, and the fog
// in the head's beam took that light's level and colour. (Review 5, R5-B7.)
describe('a moving bar\'s heads in a big rig', () => {
  it('70 lights, a 4-head bar second: no key twice, the fog lit by the head', () => {
    const list: RigFixture[] = Array.from({ length: 70 }, (_, i) => light({ id: `p${i}`, kind: 'par', look: 'par', cells: 1, p: { x: (i % 14) - 7, y: 6, z: 0 } }));
    list[1] = light({ id: 'mbar', kind: 'mover', look: 'headbar', cells: 4, heads: 4 });
    const rig = new Rig();
    rig.build(list);
    const stage: Record<string, Resolved> = {};
    for (const f of list) stage[f.id] = { intensity: 1, color: BLUE };
    stage.p64 = { intensity: 0, color: BLUE };
    stage.mbar = { intensity: 1, color: RED, cells: Array.from({ length: 4 }, () => ({ intensity: 1, color: RED })) };
    rig.update(stage, 1, 0.5, new Set());
    const keys = rig.lit.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    const heads = rig.lit.filter((l) => l.key >= list.length);
    expect(heads.map((l) => l.key)).toEqual([70, 71, 72, 73]);
    // the fog's table: each head's entry its own level and red
    const p = new Particles();
    p.light(rig.lit);
    const L = (p as unknown as { smoke: { levels: Float32Array } }).smoke.levels;
    for (const k of [70, 71, 72, 73]) expect([...L.slice(k * 4, k * 4 + 4)].map((x) => +x.toFixed(2))).toEqual([1, 1, 0, 0]);
  });
});
