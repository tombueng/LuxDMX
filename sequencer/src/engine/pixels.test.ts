import { describe, expect, it } from 'vitest';
import { EFFECTS, EFFECT_MAP, PALETTES, paramsOf, runEffect, type Elem, type FxOut, type Where } from './effects';
import { PIXEL_EFFECTS } from './pixels';
import { Engine } from './engine';
import { emptyShow } from '../model/format';

const IDS = ['theater', 'fire2012', 'twinkle', 'juggle', 'sinelon', 'pride', 'bouncing', 'ripple', 'fireworks', 'matrix', 'aurora',
  'plasma', 'glitter', 'heartbeat', 'scanner', 'meteorRain', 'lightning1d', 'rain', 'popcorn', 'gradientChase'];

// one light with n pixels, a row of n single-cell lights (PARs), a wall of strips side by side
const strip = (n: number): Where[] => Array.from({ length: n }, (_, i) => ({ u: i / (n - 1), row: 0, rows: 1 }));
const pars = (n: number): Where[] => Array.from({ length: n }, (_, i) => ({ u: 0.5, row: i, rows: n }));
const wall = (lanes: number, px: number): Where[] => Array.from({ length: lanes * px }, (_, i) => ({ u: (i % px) / (px - 1), row: Math.floor(i / px), rows: lanes }));

// One frame of a show `secs` seconds after it started, at 120 BPM.
function frame(id: string, where: Where[], secs: number, extra: Record<string, unknown> = {}): FxOut[] {
  const p = paramsOf(id, extra), beats = secs * 2;
  return runEffect(EFFECT_MAP.get(id)!, p, where.length, (p.tempo ? beats : secs) / p.speed, 1, where, { beats, secs });
}
const lv = (o: FxOut) => o.intensity ?? 0;
const levels = (outs: FxOut[]) => outs.map(lv);
const times = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
const near = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, tol = 0.02) =>
  Math.abs(a.r - b.r) < tol && Math.abs(a.g - b.g) < tol && Math.abs(a.b - b.b) < tol;
const brightest = (outs: FxOut[]) => levels(outs).reduce((bi, v, i, a) => (v > a[bi] ? i : bi), 0);

// Exact values on a 60-pixel strip at its defaults: [seconds, pixel, intensity, r, g, b].
const EXACT: Record<string, [number, number, number, number, number, number][]> = {
  theater: [[0.5, 0, 0, 1, 0.1285, 0], [0.5, 17, 0, 0.4389, 1, 0], [0.5, 42, 0, 0.4773, 0, 1], [1.7, 0, 0, 1, 0.4369, 0], [1.7, 17, 0, 0, 1, 0.1755], [1.7, 42, 0, 0.7835, 0, 1], [4.3, 0, 0, 0.7984, 1, 0], [4.3, 17, 0, 0, 0.4933, 1], [4.3, 42, 0, 1, 0, 0.1035]],
  fire2012: [[0.5, 0, 1, 1, 1, 0.2813], [0.5, 17, 0.5454, 1, 0, 0], [0.5, 42, 0, 1, 0, 0], [1.7, 0, 1, 1, 0.467, 0], [1.7, 17, 1, 1, 0.2637, 0], [1.7, 42, 0, 1, 0, 0], [4.3, 0, 1, 1, 1, 0.6111], [4.3, 17, 0.4553, 1, 0, 0], [4.3, 42, 0, 1, 0, 0]],
  twinkle: [[0.5, 0, 0.0005, 1, 0.902, 0], [0.5, 17, 0, 1, 0, 0.7843], [0.5, 42, 0.0176, 0.4784, 0, 1], [1.7, 0, 0.078, 1, 0.902, 0], [1.7, 17, 0.6119, 0, 0.898, 1], [1.7, 42, 0.4756, 0, 0.898, 1], [4.3, 0, 0, 1, 0.902, 0], [4.3, 17, 0.1028, 0, 0.898, 1], [4.3, 42, 0.0214, 1, 0, 0.7843]],
  juggle: [[0.5, 0, 0, 1, 0, 0], [0.5, 17, 0, 0.6949, 1, 0], [0.5, 42, 0.9039, 1, 0.6461, 0.3423], [1.7, 0, 0, 1, 0, 0], [1.7, 17, 0, 0.6949, 1, 0], [1.7, 42, 0.1073, 1, 0, 1], [4.3, 0, 0.8145, 0, 1, 0.0252], [4.3, 17, 0.0947, 0.8495, 0.4264, 1], [4.3, 42, 0.8412, 1, 0, 1]],
  sinelon: [[0.5, 0, 0.0019, 0.7012, 0, 1], [0.5, 17, 0.039, 1, 0, 0.4457], [0.5, 42, 0.3975, 1, 0.2237, 0], [1.7, 0, 0, 0.7012, 0, 1], [1.7, 17, 0.0003, 1, 0, 0.4457], [1.7, 42, 0.1073, 1, 0.2237, 0], [4.3, 0, 0.0044, 0, 0.2, 1], [4.3, 17, 0.0898, 0.479, 0, 1], [4.3, 42, 0.9145, 0.9231, 0, 1]],
  pride: [[0.5, 0, 0.9563, 1, 0.1908, 0.0774], [0.5, 17, 0.5408, 0.1048, 0.0774, 1], [0.5, 42, 0.3557, 1, 0.2507, 0.0774], [1.7, 0, 0.4268, 1, 0.6832, 0.0749], [1.7, 17, 0.3136, 0.5181, 0.0749, 1], [1.7, 42, 0.5688, 1, 0.5466, 0.0749], [4.3, 0, 0.2309, 0.0695, 1, 0.8226], [4.3, 17, 0.686, 1, 0.1073, 0.0695], [4.3, 42, 0.3773, 0.4432, 1, 0.0695]],
  bouncing: [[0.5, 0, 0, 1, 0.3098, 0.6392], [0.5, 17, 0, 0.8114, 1, 0.7029], [0.5, 42, 0, 0.6155, 0.8939, 1], [1.7, 0, 0, 1, 0.3098, 0.6392], [1.7, 17, 0.9123, 0.5651, 1, 0.9492], [1.7, 42, 0, 0.6155, 0.8939, 1], [4.3, 0, 1, 0.6227, 0.8409, 1], [4.3, 17, 0, 0.8114, 1, 0.7029], [4.3, 42, 0, 0.6155, 0.8939, 1]],
  ripple: [[0.5, 0, 0, 0, 0.1882, 1], [0.5, 17, 0.0704, 0, 1, 0.816], [0.5, 42, 0, 0, 0.6185, 1], [1.7, 0, 0, 0, 0.1882, 1], [1.7, 17, 0.0109, 0, 1, 0.8157], [1.7, 42, 0.0639, 0, 1, 0.8157], [4.3, 0, 0, 0, 0.1882, 1], [4.3, 17, 0.039, 0, 0.5086, 1], [4.3, 42, 0.0056, 0, 0.1883, 1]],
  fireworks: [[0.5, 0, 0, 1, 0, 0], [0.5, 17, 0, 0.6949, 1, 0], [0.5, 42, 0.0506, 0, 0, 1], [1.7, 0, 0, 1, 0, 0], [1.7, 17, 0, 0.6949, 1, 0], [1.7, 42, 0.527, 1, 0, 1], [4.3, 0, 0, 1, 0, 0], [4.3, 17, 0, 0.6949, 1, 0], [4.3, 42, 0.9251, 1, 1, 0]],
  matrix: [[0.5, 0, 0, 0, 1, 0], [0.5, 17, 0.0604, 0, 1, 0.0774], [0.5, 42, 0.2899, 0, 1, 0.1615], [1.7, 0, 0.4308, 0, 1, 0.2054], [1.7, 17, 0.0765, 0, 1, 0.0856], [1.7, 42, 0, 0, 1, 0], [4.3, 0, 0.3014, 0, 1, 0.1661], [4.3, 17, 0.3171, 0, 1, 0.172], [4.3, 42, 0, 0, 1, 0]],
  aurora: [[0.5, 0, 0.0102, 0, 0.25, 1], [0.5, 17, 0.2684, 0, 0.8635, 1], [0.5, 42, 0.2973, 0, 1, 0.4097], [1.7, 0, 0.01, 0, 0.25, 1], [1.7, 17, 0.56, 0, 0.6964, 1], [1.7, 42, 0.1411, 0.398, 0.2916, 1], [4.3, 0, 0.2447, 0, 1, 0.4405], [4.3, 17, 0.0125, 0.0069, 0.256, 1], [4.3, 42, 0.1402, 0.1008, 0.6334, 1]],
  plasma: [[0.5, 0, 0.3952, 0.6529, 0.0144, 1], [0.5, 17, 0, 1, 0.0936, 0.2361], [0.5, 42, 0.3116, 0.7691, 0, 1], [1.7, 0, 0.3238, 0.8808, 0.1431, 1], [1.7, 17, 0.3228, 0.8925, 0.1497, 1], [1.7, 42, 0.4939, 1, 0.4336, 0.3701], [4.3, 0, 0.6673, 1, 0.5327, 0.0903], [4.3, 17, 0.0538, 1, 0.0795, 0.2573], [4.3, 42, 0.4236, 0.6356, 0, 1]],
  glitter: [[0.5, 0, 1, 1, 0.4016, 0], [0.5, 17, 1, 0.7676, 0, 1], [0.5, 42, 1, 0, 1, 0.2], [1.7, 0, 1, 0.28, 1, 0], [1.7, 17, 1, 1, 0.2276, 0], [1.7, 42, 1, 0.0602, 0, 1], [4.3, 0, 1, 0.9402, 0, 1], [4.3, 17, 1, 0, 0.3867, 1], [4.3, 42, 1, 1, 0.6414, 0]],
  heartbeat: [[0.5, 0, 0.7523, 1, 0, 0.0941], [0.5, 17, 0.6366, 1, 0.0949, 0.2568], [0.5, 42, 0.6366, 1, 0.0949, 0.2568], [1.7, 0, 0.578, 1, 0, 0.0941], [1.7, 17, 0.4891, 1, 0.0949, 0.2568], [1.7, 42, 0.4891, 1, 0.0949, 0.2568], [4.3, 0, 0.2015, 1, 0, 0.0941], [4.3, 17, 0.1705, 1, 0.0949, 0.2568], [4.3, 42, 0.1705, 1, 0.0949, 0.2568]],
  scanner: [[0.5, 0, 0.0281, 1, 0.0627, 0.0008], [0.5, 17, 0.2202, 1, 0.0627, 0.0008], [0.5, 42, 0.2202, 0.0008, 0.6588, 1], [1.7, 0, 0.0067, 0.0008, 0.6588, 1], [1.7, 17, 0.3, 1, 0.1159, 0.1759], [1.7, 42, 0.3, 0.1759, 0.6588, 1], [4.3, 0, 0.1173, 1, 0.0627, 0.0008], [4.3, 17, 0.9187, 1, 0.0627, 0.0008], [4.3, 42, 0.9187, 0.0008, 0.6588, 1]],
  meteorRain: [[0.5, 0, 0.0286, 0.3327, 0.0404, 1], [0.5, 17, 0, 0.3529, 0, 1], [0.5, 42, 0.0036, 0.3504, 0.005, 1], [1.7, 0, 0, 0.3529, 0, 1], [1.7, 17, 0.0008, 0.3524, 0.0011, 1], [1.7, 42, 0.4323, 0.2691, 0.5987, 1], [4.3, 0, 0.7638, 0.736, 0.9305, 1], [4.3, 17, 0.0125, 0.3442, 0.0176, 1], [4.3, 42, 0.004, 0.3501, 0.0056, 1]],
  lightning1d: [[0.5, 0, 0, 1, 1, 1], [0.5, 17, 0, 0.8136, 0.861, 1], [0.5, 42, 0, 0.9153, 0.8814, 1], [1.7, 0, 0, 1, 1, 1], [1.7, 17, 0, 0.8136, 0.861, 1], [1.7, 42, 0, 0.9153, 0.8814, 1], [4.3, 0, 0, 1, 1, 1], [4.3, 17, 0.0736, 0.8136, 0.861, 1], [4.3, 42, 0, 0.9153, 0.8814, 1]],
  rain: [[0.5, 0, 0, 0.1176, 0.3922, 1], [0.5, 17, 0, 0.2532, 0.6181, 1], [0.5, 42, 0, 0.2532, 0.6181, 1], [1.7, 0, 0, 0.1176, 0.3922, 1], [1.7, 17, 0, 0.2532, 0.6181, 1], [1.7, 42, 0, 0.2532, 0.6181, 1], [4.3, 0, 0, 0.1176, 0.3922, 1], [4.3, 17, 0, 0.2532, 0.6181, 1], [4.3, 42, 0, 0.2532, 0.6181, 1]],
  popcorn: [[0.5, 0, 0, 1, 0, 0.7843], [0.5, 17, 0, 0.1697, 1, 0.943], [0.5, 42, 0.6456, 1, 0.0317, 0.7568], [1.7, 0, 0, 1, 0, 0.7843], [1.7, 17, 0, 0.1697, 1, 0.943], [1.7, 42, 0, 0.6584, 0.1624, 1], [4.3, 0, 0, 1, 0, 0.7843], [4.3, 17, 0, 0.1697, 1, 0.943], [4.3, 42, 0, 0.6584, 0.1624, 1]],
  gradientChase: [[0.5, 0, 0.3133, 0.5798, 0.1616, 1], [0.5, 17, 0.1651, 0.6603, 0.42, 1], [0.5, 42, 0.5217, 0.1421, 1, 0.4143], [1.7, 0, 0.0857, 1, 0.2844, 0.589], [1.7, 17, 0.0346, 0.2719, 0.2222, 1], [1.7, 42, 0.2369, 0.5838, 0.4872, 1], [4.3, 0, 0.6216, 0.3054, 0.7317, 1], [4.3, 17, 0.4114, 0.1262, 1, 0.4799], [4.3, 42, 0.7865, 1, 0.3725, 0.1988]],
};

describe('pixel shows: all of them', () => {
  it('all twenty are there, as pixel shows, with a plain name and a blurb', () => {
    expect(PIXEL_EFFECTS.map((d) => d.id)).toEqual(IDS);
    const names = EFFECTS.map((d) => d.name);
    for (const d of PIXEL_EFFECTS) {
      expect(EFFECT_MAP.get(d.id)).toBe(d);
      expect(d.category).toBe('pixel');
      expect(names.filter((n) => n === d.name)).toHaveLength(1);       // no two effects called the same
      expect(d.blurb.length).toBeGreaterThan(30); expect(d.blurb.length).toBeLessThan(140);
      expect(d.blurb).not.toMatch(/\u2014/);                         // no em dashes
      expect(d.defaults.colors?.length).toBeGreaterThan(0);             // each brings colours that suit it
    }
  });
  it('the new palettes are there and are proper colours', () => {
    for (const name of ['Aurora', 'Heat', 'Lava', 'Matrix', 'Candy', 'Neon']) {
      expect(PALETTES[name].length).toBeGreaterThanOrEqual(4);
      for (const c of PALETTES[name]) for (const v of [c.r, c.g, c.b]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
    expect(PALETTES.Rainbow.length).toBe(8);                              // the old ones untouched
  });
  it('colour and intensity always, never NaN, everything 0..1: on a strip, a row of PARs, a wall, long after the start', () => {
    const layouts = [strip(60), pars(8), wall(4, 20), strip(1), strip(2)];
    for (const id of IDS) for (const where of layouts) for (const t of [0, 0.37, 1.9, 7.3, 61.4, 3600.2]) {
      for (const o of frame(id, where, t)) {
        expect(o.color, id).toBeDefined(); expect(o.intensity, id).toBeDefined();
        for (const v of [o.intensity!, o.color!.r, o.color!.g, o.color!.b]) {
          expect(Number.isFinite(v), `${id} at ${t}`).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1);
        }
        expect(Math.max(o.color!.r, o.color!.g, o.color!.b)).toBeCloseTo(1, 5);   // the colour at full, brightness apart
      }
    }
  }, 20_000);   // (every show, many layouts and times: a few seconds on a busy machine)
  it('the knobs that stretch them stay in range too (size, spread, direction, no colours, dim floor)', () => {
    const knobs = [{ size: 0 }, { size: 1 }, { spread: 0 }, { direction: 'backward' }, { direction: 'in' }, { direction: 'out' }, { direction: 'random' },
      { direction: 'bounce' }, { blocks: 3 }, { colors: [] }, { low: 0.2, high: 0.7 }, { speed: 0.05 }];
    for (const id of IDS) for (const k of knobs) for (const t of [0.2, 3.3]) for (const o of frame(id, wall(3, 12), t, k)) {
      for (const v of [o.intensity!, o.color!.r, o.color!.g, o.color!.b]) { expect(Number.isFinite(v), `${id} ${JSON.stringify(k)}`).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      if ('low' in k) { expect(o.intensity!).toBeGreaterThanOrEqual(0.2 - 1e-9); expect(o.intensity!).toBeLessThanOrEqual(0.7 + 1e-9); }
    }
  }, 20_000);   // (every show, many layouts and times: a few seconds on a busy machine)
  it('exact values on a 60-pixel strip', () => {
    for (const id of IDS) for (const [t, i, v, r, g, b] of EXACT[id]) {
      const o = frame(id, strip(60), t)[i];
      expect(o.intensity, `${id} ${t}s pixel ${i}`).toBeCloseTo(v, 3);
      [r, g, b].forEach((x, k) => expect([o.color!.r, o.color!.g, o.color!.b][k], `${id} ${t}s pixel ${i}`).toBeCloseTo(x, 3));
    }
  });
  it('every one moves, and differs along the strip', () => {
    for (const id of IDS) {
      const frames = times(0, 12, 0.05).map((t) => frame(id, strip(60), t));
      const look = (o: FxOut) => [lv(o), o.color!.r, o.color!.g, o.color!.b].map((v) => v.toFixed(2)).join();
      expect(new Set(frames.map((f) => f.map(look).join('|'))).size, id).toBeGreaterThan(20);              // changes over time
      expect(Math.max(...frames.map((f) => new Set(f.map(look)).size)), id).toBeGreaterThan(5);           // not all the same
    }
  }, 20_000);   // (every show, many layouts and times: a few seconds on a busy machine)
  it('the per-frame cache only saves work: pixel by pixel gives the same', () => {
    for (const id of IDS) for (const where of [strip(30), wall(3, 10), pars(8)]) {
      const p = paramsOf(id), n = where.length, total = 3.7 / p.speed;
      const all = runEffect(EFFECT_MAP.get(id)!, p, n, total, 1, where, { beats: 7.4, secs: 3.7 });
      const one = where.map((w, i) => {
        const e: Elem = { phase: 0, x: n > 1 ? i / (n - 1) : 0, cycle: total % 1, total, k: i, m: n, seed: (131 + i) | 0, ...w, beats: 7.4, secs: 3.7,
          sx: 0, sy: 0, rad: 0, ang: 0, lane: 0, lanes: 1, gx: i, gy: 0, gw: n, gh: 1, first: i === 0, cell: i, cells: n };
        e.phase = (total - p.spread * (n > 1 ? i / n : 0)) % 1; if (e.phase < 0) e.phase += 1;
        return EFFECT_MAP.get(id)!.run(e, { ...p });                     // a fresh p every time: no cache
      });
      expect(one, id).toEqual(all);
    }
  });
});

describe('pixel shows: each one looks like itself', () => {
  it('theater chase: every third pixel lit, one step along every quarter beat; size sets the gap', () => {
    const lit = (t: number, extra = {}) => levels(frame('theater', strip(12), t, extra)).map((v) => (v > 0.5 ? 1 : 0)).join('');
    expect(lit(0.01)).toBe('100100100100');
    expect(lit(0.13)).toBe('010010010010');                     // a quarter beat at 120 BPM: 125 ms
    expect(lit(0.26)).toBe('001001001001');
    expect(lit(0.01, { size: 0.5 })).toBe('100010001000');
    expect(lit(0.01, { direction: 'backward' })).toBe('001001001001');
  });
  it('flames: hot at the bottom, dark at the top; on a wall in every strip; each PAR flickers on its own', () => {
    const avg = (where: Where[], pick: (i: number) => boolean) => {
      let s = 0, n = 0;
      for (const t of times(0, 6, 0.1)) frame('fire2012', where, t).forEach((o, i) => { if (pick(i)) { s += lv(o); n++; } });
      return s / n;
    };
    expect(avg(strip(60), (i) => i < 6)).toBeGreaterThan(0.85);
    expect(avg(strip(60), (i) => i > 50)).toBe(0);
    expect(avg(wall(5, 30), (i) => i % 30 < 3)).toBeGreaterThan(0.85);   // the bottom of every strip
    expect(avg(wall(5, 30), (i) => i % 30 > 25)).toBe(0);
    const p = times(0, 4, 0.05).map((t) => levels(frame('fire2012', pars(8), t)));
    for (let i = 0; i < 8; i++) {
      const v = p.map((f) => f[i]);
      expect(Math.max(...v) - Math.min(...v)).toBeGreaterThan(0.4);       // flickers
      expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(p[40].map((v) => v.toFixed(2))).size).toBeGreaterThan(4);   // not in step
    const heat = frame('fire2012', strip(60), 1)[1].color!;
    expect(heat.g).toBeGreaterThan(0.4);                                // yellow-white at the base,
    expect(frame('fire2012', strip(60), 1)[25].color!.b).toBeLessThan(0.05);   // red-orange up the flame
  });
  it('twinkles: soft in and out, and size sets how many', () => {
    const run = (size: number) => times(0, 10, 0.025).map((t) => levels(frame('twinkle', strip(40), t, { size })));
    const f = run(0.6);
    let worst = 0;
    for (let k = 1; k < f.length; k++) for (let i = 0; i < 40; i++) worst = Math.max(worst, Math.abs(f[k][i] - f[k - 1][i]));
    expect(worst).toBeLessThan(0.2);                                     // no pixel jumps (25 ms frames)
    const share = (fr: number[][]) => fr.flat().filter((v) => v > 0.1).length / fr.flat().length;
    expect(share(run(0.15))).toBeLessThan(share(f) / 2.5);
    expect(share(run(0))).toBe(0);
  });
  it('juggle: all eight dots start in the middle; later they are spread out with trails', () => {
    const f = levels(frame('juggle', strip(61), 0));
    expect(f[30]).toBe(1); expect(f[0]).toBe(0); expect(f[60]).toBe(0);
    const later = levels(frame('juggle', strip(61), 5)).filter((v) => v > 0.6).length;
    expect(later).toBeGreaterThanOrEqual(4);
    expect(later).toBeLessThan(40);
  });
  it('sinelon: a quarter round in, the dot is at the end with a fading trail behind it', () => {
    const f = levels(frame('sinelon', strip(60), 1));                 // 4 s a round: 1 s is a quarter
    expect(f[59]).toBeGreaterThan(0.95);
    expect(f[50]).toBeGreaterThan(0.01); expect(f[50]).toBeLessThan(f[56]);
    expect(f[10]).toBeLessThan(0.01);
  });
  it('colour waves: never dark, always moving, rainbow colours along the strip', () => {
    for (const t of times(0, 20, 0.5)) {
      const f = frame('pride', strip(60), t);
      expect(Math.min(...levels(f))).toBeGreaterThan(0.1);
      expect(new Set(f.map((o) => o.color!.r > 0.5 ? (o.color!.g > 0.5 ? 'y' : 'r') : o.color!.g > 0.5 ? 'g' : 'b')).size).toBeGreaterThanOrEqual(2);
    }
  });
  it('bouncing balls: thrown up from the floor together, bouncing lower, never over the top; fewer on 8 PARs', () => {
    expect(levels(frame('bouncing', strip(60), 0)).map((v) => (v > 0.5 ? 1 : 0)).indexOf(1)).toBe(0);   // all on the floor
    let top = 0, floor = 0;
    for (const t of times(0.05, 30, 0.05)) {
      const f = levels(frame('bouncing', strip(60), t));
      f.forEach((v, i) => { if (v > 0.3) top = Math.max(top, i); });
      if (f[0] > 0.3) floor++;
    }
    expect(top).toBeGreaterThan(40); expect(top).toBeLessThanOrEqual(59);
    expect(floor).toBeGreaterThan(20);                                   // they come back down, again and again
    // on a strip several balls are in the air at once, on 8 PARs no more than two
    const most = (where: Where[]) => Math.max(...times(0.5, 20, 0.25).map((t) => {
      const f = levels(frame('bouncing', where, t));
      return f.filter((v, i) => v > 0.6 && (i === 0 || f[i - 1] <= v) && (i === f.length - 1 || f[i + 1] < v)).length;
    }));
    expect(most(strip(60))).toBeGreaterThanOrEqual(3);
    expect(most(pars(8))).toBeLessThanOrEqual(2);
  });
  it('ripples: rings spread out from where a drop lands and fade', () => {
    // follow the brightest pixel's distance from where the first light showed up
    const f = times(0, 6, 0.025).map((t) => levels(frame('ripple', strip(60), t)));
    const start = f.findIndex((r) => Math.max(...r) > 0.3);
    const at = brightest(frame('ripple', strip(60), start * 0.025)), later = levels(frame('ripple', strip(60), start * 0.025 + 0.5));
    const lit = later.map((v, i) => (v > 0.05 ? Math.abs(i - at) : -1)).filter((d) => d >= 0);
    expect(Math.max(...lit)).toBeGreaterThanOrEqual(4);                 // the ring moved out, about 0.1 strip in 0.5 s
    expect(Math.max(...later)).toBeLessThan(1);
    expect(f.flat().filter((v) => v > 0.05).length / f.flat().length).toBeGreaterThan(0.1);
  });
  it('fireworks: a rocket climbs from the bottom, slowing down, then bursts into coloured sparks', () => {
    const rocket = (o: FxOut) => o.color!.r > 0.99 && o.color!.g > 0.6 && o.color!.b > 0.35 && o.color!.b < 0.85;   // warm white (embers add orange)
    const track: number[] = [];
    for (const t of times(0, 3, 0.05)) {
      const f = frame('fireworks', strip(80), t), i = brightest(f);
      if (lv(f[i]) > 0.4 && rocket(f[i])) track.push(i); else if (track.length) break;
    }
    expect(track.length).toBeGreaterThan(8);
    expect(track[0]).toBeLessThan(15);
    for (let k = 1; k < track.length; k++) expect(track[k]).toBeGreaterThanOrEqual(track[k - 1]);
    const n = track.length;
    expect(track[3] - track[0]).toBeGreaterThan(track[n - 1] - track[n - 4]);     // slower near the top
    let burst = 0;
    for (const t of times(0, 4, 0.05)) burst = Math.max(burst, levels(frame('fireworks', strip(80), t)).filter((v) => v > 0.2).length);
    expect(burst).toBeGreaterThan(8);
  });
  it('matrix rain: falls from the top, the head is the light end of the palette, the trail above it fades', () => {
    const pal = PALETTES.Matrix, head = pal[pal.length - 1];
    let seen = 0;
    for (const t of times(0.5, 6, 0.1)) {
      const f = frame('matrix', strip(60), t);
      f.forEach((o, i) => {
        if (lv(o) < 1 || !near(o.color!, { r: head.r / Math.max(head.r, head.g, head.b), g: 1, b: head.b / Math.max(head.r, head.g, head.b) })) return;
        seen++;
        if (i < 57) expect(lv(f[i + 3])).toBeLessThan(1);               // above the head: the fading trail
      });
    }
    expect(seen).toBeGreaterThan(10);
    // heads only move down: in the next frame every head is new at the top or a little lower than one before
    const heads = times(0, 6, 0.05).map((t) => frame('matrix', strip(60), t).map((o, i) => (lv(o) === 1 ? i : -1)).filter((i) => i >= 0));
    expect(heads.flat().length).toBeGreaterThan(20);
    for (let k = 1; k < heads.length; k++) for (const h of heads[k]) expect(h >= 57 || heads[k - 1].some((g) => g >= h && g - h <= 3)).toBe(true);
  });
  it('aurora: soft, slow and never jumps', () => {
    const f = times(0, 10, 0.025).map((t) => levels(frame('aurora', strip(60), t)));
    let worst = 0;
    for (let k = 1; k < f.length; k++) for (let i = 0; i < 60; i++) worst = Math.max(worst, Math.abs(f[k][i] - f[k - 1][i]));
    expect(worst).toBeLessThan(0.05);
    expect(Math.max(...f.flat())).toBeGreaterThan(0.4);
    const greens = times(0, 30, 0.5).flatMap((t) => frame('aurora', strip(30), t)).filter((o) => lv(o) > 0.2 && o.color!.g > 0.9 && o.color!.r < 0.3).length;
    expect(greens).toBeGreaterThan(50);                                  // green most of all
  });
  it('plasma: smooth along the strip, with dark gaps; size closes them', () => {
    const f = levels(frame('plasma', strip(60), 2));
    for (let i = 1; i < 60; i++) expect(Math.abs(f[i] - f[i - 1])).toBeLessThan(0.25);
    const dark = (size: number) => times(0, 10, 0.5).flatMap((t) => levels(frame('plasma', strip(60), t, { size }))).filter((v) => v < 0.05).length;
    expect(dark(0.5)).toBeGreaterThan(dark(1));
  });
  it('rainbow with glitter: always full, a rainbow along, white sparks popping', () => {
    let white = 0;
    for (const t of times(0, 3, 0.025)) {
      const f = frame('glitter', strip(60), t);
      expect(Math.min(...levels(f))).toBe(1);
      white += f.filter((o) => o.color!.r > 0.85 && o.color!.g > 0.85 && o.color!.b > 0.85).length;
    }
    expect(white).toBeGreaterThan(20);
    expect(white).toBeLessThan(400);
    expect(frame('glitter', strip(60), 0, { size: 0 }).every((o) => !(o.color!.r > 0.85 && o.color!.g > 0.85 && o.color!.b > 0.85))).toBe(true);
  });
  it('heartbeat: lub, then dub a third of a beat later, fading between; the middle leads', () => {
    const mid = (t: number) => levels(frame('heartbeat', strip(61), t))[30], edge = (t: number) => levels(frame('heartbeat', strip(61), t))[0];
    const T = 1.1;
    expect(mid(0)).toBe(1);
    expect(mid(T / 3 - 0.01)).toBeLessThan(0.5);
    expect(mid(T / 3 + 0.005)).toBeGreaterThan(0.75);                   // the second thump
    expect(mid(T - 0.01)).toBeLessThan(0.25);
    expect(mid(T + 0.001)).toBeCloseTo(1, 1);                          // and again
    expect(edge(0.12)).toBeGreaterThan(0.9);                             // the edges a little later
    expect(edge(0)).toBeLessThan(0.2);
  });
  it('dual scanner: the two eyes start at both ends and meet in the middle', () => {
    const at = (t: number) => frame('scanner', strip(61), t);
    const f = at(0);
    expect(lv(f[0])).toBe(1); expect(lv(f[60])).toBe(1);
    expect(f[0].color!.r).toBe(1); expect(f[60].color!.b).toBe(1);       // red one end, blue the other
    expect(lv(at(0.5)[30])).toBeGreaterThan(0.95);                       // a quarter round (4 beats at 120: 0.5 s)
  });
  it('meteor rain: a white head, the tail behind it breaking up, dark ahead', () => {
    const f = frame('meteorRain', strip(60), 0.9), i = brightest(f);
    expect(lv(f[i])).toBe(1); expect(near(f[i].color!, { r: 1, g: 1, b: 1 })).toBe(true);
    const behind = levels(f).slice(Math.max(0, i - 20), Math.max(0, i - 3));
    expect(Math.max(...behind)).toBeGreaterThan(0.05);
    const ahead = levels(f).slice(i + 4, Math.min(60, i + 12));
    expect(Math.max(0, ...ahead)).toBeLessThan(0.05);
    // the tail is uneven: not a smooth ramp
    let ups = 0;
    for (let k = 1; k < behind.length; k++) if (behind[k] < behind[k - 1]) ups++;
    expect(ups).toBeGreaterThan(1);
  });
  it('lightning: mostly dark; a dim leader first, then strikes over a stretch of the strip', () => {
    const f = times(0, 20, 0.01).map((t) => levels(frame('lightning1d', strip(60), t)));
    const on = f.filter((r) => Math.max(...r) > 0.05);
    expect(f.filter((r) => Math.max(...r) > 0.25).length / f.length).toBeLessThan(0.15);
    expect(on.length).toBeGreaterThan(10);
    const first = on[0];
    expect(Math.max(...first)).toBeLessThanOrEqual(0.2 + 1e-9);          // the leader
    const strike = f.find((r) => Math.max(...r) > 0.9)!;
    const idx = strike.map((v, i) => (v > 0.9 ? i : -1)).filter((i) => i >= 0);
    expect(idx.length).toBeGreaterThan(3);
    expect(idx[idx.length - 1] - idx[0] + 1).toBeLessThan(80);
  });
  it('rain drips: a drop swells at the top, falls faster and faster, splashes at the bottom', () => {
    const track: number[] = [];
    for (const t of times(0, 6, 0.05)) {
      const o = frame('rain', strip(100), t), f = levels(o), i = brightest(o);
      if (f[i] > 0.5 && i > 2 && i < 97) track.push(i); else if (track.length > 3) break; else track.length = 0;
    }
    expect(track.length).toBeGreaterThan(5);
    const steps = track.slice(1).map((v, k) => track[k] - v);
    expect(steps.every((s) => s >= 0)).toBe(true);                       // downwards
    expect(steps[steps.length - 1]).toBeGreaterThan(steps[0]);           // faster and faster
  });
  it('popcorn: kernels pop up from the bottom and come back down', () => {
    let low = 0, high = 0;
    for (const t of times(0, 12, 0.05)) levels(frame('popcorn', strip(60), t)).forEach((v, i) => { if (v > 0.5) { if (i < 10) low++; if (i > 40) high++; } });
    expect(low).toBeGreaterThan(20); expect(high).toBeGreaterThan(20);
  });
  it('gradient chase: three bands at full spread, each dark to bright, moving forward', () => {
    const peaks = (t: number) => {
      const f = levels(frame('gradientChase', strip(90), t));
      return f.map((v, i) => (v > 0.8 && (i === 89 || f[i + 1] < v) && (i === 0 || f[i - 1] <= v) ? i : -1)).filter((i) => i >= 0);
    };
    expect(peaks(0.3)).toHaveLength(3);
    peaks(0.3).forEach((i, k) => expect(peaks(0.35)[k]).toBeGreaterThan(i));     // each head a pixel or two on
  });
});

describe('pixel shows: where they run', () => {
  it('on a wall every strip is its own lane; a row of PARs is one lane along the row', () => {
    const w = levels(frame('bouncing', wall(4, 30), 6));
    const lanes = [0, 1, 2, 3].map((k) => w.slice(k * 30, k * 30 + 30).map((v) => v.toFixed(2)).join());
    expect(new Set(lanes).size).toBe(4);
    // matrix code on PARs moves along the row (last PAR first)
    const firstLit = (i: number) => times(0, 6, 0.05).findIndex((t) => levels(frame('matrix', pars(8), t))[i] > 0.9);
    expect(firstLit(7)).toBeGreaterThanOrEqual(0);
    expect(firstLit(7)).toBeLessThan(firstLit(0));
  });
  it('a show on a 30-pixel strip in the engine: every pixel its own colour, changing', () => {
    const s = emptyShow('px');
    s.fixtures = [{ id: 'st', name: 'Strip', typeId: 'gen-strip30', mode: '', universe: 0, address: 1, x: 0.5, y: 0.5 }];
    s.effects = [{ id: 'fw', name: 'Fire', kind: 'fire2012', fixtures: ['st'], params: {} }];
    let t = 0;
    const e = new Engine(() => s, () => t);
    e.startEffect('fw');
    const at = (sec: number) => { while (t < sec - 1e-9) { t = Math.min(sec, t + 0.025); e.tick(); } return e.tick().frames.get(0)!; };
    const a = [...at(1)].slice(0, 90), b = [...at(1.5)].slice(0, 90);
    expect(a.slice(0, 3).reduce((x, y) => x + y)).toBeGreaterThan(300);   // hot at the start of the strip
    expect(a.slice(84, 90).every((v) => v === 0)).toBe(true);              // dark at its end
    expect(a).not.toEqual(b);
  });
});
