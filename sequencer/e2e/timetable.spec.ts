// The timetable (the bar persona): looks by the clock, a tablet switched on later picking up what
// should be on, and the next change on the Live header. Measured on the engine and the wire.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, channels, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const live = (page: Page) => page.evaluate(() => { const a = (window as any).__luxdmx; const l = a.show.cueLists[0]; const st = a.engine.status(l.id); return st.running ? l.cues[st.index].name : ''; });

test('a time that comes plays its look; a later one shows as next; switched on later it picks up what should be on', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
  await page.locator('body').press('Control+k');
  await page.getByRole('dialog', { name: 'Find anything' }).getByRole('combobox').fill('schedule');
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog', { name: 'Timetable' });
  await dlg.getByRole('button', { name: 'Add a time' }).click();
  await dlg.getByRole('button', { name: 'Add a time' }).click();
  const [second] = await page.evaluate(() => (window as any).__luxdmx.show.cueLists[0].cues.slice(1, 3).map((c: any) => c.name));
  // the first comes in a minute (it plays the second look); the second in two hours
  const now = new Date(), soon = new Date(now.getTime() + 60e3), later = new Date(now.getTime() + 2 * 3600e3);
  await page.evaluate(({ a, b }) => {
    const app = (window as any).__luxdmx, l = app.show.cueLists[0], [e1, e2] = app.show.settings.schedule;
    e1.at = a; e1.do = { do: 'goto', list: l.id, cue: l.cues[1].id };
    e2.at = b; e2.do = { do: 'goto', list: l.id, cue: l.cues[2].id };
    app.markDirty(0);
  }, { a: hhmm(soon), b: hhmm(later) });
  await expect(dlg).toContainText('Next:');
  await page.keyboard.press('Escape');
  // editing it fired nothing; the clock passing the minute does (the app's own check, given that time)
  await page.waitForTimeout(5500);
  expect(await live(page)).not.toBe(second);
  await page.evaluate((t) => (window as any).__luxdmx.runSchedule(new Date(t)), soon.getTime() - soon.getSeconds() * 1000 + 3000);
  await expect.poll(() => live(page), { timeout: 8000 }).toBe(second);
  await expect(page.locator('.toast')).toContainText('(the timetable)');
  await expect.poll(async () => (await channels(0, 8)).some((v) => v > 0)).toBe(true);
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('.live .chip.nextup')).toContainText(second);    // (by the real clock it's still a minute away)
  // the tablet is switched off and on again (a fresh start, not a reload): the look comes back by itself
  await page.waitForTimeout(800);
  await page.goto('about:blank');
  await page.goto('/');
  await expect.poll(() => live(page), { timeout: 10000 }).toBe(second);
});

test('timetable rows stay where they are while you edit them (sorted again next time)', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
  await page.locator('body').press('Control+k');
  await page.getByRole('dialog', { name: 'Find anything' }).getByRole('combobox').fill('schedule');
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog', { name: 'Timetable' });
  await dlg.getByRole('button', { name: 'Add a time' }).click();
  await dlg.getByRole('button', { name: 'Add a time' }).click();
  const times = dlg.getByLabel('Time', { exact: true });
  await times.first().fill('23:00'); await times.first().press('Tab');
  await expect(times.first()).toHaveValue('23:00');                         // still the first row
  await dlg.getByRole('button', { name: 'Su' }).first().click();            // and this tap lands on it
  const days = await page.evaluate(() => (window as any).__luxdmx.show.settings.schedule.map((e: any) => e.days ?? null));
  expect(days[0]).toEqual([0]);
  await page.keyboard.press('Escape');
  await page.locator('body').press('Control+k');
  await page.getByRole('dialog', { name: 'Find anything' }).getByRole('combobox').fill('schedule');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Timetable' }).getByLabel('Time', { exact: true }).last()).toHaveValue('23:00');   // sorted when opened again
});

test('a new row takes the days of the one above; the last day says so in its row; right-click duplicates, Delete removes', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
  await page.locator('body').press('Control+k');
  await page.getByRole('dialog', { name: 'Find anything' }).getByRole('combobox').fill('schedule');
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog', { name: 'Timetable' });
  const sched = () => page.evaluate(() => (window as any).__luxdmx.show.settings.schedule.map((e: any) => ({ at: e.at, days: e.days ?? null })));
  await dlg.getByRole('button', { name: 'Add a time' }).click();
  const row = dlg.locator('.ent');
  await row.first().getByRole('button', { name: 'Su' }).click();               // Sundays only
  await row.first().getByRole('button', { name: 'Su' }).click();               // the last day can't go: said right there
  await expect(row.first().getByRole('status')).toContainText('At least one day');
  await dlg.getByRole('button', { name: 'Add a time' }).click();                // another Sunday, an hour later
  const [a, b] = await sched();
  expect(b.days).toEqual([0]);
  expect(Number(b.at.slice(0, 2))).toBe((Number(a.at.slice(0, 2)) + 1) % 24);
  await row.nth(1).click({ button: 'right', position: { x: 4, y: 4 } });
  await page.locator('.ctx').getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(row).toHaveCount(3);
  expect((await sched())[2]).toEqual(b);
  await row.nth(2).getByRole('combobox', { name: 'What happens' }).focus();
  await page.keyboard.press('Delete');
  await expect(row).toHaveCount(2);
  await page.keyboard.press('Control+z');                                       // (undo brings it back)
  await expect(row).toHaveCount(3);
});

test('at sunset: the time moves with the sun, for the show\'s place (the device\'s location or typed in); the clock passing it plays the look', async ({ page, context }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
  await page.locator('body').press('Control+k');
  await page.getByRole('dialog', { name: 'Find anything' }).getByRole('combobox').fill('schedule');
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog', { name: 'Timetable' });
  await dlg.getByRole('button', { name: 'Add a time' }).click();
  await dlg.getByRole('combobox', { name: 'When' }).selectOption('set');
  await dlg.getByRole('combobox', { name: 'Before or after' }).selectOption({ label: '30 min after' });
  await expect(dlg.locator('.place')).toContainText('guessed from the time zone');
  // typed in: Berlin
  await dlg.getByRole('button', { name: 'Type it in' }).click();
  await page.getByRole('dialog', { name: 'Where is the show?' }).getByRole('textbox').fill('52.52, 13.40');
  await page.getByRole('dialog', { name: 'Where is the show?' }).getByRole('button', { name: 'Use it' }).click();
  await expect(dlg.locator('.place')).not.toContainText('guessed');
  // the device's location (rounded to about a kilometre)
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 48.137154, longitude: 11.576124 });
  await dlg.getByRole('button', { name: 'Use this device\'s location' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.settings.place)).toMatchObject({ lat: 48.14, lon: 11.58 });
  const e = await page.evaluate(() => (window as any).__luxdmx.show.settings.schedule[0]);
  expect(e).toMatchObject({ sun: 'set', offset: 30 });
  const today = await dlg.locator('.today').textContent();
  expect(today).toMatch(/^\d\d:\d\d$/);
  expect(e.at).toBe(today);                                                   // (what an older app plays)
  // the clock passing it plays its look
  await page.keyboard.press('Escape');
  const at = await page.evaluate((hhmm) => { const d = new Date(); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 3, 0); return d.getTime(); }, today!);
  await page.evaluate((t) => { const a = (window as any).__luxdmx; a.schedLast = t - 10_000; a.runSchedule(new Date(t)); }, at);
  await expect(page.locator('.toast')).toContainText(`${today}:`);
});

test('a party tonight: right-click the next-up chip, skip tonight; nothing plays by the clock till 06:00, then it plays again', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
  const soon = new Date(Date.now() + 60e3);
  await page.evaluate((a) => {
    const app = (window as any).__luxdmx, l = app.show.cueLists[0];
    app.show.settings.schedule = [{ id: 'w', at: a, do: { do: 'goto', list: l.id, cue: l.cues[2].id } }];
    app.markDirty(0);
  }, hhmm(soon));
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.locator('.live .tile.cue').first().click();                   // the party look
  const party = await live(page);
  await page.locator('.live .chip.nextup').click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: /Skip tonight/ }).click();
  await expect(page.locator('.live .chip.nextup')).toContainText('Paused till 06:00');
  await page.evaluate((t) => { const a = (window as any).__luxdmx; a.schedLast = t - 10_000; a.runSchedule(new Date(t)); }, soon.getTime() + 3000);
  await page.waitForTimeout(300);
  expect(await live(page)).toBe(party);
  // the dialog says so, and plays it again from its menu
  await page.locator('.live .chip.nextup').click();
  const dlg = page.getByRole('dialog', { name: 'Timetable' });
  await expect(dlg.getByRole('status').filter({ hasText: 'Paused until 06:00' })).toBeVisible();
  await dlg.getByRole('button', { name: 'Paused' }).click();
  await page.locator('.ctx').getByRole('menuitem', { name: 'Play the timetable again now' }).click();
  await expect(dlg.getByRole('status').filter({ hasText: 'Paused until' })).toHaveCount(0);
});
