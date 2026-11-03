// Live: the busking page built from a show, every kind of control, keys, hold-to-fog with its hard
// maximum, flash, and editing the page (add, change, move, remove, lock).
import type { Page } from '@playwright/test';
import { openConnected, resetFake, channels, patch, selectFixtures, test, expect } from './helpers';

const tile = (page: Page, id: string) => page.locator(`.live [data-widget="${id}"]`);
const tileByText = (page: Page, text: string) => page.locator('.live .tile', { hasText: text }).first();

async function djShow(page: Page) {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('.live')).toBeVisible();
}
// DJ template patch: 8 RGB PARs 1-24, 2 bars 25-72, 2 movers 73-88, strobe 89-90, fog 91.

test.beforeEach(async () => { await resetFake(); });

test('the busking page plays the show: scenes, keys, GO, effects, blackout', async ({ page }) => {
  await djShow(page);
  // built from the show: the looks with keys 1-0, the effects, a flash per group, fog, blinder, drop, masters
  const show = await page.evaluate(() => { const s = (window as any).__luxdmx.show; return { looks: s.cueLists[0].cues.length, effects: s.effects.length, groups: s.groups.length }; });
  expect(show.looks).toBeGreaterThan(6);
  await expect(page.locator('.live .tile.cue')).toHaveCount(Math.min(48, show.looks));
  await expect(page.locator('.live .tile.effect')).toHaveCount(show.effects);
  await expect(page.locator('.live .tile.group')).toHaveCount(show.groups);
  await expect(page.locator('.live .tile.fog')).toHaveCount(1);
  await expect(tileByText(page, 'Full on').locator('.key')).toHaveText('6');

  await tileByText(page, 'Full on').click();
  await expect(tileByText(page, 'Full on')).toHaveClass(/\bon\b/);
  await expect.poll(async () => (await channels(0, 3)).some((v) => v > 0), { timeout: 3000 }).toBe(true);

  await page.keyboard.press('1');                                        // Warm-up
  await expect(tileByText(page, 'Warm-up')).toHaveClass(/\bon\b/);
  await expect(tileByText(page, 'Full on')).not.toHaveClass(/\bon\b/);
  await page.keyboard.press('Space');                                    // GO: next look
  await expect(tileByText(page, 'Red / blue')).toHaveClass(/\bon\b/);
  await page.waitForTimeout(450);                                        // (a GO right after another is taken as a double press)
  // the strip says what's on and what's next, and its GO steps on
  await expect(page.locator('.strip .now')).toContainText('2. Red / blue');
  await expect(page.locator('.strip .nxt')).toContainText('3. Ocean');
  await page.locator('.strip').getByRole('button', { name: /^GO/ }).click();
  await expect(page.locator('.strip .now')).toContainText('3. Ocean');
  await page.locator('.strip').getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.strip .now')).toContainText('2. Red / blue');

  // an effect button toggles its effect
  const fx = page.locator('.live .tile.effect').first();
  await fx.click();
  await expect(fx).toHaveClass(/\bon\b/);
  await fx.click();
  await expect(fx).not.toHaveClass(/\bon\b/, { timeout: 3000 });

  await page.keyboard.press('b');
  await expect.poll(() => channels(0, 24)).toEqual(Array(24).fill(0));
  await expect(page.locator('.strip').getByRole('button', { name: 'Blackout' })).toHaveClass(/\bon\b/);     // the GO bar's button (the top bar has none in Live)
  await page.keyboard.press('b');
  await expect.poll(async () => (await channels(0, 24)).some((v) => v > 0)).toBe(true);
});

test('fog runs only while held, and never longer than its maximum', async ({ page }) => {
  await djShow(page);
  const fog = tile(page, 'fog');
  await fog.scrollIntoViewIfNeeded();                                       // (a long page: it's further down)
  const box = (await fog.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(async () => (await channels(0, 91))[90]).toBe(255);
  await expect(fog).toContainText('s left');
  await page.mouse.up();
  await expect.poll(async () => (await channels(0, 91))[90]).toBe(0);

  // edit the page: a 1 s maximum
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await fog.click();
  await page.getByLabel('Maximum seconds').fill('1');
  await page.locator('.live').getByRole('button', { name: 'Done', exact: true }).click();
  // hold the key: fog on, then off after 1 s although the key is still down
  await page.keyboard.down('v');
  await expect.poll(async () => (await channels(0, 91))[90]).toBe(255);
  await page.waitForTimeout(1600);
  expect((await channels(0, 91))[90]).toBe(0);
  await page.keyboard.up('v');
});

test('flash a group while held', async ({ page }) => {
  await djShow(page);
  await page.keyboard.down('z');                                         // first group: the PARs
  await expect.poll(() => channels(0, 24)).toEqual(Array(24).fill(255));
  await page.keyboard.up('z');
  await expect.poll(() => channels(0, 24)).toEqual(Array(24).fill(0));
});

test('edit a page: add a scene button, give it a key, move it, remove it; lock the page', async ({ page }) => {
  await djShow(page);
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.live .cell').nth(2).click();                     // new controls go after the selected one
  await page.locator('.live').getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('.ctx').getByRole('menuitem', { name: /Scene button/ }).click();
  const ed = page.getByRole('complementary', { name: 'Control settings' });
  await ed.getByLabel('Cue', { exact: true }).selectOption({ label: '3. Ocean' });
  await ed.getByLabel('Label').fill('Chill');
  await ed.getByLabel('Keyboard key').fill('k');
  const added = page.locator('.live .tile', { hasText: 'Chill' });
  await expect(added).toHaveCount(1);
  await expect(page.locator('.live .cell').nth(3)).toContainText('Chill');
  // drag it to the very front
  await page.locator('.live .cell').filter({ hasText: 'Chill' }).dragTo(page.locator('.live .cell').first());
  await expect(page.locator('.live .cell').first()).toContainText('Chill');
  await page.locator('.live').getByRole('button', { name: 'Done', exact: true }).click();
  await page.keyboard.press('k');
  await expect(added).toHaveClass(/\bon\b/);
  // remove it again
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await added.click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.live .tile', { hasText: 'Chill' })).toHaveCount(0);
  await page.locator('.live').getByRole('button', { name: 'Done', exact: true }).click();
  // lock: no editing until unlocked
  await page.locator('.live').getByRole('button', { name: 'Lock page' }).click();
  await expect(page.locator('.live').getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await page.locator('.live').getByRole('button', { name: /Unlock page/ }).click();      // a tap isn't enough
  await expect(page.locator('.toast')).toContainText('Hold the padlock');
  await expect(page.locator('.live').getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  const lock = page.locator('.live').getByRole('button', { name: /Unlock page/ });
  await lock.hover(); await page.mouse.down(); await page.waitForTimeout(1200); await page.mouse.up();
  await expect(page.locator('.live').getByRole('button', { name: 'Edit', exact: true })).toBeEnabled();
  await expect(page.locator('.live').getByRole('button', { name: 'Lock page' })).toBeVisible();     // and stays unlocked
});

test('locked for the service: only playing, and Program changes left behind are shown and cleared', async ({ page }) => {
  await djShow(page);
  // a change made in Program and forgotten
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  await page.locator('.stage-wrap .fx[data-name="PAR 1"]').click();
  await page.locator('.prog .sw[aria-label="Red"]').click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('.live .held')).toContainText('1 light you changed in Program overrides the show');
  await page.locator('.live').getByRole('button', { name: 'Lock page' }).click();
  // the service mode: no Program, no tempo, no editing, no page menu, no command palette
  await expect(page.locator('.top .modes')).toHaveCount(0);
  await expect(page.locator('.top input[aria-label="BPM"]')).toHaveCount(0);
  await expect(page.locator('.top .lockedname')).toBeVisible();
  await page.locator('.live .pages [role=tab]').first().click({ button: 'right' });
  await expect(page.locator('.ctx')).toHaveCount(0);
  await page.locator('body').press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Find anything' })).toHaveCount(0);
  // the forgotten change can still be cleared, and the show plays
  await page.locator('.live .held').getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('.live .held')).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(page.locator('.strip .now')).toContainText('1.');
});

test('locked: the stage in Live only looks, no menu (a long press is a right-click); the palette locks like the padlock', async ({ page }) => {
  await djShow(page);
  const stageBtn = page.locator('.live').getByRole('button', { name: 'Show the stage' });
  if ((await stageBtn.getAttribute('aria-pressed')) !== 'true') await stageBtn.click();     // on by default on a wide screen
  const par = page.locator('.live .stage-wrap .fx[data-name="PAR 1"]');
  // unlocked: the Live stage's menus only have view items (no remove, no patch, no add)
  await par.click({ button: 'right' });
  await expect(page.locator('.ctx')).toContainText('Show DMX addresses');
  await expect(page.locator('.ctx')).not.toContainText(/Remove|Name, address|Add fixtures/);
  await page.keyboard.press('Escape');
  await par.click();                                                   // a click doesn't select either
  expect(await page.evaluate(() => (window as any).__luxdmx.selected.length)).toBe(0);
  // Ctrl+K "lock" while editing: locked AND out of Edit mode
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Find anything' }).getByRole('combobox').fill('lock');
  await page.keyboard.press('Enter');
  await expect(page.locator('.live').getByRole('button', { name: /Unlock page/ })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__luxdmx.editPage)).toBe(false);
  await expect(page.locator('.live').getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  await par.click({ button: 'right' });
  await expect(page.locator('.ctx')).toHaveCount(0);
  await page.locator('.live .stage-wrap .area > svg').click({ button: 'right', position: { x: 20, y: 20 } });
  await expect(page.locator('.ctx')).toHaveCount(0);
  await page.keyboard.press('Space');                                  // and it still plays
  await expect(page.locator('.strip .now')).toContainText('1.');
});

test('Fade out: everything to black over 5 s, and back on the next press', async ({ page }) => {
  await djShow(page);
  await page.locator('.live .tile.cue').first().click();
  await expect.poll(async () => (await channels(0, 3)).some((v) => v > 0)).toBe(true);
  const fade = page.locator('.live [data-widget="fade"]');
  await fade.scrollIntoViewIfNeeded();
  await fade.click();
  await page.waitForTimeout(2500);
  const mid = await page.evaluate(() => (window as any).__luxdmx.grandMaster as number);
  expect(mid).toBeGreaterThan(0.3); expect(mid).toBeLessThan(0.7);           // halfway down, not a jump
  await expect(fade).toContainText('fading out');
  await expect.poll(() => channels(0, 24), { timeout: 5000 }).toEqual(Array(24).fill(0));
  await expect(fade).toHaveClass(/\bon\b/);
  await expect(fade).toContainText('tap to come back');
  await fade.click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.grandMaster as number), { timeout: 7000 }).toBe(1);
  await expect(fade).not.toHaveClass(/\bon\b/);
  // a hand on the master during a fade takes over
  await fade.click();
  await page.waitForTimeout(800);
  await page.evaluate(() => { (window as any).__luxdmx.grandMaster = 0.8; });
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as any).__luxdmx.grandMaster as number)).toBeCloseTo(0.8, 2);
});

test('Fade out after a hand on the master fades out, not up; pressed while coming back it goes out again', async ({ page }) => {
  await djShow(page);
  const fade = page.locator('.live [data-widget="fade"]');
  await fade.scrollIntoViewIfNeeded();
  const gm = () => page.evaluate(() => (window as any).__luxdmx.grandMaster as number);
  await fade.click();
  await expect.poll(gm, { timeout: 7000 }).toBe(0);
  await page.evaluate(() => { (window as any).__luxdmx.grandMaster = 0.8; });   // the next song, master up by hand
  await page.waitForTimeout(300);
  await expect(fade).not.toHaveClass(/\bon\b/);
  await fade.click();                                                           // the end of that song: out again
  await page.waitForTimeout(2600);
  expect(await gm()).toBeLessThan(0.6);
  await expect.poll(gm, { timeout: 5000 }).toBe(0);
  await fade.click();                                                           // back...
  await page.waitForTimeout(1500);
  await fade.click();                                                           // ...and out again halfway
  await expect.poll(gm, { timeout: 7000 }).toBe(0);
  await fade.click();                                                           // back to where it was before all that
  await expect.poll(gm, { timeout: 7000 }).toBeCloseTo(0.8, 2);
});

for (const change of ['left as it was', 'removed', 'pointed at another list'] as const) {
  test(`a stuck MIDI pad on a list flash, the button ${change}: the 30 s cap still lets go`, async ({ page }) => {
    await djShow(page);
    const r = await page.evaluate((change) => {
      const a = (window as any).__luxdmx;
      const [l1, l2] = a.show.cueLists;
      a.engine.release(l1.id);
      const p = a.ownPages()[0];
      p.widgets.push({ id: 'lf', type: 'list', list: l1.id, action: 'flash', label: 'LF', midi: { kind: 'note', ch: 0, num: 60 } });
      a.markDirty(0);
      a.midi({ kind: 'note', ch: 0, num: 60, value: 1 });           // the pad goes down and sticks
      const flashing = a.engine.status(l1.id).flashing;
      const w = p.widgets.find((x: any) => x.id === 'lf');
      if (change === 'removed') p.widgets = p.widgets.filter((x: any) => x.id !== 'lf');
      else if (change === 'pointed at another list') w.list = l2?.id ?? 'nothing';
      a.fogUntil = { ...a.fogUntil, lf: performance.now() - 1 };    // 30 s later
      return { list: l1.id, flashing };
    }, change);
    expect(r.flashing).toBe(true);
    await expect.poll(() => page.evaluate((id) => (window as any).__luxdmx.engine.status(id).flashing, r.list)).toBe(false);
  });
}

test('Live without a cue list still has its Blackout', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('.strip')).toContainText('No cue list yet');
  await page.locator('.strip').getByRole('button', { name: 'Blackout' }).click();
  await expect(page.locator('.strip').getByRole('button', { name: 'Blackout' })).toHaveClass(/\bon\b/);
  await page.keyboard.press('b');
  await expect(page.locator('.strip').getByRole('button', { name: 'Blackout' })).not.toHaveClass(/\bon\b/);
});

test('a fog timer made before any look is never what GO plays', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-fog', 1, 0, 'Fog');
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await page.locator('.stage-wrap .fx[data-name="Fog"]').click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: /fog timer/i }).click();
  await page.getByRole('dialog', { name: 'Fog timer' }).getByRole('button', { name: 'Make the timer' }).click();
  await page.locator('.deck').getByRole('button', { name: 'List', exact: true }).click();     // a list for the looks
  await selectFixtures(page, ['D 1']);
  await page.locator('.prog .quick').getByRole('button', { name: 'Full' }).click();
  await page.locator('.deck').getByRole('button', { name: /^Record/ }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('.strip .go')).not.toContainText(/Fog/);
  await page.keyboard.press('Space');
  await expect(page.locator('.strip .now')).toContainText('1.');
  await page.waitForTimeout(300);
  expect((await channels(0, 1))[0]).toBe(0);                            // the fog machine (ch 1) stays off
});

test('a fader tile: drag it like a fader, or use the arrow keys', async ({ page }) => {
  await djShow(page);
  await page.locator('.live .tile.cue').first().click();                    // something on stage
  const gm = page.locator('.live [data-widget="gm"]');
  await gm.scrollIntoViewIfNeeded();
  const b = (await gm.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height, { steps: 4 });   // down by half the height
  await page.mouse.up();
  const v = Number((await gm.getAttribute('aria-valuenow'))!);
  expect(v).toBeGreaterThan(35); expect(v).toBeLessThan(65);
  await gm.focus();
  await page.keyboard.press('End');
  await expect(gm).toHaveAttribute('aria-valuenow', '100');
  await page.keyboard.press('ArrowDown');
  await expect(gm).toHaveAttribute('aria-valuenow', '95');
});

test('a set list: a button makes GO play another cue list', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Theatre' }).click();
  // the "song" has its own tempo
  await page.locator('.deck .tab', { hasText: 'House lights' }).click();
  await page.locator('.deck').getByRole('button', { name: 'List settings' }).click();
  await page.locator('.deck').getByLabel('List tempo').fill('96');
  await page.locator('.deck').getByLabel('List tempo').press('Tab');
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('.strip').getByLabel('Cue list for GO')).toHaveValue(/./);
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.live').getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('.ctx').getByRole('menuitem', { name: /Cue list button/ }).click();
  const ed = page.getByRole('complementary', { name: 'Control settings' });
  await ed.getByLabel('Cue list').selectOption({ label: 'House lights' });
  await ed.getByLabel('Action').selectOption('select');
  await page.locator('.live').getByRole('button', { name: 'Done', exact: true }).click();
  const song = page.locator('.live .tile', { hasText: 'House lights' }).filter({ hasText: 'SONG' });
  await song.click();
  await expect(song).toHaveClass(/\bon\b/);
  await expect(page.locator('.top input[aria-label="BPM"]')).toHaveValue('96');
  await page.keyboard.press('Space');
  await expect(page.locator('.strip .now')).toContainText('House full');
});

test('a fog timer: fogs for a few seconds, every few minutes (shortened here)', async ({ page }) => {
  await djShow(page);
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.live').getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('.ctx').getByRole('menuitem', { name: /Fog timer/ }).click();
  const ask = page.getByRole('dialog', { name: 'Fog timer' });
  await ask.getByLabel('Every how many minutes').fill('0.05');                  // 3 s, to keep the test short
  await expect(ask.getByLabel('Fog for how many seconds')).toHaveValue('3');
  await ask.getByLabel('Fog for how many seconds').fill('1');
  // 3 s period asked for, but a machine gets at least 15 s off: the dialog says so
  await expect(ask.locator('.sum')).toContainText('Fog 1 s, then 15 s off');
  await ask.getByLabel('Start it now').check();                                  // off unless asked for
  await ask.getByRole('button', { name: 'Make the timer' }).click();
  await page.locator('.live').getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.live .tile', { hasText: 'Fog every 0.05 min' })).toHaveClass(/\bon\b/);   // running, with its button
  // fog (ch 91) goes on for ~1 s, then stays off for its pause
  await expect.poll(async () => (await channels(0, 91))[90], { timeout: 3000 }).toBe(255);
  await expect.poll(async () => (await channels(0, 91))[90], { timeout: 3000 }).toBe(0);
  const seen: number[] = [];
  for (let i = 0; i < 12; i++) { seen.push((await channels(0, 91))[90]); await page.waitForTimeout(250); }
  expect(seen.every((v) => v === 0)).toBe(true);                               // 3 s later still resting
});

test('Auto GO steps through the looks on the bar', async ({ page }) => {
  await djShow(page);
  await page.locator('.top input[aria-label="BPM"]').fill('240');           // 1 bar = 1 s
  await page.locator('.live .tile.cue').first().click();
  await expect(page.locator('.strip .now')).toContainText('1. Warm-up');
  await page.locator('.strip').getByLabel('Auto GO').selectOption('1');
  await expect(page.locator('.strip .now')).toContainText('2. Red / blue', { timeout: 3000 });
  await expect(page.locator('.strip .now')).toContainText('3. Ocean', { timeout: 3000 });
  // and round again after the last one, instead of stopping there
  const looks = await page.evaluate(() => (window as any).__luxdmx.show.cueLists[0].cues.length as number);
  await expect(page.locator('.strip .now')).toContainText(`${looks}.`, { timeout: looks * 1000 + 3000 });
  await expect(page.locator('.strip .now')).toContainText('1. Warm-up', { timeout: 3000 });
  await page.locator('.strip').getByLabel('Auto GO').selectOption('0');
});

test('the screen stays on while Live is open, and lets go after', async ({ page }) => {
  // a stand-in wake lock that counts (headless Chrome has no screen to keep on)
  await page.addInitScript(() => {
    const w = window as unknown as { locks: { taken: number; released: number } };
    w.locks = { taken: 0, released: 0 };
    Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => { w.locks.taken++; return { release: async () => { w.locks.released++; } }; } } });
  });
  await djShow(page);
  await expect.poll(() => page.evaluate(() => (window as any).locks.taken)).toBe(1);
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).locks.released)).toBe(1);
});

test('the GO strip shows the note of the next cue, the standby for the operator', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Theatre' }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('.strip .nxt')).toContainText('1. Preset');
  await expect(page.locator('.strip .standby')).toHaveText('Audience coming in');       // its own line
  await page.keyboard.press('Space');
  await expect(page.locator('.strip .nxt')).toContainText('2. Scene 1');
  await expect(page.locator('.strip .standby')).toHaveText('House lights fade out with it');
});

test('the fog timer dialog takes its own defaults as they are', async ({ page }) => {
  await djShow(page);
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.live').getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('.ctx').getByRole('menuitem', { name: /Fog timer/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Fog timer' });
  await dlg.getByRole('button', { name: 'Make the timer' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('.live .tile', { hasText: 'Fog every 2 min' })).toBeVisible();
});

test('the service lock holds: Space on the padlock, other pages, the box, a reload', async ({ page }) => {
  await djShow(page);
  await page.locator('.live').getByRole('button', { name: 'Lock page' }).click();
  const now = page.locator('.strip .now');
  await expect(now).toContainText('(nothing)');
  // holding Space on the padlock unlocks it, and plays nothing (no GO, no repeats)
  const lock = page.locator('.live').getByRole('button', { name: /Unlock page/ });
  await lock.focus();
  const cdp = await page.context().newCDPSession(page);
  const space = (type: 'keyDown' | 'keyUp', autoRepeat = false) => cdp.send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32, autoRepeat });
  await space('keyDown');
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(150); await space('keyDown', true); }
  await space('keyUp');
  await expect(page.locator('.live').getByRole('button', { name: 'Lock page' })).toBeVisible();
  await expect(now).toContainText('(nothing)');
  // a held Space on the page is one GO, not a run through the list
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await space('keyDown'); for (let i = 0; i < 5; i++) await space('keyDown', true); await space('keyUp');
  await expect(now).toContainText('1.');
  // locked again: another page is locked too, the box can't be removed, a reload comes back locked in Live
  await page.locator('.live').getByRole('button', { name: 'Lock page' }).click();
  await expect(page.getByRole('button', { name: /Remove 127/ })).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('.live')).toBeVisible();
  await expect(page.locator('.top .lockedname')).toBeVisible();
});

test('Drop on a rig with no strobes: every light strobes (lights without a strobe channel blink their level)', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  const drop = page.locator('.live .tile', { hasText: 'Drop' });
  await drop.hover(); await page.mouse.down();
  const seen = new Set<number>();
  for (let i = 0; i < 20; i++) { seen.add((await channels(0, 1))[0]); await page.waitForTimeout(37); }
  await page.mouse.up();
  expect([...seen]).toEqual(expect.arrayContaining([0, 255]));
});

test('Drop: everything white, the strobe going and a fog burst while held, all gone on release', async ({ page }) => {
  await djShow(page);
  await page.locator('.live .tile.cue').nth(1).click();                       // Red / blue
  await expect.poll(async () => (await channels(0, 3))).not.toEqual([255, 255, 255]);
  const drop = page.locator('.live .tile', { hasText: 'Drop' });
  await drop.hover(); await page.mouse.down();
  await expect.poll(async () => { const c = await channels(0, 91); return [c[0], c[1], c[2], c[88], c[89] > 0, c[90]]; }).toEqual([255, 255, 255, 255, true, 255]);
  await page.mouse.up();
  await expect.poll(async () => { const c = await channels(0, 91); return [c[0] === 255 && c[1] === 255 && c[2] === 255, c[90]]; }).toEqual([false, 0]);
  // the Blinder: white only
  const blinder = page.locator('.live .tile', { hasText: 'Blinder' });
  await blinder.hover(); await page.mouse.down();
  await expect.poll(async () => { const c = await channels(0, 91); return [c[3], c[4], c[5], c[90]]; }).toEqual([255, 255, 255, 0]);
  await page.mouse.up();
});

test('a page made your own says what is new in the show, and adds it in one tap (Undo takes it back)', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.locator('.live').getByRole('button', { name: 'Edit' }).click();
  await page.locator('.live .tile.cue').first().focus();
  await page.keyboard.press('Alt+ArrowRight');                                       // the page is yours now
  await page.locator('.live').getByRole('button', { name: /Done/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.pages.length)).toBe(1);
  await expect(page.locator('.live .chip.fresh')).toHaveCount(0);
  // a new cue list in Program (a new look goes on the page by itself, next to its neighbours)
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  const lists = await page.evaluate(() => (window as any).__luxdmx.show.cueLists.length as number);
  await page.locator('.deck .tabs > button.ghost').last().click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.cueLists.length)).toBe(lists + 1);
  const n = await page.evaluate(() => (window as any).__luxdmx.show.pages[0].widgets.length);
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('.live .chip.fresh')).toContainText('1 new in the show');
  await page.locator('.live .chip.fresh').click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.pages[0].widgets.length)).toBe(n + 1);
  await expect(page.locator('.live .chip.fresh')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.pages[0].widgets.length)).toBe(n);
});
