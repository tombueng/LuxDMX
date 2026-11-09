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
