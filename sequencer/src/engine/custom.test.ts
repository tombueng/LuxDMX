import { describe, expect, it } from 'vitest';
import { EFFECT_MAP, paramsOf, runEffect, type Where } from './effects';
import { CUSTOM_EFFECTS, PIC_CACHE, pictureCache, pictureOf, placeOf, samplePicture, sampleAt, timed, unpackPicture, type Picture } from './custom';
import { packPicture } from './gif';
import { Engine } from './engine';
import { emptyShow, serializeShow } from '../model/format';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import type { Show } from '../model/types';

const def = (id: string) => EFFECT_MAP.get(id)!;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
// what a light shows: its colour times its intensity, 0..255
const shown = (o: { intensity?: number; color?: { r: number; g: number; b: number } }) =>
  [o.color!.r, o.color!.g, o.color!.b].map((c) => Math.round(c * (o.intensity ?? 0) * 255));
const run = (kind: string, params: Record<string, unknown>, n: number, total: number, where?: Where[], clock?: { beats: number; secs: number }) =>
  runEffect(def(kind), paramsOf(kind, params), n, total, 1, where, clock);

// A picture from rows of colour letters (R G B W K=black Y=yellow), one string per row.
const RGB: Record<string, number[]> = { R: [255, 0, 0], G: [0, 255, 0], B: [0, 0, 255], W: [255, 255, 255], K: [0, 0, 0], Y: [255, 255, 0] };
const frame = (rows: string[]) => Uint8Array.from(rows.flatMap((r) => [...r].flatMap((ch) => RGB[ch])));
const pack = (frames: string[][], delays = frames.map(() => 100)) => packPicture(frames[0][0].length, frames[0].length, frames.map(frame), delays);

describe('the Formula effect', () => {
  it('is in the list, as a pixel show with a default that runs', () => {
    expect(CUSTOM_EFFECTS.map((d) => d.id)).toEqual(['formula', 'picture', 'script']);
    expect(def('formula').category).toBe('pixel');
    expect(paramsOf('formula').formula).toBe('hsv(x - c, 1, 1)');
    // the rainbow wave: red, green, blue along the lights at the start
    expect(run('formula', {}, 4, 0).map(shown)).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 0, 0]]);
  });
  it('a number is a brightness in the palette colour at x', () => {
    const outs = run('formula', { formula: 'x', colors: [{ r: 1, g: 0, b: 0 }, { r: 0, g: 0, b: 1 }] }, 5, 0);
    expect(outs.map((o) => r3(o.intensity!))).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(outs[0].color).toEqual({ r: 1, g: 0, b: 0 });
    expect(outs[2].color).toEqual({ r: 0, g: 0, b: 1 });          // halfway along a two-colour palette
  });
  it('a colour sets colour and brightness (a light with a dimmer and one without agree)', () => {
    const [o] = run('formula', { formula: 'rgb(0.5, 0.25, 0)' }, 1, 0);
    expect(o.intensity).toBe(0.5);
    expect(o.color).toEqual({ r: 1, g: 0.5, b: 0 });
    expect(shown(o)).toEqual([128, 64, 0]);
    expect(run('formula', { formula: 'rgb(0, 0, 0)' }, 1, 0)[0].intensity).toBe(0);
  });
  it('Dim to and Bright to set the range', () => {
    expect(run('formula', { formula: '0.5', low: 0.2, high: 0.6 }, 1, 0)[0].intensity).toBeCloseTo(0.4);
  });
  it('sees each pixel: its light, its place on it, the clock', () => {
    const where: Where[] = [{ u: 0, row: 0, rows: 2 }, { u: 1, row: 0, rows: 2 }, { u: 0, row: 1, rows: 2 }, { u: 1, row: 1, rows: 2 }];
    const v = (f: string) => run('formula', { formula: f }, 4, 0.25, where, { beats: 3, secs: 1.5 }).map((o) => r3(o.intensity!));
    expect(v('u')).toEqual([0, 1, 0, 1]);
    expect(v('row / 2 + u / 4')).toEqual([0, 0.25, 0.5, 0.75]);
    expect(v('i / 10 + n / 100')).toEqual([0.04, 0.14, 0.24, 0.34]);
    expect(v('rows / 10')).toEqual([0.2, 0.2, 0.2, 0.2]);
    expect(v('t / 10 + beat / 100')).toEqual([0.18, 0.18, 0.18, 0.18]);
    expect(v('c')).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(v('phase')).toEqual([0.25, 0, 0.75, 0.5]);              // spread 1 along the four
    expect(v('size / 2')).toEqual([0.5, 0.5, 0.5, 0.5]);
    const rnd = v('rnd');
    expect(new Set(rnd).size).toBe(4);
    expect(v('rnd')).toEqual(rnd);                                   // stays the same
    expect(runEffect(def('formula'), { ...paramsOf('formula', { formula: 'bass' }), sound: 0.6 }, 1, 0)[0].intensity).toBeCloseTo(0.6);
  });
  it('a formula that does not read is dark, never an error', () => {
    for (const f of ['sin(', '', 'nope', 'x # 1']) expect(run('formula', { formula: f }, 3, 0).every((o) => o.intensity === 0)).toBe(true);
  });
  it('values outside 0..1 and NaN are kept in range', () => {
    expect(run('formula', { formula: '5' }, 1, 0)[0].intensity).toBe(1);
    expect(run('formula', { formula: '-1' }, 1, 0)[0].intensity).toBe(0);
    expect(run('formula', { formula: 'sqrt(-1)' }, 1, 0)[0].intensity).toBe(0);
    expect(shown(run('formula', { formula: 'rgb(2, sqrt(-1), -1)' }, 1, 0)[0])).toEqual([255, 0, 0]);
  });
});

describe('the Picture effect', () => {
  // three columns, two rows
  const still = pack([['RGB', 'WKY']]);
  it('without a picture, it shows the sample (and it is all real numbers)', () => {
    const s = samplePicture();
    expect([s.w, s.h, s.frames.length]).toEqual([40, 30, 1]);
    for (let t = 0; t < 1; t += 0.013) for (const o of run('picture', {}, 60, t)) {
      expect(Number.isFinite(o.intensity)).toBe(true);
      expect(o.intensity).toBeGreaterThanOrEqual(0); expect(o.intensity).toBeLessThanOrEqual(1);
    }
  });
  it('line: the picture\'s columns along the lights, its rows scrolling by, one pass a round', () => {
    expect(run('picture', { picture: still }, 3, 0).map(shown)).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255]]);
    expect(run('picture', { picture: still }, 3, 0.5).map(shown)).toEqual([[255, 255, 255], [0, 0, 0], [255, 255, 0]]);
    // between rows it blends (a quarter: halfway from the first row to the second)
    expect(run('picture', { picture: still }, 3, 0.25).map(shown)).toEqual([[255, 128, 128], [0, 128, 0], [128, 128, 128]]);
    // and round again: the last row runs into the first
    expect(run('picture', { picture: still }, 3, 0.75).map(shown)).toEqual([[255, 128, 128], [0, 128, 0], [128, 128, 128]]);
    // more lights than columns: in between
    expect(run('picture', { picture: still }, 5, 0).map(shown)).toEqual([[255, 0, 0], [128, 128, 0], [0, 255, 0], [0, 128, 128], [0, 0, 255]]);
    // backward: mirrored
    expect(run('picture', { picture: still, direction: 'backward' }, 3, 0).map(shown)).toEqual([[0, 0, 255], [0, 255, 0], [255, 0, 0]]);
  });
  it('bounce: down the picture and back up', () => {
    expect(run('picture', { picture: still, direction: 'bounce' }, 3, 0.5).map(shown)).toEqual([[255, 255, 255], [0, 0, 0], [255, 255, 0]]);
    expect(run('picture', { picture: still, direction: 'bounce' }, 3, 0.9).map(shown)[0]).toEqual([255, 51, 51]);
  });
  it('an animation plays its frames by their own timing (on its middle row)', () => {
    const gif = pack([['KKK', 'RGB', 'KKK'], ['KKK', 'BBB', 'KKK']], [100, 300]);
    const pic = unpackPicture(gif);
    expect(pic.total).toBe(400);
    expect(run('picture', { picture: gif }, 3, 0.1).map(shown)).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255]]);   // 40 ms: frame 1
    expect(run('picture', { picture: gif }, 3, 0.3).map(shown)).toEqual([[0, 0, 255], [0, 0, 255], [0, 0, 255]]);   // 120 ms: frame 2
    expect(run('picture', { picture: gif }, 3, 1.1).map(shown)[0]).toEqual([255, 0, 0]);                              // round again
  });
  it('wall: one picture row per light, columns along each light', () => {
    const where: Where[] = [0, 1].flatMap((row) => [0, 0.5, 1].map((u) => ({ u, row, rows: 2 })));
    const outs = run('picture', { picture: still, mapping: 'wall' }, 6, 0.37, where).map(shown);
    expect(outs).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [0, 0, 0], [255, 255, 0]]);
    // auto picks the wall for several lights with pixels, the line for one strip or single lights
    expect(run('picture', { picture: still }, 6, 0, where).map(shown)).toEqual(outs);
    const pars: Where[] = [0, 1, 2].map((row) => ({ u: 0.5, row, rows: 3 }));
    expect(run('picture', { picture: still }, 3, 0, pars).map(shown)).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255]]);
    expect(run('picture', { picture: still, mapping: 'line' }, 6, 0, where).map(shown)[5]).toEqual([0, 0, 255]);
  });
  it('a damaged picture is dark; it is unpacked once', () => {
    expect(run('picture', { picture: 'pic1:2x2:0:AAAA' }, 2, 0).every((o) => o.intensity === 0)).toBe(true);
    const p = paramsOf('picture', { picture: still });
    const pic = (s: string): Picture => unpackPicture(s);
    expect(pic(still).w).toBe(3);
    const a = placeOf(timed(3, 2, [frame(['RGB', 'WKY'])], [0]), { x: 0.5, u: 0.5, row: 0, rows: 1, m: 3, total: 0.5 }, p);
    expect(a).toEqual({ f: 0, cx: 1, cy: 1, wrap: true });
  });
});

describe('in the engine, on the wire', () => {
  function strip(kind: string, params: Record<string, unknown>): Show {
    const s = emptyShow('custom');
    s.fixtures = [{ id: 's', name: 'Strip', typeId: 'gen-strip30', mode: '', universe: 0, address: 1, x: 0.5, y: 0.5 }];
    s.effects = [{ id: 'fx', name: 'Mine', kind, fixtures: ['s'], params }];
    return s;
  }
  const engineFor = (s: Show) => {
    let t = 0;
    const e = new Engine(() => s, () => t);
    const at = (sec: number) => { while (t < sec - 1e-9) { t = Math.min(sec, t + 0.025); e.tick(); } return e.tick(); };
    return { e, at };
  };
  it('a formula: exact channels along a 30-pixel strip', () => {
    const { e, at } = engineFor(strip('formula', { formula: 'rgb(x, 0, 1 - x)' }));
    e.startEffect('fx');
    const buf = at(1).frames.get(0)!;
    for (let k = 0; k < 30; k++) expect([buf[k * 3], buf[k * 3 + 1], buf[k * 3 + 2]], `pixel ${k}`).toEqual([Math.round(k / 29 * 255), 0, Math.round((1 - k / 29) * 255)]);
  });
  it('a picture: the rows go by on the strip, at the speed', () => {
    const cols = 'RGBWY'.repeat(6);
    const { e, at } = engineFor(strip('picture', { picture: pack([[cols, 'K'.repeat(30)]]), speed: 8, tempo: false }));
    e.startEffect('fx');
    // (it runs from the first frame after the start: 25 ms later)
    let buf = at(0.5).frames.get(0)!;           // 0.475 s in: the first row, moving on to the second
    expect([buf[0], buf[1], buf[2]]).toEqual([225, 0, 0]);
    buf = at(4.025).frames.get(0)!;             // half a round: the second row (black)
    expect(Math.max(...buf.slice(0, 90))).toBe(0);
    buf = at(8.025).frames.get(0)!;             // a whole round: the first row again
    expect([...buf.slice(0, 15)]).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 0]);
  });
});

// A different animation for each seed: w x h, `n` frames of noise (packs badly, like a real video).
function noisy(seed: number, w = 40, h = 30, n = 8) {
  let s = seed;
  const frames = Array.from({ length: n }, () => Uint8Array.from({ length: w * h * 3 }, () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 16) & 255; }));
  return packPicture(w, h, frames, Array(n).fill(50));
}
describe('the picture cache', () => {
  it("a show's pictures are unpacked once, not again every frame (twelve running at once)", () => {
    const packed = Array.from({ length: 12 }, (_, k) => noisy(k + 1, 80, 60, 32));
    const first = packed.map((pic) => pictureOf(paramsOf('picture', { picture: pic })));
    expect(first.every((p) => p && p.frames.length === 32)).toBe(true);
    const t0 = performance.now();
    // every frame makes fresh params for every effect: the cache is by the picture itself
    for (let frame = 0; frame < 10; frame++) for (let i = 0; i < 12; i++) expect(pictureOf(paramsOf('picture', { picture: packed[i] }))).toBe(first[i]);
    const ms = (performance.now() - t0) / 10;
    console.log(`12 pictures: ${ms.toFixed(3)} ms of lookups a frame; ${(pictureCache().bytes / 1e6).toFixed(1)} MB kept`);
    expect(ms).toBeLessThan(2);
  });
  it('keeps at most its budget: the picture used longest ago goes first, never the one just made', () => {
    const was = PIC_CACHE.bytes;
    const [a, b, c, d, e] = Array.from({ length: 5 }, (_, k) => noisy(100 + k));
    const one = a.length + 40 * 30 * 3 * 8;
    try {
      PIC_CACHE.bytes = Math.floor(3.5 * one);                 // room for three
      const get = (x: string) => pictureOf(paramsOf('picture', { picture: x }));
      const pa = get(a), pb = get(b), pc = get(c);
      expect(pictureCache().bytes).toBeLessThanOrEqual(PIC_CACHE.bytes);
      expect(get(a)).toBe(pa);                                   // used: now the newest
      get(d);                                                    // b was used longest ago: it goes
      expect(get(a)).toBe(pa);
      expect(get(c)).toBe(pc);
      expect(get(b)).not.toBe(pb);                               // unpacked again (and the same picture)
      expect(get(b)!.frames[3]).toEqual(pb!.frames[3]);
      expect(pictureCache().bytes).toBeLessThanOrEqual(PIC_CACHE.bytes);
      PIC_CACHE.bytes = 1;                                       // too small for even one: the new one still shows
      expect(get(e)!.frames.length).toBe(8);
      expect(pictureCache().count).toBe(1);
    } finally { PIC_CACHE.bytes = was; }
  });
  it('a picture read at a place that is not a number shows its first pixel, never throws', () => {
    const pic = unpackPicture(pack([['RGB', 'KKK']]));
    for (const [cx, cy] of [[NaN, 0], [0, NaN], [Infinity, -Infinity], [-1e300, 1e300]]) {
      for (const wrap of [true, false]) expect(sampleAt(pic, NaN, cx, cy, wrap, [0, 0, 0]).every((v) => v >= 0 && v <= 1)).toBe(true);
    }
    expect(sampleAt(pic, 0, NaN, NaN, true, [0, 0, 0])).toEqual([1, 0, 0]);
  });
});

describe('in the show file', () => {
  it('a show with a formula and a picture passes the schema; one that is not packed right does not', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(fs.readFileSync('schema/luxdmx-show.schema.json', 'utf8')));
    const s = emptyShow('custom');
    s.effects = [
      { id: 'a', name: 'Mine', kind: 'formula', fixtures: [], params: { formula: 'hsv(x - c, 1, 1)' } },
      { id: 'b', name: 'Sunset', kind: 'picture', fixtures: [], params: { picture: pack([['RGB']]), mapping: 'wall' } },
    ];
    expect(validate(JSON.parse(serializeShow(s))), JSON.stringify(validate.errors)).toBe(true);
    s.effects[1].params = { picture: 'data:image/png;base64,AAAA', mapping: 'sideways' };
    expect(validate(JSON.parse(serializeShow(s)))).toBe(false);
    expect(validate.errors!.length).toBe(2);
  });
});

describe('speed', () => {
  it('a formula and a picture on 600 pixels cost little per frame', () => {
    const where: Where[] = Array.from({ length: 600 }, (_, i) => ({ u: (i % 60) / 59, row: Math.floor(i / 60), rows: 10 }));
    const gif = pack(Array.from({ length: 16 }, (_, f) => Array.from({ length: 40 }, (_, y) => Array.from({ length: 60 }, (_, x) => 'RGBWYK'[(x + y + f) % 6]).join(''))), Array(16).fill(50));
    const cases: [string, Record<string, unknown>][] = [['formula', { formula: 'hsv(wave(x + c) + 0.5 * wave(x * 2.3 - c * 1.7 + row * 0.3), 1, 0.6 + 0.4 * wave(x * 3 - c))' }], ['picture', { picture: gif }]];
    for (const [kind, params] of cases) {
      for (let k = 0; k < 20; k++) runEffect(def(kind), paramsOf(kind, params), 600, k / 40, 1, where);
      const t0 = performance.now();
      for (let k = 0; k < 200; k++) runEffect(def(kind), paramsOf(kind, params), 600, k / 40, 1, where);
      const ms = (performance.now() - t0) / 200;
      console.log(`${kind}: ${ms.toFixed(3)} ms per frame for 600 pixels`);
      expect(ms).toBeLessThan(2);
    }
  });
});

describe('a picture on a ring or a matrix', () => {
  it('each LED shows the picture where it is: the left half red, the right half blue', async () => {
    const { EFFECT_MAP, paramsOf, runEffect } = await import('./effects');
    const { packPicture } = await import('./gif');
    const { placesFor } = await import('../model/pixelLayout');
    // 4 x 2: red on the left, blue on the right
    const px = new Uint8Array(4 * 2 * 3);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) { const o = (y * 4 + x) * 3; if (x < 2) px[o] = 255; else px[o + 2] = 255; }
    const p = paramsOf('picture', { picture: packPicture(4, 2, [px], [0]) });
    const at = placesFor({ kind: 'matrix', cols: 8, rows: 8 });
    const where = Array.from({ length: at.n }, (_, i) => ({ u: 0.5, row: 0, rows: 1, at, cell: i }));
    const out = runEffect(EFFECT_MAP.get('picture')!, p, at.n, 0.3, 1, where);
    // (the picture's middle square: the two middle columns, red then blue)
    for (let i = 0; i < at.n; i++) {
      const c = out[i].color!;
      if (at.gx[i] <= 1) expect(c.r, `LED ${i}`).toBeGreaterThan(0.9);
      if (at.gx[i] >= 6) expect(c.b, `LED ${i}`).toBeGreaterThan(0.9);
    }
  });
});

describe('an add-on from a show file someone sent (the review)', () => {
  const run = async (script: unknown, vals: unknown = {}, n = 4) => {
    const { EFFECT_MAP, paramsOf, runEffect } = await import('./effects');
    const p = paramsOf('script', { script: JSON.stringify(script), vals });
    return runEffect(EFFECT_MAP.get('script')!, p, n, 0.5, 1);
  };
  it('a knob named __proto__ or toString: the effect doesn\'t run, and nothing every object has is touched', async () => {
    for (const id of ['__proto__', 'toString', 'constructor', 'hasOwnProperty', 'valueOf']) {
      const out = await run({ pixel: '1', params: [{ id, type: 'colour' }] });
      expect(out.every((o) => (o.intensity ?? 0) === 0), id).toBe(true);
    }
    expect(([] as unknown as Record<number, unknown>)[0]).toBeUndefined();
    expect(Object.keys(Object.prototype)).toEqual([]);
    // a value given for a knob it doesn't have stays out
    const out = await run({ pixel: 'glow', params: [{ id: 'glow', type: 'number', default: 0.5 }] }, JSON.parse('{"__proto__": {"glow": 1}, "toString": 1}'));
    expect(out[0].intensity).toBeCloseTo(0.5, 6);
  });
  it('one that takes too long is stopped, and rests a while instead of eating every frame', async () => {
    const { EFFECT_MAP, paramsOf, runEffect } = await import('./effects');
    const heavy = { pixel: 'sum(k, 64, fbm(k, x) + fbm(x, k) + fbm(k * 2, x * 3) + fbm(x * 5, k))', params: [] };
    const p = paramsOf('script', { script: JSON.stringify(heavy) });
    const def = EFFECT_MAP.get('script')!, where = Array.from({ length: 4000 }, (_, i) => ({ u: i / 3999, row: 0, rows: 1 }));
    expect(() => runEffect(def, p, 4000, 0.1, 1, where)).toThrow(/takes too long/);
    // the next frames: refused at once, not worked out again
    const t0 = performance.now();
    expect(() => runEffect(def, paramsOf('script', { script: JSON.stringify(heavy) }), 4000, 0.2, 1, where)).toThrow(/rests/);
    expect(performance.now() - t0).toBeLessThan(20);
  });
  it('per light: two rings of different sizes in one effect each count their own LEDs', async () => {
    const { EFFECT_MAP, paramsOf, runEffect } = await import('./effects');
    const { placesFor } = await import('../model/pixelLayout');
    const a = placesFor({ kind: 'rings', rings: [12] }), b = placesFor({ kind: 'rings', rings: [24] });
    const where = [...Array.from({ length: 12 }, (_, i) => ({ u: 0.5, row: 0, rows: 2, at: a, cell: i })), ...Array.from({ length: 24 }, (_, i) => ({ u: 0.5, row: 1, rows: 2, at: b, cell: i }))];
    const p = paramsOf('script', { script: JSON.stringify({ pixel: 'cell / (cells - 1)', params: [] }) });
    const out = runEffect(EFFECT_MAP.get('script')!, p, 36, 0.3, 1, where);
    expect(out[11].intensity).toBeCloseTo(1, 6);          // the last of the 12
    expect(out[12 + 11].intensity).toBeCloseTo(11 / 23, 6); // the 12th of the 24
  });
  it('a plain formula knows where an LED is on a ring', async () => {
    const { EFFECT_MAP, paramsOf, runEffect } = await import('./effects');
    const { placesFor } = await import('../model/pixelLayout');
    const at = placesFor({ kind: 'rings', rings: [16, 1] });
    const where = Array.from({ length: at.n }, (_, i) => ({ u: 0.5, row: 0, rows: 1, at, cell: i }));
    const out = runEffect(EFFECT_MAP.get('formula')!, paramsOf('formula', { formula: 'rad' }), at.n, 0.3, 1, where);
    expect(out[0].intensity).toBeCloseTo(1, 6);           // the rim
    expect(out[16].intensity).toBeCloseTo(0, 6);          // the middle
  });
});

describe('the second review', () => {
  it('a picture on a 32 x 8 panel: the whole width of a wide picture, not a square out of its middle', async () => {
    const { placesFor, shapeW, shapeH } = await import('../model/pixelLayout');
    const { placeOf, timed } = await import('./custom');
    const { paramsOf } = await import('./effects');
    const pic = timed(155, 35, [new Uint8Array(155 * 35 * 3)], [0]);
    const at = placesFor({ kind: 'matrix', cols: 32, rows: 8 });
    const p = paramsOf('picture', {});
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < at.n; i++) {
      const o = placeOf(pic, { x: 0, u: 0, row: 0, rows: 1, m: at.n, total: 0, sx: at.x[i], sy: at.y[i], onShape: true, sw: shapeW(at), sh: shapeH(at) }, p);
      xs.push(o.cx); ys.push(o.cy);
    }
    // 155 x 35 is 31:7 like the panel's LEDs: all of it, edge to edge (a square crop showed its middle 35 x 35)
    expect(Math.min(...xs)).toBeCloseTo(0, 4); expect(Math.max(...xs)).toBeCloseTo(154, 4);
    expect(Math.min(...ys)).toBeCloseTo(0, 4); expect(Math.max(...ys)).toBeCloseTo(34, 4);
    // a square picture on it: its full width, a band out of its middle
    const sq = timed(64, 64, [new Uint8Array(64 * 64 * 3)], [0]);
    const ys2 = Array.from({ length: at.n }, (_, i) => placeOf(sq, { x: 0, u: 0, row: 0, rows: 1, m: at.n, total: 0, sx: at.x[i], sy: at.y[i], onShape: true, sw: shapeW(at), sh: shapeH(at) }, p).cy);
    expect(Math.max(...ys2) - Math.min(...ys2)).toBeCloseTo(64 * 7 / 31 - 1, 3);
  });
  it('one too slow on a dozen lights is still caught', async () => {
    const { EFFECT_MAP, paramsOf, runEffect } = await import('./effects');
    const slow = { pixel: 'sum(k, 64, fbm(k, x) + fbm(x, k) + fbm(k * 2, x * 3) + fbm(x * 5, k) + fbm(k * 7, x * 9) + fbm(x * 11, k * 13))', params: [] };
    const def = EFFECT_MAP.get('script')!;
    let caught = false;
    for (let f = 0; f < 40 && !caught; f++) {
      try { runEffect(def, paramsOf('script', { script: JSON.stringify(slow) }), 12, f / 10, 1); } catch (e) { caught = /takes too long/.test(String(e)); }
    }
    // (on a fast machine 12 LEDs of this may stay under 30 ms: then there was nothing to catch)
    const t0 = performance.now();
    try { runEffect(def, paramsOf('script', { script: JSON.stringify(slow) }), 12, 9, 1); } catch { /* resting */ }
    expect(caught || performance.now() - t0 < 30).toBe(true);
  });
  it('a preview that\'s too slow rests on its own: the show\'s effect goes on', async () => {
    const { EFFECT_MAP, paramsOf, runEffect } = await import('./effects');
    // (not the same text as the test above: that one's still resting)
    const heavy = { pixel: 'sum(k, 64, fbm(k, x) + fbm(x, k) + fbm(k * 2, x * 3) + fbm(x * 5, k)) * 0.5', params: [] };
    const def = EFFECT_MAP.get('script')!, script = JSON.stringify(heavy);
    const big = Array.from({ length: 4000 }, (_, i) => ({ u: i / 3999, row: 0, rows: 1 }));
    expect(() => runEffect(def, { ...paramsOf('script', { script }), look: true }, 4000, 0.1, 1, big)).toThrow(/takes too long/);
    // the show, on four LEDs: runs
    expect(runEffect(def, paramsOf('script', { script }), 4, 0.2, 1)).toHaveLength(4);
  });
});
