// The 3D stage as a video to show people: the band's name on the banners, screens and kick drum
// (painted again in place: the venue isn't built again), a small club / pub instead of the big
// stage (a few dozen people, the lights on its low rig, kept with the show), a 9:16 take for phones
// (1080 x 1920 while it runs, a lens wide enough for the band), a choppy take says so at Stop, a
// browser that only makes WebM says so next to Record, and a take that survives the window
// getting narrower. Read through the dev hook window.__stage3d, not off the pixels.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });
// (the 3D stage draws in software in the test browser: slow when the machine is busy)
test.describe.configure({ timeout: 150_000 });

async function open3d(page: Page) {
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await ready3d(page);
}
async function ready3d(page: Page) {
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 45_000 });      // (three.js loads first)
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d?.venue), { timeout: 15000 }).toBe(true);
}
const venue = (page: Page) => page.evaluate(() => (window as any).__stage3d.venue());
// the venue panel: from its button in the toolbar, or from More (⋯) on a small 3D view
async function venuePanel(page: Page) {
  const s3 = page.locator('.s3'), panel = s3.getByRole('group', { name: 'The venue' });
  if (await panel.isVisible()) return panel;
  const btn = s3.getByRole('button', { name: 'Venue', exact: true });
  if (await btn.isVisible()) await btn.click();
  else { await s3.getByRole('button', { name: 'More', exact: true }).click(); await s3.getByRole('button', { name: 'Venue…' }).click(); }
  await expect(panel).toBeVisible();
  return panel;
}
// the size choice: in the toolbar on a wide stage, in More (⋯) otherwise
async function videoSize(page: Page, v: '1080p' | 'vertical' | 'shown') {
  const s3 = page.locator('.s3');
  if (!(await s3.getByLabel('Video size').isVisible())) await s3.getByRole('button', { name: 'More', exact: true }).click();
  await s3.getByLabel('Video size').selectOption(v);
  await page.keyboard.press('Escape');
}
const canvasSize = (page: Page) => page.evaluate(() => { const c = document.querySelector('.s3 canvas') as HTMLCanvasElement; return { w: c.width, h: c.height }; });
const recorded = (page: Page) => page.locator('.s3 .rec').textContent().then((t) => { const m = /REC (\d+):(\d\d)/.exec(t ?? ''); return m ? +m[1] * 60 + +m[2] : -1; });
const stop = (page: Page) => Promise.all([page.waitForEvent('download'), page.locator('.s3').getByRole('button', { name: 'Stop and save the video' }).click()]).then(([d]) => d);

test('the band name: on the banners, the screens and the kick drum, painted again in place, kept with the show; empty is the picture again', async ({ page }) => {
  await openConnected(page);
  await open3d(page);
  const before = await venue(page);
  expect(before.band.name).toBe('');
  expect(before.band.surfaces.find((s: any) => s.what === 'backdrop').shows).toBe('');         // (the band's picture)
  const panel = await venuePanel(page);
  await panel.getByLabel('Band name').fill('The Rusty Nails');
  await panel.getByLabel('Band name').press('Enter');
  await expect.poll(async () => (await venue(page)).band.name).toBe('The Rusty Nails');
  const after = await venue(page);
  // the same venue and the same textures, each painted again with the name
  expect(after.group).toBe(before.group);
  expect(after.band.surfaces.map((s: any) => s.what)).toEqual(expect.arrayContaining(['backdrop', 'scrim left', 'scrim right', 'skirt', 'barricade', 'kick drum', 'screens']));
  for (const s of after.band.surfaces) {
    const was = before.band.surfaces.find((x: any) => x.what === s.what);
    expect(s.uuid, s.what).toBe(was.uuid);
    expect(s.shows.toUpperCase(), s.what).toBe('THE RUSTY NAILS');
    if (s.what !== 'screens') expect(s.version, s.what).toBeGreaterThan(was.version);
  }
  expect(await page.evaluate(() => (window as any).__luxdmx.show.settings.bandName)).toBe('The Rusty Nails');
  // kept with the show: after a reload the banners have it straight away
  await page.reload();
  await ready3d(page);
  await expect.poll(async () => (await venue(page)).band.name).toBe('The Rusty Nails');
  // an empty field: the band's picture again (and nothing in the file)
  const again = await venuePanel(page);
  await expect(again.getByLabel('Band name')).toHaveValue('The Rusty Nails');
  await again.getByLabel('Band name').fill('');
  await again.getByLabel('Band name').press('Enter');
  await expect.poll(async () => (await venue(page)).band.surfaces.find((s: any) => s.what === 'backdrop').shows).toBe('');
  expect(await page.evaluate(() => 'bandName' in (window as any).__luxdmx.show.settings)).toBe(false);
});

test('a small club / pub: a few dozen people instead of hundreds, the lights under its low ceiling, the camera in the room, kept with the show; back to the big stage', async ({ page }) => {
  await openConnected(page);
  await page.evaluate(() => (window as any).__luxdmx.addFixtures('gen-mover8', '', 4, 0, 'Head'));
  await open3d(page);
  const hall = await venue(page);
  expect(hall.room).toBe('hall');
  const s3 = page.locator('.s3');
  // a head without a place of its own hangs on a truss of the room shown
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.select(a.show.fixtures[0].id); });
  const height = () => s3.getByRole('group', { name: 'The selected lights' }).getByLabel('Height m', { exact: true }).inputValue().then(Number);
  expect(await height()).toBeGreaterThan(6);
  const panel = await venuePanel(page);
  await expect(panel.getByRole('button', { name: 'Big stage' })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'Small club / pub' }).click();
  await expect.poll(async () => (await venue(page)).room).toBe('pub');
  const pub = await venue(page);
  expect(pub.group).not.toBe(hall.group);
  expect(pub.crowd).toBeLessThan(hall.crowd);
  expect(pub.crowd).toBeGreaterThanOrEqual(20); expect(pub.crowd).toBeLessThanOrEqual(60);
  await expect(panel.getByRole('button', { name: 'Small club / pub' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as any).__luxdmx.show.settings.stage3d.room)).toBe('pub');
  await expect.poll(height).toBeLessThan(4.5);
  // the camera went to the pub's front view: inside the room, under its ceiling
  const cam: number[] = await page.evaluate(() => (window as any).__stage3d.internals.camera.position.toArray());
  expect(Math.abs(cam[0])).toBeLessThan(4.6); expect(cam[1]).toBeLessThan(5.1); expect(cam[2]).toBeLessThan(14.6);
  // the picture stays finite, and the band's name works here too
  const finite = await page.evaluate(() => (window as any).__stage3d.hdr(160));
  expect(finite.nan).toBe(0); expect(finite.over).toBe(0);
  // kept with the show
  await page.reload();
  await ready3d(page);
  await expect.poll(async () => (await venue(page)).room).toBe('pub');
  // and back to the big stage (undo-able like any change)
  await (await venuePanel(page)).getByRole('button', { name: 'Big stage' }).click();
  await expect.poll(async () => (await venue(page)).room).toBe('hall');
  expect((await venue(page)).crowd).toBe(hall.crowd);
  expect(await page.evaluate(() => (window as any).__luxdmx.show.settings.stage3d?.room)).toBeUndefined();
});

test('9:16 for phones: the take draws at 1080 x 1920 with a lens wide enough across, the file downloads, the picture goes back', async ({ page }) => {
  await openConnected(page);
  await open3d(page);
  const s3 = page.locator('.s3');
  await videoSize(page, 'vertical');
  const before = await canvasSize(page);
  await s3.getByRole('button', { name: 'Record a video' }).click();
  await expect(s3.locator('.rec')).toContainText(/REC \d+:\d\d/);
  expect(await canvasSize(page)).toEqual({ w: 1080, h: 1920 });
  const lens = await page.evaluate(() => { const c = (window as any).__stage3d.internals.camera; return { aspect: c.aspect, fov: c.fov }; });
  expect(lens.aspect).toBeCloseTo(1080 / 1920, 4);
  // (never narrower than the tall lens the window would get; the band fits across: see recorder.test.ts)
  expect(lens.fov).toBeGreaterThanOrEqual(42 * Math.sqrt(0.85 / (1080 / 1920)) - 0.01);
  expect(lens.fov).toBeLessThanOrEqual(75);
  // the lens stays as it is for the whole take
  await expect.poll(() => recorded(page), { timeout: 10000 }).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => (window as any).__stage3d.internals.camera.fov)).toBe(lens.fov);
  const dl = await stop(page);
  expect(dl.suggestedFilename()).toMatch(/ 3D \d{4}-\d\d-\d\d \d\d\.\d\d\.(webm|mp4)$/);
  await expect.poll(() => canvasSize(page)).toEqual(before);
  expect(await page.evaluate(() => (window as any).__stage3d.internals.camera.fov)).toBeLessThan(lens.fov + 0.01);
  // the choice is remembered
  expect(await page.evaluate(() => localStorage.getItem('luxdmx.seq.video3d'))).toBe('vertical');
});

test('a choppy take says so at Stop, with what to try; a smooth one doesn\'t', async ({ page }) => {
  await openConnected(page);
  await open3d(page);
  const s3 = page.locator('.s3');
  await videoSize(page, 'shown');
  // (the frames the stage drew are counted by the take: set here, the test browser's own rate varies)
  for (const [drawn, choppy] of [[3, true], [1e6, false]] as const) {
    await s3.getByRole('button', { name: 'Record a video' }).click();
    await expect.poll(() => recorded(page), { timeout: 10000 }).toBeGreaterThanOrEqual(2);
    await page.evaluate((n) => { (window as any).__stage3d.take().drawn = n; }, drawn);
    const dl = await stop(page);
    const toast = page.locator('.toast').filter({ hasText: `Saved "${dl.suggestedFilename()}"` });
    await expect(toast).toBeVisible();
    if (choppy) await expect(toast).toContainText(/The video stutters \(\d+ frames a second\): close other tabs, or make the window smaller\./);
    else await expect(toast).not.toContainText('stutters');
  }
});

test('a browser that only makes WebM says so next to Record (Instagram wants MP4)', async ({ page }) => {
  await openConnected(page);
  await open3d(page);
  const s3 = page.locator('.s3');
  const mp4 = await page.evaluate(() => ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4d0028,mp4a.40.2', 'video/mp4;codecs=avc1.42e028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2']
    .some((t) => MediaRecorder.isTypeSupported(t)));
  if (!(await s3.getByLabel('Video size').isVisible())) await s3.getByRole('button', { name: 'More', exact: true }).click();
  if (mp4) { await expect(s3.locator('.webm')).toHaveCount(0); return; }
  await expect(s3.locator('.webm')).toHaveText('WebM');
  await expect(s3.locator('.webm')).toHaveAttribute('aria-label', 'WebM only');
  await expect(s3.locator('.webm')).toHaveAttribute('title', /Instagram and many phones want MP4/);
  await expect(s3.getByRole('button', { name: 'Record a video' })).toHaveAttribute('title', /WebM.*MP4/);
});

test('a take goes on while the window gets narrower (1400 to 1000 px): the REC chip counts on, Stop downloads', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openConnected(page);
  await open3d(page);
  const s3 = page.locator('.s3');
  await videoSize(page, 'shown');
  await s3.getByRole('button', { name: 'Record a video' }).click();
  await expect.poll(() => recorded(page), { timeout: 10000 }).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => !!(window as any).__stage3d.take())).toBe(true);
  await page.setViewportSize({ width: 1000, height: 900 });
  const at = await recorded(page);
  await expect.poll(() => recorded(page), { timeout: 10000 }).toBeGreaterThanOrEqual(at + 2);
  expect(await page.evaluate(() => !!(window as any).__stage3d?.take())).toBe(true);
  const dl = await stop(page);
  expect(dl.suggestedFilename()).toMatch(/\.(webm|mp4)$/);
  expect(await page.evaluate(() => (window as any).__stage3d.take())).toBeNull();
});
