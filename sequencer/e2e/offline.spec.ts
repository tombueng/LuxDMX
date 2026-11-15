// The built app works without a network once it has been opened (venues often have no internet):
// build, serve the build, let the service worker install, go offline, reload, and it still runs,
// with the shows that were saved in the browser. It keeps itself up to date: a new build is put in
// by itself at a quiet moment, never while something is held or playing. The demos' songs, once
// one is used, are all kept for offline.
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import type { Page } from '@playwright/test';
import { test, expect, startTemplate, selectFixtures, full, welcome, welcomeDialog, demoTile } from './helpers';

const PORT = 5185;
let server: ChildProcess | undefined;
// (a build with its own id: a new id is a new version for the installed app)
const build = (id: string) => execSync('npx vite build --outDir dist-offline-test --emptyOutDir', { stdio: 'ignore', env: { ...process.env, VITE_DEFAULT_DEVICE: '', LUXDMX_BUILD: id, VITE_EXPOSE: '1' } });
// (while the page reloads for an update there's no page to ask: '')
const buildOf = (page: Page) => page.evaluate(() => document.documentElement.dataset.build).catch(() => '');
// opened once, the worker installed and in charge of the page
async function installed(page: Page) {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test.beforeAll(async () => {
  build('test-a');
  // (a process group of its own: npx starts vite as a child, and killing npx alone left vite
  // holding the port, so the next run failed on it)
  server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-offline-test', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 250)); }
});
test.afterAll(() => {
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); } }
  execSync('rm -rf dist-offline-test');
});

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
  await startTemplate(page, 'Church');
  await expect(page.locator('.top .show .name')).toHaveText('Sunday service');
  await page.waitForTimeout(800);                              // saved in the browser

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.top .show .name')).toHaveText('Sunday service');
  await expect(page.locator('.stage-wrap .fx')).toHaveCount(35);         // the Church template's lights
  await context.setOffline(false);
});

test('a new version goes in by itself at a quiet moment, never while something is held; it then starts offline too', async ({ page, context }) => {
  test.setTimeout(240_000);
  // (put in as soon as it's quiet: the app's own wait for nobody at the keys is 90 s)
  await page.addInitScript(() => { (window as any).__luxdmxUpdateIdleMs = 0; });
  build('test-a');
  await installed(page);
  expect(await buildOf(page)).toBe('test-a');
  await page.locator('.top .show').click();
  await startTemplate(page, 'Church');
  // something held: a light at full in the programmer
  await selectFixtures(page, [await page.locator('.stage-wrap .fx').first().getAttribute('data-name') as string]);
  await full(page);
  build('test-b');
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting), { timeout: 60000 }).toBe(true);
  await page.waitForTimeout(17000);                                     // (past the app's next look, 15 s)
  expect(await buildOf(page)).toBe('test-a');                           // (held: it waits)
  // let go: in it goes, the page reloads on the new version and says so
  await page.locator('.prog').getByRole('button', { name: 'Clear', exact: true }).first().click();
  await expect.poll(() => buildOf(page), { timeout: 45000 }).toBe('test-b');
  await expect(page.locator('.toast')).toContainText('Updated to the newest version (test-b)');
  await expect(page.locator('.top .show .name')).toHaveText('Sunday service');
  // and the new version starts without a network
  await page.waitForTimeout(800);
  await context.setOffline(true);
  await page.reload();
  expect(await buildOf(page)).toBe('test-b');
  await expect(page.locator('.stage-wrap .fx')).toHaveCount(35);
  await context.setOffline(false);
});

test('a demo song used: all the demos\' songs are kept, and the templates play their own song offline', async ({ page, context }) => {
  test.setTimeout(240_000);
  // (the artists' own sites aren't asked here: the songs come from this server's copies)
  await context.route((u) => u.hostname !== '127.0.0.1', (r) => r.abort());
  await installed(page);
  const w = await welcome(page), t = demoTile(w, 'Bar');
  await t.getByRole('button', { name: 'Play the show: Bar' }).click();
  await expect(w).toBeHidden({ timeout: 60000 });
  await expect(page.locator('.toast').first()).toContainText(/to ".+" by/, { timeout: 30000 });
  // in the background, every demo's and template's song, kept
  // (the Wedding's own song among them: "Hot Core")
  const kept = () => page.evaluate(async () => { const c = await caches.open('luxdmx-songs'); return { n: (await c.keys()).length, wedding: !!(await c.match(new URL('./offline-songs/hot-core', location.href).href)) }; });
  await expect.poll(kept, { timeout: 150000, intervals: [2000] }).toMatchObject({ wedding: true });
  expect((await kept()).n).toBeGreaterThanOrEqual(8);
  await page.keyboard.press('Space');
  await context.setOffline(true);
  await page.reload();
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).getByRole('button', { name: 'New show…' }).click();
  const w2 = welcomeDialog(page), t2 = demoTile(w2, 'Wedding');
  await t2.getByRole('button', { name: 'Play the show: Wedding' }).click();
  await expect(w2).toBeHidden({ timeout: 60000 });
  await expect(page.locator('.toast').first()).toContainText(/to ".+" by/, { timeout: 30000 });
  await expect(page.locator('.toast').first()).not.toContainText('demo beat');
  await context.setOffline(false);
});
