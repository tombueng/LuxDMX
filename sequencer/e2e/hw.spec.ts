// The same paths against a real LuxDMX (its own /bridge page, its WebSocket, its DMX output),
// read back from the box's /dmx.json, which shows the output the box's monitor is set to.
//   LUXDMX_HOST=192.168.1.50 npx playwright test e2e/hw.spec.ts
//   LUXDMX_UNI=1 tests on the output that plays universe 1 instead of 0 (when something else
//   is sending to universe 0, its values would mix in).
import { openConnected, patch, selectAll, selectFixtures, intensity, swatch, record, go, full, cues, jumpTo, release, newList, tab, goLive, test, expect } from './helpers';

const HOST = process.env.LUXDMX_HOST ?? '';
const UNI = +(process.env.LUXDMX_UNI ?? 0);
const dmx = async (n = 8): Promise<number[]> =>
  (await (await fetch(`http://${HOST}/dmx.json`, { signal: AbortSignal.timeout(4000) })).json()).ch.slice(0, n);

test.skip(!HOST, 'set LUXDMX_HOST to run against a real box');
test.describe.configure({ mode: 'serial' });

// Point the box's monitor (and so /dmx.json) at the output playing UNI, and back afterwards.
async function viewOutput(uni: number) {
  const info = await (await fetch(`http://${HOST}/info.json`)).json();
  const out = (info.outputs as { en: boolean; uni: number }[]).findIndex((o) => o.en && o.uni === uni);
  if (out < 0) throw new Error(`no enabled output plays universe ${uni}`);
  const { default: WebSocket } = await import('ws');
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}/ws`);
    ws.on('open', () => { ws.send(JSON.stringify({ cmd: 'viewout', out })); setTimeout(() => { ws.close(); resolve(); }, 300); });
    ws.on('error', reject);
  });
}
test.beforeAll(async () => { if (HOST) await viewOutput(UNI); });
test.afterAll(async () => { if (HOST && UNI !== 0) await viewOutput(0).catch(() => {}); });

test('real box: record, GO with a measured fade, release', async ({ page }) => {
  await openConnected(page, HOST);
  await patch(page, 'gen-drgb', 2, UNI, 'PAR');
  await selectAll(page); await full(page); await swatch(page, 'Red'); await record(page);
  await selectAll(page); await swatch(page, 'Blue'); await record(page);
  await cues(page).nth(1).click();
  await page.locator('.insp').getByLabel('Fade', { exact: true }).fill('4');
  await jumpTo(page, 0);
  await expect.poll(() => dmx(8), { timeout: 5000 }).toEqual([255, 255, 0, 0, 255, 255, 0, 0]);
  await go(page);
  await page.waitForTimeout(2000);                       // halfway through the 4 s fade
  const mid = await dmx(4);
  expect(mid[1]).toBeGreaterThan(80); expect(mid[1]).toBeLessThan(175);
  expect(mid[3]).toBeGreaterThan(80); expect(mid[3]).toBeLessThan(175);
  await expect.poll(() => dmx(4), { timeout: 4000 }).toEqual([255, 0, 0, 255]);
  await release(page);
  await expect.poll(() => dmx(1), { timeout: 4000 }).toEqual([0]);
});

test('real box: two lists, master, blackout', async ({ page }) => {
  await openConnected(page, HOST);
  await patch(page, 'gen-drgb', 1, UNI, 'PAR');
  await selectAll(page); await intensity(page, 0.4); await swatch(page, 'Red'); await record(page);
  await newList(page);
  await selectFixtures(page, ['PAR']); await intensity(page, 0.8); await swatch(page, 'Blue'); await record(page);
  await expect.poll(() => dmx(4), { timeout: 4000 }).toEqual([204, 0, 0, 255]);
  await page.locator('.top .gm input').fill('0.5');
  await expect.poll(() => dmx(1), { timeout: 4000 }).toEqual([102]);
  await page.locator('.top').getByRole('button', { name: 'Blackout' }).click();
  await expect.poll(() => dmx(1), { timeout: 4000 }).toEqual([0]);
  await page.locator('.top').getByRole('button', { name: 'Blackout' }).click();
  await page.locator('.top .gm input').fill('1');
  await release(page);
  await expect.poll(() => dmx(4), { timeout: 5000 }).toEqual([102, 255, 0, 0]);
});

test('real box: a chase at 120 BPM arrives with its period and order', async ({ page }) => {
  await openConnected(page, HOST);
  await patch(page, 'gen-dimmer', 4, UNI, 'D');
  await selectAll(page);
  await tab(page, 'Effects');
  await page.locator('.ep').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add an effect' }).locator('[data-effect="chase"]').click();
  // sample the box's own output for 4 s
  const samples: [number, number[]][] = [];
  const end = Date.now() + 4000;
  while (Date.now() < end) { samples.push([Date.now(), await dmx(4)]); await page.waitForTimeout(40); }
  const rises = (ch: number) => samples.filter(([, v], i) => i > 0 && v[ch] > 127 && samples[i - 1][1][ch] <= 127).map(([t]) => t);
  const r1 = rises(0);
  expect(r1.length).toBeGreaterThanOrEqual(3);
  const periods = r1.slice(1).map((t, i) => t - r1[i]).sort((a, b) => a - b);
  const period = periods[Math.floor(periods.length / 2)];
  expect(period).toBeGreaterThan(850); expect(period).toBeLessThan(1150);
  // only one light at a time
  expect(samples.every(([, v]) => v.filter((x) => x > 127).length <= 1)).toBe(true);
  await page.locator('.ep [data-play="stop"]').first().click();
  await expect.poll(() => dmx(4), { timeout: 4000 }).toEqual([0, 0, 0, 0]);
});

test('real box: a reload mid-show keeps the look and reconnects without a click', async ({ page }) => {
  await openConnected(page, HOST);
  await patch(page, 'gen-drgb', 1, UNI, 'PAR');
  await selectAll(page); await full(page); await swatch(page, 'Green'); await record(page);
  await jumpTo(page, 0);
  await expect.poll(() => dmx(4), { timeout: 5000 }).toEqual([255, 0, 255, 0]);
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('.dev.ready')).toBeVisible({ timeout: 5000 });
  // longer than the box's 4 s source timeout: the look is still there because the page sends again
  await page.waitForTimeout(5000);
  await expect.poll(() => dmx(4), { timeout: 4000 }).toEqual([255, 0, 255, 0]);
  await release(page);
  await expect.poll(() => dmx(1), { timeout: 4000 }).toEqual([0]);
});

// A tablet switched off and on again (a new tab: nothing to reload from): the page puts back what
// was playing (or, with nothing saved, sends nothing), so the box (signal loss: hold, its default)
// keeps the look past its source timeout, with no dip.
test('real box: a cold start doesn\'t black out the look the box is holding', async ({ page }) => {
  const info = await (await fetch(`http://${HOST}/info.json`)).json();
  test.skip((info.outputs as { en: boolean; uni: number; loss: number }[]).find((o) => o.en && o.uni === UNI)?.loss !== 0, 'the output must hold on signal loss');
  await openConnected(page, HOST);
  await patch(page, 'gen-drgb', 1, UNI, 'PAR');
  await selectAll(page); await full(page); await swatch(page, 'Blue'); await record(page);
  await jumpTo(page, 0);
  await expect.poll(() => dmx(4), { timeout: 5000 }).toEqual([255, 0, 0, 255]);
  await page.evaluate(() => sessionStorage.removeItem('luxdmx.seq.playing'));   // nothing to resume (a new tab)
  await page.goto('about:blank');
  await page.goto('/');
  await expect(page.locator('.dev.ready')).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(5500);                                 // past the box's 4 s source timeout
  expect(await dmx(4)).toEqual([255, 0, 0, 255]);
  // the first GO takes over again (and the release leaves the output dark for the next test)
  await jumpTo(page, 0);
  await release(page);
  await expect.poll(() => dmx(1), { timeout: 5000 }).toEqual([0]);
});

test('real box: a phone plays the show through /remote; a closed one and a silent one let go of the blinder', async ({ page, browser }) => {
  await openConnected(page, HOST);
  await patch(page, 'gen-drgb', 2, UNI, 'PAR');
  await selectAll(page); await full(page); await swatch(page, 'Red'); await record(page);
  await selectAll(page); await swatch(page, 'Blue'); await record(page);
  const clear = page.locator('.prog').getByRole('button', { name: 'Clear' });
  if (await clear.isVisible()) await clear.click();
  await release(page);
  await expect.poll(() => dmx(1), { timeout: 4000 }).toEqual([0]);                // dark (a released light keeps its colour)
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await page.locator('.live').getByRole('button', { name: 'Phone as a remote' }).click();
  const dlg = page.getByRole('dialog', { name: 'Phone as a remote' });
  await dlg.getByRole('button', { name: 'Switch the phone remote on' }).click();
  const code = (await dlg.locator('.code').textContent())!.trim();
  await page.keyboard.press('Escape');
  // the phone opens the box's own page, nothing else
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const phone = await ctx.newPage();
  await phone.goto(`http://${HOST}/remote#k=${code}`);
  await expect(phone.locator('#grid .tile.cue')).toHaveCount(2, { timeout: 8000 });
  await phone.locator('#grid .tile.cue').nth(1).click();                   // the blue look
  await expect.poll(() => dmx(4), { timeout: 4000 }).toEqual([255, 0, 0, 255]);
  await phone.locator('#go').click();                                      // end of the list: stays
  await phone.locator('#back').click();
  await expect.poll(() => dmx(4), { timeout: 4000 }).toEqual([255, 255, 0, 0]);
  await phone.locator('#bo').hover();                                       // Blackout on takes holding it a moment
  await phone.mouse.down(); await phone.waitForTimeout(450); await phone.mouse.up();
  await expect.poll(() => dmx(1), { timeout: 4000 }).toEqual([0]);                // the dimmer: dark
  await phone.locator('#bo').click();
  await expect.poll(() => dmx(4), { timeout: 4000 }).toEqual([255, 255, 0, 0]);
  // held from the phone, then the phone goes away mid-hold: the box is back to the look within ~2 s
  const blinder = phone.locator('#grid .tile', { hasText: 'Blinder' });
  await blinder.scrollIntoViewIfNeeded();
  await blinder.hover();
  await phone.mouse.down();
  await expect.poll(() => dmx(4), { timeout: 4000 }).toEqual([255, 255, 255, 255]);
  await ctx.close();
  await expect.poll(() => dmx(4), { timeout: 4000 }).toEqual([255, 255, 0, 0]);
  // a phone that goes silent mid-hold, no goodbye (its Wi-Fi died): the laptop lets go by itself
  const { default: WebSocket } = await import('ws');
  const quiet = new WebSocket(`ws://${HOST}/ws`);
  await new Promise((r) => quiet.on('open', r));
  quiet.send(JSON.stringify({ relay: { k: 'hello', code, rid: 'quiet', n: 1 } }));
  quiet.send(JSON.stringify({ relay: { k: 'down', code, rid: 'quiet', w: 'blinder', n: 2 } }));
  await expect.poll(() => dmx(4), { timeout: 4000 }).toEqual([255, 255, 255, 255]);
  const t0 = Date.now();
  await expect.poll(() => dmx(4), { timeout: 5000 }).toEqual([255, 255, 0, 0]);
  expect(Date.now() - t0).toBeLessThan(3500);
  quiet.terminate();
  await page.locator('.strip').getByRole('button', { name: 'Release' }).click();
});

test('real box through LuxDMX Link: found by ArtPoll, played over Art-Net (no popup)', async ({ page }) => {
  const { spawn } = await import('node:child_process');
  const fs = await import('node:fs');
  const BIN = 'link/dist/luxdmx-link-linux-amd64';
  test.skip(!fs.existsSync(BIN), 'build LuxDMX Link first');
  const link = spawn(BIN, [], { stdio: 'ignore' });
  try {
    await expect.poll(async () => { try { const i = await (await fetch('http://127.0.0.1:47920/info.json')).json(); return i.nodes.some((n: { ip: string }) => HOST.split(':')[0] === n.ip); } catch { return false; } }, { timeout: 12000 }).toBe(true);
    await page.goto('/');
    await page.evaluate(async () => { localStorage.clear(); await new Promise<void>((r) => { const q = indexedDB.deleteDatabase('luxdmx-sequencer'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
    await page.reload();
    await page.getByRole('button', { name: 'Add a LuxDMX' }).click();
    await page.getByRole('button', { name: 'Art-Net / sACN from this computer' }).click();
    await expect(page.locator('.dev[data-box="link"]')).toContainText('1 node');
    await goLive(page);                                   // (a fresh browser starts Blind)
    await patch(page, 'gen-drgb', 1, UNI, 'PAR');
    await selectAll(page); await full(page); await swatch(page, 'Green');
    await expect.poll(() => dmx(4), { timeout: 6000 }).toEqual([255, 0, 255, 0]);
    await selectAll(page); await intensity(page, 0);
    await expect.poll(() => dmx(1), { timeout: 6000 }).toEqual([0]);
  } finally { link.kill(); }
});
