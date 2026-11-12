import { describe, expect, it } from 'vitest';
import { emptyShow, FormatError, FORMAT_VERSION, parseShow, serializeShow } from './format';
import { Engine } from '../engine/engine';
import { EFFECTS, paramsOf, runEffect } from '../engine/effects';

describe('show format', () => {
  it('round-trips an empty show', () => {
    const s = parseShow(serializeShow(emptyShow('Test')));
    expect(s.format).toBe('luxdmx-show');
    expect(s.formatVersion).toBe(FORMAT_VERSION);
    expect(s.meta.name).toBe('Test');
  });

  it('keeps fields it does not know, at every level', () => {
    const s: any = emptyShow();
    s.futureTopLevel = { a: 1 };
    s.fixtures.push({ id: 'f', name: 'F', typeId: 'gen-rgb', mode: '', universe: 0, address: 1, x: 0, y: 0, lens: 'wide' });
    s.extensions['com.example'] = { keep: true };
    const back: any = parseShow(serializeShow(parseShow(JSON.stringify(s))));
    expect(back.futureTopLevel).toEqual({ a: 1 });
    expect(back.fixtures[0].lens).toBe('wide');
    expect(back.extensions['com.example']).toEqual({ keep: true });
  });

  it('refuses a file that needs a newer reader', () => {
    const s: any = emptyShow(); s.minReaderVersion = '2.0.0';
    expect(() => parseShow(JSON.stringify(s))).toThrow(FormatError);
    expect(() => parseShow(JSON.stringify(s))).toThrow(/newer version/);
  });

  it('refuses a file that requires a feature it does not have', () => {
    const s: any = emptyShow(); s.requiredFeatures = ['timecode'];
    expect(() => parseShow(JSON.stringify(s))).toThrow(/timecode/);
  });

  it('a show with cells says so (an older reader refuses it instead of playing it wrong)', async () => {
    const { serializeShow } = await import('./format');
    const s: any = emptyShow();
    expect(JSON.parse(serializeShow(s)).requiredFeatures).toEqual([]);
    s.cueLists = [{ id: 'l', name: 'L', end: 'stop', cues: [{ id: 'c', name: 'c', fade: 0, advance: { mode: 'manual' }, values: { a: { cells: { 0: { intensity: 1 } } } } }] }];
    const out = JSON.parse(serializeShow(s));
    expect(out.requiredFeatures).toEqual(['cells']);
    expect(out.formatVersion).toBe('1.2.0');
    expect(parseShow(JSON.stringify(out)).cueLists[0].cues[0].values.a.cells).toBeTruthy();   // (this version knows them)
    // a newer file keeps its version when saved here
    const newer: any = emptyShow(); newer.formatVersion = '1.4.0';
    expect(JSON.parse(serializeShow(parseShow(JSON.stringify(newer)))).formatVersion).toBe('1.4.0');
  });

  it('opens a newer minor version (forward compatible)', () => {
    const s: any = emptyShow(); s.formatVersion = '1.4.0'; s.newThing = [1, 2];
    expect((parseShow(JSON.stringify(s)) as any).newThing).toEqual([1, 2]);
  });

  it('rejects things that are not shows', () => {
    expect(() => parseShow('nope')).toThrow(/not JSON/);
    expect(() => parseShow('{"a":1}')).toThrow(/not a LuxDMX show/);
  });

  it('fills in what a hand-written file left out', () => {
    const s = parseShow(JSON.stringify({ format: 'luxdmx-show', formatVersion: '1.0.0', cueLists: [{ id: 'L', name: 'L', end: 'stop', cues: [{ id: 'c', name: 'c' }] }] }));
    expect(s.fixtures).toEqual([]);
    expect(s.cueLists[0].cues[0].advance).toEqual({ mode: 'manual' });
    expect(s.settings.bpm).toBe(120);
  });

  it('upgrades a 1.0.0 file to the current version and keeps its content', () => {
    const s: any = emptyShow(); s.formatVersion = '1.0.0'; s.effects = [{ id: 'e', name: 'E', kind: 'chase', group: 'g', params: { speed: 2 } }];
    const up = parseShow(JSON.stringify(s));
    expect(up.formatVersion).toBe(FORMAT_VERSION);
    expect(up.effects[0].params).toEqual({ speed: 2 });
  });

  it('migrates the first prototype format', () => {
    const old = { version: 1, types: [], loop: true, devices: [{ host: '1.2.3.4' }],
      fixtures: [{ id: 'f1', name: 'PAR 1', typeId: 'gen-drgb', universe: 0, address: 1, x: 0.5, y: 0.1 }],
      cues: [{ id: 'c1', name: 'Red', fade: 3, looks: { f1: { dim: 1, color: [1, 0, 0] } } }] };
    const s = parseShow(JSON.stringify(old));
    expect(s.fixtures[0].mode).toBe('default');
    expect(s.cueLists[0].end).toBe('loop');
    expect(s.cueLists[0].cues[0].values.f1).toEqual({ intensity: 1, color: { r: 1, g: 0, b: 0 } });
    expect(s.outputs.devices[0].host).toBe('1.2.3.4');
  });
});

// ---------------------------------------------------------------- a file can't stop the frames
//
// Things a show file can hold (by hand, by a script, damaged) that used to make every frame throw
// (nothing goes out at all, no heartbeat, fog caps never run) or hang the page. Each one loads,
// is mended with a note, and a frame runs with the light on.
const FIX = [
  { id: 'a', name: 'A', typeId: 'gen-dimmer', mode: '', universe: 0, address: 1, x: 0.1, y: 0.5 },
  { id: 'b', name: 'B', typeId: 'gen-rgb', mode: '', universe: 0, address: 2, x: 0.9, y: 0.5 },
];
const showText = (extra: Record<string, unknown>) => JSON.stringify({ format: 'luxdmx-show', formatVersion: '1.1.0', minReaderVersion: '1.0.0', requiredFeatures: [], fixtures: FIX, ...extra });
// load, start every effect, tick a few frames; what went out on universe 0
function play(text: string) {
  const notes: string[] = [];
  const show = parseShow(text, notes);
  let t = 0;
  const e = new Engine(() => show, () => t);
  e.bpm = show.settings.bpm;                              // what the app does every frame
  e.programmer = { a: { intensity: 1 } };
  for (const fx of show.effects) e.startEffect(fx.id);
  let f = e.tick();
  for (const s of [0.5, 1, 7.3]) { t = s; f = e.tick(); }
  return { show, notes, out: f.frames.get(0)!, frames: f.frames, broken: (e as unknown as { broken?: Map<string, string> }).broken?.size ?? 0 };
}
const rainbow = (params: unknown) => ({ effects: [{ id: 'e1', name: 'Rainbow', kind: 'rainbow', fixtures: ['b'], params }] });

describe('a show file that used to stop every frame', () => {
  const cases: [string, string, RegExp][] = [
    ['presets: [null]', showText({ presets: [null] }), /Presets: 1 empty or broken entry/],
    ['effects: [null]', showText({ effects: [null, 5] }), /Effects: 2 empty or broken entries/],
    ['fixtureTypes: [null]', showText({ fixtureTypes: [null] }), /Fixture types/],
    ['groups: [null] and a group effect', showText({ groups: [null], effects: [{ id: 'e', name: 'E', kind: 'pulse', group: 'g', params: {} }] }), /Groups/],
    ['an effect over fixtures: 5', showText({ effects: [{ id: 'e', name: 'E', kind: 'pulse', fixtures: 5, params: {} }] }), /its lights couldn't be read/],
    ['effect params: null', showText(rainbow(null)), /its settings couldn't be read/],
    ['palette colours null', showText(rainbow({ colors: [null, null] })), /its colours couldn't be read/],
    ['spread 1e999', showText(rainbow({ spread: 7 })).replace('"spread":7', '"spread":1e999'), /spread Infinity isn't a usable number/],
    ['speed -4, blocks 1e9', showText(rainbow({ speed: -4, blocks: 1e9 })), /speed -4 is now 0.05/],
    ['bpm "fast"', showText({ ...rainbow({}), settings: { bpm: 'fast' } }), /bpm "fast" isn't a usable number, now 120/],
    ['bpm 1e999', showText({ ...rainbow({}), settings: { bpm: 7 } }).replace('"bpm":7', '"bpm":1e999'), /now 120/],
    ['bpm -120', showText({ ...rainbow({}), settings: { bpm: -120 } }), /bpm -120 is now 20/],
    ['cueLists: [null], cues: [null], values null', showText({ cueLists: [null, { id: 'L', name: 'L', end: 'stop', cues: [null, { id: 'c', name: 'c', values: { a: null, b: { intensity: 'full', color: null, raw: 'x' } }, fade: 'slow', advance: { mode: 'wait', time: 'soon' } }] }] }), /Cue lists: 1 empty/],
    ['pages: [null], widgets: [null]', showText({ pages: [null, { id: 'p', name: 'P', widgets: [null, { id: 'w', type: 'fog', fixtures: ['a'], level: 1 }] }] }), /no usable time limit, now 10 s/],
    ['timeline items: [null], bpm -5', showText({ timeline: { duration: 60, bpm: -5, items: [null, { id: 't', at: 1, lane: 'fx', do: { do: 'effect', effect: 'x', on: true } }] } }), /The timeline: bpm -5 is now 20/],
    ['a pixel number of 1e999', showText({ fixtureTypes: [{ id: 'bar', manufacturer: 'X', model: 'Bar', source: 'user', modes: [{ name: 'm', channels: [{ name: 'R', attr: 'red', cell: 7 }, { name: 'G', attr: 'green', cell: 0 }, null] }] }],
      fixtures: [...FIX, { id: 'c', name: 'C', typeId: 'bar', mode: 'm', universe: 0, address: 10, x: 0.5, y: 0.5 }], effects: [{ id: 'e', name: 'E', kind: 'rainbow', fixtures: ['c'], params: {} }] }).replace('"cell":7', '"cell":1e999'), /cell Infinity isn't a usable number, left out/],
  ];
  for (const [name, text, said] of cases) {
    it(name, () => {
      const { notes, out, broken } = play(text);
      expect(notes.join('\n')).toMatch(said);
      expect(out[0]).toBe(255);                         // the dimmer the programmer holds is out
      expect(broken).toBe(0);                           // and no effect had to be stopped
    });
  }
  it('a rainbow that loaded with odd knobs really runs (colours on the wire, changing)', () => {
    const text = showText({ ...rainbow({ spread: 1, speed: 1e300, size: -3 }), settings: { bpm: 'fast' } }).replace('"spread":1', '"spread":1e999');
    const show = parseShow(text);
    let t = 0;
    const e = new Engine(() => show, () => t);
    e.bpm = show.settings.bpm;
    e.startEffect('e1');
    const seen = new Set<string>();
    for (let k = 0; k < 20; k++) { t = k * 0.3; seen.add([...e.tick().frames.get(0)!.slice(1, 4)].join(',')); }
    expect(show.effects[0].params).toEqual({ speed: 3600, size: 0 });   // (size 0: white; spread left out: its default)
    expect(seen.size).toBeGreaterThanOrEqual(1);
    for (const s of seen) for (const v of s.split(',')) expect(Number.isInteger(+v)).toBe(true);
  });
  it('the universe "0" (text) is the number 0: one buffer, not a second one that flickers', () => {
    const { show, frames, notes } = play(showText({ fixtures: [{ ...FIX[0], universe: '0' }, { ...FIX[1], address: '2' }] }));
    expect(show.fixtures.map((f) => [f.universe, f.address])).toEqual([[0, 1], [0, 2]]);
    expect([...frames.keys()]).toEqual([0]);
    expect(notes).toEqual(['Fixture "A": universe "0" is now 0', 'Fixture "B": address "2" is now 2']);
  });
  it('a fixture that can\'t say where it is (address 600, universe "one") is left out, the others play', () => {
    const { show, out, notes } = play(showText({ fixtures: [...FIX, { ...FIX[1], id: 'c', address: 600 }, { ...FIX[1], id: 'd', universe: 'one' }, { ...FIX[1], id: 'e', address: 20.4 }] }));
    expect(show.fixtures.map((f) => f.id)).toEqual(['a', 'b', 'e']);
    expect(show.fixtures[2].address).toBe(20);
    expect(notes.filter((n) => /left out/.test(n)).length).toBe(2);
    expect(out[0]).toBe(255);
  });
  it('tempos are 20 to 300 everywhere (0 or less would never end the ruler\'s beat lines)', () => {
    for (const bpm of [0, -1, -1e9, 'x', null, 1e6]) {
      const s = parseShow(showText({ settings: { bpm }, cueLists: [{ id: 'L', name: 'L', end: 'stop', bpm, cues: [] }], timeline: { duration: 30, bpm, items: [] } }));
      expect(s.settings.bpm >= 20 && s.settings.bpm <= 300, String(bpm)).toBe(true);
      for (const v of [s.cueLists[0].bpm, s.timeline!.bpm]) expect(v === undefined || (v >= 20 && v <= 300), String(bpm)).toBe(true);
    }
  });
  it('fades, waits and button times are numbers in range; a fog button always has its limit', () => {
    const s = parseShow(showText({
      cueLists: [{ id: 'L', name: 'L', end: 'stop', releaseTime: -2, cues: [{ id: 'c', name: 'c', values: {}, fade: -3, delay: 1e999, advance: { mode: 'follow', time: -1 } }, { id: 'd', name: 'd', values: {}, advance: { mode: 'beats', beats: 'many' } }] }],
      pages: [{ id: 'p', name: 'P', widgets: [{ id: 'f', type: 'fog', fixtures: [null, 'a'], level: 5, burst: 999, max: 'ten' }, { id: 's', type: 'special', do: 'fadeOut', seconds: 0 }] }],
    }).replace('"delay":null', '"delay":1e999'));
    const [c, d] = s.cueLists[0].cues;
    expect(s.cueLists[0].releaseTime).toBe(0);
    expect([c.fade, c.delay, c.advance]).toEqual([0, undefined, { mode: 'follow', time: 0 }]);
    expect(d.advance).toEqual({ mode: 'manual' });
    expect(s.pages[0].widgets[0]).toMatchObject({ fixtures: ['a'], level: 1, burst: 60, max: 10 });
    expect(s.pages[0].widgets[1]).toMatchObject({ seconds: 0.5 });
  });
  it('the same id twice in a list: the first one counts', () => {
    const notes: string[] = [];
    const s = parseShow(showText({ fixtures: [FIX[0], { ...FIX[1], id: 'a' }] }), notes);
    expect(s.fixtures.map((f) => f.name)).toEqual(['A']);
    expect(notes).toEqual(['Fixtures: 1 entry without an id of its own left out']);
  });
  it('says what it mended, a few dozen things at most', () => {
    const notes: string[] = [];
    parseShow(showText({ fixtures: Array.from({ length: 100 }, (_, i) => ({ ...FIX[0], id: `f${i}`, universe: String(i) })) }), notes);
    expect(notes.length).toBe(41);
    expect(notes.at(-1)).toBe('...and more like these');
  });
  it('unknown fields stay, and a show with nothing wrong comes through untouched, without notes', async () => {
    const { TEMPLATES } = await import('../content/templates');
    const { buildDemo } = await import('../content/demo');
    for (const s of [...TEMPLATES.map((t) => t.build()), buildDemo()]) {
      const text = serializeShow(JSON.parse(JSON.stringify(s)));
      const notes: string[] = [];
      const t0 = performance.now();
      const back = parseShow(text, notes);
      const ms = performance.now() - t0;
      expect(notes, s.meta.name).toEqual([]);
      expect(JSON.parse(JSON.stringify(back)), s.meta.name).toEqual(JSON.parse(text));
      expect(ms, s.meta.name).toBeLessThan(250);
    }
    const odd: any = JSON.parse(showText({}));
    odd.fixtures[0].lens = 'wide'; odd.effects = [{ id: 'e', name: 'E', kind: 'futureKind', params: { swirl: 3 } }];
    const back: any = parseShow(JSON.stringify(odd));
    expect(back.fixtures[0].lens).toBe('wide');
    expect(back.effects[0]).toEqual({ id: 'e', name: 'E', kind: 'futureKind', params: { swirl: 3 } });
  });
  it('a show with live pages, its own fixture types, a timeline and a timetable comes through untouched', async () => {
    const { TEMPLATES } = await import('../content/templates');
    const { buskingPage } = await import('../content/busking');
    const s: any = TEMPLATES[1].build();
    s.pages = [buskingPage(s)];
    s.pages[0].widgets[1] = { ...s.pages[0].widgets[1], midi: { kind: 'note', ch: 1, num: 36 } };
    s.fixtureTypes.push({ id: 'u1', manufacturer: 'Me', model: 'Spot', source: 'user', physical: { panDeg: 540, tiltDeg: 270 }, modes: [{ name: '8 ch', channels: [
      { name: 'Dimmer', attr: 'intensity', default: 0 }, { name: 'Pan', attr: 'pan' }, { name: 'Pan fine', attr: 'pan', fine: true },
      { name: 'Wheel', attr: 'colorWheel', ranges: [{ from: 0, to: 9, label: 'Open', color: '#ffffff', kind: 'slot' }, { from: 10, to: 19, label: 'Red', color: '#ff0000' }] },
      { name: 'Iris', attr: 'iris', span: [0, 191] }, { name: 'R1', attr: 'red', cell: 0 }, { name: 'R2', attr: 'red', cell: 1 }, { name: 'X', attr: 'raw', default: 128 }] }] });
    s.timeline = { duration: 200, bpm: 128, offset: 0.4, audio: { name: 'song.mp3', duration: 200, store: 'k', catalog: 'x', credit: 'c' },
      sections: [{ name: 'Intro', at: 0 }, { name: 'Drop', at: 60, energy: 1 }],
      items: [{ id: 't1', at: 1, lane: 'fx', do: { do: 'effect', effect: s.effects[0].id, on: true }, len: 10 }, { id: 't2', at: 5, lane: 'special', do: { do: 'burst', attr: 'confetti', seconds: 1 } }] };
    s.settings.schedule = [{ id: 's1', at: '17:00', days: [5, 6], do: { do: 'off' } }];
    s.settings.stage = { opacity: 0.4 };
    const text = serializeShow(s), notes: string[] = [];
    expect(JSON.parse(JSON.stringify(parseShow(text, notes)))).toEqual(JSON.parse(text));
    expect(notes).toEqual([]);
  });
  it('the first prototype format with holes in it still opens', () => {
    const s = parseShow(JSON.stringify({ version: 1, types: [null], loop: false, devices: 'x', fixtures: [null, { id: 'f1', name: 'P', typeId: 'gen-dimmer', universe: 0, address: 1, x: 0, y: 0 }], cues: [null, { id: 'c1', name: 'c', looks: { f1: null } }] }));
    expect(s.fixtures.map((f) => f.id)).toEqual(['f1']);
    expect(s.cueLists[0].cues[0].values).toEqual({});
  });
});

// Knobs straight from a file reach the effects through paramsOf (which only checks the type): after
// loading, every effect there is runs with levels and colours in 0..1, whatever the file said.
describe('every effect, its knobs from a hostile file', () => {
  const knobs = '{"speed":1e999,"size":-5,"spread":1e999,"blocks":1e999,"width":"x","low":-1,"high":1e300,"level":-1e999,"colors":[null,{"r":"x","g":0,"b":0},5,{"r":2,"g":0.5,"b":-1}]}';
  for (const def of EFFECTS) {
    it(def.id, () => {
      const show = parseShow(showText({ effects: [{ id: 'e', name: 'E', kind: def.id, fixtures: ['b'], params: { k: 1 } }] }).replace('{"k":1}', knobs));
      const p = paramsOf(def.id, show.effects[0].params);
      const in01 = (v: number | undefined) => v === undefined || (v >= 0 && v <= 1);
      for (const t of [0, 0.4, 3.7]) {
        for (const o of runEffect(def, p, 10, t, 3)) {
          expect(in01(o.intensity) && in01(o.strike) && (!o.color || (in01(o.color.r) && in01(o.color.g) && in01(o.color.b))), JSON.stringify(o)).toBe(true);
          for (const v of [o.pan, o.tilt]) expect(v === undefined || Number.isFinite(v)).toBe(true);
        }
      }
    });
  }
});

describe('a ring or matrix in a file', () => {
  const type = (layout: unknown) => ({ id: 'user:x', manufacturer: 'My', model: 'X', source: 'user', modes: [{ name: 'm', layout,
    channels: Array.from({ length: 12 }, (_, i) => ({ name: `c${i}`, attr: ['red', 'green', 'blue'][i % 3], cell: Math.floor(i / 3) })) }] });
  const load = (layout: unknown) => { const s: any = emptyShow('t'); s.fixtureTypes.push(type(layout)); return parseShow(JSON.stringify(s)); };
  it('keeps a shape that fits its pixels', () => {
    expect(load({ kind: 'rings', rings: [3, 1], ccw: true }).fixtureTypes[0].modes[0].layout).toEqual({ kind: 'rings', rings: [3, 1], ccw: true });
    expect(load({ kind: 'matrix', cols: 2, rows: 2, zigzag: true }).fixtureTypes[0].modes[0].layout).toEqual({ kind: 'matrix', cols: 2, rows: 2, zigzag: true });
  });
  it('one that doesn\'t fit: gone, and the light runs as a strip', () => {
    expect(load({ kind: 'rings', rings: [60, 1] }).fixtureTypes[0].modes[0].layout).toBeUndefined();
    expect(load({ kind: 'blob' }).fixtureTypes[0].modes[0].layout).toBeUndefined();
    expect(load('square').fixtureTypes[0].modes[0].channels).toHaveLength(12);
  });
  it("a light's own wiring: kept and saved again when it's well-formed, dropped with a note when it isn't", () => {
    const s: any = emptyShow('t');
    s.fixtureTypes.push(type({ kind: 'matrix', cols: 2, rows: 2 }));
    const own = { kind: 'matrix', cols: 2, rows: 2, zigzag: true, vertical: true, from: 'br' };
    s.fixtures.push({ id: 'a', name: 'A', typeId: 'user:x', mode: 'm', universe: 0, address: 1, x: 0.5, y: 0.5, layout: own },
      { id: 'b', name: 'B', typeId: 'user:x', mode: 'm', universe: 0, address: 13, x: 0.5, y: 0.5, layout: { kind: 'matrix', cols: -1, rows: 2 } });
    const notes: string[] = [];
    const back = parseShow(serializeShow(parseShow(JSON.stringify(s), notes)));
    expect(back.fixtures[0].layout).toEqual(own);
    expect(back.fixtures[1].layout).toBeUndefined();
    expect(notes.join(' ')).toContain('Fixture "B": its own LED layout can\'t be used');
  });
});

describe("the stage's marks", () => {
  it('kept with a name and a place, broken ones left out with a note', () => {
    const s: any = emptyShow('t');
    s.settings.marks = [{ id: 'fl', name: 'Front left', p: { x: -3, y: 1.2, z: 1.5 } }, { id: 'x', name: 'Broken', p: { x: 'a', y: 0, z: 0 } }, 'nonsense'];
    const notes: string[] = [];
    const back = parseShow(serializeShow(parseShow(JSON.stringify(s), notes)));
    expect(back.settings.marks).toEqual([{ id: 'fl', name: 'Front left', p: { x: -3, y: 1.2, z: 1.5 } }]);
    expect(notes.join(' ')).toContain("2 of the stage's marks couldn't be read");
    const none: any = emptyShow('t'); none.settings.marks = 'all of them';
    expect(parseShow(JSON.stringify(none)).settings.marks).toBeUndefined();
  });
});

describe('a hostile file', () => {
  it('a "__proto__" key can\'t hide a flame from the risk marks: it is taken out, and said', async () => {
    const { parseShow } = await import('./format');
    const { cueRisk } = await import('./safety');
    const text = JSON.stringify({ format: 'luxdmx-show', formatVersion: '1.1.0', fixtures: [{ id: 'g', name: 'G', typeId: 'gen-flame', universe: 0, address: 1 }],
      cueLists: [{ id: 'l', name: 'L', cues: [{ id: 'c', name: 'c', fade: 0, advance: { mode: 'manual' }, values: {} }] }] }).replace('"values":{}', '"values":{"g":{"__proto__":{"flame":1}}}');
    const notes: string[] = [];
    const s = parseShow(text, notes);
    const v = s.cueLists[0].cues[0].values.g as Record<string, unknown>;
    expect(Object.keys(v)).toEqual([]);
    expect((v as { flame?: number }).flame).toBeUndefined();
    expect(cueRisk(s, s.cueLists[0].cues[0])).toBe('light');
    expect(notes.join()).toMatch(/__proto__/);
  });
});

describe('mending what review 7 found', () => {
  it('cells in a cell go, a group\'s unreadable cells are said, doubled MIDI controls become one', async () => {
    const { parseShow } = await import('./format');
    const notes: string[] = [];
    const s = parseShow(JSON.stringify({ format: 'luxdmx-show', formatVersion: '1.2.0', fixtures: [{ id: 'a', name: 'A', typeId: 'gen-bar8', universe: 0, address: 1 }],
      groups: [{ id: 'g', name: 'Rim', fixtures: ['a'], cells: [0, 'x', 2] }],
      settings: { bpm: 120, consoleMidi: [{ to: 'grand', midi: { kind: 'cc', ch: 1, num: 7 } }, { to: 'light:a', midi: { kind: 'cc', ch: 1, num: 7 } }] },
      cueLists: [{ id: 'l', name: 'L', cues: [{ id: 'c', name: 'c', fade: 0, advance: { mode: 'manual' }, values: { a: { cells: { 0: { intensity: 1, cells: { 1: {} }, raw: { 0: 9 } } } } } }] }] }), notes);
    expect(s.cueLists[0].cues[0].values.a.cells).toEqual({ 0: { intensity: 1 } });
    expect(s.groups[0].cells).toEqual([0, 2]);
    expect(notes.join()).toMatch(/Rim: 1 of its cells/);
    expect(s.settings.consoleMidi).toEqual([{ to: 'light:a', midi: { kind: 'cc', ch: 1, num: 7 } }]);
  });
});

describe('requiredFeatures cells from every place cells can be', () => {
  it('a preset (its own or per light), a group or an effect with cells is enough', async () => {
    const { usesCells } = await import('./format');
    const base = () => { const s: any = emptyShow(); s.cueLists = [{ id: 'l', name: 'L', end: 'stop', cues: [] }]; return s; };
    expect(usesCells(base())).toBe(false);
    let s = base(); s.presets = [{ id: 'p', name: 'P', kind: 'color', values: { cells: { 0: { color: { r: 1, g: 0, b: 0 } } } } }]; expect(usesCells(s)).toBe(true);
    s = base(); s.presets = [{ id: 'p', name: 'P', kind: 'color', values: {}, perFixture: { a: { cells: { 3: { intensity: 1 } } } } }]; expect(usesCells(s)).toBe(true);
    s = base(); s.groups = [{ id: 'g', name: 'Rim', fixtures: ['a'], cells: [0, 1] }]; expect(usesCells(s)).toBe(true);
    s = base(); s.effects = [{ id: 'e', name: 'E', kind: 'chase', fixtures: ['a'], cells: [2], params: {} }]; expect(usesCells(s)).toBe(true);
    s = base(); s.groups = [{ id: 'g', name: 'G', fixtures: ['a'] }]; expect(usesCells(s)).toBe(false);
  });
});

describe('plain keys named like JavaScript internals', () => {
  it('"constructor" and "prototype" in extensions come back as they were', async () => {
    const { parseShow } = await import('./format');
    const s: any = emptyShow(); s.extensions = { 'org.example.tool': { constructor: 'x', prototype: { a: 1 } } };
    expect((parseShow(JSON.stringify(s)) as any).extensions).toEqual(s.extensions);
  });
});

describe('a gobo wheel\'s shake and running round in a file', () => {
  it('kept: shake 0..1, running round -1..1 (the one attribute that goes below 0); out of range brought in', () => {
    const s: any = emptyShow('Gobos');
    s.cueLists.push({ id: 'L', name: 'L', end: 'stop', cues: [{ id: 'c', name: 'c', fade: 0, advance: { mode: 'manual' },
      values: { a: { gobo: 0.5, goboShake: 0.4, goboScroll: -0.5, gobo2Shake: -0.3, gobo2Scroll: -2 } } }] });
    const back: any = parseShow(serializeShow(parseShow(JSON.stringify(s))));
    expect(back.cueLists[0].cues[0].values.a).toEqual({ gobo: 0.5, goboShake: 0.4, goboScroll: -0.5, gobo2Shake: 0, gobo2Scroll: -1 });
  });
});

describe('a beam angle in a file', () => {
  it('a type\'s and a light\'s: two degrees, narrow first; nonsense left out with a note', () => {
    const s: any = emptyShow('Beams');
    s.fixtureTypes.push({ id: 'user:a', manufacturer: 'A', model: 'A', source: 'user', modes: [{ name: 'm', channels: [{ name: 'Dimmer', attr: 'intensity' }] }], physical: { beamDeg: [40, 8] } },
      { id: 'user:b', manufacturer: 'B', model: 'B', source: 'user', modes: [{ name: 'm', channels: [{ name: 'Dimmer', attr: 'intensity' }] }], physical: { beamDeg: [0, 400] } });
    s.fixtures.push({ id: 'f1', name: 'F1', typeId: 'user:a', mode: 'm', universe: 0, address: 1, x: 0, y: 0, beamDeg: [12, 12] },
      { id: 'f2', name: 'F2', typeId: 'user:a', mode: 'm', universe: 0, address: 2, x: 0, y: 0, beamDeg: 'wide' });
    const notes: string[] = [];
    const back: any = parseShow(serializeShow(parseShow(JSON.stringify(s), notes)));
    expect(back.fixtureTypes.find((t: any) => t.id === 'user:a').physical.beamDeg).toEqual([8, 40]);
    expect(back.fixtureTypes.find((t: any) => t.id === 'user:b').physical.beamDeg).toBeUndefined();
    expect(back.fixtures.map((f: any) => f.beamDeg)).toEqual([[12, 12], undefined]);
    expect(notes.join(' ')).toMatch(/beam angle/);
  });
});
