// Playwright config for the LuxDMX web-UI / API test suite.
//
// Tests run against a *live device* (the same one screenshot.mjs drives).
// Resolve order: LUXDMX_URL > mDNS lookup of LUXDMX_HOST > fallback IP.
// Headless Chromium can't resolve *.local itself, so we resolve to an IP here.
import { defineConfig } from '@playwright/test';
import dns from 'dns/promises';

const FALLBACK_IP = '192.168.178.197';

async function resolveBase() {
  if (process.env.LUXDMX_URL) return process.env.LUXDMX_URL;
  const host = process.env.LUXDMX_HOST || 'dmx-gateway.local';
  try {
    const { address } = await dns.lookup(host, { family: 4 });
    return 'http://' + address;
  } catch {
    return 'http://' + FALLBACK_IP;
  }
}

const baseURL = await resolveBase();
console.log('LuxDMX test target:', baseURL);

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,          // one device, keep requests serial
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // The mutating tests reboot the device; a following test can briefly hit it
  // mid-reboot (ECONNRESET / WS not-yet-up). Retry so a transient reboot-window
  // blip re-runs after the device has recovered, rather than failing the suite.
  retries: 2,
  reporter: [['list']],
  use: {
    baseURL,
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
});
