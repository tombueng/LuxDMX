// What goes on the wire, the same from the page (bridge.ts, link.ts) and from the output thread
// (thread.ts): only what changed plus a heartbeat, the box's message, Link's frame and routes.

// A box drops a source after 4 s of silence: a static look goes 4 times a second instead of 40, and
// a box that stalls a moment on WiFi doesn't build up seconds of stale frames in its TCP buffer.
export const HEARTBEAT_MS = 250;
export type Sent = Map<number, { data: Uint8Array; at: number }>;

export function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
// whether this universe's frame goes now (it changed, or the heartbeat's due); noted as sent if so
export function due(sent: Sent, uni: number, data: Uint8Array, t: number) {
  const l = sent.get(uni);
  if (l && t - l.at < HEARTBEAT_MS && sameBytes(l.data, data)) return false;
  sent.set(uni, { data: data.slice(), at: t });
  return true;
}

// to a box's /bridge page
export const dmxMessage = (uni: number, data: Uint8Array) => ({ luxdmx: 1, type: 'dmx', uni, prio: 100, data });

// to LuxDMX Link: 'D', version 1, the universe (15 bits, low byte first), priority, a spare byte,
// then the channels
export function linkFrame(uni: number, data: Uint8Array) {
  const f = new Uint8Array(6 + data.length);
  f.set([68, 1, uni & 0xff, (uni >> 8) & 0x7f, 100, 0]);
  f.set(data, 6);
  return f;
}
// what Link sends each universe as (it picks the nodes for Art-Net, the multicast group for sACN)
export type LinkProto = 'artnet' | 'sacn' | 'both';
export const linkRoutes = (unis: Iterable<number>, proto: LinkProto) => JSON.stringify({ type: 'routes', routes: [...unis].map((uni) => ({ uni, proto, to: 'auto' })) });
