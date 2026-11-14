// @vitest-environment happy-dom
// A light dragged on the 2D plan moves in 3D too when it has its own place there (every template
// light has): by as much as on the plan, at the same height, turned the same. One without its own
// place goes where the plan puts it anyway.
import { describe, expect, it } from 'vitest';
import { freshApp } from './app.harness';

describe('the plan and the 3D place', () => {
  it('a drag on the plan moves the light\'s 3D place by the same metres, its height and turn kept', async () => {
    const { app } = await freshApp();
    const { TEMPLATES } = await import('./content/templates');
    const { planToWorld, roomFor } = await import('./stage3d/geometry');
    app.replaceShow(TEMPLATES.find((t: any) => t.name === 'Wedding')!.build());
    const f = app.show.fixtures.find((x: any) => x.name === 'Uplight 5'), r = roomFor(app.show.settings.stage3d);
    const p0 = { ...f.p3 }, rot0 = { ...f.rot }, x0 = f.x, y0 = f.y;
    app.moveFixture(f.id, x0 + 0.2, y0 - 0.1);
    const a = planToWorld(x0, y0, r), b = planToWorld(f.x, f.y, r);
    expect(f.p3.x).toBeCloseTo(p0.x + (b.x - a.x), 2);
    expect(f.p3.z).toBeCloseTo(p0.z + (b.z - a.z), 2);
    expect(f.p3.y).toBe(p0.y); expect(f.rot).toEqual(rot0);
    expect(Math.abs(f.p3.x - p0.x)).toBeGreaterThan(3);              // (a fifth of the 22 m plan: metres, not nothing)
  }, 60000);
});
