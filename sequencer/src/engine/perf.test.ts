// A big show must not get near the frame budget (25 ms at 40 Hz): 120 fixtures over 3 universes
// (PARs, pixel bars, 16-bit movers), 3 lists running with fades, 10 effects.
import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { TEMPLATES } from '../content/templates';
import type { Fixture, Show } from '../model/types';

// the cost of a frame: the best of a few short runs, so another busy process on the machine (a
// browser, a build) doesn't fail the test, while a real slowdown still does
function perFrame(tick: () => void, runs = 6, frames = 30): number {
  let best = Infinity;
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) tick();
    best = Math.min(best, (performance.now() - t0) / frames);
  }
  return best;
}

function bigShow(): Show {
  const s = TEMPLATES[1].build();                     // DJ: presets, groups, effects in cues
  const types = ['gen-drgbwauvs', 'gen-bar12', 'gen-mover16', 'gen-rgbw'];
  s.fixtures = [];
  for (let i = 0; i < 120; i++) {
    const typeId = types[i % 4];
    s.fixtures.push({ id: `f${i}`, name: `F${i}`, typeId, mode: '', universe: Math.floor(i / 40), address: 1 + (i % 40) * 12, x: (i % 12) / 12, y: Math.floor(i / 12) / 10 } as Fixture);
  }
  const ids = s.fixtures.map((f) => f.id);
  s.groups = [0, 1, 2, 3].map((k) => ({ id: `g${k}`, name: `G${k}`, fixtures: ids.filter((_, i) => i % 4 === k) }));
  s.effects = ['rainbow', 'chase', 'circle', 'meteor', 'fire', 'wave', 'figure8', 'sparkle', 'police', 'colorFade']
    .map((kind, i) => ({ id: `e${i}`, name: kind, kind, group: `g${i % 4}`, params: {} }));
  s.cueLists = [0, 1, 2].map((l) => ({ id: `l${l}`, name: `L${l}`, end: 'loop' as const, cues: [0, 1, 2, 3].map((c) => ({
    id: `l${l}c${c}`, name: `C${c}`, fade: 1.5, advance: { mode: 'wait' as const, time: 2 },
    values: Object.fromEntries(ids.filter((_, i) => i % 3 === l).map((id) => [id, { intensity: 0.5 + c / 8, color: { r: c / 3, g: 1 - c / 3, b: 0.5 }, pan: c / 4, tilt: 0.5 }])),
    effects: [`e${(l * 3 + c) % 10}`],
  })) }));
  return s;
}

describe('engine speed', () => {
  it('a big show renders a frame well inside the 25 ms budget', () => {
    const s = bigShow();
    let t = 0;
    const e = new Engine(() => s, () => t);
    for (const l of s.cueLists) e.go(l.id);
    for (let i = 0; i < 40; i++) { t += 0.025; e.tick(); }       // warm up
    const ms = perFrame(() => { t += 0.025; e.tick(); });
    expect(e.fxWeights.size).toBeGreaterThan(2);
    console.log(`engine: ${ms.toFixed(2)} ms per frame`);
    expect(ms).toBeLessThan(6);
  });
  it('the big demo (233 lights, 114 of them moving heads, 22 universes) in its busiest look stays inside the budget', async () => {
    const { buildDemo } = await import('../content/demo');
    const s = buildDemo();
    let t = 0;
    const e = new Engine(() => s, () => t);
    const L = s.cueLists[0];
    e.jumpTo(L.id, L.cues.findIndex((c) => c.name.startsWith('Final')), 0);
    for (let i = 0; i < 40; i++) { t += 0.025; e.tick(); }
    const ms = perFrame(() => { t += 0.025; e.tick(); }, 5, 20);
    console.log(`engine, the big demo: ${ms.toFixed(2)} ms per frame`);
    expect(e.fxWeights.size).toBeGreaterThan(4);
    expect(ms).toBeLessThan(12);
  });
});
