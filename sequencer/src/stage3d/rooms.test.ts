// @vitest-environment happy-dom
// The demos' rooms: each builds (through buildVenue, as the 3D stage asks for it) with nothing NaN
// in it and its static parts baked; the crowd is the hall's crowd (no flags), inside the room and
// off the stage, turned to the DJ; the DJ stands behind the booth facing the crowd, the right hand
// on the mixer, the left on the jog wheel and up in the air when it's loud, every hand where it was
// sent; the booth's front shows the act's name. The test truss has no crowd and no DJ.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildVenue } from './venue';
import { DJ_BOOTH, ROOMS, onDeck } from './geometry';
import { BOOTH, DECKS, djPerson } from './dj';
import type { Stage } from './rooms';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const built: Record<string, Stage> = {};
const room = (id: 'club' | 'party' | 'truss') => (built[id] ??= buildVenue({ room: id, crowd: 40 }));

for (const id of ['club', 'party', 'truss'] as const) {
  describe(`the ${id} room`, () => {
    it('builds with nothing NaN in it, its static parts baked into a few dozen meshes', () => {
      const v = room(id);
      expect(v.room).toBe(id);
      let bad = 0, meshes = 0;
      v.group.updateMatrixWorld(true);
      v.group.traverse((o) => {
        const m = o as THREE.Mesh; if (!m.isMesh) return; meshes++;
        for (const k of ['position', 'normal']) { const a = m.geometry.attributes[k]; if (a) for (let i = 0; i < a.array.length; i++) if (!Number.isFinite(a.array[i])) bad++; }
        if ((m as THREE.InstancedMesh).isInstancedMesh) for (const x of (m as THREE.InstancedMesh).instanceMatrix.array) if (!Number.isFinite(x)) bad++;
      });
      expect(bad).toBe(0);
      expect(v.baked.meshes).toBeGreaterThan(20);
      expect(v.baked.batches).toBeLessThan(45);
      expect(meshes).toBeLessThan(200);
    });
  });
}

describe('the crowd in the club and the party room', () => {
  for (const id of ['club', 'party'] as const) it(`${id}: the hall's crowd, smaller, no flags, inside the room, off the stage, facing the DJ`, () => {
    const v = room(id), r = ROOMS[id], c = v.crowd!;
    expect(v.crowdCount).toBe(40);
    expect(c.fans.some((f) => f.flag)).toBe(false);
    expect(c.parts.get('pole')?.count ?? 0).toBe(0);
    const dj = DJ_BOOTH[id]!.dj;
    for (const f of c.fans) {
      expect(Math.abs(f.x)).toBeLessThan(r.walls.x - 0.5); expect(f.z).toBeLessThan(r.walls.z1 - 0.5);
      expect(onDeck(f.x, f.z, r)).toBe(false); expect(f.z).toBeGreaterThan(dj.z + 1.5);
      // turned towards the DJ end (within the crowd's own spread of a quarter turn)
      const to = Math.atan2(dj.x - f.x, dj.z - f.z), d = Math.abs(Math.atan2(Math.sin(f.yaw - to), Math.cos(f.yaw - to)));
      expect(d).toBeLessThan(0.5);
    }
    // the same moves as the hall's: it gets excited with the lights
    v.animate(1, 1, 0.9, new THREE.Color(1, 1, 1));
    for (let k = 0; k < 30; k++) v.animate(1 + k * 0.05, 1 + k * 0.1, 0.9, new THREE.Color(1, 1, 1));
    expect(c.excitement()).toBeGreaterThan(0.9);
  });
  it('the test truss: an empty room, nobody in it', () => {
    expect(room('truss').crowdCount).toBe(0); expect(room('truss').dj).toBeUndefined();
  });
});

describe('the DJ', () => {
  it('stands behind the booth, on the deck in the club and on the floor at the party, facing the crowd', () => {
    for (const id of ['club', 'party'] as const) {
      const v = room(id), at = DJ_BOOTH[id]!;
      v.group.updateMatrixWorld(true);
      const p = new THREE.Vector3().setFromMatrixPosition(v.dj!.p.group.matrixWorld);
      expect(p.x).toBeCloseTo(at.dj.x, 3); expect(p.y).toBeCloseTo(at.dj.y, 3); expect(p.z).toBeCloseTo(at.dj.z, 3);
      const front = V(0, 0, 1).transformDirection(v.dj!.p.group.matrixWorld);
      expect(front.z).toBeGreaterThan(0.99);
      expect(at.booth.z - at.dj.z).toBeCloseTo(-BOOTH.dj, 6);
    }
  });
  const d = djPerson(), own = (v: THREE.Vector3) => v.clone().add(V(0, 0, -BOOTH.dj));
  it('a hand on the mixer, the other on the jog wheel when it\'s calm; every hand where it was sent', () => {
    d.play(0, 0);
    expect(d.raised()).toBe(0);
    // (at the start of a phrase: the right hand on the crossfader, the left nudging the wheel)
    expect(d.p.gripAt('R').distanceTo(own(DECKS.fader).add(V(0, 0.012, 0)))).toBeLessThan(0.02);
    expect(d.p.gripAt('L').distanceTo(own(DECKS.jog.L).add(V(0.035, 0.012, 0)))).toBeLessThan(0.02);
    // two bars on the EQ, then the filter
    d.play(8, 0); expect(d.p.gripAt('R').distanceTo(own(DECKS.eq[0]).add(V(0, 0.012, 0)))).toBeLessThan(0.03);
    d.play(16, 0); expect(d.p.gripAt('R').distanceTo(own(DECKS.filter).add(V(0, 0.012, 0)))).toBeLessThan(0.03);
  });
  it('the left hand up in the air on a drop, pumping on the beat; the right stays on the mixer', () => {
    d.play(0, 1);
    expect(d.raised()).toBe(1);
    const up = d.p.gripAt('L');
    expect(up.y).toBeGreaterThan(1.85); expect(up.distanceTo(V(0.27, 1.93, 0.22))).toBeLessThan(0.02);
    d.play(0.5, 1);
    expect(d.p.gripAt('L').y).toBeLessThan(up.y - 0.03);
    expect(d.p.gripAt('R').distanceTo(own(DECKS.fader).add(V(0, 0.012, 0)))).toBeLessThan(0.05);
  });
  it('nods on the beat, harder when it\'s loud', () => {
    d.play(0, 0.2); const calm = d.p.head.rotation.x;
    d.play(0.5, 0.2); const off = d.p.head.rotation.x;
    d.play(0, 1); const loud = d.p.head.rotation.x;
    expect(calm).toBeGreaterThan(off); expect(loud).toBeGreaterThan(calm);
  });
  it('the booth shows the act\'s name, painted again in place', () => {
    const v = room('club'), before = v.bandInfo().surfaces[0];
    expect(before.shows).toBe('CLUB NIGHT');
    v.setBand('Night Owl');
    const after = v.bandInfo();
    expect(after.name).toBe('Night Owl'); expect(after.surfaces[0].shows).toBe('NIGHT OWL');
    expect(after.surfaces[0].uuid).toBe(before.uuid); expect(after.surfaces[0].version).toBeGreaterThan(before.version);
  });
});
