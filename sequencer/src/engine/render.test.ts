import { describe, expect, it } from 'vitest';
import { fitLook, renderFixture, TUNGSTEN } from './render';
import { GENERIC, capsOf, modeOf } from '../model/library';
import type { Fixture, FixtureMode, Resolved } from '../model/types';

const type = (id: string) => GENERIC.find((g) => g.id === id)!;
const fx = (typeId: string): Fixture => ({ id: 'f', name: 'F', typeId, mode: '', universe: 0, address: 1, x: 0.5, y: 0.5 });
function outMode(m: FixtureMode, v: Resolved, colored = true) {
  const buf = new Uint8Array(512), look = { ...v };
  fitLook(look, capsOf(m), colored);
  renderFixture(fx('x'), m, look, buf);
  return { dmx: [...buf.slice(0, m.channels.length)], look };
}
const out = (typeId: string, v: Resolved, colored = true) => outMode(modeOf(type(typeId), '')!, v, colored);
const WHITE_ONLY: FixtureMode = { name: '2 ch', channels: [{ name: 'Dimmer', attr: 'intensity' }, { name: 'White', attr: 'white' }] };

describe('looks fitted to what a fixture can do', () => {
  it('warm/cool whites take "Warm white" as a colour temperature, and draw warm', () => {
    const { dmx, look } = out('gen-wwcw', { intensity: 1, color: { r: 1, g: 0.75, b: 0.45 } });
    expect(dmx[0]).toBe(255);                 // warm at full
    expect(dmx[1]).toBeLessThan(40);          // cool nearly off
    expect(look.draw!.b).toBeLessThan(0.6);   // and the stage draws it warm
  });
  it('"Cool white" makes them cool, "White" both at full', () => {
    expect(out('gen-wwcw', { intensity: 1, color: { r: 0.84, g: 0.9, b: 1 } }).dmx[0]).toBeLessThan(60);
    expect(out('gen-wwcw', { intensity: 1, color: { r: 1, g: 1, b: 1 } }).dmx).toEqual([255, 255]);
  });
  it('a colour they cannot make leaves them at their brightest neutral white, drawn white', () => {
    const { dmx, look } = out('gen-wwcw', { intensity: 1, color: { r: 0.55, g: 0, b: 1 } });
    expect(dmx).toEqual([255, 255]);
    expect(look.draw!.g).toBeGreaterThan(0.75);
  });
  it('a CTO channel stays at its default while nobody asked for a colour', () => {
    expect(out('gen-cct', { intensity: 1, color: { r: 1, g: 1, b: 1 } }, false).dmx).toEqual([255, 0]);
  });
  it('a white-only fixture gives full white (the drawing colour never reaches the DMX)', () => {
    const { dmx, look } = outMode(WHITE_ONLY, { intensity: 1, color: { r: 1, g: 1, b: 1 } });
    expect(dmx).toEqual([255, 255]);
    expect(look.draw).toEqual({ r: 1, g: 1, b: 1 });
  });
  it('a plain dimmer draws like tungsten whatever colour was asked for', () => {
    const { look } = out('gen-dimmer', { intensity: 1, color: { r: 0, g: 0, b: 1 } });
    expect(look.draw).toEqual(TUNGSTEN);
  });
  it('colour fixtures are left alone', () => {
    const { dmx } = out('gen-rgb', { intensity: 1, color: { r: 0.55, g: 0, b: 1 } });
    expect(dmx).toEqual([140, 0, 255]);
  });
});

describe('values out of range', () => {
  // a show file or an effect can carry a value a little outside 0..1: it lands on the nearest end,
  // it never stops the frame (a gobo below 0 used to throw, and with it every light's output)
  const GOBO: FixtureMode = { name: 'gobo', channels: [{ name: 'Gobo', attr: 'gobo', ranges: [
    { from: 0, to: 7, label: 'Open', kind: 'slot' }, { from: 8, to: 15, label: 'Dots', kind: 'slot' }, { from: 16, to: 23, label: 'Star', kind: 'slot' }] }] };
  it('a gobo below 0 or above 1 picks the first or the last slot', () => {
    expect(outMode(GOBO, { gobo: -0.2 }).dmx).toEqual([4]);
    expect(outMode(GOBO, { gobo: 1.4 }).dmx).toEqual([20]);
  });
  it('colours and levels clamp', () => {
    expect(out('gen-rgb', { intensity: 1, color: { r: -1, g: 2, b: 0.5 } }).dmx).toEqual([0, 255, 128]);
    expect(out('gen-rgb', { intensity: 1.5, color: { r: 1, g: 1, b: 1 } }).dmx).toEqual([255, 255, 255]);
  });
});

describe('a moving head with pan and tilt swapped', () => {
  it("a cue's pan goes out on the tilt channel and its tilt on the pan channel; invert is the motor's own, after the swap", () => {
    const m = modeOf(type('gen-mover8'), '')!, chan = (attr: string) => m.channels.findIndex((c) => c.attr === attr);
    const run = (f: Partial<Fixture>) => { const buf = new Uint8Array(512), look: Resolved = { pan: 0.25, tilt: 0.75, intensity: 1 }; fitLook(look, capsOf(m), true); renderFixture({ ...fx('gen-mover8'), ...f }, m, look, buf); return [buf[chan('pan')], buf[chan('tilt')]]; };
    expect(run({})).toEqual([64, 191]);
    expect(run({ swapPanTilt: true })).toEqual([191, 64]);
    // (inverted pan after the swap: the pan motor gets 1 - the cue's tilt)
    expect(run({ swapPanTilt: true, invertPan: true })).toEqual([64, 64]);
  });
});
