// The gallery's list: every item a built-in light, each with something to show.
import { describe, expect, it } from 'vitest';
import { GALLERY } from './gallery';
import { GENERIC, kindOf } from '../model/library';
import { microShow } from '../stage3d/microShow';
import { rigFixtureFull } from '../stage3d/rigOf';
import { HALL } from '../stage3d/geometry';
import type { Fixture } from '../model/types';

describe('the gallery', () => {
  it('every item is a built-in light (and its extra one), ids once each, and its micro show does something', () => {
    expect(new Set(GALLERY.map((g) => g.id)).size).toBe(GALLERY.length);
    for (const g of GALLERY) {
      const t = GENERIC.find((x) => x.id === g.type);
      expect(t, g.id).toBeTruthy();
      if (g.extra) expect(GENERIC.find((x) => x.id === g.extra), g.id).toBeTruthy();
      const m = t!.modes[0], rf = rigFixtureFull({ id: 'f', name: 'x', typeId: t!.id, mode: m.name, universe: 0, address: 1, x: 0.5, y: 0.5 } as Fixture, m, kindOf(m), t, HALL);
      const s = microShow(rf, m, g.focus);
      // (something lit or firing at some point in its loop)
      const on = Array.from({ length: 40 }, (_, i) => s.at(i * 0.2)).some((v) => (v.intensity ?? 0) > 0.5 || Object.values(v).some((x) => x === 1));
      expect(on, g.id).toBe(true);
    }
  });
});
