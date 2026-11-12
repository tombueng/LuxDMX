// @vitest-environment happy-dom
// A kinetic winch: its height goes out only while the machines are armed; safe (disarmed, Blind,
// the page gone) it stays where it was last sent, never 0 (its top: a winch sent there would run
// all the way up). Its motion enable follows the arming. Soft limits per winch keep whatever a
// cue says within them. Where it was is kept over a reload.
import { describe, expect, it } from 'vitest';
import { freshApp } from './app.harness';
import { Engine } from './engine/engine';
import { cueRisk, isKinetic, isMachine } from './model/safety';
import { upgrade } from './model/format';
import { zeroedFrames, ATMOS_AND_MACHINES } from './output/safe';

// gen-winch: Height, Height fine, Speed, Motion enable, Dimmer, R, G, B
const H = 0, EN = 3;
async function winch(limits?: [number, number]) {
  const h = await freshApp();
  const { app } = h;
  app.show.fixtures.push({ id: 'w', name: 'Winch 1', typeId: 'gen-winch', mode: '', universe: 0, address: 1, x: 0.5, y: 0.3, ...(limits ? { hoistLimits: limits } : {}) });
  app.checkpoint();
  const out = () => { h.tick(); return [...app.engine.tick().frames.get(0)!.slice(0, 8)]; };
  return { ...h, out };
}

describe('a winch', () => {
  it('is a light with a winch: its ball lights as any light, its height waits for Arm', async () => {
    const { app } = await winch();
    const m = app.modeOf('w');
    expect(isKinetic(m)).toBe(true);
    expect(isMachine(m)).toBe(false);
    expect(app.gatedMachines.map((f: { id: string }) => f.id)).toEqual(['w']);
  });
  it('moves only armed; safe, it stays where it was (never 0), its enable off', async () => {
    const { app, out } = await winch();
    app.programmer = { w: { hoist: 0.5, intensity: 1 } };
    let o = out();
    expect([o[H], o[EN], o[4]]).toEqual([0, 0, 255]);           // never armed: its default, enable off (the ball lights)
    app.engine.armed = true;
    o = out();
    expect([o[H], o[EN]]).toEqual([128, 178]);                  // armed: half way down, motion enabled
    app.engine.armed = false;
    app.programmer = { w: { hoist: 0.9 } };
    o = out();
    expect([o[H], o[EN]]).toEqual([128, 0]);                    // safe: held where it was, not 0, not 0.9
    app.engine.armed = true;
    expect(out()[H]).toBe(230);
  });
  it('never past its soft limits, whatever the cue says', async () => {
    const { app, out } = await winch([0.1, 0.6]);
    app.engine.armed = true;
    app.programmer = { w: { hoist: 0.9 } };
    expect(out()[H]).toBe(153);                                 // the lowest it may go: 60 %
    app.programmer = { w: { hoist: 0 } };
    expect(out()[H]).toBe(25);                                  // the highest: 10 %
  });
  it('the safe frames (Blind, closing, a lost page) keep its height and close its enable', async () => {
    const { app, out } = await winch();
    app.engine.armed = true;
    app.programmer = { w: { hoist: 0.5 } };
    out();
    const frames = app.engine.tick().frames;
    const safe = zeroedFrames(frames, app.show.fixtures, (f) => app.modeOf(f.id), (a) => ATMOS_AND_MACHINES.includes(a)).get(0)!;
    expect([safe[H], safe[EN]]).toEqual([128, 0]);
    expect(out()[EN]).toBe(178);
  });
  it('a reload still knows where it was: the page keeps it, a new engine holds it there', async () => {
    const { app, out } = await winch();
    app.engine.armed = true;
    app.programmer = { w: { hoist: 0.5 } };
    out();
    app.armMachines(false);
    const kept = JSON.parse(localStorage.getItem('luxdmx.seq.held') ?? '{}');
    expect(kept['w:hoist'].v).toBe(128);
    const e = new Engine(() => app.show);
    e.heldSeed = { 'w:hoist': 128 };
    e.programmer = { w: { hoist: 1 } };
    expect(e.tick().frames.get(0)![H]).toBe(128);
    // and the page's own engine reads it back when it starts
    const again = await freshApp({ keepStorage: true });
    expect(again.app.engine.heldSeed['w:hoist']).toBe(128);
  });
  it('another tab closing late can\'t put an older height back (the newest kept wins)', async () => {
    const { app, out } = await winch();
    const later = Date.now() + 60_000;
    localStorage.setItem('luxdmx.seq.held', JSON.stringify({ 'w:hoist': { v: 200, at: later }, 'w:hoist:fine': { v: 0, at: later } }));
    app.engine.armed = true;
    app.programmer = { w: { hoist: 0.5 } };
    out();
    app.armMachines(false);
    expect(JSON.parse(localStorage.getItem('luxdmx.seq.held')!)['w:hoist'].v).toBe(200);
  });
  it('armed with nothing saying where: it stays where it was; where it is unknown, its enable stays shut', async () => {
    const { app, out } = await winch();
    app.engine.armed = true;
    app.programmer = { w: { intensity: 1 } };
    let o = out();
    expect([o[H], o[EN], o[4]]).toEqual([0, 0, 255]);           // never known: enable shut, armed or not
    app.programmer = { w: { hoist: 0.5 } };
    expect(out()[EN]).toBe(178);
    app.programmer = { w: { intensity: 1 } };                  // (the height released)
    o = out();
    expect([o[H], o[EN]]).toEqual([128, 178]);                  // held where it is, not run to the top
  });
  it('a number typed on its channel (All channels) becomes its height, within its soft limits; a raw number never moves it', async () => {
    const { app, out } = await winch([0.2, 0.6]);
    app.engine.armed = true;
    app.programmer = { w: { raw: { 0: 255 } } };                 // (as an old file might have it)
    let o = out();
    expect([o[H], o[1], o[EN]]).toEqual([0, 0, 0]);             // not sent: nothing says where, its place unknown
    app.selected = ['w'];
    app.setRawOf('w', [[0, 255]]);
    expect(app.programmer.w.hoist).toBeCloseTo(255 / 256, 2);
    o = out();
    expect([o[H], o[1], o[EN]]).toEqual([153, 153, 178]);       // 60 % of 16 bits, its enable open
  });
  it('a list holding its height let go: it stays there (no fade towards 0, its top)', async () => {
    const { app, out } = await winch();
    app.show.cueLists.push({ id: 'L', name: 'L', end: 'stop', cues: [{ id: 'c', name: 'c', fade: 0, advance: { mode: 'manual' }, values: { w: { hoist: 0.5, intensity: 1 } } }] } as never);
    app.checkpoint();
    app.engine.armed = true;
    app.engine.go('L');
    expect(out()[H]).toBe(128);
    app.engine.release('L', 3);
    for (let i = 0; i < 20; i++) expect(out()[H]).toBe(128);
  });
  it('the place the wire holds is what the 3D shows while live and safe (null: nobody knows)', async () => {
    const { app, out } = await winch();
    expect(app.winchHeldAt('w')).toBeNull();
    app.sfxArmed = true; app.engine.armed = true;
    app.programmer = { w: { hoist: 0.5 } };
    out();
    expect(app.winchHeldAt('w')).toBeUndefined();              // armed: the show's height
    app.armMachines(false);
    app.programmer = { w: { hoist: 0.9 } };
    out();
    expect(app.winchHeldAt('w')).toBeCloseTo(0.5, 2);
  });
  it('Blind freezes it where the wire held it', async () => {
    const { app, out } = await winch();
    app.engine.armed = true;
    app.programmer = { w: { hoist: 0.5 } };
    out();
    const frames = new Map([[0, new Uint8Array(512)]]);
    app.engine.putHeld(frames, app.engine.heldOwn());
    expect([frames.get(0)![H], frames.get(0)![1]]).toEqual([128, 0]);
  });
});

describe('a winch in the show and the file', () => {
  it('a cue that moves it is marked as dangerous', () => {
    expect(cueRisk({ cueLists: [] }, { values: { w: { hoist: 0.4 } } })).toBe('hazard');
    expect(cueRisk({ cueLists: [] }, { values: { w: { cells: { 1: { hoist: 0.4 } } } } })).toBe('hazard');
  });
  it('the file: soft limits on the light, the top one first (wrong ones left out, said)', () => {
    const notes: string[] = [];
    const s = upgrade({ format: 'luxdmx-show', version: '1.2.0', name: 'x', fixtures: [
      { id: 'a', name: 'A', typeId: 'gen-winch', mode: '', universe: 0, address: 1, x: 0, y: 0, hoistLimits: [0.7, 0.2] },
      { id: 'b', name: 'B', typeId: 'gen-winch', mode: '', universe: 0, address: 9, x: 0, y: 0, hoistLimits: [0.2, 3] },
    ] }, notes);
    expect(s.fixtures[0].hoistLimits).toEqual([0.2, 0.7]);
    expect(s.fixtures[1].hoistLimits).toBeUndefined();
    expect(notes.join(' ')).toMatch(/winch limits/);
  });
});

describe('winches of other shapes', () => {
  const EN_RANGES = [{ from: 0, to: 99, label: 'Safe' }, { from: 100, to: 255, label: 'Motion enabled' }];
  async function custom(channels: object[], limits?: [number, number]) {
    const h = await freshApp();
    const { app } = h;
    app.addType({ id: 'user:wx', manufacturer: 'X', model: 'Winch X', source: 'user', modes: [{ name: 'm', channels }] });
    app.show.fixtures.push({ id: 'x', name: 'X', typeId: 'user:wx', mode: 'm', universe: 0, address: 1, x: 0.5, y: 0.3, ...(limits ? { hoistLimits: limits } : {}) });
    app.checkpoint();
    const out = () => { h.tick(); return [...app.engine.tick().frames.get(0)!.slice(0, 6)]; };
    return { ...h, out };
  }
  it('several winches as cells: each held on its own, none moves unarmed, each its own height', async () => {
    const { app, out } = await custom([{ name: 'Enable', attr: 'enable', ranges: EN_RANGES }, { name: 'Height 1', attr: 'hoist', cell: 0 }, { name: 'Height 2', attr: 'hoist', cell: 1 }]);
    expect(app.caps('x').cellMoves).toEqual(['hoist']);
    app.programmer = { x: { hoist: 0.8 } };
    expect(out().slice(0, 3)).toEqual([0, 0, 0]);               // not armed: nothing moves
    app.engine.armed = true;
    app.programmer = { x: { hoist: 0.8, cells: { 1: { hoist: 0.5 } } } };
    expect(out().slice(0, 3)).toEqual([178, 204, 128]);
    app.programmer = {};                                         // (let go)
    expect(out().slice(0, 3)).toEqual([178, 204, 128]);         // each held where it is
    expect(Object.keys(app.engine.heldOwn()).sort()).toEqual(['x:hoist@0', 'x:hoist@1']);
  });
  it('two height channels on one light: both within its limits, each held on its own', async () => {
    const { app, out } = await custom([{ name: 'Height A', attr: 'hoist' }, { name: 'Height B', attr: 'hoist' }, { name: 'Enable', attr: 'enable', ranges: EN_RANGES }], [0, 0.4]);
    app.engine.armed = true;
    app.programmer = { x: { hoist: 0.9 } };
    expect(out().slice(0, 3)).toEqual([102, 102, 178]);
    app.testOverlay = { universe: 0, address: 1, values: [10, 250] };   // (the wizard over it: it doesn't get past)
    expect(out().slice(0, 2)).toEqual([102, 102]);
    expect(Object.keys(app.engine.heldOwn()).sort()).toEqual(['x:hoist', 'x:hoist#1']);
  });
  it('a height on part of its channel (a span): the limits are parts of that span, either way round, with a fine channel too', async () => {
    let { app, out } = await custom([{ name: 'Height', attr: 'hoist', span: [10, 255] }, { name: 'Enable', attr: 'enable', ranges: EN_RANGES }], [0.2, 1]);
    app.engine.armed = true;
    app.programmer = { x: { hoist: 0 } };
    expect(out()[0]).toBe(59);                                   // 10 + 20 % of 245
    app.testOverlay = { universe: 0, address: 1, values: [12] };
    expect(out()[0]).toBe(59);                                   // (the wizard doesn't get past)
    ({ app, out } = await custom([{ name: 'Height', attr: 'hoist', span: [255, 10] }, { name: 'Enable', attr: 'enable', ranges: EN_RANGES }], [0, 0.4]));
    app.engine.armed = true;
    app.programmer = { x: { hoist: 0.9 } };
    expect(out()[0]).toBe(157);                                  // 40 % down a reversed span: 255 - 0.4 * 245
    ({ app, out } = await custom([{ name: 'Height', attr: 'hoist', span: [10, 255] }, { name: 'Height fine', attr: 'hoist', fine: true }, { name: 'Enable', attr: 'enable', ranges: EN_RANGES }], [0.2, 1]));
    app.engine.armed = true;
    app.programmer = { x: { hoist: 0 } };
    expect(out().slice(0, 2)).toEqual([59, 51]);                 // (its fine byte as the render gives it)
  });
  it('its own programs and control channels stay at their off while safe (they\'d move it)', async () => {
    const { app, out } = await custom([{ name: 'Height', attr: 'hoist' }, { name: 'Enable', attr: 'enable', ranges: EN_RANGES },
      { name: 'Program', attr: 'effectMacro', ranges: [{ from: 0, to: 9, label: 'No function' }, { from: 10, to: 255, label: 'Wave' }] }, { name: 'Control', attr: 'control' }]);
    app.programmer = { x: { effectMacro: 1, raw: { 3: 250 } } };
    expect(out().slice(2, 4)).toEqual([5, 0]);
    app.engine.armed = true;
    app.programmer = { x: { hoist: 0.5, effectMacro: 1, raw: { 3: 250 } } };
    expect(out().slice(2, 4)).toEqual([133, 250]);
  });
  it('a machine patched over it can\'t put its height to 0', async () => {
    const { app, out } = await custom([{ name: 'Height', attr: 'hoist' }, { name: 'Enable', attr: 'enable', ranges: EN_RANGES }]);
    app.engine.armed = true;
    app.programmer = { x: { hoist: 0.5 } };
    out();
    app.engine.armed = false;
    app.show.fixtures.push({ id: 'fl', name: 'Flame', typeId: 'gen-flame', mode: '', universe: 0, address: 1, x: 0.2, y: 0.2 });
    app.checkpoint();
    expect(out()[0]).toBe(128);
    app.engine.armed = true;
    expect(out().slice(0, 2)).toEqual([128, 178]);
  });
  it('taken out of the patch or moved to another address: its old channels keep what they had, its enable safe', async () => {
    const { app, out } = await custom([{ name: 'Height', attr: 'hoist' }, { name: 'Enable', attr: 'enable', ranges: EN_RANGES }]);
    app.engine.armed = true;
    app.programmer = { x: { hoist: 0.5 } };
    expect(out().slice(0, 2)).toEqual([128, 178]);
    app.show.fixtures[app.show.fixtures.findIndex((f: { id: string }) => f.id === 'x')].address = 21;
    app.checkpoint();
    let o = out();
    expect(o.slice(0, 2)).toEqual([128, 0]);                   // the old address: held there, enable safe
    app.show.fixtures = app.show.fixtures.filter((f: { id: string }) => f.id !== 'x');
    app.checkpoint();
    o = [...app.engine.tick().frames.get(0)!.slice(0, 22)];
    expect([o[0], o[1], o[20], o[21]]).toEqual([128, 0, 128, 0]);
    // something patched there again: it gives way
    app.show.fixtures.push({ id: 'd', name: 'Dimmer', typeId: 'gen-dimmer', mode: '', universe: 0, address: 1, x: 0.2, y: 0.2 });
    app.checkpoint();
    expect(out()[0]).toBe(0);
  });
  it('a jump on the timeline never moves it: it waits until the list is played on', async () => {
    const { app, out } = await custom([{ name: 'Height', attr: 'hoist' }, { name: 'Enable', attr: 'enable', ranges: EN_RANGES }]);
    app.show.cueLists.push({ id: 'L', name: 'L', end: 'stop', cues: [{ id: 'c', name: 'c', fade: 0, advance: { mode: 'manual' }, values: { x: { hoist: 0.8 } } }] } as never);
    app.checkpoint();
    app.engine.armed = true;
    app.engine.jumpTo('L', 0); app.engine.jumped.add('L');
    expect(out().slice(0, 2)).toEqual([0, 0]);                 // (its place unknown: enable shut)
  });
  it('a grid of winches wider than a universe: the ones in the next universe held too', async () => {
    const chs = [{ name: 'Enable', attr: 'enable', ranges: EN_RANGES }, ...Array.from({ length: 520 }, (_, k) => ({ name: `Height ${k + 1}`, attr: 'hoist', cell: k }))];
    const { app, tick } = await custom(chs);
    const u1 = () => { tick(); const f = app.engine.tick().frames; return { en: f.get(0)![0], h: f.get(1)?.[4] }; };
    app.programmer = { x: { hoist: 0.5 } };
    expect(u1()).toEqual({ en: 0, h: 0 });                        // safe: nothing moves in either universe
    app.engine.armed = true;
    expect(u1()).toEqual({ en: 178, h: 128 });
    app.programmer = {};
    expect(u1()).toEqual({ en: 178, h: 128 });                    // let go: held, also past the first universe
  });
});
