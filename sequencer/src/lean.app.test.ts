// @vitest-environment happy-dom
// Under load, with nothing from this page going out (the output thread serves every box, or the
// page is blind), this page's engine works out only the frames the screen shows: every n-th
// (load.uiEvery). It was a sixth of the page's time on the festival demo, most of it never drawn.
// A box this page sends to itself, the machines armed, or a change: every frame as before.
import { describe, expect, it, vi } from 'vitest';
import { freshApp, smallShow } from './app.harness';
import { Engine } from './engine/engine';
import { emptyShow } from './model/format';

describe('the page\'s engine under load', { timeout: 30000 }, () => {
  it('nothing going out from here: it sits out the frames the screen skips', async () => {
    const { app, tick } = await freshApp();
    smallShow(app);
    const { load } = await import('./perf/load.svelte');
    app.bridges = [];
    tick(3);
    const spy = vi.spyOn(app.engine, 'tick');
    load.uiEvery = 3;
    tick(9);
    expect(spy).toHaveBeenCalledTimes(3);
    load.uiEvery = 1; spy.mockClear();
    tick(6);
    expect(spy).toHaveBeenCalledTimes(6);
  });

  it('a box this page sends to itself: every frame, whatever the screen does', async () => {
    const { app, tick } = await freshApp();
    smallShow(app);
    const { load } = await import('./perf/load.svelte');
    // (something plays: a fresh page is quiet until then, nothing goes out from it)
    app.jump(app.show.cueLists[0].id, 0);
    tick(3);
    const spy = vi.spyOn(app.engine, 'tick');
    load.uiEvery = 3;
    tick(9);
    expect(spy).toHaveBeenCalledTimes(9);
    expect(load.outputSafe).toBe(false);
  });

  it('a change shows at once: the frame after it is worked out', async () => {
    const { app, tick } = await freshApp();
    smallShow(app);
    const { load } = await import('./perf/load.svelte');
    app.bridges = [];
    load.uiEvery = 3;
    tick(4);
    const spy = vi.spyOn(app.engine, 'tick');
    app.show.meta.name = 'Changed';
    app.checkpoint();
    tick(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// Auto GO between the engine's ticks: the beat clock counted on from the last tick, or from the song
describe('the beat clock between ticks', () => {
  it('counts on by the time since the last tick, or since the song set it', () => {
    let t = 0;
    const e = new Engine(() => emptyShow(), () => t);
    e.bpm = 120;
    e.tick();
    t = 1; e.tick();
    expect(e.beatCount).toBeCloseTo(2);
    t = 1.5;
    expect(e.beatsAt(1.5)).toBeCloseTo(3);           // (half a second at 120: one more beat)
    e.syncBeats(10);                                  // (a song: its beat now)
    t = 2;
    expect(e.beatsAt(2)).toBeCloseTo(11);             // (from the song's, not twice)
  });
});
