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
