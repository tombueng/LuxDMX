// Web-UI helpers shared by the specs.
//
// The settings page opens with every section folded (see "Collapsible sections" in
// src/pages/config.html), so a test that wants to read or drive a field has to unfold
// first. Use openConfig() instead of page.goto('/config') anywhere you touch the DOM;
// tests that only hit the REST API don't need it.

// Unfold every section on an already-loaded /config. Idempotent: if the sections are
// already open (a remembered state from an earlier navigation in the same context) the
// button reads "Collapse all" and we leave it alone.
export async function expandAll(page) {
  // Wait for the fold script to have run before reading the button: the markup ships a
  // static label, and the script only re-labels it from the real state once it stamps
  // data-sec-on on the sections. Reading too early clicked the wrong way (or not at all).
  await page.locator('.card[data-sec][data-sec-on]').first().waitFor();
  const btn = page.locator('#sec-all');
  if ((await btn.textContent())?.trim() === 'Expand all') await btn.click();
  // The DMX output cards are cloned once /info.json lands, so wait for them too before
  // declaring the page unfolded.
  await page.locator('.out-card').first().waitFor().catch(() => {});
  await page.locator('.card[data-sec].sec-closed').first().waitFor({ state: 'detached' });
}

// Go to /config and unfold everything, so field-level assertions see real elements.
export async function openConfig(page) {
  await page.goto('/config');
  await expandAll(page);
}
