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

// Deleting a machine takes the list that only set it going (its shot) with it, and with that list
// what started it: a cue's "start Confetti", its button. A list that does anything else stays.
describe('deleting machines', () => {
  it('their shot lists go, and the cue actions that started them; the other lists stay', async () => {
    const { app } = await freshApp();
    const { TEMPLATES } = await import('./content/templates');
    app.replaceShow(TEMPLATES.find((t: any) => t.name === 'Wedding')!.build());
    const listNames = () => app.show.cueLists.map((l: any) => l.name);
    expect(listNames()).toEqual(expect.arrayContaining(['Confetti', 'Bubbles', 'Wedding']));
    const toss = () => app.show.cueLists.find((l: any) => l.name === 'Wedding').cues.find((c: any) => c.name === 'Bouquet toss');
    expect(toss().actions?.length).toBeGreaterThan(0);
    app.selected = app.show.fixtures.filter((f: any) => /^(Confetti|Bubbles)/.test(f.name)).map((f: any) => f.id);
    const r = app.removeFixtures();
    expect(r.lists.sort()).toEqual(['Bubbles', 'Confetti']);
    expect(listNames()).not.toContain('Confetti'); expect(listNames()).not.toContain('Bubbles');
    expect(listNames()).toEqual(expect.arrayContaining(['Wedding', 'Sparks', 'Haze']));
    expect(toss().actions ?? []).toEqual([]);                          // ("start Confetti" went with it)
    expect(app.show.pages.flatMap((p: any) => p.widgets).some((w: any) => w.list && !app.show.cueLists.some((l: any) => l.id === w.list))).toBe(false);
    // undo brings them all back
    app.undo();
    expect(listNames()).toEqual(expect.arrayContaining(['Confetti', 'Bubbles']));
    expect(toss().actions?.length).toBeGreaterThan(0);
  }, 60000);
});
