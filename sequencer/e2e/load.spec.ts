// The load display and the drawing quality (perf/load.svelte.ts): the chip in the stage's header
// says how hard the page works; open, the DMX output's frames a second and its longest gap, and the
// quality slider. Low drops the plan's blur; the choice is kept in this browser. The output itself
// keeps its 40 frames a second.
import { openConnected, patch, channels, test, expect } from './helpers';

test('the load chip, the DMX output\'s timing and the drawing quality', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 8, 0, 'PAR');
  const chip = page.locator('.stage-wrap').getByRole('button', { name: 'Load and drawing quality' });
  await expect(chip).toHaveText(/\d+%/);
  await chip.click();
  const pop = page.getByRole('dialog', { name: 'Load and quality' });
  // the output: about 40 frames a second
  await expect.poll(async () => Number((await pop.locator('dd').first().textContent())?.match(/(\d+) frames a second/)?.[1] ?? 0), { timeout: 8000 }).toBeGreaterThanOrEqual(35);
  // Low: the plan without its blur; kept over a reload
  const slider = pop.getByRole('slider');
  await slider.fill('0');
  await expect(pop).toContainText('Drawing quality Low');
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click().catch(() => {});
  await expect(page.locator('.stage-wrap svg g[filter="url(#pool)"]')).toHaveCount(0);
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('luxdmx.seq.quality'))).toBe('0');
  // the output runs as ever (after a reload it waits until something plays: a light set here)
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.programmer = { [a.show.fixtures[0].id]: { intensity: 1 } }; });
  await expect.poll(async () => (await channels(0, 1))[0]).toBe(255);
});
