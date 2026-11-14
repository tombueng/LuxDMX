// The scenes' sizes (scenes.ts builds them; content/scenePlaces.ts puts the templates' lights in
// them): pure numbers, no three.js, so the templates can use them.

// (its numbers, for the template's places too: where the screen, the rows and the walls are)
// (a big premiere house: a 22 m screen, 22 rows rising steeply to the projection booth)
export const CINEMA = {
  screenZ: -4.2, screenW: 22, screenH: 9.2, screenY: 3.6,
  rows: 22, rowZ0: 5.8, rowD: 1.1, rowRise: 0.34,
  aisles: [-7.5, 7.5], wallX: 16, backZ: 36, ceiling: 16,
  // the stage's truss in front of the screen and the bar over the front rows
  stageTruss: { z: 1.2, y: 12 }, foh: { z: 9, y: 13.5 }, deck: { x: 11, z0: -4.0, z1: 2.2 },
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

// a theatre: a big stage behind the proscenium (z 2.2: an 18 m opening, 16 m deep behind it, wide
// wings), its apron in front; the stalls rising gently, a balcony over their back half; a fly
// tower over the stage (the ceiling at 20 m), so drops can fly out of sight
export const THEATRE = {
  arch: { z: 2.2, w: 18, h: 10 }, stage: { x: 14, z0: -14, z1: 3.6 }, cycZ: -13.3, cyc: { w: 22, h: 13 },
  stalls: { z0: 5, rows: 16, d: 1.0, rise: 0.16 }, balcony: { z0: 15.5, y: 5.4, rows: 8, d: 1.05, rise: 0.38 },
  wallX: 16, backZ: 26, ceiling: 20,
  // the electrics over the stage (front to back) and the front-of-house bar over the stalls
  electrics: [{ z: 0.8, y: 11.2 }, { z: -3.5, y: 11.2 }, { z: -7.5, y: 11.8 }, { z: -11.5, y: 12.6 }], foh: { z: 11, y: 13 },
  // the booms in the wings (either side, two each), the black legs masking them
  booms: { x: 10.8, z: [-2.4, 1.0] }, legs: [-2.4, -6, -10],
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
