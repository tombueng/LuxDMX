// Render: the 3D stage as a video drawn frame by frame on the show's own clock (up to 8K at any
// computer's speed). A short render is saved as an MP4 and read back (mediabunny, in Node): its
// size, its frame count at the rate asked for, its sound from the song. The live show goes on
// untouched meanwhile: the box keeps getting the look it had, not the render's. Where the browser
// asks where to save (Chrome, Edge), the file is written straight there.
import type { Page } from '@playwright/test';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import fs from 'node:fs';
import { channels, full, openConnected, patch, resetFake, selectAll, swatch, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });
test.describe.configure({ timeout: 240_000 });

async function open3d(page: Page) {
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d?.venue), { timeout: 15000 }).toBe(true);
}
async function panel(page: Page) {
  const s3 = page.locator('.s3'), p = s3.getByRole('group', { name: 'Render a video' });
  if (!(await p.isVisible())) await s3.getByRole('button', { name: 'Render a video' }).click();
  await expect(p).toBeVisible();
  return p;
}
async function readBack(bytes: Uint8Array) {
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const v = await input.getPrimaryVideoTrack(), a = await input.getPrimaryAudioTrack();
  const stats = await v!.computePacketStats();
  return { w: v!.displayWidth, h: v!.displayHeight, frames: stats.packetCount, codec: v!.codec, sound: a ? { codec: a.codec, secs: await a.computeDuration() } : null, secs: await input.computeDuration() };
}

test('the look as it is, rendered: an MP4 at the size and rate asked for, frame for frame; the box keeps the live look meanwhile', async ({ page }) => {
  // (no save dialog in this browser: the file comes as a download)
  await page.addInitScript(() => { delete (window as any).showSaveFilePicker; });
  await openConnected(page);
  await patch(page, 'gen-drgb', 1, 0, 'PAR');
  await selectAll(page); await full(page); await swatch(page, 'Red');
  await expect.poll(() => channels(0, 4)).toEqual([255, 255, 0, 0]);
  await open3d(page);
  const p = await panel(page);
  await p.getByRole('button', { name: '1080p', exact: true }).click();
  await p.getByLabel('Frames a second').selectOption('25');
  await p.getByLabel('Seconds to render').fill('2');
  await p.getByRole('radio', { name: /The look as it is/ }).check();
  await expect(p).toContainText('0:02 of video');
  // (the render leaves the programmer out: on the box it's still red the whole time)
  let boxChanged = false;
  const watch = setInterval(async () => { try { const c = await channels(0, 4); if (c.join() !== '255,255,0,0') boxChanged = true; } catch { /* between requests */ } }, 150);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 200_000 }), p.getByRole('button', { name: 'Render 1080p' }).click()]);
  clearInterval(watch);
  expect(boxChanged).toBe(false);
  expect(dl.suggestedFilename()).toMatch(/ 3D 1080p \d{4}-\d\d-\d\d \d\d\.\d\d\.mp4$/);
  const file = await readBack(new Uint8Array(fs.readFileSync((await dl.path())!)));
  expect([file.w, file.h]).toEqual([1920, 1080]);
  expect(file.frames).toBe(50);                                   // 2 s at 25 a second
  expect(file.secs).toBeCloseTo(2, 1);
  expect(file.sound).toBeNull();                                  // (the look: no song)
  await expect(page.locator('.toast')).toContainText(/Saved ".* 3D 1080p .*\.mp4" \(1080p, 25 frames a second, 0:02/);
  // and the stage is back on the live show, at its own size
  expect(await page.evaluate(() => (window as any).__stage3d.rendering())).toBeNull();
  await expect.poll(() => page.evaluate(() => { const c = document.querySelector('.s3 canvas') as HTMLCanvasElement; return c.width !== 1920 || c.height !== 1080; })).toBe(true);
});

test('the song from the playhead, with its sound, straight into the file the browser asked for; Stop stops a render and saves nothing', async ({ page }) => {
  // a save dialog that hands back a file (the bytes land here, in the page)
  await page.addInitScript(() => {
    (window as any).__saved = null;
    (window as any).showSaveFilePicker = async (o: { suggestedName: string }) => ({
      name: o.suggestedName,
      createWritable: async () => {
        const parts: { at: number; data: Uint8Array }[] = [];
        return new WritableStream({
          write(c: { data: Uint8Array; position: number }) { parts.push({ at: c.position, data: c.data.slice() }); },
          close() {
            const size = Math.max(...parts.map((p) => p.at + p.data.length)), out = new Uint8Array(size);
            for (const p of parts) out.set(p.data, p.at);
            (window as any).__saved = { name: o.suggestedName, bytes: Array.from(out) };
          },
        });
      },
    });
  });
  await openConnected(page);
  await patch(page, 'gen-drgb', 1, 0, 'PAR');
  await page.evaluate(async () => { const a = (window as any).__luxdmx; a.timeline.useDemo(); await a.timeline.prepare(); a.timeline.seek(a.timeline.end - 1.2); });
  await open3d(page);
  const p = await panel(page);
  await p.getByRole('button', { name: '1080p', exact: true }).click();
  await p.getByLabel('Frames a second').selectOption('30');
  await p.getByRole('radio', { name: /The song, from the playhead/ }).check();
  await p.getByRole('button', { name: 'Render 1080p' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__saved?.name ?? ''), { timeout: 200_000 }).toMatch(/ 3D 1080p .*\.mp4$/);
  const bytes = new Uint8Array(await page.evaluate(() => (window as any).__saved.bytes));
  const file = await readBack(bytes);
  expect([file.w, file.h]).toEqual([1920, 1080]);
  expect(file.frames).toBe(36);                                   // 1.2 s at 30
  expect(file.sound).not.toBeNull();                              // the demo beat
  expect(file.sound!.secs).toBeCloseTo(1.2, 1);
  // Stop: a long one stopped part way, nothing saved
  await page.evaluate(() => { (window as any).__saved = null; });
  const p2 = await panel(page);
  await p2.getByRole('radio', { name: /The look as it is/ }).check();
  await p2.getByLabel('Seconds to render').fill('600');
  await p2.getByRole('button', { name: 'Render 1080p' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__stage3d.rendering()?.k ?? 0), { timeout: 60_000 }).toBeGreaterThan(3);
  await page.locator('.s3').getByRole('button', { name: 'Stop rendering' }).click();
  await expect(page.locator('.toast')).toContainText('Render stopped. Nothing saved.');
  expect(await page.evaluate(() => (window as any).__saved)).toBeNull();
  expect(await page.evaluate(() => (window as any).__stage3d.rendering())).toBeNull();
});

test('8K on a graphics card too small for it says so, and renders nothing', async ({ page }) => {
  await page.addInitScript(() => {
    const real = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (p: number) {
      if (p === this.MAX_RENDERBUFFER_SIZE || p === this.MAX_TEXTURE_SIZE) return 4096;
      if (p === this.MAX_VIEWPORT_DIMS) return new Int32Array([4096, 4096]);
      return real.call(this, p);
    };
  });
  await openConnected(page);
  await open3d(page);
  const p = await panel(page);
  await p.getByRole('button', { name: '8K', exact: true }).click();
  await p.getByRole('button', { name: 'Render 8K' }).click();
  await expect(page.locator('.toast')).toContainText('This graphics card draws at most 4096 pixels across, 8K needs 7680');
  expect(await page.evaluate(() => (window as any).__stage3d.rendering())).toBeNull();
});

// (4K for real: 25 frames at 3840 x 2160, slow in the test browser's software drawing; 8K the
// same path at twice the size: here only that the browser has a codec for it, a whole 8K render in
// software would take a quarter of an hour)
test('4K rendered for real; and there is a codec for 8K', async ({ page }) => {
  test.setTimeout(600_000);
  await page.addInitScript(() => { delete (window as any).showSaveFilePicker; });
  await openConnected(page);
  await patch(page, 'gen-mover8', 2, 0, 'Head');
  await selectAll(page); await full(page);
  const k8 = await page.evaluate(async () => {
    const mb = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    return mb.getFirstEncodableVideoCodec(['avc', 'hevc', 'av1', 'vp9'], { width: 7680, height: 4320, bitrate: 139e6, frameRate: 30 });
  });
  expect(['avc', 'hevc', 'av1', 'vp9']).toContain(k8);
  await open3d(page);
  const p = await panel(page);
  await p.getByRole('button', { name: '4K', exact: true }).click();
  await p.getByLabel('Frames a second').selectOption('25');
  await p.getByRole('radio', { name: /The look as it is/ }).check();
  await p.getByLabel('Seconds to render').fill('1');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 590_000 }), p.getByRole('button', { name: 'Render 4K' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/ 3D 4K .*\.mp4$/);
  const file = await readBack(new Uint8Array(fs.readFileSync((await dl.path())!)));
  expect([file.w, file.h, file.frames]).toEqual([3840, 2160, 25]);
});
