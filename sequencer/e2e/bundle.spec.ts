// A show with its songs for another computer: "Save with its songs" writes a .zip with the show and
// the audio of its own songs; opened in a browser that never saw them (a second laptop: a fresh
// browser context), the song plays there, nothing to find again. A plain "Save as file" says the
// songs stay behind.
import fs from 'node:fs';
import { fresh, openConnected, resetFake, test, expect, startTemplate } from './helpers';

test.beforeEach(async () => { await resetFake(); });

const RATE = 8000;
function wav(seconds = 6) {
  const n = seconds * RATE, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 3) * (i % RATE < 400 ? 20000 : 2000)), 44 + i * 2);
  return b;
}

test('"Save with its songs" takes the song along: opened in a browser that never had it, it plays there', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await openConnected(page);
  await page.locator('.top .show').click();
  await startTemplate(page, 'Bar');
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  await page.locator('.tlv .song input[type=file]').setInputFiles({ name: 'Our song.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.timeline?.audio?.store ?? ''), { timeout: 20000 }).toContain('Our song.wav');
  // the plain file: it says the song stays behind
  await page.locator('.top .show').click();
  const m = page.getByRole('dialog', { name: 'Shows' });
  const [plain] = await Promise.all([page.waitForEvent('download'), m.getByRole('button', { name: 'Save as file' }).click()]);
  expect(plain.suggestedFilename()).toMatch(/\.luxdmx\.json$/);
  await expect(page.locator('.toast')).toContainText('Its song (the audio) stays in this browser: "Save with its songs" takes it along.');
  // with its songs: one .zip
  const [dl] = await Promise.all([page.waitForEvent('download'), m.getByRole('button', { name: 'Save with its songs' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.luxdmx\.zip$/);
  await expect(page.locator('.toast')).toContainText('with 1 song in it');
  const zip = (await dl.path())!;
  expect(fs.statSync(zip).size).toBeGreaterThan(wav().length);

  // the second laptop: a browser that has never seen the song
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const other = await ctx.newPage();
  await fresh(other);
  await other.locator('.top .show').click();
  await other.getByRole('dialog', { name: 'Shows' }).locator('input[type=file]').setInputFiles(zip);
  await expect(other.locator('.top .show .name')).toContainText('Bar');
  await other.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  await expect(other.locator('.tlv')).toBeVisible();
  // (the song is there: no "isn't in this browser", its waveform drawn from the audio)
  await expect.poll(() => other.evaluate(() => { const P = (window as any).__luxdmx.timeline; return { missing: P.missing, peaks: P.peaks.length > 0 }; }), { timeout: 20000 }).toEqual({ missing: '', peaks: true });
  await expect(other.locator('.tlv .err')).toHaveCount(0);
  await ctx.close();
});
