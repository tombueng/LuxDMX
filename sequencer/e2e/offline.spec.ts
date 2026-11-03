// The built app works without a network once it has been opened (venues often have no internet):
// build, serve the build, let the service worker install, go offline, reload, and it still runs,
// with the shows that were saved in the browser.
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { test, expect } from './helpers';

const PORT = 5185;
let server: ChildProcess | undefined;

test.beforeAll(async () => {
  execSync('npx vite build --outDir dist-offline-test --emptyOutDir', { stdio: 'ignore', env: { ...process.env, VITE_DEFAULT_DEVICE: '' } });
  server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-offline-test', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 250)); }
});
test.afterAll(() => { server?.kill(); execSync('rm -rf dist-offline-test'); });

test('installable, and it starts offline with the saved show', async ({ page, context }) => {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  const manifest = await (await fetch(`http://127.0.0.1:${PORT}/manifest.webmanifest`)).json();
  expect(manifest.name).toBe('LuxDMX Sequencer');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();                                         // now the worker controls the page and caches what it loads
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForTimeout(500);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Church' }).click();
  await expect(page.locator('.top .show .name')).toHaveText('Sunday service');
  await page.waitForTimeout(800);                              // saved in the browser

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.top .show .name')).toHaveText('Sunday service');
  await expect(page.locator('.stage-wrap .fx')).toHaveCount(35);         // the Church template's lights
  await context.setOffline(false);
});
