// @vitest-environment happy-dom
// A mirror ball at work: a light aimed at it throws dots all round the room (each on a wall, the
// ceiling or the floor), none when nothing hits it; turning it sweeps them round. The bar's ball turns
// on its own motor, music or not.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MirrorDots } from './mirrorBall';
import { ROOMS } from './geometry';
import { buildVenue } from './venue';
import type { Lit } from './rig';

const room = ROOMS.bar;
const at = (o: THREE.Object3D, x: number, y: number, z: number) => { o.position.set(x, y, z); o.updateMatrixWorld(true); return o; };
const light = (from: THREE.Vector3, to: THREE.Vector3, level = 1): Lit => ({ key: 1, p: from, d: to.clone().sub(from).normalize(), c: new THREE.Color(1, 1, 1), level, deg: 6 });
const dotsOf = (m: MirrorDots) => {
  const inst = m.group.children[0] as THREE.InstancedMesh, out: THREE.Vector3[] = [], M = new THREE.Matrix4();
  for (let i = 0; i < inst.count; i++) { inst.getMatrixAt(i, M); out.push(new THREE.Vector3().setFromMatrixPosition(M)); }
  return out;
};

describe('the dots', () => {
  const ball = at(new THREE.Mesh(new THREE.SphereGeometry(0.28)), -3.2, 3.2, 3.6), pin = light(new THREE.Vector3(-1.2, 3.37, 2.4), new THREE.Vector3(-3.2, 3.2, 3.6));
  it('a pinspot on the ball throws a hundred dots and more, every one on the room\'s walls, ceiling or floor', () => {
    const m = new MirrorDots();
    m.update([{ obj: ball, r: 0.28 }], [pin], room, 0.3);
    const d = dotsOf(m);
    expect(d.length).toBeGreaterThan(100);
    expect(m.lastHit).toEqual([1]);
    const W = room.walls;
    for (const p of d) {
      const onWall = Math.abs(Math.abs(p.x) - W.x) < 0.05 || Math.abs(p.z - W.z0) < 0.05 || Math.abs(p.z - W.z1) < 0.05;
      const onFloorOrCeiling = Math.abs(p.y) < 0.05 || Math.abs(p.y - room.ceiling) < 0.05;
      expect(onWall || onFloorOrCeiling, `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`).toBe(true);
    }
  });
  it('nothing on it (a light aimed elsewhere, or off): no dots', () => {
    const m = new MirrorDots();
    m.update([{ obj: ball, r: 0.28 }], [light(new THREE.Vector3(3, 3.37, 2.4), new THREE.Vector3(4, 0, 4))], room, 0.3);
    expect(m.lastDots).toBe(0);
    m.update([{ obj: ball, r: 0.28 }], [], room, 0.3);
    expect(m.lastDots).toBe(0);
  });
  it('turning the ball sweeps the dots round the room', () => {
    const m = new MirrorDots();
    m.update([{ obj: ball, r: 0.28 }], [pin], room, 0.3);
    const before = dotsOf(m).map((v) => v.clone());
    ball.rotation.y += 0.3; ball.updateMatrixWorld(true);
    m.update([{ obj: ball, r: 0.28 }], [pin], room, 0.3);
    // (most of the dots are somewhere no dot was before)
    const moved = dotsOf(m).filter((p) => Math.min(...before.map((q) => q.distanceTo(p))) > 0.05).length;
    expect(moved / m.lastDots).toBeGreaterThan(0.6);
  });
});

it('the bar\'s mirror ball turns on its own motor, music or not', () => {
  const v = buildVenue({ room: 'bar', crowd: 10 }), b = v.mirrorBalls![0].obj;
  v.animate(1, 2, 0.5, new THREE.Color(1, 1, 1), false);
  const r0 = b.rotation.y;
  v.animate(3, 6, 0.5, new THREE.Color(1, 1, 1), false);
  expect(b.rotation.y).not.toBe(r0);
});
