// @vitest-environment happy-dom
// Saving a big pixel show (run with BENCH=1): 8 matrices of 32 x 32, 4 cues with a colour on every
// cell. Prints what a checkpoint (after every edit) and an undo cost in the app.
import { describe, expect, it } from 'vitest';
import { freshApp } from '../app.harness';
import { emptyShow } from '../model/format';
import type { Cue, FixtureType, Show, Values } from '../model/types';

const N = 32 * 32, M = 8;
const T: FixtureType = { id: 'user:m32', manufacturer: 'X', model: 'Matrix 32', source: 'user', modes: [{ name: 'm', layout: { kind: 'matrix', cols: 32, rows: 32 },
  channels: [...Array(N).keys()].flatMap((c) => [{ name: `R ${c + 1}`, attr: 'red' as const, cell: c }, { name: `G ${c + 1}`, attr: 'green' as const, cell: c }, { name: `B ${c + 1}`, attr: 'blue' as const, cell: c }]) }] };
function show(cues: number): Show {
  const s: Show = { ...emptyShow(), fixtureTypes: [T] };
  s.fixtures = [...Array(M).keys()].map((i) => ({ id: `m${i}`, name: `M ${i + 1}`, typeId: T.id, mode: 'm', universe: i * 6, address: 1, x: i / M, y: 0.3 }));
  const cue = (q: number): Cue => ({ id: `c${q}`, name: `Cue ${q + 1}`, fade: 2, advance: { mode: 'manual' },
    values: Object.fromEntries(s.fixtures.map((f) => [f.id, { intensity: 1, cells: Object.fromEntries([...Array(N).keys()].map((k) => [k, { color: { r: (k % 7) / 7, g: q / cues, b: 0.5 } }])) } as Values])) });
  s.cueLists = [{ id: 'play', name: 'Play', cues: [...Array(cues).keys()].map(cue), end: 'stop', play: true }];
  return s;
}
describe.skipIf(!process.env.BENCH)('saving a big pixel show', () => {
  it('checkpoint and undo', async () => {
    const { app } = await freshApp();
    await app.startShow(show(4), false);
    const ms = (f: () => void) => { const a = performance.now(); f(); return +(performance.now() - a).toFixed(0); };
    const cp = [0, 1, 2].map((i) => ms(() => { app.show.cueLists[0].cues[0].name = `Renamed ${i}`; app.checkpoint(); }));
    const un = ms(() => app.undo());
    console.log(`4 full-rig cell cues: checkpoint ${cp.join(' / ')} ms, undo ${un} ms, show ${(JSON.stringify(app.show).length / 1e6).toFixed(1)} MB`);
    expect(app.show.cueLists[0].cues.length).toBe(4);
  }, 300000);
});
