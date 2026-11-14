// @vitest-environment happy-dom
// The people in the scenes have their hands where hands go: each one's left hand on their own left
// (turned round to face the room a person's left is -x; the bar's guests had their arms crossed),
// and on what they hold: the counter, a table, their partner.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildBallroom, buildBar } from './scenes';
import { gearMats } from './gear';
import { ROOMS } from './geometry';
import type { Person } from './people';

// every Person in what a scene built (found by the hands they have)
function peopleIn(build: (g: THREE.Group) => unknown): Person[] {
  const g = new THREE.Group(), r = build(g) as { people?: Person[] };
  const found = new Set<Person>(r.people ?? []);
  return [...found];
}
// how far each one's left hand is to their own left of their right hand (gripAt is in the person's
// own space, where they face +z and their left is +x)
const leftOfRight = (p: Person) => p.gripAt('L').x - p.gripAt('R').x;

describe('the scenes\' people', () => {
  it('in the bar: no one with their arms crossed (the left hand on the left)', () => {
    const ps = peopleIn((g) => buildBar(g, gearMats(), ROOMS.bar));
    expect(ps.length).toBeGreaterThan(10);
    const crossed = ps.filter((p) => leftOfRight(p) < 0.05).length;
    expect(crossed).toBe(0);
  });
  it('in the ballroom too (the couples dancing)', () => {
    const ps = peopleIn((g) => buildBallroom(g, gearMats(), ROOMS.ballroom));
    expect(ps.length).toBe(6);
    for (const p of ps) expect(leftOfRight(p)).toBeGreaterThan(0.05);
  });
});
