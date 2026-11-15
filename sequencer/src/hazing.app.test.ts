// @vitest-environment happy-dom
// The fog machines making fog that no held fog button is behind (Live's "Fog on · Stop" chip):
// worked out from the fog machines only (found once per change of the lights, not on every frame),
// so a machine patched later is in it too, and one held by its button isn't.
import { describe, expect, it } from 'vitest';
import { freshApp, smallShow } from './app.harness';

describe('app.hazing', { timeout: 30000 }, () => {
  it('the machines a cue left fogging; a new one as soon as it is patched; not one held by hand', async () => {
    const { app, tick } = await freshApp();
    smallShow(app);
    app.show.cueLists[0].cues[0].values.fg = { fog: 1 };
    app.checkpoint();
    app.jump('L', 0); tick(3);
    expect(app.hazing).toEqual(['fg']);
    // a second machine, patched now, fogging in the same cue
    app.show.fixtures.push({ id: 'fg2', name: 'Fog 2', typeId: 'gen-fog', mode: '', universe: 0, address: 10, x: 0.8, y: 0.2 });
    app.show.cueLists[0].cues[0].values.fg2 = { fog: 1 };
    app.checkpoint();
    app.jump('L', 0); tick(3);
    expect(app.hazing.sort()).toEqual(['fg', 'fg2']);
    // a light isn't a fog machine, however it's set
    expect(app.hazing).not.toContain('p1');
    // held by its button: that one isn't "left on"
    app.live = { ...app.live, fg2: { fog: 1 } };
    tick(2);
    expect(app.hazing).toEqual(['fg']);
  });
});
