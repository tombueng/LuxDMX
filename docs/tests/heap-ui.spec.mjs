// The web UI on a small heap (issue #135, the WiFi half). A classic ESP32 on WiFi kept clocking
// DMX, but its status page sat on "Connecting…", and a few page loads later the board dropped off
// the network until it was power-cycled. A plain OTA upload did the same. Measured on a WT32-ETH01
// with v1.0.277: 14.5 KB of real heap at idle and 392 bytes at its lowest. Each DMX output held a
// 12 KB pre-encoded RMT frame, the Art-Net RDM queues were sized for an S3 (~20 KB), and the
// version check kept a 12 KB stack parked between its four runs a day.
//
// Read-only (prepInput only puts the device in passthrough with the monitor on output A, like the
// other input specs). Runs on any board; the floors are what bites on a classic chip:
// - idle: the real heap (/dmx.json heap, byte-addressable internal RAM) stays above IDLE_MIN
// - Art-Net, then sACN: a chase streams into output A's universe while the status page is opened
//   ROUNDS times with the config page in between. Every round the WS badge has to go Live and the
//   page and its assets have to load. The heap is sampled the whole time and can't drop under
//   LOAD_MIN, and afterwards the device still answers HTTP and ArtPoll.
//
// The numbers it has to clear on a classic chip are the WiFi ones, so run it with the board on
// WiFi to mean anything there. Over Ethernet a classic chip has ~20 KB more to work with.
import { test, expect } from '@playwright/test';
import {
  deviceHost, UdpSender, artDmxPacket, e131Packet, prepInput, sleep, artPollPacket,
  artNetRequestReply, ART_PORT, SACN_PORT,
} from './lib/net.mjs';
import { info, dmx } from './lib/device.mjs';

const ROUNDS = 5;
// Real heap floors (bytes). A classic ESP32 has ~40 KB less to begin with and WiFi takes ~53 KB
// of what's left, so it gets its own pair.
const FLOORS = {
  classic: { IDLE_MIN: 40000, LOAD_MIN: 8000 },
  other:   { IDLE_MIN: 80000, LOAD_MIN: 30000 },
};
// /info.json chip is ESP.getChipModel(): "ESP32-D0WD-V3", "ESP32-PICO-D4", ... vs "ESP32-S3".
const isClassic = (chip) => /^ESP32/.test(chip || '') && !/^ESP32-[SCH]\d/.test(chip || '');

// A chase on 512 channels (red, green, blue, white steps every 250 ms), ~30 fps, until stop().
function chase(host, proto, uni) {
  const sender = new UdpSender(host);
  let run = true;
  const done = (async () => {
    for (let seq = 0; run; seq++) {
      const step = Math.floor(Date.now() / 250) % 4;
      const d = Buffer.alloc(512);
      for (let i = 0; i + 2 < 512; i += 3) {
        d[i] = step === 0 || step === 3 ? 255 : 0;
        d[i + 1] = step === 1 || step === 3 ? 255 : 0;
        d[i + 2] = step >= 2 ? 255 : 0;
      }
      await sender.send(proto === 'sACN' ? SACN_PORT : ART_PORT,
        proto === 'sACN' ? e131Packet(uni + 1, d, seq) : artDmxPacket(uni, d, seq));
      await sleep(33);
    }
  })();
  return async () => { run = false; await done; sender.close(); };
}

// /dmx.json every 500 ms; remembers the lowest real heap it saw and how many polls went unanswered.
function heapSampler(request) {
  const st = { min: Infinity, misses: 0, polls: 0 };
  let run = true;
  const done = (async () => {
    while (run) {
      st.polls++;
      try { const j = await dmx(request); if (Number.isFinite(j.heap)) st.min = Math.min(st.min, j.heap); }
      catch { st.misses++; }
      await sleep(500);
    }
  })();
  st.stop = async () => { run = false; await done; return st; };
  return st;
}

let floors;
test.beforeAll(async ({ request }) => {
  const i = await info(request);
  floors = isClassic(i.chip) ? FLOORS.classic : FLOORS.other;
});

test('idle: the real heap leaves room for the web UI', async ({ request }) => {
  const d = await dmx(request);
  test.skip(!Number.isFinite(d.heap) || !Number.isFinite(d.heapAll), 'firmware before the real-heap fields');
  expect(d.heap, `real heap ${d.heap} B at idle (floor ${floors.IDLE_MIN})`).toBeGreaterThan(floors.IDLE_MIN);
});

for (const proto of ['Art-Net', 'sACN']) {
  test(`${proto}: the status page goes Live every time while DMX streams in`, async ({ page, request }) => {
    test.setTimeout(180_000);
    const i = await info(request);
    test.skip(proto === 'Art-Net' && i.protocol === 1, 'device takes sACN only');
    test.skip(proto === 'sACN' && i.protocol === 0, 'device takes Art-Net only');
    const host = await deviceHost();
    await prepInput(host);
    const uni = i.outputs?.[0]?.uni ?? i.universe ?? 0;

    const bad = [];
    page.on('requestfailed', (r) => {
      if (['document', 'stylesheet', 'script', 'image'].includes(r.resourceType()))
        bad.push(`${r.url()} ${r.failure()?.errorText}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400 && ['document', 'stylesheet', 'script', 'image'].includes(r.request().resourceType()))
        bad.push(`${r.url()} HTTP ${r.status()}`);
    });

    const stop = chase(host, proto, uni);
    const heap = heapSampler(request);
    try {
      for (let r = 1; r <= ROUNDS; r++) {
        await page.goto('/', { waitUntil: 'load' });
        await expect(page.locator('#ws-badge'), `round ${r}: the status page's socket opens`).toHaveText(/Live/, { timeout: 15_000 });
        await page.goto('/config', { waitUntil: 'load' });
        await sleep(1000);
      }
    } finally {
      await stop();
      await heap.stop();
    }
    expect(bad, 'pages and their assets load in full').toEqual([]);
    expect(heap.misses, `/dmx.json went unanswered ${heap.misses} of ${heap.polls} times`).toBeLessThanOrEqual(2);
    expect(heap.min, `lowest real heap seen ${heap.min} B (floor ${floors.LOAD_MIN})`).toBeGreaterThan(floors.LOAD_MIN);

    // Still on the network afterwards: HTTP and Art-Net discovery both answer.
    await page.goto('about:blank');
    await sleep(1500);
    expect((await dmx(request)).heap, 'device answers HTTP after the run').toBeGreaterThan(0);
    const reply = await artNetRequestReply(host, artPollPacket(), { wantOp: 0x2100 }).catch(() => null);
    expect(reply, 'device answers an ArtPoll after the run').toBeTruthy();
  });
}
