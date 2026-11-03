// A WebSocket frame header split across two TCP packets. A browser on WiFi can send that by
// accident (two messages bunched into one packet, the packet boundary inside the second one's
// header). ESPAsyncWebServer v3.12.1 misread it: the message was lost, and with only the header's
// first byte in the first packet the box crashed and restarted, or its web task spun for good
// (no web pages, no new connections, no Art-Net poll replies). The box now runs the library with
// upstream's fix (platformio.ini).
//
// A raw client sends two small text messages, the second one's header cut after 1, 2, 3 and 6
// bytes, with 100 ms between the two packets. A plain WebSocket opened beforehand is the witness:
// a box that restarts or wedges closes it (or stops answering it). The box must keep answering.
//
// Opt-in (LUXDMX_WRITE=1): on firmware without the fix this restarts the box, several times.
// Nothing in the config changes; the messages are text the box ignores.
import { test, expect } from '@playwright/test';
import net from 'node:net';
import crypto from 'node:crypto';
import { deviceHost } from './lib/net.mjs';

test.skip(!process.env.LUXDMX_WRITE, 'opt-in: on a box without the fix this restarts it (LUXDMX_WRITE=1)');

let host;
test.beforeAll(async () => { host = await deviceHost(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// One masked text frame, as a browser sends it.
function frame(text) {
  const p = Buffer.from(text), mask = crypto.randomBytes(4);
  return Buffer.concat([Buffer.from([0x81, 0x80 | p.length]), mask, Buffer.from(p.map((x, i) => x ^ mask[i % 4]))]);
}
async function rawSocket() {
  const s = net.connect(80, host);
  s.setNoDelay(true);
  s.on('error', () => {});
  await new Promise((ok, bad) => { s.once('connect', ok); s.once('error', bad); });
  s.write(`GET /ws HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
    `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  await new Promise((ok) => s.once('data', ok));                       // 101 Switching Protocols
  return s;
}
async function answers() {
  try { return (await fetch(`http://${host}/version.json`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
}

test('a frame header split across two TCP packets: the box keeps running and answering', async () => {
  test.setTimeout(120_000);
  // the witness: a page's socket, which hears the box's status frames (10 a second)
  const witness = new WebSocket(`ws://${host}/ws`);
  witness.binaryType = 'arraybuffer';
  let closed = false, heard = 0;
  witness.onclose = () => { closed = true; };
  witness.onmessage = () => { heard++; };
  await new Promise((ok, bad) => { witness.onopen = ok; witness.onerror = bad; });
  try {
    for (const cut of [1, 2, 3, 6]) {
      for (let round = 0; round < 3; round++) {
        const s = await rawSocket();
        const one = frame('{"hello":1}'), two = frame('{"hello":2}');
        s.write(Buffer.concat([one, two.subarray(0, cut)]));
        await sleep(100);
        s.write(two.subarray(cut));
        await sleep(400);
        s.destroy();
        const before = heard;
        expect(await answers(), `HTTP after a header cut after ${cut} byte(s), round ${round + 1}`).toBe(true);
        await sleep(400);
        expect(closed, `the witness socket is still open (cut ${cut}, round ${round + 1})`).toBe(false);
        expect(heard, `the witness still hears the box (cut ${cut}, round ${round + 1})`).toBeGreaterThan(before);
      }
    }
  } finally { witness.close(); }
});
