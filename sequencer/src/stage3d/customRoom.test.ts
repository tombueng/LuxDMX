// Your own stage: the room built from its size (geometry.ts customRoom), and the camera crews for it.
import { describe, expect, it } from 'vitest';
import { customRoom, defaultPlace, DECK, planToWorld, roomFor, stageSize, STAGE_SIZE, TRUSS_HANG } from './geometry';
import { crewOf } from './director';

describe('your own stage', () => {
  it('its deck, trusses, walls and frame from its size', () => {
    const r = customRoom({ w: 10, d: 6, riser: true, trussY: 6, trusses: 3 });
    expect(r.id).toBe('custom');
    expect(r.deck).toEqual({ x: 5, z0: -3, z1: 3 });
    expect([r.W, r.D]).toEqual([10, 6]);
    expect(r.truss.map((t) => t.y)).toEqual([6, 6, 6]);
    expect(r.truss[0].z).toBeLessThan(r.truss[2].z);                       // back to front
    expect(r.truss.every((t) => t.z >= -3 && t.z <= 3)).toBe(true);
    expect(r.frame!.length).toBe(3 * 3);                                   // a span and two towers each
    expect(r.walls.x).toBeGreaterThan(5);
    expect(r.walls.z1).toBeGreaterThan(3);
    expect(r.ceiling).toBeGreaterThan(6);
    // on the floor: no deck
    expect(customRoom({ w: 10, d: 6, riser: false }).deck.x).toBeLessThan(0);
  });
  it('the plan is the stage: its corners are the deck\'s; a head hangs under the nearest truss', () => {
    const r = customRoom({ w: 8, d: 4, trussY: 5, trusses: 2 });
    expect(planToWorld(0, 0, r)).toEqual({ x: -4, z: -2 });
    expect(planToWorld(1, 1, r)).toEqual({ x: 4, z: 2 });
    const h = defaultPlace({ x: 0.5, y: 0.1 }, 'mover', r);
    expect(h.p.y).toBeCloseTo(5 - TRUSS_HANG);
    expect(h.p.z).toBeCloseTo(r.truss[0].z);
    // a bar stands on the deck
    expect(defaultPlace({ x: 0.5, y: 0.5 }, 'bar', r).p.y).toBe(DECK);
  });
  it('sizes are kept sensible, the same size is the same room, a new one a new room', () => {
    expect(stageSize({ w: 500, d: -3, trusses: 9.6, trussY: 1 })).toEqual({ ...STAGE_SIZE, w: 40, d: 1.5, trusses: 4, trussY: 2.5 });
    expect(stageSize(undefined)).toEqual(STAGE_SIZE);
    expect(customRoom({ w: 8, d: 4 })).toBe(customRoom({ w: 8, d: 4 }));
    expect(customRoom({ w: 8, d: 4 }).key).not.toBe(customRoom({ w: 9, d: 4 }).key);
    expect(roomFor({ room: 'custom', size: { w: 7, d: 3 } }).W).toBe(7);
    expect(roomFor({ room: 'pub' }).id).toBe('pub');
    expect(roomFor(undefined).id).toBe('hall');
  });
  it('the camera crews go round it, in front of it and over it', () => {
    const small = crewOf(customRoom({ w: 6, d: 4 })), big = crewOf(customRoom({ w: 24, d: 12 }));
    expect(big.wide.pos[2]).toBeGreaterThan(small.wide.pos[2]);           // further back for a bigger stage
    expect(big.drone.rx).toBeGreaterThan(small.drone.rx);
    for (const c of [small, big]) expect(c.wide.pos[2]).toBeGreaterThan(0);  // out front
  });
});
