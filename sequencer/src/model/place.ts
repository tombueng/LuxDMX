// Where new lights go on the 2D plan: clear of the lights already there, so a light and its name
// don't sit on another's. A row of their own when the stage has one with room (the middle first,
// then spreading out), else each on the freest spot left, named left to right.
//
// Distances are on the plan as it's drawn: x counts 1.6 times y (the plan is wider than deep).

export interface Spot { x: number; y: number }
const gap = (a: Spot, b: Spot) => Math.hypot((a.x - b.x) * 1.6, a.y - b.y);

// (enough for an icon and its name beside it at the usual sizes)
export const ROOM = 0.12;
const ROWS = [0.5, 0.35, 0.65, 0.25, 0.8, 0.42, 0.58, 0.15, 0.9, 0.3, 0.7, 0.2, 0.85, 0.1];

export function placeNew(there: Spot[], count: number): Spot[] {
  const xs = Array.from({ length: count }, (_, i) => (i + 1) / (count + 1));
  const room = (y: number) => Math.min(1, ...there.flatMap((f) => xs.map((x) => gap(f, { x, y }))));
  // (a row is only a row while its lights aren't on top of each other: 0.9 wide over count + 1)
  const tight = 1.6 / (count + 1) < ROOM;
  const row = tight ? undefined : ROWS.find((y) => room(y) >= ROOM);
  if (row !== undefined) return xs.map((x) => ({ x, y: row }));
  // each on the freest spot: the most room around it, the middle and the front a little first
  const placed: Spot[] = [], all = [...there];
  for (let i = 0; i < count; i++) {
    let best: Spot = { x: 0.5, y: 0.5 }, score = -Infinity;
    for (let x = 0.05; x <= 0.951; x += 0.025)
      for (let y = 0.08; y <= 0.921; y += 0.03) {
        const p = { x, y };
        const r = Math.min(1, ...all.map((f) => gap(f, p)));
        const s = Math.min(r, ROOM * 1.5) - Math.abs(x - 0.5) * 0.02 - Math.abs(y - 0.5) * 0.01;
        if (s > score) { score = s; best = p; }
      }
    placed.push(best); all.push(best);
  }
  return placed.sort((a, b) => a.x - b.x || a.y - b.y).map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
}
