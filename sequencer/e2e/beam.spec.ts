// Gobos, a second gobo wheel, the light's built-in effects and colour programs, picked by name in the
// programmer for two kinds of head at once (the same name sits elsewhere on each), the new
// rotations as sliders; recorded and played back. Measured on the wire (the fake box).
import type { Page } from '@playwright/test';
import { channels, cues, full, openConnected, record, resetFake, selectAll, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

async function twoSpots(page: Page) {
  await page.evaluate(() => {
    const a = (window as any).__luxdmx;
    const spot = (id: string, gobos: string[]) => ({ id, manufacturer: 'Acme', model: id, source: 'user', modes: [{ name: '6 channel', channels: [
      { name: 'Dimmer', attr: 'intensity' },
      { name: 'Gobo', attr: 'gobo', ranges: [{ from: 0, to: 9, label: 'Open', kind: 'slot' }, { from: 10, to: 19, label: 'Flower', kind: 'slot' }] },
      { name: 'Gobo 2', attr: 'gobo2', ranges: gobos.map((n, i) => ({ from: i * 20, to: i * 20 + 19, label: n, kind: 'slot' })) },
      { name: 'Prism rotation', attr: 'prismRotation' },
      { name: 'Program', attr: 'effectMacro', ranges: [{ from: 0, to: 9, label: 'Off' }, { from: 10, to: 99, label: 'Auto show' }, { from: 100, to: 255, label: 'Sound' }] },
      { name: 'Colour program', attr: 'colorMacro', ranges: [{ from: 0, to: 9, label: 'Off' }, { from: 10, to: 255, label: 'Rainbow fade' }] },
    ] }] });
    a.addType(spot('Spot A', ['Open', 'Star', 'Dots']));
    a.addType(spot('Spot B', ['Open', 'Dots', 'Ring', 'Star']));
    a.show.fixtures.push({ id: 'sa', name: 'Spot A', typeId: 'Spot A', mode: '6 channel', universe: 0, address: 1, x: 0.3, y: 0.3 },
      { id: 'sb', name: 'Spot B', typeId: 'Spot B', mode: '6 channel', universe: 0, address: 11, x: 0.6, y: 0.3 });
    a.checkpoint();
  });
}
const sec = (page: Page, name: string) => page.locator('.prog').getByRole('region', { name, exact: true });

test('gobo 2, a built-in effect and a colour program by name on two kinds of head; recorded and played back', async ({ page }) => {
  await openConnected(page);
  await twoSpots(page);
  await selectAll(page);
  await full(page);
  await sec(page, 'Gobo 2').getByRole('button', { name: 'Star' }).click();
  await sec(page, 'Built-in effect').getByRole('button', { name: 'Auto show' }).click();
  await sec(page, 'Colour program').getByRole('button', { name: 'Rainbow fade' }).click();
  await page.locator('.prog').getByLabel('Prism rotation', { exact: true }).fill('1');
  // "Star" is the 2nd slot on A (20..39) and the 4th on B (60..79)
  await expect.poll(async () => { const c = await channels(0, 16); return [c[2], c[12], c[3], c[13], c[4], c[14], c[5]]; })
    .toEqual([30, 70, 255, 255, 55, 55, 133]);
  await expect(sec(page, 'Gobo 2')).toContainText('Star');
  await record(page);
  await expect(cues(page)).toHaveCount(1);
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.engine.stop(a.show.cueLists[0].id); });
  await expect.poll(async () => (await channels(0, 16))[0]).toBe(0);
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.engine.jumpTo(a.show.cueLists[0].id, 0, 0); });
  await expect.poll(async () => { const c = await channels(0, 16); return [c[2], c[12], c[4], c[14], c[5]]; }).toEqual([30, 70, 55, 55, 133]);
});
