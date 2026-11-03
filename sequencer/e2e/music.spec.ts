// Follow the music, with a kick drum at 120 BPM as a fake microphone (Chrome plays the file in a
// loop): the tempo shows up in the top bar and tempo effects run at it.
import path from 'node:path';
import { openConnected, resetFake, test, expect, channels, patch, selectAll } from './helpers';

test.use({
  launchOptions: {
    executablePath: process.env.CHROME || `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.resolve('test/fixtures/audio/kick-120.wav')}`, '--autoplay-policy=no-user-gesture-required'],
  },
});

test.beforeEach(async () => { await resetFake(); });

test('the microphone hears 120 BPM and the show follows it', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await openConnected(page);
  await page.locator('.top input[aria-label="BPM"]').fill('90');
  const btn = page.locator('.top').getByRole('button', { name: 'Follow the music' });
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await btn.locator('b').textContent()), { timeout: 15000 }).toBeGreaterThan(116);
  expect(Number(await btn.locator('b').textContent())).toBeLessThan(124);
  expect(await page.evaluate(() => (window as any).__luxdmx.bpm)).toBeGreaterThan(116);
  // the field shows the tempo everything runs at (the music's), the show's own stays saved
  await expect(page.locator('.top input[aria-label="BPM"]')).toHaveClass(/frommusic/);
  expect(Number(await page.locator('.top input[aria-label="BPM"]').inputValue())).toBeGreaterThan(116);
  expect(await page.evaluate(() => (window as any).__luxdmx.show.settings.bpm)).toBe(90);
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => (window as any).__luxdmx.bpm)).toBe(90);
  await expect(page.locator('.top input[aria-label="BPM"]')).toHaveValue('90');
});

test('a VU meter on a pixel bar moves with the music', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await openConnected(page);
  await patch(page, 'gen-bar8', 1, 0, 'Bar');
  await selectAll(page);
  await page.locator('.top').getByRole('button', { name: 'Follow the music' }).click();
  await page.locator('.side .tabs').getByRole('tab', { name: 'Effects' }).click();
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add an effect' }).locator('[data-effect="vu"]').click();
  // sample how many of the 8 cells are lit (red channel of each cell) for 3 s: it has to change
  const lit = new Set<number>();
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    const c = await channels(0, 24);
    lit.add([0, 1, 2, 3, 4, 5, 6, 7].filter((i) => c[i * 3] > 127).length);
    await page.waitForTimeout(60);
  }
  expect(lit.size).toBeGreaterThan(2);
});
