// @vitest-environment happy-dom
// The risk marks on the cards come from the app's plain copy, all cues at once per change of the
// show (reading every cue through the show's proxies took 50 ms a change on the festival): the
// same marks as worked out on the show itself, a new cue's mark before the copy has it, and a
// changed cue's mark after the change is saved.
import { describe, expect, it } from 'vitest';
import { freshApp } from './app.harness';

describe('the risk marks', () => {
  it('the same from the plain copy as from the show; they follow a change', async () => {
    const { app } = await freshApp();
    const { buildDemo } = await import('./content/demo');
    const { cueRiskOf, machines } = await import('./ui/risk');
    const { cueRisk } = await import('./model/safety');
    app.replaceShow(buildDemo()); app.checkpoint();
    const of = machines(app.show), all = app.show.cueLists.flatMap((l: any) => l.cues);
    const want = all.map((c: any) => cueRisk(app.show, c, undefined, of));
    expect(new Set(want).size).toBeGreaterThan(1);                         // (the festival has light and machines)
    expect(all.map((c: any) => cueRiskOf(app.show, c, app.showRev))).toEqual(want);
    // a cue that fires nothing made to fire a machine: its mark changes with the save
    const i = want.indexOf('light'), cue = all[i], fx = app.show.fixtures.find((f: any) => /Flame/.test(f.name));
    app.checkpoint(); cue.values[fx.id] = { flame: 1 }; app.checkpoint();
    expect(cueRiskOf(app.show, cue, app.showRev)).toBe('hazard');
  }, 60000);
});
