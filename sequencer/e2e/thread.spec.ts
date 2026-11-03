// The DMX output on its own thread (output/thread.ts): the box's bridge page takes a channel from it,
// and the frames come from there, on time while the page itself is busy (here: blocked outright,
// 400 ms at a time, three times); the page and the thread work out the same look. A page that goes
// away sends its safe look last: nothing from the thread comes after it.
import { openConnected, patch, history, resetFake, test, expect } from './helpers';

test.beforeEach(async () => { await resetFake(); });
// Every site in a process of its own, as a desktop browser does (the headless test browser merges
// processes when it runs short of them; then the box's bridge page would share the app's thread)
test.use({ launchOptions: {
  executablePath: process.env.CHROME || `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`,
  args: ['--site-per-process', '--renderer-process-limit=100'],
} });

test('the box gets its frames from the output thread, on time while the page is blocked', async ({ page }) => {
  // (the box by another name than the app's 127.0.0.1: another site, so its bridge page runs in a
  // process of its own, as a real box's does next to the app; on one site they'd share one thread)
  await openConnected(page, `localhost:${process.env.FAKE_PORT ?? 8199}`);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  // the thread runs and the box's page took its channel
  await expect.poll(() => page.evaluate(() => { const a = (window as any).__luxdmx; return a.thread.running && a.thread.serves(a.bridges[0]); }), { timeout: 10000 }).toBe(true);
  // a four-second fade up: a new value every frame (255 steps in 4 s)
  await page.evaluate(() => {
    const a = (window as any).__luxdmx, ids = a.show.fixtures.map((f: any) => f.id);
    a.show.cueLists.push({ id: 'F', name: 'Fade', end: 'stop', cues: [{ id: 'f1', name: 'Up', values: Object.fromEntries(ids.map((id: string) => [id, { intensity: 1 }])), fade: 4, advance: { mode: 'manual' } }] });
    a.markDirty(0);
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as any).__luxdmx.engine.go('F'));
  await page.waitForTimeout(300);
  const from = Date.now();
  // the page blocked: no frame, no event, nothing runs on it for 400 ms, three times
  for (let k = 0; k < 3; k++) {
    await page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 400) { /* busy */ } });
    await page.waitForTimeout(100);
  }
  const to = Date.now();
  const h = (await history(0, 1)).filter(([t]) => t >= from && t <= to);
  expect(h.length).toBeGreaterThan(40);                               // ~1.5 s at 40 a second
  let worst = 0;
  for (let i = 1; i < h.length; i++) worst = Math.max(worst, h[i][0] - h[i - 1][0]);
  expect(worst, `longest gap ${worst} ms`).toBeLessThan(80);
  // and the fade went on rising meanwhile (the thread works it out itself)
  expect(h[h.length - 1][1]).toBeGreaterThan(h[0][1] + 10);
  for (let i = 1; i < h.length; i++) expect(h[i][1]).toBeGreaterThanOrEqual(h[i - 1][1]);
});

test('the page and the thread work out the same look', async ({ page }) => {
  await openConnected(page);
  await patch(page, 'gen-drgb', 4, 0, 'PAR');
  await expect.poll(() => page.evaluate(() => { const a = (window as any).__luxdmx; return a.thread.running && a.thread.serves(a.bridges[0]); }), { timeout: 10000 }).toBe(true);
  await page.evaluate(() => { const a = (window as any).__luxdmx, ids = a.show.fixtures.map((f: any) => f.id); a.programmer = Object.fromEntries(ids.map((id: string, i: number) => [id, { intensity: 0.25 * (i + 1), color: { r: 1, g: i / 4, b: 0.5 } }])); });
  await page.waitForTimeout(600);
  const [wire, screen] = await Promise.all([
    fetch(`http://127.0.0.1:${process.env.FAKE_PORT ?? 8199}/frames.json`).then((r) => r.json()).then((f) => f['0'].ch.slice(0, 16)),
    page.evaluate(() => [...(window as any).__luxdmx.frames.get(0)].slice(0, 16)),
  ]);
  expect(wire).toEqual(screen);
});

test('a page that goes away: its safe look is the last thing the box gets', async ({ page, context }) => {
  await openConnected(page);
  await patch(page, 'gen-flame', 1, 0, 'Flame');
  await expect.poll(() => page.evaluate(() => { const a = (window as any).__luxdmx; return a.thread.running && a.thread.serves(a.bridges[0]); }), { timeout: 10000 }).toBe(true);
  await page.evaluate(() => (window as any).__luxdmx.armMachines(true));
  await page.waitForTimeout(200);
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.programmer = { [a.show.fixtures[0].id]: { flame: 1 } }; });
  await expect.poll(async () => (await history(0, 1)).at(-1)?.[1]).toBe(255);
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 800));
  expect((await history(0, 1)).at(-1)?.[1]).toBe(0);
  void context;
});

test('a show opened and a cue jumped to at once: the thread has the new show, the box gets the cue', async ({ page }) => {
  test.setTimeout(90_000);
  await openConnected(page);
  // (opening a show stops the old one's lists first: those commands must not leave the thread
  // with the old show)
  const at = await page.evaluate(async (url) => {
    const { TEMPLATES } = await import(url);
    const a = (window as any).__luxdmx, s = TEMPLATES.find((t: any) => t.name === 'Church').build();
    await a.startShow(s);
    const l = a.show.cueLists[0], i = l.cues.findIndex((c: any) => Object.values(c.values).some((v: any) => (v.intensity ?? 0) > 0.5));
    a.jump(l.id, i);
    const id = Object.entries(l.cues[i].values).find(([, v]: any) => (v.intensity ?? 0) > 0.5)![0], f = a.show.fixtures.find((x: any) => x.id === id);
    return { uni: f.universe, ch: f.address };
  }, '/src/content/templates.ts');
  await expect.poll(async () => { const h = await history(at.uni, at.ch); return h.length ? h[h.length - 1][1] : 0; }, { timeout: 5000 }).toBeGreaterThan(100);
});

// The bridge keeps one message on the wire: the next goes once the box has answered the last ('K'),
// so a slow box gets the newest look rather than a queue (and older box firmware, which misread a
// frame header split across two TCP packets, never sees one). Here the
// (fake) box answers 70 ms late while both universes fade, then not at all.
test('one message on the wire at a time: the bridge waits for the box, and the newest look still gets there', async ({ page }) => {
  const fake = `http://127.0.0.1:${process.env.FAKE_PORT ?? 8199}`;
  const wsTest = (o: object) => fetch(`${fake}/ws/test`, { method: 'POST', body: JSON.stringify(o) });
  const stats = () => fetch(`${fake}/ws/stats.json`).then((r) => r.json() as Promise<{ acks: number; early: number }>);
  await openConnected(page);
  await patch(page, 'gen-dimmer', 2, 0, 'D');
  await patch(page, 'gen-dimmer', 2, 1, 'E');
  await wsTest({ ackDelay: 70 });
  await page.evaluate(() => {
    const a = (window as any).__luxdmx, ids = a.show.fixtures.map((f: any) => f.id);
    a.show.cueLists.push({ id: 'F', name: 'Fade', end: 'stop', cues: [{ id: 'f1', name: 'Up', values: Object.fromEntries(ids.map((id: string) => [id, { intensity: 1 }])), fade: 2, advance: { mode: 'manual' } }] });
    a.markDirty(0);
  });
  await page.waitForTimeout(300);
  const from = Date.now();
  await page.evaluate(() => (window as any).__luxdmx.engine.go('F'));
  // both universes end at full, soon after the fade does: skipped looks, not a queue falling behind
  await expect.poll(async () => [(await history(0, 1)).at(-1)?.[1], (await history(1, 1)).at(-1)?.[1]], { timeout: 6000 }).toEqual([255, 255]);
  const done = Math.max(...[await history(0, 1), await history(1, 1)].map((h) => h.find(([, v]) => v === 255)![0]));
  expect(done - from, 'full on both, ms after GO').toBeLessThan(2000 + 600);
  const during = (await history(0, 1)).filter(([t]) => t >= from && t <= from + 2000);
  expect(during.length, 'frames for universe 0 during the fade').toBeGreaterThan(5);     // ~7 a second each: 70 ms a frame, two universes
  expect(during.length).toBeLessThan(25);
  const s = await stats();
  expect(s.early, 'messages sent before the answer to the one before').toBe(0);
  expect(s.acks).toBeGreaterThan(10);
  // a box that never answers (it shouldn't happen): the bridge still sends, every 2 s, rather than stall
  await wsTest({ ackDelay: 0, noAck: true });
  await page.evaluate(() => { const a = (window as any).__luxdmx; a.engine.release?.('F'); a.programmer = Object.fromEntries(a.show.fixtures.map((f: any) => [f.id, { intensity: 0.5 }])); });
  await expect.poll(async () => (await history(0, 1)).at(-1)?.[1], { timeout: 8000 }).toBe(128);
});
