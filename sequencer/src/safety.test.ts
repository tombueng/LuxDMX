// @vitest-environment happy-dom
// Safety: confetti, flames, sparks and CO2 send 0 until a person arms them (the stage still shows
// them); blind sends nothing new (the boxes keep the last live look); scrubbing or jumping on the
// timeline never fires a moment, playing forward through it does.
import { describe, expect, it } from 'vitest';
import { freshApp, smallShow } from './app.harness';
import { riskOf } from './model/safety';

async function withMachines(opts: { output?: 'live' | 'blind' } = {}) {
  const h = await freshApp(opts);
  smallShow(h.app);
  h.app.show.fixtures.push(
    { id: 'fl', name: 'Flame', typeId: 'gen-flame', mode: '', universe: 0, address: 10, x: 0.3, y: 0.9 },
    { id: 'cf', name: 'Confetti', typeId: 'gen-confetti', mode: '', universe: 0, address: 11, x: 0.7, y: 0.9 },
  );
  h.app.checkpoint();
  return h;
}
const last = (sent: { data: number[] }[]) => sent.at(-1)!.data;

describe('machines wait for a person to arm them', () => {
  it('a flame and a confetti cannon at full send 0 until armed; the stage has them all along', async () => {
    const { app, sent, tick } = await withMachines();
    app.programmer = { fl: { flame: 1 }, cf: { confetti: 1 }, p1: { intensity: 1 } };
    tick(2);
    expect(last(sent).slice(0, 1)).toEqual([255]);                 // the light goes out
    expect(last(sent).slice(9, 11)).toEqual([0, 0]);               // the machines don't
    expect(app.stage.fl.flame).toBe(1);                            // (the 3D stage shows the flame)
    // arming doesn't fire what was set while they were safe: it has to be off once first
    app.armMachines(true); tick(2);
    expect(last(sent).slice(9, 11)).toEqual([0, 0]);
    app.programmer = { p1: { intensity: 1 } }; tick(1);
    app.programmer = { fl: { flame: 1 }, cf: { confetti: 1 }, p1: { intensity: 1 } }; tick(1);
    expect(last(sent).slice(9, 11)).toEqual([255, 255]);
    app.armMachines(false); tick(2);
    expect(last(sent).slice(9, 11)).toEqual([0, 0]);
  });
  it('arming only on stage; going blind, another show or a reload makes them safe', async () => {
    const { app } = await withMachines({ output: 'blind' });
    app.armMachines(true);
    expect(app.sfxArmed).toBe(false);                              // blind: nothing to arm
    app.setOutput('live'); app.armMachines(true);
    expect(app.sfxArmed).toBe(true);
    app.setOutput('blind');
    expect(app.sfxArmed).toBe(false);
    app.setOutput('live'); app.armMachines(true);
    await app.newShow();
    expect(app.sfxArmed).toBe(false);
    expect(app.engine.armed).toBe(false);
  });
  it('the classes: light, atmosphere, once, hazard', () => {
    expect(riskOf(['intensity', 'red'])).toBe('light');
    expect(riskOf(['fog'])).toBe('atmosphere');
    expect(riskOf(['confetti'])).toBe('once');
    expect(riskOf(['intensity', 'flame'])).toBe('hazard');
  });
});

describe('blind and live', () => {
  it('a new browser is blind: nothing goes out until it goes live', async () => {
    const { app, sent, tick } = await withMachines({ output: 'blind' });
    expect(app.output).toBe('blind');
    app.programmer = { p1: { intensity: 1 } }; tick(3);
    expect(sent.length).toBe(0);
    app.setOutput('live'); tick(2);
    expect(last(sent)[0]).toBe(255);
  });
  it('going blind keeps the last live look on the stage; new changes stay here until live again', async () => {
    const { app, sent, tick } = await withMachines();
    app.programmer = { p1: { intensity: 1 } }; tick(2);
    app.setOutput('blind');
    app.programmer = { p1: { intensity: 0.2 }, p2: { intensity: 1 } }; tick(3);
    expect(last(sent).slice(0, 2)).toEqual([255, 0]);              // frozen: what was out
    expect(app.stage.p2.intensity).toBe(1);                        // the preview has the new look
    app.setOutput('live'); tick(2);
    expect(last(sent).slice(0, 2)).toEqual([51, 255]);
  });
  it('going blind stops fog and the machines in the look the stage keeps, and disarms', async () => {
    const { app, sent, tick } = await withMachines();
    app.armMachines(true); tick(1);
    app.programmer = { fl: { flame: 1 }, fg: { fog: 1 }, p1: { intensity: 1 } }; tick(2);
    expect([last(sent)[0], last(sent)[2], last(sent)[9]]).toEqual([255, 255, 255]);
    app.setOutput('blind'); tick(2);
    expect([last(sent)[0], last(sent)[2], last(sent)[9]]).toEqual([255, 0, 0]);   // the light stays, fog and flame stop
    expect(app.sfxArmed).toBe(false);
  });
  it('Blackout reaches the stage while blind (and lets the held look back after)', async () => {
    const { app, sent, tick } = await withMachines();
    app.programmer = { p1: { intensity: 1 }, p2: { intensity: 0.5 } }; tick(2);
    app.setOutput('blind'); tick(1);
    app.blackout = true; tick(2);
    expect(last(sent).slice(0, 2)).toEqual([0, 0]);
    app.blackout = false; tick(2);
    expect(last(sent).slice(0, 2)).toEqual([255, 128]);
  });
});

describe('nobody there, nothing fires', () => {
  it('a list the timetable plays keeps its machines quiet (armed or not) until a person steps it on', async () => {
    const { app, sent, tick } = await withMachines();
    app.armMachines(true);
    app.show.cueLists.push({ id: 'F', name: 'Fire', end: 'stop', cues: [
      { id: 'f1', name: 'Flames', values: { fl: { flame: 1 } }, fade: 0, advance: { mode: 'manual' } },
      { id: 'f2', name: 'Flames again', values: { fl: { flame: 1 } }, fade: 0, advance: { mode: 'manual' } },
    ] });
    app.show.settings.schedule = [{ id: 'x', at: '00:00', do: { do: 'start', list: 'F' } }];
    app.runSchedule(new Date());                                   // its first look: what should be on now
    tick(2);
    expect(app.engine.isOn('F')).toBe(true);
    expect(last(sent)[9]).toBe(0);
    app.engine.go('F'); tick(2);
    expect(last(sent)[9]).toBe(255);
  });
  it('GO never steps through the machine shots, even when they are the first list', async () => {
    const { app } = await withMachines();
    app.show.cueLists.unshift({ id: 'M', name: 'Flames', end: 'stop', cues: [{ id: 'm1', name: 'Shot', values: { fl: { flame: 1 } }, fade: 0, advance: { mode: 'manual' } }] });
    expect(app.liveList?.id).toBe('L');
  });
});

describe('a frame that throws', () => {
  it('the look that went out goes out again, fog and the machines off; the app says so once', async () => {
    const { app, sent, tick } = await withMachines();
    app.armMachines(true); tick(1);
    app.programmer = { p1: { intensity: 1 }, fg: { fog: 1 }, fl: { flame: 1 } }; tick(2);
    expect([last(sent)[0], last(sent)[2], last(sent)[9]]).toEqual([255, 255, 255]);
    const real = app.engine.tick.bind(app.engine);
    app.engine.tick = () => { throw new Error('broken'); };
    const n = sent.length;
    tick(3);
    expect(sent.length).toBeGreaterThan(n);
    expect([last(sent)[0], last(sent)[2], last(sent)[9]]).toEqual([255, 0, 0]);
    app.engine.tick = real;
  });
});

describe('the timeline never fires a moment from a jump or a scrub', () => {
  it('scrubbing back and forth over a flame moment fires nothing; playing through it does', async () => {
    const { app } = await withMachines();
    const fired: string[] = [];
    const real = app.doTimeline.bind(app);
    app.doTimeline = (a: { do: string; attr?: string }, x: boolean) => { if (a.do === 'burst') fired.push(a.attr!); return real(a, x); };
    app.show.timeline = { duration: 60, bpm: 120, items: [{ id: 'm', at: 5, lane: 'special', do: { do: 'burst', attr: 'flame', seconds: 1 } }] };
    const P = app.timeline;
    P.scrubStart();
    for (const t of [0, 4, 5, 6, 10, 5, 4.99, 5.01, 0, 5]) P.scrub(t);
    P.scrubEnd(5);
    for (const t of [3, 5, 7, 5]) P.seek(t);
    P.tick();
    expect(fired).toEqual([]);
    // playing forward through it: once (the page's clock: no sound device in the test)
    P.seek(4.5);
    await P.play();
    const t0 = performance.now();
    while (performance.now() - t0 < 900) { P.tick(); await new Promise((r) => setTimeout(r, 20)); }
    P.pause();
    expect(fired).toEqual(['flame']);
  });
});

describe('Play right after a jump', () => {
  it('a moment where a jump landed is not played into (Go to a CO2 moment, Space); from the very start it is', async () => {
    const { app } = await withMachines();
    const fired: string[] = [];
    const real = app.doTimeline.bind(app);
    app.doTimeline = (a: { do: string; attr?: string }, x: boolean) => { if (a.do === 'burst') fired.push(a.attr!); return real(a, x); };
    app.show.timeline = { duration: 60, bpm: 120, items: [
      { id: 'a', at: 0, lane: 'special', do: { do: 'burst', attr: 'fog', seconds: 1 } },
      { id: 'b', at: 5, lane: 'special', do: { do: 'burst', attr: 'co2', seconds: 1 } }] };
    const P = app.timeline;
    const playFor = async (ms: number) => { await P.play(); const t0 = performance.now(); while (performance.now() - t0 < ms) { P.tick(); await new Promise((r) => setTimeout(r, 20)); } P.pause(); };
    P.seek(5);
    await playFor(300);
    expect(fired).toEqual([]);
    P.seek(0);
    await playFor(300);
    expect(fired).toEqual(['fog']);
  });
});

describe('a jump onto a cue that holds a machine', () => {
  it('a cue with flames held, jumped to on the timeline: no flame (even armed) until the list really moves on', async () => {
    const { app, sent, tick } = await withMachines();
    app.armMachines(true);
    app.show.cueLists.push({ id: 'F', name: 'Fire', end: 'stop', cues: [
      { id: 'f1', name: 'Flames', values: { fl: { flame: 1 } }, fade: 0, advance: { mode: 'manual' } },
      { id: 'f2', name: 'Flames again', values: { fl: { flame: 1 } }, fade: 0, advance: { mode: 'manual' } },
    ] });
    app.show.timeline = { duration: 60, bpm: 120, items: [{ id: 'a', at: 2, lane: 'list:F', do: { do: 'goto', list: 'F', cue: 'f1' } }] };
    app.timeline.scrubStart(); app.timeline.scrub(10); app.timeline.scrubEnd(10); tick(3);
    expect(app.engine.isOn('F')).toBe(true);
    expect(last(sent)[9]).toBe(0);                   // jumped to: quiet
    app.engine.go('F'); tick(2);
    expect(last(sent)[9]).toBe(255);                 // GO: it really moved on
  });
});
