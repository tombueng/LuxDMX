// Recording the 3D stage: Record in the 3D toolbar, the red REC chip counts, Stop downloads a video
// named after the show (MP4 where the browser makes H.264/AAC, else WebM) with the song in it; a
// 1080p take draws at 1920 x 1080 and goes back after; closing the 3D view saves the take; a
// browser without MediaRecorder says so.
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openConnected, resetFake, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });
// (the 3D stage draws in software in the test browser: slow when the machine is busy)
test.describe.configure({ timeout: 150_000 });

// the Bar template on the timeline, the demo beat playing, the timeline's picture in 3D
async function playing(page: Page) {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  // (the demo beat straight from the player: picking songs is the timeline's own test)
  await page.evaluate(() => (window as any).__luxdmx.timeline.useDemo());
  await page.locator('.transport').getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.position), { timeout: 8000 }).toBeGreaterThan(0.2);
  await page.locator('.tlv .preview').getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45_000 });      // (three.js loads first)
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d), { timeout: 15000 }).toBe(true);
}
// the size choice: in the toolbar on a wide stage, in More (⋯) otherwise
async function videoSize(page: Page, v: '1080p' | 'shown') {
  const s3 = page.locator('.s3');
  if (!(await s3.getByLabel('Video size').isVisible())) await s3.getByRole('button', { name: 'More', exact: true }).click();
  await s3.getByLabel('Video size').selectOption(v);
  await page.keyboard.press('Escape');
}
// the seconds on the REC chip
const recorded = (page: Page) => page.locator('.s3 .rec').textContent().then((t) => { const m = /REC (\d+):(\d\d)/.exec(t ?? ''); return m ? +m[1] * 60 + +m[2] : -1; });
const canvasSize = (page: Page) => page.evaluate(() => { const c = document.querySelector('.s3 canvas') as HTMLCanvasElement; return { w: c.width, h: c.height }; });
// what this browser should make (the same order as recorder.ts)
const expectedExt = (page: Page) => page.evaluate(() => (['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4d0028,mp4a.40.2', 'video/mp4;codecs=avc1.42e028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2']
  .some((t) => MediaRecorder.isTypeSupported(t)) ? 'mp4' : 'webm'));

test('Record: a 2 s take with the demo beat downloads as a video with its sound, then the stage is back to its size', async ({ page }) => {
  await playing(page);
  const s3 = page.locator('.s3');
  await videoSize(page, '1080p');
  const before = await canvasSize(page);
  await s3.getByRole('button', { name: 'Record a video' }).click();
  // the REC chip with the time; the picture is drawn at 1920 x 1080 for the take
  await expect(s3.locator('.rec')).toContainText(/REC \d+:\d\d/);
  expect(await canvasSize(page)).toEqual({ w: 1920, h: 1080 });
  await expect.poll(() => recorded(page), { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  const [dl] = await Promise.all([page.waitForEvent('download'), s3.getByRole('button', { name: 'Stop and save the video' }).click()]);
  const ext = await expectedExt(page);
  expect(dl.suggestedFilename()).toMatch(new RegExp(`^Bar 3D \\d{4}-\\d\\d-\\d\\d \\d\\d\\.\\d\\d\\.${ext}$`));
  const file = await readFile((await dl.path())!);
  expect(file.length).toBeGreaterThan(5000);
  // a real container, and the sound is in it (Opus in WebM, AAC or Opus in MP4)
  if (ext === 'webm') {
    expect(file.subarray(0, 4).toString('hex')).toBe('1a45dfa3'); expect(file.includes('A_OPUS')).toBe(true);
    // with its length in the header (Chrome leaves it out): Duration, a 64-bit float of ms
    const at = file.subarray(0, 256).indexOf(Buffer.from([0x44, 0x89, 0x88]));
    expect(at).toBeGreaterThan(0);
    const ms = file.readDoubleBE(at + 3);
    expect(ms).toBeGreaterThan(1900); expect(ms).toBeLessThan(120_000);
  }
  else { expect(file.subarray(4, 8).toString()).toBe('ftyp'); expect(file.includes('mp4a') || file.includes('Opus')).toBe(true); }
  // and it's the beat, not silence: the browser decodes the file's sound again
  const sound = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const buf = await new OfflineAudioContext(1, 48000, 48000).decodeAudioData(bytes.buffer);
    let peak = 0; for (const v of buf.getChannelData(0)) peak = Math.max(peak, Math.abs(v));
    return { secs: buf.duration, peak };
  }, file.toString('base64'));
  expect(sound.secs).toBeGreaterThan(1.5);
  expect(sound.peak).toBeGreaterThan(0.05);
  await expect(page.locator('.toast')).toContainText(`Saved "${dl.suggestedFilename()}"`);
  // Record is back, the picture is the window's size again, the stage still draws
  await expect(s3.getByRole('button', { name: 'Record a video' })).toBeVisible();
  await expect(s3.locator('.rec')).toHaveCount(0);
  await expect.poll(() => canvasSize(page)).toEqual(before);
  const finite = await page.evaluate(() => (window as any).__stage3d.hdr(160));
  expect(finite.nan).toBe(0);
});

test('As shown: the take is the size on the screen (even numbers), and closing the 3D view saves it', async ({ page }) => {
  await playing(page);
  const s3 = page.locator('.s3');
  await videoSize(page, 'shown');
  const before = await canvasSize(page);
  await s3.getByRole('button', { name: 'Record a video' }).click();
  await expect(s3.locator('.rec')).toBeVisible();
  const during = await canvasSize(page);
  expect(during.w % 2).toBe(0); expect(during.h % 2).toBe(0);
  expect(Math.abs(during.w - before.w)).toBeLessThanOrEqual(1); expect(Math.abs(during.h - before.h)).toBeLessThanOrEqual(1);
  await expect.poll(() => recorded(page), { timeout: 8000 }).toBeGreaterThanOrEqual(1);
  // back to 2D with the take running: it ends and the file comes anyway
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.tlv .preview').getByRole('button', { name: '2D' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^Bar 3D .+\.(webm|mp4)$/);
  expect((await readFile((await dl.path())!)).length).toBeGreaterThan(2000);
  await expect(page.locator('.s3')).toHaveCount(0);
  // the size choice stays with the browser
  expect(await page.evaluate(() => localStorage.getItem('luxdmx.seq.video3d'))).toBe('shown');
});

test('a browser that can\'t record says so instead of failing', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).MediaRecorder; });
  await playing(page);
  await page.locator('.s3').getByRole('button', { name: 'Record a video' }).click();
  await expect(page.locator('.toast')).toContainText('can\'t record video here');
  await expect(page.locator('.s3 .rec')).toHaveCount(0);
});

// Before any song has played (or with it paused) the take still gets its frames: the sound track
// runs silent instead of waiting for sound that never comes (that used to give an empty file).
test('Record with no song playing: the video still comes out, with a silent sound track', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  await page.locator('.tlv .preview').getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d), { timeout: 15000 }).toBe(true);
  const s3 = page.locator('.s3');
  await videoSize(page, 'shown');
  await s3.getByRole('button', { name: 'Record a video' }).click();
  await expect.poll(() => recorded(page), { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  const [dl] = await Promise.all([page.waitForEvent('download'), s3.getByRole('button', { name: 'Stop and save the video' }).click()]);
  const file = await readFile((await dl.path())!);
  expect(file.length).toBeGreaterThan(5000);
  await expect(page.locator('.toast')).not.toContainText('Nothing was recorded');
});
