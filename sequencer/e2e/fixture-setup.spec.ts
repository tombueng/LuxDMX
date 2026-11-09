// A light's setup (the patch dialog's Channels and Mounting tabs, and the real light over RDM in its
// Patch tab): a hung head set to standing turns in the show and its beam in the little 3D picture
// points up; the test moves reach the fake box only with "On the real lights too" on and not Blind,
// and are let go after; pointing it at a mark works its offsets out; a group gets one light's setup
// (mirrored on the other side, each in its own place); a mode's channels and what another mode does
// to the lights after it; what the real light says over RDM, and its address, mode and name set
// from there. axe on each tab.
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { openConnected, resetFake, patch, channels, pixelPorts, test, expect, FAKE, selectFixtures, full } from './helpers';

test.beforeEach(async () => { await resetFake(); });

const AXE = fs.readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
async function audit(page: Page, what: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || (a.effect?.getComputedTiming().iterations ?? 1) === Infinity), undefined, { timeout: 3000 }).catch(() => {});
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => (await (window as any).axe.run(document, { resultTypes: ['violations'] })).violations.map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(' ')).join(' | ')}`));
  expect(r, what).toEqual([]);
}
const fixture = (page: Page, name: string) => page.evaluate((n) => JSON.parse(JSON.stringify((window as any).__luxdmx.show.fixtures.find((f: any) => f.name === n))), name);
const programmer = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__luxdmx.programmer)));
const beam = (page: Page, id: string) => page.evaluate((i) => (window as any).__setup3d?.beam(i) ?? null, id);
async function openSetup(page: Page, name: string, tab: 'Mounting' | 'Channels' | 'Patch' = 'Mounting') {
  await page.locator(`.fl li[data-fixture="${name}"]`).dblclick();
  const dlg = page.getByRole('dialog', { name: `Patch: ${name}` });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('tab', { name: tab }).click();
  return dlg;
}

test('a hung head set to standing: its turn changes, the picture\'s beam points up; the front, the exact angles, a PAR pointed', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover8', 1, 0, 'Head');
  const id = (await fixture(page, 'Head')).id;
  const dlg = await openSetup(page, 'Head');
  // hung at Home: the beam goes straight down
  await expect.poll(() => beam(page, id), { timeout: 30000 }).not.toBeNull();
  await expect.poll(async () => (await beam(page, id)).y).toBeLessThan(-0.95);
  const mounts = dlg.getByRole('group', { name: 'How it is mounted' });
  await expect(mounts.getByRole('button', { name: 'Hung' })).toHaveAttribute('aria-pressed', 'true');
  await mounts.getByRole('button', { name: 'Standing' }).click();
  await expect.poll(async () => (await fixture(page, 'Head')).rot).toEqual({ yaw: 0, pitch: 0, roll: 0 });
  expect((await fixture(page, 'Head')).p3.y).toBeCloseTo(1.2, 2);        // (on the deck, under where it hung)
  await expect(mounts.getByRole('button', { name: 'Standing' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await beam(page, id)).y).toBeGreaterThan(0.95);
  // its front to the left: turned a quarter; then tipped by hand
  await dlg.getByLabel('Its front faces').selectOption('left');
  await expect.poll(async () => (await fixture(page, 'Head')).rot.yaw).toBe(-90);
  await dlg.getByLabel('Tip', { exact: true }).fill('30');
  await dlg.getByLabel('Tip', { exact: true }).press('Tab');
  await expect.poll(async () => (await fixture(page, 'Head')).rot.pitch).toBe(30);
  // on its side, on the left: the beam goes towards the middle (+x)
  await mounts.getByRole('button', { name: 'On its side, left' }).click();
  await expect.poll(async () => (await beam(page, id)).x).toBeGreaterThan(0.95);
  await audit(page, 'the Mounting tab of a moving head');
  await dlg.getByRole('button', { name: 'Done' }).click();

  // a PAR: where it points
  await patch(page, 'gen-drgb', 1, 0, 'Par');
  const p = await openSetup(page, 'Par');
  await p.getByRole('group', { name: 'Where it points' }).getByRole('button', { name: 'At the audience' }).click();
  await expect.poll(async () => (await fixture(page, 'Par')).rot).toEqual({ yaw: 0, pitch: 100, roll: 0 });
  await p.getByRole('group', { name: 'Where it points' }).getByRole('button', { name: 'Straight up' }).click();
  await expect.poll(async () => (await fixture(page, 'Par')).rot.pitch).toBe(0);
  const parId = (await fixture(page, 'Par')).id;
  await expect.poll(async () => (await beam(page, parId))?.y ?? 0).toBeGreaterThan(0.95);
});

test('test moves reach the real head only when switched on and not Blind, and are let go after; a mark works out its offsets', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover8', 1, 0, 'Head');          // pan 1, tilt 2, dimmer 3 (pan and tilt rest at 128)
  await patch(page, 'gen-drgb', 1, 0, 'Par');             // 9..12, lit: the output runs (a fresh start sends nothing)
  await selectFixtures(page, ['Par']);
  await full(page);
  await expect.poll(async () => { const c = await channels(0, 9); return [c[0], c[1], c[2], c[8]]; }).toEqual([128, 128, 0, 255]);
  const head = (await fixture(page, 'Head')).id, mine = async () => (await programmer(page))[head];
  let dlg = await openSetup(page, 'Head');
  const tries = dlg.getByRole('group', { name: 'Test moves' });
  // the picture only
  await tries.getByRole('button', { name: 'Pan to 0 %' }).click();
  await page.waitForTimeout(600);
  expect(await channels(0, 3)).toEqual([128, 128, 0]);
  expect(await mine()).toBeUndefined();
  // switched on but Blind: still nothing new goes out
  await dlg.getByRole('button', { name: 'Done' }).click();
  await page.locator('.top .out').click();
  await expect(page.locator('.top .out')).toHaveAttribute('aria-pressed', 'false');
  dlg = await openSetup(page, 'Head');
  await dlg.getByLabel('On the real lights too').check();
  await expect(dlg.getByRole('status').filter({ hasText: 'Blind' })).toBeVisible();
  await dlg.getByRole('group', { name: 'Test moves' }).getByRole('button', { name: 'Pan to 0 %' }).click();
  await page.waitForTimeout(600);
  expect(await channels(0, 3)).toEqual([128, 128, 0]);
  // on stage (from the note): pan 0 and the beam on the wire; Home puts pan and tilt at 50 %
  await dlg.getByRole('button', { name: 'Go on stage' }).click();
  await page.getByRole('dialog', { name: 'Send to the stage?' }).getByRole('button', { name: 'Go on stage' }).click();
  await expect.poll(() => channels(0, 3)).toEqual([0, 128, 255]);
  await dlg.getByRole('group', { name: 'Test moves' }).getByRole('button', { name: 'Tilt to 100 %' }).click();
  await expect.poll(() => channels(0, 3)).toEqual([0, 255, 255]);
  await dlg.getByRole('group', { name: 'Test moves' }).getByRole('button', { name: 'Home' }).click();
  await expect.poll(() => channels(0, 3)).toEqual([128, 128, 255]);

  // pointed at the centre of the stage, nudged by hand onto the "real" mark, then said so
  await dlg.getByRole('group', { name: 'Marks' }).getByRole('button', { name: 'Centre of the stage' }).click();
  const aimed = await mine();
  await dlg.getByLabel('Nudge by').selectOption('5');
  await dlg.getByRole('button', { name: 'Pan +' }).click();
  await dlg.getByRole('button', { name: 'Pan +' }).click();
  await expect.poll(async () => (await mine()).pan).toBeCloseTo(aimed.pan + 10 / 540, 4);
  await dlg.getByRole('button', { name: "It's on the mark" }).click();
  await expect(dlg.getByRole('status').filter({ hasText: 'Pan offset' })).toBeVisible();
  const f = await fixture(page, 'Head');
  expect(Math.abs(Math.abs(f.panOffset) - 10)).toBeLessThan(0.2);
  // the model agrees now: aimed at the centre again, it sends what the hand found
  const nudged = (await mine()).pan;
  await dlg.getByRole('group', { name: 'Marks' }).getByRole('button', { name: 'Centre of the stage' }).click();
  expect(Math.abs((await mine()).pan - nudged)).toBeLessThan(0.001);

  // switched off: the head gets back what it had (nothing: its defaults, dark); the PAR stays up
  await dlg.getByLabel('On the real lights too').uncheck();
  await expect.poll(() => channels(0, 3)).toEqual([128, 128, 0]);
  expect(await mine()).toBeUndefined();
  // on again, then the dialog closed: the same
  await dlg.getByLabel('On the real lights too').check();
  await expect.poll(() => channels(0, 3)).not.toEqual([128, 128, 0]);
  await dlg.getByRole('button', { name: 'Done' }).click();
  await expect.poll(() => channels(0, 3)).toEqual([128, 128, 0]);
  expect(await mine()).toBeUndefined();
  expect((await channels(0, 9))[8]).toBe(255);
});

test('a group gets the setup: each in its own place, mirrored on the other side, one light copied to the rest', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover8', 3, 0, 'Head');
  const before = await Promise.all(['Head 1', 'Head 2', 'Head 3'].map((n) => fixture(page, n)));
  const dlg = await openSetup(page, 'Head 1');
  await dlg.getByLabel('Set up', { exact: true }).selectOption({ label: 'All 3 Moving head, 8 ch' });
  await expect.poll(() => page.evaluate(() => (window as any).__setup3d?.stats().lights)).toBe(3);
  await dlg.getByRole('group', { name: 'How it is mounted' }).getByRole('button', { name: 'Standing' }).click();
  const heads = () => Promise.all(['Head 1', 'Head 2', 'Head 3'].map((n) => fixture(page, n)));
  await expect.poll(async () => (await heads()).map((h) => h.rot.roll)).toEqual([0, 0, 0]);
  // (each stands where it hung: its own x, its plan place unchanged)
  const after = await heads();
  expect(new Set(after.map((h) => h.p3.x)).size).toBe(3);
  expect(after.map((h) => [h.x, h.y])).toEqual(before.map((h) => [h.x, h.y]));
  await dlg.getByLabel('Invert pan').check();
  await expect.poll(async () => (await heads()).map((h) => !!h.invertPan)).toEqual([true, true, true]);
  // its pan turning the other way round from its type: for the picture only, nothing on the wire
  const wire = await channels(0, 24);
  await dlg.getByLabel('Pan turns the other way round').check();
  await expect.poll(async () => (await heads()).map((h) => !!h.panReversed)).toEqual([true, true, true]);
  await page.waitForTimeout(300);
  expect(await channels(0, 24)).toEqual(wire);
  await dlg.getByLabel('Pan turns the other way round').uncheck();
  // on its side on the left: a head on the other side of the middle gets the mirror image
  await dlg.getByRole('group', { name: 'How it is mounted' }).getByRole('button', { name: 'On its side, left' }).click();
  const side = await heads();
  expect(side[0].rot.roll).toBe(-90);
  for (const h of side.slice(1)) if (Math.sign(h.p3.x) !== Math.sign(side[0].p3.x) && Math.abs(h.p3.x) > 0.25) expect(h.rot.roll).toBe(90);
  // one light set up on its own, then copied to the others (with its offsets when asked)
  await dlg.getByLabel('Set up', { exact: true }).selectOption({ label: 'Head 1 only' });
  await dlg.getByLabel('Invert tilt').check();
  await dlg.getByLabel('Pan offset').fill('7');
  await dlg.getByLabel('Pan offset').press('Tab');
  await expect.poll(async () => (await heads()).map((h) => !!h.invertTilt)).toEqual([true, false, false]);
  await dlg.getByLabel('Set up', { exact: true }).selectOption({ label: 'All 3 Moving head, 8 ch' });
  await dlg.getByLabel('with its offsets').check();
  await dlg.getByRole('button', { name: 'Make the other 2 like Head 1' }).click();
  await expect.poll(async () => (await heads()).map((h) => !!h.invertTilt)).toEqual([true, true, true]);
  expect((await heads()).map((h) => Math.abs(h.panOffset ?? 0))).toEqual([7, 7, 7]);
});

test('every channel tried on the real light, and what a channel does changed for one light or for all', async ({ page }) => {
  await openConnected(page);
  await page.evaluate(() => {
    const a = (window as any).__luxdmx, ch = (name: string, attr: string, x: any = {}) => ({ name, attr, ...x });
    const basic = [ch('Pan', 'pan', { default: 128 }), ch('Tilt', 'tilt', { default: 128 }), ch('Dimmer', 'intensity'), ch('Red', 'red'), ch('Green', 'green'), ch('Blue', 'blue'), ch('Strobe', 'strobe'), ch('Speed', 'speed')];
    const t = a.addType({ id: 'user-spot2', manufacturer: 'Test', model: 'Spot Two', source: 'user', modes: [{ name: 'Basic', channels: basic }] });
    a.addFixtures(t, 'Basic', 2, 0, 'Spot', 1);
  });
  const dlg = await openSetup(page, 'Spot 1', 'Channels');
  // a value on its dimmer (channel 3): on the wire, and the row says it's held
  await dlg.getByLabel('Dimmer DMX value').fill('200');
  await dlg.getByLabel('Dimmer DMX value').press('Tab');
  await expect.poll(async () => (await channels(0, 16))[2]).toBe(200);
  await expect(dlg.locator('tr[data-ch="3"]')).toHaveClass(/held/);
  await dlg.getByRole('button', { name: 'Let go of Dimmer' }).click();
  await expect(dlg.locator('tr[data-ch="3"]')).not.toHaveClass(/held/);
  // every channel at once: its defaults (pan and tilt at 128), then let go of all
  await dlg.getByRole('button', { name: 'All to default' }).click();
  await expect.poll(async () => channels(0, 8)).toEqual([128, 128, 0, 0, 0, 0, 0, 0]);
  await dlg.getByRole('button', { name: 'All full' }).click();
  await expect.poll(async () => channels(0, 8)).toEqual([255, 255, 255, 255, 255, 255, 255, 255]);
  await dlg.getByRole('button', { name: 'Let go of all' }).click();
  const id1 = (await fixture(page, 'Spot 1')).id;
  await expect.poll(async () => Object.keys((await programmer(page))[id1]?.raw ?? {})).toEqual([]);
  // channel 7 is really a shutter: changed for Spot 1 only, which gets its own copy of the type
  await dlg.getByRole('button', { name: 'Change what the channels do…' }).click();
  await dlg.getByLabel('Channel 7 does').selectOption('shutter');
  await dlg.getByLabel('Channel 7 name').fill('Shutter');
  await dlg.getByLabel('Channel 7 name').press('Tab');
  await audit(page, 'changing what the channels do');
  await dlg.getByRole('button', { name: 'Only for Spot 1' }).click();
  const s1 = await fixture(page, 'Spot 1'), s2 = await fixture(page, 'Spot 2');
  expect(s1.typeId).not.toBe('user-spot2');
  expect(s2.typeId).toBe('user-spot2');
  const typeOf = (id: string) => page.evaluate((i) => JSON.parse(JSON.stringify((window as any).__luxdmx.show.fixtureTypes.find((t: any) => t.id === i))), id);
  const own = await typeOf(s1.typeId);
  expect(own.model).toBe('Spot Two (Spot 1)');
  expect(own.modes[0].channels[6]).toMatchObject({ name: 'Shutter', attr: 'shutter' });
  expect((await typeOf('user-spot2')).modes[0].channels[6]).toMatchObject({ name: 'Strobe', attr: 'strobe' });
  await expect(dlg.locator('tr[data-ch="7"]')).toContainText('Shutter');
  await dlg.getByRole('button', { name: 'Done' }).click();
  // Spot 2: a type of your own changes in place, for every light that has it
  const d2 = await openSetup(page, 'Spot 2', 'Channels');
  await d2.getByRole('button', { name: 'Change what the channels do…' }).click();
  await d2.getByLabel('Channel 8 name').fill('Move speed');
  await d2.getByLabel('Channel 8 name').press('Tab');
  await d2.getByRole('button', { name: 'Save it to the type' }).click();
  expect((await typeOf('user-spot2')).modes[0].channels[7].name).toBe('Move speed');
  expect((await fixture(page, 'Spot 2')).typeId).toBe('user-spot2');
});

test("a matrix's channels: one pixel stands for all, its colour order changed in one go", async ({ page }) => {
  await pixelPorts([[12, 1]]);
  await openConnected(page);
  await patch(page, 'gen-matrix8x8', 1, 12, 'Matrix');
  const dlg = await openSetup(page, 'Matrix', 'Channels');
  await expect(dlg.getByRole('table', { name: 'The channels of 192 ch' }).locator('tbody tr')).toHaveCount(3);
  // the red slider sets every pixel's red
  await dlg.getByLabel('Red DMX value').fill('100');
  await dlg.getByLabel('Red DMX value').press('Tab');
  await expect.poll(async () => (await channels(12, 192)).filter((v, i) => i % 3 === 0 && v === 100).length).toBe(64);
  // the panel is GRB: the first channel of each pixel is green, the second red
  await dlg.getByRole('button', { name: 'Change what the channels do…' }).click();
  await dlg.getByLabel('Channel 1 does').selectOption('green');
  await dlg.getByLabel('Channel 2 does').selectOption('red');
  await dlg.getByRole('button', { name: 'Save', exact: true }).click();
  const t = await page.evaluate(() => { const a = (window as any).__luxdmx, f = a.show.fixtures[0]; return JSON.parse(JSON.stringify(a.show.fixtureTypes.find((x: any) => x.id === f.typeId))); });
  expect(t.source).toBe('user');
  expect(t.modes[0].layout).toMatchObject({ kind: 'matrix', cols: 8, rows: 8, zigzag: true });
  expect(t.modes[0].channels.slice(0, 6).map((c: any) => [c.name, c.attr])).toEqual([['Green 1', 'green'], ['Red 1', 'red'], ['Blue 1', 'blue'], ['Green 2', 'green'], ['Red 2', 'red'], ['Blue 2', 'blue']]);
  expect(t.modes[0].channels[189]).toMatchObject({ name: 'Green 64', attr: 'green', cell: 63 });
});

test("a mode's channels, and what another mode does to the lights after it", async ({ page }) => {
  await openConnected(page);
  // a spot with two modes, two of them one after the other
  await page.evaluate(() => {
    const a = (window as any).__luxdmx, ch = (name: string, attr: string, x: any = {}) => ({ name, attr, ...x });
    const basic = [ch('Pan', 'pan', { default: 128 }), ch('Tilt', 'tilt', { default: 128 }), ch('Dimmer', 'intensity'), ch('Red', 'red'), ch('Green', 'green'), ch('Blue', 'blue'), ch('Strobe', 'strobe'), ch('Speed', 'speed')];
    const ext = [ch('Pan', 'pan', { default: 128 }), ch('Pan fine', 'pan', { fine: true }), ch('Tilt', 'tilt', { default: 128 }), ch('Tilt fine', 'tilt', { fine: true }), ch('Dimmer', 'intensity'), ch('Red', 'red'), ch('Green', 'green'), ch('Blue', 'blue'), ch('Strobe', 'strobe'), ch('Speed', 'speed'),
      ch('Colour wheel', 'colorWheel', { ranges: [{ from: 0, to: 9, label: 'White', kind: 'slot', color: '#ffffff' }, { from: 10, to: 19, label: 'Red', kind: 'slot', color: '#ff0000' }] })];
    const t = a.addType({ id: 'user-spot2', manufacturer: 'Test', model: 'Spot Two', source: 'user', modes: [{ name: 'Basic', channels: basic }, { name: 'Extended', channels: ext }] });
    a.addFixtures(t, 'Basic', 2, 0, 'Spot', 1);
  });
  const dlg = await openSetup(page, 'Spot 1', 'Channels');
  const table = dlg.getByRole('table', { name: 'The channels of Basic' });
  await expect(table.locator('tbody tr')).toHaveCount(8);
  const modes = dlg.locator('.modes li');
  await expect(modes).toHaveCount(1);
  await expect(modes).toContainText('3 channels more: it uses 1 to 11');
  await expect(modes).toContainText('Spot 2 9 → 12');
  await audit(page, 'the Channels tab');
  // used as it is: it now shares channels; the Patch tab offers to move the light after it
  await modes.getByRole('button', { name: 'Use it', exact: true }).click();
  await expect(dlg.getByRole('table', { name: 'The channels of Extended' }).locator('tbody tr')).toHaveCount(11);
  await expect(dlg.getByRole('table', { name: 'The channels of Extended' }).locator('tbody tr').nth(1)).toContainText('fine, with channel 1 (16 bit)');
  await expect(dlg.getByRole('table', { name: 'The channels of Extended' }).locator('tbody tr').nth(10)).toContainText('Red 10–19');
  await expect(dlg.locator('.modes li')).toContainText('3 channels fewer: it uses 1 to 8, 9 to 11 come free');
  await dlg.getByRole('tab', { name: 'Patch' }).click();
  await expect(dlg.locator('.err')).toContainText('Shares channels with Spot 2');
  await dlg.getByRole('button', { name: 'Move the light after it up instead' }).click();
  await expect.poll(async () => (await fixture(page, 'Spot 2')).address).toBe(12);
  await expect(dlg.locator('.err')).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Done' }).click();
  // on the wire: Spot 2's dimmer (its third channel) is now channel 14
  await selectFixtures(page, ['Spot 2']);
  await full(page);
  await expect.poll(async () => (await channels(0, 16))[13]).toBe(255);
});

test('the real light over RDM in its patch: what it says, its address, mode and name set from there', async ({ page }) => {
  test.setTimeout(90_000);
  await openConnected(page);
  // the fake box's moving head (11 channels, universe 1 at 1) patched at 5, knowing its light; a PAR
  // that knows its light (8 channels on the rig, 5 in the patch)
  await patch(page, 'gen-mover16', 1, 1, 'Head');
  await patch(page, 'gen-drgbw', 1, 0, 'Par');
  await page.evaluate(() => {
    const a = (window as any).__luxdmx, [h, p] = a.show.fixtures;
    h.address = 5; h.uid = '4C55:00000010'; p.address = 60; p.uid = '4C55:00000002'; a.markDirty(0);
  });
  const rdm = async (uid: string) => (await (await fetch(`http://${FAKE}/rdm.json`)).json()).devices.find((d: any) => d.uid === uid);
  let dlg = await openSetup(page, 'Head', 'Patch');
  const box = dlg.locator('.real');
  await expect(box).toContainText('knows its light');
  await box.getByRole('button', { name: 'Scan the rig' }).click();
  await expect(box).toContainText('Head 11', { timeout: 15000 });
  await expect(box).toContainText('1.1 to 11');
  await expect(box).toContainText('the patch says 1.5 to 15');
  await expect(box).toContainText('11 channel, 11 ch');
  await expect(box).toContainText('45 °C');
  await audit(page, 'the Patch tab with the real light');
  await box.getByRole('button', { name: 'Set the light to 5' }).click();
  await expect.poll(async () => (await rdm('4C55:00000010')).addr, { timeout: 10000 }).toBe(5);
  await expect(box).not.toContainText('the patch says', { timeout: 10000 });
  await box.getByRole('button', { name: 'Identify' }).click();
  await expect.poll(async () => (await rdm('4C55:00000010')).identify).toBe(true);
  await box.getByRole('button', { name: 'Name it Head' }).click();
  await expect.poll(async () => (await rdm('4C55:00000010')).label).toBe('Head');
  await dlg.getByRole('button', { name: 'Done' }).click();

  // the PAR: the light is in its 8 channel mode; set to the patch's 5 from here
  dlg = await openSetup(page, 'Par', 'Patch');
  const pbox = dlg.locator('.real');
  await expect(pbox).toContainText('8 channel, 8 ch');
  await expect(pbox).toContainText('the patch has 5');
  await pbox.getByRole('button', { name: 'Light to 5 channel' }).click();
  await expect.poll(async () => (await rdm('4C55:00000002')).pers, { timeout: 10000 }).toBe(2);
  // and any of its modes from its own list
  await pbox.getByLabel("The light's mode").selectOption({ label: '3 channel (3 ch)' });
  await expect.poll(async () => (await rdm('4C55:00000002')).pers, { timeout: 10000 }).toBe(1);
});

test("a light's menu has Mounting…: the setup opens on its Mounting tab; the next time the dialog opens on Patch", async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover8', 2, 0, 'Head');
  // (both selected: the entry is for them)
  await page.locator('.fl li[data-fixture="Head 1"]').click({ button: 'right' });
  await expect(page.locator('.ctx').getByRole('menuitem', { name: 'Mounting of the 2 selected…' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.fl li[data-fixture="Head 1"]').click();
  await page.locator('.fl li[data-fixture="Head 1"]').click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: 'Mounting…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Patch: Head 1' });
  await expect(dlg.getByRole('tab', { name: 'Mounting' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await page.locator('.fl li[data-fixture="Head 1"]').dblclick();
  await expect(dlg.getByRole('tab', { name: 'Patch' })).toHaveAttribute('aria-selected', 'true');
});
