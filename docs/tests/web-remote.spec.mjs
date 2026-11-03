// A phone as a remote for the LuxDMX Sequencer: the box serves the phone's page (/remote) and
// passes relay messages between the phone and the laptop running the show. The box never reads
// them: a /ws text message that starts with {"relay": goes, as it came, by role: what the laptop
// sends ({"type":"relay","host":1}) to the phones ({"type":"relay"}), what a phone sends to the
// laptop; never back, never to other pages. At most 4 KB (put back together when it arrives in TCP
// pieces), valid UTF-8 only, 50 a second per client. Each relay (and each DMX frame) is answered
// with one byte, 'K', and the sequencer's pages send their next message only then (one at a time,
// so no frame header lands split across two TCP packets; the library before 8e17be5 misread that,
// see ws-torn-header.spec.mjs). So the tests here send like the pages do. And a
// fifth client never pushes out the one that streams DMX. Everything else about the remote (codes, held
// buttons letting go) lives in the sequencer and is tested there (sequencer/e2e/remote.spec.ts,
// and its hw.spec.ts on a box).
//
// Read-only: nothing here touches the config or the outputs.
import { test, expect } from '@playwright/test';
import net from 'node:net';
import crypto from 'node:crypto';
import { deviceHost } from './lib/net.mjs';

let host;
test.beforeAll(async () => { host = await deviceHost(); });

async function socket(role = 'phone') {
  const ws = new WebSocket(`ws://${host}/ws`);
  ws.binaryType = 'arraybuffer';
  const texts = [];
  let closed = false, acks = 0, onAck = null;
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') texts.push(e.data);
    else if (e.data.byteLength === 1 && new Uint8Array(e.data)[0] === 0x4b) { acks++; if (onAck) onAck(); }
  };
  ws.onclose = () => { closed = true; };
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
  if (role === 'phone') ws.send('{"type":"relay"}');
  else if (role === 'host') ws.send('{"type":"relay","host":1}');
  await new Promise((r) => setTimeout(r, 150));
  // as the pages send: one message, then wait for the box's answer
  const send = (m) => new Promise((ok, bad) => {
    const t = setTimeout(() => { onAck = null; bad(new Error('no answer from the box in 2 s')); }, 2000);
    onAck = () => { clearTimeout(t); onAck = null; ok(); };
    ws.send(m);
  });
  return { ws, texts, closed: () => closed, acks: () => acks, send };
}
const relayed = (texts, tag) => texts.filter((t) => t.includes(tag));
// A text frame with any bytes in it (a browser can only send valid UTF-8): a raw WebSocket client.
async function rawTextFrame(bytes) {
  const sock = net.connect(80, host);
  await new Promise((ok, bad) => { sock.once('connect', ok); sock.once('error', bad); });
  sock.write(`GET /ws HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
    `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  await new Promise((ok) => sock.once('data', ok));                   // 101 Switching Protocols
  const mask = crypto.randomBytes(4), n = bytes.length;
  const head = n < 126 ? Buffer.from([0x81, 0x80 | n]) : Buffer.from([0x81, 0x80 | 126, n >> 8, n & 0xff]);
  const body = Buffer.from(bytes.map((x, i) => x ^ mask[i % 4]));
  sock.write(Buffer.concat([head, mask, body]));
  await new Promise((r) => setTimeout(r, 200));
  sock.destroy();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('/remote is the phone page, gzipped and small', async ({ request }) => {
  const r = await request.get('/remote');
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toContain('text/html');
  expect(r.headers()['cache-control']).toContain('no-cache');
  const html = await r.text();
  expect(html).toContain('LuxDMX remote');
  expect(html).toContain('"relay"');
  expect(Number(r.headers()['content-length'] ?? 0)).toBeLessThan(16000);   // the gzipped size on the wire
});

test('a phone\'s relay reaches the laptop, the laptop\'s the phones; unchanged, never back, never elsewhere', async () => {
  const laptop = await socket('host'), a = await socket(), b = await socket(), page = await socket('none');
  const tag = `t${Date.now()}`;
  const msg = JSON.stringify({ relay: { k: 'hello', code: '1234', rid: tag, label: 'Grüße ✨' } });
  a.ws.send(msg);
  await expect.poll(() => relayed(laptop.texts, tag).length, { timeout: 3000 }).toBe(1);
  expect(relayed(laptop.texts, tag)[0]).toBe(msg);
  const back = JSON.stringify({ relay: { k: 'state', code: '1234', host: 1, tag: `${tag}-back` } });
  laptop.ws.send(back);
  await expect.poll(() => relayed(b.texts, `${tag}-back`).length, { timeout: 3000 }).toBe(1);
  await expect.poll(() => relayed(a.texts, `${tag}-back`).length, { timeout: 3000 }).toBe(1);
  await sleep(400);
  expect(relayed(a.texts, `"rid":"${tag}"`)).toEqual([]);   // never back to who sent it
  expect(relayed(b.texts, `"rid":"${tag}"`)).toEqual([]);   // phones don't get each other's chatter
  expect(relayed(page.texts, tag)).toEqual([]);             // the status page etc. never see relays
  for (const s of [laptop, a, b, page]) s.ws.close();
});

test('the box answers every relay and DMX frame with one byte, the subscribe and other text with nothing', async () => {
  const a = await socket('host');
  expect(a.acks()).toBe(0);                                                      // the subscribe: nothing
  await a.send(JSON.stringify({ relay: { rid: `ack${Date.now()}` } }));
  expect(a.acks()).toBe(1);
  await a.send(new Uint8Array([0x44, 1, 0xff, 0x7f, 100, 0, 1, 2, 3]));          // DMX for a universe nobody plays
  expect(a.acks()).toBe(2);
  await a.send(JSON.stringify({ relay: { rid: `ack${Date.now()}`, pad: 'y'.repeat(3000) } }));   // in TCP pieces
  expect(a.acks()).toBe(3);
  await a.send(JSON.stringify({ relay: { pad: 'z'.repeat(4200) } }));            // too big: dropped, still answered
  expect(a.acks()).toBe(4);
  a.ws.send(JSON.stringify({ hello: 1 }));                                       // not a relay
  a.ws.send(new Uint8Array([1, 2, 3]));                                          // not DMX
  await sleep(400);
  expect(a.acks()).toBe(4);
  expect(a.closed()).toBe(false);
  a.ws.close();
});

test('a relay bigger than a TCP segment arrives whole, two in a row too', async () => {
  const a = await socket(), b = await socket('host');
  const tag = `big${Date.now()}`;
  const one = JSON.stringify({ relay: { rid: tag, i: 1, pad: 'Grüße ✨ '.repeat(260) } });   // ~3 KB, multi-byte
  const two = JSON.stringify({ relay: { rid: tag, i: 2, pad: 'x'.repeat(3800) } });
  expect(new TextEncoder().encode(one).length).toBeGreaterThan(2500);
  await a.send(one); await a.send(two);
  await expect.poll(() => relayed(b.texts, tag).length, { timeout: 4000 }).toBe(2);
  expect(relayed(b.texts, tag)).toEqual([one, two]);
  for (const s of [a, b]) s.ws.close();
});

test('oversized, broken UTF-8 and other text are not passed on, nobody loses their socket', async ({ request }) => {
  const a = await socket(), b = await socket('host');
  const tag = `bad${Date.now()}`;
  a.ws.send(JSON.stringify({ relay: { rid: tag, pad: 'x'.repeat(4200) } }));                // over 4 KB
  // bytes that aren't UTF-8 (a browser receiving them would have to drop its socket)
  await rawTextFrame([...new TextEncoder().encode(`{"relay":{"rid":"${tag}","x":"`), 0xff, 0xfe, ...new TextEncoder().encode('"}}')]);
  a.ws.send(JSON.stringify({ hello: tag }));                                                // not a relay
  a.ws.send(JSON.stringify({ relay: { rid: `${tag}-ok` } }));                               // and one that is
  await expect.poll(() => relayed(b.texts, `${tag}-ok`).length, { timeout: 3000 }).toBe(1);
  expect(relayed(b.texts, tag).filter((t) => !t.includes(`${tag}-ok`))).toEqual([]);
  expect(b.closed()).toBe(false);
  expect((await request.get('/info.json')).status()).toBe(200);
  for (const s of [a, b]) s.ws.close();
});

test('a burst of fader moves all arrive in order; a flood is cut at 50 a second', async () => {
  const a = await socket(), b = await socket('host');
  const tag = `f${Date.now()}`;
  for (let i = 0; i < 40; i++) {
    await a.send(JSON.stringify({ relay: { k: 'fader', rid: tag, v: i / 40 } }));
    await sleep(25);
  }
  await expect.poll(() => relayed(b.texts, tag).length, { timeout: 4000 }).toBe(40);
  const vs = relayed(b.texts, tag).map((t) => JSON.parse(t).relay.v);
  expect(vs).toEqual([...vs].sort((x, y) => x - y));
  await sleep(1100);
  // a page that waits for every answer but sends as fast as that allows: far more than 50 a second
  const flood = `fl${Date.now()}`, t0 = Date.now();
  for (let i = 0; i < 120; i++) await a.send(JSON.stringify({ relay: { rid: flood, i } }));
  expect(Date.now() - t0, 'ms for 120 answered messages').toBeLessThan(1500);
  await sleep(1500);
  expect(relayed(b.texts, flood).length).toBeLessThanOrEqual(52);
  expect(relayed(b.texts, flood).length).toBeGreaterThan(10);
  for (const s of [a, b]) s.ws.close();
});

test('a fifth client never pushes out the one streaming DMX, and a newcomer can still relay', async () => {
  // the laptop's bridge streams DMX (a frame now and then for the output under test isn't needed:
  // any 'D' frame marks it), then four more clients come and go like phones do
  const bridge = await socket('host');
  const frame = new Uint8Array(7); frame.set([0x44, 1, 0x7f, 0x7f, 0, 0, 0]);   // universe 32639: no output plays it
  const keep = setInterval(() => { if (bridge.ws.readyState === 1) bridge.ws.send(frame); }, 200);
  bridge.ws.send(frame);
  await sleep(300);
  const phones = [];
  for (let i = 0; i < 4; i++) phones.push(await socket());
  await sleep(3500);                                   // the box caps at 4 live clients once a second
  expect(bridge.closed()).toBe(false);
  expect(phones.filter((p) => p.closed()).length).toBeGreaterThanOrEqual(1);
  // a phone that's still in reaches the laptop
  const live = phones.find((p) => !p.closed());
  const tag = `n${Date.now()}`;
  live.ws.send(JSON.stringify({ relay: { rid: tag } }));
  await expect.poll(() => relayed(bridge.texts, tag).length, { timeout: 3000 }).toBe(1);
  clearInterval(keep);
  for (const s of [bridge, ...phones]) s.ws.close();
});

test('a fifth client never pushes out the laptop\'s bridge, even before it sent any DMX', async () => {
  const bridge = await socket('host');                 // subscribed as the laptop, no frame yet
  const phones = [];
  for (let i = 0; i < 4; i++) phones.push(await socket());
  await sleep(3500);
  expect(bridge.closed()).toBe(false);
  expect(phones.filter((p) => p.closed()).length).toBeGreaterThanOrEqual(1);
  for (const s of [bridge, ...phones]) s.ws.close();
});
