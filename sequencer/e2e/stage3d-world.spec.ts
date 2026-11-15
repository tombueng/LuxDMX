// The 3D world goes on from view to view, and goes back to the graphics chip when nobody takes it
// up (3 minutes, freed here at once). A view's stage that gets a newly built world after holding an
// older one sets everything up for the new one: the crowd light and the mirror ball's dots in the
// scene it draws, the exposure meter on the graphics context it draws with. (They were kept from the
// old world: no crowd light, no dots, the exposure frozen. Review 5, R5-B5.)
import { openConnected, startTemplate, test, expect } from './helpers';

test('a new world after the last one went: the crowd light, the mirror ball\'s dots and the exposure belong to it', async ({ page }) => {
  test.setTimeout(150_000);
  await openConnected(page);
  await startTemplate(page, 'Bar');
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__stage3d?.venue?.()?.room), { timeout: 45000 }).toBe('bar');
  const parts = () => page.evaluate(() => (window as any).__stage3d?.parts?.());
  await expect.poll(parts, { timeout: 10000 }).toEqual({ lamp: true, dots: true, meter: true });
  // (the meter has read the picture once: its pixel buffer is on this world's graphics context)
  await expect.poll(() => page.evaluate(() => !!(window as any).__stage3d.internals.meter?.context), { timeout: 20000 }).toBe(true);
  await page.evaluate(() => { (window as any).__stage3d.internals.renderer.__old = true; });
  const tabs = page.locator('.top .modes');
  // Live, its stage hidden: the world is parked, nobody takes it; then it goes
  await tabs.getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('div.live')).toBeVisible();
  const eye = page.locator('.live').getByRole('button', { name: 'Show the stage' });
  if ((await eye.getAttribute('aria-pressed')) === 'true') await eye.click();
  await expect(page.locator('.live .stagebox')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await import('/src/stage3d/Stage3D.svelte')).keptWorld()), { timeout: 10000 }).toBe(true);
  await page.evaluate(async () => (await import('/src/stage3d/Stage3D.svelte')).freeKeptWorld());
  // back to Program: a new world, and its parts are its own
  await tabs.getByRole('tab', { name: 'Program' }).click();
  await expect.poll(() => page.evaluate(() => { const s = (window as any).__stage3d; return !!s?.internals && !s.internals.renderer.__old; }), { timeout: 45000 }).toBe(true);
  await expect.poll(parts, { timeout: 10000 }).toEqual({ lamp: true, dots: true, meter: true });
});

// A view's stage that's hidden gives its picture buffers back (the frames and the glow's chain: up
// to ~190 MB each on a sharp screen, kept by every view that ever showed the 3D); shown again, they're
// made anew. The graphics card's texture count stays put from view to view. (Review 5, R5-P5)
test('switching views: the hidden view\'s picture buffers go back to the graphics card', async ({ page }) => {
  test.setTimeout(150_000);
  await openConnected(page);
  await startTemplate(page, 'Bar');
  await page.locator('.stage-wrap').getByRole('button', { name: '3D' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__stage3d?.venue?.()?.room), { timeout: 45000 }).toBe('bar');
  const tex = async () => {
    // (a few frames drawn by the stage on screen first: its buffers made)
    const n0 = await page.evaluate(() => (window as any).__stage3d?.stats?.().drawn ?? 0);
    await expect.poll(() => page.evaluate(() => (window as any).__stage3d?.stats?.().drawn ?? 0), { timeout: 30000 }).toBeGreaterThan(n0 + 2);
    return page.evaluate(() => (window as any).__stage3d.internals.renderer.info.memory.textures as number);
  };
  const tabs = page.locator('.top .modes');
  const t0 = await tex();
  await tabs.getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('div.live')).toBeVisible();
  const eye = page.locator('.live').getByRole('button', { name: 'Show the stage' });
  if ((await eye.getAttribute('aria-pressed')) !== 'true') await eye.click();
  const t1 = await tex();
  await tabs.getByRole('tab', { name: 'Timeline' }).click();
  const t2 = await tex();
  await tabs.getByRole('tab', { name: 'Program' }).click();
  const t3 = await tex();
  console.log('textures on the graphics card, Program / Live / Timeline / Program:', t0, t1, t2, t3);
  for (const t of [t1, t2, t3]) expect(t).toBeLessThanOrEqual(t0 + 2);
});
