// @vitest-environment happy-dom
// A render's show on a clock of its own: the timeline's cues come at their moments on that clock
// (whatever the wall clock does), a burst holds on for its seconds, it starts from the look as it
// is, and the live show (its engine, what goes to the box) never hears of it.
import { describe, expect, it } from 'vitest';
import { freshApp, smallShow } from '../app.harness';
import type { Timeline, TimelineItem } from '../model/timeline';
import { ShowAt } from './showAt';

const goto = (id: string, at: number, cue: string): TimelineItem => ({ id, at, lane: 'list:L', do: { do: 'goto', list: 'L', cue } });

async function setup() {
  const h = await freshApp();
  const { app } = h;
  smallShow(app);
  app.show.timeline = { duration: 10, bpm: 120, offset: 0, items: [goto('a', 1, 'c1'), goto('b', 4, 'c2'),
    { id: 'f', at: 6, lane: 'special', do: { do: 'burst', attr: 'fog', seconds: 2 } }] } as Timeline;
  app.checkpoint();
  const copy = JSON.parse(JSON.stringify(app.show));
  const host = { show: copy, burstValues: (a: never) => app.burstValues(a), shown: (s: never, f: never) => app.ledShown(s, f) };
  return { ...h, host };
}
const lvl = (m: { stage: Record<string, { intensity?: number }> }, id: string) => Math.round((m.stage[id]?.intensity ?? 0) * 1000) / 1000;

describe('a render\'s own show', () => {
  it('plays the timeline on its own clock: each cue at its moment, a burst for its seconds', async () => {
    const { app, host } = await setup();
    const s = new ShowAt(host, app.renderStart(), 0, host.show.timeline, true);
    expect(lvl(s.step(0.5), 'p1')).toBe(0);                     // nothing yet
    expect(lvl(s.step(1.0), 'p1')).toBe(1);                     // c1 at 1 s
    expect(lvl(s.step(3.9), 'p2')).toBe(1);
    const at4 = s.step(4.0);
    expect([lvl(at4, 'p1'), lvl(at4, 'p2')]).toEqual([0.5, 0.2]);   // c2 at 4 s
    expect(s.step(6.1).stage.fg?.fog).toBe(1);                  // the fog burst
    expect(s.step(7.9).stage.fg?.fog).toBe(1);
    expect(s.step(8.2).stage.fg?.fog ?? 0).toBe(0);             // its 2 s are over
    // (never back in time)
    expect(s.now).toBe(8.2); s.step(3); expect(s.now).toBe(8.2);
  });
  it('from the middle of the song: the stage as the timeline has it there', async () => {
    const { app, host } = await setup();
    const s = new ShowAt(host, app.renderStart(), 5, host.show.timeline);
    expect(lvl(s.step(5), 'p2')).toBe(0.2);
  });
  it('starts from the look as it is (a list playing), and the live show never hears of it', async () => {
    const { app, host, tick, sent } = await setup();
    app.engine.go('L'); tick();                                  // live: Warm on stage
    const before = sent.length;
    const s = new ShowAt(host, app.renderStart(), 0, undefined);
    expect(lvl(s.step(0.1), 'p1')).toBe(1);                      // the render starts from it
    // the render's own list moves on; the live one doesn't
    s.engine.go('L');
    expect(lvl(s.step(0.2), 'p2')).toBe(0.2);
    tick();
    expect(app.engine.status('L').index).toBe(0);
    expect(sent.slice(before).every((x) => x.data[1] === 255)).toBe(true);   // the box still gets Warm (P2 full)
  });
  it('the programmer only when asked for', async () => {
    const { app, host } = await setup();
    app.programmer = { p1: { intensity: 0.3 } };
    expect(lvl(new ShowAt(host, app.renderStart(), 0).step(0), 'p1')).toBe(0);
    expect(lvl(new ShowAt(host, app.renderStart(true), 0).step(0), 'p1')).toBeCloseTo(0.3, 5);
  });
});
