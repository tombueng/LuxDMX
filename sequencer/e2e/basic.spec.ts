// The simple path: patch, set, record two cues, GO with a fade, release. Values read back from the
// fake LuxDMX, so this is what a real box receives.
import { openConnected, channels, history, resetFake, patch, selectAll, swatch, record, go, full, cues, jumpTo, release, fixturesOnStage , test, expect } from './helpers';

test('patch, record two cues, GO fades between them', async ({ page }) => {
  await resetFake();
  await openConnected(page);
  await patch(page, 'gen-drgb', 4);
  await expect(fixturesOnStage(page)).toHaveCount(4);

  await selectAll(page);
  await full(page);
  await swatch(page, 'Red');
  await expect.poll(() => channels(0, 16)).toEqual([255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0]);
  await record(page);
  await selectAll(page);
  await swatch(page, 'Blue');
  await record(page);
  await expect(cues(page)).toHaveCount(2);
  await expect.poll(() => channels(0, 4)).toEqual([255, 0, 0, 255]);

  await jumpTo(page, 0);
  await expect.poll(() => channels(0, 4), { timeout: 4000 }).toEqual([255, 255, 0, 0]);
  await resetFake();
  const t0 = Date.now();
  await go(page);
  await expect.poll(() => channels(0, 4), { timeout: 4000 }).toEqual([255, 0, 0, 255]);
  const red = (await history(0, 2)).filter(([t]) => t >= t0);
  const start = red.find(([, v]) => v < 255)![0], end = red.find(([, v]) => v === 0)![0];
  expect(end - start).toBeGreaterThan(1700);
  expect(end - start).toBeLessThan(2400);
  const mid = red.find(([t]) => t >= start + 1000)![1];
  expect(mid).toBeGreaterThan(90);
  expect(mid).toBeLessThan(165);

  await release(page);
  await expect.poll(() => channels(0, 1), { timeout: 4000 }).toEqual([0]);
});

test('starter looks for my own rig: moods in the empty list, a gradient across the stage', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 3, 0, 'PAR');
  await page.locator('.deck').getByRole('button', { name: /starter looks for my rig/ }).click();
  await expect(cues(page)).toHaveCount(8);
  await expect(cues(page).nth(2)).toContainText('Sunset');
  await cues(page).nth(2).dblclick();                                    // go to Sunset
  // left PAR orange-ish (more green than the right one), right PAR magenta-ish (more blue)
  await expect.poll(async () => { const c = await channels(0, 9); return c[1] > c[7] && c[8] > c[2]; }, { timeout: 4000 }).toBe(true);
  await page.locator('body').press('Control+z');                          // one undo takes them all back
  await expect(cues(page)).toHaveCount(0);
});
