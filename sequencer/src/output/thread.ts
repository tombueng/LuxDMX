// The output thread: works out every DMX frame and sends it, 40 a second on its own clock, whatever
// the page is doing (drawing the stage, a dialog, a slow moment). The page keeps an engine of its own
// for the screen and tells this one everything that changes it (output/host.ts): the show, what's
// set by hand, every command (GO, a jump, an effect, Arm) with the moment it was given. Both engines
// work out the same frames; this one's go out.
//
// Where they go: to a LuxDMX box through a channel to its bridge page (a port), and to LuxDMX Link on
// this computer through a socket of its own. (A box whose page takes no channel, older firmware, gets
// its frames from the page as before.)
import { Engine } from '../engine/engine';
import { modeOf as modeIn, typeMap } from '../model/library';
import { atmosAndMachines, zeroedFrames } from './safe';
import type { Fixture, FixtureMode, Show, Values } from '../model/types';

export type ToThread =
  | { t: 'init'; origin: number; page?: string }
  | { t: 'show'; json: string }          // (as text: parsed here, not on the page)
  | { t: 'inputs'; v: Partial<Inputs> }
  | { t: 'call'; m: string; a: unknown[]; at: number }
  | { t: 'jumped'; op: 'add' | 'delete' | 'clear'; id?: string }
  | { t: 'policy'; quiet: boolean; blind: [number, Uint8Array][] | null }
  | { t: 'port'; key: string; port: MessagePort; outputs: { en: boolean; uni: number }[] }
  | { t: 'outputs'; key: string; outputs: { en: boolean; uni: number }[] }
  | { t: 'drop'; key: string }
  | { t: 'link'; on: boolean; url: string; proto: 'artnet' | 'sacn' | 'both' }
  | { t: 'final' };
export type FromThread =
  | { t: 'held'; held: Record<string, number> }
  | { t: 'stats'; rate: number; worst: number; late: number; ms: number; sent: number; to: number; quiet: boolean; unis: number }
  | { t: 'broken'; why: string };
export interface Inputs { programmer: Record<string, Values>; live: Record<string, Values>; grandMaster: number; blackout: boolean; bpm: number; sound: number; overlay: Engine['overlay']; armed: boolean; groupMasters: Record<string, number>; heldSeed: Record<string, number> }

const PERIOD = 25, HEARTBEAT_MS = 250, LATE = 10;
const post = (m: FromThread, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let show: Show | null = null;
let mainOrigin = performance.timeOrigin;
let at: number | null = null;                         // a command's own moment, while it's applied
// the page's clock (seconds), so a fade started there starts at the same moment here
const now = () => at ?? (performance.now() + performance.timeOrigin - mainOrigin) / 1000;
const engine = new Engine(() => show ?? EMPTY, now);
engine.cacheTracks = true;        // (the show here is a fresh copy after every edit)
const EMPTY = { fixtures: [], cueLists: [], effects: [], groups: [], presets: [], fixtureTypes: [], pages: [] } as unknown as Show;
let modes = new Map<string, FixtureMode | undefined>();
let quiet = true, blind: Map<number, Uint8Array> | null = null, stopped = false, failing = false;
let last: Map<number, Uint8Array> | null = null;
const recent = new Map<number, number>();

// ---- where frames go
interface Port { port: MessagePort; outputs: { en: boolean; uni: number }[]; sent: Map<number, { data: Uint8Array; at: number }> }
const ports = new Map<string, Port>();
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
// only what changed, plus a heartbeat (as the page's bridge does: output/bridge.ts)
function due(sent: Map<number, { data: Uint8Array; at: number }>, uni: number, data: Uint8Array, t: number, beat = HEARTBEAT_MS) {
  const l = sent.get(uni);
  if (l && t - l.at < beat && sameBytes(l.data, data)) return false;
  sent.set(uni, { data: data.slice(), at: t });
  return true;
}
// LuxDMX Link: a socket of its own (Link takes frames from any of its pages; the page's socket shows
// the nodes and the state)
let pageId = '';                  // the page's, for Link (output/link.ts PAGE_ID)
const link = { on: false, url: '', proto: 'artnet' as 'artnet' | 'sacn' | 'both', ws: null as WebSocket | null, ready: false, unis: new Set<number>(), sentProto: '', sent: new Map<number, { data: Uint8Array; at: number }>(), retry: 0 };
function linkOpen() {
  if (!link.on || (link.ws && link.ws.readyState <= 1)) return;
  let ws: WebSocket;
  try { ws = new WebSocket(link.url); } catch { link.retry = setTimeout(linkOpen, 2500) as unknown as number; return; }
  ws.binaryType = 'arraybuffer';
  link.ws = ws; link.ready = false;
  // (the page's id too: Link counts this connection and the page's own as one page)
  ws.onmessage = (e) => { if (typeof e.data === 'string' && e.data.includes('"hello"')) { link.ready = true; link.sent.clear(); if (pageId) ws.send(JSON.stringify({ type: 'page', id: pageId })); linkRoutes(); } };
  ws.onclose = () => { if (link.ws === ws) { link.ws = null; link.ready = false; if (link.on) link.retry = setTimeout(linkOpen, 2500) as unknown as number; } };
}
function linkRoutes() {
  if (!link.ready || link.ws?.readyState !== 1) return;
  link.sentProto = link.proto;
  link.ws.send(JSON.stringify({ type: 'routes', routes: [...link.unis].map((uni) => ({ uni, proto: link.proto, to: 'auto' })) }));
}
function linkSend(uni: number, data: Uint8Array, t: number) {
  if (!link.ready || link.ws?.readyState !== 1) return;
  if (link.proto !== link.sentProto) linkRoutes();
  if (!link.unis.has(uni)) { link.unis.add(uni); linkRoutes(); }
  if (!due(link.sent, uni, data, t)) return;
  const f = new Uint8Array(6 + data.length);
  f.set([68, 1, uni & 0xff, (uni >> 8) & 0x7f, 100, 0]);
  f.set(data, 6);
  link.ws.send(f); sentN++;
}

function send(frames: Map<number, Uint8Array>, t: number) {
  for (const p of ports.values()) for (const [uni, data] of frames) {
    if (p.outputs.length && !p.outputs.some((o) => o.en && o.uni === uni)) continue;
    if (due(p.sent, uni, data, t)) { p.port.postMessage({ luxdmx: 1, type: 'dmx', uni, prio: 100, data }); sentN++; }
  }
  if (link.on) for (const [uni, data] of frames) linkSend(uni, data, t);
}

// The winches' held heights, for the page to keep over a reload and to freeze for Blind: what
// went on the wire. Said on the frame they change (they only change while armed).
let heldSaid = '', wasArmed = false;
function tellHeld() {
  const now = engine.armed;
  if (!now && !wasArmed && heldSaid) return;
  wasArmed = now;
  const h = engine.heldOwn(), s = JSON.stringify(h);
  if (s === heldSaid) return;
  heldSaid = s;
  post({ t: 'held', held: h });
}

// ---- the clock
const ticks: number[] = [];
let work = 0, statAt = 0, sentN = 0;
function frame() {
  if (stopped || !show) return;
  const t0 = performance.now();
  let frames: Map<number, Uint8Array> | null;
  try { frames = engine.tick().frames; failing = false; tellHeld(); } catch (e) {
    // a frame that throws: the look that went out, fog and the machines off; said once
    if (!failing) { failing = true; post({ t: 'broken', why: (e as Error)?.message ?? String(e) }); }
    frames = last && zeroedFrames(last, show.fixtures, (f) => modes.get(f.id), atmosAndMachines);
  }
  if (frames) {
    // a universe nothing drives any more gets zeros for a couple of seconds (as the page does)
    for (const u of frames.keys()) recent.set(u, t0);
    for (const [u, w] of recent) { if (frames.has(u)) continue; if (t0 - w > 2000) recent.delete(u); else frames.set(u, new Uint8Array(512)); }
    if (!failing) last = frames;
    const out = blind ?? frames;
    if (!quiet) send(out, t0);
  }
  ticks.push(t0); while (ticks.length && t0 - ticks[0] > 5000) ticks.shift();
  work += performance.now() - t0;
  if (t0 - statAt > 500) {
    let worst = 0, late = 0;
    for (let i = 1; i < ticks.length; i++) { const g = ticks[i] - ticks[i - 1]; worst = Math.max(worst, g); if (g > PERIOD + LATE) late++; }
    const span = ticks.length > 1 ? ticks[ticks.length - 1] - ticks[0] : 0;
    const dt = Math.max(1, t0 - statAt);
    post({ t: 'stats', rate: span > 500 ? Math.round(((ticks.length - 1) / span) * 1000) : 0, worst: Math.round(worst), late, ms: Math.round((work / dt) * 1000) / 10, sent: Math.round((sentN / dt) * 1000),
      to: ports.size + (link.ready ? 1 : 0), quiet, unis: last?.size ?? 0 });
    work = 0; statAt = t0; sentN = 0;
  }
}
// due every 25 ms from the start, not 25 ms after the last one (a late frame doesn't push the rest)
let next = performance.now();
function loop() {
  frame();
  next += PERIOD;
  const t = performance.now();
  if (next < t - PERIOD) next = t;                  // (asleep for a while: start again from now)
  setTimeout(loop, Math.max(0, next - t));
}

// ---- what the page says
const COMMANDS = new Set(['go', 'back', 'jumpTo', 'start', 'refresh', 'toggle', 'release', 'stop', 'releaseAll', 'flash', 'alignBeat', 'syncBeats', 'releaseFlashes',
  'setMaster', 'wake', 'faderReleased', 'jumpQuiet', 'actQuiet', 'backdate', 'forget', 'startEffect', 'stopEffect', 'toggleEffect', 'flashEffect', 'takeLiveEffects', 'stopAllEffects', 'act']);
self.onmessage = (e: MessageEvent<ToThread>) => {
  const m = e.data;
  switch (m.t) {
    case 'init': mainOrigin = m.origin; pageId = m.page ?? ''; loop(); break;
    case 'show': {
      const s: Show = JSON.parse(m.json);
      show = s;
      const types = typeMap(s);
      modes = new Map(s.fixtures.map((f: Fixture) => [f.id, modeIn(types.get(f.typeId), f.mode)]));
      break;
    }
    case 'inputs': Object.assign(engine, m.v); break;
    case 'call':
      if (!COMMANDS.has(m.m)) break;
      at = m.at;
      try { (engine as unknown as Record<string, (...a: unknown[]) => unknown>)[m.m](...m.a); } catch { /* the page's engine said what happened */ } finally { at = null; }
      break;
    case 'jumped': if (m.op === 'add' && m.id) engine.jumped.add(m.id); else if (m.op === 'delete' && m.id) engine.jumped.delete(m.id); else if (m.op === 'clear') engine.jumped.clear(); break;
    case 'policy': quiet = m.quiet; blind = m.blind ? new Map(m.blind) : null; break;
    case 'port': ports.set(m.key, { port: m.port, outputs: m.outputs, sent: new Map() }); break;
    case 'outputs': { const p = ports.get(m.key); if (p) p.outputs = m.outputs; break; }
    case 'drop': { const p = ports.get(m.key); p?.port.close(); ports.delete(m.key); break; }
    case 'link':
      link.on = m.on; link.url = m.url; link.proto = m.proto;
      if (m.on) linkOpen(); else { clearTimeout(link.retry); link.ws?.close(); link.ws = null; link.ready = false; }
      break;
    case 'final':
      // the page is going: nothing more from here (the page sends the safe look itself)
      stopped = true;
      break;
  }
};
