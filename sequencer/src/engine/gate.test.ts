// The machines on the wire (model/safety.ts, engine.ts gate): confetti, flames, sparks and CO2 send 0
// until armed; arming never fires one that was already on; an armed one is cut after its longest
// time on; nothing else on the same address, no wizard and no raw number gets round it; a list
// the timeline (or the timetable) put on a cue keeps them quiet through its own follow-ons; one
// effect that throws stops only itself.
import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { EFFECT_MAP } from './effects';
import { emptyShow } from '../model/format';
import type { Cue, CueList, Fixture, Show } from '../model/types';

const fx = (id: string, typeId: string, address: number): Fixture => ({ id, name: id, typeId, mode: '', universe: 0, address, x: 0, y: 0 });
const cue = (values: Cue['values'], extra: Partial<Cue> = {}): Cue => ({ id: Math.random().toString(36).slice(2), name: 'c', values, fade: 0, advance: { mode: 'manual' }, ...extra });
const list = (id: string, cues: Cue[]): CueList => ({ id, name: id, cues, end: 'stop' });

function rig(fixtures: Fixture[], lists: CueList[] = []) {
  const show: Show = { ...emptyShow(), fixtures, cueLists: lists };
  let t = 0;
  const e = new Engine(() => show, () => t);
  const at = (s: number, n = 12) => { t = s; return [...e.tick().frames.get(0)!.slice(0, n)]; };
  return { show, e, at };
}

describe('arming', () => {
  it('a flame already on when the machines are armed stays at 0 until it has been off once', () => {
    const r = rig([fx('fl', 'gen-flame', 1)]);
    r.e.programmer = { fl: { flame: 1 } };
    expect(r.at(0.0)[0]).toBe(0);                  // safe
    r.e.armed = true;
    expect(r.at(0.1)[0]).toBe(0);                  // armed, but it was on before: waits
    expect(r.at(0.5)[0]).toBe(0);
    r.e.programmer = {};
    expect(r.at(0.6)[0]).toBe(0);                  // let go of
    r.e.programmer = { fl: { flame: 1 } };
    expect(r.at(0.7)[0]).toBe(255);                // a new shot: fires
  });
  it('disarming stops it at once, and arming again needs it off again', () => {
    const r = rig([fx('fl', 'gen-flame', 1)]);
    r.e.armed = true; r.at(0);
    r.e.programmer = { fl: { flame: 1 } };
    expect(r.at(0.1)[0]).toBe(255);
    r.e.armed = false;
    expect(r.at(0.2)[0]).toBe(0);
    r.e.armed = true;
    expect(r.at(0.3)[0]).toBe(0);
  });
});

describe('the longest time on', () => {
  it('a flame held open is cut after 5 s and stays off until its source lets go', () => {
    const r = rig([fx('fl', 'gen-flame', 1)]);
    r.e.armed = true; r.at(0);
    r.e.programmer = { fl: { flame: 1 } };
    expect(r.at(1)[0]).toBe(255);
    expect(r.at(5.9)[0]).toBe(255);
    expect(r.at(6.2)[0]).toBe(0);                  // 5 s on: cut
    expect(r.at(20)[0]).toBe(0);                   // still held: still cut
    r.e.programmer = {}; r.at(21);
    r.e.programmer = { fl: { flame: 1 } };
    expect(r.at(22)[0]).toBe(255);                 // off and on again: a new shot
  });
  it('sparks may run 30 s, confetti 5 s', () => {
    const r = rig([fx('sp', 'gen-sparks', 1), fx('cf', 'gen-confetti', 2)]);
    r.e.armed = true; r.at(0);
    r.e.programmer = { sp: { sparks: 1 }, cf: { confetti: 1 } };
    expect(r.at(1).slice(0, 2)).toEqual([255, 255]);
    expect(r.at(10).slice(0, 2)).toEqual([255, 0]);
    expect(r.at(30.5).slice(0, 2)).toEqual([255, 0]);
    expect(r.at(31.5).slice(0, 2)).toEqual([0, 0]);
  });
});

describe('nothing gets round the gate', () => {
  it('a light patched over a machine\'s address does not fire it', () => {
    // Dimmer + RGB at 8 (blue = 11) over a confetti cannon at 11
    const r = rig([fx('cf', 'gen-confetti', 11), fx('par', 'gen-drgb', 8)]);
    r.e.programmer = { par: { intensity: 1, color: { r: 0, g: 0, b: 1 } } };
    expect(r.at(0.1)[10]).toBe(0);
    expect(r.at(0.1)[7]).toBe(255);                // (the light itself goes out)
  });
  it('the channel wizard\'s test values on a patched machine wait for arming too', () => {
    const r = rig([fx('fl', 'gen-flame', 1), fx('p', 'gen-dimmer', 2)]);
    r.e.overlay = { universe: 0, address: 1, values: [255, 255] };
    expect(r.at(0.1).slice(0, 2)).toEqual([0, 255]);
  });
  it('a raw number on a machine\'s channel ("All channels") is gated like the attribute', () => {
    const r = rig([fx('fl', 'gen-flame', 1)]);
    r.e.programmer = { fl: { raw: { 0: 200 } } };
    expect(r.at(0.1)[0]).toBe(0);
  });
});

describe('lists put on a cue without playing into it stay quiet', () => {
  it('a raw flame value in a jumped cue stays quiet, armed or not, until GO', () => {
    const r = rig([fx('fl', 'gen-flame', 1)], [list('F', [cue({ fl: { raw: { 0: 255 } } }), cue({ fl: { raw: { 0: 255 } } })])]);
    r.e.armed = true; r.at(0);
    r.e.jumpTo('F', 0); r.e.jumped.add('F');
    expect(r.at(0.2)[0]).toBe(0);
    r.e.go('F');
    expect(r.at(0.4)[0]).toBe(255);
  });
  it('its own follow-ons keep it quiet (a chase the timeline jumped onto)', () => {
    const go = { mode: 'follow' as const, time: 0.2 };
    const r = rig([fx('fl', 'gen-flame', 1)], [list('F', [cue({ fl: { flame: 0 } }, { advance: go }), cue({ fl: { flame: 1 } }, { advance: go }), cue({ fl: { flame: 1 } })])]);
    r.e.armed = true; r.at(0);
    r.e.jumpTo('F', 0); r.e.jumped.add('F');
    for (const t of [0.1, 0.3, 0.5, 0.7, 1]) expect(r.at(t)[0]).toBe(0);
    expect(r.e.status('F').index).toBe(2);         // (it did move on, by itself)
  });
});

describe('fog put to 0 by hand wins over a raw number', () => {
  it('"stop the fog" (the live layer) zeroes a raw fog value too', () => {
    const r = rig([fx('fg', 'gen-fog', 1)]);
    r.e.programmer = { fg: { raw: { 0: 200 } } };
    expect(r.at(0.1)[0]).toBe(200);
    r.e.live = { fg: { fog: 0 } };
    expect(r.at(0.2)[0]).toBe(0);
  });
});

describe('an effect that throws', () => {
  it('stops only itself: the frame goes out, the engine says which one', () => {
    EFFECT_MAP.set('boom', { id: 'boom', name: 'Boom', category: 'intensity', blurb: '', defaults: {}, run: () => { throw new Error('bad formula'); } } as never);
    try {
      const r = rig([fx('p', 'gen-dimmer', 1)]);
      r.show.effects = [{ id: 'e1', name: 'Boom', kind: 'boom', fixtures: ['p'], params: {} }];
      r.e.programmer = { p: { intensity: 1 } };
      r.e.startEffect('e1');
      expect(r.at(0.1)[0]).toBe(255);
      expect(r.at(0.5)[0]).toBe(255);
      expect(r.e.broken.get('e1')).toMatch(/bad formula/);
    } finally { EFFECT_MAP.delete('boom'); }
  });
});

describe("a machine's own safety / enable channel", () => {
  // (Stage Flame style: 0..100 SAFE, 101..153 LIVE, 154..255 SAFE)
  const t = { id: 'sf', manufacturer: 'X', model: 'Stage Flame', source: 'qxf' as const, modes: [{ name: '2ch', channels: [
    { name: 'Safety', attr: 'enable' as const, ranges: [{ from: 0, to: 100, label: 'SAFE Mode' }, { from: 101, to: 153, label: 'LIVE' }, { from: 154, to: 255, label: 'SAFE Mode' }] },
    { name: 'Fire', attr: 'flame' as const }] }] };
  it('follows the arming: its "LIVE" value while armed, 0 while safe; nothing else can open it', () => {
    const r = rig([{ ...fx('sf', 'sf', 1), mode: '2ch' }]);
    r.show.fixtureTypes = [t];
    r.e.programmer = { sf: { raw: { 0: 127 } } };              // a raw value can't open the lock
    expect(r.at(0.1).slice(0, 2)).toEqual([0, 0]);
    r.e.programmer = {};
    r.e.armed = true;
    expect(r.at(0.2).slice(0, 2)).toEqual([127, 0]);
    r.e.programmer = { sf: { flame: 1 } };
    expect(r.at(0.3).slice(0, 2)).toEqual([127, 255]);
    r.e.armed = false;
    expect(r.at(0.4).slice(0, 2)).toEqual([0, 0]);
  });
});

describe('enable channels: overlaps and the values they take', () => {
  const flame = { id: 'sf', manufacturer: 'X', model: 'Stage Flame', source: 'qxf' as const, modes: [{ name: '2ch', channels: [
    { name: 'Safety', attr: 'enable' as const, ranges: [{ from: 0, to: 100, label: 'SAFE Mode' }, { from: 101, to: 153, label: 'LIVE' }, { from: 154, to: 255, label: 'SAFE Mode' }] },
    { name: 'Fire', attr: 'flame' as const }] }] };
  it('one machine\'s enable patched over another\'s fire channel never fires it', () => {
    // A at 1 (Safety 1, Fire 2), B at 2 (Safety 2 = A's Fire)
    const r = rig([{ ...fx('a', 'sf', 1), mode: '2ch' }, { ...fx('b', 'sf', 2), mode: '2ch' }]);
    r.show.fixtureTypes = [flame];
    r.e.armed = true;
    for (const t of [0.1, 1, 10, 30]) expect(r.at(t)[1]).toBe(0);
  });
  it('on: the range that enables; off: outside every enabling range', async () => {
    const { enableValue, enables } = await import('../model/safety');
    for (const l of ['Disarmed', 'Unarmed', 'Inactive', 'pre-Enable (pressurize)', 'Device Test Mode', 'SAFE Mode', 'Safety on']) expect(enables(l), l).toBe(false);
    for (const l of ['Safety OFF', 'Armed Mode', 'LIVE', 'Device enabled', 'Ready']) expect(enables(l), l).toBe(true);
    // 0 inside the enabling range: off is the range that says safe
    expect(enableValue([{ from: 0, to: 127, label: 'Armed' }, { from: 128, to: 255, label: 'Safe' }])).toEqual({ on: 64, off: 192 });
    // nothing enables it: never on
    expect(enableValue([{ from: 0, to: 99, label: 'Disabled' }, { from: 100, to: 255, label: 'Test mode (CO2 disabled)' }])).toEqual({ off: 0 });
    expect(enableValue(undefined)).toEqual({ on: 255, off: 0 });
  });
});
