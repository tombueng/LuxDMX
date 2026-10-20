// Every DMX output the board has pins for has to actually send, not just show up as enabled.
//
// On the ESP32-S3 the first output takes the one DMA-capable RMT channel and every other output
// gets one channel memory block. They used to ask for two, which left the third output nothing:
// on the carrier, Output C said "enabled" and never clocked a frame, 40/40/0 fps. The pixel
// backend counts on one channel per DMX output as well, so with every output on, one RMT pixel
// port still has to fit next to them (4 TX channels on an S3).
//
// Only outputs whose pins are free get switched on: no collision with Ethernet, the display,
// buttons, LEDs, an enabled pixel port or another output. A board wired differently is left
// alone instead of having a DMX driver dropped onto its W5500. Restores the config afterwards.
import { test, expect } from '@playwright/test';
import { configSnapshot, configForm, dmx, waitForState } from './lib/device.mjs';
import { UdpSender, artDmxPacket, e131Packet, prepInput, sleep, deviceHost, ART_PORT, SACN_PORT } from './lib/net.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';
const RATE_HZ = [40, 41.7, 33.3, 25, 20];            // ENUM_TXRATE in config_schema.cpp
const RMII_PINS = [0, 18, 19, 21, 22, 23, 25, 26, 27]; // classic ESP32 EMAC, fixed in silicon
const NAME = 'ABCDEFGH';

let original = null;
test.beforeAll(async ({ request }) => { if (WRITE) original = await configSnapshot(request); });
test.afterAll(async ({ request }) => {
  if (!original) return;
  await request.post('/config', { form: { ...configForm(original), pixbk: String(original.pixBackend || 0) } })
    .catch(() => {});
  await waitForState(request, (d) => d.outputs.every((o, i) => o.en === original.outputs[i].en));
});

// GPIOs something other than a DMX output is using right now. Only features that are on count:
// the config keeps pin numbers for a display or LED type that isn't selected, and on the carrier
// those overlap the pixel ports and Ethernet.
function busyPins(s) {
  const keys = ['encA', 'encB', 'encSw', 'btn1Pin', 'btn2Pin', 'btn3Pin', 'btn4Pin'];
  if (s.useEthernet || s.ethW5500) keys.push('ethCs', 'ethSck', 'ethMosi', 'ethMiso', 'ethInt', 'ethRst');
  if (s.dispType >= 1 && s.dispType <= 3) keys.push('dispSda', 'dispScl');           // I2C OLEDs
  if (s.dispType === 4) keys.push('dispCs', 'dispDc', 'dispMosi', 'dispSck', 'dispRst'); // SPI colour
  if (s.ledType === 1 || s.ledType === 2) keys.push('ledPin');                         // GPIO / WS2812
  if (s.ledType === 3) keys.push('ledR', 'ledG', 'ledB', 'ledW', 'ledY');               // 5-LED panel
  const pins = keys.map((k) => s[k]);
  if (s.ethRmii) pins.push(...RMII_PINS);
  for (const p of s.pixels || []) if (p.en) pins.push(p.pin);
  return new Set(pins.filter((p) => Number.isInteger(p) && p >= 0));
}

// The outputs this board can have on without touching anything else: the ones already on, plus
// every other one with a TX pin and no pin shared with another owner or with an output before it.
function usableOutputs(s) {
  const busy = busyPins(s);
  const pinsOf = (o) => [o.tx, o.rx, o.rts].filter((p) => p >= 0);
  s.outputs.forEach((o) => { if (o.en) pinsOf(o).forEach((p) => busy.add(p)); });
  const picked = [];
  s.outputs.forEach((o, i) => {
    if (o.en && o.tx >= 0) { picked.push(i); return; }
    const mine = pinsOf(o);
    if (o.tx < 0 || new Set(mine).size !== mine.length || mine.some((p) => busy.has(p))) return;
    picked.push(i);
    mine.forEach((p) => busy.add(p));
  });
  return picked;
}

// Feed every enabled output its own universe for a few seconds (so a "stop sending" loss policy
// can't idle one), and read the per-output transmit rate while the stream is still running.
async function outFpsUnderLoad(request, host, proto, outputs) {
  await prepInput(host);
  const sender = new UdpSender(host);
  let streaming = true;
  const stream = (async () => {
    for (let seq = 0; streaming; seq++) {
      const d = Buffer.alloc(512, seq & 0xff);   // new values every frame, so a Delta output sends too
      for (const o of outputs.filter((x) => x.en)) {
        await sender.send(proto === 'sACN' ? SACN_PORT : ART_PORT,
          proto === 'sACN' ? e131Packet(o.uni + 1, d, seq) : artDmxPacket(o.uni, d, seq));
      }
      await sleep(25);
    }
  })();
  try {
    await sleep(3500);                           // outfps rolls up once a second
    return (await dmx(request)).outfps;
  } finally {
    streaming = false;
    await stream;
    sender.close();
  }
}

function expectAllSending(fps, outputs, use) {
  for (const i of use) {
    const want = Math.min(RATE_HZ[outputs[i].rate ?? 0] ?? 40, 40);
    expect(fps[i], `output ${NAME[i]} is enabled, so it has to clock frames (wants ~${want} fps)`)
      .toBeGreaterThan(want * 0.75);
  }
}

async function switchOn(request, snap, use, extra = {}) {
  const on = { ...snap, outputs: snap.outputs.map((o, i) => (use.includes(i) ? { ...o, en: true } : o)), ...extra };
  await request.post('/config', { form: { ...configForm(on), pixbk: String(on.pixBackend || 0) } }).catch(() => {});
  await waitForState(request, (d) => use.every((i) => d.outputs[i].en));
  return on;
}

for (const proto of ['Art-Net', 'sACN']) {
  test(`${proto}: every output with its own pins sends frames`, async ({ request }) => {
    test.skip(!WRITE, 'device-mutating: set LUXDMX_WRITE=1 to run');
    test.setTimeout(120_000);
    const snap = await configSnapshot(request);
    test.skip(proto === 'Art-Net' && snap.protocol === 1, 'device takes sACN only');
    test.skip(proto === 'sACN' && snap.protocol === 0, 'device takes Art-Net only');
    const use = usableOutputs(snap);
    test.skip(use.length < 2, `only ${use.length} output(s) have pins of their own on this board`);

    const on = await switchOn(request, snap, use);
    const fps = await outFpsUnderLoad(request, await deviceHost(), proto, on.outputs);
    expectAllSending(fps, on.outputs, use);
  });
}

test('with every output on, one RMT pixel port still fits next to them', async ({ request }) => {
  test.skip(!WRITE, 'device-mutating: set LUXDMX_WRITE=1 to run');
  test.setTimeout(120_000);
  const snap = await configSnapshot(request);
  const use = usableOutputs(snap);
  test.skip(use.length < 2, `only ${use.length} output(s) have pins of their own on this board`);
  const pr = await request.get('/pixels.json');
  const px = pr.ok() ? await pr.json() : {};
  test.skip(!px.rmtMax, 'firmware does not report rmtMax');
  const dmxOn = new Set([...use, ...snap.outputs.map((o, i) => (o.en ? i : -1)).filter((i) => i >= 0)]).size;
  test.skip(px.rmtMax - dmxOn - (snap.ledType === 2 ? 1 : 0) < 1, 'no RMT channel left for a pixel port');
  const port = snap.pixels[0];
  const taken = busyPins(snap);
  for (const i of use) [snap.outputs[i].tx, snap.outputs[i].rx, snap.outputs[i].rts].forEach((p) => taken.add(p));
  test.skip(!(port?.pin >= 0) || taken.has(port.pin), 'pixel port 1 has no free pin');

  // Exactly one pixel port: any other enabled port would want a channel of its own, and 3 DMX +
  // 2 ports doesn't fit in four (afterAll switches them back on).
  const pixels = snap.pixels.map((p, i) => (i === 0 ? { ...p, en: true, count: 16 } : { ...p, en: false }));
  const on = await switchOn(request, snap, use, { pixels, pixBackend: 1 });
  await expect.poll(async () => (await (await request.get('/pixels.json')).json()).backend,
    { message: 'the pixel port gets the RMT channel the DMX outputs left over', timeout: 15_000 }).toBe('rmt');
  const proto = snap.protocol === 1 ? 'sACN' : 'Art-Net';
  const fps = await outFpsUnderLoad(request, await deviceHost(), proto, on.outputs);
  expectAllSending(fps, on.outputs, use);
});
