// Single cells of a light (Values.cells): a pixel bar's cells, a ring's LEDs, set one by one in cues
// and the programmer, tracked through a play, mixed across lists, under effects and the live layer.
import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { cellsOf, lerpResolved, overlay, resolveValues } from './resolve';
import { cueLooks, lookColor, wholeLook } from './cuelook';
import { renderFixture } from './render';
import { emptyShow, upgrade } from '../model/format';
import type { Cue, CueList, Fixture, FixtureType, Preset, Show } from '../model/types';

const fx = (id: string, typeId: string, address: number, universe = 0): Fixture =>
  ({ id, name: id, typeId, mode: '', universe, address, x: 0, y: 0 });
const cue = (values: Cue['values'], fade = 0, extra: Partial<Cue> = {}): Cue =>
  ({ id: Math.random().toString(36).slice(2), name: 'c', values, fade, advance: { mode: 'manual' }, ...extra });
const list = (id: string, cues: Cue[], extra: Partial<CueList> = {}): CueList => ({ id, name: id, cues, end: 'stop', play: true, ...extra });
// a bar with a master dimmer and 4 RGB cells: Dim, R1 G1 B1, ..., R4 G4 B4
const BAR4: FixtureType = { id: 't-bar4', manufacturer: 'X', model: 'Bar 4', source: 'user', modes: [{ name: 'm', channels: [
  { name: 'Dim', attr: 'intensity' },
  ...[0, 1, 2, 3].flatMap((c) => [{ name: `R${c}`, attr: 'red' as const, cell: c }, { name: `G${c}`, attr: 'green' as const, cell: c }, { name: `B${c}`, attr: 'blue' as const, cell: c }]),
] }] };

function rig(fixtures: Fixture[], lists: CueList[] = [], presets: Preset[] = []) {
  const show: Show = { ...emptyShow(), fixtures, cueLists: lists, presets };
  show.fixtureTypes.push(BAR4);
  let t = 0;
  const e = new Engine(() => show, () => t);
  return { show, e, at: (s: number) => { t = s; return e.tick(); } };
}
const dmx = (r: ReturnType<typeof rig>, t: number, n: number, u = 0) => [...r.at(t).frames.get(u)!.slice(0, n)];
// gen-bar8: 8 RGB cells, no dimmer (cell k is channels 3k .. 3k+2)
const cellOf = (b: number[], k: number) => b.slice(3 * k, 3 * k + 3);
const RED = { r: 1, g: 0, b: 0 }, BLUE = { r: 0, g: 0, b: 1 }, GREEN = { r: 0, g: 1, b: 0 };

describe('cell values resolve and add up', () => {
  it('resolve presets inside cells, for that light', () => {
    const p: Preset = { id: 'p', name: 'Red', kind: 'color', values: { color: RED }, perFixture: { b: { color: GREEN } } };
    const r = resolveValues({ intensity: 1, cells: { 2: { color: { preset: 'p' } }, 5: { intensity: 0.5 } } }, 'a', new Map([['p', p]]));
    expect(r.cellVals).toEqual({ 2: { color: RED }, 5: { intensity: 0.5 } });
    expect(resolveValues({ cells: { 0: { color: { preset: 'p' } } } }, 'b', new Map([['p', p]])).cellVals).toEqual({ 0: { color: GREEN } });
    // a cell's channels or nested cells mean nothing
    expect(resolveValues({ cells: { 0: { raw: { 1: 9 }, cells: {} } as never } }, 'a', new Map()).cellVals).toBeUndefined();
  });
  it('a later cue adds cells and channels to an earlier one; a whole-light value takes the cells with it', () => {
    const a = { intensity: 1, raw: { 3: 50 }, cellVals: { 1: { color: RED }, 2: { color: RED, intensity: 0.2 } } };
    const b = { raw: { 7: 9 }, cellVals: { 4: { color: BLUE } } };
    expect(overlay(a, b)).toEqual({ intensity: 1, raw: { 3: 50, 7: 9 }, cellVals: { 1: { color: RED }, 2: { color: RED, intensity: 0.2 }, 4: { color: BLUE } } });
    // "all green" over cells that were red: they're green too (their own levels stay)
    expect(overlay(a, { color: GREEN })).toEqual({ intensity: 1, color: GREEN, raw: { 3: 50 }, cellVals: { 2: { intensity: 0.2 } } });
  });
  it('fades a cell from what it showed to what the next look gives it', () => {
    const a = { intensity: 1, color: BLUE, cellVals: { 0: { color: RED } } };
    const b = { intensity: 1, color: BLUE };        // cell 0 isn't named any more: it goes to the light's blue
    const mid = lerpResolved(a, b, 0.5);
    expect(mid.cellVals![0].color).toEqual({ r: 0.5, g: 0, b: 0.5 });
    expect(lerpResolved(a, b, 1).cellVals![0].color).toEqual(BLUE);
    // a look that doesn't touch the colour at all leaves the cell's own
    expect(lerpResolved(a, { pan: 0.3 }, 1).cellVals![0].color).toEqual(RED);
    // coming from a light without cells: from the light's own level
    expect(lerpResolved({ intensity: 0.2 }, { cellVals: { 3: { intensity: 1 } } }, 0.5).cellVals![3].intensity).toBeCloseTo(0.6);
  });
  it('the cue cards track cells through a play', () => {
    const l = list('l', [cue({ b: { intensity: 1, cells: { 0: { color: RED } } } }), cue({ b: { cells: { 7: { color: BLUE } } } })]);
    const looks = cueLooks(l, new Map());
    expect(looks[1].b.cellVals).toEqual({ 0: { color: RED }, 7: { color: BLUE } });
  });
});

describe('cells on the wire', () => {
  it('a cue lights only the cells it names, in their colours', () => {
    const r = rig([fx('b', 'gen-bar8', 1)], [list('l', [cue({ b: { intensity: 0, color: BLUE, cells: { 0: { intensity: 1, color: RED }, 7: { intensity: 0.5 } } } })])]);
    r.e.go('l');
    const b = dmx(r, 0.1, 24);
    expect(cellOf(b, 0)).toEqual([255, 0, 0]);
    expect(cellOf(b, 1)).toEqual([0, 0, 0]);
    expect(cellOf(b, 7)).toEqual([0, 0, 128]);     // its level, the light's blue
  });
  it('with a master dimmer: the dimmer carries the brightest cell, each cell the rest', () => {
    const r = rig([fx('d', 't-bar4', 1)], [list('l', [cue({ d: { intensity: 0.5, color: BLUE, cells: { 1: { intensity: 1, color: RED } } } })])]);
    r.e.go('l');
    const b = dmx(r, 0.1, 13);
    expect(b[0]).toBe(255);
    expect(b.slice(1, 4)).toEqual([0, 0, 128]);     // cell 0: half of full, blue
    expect(b.slice(4, 7)).toEqual([255, 0, 0]);     // cell 1: full red
  });
  it('tracks through a play and goes back: cue 2 keeps cue 1 cells, back to 1 drops cue 2 cells', () => {
    const r = rig([fx('b', 'gen-bar8', 1)], [list('l', [
      cue({ b: { intensity: 0, cells: { 0: { intensity: 1, color: RED } } } }),
      cue({ b: { cells: { 5: { intensity: 1, color: GREEN } } } }),
    ])]);
    r.e.go('l'); r.e.go('l');
    let b = dmx(r, 0.1, 24);
    expect(cellOf(b, 0)).toEqual([255, 0, 0]);
    expect(cellOf(b, 5)).toEqual([0, 255, 0]);
    r.e.back('l');
    b = dmx(r, 0.2, 24);
    expect(cellOf(b, 0)).toEqual([255, 0, 0]);
    expect(cellOf(b, 5)).toEqual([0, 0, 0]);
  });
  it('a cue that sets the whole light again takes the cells with it', () => {
    const r = rig([fx('b', 'gen-bar8', 1)], [list('l', [
      cue({ b: { intensity: 1, color: BLUE, cells: { 0: { color: RED } } } }),
      cue({ b: { color: GREEN } }),
    ])]);
    r.e.go('l');
    expect(cellOf(dmx(r, 0.1, 24), 0)).toEqual([255, 0, 0]);
    r.e.go('l');
    const b = dmx(r, 0.2, 24);
    expect(cellOf(b, 0)).toEqual([0, 255, 0]);
    expect(cellOf(b, 3)).toEqual([0, 255, 0]);
  });
  it('fades cells with the cue', () => {
    const r = rig([fx('b', 'gen-bar8', 1)], [list('l', [
      cue({ b: { intensity: 1, color: BLUE } }),
      cue({ b: { cells: { 2: { color: RED } } } }, 2),
    ])]);
    r.e.go('l'); dmx(r, 0, 24);
    r.e.go('l');
    expect(cellOf(dmx(r, 1, 24), 2)).toEqual([128, 0, 128]);
    expect(cellOf(dmx(r, 2.5, 24), 2)).toEqual([255, 0, 0]);
  });
  it('a light coming up from dark takes its cell colours at once (no detour through the light colour)', () => {
    const r = rig([fx('b', 'gen-bar8', 1)], [list('l', [cue({ b: { intensity: 0, color: BLUE, cells: { 1: { intensity: 1, color: RED } } } }, 2)])]);
    r.e.go('l');
    const b = dmx(r, 1, 24);
    expect(cellOf(b, 1)).toEqual([128, 0, 0]);       // half way up, already red
  });
  it('intensity is highest-takes-precedence per cell across lists, by each list\'s master', () => {
    const r = rig([fx('b', 'gen-bar8', 1)], [
      list('cells', [cue({ b: { intensity: 0, color: RED, cells: { 0: { intensity: 1 } } } })]),
      list('all', [cue({ b: { intensity: 0.4 } })]),
    ]);
    r.e.go('cells'); r.e.go('all');
    let b = dmx(r, 0.1, 24);
    expect(cellOf(b, 0)).toEqual([255, 0, 0]);
    expect(cellOf(b, 4)).toEqual([102, 0, 0]);       // the other list lights every cell at 40 %
    r.e.setMaster('cells', 0.5);
    b = dmx(r, 0.2, 24);
    expect(cellOf(b, 0)).toEqual([128, 0, 0]);
  });
  it('the programmer: a whole-light value wins over cue cells, a cell value over everything', () => {
    const r = rig([fx('b', 'gen-bar8', 1)], [list('l', [cue({ b: { intensity: 1, color: BLUE, cells: { 0: { color: RED }, 1: { color: RED } } } })])]);
    r.e.go('l');
    r.e.programmer = { b: { color: GREEN, cells: { 1: { color: { r: 1, g: 1, b: 0 } } } } };
    const b = dmx(r, 0.1, 24);
    expect(cellOf(b, 0)).toEqual([0, 255, 0]);
    expect(cellOf(b, 1)).toEqual([255, 255, 0]);
    expect(cellOf(b, 2)).toEqual([0, 255, 0]);
    // what Record would store: the cells as the cue set them, under the programmer's
    const look = r.at(0.2).look.b;
    expect(look.cellVals?.[1].color).toEqual({ r: 1, g: 1, b: 0 });
  });
  it('effects run on top of the cue cells; the grand master and blackout dim them', () => {
    const r = rig([fx('b', 'gen-bar8', 1)], [list('l', [cue({ b: { intensity: 0, color: RED, cells: { 3: { intensity: 1 } } } })])]);
    r.e.go('l');
    r.e.grandMaster = 0.5;
    expect(cellOf(dmx(r, 0.1, 24), 3)).toEqual([128, 0, 0]);
    r.e.blackout = true;
    expect(cellOf(dmx(r, 0.2, 24), 3)).toEqual([0, 0, 0]);
  });
  it('the live layer can light single cells (Highlight on picked cells)', () => {
    const r = rig([fx('b', 'gen-bar8', 1)], [list('l', [cue({ b: { intensity: 1, color: BLUE } })])]);
    r.e.go('l');
    r.e.live = { b: { strobe: 0, cells: { 2: { intensity: 1, color: { r: 1, g: 1, b: 1 } }, 3: { intensity: 0 } } } };
    const b = dmx(r, 0.1, 24);
    expect(cellOf(b, 2)).toEqual([255, 255, 255]);
    expect(cellOf(b, 3)).toEqual([0, 0, 0]);
    expect(cellOf(b, 4)).toEqual([0, 0, 255]);
  });
  it('a release fades the cells out with the list', () => {
    const r = rig([fx('b', 'gen-bar8', 1)], [list('l', [cue({ b: { intensity: 0, color: RED, cells: { 0: { intensity: 1 } } } })], { releaseTime: 2 })]);
    r.e.go('l'); dmx(r, 0, 24);
    r.e.release('l');
    // half way: half the level (the colour blends back toward what's underneath, as a whole light's does)
    expect(cellOf(dmx(r, 1, 24), 0)[0]).toBe(128);
    expect(cellOf(dmx(r, 2.5, 24), 0)).toEqual([0, 0, 0]);
  });
  it('a list of looks: a look naming other cells leaves the earlier look\'s cells as they were', () => {
    const r = rig([fx('b', 'gen-bar8', 1)], [list('l', [
      cue({ b: { intensity: 0, color: RED, cells: { 0: { intensity: 1 } } } }),
      cue({ b: { cells: { 6: { intensity: 1, color: BLUE } } } }),
    ], { play: false })]);
    r.e.jumpTo('l', 0); r.e.jumpTo('l', 1);
    const b = dmx(r, 0.1, 24);
    expect(cellOf(b, 0)).toEqual([255, 0, 0]);
    expect(cellOf(b, 6)).toEqual([0, 0, 255]);
  });
});

describe('cells in a show file', () => {
  it('are mended like the light\'s own values; what isn\'t a cell is left out, what a cell doesn\'t use yet is kept', () => {
    const notes: string[] = [];
    const raw = { ...emptyShow(), cueLists: [{ id: 'l', name: 'l', end: 'stop', cues: [{ id: 'c', name: 'c', fade: 0, advance: { mode: 'manual' }, values: { b: {
      intensity: 1, cells: { 0: { intensity: 2, pan: 0.5, color: { r: 1, g: 0, b: 0 } }, x: { intensity: 1 }, '07': { intensity: 1 }, 3: 'red', 4: { intensity: '0.5' }, 5: { gobo: 1, future: 'x' } },
    } } }] }] };
    const s = upgrade(JSON.parse(JSON.stringify(raw)), notes);
    // (what a cell doesn't use yet is kept, for a newer app: pan, a gobo, an unknown field)
    expect(s.cueLists[0].cues[0].values.b.cells).toEqual({ 0: { intensity: 1, pan: 0.5, color: { r: 1, g: 0, b: 0 } }, 4: { intensity: 0.5 }, 5: { gobo: 1, future: 'x' } });
    expect(notes.join(' ')).toMatch(/left out or brought into range/);
  });
});

describe('cells with a dimmer of their own', () => {
  // a 4-lite blinder: a master dimmer and a dimmer per lamp; and one without the master
  const LITE: FixtureType = { id: 't-4lite', manufacturer: 'X', model: '4-lite', source: 'user', modes: [
    { name: 'master', channels: [{ name: 'Master', attr: 'intensity' }, ...[0, 1, 2, 3].map((c) => ({ name: `Lamp ${c + 1}`, attr: 'intensity' as const, cell: c }))] },
    { name: 'lamps', channels: [0, 1, 2, 3].map((c) => ({ name: `Lamp ${c + 1}`, attr: 'intensity' as const, cell: c })) },
  ] };
  const setup = (mode: string, values: Cue['values'][string]) => {
    const r = rig([{ ...fx('l', 't-4lite', 1), mode }], [list('l', [cue({ l: values })])]);
    r.show.fixtureTypes.push(LITE);
    r.e.go('l');
    return r;
  };
  it('each lamp gets its own level; the master the brightest, the lamps the rest of the way', () => {
    expect(dmx(setup('lamps', { intensity: 0, cells: { 0: { intensity: 1 }, 2: { intensity: 0.5 } } }), 0.1, 4)).toEqual([255, 0, 128, 0]);
    expect(dmx(setup('master', { intensity: 0, cells: { 0: { intensity: 0.5 }, 2: { intensity: 0.25 } } }), 0.1, 5)).toEqual([128, 255, 0, 128, 0]);
  });
  it('the whole light at a level: the master carries it and the lamps stay open (not the level twice)', () => {
    expect(dmx(setup('master', { intensity: 0.5 }), 0.1, 5)).toEqual([128, 255, 255, 255, 255]);
    expect(dmx(setup('lamps', { intensity: 0.5 }), 0.1, 4)).toEqual([128, 128, 128, 128]);
  });
});

describe('cells through fades, takeovers, releases and effects (review cycle 1)', () => {
  it('a cue-to-cue colour fade on a light lit only by a cell fades (it doesn\'t snap)', () => {
    const r = rig([fx('b', 'gen-bar8', 1)], [list('l', [
      cue({ b: { intensity: 0, cells: { 0: { intensity: 1, color: RED } } } }),
      cue({ b: { cells: { 0: { color: BLUE } } } }, 2),
    ])]);
    r.e.go('l'); dmx(r, 0, 24);
    r.e.go('l');
    expect(cellOf(dmx(r, 1, 24), 0)).toEqual([128, 0, 128]);
  });
  it('another list taking the light\'s colour over fades a cue cell from its own colour', () => {
    const r = rig([fx('b', 'gen-bar8', 1)], [
      list('a', [cue({ b: { intensity: 1, color: BLUE, cells: { 0: { color: RED } } } })]),
      list('b', [cue({ b: { color: GREEN } }, 2)]),
    ]);
    r.e.go('a'); dmx(r, 0, 24); dmx(r, 0.05, 24);
    r.e.go('b');
    const c = cellOf(dmx(r, 0.15, 24), 0);
    expect(c[0]).toBeGreaterThan(200);                // still mostly red, not jumped to the light's blue
    expect(cellOf(dmx(r, 3, 24), 0)).toEqual([0, 255, 0]);
  });
  it('a look tapped on a list being released doesn\'t pop its cells back up', () => {
    const r = rig([fx('b', 'gen-bar8', 1)], [list('l', [
      cue({ b: { intensity: 0, color: RED, cells: { 0: { intensity: 1 } } } }),
      cue({ d: { intensity: 1 } }),
    ], { play: false, releaseTime: 2 })]);
    r.show.fixtures.push(fx('d', 'gen-dimmer', 100));
    r.e.jumpTo('l', 0); dmx(r, 0, 24);
    r.e.release('l');
    const before = cellOf(dmx(r, 1.5, 24), 0)[0];
    r.e.jumpTo('l', 1);
    expect(cellOf(dmx(r, 1.55, 24), 0)[0]).toBeLessThanOrEqual(before + 2);
  });
  it('an effect on the whole light (pixels off) reaches lights that have cue cells', () => {
    const r = rig([fx('b', 'gen-bar8', 1), fx('p', 'gen-bar8', 30)], [list('l', [cue({ b: { intensity: 1, color: BLUE, cells: { 0: { color: RED } } }, p: { intensity: 1, color: BLUE } })])]);
    r.show.effects.push({ id: 'fx', name: 'pulse', kind: 'pulse', fixtures: ['b', 'p'], params: { pixels: false } } as never);
    r.e.go('l'); r.e.startEffect('fx');
    // whatever the pulse does to the plain bar, it does to the bar with a red cell too
    let lowest = 255;
    for (let t = 0.5; t < 3; t += 0.15) {
      const b = dmx(r, t, 54), plainLevel = cellOf(b.slice(29), 3)[2];
      lowest = Math.min(lowest, plainLevel);
      expect(cellOf(b, 0)[0]).toBe(plainLevel);                     // the red cell
      expect(cellOf(b, 3)[2]).toBe(plainLevel);                     // and the bar's other cells
    }
    expect(lowest).toBeLessThan(200);                               // (the pulse really dims them)
  });
  it('a cell going down takes the cue\'s fade-out time, a light going up its fade', () => {
    const r = rig([fx('b', 'gen-bar8', 1)], [list('l', [
      cue({ b: { intensity: 0.2, color: RED, cells: { 0: { intensity: 1 } } } }),
      cue({ b: { intensity: 0.6, cells: { 0: { intensity: 0 } } } }, 1, { fadeOut: 4 }),
    ])]);
    r.e.go('l'); dmx(r, 0, 24);
    r.e.go('l');
    const b = dmx(r, 2, 24);
    expect(cellOf(b, 3)[0]).toBe(153);                // the light: up in 1 s
    expect(cellOf(b, 0)[0]).toBeGreaterThan(100);     // cell 0: half way down its 4 s
  });
  it('the QLC+ export and the cue pictures see cue cells (sparse, as cues hold them)', () => {
    const bar = BAR4.modes[0], buf = new Uint8Array(512);
    renderFixture(fx('d', 't-bar4', 1), bar, { intensity: 0, color: BLUE, cellVals: { 2: { intensity: 1, color: RED } } }, buf);
    expect([...buf.slice(0, 13)]).toEqual([255, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0]);
    expect(lookColor(cueLooks(list('l', [cue({ b: { intensity: 0, cells: { 4: { intensity: 1, color: RED } } } })]), new Map())[0].b).glow).toBe(1);
  });
  it('200 discs with a rim cue cost about what a whole-light cue costs', () => {
    const many = (rim: boolean) => {
      const fixtures = Array.from({ length: 200 }, (_, i) => fx(`d${i}`, 'gen-disc241', 1, i * 2));
      const values = Object.fromEntries(fixtures.map((f) => [f.id, rim ? { intensity: 0, color: BLUE, cells: Object.fromEntries(Array.from({ length: 60 }, (_, k) => [k, { intensity: 1, color: RED }])) } : { intensity: 1, color: BLUE }]));
      const r = rig(fixtures, [list('l', [cue(values)])]);
      r.e.go('l');
      for (let i = 0; i < 5; i++) r.at(i * 0.025);
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) r.at(1 + i * 0.025);
      return (performance.now() - t0) / 20;
    };
    const whole = many(false), rim = many(true);
    expect(rim).toBeLessThan(whole * 3 + 5);
  });
});

describe('review cycle 2', () => {
  it('Blackout and the grand master dim cells the programmer sets (with or without a level for the whole light)', () => {
    for (const prog of [{ cells: { 2: { intensity: 1, color: RED } } }, { intensity: 0.5, cells: { 2: { intensity: 1, color: RED } } }]) {
      const r = rig([fx('b', 'gen-bar8', 1)]);
      r.e.programmer = { b: prog };
      expect(cellOf(dmx(r, 0.1, 24), 2)).toEqual([255, 0, 0]);
      r.e.grandMaster = 0.5;
      expect(cellOf(dmx(r, 0.2, 24), 2)).toEqual([128, 0, 0]);
      r.e.blackout = true;
      expect(dmx(r, 0.3, 24).every((v) => v === 0)).toBe(true);
    }
  });
  it('a pixel head\'s own main emitters take their share under a master that carries a brighter cell', () => {
    const HEAD: FixtureType = { id: 't-head', manufacturer: 'X', model: 'Head', source: 'user', modes: [{ name: 'm', channels: [
      { name: 'Dim', attr: 'intensity' }, { name: 'R', attr: 'red' }, { name: 'G', attr: 'green' }, { name: 'B', attr: 'blue' },
      ...[0, 1].flatMap((c) => [{ name: `R${c}`, attr: 'red' as const, cell: c }, { name: `G${c}`, attr: 'green' as const, cell: c }, { name: `B${c}`, attr: 'blue' as const, cell: c }]),
    ] }] };
    const r = rig([fx('h', 't-head', 1)], [list('l', [cue({ h: { intensity: 0, color: { r: 1, g: 1, b: 1 }, cells: { 0: { intensity: 1, color: RED } } } })])]);
    r.show.fixtureTypes.push(HEAD);
    r.e.go('l');
    expect(dmx(r, 0.1, 10)).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 0, 0]);   // main beam dark, cell 0 red
    const r2 = rig([fx('h', 't-head', 1)], [list('l', [cue({ h: { intensity: 0.5, color: { r: 1, g: 1, b: 1 }, cells: { 0: { intensity: 1, color: RED } } } })])]);
    r2.show.fixtureTypes.push(HEAD);
    r2.e.go('l');
    expect(dmx(r2, 0.1, 4)).toEqual([255, 128, 128, 128]);                 // main beam at its own half
  });
  it('a light lit only by its cells is one lit light to the plan and the 3D stage, in its brightest cell\'s colour; white lights keep their look per cell', () => {
    const l = { intensity: 0, color: BLUE, cellVals: { 3: { intensity: 1, color: RED } } };
    expect(wholeLook(l)).toMatchObject({ intensity: 1, color: RED });
    expect(lookColor(l).css).toBe('rgb(255,0,0)');
    expect(wholeLook({ intensity: 1, color: BLUE })).toEqual({ intensity: 1, color: BLUE });
    const drawn = { intensity: 1, color: RED, draw: { r: 1, g: 1, b: 1 }, cellVals: { 0: { color: BLUE } } };
    expect(cellsOf(drawn, 2)![0].draw).toEqual({ r: 1, g: 1, b: 1 });
  });
});

describe('effects on some cells only', () => {
  it('a chase on the cells it names, in their order; the others keep what the cue gives them', () => {
    const r = rig([fx('b', 'gen-bar8', 1)], [list('l', [cue({ b: { intensity: 1, color: BLUE } })])]);
    r.show.effects.push({ id: 'fx', name: 'chase', kind: 'chase', fixtures: ['b'], cells: [7, 6, 5], params: { color: undefined } } as never);
    r.e.go('l'); r.e.startEffect('fx');
    const lit = new Set<number>();
    for (let t = 0.5; t < 4; t += 0.1) {
      const b = dmx(r, t, 24);
      for (const k of [0, 1, 2, 3, 4]) expect(cellOf(b, k)).toEqual([0, 0, 255]);   // untouched
      for (const k of [5, 6, 7]) if (cellOf(b, k)[2] < 200) lit.add(k);              // the chase dims them in turn
    }
    expect([...lit].sort()).toEqual([5, 6, 7]);
  });
});

describe('a machine\'s own programs wait for Arm too', () => {
  it('a flame projector\'s "Auto 1" program sends 0 until armed, and a few seconds at most when armed', () => {
    const FP: FixtureType = { id: 't-fp', manufacturer: 'X', model: 'Flame', source: 'user', modes: [{ name: 'm', channels: [
      { name: 'Fire', attr: 'flame' }, { name: 'Program', attr: 'effectMacro', ranges: [{ from: 0, to: 9, label: 'Off' }, { from: 10, to: 255, label: 'Auto 1' }] },
    ] }] };
    const r = rig([fx('f', 't-fp', 1)], [list('l', [cue({ f: { effectMacro: 1 } })])]);
    r.show.fixtureTypes.push(FP);
    r.e.go('l');
    expect(dmx(r, 0.1, 2)).toEqual([0, 0]);              // not armed: the program stays off
    r.e.armed = true;
    expect(dmx(r, 0.2, 2)[1]).toBe(0);                   // (on since before arming: waits for an off)
    // off, then on again: it runs, and is cut after the machine's longest time (a flame's 5 s)
    r.show.cueLists[0].cues.push(cue({ f: { effectMacro: 0 } }), cue({ f: { effectMacro: 1 } }));
    r.e.go('l'); expect(dmx(r, 0.3, 2)[1]).toBe(5);
    r.e.go('l'); expect(dmx(r, 0.4, 2)[1]).toBe(133);
    expect(dmx(r, 5.3, 2)[1]).toBe(133);
    expect(dmx(r, 5.5, 2)[1]).toBe(0);                   // on for more than 5 s: cut
  });
});

describe('a machine\'s program in its first range', () => {
  it('is a program, not off, unless the range says off: "Auto 1" from 0 waits for Arm like any other', () => {
    const FP: FixtureType = { id: 't-fp3', manufacturer: 'X', model: 'Flame', source: 'user', modes: [{ name: 'm', channels: [
      { name: 'Fire', attr: 'flame' }, { name: 'Program', attr: 'effectMacro', ranges: [{ from: 0, to: 127, label: 'Auto 1' }, { from: 128, to: 255, label: 'Auto 2' }] },
    ] }] };
    const r = rig([fx('f', 't-fp3', 1)], [list('l', [cue({ f: { effectMacro: 0 } })])]);
    r.show.fixtureTypes.push(FP);
    r.e.go('l');
    expect(dmx(r, 0.1, 2)).toEqual([0, 0]);
    r.e.armed = true;
    expect(dmx(r, 0.2, 2)[1]).toBe(0);                   // (on since before arming: waits, it isn't "off")
  });
});

describe('a machine\'s programs on a timeline jump', () => {
  it('a jump (quiet) never starts a flame program, armed or not; its cue is marked dangerous', async () => {
    const FP: FixtureType = { id: 't-fp2', manufacturer: 'X', model: 'Flame', source: 'user', modes: [{ name: 'm', channels: [
      { name: 'Fire', attr: 'flame' }, { name: 'Program', attr: 'effectMacro', ranges: [{ from: 0, to: 9, label: 'Off' }, { from: 10, to: 255, label: 'Auto 1' }] },
    ] }] };
    const r = rig([fx('f', 't-fp2', 1)], [list('l', [cue({ f: { effectMacro: 1 } })])]);
    r.show.fixtureTypes.push(FP);
    r.e.armed = true;
    dmx(r, 0, 2);
    r.e.jumpTo('l', 0); r.e.jumped.add('l');           // (what a timeline jump does)
    for (const t of [0.1, 0.5, 1]) expect(dmx(r, t, 2)).toEqual([0, 0]);
    const { cueRiskOf } = await import('../ui/risk');
    expect(cueRiskOf(r.show, r.show.cueLists[0].cues[0], 1)).toBe('hazard');
  });
});

describe('group masters', () => {
  it('scale what the cues give a group\'s lights, cells too; a light in two groups gets both', () => {
    const r = rig([fx('a', 't-bar4', 1), fx('b', 't-bar4', 14)], [list('l', [cue({ a: { intensity: 1, color: RED }, b: { intensity: 1, cells: { 1: { intensity: 1, color: BLUE } } } })])]);
    r.show.groups = [{ id: 'g1', name: 'A', fixtures: ['a'] }, { id: 'g2', name: 'Both', fixtures: ['a', 'b'] }];
    r.e.start('l');
    expect(dmx(r, 1, 26)[0]).toBe(255);
    r.e.groupMasters = { g1: 0.5 };
    const half = dmx(r, 1.1, 26);
    expect(half[0]).toBe(128);
    expect(half[13]).toBe(255);                       // b isn't in it
    r.e.groupMasters = { g1: 0.5, g2: 0.5 };
    const q = dmx(r, 1.2, 26);
    expect(q[0]).toBe(64);
    expect(q[13]).toBeLessThanOrEqual(128);           // b at half, its cell with it
    r.e.groupMasters = {};
    expect(dmx(r, 1.3, 26)[0]).toBe(255);
  });
});

describe('a cell group\'s master', () => {
  it('scales just its cells, the rest of the light stays', () => {
    const show = rig([fx('p', 'gen-bar8', 1)], [list('l', [cue({ p: { intensity: 1, color: RED } })])]);
    show.show.groups = [{ id: 'g', name: 'Ends', fixtures: ['p'], cells: [0, 7] }];
    show.e.start('l');
    const full = dmx(show, 1, 24);
    expect(cellOf(full, 0)).toEqual([255, 0, 0]);
    show.e.groupMasters = { g: 0.5 };
    const half = dmx(show, 1.1, 24);
    expect(cellOf(half, 0)).toEqual([128, 0, 0]);
    expect(cellOf(half, 7)).toEqual([128, 0, 0]);
    expect(cellOf(half, 3)).toEqual([255, 0, 0]);
  });
});

describe('cells a light does not have', () => {
  it('never drive its dimmer, and Blackout and the grand master reach it', () => {
    // a plain dimmer at half with a stray cell at full; a 4-cell bar dark with a cell 10 at full
    const r = rig([fx('d', 'gen-dimmer', 1), fx('b', 't-bar4', 2)], [list('l', [cue({ d: { intensity: 0.5, cells: { 0: { intensity: 1 } } }, b: { intensity: 0, cells: { 9: { intensity: 1, color: RED } } } })])]);
    r.e.start('l');
    const out = dmx(r, 1, 14);
    expect(out[0]).toBe(128);                                               // its own half, not the stray cell's full
    expect(out.slice(1)).toEqual(new Array(13).fill(0));
    r.e.grandMaster = 0;
    expect(dmx(r, 1.1, 14)).toEqual(new Array(14).fill(0));
    r.e.grandMaster = 1; r.e.blackout = true;
    expect(dmx(r, 1.2, 14)).toEqual(new Array(14).fill(0));
  });
});

describe('the tracked look kept from one GO to the next', () => {
  it('gives the same looks as working it out from the top, also after going back and a new copy of the show', () => {
    const mk = () => rig([fx('b', 't-bar4', 1), fx('c', 't-bar4', 14)], [list('l', [
      cue({ b: { intensity: 1, cells: { 0: { color: RED } } }, c: { fog: 1 } as any }),
      cue({ c: { intensity: 0.5, color: BLUE } }),
      cue({ b: { color: GREEN } }),
      cue({ b: { cells: { 3: { color: BLUE } } }, c: { intensity: 1 } }),
    ], { play: true })]);
    const a = mk(), b = mk();
    b.e.cacheTracks = true;
    const seq = [0, 1, 2, 3, 1, 2, 3, 0, 3];
    seq.forEach((i, n) => {
      a.e.jumpTo('l', i, 0); b.e.jumpTo('l', i, 0);
      expect(dmx(b, n + 1, 27)).toEqual(dmx(a, n + 1, 27));
    });
    // a new copy of the show (an edit): from the top again
    b.show.cueLists[0] = JSON.parse(JSON.stringify(b.show.cueLists[0]));
    b.show.cueLists[0].cues[2].values.b = { color: RED };
    a.show.cueLists[0].cues[2].values.b = { color: RED };
    a.e.jumpTo('l', 3, 0); b.e.jumpTo('l', 3, 0);
    expect(dmx(b, 20, 27)).toEqual(dmx(a, 20, 27));
  });
});

describe('lerpResolved done with cells on both sides', () => {
  it('equals the step-by-step blend at its end', async () => {
    const { lerpResolved } = await import('./resolve');
    const a = { intensity: 0.4, color: RED, cellVals: { 0: { color: GREEN, intensity: 0.2 }, 2: { white: 0.5 }, 5: { color: BLUE } } } as any;
    const b = { intensity: 0.9, color: BLUE, cellVals: { 0: { intensity: 1 }, 3: { color: RED } } } as any;
    const slow = lerpResolved(a, b, 0.999999999, 0.999999999, 0.999999999), fast = lerpResolved(a, b, 1, 1, 1);
    const round = (o: any) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)));
    expect(round(fast.cellVals)).toEqual(round(slow.cellVals));
  });
});

describe('risk marks see a machine fired by channel number', () => {
  it('a cue with raw 255 on a flame projector\'s fire channel is dangerous', async () => {
    const FP: FixtureType = { id: 't-fp3', manufacturer: 'X', model: 'Flame', source: 'user', modes: [{ name: 'm', channels: [{ name: 'Fire', attr: 'flame' }, { name: 'Program', attr: 'effectMacro' }] }] };
    const r = rig([fx('f', 't-fp3', 1)], [list('l', [cue({ f: { raw: { 0: 255 } } }), cue({ f: { raw: { 1: 40 } } }), cue({ f: { raw: { 0: 0 } } })])]);
    r.show.fixtureTypes.push(FP);
    const { cueRiskOf } = await import('../ui/risk');
    expect(r.show.cueLists[0].cues.map((c, i) => cueRiskOf(r.show, c, 100 + i))).toEqual(['hazard', 'hazard', 'light']);
  });
});

describe('a quiet jump is one command', () => {
  it('jumpQuiet: armed, the flame cue it lands on never fires, from the first frame', () => {
    const r = rig([fx('f', 'gen-flame', 1)], [list('l', [cue({}), cue({ f: { flame: 1 } })])]);
    r.e.armed = true;
    dmx(r, 0, 1);
    r.e.jumpQuiet('l', 1, 0);
    for (const t of [0.01, 0.2, 1]) expect(dmx(r, t, 1)).toEqual([0]);
    r.e.actQuiet({ do: 'goto', list: 'l', cue: r.show.cueLists[0].cues[1].id });
    expect(dmx(r, 1.1, 1)).toEqual([0]);
  });
});

describe('a machine program\'s own off', () => {
  it('its "Off" range (sent at its middle) counts as off for the gate: armed, the next program fires', () => {
    const FP: FixtureType = { id: 't-fp4', manufacturer: 'X', model: 'Flame', source: 'user', modes: [{ name: 'm', channels: [
      { name: 'Fire', attr: 'flame' }, { name: 'Program', attr: 'effectMacro', ranges: [{ from: 0, to: 9, label: 'Off' }, { from: 10, to: 255, label: 'Auto 1' }] }] }] };
    const r = rig([fx('f', 't-fp4', 1)], [list('l', [cue({ f: { effectMacro: 0 } }), cue({ f: { effectMacro: 1 } })], { play: true })]);
    r.show.fixtureTypes.push(FP);
    r.e.armed = true;
    r.e.start('l');
    expect(dmx(r, 0.1, 2)[1]).toBe(5);                  // (Off, at its middle: the gate lets it through)
    r.e.go('l');
    expect(dmx(r, 0.2, 2)[1]).toBe(133);                // Auto 1
  });
});

describe('a cue\'s own times for colour, position, beam', () => {
  it('the colour snaps while the heads take their time, and the cue is done when the slowest is', () => {
    const r = rig([fx('h', 'gen-mover16', 1)], [list('l', [
      cue({ h: { intensity: 1, pan: 0, color: RED } }, 0),
      cue({ h: { intensity: 1, pan: 1, color: BLUE } }, 2, { times: { color: 0, position: 4 } }),
    ], { play: true })]);
    r.e.start('l');
    const at = (t: number) => { const b = dmx(r, t, 11); return { pan: b[0], r: b[7], b: b[9] }; };
    at(0.1);
    r.at(1); r.e.go('l');
    const mid = at(2);                                   // 1 s into it: blue already, pan a quarter of the way
    expect([mid.r, mid.b]).toEqual([0, 255]);
    expect(mid.pan).toBeGreaterThan(50); expect(mid.pan).toBeLessThan(80);
    expect(at(5.1).pan).toBe(255);
  });
});

describe('the end of a fade keeps what only the start had (review 9)', () => {
  it('back from a red cue to one without a colour: red through the fade and after it', () => {
    const r = rig([fx('a', 't-bar4', 1)], [list('l', [cue({ a: { intensity: 1 } }, 2), cue({ a: { color: RED } }, 0)], { play: true })]);
    r.e.start('l'); dmx(r, 3, 4);
    r.e.go('l'); expect(dmx(r, 3.1, 4).slice(1, 4)).toEqual([255, 0, 0]);
    r.e.back('l');
    expect(dmx(r, 4, 4).slice(1, 4)).toEqual([255, 0, 0]);         // in the fade
    expect(dmx(r, 6, 4).slice(1, 4)).toEqual([255, 0, 0]);         // and after it (no snap to white)
  });
});

describe('a list at 0 starting again', () => {
  it('back at full only after the console fader let it go; a level set to 0 otherwise stays', () => {
    const r = rig([fx('a', 't-bar4', 1)], [list('l', [cue({ a: { intensity: 1 } })])]);
    r.e.setMaster('l', 0); r.e.start('l');                       // (a cue action "master 0", then start)
    expect(dmx(r, 1, 1)[0]).toBe(0);
    r.e.release('l'); dmx(r, 5, 1);
    r.e.faderReleased('l');                                     // (the console's fader down to 0)
    r.e.start('l');
    expect(dmx(r, 6, 1)[0]).toBe(255);
  });
});
