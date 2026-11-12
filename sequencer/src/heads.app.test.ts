// @vitest-environment happy-dom
// A moving bar whose heads tilt on their own (cells that are heads): the programmer points picked
// heads (the rest keep the bar's), a cue keeps each head's tilt and plays it back, a move effect
// runs along the heads as a wave, and the bar's own pan stays the bar's.
import { describe, expect, it } from 'vitest';
import { freshApp } from './app.harness';
import { lerpResolved } from './engine/resolve';

// the generic bar: pan, speed, then per head tilt, dimmer, R, G, B, W
const TILT = (k: number) => 2 + k * 6;
async function bar() {
  const h = await freshApp();
  const { app } = h;
  app.show.fixtures.push({ id: 'b', name: 'Bar', typeId: 'gen-headbar4', mode: '', universe: 0, address: 1, x: 0.5, y: 0.3 });
  app.checkpoint();
  const out = () => { h.tick(); return [...app.engine.tick().frames.get(0)!.slice(0, 26)]; };
  return { ...h, out };
}

describe('a moving bar\'s heads', () => {
  it('are a mover with four heads', async () => {
    const { app } = await bar();
    expect(app.caps('b')).toMatchObject({ position: true, heads: 4, cells: 4 });
    expect(app.kinds.b).toBe('mover');
  });
  it('the programmer: picked heads tilt on their own, the others keep the bar\'s; the bar pans as one', async () => {
    const { app, out } = await bar();
    app.selected = ['b'];
    app.set({ intensity: 1, tilt: 0.5 });
    app.selectCells([1, 2]);
    app.set({ tilt: 0.8 });
    let o = out();
    expect([0, 1, 2, 3].map((k) => o[TILT(k)])).toEqual([128, 204, 204, 128]);
    expect(app.programmer.b.cells).toMatchObject({ 1: { tilt: 0.8 }, 2: { tilt: 0.8 } });
    // the bar's pan is the bar's (not a head's): the whole light
    app.set({ pan: 0.25 });
    expect(out()[0]).toBe(64);
    expect(app.programmer.b.pan).toBe(0.25);
    // an encoder on picked heads turns just them, from where each is
    app.selectCells([3]);
    app.nudge('tilt', -0.3);
    o = out();
    expect(o[TILT(3)]).toBe(51);
    expect(o[TILT(1)]).toBe(204);
    // the whole bar tilted: every head follows (their own tilts let go)
    app.selectCells(null);
    app.set({ tilt: 0.1 });
    o = out();
    expect([0, 1, 2, 3].map((k) => o[TILT(k)])).toEqual([26, 26, 26, 26]);
  });
  it('a cue keeps each head\'s tilt and plays it back', async () => {
    const { app, out } = await bar();
    app.show.cueLists.push({ id: 'L', name: 'L', end: 'stop', cues: [{ id: 'c', name: 'Heads', fade: 0, advance: { mode: 'manual' },
      values: { b: { intensity: 1, tilt: 0.5, cells: { 0: { tilt: 0 }, 3: { tilt: 1 } } } } }] } as never);
    app.checkpoint();
    app.engine.go('L');
    const o = out();
    expect([0, 1, 2, 3].map((k) => o[TILT(k)])).toEqual([0, 128, 128, 255]);
  });
  it('a move effect runs along the heads: a tilt wave puts each head somewhere else', async () => {
    const { app, out } = await bar();
    app.show.effects.push({ id: 'w', name: 'Wave', kind: 'tilt', fixtures: ['b'], params: { size: 0.4, spread: 1, speed: 1 } } as never);
    app.programmer = { b: { intensity: 1, tilt: 0.5 } };
    app.engine.startEffect('w');
    for (let i = 0; i < 60; i++) out();
    const o = out(), tilts = [0, 1, 2, 3].map((k) => o[TILT(k)]);
    expect(Math.max(...tilts) - Math.min(...tilts)).toBeGreaterThan(5);      // (somewhere else along the wave)
  });
});

describe('a pan move on a bar whose heads only tilt', () => {
  it('pans the whole bar (its own pan channel), the heads still tilt along', async () => {
    const { app, out } = await bar();
    app.show.effects.push({ id: 'p', name: 'Sweep', kind: 'pan', fixtures: ['b'], params: { size: 0.4, spread: 1, speed: 1 } } as never);
    app.programmer = { b: { intensity: 1, pan: 0.5, tilt: 0.5 } };
    app.engine.startEffect('p');
    const pans = new Set<number>();
    for (let i = 0; i < 80; i++) pans.add(out()[0]);
    expect(pans.size).toBeGreaterThan(5);                                     // the bar's pan moves
  });
});

describe('a head\'s tilt fading', () => {
  it('on the cue\'s position time, from its own (else the light\'s) to the next cue\'s', () => {
    const a = { tilt: 0.5, cellVals: { 1: { tilt: 0 } } }, b = { tilt: 0.5, cellVals: { 1: { tilt: 1 } } };
    const mid = lerpResolved(a as never, b as never, 0.5, 0.5, undefined, { color: 0.5, position: 0.25, beam: 0.5 });
    expect(mid.cellVals?.[1]?.tilt).toBeCloseTo(0.25, 5);       // (a quarter of the way: the position time)
  });
  it('a fade done before its position time: the heads are still on their way (no jump at the end of the fade)', () => {
    const a = { tilt: 0.5, cellVals: { 1: { tilt: 0 } } }, b = { tilt: 0.5, cellVals: { 1: { tilt: 1 } } };
    const at = lerpResolved(a as never, b as never, 1, 1, undefined, { color: 1, position: 0.2, beam: 1 });
    expect(at.cellVals?.[1]?.tilt).toBeCloseTo(0.2, 5);
  });
});

describe('a moving bar\'s heads kept', () => {
  const fan = async () => {
    const h = await bar(), { app } = h;
    app.selected = ['b']; app.set({ intensity: 1, tilt: 0.5 });
    [0, 1, 2, 3].forEach((k) => { app.selectCells([k]); app.set({ tilt: [0, 0.33, 0.66, 1][k] }); });
    app.selectCells([]);
    h.tick(2);
    return h;
  };
  const tilts = (o: number[]) => [0, 1, 2, 3].map((k) => o[TILT(k)]);
  it('Record keeps each head\'s own tilt from the stage: a fan from a cue, only the colour changed, plays back as a fan', async () => {
    const { app, out, tick } = await bar();
    app.show.cueLists.push({ id: 'F', name: 'Fan', end: 'stop', cues: [{ id: 'f', name: 'fan', fade: 0, advance: { mode: 'manual' },
      values: { b: { intensity: 1, tilt: 0.5, cells: { 0: { tilt: 0 }, 1: { tilt: 0.33 }, 2: { tilt: 0.66 }, 3: { tilt: 1 } } } } }] } as never);
    app.checkpoint();
    app.engine.go('F'); tick(2);
    expect(tilts(out())).toEqual([0, 84, 168, 255]);
    app.selected = ['b']; app.set({ color: { r: 1, g: 0, b: 0 } }); tick(2);
    expect(app.record()).toBe(true);
    const rec = app.show.cueLists.flatMap((l: { id: string; cues: { id: string }[] }) => l.cues.map((c) => ({ l: l.id, c }))).find((x: { c: { id: string } }) => x.c.id !== 'f');
    expect(Object.keys(rec.c.values.b.cells ?? {}).sort()).toEqual(['0', '1', '2', '3']);
    app.engine.stop('F'); app.programmer = {}; tick(1);
    const l = app.show.cueLists.find((x: { id: string }) => x.id === rec.l);
    app.engine.jumpTo(rec.l, l.cues.indexOf(rec.c), 0);
    expect(tilts(out())).toEqual([0, 84, 168, 255]);
  });
  it('a position preset keeps each head\'s own position, and puts the fan back', async () => {
    const { app, out } = await fan();
    const p = app.presetFromSelection('position', 'Fan');
    app.programmer = { b: { intensity: 1, tilt: 0.5 } };
    expect(tilts(out())).toEqual([128, 128, 128, 128]);
    app.selected = ['b'];
    app.applyPreset(p.id);
    expect(tilts(out())).toEqual([0, 84, 168, 255]);
  });
  it('an encoder with no heads picked turns each head from where it is: a fan stays a fan', async () => {
    const { app, out } = await fan();
    app.nudge('tilt', -0.1);
    const t = tilts(out());
    expect(t[3] - t[0]).toBeGreaterThan(200);
    expect(t[1]).toBeLessThan(84);
  });
  it('Record keeps the other axes and a winch\'s height too', async () => {
    const h = await freshApp(), { app } = h;
    app.show.fixtures.push({ id: 'r', name: 'Roller', typeId: 'gen-roll', mode: '', universe: 0, address: 1, x: 0.5, y: 0.3 });
    app.checkpoint();
    app.selected = ['r']; app.set({ intensity: 1, roll: 0.3 });
    h.tick(2);
    expect(app.record()).toBe(true);
    expect(app.show.cueLists[0].cues[0].values.r.roll).toBeCloseTo(0.3, 5);
  });
});

describe('a bar that tilts as a whole besides its heads', () => {
  it('the bar\'s own tilt goes to the bar; its heads stay at their middle unless set (the angle doesn\'t count twice)', async () => {
    const h = await freshApp(), { app } = h;
    app.addType({ id: 'user:bt', manufacturer: 'X', model: 'Tilt bar', source: 'user', modes: [{ name: 'm', channels: [
      { name: 'Tilt', attr: 'tilt' }, { name: 'Tilt 1', attr: 'tilt', cell: 0 }, { name: 'Dim 1', attr: 'intensity', cell: 0 }, { name: 'Tilt 2', attr: 'tilt', cell: 1 }, { name: 'Dim 2', attr: 'intensity', cell: 1 }] }] });
    app.show.fixtures.push({ id: 't', name: 'T', typeId: 'user:bt', mode: 'm', universe: 0, address: 1, x: 0.5, y: 0.3 });
    app.checkpoint();
    app.programmer = { t: { intensity: 1, tilt: 0.8, cells: { 1: { tilt: 0.2 } } } };
    h.tick();
    const o = [...app.engine.tick().frames.get(0)!.slice(0, 5)];
    expect([o[0], o[1], o[3]]).toEqual([204, 128, 51]);
  });
});
