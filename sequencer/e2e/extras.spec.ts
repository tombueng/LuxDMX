// Small things that make it nicer: the demo, Highlight, group names on fixture rows.
import { openConnected, resetFake, patch, channels, selectFixtures, tab, test, expect, full, selectAll, selectNone, go, demo } from './helpers';

test.beforeEach(async () => { await resetFake(); });

test('"Show me a demo" plays the big demo: 3D stage, the timeline running, light on the wire', async ({ page }) => {
  await openConnected(page);
  await demo(page);
  await expect(page.locator('.top .show .name')).toHaveText('We Are Not The Band: live');
  await expect(page.locator('.tlv')).toBeVisible();
  await expect(page.locator('.s3 canvas')).toBeVisible({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.playing)).toBe(true);
  expect(await page.evaluate(() => (window as any).__luxdmx.show.fixtures.length)).toBeGreaterThanOrEqual(200);
  await expect.poll(async () => (await channels(0, 304)).some((v) => v > 0), { timeout: 8000 }).toBe(true);
  // (it starts with the show's intro, before the song's 0: the clock runs on from wherever it is)
  const p0: number = await page.evaluate(() => (window as any).__luxdmx.timeline.position);
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.position), { timeout: 8000 }).toBeGreaterThan(p0 + 1);
});

test('Highlight puts the selected lights at full white, not into cues', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 2, 0, 'P');
  await selectFixtures(page, ['P 2']);
  await page.locator('.prog').getByRole('button', { name: 'Highlight' }).click();
  // (a dark PAR keeps its colour channels up: the dimmer channel is what's at zero)
  await expect.poll(() => channels(0, 8)).toEqual([0, 255, 255, 255, 255, 255, 255, 255]);
  await selectFixtures(page, ['P 1']);                                  // it follows the selection
  await expect.poll(() => channels(0, 8)).toEqual([255, 255, 255, 255, 0, 255, 255, 255]);
  await page.locator('.prog').getByRole('button', { name: 'Highlight' }).click();
  await expect.poll(() => channels(0, 8)).toEqual([0, 255, 255, 255, 0, 255, 255, 255]);
  await expect(page.locator('.deck').getByRole('button', { name: /^Record/ })).toBeVisible();
});

test('fixture rows say which groups a light is in', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Band' }).click();
  await tab(page, 'Fixtures');
  await expect(page.locator('.fl li[data-fixture="Front 1"]')).toContainText('Front');
  await expect(page.locator('.fl li[data-fixture="Mover 2"]')).toContainText('Movers');
});

test('a cue sheet to print, and as CSV', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'Theatre' }).click();
  await page.locator('.top').getByRole('button', { name: 'More' }).click();
  const [sheet] = await Promise.all([page.waitForEvent('popup'), page.locator('.ctx').getByRole('menuitem', { name: 'Print a cue sheet' }).click()]);
  await expect(sheet.locator('h1')).toHaveText('Play');
  await expect(sheet.locator('table').first()).toContainText('Audience coming in');
  await expect(sheet.locator('table').first()).toContainText('play "House out" on House lights');
  await page.locator('.top').getByRole('button', { name: 'More' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.ctx').getByRole('menuitem', { name: /CSV/ }).click()]);
  const csv = await (await import('node:fs')).promises.readFile((await dl.path())!, 'utf8');
  expect(csv.split('\r\n')[0]).toBe('List,Cue,Name,Fade,Then,Lights,Effects,Also,Note');
  expect(csv).toContain('Show,1,Preset,3 s,GO');
});

test('arrange the selection on the stage; a picture of the room underneath', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-rgb', 4, 0, 'P');
  const ys = () => page.evaluate(() => (window as any).__luxdmx.show.fixtures.map((f: any) => +f.y.toFixed(3)));
  // scatter them, then line them up again
  await page.evaluate(() => (window as any).__luxdmx.show.fixtures.forEach((f: any, i: number) => { f.y = 0.2 + i * 0.15; }));
  await page.locator('.stage-wrap').getByRole('button', { name: 'Select all' }).click();
  await page.locator('.stage-wrap .fx[data-name="P 1"]').click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: 'Line up the selected lights in a row' }).click();
  expect(new Set(await ys()).size).toBe(1);
  // background picture from the stage menu
  const svg = (await page.locator('.stage-wrap svg[aria-label="Stage"]').boundingBox())!;
  await page.mouse.click(svg.x + 12, svg.y + 12, { button: 'right' });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.ctx').getByRole('menuitem', { name: /Background picture/ }).click()]);
  await chooser.setFiles('test/fixtures/stage.png');
  await expect(page.locator('.stage-wrap svg image')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__luxdmx.show.settings.stage.image.slice(0, 15))).toBe('data:image/jpeg');
});

test('fan the heads; spread a rainbow or a gradient across the selection', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-mover8', 3, 0, 'Head');
  await page.locator('.stage-wrap').getByRole('button', { name: 'Select all' }).click();
  await page.locator('.prog').getByLabel('Fan').fill('0.6');
  // mover8: pan at 1, 9, 17; centred heads spread to 0.2 / 0.5 / 0.8
  await expect.poll(async () => { const c = await channels(0, 24); return [c[0], c[8], c[16]]; }).toEqual([51, 128, 204]);
  await page.locator('.prog').getByRole('button', { name: 'Rainbow' }).click();
  await page.locator('.prog .quick').getByRole('button', { name: 'Full' }).click();
  // R G B at 4-6, 12-14, 20-22: three different colours, the first one red
  await expect.poll(async () => { const c = await channels(0, 24); return [c.slice(3, 6).join(), c.slice(11, 14).join(), c.slice(19, 22).join()]; })
    .toEqual(['255,0,0', expect.any(String), expect.any(String)]);
  const c = await channels(0, 24);
  expect(new Set([c.slice(3, 6).join(), c.slice(11, 14).join(), c.slice(19, 22).join()]).size).toBe(3);
  await page.locator('.prog').getByRole('button', { name: 'Gradient' }).click();      // red to blue
  await expect.poll(async () => { const d = await channels(0, 24); return [d.slice(3, 6).join(), d.slice(19, 22).join()]; }).toEqual(['255,0,0', '0,0,255']);
});

test('a fixture type made in one show is there in the next one (My fixtures)', async ({ page }) => {
  await openConnected(page);
  await tab(page, 'Fixtures');
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  const add = page.getByRole('dialog', { name: 'Add fixtures' });
  await add.getByRole('button', { name: 'Make my own…' }).click();
  await page.getByLabel('Model').fill('Garage PAR');
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '+ Channel' }).click();
  await page.getByLabel('Channel 1 function').selectOption('intensity');
  await page.getByLabel('Channel 2 function').selectOption('red');
  await page.getByRole('button', { name: 'Save type' }).click();
  await add.getByRole('button', { name: /^Add \d+ × / }).click();
  // a new, empty show: the type is offered under My fixtures
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).getByRole('button', { name: 'New blank show' }).click();
  await page.getByRole('button', { name: 'Add your first lights' }).click();
  await expect(add.locator('.mine .tcard', { hasText: 'Garage PAR' })).toHaveCount(1);
  await add.locator('.mine .tcard', { hasText: 'Garage PAR' }).click();
  await add.getByLabel('How many').fill('1');
  await add.getByRole('button', { name: /^Add 1 × / }).click();
  await page.locator('.stage-wrap').getByRole('button', { name: 'Select all' }).click();
  await page.locator('.prog .quick').getByRole('button', { name: 'Full' }).click();
  await expect.poll(() => channels(0, 2)).toEqual([255, 255]);
  // this show has it now: listed with the rest, not twice
  await page.locator('.fl').getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(add.locator('h3', { hasText: 'My fixtures' })).toHaveCount(0);           // already in this show
  await expect(add.locator('[data-type]', { hasText: 'Garage PAR' })).toHaveCount(1);
});

test('a big rig gets a filter on the fixture list', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
  await tab(page, 'Fixtures');
  const all = await page.evaluate(() => (window as any).__luxdmx.show.fixtures.length as number);
  const filter = page.getByLabel('Filter fixtures');
  await filter.fill('mover');
  await expect(page.locator('.fl li.oitem')).toHaveCount(2);
  await filter.fill('25');                                              // an address: the bar that starts at 25
  await expect(page.locator('.fl li.oitem .nm')).toHaveText(['Bar 1']);
  // Ctrl+A while filtered takes only what's shown; deleting a light keeps the field (and the filter) visible
  await filter.fill('pars');                                            // the group: the 8 PARs (not the spark machines)
  await page.locator('.fl li.oitem').first().click();
  await page.locator('.fl .olist').press('Control+a');
  await expect(page.locator('.fl li.oitem.sel')).toHaveCount(8);
  await expect(page.locator('.fl .selbar')).toContainText('8 selected');
  await page.locator('.fl .olist').press('Delete');
  await expect(filter).toBeVisible();                                     // the rest left, but a filter is on
  await expect(page.locator('.fl li.oitem')).toHaveCount(0);
  await filter.fill('');
  await expect(page.locator('.fl li.oitem')).toHaveCount(all - 8);
});

test('the DMX output monitor: what goes out on each channel, and whose it is', async ({ page }) => {
  // count the monitor's redraws: a still look must not be painted 40-100 times a second
  await page.addInitScript(() => {
    const w = window as unknown as { draws: number }; w.draws = 0;
    const orig = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...a: [number, number, number, number]) { if (this.canvas.closest('.surface')) w.draws++; return orig.apply(this, a); };
  });
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');                 // channels 1 and 2
  await patch(page, 'gen-rgb', 1, 0, 'Wash');                 // 3, 4, 5
  await selectAll(page); await full(page);
  await selectNone(page);
  await page.locator('.top').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /DMX output/ }).click();
  const mon = page.getByRole('dialog', { name: 'DMX output' });
  await expect(mon).toContainText('5 of 512 channels patched');
  const d0 = await page.evaluate(() => (window as any).draws);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as any).draws) - d0).toBeLessThan(5);
  const grid = mon.getByRole('button', { name: /DMX values of universe 0/ });
  await grid.focus();
  await grid.press('ArrowRight');                         // the first press lands on channel 1
  await expect(mon.locator('.info')).toContainText('Channel 1: 255 (100%), D 1');
  for (let i = 0; i < 3; i++) await grid.press('ArrowRight');   // channel 4: the wash's green
  await expect(mon.locator('.info')).toContainText(/Channel 4: \d+ .*Wash · Green/);
  await grid.press('Enter');                              // selects that fixture
  await mon.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.fl li.oitem.sel .nm')).toHaveText(['Wash']);
  // the strip under the stage opens it too, on that universe, and says the universe is sending
  await expect(page.locator('.dmx .u.live')).toHaveText('U0');
  await page.locator('.dmx .u', { hasText: 'U0' }).click();
  await expect(page.getByRole('dialog', { name: 'DMX output' })).toContainText('Universe 0');
  await page.keyboard.press('Escape');
  // the first dimmer is at full on the wire, and the monitor said so too
  expect((await channels(0, 2))[0]).toBe(255);
});

test('nothing selected: the programmer offers the groups and shows what is playing', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
  await selectNone(page);
  const prog = page.locator('.prog');
  await prog.locator('.quick').getByRole('button', { name: 'Movers' }).click();
  await expect(prog.locator('.names')).toContainText('Mover 1, Mover 2');
  await selectNone(page);
  await go(page);
  const now = prog.getByRole('region', { name: 'Playing now' });
  await expect(now).toContainText('Moods');
  await now.getByRole('button', { name: 'Release' }).click();
  await expect(now).toHaveCount(0);
});

test('the patch on paper, and the DIP switches for an address', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ hasText: 'DJ / Party' }).click();
  await page.locator('.top').getByRole('button', { name: 'More' }).click();
  const [sheet] = await Promise.all([page.waitForEvent('popup'), page.locator('.ctx').getByRole('menuitem', { name: /Print the patch/ }).click()]);
  await expect(sheet.locator('h2')).toHaveText(['Universe 0']);
  const bar1 = sheet.locator('tr', { hasText: 'Bar 1' });
  await expect(bar1.locator('.a')).toHaveText('25–48');               // 24 channels from 25
  await expect(bar1.locator('.dip rect[y="4.5"]')).toHaveCount(3);     // knobs up: 1 + 8 + 16
  await sheet.close();
  // in the fixture's own row too
  await tab(page, 'Fixtures');
  await page.locator('.fl li.oitem', { hasText: 'Bar 1' }).dblclick();
  const dlg = page.getByRole('dialog', { name: 'Patch: Bar 1' });
  await expect(dlg.locator('.dip .row')).toHaveAttribute('aria-label', /switches 1, 4, 5 on/);
  // flip switch 2 the way it's done on the fixture: the address follows (25 + 2 = 27)
  await dlg.locator('.dip').getByRole('button', { name: 'Switch 2 (2)' }).click();
  await expect(dlg.getByLabel('Fixture address')).toHaveValue('27');
});

test('check the patch: one light at a time at full, then everything as it was', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 3, 0, 'D');
  await selectFixtures(page, ['D 2']);
  await page.locator('.fl').getByRole('button', { name: 'Check the patch' }).click();
  const dlg = page.getByRole('dialog', { name: 'Check the patch' });
  await expect(dlg.locator('h3')).toHaveText('D 1');
  await expect(dlg.getByRole('button', { name: 'Next light' })).toBeFocused();       // not the address field
  await expect.poll(() => channels(0, 3)).toEqual([255, 0, 0]);
  await dlg.getByRole('button', { name: 'Next light' }).click();
  await expect(dlg.locator('h3')).toHaveText('D 2');
  await expect.poll(() => channels(0, 3)).toEqual([0, 255, 0]);
  await page.keyboard.press('ArrowRight');
  await expect(dlg.getByLabel('Address of D 3')).toHaveValue('3');
  await expect.poll(() => channels(0, 3)).toEqual([0, 0, 255]);
  // the dialog sits in a corner: a light clicked on the stage becomes the one checked
  await page.locator('.stage-wrap .fx[data-name="D 1"]').click();
  await expect(dlg.locator('h3')).toHaveText('D 1');
  await expect.poll(() => channels(0, 3)).toEqual([255, 0, 0]);
  await page.keyboard.press('ArrowRight');
  await expect(dlg.locator('h3')).toHaveText('D 2');
  await page.keyboard.press('ArrowRight');
  await expect(dlg.locator('h3')).toHaveText('D 3');
  // a cue playing doesn't hide which light it is: the others stay dark
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.programmer = Object.fromEntries(a.show.fixtures.map((f: any) => [f.id, { intensity: 1 }])); });
  await expect.poll(() => channels(0, 3)).toEqual([0, 0, 255]);
  await page.evaluate(() => { (window as any).__luxdmx.programmer = {}; });
  // an arrow in the address field steps to another light; it never changes an address
  await dlg.getByLabel('Address of D 3').focus();
  await page.keyboard.press('ArrowUp');
  await expect(dlg.locator('h3')).toHaveText('D 2');
  expect(await page.evaluate(() => (window as any).__luxdmx.show.fixtures.find((f: any) => f.name === 'D 3').address)).toBe(3);
  await page.keyboard.press('ArrowDown');
  await expect(dlg.locator('h3')).toHaveText('D 3');
  // fix an address right here: D 3 to 2 says it shares channels with D 2
  await dlg.getByLabel('Address of D 3').fill('2');
  await dlg.getByLabel('Address of D 3').press('Tab');
  await expect(dlg.locator('.err')).toContainText('Shares channels with D 2');
  await page.locator('body').press('Control+z');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect.poll(() => channels(0, 3)).toEqual([0, 0, 0]);
  await expect(page.locator('.fl li.oitem.sel .nm')).toHaveText(['D 2']);       // the selection is back
});
