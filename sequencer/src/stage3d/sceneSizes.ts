// The scenes' sizes (scenes.ts builds them; content/scenePlaces.ts puts the templates' lights in
// them): pure numbers, no three.js, so the templates can use them.

// (its numbers, for the template's places too: where the screen, the rows and the walls are)
export const CINEMA = {
  screenZ: -3.0, screenW: 15, screenH: 6.4, screenY: 3.0,
  rows: 18, rowZ0: 4.2, rowD: 1.05, rowRise: 0.32,
  aisles: [-4.8, 4.8], wallX: 11, backZ: 26, ceiling: 11.5,
};
// the height of the floor at z (the stalls, then the rows rising to the back)
export function cinemaFloor(z: number) {
  const r = Math.floor((z - CINEMA.rowZ0) / CINEMA.rowD);
  return r < 0 ? 0 : Math.min(CINEMA.rows, r + 1) * CINEMA.rowRise;
}

export const BAR = {
  counterZ: -2.3, counterX: 6, counterH: 1.12, backZ: -4.35, shelves: [1.35, 1.8, 2.25, 2.7],
  dance: { x: 3.6, z0: 2.6, z1: 7.2 }, ball: { x: -3.2, y: 3.2, z: 3.6 }, rail: 3.55, ceiling: 3.9,
};

// a theatre: the stage behind the proscenium (z 2.2), its apron in front; the stalls rising gently,
// a balcony over their back half
export const THEATRE = {
  arch: { z: 2.2, w: 12, h: 7.5 }, stage: { x: 8, z0: -6, z1: 3.4 }, cycZ: -5.7,
  stalls: { z0: 4.4, rows: 13, d: 1.0, rise: 0.16 }, balcony: { z0: 12.6, y: 4.6, rows: 7, d: 1.05, rise: 0.38 },
  wallX: 11, backZ: 21, ceiling: 12,
};
// the floor of the stalls at z (gently raked)
export function theatreFloor(z: number) {
  const s = THEATRE.stalls, r = Math.floor((z - s.z0) / s.d);
  return r < 0 ? 0 : Math.min(s.rows, r + 1) * s.rise;
}

// a church: the chancel raised at the east end (the deck), the altar on it, the nave's pews to the
// west door; stained glass along the walls
export const CHURCH = {
  chancel: { x: 6, z0: -7.4, z1: -1.2 }, altarZ: -5.6, lecternX: -4.2,
  pews: { z0: 1.0, rows: 18, d: 1.05, blocks: [[-7.4, -1.3], [1.3, 7.4]] as [number, number][] },
  wallX: 9, backZ: 22, ceiling: 13, windows: [1.5, 6, 10.5, 15, 19.5],
};

// a ballroom for a wedding: draped walls (for the uplights), round tables round a parquet dance
// floor, the head table along the back wall with the cake beside it and the DJ on the other side,
// chandeliers; two ceiling pipes over the dance floor for the moving lights
export const BALLROOM = {
  wallX: 11, z0: -6, z1: 20, ceiling: 6.5,
  dance: { x: 4, z0: 3, z1: 10 },
  head: { z: -3.6, w: 8 },
  cake: { x: 7.4, z: -3.4 }, dj: { x: -7.4, z: -3.6 },
  tables: [[-7.8, 0.5], [-7.8, 4.5], [-7.8, 8.5], [-7.8, 12.5], [7.8, 0.5], [7.8, 4.5], [7.8, 8.5], [7.8, 12.5], [-4, 14], [0, 14], [4, 14], [-2, 17.5], [2, 17.5]] as [number, number][],
  chandeliers: [[-5, 6.5], [5, 6.5], [0, 12.6]] as [number, number][],
  pipeY: 6.1, pipes: [3.0, 10.0],
};
