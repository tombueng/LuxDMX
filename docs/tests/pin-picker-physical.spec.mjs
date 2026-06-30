// Issue #17: the pin picker draws a faithful physical header for the curated boards
// (power/GND/EN pins shown, real silk labels, GPIO pins still clickable). These run
// against the web-UI simulator (sim/server.js), which serves the real config.html.
import { test, expect } from '@playwright/test';

async function openPickerWith(page, boardId) {
  await page.goto('/config');
  await expect(page.locator('#board-sel')).toBeVisible();
  // pick the curated board, then open the diagram
  await page.selectOption('#board-sel', boardId);
  await page.click('#board-open');
  await expect(page.locator('#board-modal')).toHaveClass(/show/);
  await expect(page.locator('#board-svg-wrap svg.board-svg')).toBeVisible();
}

test.describe('Pin picker physical layout (issue #17)', () => {
  test('ESP32 DevKitC: power rail + silk labels render, power pin not assignable', async ({ page }) => {
    await openPickerWith(page, 'esp32-devkitc');

    // a power rail pin (3V3) is shown
    await expect(page.locator('#board-svg-wrap text', { hasText: /^3V3$/ }).first()).toBeVisible();
    // GND and EN are shown too (the whole point: you can wire VCC/GND/EN by the diagram)
    await expect(page.locator('#board-svg-wrap text', { hasText: /^GND$/ }).first()).toBeVisible();
    await expect(page.locator('#board-svg-wrap text', { hasText: /^EN$/ }).first()).toBeVisible();

    // power pins are rendered as inert .ppin.power groups (no data-gpio, not a .pad)
    const powerGroups = page.locator('#board-svg-wrap g.ppin.power');
    expect(await powerGroups.count()).toBeGreaterThan(0);
    // none of the power groups is a clickable assignment pad
    expect(await page.locator('#board-svg-wrap g.ppin.power[data-gpio]').count()).toBe(0);

    // a GPIO pin IS a clickable pad (e.g. GPIO21 / IO21)
    await expect(page.locator('#board-svg-wrap g.pad[data-gpio="21"]')).toHaveCount(1);
  });

  test('ESP32-S3 DevKitC-1: assignable GPIO pad click fills the target field', async ({ page }) => {
    // open the picker bound to a specific role by clicking a pin-pick button
    await page.goto('/config');
    await page.selectOption('#board-sel', 'esp32s3-devkitc-1');
    // pick a pin for Output A TX (the button sits in the same .pin-grp as the field)
    await page.locator('.pin-grp:has(input[name="o0_tx"]) button.pin-pick').click();
    await expect(page.locator('#board-modal')).toHaveClass(/show/);
    // S3 board has a RST (enable) pin shown but inert
    await expect(page.locator('#board-svg-wrap text', { hasText: /^RST$/ }).first()).toBeVisible();
    // click GPIO17's pad and confirm it lands in the field (click the inner pad rect,
    // whose bbox is tight; the handler lives on the enclosing <g> and the event bubbles)
    await page.locator('#board-svg-wrap g.pad[data-gpio="17"] rect.pin-pad').click();
    await expect(page.locator('input[name="o0_tx"]')).toHaveValue('17');
  });

  test('DOIT DevKit v1: D21 silk + VIN rail are shown', async ({ page }) => {
    await openPickerWith(page, 'esp32-devkit-v1');
    // DOIT board silks GPIOs as Dxx; D21 must appear in a label
    await expect(page.locator('#board-svg-wrap text', { hasText: /D21/ }).first()).toBeVisible();
    // VIN power rail is present on this 30-pin board
    await expect(page.locator('#board-svg-wrap text', { hasText: /^VIN$/ }).first()).toBeVisible();
    // GPIO21 is still a clickable pad
    await expect(page.locator('#board-svg-wrap g.pad[data-gpio="21"]')).toHaveCount(1);
  });
});
