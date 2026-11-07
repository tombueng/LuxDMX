// @vitest-environment happy-dom
// Through the whole app: a show file with the things that used to stop every frame (a tempo of
// "fast", nulls in its lists, a palette of nulls, an endless spread, the universe as "0") is
// imported, its effect runs, and the frames go out.
import { describe, expect, it } from 'vitest';
import { freshApp } from '../app.harness';

const show = JSON.stringify({
  format: 'luxdmx-show', formatVersion: '1.1.0', minReaderVersion: '1.0.0', requiredFeatures: [],
  settings: { bpm: 'fast' },
  fixtures: [
    { id: 'a', name: 'A', typeId: 'gen-dimmer', mode: '', universe: '0', address: 1, x: 0.1, y: 0.5 },
    { id: 'b', name: 'B', typeId: 'gen-rgb', mode: '', universe: 0, address: 2, x: 0.9, y: 0.5 },
    null,
  ],
  presets: [null], groups: [null], cueLists: [null, { id: 'L', name: 'L', end: 'stop', cues: [null, { id: 'c', name: 'Up', values: { a: { intensity: 'full' }, b: null }, fade: -1 }] }],
  effects: [null, { id: 'e1', name: 'Rainbow', kind: 'rainbow', fixtures: ['b'], params: { spread: 7, colors: [null] } }],
  pages: [{ id: 'p', name: 'P', widgets: [null, { id: 'f', type: 'fog', fixtures: ['a'], level: 1 }] }],
}).replace('"spread":7', '"spread":1e999');

describe('importing a show file that used to stop every frame', () => {
  it('loads, plays its effect, and the frames go out', async () => {
    const { app, sent, tick } = await freshApp();
    await app.importShow(new File([show], 'party.luxdmx.json'));
    expect(app.show.settings.bpm).toBe(120);
    expect(app.show.fixtures.map((f: { universe: number }) => f.universe)).toEqual([0, 0]);
    expect(app.show.pages[0].widgets[0].max).toBe(10);
    // (a new show connects to its own boxes: the test box again)
    app.bridges = [{ state: 'ready', host: 'box', send: (uni: number, data: Uint8Array) => sent.push({ uni, data: [...data.slice(0, 16)] }), relay() {}, close() {}, open() {}, lostAt: 0, outputs: [], pixels: [] }];
    app.engine.startEffect('e1');
    const before = sent.length;
    let threw = 0;
    for (let i = 0; i < 12; i++) { try { tick(); } catch { threw++; } await new Promise((r) => setTimeout(r, 30)); }
    expect(threw).toBe(0);
    expect(sent.length).toBeGreaterThan(before);
    expect(new Set(sent.slice(before).map((s) => s.uni))).toEqual(new Set([0]));   // one universe, not "0" as well
    // the rainbow on B (channels 2 to 4) is colour, changing over time
    const colours = new Set(sent.slice(before).map((s) => s.data.slice(1, 4).join(',')));
    expect(colours.size).toBeGreaterThan(1);
    expect(app.engine.broken?.size ?? 0).toBe(0);
  });
});
