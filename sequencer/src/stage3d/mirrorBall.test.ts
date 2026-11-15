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

// A mirror ball never hangs dead still: stopped, it still sways and twists a few degrees back and
// forth; its motor turns it on top of that, at the speed its DMX channel says.
describe('its motion and its motor', () => {
  it('stopped: never still, but only a few degrees either way; running: round and round', async () => {
    const { ballMotion } = await import('./mirrorBall');
    const o = new THREE.Object3D(), ys: number[] = [], xs: number[] = [];
    for (let t = 0; t < 30; t += 0.1) { ballMotion(o, t, 0); ys.push(o.rotation.y); xs.push(o.rotation.x); }
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(spread(ys)).toBeGreaterThan(0.05); expect(spread(ys)).toBeLessThan(0.25);         // (a twist of a few degrees)
    expect(spread(xs)).toBeGreaterThan(0.01); expect(spread(xs)).toBeLessThan(0.06);         // (a little sway)
    const m = new THREE.Object3D();
    for (let t = 0; t <= 4; t += 0.05) ballMotion(m, t, 0.5);
    expect((m.userData as { spun: number }).spun).toBeCloseTo(2, 1);                        // (0.5 rad/s for 4 s)
  });
  it('the Bar\'s ball is on a DMX motor: slow all evening, faster for the disco, stopped for the lights up', async () => {
    const { TEMPLATES } = await import('../content/templates');
    const { rigFixtureFull } = await import('./rigOf');
    const { GENERIC, kindOf } = await import('../model/library');
    const { rotationOf } = await import('./gobos');
    const s = TEMPLATES.find((t) => t.name === 'Bar')!.build(), f = s.fixtures.find((x) => x.name === 'Mirror ball')!;
    expect(f.typeId).toBe('gen-mirrorball');
    const t = GENERIC.find((g) => g.id === f.typeId)!, m = t.modes[0];
    const rf = rigFixtureFull(f, m, kindOf(m), t, ROOMS.bar);
    expect(rf.look).toBe('mirrorball');
    const speed = (cue: string) => { const v = s.cueLists[0].cues.find((c) => c.name === cue)!.values[f.id]?.rollRotation as number; const r = rotationOf(rf.axes?.rollRot ?? undefined, v ?? 0); return 'speed' in r ? r.speed : NaN; };
    expect(speed('Daytime')).toBeGreaterThan(0);
    expect(speed('Disco')).toBeGreaterThan(speed('Daytime') * 2);
    expect(speed('Lights up')).toBe(0);
    // (hung where the room's own ball was: that one gives way to it on the 3D stage)
    expect(Math.hypot(f.p3!.x - (-3.2), f.p3!.z - 3.6)).toBeLessThan(0.01);
  });
});

describe('a light aimed at the ball', () => {
  // (the bar's ball on its motor and a pinspot on it from the side, as the Bar template hangs them)
  it('stops on it: the beam ends at the mirrors and lays no pool on the wall behind; with the ball gone, it would', async () => {
    const { Rig, hitBall } = await import('./rig');
    const { rigFixtureFull } = await import('./rigOf');
    const { GENERIC, kindOf } = await import('../model/library');
    const { aimRot, HALL, showRoom } = await import('./geometry');
    showRoom(room);
    const rf = (typeId: string, id: string, p: { x: number; y: number; z: number }, to?: { x: number; y: number; z: number }) => {
      const t = GENERIC.find((g) => g.id === typeId)!, m = t.modes[0];
      const f = rigFixtureFull({ id, name: id, typeId, mode: m.name, universe: 0, address: 1, x: 0.5, y: 0.5 } as never, m, kindOf(m), t, HALL);
      f.p = p; if (to) f.rot = aimRot(p, to);
      return f;
    };
    const ballAt = { x: -3.2, y: 3.88, z: 3.6 }, mid = { x: -3.2, y: 3.23, z: 3.6 };
    const pools = (withBall: boolean) => {
      const rig = new Rig(), pin = rf('gen-dimmer', 'pin', { x: -5.4, y: 3.4, z: 5.0 }, mid);
      const list = withBall ? [rf('gen-mirrorball', 'ball', ballAt), pin] : [pin];
      rig.build(list); rig.place(list);
      for (let t = 0; t < 0.2; t += 1 / 30) rig.update({ pin: { intensity: 1 }, ball: { rollRotation: 0 } }, t, 0.3, new Set());
      return (rig as unknown as { pools: THREE.InstancedMesh }).pools.count;
    };
    expect(pools(false)).toBe(1);
    expect(pools(true)).toBe(0);
    // (the arithmetic: straight at it, it meets the near side; beside it, never)
    const p = new THREE.Vector3(0, 0, 0), d = new THREE.Vector3(1, 0, 0);
    expect(hitBall(p, d, new THREE.Vector3(5, 0, 0), 0.3)).toBeCloseTo(4.7);
    expect(hitBall(p, d, new THREE.Vector3(5, 0.5, 0), 0.3)).toBe(Infinity);
    expect(hitBall(p, d, new THREE.Vector3(-5, 0, 0), 0.3)).toBe(Infinity);
  });
});
