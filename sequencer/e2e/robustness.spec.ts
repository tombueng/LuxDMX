// Things that must not go wrong in front of an audience (from the independent code review):
// a show from a newer version is never overwritten, deleting the open show deletes it, a blackout
// cue holds, a held flash can't stay on, undo brings a box back with its connection.
import { openConnected, resetFake, patch, channels, selectAll, intensity, record, cues, fresh, go, test, expect, addDevice, fixturesOnStage, welcomeDialog, showBoxes, boxReady } from './helpers';

test.beforeEach(async () => { await resetFake(); });

test('a show this version cannot read is kept, and a new show opens next to it', async ({ page }) => {
  await fresh(page);
  const future = JSON.stringify({ format: 'luxdmx-show', formatVersion: '9.0.0', minReaderVersion: '9.0.0', requiredFeatures: [], meta: { name: 'From the future' } });
  // (planted as the next page starts: the page that's open saves its own show as it goes, and a
  // save after the plant would put it back)
  await page.addInitScript((t) => {
    if (sessionStorage.getItem('planted')) return;
    sessionStorage.setItem('planted', '1');
    localStorage.setItem('luxdmx.seq.show', t); localStorage.setItem('luxdmx.seq.show.id', 'sFUTURE'); localStorage.setItem('luxdmx.seq.current', 'sFUTURE');
  }, future);
  await page.reload();
  await expect(page.locator('.toast')).toContainText("can't be opened by this version");
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => localStorage.getItem('luxdmx.seq.show.unreadable'))).toContain('From the future');
  expect(await page.evaluate(() => localStorage.getItem('luxdmx.seq.current'))).not.toBe('sFUTURE');
});

test('deleting the show that is open deletes it', async ({ page }) => {
  await fresh(page);
  await page.locator('.top .show').click();
  const m = page.getByRole('dialog', { name: 'Shows' });
  await m.locator('.tpl').filter({ hasText: 'Church' }).click();
  await page.locator('.top .show').click();
  await expect(m.locator('.card')).toHaveCount(2);
  await m.getByRole('button', { name: 'Delete Sunday service' }).click();
  await page.getByRole('dialog', { name: 'Delete "Sunday service"?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(m.locator('.card .title', { hasText: 'Sunday service' })).toHaveCount(0);
  await page.waitForTimeout(800);
  await page.reload();
  // (what opens instead is a new, empty show: the welcome comes up for it)
  await expect(welcomeDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.top .show').click();
  await expect(m.locator('.card .title', { hasText: 'Sunday service' })).toHaveCount(0);
});

test('a blackout cue action from GO holds', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 1, 0, 'D');
  await selectAll(page); await intensity(page, 1); await record(page);
  await selectAll(page); await intensity(page, 0.5); await record(page);
  await cues(page).nth(1).click();
  await page.locator('.insp').getByRole('button', { name: 'action' }).click();
  await page.locator('.insp').getByLabel('Action', { exact: true }).selectOption('blackout');
  await cues(page).nth(0).dblclick();
  await expect.poll(() => channels(0, 1)).toEqual([255]);
  await go(page);
  await page.waitForTimeout(600);
  expect(await channels(0, 1)).toEqual([0]);
  await expect(page.locator('.top').getByRole('button', { name: 'Blackout' })).toHaveClass(/\bon\b/);
});

test('a flash held while leaving the live page lets go', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.keyboard.down('z');
  await expect.poll(() => channels(0, 3)).toEqual([255, 255, 255]);
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  await expect.poll(() => channels(0, 3)).toEqual([0, 0, 0]);
  await page.keyboard.up('z');
});

test('undo brings a removed box back', async ({ page }) => {
  await openConnected(page);
  await page.waitForTimeout(500);
  await showBoxes(page);
  await page.locator('.dev').getByRole('button', { name: /^Remove/ }).click();
  await expect(page.locator('.dev')).toHaveCount(0);
  await page.locator('body').press('Escape');
  await page.locator('body').press('Control+z');
  await showBoxes(page);
  await expect(page.locator('.dev')).toHaveCount(1);
});

test('open a show from the manager and reload: it stays that show (no overwrite)', async ({ page }) => {
  await openConnected(page);
  const m = page.getByRole('dialog', { name: 'Shows' });
  for (const t of ['Church', 'Cinema']) {
    await page.locator('.top .show').click();
    await m.locator('.tpl').filter({ hasText: t }).click();
  }
  await expect(page.locator('.top .show .name')).toHaveText('Cinema');
  await page.waitForTimeout(600);
  await page.locator('.top .show').click();
  await m.locator('.card').filter({ has: page.locator('.title', { hasText: /^Sunday service$/ }) }).locator('.pic').click();
  await expect(page.locator('.top .show .name')).toHaveText('Sunday service');
  await page.reload();                                       // no edit in between
  await expect(page.locator('.top .show .name')).toHaveText('Sunday service');
  await page.locator('.top .show').click();
  await expect(m.locator('.card .title', { hasText: /^Cinema$/ })).toHaveCount(1);
  await expect(m.locator('.card .title', { hasText: /^Sunday service$/ })).toHaveCount(1);
});

test('a show too big for the quick copy still comes back whole after a reload', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Band' }).click();
  // make localStorage refuse anything big, like a full quota would
  await page.evaluate(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) { if (v.length > 2000) throw new DOMException('full', 'QuotaExceededError'); return orig.call(this, k, v); };
  });
  await page.locator('.top .show .name').click();
  await page.getByRole('dialog', { name: 'Shows' }).getByRole('button', { name: /^Rename Band night/ }).click();
  await page.getByRole('dialog', { name: 'Shows' }).getByLabel('Show name').fill('Big gig');
  await page.getByRole('dialog', { name: 'Shows' }).getByLabel('Show name').press('Enter');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => localStorage.getItem('luxdmx.seq.show'))).toBeNull();   // no stale copy left behind
  await page.reload();
  await expect(page.locator('.top .show .name')).toHaveText('Big gig');
});

test('a newer-version show in the browser database is not saved over either', async ({ page }) => {
  await fresh(page);
  // put a show "from the future" into IndexedDB as the open one, with no quick copy
  await page.evaluate(async () => {
    const future = JSON.stringify({ format: 'luxdmx-show', formatVersion: '9.0.0', minReaderVersion: '9.0.0', requiredFeatures: [], meta: { name: 'Future', modified: '2030-01-01' } });
    await new Promise<void>((ok) => {
      const r = indexedDB.open('luxdmx-sequencer', 3);
      r.onsuccess = () => {
        const t = r.result.transaction(['shows', 'meta'], 'readwrite');
        const meta = { id: 'sF', name: 'Future', modified: '2030-01-01', fixtures: 0, cues: 0, thumb: '' };
        t.objectStore('shows').put({ ...meta, json: future }); t.objectStore('meta').put(meta);
        t.oncomplete = () => { r.result.close(); ok(); };
      };
    });
    localStorage.setItem('luxdmx.seq.current', 'sF');
    localStorage.removeItem('luxdmx.seq.show'); localStorage.removeItem('luxdmx.seq.show.id');
  });
  await page.reload();
  await expect(page.locator('.toast')).toContainText("can't be opened by this version");
  await page.waitForTimeout(600);
  const still = await page.evaluate(() => new Promise<string>((ok) => {
    const r = indexedDB.open('luxdmx-sequencer', 3);
    r.onsuccess = () => { const g = r.result.transaction('shows').objectStore('shows').get('sF'); g.onsuccess = () => ok(g.result.json); };
  }));
  expect(still).toContain('"formatVersion":"9.0.0"');
});

test('the Undo in a message undoes that, and only while nothing else changed', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Theatre' }).click();
  await page.locator('.deck .tab', { hasText: 'House lights' }).click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: 'Delete the list' }).click();
  await expect(page.locator('.deck .tab', { hasText: 'House lights' })).toHaveCount(0);
  // something else changes before Undo is pressed
  await page.locator('.deck .card').first().click();
  await page.locator('.insp').getByLabel('Cue name').fill('Doors');
  await page.waitForTimeout(500);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.toast')).toContainText('Something else changed since');
  await expect(page.locator('.deck .card').first()).toContainText('Doors');              // the rename stays
});

test('Highlight goes off with Release all', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 1, 0, 'D');
  await page.locator('.prog').getByRole('button', { name: 'Highlight' }).click();
  await expect.poll(() => channels(0, 1)).toEqual([255]);
  await page.locator('body').press('Control+k');
  await page.getByRole('dialog', { name: 'Find anything' }).getByRole('combobox').fill('release everything');
  await page.getByRole('dialog', { name: 'Find anything' }).getByRole('combobox').press('Enter');
  await expect.poll(() => channels(0, 1)).toEqual([0]);
  await expect(page.locator('.prog').getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'false');
});

test('undo survives a reload', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await page.waitForTimeout(600);
  await patch(page, 'gen-dimmer', 1, 0, 'E');
  await page.waitForTimeout(800);
  await page.reload();
  await expect(fixturesOnStage(page)).toHaveCount(3);
  await page.locator('body').press('Control+z');
  await expect(fixturesOnStage(page)).toHaveCount(2);
});

test('a box that never answers says so instead of "opening" forever', async ({ page }) => {
  // a web server that is not a LuxDMX (or one with old firmware): /bridge is just a page
  const http = await import('node:http');
  const server = http.createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Not a LuxDMX</title>'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    await fresh(page);
    await addDevice(page, `127.0.0.1:${port}`);
    await showBoxes(page);
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('.dev').getByRole('button', { name: 'Connect' }).click()]);
    await expect(page.locator('.dev')).toContainText('opening');
    await expect(page.locator('.dev')).toContainText('no answer', { timeout: 12000 });
    await expect(page.locator('.dev.silent')).toHaveAttribute('title', /firmware/);
    await popup.close();
  } finally { server.close(); }
});

test('a reload in the middle of a show: the cue comes back and the box reconnects by itself', async ({ page }) => {
  await resetFake();
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await selectAll(page); await intensity(page, 0.6); await record(page);
  const clear = page.locator('.prog').getByRole('button', { name: 'Clear' });
  if (await clear.isVisible()) await clear.click();
  await go(page);
  await expect.poll(async () => (await channels(0, 2))[0]).toBe(153);
  // and the masters: grand master at half
  await page.locator('.top input[aria-label="Grand master"]').fill('0.5');
  await expect.poll(async () => (await channels(0, 2))[0]).toBe(77);
  await page.waitForTimeout(600);                        // the playing state is saved twice a second
  await page.reload();
  // no Connect click: the popup is still open and is taken back
  await expect(boxReady(page)).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('status')).toContainText('Picked up where it was');
  await expect(page.locator('.deck .card.cur')).toHaveCount(1);
  // and the box keeps getting the look, through the same grand master
  await resetFake();
  await expect.poll(async () => (await channels(0, 2))[0], { timeout: 4000 }).toBe(77);
  // blackout comes back too
  await page.locator('.top').getByRole('button', { name: 'Blackout' }).click();
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('.bo-frame')).toBeVisible();
  await expect.poll(async () => (await channels(0, 2))[0], { timeout: 4000 }).toBe(0);
});

test('a reload keeps the hands-off show going: the page, the song GO plays, Auto GO', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Theatre' }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  const lists = await page.evaluate(() => (window as any).__luxdmx.show.cueLists.map((l: any) => l.name) as string[]);
  const song = lists.find((n, i) => i > 0 && !/fog/i.test(n))!;
  expect(song, 'the template has a second list').toBeTruthy();
  await page.locator('.strip').getByLabel('Cue list for GO').selectOption({ label: song });
  await page.locator('.strip').getByLabel('Auto GO').selectOption('4');
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator('.live')).toBeVisible();
  await expect(page.locator('.strip').getByLabel('Cue list for GO')).toHaveValue(await page.evaluate((n) => (window as any).__luxdmx.show.cueLists.find((l: any) => l.name === n).id, song));
  await expect(page.locator('.strip').getByLabel('Auto GO')).toHaveValue('4');
  await expect(page.locator('.strip .gon')).toHaveText(song);
});

test('a change made by a click is saved within a second, with no further click (a browser killed then keeps it)', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 3, 0, 'D');                   // adding takes a checkpoint first, then the change
  await page.waitForTimeout(1200);
  const saved = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!, v = localStorage.getItem(k) ?? '';
      if (v.includes('"luxdmx-show"')) return (JSON.parse(v).fixtures ?? []).length;
    }
    return -1;
  });
  expect(saved).toBe(3);
});

test('undoing a new cue list goes back to the list that was there', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 1, 0, 'D');
  await selectAll(page); await intensity(page, 0.5); await record(page);
  await page.waitForTimeout(400);
  await page.locator('.deck').getByRole('button', { name: 'List', exact: true }).click();     // a second list, now open
  await expect(page.locator('.deck .card')).toHaveCount(0);
  await page.waitForTimeout(400);
  await page.locator('body').press('Control+z');
  await expect(page.locator('.deck .card')).toHaveCount(1);                                     // back on the first list
  await page.keyboard.press('Space');
  await expect.poll(async () => (await channels(0, 1))[0]).toBe(128);
});

test('a reload while a flash is held does not bring the flash back latched', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await selectAll(page); await intensity(page, 0.6); await record(page);
  const clear = page.locator('.prog').getByRole('button', { name: 'Clear' });
  if (await clear.isVisible()) await clear.click();
  // nothing playing; then hold the list as a flash (what a Flash pad does while pressed)
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.engine.stop(a.show.cueLists[0].id); });
  await expect.poll(async () => (await channels(0, 2))[0]).toBe(0);
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.engine.flash(a.show.cueLists[0].id, true); });
  await expect.poll(async () => (await channels(0, 2))[0]).toBe(153);
  await page.waitForTimeout(700);
  await page.reload();
  await expect(boxReady(page)).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1000);
  expect((await channels(0, 2))).toEqual([0, 0]);
  await expect(page.locator('.deck .card.cur')).toHaveCount(0);
});
