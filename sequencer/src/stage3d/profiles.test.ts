// @vitest-environment happy-dom
// Real fixtures drawn as what they are (profiles.ts): the two first, from their files as the
// libraries have them (QLC+'s Stairville LED Matrix Blinder 5x5, OFL's Showtec Phantom Matrix FX):
// their look, their cells on the face in the manual's order, each cell's own colour, the head
// moving as its pan and tilt say. Sources and photos: sim/fixtures-research/poc-*.md.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromQxf } from '../import/qxf';
import { fromOfl } from '../import/ofl';
import { kindOf } from '../model/library';
import { rigFixtureFull } from './rigOf';
import { HALL } from './geometry';
import { Rig } from './rig';
import { cellAt, profileOf, whiteOf } from './profiles';
import type { Fixture, FixtureType } from '../model/types';

const data = (f: string) => readFileSync(join(__dirname, '../import/testdata', f), 'utf8');
const blinder = fromQxf(data('Stairville-LED-Matrix-Blinder-5x5.qxf'), 'Stairville/Stairville-LED-Matrix-Blinder-5x5.qxf');
const phantom = fromOfl('showtec/phantom-matrix-fx', JSON.parse(data('showtec_phantom-matrix-fx.json')), 'Showtec');
const rf = (t: FixtureType, mode: string, id: string) => {
  const m = t.modes.find((x) => x.name === mode)!;
  return rigFixtureFull({ id, name: id, typeId: t.id, mode, universe: 0, address: 1, x: 0.5, y: 0.5 } as Fixture, m, kindOf(m), t, HALL);
};

describe('which fixtures', () => {
  it('the two by their maker and model; the blinder\'s RGB WW cousin (another LED) is not this one', () => {
    expect(profileOf('Stairville', 'LED Matrix Blinder 5x5')?.panel).toBeDefined();
    expect(profileOf('Showtec', 'Phantom Matrix FX')?.head).toBeDefined();
    expect(profileOf('Stairville', 'LED Matrix Blinder 5x5 RGB WW')).toBeUndefined();
    expect(profileOf('Stairville', 'LED Par 56')).toBeUndefined();
  });
  it('from their library files: the blinder a panel, the Phantom a moving matrix head', () => {
    expect(rf(blinder, '26-Channel', 'b').look).toBe('panel');
    expect(rf(phantom, '118-Channel', 'p').look).toBe('matrixhead');
    expect(rf(phantom, '118-Channel', 'p').cells).toBe(25);
  });
});

describe('the face', () => {
  it('the cells as the manuals number them: row by row from the top left, seen from the front', () => {
    const p = profileOf('Stairville', 'LED Matrix Blinder 5x5')!;
    const [x0, z0] = cellAt(p, 0), [x4, z4] = cellAt(p, 4), [x24, z24] = cellAt(p, 24);
    expect(x0).toBeLessThan(0); expect(z0).toBeLessThan(0);             // (top left)
    expect(x4).toBeGreaterThan(0); expect(z4).toBeCloseTo(z0, 6);        // (top right)
    expect(x24).toBeGreaterThan(0); expect(z24).toBeGreaterThan(0);      // (bottom right)
    expect(x4 - x0).toBeCloseTo(4 * 0.0875, 6);
  });
  it('a warm white at 2800 K: more red than blue', () => {
    const [r, , b] = whiteOf(2800);
    expect(r).toBeGreaterThan(b + 0.3);
  });
});

describe('on the 3D stage', () => {
  function frame(values: Record<string, unknown>, t = 0) {
    const rig = new Rig(), list = [rf(blinder, '26-Channel', 'b'), rf(phantom, '118-Channel', 'p')];
    rig.build(list); rig.place(list);
    for (let k = 0; k <= 60; k++) rig.update(values as never, t + k / 30, 0.3, new Set());
    return rig;
  }
  const meshes = (rig: Rig) => (rig as unknown as { parts: Map<string, THREE.InstancedMesh>; cells: THREE.InstancedMesh });
  it('the blinder\'s 25 round cells and the head\'s 25 square ones, each its own colour', () => {
    // (as the engine resolves a light with cells: one value each, in data order)
    const cells = Array.from({ length: 25 }, (_, i) => ({ intensity: 1, color: i === 0 ? { r: 1, g: 0, b: 0 } : { r: 0, g: 0, b: 1 } }));
    const rig = frame({ b: { intensity: 1 }, p: { intensity: 1, cells } }), m = meshes(rig);
    expect(m.cells.count).toBe(25);
    const sq = m.parts.get('sqcell')!;
    expect(sq.count).toBe(25);
    const c0 = new THREE.Color(), c1 = new THREE.Color();
    sq.getColorAt(0, c0); sq.getColorAt(1, c1);
    expect(c0.r).toBeGreaterThan(c0.b); expect(c1.b).toBeGreaterThan(c1.r);
    // (the blinder's cells: its own warm white, it has no colour channels)
    const w = new THREE.Color(); m.cells.getColorAt(0, w);
    expect(w.r).toBeGreaterThan(w.b);
  });
  it('the head tilts and pans as its channels say, its cells with it', () => {
    const head = (tilt: number) => { const rig = frame({ p: { intensity: 1, pan: 0.5, tilt } }); const h = meshes(rig).parts.get(`mh:Showtec Phantom Matrix FX:head`)!, mx = new THREE.Matrix4(); h.getMatrixAt(0, mx); return new THREE.Vector3(0, 1, 0).transformDirection(mx); };
    const a = head(0.2), b = head(0.8);
    expect(a.angleTo(b)).toBeGreaterThan(1);
  });
});
