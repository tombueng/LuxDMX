// WebSocket clients vs the heap (issue #135). A classic ESP32 hung when the web UI was used
// while DMX ran: every browser tab got the full status stream, one client that stopped reading
// parked up to 32 queued messages, and the all-or-nothing send gate then froze the stream for
// everybody. The heap guards that should have caught it counted ~33 KB of IRAM that nothing can
// allocate from, so they never fired. These check the fixed behaviour on a live device:
//
// - /dmx.json reports the real (byte-addressable) heap, plus the old figure as heapAll.
// - The ~6 KB senders/log JSON only goes to a socket that asked for it (the status page).
// - A client that stops reading costs a few KB and stalls only itself; a second client keeps
//   getting its 10 Hz frames the whole time. This one takes about a minute: the stalled socket
//   first has to fill its own kernel receive buffer before the device sees any backpressure.
//   Honest note: on an S3 the old firmware passes this too, AsyncTCP's 5 s ack timeout drops
//   the stuck socket before its queue fills (measured, investigations/issue135/stall-oldfw.log).
//   The freeze in the issue needs the classic chip's heap at zero, which an S3 never gets to.
//   It stays as a guard that one bad client never takes the others down.
// - Art-Net AND sACN input still show up in the /ws frame (the push moved out of the receive path).
// - A page closes its socket while hidden and when it's left, and reconnects when visible again.
//
// Nothing here changes the config. The input tests put the device in passthrough with the
// monitor on output A (prepInput), like the other input specs.
//
// Not automated: the version check now runs every 6 h instead of every ~125 s. Waiting 6 h is
// not a test; the fix is the tick arithmetic in versionCheckTask.
import { test, expect } from '@playwright/test';
import net from 'node:net';
import crypto from 'node:crypto';
import {
  deviceHost, UdpSender, streamFor, artDmxPacket, e131Packet, prepInput, sleep,
  ART_PORT, SACN_PORT,
} from './lib/net.mjs';
import { info, dmx, pollFor, universes } from './lib/device.mjs';

// A /ws client that counts what it gets. meta=true sends the status page's subscription.
function wsCounter(host, { meta = false } = {}) {
  const st = { bin: 0, text: [], open: false, lastBinAt: 0, maxGap: 0, last: null };
  const ws = new WebSocket(`ws://${host}/ws`);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { st.open = true; if (meta) ws.send(JSON.stringify({ type: 'meta' })); };
  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      const now = Date.now();
      if (st.lastBinAt) st.maxGap = Math.max(st.maxGap, now - st.lastBinAt);
      st.lastBinAt = now; st.bin++; st.last = new Uint8Array(ev.data);
    } else {
      st.text.push(ev.data);
    }
  };
  st.close = () => { try { ws.close(); } catch {} };
  st.resetGap = () => { st.maxGap = 0; st.lastBinAt = 0; };
  return st;
}

// A client that does the WebSocket handshake and then never reads again, like a tab the OS froze
// or a laptop that went to sleep with the page open. Node stops pulling from the kernel, the
// receive window closes, and from the device's side the frames pile up in its queue.
function stalledClient(host) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(80, host);
    const key = crypto.randomBytes(16).toString('base64');
    let head = '';
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('no WS handshake')); }, 5000);
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.once('connect', () => sock.write(
      `GET /ws HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    const onData = (d) => {
      head += d.toString('latin1');
      if (!head.includes('\r\n\r\n')) return;
      clearTimeout(timer);
      sock.off('data', onData);
      sock.pause();   // from here on nothing is read
      if (!/^HTTP\/1\.1 101/.test(head)) { sock.destroy(); reject(new Error(head.split('\r\n')[0])); return; }
      resolve(sock);
    };
    sock.on('data', onData);
  });
}

async function wsCount(request) { return (await dmx(request)).ws; }

test.describe('WebSocket clients and the real heap (issue #135)', () => {
  test('/dmx.json reports the real heap next to the old figure', async ({ request }) => {
    const d = await dmx(request);
    for (const k of ['heap', 'heapMin', 'heapBlock', 'heapAll', 'ws'])
      expect(Number.isInteger(d[k]), `${k} is an integer`).toBe(true);
    expect(d.heap).toBeGreaterThan(0);
    // The figures are read one after the other while the box runs, so allow a little drift between
    // them (an allocation landing in between moves one and not the other).
    const SLACK = 2048;
    expect(d.heap, 'real heap can never exceed the old figure').toBeLessThanOrEqual(d.heapAll + SLACK);
    expect(d.heapBlock, 'largest block fits inside the free total').toBeLessThanOrEqual(d.heap + SLACK);
    expect(d.heapMin, 'the low-water mark is at or below the current figure').toBeLessThanOrEqual(d.heap + SLACK);
    // The classic chip is where the two differ: heapAll also counts ~33 KB of 32-bit-only IRAM.
    const chip = (await info(request)).chip || '';
    if (!/S2|S3|C3|C6/.test(chip))
      expect(d.heapAll - d.heap, `${chip}: IRAM left out of the real figure`).toBeGreaterThan(20000);
  });

  test('only a subscribed socket gets the senders/log JSON', async () => {
    const host = await deviceHost();
    const plain = wsCounter(host), status = wsCounter(host, { meta: true });
    try {
      await sleep(5500);   // the meta push runs every 2 s
      expect(plain.bin, 'plain socket gets the status frames').toBeGreaterThan(20);
      expect(status.bin, 'subscribed socket gets them too').toBeGreaterThan(20);
      expect(plain.text.length, 'plain socket never gets the meta JSON').toBe(0);
      expect(status.text.length, 'subscribed socket gets the meta JSON').toBeGreaterThan(0);
      const m = JSON.parse(status.text.at(-1));
      expect(m.meta).toBe(1);
      expect(Array.isArray(m.senders)).toBe(true);
      expect(Array.isArray(m.log)).toBe(true);
    } finally { plain.close(); status.close(); }
  });

  test('a client that stops reading stalls only itself', async ({ request }) => {
    test.setTimeout(150_000);
    const host = await deviceHost();
    const n0 = await wsCount(request);
    const base = await dmx(request);
    const healthy = wsCounter(host);
    let stalled;
    try {
      await pollFor(() => wsCount(request), (n) => n >= n0 + 1, { ms: 5000 });
      stalled = await stalledClient(host);
      expect(await pollFor(() => wsCount(request), (n) => n >= n0 + 2, { ms: 5000 }), 'both connected').toBeGreaterThanOrEqual(n0 + 2);
      healthy.resetGap();
      // 75 s: the stalled side's kernel buffer fills first (~5.5 KB/s of frames), then the
      // device's send buffer, then its 4-message queue (or the ack timeout drops it). Checking
      // the whole window covers whichever happens when.
      let minHeap = base.heap;
      const t0 = Date.now(), binAt0 = healthy.bin;
      while (Date.now() - t0 < 75_000) {
        await sleep(2500);
        const d = await dmx(request);
        minHeap = Math.min(minHeap, d.heap);
        expect(Date.now() - healthy.lastBinAt, `healthy client starved at ${Math.round((Date.now() - t0) / 1000)} s`).toBeLessThan(2000);
      }
      const rate = (healthy.bin - binAt0) / 75;
      expect(rate, 'healthy client kept the ~10 Hz stream').toBeGreaterThan(6);
      expect(healthy.maxGap, 'no long gap in the healthy stream').toBeLessThan(2000);
      // A stuck client is now worth its 4 queued frames plus one TCP send buffer, not ~25 KB.
      expect(base.heap - minHeap, `heap ${base.heap} -> lowest ${minHeap}`).toBeLessThan(16000);
    } finally {
      healthy.close();
      if (stalled) stalled.destroy();
    }
    // And the stalled one goes away once its socket does.
    const back = await pollFor(() => wsCount(request), (n) => n <= n0, { ms: 20_000, every: 500 });
    expect(back, 'stalled client was cleaned up').toBeLessThanOrEqual(n0);
  });

  test('Art-Net and sACN input still reach the /ws frame', async ({ request }) => {
    const host = await deviceHost();
    const { art, sacn, info: d } = await universes(request);
    await prepInput(host);
    const sender = new UdpSender(host);
    const client = wsCounter(host);
    try {
      const protos = [];
      if (d.protocol !== 1) protos.push(['artnet', ART_PORT, (i, buf) => artDmxPacket(art, buf, i), 77]);
      if (d.protocol !== 0) protos.push(['sacn', SACN_PORT, (i, buf) => e131Packet(sacn, buf, i), 88]);
      for (const [proto, port, make, val] of protos) {
        const data = Buffer.alloc(512); data[0] = val;
        const streaming = streamFor(sender, port, (i) => make(i, data), { ms: 3000 });
        // frame layout: 16-byte header, then the 512 channels of the viewed output
        const got = await pollFor(async () => client.last && client.last[16], (v) => v === val, { ms: 6000, every: 100 });
        await streaming;
        expect(got, `${proto}: channel 1 in the /ws frame`).toBe(val);
      }
    } finally { sender.close(); client.close(); }
  });

  for (const path of ['/', '/config']) {
    test(`${path} closes its socket while hidden and when left`, async ({ page, request }) => {
      const n0 = await wsCount(request);
      await page.goto(path);
      expect(await pollFor(() => wsCount(request), (n) => n === n0 + 1, { ms: 8000 }), 'page connected').toBe(n0 + 1);

      const setVisibility = (state) => page.evaluate((s) => {
        Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
        Object.defineProperty(document, 'hidden', { value: s === 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }, state);

      await setVisibility('hidden');
      expect(await pollFor(() => wsCount(request), (n) => n === n0, { ms: 8000 }), 'hidden tab let go').toBe(n0);
      await sleep(3000);   // and it stays gone: no reconnect loop while hidden
      expect(await wsCount(request), 'no reconnect while hidden').toBe(n0);

      await setVisibility('visible');
      expect(await pollFor(() => wsCount(request), (n) => n === n0 + 1, { ms: 8000 }), 'visible again').toBe(n0 + 1);

      await page.goto('about:blank');
      expect(await pollFor(() => wsCount(request), (n) => n === n0, { ms: 8000 }), 'left the page').toBe(n0);
    });
  }
});
