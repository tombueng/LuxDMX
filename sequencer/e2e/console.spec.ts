// The console view: the app laid out like a lighting desk. The command line, a fader, a select and a
// flash button per light and per group, encoders for what the selection has, playback faders with
// GO, Flash and Release, the grand master, the keyboard. Measured on the wire (the fake box).
import type { Page } from '@playwright/test';
import { channels, cues, openConnected, patch, resetFake, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

const view = (page: Page) => page.locator('.console');
const command = async (page: Page, text: string) => {
  await view(page).getByLabel('Command', { exact: true }).fill(text);
  await view(page).getByLabel('Command', { exact: true }).press('Enter');
};
const said = (page: Page) => view(page).locator('.said');
async function rig(page: Page) {
  await openConnected(page);
  await patch(page, 'gen-drgb', 4, 0, 'PAR');               // 1-4 at 1, 5, 9, 13
  await patch(page, 'gen-mover16', 1, 0, 'Head');           // 5 at 17 (pan 17/18, dimmer 22)
  await page.getByRole('tab', { name: 'Console' }).click();
  await expect(view(page)).toBeVisible();
}

test('the command line: lights by number, runs, taking out, levels, words', async ({ page }) => {
  await rig(page);
  await command(page, '1 thru 4 - 2 @ 50');
  await expect(said(page)).toHaveText('3 lights at 50% (2 taken out)');
  await expect.poll(async () => { const c = await channels(0, 16); return [c[0], c[4], c[8], c[12]]; }).toEqual([128, 0, 128, 128]);
  await command(page, '2 @ full');
  await expect.poll(async () => (await channels(0, 16))[4]).toBe(255);
  await command(page, '@ -20');                              // on what's selected (2), from where it is
  await expect.poll(async () => (await channels(0, 16))[4]).toBe(204);
  await command(page, '9 @ 50');
  await expect(said(page)).toHaveText('no light 9');
  await expect(said(page)).toHaveClass(/bad/);
  await command(page, 'clear');
  await expect.poll(async () => { const c = await channels(0, 16); return [c[0], c[4]]; }).toEqual([0, 0]);
  // typed anywhere on the console (not in a field), it goes to the command line; arrow up: the last one again
  await view(page).locator('.enc').click();
  await page.keyboard.type('1>2@75');
  await page.keyboard.press('Enter');
  await expect.poll(async () => { const c = await channels(0, 16); return [c[0], c[4]]; }).toEqual([191, 191]);
  await view(page).getByLabel('Command', { exact: true }).press('ArrowUp');
  await expect(view(page).getByLabel('Command', { exact: true })).toHaveValue('1>2@75');
  // help says what to type; oops takes the last change to the show back
  await command(page, 'help');
  await expect(said(page)).toContainText('Try: 5 @ full');
  const cueCount = () => page.evaluate(() => (window as any).__luxdmx.show.cueLists.reduce((n: number, l: any) => n + l.cues.length, 0));
  await command(page, '1 @ full'); await command(page, 'record');
  await expect.poll(cueCount).toBe(1);
  await command(page, 'oops');
  await expect(said(page)).toHaveText('Undone');
  await expect.poll(cueCount).toBe(0);
});

test('lights keep their numbers when another goes; the patch dialog changes one', async ({ page }) => {
  await rig(page);
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.checkpoint(); a.removeFixture(a.show.fixtures[1].id); });   // PAR 2
  await command(page, '3 @ full');                           // still PAR 3, at 9
  await expect.poll(async () => { const c = await channels(0, 16); return [c[4], c[8]]; }).toEqual([0, 255]);
  await command(page, '1 thru 4 @ 40');                       // a run skips the gap, and says so
  await expect(said(page)).toHaveText('3 lights at 40% (no 2)');
  await command(page, 'clear');
  // the strips show the numbers too
  await expect(view(page).locator('.faders .strip .num')).toHaveText(['1', '3', '4', '5']);
  // the head becomes number 2
  await page.getByRole('tab', { name: 'Program' }).click();
  await page.locator('.fl li[data-fixture="Head"]').dblclick();
  const dlg = page.getByRole('dialog', { name: /Patch: Head/ });
  await dlg.getByLabel('Fixture number').fill('3');
  await dlg.getByLabel('Fixture number').press('Enter');
  await expect(dlg.getByRole('status')).toHaveText("3 is already PAR 3's: pick another, or renumber PAR 3 first");
  await expect(dlg.getByLabel('Fixture number')).toHaveValue('5');       // (refused: its own number again)
  await dlg.getByLabel('Fixture number').fill('2');
  await dlg.getByLabel('Fixture number').press('Enter');
  await expect(dlg.getByRole('status')).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.fl li[data-fixture="Head"] .num')).toHaveText('2');
  await page.getByRole('tab', { name: 'Console' }).click();
  await command(page, '2 @ full');
  await expect.poll(async () => (await channels(0, 32))[21]).toBe(255);
  await command(page, 'clear');
  // the three PARs numbered from 101 in one go, from the list's menu
  await page.getByRole('tab', { name: 'Program' }).click();
  await page.locator('.fl li[data-fixture="PAR 1"]').click();
  await page.locator('.fl li[data-fixture="PAR 4"]').click({ modifiers: ['Shift'] });
  await page.locator('.fl li[data-fixture="PAR 3"]').click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: /Number the 3 from/ }).click();
  const ask = page.getByRole('dialog', { name: 'Number the 3 lights from' });
  await ask.getByRole('textbox').fill('101');
  await ask.getByRole('button', { name: 'Number' }).click();
  await expect(page.locator('.fl li[data-fixture="PAR 4"] .num')).toHaveText('103');
  await page.getByRole('tab', { name: 'Console' }).click();
  await command(page, '101 @ full');
  await expect.poll(async () => (await channels(0, 16))[0]).toBe(255);
});

test('cues by number, and Next / Prev through the selection with Highlight', async ({ page }) => {
  await rig(page);
  await command(page, '1 @ full'); await command(page, 'record');
  await page.evaluate(() => { (window as any).__luxdmx.show.cueLists[0].play = true; });   // a play: cues add up from the top
  await command(page, '3 @ full'); await command(page, 'record');
  await command(page, '4 @ full'); await command(page, 'record cue 1.5 time 0');
  await expect(said(page)).toContainText('Recorded cue 1.5');
  await command(page, 'clear');
  await command(page, 'goto cue 1.5');
  await expect.poll(async () => { const c = await channels(0, 16); return [c[0], c[8], c[12]]; }, { timeout: 6000 }).toEqual([255, 0, 255]);
  // the list's cues from its strip: numbered, the one on stage marked; cue 2 picked goes there
  await view(page).locator('.strip.pb').first().getByRole('button', { name: /^Cues of / }).click();
  const menu = page.locator('.ctx[role=menu]');
  await expect(menu.getByRole('menuitem')).toHaveCount(3);
  await expect(menu.getByRole('menuitem').nth(1)).toContainText('▶ 1.5');
  await menu.getByRole('menuitem').nth(2).click();
  // (a play tracks: cue 2 adds light 3, light 4 from cue 1.5 stays)
  await expect.poll(async () => { const c = await channels(0, 16); return [c[0], c[8], c[12]]; }, { timeout: 6000 }).toEqual([255, 255, 255]);
  await command(page, 'goto cue 1.5');
  await command(page, 'record cue 2');
  await expect(said(page)).toHaveClass(/bad/);
  // Only changes: a cue keeps just what was changed (light 2 at half), nothing else of the stage
  await view(page).getByRole('button', { name: 'Only changes' }).click();
  await command(page, 'clear'); await command(page, '2 @ 50'); await command(page, 'record cue 9');
  expect(await page.evaluate(() => { const l = (window as any).__luxdmx.show.cueLists[0]; return JSON.parse(JSON.stringify(l.cues[l.cues.length - 1].values)); })).toEqual({ [await page.evaluate(() => (window as any).__luxdmx.show.fixtures[1].id)]: { intensity: 0.5 } });
  await view(page).getByRole('button', { name: 'Only changes' }).click();
  await command(page, 'clear'); await command(page, 'delete cue 9'); await command(page, 'goto cue 1.5');
  // the strip's Back: the cue before (here from cue 2 back to cue 1)
  const strip = view(page).locator('.strip.pb').first();
  await expect(strip.getByRole('button', { name: /^GO / })).toHaveAttribute('title', /GO: Cue 2/);
  await strip.getByRole('button', { name: /^GO / }).click();
  await expect.poll(async () => (await channels(0, 16))[8], { timeout: 6000 }).toBe(255);
  await strip.getByRole('button', { name: /^Back / }).click();
  await expect.poll(async () => (await channels(0, 16))[8], { timeout: 6000 }).toBe(0);
  await command(page, 'delete cue 1.5');
  await expect(said(page)).toContainText('Deleted cue 1.5');
  await command(page, 'release');
  await expect.poll(async () => { const c = await channels(0, 16); return [c[0], c[8], c[12]]; }, { timeout: 8000 }).toEqual([0, 0, 0]);
  // Next / Prev: one light of the selection at a time; Highlight puts that one at full
  await command(page, '1 + 3');
  await view(page).getByRole('button', { name: 'Highlight' }).click();
  await view(page).getByRole('button', { name: 'Next ▶' }).click();
  await expect(said(page)).toHaveText('1 PAR 1 (1 of 2)');
  // (the other one of the selection at 15 %: Lowlight, on by default)
  await expect.poll(async () => { const c = await channels(0, 16); return [c[0], c[8], c[4]]; }).toEqual([255, 38, 0]);
  await view(page).getByRole('button', { name: 'Next ▶' }).click();
  await expect(said(page)).toHaveText('3 PAR 3 (2 of 2)');
  await expect.poll(async () => { const c = await channels(0, 16); return [c[0], c[8]]; }).toEqual([38, 255]);
  await view(page).getByRole('button', { name: 'Lowlight' }).click();
  await expect.poll(async () => { const c = await channels(0, 16); return [c[0], c[8]]; }).toEqual([0, 255]);
  await view(page).getByRole('button', { name: '◀ Prev' }).click();                  // back to the first of them
  await expect(said(page)).toHaveText('1 PAR 1 (1 of 2)');
  await expect.poll(async () => { const c = await channels(0, 16); return [c[0], c[8]]; }).toEqual([255, 0]);
  await view(page).getByRole('button', { name: 'All 2' }).click();
  await expect(said(page)).toHaveText('2 selected again');
  await expect.poll(async () => { const c = await channels(0, 16); return [c[0], c[8]]; }).toEqual([255, 255]);
  await view(page).getByRole('button', { name: 'Highlight' }).click();
});

test('faders, select and flash per light; encoders for the selection; record and play back on a playback fader', async ({ page }) => {
  await rig(page);
  const strip = (name: string) => view(page).locator(`.faders .strip[data-strip="${name}"]`);
  // PAR 4's own fader, to full from the keyboard (End, as sliders do)
  await strip('PAR 4').getByRole('slider', { name: 'PAR 4 level' }).focus();
  await page.keyboard.press('End');
  await expect.poll(async () => (await channels(0, 16))[12]).toBe(255);
  // flash PAR 2 while held
  const flash = strip('PAR 2').getByRole('button', { name: 'Flash PAR 2' });
  await flash.hover(); await page.mouse.down();
  await expect.poll(async () => (await channels(0, 16))[4]).toBe(255);
  await page.mouse.up();
  await expect.poll(async () => (await channels(0, 16))[4]).toBe(0);
  // select the head, the Position page, Pan up with the keyboard on its encoder (5 steps of 2 %)
  await strip('Head').getByRole('button', { name: 'Head', exact: true }).click();
  await view(page).getByRole('tab', { name: 'Position' }).click();
  const pan = view(page).getByRole('slider', { name: 'Pan' });
  const before = await pan.getAttribute('aria-valuenow');
  await pan.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
  await expect(pan).toHaveAttribute('aria-valuenow', String(Number(before) + 10));
  await expect.poll(async () => { const c = await channels(0, 28); return Math.round((c[16] * 256 + c[17]) / 655.35); }).toBe(Number(before) + 10);
  // two lights at different levels: the encoder says from where to where, and turns both
  await command(page, '1 @ 20'); await command(page, '2 @ 80'); await command(page, '1 + 2');
  await view(page).getByRole('tab', { name: 'Intensity' }).click();
  const int = view(page).getByRole('slider', { name: 'Intensity', exact: true });
  await expect(int).toHaveAttribute('aria-valuetext', '20–80%');
  await int.focus(); await page.keyboard.press('ArrowUp');
  await expect(int).toHaveAttribute('aria-valuetext', '22–82%');
  await expect.poll(async () => { const c = await channels(0, 16); return [c[0], c[4]]; }).toEqual([56, 209]);   // both turned, each from its own
  // the PARs' colour: the Hue encoder turns them round the wheel (white: to full colour, from red)
  await command(page, '1 thru 4 @ full');
  await view(page).getByRole('tab', { name: 'Colour' }).click();
  const hue = view(page).getByRole('slider', { name: 'Hue' });
  await hue.focus();
  await page.keyboard.press('PageUp'); await page.keyboard.press('PageUp'); await page.keyboard.press('PageUp');   // +0.3 of the wheel: green-ish
  await expect.poll(async () => { const c = await channels(0, 4); return c[2] > c[1] && c[2] > c[3]; }).toBe(true);
  // that colour as a palette, from the console's own row; it shows lit for the light that has it
  await view(page).getByRole('button', { name: '+ Palette' }).click();
  const ask = page.getByRole('dialog', { name: /New colour palette/i });
  await ask.getByRole('textbox').fill('Leaf');
  await ask.getByRole('button', { name: 'Save palette' }).click();
  await expect(view(page).locator('.pals').getByRole('button', { name: 'Leaf', exact: true })).toBeVisible();
  // ... and on the head (not in it when it was made): green-ish on its colour channels too
  await command(page, '5');
  await view(page).locator('.pals').getByRole('button', { name: 'Leaf', exact: true }).click();
  await expect.poll(async () => { const c = await channels(0, 28); return c[24] > c[23] && c[24] > c[25]; }).toBe(true);
  await command(page, '1 thru 4');
  // Record, then the playback: down to 0 lets the list go, up starts it, GO, Flash
  await view(page).getByRole('button', { name: /^Record/ }).click();
  await expect(cues(page)).toHaveCount(1);
  const pb = view(page).locator('.playbacks .strip').first(), fader = pb.getByRole('slider');
  await fader.focus();
  await page.keyboard.press('Home');                          // down to 0: the list lets go
  await expect.poll(async () => (await channels(0, 16))[0], { timeout: 6000 }).toBe(0);
  await page.keyboard.press('End');                         // up: it starts again
  await expect.poll(async () => (await channels(0, 16))[0], { timeout: 6000 }).toBe(255);
  for (let i = 0; i < 5; i++) await page.keyboard.press('PageDown');
  await expect.poll(async () => (await channels(0, 16))[0]).toBe(128);
  // a drag moves it from where it is (a touch on the track doesn't make it jump)
  const box = (await fader.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 5 + box.height * 0.25, { steps: 5 });
  await page.mouse.up();
  // (a quarter of its height down from half: a quarter, give or take a pixel's rounding)
  await expect.poll(async () => Math.abs((await channels(0, 16))[0] - 64) <= 2).toBe(true);
  // down to 0 with the fader, then GO: the list comes back at full (its level isn't left at 0)
  await fader.focus(); await page.keyboard.press('Home');
  await expect.poll(async () => (await channels(0, 16))[0], { timeout: 6000 }).toBe(0);
  await pb.getByRole('button', { name: /^GO/ }).click();
  await expect.poll(async () => (await channels(0, 16))[0], { timeout: 6000 }).toBe(255);
  // the grand master over everything
  const gm = view(page).getByRole('slider', { name: 'Grand master' });
  await gm.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('PageDown');
  await expect.poll(async () => (await channels(0, 16))[0]).toBe(128);
  await page.keyboard.press('End');
  // Space after a click on Record is GO (it doesn't record again)
  await command(page, '2 @ 30');
  await view(page).getByRole('button', { name: /^Record/ }).click();
  await expect(cues(page)).toHaveCount(2);
  await page.keyboard.press(' ');
  await expect(cues(page)).toHaveCount(2);
});

test('a gobo encoder clicks from slot to slot, by name', async ({ page }) => {
  await rig(page);
  await page.getByRole('tab', { name: 'Program' }).click();
  await patch(page, 'gen-spotgobo', 1, 0, 'Spot');             // 6: its gobo is its 12th channel
  const g = (await page.evaluate(() => (window as any).__luxdmx.show.fixtures.find((f: any) => f.name === 'Spot').address)) - 1 + 11;
  await page.getByRole('tab', { name: 'Console' }).click();
  await command(page, '6');
  await view(page).getByRole('tab', { name: 'Beam' }).click();
  const gobo = view(page).getByRole('slider', { name: 'Gobo', exact: true });
  await expect(gobo).toHaveAttribute('aria-valuetext', 'Open');
  await gobo.focus();
  await page.keyboard.press('ArrowUp');
  await expect(gobo).toHaveAttribute('aria-valuetext', 'Dots');
  await expect.poll(async () => (await channels(0, 64))[g]).toBe(15);           // the middle of Dots (10 to 19)
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  await expect(gobo).toHaveAttribute('aria-valuetext', 'Ring');
  await expect.poll(async () => (await channels(0, 64))[g]).toBe(35);
  await page.keyboard.press('ArrowDown');
  await expect(gobo).toHaveAttribute('aria-valuetext', 'Star');
  await expect.poll(async () => (await channels(0, 64))[g]).toBe(25);
  // a beam palette holding that gobo, put back on the spot: the encoder still turns from there
  // (the programmer holds the palette then, not a number)
  await view(page).getByRole('button', { name: '+ Palette' }).click();
  const ask = page.getByRole('dialog', { name: /New beam palette/i });
  await ask.getByRole('textbox').fill('Starry'); await ask.getByRole('button', { name: 'Save palette' }).click();
  await gobo.focus(); await page.keyboard.press('ArrowDown');
  await expect(gobo).toHaveAttribute('aria-valuetext', 'Dots');
  await view(page).locator('.pals').getByRole('button', { name: 'Starry', exact: true }).click();
  await expect.poll(async () => (await channels(0, 64))[g]).toBe(25);
  await gobo.focus(); await page.keyboard.press('ArrowUp');
  await expect(gobo).toHaveAttribute('aria-valuetext', 'Ring');
  await expect.poll(async () => (await channels(0, 64))[g]).toBe(35);
});

test('the Built-in page: a light\'s own program by name, its speed, a colour program', async ({ page }) => {
  await rig(page);
  await page.evaluate(() => {
    const a = (window as any).__luxdmx;
    a.saveType({ id: 'user:ledbar', manufacturer: 'Acme', model: 'Bar FX', source: 'user', modes: [{ name: '4 ch', channels: [
      { name: 'Dimmer', attr: 'intensity' },
      { name: 'Program', attr: 'effectMacro', ranges: [{ from: 0, to: 9, label: 'Off' }, { from: 10, to: 99, label: 'Auto show' }, { from: 100, to: 255, label: 'Sound' }] },
      { name: 'Speed', attr: 'effectSpeed' },
      { name: 'Colour program', attr: 'colorMacro', ranges: [{ from: 0, to: 9, label: 'Off' }, { from: 10, to: 255, label: 'Rainbow fade' }] }] }] });
    a.show.fixtures.push({ id: 'fxb', name: 'FX bar', typeId: 'user:ledbar', mode: '4 ch', universe: 0, address: 41, x: 0.5, y: 0.6 });
    a.checkpoint();
  });
  await command(page, '6');                                     // (numbered after the five)
  await view(page).getByRole('tab', { name: 'Built-in' }).click();
  const prog = view(page).getByRole('slider', { name: 'Built-in effect', exact: true });
  await expect(prog).toHaveAttribute('aria-valuetext', 'Off');
  await prog.focus(); await page.keyboard.press('ArrowUp');
  await expect(prog).toHaveAttribute('aria-valuetext', 'Auto show');
  await expect.poll(async () => (await channels(0, 44))[41]).toBe(55);           // the middle of 10..99
  const speed = view(page).getByRole('slider', { name: 'Effect speed', exact: true });
  await speed.focus(); for (let i = 0; i < 5; i++) await page.keyboard.press('PageUp');
  await expect.poll(async () => (await channels(0, 44))[42]).toBe(128);          // half
  const col = view(page).getByRole('slider', { name: 'Colour program', exact: true });
  await col.focus(); await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await channels(0, 44))[43]).toBe(133);
});

test('groups and cells by command; Space is GO', async ({ page }) => {
  await rig(page);
  await page.getByRole('tab', { name: 'Program' }).click();
  await patch(page, 'gen-bar8', 1, 1, 'Bar');                  // 6, on universe 1
  await page.getByRole('tab', { name: 'Console' }).click();
  await command(page, '6.1 thru 6.3 @ full');
  await expect(said(page)).toHaveText('1 light, 3 cells at 100%');
  await expect.poll(async () => { const c = await channels(1, 24); return [c[0], c[6], c[9]]; }).toEqual([255, 255, 0]);
  // a group by number: the PARs 1 and 2, at 40 on the wire
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.selected = a.show.fixtures.slice(0, 2).map((f: any) => f.id); a.groupFromSelection('Front'); a.selectNone(); });
  await view(page).getByRole('radio', { name: 'Groups' }).click();
  await expect(view(page).locator('.faders .strip')).toHaveCount(1);
  await command(page, 'group 1 @ 40');
  await expect(said(page)).toHaveText('2 lights at 40%');
  await expect.poll(async () => { const c = await channels(0, 16); return [c[0], c[4]]; }).toEqual([102, 102]);
  await command(page, 'clear');
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.show.groups = []; });
  await command(page, '1 @ full');
  await command(page, 'record');
  await command(page, 'clear');
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.engine.stop(a.show.cueLists[0].id); });
  await expect.poll(async () => (await channels(0, 4))[0]).toBe(0);
  await view(page).locator('.enc').click({ position: { x: 3, y: 3 } });   // (its edge: nothing there to press)
  await page.keyboard.press(' ');
  await expect.poll(async () => (await channels(0, 4))[0], { timeout: 6000 }).toBe(255);
  // a group's fader is its master: it scales what the cue gives, it doesn't take the lights over
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.selected = [a.show.fixtures[0].id]; a.groupFromSelection('Solo one'); a.selectNone(); });
  await view(page).getByRole('radio', { name: 'Groups' }).click();
  const master = view(page).getByRole('slider', { name: 'Solo one master' });
  await master.focus();
  await page.keyboard.press('Home');
  await expect.poll(async () => (await channels(0, 4))[0]).toBe(0);
  expect(await page.evaluate(() => Object.keys((window as any).__luxdmx.programmer).length)).toBe(0);
  // said in the top bar wherever you are, and still down after a reload
  await expect(page.locator('.top .gms')).toHaveText('Solo one 0%');
  // (once the tab has put it away for a reload)
  await expect.poll(() => page.evaluate(() => (sessionStorage.getItem('luxdmx.seq.playing') ?? '').includes('"gms"'))).toBe(true);
  await page.reload();
  await expect(page.locator('.top .gms')).toHaveText('Solo one 0%');
  await expect.poll(async () => (await channels(0, 4))[0]).toBe(0);
  await page.locator('.top .gms').click();                                  // (it opens the console)
  await view(page).getByRole('radio', { name: 'Groups' }).click();
  await view(page).getByRole('slider', { name: 'Solo one master' }).focus();
  await page.keyboard.press('End');
  await expect.poll(async () => (await channels(0, 4))[0]).toBe(255);
  await expect(page.locator('.top .gms')).toHaveCount(0);
});

test('the stage beside the desk: a click on a light selects it, the command line shows on it, 3D there too; hidden with its button and remembered', async ({ page }) => {
  await rig(page);
  const stage = view(page).getByRole('region', { name: 'Stage' });
  await expect(stage.locator('.stage-wrap')).toBeVisible();
  // a click on a light on the plan: selected, and the desk says so
  await stage.locator('.fx[data-name="PAR 2"]').click();
  await expect(said(page)).toContainText('1 selected');
  expect(await page.evaluate(() => (window as any).__luxdmx.selected.map((id: string) => (window as any).__luxdmx.show.fixtures.find((f: any) => f.id === id).name))).toEqual(['PAR 2']);
  // what the command line does shows on the plan (the light lit)
  await command(page, '3 @ full');
  await expect.poll(() => page.evaluate(() => { const a = (window as any).__luxdmx, f = a.show.fixtures.find((x: any) => x.name === 'PAR 3'); return a.drawn[f.id]?.intensity; })).toBe(1);
  // 3D in the same place
  await stage.getByRole('button', { name: '3D' }).click();
  await expect(stage.locator('.s3 canvas')).toBeVisible({ timeout: 45_000 });
  await stage.getByRole('button', { name: '2D', exact: true }).click();
  await expect(stage.locator('.s3 canvas')).toHaveCount(0);
  // hidden with its button, and still hidden after a reload
  await view(page).getByRole('button', { name: 'Show the stage' }).click();
  await expect(stage).toHaveCount(0);
  await page.reload();
  await page.getByRole('tab', { name: 'Console' }).click();
  await expect(view(page)).toBeVisible();
  await expect(view(page).getByRole('region', { name: 'Stage' })).toHaveCount(0);
  await expect(view(page).getByRole('button', { name: 'Show the stage' })).toHaveAttribute('aria-pressed', 'false');
});
