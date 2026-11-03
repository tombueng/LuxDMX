import { describe, expect, it } from 'vitest';
import { pictureColors } from './pictureColors';

// A picture as pixels: `n` of each colour.
const pic = (...parts: [number, number, number, number][]) => parts.flatMap(([r, g, b, n]) => Array.from({ length: n }, () => [r, g, b, 255])).flat();

describe('colours from a picture', () => {
  it('finds the main colours, most used first, at full brightness', () => {
    const c = pictureColors(pic([200, 0, 0, 300], [0, 0, 100, 200], [0, 120, 0, 100]), 3);
    expect(c.map((x) => [x.r, x.g, x.b].map((v) => Math.round(v * 10) / 10))).toEqual([[1, 0, 0], [0, 0, 1], [0, 1, 0]]);
  });
  it('a grey wall counts less than a little colour; black counts not at all', () => {
    const c = pictureColors(pic([128, 128, 128, 400], [0, 0, 0, 400], [255, 0, 200, 60]), 2);
    expect(c[0].r).toBeCloseTo(1, 1); expect(c[0].g).toBeCloseTo(0, 1);
  });
  it('one colour stays one, an empty picture gives nothing', () => {
    expect(pictureColors(pic([255, 120, 0, 50]), 5)).toHaveLength(1);
    expect(pictureColors(pic([0, 0, 0, 50]), 5)).toEqual([]);
  });
});

describe('a poster with one big colour and small bright ones', () => {
  it('gives every distinct hue, not shades of the big one', () => {
    // mostly magenta/purple shades, a cyan band, an orange band, a yellow triangle
    const c = pictureColors(pic([230, 0, 200, 900], [140, 20, 255, 700], [200, 60, 255, 500], [0, 220, 240, 150], [255, 120, 0, 150], [255, 230, 0, 100]), 5);
    const hue = (x: { r: number; g: number; b: number }) => {
      const max = Math.max(x.r, x.g, x.b), min = Math.min(x.r, x.g, x.b), d = max - min;
      const h = max === x.r ? ((x.g - x.b) / d + 6) % 6 : max === x.g ? (x.b - x.r) / d + 2 : (x.r - x.g) / d + 4;
      return h * 60;
    };
    const hs = c.map(hue);
    expect(hs.some((h) => h > 170 && h < 200)).toBe(true);     // cyan
    expect(hs.some((h) => h > 20 && h < 40)).toBe(true);       // orange
    expect(hs.some((h) => h > 45 && h < 65)).toBe(true);       // yellow
  });
});
