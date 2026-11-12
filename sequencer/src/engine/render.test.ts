import { describe, expect, it } from 'vitest';
import { fitLook, rawLook, renderFixture, TUNGSTEN } from './render';
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

// "All channels" in the programmer: raw bytes go out as they are, and the pictures read them back
describe('the stage reads raw channel values back', () => {
  const fx = (typeId: string, o: Partial<Fixture> = {}) => ({ id: 'x', name: 'X', typeId, mode: '', universe: 0, address: 1, x: 0, y: 0, ...o }) as Fixture;
  // every channel raw at what the look would send, then read back
  const roundTrip = (typeId: string, v: Resolved, o: Partial<Fixture> = {}) => {
    const m = modeOf(type(typeId), '')!, f = fx(typeId, o), buf = new Uint8Array(512);
    renderFixture(f, m, v, buf);
    const bytes = [...buf.slice(0, m.channels.length)];
    const raw = Object.fromEntries(bytes.map((b, i) => [String(i), b]));
    return rawLook(f, m, { intensity: 0, raw } as Resolved, bytes);
  };
  it('a moving head: pan and tilt (16 bit), the dimmer, its colour', () => {
    const r = roundTrip('gen-mover16', { intensity: 0.6, pan: 0.3, tilt: 0.8, color: { r: 1, g: 0.5, b: 0 } });
    expect(r.pan).toBeCloseTo(0.3, 4); expect(r.tilt).toBeCloseTo(0.8, 4);
    expect(r.intensity).toBeCloseTo(0.6, 2);
    expect(r.color!.r).toBeCloseTo(1, 2); expect(r.color!.g).toBeCloseTo(0.5, 2); expect(r.color!.b).toBeCloseTo(0, 2);
  });
  it('pan and tilt on an inverted or swapped head: what a cue would call them', () => {
    const inv = roundTrip('gen-mover8', { intensity: 1, pan: 0.2, tilt: 0.9 }, { invertPan: true });
    expect(inv.pan).toBeCloseTo(0.2, 2); expect(inv.tilt).toBeCloseTo(0.9, 2);
    const sw = roundTrip('gen-mover8', { intensity: 1, pan: 0.2, tilt: 0.9 }, { swapPanTilt: true });
    expect(sw.pan).toBeCloseTo(0.2, 2); expect(sw.tilt).toBeCloseTo(0.9, 2);
  });
  it('a light with no dimmer: its emitters are its brightness', () => {
    const r = roundTrip('gen-rgb', { intensity: 0.5, color: { r: 0, g: 0, b: 1 } });
    expect(r.intensity).toBeCloseTo(0.5, 2);
    expect(r.color).toEqual({ r: 0, g: 0, b: 1 });
  });
  it('one channel by hand: only what it controls changes, the rest of the look stays', () => {
    const m = modeOf(type('gen-mover8'), '')!, f = fx('gen-mover8'), buf = new Uint8Array(512);
    const v: Resolved = { intensity: 1, pan: 0.5, tilt: 0.5, color: { r: 1, g: 1, b: 1 }, raw: { 0: 255 } };
    renderFixture(f, m, v, buf);
    const r = rawLook(f, m, v, [...buf.slice(0, 8)]);
    expect(r.pan).toBe(1);                                         // the pan byte at 255
    expect([r.tilt, r.intensity]).toEqual([0.5, 1]);
    expect(rawLook(f, m, { intensity: 1 }, [...buf.slice(0, 8)])).toEqual({ intensity: 1 });   // (nothing raw: the look as it is)
  });
  it('gobo slots, a colour wheel and the shutter, from their ranges', () => {
    const m: FixtureMode = { name: 'spot', channels: [
      { name: 'Dimmer', attr: 'intensity' },
      { name: 'Gobo', attr: 'gobo', ranges: [{ from: 0, to: 9, label: 'Open', kind: 'slot' }, { from: 10, to: 19, label: 'Stars', kind: 'slot' }, { from: 20, to: 29, label: 'Dots', kind: 'slot' }] },
      { name: 'Colour', attr: 'colorWheel', ranges: [{ from: 0, to: 9, label: 'White', color: '#ffffff' }, { from: 10, to: 19, label: 'Red', color: '#ff0000' }] },
      { name: 'Shutter', attr: 'shutter', ranges: [{ from: 0, to: 9, label: 'Closed', kind: 'closed' }, { from: 10, to: 19, label: 'Open', kind: 'open' }, { from: 20, to: 255, label: 'Strobe', kind: 'strobe' }] },
    ] };
    const f = fx('user:spot'), look = (bytes: number[]) => rawLook(f, m, { intensity: 1, raw: { 1: bytes[1], 2: bytes[2], 3: bytes[3] } } as Resolved, bytes);
    const a = look([255, 25, 15, 15]);
    expect(a.gobo).toBe(1); expect(a.color).toEqual({ r: 1, g: 0, b: 0 }); expect(a.strobe).toBe(0);
    expect(look([255, 12, 0, 5]).intensity).toBe(0);                // shutter closed
    expect(look([255, 12, 0, 255]).strobe).toBe(1);                 // strobing at its fastest
    expect(look([255, 12, 0, 255]).gobo).toBe(0.5);
  });
});

describe('a gobo wheel\'s shake and scroll ranges, read back for the pictures', () => {
  const m: FixtureMode = { name: 'spot', channels: [
    { name: 'Dimmer', attr: 'intensity' },
    { name: 'Gobo', attr: 'gobo', ranges: [{ from: 0, to: 9, label: 'Open', kind: 'slot' }, { from: 10, to: 19, label: 'Stars', kind: 'slot' }, { from: 20, to: 29, label: 'Dots', kind: 'slot' },
      { from: 30, to: 99, label: 'Shake 2 slow..fast', kind: 'other' }, { from: 100, to: 177, label: 'Rotation CW slow..fast', kind: 'other' }, { from: 178, to: 255, label: 'Rotation CCW fast..slow', kind: 'other' }] },
  ] };
  const f = { id: 'x', name: 'X', typeId: 'user:s', mode: 'spot', universe: 0, address: 1, x: 0, y: 0 } as Fixture;
  const look = (g: number) => rawLook(f, m, { intensity: 1, raw: { 1: g } } as Resolved, [255, g]);
  it('a shake range: its slot, shaking as fast as where it is in the range', () => {
    const slow = look(31), fast = look(99);
    expect(slow.gobo).toBe(0.5); expect(fast.gobo).toBe(0.5);       // slot 2 of Open, Stars, Dots: Stars
    expect(slow.goboShake!).toBeLessThan(fast.goboShake!);
    expect(slow.goboScroll).toBeUndefined();
  });
  it('the wheel running round: which way and how fast', () => {
    expect(look(177).goboScroll!).toBeGreaterThan(look(101).goboScroll!);
    expect(look(178).goboScroll!).toBeLessThan(look(254).goboScroll!);   // CCW fast..slow: fastest at its start
    expect(look(178).goboScroll!).toBeLessThan(0);
  });
  it('a slot is a slot (no shake, no scroll)', () => {
    const s = look(15);
    expect(s.gobo).toBe(0.5); expect(s.goboShake).toBeUndefined(); expect(s.goboScroll).toBeUndefined();
  });
});

describe('a gobo wheel\'s shake and running round as attributes, on its channel\'s ranges', () => {
  const m: FixtureMode = { name: 'spot', channels: [
    { name: 'Dimmer', attr: 'intensity' },
    { name: 'Gobo', attr: 'gobo', ranges: [{ from: 0, to: 9, label: 'Open', kind: 'slot' }, { from: 10, to: 19, label: 'Stars', kind: 'slot' }, { from: 20, to: 29, label: 'Dots', kind: 'slot' },
      { from: 30, to: 64, label: 'Shake 2 (Stars) slow..fast', kind: 'other' }, { from: 65, to: 99, label: 'Shake 3 (Dots) slow..fast', kind: 'other' },
      { from: 100, to: 177, label: 'Wheel rotation CW fast..slow', kind: 'other' }, { from: 178, to: 255, label: 'Wheel rotation CCW slow..fast', kind: 'other' }] },
  ] };
  const f = { id: 'x', name: 'X', typeId: 'user:s', mode: 'spot', universe: 0, address: 1, x: 0, y: 0 } as Fixture;
  const send = (v: Resolved) => { const buf = new Uint8Array(512); renderFixture(f, m, { intensity: 1, ...v }, buf); return buf[1]; };
  it('a gobo shaking: in its own shake range, faster further in; another gobo shakes in its own', () => {
    const slow = send({ gobo: 0.5, goboShake: 0.1 }), fast = send({ gobo: 0.5, goboShake: 1 });
    expect(slow).toBeGreaterThanOrEqual(30); expect(fast).toBeLessThanOrEqual(64); expect(fast).toBeGreaterThan(slow);
    expect(send({ gobo: 1, goboShake: 0.5 })).toBeGreaterThanOrEqual(65);
    expect(send({ gobo: 0, goboShake: 0.5 })).toBe(5);              // (Open has no shake: Open)
    expect(send({ gobo: 0.5, goboShake: 0 })).toBe(15);             // (not shaking: the slot)
  });
  it('the wheel running round: CW fast..slow (faster: nearer its start), CCW the other way', () => {
    const cwFast = send({ gobo: 0.5, goboScroll: 1 }), cwSlow = send({ gobo: 0.5, goboScroll: 0.1 });
    expect(cwFast).toBe(100); expect(cwSlow).toBeGreaterThan(cwFast); expect(cwSlow).toBeLessThanOrEqual(177);
    expect(send({ goboScroll: -0.5 })).toBeGreaterThanOrEqual(178);
    // and read back: what it sends is what the pictures show
    const back = rawLook(f, m, { intensity: 1, raw: { 1: cwSlow } } as Resolved, [255, cwSlow]);
    expect(back.goboScroll!).toBeGreaterThan(0); expect(back.goboScroll!).toBeLessThan(0.3);
  });
});
