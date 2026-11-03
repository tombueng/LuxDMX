// MIDI controllers on the live page, with a fake Web MIDI input (the browser's own MIDI layer can't
// be driven from a test): learn a pad for a scene and a knob for the grand master, then play.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, channels, test, expect } from './helpers';

const send = (page: Page, bytes: number[]) => page.evaluate((b) => (window as any).__midiIn.onmidimessage({ data: new Uint8Array(b) }), bytes);

test.beforeEach(async ({ page }) => {
  await resetFake();
  await page.addInitScript(() => {
    const input: any = { name: 'Fake pad', onmidimessage: null };
    (window as any).__midiIn = input;
    // one access object, kept so a test can unplug the pad
    (navigator as any).requestMIDIAccess = async () => ((window as any).__midiAccess ??= { inputs: new Map([['in1', input]]), onstatechange: null });
  });
});

test('learn a pad and a knob, then play with them', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Cinema' }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  const ed = page.getByRole('complementary', { name: 'Control settings' });

  // pad 36 -> the "Walk-in" scene
  await page.locator('.live [data-widget="cue-l1c1"]').click();
  await ed.getByRole('button', { name: 'Learn' }).click();
  await expect(ed).toContainText('move a knob or hit a pad');
  await send(page, [0x90, 36, 100]);
  await expect(ed).toContainText('Note 36 · ch 1');
  // knob CC 7 on channel 2 -> grand master
  await page.locator('.live .tile.fader', { hasText: 'Grand master' }).click();
  await ed.getByRole('button', { name: 'Learn' }).click();
  await send(page, [0xb1, 7, 127]);
  await expect(ed).toContainText('CC 7 · ch 2');
  await page.locator('.live').getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.live .chip', { hasText: 'Fake pad' })).toBeVisible();

  // play: the pad starts the scene (house lights full at 1-4), the knob halves everything
  await send(page, [0x90, 36, 100]);
  await send(page, [0x80, 36, 0]);
  await expect(page.locator('.live [data-widget="cue-l1c1"]')).toHaveClass(/\bon\b/);
  await expect.poll(() => channels(0, 4), { timeout: 5000 }).toEqual([255, 255, 255, 255]);
  await send(page, [0xb1, 7, 64]);
  await expect.poll(() => channels(0, 1)).toEqual([129]);
  await expect(page.locator('.live .tile.fader', { hasText: 'Grand master' }).locator('b')).toHaveText('50%');
});

test('a pad held while its button is removed still lets go', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.live [data-widget^="flash-"]').first().click();                 // flash the PARs
  const ed = page.getByRole('complementary', { name: 'Control settings' });
  await ed.getByRole('button', { name: 'Learn' }).click();
  await send(page, [0x90, 40, 100]);
  await expect(ed).toContainText('Note 40');
  await page.locator('.live').getByRole('button', { name: 'Done', exact: true }).click();
  await send(page, [0x90, 40, 100]);                                                      // hold the pad
  await expect.poll(() => channels(0, 3)).toEqual([255, 255, 255]);
  // remove the button while the pad is still down
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.live [data-widget^="flash-"]').first().click();
  await ed.getByRole('button', { name: 'Remove' }).click();
  await send(page, [0x80, 40, 0]);                                                        // let go
  await expect.poll(() => channels(0, 3)).toEqual([0, 0, 0]);
});

test('unplugging the controller while a pad is held lets go of it', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  const ed = page.getByRole('complementary', { name: 'Control settings' });
  await page.locator('.live .tile.group').first().click();                      // the PARs flash
  await ed.getByRole('button', { name: 'Learn' }).click();
  await send(page, [0x90, 40, 100]);
  await expect(ed).toContainText('Note 40');
  await page.locator('.live').getByRole('button', { name: 'Done', exact: true }).click();
  await send(page, [0x90, 40, 100]);                                              // held
  await expect.poll(async () => Math.max(...(await channels(0, 24)))).toBeGreaterThan(0);
  await page.evaluate(() => { const a = (window as any).__midiAccess; a.inputs.delete('in1'); a.onstatechange?.(); });
  await expect.poll(async () => Math.max(...(await channels(0, 24))), { timeout: 3000 }).toBe(0);
});
