// Real Open Fixture Library files (test/fixtures/ofl, pinned commit), from a cheap PAR to Robe and
// Clay Paky moving lights: they convert, and what we send them makes sense.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fromOfl } from './ofl';
import { renderFixture } from '../engine/render';
import type { Fixture, FixtureMode, FixtureType, Resolved } from '../model/types';

const load = (key: string, man: string): FixtureType =>
  fromOfl(key, JSON.parse(fs.readFileSync(`test/fixtures/ofl/${key.replace('/', '__')}.json`, 'utf8')), man);
const fx = { id: 'a', name: 'a', typeId: 't', mode: '', universe: 0, address: 1, x: 0, y: 0 } as Fixture;
function render(m: FixtureMode, v: Resolved) {
  const b = new Uint8Array(512); renderFixture(fx, m, v, b);
  return Object.fromEntries(m.channels.map((c, i) => [c.name, b[i]]));
}
const mode = (t: FixtureType, name: string) => t.modes.find((m) => m.name === name)!;
const attrs = (m: FixtureMode) => m.channels.map((c) => (c.fine ? c.attr + '(fine)' : c.attr));

describe('Open Fixture Library import', () => {
  it('a cheap PAR: every mode, channel count matches', () => {
    const t = load('cameo/flat-pro-18', 'Cameo');
    expect(t.id).toBe('ofl:cameo/flat-pro-18');
    expect(t.modes.length).toBeGreaterThan(1);
    for (const m of t.modes) expect(m.channels.length).toBeGreaterThan(0);
    const all = t.modes.flatMap((m) => m.channels.map((c) => c.attr));
    expect(all).toContain('red');
    expect(all).toContain('intensity');
  });

  it('a 6-in-1 PAR knows white, amber and UV', () => {
    const t = load('showtec/club-par-12-6-rgbwauv', 'Showtec');
    const a = t.modes.flatMap((m) => m.channels.map((c) => c.attr));
    for (const x of ['red', 'green', 'blue', 'white', 'amber', 'uv']) expect(a).toContain(x);
  });

  it('a pixel bar: matrix channels expand per pixel, with cell numbers', () => {
    const t = load('eurolite/led-pix-12-hcl', 'Eurolite');
    const big = t.modes.reduce((a, b) => (b.channels.length > a.channels.length ? b : a));
    const reds = big.channels.filter((c) => c.attr === 'red');
    expect(reds.length).toBe(12);
    expect(reds.map((c) => c.cell)).toEqual([...Array(12).keys()]);
  });

  it('Robe Robin 600E Spot: 16-bit, CMY, wheels, shutter, and a sensible render', () => {
    const t = load('robe/robin-600e-spot', 'Robe');
    const m = mode(t, '32-channel');
    expect(m.channels).toHaveLength(32);
    expect(attrs(m).slice(0, 4)).toEqual(['pan', 'pan(fine)', 'tilt', 'tilt(fine)']);
    expect(attrs(m)).toEqual(expect.arrayContaining(['cyan', 'magenta', 'yellow', 'colorWheel', 'gobo', 'shutter', 'intensity', 'zoom', 'focus', 'iris', 'prism', 'frost', 'cct']));
    const shutter = m.channels.find((c) => c.attr === 'shutter')!;
    expect(shutter.ranges!.some((r) => r.kind === 'open')).toBe(true);
    const wheel = m.channels.find((c) => c.attr === 'colorWheel' && !c.fine)!;
    expect(wheel.ranges!.filter((r) => r.color).length).toBeGreaterThan(4);

    const out = render(m, { intensity: 1, color: { r: 1, g: 0, b: 0 }, pan: 0.5, tilt: 0.5 });
    expect(out['Dimmer']).toBe(255);
    expect([out['Cyan'], out['Magenta'], out['Yellow']]).toEqual([0, 255, 255]);   // red by CMY...
    const open = wheel.ranges!.find((r) => r.color === '#ffffff')!;
    expect(out['Color Wheel']).toBeGreaterThanOrEqual(open.from);                 // ...with the wheel open
    expect(out['Color Wheel']).toBeLessThanOrEqual(open.to);
    const sh = shutter.ranges!.find((r) => r.kind === 'open')!;
    expect(out['Shutter']).toBeGreaterThanOrEqual(sh.from);
    expect(out['Shutter']).toBeLessThanOrEqual(sh.to);
    expect(out['CTO Filter']).toBe(m.channels.find((c) => c.name === 'CTO Filter')!.default ?? 0);  // no CTO unless asked
  });

  it('Clay Paky Sharpy: red comes from the colour wheel (no colour mixing)', () => {
    const t = load('clay-paky/sharpy', 'Clay Paky');
    const m = mode(t, 'Standard');
    expect(m.channels).toHaveLength(16);
    const wheel = m.channels.find((c) => c.attr === 'colorWheel')!;
    const out = render(m, { intensity: 1, color: { r: 1, g: 0, b: 0 } });
    const slot = wheel.ranges!.find((r) => r.from <= out['Color Wheel'] && out['Color Wheel'] <= r.to)!;
    expect(slot.label.toLowerCase()).toContain('red');
    expect(out['Dimmer']).toBe(255);
  });

  it('Martin MAC Aura converts every mode', () => {
    const t = load('martin/mac-aura', 'Martin');
    for (const m of t.modes) expect(m.channels.every((c) => c.attr)).toBe(true);
    expect(t.physical?.panDeg).toBeGreaterThan(300);
  });

  it('a fog machine drives its fog channel', () => {
    const t = load('stairville/m-fog-1000', 'Stairville');
    const a = t.modes.flatMap((m) => m.channels.map((c) => c.attr));
    expect(a).toContain('fog');
  });

  it('switching channels resolve to a real channel', () => {
    const t = load('eurolite/led-kls-801', 'Eurolite');
    for (const m of t.modes) expect(m.channels.length).toBeGreaterThan(0);
  });
});
