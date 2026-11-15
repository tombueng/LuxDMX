// The twenty more moves: each one stays within half its Size either way, goes somewhere over a round
// and comes back to where it started (the closed shapes), and draws what its name says.
import { describe, expect, it } from 'vitest';
import { EFFECTS, EFFECT_MAP, paramsOf, runEffect } from './effects';
import { MOVE_EFFECTS } from './moves';

const ids = MOVE_EFFECTS.map((d) => d.id);
const one = (id: string, t: number, n = 1, size = 0.4) => runEffect(EFFECT_MAP.get(id)!, paramsOf(id, { size, spread: 0 }), n, t);
const path = (id: string, steps = 400, size = 0.4) => Array.from({ length: steps }, (_, i) => one(id, i / steps, 1, size)[0]);

it('twenty of them, after the first eight, each named and said in plain words', () => {
  expect(MOVE_EFFECTS.length).toBe(20);
  const moves = EFFECTS.filter((d) => d.category === 'move');
  expect(moves.length).toBe(28);
  expect(moves.slice(0, 8).map((d) => d.id)).toEqual(['circle', 'figure8', 'pan', 'tilt', 'fan', 'cross', 'swing', 'ballyhoo']);
  for (const d of MOVE_EFFECTS) { expect(d.blurb.length).toBeGreaterThan(20); expect(d.blurb).not.toMatch(/—/); }
});

describe.each(ids)('%s', (id) => {
  it('stays within half its size, never NaN, and moves', () => {
    for (const size of [0.1, 0.4, 1]) {
      const pts = Array.from({ length: 300 }, (_, i) => one(id, i / 97, 5, size)).flat();
      for (const o of pts) {
        for (const v of [o.pan ?? 0, o.tilt ?? 0]) { expect(Number.isFinite(v)).toBe(true); expect(Math.abs(v)).toBeLessThanOrEqual(0.5 * size + 1e-9); }
      }
      const pans = pts.map((o) => o.pan ?? 0), tilts = pts.map((o) => o.tilt ?? 0);
      expect(Math.max(...pans) - Math.min(...pans) + Math.max(...tilts) - Math.min(...tilts)).toBeGreaterThan(0.3 * size);
    }
  });
});

it('the closed shapes come back to where they started, without a jump on the way', () => {
  for (const id of ['square', 'triangle', 'star', 'heart', 'spiral', 'flower', 'knot', 'uprightEight', 'spirograph', 'bounce', 'zigzag', 'searchlight', 'wipers', 'weave', 'mirrorCircles']) {
    const a = one(id, 0)[0], b = one(id, 1)[0];
    expect(Math.hypot((a.pan ?? 0) - (b.pan ?? 0), (a.tilt ?? 0) - (b.tilt ?? 0)), id).toBeLessThan(1e-6);
    const p = path(id, 2000);
    for (let i = 1; i < p.length; i++) expect(Math.hypot((p[i].pan ?? 0) - (p[i - 1].pan ?? 0), (p[i].tilt ?? 0) - (p[i - 1].tilt ?? 0)), `${id} at ${i}`).toBeLessThan(0.02);
  }
});

it('the square goes through its four corners; the star has five points; the heart dips at the bottom middle', () => {
  const sq = path('square'), r = 0.2;
  for (const [x, y] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) expect(sq.some((o) => Math.abs(o.pan! - x * r) < 1e-3 && Math.abs(o.tilt! - y * r) < 1e-3)).toBe(true);
  // (the star's points: as far out as it goes, five times a round)
  const st = path('star', 1000), far = st.map((o) => Math.hypot(o.pan!, o.tilt!)), top = Math.max(...far);
  let points = 0;
  for (let i = 0; i < far.length; i++) if (far[i] > top - 1e-6 && !(far[(i + far.length - 1) % far.length] > top - 1e-6)) points++;
  expect(points).toBe(5);
  const h = path('heart', 1000), low = h.reduce((a, o) => (o.tilt! < a.tilt! ? o : a));
  expect(Math.abs(low.pan!)).toBeLessThan(0.01);
});

it('Weave: neighbours go opposite ways; Mirror circles: the halves too; Step holds four places on the beat', () => {
  const w = one('weave', 0.25, 4);
  expect(Math.sign(w[0].pan!)).toBe(-Math.sign(w[1].pan!));
  const m = one('mirrorCircles', 0.25, 4);
  expect(Math.sign(m[0].pan!)).toBe(-Math.sign(m[3].pan!));
  const places = new Set([0.1, 0.35, 0.6, 0.85].map((t) => JSON.stringify(one('step', t)[0])));
  expect(places.size).toBe(4);
  expect(one('step', 0.15)[0]).toEqual(one('step', 0.2)[0]);              // (holding still between the beats)
  expect(paramsOf('step').tempo).toBe(true); expect(paramsOf('headBang').speed).toBe(1);
});

it('Head bang is down on the beat and back up before the next', () => {
  const down = one('headBang', 0)[0].tilt!, up = one('headBang', 0.9)[0].tilt!;
  expect(down).toBeCloseTo(-0.2); expect(up).toBeGreaterThan(0.19);
});
