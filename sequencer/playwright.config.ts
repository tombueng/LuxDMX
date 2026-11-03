import { defineConfig } from '@playwright/test';

// e2e against the dev server and a fake LuxDMX (test/fake-luxdmx.mjs), so it runs anywhere.
// LUXDMX_HOST=<box> additionally points the hardware tests (*.hw.spec.ts) at a real box.
// PW_PORT / FAKE_PORT: other ports for the dev server and the fake box, so two runs at once
// (two people, two checkouts) don't share one fake box.
const PORT = Number(process.env.PW_PORT ?? 5174), FAKE = Number(process.env.FAKE_PORT ?? 8199);
export default defineConfig({
  testDir: 'e2e',
  // (a run on other ports keeps its own results: two runs at once don't overwrite each other's)
  outputDir: process.env.PW_PORT ? `test-results/${PORT}` : 'test-results/main',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    viewport: { width: 1400, height: 900 },
    launchOptions: {
      executablePath: process.env.CHROME ||
        `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`,
    },
  },
  webServer: [
    // No default box in tests: they connect to the fake one themselves.
    { command: `VITE_DEFAULT_DEVICE= VITE_CACHE_DIR=node_modules/.vite-${PORT} npx vite --host 127.0.0.1 --port ${PORT} --strictPort`, url: `http://127.0.0.1:${PORT}/`, reuseExistingServer: true },
    { command: `node test/fake-luxdmx.mjs ${FAKE} 0,1`, url: `http://127.0.0.1:${FAKE}/info.json`, reuseExistingServer: true },
  ],
});
