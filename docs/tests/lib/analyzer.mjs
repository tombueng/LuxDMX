// Client for the RP2350 bench analyzer (github.com/tombueng/dmx-analyzer): the second box on the
// DMX line that watches what the gateway actually transmits, and answers RDM as 64 virtual fixtures.
//
// Why this exists: every other spec in this suite asks the gateway how it thinks it is doing.
// /dmx.json outfps counts frames handed to the RMT, ArtPollReply advertises a rate, /rdm.json lists
// what discovery believes it found. All of that is self-reported. The analyzer is an independent
// witness on the wire, which is the only way to check a torn frame, a framing error, a line that
// stopped clocking, or whether a SET really landed inside the responder.
//
// The analyzer has no mDNS, so it is addressed by IP: LUXDMX_ANALYZER_URL (full URL) or
// LUXDMX_ANALYZER (bare host/IP), else the bench default below. Specs skip themselves when it does
// not answer, so a run on a machine without the rig stays green.
import { UdpSender, artDmxPacket, sleep, ART_PORT } from './net.mjs';

const FALLBACK_IP = '192.168.178.105';

export function analyzerBase() {
  if (process.env.LUXDMX_ANALYZER_URL) return process.env.LUXDMX_ANALYZER_URL.replace(/\/$/, '');
  return 'http://' + (process.env.LUXDMX_ANALYZER || FALLBACK_IP);
}

async function anJson(path, init = {}) {
  const res = await fetch(analyzerBase() + path, { signal: AbortSignal.timeout(6000), ...init });
  if (!res.ok) throw new Error(`analyzer ${path} -> HTTP ${res.status}`);
  return res.json();
}
const anPost = (path, body) => anJson(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

// ── reads ───────────────────────────────────────────────────────────────────
export const anStatus   = ()      => anJson('/api/status');    // fw, bus state, fixture count
export const anMetrics  = ()      => anJson('/api/metrics');   // framing/RDM counters, both taps
export const anFixtures = ()      => anJson('/api/fixtures');  // the simulated responders
export const anDmx      = ()      => anJson('/api/dmx');       // last complete frame off the wire
export const anCapture  = (since) => anJson(`/api/capture?since=${since | 0}`);

// ── writes (the analyzer is a test instrument, none of this touches the DUT) ─
export const anReset  = () => anPost('/api/analyzer/reset');   // zero framing counters + windows
export const anUnmute = () => anPost('/api/unmute');           // forget discovery, so the next sweep is real
export const anFuzz   = (o) => anPost('/api/fuzz', o);         // fault injection (drop/late/badcsum/mute)

// Is the analyzer on the bench and answering? Cached: every spec asks in beforeAll.
let reachable;
export async function analyzerUp() {
  if (reachable === undefined) {
    try { reachable = !!(await anStatus()).fw; } catch { reachable = false; }
  }
  return reachable;
}
export const NO_ANALYZER =
  `no RP2350 analyzer at ${analyzerBase()} — set LUXDMX_ANALYZER=<ip> (see docs/rig-wiring-*.md)`;

// The frame's channel values as bytes. The API ships them as one hex string, 2 chars per slot.
export function frameValues(f) {
  const hex = f?.v ?? '';
  const n = Math.min(f?.ch ?? 0, hex.length >> 1);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// Frames per second as counted on the wire, from the dedicated framing state machine (anFrames).
// A line that has stopped clocking reports 0.
//
// Deliberately NOT the /api/dmx sequence number: that one is published from the RDM decode path and
// stands completely still while a discovery sweep is running (measured: 40/s idle, 0/s during a
// sweep, while anFrames carried on at ~35/s). Anything timing DMX during RDM has to use this.
export async function wireHz({ ms = 4000 } = {}) {
  const a = await anMetrics(); const t0 = Date.now();
  await sleep(ms);
  const b = await anMetrics();
  return (b.anFrames - a.anFrames) * 1000 / (Date.now() - t0);
}

// Drain the decoded packet log from `cursor` until `done()` says stop, returning every event seen.
//
// The capture ring is 256 events deep and a 64-fixture sweep produces ~1500 of them, so it laps in
// under two seconds. Reading the log only after the sweep shows you the tail (sensor GETs) and makes
// it look like discovery never happened.
export async function drainCapture(cursor, done, { every = 300, ms = 120_000 } = {}) {
  const events = [];
  const deadline = Date.now() + ms;
  let cur = cursor;
  while (Date.now() < deadline) {
    const c = await anCapture(cur);
    events.push(...c.ev);
    cur = c.seq;
    if (await done()) break;
    await sleep(every);
  }
  return events;
}

// Poll the wire until pred(frame, values) holds. Returns the last frame seen either way, so a
// failed expectation can print what was actually on the line.
export async function waitForWire(pred, { ms = 8000, every = 250 } = {}) {
  const deadline = Date.now() + ms;
  let last = null;
  while (Date.now() < deadline) {
    try { last = await anDmx(); if (pred(last, frameValues(last))) return last; } catch {}
    await sleep(every);
  }
  return last;
}

// Which output is the analyzer physically wired to? Drive each enabled output's universe with a
// marker pattern and see which one shows up on the line. The bench gets re-wired between
// workstreams (it was on output A for the RDM work and on output B for issue #93), so probing beats
// hardcoding an index and then quietly testing an output nobody is listening to.
// Returns the output index, or -1 if nothing we send reaches the wire.
export async function probeWiredOutput(host, snap, { ms = 1500 } = {}) {
  const sender = new UdpSender(host);
  try {
    for (const [i, o] of snap.outputs.entries()) {
      if (!o.en) continue;
      const mark = 0x40 + i * 0x30;                    // distinct per output, and not a value at rest
      const data = Buffer.alloc(512);
      data[0] = mark; data[41] = mark; data[511] = mark;
      const end = Date.now() + ms;
      for (let s = 0; Date.now() < end; s++) {
        await sender.send(ART_PORT, artDmxPacket(o.uni, data, s));
        await sleep(25);
      }
      const hit = await waitForWire((_f, v) => v[0] === mark && v[41] === mark && v[511] === mark,
        { ms: 1500 });
      if (hit && frameValues(hit)[0] === mark) return i;
    }
  } finally { sender.close(); }
  return -1;
}

// Stream one fixed frame at `fps` for `ms` (the analyzer measures what the gateway makes of it).
export async function driveArtnet(host, uni, data, { ms = 4000, fps = 40 } = {}) {
  const sender = new UdpSender(host);
  const period = Math.max(1, Math.round(1000 / fps));
  try {
    const end = Date.now() + ms;
    for (let s = 0; Date.now() < end; s++) {
      await sender.send(ART_PORT, artDmxPacket(uni, data, s));
      await sleep(period);
    }
  } finally { sender.close(); }
}

// RDM command classes / PIDs, for asserting on the decoded capture log.
export const CC = { DISC: 0x10, DISC_RESP: 0x11, GET: 0x20, GET_RESP: 0x21, SET: 0x30, SET_RESP: 0x31 };
export const PID = {
  DISC_UNIQUE_BRANCH: 0x0001, DISC_MUTE: 0x0002, DISC_UN_MUTE: 0x0003,
  DEVICE_INFO: 0x0060, DMX_START_ADDRESS: 0x00f0, IDENTIFY_DEVICE: 0x1000,
};
// capture event kinds
export const EV = { DMX: 0, REQ: 1, RESP: 2 };
