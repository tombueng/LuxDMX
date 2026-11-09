// The box's pixel curve, worked out the same way as src/pixel_map.h (gamma and brightness in one
// 8-bit table, then the power cap), so the stage shows dark what the real LEDs show dark.
import { describe, expect, it } from 'vitest';
import { cleanCurve, curveOfPort, curveTable, firstLit, isPixelType, ledOut, onScreen, WS2812 } from './ledCurve';
import { GENERIC, modeOf } from './library';

describe("a pixel port's curve", () => {
  it('as it comes (gamma 2.2, full brightness): below 15 nothing, full is full', () => {
    const t = curveTable(WS2812);
    expect([t[0], t[14], t[15], t[128], t[255]]).toEqual([0, 0, 1, 56, 255]);
    expect(firstLit(WS2812)).toBe(15);
  });
  it('at brightness 150 (the bench carrier) the LEDs stay off up to DMX 24', () => {
    const c = { ...WS2812, bright: 150 };
    expect(firstLit(c)).toBe(25);
    expect(curveTable(c)[255]).toBe(150);
    // the box: v = (int)(powf(x, g) * 255 + 0.5); v = v * b / 255
    for (const i of [25, 40, 77, 200]) expect(curveTable(c)[i]).toBe(Math.floor(Math.floor(Math.pow(i / 255, 2.2) * 255 + 0.5) * 150 / 255));
  });
  it('linear (gamma 1) and dark (brightness 0)', () => {
    expect(curveTable({ gamma: 1, bright: 255 })[7]).toBe(7);
    expect(firstLit({ gamma: 1, bright: 0 })).toBe(256);
  });
  it('the power cap: 100 white pixels at 20 mA a channel want 6.1 A, a 1 A cap scales the lit part down', () => {
    const bytes = new Uint8Array(300).fill(255);
    const { out, scale } = ledOut({ ...WS2812, maxMa: 1000 }, bytes, 100);
    // estimate 6000 lit + 100 idle; room 900 of 6000: 900 * 256 / 6000 = 38
    expect(scale).toBe(38);
    expect(out[0]).toBe((255 * 38) >> 8);
    expect(ledOut({ ...WS2812, maxMa: 0 }, bytes, 100).scale).toBe(256);
    expect(ledOut({ ...WS2812, maxMa: 50 }, bytes, 100).scale).toBe(0);        // idle alone is over it
  });
  it('on the screen: full is full, what the box turns off is black', () => {
    expect(onScreen(255)).toBe(1);
    expect(onScreen(0)).toBe(0);
    expect(onScreen(56)).toBeGreaterThan(0.45);      // DMX 128 through gamma 2.2 is about half on the screen
  });
  it('from a box port, and from a file', () => {
    expect(curveOfPort({ uni: 10, start: 1, count: 241, bright: 150, gamma: 220, maxMa: 500, mAPerCh: 2000, quiesMa: 100 })).toEqual({ gamma: 2.2, bright: 150, maxMa: 500, maPerCh: 20, idleMa: 1 });
    expect(cleanCurve({ gamma: 2.4, bright: 300, maxMa: 'x' })).toEqual({ gamma: 2.4 });
    expect(cleanCurve('no')).toBeUndefined();
  });
  it('which lights are pixels a box port drives: strips, rings, discs, matrices; not DMX bars or PARs', () => {
    const is = (id: string) => { const t = GENERIC.find((x) => x.id === id)!; return isPixelType(t, modeOf(t, '')); };
    expect(['gen-strip60', 'gen-disc241', 'gen-ring24', 'gen-matrix16x16'].map(is)).toEqual([true, true, true, true]);
    expect(['gen-bar8', 'gen-rgb', 'gen-mover16'].map(is)).toEqual([false, false, false]);
  });
});

describe('which port a light is on', () => {
  it('RGB, worked out: 300 pixels from channel 1 read two universes', async () => {
    const { onPort } = await import('./ledCurve');
    const p = { uni: 10, start: 1, count: 300, bright: 255, gamma: 220, maxMa: 0, mAPerCh: 2000, quiesMa: 100 };
    expect(onPort(p, { universe: 10, address: 1 })).toBe(true);
    expect(onPort(p, { universe: 11, address: 1 })).toBe(true);
    expect(onPort(p, { universe: 12, address: 1 })).toBe(false);
    expect(onPort({ ...p, start: 100 }, { universe: 10, address: 50 })).toBe(false);
  });
  it('as the box says it: an RGBW port of 300 reads three (128 a universe)', async () => {
    const { onPort } = await import('./ledCurve');
    const p = { uni: 10, start: 1, count: 300, spans: 3, bright: 255, gamma: 220, maxMa: 0, mAPerCh: 2000, quiesMa: 100 };
    expect(onPort(p, { universe: 12, address: 1 })).toBe(true);
    expect(onPort(p, { universe: 13, address: 1 })).toBe(false);
  });
});
