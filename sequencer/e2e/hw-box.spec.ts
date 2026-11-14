// The sequencer with a REAL LuxDMX box (not the fake one): connected through the box's own /bridge
// page, what you do comes out of the box (its /dmx.json says what output A sends: universe 0), the
// box gone and back (restarted; or, LUXDMX_CUT=switch, the test rig's Tasmota switch cutting its
// Ethernet when it's behind it), the app says so and goes on where it was.
//
//   LUXDMX_BOX=192.168.178.59 [LUXDMX_CUT=switch LUXDMX_TASMOTA=tasmota-network-switch] npx playwright test e2e/hw-box.spec.ts
//
// Skipped without LUXDMX_BOX. The box's output A must be on universe 0. Leaves the switch on.
import type { Page } from '@playwright/test';
import { openConnected, patch, selectAll, full, swatch, record, go, cues, demoTile, welcome, test, expect } from './helpers';

const BOX = process.env.LUXDMX_BOX ?? '';
const TASMOTA = process.env.LUXDMX_TASMOTA ?? 'tasmota-network-switch';
test.skip(!BOX, 'needs a real box: LUXDMX_BOX=<its address>');
test.describe.configure({ timeout: 180_000 });

// what output A sends now (the box's own buffer), and how often
const boxOut = async (n = 8): Promise<{ ch: number[]; outfps: number }> => {
  const r = await fetch(`http://${BOX}/dmx.json`, { signal: AbortSignal.timeout(2000) }).then((x) => x.json());
  return { ch: (r.ch as number[]).slice(0, n), outfps: r.outfps?.[0] ?? 0 };
};
const power = (on: boolean) => fetch(`http://${TASMOTA}/cm?cmnd=Power%20${on ? 'On' : 'Off'}`, { signal: AbortSignal.timeout(4000) });
const boxUp = () => fetch(`http://${BOX}/info.json`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
const blackoutBtn = (page: Page) => page.locator('.top').getByRole('button', { name: /^Blackout/ });

test('a real box: the looks come out of it, GO steps through them, blackout darkens it, off the network and back it goes on', async ({ page }) => {
  await openConnected(page, BOX);
  await patch(page, 'gen-drgb', 1, 0, 'PAR');              // (dimmer, red, green, blue on 1-4)
  // a look: full red, out of the box at once
  await selectAll(page); await full(page); await swatch(page, 'Red');
  await expect.poll(async () => (await boxOut(4)).ch, { timeout: 10000 }).toEqual([255, 255, 0, 0]);
  expect((await boxOut()).outfps).toBeGreaterThan(20);    // (it sends all along)
  await record(page);
  await swatch(page, 'Blue');
  await expect.poll(async () => (await boxOut(4)).ch, { timeout: 10000 }).toEqual([255, 0, 0, 255]);
  await record(page);
  await expect(cues(page)).toHaveCount(2);
  // GO from the top: red, then blue (the programmer cleared: what the cues say)
  const clear = page.locator('.prog').getByRole('button', { name: 'Clear', exact: true });
  if (await clear.isVisible()) await clear.click();
  await cues(page).first().dblclick();
  await expect.poll(async () => (await boxOut(4)).ch, { timeout: 10000 }).toEqual([255, 255, 0, 0]);
  await go(page);
  await expect.poll(async () => (await boxOut(4)).ch, { timeout: 15000 }).toEqual([255, 0, 0, 255]);
  // blackout: dark at the box, and back
  await blackoutBtn(page).click();
  // (the dimmer at 0 is dark: the colours may stay where they were)
  await expect.poll(async () => (await boxOut(4)).ch[0], { timeout: 10000 }).toBe(0);
  console.log('blackout at the box:', JSON.stringify((await boxOut(4)).ch));
  await blackoutBtn(page).click();
  await expect.poll(async () => (await boxOut(4)).ch, { timeout: 10000 }).toEqual([255, 0, 0, 255]);

  // the box gone for a while: its Ethernet switch off (when it's behind the rig's switch), else
  // restarted (gone for some seconds, the same to the app)
  const viaSwitch = process.env.LUXDMX_CUT === 'switch';
  try {
    if (viaSwitch) await power(false);
    else await fetch(`http://${BOX}/reboot`, { method: 'POST', signal: AbortSignal.timeout(3000) }).catch(() => {});
    await expect.poll(boxUp, { timeout: 20000, intervals: [200] }).toBe(false);
    // the app says the box is gone (its connection bar), and keeps the show going here
    await expect(page.locator('.lost[role="alert"]').filter({ hasText: /aren't getting anything|isn't getting anything|not answering|lost its connection/ }).first()).toBeVisible({ timeout: 30000 });
  } finally {
    if (viaSwitch) await power(true);
  }
  await expect.poll(boxUp, { timeout: 60000 }).toBe(true);
  // back: connected again by itself, and the box sends the look the show is on
  await expect(page.locator('.dev.ready, .top .boxes.ready').first()).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.lost[role="alert"]')).toHaveCount(0, { timeout: 20000 });
  await expect.poll(async () => (await boxOut(4)).ch, { timeout: 20000 }).toEqual([255, 0, 0, 255]);
  // and goes on: back to red
  await cues(page).first().dblclick();
  await expect.poll(async () => (await boxOut(4)).ch, { timeout: 10000 }).toEqual([255, 255, 0, 0]);
});

test('a real box: a fade runs smoothly out of it (red down, blue up, no jumps), and a change gets there quickly', async ({ page }) => {
  await openConnected(page, BOX);
  await patch(page, 'gen-drgb', 1, 0, 'PAR');
  await selectAll(page); await full(page); await swatch(page, 'Red'); await record(page);
  await swatch(page, 'Blue'); await record(page);
  const clear = page.locator('.prog').getByRole('button', { name: 'Clear', exact: true });
  if (await clear.isVisible()) await clear.click();
  // the second cue fades in 2 s
  await cues(page).nth(1).click();
  await page.locator('.insp').getByLabel('Fade', { exact: true }).fill('2');
  await cues(page).first().dblclick();
  await expect.poll(async () => (await boxOut(4)).ch, { timeout: 10000 }).toEqual([255, 255, 0, 0]);
  // GO, then what the box sends, every 40 ms, for 2.6 s
  await go(page);
  const t0 = Date.now(), seen: { t: number; r: number; b: number }[] = [];
  while (Date.now() - t0 < 2600) { const c = (await boxOut(4)).ch; seen.push({ t: Date.now() - t0, r: c[1], b: c[3] }); await page.waitForTimeout(40); }
  console.log('fade at the box:', seen.filter((_, i) => i % 4 === 0).map((x) => `${x.t}:${x.r}/${x.b}`).join(' '));
  const mid = seen.filter((x) => x.r > 10 && x.r < 245);
  expect(mid.length).toBeGreaterThan(8);                                   // (it fades, it doesn't jump)
  for (let i = 1; i < seen.length; i++) {
    expect(seen[i].r).toBeLessThanOrEqual(seen[i - 1].r + 1);              // red only goes down
    expect(seen[i].b).toBeGreaterThanOrEqual(seen[i - 1].b - 1);           // blue only goes up
    expect(Math.abs(seen[i].b - seen[i - 1].b)).toBeLessThan(90);          // no step bigger than a third
  }
  expect(seen.at(-1)).toMatchObject({ r: 0, b: 255 });
  // a change gets there quickly: red picked, the box sends it within half a second
  await selectAll(page);
  const c0 = Date.now();
  await swatch(page, 'Red');
  await expect.poll(async () => (await boxOut(4)).ch[1], { timeout: 3000, intervals: [20] }).toBe(255);
  const ms = Date.now() - c0;
  console.log('click to box output:', ms, 'ms');
  expect(ms).toBeLessThan(500);
});

test('a real box: a template\'s show plays out of it (the looks change with the song), and its machines stay at 0 through a moment while they\'re safe', async ({ page }) => {
  await openConnected(page, BOX);
  // the Wedding's show on the demo beat (nothing to download): every light on universe 0, output A
  const w = await welcome(page), t = demoTile(w, 'Wedding');
  await t.getByLabel('Music for Wedding').selectOption('beat');
  await t.getByRole('button', { name: 'Play the show: Wedding' }).click();
  await expect(w).toBeHidden({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.playing), { timeout: 30000 }).toBe(true);
  // where its machines are, and the first chorus (confetti fires as it lands: only when armed)
  const info = await page.evaluate(() => {
    const a = (window as any).__luxdmx, s = a.show;
    const ch = (re: RegExp) => s.fixtures.filter((f: any) => re.test(f.name)).map((f: any) => f.address - 1);
    const chorus = s.timeline.sections ? s.timeline.sections.find((x: any) => /^chorus/i.test(x.name))?.at : undefined;
    const burst = s.timeline.items.find((i: any) => i.do.do === 'burst' && i.do.attr === 'confetti');
    return { machines: [...ch(/^Confetti/), ...ch(/^Sparks/)], at: chorus ?? burst?.at, last: Math.max(...s.fixtures.map((f: any) => f.address + 20)) };
  });
  expect(info.machines.length).toBe(3);
  expect(info.at).toBeGreaterThan(0);
  const frames: number[][] = [];
  const sample = async (secs: number) => { const t0 = Date.now(); while (Date.now() - t0 < secs * 1000) { frames.push((await boxOut(info.last)).ch); await page.waitForTimeout(150); } };
  // the looks: the box sends something, and it changes as the show goes on (from the song's start:
  // the eight seconds before it hold one look while the guests wait)
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(0));
  await sample(6);
  expect(frames.some((f) => f.some((v) => v > 0))).toBe(true);
  expect(new Set(frames.map((f) => f.join(','))).size).toBeGreaterThan(2);
  // through the moment: just before it, then playing through it; the machines get 0 all along
  frames.length = 0;
  await page.evaluate((at) => (window as any).__luxdmx.timeline.seek(at - 2), info.at);
  await sample(6);
  for (const f of frames) for (const c of info.machines) expect(f[c], `channel ${c + 1}`).toBe(0);
  console.log('wedding at the box:', frames.length, 'frames,', new Set(frames.map((f) => f.join(','))).size, 'different; machines', info.machines.map((c) => c + 1).join(','));
});

