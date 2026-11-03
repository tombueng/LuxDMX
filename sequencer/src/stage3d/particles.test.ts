// @vitest-environment happy-dom
// Fog like real stage fog, in numbers: a burst leaves the nozzle as a jet, then the cloud spreads
// over the whole stage and towards the audience in 10 to 20 s (it doesn't pile up at the
// backdrop), thins as it spreads, and is gone 30 to 40 s after the machine stops, fading (never
// popping). A hazer's haze rises and spreads further. How foggy the room is follows the same clock.
// Walls hold it, the frame rate doesn't change it, nothing goes NaN.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Air, CLOUD, FOG, HAZE, JET, Particles, type Emitter, type P } from './particles';
import { BAND, DECK, ROOMS, showRoom, shownRoom } from './geometry';

// a repeatable Math.random (the machines scatter their puffs with it)
function seeded(s: number) { return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seeded(11)); showRoom(ROOMS.hall); });
afterEach(() => { vi.restoreAllMocks(); showRoom(ROOMS.hall); });

const toward = (x: number, z: number) => { const dx = BAND.x - x, dz = BAND.z - z, l = Math.hypot(dx, dz); return { x: dx / l, y: 0, z: dz / l }; };
const fog = (id: string, x: number, z: number, dir: { x: number; y: number; z: number }, haze = false): Emitter => ({ id, kind: 'fog', x, y: DECK, z, dir, haze });
// the worst case for "piles up at the back": a machine in the back left corner blowing along the backdrop
const BACK = fog('back', -5, -3.7, { x: 1, y: 0, z: 0 });
// the demo's two machines on the front corners of the deck, blowing at the band
const DEMO = [fog('l', -6.25, 4.3, toward(-6.25, 4.3)), fog('r', 6.25, 4.3, toward(6.25, 4.3))];

// Where the fog is, weighted by how much of it shows (each puff's alpha times its area): the share
// in the back, middle and front thirds of the deck shown and off its front edge, how far forward 90 %
// of it reaches, on the left, how high (on average), how thick a cloud puff is (alpha, on average)
interface Look { count: number; mass: number; reach: number; back: number; mid: number; front: number; off: number; left: number; y: number; alpha: number; fogginess: number; uneven: number }
function look(Ps: Particles, haze = false): Look {
  const all = Ps.puffs('fog'), ps = all.filter((p) => (haze ? p.spin === HAZE : p.spin !== HAZE)), dk = shownRoom().deck;
  const w = ps.map((p) => p.a * p.size * p.size), W = w.reduce((a, b) => a + b, 0) || 1, third = (dk.z1 - dk.z0) / 3;
  const share = (f: (p: P) => boolean) => ps.reduce((a, p, i) => a + (f(p) ? w[i] : 0), 0) / W;
  const sorted = ps.map((p, i) => [p.z, w[i]] as const).sort((a, b) => a[0] - b[0]);
  let acc = 0, reach = NaN;
  for (const [z, wi] of sorted) { acc += wi; if (acc >= 0.9 * W) { reach = z; break; } }
  const clouds = ps.filter((p) => p.spin === CLOUD);
  // how unevenly it covers the deck, seen from above (each puff's alpha over its sprite's round
  // footprint, per square metre): the spread from square metre to square metre over the average
  const nx = Math.ceil(2 * dk.x), nz = Math.ceil(dk.z1 - dk.z0), cells = new Float64Array(nx * nz);
  for (const p of ps) {
    const rad = p.size / 2;
    for (let i = Math.max(0, Math.floor(p.x - rad + dk.x)); i < Math.min(nx, Math.ceil(p.x + rad + dk.x)); i++)
      for (let j = Math.max(0, Math.floor(p.z - rad - dk.z0)); j < Math.min(nz, Math.ceil(p.z + rad - dk.z0)); j++)
        if (Math.hypot(i + 0.5 - dk.x - p.x, j + 0.5 + dk.z0 - p.z) <= rad) cells[j * nx + i] += p.a;
  }
  const mean = cells.reduce((a, b) => a + b, 0) / cells.length, spread = Math.sqrt(cells.reduce((a, c) => a + (c - mean) ** 2, 0) / cells.length);
  return {
    count: all.length, mass: ps.length ? W : 0, reach,
    back: share((p) => p.z < dk.z0 + third), mid: share((p) => p.z >= dk.z0 + third && p.z <= dk.z1 - third), front: share((p) => p.z > dk.z1 - third && p.z <= dk.z1), off: share((p) => p.z > dk.z1),
    left: share((p) => p.x < 0), y: ps.reduce((a, p, i) => a + p.y * w[i], 0) / W, alpha: clouds.reduce((a, p) => a + p.a, 0) / Math.max(1, clouds.length),
    fogginess: Ps.fogginess, uneven: mean > 0 ? spread / mean : Infinity,
  };
}
// machines at their level for the first `secs` seconds, then off; stepped like the 3D stage does
// (frames of `dt`), looked at at the times asked
function run(ms: { e: Emitter; v: number }[], secs: number, times: number[], dt = 1 / 30, haze = false, each?: (P: Particles, t: number) => void) {
  const Ps = new Particles(), seen = new Map<number, Look>();
  let t = 0;
  for (const at of times) {
    while (t < at - 1e-9) { const h = Math.min(dt, at - t); Ps.step(h, ms.map((m) => ({ e: m.e, v: t < secs ? m.v : 0 }))); t += h; each?.(Ps, t); }
    seen.set(at, look(Ps, haze));
  }
  return { Ps, at: (t: number) => seen.get(t)! };
}
const r2 = (x: number) => Math.round(x * 100) / 100;

describe('fog', () => {
  it('a burst at the back spreads forward over the whole stage in 10 to 20 s, not piling up at the backdrop', () => {
    const { at } = run([{ e: BACK, v: 1 }], 6, [5, 10, 15, 20]);
    // (the numbers, for the record: where 90 % of it reaches, the share in the back third)
    console.log('back burst', [5, 10, 15, 20].map((t) => ({ t, reach: r2(at(t).reach), back: r2(at(t).back), mid: r2(at(t).mid), front: r2(at(t).front), off: r2(at(t).off), left: r2(at(t).left) })));
    expect(at(5).back).toBeGreaterThan(0.8);                 // it starts at the back
    expect(at(10).reach).toBeGreaterThan(1.5);               // 10 s: into the front third (it starts at z -3.7)
    expect(at(10).back).toBeLessThan(0.6);
    expect(at(20).reach).toBeGreaterThan(4.5);               // 20 s: over the deck's front edge
    expect(at(20).back).toBeLessThan(0.35);                  // and not much more at the back than anywhere
    expect(at(20).front + at(20).off).toBeGreaterThan(0.3);
    expect(at(20).left).toBeGreaterThan(0.3); expect(at(20).left).toBeLessThan(0.7);   // across the stage too
  });

  it("the demo's machines (front corners, blowing at the band): the cloud covers the stage, back to front, and rolls off to the audience", () => {
    const { at } = run(DEMO.map((e) => ({ e, v: 1 })), 6, [2, 10, 20]);
    console.log('demo burst', [2, 10, 20].map((t) => ({ t, reach: r2(at(t).reach), back: r2(at(t).back), mid: r2(at(t).mid), front: r2(at(t).front), off: r2(at(t).off) })));
    // the jet carries it a good way towards the band (the machines stand at z 4.3)
    expect(at(2).mid).toBeGreaterThan(0.25);
    expect(at(10).back).toBeGreaterThan(0.1); expect(at(10).front).toBeGreaterThan(0.2);
    for (const k of ['back', 'mid', 'front'] as const) expect(at(20)[k]).toBeLessThan(0.5);
    expect(at(20).off).toBeGreaterThan(0.15);
  });

  it('it thins as it spreads and fades out: gone 30 to 40 s after the machine stops, never popping', () => {
    const T = Array.from({ length: 47 }, (_, i) => i);
    let dying = 0;
    const { at } = run([{ e: BACK, v: 1 }], 6, T, 1 / 30, false, (Ps) => {
      // a puff at the very end of its life has already faded to nothing
      for (const p of Ps.puffs('fog')) if (p.spin === CLOUD && p.age > 0.97 * p.life) { dying++; expect(p.a).toBeLessThan(0.005); }
    });
    const mass = T.map((t) => at(t).mass), peak = Math.max(...mass), top = mass.indexOf(peak);
    console.log('back burst, fog shown', T.filter((t) => t % 5 === 0 || t > 40).map((t) => `${t}s ${Math.round((mass[t] / peak) * 100)}% n${at(t).count} f${r2(at(t).fogginess)}`).join(', '));
    expect(dying).toBeGreaterThan(0);
    // no second takes away more than a seventh of it
    for (let t = top + 1; t < T.length; t++) expect(mass[t - 1] - mass[t]).toBeLessThan(peak / 7);
    expect(at(5).alpha).toBeGreaterThan(at(20).alpha * 1.4);   // thinner as it spreads
    expect(mass[26]).toBeGreaterThan(0.25 * peak);              // 20 s after the stop: still there
    expect(mass[36]).toBeLessThan(0.1 * peak);                  // 30 s after: nearly gone
    expect(at(46).count).toBe(0);                               // 40 s after: gone
    expect(at(46).fogginess).toBe(0);
  });

  it("the room's fogginess follows the fog: up as it spreads, gone with it", () => {
    const T = [2, 5, 8, 10, 12, 15, 20, 25, 30, 36, 46];
    const { at } = run([{ e: BACK, v: 1 }], 6, T);
    const f = T.map((t) => at(t).fogginess), peak = Math.max(...f), when = T[f.indexOf(peak)];
    console.log('back burst, fogginess', T.map((t, i) => `${t}s ${r2(f[i])}`).join(', '));
    expect(f[0]).toBeLessThan(0.05);
    expect(peak).toBeGreaterThan(0.25);
    expect(when).toBeGreaterThanOrEqual(8); expect(when).toBeLessThanOrEqual(20);
    expect(at(36).fogginess).toBeLessThan(0.05);
    expect(at(46).fogginess).toBe(0);
    // a machine at full: the room is full in about 15 to 20 s; 40 s after it stops, clear again
    const full = run([{ e: fog('c', 3, 4.1, toward(3, 4.1)), v: 1 }], 40, [10, 20, 40, 60, 80]);
    console.log('one machine at full 40 s, fogginess', [10, 20, 40, 60, 80].map((t) => `${t}s ${r2(full.at(t).fogginess)}`).join(', '));
    expect(full.at(10).fogginess).toBeLessThan(0.6);
    expect(full.at(20).fogginess).toBeGreaterThan(0.8);
    expect(full.at(40).fogginess).toBeLessThanOrEqual(1);
    expect(full.at(80).fogginess).toBe(0);
    expect(full.at(80).count).toBe(0);
  });

  it("a hazer's haze rises higher and spreads wider than fog, on the same clock", () => {
    const at = [10, 20, 30, 70], spot = { x: -6.5, z: -1 }, dir = { x: 1, y: 0, z: 0 };
    const haze = run([{ e: fog('h', spot.x, spot.z, dir, true), v: 1 }], 30, at, 1 / 30, true).at;
    const smoke = run([{ e: fog('f', spot.x, spot.z, dir), v: 1 }], 30, at).at;
    console.log('hazer vs fog machine at the left, 30 s', [10, 20, 30].map((t) => ({ t, hazeY: r2(haze(t).y), fogY: r2(smoke(t).y), hazeLeft: r2(haze(t).left), fogLeft: r2(smoke(t).left), hazeUneven: r2(haze(t).uneven), fogUneven: r2(smoke(t).uneven) })));
    expect(haze(30).y).toBeGreaterThan(smoke(30).y + 0.5);
    expect(haze(20).left).toBeLessThan(0.65);
    for (const t of [10, 20, 30]) expect(haze(t).uneven).toBeLessThan(smoke(t).uneven);
    expect(haze(70).count).toBe(0);
    expect(haze(70).fogginess).toBe(0);
  });

  it("stays in the room: the pub's walls, backdrop and ceiling hold it, and a small room fills sooner", () => {
    const T = [5, 10, 15, 20, 30];
    const hall = run([{ e: fog('p', 2.5, 2.4, toward(2.5, 2.4)), v: 1 }], 6, T).at;
    showRoom(ROOMS.pub);
    const room = ROOMS.pub;
    let outside = 0;
    const pub = run([{ e: fog('p', 2.5, 2.4, toward(2.5, 2.4)), v: 1 }, { e: fog('ph', -4, 0, { x: 1, y: 0, z: 0 }, true), v: 1 }], 6, T, 1 / 30, false, (Ps) => {
      for (const p of Ps.puffs('fog')) if (Math.abs(p.x) > 4.6 || p.z < room.deck.z0 || p.y > room.ceiling || p.y < 0) outside++;
    }).at;
    expect(outside).toBe(0);
    expect(Math.max(...T.map((t) => pub(t).fogginess))).toBeGreaterThan(Math.max(...T.map((t) => hall(t).fogginess)));
    expect(pub(20).reach).toBeGreaterThan(room.deck.z1);       // over the pub's deck edge into the room
  });

  it('the same fog whatever the frame rate', () => {
    const fine = run([{ e: BACK, v: 1 }], 6, [15, 30], 1 / 60).at;
    const coarse = run([{ e: BACK, v: 1 }], 6, [15, 30], 0.1).at;
    expect(Math.abs(fine(15).reach - coarse(15).reach)).toBeLessThan(0.8);
    expect(Math.abs(fine(15).back - coarse(15).back)).toBeLessThan(0.1);
    expect(Math.abs(fine(15).fogginess - coarse(15).fogginess)).toBeLessThan(0.06);
    expect(Math.abs(fine(30).mass - coarse(30).mass) / fine(15).mass).toBeLessThan(0.1);
  });

  it('stays bounded and finite: the demo at full with its hazers for a minute, a stalled frame in it', () => {
    const ms = [...DEMO.map((e) => ({ e, v: 1 })), ...[[-6.5, -3.5], [6.5, -3.5], [-6.5, 0.6], [6.5, 0.6]].map(([x, z], i) => ({ e: fog(`h${i}`, x, z, { x: x < 0 ? 1 : -1, y: 0, z: 0 }, true), v: 0.35 }))];
    const Ps = new Particles();
    for (let t = 0; t < 60; t += 1 / 30) Ps.step(t > 30 && t < 30.05 ? 0.5 : 1 / 30, ms);
    const ps = Ps.puffs('fog');
    expect(ps.length).toBeLessThan(6000);
    expect(ps.filter((p) => p.spin === CLOUD).length).toBeLessThanOrEqual(FOG.KEPT);
    expect(ps.some((p) => p.spin === JET)).toBe(true);
    for (const p of ps) for (const v of [p.x, p.y, p.z, p.vx, p.vy, p.vz, p.size, p.a]) expect(Number.isFinite(v)).toBe(true);
    expect(Math.max(...ps.map((p) => p.size))).toBeLessThanOrEqual(5.2);
    expect(Ps.fogginess).toBeGreaterThan(0.9);
    expect(Ps.fogginess).toBeLessThanOrEqual(1);
  });
});

describe('the air that carries the fog', () => {
  it('pushes a pile at the backdrop away from it (never into it), and spreads a blob evenly both ways', () => {
    const A = new Air();
    A.fit(-8, 8, 0, 16);
    for (let i = 0; i < 200; i++) A.add(((i % 20) - 10) * 0.05, 0.3, 1);
    A.solve(0, { D: 1, thin: 0.4, max: 1.4, swirl: 0 });
    A.at(0, 0.3); expect(A.vz).toBeGreaterThanOrEqual(0);
    A.at(0, 1.5); expect(A.vz).toBeGreaterThan(0.1);
    A.fit(-8, 8, 0, 16); A.clear();
    for (let i = 0; i < 200; i++) A.add(0, 8, 1);
    A.solve(0, { D: 1, thin: 0.4, max: 1.4, swirl: 0 });
    A.at(-1.5, 8); const left = A.vx; A.at(1.5, 8);
    expect(left).toBeLessThan(-0.1); expect(A.vx).toBeCloseTo(-left, 5);
    // the swirls turn the air over without bunching it: on average they carry nothing anywhere
    A.clear(); A.solve(3, { D: 1, thin: 0.4, max: 1.4, swirl: 0.4 });
    let sx = 0, sz = 0, n = 0;
    for (let x = -7.5; x <= 7.5; x += 1) for (let z = 0.5; z <= 15.5; z += 1) { A.at(x, z); sx += A.vx; sz += A.vz; n++; expect(Math.hypot(A.vx, A.vz)).toBeLessThan(0.5); }
    expect(Math.abs(sx / n)).toBeLessThan(0.1); expect(Math.abs(sz / n)).toBeLessThan(0.1);
  });
});

// Cold sparks light up: brighter than white at the fountain, cooling as they fall, a warm glow round
// the machine while it runs (gone with it); flames are columns you see through, not walls of light.
describe('sparks and flames', () => {
  const at = (kind: 'sparks' | 'flame'): Emitter => ({ id: kind, kind, x: 0, y: DECK, z: 3 });
  it('a spark fountain is brighter than white and throws a warm glow round itself while it runs', () => {
    const Ps = new Particles();
    for (let i = 0; i < 30; i++) Ps.step(1 / 30, [{ e: at('sparks'), v: 1 }]);
    const sparks = Ps.puffs('sparks'), glow = Ps.puffs('glow');
    expect(sparks.length).toBeGreaterThan(1500);
    expect(Math.max(...sparks.map((p) => p.r))).toBeGreaterThan(2);
    expect(glow.length).toBeGreaterThan(0);
    for (const p of glow) { expect(p.size).toBeGreaterThan(2); expect(p.r).toBeGreaterThan(p.b); }
    for (let i = 0; i < 15; i++) Ps.step(1 / 30, [{ e: at('sparks'), v: 0 }]);
    expect(Ps.puffs('glow').length).toBe(0);                        // (the glow goes with the machine)
  });
  it('a flame column is see-through: no flame puff more than 60 % opaque', () => {
    const Ps = new Particles();
    for (let i = 0; i < 15; i++) Ps.step(1 / 30, [{ e: at('flame'), v: 1 }]);
    const ps = Ps.puffs('flame');
    expect(ps.length).toBeGreaterThan(100);
    expect(Math.max(...ps.map((p) => p.a))).toBeLessThanOrEqual(0.6);
  });
});
