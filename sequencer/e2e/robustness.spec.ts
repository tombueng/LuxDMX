// Things that must not go wrong in front of an audience (from the independent code review):
// a show from a newer version is never overwritten, deleting the open show deletes it, a blackout
// cue holds, a held flash can't stay on, undo brings a box back with its connection.
import { FAKE, jumpTo, openConnected, resetFake, patch, channels, selectAll, intensity, record, cues, fresh, go, test, expect, addDevice, fixturesOnStage, welcomeDialog, showBoxes, boxReady, startTemplate } from './helpers';

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
  await startTemplate(page, 'Church');
  await page.locator('.top .show').click();
  await expect(m.locator('.card')).toHaveCount(1);         // (the empty first show went when the template opened)
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
  await startTemplate(page, 'DJ / Party');
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
    await startTemplate(page, t);
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
  await startTemplate(page, 'Band');
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
  await startTemplate(page, 'Theatre');
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
    const popup = (await addDevice(page, `127.0.0.1:${port}`))!;          // (Add opens the box's window at once)
    await showBoxes(page);
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
  await startTemplate(page, 'Theatre');
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

test('the box\'s window reloaded (F5 in it): the app takes it back by itself, the look goes out again', async ({ page }) => {
  await resetFake();
  const popup = await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await selectAll(page); await intensity(page, 1);
  await expect.poll(() => channels(0, 2)).toEqual([255, 255]);
  await popup.reload();
  // (it said "lost its connection and is trying again" for ever: the reloaded window waited for a hello)
  await resetFake();
  await expect.poll(() => channels(0, 2), { timeout: 15000 }).toEqual([255, 255]);
  await expect(page.locator('.dev.ready').or(page.locator('.top .boxes.ready')).first()).toBeVisible();
});

// Show night: the box drops off the network for a few seconds (its Wi-Fi, a cable), GO is pressed
// while it's gone. The app says so plainly, and once the box is back the lights get the look GO
// went to, by themselves: no click, no old frame.
test('the box off the network mid-show: said loudly, GO still counts, and the look GO went to goes out when it\'s back', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await selectAll(page); await intensity(page, 0.6); await record(page);
  await intensity(page, 0.2); await record(page);
  await jumpTo(page, 0);
  await expect.poll(async () => (await channels(0, 2))[0]).toBe(153);
  // off the network for 6 s
  await fetch(`http://${FAKE}/ws/test`, { method: 'POST', body: JSON.stringify({ down: 6000 }) });
  await expect(page.locator('.lost[role="alert"]')).toContainText("The lights aren't getting anything", { timeout: 4000 });
  await go(page);                                                             // (cue 2, while it's gone)
  await expect(page.locator('.deck .card.cur')).toContainText('2');
  // back: the alarm goes, and the lights get cue 2
  await expect(page.locator('.lost[role="alert"]')).toHaveCount(0, { timeout: 15000 });
  await expect.poll(async () => (await channels(0, 2))[0], { timeout: 5000 }).toBe(51);
  // and Blackout pressed while it's gone holds when it's back
  await fetch(`http://${FAKE}/ws/test`, { method: 'POST', body: JSON.stringify({ down: 4000 }) });
  await expect(page.locator('.lost[role="alert"]')).toBeVisible({ timeout: 4000 });
  await page.locator('.top').getByRole('button', { name: 'Blackout' }).click();
  await expect(page.locator('.lost[role="alert"]')).toHaveCount(0, { timeout: 15000 });
  await expect.poll(async () => (await channels(0, 2))[0], { timeout: 5000 }).toBe(0);
});

// Two tabs on the same show (a bookmark opened twice): the last one to save wins. The tab whose
// copy is out of date says so, and a tap takes the other tab's version instead of saving over it.
test('two tabs on one show: the out-of-date one says "changed in another tab" and takes that version on a tap', async ({ page, context }) => {
  await fresh(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await page.waitForTimeout(800);                                             // (saved)
  const b = await context.newPage();
  await b.goto('/');
  await expect(fixturesOnStage(b)).toHaveCount(2);
  const chip = page.locator('.top').getByRole('button', { name: 'changed in another tab' });
  await page.waitForTimeout(1500);
  await expect(chip).toHaveCount(0);                                          // (only opened there: nothing changed)
  // a change in B: A's copy is out of date now
  await patch(b, 'gen-dimmer', 1, 0, 'From B');
  await expect(chip).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.top .saved')).toHaveCount(0);                   // (not "saved" beside it)
  expect(await page.locator('.top .show .name').evaluate((n) => n.getBoundingClientRect().width)).toBeGreaterThan(20);   // (the name kept, not 0 px)
  await expect(b.locator('.top').getByRole('button', { name: 'changed in another tab' })).toHaveCount(0);
  await chip.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Take it' }).click();
  await expect(fixturesOnStage(page)).toHaveCount(3);                         // B's light is here too
  await expect(chip).toHaveCount(0);
  // the other way round: a change in A now makes B the out-of-date one
  await patch(page, 'gen-dimmer', 1, 0, 'From A');
  await expect(b.locator('.top').getByRole('button', { name: 'changed in another tab' })).toBeVisible({ timeout: 5000 });
  // B saw A saving: it says the show is open elsewhere too. A closed: that warning goes
  const c = await context.newPage();
  await c.goto('/');
  await expect(fixturesOnStage(c)).toHaveCount(4);
  await patch(c, 'gen-dimmer', 1, 0, 'From C');
  await expect(page.locator('.top').getByText(/open in another tab|changed in another tab/).first()).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'changed in another tab' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Take it' }).click();
  await expect(page.locator('.top').getByText('open in another tab')).toBeVisible({ timeout: 5000 });
  await b.close(); await c.close();
  await expect(page.locator('.top').getByText('open in another tab')).toHaveCount(0, { timeout: 5000 });
});

// The browser keeps nothing (its storage full, or blocked): said in red, with the way out, not a
// "saving…" that never ends while the work is lost on the next reload.
test('a browser that keeps nothing says "not saved" and how to keep the show, and "saved" once it keeps it again', async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => {
    const w = window as any;
    w.__realTx = IDBDatabase.prototype.transaction; w.__realSet = Storage.prototype.setItem;
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, s: any, m?: any) { if (m === 'readwrite') throw new DOMException('full', 'QuotaExceededError'); return w.__realTx.call(this, s, m); } as any;
    Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };
  });
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  const saved = page.locator('.top .saved');
  await expect(saved).toHaveText('not saved', { timeout: 5000 });
  await expect(page.locator('.toast')).toContainText("isn't keeping the show");
  await expect(page.locator('.toast')).toContainText('Save as file');
  // room again: the next change is kept, and it says so
  await page.evaluate(() => { const w = window as any; IDBDatabase.prototype.transaction = w.__realTx; Storage.prototype.setItem = w.__realSet; });
  await patch(page, 'gen-dimmer', 1, 0, 'E');
  await expect(saved).toHaveText('saved', { timeout: 5000 });
  await page.reload();
  await expect(fixturesOnStage(page)).toHaveCount(3);
});

// A big rig: 320 lights, 40 cues. A Record took seconds (each card's picture looked every light up
// through the whole rig), adding 200 lights froze the page for 12 s. Generous bounds: a busy test
// machine passes, the old ways don't.
test('a big rig stays quick: Record and adding lights take moments, not seconds', async ({ page }) => {
  test.setTimeout(180000);
  await fresh(page);
  const addMs = await page.evaluate(() => {
    const a = (window as any).__luxdmx, t = performance.now();
    a.addFixtures('gen-dimmer', '', 175, 0, 'D'); a.addFixtures('gen-rgbw', '', 145, 1, 'P');
    return performance.now() - t;
  });
  expect(addMs).toBeLessThan(3000);
  await page.evaluate(() => {
    const a = (window as any).__luxdmx;
    a.selectAll();
    for (let i = 0; i < 40; i++) { a.set({ intensity: ((i % 10) + 1) / 10 }); a.record(undefined, { fade: 0 }); }
  });
  await expect(cues(page)).toHaveCount(40);
  await page.waitForTimeout(1000);
  await page.evaluate(() => (window as any).__luxdmx.set({ intensity: 0.33 }));
  const t = Date.now();
  await record(page);
  await expect(cues(page)).toHaveCount(41);
  await expect(page.locator('.top .saved')).toHaveText('saved');
  expect(Date.now() - t).toBeLessThan(4000);                                   // (it took 5 s; a busy machine running two test runs took 3.4 s)
});

// 19 different edits (lights, groups, cues, an effect, lists, moves, renames, removals), then Undo
// until it can't and Redo until it can't: exactly the start and exactly the end, every state between
// one the session went through.
test('a long session: undo all the way back is the empty show, redo all the way forward the same show again', async ({ page }) => {
  test.setTimeout(240000);
  await fresh(page);
  const res = await page.evaluate(async () => {
    const a = (window as any).__luxdmx;
    const tick = () => new Promise((r) => setTimeout(r, 30));
    const snaps: string[] = [];
    const snap = () => { a.checkpoint(); snaps.push(a.lastSnap); };
    snap();
    const steps: [string, () => unknown][] = [
      ['add 8 RGB', () => a.addFixtures('gen-rgb', '', 8, 0, 'Par')],
      ['add 4 dimmers', () => a.addFixtures('gen-dimmer', '', 4, 0, 'Dim')],
      ['add 2 movers', () => a.addFixtures('gen-mover8', '', 2, 1, 'Head')],
      ['select pars', () => { a.selected = a.show.fixtures.filter((f: any) => f.name.startsWith('Par')).map((f: any) => f.id); }],
      ['group pars', () => a.groupFromSelection('Pars')],
      ['red', () => a.set({ intensity: 1, color: { r: 1, g: 0, b: 0 } })],
      ['record 1', () => a.record()],
      ['blue', () => a.set({ intensity: 0.5, color: { r: 0, g: 0, b: 1 } })],
      ['record 2', () => a.record()],
      ['select all', () => a.selectAll()],
      ['group all', () => a.groupFromSelection('All of them')],
      ['50%', () => a.set({ intensity: 0.5 })],
      ['record 3', () => { a.record(); a.selected = []; a.programmer = {}; }],
      ['effect', () => a.addEffect('rainbow', { fixtures: a.show.fixtures.filter((f: any) => f.name.startsWith('Par')).map((f: any) => f.id) })],
      ['move a light', () => a.moveFixture(a.show.fixtures[0].id, 0.2, 0.3)],
      ['rename cue', () => { a.checkpoint(); a.show.cueLists[0].cues[0].name = 'Opening'; }],
      ['remove a dimmer', () => a.removeFixtures([a.show.fixtures.find((f: any) => f.name === 'Dim 2').id])],
      ['remove group', () => a.removeGroup(a.show.groups[0].id)],
      ['new list', () => a.newList('Second')],
      ['record into second', () => { a.selected = [a.show.fixtures[1].id]; a.set({ intensity: 0.3 }); a.record(); }],
      ['remove cue 2 of list 1', () => a.removeCue(a.show.cueLists[0].id, 1)],
      ['fixture rename', () => { a.checkpoint(); a.show.fixtures[2].name = 'Center'; }],
      ['add 3 more', () => a.addFixtures('gen-rgbw', '', 3, 1, 'W')],
      ['move another', () => a.moveFixture(a.show.fixtures[5].id, 0.7, 0.8)],
    ];
    const done: string[] = [];
    for (const [name, f] of steps) { await f(); await tick(); a.checkpoint(); if (a.lastSnap !== snaps[snaps.length - 1]) { snaps.push(a.lastSnap); done.push(name); } }
    const final = a.lastSnap;
    const back: string[] = [];
    let n = 0;
    while (a.canUndo && n < 200) { a.undo(); await tick(); a.checkpoint(); back.push(a.lastSnap); n++; }
    const atStart = a.lastSnap === snaps[0];
    let m = 0;
    while (a.canRedo && m < 200) { a.redo(); await tick(); m++; }
    a.checkpoint();
    const atEnd = a.lastSnap === final;
    // which undo states don't match a recorded snapshot
    const strays = back.filter((b) => !snaps.includes(b)).length;
    const diff = (x: string, y: string) => { let i = 0; while (i < x.length && x[i] === y[i]) i++; return x.slice(Math.max(0, i - 60), i + 80) + ' ||| ' + y.slice(Math.max(0, i - 60), i + 80); };
    return { steps: done.length, snaps: snaps.length, undos: n, redos: m, atStart, atEnd, strays, startDiff: atStart ? '' : diff(a.lastSnap === final ? back[back.length - 1] : back[back.length - 1], snaps[0]), endDiff: atEnd ? '' : diff(a.lastSnap, final) };
  });
  expect(res.atStart).toBe(true);
  expect(res.atEnd).toBe(true);
  expect(res.strays).toBe(0);
});

// The fine print of two tabs: what one tab writes is fingerprinted as written (a field the file
// fixes doesn't count as a change), an undone change takes the warning back, and a version this
// tab can't read is said, not swallowed.
test('two tabs: no false alarm, the alarm goes when the change is undone, an unreadable version is said', async ({ page, context }) => {
  await fresh(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  // a show from an older app (the file says this one's name, the live show still the old)
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.show.meta.app = 'LuxDMX Sequencer 0.1'; a.checkpoint(); });
  await page.waitForTimeout(800);
  const chip = page.locator('.top').getByRole('button', { name: 'changed in another tab' });
  const b = await context.newPage();
  await b.goto('/');
  await expect(fixturesOnStage(b)).toHaveCount(2);
  await page.waitForTimeout(1500);
  await expect(chip).toHaveCount(0);                                          // (nothing changed)
  // a change over there, then undone: the warning comes and goes
  await patch(b, 'gen-dimmer', 1, 0, 'B');
  await expect(chip).toBeVisible({ timeout: 5000 });
  await b.evaluate(() => (window as any).__luxdmx.undo());
  await expect(chip).toHaveCount(0, { timeout: 5000 });
  // a version from a newer app over there: taking it is refused, with a word
  await b.evaluate(() => { const a = (window as any).__luxdmx; a.checkpoint(); a.show.requiredFeatures = ['from-the-future']; a.show.fixtures[0].name = 'Future'; a.checkpoint(); });
  await expect(chip).toBeVisible({ timeout: 5000 });
  await chip.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Take it' }).click();
  await expect(page.locator('.toast')).toContainText("Couldn't take the other tab's version");
  await expect(fixturesOnStage(page)).toHaveCount(2);                         // (this tab's show as it was)
  await b.close();
});

// Venue Wi-Fi: a box that's connected but answers slowly, or hardly at all, looked perfectly healthy
// while the lights got a look every few seconds. It's said in orange; a box back after a drop shows
// green in the same place for a while (a flapping link doesn't push the page up and down); the
// DMX output's universe dot doesn't say "sending" while nothing goes out.
test('a slow or stalled box is said; a box back stays in the same place, green; the universe dot tells the truth', async ({ page }) => {
  test.setTimeout(150_000);
  await openConnected(page);
  await patch(page, 'gen-dimmer', 4, 0, 'D');
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.addEffect('chase', { fixtures: a.show.fixtures.map((f: any) => f.id) }); });
  const ws = (b: object) => fetch(`http://${FAKE}/ws/test`, { method: 'POST', body: JSON.stringify(b) });
  await expect(page.locator('.lost.slow')).toHaveCount(0);
  await ws({ ackDelay: 1000 });
  await expect(page.locator('.lost.slow')).toContainText('answers slowly', { timeout: 10000 });
  await ws({ ackDelay: 0 });
  await expect(page.locator('.lost.slow')).toHaveCount(0, { timeout: 10000 });
  await ws({ noAck: true });
  await expect(page.locator('.lost.slow')).toContainText(/answers slowly|hardly answers/, { timeout: 12000 });
  await ws({ noAck: false });
  await expect(page.locator('.lost.slow')).toHaveCount(0, { timeout: 12000 });
  // off the network: red, the dot orange; back: green where the red was
  await ws({ down: 3000 });
  await expect(page.locator('.lost[role="alert"]')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('.dmx .u', { hasText: 'U0' })).toHaveAttribute('title', /no connected box plays it/);
  const goAt = async () => (await page.locator('.side .tabs').boundingBox())!.y;
  const yLost = await goAt();
  await expect(page.locator('.lost.back')).toContainText('is back', { timeout: 15000 });
  expect(Math.abs((await goAt()) - yLost)).toBeLessThan(2);                     // (nothing moved)
  await expect(page.locator('.dmx .u', { hasText: 'U0' })).toHaveAttribute('title', /sending/);
});

// Two boxes, one off the network: the bar says which universes get nothing (not "the lights": the
// other box's are fine), and which box, by its address too when both have the same name.
test('two boxes, one gone: the bar names its universes and the box by its address', async ({ page }) => {
  test.setTimeout(120_000);
  const { spawn } = await import('node:child_process');
  const port2 = Number(FAKE.split(':')[1]) + 40, host2 = `127.0.0.1:${port2}`;
  const box2 = spawn('node', ['test/fake-luxdmx.mjs', String(port2), '2'], { stdio: 'ignore', detached: true });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://${host2}/info.json`); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openConnected(page);
    const popup = (await addDevice(page, host2))!;
    await popup.locator('#allow').click();
    await expect(page.locator('.dev.ready')).toHaveCount(2);
    await fetch(`http://${FAKE}/ws/test`, { method: 'POST', body: JSON.stringify({ down: 6000 }) });
    const bar = page.locator('.lost[role="alert"]');
    await expect(bar).toContainText("Universes 0, 1 aren't getting anything", { timeout: 5000 });
    await expect(bar).toContainText(`(${FAKE})`);                                // (both are "Fake LuxDMX")
    await expect(bar).not.toContainText("The lights aren't getting anything");
  } finally { try { process.kill(-box2.pid!); } catch { /* gone */ } }
});

// Playing the show isn't editing it: GO, Space and a Live button don't book a compare of the whole
// show afterwards (on the big demo a tenth of a second after every GO); a click that may edit does.
test('GO, Space and Live buttons book no save; a click that may edit does', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.selectAll(); for (const v of [0.3, 0.7]) { a.set({ intensity: v }); a.record(); } a.programmer = {}; a.selected = []; });
  await page.waitForTimeout(600);
  const pending = () => page.evaluate(() => (window as any).__luxdmx.savePending as boolean);
  expect(await pending()).toBe(false);
  await page.locator('.deck').getByRole('button', { name: /^GO/ }).click();
  expect(await pending()).toBe(false);
  await page.locator('body').press('Space');
  expect(await pending()).toBe(false);
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.waitForTimeout(600);
  await page.locator('.live .tile').filter({ hasText: 'Cue 1' }).first().click();
  expect(await pending()).toBe(false);
  await page.locator('.top .modes').getByRole('tab', { name: 'Program' }).click();
  await page.waitForTimeout(600);
  await page.locator('.fl li.oitem').first().click();
  expect(await pending()).toBe(true);                                         // (a click that may change something)
});
