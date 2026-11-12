// @vitest-environment happy-dom
// The console's command line on the app as a whole (clock stopped, a fake box): cues by their
// number, Next / Prev through the selection, lights by their fixed numbers.
import { describe, expect, it } from 'vitest';
import { freshApp } from './app.harness';

async function show() {
  const r = await freshApp();
  r.app.show.fixtures.push(
    { id: 'a', name: 'A', typeId: 'gen-dimmer', mode: '', universe: 0, address: 1, x: 0.2, y: 0.3 },
    { id: 'b', name: 'B', typeId: 'gen-dimmer', mode: '', universe: 0, address: 2, x: 0.4, y: 0.3 },
    { id: 'c', name: 'C', typeId: 'gen-dimmer', mode: '', universe: 0, address: 3, x: 0.6, y: 0.3 },
  );
  r.app.checkpoint();
  return r;
}
const run = (app: any, t: string) => app.runCommand(t);

describe('cues by number on the command line', () => {
  it('record cue N goes where its number belongs, with its time; a taken number is said', async () => {
    const { app } = await show();
    run(app, '1 @ full'); expect(run(app, 'record').ok).toBe(true);
    run(app, '2 @ full'); expect(run(app, 'record').ok).toBe(true);
    const l = app.liveList ?? app.list;
    run(app, '3 @ full');
    expect(run(app, 'record cue 1.5 time 4')).toEqual({ ok: true, said: `Recorded cue 1.5 into ${l.name}` });
    expect(l.cues.map((c: any) => c.num)).toEqual([1, 1.5, 2]);
    expect(l.cues[1].fade).toBe(4);
    run(app, '1 @ 50');
    const r = run(app, 'record cue 2');
    expect(r.ok).toBe(false);
    expect(r.said).toMatch(/has cue 2 .*update cue 2/);
  });
  it('goto, update, time and delete by number', async () => {
    const r = await show(), { app } = r;
    run(app, '1 @ full'); run(app, 'record');
    run(app, '2 @ full'); run(app, 'record');
    const l = app.liveList ?? app.list;
    run(app, 'clear');
    expect(run(app, 'goto cue 2').ok).toBe(true);
    r.tick(5);
    expect(app.engine.status(l.id).index).toBe(1);
    expect(run(app, 'cue 2 time 0.5')).toEqual({ ok: true, said: 'Cue 2 fades in 0.5 s' });
    expect(l.cues[1].fade).toBe(0.5);
    run(app, '3 @ 30');
    expect(run(app, 'update cue 1')).toEqual({ ok: true, said: `Updated cue 1 in ${l.name}` });
    expect(l.cues[0].values.c.intensity).toBeCloseTo(0.3);
    expect(run(app, 'goto cue 9')).toEqual({ ok: false, said: `${l.name} has no cue 9` });
    expect(run(app, 'delete cue 1').ok).toBe(true);
    expect(l.cues.length).toBe(1);
    app.undo();
    expect((app.liveList ?? app.list).cues.length).toBe(2);
  });
});

describe('Next and Prev', () => {
  it('step through the selection one light at a time, All brings it back; one light: by number', async () => {
    const { app } = await show();
    run(app, '3 + 1');
    expect(app.selected).toEqual(['c', 'a']);
    expect(run(app, 'next').said).toBe('3 C (1 of 2)');
    expect(run(app, 'next').said).toBe('1 A (2 of 2)');
    expect(run(app, 'next').said).toBe('3 C (1 of 2)');
    expect(run(app, 'prev').said).toBe('1 A (2 of 2)');
    app.stepBack();
    expect(app.selected).toEqual(['c', 'a']);
    expect(app.stepAll).toBe(null);
    // one selected: the next by number; a new selection ends stepping
    run(app, '1');
    expect(run(app, 'next').said).toBe('2 B');
    expect(run(app, 'prev').said).toBe('1 A');
    expect(run(app, 'prev').said).toBe('3 C');
    run(app, '1 thru 2'); run(app, 'next');
    expect(app.stepAll).toEqual(['a', 'b']);
    app.select('c', false);
    expect(app.stepAll).toBe(null);
  });
});

describe('review fixes', () => {
  it('record cue N far from the cue a running play is on: stored, the play and the stage stay', async () => {
    const r = await show(), { app } = r;
    for (const n of [1, 2, 3]) { run(app, `${n} @ full`); r.tick(1); run(app, 'record'); r.tick(1); }
    const l = app.liveList ?? app.list;
    l.play = true;
    for (const c of l.cues) { c.fade = 0; c.fadeOut = 0; }               // (the clock is the real one: no fades to wait for)
    app.go(l.id); r.tick(1);
    run(app, 'goto cue 1'); r.tick(5);
    const before = [...app.engine.tick().frames.get(0)!.slice(0, 3)];
    run(app, '2 @ 40'); r.tick(1);
    const said = run(app, 'record cue 4.5').said;
    expect(said).toMatch(/the play stays where it is/);
    r.tick(5);
    expect(app.engine.status(l.id).index).toBe(0);                          // still on cue 1
    expect(app.programmer.b?.intensity).toBeCloseTo(0.4);                   // the programmer keeps it
    expect(l.cues.map((c: any) => c.num)).toEqual([1, 2, 3, 4.5]);
    run(app, 'clear'); r.tick(5);
    expect([...app.engine.tick().frames.get(0)!.slice(0, 3)]).toEqual(before);
  });
  it('a list let go by its fader plays at full when a goto starts it again', async () => {
    const r = await show(), { app } = r;
    run(app, '1 @ full'); r.tick(1); run(app, 'record'); r.tick(1);
    const l = app.liveList ?? app.list;
    for (const c of l.cues) { c.fade = 0; c.fadeOut = 0; }               // (the clock is the real one: no fades to wait for)
    run(app, 'clear');
    app.playbackFader(l.id, 1); r.tick(2);
    app.playbackFader(l.id, 0); r.tick(5);
    expect(run(app, 'goto cue 1').ok).toBe(true);
    r.tick(5);
    expect(app.engine.status(l.id).master).toBe(1);
    expect(app.engine.tick().frames.get(0)![0]).toBe(255);
  });
  it('update list N needs that list playing; delete keeps the other numbers; "-" says what it took out', async () => {
    const r = await show(), { app } = r;
    for (const n of [1, 2, 3]) { run(app, `${n} @ full`); r.tick(1); run(app, 'record'); r.tick(1); }
    const l = app.liveList ?? app.list;
    app.engine.stop(l.id);
    run(app, '1 @ 50');
    expect(run(app, 'update list 1').said).toMatch(/isn't playing/);
    run(app, 'clear');
    run(app, 'delete cue 1');
    expect(run(app, 'goto cue 3').ok).toBe(true);
    expect(run(app, '1 thru 3 - 2').said).toBe('2 lights (2 taken out)');
  });
  it('a cell group by command picks its cells; effects take only lights with the same picks', async () => {
    const r = await freshApp(), { app } = r;
    app.show.fixtures.push(
      { id: 'b', name: 'Bar', typeId: 'gen-bar8', mode: '', universe: 0, address: 1, x: 0.3, y: 0.3 },
      { id: 'b2', name: 'Bar 2', typeId: 'gen-bar8', mode: '', universe: 0, address: 31, x: 0.5, y: 0.3 },
    );
    app.checkpoint();
    run(app, '1 + 2'); app.selectCells([0, 7]);
    app.groupFromSelection('Ends');
    run(app, 'clear'); app.selectNone();
    expect(run(app, 'group 1').said).toBe('2 lights, 4 cells');
    expect(app.cellSel).toEqual({ b: [0, 7], b2: [0, 7] });
    // different cells on each: the effect only on the one picked like the first
    run(app, '1.1 thru 1.2 + 2.5');
    const e = app.addEffect('chase');
    expect(e.fixtures).toEqual(['b']);
    expect(e.cells).toEqual([0, 1]);
  });
});

describe('record only changes', () => {
  it('stores just what the programmer holds, so a play tracks; Update merges into the cue', async () => {
    const r = await show(), { app } = r;
    run(app, '1 + 2 @ full'); r.tick(1); run(app, 'record'); r.tick(1);
    const l = app.liveList ?? app.list;
    l.play = true;
    app.show.settings.recordChanges = true;
    run(app, '1 @ 50'); r.tick(1); run(app, 'record'); r.tick(1);
    expect(l.cues[1].values).toEqual({ a: { intensity: 0.5 } });            // (light 2 isn't in it: it tracks)
    run(app, '3 @ 30'); r.tick(1);
    expect(run(app, 'update cue 2').ok).toBe(true);
    expect(l.cues[1].values).toEqual({ a: { intensity: 0.5 }, c: { intensity: 0.3 } });
    run(app, '1 @ 70'); r.tick(1);
    run(app, 'update cue 2');
    expect(l.cues[1].values.a).toEqual({ intensity: 0.7 });
    // whole looks again: a touched light keeps all it shows
    delete app.show.settings.recordChanges;
    run(app, 'clear'); run(app, '2 @ 20'); r.tick(1); run(app, 'record'); r.tick(1);
    expect(Object.keys(l.cues[l.cues.length - 1].values)).toEqual(['b']);
  });
});

describe('console faders on MIDI', () => {
  it('take over only once they reach the fader; a pad flashes and goes back; locked: nothing', async () => {
    const r = await show(), { app } = r;
    app.show.settings.consoleMidi = [{ to: 'grand', midi: { kind: 'cc', ch: 1, num: 7 } }, { to: 'grand', midi: { kind: 'note', ch: 1, num: 36 } }];
    const cc = (v: number) => app.midi({ kind: 'cc', ch: 1, num: 7, value: v });
    app.grandMaster = 0.5;
    cc(0.1); expect(app.grandMaster).toBe(0.5);                   // (far from it: not yet)
    cc(0.3); expect(app.grandMaster).toBe(0.5);
    cc(0.6); expect(app.grandMaster).toBe(0.6);                   // (crossed it: taken over)
    cc(0.2); expect(app.grandMaster).toBe(0.2);
    app.midi({ kind: 'note', ch: 1, num: 36, value: 1 }); expect(app.grandMaster).toBe(1);
    app.midi({ kind: 'note', ch: 1, num: 36, value: 0 }); expect(app.grandMaster).toBe(0.2);
    app.midi({ kind: 'note', ch: 1, num: 36, value: 1 }); app.releaseMidi(); expect(app.grandMaster).toBe(0.2);
    cc(0.2); cc(0.3); expect(app.grandMaster).toBe(0.3);         // (taken over again, at the fader)
    app.show.pages = [{ id: 'p', name: 'Service', widgets: [], locked: true }]; app.view = 'live';   // (locked for the service)
    expect(app.locked).toBe(true);
    cc(0.35); expect(app.grandMaster).toBe(0.3);                 // (taken over, so only the lock holds it)
    app.view = 'console';
    cc(0.4); expect(app.grandMaster).toBe(0.4);
  });
});

describe('undo and help by command', () => {
  it('"undo" takes the last change back; "help" says what to type', async () => {
    const r = await show(), { app } = r;
    run(app, '1 @ full'); r.tick(1); run(app, 'record'); r.tick(1);
    const l = app.liveList ?? app.list;
    expect(l.cues.length).toBe(1);
    expect(run(app, 'oops')).toEqual({ ok: true, said: 'Undone' });
    expect((app.liveList ?? app.list)?.cues.length ?? 0).toBe(0);
    expect(run(app, 'help').said).toMatch(/^Try: 5 @ full/);
  });
});
