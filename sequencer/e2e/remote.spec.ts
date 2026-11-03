// A phone as a remote: the laptop's show, played from the box's own /remote page through the /ws
// relay (the fake box passes relay messages on like the firmware does: to the other clients that
// asked for them). Taps, GO, blackout, a fader, holding, the code, guests, and the safety rules:
// a phone that goes quiet, leaves, or has its page redrawn under the finger lets go of what it held.
import type { Browser, Page } from '@playwright/test';
import WebSocket from 'ws';
import { FAKE, openConnected, resetFake, channels, fresh, test, expect } from './helpers';

const tile = (page: Page, text: string) => page.locator('.live .tile', { hasText: text }).first();
const phoneTile = (phone: Page, text: string) => phone.locator('#grid .tile', { hasText: text }).first();
const appState = <T>(page: Page, f: (a: any) => T) => page.evaluate((src) => (0, eval)(src)((window as any).__luxdmx), f.toString()) as Promise<T>;

async function laptopWithRemote(page: Page) {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.locator('.live').getByRole('button', { name: 'Phone as a remote' }).click();
  const dlg = page.getByRole('dialog', { name: 'Phone as a remote' });
  await dlg.getByRole('button', { name: 'Switch the phone remote on' }).click();
  await expect(dlg.locator('.qr svg')).toBeVisible();
  const code = (await dlg.locator('.code').textContent())!.trim();
  expect(code).toMatch(/^\d{4}$/);
  await expect(dlg).toContainText(`http://${FAKE}/remote`);
  return { dlg, code };
}
async function phoneFor(browser: Browser, code: string, touch = false) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: touch, isMobile: touch });
  const phone = await ctx.newPage();
  await phone.goto(`http://${FAKE}/remote#k=${code}`);
  return phone;
}
// A raw client on the box's /ws, like a phone page that stops talking at the worst moment.
async function rawClient(listen = false) {
  const ws = new WebSocket(`ws://${FAKE}/ws`);
  await new Promise((r) => ws.once('open', r));
  if (listen) ws.send('{"type":"relay"}');
  return ws;
}
const relay = (ws: WebSocket, m: Record<string, unknown>) => ws.send(JSON.stringify({ relay: m }));
// how many look buttons the page has: the template's looks (the generated page shows up to 48)
const looks = (page: Page) => page.evaluate(() => Math.min(48, (window as any).__luxdmx.show.cueLists[0].cues.length as number));
async function holdOn(phone: Page, text: string) {
  const t = phoneTile(phone, text);
  await t.scrollIntoViewIfNeeded();
  await t.hover();
  await phone.mouse.down();
}

test.beforeEach(async () => { await resetFake(); });

test('a phone plays the live page: the same buttons, taps, GO, blackout, a fader, tap tempo', async ({ page, browser }) => {
  const { dlg, code } = await laptopWithRemote(page);
  const phone = await phoneFor(browser, code);
  // it draws the laptop's page: the show's name, its looks with their colours and numbers, effects with theirs
  await expect(phone.locator('#show')).toHaveText(await appState(page, (a) => a.show.meta.name));
  await expect(phone.locator('#status')).toHaveText('On stage');
  await expect(phone.locator('#grid .tile.cue')).toHaveCount(await looks(page));
  await expect(phone.locator('#grid .tile.cue .pic').first()).toBeVisible();
  await expect(phone.locator('#grid .tile.cue .num').first()).toHaveText('1');
  await expect(phone.locator('#grid .tile.effect')).toHaveCount(await page.evaluate(() => (window as any).__luxdmx.show.effects.length as number));
  await expect(phone.locator('#grid .tile.effect .dots').first()).toBeVisible();
  await expect(dlg.locator('.ph')).toHaveCount(1);
  await expect(dlg.locator('.ph')).toContainText('Browser');
  await expect(page.locator('.toast')).toContainText('joined the remote');
  // once a phone is on, the code folds away
  await expect(dlg.locator('.qr')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.live').getByRole('button', { name: 'Phone as a remote' })).toContainText('Phone · 1');

  await phoneTile(phone, 'Full on').click();
  await expect(tile(page, 'Full on')).toHaveClass(/\bon\b/);
  await expect(phoneTile(phone, 'Full on')).toHaveClass(/\bon\b/);
  await expect.poll(async () => (await channels(0, 3)).some((v) => v > 0)).toBe(true);

  // GO and Back from the phone; it says what's on and next
  await phoneTile(phone, 'Warm-up').click();
  await expect(page.locator('.strip .now')).toContainText('1. Warm-up');
  await expect(phone.locator('#now')).toHaveText('1. Warm-up');
  await expect(phone.locator('#next')).toContainText('2. Red / blue');
  await phone.locator('#go').click();
  await expect(page.locator('.strip .now')).toContainText('2. Red / blue');
  await expect(phone.locator('#now')).toHaveText('2. Red / blue');
  await phone.locator('#back').click();
  await expect(page.locator('.strip .now')).toContainText('1. Warm-up');

  // Blackout: a tap only says how; holding it a moment blacks out, a tap brings it back
  await phone.locator('#bo').click();
  await expect(phone.locator('#hint')).toContainText('Hold Blackout');
  expect(await appState(page, (a) => a.blackout)).toBe(false);
  await phone.locator('#bo').hover();
  await phone.mouse.down(); await phone.waitForTimeout(450); await phone.mouse.up();
  await expect.poll(() => channels(0, 24)).toEqual(Array(24).fill(0));
  await expect(phone.locator('#bo')).toHaveAttribute('aria-pressed', 'true');
  await expect(phone.locator('#frame')).toBeVisible();
  await phone.locator('#bo').click();
  await expect.poll(async () => (await channels(0, 24)).some((v) => v > 0)).toBe(true);

  // the grand master, dragged on the phone (a mouse grabs at once; a finger holds first)
  const gm = phone.locator('#grid .fader', { hasText: 'Grand master' });
  await gm.scrollIntoViewIfNeeded();
  const b = (await gm.boundingBox())!;
  await phone.mouse.move(b.x + b.width / 2, b.y + 10);
  await phone.mouse.down();
  await phone.mouse.move(b.x + b.width / 2, b.y + 10 + 150, { steps: 6 });         // a long drag: fine control on a phone
  await phone.mouse.up();
  await expect.poll(() => appState(page, (a) => a.grandMaster)).toBeLessThan(0.7);

  await expect(phoneTile(phone, 'Fade out')).toBeVisible();          // the end-of-song button is there too
  // tap tempo, timed on the phone: four taps 500 ms apart is 120 BPM
  await appState(page, (a) => { a.show.settings.bpm = 90; });
  const tap = phoneTile(phone, 'Tap');
  await tap.scrollIntoViewIfNeeded();
  for (let i = 0; i < 4; i++) { await tap.click(); await phone.waitForTimeout(470); }
  await expect.poll(() => appState(page, (a) => a.show.settings.bpm)).toBeGreaterThan(110);
  expect(await appState(page, (a) => a.show.settings.bpm)).toBeLessThan(135);
  await phone.context().close();
});

// The box answers every message ('K') and the phone page sends its next one only then (one on the
// wire at a time; older box firmware misread a frame header split across packets). On a slow box a fast
// drag still ends where the finger stopped, and GO pressed while the fader moves still waits for
// its turn instead of getting lost (two GOs 350 ms apart: closer, the laptop takes them as one).
test('a slow box: the phone sends one message at a time, a fast drag ends where the finger stopped, GOs all count', async ({ page, browser }) => {
  const { code } = await laptopWithRemote(page);
  await page.keyboard.press('Escape');
  const phone = await phoneFor(browser, code);
  await expect(phone.locator('#status')).toHaveText('On stage');
  await fetch(`http://${FAKE}/ws/test`, { method: 'POST', body: JSON.stringify({ ackDelay: 120 }) });
  const gm = phone.locator('#grid .fader', { hasText: 'Grand master' });
  await gm.scrollIntoViewIfNeeded();
  const b = (await gm.boundingBox())!;
  await phone.mouse.move(b.x + b.width / 2, b.y + 10);
  await phone.mouse.down();
  await phone.mouse.move(b.x + b.width / 2, b.y + 10 + 150, { steps: 30 });
  await phone.mouse.up();
  await phone.locator('#go').click();               // queued behind the fader's last move
  // where the finger stopped, as the phone shows it at once; the laptop ends there too
  const end = Number(await gm.getAttribute('aria-valuenow'));
  expect(end).toBeLessThan(70);
  await expect.poll(() => appState(page, (a) => Math.round(a.grandMaster * 100))).toBe(end);
  await expect(page.locator('.strip .now')).toContainText('1. Warm-up');
  await phone.waitForTimeout(350);
  await phone.locator('#go').click();
  await phone.waitForTimeout(350);
  await phone.locator('#go').click();
  await expect(page.locator('.strip .now')).toContainText('3.');
  const s = await fetch(`http://${FAKE}/ws/stats.json`).then((r) => r.json());
  expect(s.early, 'messages sent before the answer to the one before').toBe(0);
  await phone.context().close();
});

test('held from the phone: on while held, let go on release, when the phone goes quiet, or closes', async ({ page, browser }) => {
  const { code } = await laptopWithRemote(page);
  await page.keyboard.press('Escape');
  const phone = await phoneFor(browser, code);
  await holdOn(phone, 'Blinder');
  await expect(tile(page, 'Blinder')).toHaveClass(/\bon\b/);
  await expect.poll(() => channels(0, 3)).toEqual([255, 255, 255]);   // the first PAR, full white
  await phone.waitForTimeout(2200);                                     // held longer than the safety timeout: still on
  await expect(tile(page, 'Blinder')).toHaveClass(/\bon\b/);
  await phone.mouse.up();
  await expect(tile(page, 'Blinder')).not.toHaveClass(/\bon\b/);

  // a phone that says "down" and then nothing more (locked, out of Wi-Fi): let go within 1.5 s
  const ws = await rawClient();
  relay(ws, { k: 'hello', code, rid: 'quiet' });
  relay(ws, { k: 'down', code, rid: 'quiet', w: 'blinder' });
  await expect(tile(page, 'Blinder')).toHaveClass(/\bon\b/);
  const t0 = Date.now();
  await expect(tile(page, 'Blinder')).not.toHaveClass(/\bon\b/, { timeout: 4000 });
  expect(Date.now() - t0).toBeLessThan(3000);
  ws.close();

  // a page closed while holding lets go too
  await holdOn(phone, 'Blinder');
  await expect(tile(page, 'Blinder')).toHaveClass(/\bon\b/);
  await phone.close();
  await expect(tile(page, 'Blinder')).not.toHaveClass(/\bon\b/, { timeout: 4000 });
});

test('the page changing under a held finger lets go; a keyboard hold lets go when focus moves', async ({ page, browser }) => {
  const { code } = await laptopWithRemote(page);
  await page.keyboard.press('Escape');
  const phone = await phoneFor(browser, code);
  await holdOn(phone, 'Blinder');
  await expect(tile(page, 'Blinder')).toHaveClass(/\bon\b/);
  // the laptop edits the page (a new heading): the phone redraws, and nothing stays held under the finger
  await appState(page, (a) => { a.ownPages()[0].widgets.unshift({ id: 'w-new', type: 'label', label: 'New' }); a.markDirty(0); });
  await expect(phone.locator('#grid .head', { hasText: 'New' })).toBeVisible({ timeout: 5000 });
  await expect(tile(page, 'Blinder')).not.toHaveClass(/\bon\b/, { timeout: 4000 });
  await phone.mouse.up();
  // a keyboard on a tablet: Enter held on the blinder, Tab away, let go of Enter: it lets go
  await phoneTile(phone, 'Blinder').focus();
  await phone.keyboard.down('Enter');
  await expect(tile(page, 'Blinder')).toHaveClass(/\bon\b/);
  await phone.keyboard.press('Tab');
  await phone.keyboard.up('Enter');
  await expect(tile(page, 'Blinder')).not.toHaveClass(/\bon\b/, { timeout: 4000 });
  await phone.context().close();
});

test('with a finger: a tap plays, a swipe over a button only scrolls, the pinned blinder holds', async ({ page, browser }) => {
  const { code } = await laptopWithRemote(page);
  await page.keyboard.press('Escape');
  const phone = await phoneFor(browser, code, true);
  await expect(phone.locator('#grid .tile.cue')).toHaveCount(await looks(page));
  await phoneTile(phone, 'Warm-up').tap();
  await expect(tile(page, 'Warm-up')).toHaveClass(/\bon\b/);
  const cdp = await phone.context().newCDPSession(phone);
  const touch = (type: string, x?: number, y?: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y }] } as never);
  const centre = async (text: string) => { const t = phoneTile(phone, text); await t.scrollIntoViewIfNeeded(); const b = (await t.boundingBox())!; return [b.x + b.width / 2, b.y + b.height / 2]; };
  // a swipe that starts on a look: the page scrolls, nothing plays
  const [sx, sy] = await centre('Full on');
  await touch('touchStart', sx, sy);
  for (let i = 1; i <= 6; i++) await touch('touchMove', sx, sy - i * 12);
  await touch('touchEnd');
  await page.waitForTimeout(400);
  await expect(tile(page, 'Full on')).not.toHaveClass(/\bon\b/);
  // the hold buttons are pinned above GO on a phone: a finger resting on the Blinder there holds it
  const pinned = phone.locator('#holdrow .tile', { hasText: 'Blinder' });
  await expect(pinned).toBeVisible();
  const pb = (await pinned.boundingBox())!;
  await touch('touchStart', pb.x + pb.width / 2, pb.y + pb.height / 2);
  await expect(tile(page, 'Blinder')).toHaveClass(/\bon\b/);
  await phone.waitForTimeout(1800);
  await expect(tile(page, 'Blinder')).toHaveClass(/\bon\b/);
  await touch('touchEnd');
  await expect(tile(page, 'Blinder')).not.toHaveClass(/\bon\b/);
  await phone.context().close();
});

test('the code: a wrong one gets nothing; a guest can be removed; a new code or off sends phones back to the code', async ({ page, browser }) => {
  const { dlg, code } = await laptopWithRemote(page);
  const wrong = code === '1111' ? '2222' : '1111';
  const stranger = await phoneFor(browser, wrong);
  await expect(stranger.locator('#cardMsg')).toContainText(`No show answered with code ${wrong}`, { timeout: 8000 });
  await expect(stranger.locator('#grid .tile')).toHaveCount(0);
  await expect(stranger.locator('#foot')).toHaveClass(/\boff\b/);           // no live-looking GO
  // and its presses do nothing
  const ws = await rawClient();
  relay(ws, { k: 'tap', code: wrong, rid: 'x', w: 'relall' });
  relay(ws, { k: 'bo', code: wrong, rid: 'x', on: true });
  ws.close();
  await page.waitForTimeout(400);
  await expect(dlg.locator('.phones')).toContainText('No phone yet');
  expect(await appState(page, (a) => a.blackout)).toBe(false);
  // it can type the right code on that card
  await stranger.locator('#card .code').fill(code);
  await stranger.locator('#card').getByRole('button', { name: 'Join' }).click();
  await expect(stranger.locator('#grid .tile.cue')).toHaveCount(await looks(page));

  // a guest: shown in the list, removed, it lets go of what it held and is told so; Jo's phone carries on
  const jo = await phoneFor(browser, code);
  await expect(jo.locator('#grid .tile.cue')).toHaveCount(await looks(page));
  await expect(dlg.locator('.ph')).toHaveCount(2);
  await holdOn(stranger, 'Blinder');
  await expect(tile(page, 'Blinder')).toHaveClass(/\bon\b/);
  await dlg.locator('.ph').first().getByRole('button', { name: 'Remove' }).click();
  await expect(tile(page, 'Blinder')).not.toHaveClass(/\bon\b/);
  await expect(stranger.locator('#cardMsg')).toContainText('took this phone off the remote');
  await expect(jo.locator('#status')).toHaveText('On stage');
  await expect(dlg.locator('.ph')).toHaveCount(1);
  await stranger.mouse.up();
  // a phone leaving doesn't end it for the others
  const other = await phoneFor(browser, code);
  await expect(other.locator('#grid .tile.cue')).toHaveCount(await looks(page));
  await other.locator('#moreBtn').click();
  other.once('dialog', (d) => d.accept());
  await other.getByRole('menuitem', { name: 'Leave the remote' }).click();
  await jo.waitForTimeout(800);
  await expect(jo.locator('#grid .tile.cue')).toHaveCount(await looks(page));
  await expect(jo.locator('#card')).toBeHidden();

  // a new code: every phone back to the code card, no dead GO
  await dlg.getByRole('button', { name: 'New code' }).click();
  await expect(jo.locator('#cardMsg')).toContainText('changed its code');
  await expect(jo.locator('#grid .tile')).toHaveCount(0);
  await expect(jo.locator('#foot')).toHaveClass(/\boff\b/);
  // switched off: the code goes away
  await dlg.getByRole('button', { name: 'Switch off' }).click();
  await expect(dlg.locator('.qr')).toHaveCount(0);
  await expect(dlg.getByRole('button', { name: 'Switch the phone remote on' })).toBeVisible();
  for (const p of [stranger, jo, other]) await p.context().close();
});

test('what the laptop sends is shown as text, whatever another client on the network relays', async ({ page, browser }) => {
  const { code } = await laptopWithRemote(page);
  const phone = await phoneFor(browser, code);
  await expect(phone.locator('#grid .tile.cue')).toHaveCount(await looks(page));
  const evil = await rawClient();
  relay(evil, { k: 'layout', host: 1, code, v: 999999, show: '<img src=x onerror="window.pwned=1">', pages: [{ id: 'p', name: '<b>x</b>', n: 1 }] });
    relay(evil, { k: 'tiles', host: 1, code, v: 999999, p: 0, from: 0, tiles: [{ id: 'a"><img src=x onerror="window.pwned=2">', type: 'fog', label: '<img src=x onerror="window.pwned=3">', color: 'red;position:fixed;inset:0', burst: '1"><img src=x onerror="window.pwned=4">', holds: true }] });
  evil.close();
  await phone.waitForTimeout(800);
  expect(await phone.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();
  expect(await phone.locator('img').count()).toBe(0);
  await phone.context().close();
});

test('which link is down: the laptop gone quiet, said in words, nothing looks playable', async ({ page, browser }) => {
  const { code } = await laptopWithRemote(page);
  await page.keyboard.press('Escape');
  const phone = await phoneFor(browser, code);
  await expect(phone.locator('#grid .tile.cue')).toHaveCount(await looks(page));
  // the laptop stops answering (as if its tab froze): the phone says so, and nothing looks playable
  await appState(page, (a) => { a.remote.on = false; });
  await expect(phone.locator('#lost')).toContainText("running the show isn't answering", { timeout: 8000 });
  await expect(phone.locator('#status')).toHaveText('No show');
  await expect(phone.locator('#foot')).toHaveClass(/\boff\b/);
  // the laptop says a phone is waiting, with a way to switch it on
  await expect(page.locator('.toast')).toContainText('A phone is waiting for the remote', { timeout: 6000 });
  await page.locator('.toast').getByRole('button', { name: 'Switch on' }).click();
  await expect(phone.locator('#lost')).toBeHidden({ timeout: 8000 });
  await expect(phone.locator('#status')).toHaveText('On stage');
  await phone.context().close();
});

test('without a connected box the dialog says to connect one, and can add it', async ({ page }) => {
  await fresh(page);
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.locator('.live').getByRole('button', { name: 'Phone as a remote' }).click();
  const dlg = page.getByRole('dialog', { name: 'Phone as a remote' });
  await expect(dlg).toContainText('connect it first');
  await dlg.getByLabel('LuxDMX address').fill(FAKE);
  await dlg.getByRole('button', { name: 'Add your LuxDMX' }).click();
  await expect(dlg.getByRole('button', { name: 'Connect' })).toBeVisible();
});

test('a phone on a locked staff page of looks: just the looks, no GO or Back, Blackout across, "locked" said', async ({ page, browser }) => {
  const { dlg, code } = await laptopWithRemote(page);
  await page.keyboard.press('Escape');
  await page.locator('.live').getByRole('button', { name: 'New page' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Just the looks (for staff)' }).click();
  await page.locator('.live').getByRole('button', { name: 'Lock page' }).click();
  const phone = await phoneFor(browser, code);
  const looks = await page.evaluate(() => (window as any).__luxdmx.show.cueLists[0].cues.length);
  await expect(phone.locator('#grid .tile')).toHaveCount(looks, { timeout: 8000 });   // the locked page only
  await expect(phone.locator('#go')).toBeHidden();
  await expect(phone.locator('#back')).toBeHidden();
  await expect(phone.locator('#status')).toHaveClass(/locked/);
  // and a GO sent anyway (an old page, a forged message) does nothing
  const before = await page.evaluate(() => { const a = (window as any).__luxdmx; return a.engine.status(a.show.cueLists[0].id).index; });
  // (enabled again by hand first: a disabled button sends nothing, so the laptop's own check is what's tested)
  await phone.evaluate(() => { const b = document.getElementById('go') as HTMLButtonElement; b.disabled = false; b.click(); });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => { const a = (window as any).__luxdmx; return a.engine.status(a.show.cueLists[0].id).index; })).toBe(before);
  void dlg;
});

// The phone says what the laptop sends: on stage or blind, and whether its machines are armed;
// buttons that fire one carry the same mark as on the laptop.
test('the phone shows blind, on stage and armed, and marks the machine buttons', async ({ page, browser }) => {
  const { dlg, code } = await laptopWithRemote(page);
  await dlg.getByRole('button', { name: 'Close' }).first().click().catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  const phone = await phoneFor(browser, code);
  await expect(phone.locator('#status')).toHaveText('On stage');
  await expect(phoneTile(phone, 'Confetti').locator('.risk')).toHaveText('1×');
  await expect(phoneTile(phone, 'CO2').locator('.risk')).toBeVisible();
  await page.evaluate(() => (window as any).__luxdmx.setOutput('blind'));
  await expect(phone.locator('#status')).toHaveText('Blind');
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.setOutput('live'); a.armMachines(true); });
  await expect(phone.locator('#status')).toHaveText('On stage · armed');
  await phone.context().close();
});
