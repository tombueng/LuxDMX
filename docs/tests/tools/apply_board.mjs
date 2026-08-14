// Apply a board template to a LIVE device through the real /config page.
//
// Not a hand-built POST: a partial POST /config sets every omitted checkbox to false
// (that is what checkbox form semantics mean), which on a wired device drops useeth and
// strands it on the setup AP. Driving the actual page keeps every field the device already
// has and changes only what the template touches.
//
// Usage: node tools/apply_board.mjs <host> <boardId>
//        node tools/apply_board.mjs 192.168.178.55 luxdmx_carrier
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const HOST  = process.argv[2] || '192.168.178.55';
const BOARD = process.argv[3] || 'luxdmx_carrier';
// Anything after the board id is "field=value", applied to the form after the template and
// before Save. Use "-" as the board id to change fields without touching the template.
const SETS = process.argv.slice(4).map((s) => s.split('='));

// The bundled browser lives under ~/.cache/ms-playwright; pick whatever revision is there
// rather than pinning one, so this keeps working after a playwright bump.
function chromePath() {
  const base = path.join(process.env.HOME, '.cache', 'ms-playwright');
  if (!fs.existsSync(base)) return undefined;
  for (const d of fs.readdirSync(base).filter((x) => x.startsWith('chromium')).sort().reverse()) {
    const p = path.join(base, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

const browser = await chromium.launch({ executablePath: chromePath() });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text()); });

try {
  await page.goto(`http://${HOST}/config`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => {
    const s = document.getElementById('board-sel');
    return s && s.options.length > 1;
  }, { timeout: 20000 });

  const before = await page.evaluate(() => ({
    sel: document.getElementById('board-sel').value,
    o0tx: document.getElementsByName('o0_tx')[0]?.value,
    miso: document.getElementsByName('ethmiso')[0]?.value,
  }));
  console.log('vorher :', JSON.stringify(before));

  const options = await page.evaluate(() =>
    [...document.getElementById('board-sel').options].map((o) => o.value));
  if (BOARD !== '-' && !options.includes(BOARD)) {
    console.log(`FEHLER: Board "${BOARD}" nicht in der Liste: ${options.join(', ')}`);
    process.exit(2);
  }
  if (BOARD === '-') console.log('(Template unveraendert, nur Felder)');

  // The board block sits in a collapsed section, so the <select> is not "visible" to
  // Playwright's actionability checks. Driving it through the DOM hits the same handlers:
  // the picker listens for the change event, and apply is a plain click handler.
  if (BOARD !== '-') {
    await page.evaluate((b) => {
      const s = document.getElementById('board-sel');
      s.value = b;
      s.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('board-apply').click();
    }, BOARD);

    // "Apply template" asks for confirmation first. Without the OK the only thing that lands is
    // the board's hardwired pin locks, so the form looks half-applied: the copper pins move but
    // the preset (which is what turns the status LED off here) never runs.
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const ov = document.getElementById('app-modal');
      if (ov && ov.classList.contains('show')) document.getElementById('app-modal-ok').click();
    });
    await page.waitForTimeout(1200);
  }

  const after = await page.evaluate(() => ({
    sel: document.getElementById('board-sel').value,
    o0tx: document.getElementsByName('o0_tx')[0]?.value,
    o1tx: document.getElementsByName('o1_tx')[0]?.value,
    o2tx: document.getElementsByName('o2_tx')[0]?.value,
    miso: document.getElementsByName('ethmiso')[0]?.value,
    p0pin: document.getElementsByName('p0_pin')[0]?.value,
  }));
  console.log('im Formular nach Apply:', JSON.stringify(after));

  if (SETS.length) {
    const applied = await page.evaluate((sets) => {
      const out = {};
      for (const [k, v] of sets) {
        const el = document.getElementsByName(k)[0];
        if (!el) { out[k] = 'FEHLT'; continue; }
        // Fields a board pins in copper are rendered disabled, and a disabled field is not
        // submitted at all: setting one looks like it worked and then changes nothing on the
        // device. Un-disable it so the value actually rides along.
        if (el.disabled) el.disabled = false;
        // Enables are checkboxes: writing .value on one silently does nothing, which reads
        // exactly like a successful set right up until the device ignores it.
        if (el.type === 'checkbox') el.checked = (v === '1' || v === 'true' || v === 'on');
        else el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        out[k] = el.type === 'checkbox' ? (el.checked ? 'an' : 'aus') : el.value;
      }
      return out;
    }, SETS);
    console.log('Felder gesetzt:', JSON.stringify(applied));
    await page.waitForTimeout(600);
  }

  const btn = await page.evaluate(() => {
    const e = document.getElementById('save-btn');
    return e ? { found: true, disabled: e.disabled, text: e.textContent.trim(), tag: e.tagName, type: e.type } : { found: false };
  });
  console.log('save-btn:', JSON.stringify(btn));
  if (btn.disabled) {
    const w = await page.evaluate(() => {
      const box = document.getElementById('pin-warnings');
      const rows = box ? [...box.querySelectorAll('li,div,p')].map((e) => e.textContent.trim()).filter(Boolean) : [];
      const bad = [...document.querySelectorAll('.is-invalid')].map((e) => `${e.name || e.id}=${e.value}`);
      return { rows: rows.slice(0, 12), bad };
    });
    console.log('Konflikte:', JSON.stringify(w, null, 1));
  }

  page.on('response', (res) => {
    if (res.url().includes('/config') && res.request().method() === 'POST')
      console.log('  POST /config ->', res.status());
  });

  await page.evaluate(() => document.getElementById('save-btn').click());
  await page.waitForTimeout(6000);
  console.log('Seiten-Status:', await page.evaluate(() => {
    const s = document.getElementById('save-status') || document.getElementById('savemsg');
    return s ? s.textContent.trim() : '(kein Statusfeld)';
  }));

  // Read it back from the device, not from the form: the point of the exercise is what the
  // device now believes, and a save that silently did nothing looks identical in the DOM.
  // Applying config live re-inits the networking, so the first attempts get refused -- poll.
  let r = null;
  for (let i = 0; i < 20 && !r; i++) {
    try { r = await fetch(`http://${HOST}/info.json`).then((x) => x.json()); }
    catch { await new Promise((s) => setTimeout(s, 1500)); }
  }
  if (!r) { console.log('Geraet antwortet nach dem Save nicht mehr'); process.exit(3); }
  console.log('Geraet danach:', JSON.stringify({
    boardSel: r.boardSel, ethMiso: r.ethMiso, ethCs: r.ethCs,
    outTx: (r.outputs || []).map((o) => o.tx),
    pixPins: (r.pixels || []).map((p) => p.pin),
  }));
} finally {
  await browser.close();
}
