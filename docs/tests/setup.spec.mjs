// First-run setup portal (issue #45). Unlike the other specs, this one does NOT need a
// live device: it boots the local UI simulator (sim/server.js) on a throwaway port and
// drives the real src/pages/setup.html through both paths (access-point + join-WiFi).
//
//   cd docs && npx playwright test tests/setup.spec.mjs
//
// The sim serves /setup (the page), /setup/scan (a couple of fake SSIDs) and accepts the
// POST /setup, echoing the form fields back so we can assert what the page submitted.
import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');            // docs/tests -> repo root
const simEntry = path.join(repo, 'sim', 'server.js');
const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;

let sim;

// `/sim/` is gitignored (it carries the video pipeline and is kept in the private ops repo),
// so it is missing in a fresh worktree and on CI, and a checkout can be sitting on a copy
// that predates the setup portal and serves no /setup at all. Either way that is a missing
// harness, not a broken portal, so say so and skip -- red tests that mean "your environment
// is stale" train people to ignore red tests.
let simWhy = fs.existsSync(simEntry) ? null : 'sim/server.js not present (it is gitignored, see the private ops repo)';

test.beforeAll(async () => {
  if (simWhy) return;
  const simErr = [];
  sim = spawn(process.execPath, [simEntry, String(PORT)], { cwd: repo, stdio: 'pipe' });
  sim.stderr.on('data', (b) => simErr.push(String(b)));
  // wait until the sim answers /setup
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      const r = await fetch(BASE + '/setup');
      if (r.ok) break;
      if (r.status === 404) { simWhy = 'this sim/server.js is older than the setup portal (no /setup route)'; break; }
    } catch { /* not up yet */ }
    if (Date.now() > deadline) {
      simWhy = 'sim did not start: ' + (simErr.join('').trim().split('\n')[0] || 'no output');
      break;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (simWhy && sim) { sim.kill(); sim = null; }
});

test.beforeEach(() => { test.skip(!!simWhy, simWhy || ''); });

test.afterAll(() => { if (sim) sim.kill(); });

// These tests talk to the sim directly, not the global baseURL device.
test.use({ baseURL: BASE });

test.describe('first-run setup portal', () => {
  test('landing shows both choices on brand', async ({ page }) => {
    await page.goto(BASE + '/setup');
    await expect(page).toHaveTitle(/LuxDMX/i);
    await expect(page.locator('.brand-text')).toHaveText('LuxDMX');
    await expect(page.locator('#go-sta')).toBeVisible();
    await expect(page.locator('#go-ap')).toBeVisible();
    await expect(page.locator('#go-sta')).toContainText('Join my WiFi');
    await expect(page.locator('#go-ap')).toContainText('Use as access point');
    // both detail forms start hidden
    await expect(page.locator('#step-sta')).toBeHidden();
    await expect(page.locator('#step-ap')).toBeHidden();
  });

  test('access-point path posts mode=ap with the AP password', async ({ page }) => {
    await page.goto(BASE + '/setup');
    await page.locator('#go-ap').click();
    await expect(page.locator('#step-ap')).toBeVisible();
    await expect(page.locator('#step-landing')).toBeHidden();
    await page.locator('#ap-pw').fill('showtime123');

    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/setup') && r.method() === 'POST'),
      page.locator('#form-ap button[type=submit]').click(),
    ]);
    const body = req.postData() || '';
    const p = new URLSearchParams(body);
    expect(p.get('mode')).toBe('ap');
    expect(p.get('appw')).toBe('showtime123');
  });

  test('join path: pick a scanned SSID, post mode=sta with ssid + password', async ({ page }) => {
    await page.goto(BASE + '/setup');
    await page.locator('#go-sta').click();
    await expect(page.locator('#step-sta')).toBeVisible();

    // the scan list fills from /setup/scan
    const items = page.locator('#net-list .net-item');
    await expect(items.first()).toBeVisible({ timeout: 5000 });
    await expect(items).toHaveCount(3);

    // clicking a network fills the SSID field
    await page.locator('#net-list .net-item', { hasText: 'GreenRoom' }).click();
    await expect(page.locator('#sta-ssid')).toHaveValue('GreenRoom');
    await page.locator('#sta-pw').fill('hunter2pass');

    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/setup') && r.method() === 'POST'),
      page.locator('#form-sta button[type=submit]').click(),
    ]);
    const p = new URLSearchParams(req.postData() || '');
    expect(p.get('mode')).toBe('sta');
    expect(p.get('ssid')).toBe('GreenRoom');
    expect(p.get('pw')).toBe('hunter2pass');
  });

  test('manual SSID entry works without picking from the list', async ({ page }) => {
    await page.goto(BASE + '/setup');
    await page.locator('#go-sta').click();
    await page.locator('#sta-ssid').fill('Hidden-Net');
    await page.locator('#sta-pw').fill('opensesame');

    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/setup') && r.method() === 'POST'),
      page.locator('#form-sta button[type=submit]').click(),
    ]);
    const p = new URLSearchParams(req.postData() || '');
    expect(p.get('mode')).toBe('sta');
    expect(p.get('ssid')).toBe('Hidden-Net');
  });
});
