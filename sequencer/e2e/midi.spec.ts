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

test('the console faders learn MIDI controls, and they work in every view', async ({ page }) => {
  await openConnected(page);
  const { patch } = await import('./helpers');
  await patch(page, 'gen-drgb', 2, 0, 'PAR');                           // 1 at 1, 2 at 5
  await page.getByRole('tab', { name: 'Console' }).click();
  const con = page.locator('.console');
  await con.getByRole('button', { name: 'MIDI', exact: true }).click();
  // CC 8 on channel 1 -> PAR 1's level
  await con.getByRole('button', { name: 'MIDI for PAR 1' }).click();
  await expect(con.getByRole('button', { name: 'MIDI for PAR 1' })).toHaveText('…');
  await send(page, [0xb0, 8, 0]);
  await expect(con.getByRole('button', { name: 'MIDI for PAR 1' })).toHaveText('CC8');
  await send(page, [0xb0, 8, 127]);
  await expect.poll(async () => (await channels(0, 8))[0]).toBe(255);
  // CC 7 -> the grand master, then from Program (another view) both still move
  await con.getByRole('button', { name: 'MIDI for the grand master' }).click();
  await send(page, [0xb0, 7, 127]);
  await expect(con.getByRole('button', { name: 'MIDI for the grand master' })).toHaveText('CC7');
  await page.getByRole('tab', { name: 'Program' }).click();
  await send(page, [0xb0, 7, 64]);
  await expect.poll(async () => (await channels(0, 8))[0]).toBe(129);                  // (64 of 127: just over half)
  await send(page, [0xb0, 8, 0]);
  await expect.poll(async () => (await channels(0, 8))[0]).toBe(0);
  expect(await page.evaluate(() => (window as any).__luxdmx.show.settings.consoleMidi.map((b: any) => [b.to.split(':')[0], b.midi.num]))).toEqual([['light', 8], ['grand', 7]]);
  // the controller unplugged and back (or its bank changed): a fader far from the grand master
  // doesn't jump it; once it passes where the master is, it moves it again
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.releaseMidi(); a.grandMaster = 0.5; });
  await send(page, [0xb0, 7, 127]);
  await send(page, [0xb0, 7, 90]);
  expect(await page.evaluate(() => (window as any).__luxdmx.grandMaster)).toBe(0.5);
  await send(page, [0xb0, 7, 50]);                                      // (crossed it)
  expect(await page.evaluate(() => (window as any).__luxdmx.grandMaster)).toBeCloseTo(50 / 127, 3);
  await send(page, [0xb0, 7, 127]);
  // a pad on PAR 2's level is a flash: full while held, back when let go
  await page.getByRole('tab', { name: 'Console' }).click();
  await con.getByRole('button', { name: 'MIDI for PAR 2' }).click();
  await send(page, [0x90, 40, 100]);
  await expect(con.getByRole('button', { name: 'MIDI for PAR 2' })).toHaveText('N40');
  await send(page, [0x80, 40, 0]);
  await expect.poll(async () => (await channels(0, 8))[4]).toBe(0);
  await send(page, [0x90, 40, 100]);
  await expect.poll(async () => (await channels(0, 8))[4]).toBe(255);
  await send(page, [0x80, 40, 0]);
  await expect.poll(async () => (await channels(0, 8))[4]).toBe(0);
  // a control a live page's button had: learning it for the console says so
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.show.pages.push({ id: 'pg-m', name: 'Mine', widgets: [{ id: 'w-m', type: 'special', do: 'blackout', label: 'Kill it', midi: { kind: 'cc', ch: 1, num: 9 } }] }); });
  await page.getByRole('tab', { name: 'Console' }).click();
  await con.getByRole('button', { name: 'MIDI for PAR 2' }).click();            // (it had the pad: let go of it first)
  await expect(con.getByRole('button', { name: 'MIDI for PAR 2' })).toHaveText('Learn');
  await con.getByRole('button', { name: 'MIDI for PAR 2' }).click();
  await send(page, [0xb0, 9, 64]);
  await expect(page.locator('.toast')).toContainText("It was on Kill it on a live page: that one doesn't answer it any more");
  // and it really doesn't: the control pushed all the way, let go, no Blackout
  await send(page, [0xb0, 9, 127]); await send(page, [0xb0, 9, 0]);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__luxdmx.blackout)).toBe(false);
  // its button again lets go of the control
  await page.getByRole('tab', { name: 'Console' }).click();
  await con.getByRole('button', { name: 'MIDI for PAR 1' }).click();
  await expect(con.getByRole('button', { name: 'MIDI for PAR 1' })).toHaveText('Learn');
});
