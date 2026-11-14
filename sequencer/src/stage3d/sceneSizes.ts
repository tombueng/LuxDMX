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
