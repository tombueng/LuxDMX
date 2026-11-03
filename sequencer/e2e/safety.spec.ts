// Safety on the wire: blind keeps the stage as it was (nothing new goes out until you go live);
// confetti, flames, sparks and CO2 send 0 until someone holds Arm; a timeline jumped about over a
// flame moment never fires it, playing through it does (armed).
import { openConnected, resetFake, channels, history, patch, selectAll, full, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

test('blind: the lights keep what they had, the next look waits until Live', async ({ page }) => {
  await openConnected(page);                              // (connect goes live)
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await selectAll(page); await full(page);
  await expect.poll(() => channels(0, 2)).toEqual([255, 255]);
  await page.locator('.top .out').click();                // blind: one click, no question
  await expect(page.locator('.top .out')).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.programmer = { ...a.programmer, [a.show.fixtures[0].id]: { intensity: 0.2 } }; });
  await page.waitForTimeout(800);
  expect(await channels(0, 2)).toEqual([255, 255]);       // the stage didn't change
  await page.locator('.top .out').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Go on stage' }).click();
  await expect.poll(() => channels(0, 2)).toEqual([51, 255]);
});

test('a flame projector sends 0 until Arm is held, and arming never fires one that was already on; one click makes it safe again', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-flame', 1, 0, 'Flame');
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.programmer = { [a.show.fixtures[0].id]: { flame: 1 } }; });
  await page.waitForTimeout(600);
  expect(await channels(0, 1)).toEqual([0]);
  const arm = page.locator('.top .arm');
  await expect(arm).toHaveAttribute('aria-pressed', 'false');
  await arm.click();                                       // a click alone doesn't arm
  await page.waitForTimeout(300);
  expect(await channels(0, 1)).toEqual([0]);
  const box = (await arm.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(1400); await page.mouse.up();
  await expect(arm).toHaveAttribute('aria-pressed', 'true');
  // it was on before arming: it waits until it has been off (arming fires nothing by itself)
  await page.waitForTimeout(600);
  expect(await channels(0, 1)).toEqual([0]);
  await page.evaluate(() => { (window as any).__luxdmx.programmer = {}; });
  await page.waitForTimeout(200);
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.programmer = { [a.show.fixtures[0].id]: { flame: 1 } }; });
  await expect.poll(() => channels(0, 1)).toEqual([255]);
  await arm.click();                                       // the next click after the hold makes it safe
  await expect(arm).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => channels(0, 1)).toEqual([0]);
});

test('blind: nothing to arm; going blind makes the machines safe and stops fog; Blackout still reaches the stage', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 1, 0, 'D');
  await patch(page, 'gen-fog', 1, 0, 'Fog');
  await patch(page, 'gen-flame', 1, 0, 'Flame');
  const ids = await page.evaluate(() => (window as any).__luxdmx.show.fixtures.map((f: any) => f.id));
  await page.evaluate(() => (window as any).__luxdmx.armMachines(true));
  await page.waitForTimeout(150);
  await page.evaluate(([d, f, fl]) => { (window as any).__luxdmx.programmer = { [d]: { intensity: 1 }, [f]: { fog: 1 }, [fl]: { flame: 1 } }; }, ids);
  await expect.poll(() => channels(0, 3)).toEqual([255, 255, 255]);
  await page.locator('.top .out').click();                 // blind
  await expect(page.locator('.top .arm')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => channels(0, 3)).toEqual([255, 0, 0]);   // the light stays, fog and flame stop
  // holding Arm while blind says why and arms nothing
  const arm = page.locator('.top .arm'), box = (await arm.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(1400); await page.mouse.up();
  await expect(arm).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.toast').last()).toContainText('Go on stage first');
  // Blackout gets through, and the held look comes back after
  await page.locator('.top .bo').click();
  await expect.poll(() => channels(0, 1)).toEqual([0]);
  await page.locator('.top .bo').click();
  await expect.poll(() => channels(0, 1)).toEqual([255]);
});

test('the Live page says blind and takes you on stage; a locked page can\'t go blind or arm by a slip; machine buttons are marked', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-dimmer', 1, 0, 'D');
  await patch(page, 'gen-flame', 1, 0, 'Flame');
  // a list that fires the flame, on the generated live page
  await page.evaluate(() => {
    const a = (window as any).__luxdmx, fl = a.show.fixtures[1].id;
    a.show.cueLists.push({ id: 'F', name: 'Flames', end: 'stop', cues: [{ id: 'f1', name: '1 s of flames', values: { [fl]: { flame: 1 } }, fade: 0, advance: { mode: 'manual' } }] });
  });
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('.live .tile', { hasText: 'Flames' }).locator('.risk.hazard')).toBeVisible();
  await page.locator('.top .out').click();                 // blind
  const chip = page.locator('.live .chip.blind');
  await expect(chip).toBeVisible();
  await chip.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Go on stage' }).click();
  await expect(chip).toHaveCount(0);
  await expect(page.locator('.top .out')).toHaveAttribute('aria-pressed', 'true');
  // locked for the service: on stage, so no Blind button; safe, so no Arm button
  await page.evaluate(() => (window as any).__luxdmx.lockShow(true));
  await expect(page.locator('.top .out')).toHaveCount(0);
  await expect(page.locator('.top .arm')).toHaveCount(0);
  // armed (before it was locked): Arm shows, to make them safe
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.lockShow(false); a.armMachines(true); a.lockShow(true); });
  await expect(page.locator('.top .arm')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.top .arm').click();
  await expect(page.locator('.top .arm')).toHaveCount(0);
});

test('jumping about the timeline over a flame moment never fires it; playing through it does', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-flame', 1, 0, 'Flame');
  await page.evaluate(() => {
    const a = (window as any).__luxdmx;
    a.armMachines(true);
    a.show.timeline = { duration: 60, bpm: 120, items: [{ id: 'm', at: 5, lane: 'special', do: { do: 'burst', attr: 'flame', seconds: 1 } }] };
  });
  const t0 = Date.now();
  await page.evaluate(async () => {
    const P = (window as any).__luxdmx.timeline;
    P.scrubStart();
    for (const t of [0, 4, 5, 6, 10, 5, 4.99, 5.01, 0, 5, 5]) { P.scrub(t); await new Promise((r) => setTimeout(r, 40)); }
    P.scrubEnd(5);
    for (const t of [3, 5, 7, 5]) { P.seek(t); await new Promise((r) => setTimeout(r, 40)); }
  });
  await page.waitForTimeout(400);
  const scrubbed = (await history(0, 1)).filter(([at]) => at >= t0);
  expect(scrubbed.every(([, v]) => v === 0), JSON.stringify(scrubbed.slice(-6))).toBe(true);
  // played from 4.5 s: it fires when the song passes 5 s
  await page.evaluate(async () => { const P = (window as any).__luxdmx.timeline; P.seek(4.5); await P.play(); });
  await expect.poll(() => channels(0, 1), { timeout: 4000 }).toEqual([255]);
});

// Safe machines don't surprise anyone: the Live page says a machine moment is coming that won't
// fire, and a reload that made them safe says so.
test('a machine moment coming while safe is said on the Live page; a reload says it made them safe', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-confetti', 1, 0, 'Confetti');
  await page.evaluate(async () => {
    const a = (window as any).__luxdmx;
    a.show.timeline = { duration: 60, bpm: 120, items: [{ id: 'c', at: 30, lane: 'special', do: { do: 'burst', attr: 'confetti', seconds: 1 } }] };
    a.timeline.seek(2); await a.timeline.play();
  });
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  const chip = page.locator('.live .chip.shot');
  await expect(chip).toContainText('Confetti at 0:30 · safe');
  await page.evaluate(() => (window as any).__luxdmx.armMachines(true));
  await expect(chip).toHaveCount(0);                                // armed: nothing to warn about
  await page.evaluate(() => (window as any).__luxdmx.timeline.pause());
  await page.reload();
  await expect(page.locator('.toast')).toContainText('The reload made the machines safe');
  await expect(page.locator('.top .arm')).toHaveAttribute('aria-pressed', 'false');
});
