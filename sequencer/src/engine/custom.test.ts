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
    expect(CUSTOM_EFFECTS.map((d) => d.id)).toEqual(['formula', 'picture']);
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
