// Effect machines from fixture files and from the fixture editor are gated on the wire like the
// built-in ones: a flame projector and CO2 jets imported from the QLC+ library (copies in
// src/import/testdata) and a home-made flame machine send 0 at full until Arm is held; a fogger's
// fog amount is fog (Full lights its LEDs without fogging, Blind stops the fog).
import type { Page } from '@playwright/test';
import { openConnected, channels, history, resetFake, selectAll, tab, test, expect } from './helpers';

const DATA = 'src/import/testdata';
const addDialog = (page: Page) => page.getByRole('dialog', { name: 'Add fixtures' });
async function openAdd(page: Page) {
  await tab(page, 'Fixtures');
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(addDialog(page)).toBeVisible();
}
async function importFile(page: Page, file: string, mode?: string) {
  await openAdd(page);
  await addDialog(page).locator('input[type=file]').setInputFiles(`${DATA}/${file}`);
  if (mode) await addDialog(page).getByLabel('Mode', { exact: true }).selectOption({ label: mode });
  await addDialog(page).getByLabel('How many').fill('1');
  await addDialog(page).getByLabel('Universe').fill('0');
  await addDialog(page).getByRole('button', { name: /^Add \d+ × / }).click();
  await expect(addDialog(page)).toBeHidden();
}
// what the show made of each patched fixture's channels, and where it sits
const patched = (page: Page) => page.evaluate(() => {
  const a = (window as any).__luxdmx;
  return a.show.fixtures.map((f: any) => {
    const t = a.show.fixtureTypes.find((x: any) => x.id === f.typeId);
    const m = t.modes.find((x: any) => x.name === f.mode) ?? t.modes[0];
    return { address: f.address, attrs: m.channels.map((c: any) => c.attr) };
  });
});
const slider = (page: Page, label: string) => page.locator(`.prog input[type=range][aria-label="${label}"]`);
// A new shot once armed: one that was on before arming waits until it has been off (a frame or more)
async function shot(page: Page, label: string) {
  await slider(page, label).fill('0');
  await page.waitForTimeout(300);
  await slider(page, label).fill('1');
}
// Arm: held for a moment (a click alone doesn't arm)
async function holdArm(page: Page) {
  const arm = page.locator('.top .arm');
  const box = (await arm.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(1400); await page.mouse.up();
  await expect(arm).toHaveAttribute('aria-pressed', 'true');
}

test.beforeEach(async () => { await resetFake(); });

test('a flame projector from a QLC+ file: at full it sends 0 until Arm is held', async ({ page }) => {
  await openConnected(page);
  await importFile(page, 'MagicFX-Stage-Flame.qxf');
  expect(await patched(page)).toEqual([{ address: 1, attrs: ['enable', 'flame'] }]);
  await selectAll(page);
  const t0 = Date.now();
  await slider(page, 'Flame').fill('1');                       // full
  await page.waitForTimeout(800);
  expect(await channels(0, 2)).toEqual([0, 0]);                // Safety, Fire: nothing on the wire
  const fire = (await history(0, 2)).filter(([at]) => at >= t0);
  expect(fire.every(([, v]) => v === 0), JSON.stringify(fire.slice(-4))).toBe(true);
  await holdArm(page);
  await page.waitForTimeout(300);
  // its own Safety channel goes LIVE (101..153) with the arming; the flame, on since before, waits for an off
  expect(await channels(0, 2)).toEqual([127, 0]);
  await shot(page, 'Flame');
  await expect.poll(async () => channels(0, 2)).toEqual([127, 255]);
  await page.locator('.top .arm').click();                     // safe again: both locks shut
  await expect.poll(async () => channels(0, 2)).toEqual([0, 0]);
});

test('CO2 jets from QLC+ files (one of them filed as "Smoke") send 0 at full while safe', async ({ page }) => {
  await openConnected(page);
  await importFile(page, 'MagicFX-Eco2Jet.qxf', 'Standard Personality (2 ch)');
  await importFile(page, 'MagicFX-Psyco2Jet.qxf', 'RAW (4 ch)');
  const [eco, psy] = await patched(page);
  expect(eco.attrs).toEqual(['enable', 'co2']);
  expect(psy.attrs).toEqual(['enable', 'tilt', 'speed', 'co2']);
  await selectAll(page);
  await slider(page, 'CO2').fill('1');
  await page.waitForTimeout(800);
  const ch = await channels(0, 8);
  expect([ch[eco.address], ch[psy.address + 2]]).toEqual([0, 0]);   // Eco2Jet "Effect", Psyco2Jet "Output"
  await holdArm(page);
  await shot(page, 'CO2');
  await expect.poll(async () => { const c = await channels(0, 8); return [c[eco.address], c[psy.address + 2]]; }).toEqual([255, 255]);
  // their Enable / Safety channels: "Enable" (100..154) and "Device enabled" (100..155) while armed
  expect(await channels(0, 8).then((c) => [c[eco.address - 1], c[psy.address - 1]])).toEqual([127, 128]);
  await page.locator('.top .arm').click();
  await expect.poll(async () => { const c = await channels(0, 8); return [c[eco.address - 1], c[eco.address], c[psy.address - 1], c[psy.address + 2]]; }).toEqual([0, 0, 0, 0]);
});

test('a home-made fixture with a Flame channel is gated the same way', async ({ page }) => {
  await openConnected(page);
  await openAdd(page);
  await addDialog(page).getByRole('button', { name: 'Make my own…' }).click();
  await page.getByLabel('Model').fill('Garage flamer');
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '+ Channel' }).click();
  const fn = page.getByLabel('Channel 2 function');
  await expect(fn.locator('optgroup[label="Machines"] option')).toHaveText([
    'Confetti (fires only while armed)', 'Bubbles', 'Flame (fires only while armed)', 'Sparks (fire only while armed)', 'CO2 jet (fires only while armed)',
    'Safety / enable (on only while armed)']);
  await page.getByLabel('Channel 1 function').selectOption('control');
  await fn.selectOption('flame');
  await page.getByLabel('Mode name').fill('2 ch');
  await page.getByRole('button', { name: 'Save type' }).click();
  await addDialog(page).getByLabel('How many').fill('1');
  await addDialog(page).getByLabel('Universe').fill('0');
  await addDialog(page).getByRole('button', { name: /^Add \d+ × / }).click();
  await expect(addDialog(page)).toBeHidden();
  expect(await patched(page)).toEqual([{ address: 1, attrs: ['control', 'flame'] }]);
  await selectAll(page);
  await slider(page, 'Flame').fill('1');
  await page.waitForTimeout(800);
  expect(await channels(0, 2)).toEqual([0, 0]);
  await holdArm(page);
  await shot(page, 'Flame');
  await expect.poll(async () => (await channels(0, 2))[1]).toBe(255);
  await page.locator('.top .arm').click();
  await expect.poll(async () => (await channels(0, 2))[1]).toBe(0);
});

test('a fogger from a QLC+ file: its fog amount is fog, Full lights its LEDs without fogging, Blind stops the fog', async ({ page }) => {
  await openConnected(page);
  await importFile(page, 'Stairville-AF-180-LED-Fogger-Co2-FX.qxf');
  expect((await patched(page))[0].attrs).toEqual(['fog', 'intensity', 'colorWheel', 'effectMacro', 'red', 'green', 'blue']);
  await selectAll(page);
  await page.locator('#pg-int .quick').getByRole('button', { name: 'Full' }).click();   // intensity full: the LEDs
  await expect.poll(async () => (await channels(0, 2))[1]).toBe(255);
  await page.waitForTimeout(500);
  expect((await channels(0, 2))[0]).toBe(0);                   // no fog from a dimmer
  await page.locator('.prog .fogq .quick').getByRole('button', { name: 'Full' }).click();
  await expect.poll(async () => (await channels(0, 2))[0]).toBe(255);
  await page.locator('.top .out').click();                     // blind: one click
  await expect(page.locator('.top .out')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await channels(0, 2))[0]).toBe(0);
  expect((await channels(0, 2))[1]).toBe(255);                 // the light stays as it was
});

test('a flame projector\'s own program waits for Arm, and goes to 0 the moment the output goes blind', async ({ page }) => {
  await openConnected(page);
  await page.evaluate(() => {
    const a = (window as any).__luxdmx;
    a.saveType({ id: 'user:fp', manufacturer: 'Test', model: 'Flame + program', source: 'user', modes: [{ name: '2 ch', channels: [
      { name: 'Fire', attr: 'flame' }, { name: 'Program', attr: 'effectMacro', ranges: [{ from: 0, to: 9, label: 'Off' }, { from: 10, to: 255, label: 'Auto 1' }] }] }] });
    a.show.fixtures.push({ id: 'fp', name: 'Flame', typeId: 'user:fp', mode: '2 ch', universe: 0, address: 1, x: 0.5, y: 0.2 });
    a.checkpoint();
    a.selected = ['fp']; a.setSlot('effectMacro', 'Auto 1', 1);
  });
  // (sampled over the whole time, not one look: a safety "never" has to hold all along)
  const never = async (ms: number) => { for (let t = 0; t < ms; t += 50) { const c = await channels(0, 2); expect([c[0] ?? 0, c[1] ?? 0]).toEqual([0, 0]); await page.waitForTimeout(50); } };
  await never(600);                                                    // not armed: nothing
  // armed: one already on when it was armed waits until it has been off (arming never fires by itself)
  await holdArm(page);
  await never(400);
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.setSlot('effectMacro', 'Off', 0); });
  await expect.poll(async () => (await channels(0, 2))[1]).toBe(5);    // its Off goes out (the middle of 0..9)
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.setSlot('effectMacro', 'Auto 1', 1); });
  await expect.poll(async () => (await channels(0, 2))[1]).toBe(133);  // now it runs (the middle of Auto 1)
  await page.locator('.top .out').click();                             // blind
  await expect(page.locator('.top .out')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await channels(0, 2))[1]).toBe(0);    // the program stops on the wire too
});
