import { describe, expect, it } from 'vitest';
import { ATLAS_CELLS, GOBOS, PLAIN_WHEEL, wheelPatterns } from './gobos';

const id = (labels: string[]) => wheelPatterns(labels).map((i) => (i === null ? 'open' : GOBOS[i].id));

describe('gobos from a wheel\'s slot names', () => {
  it('fit in the atlas, each drawn or a symbol', () => {
    expect(GOBOS.length).toBeGreaterThanOrEqual(80);
    expect(GOBOS.length).toBeLessThanOrEqual(ATLAS_CELLS * ATLAS_CELLS);
    for (const g of GOBOS) expect(!!g.draw !== !!g.glyph, g.id).toBe(true);
    expect(new Set(GOBOS.map((g) => g.id)).size).toBe(GOBOS.length);
  });
  it('reads English and German names, the specific ones before the general', () => {
    expect(id(['Open', 'Stars', 'Sterne', 'Star', 'Flower', 'Blume', 'Punkte', 'Dots'])).toEqual(['open', 'stars', 'stars', 'star', 'flower', 'flower', 'dots', 'dots']);
    expect(id(['Ring of dots', 'Dot rings', 'Ring', 'Rings', 'Sunburst', 'Sun', 'Sunflower', 'Star of David', 'Shooting star', 'Crescent star', 'Moon'])).toEqual(
      ['dotring', 'dotrings', 'ring', 'tunnel', 'sunburst', 'sun', 'sunflower', 'davidstar', 'comet', 'crescentstar', 'moon']);
    expect(id(['Crosshair', 'Maltese cross', 'Cross', 'Heart outline', 'Herz', 'Eisblume', 'Schneeflocke', 'Diamond mesh', 'Grid', 'Ship wheel', 'Gear'])).toEqual(
      ['crosslines', 'maltese', 'cross', 'heartoutline', 'heart', 'snowflake3', 'snowflake', 'net', 'grid', 'dharma', 'gear']);
    expect(id(['Breakup 2', 'Leaves', 'Blätter', 'Wasser', 'Feuer', 'Streifen', 'Spirale', 'Tunnel', 'Galaxy', 'Rain'])).toEqual(
      ['breakup', 'leaves', 'leaves', 'water', 'fire', 'lines', 'spiral', 'tunnel', 'galaxy', 'finelines']);
  });
  it('names inside a longer label count, numbers and brackets don\'t get in the way', () => {
    expect(id(['Gobo 3 (Flower)', 'G4_stars', 'gobo-5-dots', '8: Triangle'])).toEqual(['flower', 'stars', 'dots', 'triangle']);
  });
  it('slots that say nothing get patterns of their own, never one already on the wheel', () => {
    const w = id(['Open', 'Gobo 1', 'Gobo 2', 'Gobo 3', 'Star', 'Gobo 5']);
    expect(w[0]).toBe('open');
    expect(w[4]).toBe('star');
    expect(new Set(w.slice(1)).size).toBe(5);                     // all different
    expect(w.filter((x) => x === 'star').length).toBe(1);         // (the unnamed ones skip the star)
    // the same names give the same patterns every time
    expect(id(['Gobo 1', 'Gobo 2'])).toEqual(id(['Gobo 1', 'Gobo 2']));
  });
  it('blank, white, none and "kein Gobo" are open', () => {
    expect(id(['', 'White', 'None', 'kein Gobo', 'Offen', 'Blank'])).toEqual(['open', 'open', 'open', 'open', 'open', 'open']);
  });
  it('a wheel with no names has a spread of patterns', () => {
    expect(new Set(PLAIN_WHEEL).size).toBe(PLAIN_WHEEL.length);
    expect(PLAIN_WHEEL.every((i) => i >= 0)).toBe(true);
  });
});

import { rotationOf } from './gobos';
describe('gobo rotation, as the channel\'s ranges say', () => {
  const R = [
    { from: 0, to: 63, label: 'Index 0..360deg' }, { from: 64, to: 127, label: 'Rotation fast CW..slow CW' },
    { from: 128, to: 131, label: 'Stop' }, { from: 132, to: 255, label: 'Rotation slow CCW..fast CCW' },
  ];
  const at = (b: number) => rotationOf(R, b / 255);
  it('an index range is a fixed angle', () => {
    expect(at(0)).toEqual({ angle: 0 });
    expect((at(63) as { angle: number }).angle).toBeCloseTo(Math.PI * 2, 5);
  });
  it('turning ranges: the way and how fast, as their words say', () => {
    const fastCw = at(64) as { speed: number }, slowCw = at(127) as { speed: number };
    expect(fastCw.speed).toBeGreaterThan(slowCw.speed); expect(slowCw.speed).toBeGreaterThan(0);
    const slowCcw = at(132) as { speed: number }, fastCcw = at(255) as { speed: number };
    expect(slowCcw.speed).toBeLessThan(0); expect(fastCcw.speed).toBeLessThan(slowCcw.speed);
    expect(at(130)).toEqual({ speed: 0 });
  });
  it('percentages count too, and no ranges: 0 is still, then faster clockwise', () => {
    const P = [{ from: 0, to: 255, label: 'Rotation 100%..0% CW' }];
    expect((rotationOf(P, 0) as { speed: number }).speed).toBeGreaterThan((rotationOf(P, 1) as { speed: number }).speed);
    expect(rotationOf(undefined, 0)).toEqual({ speed: 0 });
    expect((rotationOf(undefined, 0.5) as { speed: number }).speed).toBeCloseTo(Math.PI * 2, 5);
  });
});

import { prismOf } from './gobos';
describe('the prism, as its channel\'s ranges say', () => {
  it('a plain level: out at 0, three round facets from a little up', () => {
    expect(prismOf(undefined, 0)).toBeNull();
    expect(prismOf(undefined, 0.5)).toEqual({ facets: 3, linear: false });
  });
  it('ranges: out, 3-facet round, 5-facet linear, 8-fach', () => {
    const R = [{ from: 0, to: 9, label: 'Open' }, { from: 10, to: 69, label: '3-facet prism' }, { from: 70, to: 129, label: '5 facet linear prism' }, { from: 130, to: 189, label: '8-fach Prisma' }, { from: 190, to: 255, label: 'Prism 2' }];
    const at = (b: number) => prismOf(R, b / 255);
    expect(at(5)).toBeNull();
    expect(at(40)).toEqual({ facets: 3, linear: false });
    expect(at(100)).toEqual({ facets: 5, linear: true });
    expect(at(150)).toEqual({ facets: 8, linear: false });
    expect(at(220)).toEqual({ facets: 3, linear: false });       // (a second prism without a number: three)
  });
});

describe('turning backwards, as fixture files say it', () => {
  it('reverse, backward and rückwärts turn the other way; forward and vorwärts the usual way', () => {
    const speed = (label: string) => (rotationOf([{ from: 0, to: 255, label }], 0.5) as { speed: number }).speed;
    for (const l of ['Rotation reverse slow..fast', 'Backward rotation', 'Rückwärts drehen', 'Rotation CCW', 'counter-clockwise']) expect(speed(l), l).toBeLessThan(0);
    for (const l of ['Rotation forward slow..fast', 'Vorwärts drehen', 'Rotation CW', 'clockwise']) expect(speed(l), l).toBeGreaterThan(0);
  });
});
