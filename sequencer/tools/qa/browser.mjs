// QA browser: a long-running Chromium the tester drives from the shell, over a small HTTP API on
// 127.0.0.1. It keeps every console message, page error, failed request and dialog, so after
// each step you see what the page said. Driven with tools/qa/q.mjs.
//
//   node tools/qa/browser.mjs [--port 9333] [--url http://127.0.0.1:5173/] [--out DIR] [--headed]
//
// Selectors are Playwright's: css, `role=button[name="GO"]`, `text=Record`, `label=Tilt`, chained
// with `>>`. Every action answers with the log entries it caused (errors first).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('port', 9333));
const START = arg('url', 'http://127.0.0.1:5173/');
const OUT = arg('out', path.join(process.env.HOME, 'DMX/sim/qa/out'));
const HEADED = process.argv.includes('--headed');
fs.mkdirSync(OUT, { recursive: true });

// (Google Chrome on the real graphics card when it's there: the 3D stage at its real speed; the
// headless shell draws WebGL in software, a frame a second on a big rig)
const GPU_CHROME = '/usr/bin/google-chrome';
const useGpu = !process.env.CHROME && !process.argv.includes('--no-gpu') && fs.existsSync(GPU_CHROME);
const browser = await chromium.launch({
  headless: !HEADED,
  executablePath: useGpu ? GPU_CHROME : process.env.CHROME || undefined,
  args: ['--use-fake-device-for-media-stream=fps=60,device-count=2', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required',
    ...(useGpu ? ['--ignore-gpu-blocklist', '--enable-gpu'] : ['--enable-unsafe-swiftshader'])],
});
let ctx, pages = [], cur = 0, seq = 0, viewport = { width: 1600, height: 1000 };
const logs = [];
const log = (e) => { e.seq = ++seq; e.t = new Date().toISOString().slice(11, 23); e.page = pages.indexOf(e.p ?? pages[cur]); delete e.p; logs.push(e); if (logs.length > 5000) logs.shift(); };

function attach(p) {
  if (!pages.includes(p)) pages.push(p);
  p.on('console', (m) => (['verbose', 'debug'].includes(m.type()) ? undefined : log({ p, type: 'console', level: m.type(), text: m.text().slice(0, 2000), at: m.location()?.url?.replace(/^https?:\/\/[^/]+/, '') + ':' + (m.location()?.lineNumber ?? '') })));
  p.on('pageerror', (e) => log({ p, type: 'pageerror', level: 'error', text: (e.stack || e.message || String(e)).slice(0, 3000) }));
  p.on('requestfailed', (r) => { const u = r.url(); if (!/favicon/.test(u)) log({ p, type: 'requestfailed', level: 'warning', text: `${r.method()} ${u} ${r.failure()?.errorText ?? ''}` }); });
  p.on('response', (r) => { if (r.status() >= 400) log({ p, type: 'http', level: 'warning', text: `${r.status()} ${r.request().method()} ${r.url()}` }); });
  p.on('dialog', async (d) => { log({ p, type: 'dialog', level: 'info', text: `${d.type()}: ${d.message()}` }); await d.accept().catch(() => {}); });
  p.on('close', () => { const i = pages.indexOf(p); if (i >= 0) pages.splice(i, 1); if (cur >= pages.length) cur = Math.max(0, pages.length - 1); });
}
async function fresh(url = START, keep = false) {
  if (ctx && !keep) await ctx.close().catch(() => {});
  ctx = await browser.newContext({ viewport, permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'], acceptDownloads: true });
  ctx.on('page', attach);
  pages = []; cur = 0;
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  return p;
}
await fresh();
const page = () => pages[cur];
// (also label=..., placeholder=..., title=...: Playwright's getByLabel and friends; `within >> label=x`
// looks inside the first part)
function find(root, sel) {
  const part = /^label~=(.*)$/s.exec(sel);
  if (part) return root.getByLabel(part[1].replace(/^"(.*)"$/, '$1'));
  const m = /^(label|placeholder|title)=(.*)$/s.exec(sel);
  if (!m) return root.locator(sel);
  const v = m[2].replace(/^"(.*)"$/, '$1');
  // (exact: "Command" must not find "Command line"; label~=... for a part of it)
  return m[1] === 'label' ? root.getByLabel(v, { exact: true }) : m[1] === 'placeholder' ? root.getByPlaceholder(v) : root.getByTitle(v);
}
const loc = (sel, nth) => {
  const parts = String(sel).split(/\s+>>>\s+/);
  let l = find(page(), parts[0]);
  for (const p of parts.slice(1)) l = find(l.first(), p);
  return nth === undefined ? l.first() : nth === 'last' ? l.last() : l.nth(nth);
};

// what the visible page offers: buttons, fields, links, tabs, sliders (name, role, state)
async function controls(sel) {
  return page().evaluate((root) => {
    const base = root ? document.querySelector(root) : document.body;
    if (!base) return [];
    const els = base.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=tab], [role=slider], [role=menuitem], [role=checkbox], [role=switch], [role=option], summary, [tabindex="0"]');
    const out = [];
    for (const e of els) {
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const st = getComputedStyle(e);
      if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) continue;
      // (about the accessible name: its label, else its text; the title as a hint)
      const lab = e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.innerText;
      const name = (e.getAttribute('aria-label') || lab || e.innerText || e.value || e.getAttribute('placeholder') || e.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      const hint = (e.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 50);
      out.push({ tag: e.tagName.toLowerCase(), role: e.getAttribute('role') || e.type || '', name, hint: hint && hint !== name ? hint : undefined, dis: e.disabled || e.getAttribute('aria-disabled') === 'true' || undefined,
        on: e.getAttribute('aria-pressed') ?? e.getAttribute('aria-selected') ?? e.getAttribute('aria-checked') ?? (e.type === 'checkbox' ? String(e.checked) : undefined),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return out;
  }, sel ?? null);
}

const actions = {
  async goto(b) { await page().goto(b.url ?? START, { waitUntil: 'domcontentloaded' }); return { url: page().url() }; },
  async reset(b) { if (b.viewport) viewport = b.viewport; await fresh(b.url ?? START); return { url: page().url() }; },
  async reload() { await page().reload({ waitUntil: 'domcontentloaded' }); return { url: page().url() }; },
  async click(b) { await loc(b.sel, b.nth).click({ button: b.button, clickCount: b.count, modifiers: b.mods, force: b.force, position: b.pos, timeout: b.timeout ?? 15000 }); return {}; },
  async dblclick(b) { await loc(b.sel, b.nth).dblclick({ timeout: b.timeout ?? 15000, position: b.pos }); return {}; },
  async hover(b) { await loc(b.sel, b.nth).hover({ timeout: b.timeout ?? 15000 }); return {}; },
  async fill(b) { await loc(b.sel, b.nth).fill(String(b.value), { timeout: b.timeout ?? 15000 }); return {}; },
  async type(b) { if (b.sel) await loc(b.sel, b.nth).focus(); await page().keyboard.type(String(b.text), { delay: b.delay ?? 10 }); return {}; },
  async press(b) { if (b.sel) await loc(b.sel, b.nth).press(b.key, { timeout: b.timeout ?? 15000 }); else await page().keyboard.press(b.key); return {}; },
  async select(b) { return { picked: await loc(b.sel, b.nth).selectOption(b.value, { timeout: b.timeout ?? 15000 }) }; },
  async check(b) { await loc(b.sel, b.nth).setChecked(b.on !== false, { timeout: b.timeout ?? 15000 }); return {}; },
  async files(b) { await loc(b.sel, b.nth).setInputFiles(b.paths); return {}; },
  async mouse(b) {
    const m = page().mouse;
    if (b.action === 'move') await m.move(b.x, b.y, { steps: b.steps ?? 1 });
    else if (b.action === 'down') await m.down({ button: b.button });
    else if (b.action === 'up') await m.up({ button: b.button });
    else if (b.action === 'click') await m.click(b.x, b.y, { button: b.button, clickCount: b.count });
    else if (b.action === 'wheel') { if (b.x !== undefined) await m.move(b.x, b.y); await m.wheel(b.dx ?? 0, b.dy ?? 0); }
    return {};
  },
  async drag(b) {
    const at = async (v) => (typeof v === 'string' ? (async () => { const r = await loc(v).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })() : v);
    const a = await at(b.from), z = await at(b.to), m = page().mouse;
    await m.move(a.x, a.y); await m.down(); await m.move(z.x, z.y, { steps: b.steps ?? 12 }); await m.up();
    return { from: a, to: z };
  },
  async eval(b) {
    const js = String(b.js);
    const body = /\breturn\b|;|\n/.test(js) && !/^\s*\(/.test(js) ? `(async () => { ${js} })()` : js;
    return { value: await page().evaluate(body) };
  },
  async shot(b) {
    const name = (b.name || `shot-${Date.now()}`).replace(/[^\w.-]+/g, '_') + '.png', file = path.join(OUT, name);
    if (b.sel) await loc(b.sel, b.nth).screenshot({ path: file, timeout: b.timeout ?? 8000 });
    else await page().screenshot({ path: file, fullPage: !!b.full, timeout: b.timeout ?? 8000 });
    return { file };
  },
  async snap(b) { return { text: await (b.sel ? loc(b.sel, b.nth) : page().locator('body')).ariaSnapshot({ timeout: b.timeout ?? 15000 }) }; },
  async text(b) { const t = await loc(b.sel ?? 'body', b.nth).innerText({ timeout: b.timeout ?? 15000 }); return { text: t.slice(0, b.max ?? 6000) }; },
  async count(b) { return { n: await page().locator(b.sel).count() }; },
  async controls(b) { return { list: await controls(b.sel) }; },
  // Look-checks over what's on screen: text the same colour as its background (unreadable), text cut
  // off without an ellipsis, controls running out of their box, buttons with no name at all
  async lint() {
    return { found: await page().evaluate(() => {
      const out = [], seen = new Set();
      const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
      const bgOf = (e) => { for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (c && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(c)) return c; } return 'rgb(0, 0, 0)'; };
      const name = (e) => (e.getAttribute('aria-label') || e.innerText || e.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      for (const e of document.querySelectorAll('button, a, label, [role=tab], [role=button], span, b, h2, h3, p, td, li')) {
        if (!vis(e)) continue;
        const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        const cs = getComputedStyle(e);
        if (own && cs.color === bgOf(e)) out.push({ what: 'same colour as its background', el: e.tagName.toLowerCase() + '.' + [...e.classList].join('.'), text: name(e) });
        if (own && cs.overflow !== 'visible' && cs.textOverflow !== 'ellipsis' && e.scrollWidth > e.clientWidth + 2 && cs.whiteSpace === 'nowrap') out.push({ what: 'cut off, no ellipsis', el: e.tagName.toLowerCase() + '.' + [...e.classList].join('.'), text: name(e) });
        if (/^(BUTTON|A)$/.test(e.tagName) && !name(e) && !e.querySelector('svg title')) { const k = e.outerHTML.slice(0, 80); if (!seen.has(k)) { seen.add(k); out.push({ what: 'a button with no name', el: k, text: '' }); } }
      }
      return out.slice(0, 60);
    }) };
  },
  async logs(b) { const since = b.since ?? 0; return { seq, list: logs.filter((e) => e.seq > since && (!b.errors || e.level === 'error' || e.type === 'pageerror')) }; },
  async pages() { return { cur, list: pages.map((p, i) => ({ i, url: p.url() })) }; },
  async page(b) { cur = Math.max(0, Math.min(pages.length - 1, b.i)); await pages[cur].bringToFront(); return { cur, url: pages[cur].url() }; },
  async viewport(b) { viewport = { width: b.w, height: b.h }; for (const p of pages) await p.setViewportSize(viewport); return { viewport }; },
  async wait(b) { if (b.sel) await loc(b.sel, b.nth).waitFor({ state: b.state ?? 'visible', timeout: b.timeout ?? 10000 }); else await page().waitForTimeout(b.ms ?? 500); return {}; },
  // click something that downloads a file: where it was saved, its name and size
  async download(b) {
    const [d] = await Promise.all([page().waitForEvent('download', { timeout: b.timeout ?? 15000 }), loc(b.sel, b.nth).click({ timeout: b.timeout ?? 15000 })]);
    const file = path.join(OUT, d.suggestedFilename().replace(/[^\w. ()-]+/g, '_'));
    await d.saveAs(file);
    return { file, name: d.suggestedFilename(), size: fs.statSync(file).size };
  },
  async quit() { setTimeout(() => process.exit(0), 50); return {}; },
};

http.createServer(async (req, res) => {
  const name = req.url.slice(1).split('?')[0];
  let body = '';
  for await (const c of req) body += c;
  let b = {};
  try { b = body ? JSON.parse(body) : {}; } catch { /* plain */ }
  const before = seq;
  let out;
  try {
    const f = actions[name];
    if (!f) throw new Error(`no action ${name}: ${Object.keys(actions).join(' ')}`);
    out = { ok: true, ...(await f(b)) };
  } catch (e) { out = { ok: false, error: String(e.message || e).split('\n').slice(0, 6).join('\n') }; }
  // (let the page react, then say what it logged meanwhile)
  if (!['logs', 'quit'].includes(name)) { await new Promise((r) => setTimeout(r, b.settle ?? 150)); const said = logs.filter((e) => e.seq > before && e.type !== 'http'); if (said.length) out.said = said.slice(-30); }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(out));
}).listen(PORT, '127.0.0.1', () => console.log(`QA browser on http://127.0.0.1:${PORT}, page ${START}, shots in ${OUT}`));
