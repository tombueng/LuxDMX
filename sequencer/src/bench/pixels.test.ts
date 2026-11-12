// A big pixel rig, measured (not a check: run with BENCH=1 npx vitest run src/bench). 8 matrices of
// 32 x 32 RGB, a play of 20 cues each with a colour on every cell, a second list and effects on
// cells, a group master on a group of cells, the programmer holding 2 x 1024 cells. Prints the
// time per frame (median, p99) and per GO, with the output thread's caches on and off.
import { describe, expect, it } from 'vitest';
import { Engine } from '../engine/engine';
import { emptyShow } from '../model/format';
import type { Cue, Fixture, FixtureType, Show, Values } from '../model/types';

const N = 32 * 32, M = 8;
const T: FixtureType = { id: 'user:m32', manufacturer: 'X', model: 'Matrix 32', source: 'user', modes: [{ name: 'm', layout: { kind: 'matrix', cols: 32, rows: 32 },
  channels: [...Array(N).keys()].flatMap((c) => [{ name: `R ${c + 1}`, attr: 'red' as const, cell: c }, { name: `G ${c + 1}`, attr: 'green' as const, cell: c }, { name: `B ${c + 1}`, attr: 'blue' as const, cell: c }]) }] };
const hsv = (h: number) => { const f = (n: number) => { const k = (n + h * 6) % 6; return 1 - Math.max(0, Math.min(k, 4 - k, 1)); }; return { r: f(5), g: f(3), b: f(1) }; };
function show(): Show {
  const s: Show = { ...emptyShow(), fixtureTypes: [T] };
  s.fixtures = [...Array(M).keys()].map((i): Fixture => ({ id: `m${i}`, name: `M ${i + 1}`, typeId: T.id, mode: 'm', universe: i * 6, address: 1, x: i / M, y: 0.3 }));
  const cue = (q: number): Cue => ({ id: `c${q}`, name: `Cue ${q + 1}`, fade: 2, advance: { mode: 'manual' },
    values: Object.fromEntries(s.fixtures.map((f) => [f.id, { intensity: 1, cells: Object.fromEntries([...Array(N).keys()].map((k) => [k, { color: hsv((k / N + q / 20) % 1) }])) } as Values])) });
  s.cueLists = [{ id: 'play', name: 'Play', cues: [...Array(20).keys()].map(cue), end: 'stop', play: true },
    { id: 'two', name: 'Two', cues: [{ ...cue(7), id: 'x7' }], end: 'stop', play: false }];
  s.groups = [{ id: 'rim', name: 'Rim', fixtures: s.fixtures.map((f) => f.id), cells: [...Array(32).keys()] }];
  s.effects = [{ id: 'e1', name: 'Wave', kind: 'wave', fixtures: s.fixtures.map((f) => f.id), params: {} }, { id: 'e2', name: 'Chase', kind: 'chase', group: 'rim', params: {} }];
  return s;
}
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { median: +s[Math.floor(s.length / 2)].toFixed(1), p99: +s[Math.floor(s.length * 0.99)].toFixed(1) }; };

describe.skipIf(!process.env.BENCH)('a big pixel rig', () => {
  for (const cache of [false, true]) it(`frames and GO, caches ${cache ? 'on' : 'off'}`, () => {
    const s = show();
    let t = 0;
    const e = new Engine(() => s, () => t);
    e.cacheTracks = cache;
    e.start('play'); e.start('two'); e.startEffect('e1'); e.startEffect('e2');
    e.groupMasters = { rim: 0.6 }; e.grandMaster = 0.9;
    e.programmer = { m0: { cells: Object.fromEntries([...Array(N).keys()].map((k) => [k, { color: hsv(k / N) }])) }, m1: { cells: Object.fromEntries([...Array(N).keys()].map((k) => [k, { intensity: 0.5 }])) } };
    const frames: number[] = [], gos: number[] = [];
    for (let q = 0; q < 12; q++) {
      const g0 = performance.now(); e.go('play'); gos.push(performance.now() - g0);
      for (let f = 0; f < 30; f++) { t += 0.025; const a = performance.now(); e.tick(); frames.push(performance.now() - a); }
    }
    console.log(`caches ${cache ? 'on ' : 'off'}: frame`, stats(frames), 'GO', stats(gos));
    expect(frames.length).toBe(360);
  }, 300000);
});
