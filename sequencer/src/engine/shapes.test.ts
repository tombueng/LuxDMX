// The effects for rings and matrices: they run on every shape and on anything else, stay in range,
// move, the stories start and end dark, and the words come out letter by letter.
import { describe, expect, it } from 'vitest';
import { EFFECTS, EFFECT_MAP, paramsOf, runEffect, type Where } from './effects';
import { textColumns } from './shapes';
import { Engine } from './engine';
import { emptyShow } from '../model/format';
import { placesFor, type Places } from '../model/pixelLayout';
import type { PixelLayout } from '../model/types';

const SHAPES = EFFECTS.filter((d) => d.shape);
const on = (l: PixelLayout): Where[] => { const at = placesFor(l); return Array.from({ length: at.n }, (_, i) => ({ u: i / (at.n - 1), row: 0, rows: 1, at, cell: i })); };
const LAYOUTS: Record<string, Where[]> = {
  disc: on({ kind: 'rings', rings: [60, 48, 40, 32, 24, 16, 12, 8, 1] }), small: on({ kind: 'rings', rings: [24, 16, 12, 8, 1] }), ring: on({ kind: 'rings', rings: [24] }),
  matrix: on({ kind: 'matrix', cols: 16, rows: 16, zigzag: true }), banner: on({ kind: 'matrix', cols: 32, rows: 8, zigzag: true, vertical: true }),
  strip: Array.from({ length: 60 }, (_, i) => ({ u: i / 59, row: 0, rows: 1 })), pars: Array.from({ length: 8 }, (_, i) => ({ u: 0.5, row: i, rows: 8 })),
};
const frameAt = (id: string, where: Where[], secs: number) => {
  const p = paramsOf(id), beats = secs * 2;
  return runEffect(EFFECT_MAP.get(id)!, { ...p, sound: 0 }, where.length, (p.tempo ? beats : secs) / p.speed, 1, where, { beats, secs });
};
const lit = (fr: ReturnType<typeof frameAt>) => fr.reduce((a, o) => a + (o.intensity ?? 0), 0);

it('there are plenty, each with a name and a blurb in plain words', () => {
  expect(SHAPES.length).toBeGreaterThanOrEqual(20);
  expect(new Set(EFFECTS.map((d) => d.id)).size).toBe(EFFECTS.length);
  for (const d of SHAPES) { expect(d.category).toBe('pixel'); expect(d.name.length).toBeGreaterThan(2); expect(d.blurb.length).toBeGreaterThan(20); expect(d.blurb).not.toMatch(/—/); }
});

describe.each(SHAPES.map((d) => d.id))('%s', (id) => {
  it.each(Object.keys(LAYOUTS))('on a %s: in range, never NaN', (name) => {
    const where = LAYOUTS[name];
    for (const secs of [0, 0.3, 1.7, 4.1, 9.3, 17.7, 21.2, 29.9, 73, 500.5, 1e5]) {
      for (const o of frameAt(id, where, secs)) {
        expect(o.intensity, `${secs}`).toBeGreaterThanOrEqual(0); expect(o.intensity!).toBeLessThanOrEqual(1);
        for (const v of [o.color!.r, o.color!.g, o.color!.b]) { expect(v, `${secs}`).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      }
    }
  });
  it('lights up and changes over time on a disc and a matrix', () => {
    for (const name of ['disc', 'matrix']) {
      const frames = [2, 5, 9, 12.5, 18.5].map((s) => frameAt(id, LAYOUTS[name], s));
      expect(Math.max(...frames.map(lit)), name).toBeGreaterThan(1);
      const seen = new Set(frames.map((f) => f.map((o) => Math.round((o.intensity ?? 0) * 50)).join()));
      expect(seen.size, name).toBeGreaterThan(1);
    }
  });
});

describe('the stories start and end dark', () => {
  it.each([['eye', 30], ['reactor', 25], ['radar', 26]])('%s', (id, secs) => {
    expect(lit(frameAt(id as string, LAYOUTS.disc, secs as number - 0.001))).toBeLessThan(2);
  });
  it('supernova starts as a small dim star', () => {
    expect(lit(frameAt('supernova', LAYOUTS.disc, 0.05))).toBeLessThan(2);
  });
});

it('the eye is a picture: at its widest the pupil is dark and the white round it is lit', () => {
  const where = LAYOUTS.disc, at = where[0].at as Places, fr = frameAt('eye', where, 9.8);     // wide open, looking ahead
  const centre = where.findIndex((_, i) => at.rad[i] === 0);
  expect(fr[centre].intensity).toBeLessThan(0.05);
  const bright = fr.filter((_, i) => Math.abs(at.y[i]) < 0.3 && Math.abs(at.x[i]) > 0.3 && Math.abs(at.x[i]) < 0.6);
  expect(Math.max(...bright.map((o) => o.intensity!))).toBeGreaterThan(0.3);
});
it('a black hole has nothing coming out of its middle', () => {
  const where = LAYOUTS.disc, at = where[0].at as Places;
  for (const s of [3, 8, 20]) frameAt('blackHole', where, s).forEach((o, i) => { if (at.rad[i] < 0.13) expect(o.intensity).toBe(0); });
});
it('campfire burns from the bottom up, whatever order the LEDs are wired in', () => {
  const where = on({ kind: 'matrix', cols: 16, rows: 16, zigzag: true, vertical: true, from: 'br' }), at = where[0].at as Places;
  let low = 0, high = 0;
  frameAt('campfire', where, 4).forEach((o, i) => { if (at.gy[i] < 4) low += o.intensity!; else if (at.gy[i] > 11) high += o.intensity!; });
  expect(low).toBeGreaterThan(high * 3);
});
it('wiring test: a colour per ring, the first LED white, a dot walking in data order', () => {
  const where = LAYOUTS.small, fr = frameAt('wiringTest', where, 1);    // 12 LEDs a second: at the 13th
  expect(fr[12].color).toEqual({ r: 1, g: 1, b: 1 }); expect(fr[12].intensity).toBe(1);
  expect(Math.min(fr[0].color!.r, fr[0].color!.g, fr[0].color!.b)).toBeGreaterThan(0.6); expect(fr[0].intensity).toBeGreaterThan(0.5);
  expect(fr[30].intensity).toBeCloseTo(0.22, 2);
  expect(fr[30].color).not.toEqual(fr[50].color);
});
describe('the words', () => {
  it('capitals, numbers, no accents', () => {
    expect([...textColumns('L')]).toEqual([0x7f, 0x40, 0x40, 0x40, 0x40, 0]);
    expect(textColumns('l')).toEqual(textColumns('L'));
    expect(textColumns('Ä')).toEqual(textColumns('A'));
    expect([...textColumns('☃')]).toEqual([0, 0, 0, 0, 0, 0]);           // what it hasn't: a gap
  });
  it('come in from the right and spell it out on an 8-row matrix', () => {
    const where = on({ kind: 'matrix', cols: 32, rows: 8, zigzag: true, vertical: true }), at = where[0].at as Places;
    const p = paramsOf('scrollText', { text: 'L' });
    // after 32 columns (14 a second) the L has reached the left edge
    const fr = runEffect(EFFECT_MAP.get('scrollText')!, p, where.length, 32 / 14 + 0.001, 1, where, { beats: 0, secs: 0 });
    const onAt = (x: number, down: number) => fr[where.findIndex((_, i) => at.gx[i] === x && at.gy[i] === 7 - down)].intensity;
    expect(onAt(0, 0)).toBe(1); expect(onAt(0, 6)).toBe(1); expect(onAt(1, 6)).toBe(1); expect(onAt(4, 6)).toBe(1);
    expect(onAt(1, 0)).toBe(0); expect(onAt(5, 6)).toBe(0); expect(onAt(0, 7)).toBe(0);
  });
  it('a long text is cut, an empty one says the name', () => {
    expect(paramsOf('scrollText', { text: 'x'.repeat(999) }).text).toHaveLength(200);
    const fr = runEffect(EFFECT_MAP.get('scrollText')!, paramsOf('scrollText', { text: '' }), LAYOUTS.banner.length, 2.6, 1, LAYOUTS.banner, { beats: 0, secs: 0 });
    expect(lit(fr)).toBeGreaterThan(5);
  });
});

describe('a light too big for one universe', () => {
  it('runs on over the next universe with whole pixels, and leaves the others alone', () => {
    const s = emptyShow('t');
    s.fixtures.push({ id: 'd', name: 'Disc', typeId: 'gen-disc241', mode: '723 ch', universe: 10, address: 1, x: 0.5, y: 0.5 });
    s.effects.push({ id: 'e', name: 'Test', kind: 'wiringTest', fixtures: ['d'], params: {} });
    let t = 0;
    const en = new Engine(() => s, () => t);
    en.startEffect('e');
    en.tick();                                 // (its clock starts here)
    while (t < 2.02) { t += 0.05; en.tick(); } // 24 LEDs on: the dot is on the 25th
    const f = en.tick().frames;
    expect([...f.keys()].sort()).toEqual([10, 11]);
    expect(f.get(10)!.length).toBe(512); expect(f.get(11)!.length).toBe(512);
    expect([...f.get(10)!.slice(72, 75)]).toEqual([255, 255, 255]);
    // pixel 170 is the first on the next universe (the second ring: the 241st LED is the middle)
    const second = (i: number) => [...f.get(11)!.slice((i - 170) * 3, (i - 170) * 3 + 3)];
    expect(second(170).some((v) => v > 0)).toBe(true);
    expect(second(240).some((v) => v > 0)).toBe(true);
    expect(f.get(11)!.slice(213).every((v) => v === 0)).toBe(true);    // nothing after its last channel
    expect(f.get(10)!.slice(510).every((v) => v === 0)).toBe(true);    // whole pixels: 510 and 511 stay free
  });
});
