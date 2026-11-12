// The rig with RDM, through the real bridge page to the fake box's RDM controller (four made-up
// lights on its lines, test/fake-luxdmx.mjs): a scan finds them, each held against the patch (a
// match, one that knows its light but sits elsewhere in another mode, two the show doesn't know),
// Identify reaches the light, "Make the rig match the show" sets the light's address and mode over
// RDM, the new lights get patched where they are (remembering which light they are), and while the
// rig is watched a light that stops answering shows up in the log and on the boxes.
import type { Page } from '@playwright/test';
import { channels, openConnected, resetFake, patch, test, expect, FAKE } from './helpers';

test.beforeEach(async () => { await resetFake(); });
const rdm = async () => (await fetch(`http://${FAKE}/rdm.json`)).json();
const light = async (uid: string) => (await rdm()).devices.find((d: { uid: string }) => d.uid === uid);
const row = (page: Page, uid: string) => page.locator(`.rig li.row[data-uid="${uid}"]`);

test('scan the rig, check it against the patch, fix it both ways, patch the new lights, watch it', async ({ page }) => {
  test.setTimeout(120_000);
  await openConnected(page);
  // the show: a PAR where the rig has one (a match), another PAR that knows its light (it's elsewhere
  // on the rig, in another mode)
  await patch(page, 'gen-drgbw', 1, 0, 'Par A');
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.show.fixtures[0].address = 40; a.markDirty(0); });
  await patch(page, 'gen-drgbw', 1, 0, 'Par B');
  await page.evaluate(() => { const a = (window as any).__luxdmx, f = a.show.fixtures[1]; f.address = 70; f.uid = '4C55:00000002'; a.markDirty(0); });

  await page.locator('.top').getByRole('button', { name: 'Rig', exact: true }).or(page.locator('.top').getByRole('button', { name: /LuxDMX boxes/ })).first().click();
  if (!(await page.getByRole('dialog', { name: 'The rig (RDM)' }).isVisible())) await page.getByRole('button', { name: /The rig \(RDM\)/ }).click();
  const dlg = page.getByRole('dialog', { name: 'The rig (RDM)' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Scan the rig' }).click();
  await expect(dlg.locator('li.row')).toHaveCount(4, { timeout: 15000 });
  await expect(dlg.getByRole('button', { name: /^Scan again/ })).toBeEnabled({ timeout: 15000 });

  // the match, by address
  await expect(row(page, '4C55:00000001')).toContainText('Par A');
  await expect(row(page, '4C55:00000001')).not.toHaveClass(/warn|bad/);
  // the one that knows its light: elsewhere, in another mode; the fixes either way
  const b = row(page, '4C55:00000002');
  await expect(b).toContainText('Par B');
  await expect(b).toContainText('another address, another mode');
  await expect(b.getByRole('button', { name: 'Set the light to 70' })).toBeVisible();
  await expect(b.getByRole('button', { name: 'Move the patch to 0.60' })).toBeVisible();
  // the spot: its maker, model and its head's temperature
  await expect(row(page, '5253:00000101')).toContainText('Robin 600E Spot');
  await expect(row(page, '5253:00000101')).toContainText('°C');
  await expect(row(page, '5253:00000101')).toContainText('not in the show');

  // Identify reaches the real light, and selects its fixture
  await row(page, '4C55:00000001').getByRole('button', { name: 'Identify' }).click();
  await expect.poll(async () => (await light('4C55:00000001')).identify).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.selected)).toEqual([await page.evaluate(() => (window as any).__luxdmx.show.fixtures[0].id)]);
  await row(page, '4C55:00000001').getByRole('button', { name: 'Identify' }).click();
  await expect.poll(async () => (await light('4C55:00000001')).identify).toBe(false);

  // the rig made to match the show: Par B's light to address 70, in its 5-channel mode, over RDM
  await dlg.getByRole('button', { name: /Make the rig match the show \(2 changes\)/ }).click();
  await expect.poll(async () => { const d = await light('4C55:00000002'); return [d.addr, d.pers]; }, { timeout: 10000 }).toEqual([70, 2]);
  await expect(b).not.toContainText('another address', { timeout: 10000 });
  // (it stays amber: the light itself reports a warning, shown with it)
  await expect(b).toContainText('warning');

  // the lights the show doesn't know: patched where they are, as many channels as they use, each
  // remembering its light
  await dlg.getByRole('button', { name: /Patch the 2 new lights/ }).click();
  // (Par B knew its light already; Par A matches by its address until "Remember it")
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.fixtures.filter((f: any) => f.uid).length), { timeout: 30000 }).toBe(3);
  const added = await page.evaluate(() => { const a = (window as any).__luxdmx; return a.show.fixtures.filter((f: any) => ['5253:00000101', '4C55:00000010'].includes(f.uid)).map((f: any) => [f.uid, f.universe, f.address, a.modeOf(f.id).channels.length]).sort(); });
  expect(added).toEqual([['4C55:00000010', 1, 1, 11], ['5253:00000101', 0, 1, 37]]);
  await expect(dlg.locator('.chip.ok')).toContainText('4 match');

  // watching: a light that stops answering shows up in the log and on the boxes
  await dlg.getByLabel('Watch the rig').check();
  await fetch(`http://${FAKE}/rdm/test`, { method: 'POST', body: JSON.stringify({ drop: '4C55:00000010' }) });
  await expect(dlg.locator('.log summary')).toBeVisible();
  await dlg.locator('.log summary').click();
  await expect(dlg.locator('.log')).toContainText('stopped answering', { timeout: 15000 });
  await expect(row(page, '4C55:00000010')).toHaveCount(0);
  await expect(dlg.locator('.chip.bad')).toContainText('1 not answering');
});

test("a box without RDM through its bridge page says so plainly", async ({ page }) => {
  await openConnected(page);
  // (an older bridge page: RDM requests are never answered)
  await page.evaluate(() => { const b = (window as any).__luxdmx.bridges[0]; b.rdm = () => Promise.resolve({ ok: false, error: 'timeout' }); });
  await page.locator('body').press('Control+k');
  await page.getByRole('combobox', { name: 'Find anything' }).fill('rig rdm');
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog', { name: 'The rig (RDM)' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Scan the rig' }).click();
  await expect(dlg.locator('.src.no')).toContainText('firmware has no RDM for the sequencer yet');
});

test('a light found on the line is patched with the show\'s own type for its RDM ids, in the mode its personality is', async ({ page }) => {
  test.setTimeout(120_000);
  await openConnected(page);
  // "Head 11" (LuxDMX Test, model 0x0010, personality 1 = 11 channels): an imported GDTF-like type of
  // your own that says so, with two modes; its personality 1 is the second one
  await page.evaluate(() => {
    const a = (window as any).__luxdmx;
    const chs = (n: number) => Array.from({ length: n }, (_, i) => ({ name: i === 0 ? 'Pan' : i === 2 ? 'Tilt' : `Ch ${i + 1}`, attr: i === 0 ? 'pan' : i === 2 ? 'tilt' : 'raw' }));
    a.addType({ id: 'gdtf:LuxDMX Test/Head 11', manufacturer: 'LuxDMX Test', model: 'Head 11 (GDTF)', source: 'gdtf', modes: [{ name: 'Basic', channels: chs(11) }, { name: 'Standard', channels: chs(11) }],
      rdm: { maker: 0x4c55, model: 0x0010, modes: { 1: 'Standard' } } });
  });
  await page.locator('.top').getByRole('button', { name: 'Rig', exact: true }).or(page.locator('.top').getByRole('button', { name: /LuxDMX boxes/ })).first().click();
  if (!(await page.getByRole('dialog', { name: 'The rig (RDM)' }).isVisible())) await page.getByRole('button', { name: /The rig \(RDM\)/ }).click();
  const dlg = page.getByRole('dialog', { name: 'The rig (RDM)' });
  await dlg.getByRole('button', { name: 'Scan the rig' }).click();
  await expect(dlg.locator('li.row')).toHaveCount(4, { timeout: 15000 });
  await dlg.getByRole('button', { name: /Patch the \d new lights/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.show.fixtures.find((f: any) => f.uid === '4C55:00000010')?.typeId), { timeout: 30000 }).toBe('gdtf:LuxDMX Test/Head 11');
  const head = await page.evaluate(() => { const a = (window as any).__luxdmx, f = a.show.fixtures.find((x: any) => x.uid === '4C55:00000010'); return [f.mode, a.kinds[f.id]]; });
  expect(head).toEqual(['Standard', 'mover']);
  // the two "Par 6" lights the show doesn't know get one plain type between them, with its RDM ids
  const pars = await page.evaluate(() => { const a = (window as any).__luxdmx; return a.show.fixtures.filter((f: any) => f.uid?.startsWith('4C55:0000000')).map((f: any) => a.types.get(f.typeId)?.rdm); });
  expect(pars.length).toBe(2);
  expect(pars[0]).toMatchObject({ maker: 0x4c55, model: 6 });
});

test('a pyro device nobody\'s library knows comes in with every channel waiting for Arm', async ({ page }) => {
  await openConnected(page);
  await fetch(`http://${FAKE}/reset?pyro=1`, { method: 'POST' });     // (after: connecting starts the fake afresh)
  await page.locator('.top').getByRole('button', { name: 'Rig', exact: true }).or(page.locator('.top').getByRole('button', { name: /LuxDMX boxes/ })).first().click();
  if (!(await page.getByRole('dialog', { name: 'The rig (RDM)' }).isVisible())) await page.getByRole('button', { name: /The rig \(RDM\)/ }).click();
  const dlg = page.getByRole('dialog', { name: 'The rig (RDM)' });
  await dlg.getByRole('button', { name: 'Scan the rig' }).click();
  await expect(dlg.locator('li.row')).toHaveCount(5, { timeout: 15000 });
  await dlg.getByRole('button', { name: /Patch the \d new lights/ }).click();
  await expect.poll(() => page.evaluate(() => { const a = (window as any).__luxdmx, f = a.show.fixtures.find((x: any) => x.uid === '7A70:00000001'); return f ? a.modeOf(f.id).channels.map((c: any) => [c.name, c.attr]) : null; }), { timeout: 30000 })
    .toEqual([['Pyro 1', 'flame'], ['Pyro 2', 'flame']]);
  // all at full in "All channels" on stage: nothing on the wire while not armed
  await page.evaluate(() => { const a = (window as any).__luxdmx, f = a.show.fixtures.find((x: any) => x.uid === '7A70:00000001'); a.setRawOf(f.id, [[0, 255], [1, 255]]); });
  for (let t = 0; t < 600; t += 50) { const c = await channels(0, 101); expect([c[99] ?? 0, c[100] ?? 0]).toEqual([0, 0]); await page.waitForTimeout(50); }
});
