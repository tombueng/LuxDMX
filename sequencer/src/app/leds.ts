// What the stage pictures show of pixel lights: each LED as the box's port really lights it (its
// curve, the power cap over the port), and channels set by hand as their bytes do. The app's
// ledOf / ledShown / unservedPixels hand over to these.
import type { app as theApp } from '../app.svelte';
import { LinkOutput } from '../output/link';
import { capsOf } from '../model/library';
import { spansOf } from '../model/pixelLayout';
import { curveOfPort, curveTable, isPixelType, onPort, onScreen, powerScale, WS2812, type LedCurve, type PortInfo } from '../model/ledCurve';
import { rawLook } from '../engine/render';
import type { Fixture, FixtureMode, Resolved } from '../model/types';

type App = typeof theApp;

// What the box playing a light says about its pixel port (the same universe and start channel)
function boxPortOf(app: App, f: Fixture): PortInfo | undefined {
  for (const b of app.bridges) {
    if (b.state !== 'ready' && b.state !== 'reconnecting') continue;
    // (through LuxDMX Link: every box it found says its own; through a box's bridge: that box)
    const lists: [PortInfo[], string][] = b instanceof LinkOutput ? b.nodes.map((n) => [n.pixelPorts ?? [], n.short || n.ip]) : [[b.ports ?? [], b.name || b.host]];
    for (const [ports, box] of lists) {
      const p = ports.find((q) => onPort(q, f));
      if (p) return { ...p, box };
    }
  }
  return undefined;
}
// (once per mode: whether it's a pixel light doesn't change while the mode is the same object)
const pixelModes = new WeakMap<object, boolean>();
// How a pixel light's LEDs really light (model/ledCurve.ts): what it was set to by hand, else what
// the box playing it says about its pixel port, else a port as it comes. Not a pixel light (a DMX
// bar, a PAR): undefined, drawn as its values say.
export function ledOfLight(app: App, f: Fixture): { curve: LedCurve; from: 'own' | 'box' | 'usual'; port?: PortInfo } | undefined {
  const m = app.modeOf(f.id);
  if (!m) return undefined;
  let px = pixelModes.get(m);
  if (px === undefined) { px = isPixelType(app.types.get(f.typeId), m); pixelModes.set(m, px); }
  if (!px) return undefined;
  const port = boxPortOf(app, f), base = port ? curveOfPort(port) : WS2812;
  if (f.led && Object.keys(f.led).length) return { curve: { ...base, ...f.led }, from: 'own', port };
  return { curve: base, from: port ? 'box' : 'usual', port };
}
// The stage with every pixel light's cells as the LEDs show them: its channels as they go out,
// through its port's table, the power cap over everything on that port (as the box adds it up),
// back on the screen's own curve.
export function ledShown(app: App, stage: Record<string, Resolved>, frames: Map<number, Uint8Array>): Record<string, Resolved> {
  type One = { f: Fixture; m: FixtureMode; cells: number; out: Uint8Array; curve: LedCurve };
  const ports = new Map<string, { curve: LedCurve; pixels: number; sum: number; lights: One[] }>();
  for (const f of app.show.fixtures) {
    if (!stage[f.id]) continue;
    const led = ledOfLight(app, f), m = app.modeOf(f.id);
    if (!led || !m) continue;
    const n = m.channels.length, out = new Uint8Array(n), cells = capsOf(m).cells, tab = curveTable(led.curve);
    for (const s of spansOf(f, m)) { const buf = frames.get(s.universe); if (buf) out.set(buf.subarray(s.at, Math.min(512, s.at + s.count)), s.from); }
    let sum = 0;
    for (let i = 0; i < n; i++) { out[i] = tab[out[i]]; sum += out[i]; }
    // (one port, one budget: its lights add up, and all its pixels draw their idle current)
    const key = led.port ? `${led.port.box}|${led.port.uni}|${led.port.start}` : `light ${f.id}`;
    let g = ports.get(key);
    if (!g) { g = { curve: led.curve, pixels: led.port?.count ?? cells, sum: 0, lights: [] }; ports.set(key, g); }
    g.sum += sum;
    g.lights.push({ f, m, cells, out, curve: led.curve });
  }
  let shownAll = stage;
  for (const g of ports.values()) {
    const scale = powerScale(g.curve, g.sum, g.pixels);
    for (const { f, m, cells, out } of g.lights) {
      if (scale < 256) for (let i = 0; i < out.length; i++) out[i] = (out[i] * scale) >> 8;
      const rgbw = new Float32Array(cells * 4);
      m.channels.forEach((c, i) => {
        const k = c.attr === 'red' ? 0 : c.attr === 'green' ? 1 : c.attr === 'blue' ? 2 : c.attr === 'white' ? 3 : -1;
        if (k >= 0 && c.cell !== undefined && c.cell < cells) rgbw[c.cell * 4 + k] = onScreen(out[i]);
      });
      const shown: Resolved[] = [];
      let top = 0;
      for (let c = 0; c < cells; c++) {
        const r = rgbw[c * 4], gg = rgbw[c * 4 + 1], b = rgbw[c * 4 + 2], w = rgbw[c * 4 + 3], d = Math.max(r, gg, b, w);
        top = Math.max(top, d);
        shown.push(d > 0 ? { intensity: d, color: { r: r / d, g: gg / d, b: b / d }, ...(w ? { white: w / d } : {}) } : { intensity: 0, color: { r: 0, g: 0, b: 0 } });
      }
      if (shownAll === stage) shownAll = { ...stage };
      shownAll[f.id] = { ...stage[f.id], intensity: top, cells: shown };
    }
  }
  // channels set by hand ("All channels"): the pictures show what their bytes do (render.ts rawLook)
  for (const f of app.show.fixtures) {
    const v = shownAll[f.id];
    if (!v?.raw) continue;
    const m = app.modeOf(f.id);
    if (!m) continue;
    const bytes = new Uint8Array(m.channels.length);
    for (const s of spansOf(f, m)) { const buf = frames.get(s.universe); if (buf) bytes.set(buf.subarray(s.at, Math.min(512, s.at + s.count)), s.from); }
    const look = rawLook(f, m, v, bytes);
    if (look === v) continue;
    if (shownAll === stage) shownAll = { ...stage };
    shownAll[f.id] = look;
  }
  return shownAll;
}
// The universes of pixel lights that no connected box plays (said in the banner)
export function unservedPixels(app: App): number[] {
  const up = app.bridges.filter((b) => b.state === 'ready');
  if (!up.length) return [];
  const unis = new Set<number>();
  for (const f of app.show.fixtures) { const m = app.modeOf(f.id); if (capsOf(m).cells > 1) for (const s of spansOf(f, m)) unis.add(s.universe); }
  return [...unis].filter((u) => !up.some((b) => b.wants(u))).sort((a, b) => a - b);
}
