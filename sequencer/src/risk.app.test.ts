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

// A cue that only moves scenery on a winch (a curtain, a drop) is marked as that, not as a machine
// that fires: the Theatre's every scene change moves a drop, and a client read pyro on all of them.
// It's still a hazard for the wire (it waits for Arm); a cue that also fires sparks says machine.
describe('the winch mark', () => {
  it('a scene change that flies a drop: "winch"; with sparks too: "machine"; still a hazard for Arm', async () => {
    const { app } = await freshApp();
    const { TEMPLATES } = await import('./content/templates');
    const { cueMarkOf, listMarkOf } = await import('./ui/risk');
    app.replaceShow(TEMPLATES.find((t) => t.name === 'Theatre')!.build()); app.checkpoint();
    const show = app.show.cueLists.find((l: any) => l.name === 'Show'), cue = (n: string) => show.cues.find((c: any) => c.name === n);
    expect(cueMarkOf(app.show, cue('Forest'), app.showRev)).toBe('winch');
    expect(cueMarkOf(app.show, cue('Battle'), app.showRev)).toBe('hazard');          // (CO2 and sparks on the charge)
    expect(cueMarkOf(app.show, cue('Finale'), app.showRev)).toBe('hazard');
    expect(listMarkOf(app.show, show, app.showRev)).toBe('hazard');
    const { cueRiskOf } = await import('./ui/risk');
    expect(cueRiskOf(app.show, cue('Forest'), app.showRev)).toBe('hazard');          // (the wire still waits for Arm)
    // a list of nothing but the curtain: winch
    const curtain = app.show.fixtures.find((f: any) => f.name === 'House curtain');
    app.checkpoint(); show.cues.push({ ...cue('Forest'), id: 'only-curtain', name: 'Only the curtain', values: { [curtain.id]: { hoist: 1 } }, actions: [] }); app.checkpoint();
    expect(cueMarkOf(app.show, cue('Only the curtain'), app.showRev)).toBe('winch');
    expect(cueMarkOf(app.show, cue('Bows'), app.showRev)).toBe('winch');
  }, 60000);
});

// The cards' looks and pictures: a list nobody changed keeps its looks (the same objects, its
// pictures not drawn again); a changed cue gets a new look and a new picture; moving a light on the
// plan draws the pictures again (where the lights are is in them).
describe('the cards\' pictures', () => {
  it('kept while nothing they show changed, new when it did', async () => {
    const { app } = await freshApp();
    const { buildDemo } = await import('./content/demo');
    const { lookSvg, layoutKey } = await import('./ui/thumb');
    app.replaceShow(buildDemo()); app.checkpoint();
    const [l0, l1] = app.show.cueLists, before0 = app.cueLooksOf.get(l0.id), before1 = app.cueLooksOf.get(l1.id);
    const pic = (look: any) => lookSvg(app.plain.fixtures, layoutKey(app.plain.fixtures, app.kinds), look, app.kinds, 160, 90, false);
    const svg0 = pic(before0[0]);
    // a light renamed: nothing a card shows
    app.checkpoint(); app.show.fixtures[1].name += ' x'; app.checkpoint();
    expect(app.cueLooksOf.get(l0.id)).toBe(before0); expect(app.cueLooksOf.get(l1.id)).toBe(before1);
    expect(pic(app.cueLooksOf.get(l0.id)[0])).toBe(svg0);
    // a cue of the first list changed: that list's looks are new, the other's kept
    const f = Object.keys(l0.cues[0].values)[0];
    app.checkpoint(); l0.cues[0].values[f] = { intensity: 1, color: { r: 0, g: 1, b: 0 } }; app.checkpoint();
    expect(app.cueLooksOf.get(l0.id)).not.toBe(before0); expect(app.cueLooksOf.get(l1.id)).toBe(before1);
    expect(pic(app.cueLooksOf.get(l0.id)[0])).not.toBe(svg0);
    // a light moved on the plan: the same look, drawn again
    const look1 = app.cueLooksOf.get(l1.id)[0], s1 = pic(look1);
    app.checkpoint(); app.show.fixtures[0].x = 0.01; app.show.fixtures[0].y = 0.02; app.checkpoint();
    expect(app.cueLooksOf.get(l1.id)[0]).toBe(look1);
    expect(pic(look1)).not.toBe(s1);
  }, 60000);
});
