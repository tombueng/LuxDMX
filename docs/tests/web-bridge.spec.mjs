// The browser bridge: how a web page (the LuxDMX Sequencer) sends DMX to the box. Browsers can't
// send Art-Net, and an https page can't open a plain ws:// to the box, so the box serves a tiny
// page, /bridge, that the app opens as a popup. The two talk with postMessage; the bridge asks
// the user once per site and forwards frames to /ws as binary messages:
//   'D', 1, universe lo, universe hi, priority, 0, then 1..512 channel values
// The box treats them like any other source (merging, timeouts), shown as protocol 2, "Web".
//
// Read-only for the config; it does put values on one output for a few seconds, like artnet.spec.
// LUXDMX_UNI picks the universe to test on (default: output A's), e.g. when something else is
// already sending to output A.
import { test, expect } from '@playwright/test';
import { deviceHost } from './lib/net.mjs';
import { dmx, info, senders, pollFor } from './lib/device.mjs';

let host, uni, outIdx;
test.beforeAll(async ({ request }) => {
  host = await deviceHost();
  const d = await info(request);
  uni = process.env.LUXDMX_UNI !== undefined ? +process.env.LUXDMX_UNI : d.outputs?.[0]?.uni ?? 0;
  outIdx = (d.outputs ?? []).findIndex((o) => o.en && o.uni === uni);
  test.skip(outIdx < 0, `no enabled output plays universe ${uni}`);
});

// One frame, in the bridge's wire format.
const frame = (u, values, prio = 100) => {
  const f = new Uint8Array(6 + values.length);
  f.set([0x44, 1, u & 0xff, u >> 8, prio, 0]);
  f.set(values, 6);
  return f;
};
async function socket() {
  const ws = new WebSocket(`ws://${host}/ws`);
  ws.binaryType = 'arraybuffer';
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
  // /dmx.json shows the output the monitor looks at: look at the one under test.
  ws.send(JSON.stringify({ cmd: 'viewout', out: outIdx }));
  return ws;
}
// Keep sending (the box drops a source after 4 s of silence) until stopped.
function stream(ws, make) {
  let i = 0;
  const t = setInterval(() => { if (ws.readyState === 1) ws.send(make(i++)); }, 50);
  return () => clearInterval(t);
}

test('/bridge is a small page with the allow / deny controls', async ({ request }) => {
  const r = await request.get('/bridge');
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toContain('text/html');
  const html = await r.text();
  expect(html).toContain('id="allow"');
  expect(html).toContain('id="deny"');
  expect(html.length).toBeLessThan(20000);
});

test('binary frames on /ws drive the output and show up as a "Web" sender', async ({ request }) => {
  const ws = await socket();
  const stop = stream(ws, () => frame(uni, [201, 0, 77, 202]));
  try {
    const d = await pollFor(() => dmx(request), (x) => x.ch[0] === 201 && x.ch[2] === 77 && x.ch[3] === 202);
    expect(d.ch.slice(0, 4)).toEqual([201, 0, 77, 202]);
    const s = await pollFor(() => senders(request), (x) => (x.senders ?? x).some?.((e) => e.p === 2));
    expect((s.senders ?? s).some((e) => e.p === 2)).toBe(true);
  } finally { stop(); ws.close(); }
});

test('malformed frames are ignored and the box keeps answering', async ({ request }) => {
  const ws = await socket();
  const stop = stream(ws, () => frame(uni, [111, 112]));
  try {
    await pollFor(() => dmx(request), (x) => x.ch[0] === 111);
    for (const bad of [
      new Uint8Array([0x45, 1, uni & 0xff, uni >> 8, 100, 0, 9, 9]),        // wrong magic
      new Uint8Array([0x44, 2, uni & 0xff, uni >> 8, 100, 0, 9, 9]),        // unknown version
      new Uint8Array([0x44, 1, uni & 0xff, uni >> 8]),                      // too short
      new Uint8Array(6 + 600).fill(9).fill(0x44, 0, 1).fill(1, 1, 2),       // too long
    ]) ws.send(bad);
    await new Promise((r) => setTimeout(r, 600));
    const d = await dmx(request);
    expect(d.ch.slice(0, 2)).toEqual([111, 112]);
    expect((await request.get('/info.json')).status()).toBe(200);
  } finally { stop(); ws.close(); }
});

test('the popup handshake: hello -> ask -> allow -> frames reach the output (and the site is forgotten again)', async ({ page, request }) => {
  await page.goto('/');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.evaluate(() => { window.__bridge = window.open('/bridge', 'bridge'); })]);
  await popup.waitForLoadState();
  const send = (m) => page.evaluate((msg) => window.__bridge.postMessage({ luxdmx: 1, ...msg }, location.origin), m);
  await send({ type: 'hello' });
  await expect(popup.locator('#allow')).toBeVisible();
  await popup.locator('#allow').click();
  const ws = await socket();                                 // only to point /dmx.json at the output
  const t = setInterval(() => send({ type: 'dmx', uni, data: [55, 66, 77] }).catch(() => {}), 60);
  try {
    const d = await pollFor(() => dmx(request), (x) => x.ch[0] === 55 && x.ch[1] === 66 && x.ch[2] === 77);
    expect(d.ch.slice(0, 3)).toEqual([55, 66, 77]);
  } finally {
    clearInterval(t);
    await popup.locator('#revoke').click().catch(() => {});  // leave the site un-allowed for the next run
    ws.close();
  }
});

// The app only sends a box what it plays, so the page says which universes that is: its DMX outputs
// and the enabled pixel ports, every universe each of them spans. And how each pixel port drives its
// LEDs (brightness, gamma, power cap, current model), so the app draws them as they really light.
test('the popup names what the box plays: outputs and pixel ports, and how each port drives its LEDs', async ({ page, request }) => {
  const r = await request.get('/pixels.json');
  const ports = r.ok() ? (await r.json()).ports ?? [] : [];
  const want = [...new Set(ports.filter((p) => p.en).flatMap((p) => Array.from({ length: Math.max(1, p.spans) }, (_, k) => p.uni + k)))].sort((a, b) => a - b);
  const i = await info(request);
  await page.goto('/');
  await page.evaluate(() => { window.__ready = new Promise((ok) => addEventListener('message', (e) => { if (e.data?.type === 'ready') ok(e.data); })); });
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.evaluate(() => { window.__bridge = window.open('/bridge', 'bridge'); })]);
  await popup.waitForLoadState();
  await page.evaluate(() => window.__bridge.postMessage({ luxdmx: 1, type: 'hello' }, location.origin));
  await popup.locator('#allow').click();
  const ready = await page.evaluate(() => window.__ready);
  try {
    expect(ready.outputs.map((o) => o.uni)).toEqual((i.outputs ?? []).map((o) => o.uni));
    expect([...ready.pixels].sort((a, b) => a - b)).toEqual(want);
    const KEYS = ['uni', 'start', 'count', 'spans', 'bright', 'gamma', 'maxMa', 'mAPerCh', 'quiesMa'];
    expect(ready.pixelPorts).toEqual(ports.filter((p) => p.en).map((p) => Object.fromEntries(KEYS.map((k) => [k, p[k]]))));
  } finally {
    await popup.locator('#revoke').click().catch(() => {});
  }
});

// The app's output thread gets a channel of its own to the bridge page (a MessagePort): frames
// through it reach the output whatever the app's page is busy with; the page says it took it. A
// page that goes away sends "bye" with its safe look: that look is what stays, nothing from the
// channel comes after it.
test('a channel from the app\'s output thread: frames through it reach the output; "bye" ends it with the safe look', async ({ page, request }) => {
  await page.goto('/');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.evaluate(() => { window.__bridge = window.open('/bridge', 'bridge'); })]);
  await popup.waitForLoadState();
  const send = (m) => page.evaluate((msg) => window.__bridge.postMessage({ luxdmx: 1, ...msg }, location.origin), m);
  await send({ type: 'hello' });
  await expect(popup.locator('#allow')).toBeVisible();
  await popup.locator('#allow').click();
  const ws = await socket();
  // the channel (the app hands one end to its output thread; here the page keeps it)
  const took = await page.evaluate(() => new Promise((ok) => {
    const ch = new MessageChannel();
    window.__port = ch.port1;
    addEventListener('message', (e) => { if (e.data?.luxdmx === 1 && e.data.type === 'port') ok(!!e.data.ok); });
    window.__bridge.postMessage({ luxdmx: 1, type: 'port' }, location.origin, [ch.port2]);
    setTimeout(() => ok(false), 3000);
  }));
  expect(took).toBe(true);
  const viaPort = (u, data) => page.evaluate(([u, data]) => window.__port.postMessage({ luxdmx: 1, type: 'dmx', uni: u, prio: 100, data }), [u, data]);
  const t = setInterval(() => viaPort(uni, [31, 41, 59]).catch(() => {}), 60);
  try {
    await pollFor(() => dmx(request), (x) => x.ch[0] === 31 && x.ch[1] === 41 && x.ch[2] === 59);
    // bye: the safe look, then nothing more from the channel (it keeps sending here, on purpose)
    await send({ type: 'bye', frames: [{ uni, prio: 100, data: [0, 0, 7] }] });
    await pollFor(() => dmx(request), (x) => x.ch[0] === 0 && x.ch[2] === 7);
    await new Promise((r) => setTimeout(r, 600));
    expect((await dmx(request)).ch.slice(0, 3)).toEqual([0, 0, 7]);
  } finally {
    clearInterval(t);
    await send({ type: 'hello' }).catch(() => {});             // (the page back as it was for the next test)
    await popup.locator('#revoke').click().catch(() => {});
    ws.close();
  }
});
