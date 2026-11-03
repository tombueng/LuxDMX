// A pub band's gig in one show (the set list), on the fake box: a set of two songs made on the
// Timeline screen from a band's real show (data/gig-song.luxdmx.json); on Live, Play with a key,
// Next song with a key while the first plays: the wire never goes dark between the songs, the
// next one's first look comes up, nothing fires; a MIDI pad learned on Play starts the second.
// Next part, armed, skips a confetti moment (0 on the wire), played into it fires. Sound here
// off: the song's clock runs on.
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { openConnected, resetFake, channels, history, test, expect } from './helpers';

const send = (page: Page, bytes: number[]) => page.evaluate((b) => (window as any).__midiIn.onmidimessage({ data: new Uint8Array(b) }), bytes);
// (fn runs in the page with the app; it can't use anything from here)
const app = <T>(page: Page, fn: (a: any) => T) => page.evaluate(`(${fn.toString()})(window.__luxdmx)`) as Promise<T>;

test.beforeEach(async ({ page }) => {
  await resetFake();
  // a fake MIDI pad (the browser's own MIDI can't be driven from a test)
  await page.addInitScript(() => {
    const input: any = { name: 'Fake pad', onmidimessage: null };
    (window as any).__midiIn = input;
    (navigator as any).requestMIDIAccess = async () => ((window as any).__midiAccess ??= { inputs: new Map([['in1', input]]), onstatechange: null });
  });
});

// The band's show, and a second song added to its set on the Timeline screen: named, with the
// Chorus look on its start; then the first one picked again
async function gig(page: Page) {
  await openConnected(page);
  // (without the box it was made with: it keeps the one connected here)
  const show = JSON.parse(await readFile(new URL('./data/gig-song.luxdmx.json', import.meta.url), 'utf8'));
  show.outputs.devices = [];
  const text = JSON.stringify(show);
  await page.evaluate(async (t) => { await (window as any).__luxdmx.importShow(new File([t], 'gig-song.luxdmx.json')); }, text);
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  const set = page.getByRole('region', { name: 'Set list' });
  await expect(set.locator('.pick')).toHaveText([/Whiskey Therapy - Whiskey en el Hotel/]);
  await set.getByRole('button', { name: 'Add a song' }).click();
  await expect(set.locator('.pick')).toHaveCount(2);
  await expect(set.locator('li.cur .pick')).toContainText('Song 2');
  await set.locator('.pick').nth(1).dblclick();
  const ask = page.getByRole('dialog', { name: 'Rename the song' });
  await ask.getByLabel('Name').fill('Going To Hell');
  await ask.getByRole('button', { name: 'OK' }).click();
  await page.locator('.tlv .pal .chip', { hasText: 'Chorus' }).first().click();            // at the playhead: 0:00
  expect(await app(page, (a) => a.show.timeline.items.map((i: any) => [i.at, i.do.cue]))).toEqual([[0, 'l1c3']]);
  await set.locator('.pick').first().click();
  await expect(set.locator('li.cur .pick')).toContainText('Whiskey');
  expect(await app(page, (a) => [a.show.setlist.before.length, a.show.setlist.after.map((t: any) => t.name)])).toEqual([0, ['Going To Hell']]);
}

test('a set of two songs: Next song with a key while the first plays, the wire never dark, the next one ready; a pad starts it', async ({ page }) => {
  await gig(page);
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  const play = page.locator('.live [data-widget="song-play"]'), next = page.locator('.live [data-widget="song-next"]');
  await expect(play).toContainText('Play');
  await expect(play).toContainText('Whiskey Therapy - Whiskey en el Hotel · 0:00');
  await expect(next).toContainText('Going To Hell');
  await expect(play.locator('.key')).toHaveText(',');
  await expect(next.locator('.key')).toHaveText('.');
  // a MIDI pad on Play (Learn, like any button)
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await play.click();
  const ed = page.getByRole('complementary', { name: 'Control settings' });
  await expect(ed.getByLabel('Song action')).toHaveValue('play');
  await ed.getByRole('button', { name: 'Learn' }).click();
  await send(page, [0x90, 60, 100]);
  await expect(ed).toContainText('Note 60');
  await page.locator('.live').getByRole('button', { name: 'Done', exact: true }).click();

  // the first song from its start, with its key: its first look (Walk-in, the front at 40 %)
  await page.keyboard.press(',');
  await expect.poll(() => app(page, (a) => a.timeline.playing)).toBe(true);
  await expect(play).toContainText('Pause');
  await expect.poll(() => channels(0, 1), { timeout: 5000 }).toEqual([102]);
  // (Play from the start came in a beat before its first downbeat: 0.982 s at 126 BPM)
  expect(await app(page, (a) => a.timeline.position)).toBeGreaterThan(0.45);
  const t0 = Date.now(), armed = await app(page, (a) => [a.sfxArmed, a.output]);
  await page.waitForTimeout(800);
  // Next song, with its key, in the middle of the song
  await page.keyboard.press('.');
  await expect.poll(() => app(page, (a) => a.show.timeline.name)).toBe('Going To Hell');
  expect(await app(page, (a) => [a.timeline.playing, a.timeline.position])).toEqual([false, 0]);
  await expect(page.locator('.toast')).toContainText('Up next: Going To Hell');
  // its first look comes up (the Chorus: the front at full); never dark on the way
  await expect.poll(() => channels(0, 1), { timeout: 6000 }).toEqual([255]);
  const front = (await history(0, 1)).filter(([at]) => at >= t0).map(([, v]) => v);
  expect(front.length).toBeGreaterThan(5);
  expect(Math.min(...front)).toBeGreaterThan(0);
  // not another show: the same show, still on stage, the machines as they were
  expect(await app(page, (a) => [a.sfxArmed, a.output])).toEqual(armed);
  expect(await app(page, (a) => a.show.meta.name)).toBe('Gig: 2 Whiskey');
  await expect(play).toContainText('Going To Hell · 0:00 / 4:00');
  await expect(next).toContainText('that was the last one');
  // the pad starts it
  await send(page, [0x90, 60, 100]); await send(page, [0x80, 60, 0]);
  await expect.poll(() => app(page, (a) => a.timeline.playing)).toBe(true);
  await expect.poll(() => app(page, (a) => a.timeline.position), { timeout: 5000 }).toBeGreaterThan(0.5);
  await send(page, [0x90, 60, 100]); await send(page, [0x80, 60, 0]);
  await expect.poll(() => app(page, (a) => a.timeline.playing)).toBe(false);
  // the last song: Next song says so and stays
  await page.waitForTimeout(900);
  await page.keyboard.press('.');
  await expect(page.locator('.toast')).toContainText('That was the last song of the set');
  expect(await app(page, (a) => a.show.timeline.name)).toBe('Going To Hell');
});

// SAFETY: a jump to the next part never fires what it jumps over, armed or not.
test('Next part, armed: the confetti it jumps over sends 0 on the wire; played into, it fires', async ({ page }) => {
  await gig(page);
  // confetti in the first verse (16.2 s to 42.9 s), armed
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.show.timeline.items.push({ id: 'cf', at: 20, lane: 'special', do: { do: 'burst', attr: 'confetti', seconds: 1 } }); a.armMachines(true); });
  const addr = await app(page, (a) => a.show.fixtures.find((f: any) => f.typeId === 'gen-confetti').address);
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  const part = page.locator('.live [data-widget="song-part"]');
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(17));
  await expect(part).toContainText('Instrumental');
  const t0 = Date.now();
  await page.keyboard.press(',');
  await expect.poll(() => app(page, (a) => a.timeline.position)).toBeGreaterThan(17.2);
  await page.keyboard.press('-');
  // on the next beat it's in the Instrumental, the confetti at 20 s jumped over
  await expect.poll(() => app(page, (a) => a.timeline.position), { timeout: 3000 }).toBeGreaterThan(42.88);
  expect(await app(page, (a) => a.timeline.position)).toBeLessThan(45);
  await page.waitForTimeout(600);
  const shot = (await history(0, addr)).filter(([at]) => at >= t0).map(([, v]) => v);
  expect(shot.length).toBeGreaterThan(5);
  expect(Math.max(...shot)).toBe(0);
  // played into, the same moment fires (armed): the wiring is there, it was the jump
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(19.3));
  await expect.poll(async () => (await channels(0, addr)).at(-1), { timeout: 4000 }).toBe(255);
  await page.keyboard.press(',');
});

test('Sound here off, from Live: no sound from this browser, the song plays on its clock; kept after a reload', async ({ page }) => {
  await gig(page);
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  const sound = page.locator('.live .bar').getByRole('button', { name: 'Sound here' });
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.toast')).toContainText('No sound here');
  expect(await page.evaluate(() => localStorage.getItem('luxdmx.seq.sound'))).toBe('off');
  // (a count-in: its clicks go to the speakers, so they're there to be silent)
  await page.locator('.live').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.evaluate(() => { (window as any).__luxdmx.show.setlist.countIn = 1; });
  await page.locator('.live').getByRole('button', { name: 'Done', exact: true }).click();
  await page.keyboard.press(',');
  await expect.poll(() => app(page, (a) => a.timeline.position), { timeout: 6000 }).toBeGreaterThan(1.5);
  // the speakers get nothing (where this browser runs sound at all); a recording of the stage still
  // gets the song (its own stream, off the bus)
  const out = await app(page, (a) => ({ clock: a.timeline.perfClock ? 'page' : 'audio', gain: a.timeline.gain?.gain.value }));
  if (out.clock === 'audio') expect(out.gain).toBe(0);
  expect(await app(page, (a) => a.timeline.audioStream()?.getAudioTracks().length)).toBe(1);
  await page.keyboard.press(',');
  await page.reload();
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('.live .bar').getByRole('button', { name: 'Sound here' })).toHaveAttribute('aria-pressed', 'false');
});

// axe on the set list (Timeline) and the song buttons (Live): names, roles, contrast
const AXE = fs.readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
async function audit(page: Page, what: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || (a.effect?.getComputedTiming().iterations ?? 1) === Infinity), undefined, { timeout: 3000 }).catch(() => {});
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => (await (window as any).axe.run(document, { resultTypes: ['violations'] })).violations.map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(' ')).join(' | ')}`));
  expect(r, what).toEqual([]);
}
test('the set list and the song buttons pass axe', async ({ page }) => {
  await gig(page);
  await expect(page.getByRole('region', { name: 'Set list' }).getByLabel('Count-in')).toHaveValue('0');
  await audit(page, 'timeline with a set list');
  await page.locator('.top .modes').getByRole('tab', { name: 'Live' }).click();
  await expect(page.locator('.live [data-widget="song-play"]')).toBeVisible();
  await audit(page, 'live with the song buttons');
});
