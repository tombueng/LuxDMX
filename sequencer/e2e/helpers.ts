// Shared e2e helpers: the fake LuxDMX (test/fake-luxdmx.mjs), the bridge handshake, and short
// ways to drive the UI the way a person would.
import { test as base, expect, type Page } from '@playwright/test';

// Every test fails on an uncaught error (or a Svelte warning) in the page, even if the
// assertions happen to pass.
export const test = base.extend<{ pageErrors: void }>({
  pageErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
    // (the app never asks before leaving; a stray dialog is dismissed)
    page.on('dialog', (d) => (d.type() === 'beforeunload' ? d.accept() : d.dismiss()));
    // Svelte's dev warnings (state misuse, ownership) count too: they're bugs waiting to happen.
    page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('[svelte]')) errors.push(m.text()); });
    await use();
    expect(errors, 'uncaught errors in the page').toEqual([]);
  }, { auto: true }],
});
export { expect };

export const FAKE = `127.0.0.1:${process.env.FAKE_PORT ?? 8199}`;

export async function frames(host = FAKE): Promise<Record<string, { ch: number[]; count: number; first: number; last: number }>> {
  return (await fetch(`http://${host}/frames.json`)).json();
}
export async function channels(uni = 0, n = 16, host = FAKE): Promise<number[]> {
  const f = (await frames(host))[uni];
  return f ? f.ch.slice(0, n) : [];
}
export async function history(uni: number, ch: number, host = FAKE): Promise<[number, number][]> {
  return (await fetch(`http://${host}/history.json?uni=${uni}&ch=${ch}`)).json();
}
// Pixel ports on the fake box: [first universe, how many it spans]. Set before connecting: the box's
// bridge page says them when it opens.
export async function pixelPorts(ports: [number, number][], host = FAKE) { await fetch(`http://${host}/pixels?ports=${ports.map((p) => p.join(':')).join(',')}`, { method: 'POST' }); }
export async function resetFake(host = FAKE) { await fetch(`http://${host}/reset`, { method: 'POST' }); }

// A fresh app: nothing saved (no open show, no shows in the browser).
// (cleared from a plain file of the app's site, not the app: the app saves as it goes away, and a
// running app holds its database open, so a delete from inside it waits and the next start could
// still find the show it was clearing: now and then no welcome)
export async function fresh(page: Page, keepWelcome = false) {
  await page.goto('/manifest.webmanifest');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((r) => { const q = indexedDB.deleteDatabase('luxdmx-sequencer'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
  });
  await page.goto('/');
  // the welcome comes up over an empty show: closed here (welcome() below opens it again)
  if (!keepWelcome) {
    const w = welcomeDialog(page);
    await expect(w).toBeVisible();
    await w.getByRole('button', { name: 'Start with an empty stage' }).click();
    await expect(w).toBeHidden();
  }
}
export const welcomeDialog = (page: Page) => page.getByRole('dialog', { name: "Let's get some light on stage" });
// the welcome again, from the empty stage
export async function welcome(page: Page) {
  await page.getByRole('button', { name: 'Get started' }).click();
  const w = welcomeDialog(page);
  await expect(w).toBeVisible();
  return w;
}
// The big demo from the welcome: on the demo beat unless a song is named (a real one would come
// down from the internet)
export async function demo(page: Page, song = 'beat') {
  const w = await welcome(page);
  await w.getByLabel("The demo's music").selectOption(song);
  await w.getByRole('button', { name: 'Show me a demo' }).click();
}

// Fresh app, connected to a device through its bridge popup.
export async function openConnected(page: Page, host = FAKE) {
  await fresh(page);
  await addDevice(page, host);
  return connect(page);
}
// On a phone the boxes sit behind one status button in the top bar.
const boxesButton = (page: Page) => page.locator('.top').getByRole('button', { name: /LuxDMX boxes/ });
export async function addDevice(page: Page, host = FAKE) {
  // one of the two is there once the app has drawn (isVisible doesn't wait: a slow first paint took the wrong one)
  const add = page.getByRole('button', { name: 'Add a LuxDMX' });
  await expect(boxesButton(page).or(add).first()).toBeVisible();
  if (await boxesButton(page).isVisible()) { if (!(await page.getByLabel('LuxDMX address').isVisible())) await boxesButton(page).click(); }
  else await add.click();
  await page.getByLabel('LuxDMX address').fill(host);
  await page.getByRole('button', { name: 'Add LuxDMX' }).click();
}
// The boxes' pills: on a tablet, or when they'd wrap the top bar, they sit in the boxes button's
// list: opened when it's that way. A box connected: its pill, or the boxes button, says so.
export async function showBoxes(page: Page) {
  await expect(boxesButton(page).or(page.locator('.dev')).first()).toBeVisible();
  if (await boxesButton(page).isVisible() && !(await page.locator('.dev').first().isVisible())) await boxesButton(page).click();
}
export const boxReady = (page: Page) => page.locator('.dev.ready').or(page.locator('.top .boxes.ready')).first();
export async function connect(page: Page) {
  await expect(boxesButton(page).or(page.locator('.dev')).first()).toBeVisible();
  const compact = await boxesButton(page).isVisible();
  if (compact && !(await page.locator('.dev').first().isVisible())) await boxesButton(page).click();
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('.dev').getByRole('button', { name: 'Connect' }).click()]);
  await popup.locator('#allow').click();
  await expect(page.locator('.dev.ready')).toBeVisible();
  if (compact) { await page.keyboard.press('Escape'); await expect(page.locator('.top .boxes.ready')).toBeVisible(); }
  await goLive(page);
  return popup;
}
// What you do goes out to the stage (a new browser starts blind): the top bar's switch, confirmed.
export async function goLive(page: Page) {
  const out = page.locator('.top .out');
  if ((await out.getAttribute('aria-pressed')) === 'true') return;
  await out.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Go on stage' }).click();
  await expect(out).toHaveAttribute('aria-pressed', 'true');
}

// ---- UI shortcuts
export const tab = (page: Page, name: 'Fixtures' | 'Groups' | 'Presets' | 'Effects') => page.locator('.side .tabs').getByRole('tab', { name }).click();
export async function patch(page: Page, typeId: string, count = 4, universe = 0, name?: string) {
  await tab(page, 'Fixtures');
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Add fixtures' });
  await dlg.locator(`[data-type="${typeId}"]`).click();
  await dlg.getByLabel('How many').fill(String(count));
  await dlg.getByLabel('Universe').fill(String(universe));
  if (name) await dlg.getByLabel('Name', { exact: true }).fill(name);
  await dlg.getByRole('button', { name: /^Add \d+ × / }).click();
  await expect(dlg).toBeHidden();
}
export const fixturesOnStage = (page: Page) => page.locator('.stage-wrap .fx');
export const selectAll = (page: Page) => page.locator('.stage-wrap').getByRole('button', { name: 'Select all' }).click();
export const selectNone = (page: Page) => page.locator('.stage-wrap').getByRole('button', { name: 'Select none' }).click();
export async function selectFixtures(page: Page, names: string[]) {
  await selectNone(page);
  for (const n of names) await page.locator(`.stage-wrap .fx[data-name="${n}"]`).click({ modifiers: ['Shift'] });
}
export const intensity = (page: Page, v: number) => page.locator('.prog').getByLabel('Intensity', { exact: true }).fill(String(v));
export const full = (page: Page) => page.locator('.prog .quick').getByRole('button', { name: 'Full' }).click();
export const swatch = (page: Page, name: string) => page.locator(`.prog .sw[aria-label="${name}"]`).click();
export const record = (page: Page) => page.locator('.deck').getByRole('button', { name: /^Record/ }).click();
export const go = (page: Page) => page.locator('.deck').getByRole('button', { name: /^GO/ }).click();
export const cues = (page: Page) => page.locator('.deck .card');
export const jumpTo = (page: Page, i: number) => cues(page).nth(i).dblclick();
export const release = (page: Page) => page.locator('.deck').getByRole('button', { name: 'Release', exact: true }).click();
export const newList = (page: Page) => page.locator('.deck').getByRole('button', { name: 'List', exact: true }).click();
