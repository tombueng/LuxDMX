// Screen timeout for the status display (issue #134). OLEDs burn in, so the panel goes dark after
// `disptimeout` seconds without a button/encoder input (default 20, 0 = always on). A config save
// also lights it and restarts the countdown. Incoming DMX does NOT wake it: a show runs for hours
// and keeping the panel lit for that is exactly what burns it in.
//
// Shape + UI tests are read-only. The behavioural tests (LUXDMX_WRITE=1) change the timeout through
// the real /config form, and restore the original value afterwards. The dark/wake part needs a panel
// that actually came up (/info.json dispReady) and skips itself on a board without one.
//
// Not covered here: "the first button press only wakes the panel". That needs a finger (or a GPIO
// driver) on the encoder/button pins, which this suite has no way to press. The firmware side of it
// is the `dark` check in controlsTask.
import { test, expect } from '@playwright/test';
import {
  deviceHost, UdpSender, streamFor, artDmxPacket, e131Packet, prepInput, sleep,
  ART_PORT, SACN_PORT,
} from './lib/net.mjs';
import { info, dmx, pollFor, universes } from './lib/device.mjs';
import { expandAll } from './lib/ui.mjs';

const WRITE = process.env.LUXDMX_WRITE === '1';
function skipUnlessWrite() {
  test.skip(!WRITE, 'device-mutating: set LUXDMX_WRITE=1 to run');
}

// Uptime as seconds. A restart shows up as this going DOWN.
async function uptimeSec(request) {
  const m = /(\d+)d (\d+):(\d+):(\d+)/.exec((await dmx(request)).up);
  if (!m) return 0;
  return +m[1] * 86400 + +m[2] * 3600 + +m[3] * 60 + +m[4];
}

// Open /config, make sure it shows THIS device's settings (never save placeholders), set the
// timeout and save. The field sits in the display card, which is hidden when no display type is
// selected, so a board without a panel gets the value set directly on the (real, named) input.
async function saveTimeout(page, request, seconds) {
  const want = await info(request);
  await page.goto('/config', { waitUntil: 'networkidle' });
  await expandAll(page);
  await expect
    .poll(async () => page.locator('input.out-uni').first().inputValue(), { timeout: 15_000 })
    .toBe(String(want.outputs[0].uni));
  expect(await page.locator('#dev-host').inputValue(), 'config page shows placeholders').toBe(want.hostname);
  const field = page.locator('#disp-timeout');
  if (await field.isVisible()) await field.fill(String(seconds));
  else await field.evaluate((el, v) => { el.value = v; }, String(seconds));
  await page.click('#save-btn');
  await page.waitForTimeout(2500);
  await expect(page.locator('#app-modal.show'), 'a timeout change must not need a restart').toHaveCount(0);
}

test.describe('Display screen timeout (issue #134)', () => {
  test('/info.json reports the timeout and the panel state', async ({ request }) => {
    const d = await info(request);
    expect(Number.isInteger(d.dispTimeout), 'dispTimeout is an integer').toBe(true);
    expect(d.dispTimeout).toBeGreaterThanOrEqual(0);
    expect(d.dispTimeout).toBeLessThanOrEqual(86400);
    expect(typeof d.dispReady).toBe('boolean');
    expect(typeof d.dispOn).toBe('boolean');
    if (!d.dispReady) expect(d.dispOn, 'no panel, so it cannot be lit').toBe(false);
  });

  test('/config shows the timeout field with the device value', async ({ page, request }) => {
    const d = await info(request);
    await page.goto('/config', { waitUntil: 'networkidle' });
    const f = page.locator('#disp-timeout');
    await expect(f).toHaveAttribute('name', 'disptimeout');
    await expect(f).toHaveAttribute('min', '0');
    await expect(f).toHaveAttribute('max', '86400');
    await expect.poll(() => f.inputValue(), { timeout: 10_000 }).toBe(String(d.dispTimeout));
  });

  test('changing the timeout is live, no restart', async ({ page, request }) => {
    skipUnlessWrite();
    test.setTimeout(90_000);
    const orig = (await info(request)).dispTimeout;
    const next = orig === 45 ? 46 : 45;
    const up0 = await uptimeSec(request);
    try {
      await saveTimeout(page, request, next);
      expect((await info(request)).dispTimeout, 'the new value stuck').toBe(next);
      const up1 = await uptimeSec(request);
      expect(up1, `uptime ${up0} -> ${up1}, so the device restarted`).toBeGreaterThanOrEqual(up0);
    } finally {
      await saveTimeout(page, request, orig);
    }
    expect((await info(request)).dispTimeout).toBe(orig);
  });

  test('panel goes dark after the timeout, DMX does not wake it, a save does', async ({ page, request }) => {
    skipUnlessWrite();
    test.setTimeout(120_000);
    const start = await info(request);
    test.skip(!start.dispReady, 'no display panel came up on this device (dispReady=false)');
    const orig = start.dispTimeout;
    const host = await deviceHost();
    const { art, sacn } = await universes(request);
    const sender = new UdpSender(host);
    try {
      // A save wakes the panel and restarts the countdown, so it is lit right after this.
      // 6 s: saveTimeout itself waits 2.5 s after the click, so this leaves a clear lit window.
      await saveTimeout(page, request, 6);
      const t0 = Date.now();
      expect((await info(request)).dispOn, 'a save lights the panel').toBe(true);

      const dark = await pollFor(() => info(request), (d) => d.dispOn === false, { ms: 10_000, every: 200 });
      expect(dark.dispOn, 'panel went dark after the timeout').toBe(false);
      expect(Date.now() - t0, 'went dark too early').toBeGreaterThan(1500);

      // Incoming DMX on both protocols: still routed, panel stays dark.
      await prepInput(host);
      const protos = [];
      if (start.protocol !== 1) protos.push(['artnet', ART_PORT, (i, d) => artDmxPacket(art, d, i), 211]);
      if (start.protocol !== 0) protos.push(['sacn', SACN_PORT, (i, d) => e131Packet(sacn, d, i), 123]);
      for (const [proto, port, make, val] of protos) {
        const data = Buffer.alloc(512); data[0] = val;
        const streaming = streamFor(sender, port, (i) => make(i, data), { ms: 2500 });
        const got = await pollFor(() => dmx(request), (x) => x.ch[0] === val, { ms: 6000 });
        await streaming;
        expect(got.ch[0], `${proto}: DMX still flows with the panel dark`).toBe(val);
        expect((await info(request)).dispOn, `${proto}: input must not wake the panel`).toBe(false);
      }

      // 0 = never off. Saving it lights the panel and it stays lit.
      await saveTimeout(page, request, 0);
      expect((await info(request)).dispOn, 'save woke the panel').toBe(true);
      await sleep(5000);
      expect((await info(request)).dispOn, 'timeout 0 keeps it on').toBe(true);
    } finally {
      sender.close();
      await saveTimeout(page, request, orig);
    }
    expect((await info(request)).dispTimeout).toBe(orig);
  });
});
