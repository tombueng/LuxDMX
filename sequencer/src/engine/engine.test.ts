import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { renderFixture } from './render';
import { resolveValues } from './resolve';
import { emptyShow } from '../model/format';
import type { Cue, CueList, Fixture, FixtureMode, Preset, Show } from '../model/types';

const fx = (id: string, typeId: string, address: number, universe = 0, extra: Partial<Fixture> = {}): Fixture =>
  ({ id, name: id, typeId, mode: '', universe, address, x: 0, y: 0, ...extra });
const cue = (values: Cue['values'], fade = 0, extra: Partial<Cue> = {}): Cue =>
  ({ id: Math.random().toString(36).slice(2), name: 'c', values, fade, advance: { mode: 'manual' }, ...extra });
const list = (id: string, cues: Cue[], extra: Partial<CueList> = {}): CueList => ({ id, name: id, cues, end: 'stop', ...extra });

function rig(fixtures: Fixture[], lists: CueList[] = [], presets: Preset[] = []) {
  const show: Show = { ...emptyShow(), fixtures, cueLists: lists, presets };
  let t = 0;
  const e = new Engine(() => show, () => t);
  return { show, e, at: (s: number) => { t = s; return e.tick(); }, ch: (s: number, n = 8, u = 0) => [...(e.tick(), (t = s, e.tick()).frames.get(u)!.slice(0, n))] };
}
const out = (r: ReturnType<typeof rig>, t: number, n = 8, u = 0) => [...r.at(t).frames.get(u)!.slice(0, n)];

// ------------------------------------------------------------------ rendering
describe('render', () => {
  const render = (m: FixtureMode, v: Parameters<typeof renderFixture>[2], f: Partial<Fixture> = {}) => {
    const buf = new Uint8Array(512);
    renderFixture({ ...fx('a', 't', 1), ...f }, m, v, buf);
    return [...buf.slice(0, m.channels.length)];
  };
  const mode = (...attrs: string[]): FixtureMode => ({ name: 'm', channels: attrs.map((a) => ({ name: a, attr: a as never })) });

  it('dimmer + RGB', () => expect(render(mode('intensity', 'red', 'green', 'blue'), { intensity: 1, color: { r: 1, g: 0.5, b: 0 } })).toEqual([255, 255, 128, 0]));
  it('RGB without a dimmer channel follows intensity', () =>
    expect(render(mode('red', 'green', 'blue'), { intensity: 0.5, color: { r: 1, g: 1, b: 0 } })).toEqual([128, 128, 0]));
  it('RGBW moves the common part of a colour onto the white LED', () =>
    expect(render(mode('intensity', 'red', 'green', 'blue', 'white'), { intensity: 1, color: { r: 1, g: 1, b: 0.6 } })).toEqual([255, 102, 102, 0, 153]));
  it('RGBW with white set by hand leaves RGB alone', () =>
    expect(render(mode('red', 'green', 'blue', 'white'), { intensity: 1, color: { r: 1, g: 0, b: 0 }, white: 0.2 })).toEqual([255, 0, 0, 51]));
  it('CMY is the inverse of RGB', () =>
    expect(render(mode('intensity', 'cyan', 'magenta', 'yellow'), { intensity: 1, color: { r: 1, g: 0, b: 0 } })).toEqual([255, 0, 255, 255]));
  it('a colour wheel takes the nearest slot', () => {
    const m: FixtureMode = { name: 'm', channels: [{ name: 'Color', attr: 'colorWheel', ranges: [
      { from: 0, to: 9, label: 'Open', kind: 'slot', color: '#ffffff' }, { from: 10, to: 19, label: 'Red', kind: 'slot', color: '#ff0000' },
      { from: 20, to: 29, label: 'Blue', kind: 'slot', color: '#0000ff' }] }] };
    expect(render(m, { color: { r: 0.9, g: 0.1, b: 0.2 } })).toEqual([15]);
    expect(render(m, { color: { r: 0.1, g: 0.2, b: 0.8 } })).toEqual([25]);
  });
  it('16-bit pan with a fine channel, and inverted', () => {
    const m: FixtureMode = { name: 'm', channels: [{ name: 'Pan', attr: 'pan' }, { name: 'Pan fine', attr: 'pan', fine: true }] };
    const [hi, lo] = render(m, { pan: 0.75 });
    expect(hi * 256 + lo).toBe(Math.round(0.75 * 65535));
    const [ihi, ilo] = render(m, { pan: 0.75 }, { invertPan: true });
    expect(ihi * 256 + ilo).toBe(Math.round(0.25 * 65535));
  });
  it('a shutter channel opens, and strobes inside its strobe range', () => {
    const m: FixtureMode = { name: 'm', channels: [{ name: 'Shutter', attr: 'shutter', ranges: [
      { from: 0, to: 7, label: 'Closed', kind: 'closed' }, { from: 8, to: 15, label: 'Open', kind: 'open' }, { from: 16, to: 131, label: 'Strobe', kind: 'strobe' }] }] };
    expect(render(m, { strobe: 0 })).toEqual([12]);
    expect(render(m, { strobe: 0.5 })).toEqual([74]);
  });
  it('gobo picks a slot by position in the list', () => {
    const m: FixtureMode = { name: 'm', channels: [{ name: 'Gobo', attr: 'gobo', ranges: [
      { from: 0, to: 9, label: 'Open', kind: 'slot' }, { from: 10, to: 19, label: 'G1', kind: 'slot' }, { from: 20, to: 29, label: 'G2', kind: 'slot' }] }] };
    expect(render(m, { gobo: 0.5 })).toEqual([15]);
    expect(render(m, { gobo: 1 })).toEqual([25]);
  });
  it('raw values go straight out, untouched channels sit at their default', () => {
    const m: FixtureMode = { name: 'm', channels: [{ name: 'Macro', attr: 'raw', default: 7 }, { name: 'Mode', attr: 'raw' }] };
    expect(render(m, { raw: { '1': 200 } })).toEqual([7, 200]);
  });
});

// ------------------------------------------------------------------ presets
describe('presets', () => {
  const presets = new Map<string, Preset>([
    ['warm', { id: 'warm', name: 'Warm', kind: 'color', values: { color: { r: 1, g: 0.7, b: 0.4 } } }],
    ['singer', { id: 'singer', name: 'Singer', kind: 'position', values: { pan: 0.5, tilt: 0.5 }, perFixture: { m2: { pan: 0.3 } } }],
  ]);
  it('looks up references, with per-fixture overrides', () => {
    expect(resolveValues({ color: { preset: 'warm' }, intensity: 1 }, 'p1', presets)).toEqual({ color: { r: 1, g: 0.7, b: 0.4 }, intensity: 1 });
    expect(resolveValues({ pan: { preset: 'singer' }, tilt: { preset: 'singer' } }, 'm2', presets)).toEqual({ pan: 0.3, tilt: 0.5 });
  });
  it('drops a reference to a preset that is gone', () => {
    expect(resolveValues({ color: { preset: 'nope' }, intensity: 0.5 }, 'p1', presets)).toEqual({ intensity: 0.5 });
  });
  it('a cue follows when its preset changes', () => {
    const p: Preset = { id: 'c', name: 'C', kind: 'color', values: { color: { r: 1, g: 0, b: 0 } } };
    const r = rig([fx('a', 'gen-drgb', 1)], [list('L', [cue({ a: { intensity: 1, color: { preset: 'c' } } })])], [p]);
    r.e.go('L');
    expect(out(r, 0, 4)).toEqual([255, 255, 0, 0]);
    p.values.color = { r: 0, g: 0, b: 1 };
    r.e.jumpTo('L', 0);
    expect(out(r, 0, 4)).toEqual([255, 0, 0, 255]);
  });
});

// ------------------------------------------------------------------ playback
describe('cue lists', () => {
  const red = { intensity: 1, color: { r: 1, g: 0, b: 0 } }, blue = { intensity: 1, color: { r: 0, g: 0, b: 1 } };

  it('fades in from dark over the cue fade', () => {
    const r = rig([fx('a', 'gen-drgb', 1)], [list('L', [cue({ a: red }, 2)])]);
    r.e.go('L');
    expect(out(r, 1, 4)).toEqual([128, 255, 0, 0]);
    expect(out(r, 2, 4)).toEqual([255, 255, 0, 0]);
  });

  it('keeps what the next cue does not mention', () => {
    const r = rig([fx('a', 'gen-drgb', 1)], [list('L', [cue({ a: red }), cue({ a: { color: { r: 0, g: 0, b: 1 } } }, 2)])]);
    r.e.go('L'); out(r, 0); r.e.go('L');
    expect(out(r, 1, 4)).toEqual([255, 128, 0, 128]);
  });

  it('honours delay and a separate fade out for intensity', () => {
    const r = rig([fx('a', 'gen-dimmer', 1)], [list('L', [cue({ a: { intensity: 1 } }), cue({ a: { intensity: 0 } }, 4, { fadeOut: 1, delay: 1 })])]);
    r.e.go('L'); out(r, 0); r.e.go('L');
    expect(out(r, 0.5, 1)).toEqual([255]);          // still in the delay
    expect(out(r, 1.5, 1)).toEqual([128]);          // halfway through the 1 s fade out
    expect(out(r, 2.1, 1)).toEqual([0]);
  });

  it('two lists: intensity highest wins, colour latest wins', () => {
    const r = rig([fx('a', 'gen-drgb', 1)], [list('A', [cue({ a: { intensity: 0.4, color: { r: 1, g: 0, b: 0 } } })]),
                                              list('B', [cue({ a: { intensity: 0.8, color: { r: 0, g: 0, b: 1 } } })])]);
    r.e.go('A'); out(r, 0); r.e.go('B');
    expect(out(r, 0, 4)).toEqual([204, 0, 0, 255]);
    r.e.go('A');                                    // A moves again: its colour is now the latest
    expect(out(r, 0, 4)).toEqual([204, 0, 0, 255]); // (A at its last cue, stop list: nothing moves)
    r.e.jumpTo('A', 0);
    expect(out(r, 0, 4)).toEqual([204, 255, 0, 0]);
  });

  it('a high-priority list beats a newer normal one', () => {
    const r = rig([fx('a', 'gen-drgb', 1)], [list('house', [cue({ a: red })], { priority: 'high' }), list('show', [cue({ a: blue })])]);
    r.e.go('house'); out(r, 0); r.e.go('show');
    expect(out(r, 0, 4)).toEqual([255, 255, 0, 0]);
  });

  it('a jump back shows that cue as it plays from the top, not its changes over what is on now', () => {
    // cue 1: a red; cue 2: b on; cue 3: a blue and b off... jumping from 3 back to 2 must show a red, b on
    const r = rig([fx('a', 'gen-drgb', 1), fx('b', 'gen-dimmer', 5)], [list('L', [
      cue({ a: { intensity: 1, color: { r: 1, g: 0, b: 0 } } }),
      cue({ b: { intensity: 1 } }),
      cue({ a: { color: { r: 0, g: 0, b: 1 } }, b: { intensity: 0 } }),
    ], { play: true })]);
    r.e.jumpTo('L', 2); out(r, 0);
    expect(out(r, 0.1, 5)).toEqual([255, 0, 0, 255, 0]);
    r.e.jumpTo('L', 1);
    expect(out(r, 0.2, 5)).toEqual([255, 255, 0, 0, 255]);
  });

  it('a light only a later cue set goes out when the list jumps back before it', () => {
    const r = rig([fx('a', 'gen-dimmer', 1), fx('b', 'gen-dimmer', 2)], [list('L', [cue({ a: { intensity: 1 } }), cue({ b: { intensity: 1 } })], { play: true })]);
    r.e.jumpTo('L', 1); out(r, 0);
    expect(out(r, 0.1, 2)).toEqual([255, 255]);
    r.e.jumpTo('L', 0);
    expect(out(r, 0.2, 2)).toEqual([255, 0]);
  });

  it('a second GO during a fade: lights the new cue leaves alone finish where they were going', () => {
    // cue 1 a red; cue 2 a yellow over 4 s; cue 3 only b. GO GO quickly: a ends yellow, not stuck orange
    const r = rig([fx('a', 'gen-drgb', 1), fx('b', 'gen-dimmer', 5)], [list('L', [
      cue({ a: { intensity: 1, color: { r: 1, g: 0, b: 0 } } }),
      cue({ a: { color: { r: 1, g: 1, b: 0 } } }, 4),
      cue({ b: { intensity: 1 } }, 2),
    ])]);
    r.e.go('L'); out(r, 0);
    r.e.go('L'); out(r, 1);                 // cue 2 a quarter of the way
    r.e.go('L'); out(r, 1.25);              // cue 3 right after
    expect(out(r, 4, 5)).toEqual([255, 255, 255, 0, 255]);
  });

  it('each light keeps its own fade: a quick cue in the middle of a long one leaves the long one alone', () => {
    const r = rig([fx('a', 'gen-dimmer', 1), fx('b', 'gen-dimmer', 2)], [list('L', [
      cue({ a: { intensity: 0 } }),
      cue({ a: { intensity: 1 } }, 10),                 // a 10 s sunrise
      cue({ b: { intensity: 1 } }, 0),                  // a snap on another light, 1 s into it
      cue({ b: { intensity: 0.5 } }, 0, { delay: 3 }),  // and one with a delay
    ])]);
    r.e.go('L'); out(r, 0);
    r.e.go('L'); out(r, 0);
    r.e.go('L'); out(r, 1);
    const at2 = out(r, 2, 2);
    expect(at2[0]).toBeGreaterThan(40); expect(at2[0]).toBeLessThan(62);   // ~20%: still rising, no snap to full
    expect(at2[1]).toBe(255);
    r.e.go('L'); out(r, 2);
    const at4 = out(r, 4, 2);                                                // the delayed cue waits; the sunrise doesn't
    expect(at4[0]).toBeGreaterThan(90); expect(at4[0]).toBeLessThan(115);
    expect(at4[1]).toBe(255);
  });

  it('back to a cue switches off a level that only a later cue set (an earlier cue set the colour)', () => {
    const r = rig([fx('a', 'gen-drgb', 1)], [list('L', [
      cue({ a: { color: { r: 1, g: 0, b: 0 } } }),
      cue({ a: { intensity: 1 } }),
    ], { end: 'loop', play: true })]);
    r.e.go('L'); out(r, 0); r.e.go('L'); out(r, 0.1);
    expect(out(r, 0.2, 4)[0]).toBe(255);
    r.e.back('L');
    expect(out(r, 0.3, 4)[0]).toBe(0);
    r.e.go('L'); out(r, 0.4); r.e.go('L');                                 // round the loop to cue 1 again
    expect(out(r, 0.5, 4)[0]).toBe(0);
  });

  it('in a list of looks a look sets what it names: back or out of order, the rest stays as it is', () => {
    const r = rig([fx('a', 'gen-dimmer', 1), fx('b', 'gen-dimmer', 2)], [list('L', [cue({ a: { intensity: 1 } }), cue({ b: { intensity: 1 } }), cue({ a: { intensity: 0.5 } })])]);
    r.e.jumpTo('L', 1); expect(out(r, 0.1, 2)).toEqual([0, 255]);         // "Hall": only b (no a from the look before it)
    r.e.jumpTo('L', 0); expect(out(r, 0.2, 2)).toEqual([255, 255]);       // a on, b stays
    r.e.jumpTo('L', 2); expect(out(r, 0.3, 2)).toEqual([128, 255]);
  });

  it('fog and haze run only in the cue that sets them', () => {
    const r = rig([fx('h', 'gen-fog', 1), fx('d', 'gen-dimmer', 2)], [list('L', [
      cue({ h: { fog: 1 } }), cue({ d: { intensity: 1 } }), cue({ h: { fog: 0.5 } }),
    ])]);
    r.e.go('L'); expect(out(r, 0.1, 2)[0]).toBe(255);
    r.e.go('L'); expect(out(r, 0.2, 2)).toEqual([0, 255]);
    r.e.go('L'); expect(out(r, 0.3, 2)[0]).toBe(128);
    r.e.back('L'); expect(out(r, 0.4, 2)[0]).toBe(0);                     // back past the haze cue: off
  });

  it('a light a list let go of stops holding its colour over the list underneath', () => {
    const r = rig([fx('a', 'gen-drgb', 1)], [
      list('W', [cue({ a: { intensity: 1, color: { r: 0, g: 0, b: 1 } } })]),
      list('X', [cue({}), cue({ a: { intensity: 1, color: { r: 1, g: 0, b: 0 } } })], { play: true }),
    ]);
    r.e.go('W'); out(r, 0);
    r.e.go('X'); out(r, 0.1); r.e.go('X'); out(r, 0.2);
    expect(out(r, 0.3, 4)).toEqual([255, 255, 0, 0]);                      // the accent: red
    r.e.back('X');
    out(r, 0.4);
    expect(out(r, 0.5, 4)).toEqual([255, 0, 0, 255]);                      // the wash's blue again, not a red left behind
  });

  it('a light coming up from dark takes its colour at once: only its level fades (no detour through white)', () => {
    const r = rig([fx('p', 'gen-drgbw', 1)], [list('L', [cue({ p: { intensity: 1, color: { r: 1, g: 0.6, b: 0.2 }, white: 0 } }, 4)])]);
    out(r, 0);
    r.e.go('L');
    const q = out(r, 1, 5);                                                // a quarter of the way
    expect(q[0]).toBeGreaterThan(50); expect(q[0]).toBeLessThan(80);
    expect(q[4]).toBe(0);                                                  // the white LED stays off
    expect(q[1]).toBe(255);                                                // the colour is there already
  });

  it('a change to an earlier cue shows at once on the cue on stage that inherits it', () => {
    const r = rig([fx('a', 'gen-dimmer', 1)], [list('L', [cue({ a: { intensity: 0.5 } }), cue({})], { play: true })]);
    r.e.go('L'); out(r, 0); r.e.go('L');
    expect(out(r, 0.1, 1)).toEqual([128]);
    r.show.cueLists[0].cues[0].values.a = { intensity: 1 };
    r.e.refresh('L');
    expect(out(r, 0.2, 1)).toEqual([255]);
  });

  it('release fades back to what is underneath', () => {
    const r = rig([fx('a', 'gen-drgb', 1)], [list('A', [cue({ a: { intensity: 0.5, color: { r: 1, g: 0, b: 0 } } })]),
                                              list('B', [cue({ a: { intensity: 1, color: { r: 0, g: 0, b: 1 } } })], { releaseTime: 2 })]);
    r.e.go('A'); out(r, 0); r.e.go('B'); out(r, 0);
    r.e.release('B');
    expect(out(r, 1, 4)).toEqual([128, 128, 0, 128]);   // halfway: intensity max(0.5, 1*0.5), colour half way back
    expect(out(r, 2.01, 4)).toEqual([128, 255, 0, 0]);
    expect(r.e.status('B').running).toBe(false);
  });

  it('list master scales its intensity, grand master and blackout scale everything', () => {
    const r = rig([fx('a', 'gen-dimmer', 1)], [list('L', [cue({ a: { intensity: 1 } })])]);
    r.e.go('L'); r.e.setMaster('L', 0.5);
    expect(out(r, 0, 1)).toEqual([128]);
    r.e.grandMaster = 0.5;
    expect(out(r, 0, 1)).toEqual([64]);
    r.e.blackout = true;
    expect(out(r, 0, 1)).toEqual([0]);
  });

  it('the programmer sits on top', () => {
    const r = rig([fx('a', 'gen-drgb', 1)], [list('L', [cue({ a: red })])]);
    r.e.go('L');
    r.e.programmer = { a: { color: { r: 0, g: 1, b: 0 } } };
    expect(out(r, 0, 4)).toEqual([255, 0, 255, 0]);
  });

  it('wait, follow and beats advance on their own; loop and release at the end', () => {
    const r = rig([fx('a', 'gen-dimmer', 1)], [list('L', [
      cue({ a: { intensity: 0.2 } }, 0, { advance: { mode: 'wait', time: 1 } }),
      cue({ a: { intensity: 0.4 } }, 1, { advance: { mode: 'follow', time: 1 } }),
      cue({ a: { intensity: 0.6 } }, 0, { advance: { mode: 'beats', beats: 2 } }),
    ], { end: 'loop' })]);
    r.e.bpm = 120;                                  // 2 beats = 1 s
    r.e.go('L');
    expect(r.e.status('L').index).toBe(0);
    out(r, 1.01); expect(r.e.status('L').index).toBe(1);   // wait 1 s from cue start
    out(r, 2.5); expect(r.e.status('L').index).toBe(1);    // fade 1 s + follow 1 s = 3.01
    out(r, 3.02); expect(r.e.status('L').index).toBe(2);
    out(r, 4.03); expect(r.e.status('L').index).toBe(0);   // 2 beats at 120 bpm, then loop
    r.show.cueLists[0].end = 'release';
    out(r, 5.04); out(r, 7.06); out(r, 8.07);              // through cues 1, 2 to the end
    out(r, 11);
    expect(r.e.status('L').running).toBe(false);
  });

  it('a cue can start and release other lists', () => {
    const r = rig([fx('a', 'gen-dimmer', 1), fx('b', 'gen-dimmer', 2)], [
      list('house', [cue({ a: { intensity: 0.1 } }, 0, { actions: [{ do: 'start', list: 'pre' }] })]),
      list('pre', [cue({ b: { intensity: 1 } })]),
    ]);
    r.e.go('house');
    expect(out(r, 0, 2)).toEqual([26, 255]);
    r.show.cueLists[0].cues[0].actions = [{ do: 'release', list: 'pre' }];
    r.e.jumpTo('house', 0);
    out(r, 3);
    expect(r.e.status('pre').running).toBe(false);
  });

  it('flash is full at once and gone on release', () => {
    const r = rig([fx('a', 'gen-dimmer', 1)], [list('L', [cue({ a: { intensity: 1 } }, 5)])]);
    r.e.flash('L', true);
    expect(out(r, 0, 1)).toEqual([255]);
    r.e.flash('L', false);
    expect(out(r, 0, 1)).toEqual([0]);
  });

  it('toggle starts and releases', () => {
    const r = rig([fx('a', 'gen-dimmer', 1)], [list('L', [cue({ a: { intensity: 1 } })], { releaseTime: 0 })]);
    r.e.toggle('L'); expect(r.e.isOn('L')).toBe(true);
    r.e.toggle('L'); out(r, 0.01); expect(r.e.isOn('L')).toBe(false);
  });
});

// ------------------------------------------------------------------ review fixes (2026-10-27)
describe('engine, after the review', () => {
  it('a blackout cue action holds (the engine owns blackout)', () => {
    const r = rig([fx('d', 'gen-dimmer', 1)], [list('l', [cue({ d: { intensity: 1 } }, 0, { actions: [{ do: 'blackout', on: true }] })])]);
    r.e.go('l');
    expect(out(r, 0.1, 1)).toEqual([0]);
    expect(out(r, 0.5, 1)).toEqual([0]);
    expect(r.e.blackout).toBe(true);
  });
  it('raw channel values follow the grand master, blackout and a release', () => {
    const r = rig([fx('p', 'gen-drgb', 1)], [list('l', [cue({ p: { raw: { 0: 255, 1: 200 } } })], { releaseTime: 2 })]);
    r.e.go('l');
    expect(out(r, 0.1, 2)).toEqual([255, 200]);
    r.e.grandMaster = 0.5;
    expect(out(r, 0.2, 2)).toEqual([128, 100]);
    r.e.grandMaster = 1; r.e.blackout = true;
    expect(out(r, 0.3, 2)).toEqual([0, 0]);
    r.e.blackout = false;
    r.e.release('l');
    const mid = out(r, 1.3, 1)[0];
    expect(mid).toBeGreaterThan(80); expect(mid).toBeLessThan(180);
    expect(out(r, 2.5, 1)).toEqual([0]);
  });
  it('GO after deleting the live cue plays what took its place, not one further', () => {
    const cues = [1, 2, 3, 4, 5].map((n) => cue({ d: { intensity: n / 10 } }, 0, { id: `c${n}` }));
    const r = rig([fx('d', 'gen-dimmer', 1)], [list('l', cues)]);
    r.e.jumpTo('l', 2);                                  // c3 live
    r.show.cueLists[0].cues.splice(1, 1);                // delete c2: c3 is now index 1
    r.e.go('l');
    expect(out(r, 0.1, 1)).toEqual([102]);               // c4 (0.4)
    r.show.cueLists[0].cues.splice(2, 1);                // delete the live c4
    r.e.go('l');
    expect(out(r, 0.2, 1)).toEqual([128]);               // c5, which took its place
  });
  it('a list starting on top of another fades pan and colour from what is on stage', () => {
    const r = rig([fx('m', 'gen-mover8', 1)], [
      list('a', [cue({ m: { intensity: 1, pan: 0.2, color: { r: 1, g: 0, b: 0 } } })]),
      list('b', [cue({ m: { intensity: 1, pan: 0.8, color: { r: 0, g: 0, b: 1 } } }, 4)]),
    ]);
    r.e.go('a'); out(r, 0.1);
    r.e.go('b');
    const half = r.at(2.1).stage.m;
    expect(half.pan!).toBeGreaterThan(0.4); expect(half.pan!).toBeLessThan(0.6);
    expect(half.color!.r).toBeGreaterThan(0.3);
    expect(r.at(4.2).stage.m.pan).toBeCloseTo(0.8);
  });
  it('the live cue shows an update or a preset change at once', () => {
    const p: Preset = { id: 'red', name: 'Red', kind: 'color', values: { color: { r: 1, g: 0, b: 0 } } };
    const r = rig([fx('p', 'gen-drgb', 1)], [list('l', [cue({ p: { intensity: 1, color: { preset: 'red' } } })])], [p]);
    r.e.go('l');
    expect(out(r, 0.1, 4)).toEqual([255, 255, 0, 0]);
    p.values.color = { r: 0, g: 1, b: 0 };
    r.e.refresh();
    expect(out(r, 0.2, 4)).toEqual([255, 0, 255, 0]);
  });
  it('lists that start each other in a circle stop instead of overflowing', () => {
    const r = rig([fx('d', 'gen-dimmer', 1)], [
      list('a', [cue({ d: { intensity: 1 } }, 0, { actions: [{ do: 'go', list: 'b' }] })]),
      list('b', [cue({}, 0, { actions: [{ do: 'go', list: 'a' }] })]),
    ]);
    expect(() => r.e.go('a')).not.toThrow();
  });
  it('a flash does not run the actions of the first cue', () => {
    const r = rig([fx('d', 'gen-dimmer', 1)], [list('l', [cue({ d: { intensity: 1 } }, 0, { actions: [{ do: 'blackout', on: true }] })])]);
    r.e.flash('l', true);
    expect(out(r, 0.1, 1)).toEqual([255]);
    r.e.flash('l', false);
    expect(r.e.blackout).toBe(false);
  });
  it('restart: resume picks up where the list stopped', () => {
    const cues = [1, 2, 3].map((n) => cue({ d: { intensity: n / 4 } }));
    const r = rig([fx('d', 'gen-dimmer', 1)], [list('l', cues, { restart: 'resume', releaseTime: 0 })]);
    r.e.go('l'); r.e.go('l');
    r.e.release('l'); out(r, 0.1);
    r.e.start('l');
    expect(out(r, 0.2, 1)).toEqual([128]);
  });
});

describe('engine, after the second review', () => {
  it('setting one raw channel by hand keeps the other raw channels of the cue', () => {
    const r = rig([fx('p', 'gen-drgb', 1)], [list('l', [cue({ p: { raw: { 1: 40, 2: 90 } } })])]);
    r.e.go('l');
    expect(out(r, 0.1, 4).slice(1, 3)).toEqual([40, 90]);
    r.e.programmer = { p: { raw: { 3: 120 } } };
    expect(out(r, 0.2, 4).slice(1, 4)).toEqual([40, 90, 120]);
  });
  it('Record stores the intensity before the list level', () => {
    const r = rig([fx('d', 'gen-dimmer', 1)], [list('l', [cue({ d: { intensity: 1 } })])]);
    r.e.go('l');
    r.e.setMaster('l', 0.5);
    const f = r.at(0.1);
    expect(f.frames.get(0)![0]).toBe(128);              // the output follows the level
    expect(f.look.d.intensity).toBe(1);                 // what Record would store doesn't
  });
  it('a cue that waits 0 s still steps no faster than every 50 ms', () => {
    const cues = [0, 1].map((n) => cue({ d: { intensity: n } }, 0, { advance: { mode: 'wait', time: 0 } }));
    const r = rig([fx('d', 'gen-dimmer', 1)], [list('l', cues, { end: 'loop' })]);
    r.e.go('l');
    let flips = 0, last = -1;
    for (let t = 0.025; t <= 1.0001; t += 0.025) { const v = out(r, t, 1)[0]; if (last >= 0 && v !== last) flips++; last = v; }
    expect(flips).toBeLessThanOrEqual(21);
  });
});

describe('deleting the cue on stage', () => {
  it('stops the effects only that cue ran, and keeps the look', () => {
    const s = emptyShow();
    s.fixtures = [{ id: 'p', name: 'P', typeId: 'gen-rgb', mode: '', universe: 0, address: 1, x: 0.5, y: 0.5 }];
    s.effects = [{ id: 'rb', name: 'Rainbow', kind: 'rainbow', fixtures: ['p'], params: {} }];
    s.cueLists = [{ id: 'l', name: 'L', end: 'stop', cues: [
      { id: 'a', name: 'A', values: { p: { intensity: 1, color: { r: 1, g: 0, b: 0 } } }, fade: 0, advance: { mode: 'manual' } },
      { id: 'b', name: 'B', values: {}, effects: ['rb'], fade: 0, advance: { mode: 'manual' } },
    ] }];
    let t = 0;
    const e = new Engine(() => s, () => t);
    e.jumpTo('l', 0); t = 0.1; e.tick();
    e.jumpTo('l', 1); t = 1; e.tick();
    expect(e.fxWeights.get('rb')).toBeGreaterThan(0);
    s.cueLists[0].cues.splice(1, 1);                   // cut the cue that runs the rainbow
    t = 1.1; e.tick(); t = 1.2;
    const f = e.tick().frames.get(0)!;
    expect(e.fxWeights.get('rb') ?? 0).toBe(0);
    expect([...f.slice(0, 3)]).toEqual([255, 0, 0]);
  });
});

// ------------------------------------------------------------------ round 10 review
describe('fades of lists that set colour or position, not the level', () => {
  it('a colour layer over another list\'s light fades its colour (the light is lit on stage, not dark)', () => {
    const r = rig([fx('a', 'gen-drgb', 1)], [
      list('W', [cue({ a: { intensity: 1 } })]),
      list('C', [cue({ a: { color: { r: 1, g: 0, b: 0 } } }), cue({ a: { color: { r: 0, g: 0, b: 1 } } }, 4)]),
    ]);
    r.e.go('W'); out(r, 0); r.e.go('C'); out(r, 0.1);
    expect(out(r, 0.2, 4)).toEqual([255, 255, 0, 0]);
    r.e.go('C');
    const q = out(r, 1.2, 4);                          // a quarter of the way to blue
    expect(q[1]).toBeGreaterThan(150); expect(q[3]).toBeLessThan(100);
    expect(out(r, 5, 4)).toEqual([255, 0, 0, 255]);
  });
  it('a position list moves a lit mover with the fade, a dark one at once', () => {
    const r = rig([fx('m', 't-mov', 1, 0, { mode: 'default' })]);
    r.show.fixtureTypes.push({ id: 't-mov', manufacturer: 'X', model: 'Mover', source: 'user', modes: [{ name: 'default', channels: [{ name: 'Dim', attr: 'intensity' }, { name: 'Pan', attr: 'pan' }] }] } as never);
    r.show.cueLists.push(list('W', [cue({ m: { intensity: 1 } })]), list('P', [cue({ m: { pan: 0 } }), cue({ m: { pan: 1 } }, 4), cue({ m: { pan: 0 } }, 4)]));
    r.e.go('W'); out(r, 0); r.e.go('P'); out(r, 0.1);
    r.e.go('P');
    expect(out(r, 1.2, 2)[1]).toBeGreaterThan(40); expect(out(r, 1.2, 2)[1]).toBeLessThan(90);   // ~64: moving
    out(r, 5); r.e.release('W'); out(r, 5.1); out(r, 8);  // the light goes dark
    r.e.go('P');
    expect(out(r, 8.2, 2)[1]).toBe(0);                 // dark: it's moved before it comes up again
  });
});

describe('refresh keeps what a jump switched off', () => {
  it('a light Back switched off stays off when the list is refreshed (Update, a preset edit)', () => {
    const r = rig([fx('a', 'gen-drgb', 1)], [list('L', [cue({ a: { color: { r: 1, g: 0, b: 0 } } }), cue({ a: { intensity: 1 } })], { play: true })]);
    r.e.go('L'); out(r, 0); r.e.go('L'); out(r, 0.1);
    expect(out(r, 0.2)[0]).toBe(255);
    r.e.back('L'); expect(out(r, 0.3)[0]).toBe(0);
    r.e.refresh('L');
    expect(out(r, 0.4)[0]).toBe(0);
  });
  it('a cue jumped to with only its own values stays that way after a refresh', () => {
    const l = list('L', [cue({ a: { intensity: 1 } }), cue({ b: { intensity: 0.5 } })]);
    const r = rig([fx('a', 'gen-dimmer', 1), fx('b', 'gen-dimmer', 2)], [l]);
    r.e.jumpTo('L', 1, 0, false, true);                // exact: only b
    expect(out(r, 0.1, 2)).toEqual([0, 128]);
    l.cues[1].values.b = { intensity: 0.6 };
    r.e.refresh('L');
    expect(out(r, 0.2, 2)).toEqual([0, 153]);          // b updated, a didn't pop on
  });
});

describe('effects in a list of looks', () => {
  it('an effect on lights the next look doesn\'t name keeps running; one on lights it names gives way', () => {
    const r = rig([fx('m', 'gen-dimmer', 1), fx('p', 'gen-dimmer', 2)], [list('L', [
      cue({ m: { intensity: 1 }, p: { intensity: 1 } }, 0, { effects: ['swing'] }),
      cue({ p: { intensity: 0.5 } }),
      cue({ m: { intensity: 0.2 } }),
    ])]);
    r.show.effects.push({ id: 'swing', name: 'Swing', kind: 'pulse', fixtures: ['m'], params: {} } as never);
    r.e.jumpTo('L', 0, 0); out(r, 0.1);
    r.e.jumpTo('L', 1, 0); out(r, 0.2);
    expect(r.e.status('L').running).toBe(true);
    expect((r.e as any).players.get('L').effects(0.3).get('swing')).toBe(1);     // still on: "Green" doesn't name the mover
    r.e.jumpTo('L', 2, 0); out(r, 0.4);
    expect((r.e as any).players.get('L').effects(0.5).get('swing') ?? 0).toBe(0); // a look that names it: it stops
  });
});

describe('haze all night', () => {
  it('a haze list keeps hazing whatever the moods say about fog (highest wins, like intensity)', () => {
    const r = rig([fx('h', 'gen-fog', 1), fx('p', 'gen-dimmer', 2)], [
      list('haze', [cue({ h: { fog: 0.3 } })]),
      list('moods', [cue({ h: { fog: 1 }, p: { intensity: 1 } }), cue({ p: { intensity: 0.5 } })]),
    ]);
    r.e.jumpTo('moods', 0, 0); out(r, 0.1);
    r.e.go('haze'); out(r, 0.2);
    expect(out(r, 0.3, 2)[0]).toBe(255);                   // the mood's fog burst on top
    r.e.jumpTo('moods', 1, 0);
    expect(out(r, 0.4, 2)).toEqual([77, 128]);             // the next mood stops its own fog, the haze list goes on
  });
});

describe('a look tapped while its list fades out', () => {
  // A over B: B fades out (red to A's blue, purple halfway), then a look of B is tapped
  const setup = (hallNamesP: boolean) => {
    const red = cue({ p: { intensity: 1, color: { r: 1, g: 0, b: 0 } } });
    const hall = cue({ q: { intensity: 1 }, ...(hallNamesP ? { p: { intensity: 1, color: { r: 0, g: 1, b: 0 } } } : {}) }, 4);
    const r = rig([fx('p', 'gen-drgb', 1), fx('q', 'gen-dimmer', 10)], [
      list('A', [cue({ p: { intensity: 1, color: { r: 0, g: 0, b: 1 } } })]),
      list('B', [red, hall], { releaseTime: 2 }),
    ]);
    r.e.jumpTo('A', 0, 0); r.at(0.05);
    r.e.jumpTo('B', 0, 0); r.at(0.1);
    r.e.release('B');
    const before = r.at(1.1).stage.p.color!;
    expect(before.r).toBeGreaterThan(0.3); expect(before.b).toBeGreaterThan(0.3);   // purple
    r.e.jumpTo('B', 1);
    return { r, before };
  };
  it('a light the look doesn\'t name goes on fading to what\'s underneath (no pop back to red)', () => {
    const { r, before } = setup(false);
    const after = r.at(1.15).stage.p.color!;
    expect(Math.abs(after.r - before.r)).toBeLessThan(0.08);
    expect(r.at(3).stage.p.color!.b).toBeGreaterThan(0.6);                          // on its way to blue
    expect(r.at(5.5).stage.p.color).toEqual({ r: 0, g: 0, b: 1 });
  });
  it('a light the look names fades from the purple on stage to its colour', () => {
    const { r, before } = setup(true);
    const after = r.at(1.15).stage.p.color!;
    expect(Math.abs(after.r - before.r)).toBeLessThan(0.08);
    expect(Math.abs(after.b - before.b)).toBeLessThan(0.08);
    expect(r.at(5.5).stage.p.color).toEqual({ r: 0, g: 1, b: 0 });
  });
});

describe('kept effects follow later edits', () => {
  const setup = () => {
    const a = cue({ m: { intensity: 1, pan: 0.5 } }, 0, { effects: ['circle'] }), b = cue({ p: { intensity: 1 } }), c = cue({ q: { intensity: 1 } });
    const r = rig([fx('m', 'gen-mover8', 1), fx('p', 'gen-dimmer', 20), fx('q', 'gen-dimmer', 21)], [list('L', [a, b, c])]);
    r.show.effects.push({ id: 'circle', name: 'Circle', kind: 'circle', fixtures: ['m'], params: {} } as never);
    r.e.jumpTo('L', 0, 0); r.at(0.1);
    return { r, p: (r.e as any).players.get('L') };
  };
  it('the look on stage updated to name the mover: the kept circle gives way to its position', () => {
    const { r, p } = setup();
    r.e.jumpTo('L', 1, 0); r.at(0.2);
    expect(p.effects(0.3).get('circle')).toBe(1);                  // kept: "b" doesn't name the mover
    r.show.cueLists[0].cues[1].values.m = { intensity: 1, pan: 0.1, tilt: 0.1 };
    r.e.refresh('L');
    expect(p.effects(0.4).get('circle')).toBeUndefined();
    expect(r.at(0.6).stage.m.pan).toBeCloseTo(0.1, 2);
  });
  it('deleting the look on stage keeps the circle that was kept, and a refresh agrees', () => {
    const { r, p } = setup();
    r.e.jumpTo('L', 2, 0); r.at(0.2);
    r.show.cueLists[0].cues.splice(2, 1);
    r.at(0.4);
    expect(p.effects(0.5).get('circle')).toBe(1);
    r.e.refresh('L');
    expect(p.effects(0.7).get('circle')).toBe(1);
  });
});

describe('a haze list master', () => {
  it('turns the haze down like a level', () => {
    const r = rig([fx('h', 'gen-hazer', 1)], [list('H', [cue({ h: { haze: 0.8 } })])]);
    r.e.jumpTo('H', 0, 0);
    expect(r.at(0.1).stage.h.haze).toBeCloseTo(0.8, 3);
    r.e.setMaster('H', 0.5);
    expect(r.at(0.2).stage.h.haze).toBeCloseTo(0.4, 3);
  });
});

describe('a strobing flash on lights without a strobe channel', () => {
  it('blinks their level (a pixel bar, a plain dimmer); a light with a strobe channel gets its strobe', () => {
    const r = rig([fx('b', 'gen-bar8', 1), fx('d', 'gen-dimmer', 30), fx('s', 'gen-drgbws', 40)]);
    r.e.live = { b: { intensity: 1, color: { r: 1, g: 1, b: 1 }, strobe: 0.8 }, d: { intensity: 1, strobe: 0.8 }, s: { intensity: 1, strobe: 0.8 } };
    const seen = { b: new Set<number>(), d: new Set<number>(), s: new Set<number>() };
    for (let i = 0; i < 40; i++) {
      const f = r.at(1 + i * 0.025).frames.get(0)!;
      seen.b.add(f[0]); seen.d.add(f[29]); seen.s.add(f[39]);
    }
    expect([...seen.b].sort()).toEqual([0, 255]);
    expect([...seen.d].sort()).toEqual([0, 255]);
    expect([...seen.s]).toEqual([255]);                 // its own strobe channel does it, the level stays
  });
});

describe('Lightning', () => {
  it('strikes white over a dark blue look and leaves the look as it is between strikes', () => {
    const r = rig([fx('p', 'gen-drgb', 1)], [list('L', [cue({ p: { intensity: 0.4, color: { r: 0.1, g: 0, b: 0.6 } } })])]);
    r.show.effects.push({ id: 'z', name: 'Lightning', kind: 'lightning', fixtures: ['p'], params: { size: 1, speed: 4 } } as never);
    r.e.jumpTo('L', 0, 0);
    r.e.startEffect('z');
    let dark = 0, white = 0, black = 0;
    for (let i = 0; i < 400; i++) {
      const s = r.at(0.5 + i * 0.01).stage.p;
      if ((s.intensity ?? 0) < 0.05) black++;
      else if ((s.color?.r ?? 0) > 0.9 && (s.intensity ?? 0) > 0.9) white++;
      else if (Math.abs((s.intensity ?? 0) - 0.4) < 0.01 && (s.color?.b ?? 0) > 0.55) dark++;
    }
    expect(black).toBe(0);
    expect(white).toBeGreaterThan(0);
    expect(dark).toBeGreaterThan(200);
  });
});
