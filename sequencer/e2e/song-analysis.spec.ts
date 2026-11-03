// A song file of your own: its tempo, first downbeat and parts are found from the sound when it's
// loaded (the last song's never stay), as their own undo step, with a toast saying what was found;
// noise says there's no steady beat. P (and Add a part) starts a part at the bar line nearest the
// playhead, named after the one before it; on the ruler a double-click renames a part and a
// right-click removes it. A cue played on the found grid comes on on the wire.
import type { Page } from '@playwright/test';
import { openConnected, resetFake, channels, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

// A made-up band at 128 BPM, its first downbeat at 0.4 s: drums (kick on 1 and 3, snare on 2 and 4,
// hats), a bass note on the one, a chord pad; six blocks of eight bars (quiet, verse, loud, quiet,
// loud, verse), so the parts start on bars 8, 16, 24, 32 and 40.
const RATE = 11025, BPM = 128, FIRST = 0.4, BAR = 240 / BPM;
function wav(x: Float32Array) {
  const n = x.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i] * 0.8)) * 32767), 44 + i * 2);
  return b;
}
function band() {
  let s = 7;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
  const quiet = { kick: 0, snare: 0, hat: 0.3, pad: 0.5, chord: 1 }, verse = { kick: 0.7, snare: 0.6, hat: 0.5, pad: 0, chord: 1 }, loud = { kick: 1, snare: 1, hat: 1, pad: 1, chord: 1.5 };
  const blocks = [quiet, verse, loud, quiet, loud, verse], beat = 60 / BPM;
  const x = new Float32Array(Math.ceil((FIRST + 48 * BAR + 1) * RATE));
  const hit = (t: number, len: number, f: (s: number) => number) => { const a = Math.round(t * RATE); for (let i = 0; i < len * RATE && a + i < x.length; i++) x[a + i] += f(i / RATE); };
  for (let k = 0; k < 48; k++) {
    const B = blocks[Math.floor(k / 8)], t0 = FIRST + k * BAR, root = [110, 98, 87.3, 98][k % 4] * B.chord;
    for (let q = 0; q < 4; q++) {
      const t = t0 + q * beat;
      if (B.kick && q % 2 === 0) hit(t, 0.25, (u) => B.kick * Math.sin(2 * Math.PI * 55 * u * (1 + 2 * Math.exp(-u * 40))) * Math.exp(-u * 12));
      if (B.snare && q % 2 === 1) hit(t, 0.18, (u) => B.snare * (0.8 * r() * Math.exp(-u * 25) + 0.3 * Math.sin(2 * Math.PI * 190 * u) * Math.exp(-u * 30)));
      for (const h of [0, 0.5]) hit(t + h * beat, 0.05, (u) => B.hat * 0.3 * r() * Math.exp(-u * 90));
    }
    if (B.kick) hit(t0, BAR * 0.9, (u) => B.kick * 0.35 * Math.sin(2 * Math.PI * root * u) * Math.min(1, u * 50));
    if (B.pad) hit(t0, BAR, (u) => B.pad * 0.12 * (Math.sin(2 * Math.PI * root * 4 * u) + Math.sin(2 * Math.PI * root * 5 * u) + Math.sin(2 * Math.PI * root * 6 * u)));
  }
  return wav(x);
}
function noise(seconds = 20) {
  let s = 3;
  return wav(new Float32Array(seconds * RATE).map(() => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296 - 0.5) * 0.6; }));
}

const tl = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__luxdmx.show.timeline)));
async function bar(page: Page) {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.locator('.tlv')).toBeVisible();
}
const load = (page: Page, name: string, buffer: Buffer) => page.locator('.tlv .song input[type=file]').setInputFiles({ name, mimeType: 'audio/wav', buffer });

test('an own song file: tempo, first downbeat and parts found on load, the last song\'s gone; undo takes them off', async ({ page }) => {
  await bar(page);
  // the song before: another tempo, first downbeat and parts
  await page.evaluate(() => { const t = (window as any).__luxdmx.timeline.ensure(); t.bpm = 99; t.offset = 1.23; t.sections = [{ name: 'Old verse', at: 3 }, { name: 'Old chorus', at: 20 }]; });
  await expect(page.locator('.tlv .sec', { hasText: 'Old chorus' })).toBeVisible();
  await load(page, 'my-band.wav', band());
  await expect(page.locator('.toast')).toContainText(/128 BPM, first beat at 0:00\.4, \d+ parts found: check them on the ruler/, { timeout: 20000 });
  const t = await tl(page);
  expect(Math.abs(t.bpm - BPM)).toBeLessThan(0.5);
  expect(Math.abs(t.offset - FIRST)).toBeLessThan(0.06);
  expect(t.audio.name).toBe('my-band.wav');
  // the parts: the first at 0, one within a bar of each change, every one on a bar line of the found grid
  expect(t.sections[0]).toMatchObject({ name: 'Intro', at: 0 });
  for (const b of [8, 16, 24, 32, 40]) expect(t.sections.some((s: any) => Math.abs(s.at - (FIRST + b * BAR)) <= BAR), `bar ${b}`).toBe(true);
  for (const s of t.sections.slice(1)) { const k = (s.at - t.offset) / (240 / t.bpm); expect(Math.abs(k - Math.round(k))).toBeLessThan(0.01); }
  expect(t.sections.map((s: any) => s.name)).toContain('Chorus');
  expect(JSON.stringify(t.sections)).not.toContain('Old');
  await expect(page.locator('.tlv .sec')).toHaveCount(t.sections.length);
  await expect(page.locator('.tlv .sec').first()).toHaveText('Intro');
  await expect(page.locator('.tlv .transport').getByLabel('Timeline BPM')).toHaveValue(String(t.bpm));
  // undo: what was found goes (the song stays, without the old song's tempo or parts); redo brings it back
  await page.locator('body').press('Control+z');
  await expect.poll(async () => { const u = await tl(page); return [u.audio?.name, u.bpm ?? null, u.offset ?? null, u.sections ?? null]; }).toEqual(['my-band.wav', null, null, null]);
  await page.locator('body').press('Control+Shift+z');
  await expect.poll(async () => (await tl(page)).sections?.length).toBe(t.sections.length);
});

test('P adds a part at the nearest bar line, named after the one before; rename by double-click, remove by right-click', async ({ page }) => {
  await bar(page);
  await load(page, 'my-band.wav', band());
  await expect(page.locator('.toast')).toContainText('parts found', { timeout: 20000 });
  const t = await tl(page), barS = 240 / t.bpm;
  // the playhead a little after bar 12 (in the second block): P puts a part on bar 12
  const at12 = t.offset + 12 * barS;
  await page.evaluate((x) => (window as any).__luxdmx.timeline.seek(x), at12 + 0.3 * barS);
  const before = t.sections.filter((s: any) => s.at < at12 - 0.01).pop();
  const base = before.name.replace(/\s+\d+$/, '');
  await page.locator('body').press('p');
  await expect.poll(async () => (await tl(page)).sections.length).toBe(t.sections.length + 1);
  const added = (await tl(page)).sections.find((s: any) => Math.abs(s.at - at12) < 0.02);
  expect(added, 'a part on bar 12').toBeTruthy();
  expect(added.name).toMatch(new RegExp(`^${base} \\d+$`));
  await expect(page.locator('.toast')).toContainText(`"${added.name}" starts at`);
  // pressed again there: it's already a part
  await page.locator('body').press('p');
  await expect(page.locator('.toast')).toContainText('already starts there');
  expect((await tl(page)).sections.length).toBe(t.sections.length + 1);
  // the button does the same, at the playhead (bar 36 here)
  const at36 = t.offset + 36 * barS;
  await page.evaluate((x) => (window as any).__luxdmx.timeline.seek(x), at36 - 0.2 * barS);
  await page.locator('.tlv .transport').getByRole('button', { name: 'Add a part here' }).click();
  await expect.poll(async () => (await tl(page)).sections.some((s: any) => Math.abs(s.at - at36) < 0.02)).toBe(true);
  // rename: a double-click on it on the ruler
  await page.locator('.tlv .sec', { hasText: added.name }).dblclick();
  const ask = page.getByRole('dialog', { name: 'Rename the part' });
  await ask.getByLabel('Name').fill('Big build');
  await ask.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.tlv .sec', { hasText: 'Big build' })).toBeVisible();
  expect((await tl(page)).sections.find((s: any) => Math.abs(s.at - at12) < 0.02).name).toBe('Big build');
  // remove: a right-click on it, Remove this part (and its Undo brings it back)
  const n = (await tl(page)).sections.length;
  await page.locator('.tlv .sec', { hasText: 'Big build' }).click({ button: 'right' });
  await page.locator('.ctx').getByRole('menuitem', { name: 'Remove this part' }).click();
  await expect(page.locator('.tlv .sec', { hasText: 'Big build' })).toHaveCount(0);
  expect((await tl(page)).sections.length).toBe(n - 1);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.tlv .sec', { hasText: 'Big build' })).toBeVisible();
  // a right-click on the ruler offers a part there too
  await page.locator('.tlv .ruler').click({ button: 'right', position: { x: 40, y: 8 } });
  await expect(page.locator('.ctx').getByRole('menuitem', { name: 'Add a part here' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('a cue placed on a found part snaps onto it and comes on (engine and wire) when the song gets there', async ({ page }) => {
  await bar(page);
  await load(page, 'my-band.wav', band());
  await expect(page.locator('.toast')).toContainText('parts found', { timeout: 20000 });
  await page.locator('.tlv .sec', { hasText: /^Chorus$/ }).click();      // goes there
  const at = (await tl(page)).sections.find((s: any) => s.name === 'Chorus').at;
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.position)).toBeCloseTo(at, 1);
  const name = await page.evaluate(() => (window as any).__luxdmx.show.cueLists[0].cues[1].name);
  await page.locator('.tlv .pal .chip').nth(1).click();                   // a cue at the playhead: on the chorus
  expect(Math.abs((await tl(page)).items[0].at - at)).toBeLessThan(0.01);
  const cueOn = () => page.evaluate(() => { const a = (window as any).__luxdmx, l = a.show.cueLists[0], st = a.engine.status(l.id); return st.running ? l.cues[st.index].name : ''; });
  await page.evaluate((x) => (window as any).__luxdmx.timeline.seek(x), Math.max(0, at - 1.5));
  await expect.poll(cueOn).toBe('');
  await page.locator('.transport').getByRole('button', { name: 'Play' }).click();
  await expect.poll(cueOn, { timeout: 8000 }).toBe(name);
  await expect.poll(async () => (await channels(0, 16)).some((v) => v > 0)).toBe(true);
  await page.locator('.transport').getByRole('button', { name: 'Pause' }).click();
});

test('noise: no steady beat found, says so, sets no tempo and no parts', async ({ page }) => {
  await bar(page);
  await page.evaluate(() => { const t = (window as any).__luxdmx.timeline.ensure(); t.bpm = 99; t.sections = [{ name: 'Old verse', at: 3 }]; });
  await load(page, 'wind.wav', noise());
  await expect(page.locator('.toast')).toContainText('No steady beat found', { timeout: 20000 });
  const t = await tl(page);
  expect([t.audio.name, t.bpm ?? null, t.sections ?? null]).toEqual(['wind.wav', null, null]);
  await expect(page.locator('.tlv .sec')).toHaveCount(0);
});
