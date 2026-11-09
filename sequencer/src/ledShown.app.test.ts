// @vitest-environment happy-dom
// The stage draws a pixel light as its LEDs really light: DMX 20 goes out either way, but at a box
// port's brightness 150 the LEDs stay dark, so the picture does too. The port's numbers come from the
// box's bridge or from LuxDMX Link (which reads every box it finds); set by hand, they win.
import { describe, expect, it } from 'vitest';
import { freshApp } from './app.harness';
import type { PortInfo } from './model/ledCurve';

const PORT: PortInfo = { uni: 10, start: 1, count: 241, bright: 150, gamma: 220, maxMa: 0, mAPerCh: 2000, quiesMa: 100 };

describe('pixel lights on the stage, as their LEDs light', () => {
  it('DMX 20: lit at a port as it comes, dark at the box\'s brightness 150, lit again when set by hand', async () => {
    const { app, sent, tick } = await freshApp();
    app.show.fixtures.push({ id: 'd', name: 'Disc', typeId: 'gen-disc241', mode: '', universe: 10, address: 1, x: 0.5, y: 0.5 });
    app.markDirty(0);
    app.programmer.d = { intensity: 1, color: { r: 20 / 255, g: 20 / 255, b: 20 / 255 } };
    tick(2);
    expect(sent.filter((s) => s.uni === 10).at(-1)?.data.slice(0, 3)).toEqual([20, 20, 20]);     // (the DMX is the same throughout)
    expect(app.ledOf('d')).toMatchObject({ from: 'usual' });
    expect(app.drawnNow.d.cells[0].intensity).toBeGreaterThan(0);
    // the box's bridge says its port
    app.bridges[0].ports = [PORT];
    tick(1);
    expect(app.ledOf('d')).toMatchObject({ from: 'box', port: { bright: 150 } });
    expect(app.drawnNow.d.cells[0].intensity).toBe(0);
    expect(app.drawnNow.d.cells.every((c: any) => c.intensity === 0)).toBe(true);
    // a brighter colour lights
    app.programmer.d = { intensity: 1, color: { r: 60 / 255, g: 0, b: 0 } };
    tick(1);
    expect(app.drawnNow.d.cells[5].intensity).toBeGreaterThan(0);
    expect(app.drawnNow.d.cells[5].color.g).toBe(0);
    // set by hand: it wins over the box
    app.show.fixtures[0].led = { bright: 255 };
    app.programmer.d = { intensity: 1, color: { r: 20 / 255, g: 20 / 255, b: 20 / 255 } };
    tick(1);
    expect(app.ledOf('d')).toMatchObject({ from: 'own' });
    expect(app.drawnNow.d.cells[0].intensity).toBeGreaterThan(0);
    // what the stage keeps for everything else is untouched
    expect(app.stageNow.d.cells?.[0]?.intensity ?? app.stageNow.d.intensity).toBeGreaterThan(0);
  });

  it('through LuxDMX Link: the port of the box Link found', async () => {
    const { app, tick } = await freshApp();
    const { LinkOutput, LINK } = await import('./output/link');
    // (no real Link: one that runs on this computer must never get frames from a test)
    const link = Object.assign(Object.create(LinkOutput.prototype), { state: 'ready', host: LINK, name: 'This computer', ports: [],
      nodes: [{ ip: '10.0.0.5', short: 'Carrier', long: '', universes: [0], pixelPorts: [PORT] }], send() {}, watch() {}, wants: () => true, serves: () => false });
    app.bridges = [link];
    app.show.fixtures.push({ id: 'd', name: 'Disc', typeId: 'gen-disc241', mode: '', universe: 10, address: 1, x: 0.5, y: 0.5 });
    app.markDirty(0);
    app.programmer.d = { intensity: 1, color: { r: 20 / 255, g: 20 / 255, b: 20 / 255 } };
    tick(2);
    expect(app.ledOf('d')).toMatchObject({ from: 'box', port: { box: 'Carrier', bright: 150 } });
    expect(app.drawnNow.d.cells[0].intensity).toBe(0);
  });
});

describe('a port\'s lights together (the review)', () => {
  it('two lights on one port share its power cap, and the second one, not at the start channel, gets the port\'s curve too', async () => {
    const { app, tick } = await freshApp();
    // a port at universe 10 from channel 1, 300 pixels, brightness 255, a 1 A cap
    app.bridges[0].ports = [{ uni: 10, start: 1, count: 300, bright: 255, gamma: 220, maxMa: 1000, mAPerCh: 2000, quiesMa: 100 }];
    app.show.fixtures.push({ id: 'a', name: 'A', typeId: 'gen-strip60', mode: '', universe: 10, address: 1, x: 0.3, y: 0.5 },
      { id: 'b', name: 'B', typeId: 'gen-strip60', mode: '', universe: 10, address: 181, x: 0.7, y: 0.5 });
    app.markDirty(0);
    expect(app.ledOf('b')).toMatchObject({ from: 'box', port: { start: 1 } });
    // one strip full white: 60 x 3 x 20 mA = 3.6 A + 0.3 A idle, over the 1 A cap
    app.programmer.a = { intensity: 1, color: { r: 1, g: 1, b: 1 } };
    tick(2);
    const one = app.drawnNow.a.cells[0].intensity;
    expect(one).toBeLessThan(0.8);
    // both: the cap is shared, each gets dimmer still
    app.programmer.b = { intensity: 1, color: { r: 1, g: 1, b: 1 } };
    tick(2);
    expect(app.drawnNow.a.cells[0].intensity).toBeLessThan(one - 0.05);
    expect(app.drawnNow.b.cells[0].intensity).toBeCloseTo(app.drawnNow.a.cells[0].intensity, 6);
  });
});
