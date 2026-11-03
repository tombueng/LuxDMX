// Before and after the song on the timeline: time set before the song and after it shows on the
// ruler (shaded, named), Home goes to the very start, a cue placed before the song comes on (on the
// wire) before the song starts, and the song's own cue at its 0 after it. The big demo's intro (on
// the demo beat) plays: house lights, dark, searchlights, the backdrop, the walk-on, the band in its
// spots, then the song. The crowd's sound: its node is there, its level rises when the music
// starts (and the sound coming out of it with it), it loads chatter and cheering only (no applause,
// no claps), its switch in the transport silences it, and its chips have no Clapping.
import type { Page } from '@playwright/test';
import { channels, demo, openConnected, resetFake, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });

const cueOn = (page: Page, list: number | string = 0) => page.evaluate((k) => { const a = (window as any).__luxdmx; const l = typeof k === 'number' ? a.show.cueLists[k] : a.show.cueLists.find((x: any) => x.name === k); const st = a.engine.status(l.id); return st.running ? l.cues[st.index].name : ''; }, list);
const pos = (page: Page) => page.evaluate(() => (window as any).__luxdmx.timeline.position as number);
async function bar(page: Page) {
  await openConnected(page);
  await page.locator('.top .show').click();
  await page.getByRole('dialog', { name: 'Shows' }).locator('.tpl').filter({ has: page.locator('b', { hasText: /^Bar$/ }) }).click();
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.locator('.tlv')).toBeVisible();
}

test('a cue placed before the song comes on before the song starts; the time around the song on the ruler; Home and End go to its ends', async ({ page }) => {
  await bar(page);
  const names = await page.evaluate(() => (window as any).__luxdmx.show.cueLists[0].cues.slice(0, 2).map((c: any) => c.name));
  // six seconds before the song, four after it
  await page.getByLabel('Seconds before the song').fill('6');
  await page.getByLabel('Seconds before the song').press('Enter');
  await page.getByLabel('Seconds after the song').fill('4');
  await page.getByLabel('Seconds after the song').press('Enter');
  await expect.poll(() => page.evaluate(() => { const t = (window as any).__luxdmx.show.timeline; return [t.lead, t.tail]; })).toEqual([6, 4]);
  // the ruler names them and shades them; the beat grid starts with the song, not before it
  const lead = page.locator('.tlv .ruler .span.lead'), tail = page.locator('.tlv .ruler .span.tail');
  await expect(lead).toHaveText('Before the song');
  await expect(tail).toHaveText('After the song');
  await expect(page.locator('.tlv .shade.lead')).toHaveCount(1);
  const lb = (await lead.boundingBox())!, firstTick = (await page.locator('.tlv .ruler .tick').first().boundingBox())!;
  expect(firstTick.x).toBeGreaterThanOrEqual(lb.x + lb.width - 2);
  // Home: the very start (where Play starts); a cue tapped there, the second one on the song's 0
  await page.locator('.transport').getByRole('button', { name: 'Back to the start' }).click();
  await expect.poll(() => pos(page)).toBe(-6);
  await expect(page.locator('.transport .clock')).toContainText('-0:06.0');
  const chips = page.locator('.tlv .pal .chip');
  await chips.first().click();
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(0));
  await chips.nth(1).click();
  expect(await page.evaluate(() => (window as any).__luxdmx.show.timeline.items.map((i: any) => i.at))).toEqual([-6, 0]);
  // played from the very start: the first cue is on (engine and wire) while the song hasn't started
  await page.locator('.transport').getByRole('button', { name: 'Back to the start' }).click();
  await page.locator('.transport').getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => { const [c, p, ch] = [await cueOn(page), await pos(page), await channels(0, 16)]; return c === names[0] && p < -1 && ch.some((v) => v > 0); }, { timeout: 8000 }).toBe(true);
  expect(await pos(page)).toBeLessThan(0);
  // and the song's own cue when the song gets to its 0
  await expect.poll(() => cueOn(page), { timeout: 12000 }).toBe(names[1]);
  expect(await pos(page)).toBeGreaterThanOrEqual(0);
  await page.locator('.transport').getByRole('button', { name: 'Pause' }).click();
  // End: the end of the time after the song (the keys work from the tracks)
  await page.locator('.tlv .tracks').click({ position: { x: 5, y: 120 } }).catch(() => {});
  await page.keyboard.press('End');
  await expect.poll(() => page.evaluate(() => { const t = (window as any).__luxdmx.timeline; return t.position - t.duration; })).toBe(4);
  await page.keyboard.press('Home');
  await expect.poll(() => pos(page)).toBe(-6);
  // something placed before the song can't be cut off: the time before it stays long enough
  await page.getByLabel('Seconds before the song').fill('2');
  await page.getByLabel('Seconds before the song').press('Enter');
  await expect(page.locator('.toast')).toContainText('6 s before the song');
  expect(await page.evaluate(() => (window as any).__luxdmx.show.timeline.lead)).toBe(6);
  await expect(page.getByLabel('Seconds before the song')).toHaveValue('6');
});

test("the big demo's intro: house lights, dark, searchlights, the backdrop, the walk-on, the band in its spots, then the song", async ({ page }) => {
  test.setTimeout(90_000);
  await openConnected(page);
  await demo(page);
  await expect(page.locator('.tlv')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.playing), { timeout: 30000 }).toBe(true);
  // it starts before the song, with the house lights on
  const lead = await page.evaluate(() => (window as any).__luxdmx.show.timeline.lead);
  expect(lead).toBeGreaterThanOrEqual(25);
  expect(await pos(page)).toBeLessThan(-lead + 15);
  await expect.poll(() => cueOn(page, 'Show'), { timeout: 10000 }).toBe('House lights');
  await expect(page.locator('.tlv .ruler .span.lead')).toHaveText('Before the song');
  await expect(page.locator('.tlv .ruler .span.tail')).toHaveText('After the song');
  // the intro, step by step (jumps: the stage as it would be there)
  await page.evaluate(() => (window as any).__luxdmx.timeline.pause());
  const at = async (t: number) => { await page.evaluate((x) => (window as any).__luxdmx.timeline.seek(x), t); return cueOn(page, 'Show'); };
  await expect.poll(() => at(-lead + 6)).toBe('House lights down');
  await expect.poll(() => at(-20)).toBe('Searchlights');
  await expect.poll(() => cueOn(page, 'Moves')).toMatch(/^Sweep (left|right), slowly$/);
  // the searchlights on the wire (the back beams on universe 0)
  await expect.poll(async () => (await channels(0, 304)).some((v) => v > 0), { timeout: 8000 }).toBe(true);
  await expect.poll(() => at(-10)).toBe('Reveal: the backdrop');
  await expect.poll(() => at(-6)).toBe('Walk-on: strobes');
  await expect.poll(() => at(-1)).toBe('Stop: on the band');
  await expect.poll(() => at(1)).toBe('Intro: blue haze');
  // after the song: the blinders on the crowd, then the house lights
  const dur = await page.evaluate(() => (window as any).__luxdmx.show.timeline.duration);
  await expect.poll(() => at(dur + 2)).toBe('Thank you: on the crowd');
  await expect.poll(() => at(dur + 12)).toBe('House lights');
});

test("the crowd: its sound node is there, louder when the music starts, and its switch in the transport silences it", async ({ page }) => {
  test.setTimeout(90_000);
  // (the recordings it loads: chatter and cheering, no applause, no claps)
  const loaded: string[] = [];
  page.on('request', (r) => { const m = /sounds\/crowd\/([^?]+)/.exec(r.url()); if (m) loaded.push(m[1]); });
  await openConnected(page);
  await demo(page);
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.playing), { timeout: 30000 }).toBe(true);
  // the sounds are made (in a worker) and the crowd's node hangs off the player
  await expect.poll(() => page.evaluate(() => { const c = (window as any).__luxdmx.timeline.crowd; return !!c.node && c.ready; }), { timeout: 20000 }).toBe(true);
  expect(await page.evaluate(() => { const P = (window as any).__luxdmx.timeline; return [P.crowd.node instanceof GainNode, P.ctx?.state]; })).toEqual([true, 'running']);
  // listen to what comes out of it
  await page.evaluate(() => {
    const P = (window as any).__luxdmx.timeline, an = P.ctx.createAnalyser();
    an.fftSize = 2048; P.crowd.node.connect(an);
    (window as any).__crowdRms = () => { const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); let s = 0; for (const v of d) s += v * v; return Math.sqrt(s / d.length); };
  });
  // (the plan, not the 3D stage: drawn without a graphics card here, a 3D frame takes most of a
  // second and the song runs on meanwhile. The song's clock, the crowd's level and its sound are
  // read together: a level read apart from its time could already be the music's)
  await page.locator('.tlv .stage-wrap').getByRole('button', { name: '2D' }).click();
  type At = { t: number; level: number; rms: number };
  const at = () => page.evaluate(() => { const P = (window as any).__luxdmx.timeline; return { t: P.position as number, level: P.crowd.level as number, rms: (window as any).__crowdRms() as number }; });
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  // the last two seconds before the music: the band in its spots, the crowd roaring after the walk-on
  // (a slow frame that jumped past them: from -2 again)
  const pre: At[] = [];
  await page.evaluate(() => (window as any).__luxdmx.timeline.seek(-2));
  await expect.poll(async () => {
    const s = await at();
    if (s.t > -1.9 && s.t < -0.1) pre.push(s);
    else if (s.t >= -0.1 && pre.length < 6) { pre.length = 0; await page.evaluate(() => (window as any).__luxdmx.timeline.seek(-2)); }
    return s.t >= -0.1 && pre.length >= 6;
  }, { timeout: 30000, intervals: [40] }).toBe(true);
  const before = Math.max(...pre.map((s) => s.level)), soundBefore = mean(pre.map((s) => s.rms));
  expect(before).toBeGreaterThan(0.5);
  expect(soundBefore).toBeGreaterThan(0.005);                                  // (the crowd is really sounding)
  // the music starts: louder
  const post: At[] = [];
  await expect.poll(async () => { const s = await at(); if (s.t > 0.3 && s.t < 4) post.push(s); return post.length; }, { timeout: 15000, intervals: [40] }).toBeGreaterThanOrEqual(6);
  const after = Math.min(...post.map((s) => s.level)), soundAfter = mean(post.map((s) => s.rms));
  expect(after).toBeGreaterThan(before);
  expect(soundAfter).toBeGreaterThan(soundBefore * 1.1);
  expect([...new Set(loaded)].sort()).toEqual(['chatter.mp3', 'cheer-1.mp3', 'cheer-2.mp3', 'cheering.mp3']);
  // the switch next to the song's volume: no crowd, and back
  const sw = page.locator('.transport').getByRole('button', { name: 'Crowd sound' });
  await expect(sw).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.transport').getByLabel('Crowd volume')).toBeVisible();
  await sw.click();
  await expect(sw).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.crowd.node.gain.value), { timeout: 3000 }).toBeLessThan(0.01);
  expect(await page.evaluate(() => localStorage.getItem('luxdmx.seq.crowd'))).toBe('off');
  await sw.click();
  await expect.poll(() => page.evaluate(() => (window as any).__luxdmx.timeline.crowd.node.gain.value), { timeout: 3000 }).toBeGreaterThan(0.3);
  await page.evaluate(() => (window as any).__luxdmx.timeline.pause());
});

test('the Crowd chips: chatter, cheering, a roar, quiet and a cheer; no clapping (it sounded ugly)', async ({ page }) => {
  await openConnected(page);
  await page.locator('.top .modes').getByRole('tab', { name: 'Timeline' }).click();
  const pal = page.getByRole('complementary', { name: 'What can go on the timeline' });
  const chips = pal.locator('.chip.cr');
  await expect(chips).toHaveText(['Chatter', 'Cheering', 'Roar', 'Quiet', 'Cheer!']);
  await expect(pal.getByRole('button', { name: /clap/i })).toHaveCount(0);
});
