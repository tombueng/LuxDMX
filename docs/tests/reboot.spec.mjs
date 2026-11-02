// Remote restart (POST /reboot).
//
// Every other restart path the firmware has is a side effect of something else: saving a
// setting, finishing an OTA, erasing the WiFi credentials. There was no way to simply
// restart a box you can reach over the network, which matters because a long-running
// gateway can fragment its heap far enough that an OTA upload no longer fits — and the
// only cure was walking over to it and pulling the plug.
//
// The shape tests are safe to run anywhere. The ones that actually restart the device are
// opt-in, like the rest of the device-mutating suite.
//
// After a restart the box must also *listen*: a box set to sACN (or both) used to open its sACN
// socket on the setup task while the receive task was already reading it, and about one boot in
// six that task got the socket before it was non-blocking, sat in recvfrom waiting for sACN and
// never came back: the web page worked, every DMX input (Art-Net, sACN, OTA) was ignored until
// the next restart. So that one restarts a few times (LUXDMX_REBOOTS, default 4) and sends both.
import { test, expect } from '@playwright/test';
import { info, dmx, pollFor } from './lib/device.mjs';
import { openConfig } from './lib/ui.mjs';
import { sleep, deviceHost, prepInput, UdpSender, streamFor, artDmxPacket, e131Packet, ART_PORT, SACN_PORT } from './lib/net.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';

// "00d 00:17:34" -> seconds. A restart shows up as this going DOWN.
async function uptimeSec(request) {
  const m = /(\d+)d (\d+):(\d+):(\d+)/.exec((await dmx(request)).up);
  if (!m) return 0;
  return +m[1] * 86400 + +m[2] * 3600 + +m[3] * 60 + +m[4];
}

// POST /reboot, then wait for the box to really go away and come back. Returns /info.json.
async function restart(request) {
  const res = await request.post('/reboot');
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).ok).toBeTruthy();
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) {
    try { await request.get('/info.json', { timeout: 1000 }); await sleep(250); }
    catch { gone = true; }
  }
  expect(gone, 'device never went away, so it never restarted').toBeTruthy();
  let back = null;
  for (let i = 0; i < 60 && !back; i++) {
    try { back = await info(request); } catch { await sleep(1000); }
  }
  expect(back, 'device did not come back within a minute').toBeTruthy();
  return back;
}

test.describe('Remote restart', () => {
  test('GET /reboot does NOT restart the device', async ({ request }) => {
    // The whole point of making this POST-only: a browser prefetching a link, a link
    // scanner, or a dashboard thumbnailer must not be able to black out a live rig.
    const before = await uptimeSec(request);
    const res = await request.get('/reboot');
    expect(res.status(), 'GET must not be a working restart').not.toBe(200);
    await sleep(3000);
    const after = await uptimeSec(request);
    expect(after, 'device restarted on a GET').toBeGreaterThanOrEqual(before);
  });

  test('the Device section offers a Restart button', async ({ page }) => {
    await openConfig(page);
    const btn = page.locator('#reboot-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveText(/Restart/i);
    // It must not be a submit control sitting inside the config form, or it would save.
    expect(await btn.evaluate((el) => el.type)).toBe('button');
  });

  test('clicking Restart asks first, and Cancel does nothing', async ({ page, request }) => {
    const before = await uptimeSec(request);
    await openConfig(page);
    await page.locator('#reboot-btn').click();
    await expect(page.locator('#app-modal')).toBeVisible();
    await expect(page.locator('#app-modal-body')).toContainText(/restart/i);
    await page.locator('#app-modal-cancel').click();
    await expect(page.locator('#app-modal')).toBeHidden();
    await sleep(2000);
    expect(await uptimeSec(request), 'Cancel restarted the device').toBeGreaterThanOrEqual(before);
  });

  test('POST /reboot restarts the device and keeps every setting', async ({ request }) => {
    test.skip(!WRITE, 'device-mutating: set LUXDMX_WRITE=1 to run');
    test.setTimeout(120_000);
    const before = await info(request);
    const upBefore = await uptimeSec(request);

    // It answers first and restarts a moment later, so restart() waits for it to actually go
    // away before waiting for it to come back: otherwise "it answers" proves nothing.
    const back = await restart(request);

    // Uptime restarted from zero, and nothing was reconfigured on the way through.
    expect(await uptimeSec(request)).toBeLessThan(upBefore + 1);
    expect(back.hostname).toBe(before.hostname);
    expect(back.outputs[0].uni).toBe(before.outputs[0].uni);
    expect(back.useEthernet).toBe(before.useEthernet);
    expect(back.wifiSsid).toBe(before.wifiSsid);   // /reboot is not /reset
    expect(back.ledType).toBe(before.ledType);
  });

  test('after every restart, Art-Net and sACN input reach the output', async ({ request }) => {
    test.skip(!WRITE, 'device-mutating: set LUXDMX_WRITE=1 to run');
    const n = +(process.env.LUXDMX_REBOOTS ?? 4);
    test.setTimeout(n * 90_000 + 30_000);
    const host = await deviceHost();
    const first = await info(request);
    const uni = first.outputs[0].uni;
    for (let i = 1; i <= n; i++) {
      const box = await restart(request);
      await sleep(5000);                                  // past the start-up, where the race was
      await prepInput(host);
      const tx = new UdpSender(host);
      try {
        if (box.protocol !== 1) {                         // Art-Net (0) or both (2)
          const vals = [i, 101, 102, 103];
          await streamFor(tx, ART_PORT, (seq) => artDmxPacket(uni, [...vals, ...new Array(508).fill(0)], seq % 255 + 1), { ms: 1500 });
          const d = await pollFor(() => dmx(request), (x) => x.ch?.[0] === i, { ms: 3000 });
          expect(d.ch.slice(0, 4), `Art-Net after restart ${i}`).toEqual(vals);
        }
        if (box.protocol !== 0) {                         // sACN (1) or both (2): universe + 1
          const vals = [i, 201, 202, 203];
          await streamFor(tx, SACN_PORT, (seq) => e131Packet(uni + 1, [...vals, ...new Array(508).fill(0)], seq % 256), { ms: 1500 });
          const d = await pollFor(() => dmx(request), (x) => x.ch?.[1] === 201, { ms: 3000 });
          expect(d.ch.slice(0, 4), `sACN after restart ${i}`).toEqual(vals);
        }
      } finally { tx.close(); }
    }
  });
});
