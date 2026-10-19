// A pixel port started on RMT from a live config change, then config saves while DMX is
// streaming, must never restart the device.
//
// The pixel driver used to be (re)started on the network task, core 0, while the DMX outputs'
// RMT channels are made in setup() on core 1. The RMT has one interrupt for all its channels,
// so that routed it to both cores. A config save writes flash, which parks the other core with
// its non-IRAM interrupts off, and a DMX frame finishing in that window left an interrupt that
// core 0 could not clear. Core 0 took it again and again, never finished the flash write, and
// the interrupt watchdog rebooted the box. On the carrier pixels.spec did that about one run in
// three. Here DMX streams the whole time, so a frame finishes during the saves' flash writes
// over and over, and the old firmware didn't survive the loop.
//
// Both protocols, because each feeds output A from its own receive path. Restores the pixel
// ports and the driver choice afterwards.
import { test, expect } from '@playwright/test';
import { configSnapshot, configForm, dmx, universes } from './lib/device.mjs';
import { UdpSender, artDmxPacket, e131Packet, prepInput, sleep, deviceHost, ART_PORT, SACN_PORT } from './lib/net.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';
const SAVES = +(process.env.LUXDMX_RMT_SAVES || 15);

let host, original = null;
test.beforeAll(async ({ request }) => {
  host = await deviceHost();
  if (WRITE) original = await configSnapshot(request);
});
test.afterAll(async ({ request }) => {
  if (!original) return;
  await post(request, { ...configForm(original), pixbk: String(original.pixBackend || 0) });
});

// Uptime as seconds. A restart shows up as this going DOWN.
async function uptimeSec(request) {
  const m = /(\d+)d (\d+):(\d+):(\d+)/.exec((await dmx(request)).up);
  return m ? +m[1] * 86400 + +m[2] * 3600 + +m[3] * 60 + +m[4] : 0;
}

// A save while the device is still applying the previous one can get its connection reset, and a
// crashed device doesn't answer at all. Neither throws here: the uptime check below is the verdict.
async function post(request, form) {
  try { return await request.post('/config', { form, timeout: 10_000 }); } catch { return null; }
}

async function pixelsJson(request) {
  for (let i = 0; i < 20; i++) {
    try { const r = await request.get('/pixels.json'); if (r.ok()) return await r.json(); } catch {}
    await sleep(500);
  }
  throw new Error('no /pixels.json');
}

for (const proto of ['Art-Net', 'sACN']) {
  test(`${proto}: saves after a live RMT pixel start never restart the device`, async ({ request }) => {
    test.skip(!WRITE, 'device-mutating: set LUXDMX_WRITE=1 to run');
    test.setTimeout(120_000);
    const snap = await configSnapshot(request);
    const px = await pixelsJson(request);
    test.skip(!px.rmtMax, 'firmware does not report rmtMax');
    test.skip(!snap.outputs[0]?.en, 'output A is off, so no DMX frames finish during the saves');
    test.skip(proto === 'Art-Net' && snap.protocol === 1, 'device takes sACN only');
    test.skip(proto === 'sACN' && snap.protocol === 0, 'device takes Art-Net only');
    const free = px.rmtMax - snap.outputs.filter((o) => o.en).length - (snap.ledType === 2 ? 1 : 0);
    test.skip(free < 1, 'no RMT channel left for a pixel port');
    test.skip(!(snap.pixels[0]?.pin >= 0), 'pixel port 1 has no pin');

    // Port 1 on and forced onto RMT. This is the live driver start that used to land on core 0.
    const pixOn = { ...snap, pixels: snap.pixels.map((p, i) => (i === 0 ? { ...p, en: true, count: 16 } : p)) };
    await post(request, { ...configForm(pixOn), pixbk: '1' });
    await expect.poll(async () => (await pixelsJson(request)).backend, { timeout: 15_000 }).toBe('rmt');

    await prepInput(host);
    const { art, sacn } = await universes(request);
    const sender = new UdpSender(host);
    let streaming = true, seq = 0;
    const stream = (async () => {
      const d = Buffer.alloc(512);
      while (streaming) {
        d.fill(seq & 0xff);                       // new values every frame, so a Delta output sends too
        await sender.send(proto === 'sACN' ? SACN_PORT : ART_PORT,
          proto === 'sACN' ? e131Packet(sacn, d, seq) : artDmxPacket(art, d, seq));
        seq++;
        await sleep(25);
      }
    })();

    try {
      await sleep(1000);
      const up0 = await uptimeSec(request);
      const t0 = Date.now();
      // Every save reads ~200 keys back from NVS and writes the changed one: hundreds of flash
      // operations per save, each one a window for the old bug. Brightness alternates so there is
      // a real write each time, and it's a pixel field, so the driver is restarted on every save.
      for (let i = 0; i < SAVES; i++) {
        const bright = String(i % 2 ? 200 : 201);
        const form = { ...configForm({ ...pixOn, pixels: pixOn.pixels.map((p, k) => (k === 0 ? { ...p, bright } : p)) }),
                       pixbk: '1' };
        await post(request, form);
        await sleep(400);
      }
      await sleep(1500);
      const elapsed = Math.floor((Date.now() - t0) / 1000);
      let up1 = -1;                               // a rebooted device needs a moment to answer again
      for (let i = 0; i < 30 && up1 < 0; i++) {
        up1 = await uptimeSec(request).catch(() => -1);
        if (up1 < 0) await sleep(1000);
      }
      expect(up1, `uptime ${up0} -> ${up1} s over ${elapsed} s of saves: the device restarted`)
        .toBeGreaterThanOrEqual(up0 + elapsed - 3);
      expect((await pixelsJson(request)).backend, 'the pixel port is still on RMT').toBe('rmt');
      expect(seq, 'DMX was streaming the whole time').toBeGreaterThan(SAVES * 10);
    } finally {
      streaming = false;
      await stream;
      sender.close();
    }
  });
}
