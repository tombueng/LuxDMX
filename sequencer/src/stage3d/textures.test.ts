// The band's name on a banner: it fills its box on one line, or on two when that's bigger, and it
// never runs past the box's sides or its top and bottom, whatever the name.
import { describe, expect, it } from 'vitest';
import { nameLayout } from './textures';

// a bold font: about 0.62 of the size a letter, a space narrower
const measure = (s: string, px: number) => [...s].reduce((a, c) => a + (c === ' ' ? 0.28 : 0.62), 0) * px;

describe('the band name on a banner', () => {
  it('a short name: one line, as big as the box allows', () => {
    const { lines, px } = nameLayout('DOGS', measure, 2400, 900);
    expect(lines).toEqual(['DOGS']);
    expect(px).toBe(Math.floor(900 / 1.08));                     // the height decides
    expect(measure('DOGS', px)).toBeLessThanOrEqual(2400);
    // a narrower box: the width decides
    expect(nameLayout('DOGS', measure, 1000, 900).px).toBe(Math.floor(1000 / (4 * 0.62)));
  });
  it('a longer name on a wide box stays on one line; on a tall one it goes on two, split evenly', () => {
    expect(nameLayout('THE RUSTY NAILS', measure, 4000, 300).lines).toEqual(['THE RUSTY NAILS']);
    const two = nameLayout('THE RUSTY NAILS', measure, 1600, 1100);
    expect(two.lines).toEqual(['THE RUSTY', 'NAILS']);
    expect(nameLayout('ALPHA BETA GAMMA DELTA', measure, 1200, 1000).lines).toEqual(['ALPHA BETA', 'GAMMA DELTA']);
  });
  it('whatever the name and the box: never wider or taller than the box, at least 1 px', () => {
    const names = ['A', 'WE ARE NOT THE BAND', 'Supercalifragilisticexpialidocious', 'The Incredibly Long Named Pub Rock Collective Of Upper Wherever', '  spaced   out  ', 'X Y'];
    for (const n of names) for (const [w, h] of [[2048, 900], [2048, 1229], [1024, 576], [150, 110], [4096, 160], [30, 400]]) {
      const { lines, px } = nameLayout(n, measure, w, h);
      expect(lines.length, n).toBeGreaterThanOrEqual(1); expect(lines.length).toBeLessThanOrEqual(2);
      expect(lines.join(' '), n).toBe(n.trim().split(/\s+/).join(' '));
      expect(px).toBeGreaterThanOrEqual(1);
      if (px > 1) for (const l of lines) expect(measure(l, px), `${n} in ${w} x ${h}`).toBeLessThanOrEqual(w + 1e-6);
      if (px > 1) expect(lines.length * px * 1.08).toBeLessThanOrEqual(h + 1e-6);
    }
  });
  it('nothing to lay out: no lines', () => {
    expect(nameLayout('   ', measure, 100, 100)).toEqual({ lines: [], px: 0 });
    expect(nameLayout('A', measure, 0, 100)).toEqual({ lines: [], px: 0 });
  });
});
