// QLC+ workspaces through the UI: open one from the show manager (fixtures from the QLC+ library,
// served offline from test/fixtures), play an imported scene and chaser on the box, save for QLC+.
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import { openConnected, resetFake, channels, test, expect } from './helpers';

async function offlineQlc(page: Page) {
  await page.route('https://raw.githubusercontent.com/mcallegari/qlcplus/**', (r) => {
    const f = `test/fixtures/qxf/${decodeURIComponent(r.request().url().split('/').pop()!)}`;
    return fs.existsSync(f) ? r.fulfill({ path: f, contentType: 'text/xml' }) : r.fulfill({ status: 404 });
  });
}

test.beforeEach(async ({ page }) => { await resetFake(); await offlineQlc(page); });

test('open a QLC+ workspace, play it, save it for QLC+ again', async ({ page }, info) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  const m = page.getByRole('dialog', { name: 'Shows' });
  await m.locator('input[type=file]').setInputFiles('test/fixtures/qxw/sample.qxw');
  await expect(page.locator('.toast')).toContainText('QLC+ workspace: 4 fixtures (2 from the library, 1 as raw channels), 2 scenes, 3 chasers, 1 EFX');
  await expect(page.locator('.toast')).toContainText('Not imported: 1 RGB matrices');
  await expect(page.locator('.top .show .name')).toHaveText('sample');
  await expect(page.locator('.stage-wrap .fx')).toHaveCount(7);          // 4 dimmers, PAR, mystery box, Sharpy

  // the "Warm" scene: dimmers 1-2 and the PAR at 11-14
  await page.locator('.deck .tab', { hasText: 'Scenes' }).click();
  await page.locator('.deck .card').first().dblclick();
  await expect.poll(async () => { const c = await channels(0, 14); return [c[0], c[1], ...c.slice(10, 14)]; }, { timeout: 5000 }).toEqual([255, 128, 255, 128, 0, 64]);

  // save for QLC+: a workspace with the same fixtures
  await page.locator('.top .show').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), m.getByRole('button', { name: /Save for QLC\+/ }).click()]);
  const file = info.outputPath('sample.qxw');
  await dl.saveAs(file);
  const xml = fs.readFileSync(file, 'utf8');
  expect(xml).toContain('<Workspace xmlns="http://www.qlcplus.org/Workspace"');
  expect(xml).toContain('<Model>LED PAR 36 COB RGBW 12W</Model>');
  expect(xml.match(/<Manufacturer>/g)).toHaveLength(7);              // seven fixtures (the EFX lists its own <Fixture> too)
  expect(xml).toContain('Type="Chaser" Name="Warm blue chase"');
});
