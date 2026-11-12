// @vitest-environment happy-dom
// Picking single cells in the programmer (the app as a whole, clock stopped, a fake box): what the
// brightness and colour controls do to them, what Record keeps, presets, spreads, Off, Highlight.
import { describe, expect, it } from 'vitest';
import { freshApp } from './app.harness';

const RED = { r: 1, g: 0, b: 0 }, BLUE = { r: 0, g: 0, b: 1 };
// a pixel bar of 8 RGB cells at 1 and a plain dimmer at 30
async function barShow() {
  const r = await freshApp();
  r.app.show.fixtures.push(
    { id: 'b', name: 'Bar', typeId: 'gen-bar8', mode: '', universe: 0, address: 1, x: 0.3, y: 0.3 },
    { id: 'b2', name: 'Bar 2', typeId: 'gen-bar8', mode: '', universe: 0, address: 31, x: 0.5, y: 0.3 },
    { id: 'd', name: 'Dim', typeId: 'gen-dimmer', mode: '', universe: 0, address: 61, x: 0.7, y: 0.3 },
  );
  r.app.checkpoint();
  return r;
}
const out = (r: Awaited<ReturnType<typeof barShow>>) => { r.tick(2); return r.app.engine.tick().frames.get(0)!; };
const cell = (f: Uint8Array, k: number, at = 0) => [...f.slice(at + 3 * k, at + 3 * k + 3)];

describe('picking cells', () => {
  it('only on lights that have them, only the ones they have, and a new selection drops them', async () => {
    const r = await barShow(), { app } = r;
    app.selected = ['b', 'd'];
    app.selectCells([1, 3, 3, 99]);
    expect(app.cellSel).toEqual({ b: [1, 3] });
    expect(app.cellsPicked('d')).toEqual([]);
    app.select('b', false);
    expect(app.cellSel).toEqual({});
    app.selected = ['b', 'b2']; app.selectCells([0]);
    expect(app.cellSel).toEqual({ b: [0], b2: [0] });
    app.selectCells(null);
    expect(app.cellSel).toEqual({});
  });
  it('brightness and colour go to the picked cells, the rest of the light keeps what it had', async () => {
    const r = await barShow(), { app } = r;
    app.selected = ['b']; app.set({ intensity: 1, color: BLUE });
    app.selectCells([2, 3]); app.set({ color: RED });
    expect(app.programmer.b).toEqual({ intensity: 1, color: BLUE, cells: { 2: { color: RED }, 3: { color: RED } } });
    const f = out(r);
    expect(cell(f, 2)).toEqual([255, 0, 0]);
    expect(cell(f, 0)).toEqual([0, 0, 255]);
    // what the controls read: the first picked cell
    expect(app.look.b.cellVals?.[2]?.color).toEqual(RED);
  });
  it('the whole light again (Whole) takes the cells with it: all blue means every cell blue', async () => {
    const r = await barShow(), { app } = r;
    app.selected = ['b']; app.selectCells([0]); app.set({ intensity: 1, color: RED });
    app.selectCells(null); app.set({ color: BLUE });
    expect(app.programmer.b.cells).toEqual({ 0: { intensity: 1 } });
    expect(cell(out(r), 0)).toEqual([0, 0, 255]);
  });
  it('Off on picked cells switches just them off', async () => {
    const r = await barShow(), { app } = r;
    app.selected = ['b']; app.set({ intensity: 1, color: RED });
    app.selectCells([5]); app.off();
    const f = out(r);
    expect(cell(f, 5)).toEqual([0, 0, 0]);
    expect(cell(f, 4)).toEqual([255, 0, 0]);
  });
  it('a colour on dark cells lights them, not the rest of the light', async () => {
    const r = await barShow(), { app } = r;
    app.selected = ['b']; app.selectCells([1]);
    app.set({ color: RED }); app.lightUpIfDark();
    const f = out(r);
    expect(cell(f, 1)).toEqual([255, 0, 0]);
    expect(cell(f, 2)).toEqual([0, 0, 0]);
  });
  it('a rainbow over picked cells runs cell by cell, across the lights in order', async () => {
    const r = await barShow(), { app } = r;
    app.selected = ['b', 'b2']; app.selectCells([0, 7]);
    app.spreadColors('rainbow');
    const steps = [app.programmer.b.cells[0].color, app.programmer.b.cells[7].color, app.programmer.b2.cells[0].color, app.programmer.b2.cells[7].color];
    expect(new Set(steps.map((c: typeof RED) => JSON.stringify(c))).size).toBe(4);
    expect(steps[0]).toEqual(RED);                   // starts red
    // and goes round the wheel in that order: bar 1's cells, then bar 2's
    const hue = (c: typeof RED) => { const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b), d = mx - mn; if (!d) return 0; const h = mx === c.r ? ((c.g - c.b) / d + 6) % 6 : mx === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4; return h * 60; };
    const hs = steps.map(hue);
    for (let i = 1; i < hs.length; i++) expect(hs[i]).toBeGreaterThan(hs[i - 1]);
  });
  it('a colour preset goes to the picked cells by reference', async () => {
    const r = await barShow(), { app } = r;
    const p = app.show.presets.find((x: { kind: string }) => x.kind === 'color');
    app.selected = ['b']; app.set({ intensity: 1 }); app.selectCells([4]);
    app.applyPreset(p.id);
    expect(app.programmer.b.cells[4].color).toEqual({ preset: p.id });
    expect(app.programmer.b.color).toBeUndefined();
  });
  it('Record keeps the cells; played again, the cue shows them', async () => {
    const r = await barShow(), { app } = r;
    app.selected = ['b']; app.set({ intensity: 1, color: BLUE });
    app.selectCells([0, 1]); app.set({ color: RED });
    r.tick(1);
    expect(app.record()).toBe(true);
    const c = app.show.cueLists[0].cues[0];
    expect(c.values.b.cells).toEqual({ 0: { color: RED }, 1: { color: RED } });
    expect(c.values.b.color).toEqual(BLUE);
    app.engine.stop(app.show.cueLists[0].id); r.tick(1);
    app.engine.jumpTo(app.show.cueLists[0].id, 0, 0);   // (no fade: a recorded cue has 2 s)
    const f = out(r);
    expect(cell(f, 0)).toEqual([255, 0, 0]);
    expect(cell(f, 3)).toEqual([0, 0, 255]);
  });
  it('Highlight on picked cells: just them full white, the rest of the light dark, not recorded', async () => {
    const r = await barShow(), { app } = r;
    app.selected = ['b']; app.set({ intensity: 1, color: BLUE });
    app.selectCells([6]); app.highlight = true;
    const f = out(r);
    expect(cell(f, 6)).toEqual([255, 255, 255]);
    expect(cell(f, 5)).toEqual([0, 0, 0]);
    app.highlight = false;
    expect(cell(out(r), 5)).toEqual([0, 0, 255]);
    expect(app.programmer.b.cells).toBeUndefined();
  });
});

describe('cells in the app (review cycle 1)', () => {
  it('Update keeps the cue\'s cells and adds the new one', async () => {
    const r = await barShow(), { app } = r;
    app.selected = ['b']; app.set({ intensity: 1, color: BLUE });
    app.selectCells([0]); app.set({ color: RED });
    r.tick(1); app.record();
    const c = app.show.cueLists[0].cues[0];
    app.selected = ['b']; app.selectCells([5]); app.set({ color: { r: 0, g: 1, b: 0 } });
    r.tick(1);
    expect(app.updateCue(c.id)).toBe(true);
    expect(Object.keys(c.values.b.cells).sort()).toEqual(['0', '5']);
  });
  it('a preset used inside cells counts as used, and deleting it leaves the cells their colour', async () => {
    const r = await barShow(), { app } = r;
    const p = app.show.presets.find((x: { kind: string }) => x.kind === 'color');
    app.selected = ['b']; app.set({ intensity: 1 }); app.selectCells([2]); app.applyPreset(p.id);
    r.tick(1); app.record(); app.checkpoint(); r.tick(1);
    expect(app.presetUses.get(p.id)).toBe(1);
    app.removePresets([p.id]);
    expect(app.show.cueLists[0].cues[0].values.b.cells[2].color).toEqual(p.values.color);
  });
  it('a cue lighting only some cells isn\'t called "Off"', async () => {
    const { app } = await barShow();
    expect(app.suggestName({ b: { intensity: 0, cells: { 3: { intensity: 1 } } } })).not.toBe('Off');
    expect(app.suggestName({ b: { intensity: 0 } })).toBe('Off');
  });
  it('picks belong to the selection they were made on: another selection (any way it comes) drops them', async () => {
    const { app } = await barShow();
    app.selected = ['b']; app.selectCells([1, 2]);
    expect(app.cellsPicked('b')).toEqual([1, 2]);
    app.selected = ['b', 'b2'];                           // (the stage's lasso, Ctrl+A, the list's arrows)
    expect(app.cellsPicked('b')).toEqual([]);
    app.selected = ['b'];
    expect(app.cellsPicked('b')).toEqual([]);             // (not back from before)
  });
  it('picks go to lights of the same shape only; the others are left alone while cells are picked', async () => {
    const r = await barShow(), { app } = r;
    app.show.fixtures.push({ id: 'r', name: 'Ring', typeId: 'gen-ring12', mode: '', universe: 1, address: 1, x: 0.5, y: 0.6 });
    app.checkpoint();
    app.selected = ['b', 'b2', 'r', 'd']; app.set({ intensity: 1, color: BLUE });
    app.selectCells([0]);
    expect(Object.keys(app.cellSel).sort()).toEqual(['b', 'b2']);
    app.set({ color: RED });
    expect(app.programmer.r.color).toEqual(BLUE);         // the ring: untouched by the cell colour
    expect(app.programmer.r.cells).toBeUndefined();
    expect(app.programmer.d.color).toEqual(BLUE);
  });
  it('a colour preset made with cells picked takes the first picked cell\'s colour', async () => {
    const r = await barShow(), { app } = r;
    app.selected = ['b']; app.set({ intensity: 1, color: BLUE }); app.selectCells([3]); app.set({ color: RED });
    r.tick(1);
    const p = app.presetFromSelection('color', 'Cell red');
    expect(p.values.color).toEqual(RED);
  });
  it('a type with the same cells keeps the cues\' cells when a light changes to it', async () => {
    const r = await barShow(), { app } = r;
    app.show.cueLists.push({ id: 'L', name: 'L', end: 'stop', cues: [{ id: 'c', name: 'c', fade: 0, advance: { mode: 'manual' }, values: { b: { intensity: 1, cells: { 1: { color: RED } } } } }] });
    app.checkpoint();
    const own = { ...JSON.parse(JSON.stringify(app.types.get('gen-bar8'))), id: 'user:bar8', source: 'user' };
    app.addType(own);
    app.changeType('b', 'user:bar8');
    expect(app.show.cueLists.at(-1).cues[0].values.b.cells).toEqual({ 1: { color: RED } });
  });
  it('a programmer cell holds just that cell: an effect still lights the light\'s other cells', async () => {
    const r = await barShow(), { app } = r;
    app.selected = ['b']; app.selectCells([0]); app.set({ intensity: 0.3, color: RED });
    app.selectCells(null);                                // (the whole light again: the effect runs on all of it)
    const e = app.addEffect('rainbow', { fixtures: ['b'] });
    r.tick(3);
    const f = app.engine.tick().frames.get(0)!;
    expect(cell(f, 0)).toEqual([77, 0, 0]);               // held at 30 % red
    expect(cell(f, 5).some((v) => v > 0)).toBe(true);     // the others light up with the rainbow
    app.toggleEffect(e.id);
  });
});

describe('Record right after a change (before the next frame)', () => {
  it('a colour for the whole light set just now takes the cells the look still shows with it', async () => {
    const r = await barShow(), { app } = r;
    app.selected = ['b']; app.set({ intensity: 1, color: BLUE }); app.selectCells([0, 1]); app.set({ color: RED });
    r.tick(1); app.record(); r.tick(2);
    app.selectCells(null); app.set({ color: { r: 0, g: 1, b: 0 } });   // (Whole, then green for the whole light)
    app.record();                                         // (no frame in between: the look still has the red cells)
    expect(app.show.cueLists[0].cues.at(-1).values.b.cells).toBeUndefined();
  });
});

describe('gobos, effects and colour programs by name', () => {
  it('each light gets the slot of that name, wherever it sits on its wheel; one without that name the same place', async () => {
    const r = await freshApp(), { app } = r;
    const spot = (id: string, names: string[]) => ({ id, manufacturer: 'X', model: id, source: 'user', modes: [{ name: 'm', channels: [
      { name: 'Dim', attr: 'intensity' },
      { name: 'Gobo 2', attr: 'gobo2', ranges: names.map((n, i) => ({ from: i * 20, to: i * 20 + 19, label: n, kind: 'slot' })) },
      { name: 'Program', attr: 'effectMacro', ranges: [{ from: 0, to: 9, label: 'Off' }, { from: 10, to: 99, label: 'Auto show' }, { from: 100, to: 255, label: 'Sound' }] },
    ] }] });
    app.addType(spot('t-a', ['Open', 'Star', 'Dots'])); app.addType(spot('t-b', ['Open', 'Dots', 'Ring', 'Star']));
    app.show.fixtures.push({ id: 'a', name: 'A', typeId: 't-a', mode: 'm', universe: 0, address: 1, x: 0.3, y: 0.3 }, { id: 'b', name: 'B', typeId: 't-b', mode: 'm', universe: 0, address: 11, x: 0.6, y: 0.3 });
    app.checkpoint();
    app.selected = ['a', 'b']; app.set({ intensity: 1 });
    app.setSlot('gobo2', 'Star', 1);
    app.setSlot('effectMacro', 'Auto show', 1);
    r.tick(2);
    const f = app.engine.tick().frames.get(0)!;
    expect([f[1], f[11]]).toEqual([Math.round((20 + 39) / 2), Math.round((60 + 79) / 2)]);   // "Star": 2nd on A, 4th on B
    expect([f[2], f[12]]).toEqual([55, 55]);                                                  // "Auto show"
  });
});

describe('the console', () => {
  it('commands select, set levels and run the words; encoders turn each light from where it is', async () => {
    const r = await barShow(), { app } = r;
    expect(app.runCommand('1 thru 3 - 2 @ 40')).toEqual({ ok: true, said: '2 lights at 40% (2 taken out)' });
    expect(app.selected).toEqual([app.show.fixtures[0].id, app.show.fixtures[2].id]);
    expect(app.programmer.d.intensity).toBe(0.4);
    expect(app.runCommand('1.2 thru 1.4 @ full').said).toBe('1 light, 3 cells at 100%');
    expect(app.cellsPicked('b')).toEqual([1, 2, 3]);
    expect(app.runCommand('go 9')).toEqual({ ok: false, said: "there's no list 9 (no cue lists yet)" });
    // a fan of two bars' levels, turned up together: each from its own
    app.runCommand('1 thru 2'); app.setLevelOf(['b'], 0.2); app.setLevelOf(['b2'], 0.6);
    app.nudge('intensity', 0.1); app.nudge('intensity', 0.1);   // (twice before a frame: both count)
    expect([app.programmer.b.intensity, app.programmer.b2.intensity].map((v: number) => Math.round(v * 100))).toEqual([40, 80]);
  });
  it('a playback fader starts its list going up, lets it go at 0, and brings it back while it fades out', async () => {
    const r = await barShow(), { app } = r;
    app.show.cueLists.push({ id: 'L', name: 'L', end: 'stop', cues: [{ id: 'c', name: 'c', fade: 0, advance: { mode: 'manual' }, values: { d: { intensity: 1 } } }] });
    app.checkpoint();
    app.playbackFader('L', 0.5);
    expect(app.engine.status('L').running).toBe(true);
    app.playbackFader('L', 0);
    expect(app.engine.status('L').releasing).toBe(true);
    app.playbackFader('L', 1);
    expect(app.engine.status('L').releasing).toBe(false);
  });
});

describe('cells in the app (review cycle 2)', () => {
  it('with cells picked the controls show the light\'s position and beam, a position preset keeps the light\'s', async () => {
    const r = await freshApp(), { app } = r;
    app.show.fixtures.push({ id: 'h', name: 'Head', typeId: 'gen-mover16', mode: '', universe: 0, address: 1, x: 0.5, y: 0.3 }, { id: 'b', name: 'Bar', typeId: 'gen-bar8', mode: '', universe: 0, address: 20, x: 0.3, y: 0.3 });
    app.checkpoint();
    app.selected = ['b']; app.set({ intensity: 1, zoom: 0.7 } as any); app.selectCells([1]); app.set({ color: RED });
    r.tick(2);
    expect(app.lookFor('b')).toMatchObject({ color: RED, zoom: 0.7 });
    const p = app.presetFromSelection('intensity', 'Cell level');
    expect(p.values.intensity).toBe(1);
  });
  it('clicking the light that\'s already the only one selected keeps its picked cells; all cells and one value is the whole light', async () => {
    const r = await barShow(), { app } = r;
    app.select('b', false); app.selectCells([2, 3]);
    app.select('b', false);
    expect(app.cellsPicked('b')).toEqual([2, 3]);
    app.selectCells([0, 1, 2, 3, 4, 5, 6, 7]); app.set({ color: RED });
    expect(app.programmer.b.color).toEqual(RED);
    expect(app.programmer.b.cells).toBeUndefined();
  });
  it('play along copies cells only to a light of the same cell shape', async () => {
    const r = await barShow(), { app } = r;
    app.show.cueLists.push({ id: 'L', name: 'L', end: 'stop', cues: [{ id: 'c', name: 'c', fade: 0, advance: { mode: 'manual' }, values: { b: { intensity: 1, cells: { 1: { color: RED } } } } }] });
    app.show.fixtures.push({ id: 'r', name: 'Ring', typeId: 'gen-ring12', mode: '', universe: 1, address: 1, x: 0.5, y: 0.6 });
    app.checkpoint();
    app.playAlong(['b2', 'r'], 'b');
    const v = app.show.cueLists.at(-1).cues[0].values;
    expect(v.b2.cells).toEqual({ 1: { color: RED } });
    expect(v.r.cells).toBeUndefined();
  });
});

describe('the console (review cycle 3)', () => {
  it('cells by command are per light and checked; cells and whole lights in one command are said, not guessed; a light named after cells drops them', async () => {
    const r = await barShow(), { app } = r;
    expect(app.runCommand('1.3 + 2.5 @ full').said).toBe('2 lights, 2 cells at 100%');
    expect(app.cellSel).toEqual({ b: [2], b2: [4] });
    expect(app.runCommand('1.9').said).toBe('light 1 has only 8 cells (1.1 to 1.8)');
    expect(app.runCommand('3.1').said).toBe('light 3 has no cells');
    expect(app.runCommand('1.3 + 3').ok).toBe(false);
    app.runCommand('1.3');
    app.runCommand('1 @ 0');
    expect(app.cellSel).toEqual({});
    expect(app.programmer.b.intensity).toBe(0);
    expect(app.runCommand('+ 1 thru 3 - 2').said).toBe('2 lights (2 taken out)');
  });
  it('one digit is tens; GO, back and release with no list say so', async () => {
    const { app } = await barShow();
    app.runCommand('3 @ 5');
    expect(app.programmer.d.intensity).toBe(0.5);
    app.runCommand('3 @ 05');
    expect(app.programmer.d.intensity).toBe(0.05);
    for (const w of ['go', 'back', 'release']) expect(app.runCommand(w)).toEqual({ ok: false, said: 'No cue list to play yet: select lights, set them, record' });
  });
  it('a name picked on two lights: the one without it is left alone', async () => {
    const r = await freshApp(), { app } = r;
    const t = (id: string, names: string[]) => ({ id, manufacturer: 'X', model: id, source: 'user', modes: [{ name: 'm', channels: [{ name: 'P', attr: 'effectMacro', ranges: names.map((n, i) => ({ from: i * 50, to: i * 50 + 49, label: n })) }] }] });
    app.addType(t('A', ['Off', 'Rainbow'])); app.addType(t('B', ['Off', 'Sound']));
    app.show.fixtures.push({ id: 'a', name: 'A', typeId: 'A', mode: 'm', universe: 0, address: 1, x: 0.2, y: 0.2 }, { id: 'b', name: 'B', typeId: 'B', mode: 'm', universe: 0, address: 2, x: 0.4, y: 0.2 });
    app.checkpoint();
    app.selected = ['a', 'b']; app.setSlot('effectMacro', 'Rainbow', 1);
    expect(app.programmer.a.effectMacro).toBe(1);
    expect(app.programmer.b).toBeUndefined();
  });
});

describe('groups of cells', () => {
  it('a group made with cells picked picks them again, and an effect on it runs on just them', async () => {
    const r = await barShow(), { app } = r;
    app.selected = ['b', 'b2']; app.selectCells([0, 1]);
    const gid = app.groupFromSelection('Ends');
    const g = app.show.groups.find((x: { id: string }) => x.id === gid);
    expect(g.cells).toEqual([0, 1]);
    app.selectNone(); app.selectGroup(gid);
    expect(app.cellSel).toEqual({ b: [0, 1], b2: [0, 1] });
    app.selectCells(null); app.set({ intensity: 1, color: BLUE });
    const e = app.addEffect('chase', { group: gid });
    r.tick(5);
    // the rest of the bars stay blue, frame after frame; the chase is on cells 1 and 2 (it dims one
    // of them at a time), so they aren't both full blue
    let moved = false;
    for (let i = 0; i < 40; i++) {
      r.tick(1);
      const f = app.engine.tick().frames.get(0)!;
      for (let k = 2; k < 8; k++) expect(cell(f, k)).toEqual([0, 0, 255]);
      if (cell(f, 0).join() !== '0,0,255' || cell(f, 1).join() !== '0,0,255') moved = true;
    }
    expect(moved).toBe(true);
    app.toggleEffect(e.id);
  });
});

describe('a type whose cells change', () => {
  const six = (n: number) => ({ id: 'user:six', manufacturer: 'X', model: 'Six', source: 'user' as const, modes: [{ name: 'm', channels: [...Array(n).keys()].flatMap((c) => [{ name: `R${c}`, attr: 'red' as const, cell: c }, { name: `G${c}`, attr: 'green' as const, cell: c }, { name: `B${c}`, attr: 'blue' as const, cell: c }]) }] });
  const C = [{ r: 1, g: 0, b: 0 }, { r: 0, g: 1, b: 0 }, { r: 0, g: 0, b: 1 }, { r: 1, g: 1, b: 0 }, { r: 0, g: 1, b: 1 }, { r: 1, g: 0, b: 1 }];
  it('cells taken out of the editor: the looks follow the LEDs, the gone ones go', async () => {
    const r = await freshApp(), { app } = r;
    app.saveType(six(6));
    app.show.fixtures.push({ id: 'x', name: 'Six', typeId: 'user:six', mode: 'm', universe: 0, address: 1, x: 0.5, y: 0.3 });
    app.checkpoint();
    const l = app.newList('L');
    l.cues.push({ id: 'c1', name: 'c', fade: 0, advance: { mode: 'manual' }, values: { x: { intensity: 1, cells: Object.fromEntries(C.map((c, k) => [k, { color: c }])) } } });
    app.show.groups.push({ id: 'g', name: 'Ends', fixtures: ['x'], cells: [0, 5] });
    app.selected = ['x']; app.selectCells([4]);
    app.saveType(six(4), { m: { 1: null, 2: null, 3: 1, 4: 2, 5: 3 } });
    expect(Object.entries(l.cues[0].values.x.cells!).map(([k, v]: [string, any]) => [k, v.color])).toEqual([['0', C[0]], ['1', C[3]], ['2', C[4]], ['3', C[5]]]);
    expect(app.show.groups[0].cells).toEqual([0, 3]);
    expect(app.cellSel).toEqual({});
  });
  it('fewer cells without a map: the ones past the end go; a programmer cell past it is never recorded', async () => {
    const r = await freshApp(), { app } = r;
    app.saveType(six(6));
    app.show.fixtures.push({ id: 'x', name: 'Six', typeId: 'user:six', mode: 'm', universe: 0, address: 1, x: 0.5, y: 0.3 });
    app.checkpoint();
    const l = app.newList('L');
    l.cues.push({ id: 'c1', name: 'c', fade: 0, advance: { mode: 'manual' }, values: { x: { cells: { 1: { color: C[1] }, 5: { color: C[5] } } } } });
    app.saveType(six(3));
    expect(Object.keys(l.cues[0].values.x.cells!)).toEqual(['1']);
    app.programmer = { x: { intensity: 1, cells: { 2: { color: C[2] }, 4: { color: C[4] } } } };
    r.tick(1);
    app.record(l.id);
    expect(Object.keys(l.cues[1].values.x.cells ?? {})).toEqual(['2']);
  });
});

describe('a group of cells flashes', () => {
  it('just its cells (the console\'s group flash and a live group button go through this)', async () => {
    const r = await freshApp(), { app } = r;
    app.show.fixtures.push({ id: 'b', name: 'Bar', typeId: 'gen-bar8', mode: '', universe: 0, address: 1, x: 0.3, y: 0.3 });
    app.show.groups.push({ id: 'g', name: 'Ends', fixtures: ['b'], cells: [0, 7] });
    app.checkpoint();
    app.flashLights('g', ['b'], true, app.show.groups[0]);
    r.tick(2);
    const f = app.engine.tick().frames.get(0)!;
    expect(cell(f, 0).some((x) => x > 0)).toBe(true);
    expect(cell(f, 7).some((x) => x > 0)).toBe(true);
    expect(cell(f, 3)).toEqual([0, 0, 0]);
    app.flashLights('g', ['b'], false);
  });
});
