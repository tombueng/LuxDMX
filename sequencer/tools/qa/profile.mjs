// UI performance profiler: builds the app unminified (readable function names), serves the build on
// a throwaway port for the run only, drives scenarios in Chrome on the real graphics card, and for
// each one records a CPU profile (Chrome's own profiler over CDP), the long tasks, the frame times,
// and Chrome's counters (style recalcs, layouts, script time). Prints a summary and writes the raw
// .cpuprofile files (open them in Chrome DevTools, Performance tab, "Load profile") to the out dir.
//
//   nice -n 19 node tools/qa/profile.mjs [--only name,name] [--secs 6] [--out DIR] [--no-build]
//
// Never the user's dev server: its own preview on PROFILE_PORT, gone when the run ends.
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(process.env.PROFILE_PORT ?? 5197);
const OUT = arg('out', path.join(process.env.HOME, 'DMX/sim/qa/profile', new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')));
const SECS = Number(arg('secs', 6));
const ONLY = arg('only', '').split(',').filter(Boolean);
const DIST = 'dist-profile';
fs.mkdirSync(OUT, { recursive: true });

if (!process.argv.includes('--no-build')) {
  console.log('building (unminified)…');
  execSync(`npx vite build --outDir ${DIST} --emptyOutDir --minify false`, { stdio: 'ignore', env: { ...process.env, VITE_EXPOSE: '1', LUXDMX_BUILD: 'profile' } });
}
const server = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(1); });
const BASE = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 250)); }

const GPU_CHROME = '/usr/bin/google-chrome';
const browser = await chromium.launch({
  headless: true, executablePath: fs.existsSync(GPU_CHROME) ? GPU_CHROME : undefined,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 250 });

// long tasks and frame times, gathered in the page
await page.addInitScript(() => {
  const w = window;
  w.__perf = { long: [], frames: [] };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__perf.long.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch { /* none */ }
  let last = 0;
  const tick = (t) => { if (last) w.__perf.frames.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

const app = (fn, arg) => page.evaluate(fn, arg);
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

// The top functions by their own time (and the files they're in), from a CPU profile
function summarise(profile, top = 18) {
  const self = new Map(), dt = profile.timeDeltas, byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const total = profile.endTime - profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]), cf = n.callFrame, d = (dt[i + 1] ?? 0) / 1000;
    const file = cf.url.replace(/^.*\/(assets|node_modules)\//, '$1/').replace(/\?.*$/, '');
    const key = `${cf.functionName || '(anonymous)'}  ${file}${cf.url ? `:${cf.lineNumber + 1}` : ''}`;
    self.set(key, (self.get(key) ?? 0) + d);
  }
  const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  return { totalMs: total / 1000, rows };
}

// What to measure. Each: get there (not measured), then `act` for SECS seconds (measured).
const SCENARIOS = [
  { name: 'start', note: 'the app opening on the festival show (saved in the browser)', prep: async () => { await openFestival(); await app(() => window.__luxdmx.timeline.pause()); await page.waitForTimeout(1500); },
    act: async () => { await page.reload(); await page.waitForFunction(() => !!window.__luxdmx && document.querySelectorAll('.stage-wrap .fx').length > 50); await page.waitForTimeout(1500); } },
  { name: 'program-idle', note: 'Program, the festival show playing', prep: async () => { await openFestival(); await tab('Program'); }, act: async () => { await page.waitForTimeout(SECS * 1000); } },
  { name: 'live', note: 'Live, the festival show playing', prep: async () => { await openFestival(); await tab('Live'); }, act: async () => { await page.waitForTimeout(SECS * 1000); } },
  { name: 'timeline-play', note: 'the timeline playing the festival demo', prep: async () => { await openFestival(); await tab('Timeline'); }, act: async () => { await page.waitForTimeout(SECS * 1000); } },
  { name: 'stage3d', note: 'the 3D stage open, the show playing', prep: async () => { await openFestival(); await page.locator('.s3 canvas').waitFor({ timeout: 60000 }); await page.waitForTimeout(5000); }, act: async () => { await page.waitForTimeout(SECS * 1000); } },
  { name: 'views', note: 'switching Program, Live, Timeline, Console (the show paused)', prep: async () => { await openFestival(); await app(() => window.__luxdmx.timeline.pause()); }, act: async () => {
    const took = {};
    for (let i = 0; i < 3; i++) for (const t of ['Live', 'Timeline', 'Console', 'Program']) {
      const t0 = Date.now(); await tab(t); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      (took[t] ??= []).push(Date.now() - t0); await page.waitForTimeout(200);
    }
    console.log('   view switch (ms, to the second frame after the click):', JSON.stringify(took));
  } },
  { name: 'to-live', note: 'Program to Live and back, five times (the show paused)', prep: async () => { await openFestival(); await app(() => window.__luxdmx.timeline.pause()); for (const t of ['Live', 'Program']) { await tab(t); await page.waitForTimeout(800); } }, act: async () => {
    const took = [];
    for (let i = 0; i < 5; i++) { const t0 = Date.now(); await tab('Live'); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); took.push(Date.now() - t0); await page.waitForTimeout(300); await tab('Program'); await page.waitForTimeout(300); }
    console.log('   to Live (ms):', JSON.stringify(took));
  } },
  { name: 'fader', note: 'the intensity fader of 40 selected lights, typed 60 times (the show paused)', prep: async () => {
    await openFestival(); await app(() => window.__luxdmx.timeline.pause()); await tab('Program');
    await app(() => { const a = window.__luxdmx; a.selected = a.show.fixtures.slice(0, 40).map((f) => f.id); });
  }, act: async () => {
    const f = page.locator('.prog').getByLabel('Intensity', { exact: true });
    for (let i = 0; i < 60; i++) await f.fill(String((i * 7) % 100));
  } },
];
// the festival demo from the welcome, on the demo beat (nothing to download), playing
async function openFestival() {
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.__luxdmx);
  const shows = page.getByRole('dialog', { name: 'Shows' }), w = page.getByRole('dialog', { name: "Let's get some light on stage" });
  // (the welcome may be up by itself on a fresh page)
  await page.waitForTimeout(1500);
  if (!(await w.isVisible())) {
    const tpl = page.getByRole('button', { name: 'or start from a template' });
    if (await tpl.isVisible()) await tpl.click();
    else { await page.locator('.top .show').click(); await shows.getByRole('button', { name: 'New show…' }).click(); }
  }
  const t = w.getByRole('group', { name: 'Festival stage' });
  await t.getByLabel('Music for Festival stage').selectOption('beat');
  await t.getByRole('button', { name: /^Play the show/ }).click();
  await w.waitFor({ state: 'hidden', timeout: 60000 });
  await page.waitForFunction(() => window.__luxdmx.timeline.playing, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
}
const tab = (name) => page.locator('.top .modes').getByRole('tab', { name }).click();

const report = [];
for (const s of SCENARIOS) {
  if (ONLY.length && !ONLY.includes(s.name)) continue;
  try { await s.prep(); } catch (e) { console.log(`${s.name}: couldn't get there (${e.message.split('\n')[0]})`); continue; }
  await app(() => { window.__perf = { long: [], frames: [] }; }).catch(() => {});
  const m0 = await metrics();
  await cdp.send('Profiler.start');
  const t0 = Date.now();
  try { await s.act(); } catch (e) { console.log(`${s.name}: ${e.message.split('\n')[0]}`); }
  const { profile } = await cdp.send('Profiler.stop');
  const wall = Date.now() - t0, m1 = await metrics();
  const perf = await app(() => window.__perf).catch(() => ({ long: [], frames: [] }));
  fs.writeFileSync(path.join(OUT, `${s.name}.cpuprofile`), JSON.stringify(profile));
  const sum = summarise(profile), d = (k) => (m1[k] ?? 0) - (m0[k] ?? 0);
  const frames = perf.frames.filter((f) => f < 2000);
  const r = {
    name: s.name, note: s.note, wallMs: wall,
    scriptMs: Math.round(d('ScriptDuration') * 1000), layoutMs: Math.round(d('LayoutDuration') * 1000), styleMs: Math.round(d('RecalcStyleDuration') * 1000), taskMs: Math.round(d('TaskDuration') * 1000),
    layouts: d('LayoutCount'), styles: d('RecalcStyleCount'), heapMB: Math.round((m1.JSHeapUsedSize ?? 0) / 1e6),
    longTasks: perf.long.length, longMs: Math.round(perf.long.reduce((a, b) => a + b, 0)), longest: Math.round(Math.max(0, ...perf.long)),
    fps: frames.length ? Math.round(1000 / (frames.reduce((a, b) => a + b, 0) / frames.length)) : 0, frameP95: Math.round(pct(frames, 0.95)), frameMax: Math.round(Math.max(0, ...frames)),
    top: sum.rows.map(([k, ms]) => [Math.round(ms), k]),
  };
  report.push(r);
  console.log(`\n== ${r.name}: ${r.note}`);
  console.log(`   wall ${r.wallMs} ms | busy ${r.taskMs} ms (script ${r.scriptMs}, style ${r.styleMs} x${r.styles}, layout ${r.layoutMs} x${r.layouts}) | long tasks ${r.longTasks} = ${r.longMs} ms, longest ${r.longest} | ${r.fps} fps, p95 frame ${r.frameP95} ms, worst ${r.frameMax} | heap ${r.heapMB} MB`);
  for (const [ms, k] of r.top.slice(0, 12)) console.log(`   ${String(ms).padStart(6)} ms  ${k}`);
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\nprofiles and report: ${OUT}`);
await browser.close();
stop();
if (!process.argv.includes('--keep-build')) execSync(`rm -rf ${DIST}`);
