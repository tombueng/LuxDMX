// @vitest-environment happy-dom
// What a pixel light gives the rest of the room (rig.lit: the washes, the crowd light, the fog's
// colour, the mirror-ball dots): its cells' colours, each by how bright it is. It was the colour
// the cell loop left behind: a bar its last cell's, a ring its own (white when unset), a matrix
// head black when only its cells were lit. (Review 5, R5-B2.)
import { describe, expect, it } from 'vitest';
import { Rig, type RigFixture } from './rig';
import { PROFILES } from './profiles';
import { placesFor } from '../model/pixelLayout';
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
