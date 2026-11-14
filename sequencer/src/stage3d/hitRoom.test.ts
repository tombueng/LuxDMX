// Where light lands (hitRoom): on the deck and the floor as before, and now on the room's walls, its
// ceiling and what stands across it (the theatre's cyc, the cinema's screen), facing the light;
// with the room hidden (your own venue model), on the floor only.
import { afterEach, describe, expect, it } from 'vitest';
import { DECK, hitRoom, ROOMS, showWalls } from './geometry';

afterEach(() => showWalls(true));
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe('where light lands', () => {
  it('a light straight down: the deck, its normal up', () => {
    const h = hitRoom({ x: 0, y: 7, z: 0 }, { x: 0, y: -1, z: 0 }, ROOMS.hall)!;
    near(h.y, DECK); expect(h.n).toEqual({ x: 0, y: 1, z: 0 });
  });
  it('a wall uplight in the church: up its wall (the side wall, facing in), not into the air', () => {
    const r = ROOMS.church, p = { x: -(r.walls.x - 0.3), y: 0.1, z: 8 };
    const h = hitRoom(p, { x: -0.05, y: 1, z: 0 }, r)!;
    near(h.x, -r.walls.x); expect(h.n).toEqual({ x: 1, y: 0, z: 0 }); expect(h.y).toBeGreaterThan(5); expect(h.y).toBeLessThanOrEqual(r.ceiling);
  });
  it('straight up: the ceiling, facing down; the far wall behind the audience; the back wall', () => {
    const r = ROOMS.club;
    expect(hitRoom({ x: 0, y: 3, z: 6 }, { x: 0, y: 1, z: 0 }, r)!.n).toEqual({ x: 0, y: -1, z: 0 });
    const far = hitRoom({ x: 0, y: 3, z: 6 }, { x: 0, y: 0, z: 1 }, r)!; near(far.z, r.walls.z1); expect(far.n).toEqual({ x: 0, y: 0, z: -1 });
    const back = hitRoom({ x: 0, y: 5, z: 3 }, { x: 0, y: 0, z: -1 }, r)!; near(back.z, r.walls.z0); expect(back.n).toEqual({ x: 0, y: 0, z: 1 });
  });
  it('the theatre\'s cyc lights land on the cyc, in front of the back wall; the cinema\'s screen too', () => {
    const t = ROOMS.theatre, h = hitRoom({ x: 2, y: 8, z: -4.8 }, { x: 0, y: -0.3, z: -1 }, t)!;
    near(h.z, t.screens![0].z); expect(h.n).toEqual({ x: 0, y: 0, z: 1 });
    const c = ROOMS.cinema, s = hitRoom({ x: 0, y: 6, z: 8 }, { x: 0, y: 0, z: -1 }, c)!;
    near(s.z, c.screens![0].z);
  });
  it('the cinema\'s side walls: light lands on the panels standing off them, not behind', () => {
    const c = ROOMS.cinema, h = hitRoom({ x: -10.7, y: 2.5, z: 10 }, { x: -0.1, y: 1, z: 0 }, c)!;
    near(h.x, -(c.walls.x - c.inset!)); expect(h.n).toEqual({ x: 1, y: 0, z: 0 });
  });
  it('the room hidden (your own venue model): the floor or nothing, never its walls', () => {
    showWalls(false);
    expect(hitRoom({ x: 0, y: 3, z: 6 }, { x: 0, y: 1, z: 0 }, ROOMS.club)).toBeUndefined();
    expect(hitRoom({ x: 0, y: 7, z: 0 }, { x: 0, y: -1, z: 0 }, ROOMS.hall)!.n).toEqual({ x: 0, y: 1, z: 0 });
  });
});

describe('raked seats', () => {
  it('a light over the theatre\'s stalls or the cinema\'s rows lands on the seats, not on the floor under them', async () => {
    const { theatreFloor, cinemaFloor } = await import('./sceneSizes');
    const t = hitRoom({ x: 4, y: 11.6, z: 9 }, { x: 0, y: -1, z: 0.02 }, ROOMS.theatre)!;
    expect(t.y).toBeCloseTo(theatreFloor(t.z), 2); expect(t.y).toBeGreaterThan(0.5);
    const c = hitRoom({ x: 4, y: 11, z: 14 }, { x: 0, y: -1, z: 0 }, ROOMS.cinema)!;
    expect(c.y).toBeCloseTo(cinemaFloor(14), 2); expect(c.y).toBeGreaterThan(2);
    // (a slanting beam stops at the first row it meets, before the floor would have been)
    const s = hitRoom({ x: 0, y: 8, z: 2 }, { x: 0, y: -0.5, z: 0.866 }, ROOMS.theatre)!;
    expect(s.y).toBeGreaterThan(0); expect(s.y).toBeCloseTo(theatreFloor(s.z), 2);
  });
});
