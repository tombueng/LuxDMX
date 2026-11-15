// The plan's names: under each light when there's room, beside it when the row below is taken,
// left out where it would read as another light's (a selected light always keeps its name), inside
// the plan; a crowded plan tries a smaller size and keeps the one that fits more.
import { describe, expect, it } from 'vitest';
import { bestLabels, placeLabels, type Labels } from './stageLabels';
import type { Fixture } from '../model/types';

const W = 1000, H = 560;
const fx = (id: string, x: number, y: number): Fixture => ({ id, name: `Light ${id}`, typeId: 'gen-dimmer', mode: '', universe: 0, address: 1, x, y });
const opts = (fixtures: Fixture[], selected: string[] = []): Labels =>
  ({ fixtures, selected, text: (f) => f.name, halfW: () => 8, size: 12, px: 1, W, H, edge: 0.035 });

describe('names on the plan', () => {
  it('two lights far apart: each name right under its light', () => {
    const at = placeLabels(opts([fx('a', 0.2, 0.3), fx('b', 0.7, 0.3)]), 12);
    for (const [id, x] of [['a', 200], ['b', 700]] as const) {
      expect(at.get(id)).toMatchObject({ x, anchor: 'middle' });
      expect(at.get(id)!.y).toBeGreaterThan(0.3 * H);
    }
  });
  it('a light right under another: the upper one\'s name goes beside it, not onto the lower light', () => {
    const at = placeLabels(opts([fx('a', 0.5, 0.3), fx('b', 0.5, 0.3 + 26 / H)]), 12);
    expect(at.get('a')?.anchor).not.toBe('middle');
    expect(at.get('b')).toMatchObject({ anchor: 'middle' });
  });
  it('no room anywhere: left out, unless the light is selected', () => {
    const row = Array.from({ length: 40 }, (_, i) => fx(`l${i}`, 0.05 + i * 0.022, 0.5));
    const at = placeLabels(opts(row), 12);
    expect([...at.values()].some((v) => v === null)).toBe(true);
    expect(placeLabels(opts(row, ['l20']), 12).get('l20')).not.toBeNull();
  });
  it('a name never sticks out of the plan', () => {
    const at = placeLabels(opts([fx('edge', 0.995, 0.5)]), 12);
    const a = at.get('edge');
    if (a) expect(a.anchor === 'start' ? a.x + 'Light edge'.length * 12 * 0.6 : a.x).toBeLessThanOrEqual(W);
  });
  it('a crowded plan: a smaller size when it fits more names', () => {
    const grid = Array.from({ length: 60 }, (_, i) => fx(`g${i}`, 0.05 + (i % 12) * 0.08, 0.15 + Math.floor(i / 12) * 0.13));
    const r = bestLabels(opts(grid), 1.4);
    const shown = (m: Map<string, unknown>) => [...m.values()].filter(Boolean).length;
    expect(shown(r.at)).toBeGreaterThanOrEqual(shown(placeLabels(opts(grid), 12 * 1.4)));
    expect([16.8, 14.7, 10.5]).toContain(Math.round(r.fs * 10) / 10);
  });
});

// A curtain or a drop is drawn as a thin line across the stage: the names of the lights hung along
// it still go under them (a name over the line reads, it has its dark outline, and isn't taken for
// the cloth's), and the cloth's own name sits at one of its ends, inside the plan. Before, four fly
// bars and a curtain across the theatre's stage left out a third of its names.
describe('a cloth across the stage', () => {
  const lights = Array.from({ length: 8 }, (_, i) => fx(`l${i}`, 0.15 + i * 0.1, 0.4));
  const drop = { ...fx('drop', 0.5, 0.4 + 30 / H), name: 'Fly 1' };
  const o: Labels = { ...opts([...lights, drop]), halfW: (id) => (id === 'drop' ? 480 : 8), cloth: (id) => id === 'drop' };
  it('the lights along it keep their names; the cloth\'s is at its end', () => {
    const at = placeLabels(o, 12);
    for (const l of lights) expect(at.get(l.id), l.id).not.toBeNull();
    const d = at.get('drop')!;
    expect(d).not.toBeNull();
    expect(Math.abs(d.x - 500)).toBeGreaterThan(300);               // (at an end, not in the middle)
    expect(d.x).toBeGreaterThan(0); expect(d.x).toBeLessThan(W);
  });
});
