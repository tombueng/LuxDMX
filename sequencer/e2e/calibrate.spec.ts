// Focus and calibrate: two moving heads that really hang somewhere else than the show thinks
// (made up here: moved, turned, with offsets), steered onto the four corner marks through the
// dialog's Pan % and Tilt % (what a person does by eye with the arrows); the app works out where
// they hang, and with that the show points them where the real ones point. On the wire while
// steering, only the head being steered lit; the marks kept as position presets; marks moved by
// hand are kept with the show.
import type { Page } from '@playwright/test';
import { openConnected, patch, channels, resetFake, tab, test, expect } from './helpers';
import { aimAt, roomOf, type Optics, type Rot, type V3 } from '../src/stage3d/geometry';
import { calMarks, placeOf } from '../src/model/fixtureSetup';

test.beforeEach(async () => { await resetFake(); });

const lights = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__luxdmx.show.fixtures)));
const O: Optics = { panDeg: 540, tiltDeg: 270, panOffset: 0, tiltOffset: 0, invertPan: false, invertTilt: false };
interface Truth { p: V3; rot: Rot; panOffset: number; tiltOffset: number }

test('two heads steered onto four marks: where they really hang, then the show points them right', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover16', 2, 0, 'Head');
  const room = roomOf(undefined);
  // where the show thinks they are, and where they "really" are
  const shown = (await lights(page)).map((f: any) => placeOf(f, 'mover', room));
  const truth: Truth[] = shown.map((s: { p: V3; rot: Rot }, i: number) => ({
    p: { x: s.p.x + (i ? -0.5 : 0.6), y: s.p.y - 0.4, z: s.p.z + 0.3 }, rot: { yaw: s.rot.yaw + (i ? -6 : 7), pitch: s.rot.pitch + 2, roll: s.rot.roll },
    panOffset: i ? -11 : 9, tiltOffset: i ? 3 : -4,
  }));
  const marks = calMarks(room).slice(0, 4);
  const real = (i: number, m: V3) => aimAt(truth[i].p, truth[i].rot, m, { ...O, panOffset: truth[i].panOffset, tiltOffset: truth[i].tiltOffset })!;

  await tab(page, 'Fixtures');
  await page.locator('.fl li[data-fixture="Head 1"]').click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: 'Focus and calibrate the 2 heads…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Focus and calibrate: 2 heads' });
  await expect(dlg.getByRole('table', { name: 'The marks' }).locator('tbody tr')).toHaveCount(5);
  await dlg.getByLabel('On the real heads').check();

  for (const [mi, m] of marks.entries()) {
    await dlg.getByRole('radio', { name: `${mi + 1} ${m.name}` }).click();
    for (const i of [0, 1]) {
      const name = `Head ${i + 1}`, v = real(i, m.p);
      await dlg.getByRole('radio', { name: new RegExp(`^${name}`) }).click();
      await dlg.getByLabel('Pan %').fill((v.pan * 100).toFixed(5));
      await dlg.getByLabel('Pan %').press('Tab');
      await dlg.getByLabel('Tilt %').fill((v.tilt * 100).toFixed(5));
      await dlg.getByLabel('Tilt %').press('Tab');
      if (mi === 0) {
        // on the wire: this head's pan (16 bit), lit; the other one dark
        const at = i * 11;
        await expect.poll(async () => { const c = await channels(0, 22); return Math.abs(c[at] * 256 + c[at + 1] - Math.round(v.pan * 65535)); }, { timeout: 6000 }).toBeLessThan(2);
        const c = await channels(0, 22);
        expect(c[at + 5]).toBe(255);
        expect(c[(1 - i) * 11 + 5]).toBe(0);
      }
      await dlg.getByRole('button', { name: `${name} is on ${m.name}` }).click();
    }
  }
  await expect(dlg.getByRole('radio', { name: /^Head 1/ })).toContainText('4 of 5');

  await dlg.getByRole('button', { name: 'Work it out for 2' }).click();
  const res = dlg.getByRole('list', { name: 'Results' });
  await expect(res.locator('li')).toHaveCount(2);
  await expect(res.locator('li[data-head="Head 1"]')).toContainText('Fits all its marks within 1 cm');
  await expect(res.locator('li[data-head="Head 2"]')).toContainText('Fits all its marks within 1 cm');
  await dlg.getByRole('button', { name: 'Use it', exact: true }).click();
  const after = await lights(page);
  for (const i of [0, 1]) {
    const f = after[i];
    expect(Math.hypot(f.p3.x - truth[i].p.x, f.p3.y - truth[i].p.y, f.p3.z - truth[i].p.z), `Head ${i + 1}'s place`).toBeLessThan(0.02);
    // (its turn about its own up and its pan offset are the same thing to a head, so they're
    // checked together: the show now aims it at spots it was never steered to just as the real
    // one gets there, the centre mark and one in the audience)
    for (const c of [calMarks(room)[4].p, { x: -2, y: 0, z: 7 }]) {
      const mine = aimAt(f.p3, f.rot, c, { ...O, panOffset: f.panOffset ?? 0, tiltOffset: f.tiltOffset ?? 0 })!, theirs = real(i, c);
      expect(Math.abs(mine.pan - theirs.pan) * 540, `Head ${i + 1} pan`).toBeLessThan(0.3);
      expect(Math.abs(mine.tilt - theirs.tilt) * 270, `Head ${i + 1} tilt`).toBeLessThan(0.3);
    }
  }

  // the marks as position presets: each head's own pan and tilt in each
  await dlg.getByRole('button', { name: 'Keep the marks as position presets' }).click();
  // (next to the position presets the app made for the heads when they were patched)
  const names = marks.map((m) => m.name);
  const presets = (await page.evaluate(() => JSON.parse(JSON.stringify((window as any).__luxdmx.show.presets.filter((p: any) => p.kind === 'position')))))
    .filter((p: any) => names.includes(p.name));
  expect(presets.map((p: any) => p.name)).toEqual(names);
  for (const [mi, m] of marks.entries()) for (const i of [0, 1]) {
    const own = presets[mi].perFixture[after[i].id];
    expect(Math.abs(own.pan - real(i, m.p).pan)).toBeLessThan(1e-6);
  }
  // a mark moved to where the tape really is: kept with the show
  await dlg.getByLabel('Mark 5 across').fill('0.5');
  await dlg.getByLabel('Mark 5 across').press('Tab');
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.settings.marks?.[4]?.p.x)).toBe(0.5);
  // closing lets the heads go
  await dlg.getByRole('button', { name: 'Close' }).click();
  await expect.poll(async () => (await channels(0, 22))[5], { timeout: 6000 }).toBe(0);
});

test('the arrows steer the head being steered; a head needs three marks', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover8', 1, 0, 'Head');
  await tab(page, 'Fixtures');
  await page.locator('.fl li[data-fixture="Head"]').click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: 'Focus and calibrate…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Focus and calibrate: Head' });
  const pan = async () => Number(await dlg.getByLabel('Pan %').inputValue());
  const p0 = await pan();
  await dlg.getByLabel('Step').selectOption('5');
  await dlg.getByRole('button', { name: 'Pan plus' }).click();
  expect(await pan()).toBeCloseTo(p0 + 500 / 540, 1);
  await dlg.getByRole('group', { name: 'Steer Head' }).focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  expect(await pan()).toBeCloseTo(p0 - 500 / 540, 1);
  await expect(dlg.getByRole('button', { name: 'Work it out' })).toBeDisabled();
  await expect(dlg).toContainText('A head needs three marks');
});

test('a head that pans 630° and tilts 250° where its profile says 540° and 270°: six marks, one raised, measure it', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover16', 1, 0, 'Head');
  const room = roomOf(undefined);
  const s = placeOf((await lights(page))[0], 'mover', room);
  const truth: Truth = { p: { x: s.p.x + 0.4, y: s.p.y - 0.3, z: s.p.z + 0.2 }, rot: { yaw: s.rot.yaw + 5, pitch: s.rot.pitch, roll: s.rot.roll }, panOffset: 6, tiltOffset: -2 };
  const realO: Optics = { ...O, panDeg: 630, tiltDeg: 250, panOffset: truth.panOffset, tiltOffset: truth.tiltOffset };
  const marks = calMarks(room);
  await tab(page, 'Fixtures');
  await page.locator('.fl li[data-fixture="Head"]').click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: 'Focus and calibrate…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Focus and calibrate: Head' });
  const steerOnto = async (mi: number) => {
    const m = marks[mi], v = aimAt(truth.p, truth.rot, m.p, realO)!;
    await dlg.getByRole('radio', { name: `${mi + 1} ${m.name}` }).click();
    await dlg.getByLabel('Pan %').fill((v.pan * 100).toFixed(5)); await dlg.getByLabel('Pan %').press('Tab');
    await dlg.getByLabel('Tilt %').fill((v.tilt * 100).toFixed(5)); await dlg.getByLabel('Tilt %').press('Tab');
    await dlg.getByRole('button', { name: `Head is on ${m.name}` }).click();
  };
  // four marks: they don't meet, and it says six (one at another height) would measure the ranges
  for (const mi of [0, 1, 2, 3]) await steerOnto(mi);
  await dlg.getByRole('button', { name: 'Work it out for 1' }).click();
  const res = dlg.getByRole('list', { name: 'Results' }).locator('li[data-head="Head"]');
  await expect(res).toContainText('Six marks or more, one at least 40 cm higher or lower than the rest, measure it');
  // the fifth on a box 90 cm up, and a sixth: measured
  await dlg.getByLabel('Mark 5 height').fill(String(Math.round((marks[4].p.y + 0.9) * 100) / 100));
  await dlg.getByLabel('Mark 5 height').press('Tab');
  marks[4] = { ...marks[4], p: { ...marks[4].p, y: Math.round((marks[4].p.y + 0.9) * 100) / 100 } };
  await steerOnto(4);
  await dlg.getByRole('button', { name: '+ Mark' }).click();
  await dlg.getByLabel('Mark 6 across').fill('1.5'); await dlg.getByLabel('Mark 6 across').press('Tab');
  marks.push(...(await page.evaluate(() => (window as any).__luxdmx.show.settings.marks.slice(5))));
  await steerOnto(5);
  await dlg.getByRole('button', { name: 'Work it out for 1' }).click();
  await expect(res).toContainText(/Its pan goes 6[23]\d° and its tilt 2[45]\d°, not the 540° and 270°/);
  await expect(res).toContainText('Fits all its marks within');
  await expect(res.getByRole('checkbox', { name: /Keep 6\d\d° and 2\d\d° for Head/ })).toBeChecked();
  await dlg.getByRole('button', { name: 'Use it', exact: true }).click();
  const f = (await lights(page))[0];
  expect(Math.abs(f.panDeg - 630)).toBeLessThan(6);
  expect(Math.abs(f.tiltDeg - 250)).toBeLessThan(3);
  // the show now aims it at a spot it was never steered to just as the real one gets there
  const spot = { x: 1, y: 1.2, z: 0.5 };
  const mine = aimAt(f.p3, f.rot, spot, { ...O, panDeg: f.panDeg, tiltDeg: f.tiltDeg, panOffset: f.panOffset ?? 0, tiltOffset: f.tiltOffset ?? 0 })!, theirs = aimAt(truth.p, truth.rot, spot, realO)!;
  expect(Math.abs(mine.pan - theirs.pan) * 630).toBeLessThan(1);
  expect(Math.abs(mine.tilt - theirs.tilt) * 250).toBeLessThan(1);
});

test('a light whose profile has no pan and tilt (plain channels): find them, then it calibrates like any head', async ({ page }) => {
  await openConnected(page);
  // a light the library doesn't know, as RDM patches it: "Channel 1" to "Channel 6", nothing named
  await page.evaluate(() => {
    const a = (window as any).__luxdmx;
    a.addType({ id: 'rdm-1234-9', manufacturer: 'Maker 1234', model: 'Model 9', source: 'user', modes: [{ name: '6 channel', channels: [1, 2, 3, 4, 5, 6].map((i) => ({ name: `Channel ${i}`, attr: 'raw' })) }] });
    a.show.fixtures.push({ id: 'mx', name: 'Mystery', typeId: 'rdm-1234-9', mode: '6 channel', universe: 0, address: 1, x: 0.5, y: 0.3 });
    a.checkpoint();
  });
  await tab(page, 'Fixtures');
  await page.locator('.fl li[data-fixture="Mystery"]').click({ button: 'right' });
  await expect(page.locator('.ctx').getByRole('menuitem', { name: 'Focus and calibrate…' })).toHaveCount(0);
  await page.locator('.ctx').getByRole('menuitem', { name: 'Find pan and tilt…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Find pan and tilt: Mystery' });
  // trying a slider reaches the real light
  await dlg.getByLabel('Try channel 3').fill('200');
  await expect.poll(async () => (await channels(0, 6))[2]).toBe(200);
  const rows = dlg.getByRole('table', { name: 'Its channels' }).locator('tbody tr');
  await rows.nth(0).getByRole('button', { name: 'Pan' }).click();
  await rows.nth(2).getByRole('button', { name: 'Tilt' }).click();
  await dlg.getByLabel('Pan fine channel').selectOption('1');      // (channel 2)
  await rows.nth(3).getByRole('button', { name: 'Dimmer' }).click();
  await dlg.getByLabel('Pan range in degrees').fill('630');
  await dlg.getByRole('button', { name: 'Save and focus on marks…' }).click();
  // it's a head now: the calibration opens for it, and its type says so
  await expect(page.getByRole('dialog', { name: 'Focus and calibrate: Mystery' })).toBeVisible();
  const t = await page.evaluate(() => { const a = (window as any).__luxdmx; const f = a.show.fixtures.find((x: any) => x.id === 'mx'); return JSON.parse(JSON.stringify(a.show.fixtureTypes.find((x: any) => x.id === f.typeId))); });
  expect(t.modes[0].channels.slice(0, 4).map((c: any) => [c.name, c.attr, !!c.fine])).toEqual([['Pan', 'pan', false], ['Pan fine', 'pan', true], ['Tilt', 'tilt', false], ['Dimmer', 'intensity', false]]);
  expect(t.physical).toEqual({ panDeg: 630, tiltDeg: 270 });
  // the try values were let go: home (128) on pan and tilt, from the light's own defaults
  await expect.poll(async () => { const c = await channels(0, 3); return [c[0], c[2]]; }).toEqual([128, 128]);
});
