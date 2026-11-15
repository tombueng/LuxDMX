// The camera views of every room (Front, FOH, Side, From the stage; Top looks down from above it):
// inside its walls and under its ceiling; in the rooms with seats, tables and pews, clear of them.
// (How a view looks, a table's guests filling the bottom of the picture, is checked by eye: the
// ballroom's front view went up for that.)
import { describe, expect, it } from 'vitest';
import { ROOMS } from './geometry';
import { blocked, castOf, spaceOf } from './director';

describe('the camera views', () => {
  for (const [id, r] of Object.entries(ROOMS)) it(`${id}: inside the room, under its ceiling`, () => {
    for (const [k, v] of Object.entries(r.views)) {
      if (k === 'top') { expect(v.pos[1], `${id}.top`).toBeGreaterThan(r.ceiling); continue; }
      const [x, y, z] = v.pos;
      expect(Math.abs(x), `${id}.${k}`).toBeLessThan(r.walls.x);
      expect(z, `${id}.${k}`).toBeGreaterThan(r.walls.z0); expect(z, `${id}.${k}`).toBeLessThan(r.walls.z1);
      expect(y, `${id}.${k}`).toBeLessThan(r.ceiling);
    }
  });
  for (const id of ['ballroom', 'church', 'cinema'] as const) it(`${id}: Front, FOH and Side clear of its seats, pews and tables`, () => {
    const r = ROOMS[id], sp = spaceOf(r, castOf(id));
    for (const k of ['front', 'foh', 'side'] as const) {
      const [x, y, z] = r.views[k].pos;
      expect(blocked(sp, { x, y, z }), `${id}.${k}`).toBe('');
    }
  });
});
