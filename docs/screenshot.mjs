import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, rmSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import dns from 'dns/promises';

// ── Config ───────────────────────────────────────────────────────────────────
// Resolve the device: LUXDMX_URL > mDNS lookup of LUXDMX_HOST > fallback IP.
// (Headless Chromium can't resolve *.local itself, so we resolve to an IP here.)
const FALLBACK_IP = '192.168.178.197';
const OUT         = 'C:/dev/DMX/docs';
const VID_RAW     = OUT + '/video-raw';
const RUN_OTA     = process.env.LUXDMX_OTA === '1';   // off by default (reflashes device)
const RUN_VIDEO   = process.env.LUXDMX_NOVIDEO !== '1';
const RUN_SHOTS   = process.env.LUXDMX_NOSHOT !== '1';
const VID_W       = 1920;                                // Full-HD walkthrough recording
const VID_H       = 1080;

async function resolveBase() {
  if (process.env.LUXDMX_URL) return process.env.LUXDMX_URL;
  const host = process.env.LUXDMX_HOST || 'dmx-gateway.local';
  try {
    const { address } = await dns.lookup(host, { family: 4 });
    return 'http://' + address;
  } catch {
    return 'http://' + FALLBACK_IP;
  }
}

const BASE = await resolveBase();
mkdirSync(OUT, { recursive: true });
console.log('device:', BASE);

// A visible cursor with a pulsing click ripple so the walkthrough is easy to follow.
const CURSOR_JS = `(() => {
  if (window.__cursor) return; window.__cursor = 1;
  const root = document.documentElement;
  const style = document.createElement('style');
  style.textContent =
    '@keyframes lgRipple{0%{opacity:.55;transform:translate(-50%,-50%) scale(.25)}'
    + '100%{opacity:0;transform:translate(-50%,-50%) scale(2.8)}}';
  root.appendChild(style);
  const dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;z-index:2147483647;width:22px;height:22px;left:0;top:0;'
    + 'margin:-11px 0 0 -11px;border-radius:50%;background:rgba(88,166,255,.5);'
    + 'border:2px solid #fff;box-shadow:0 0 10px rgba(0,0,0,.7);pointer-events:none;'
    + 'transition:transform .08s;';
  const add = () => (document.body || root).appendChild(dot);
  if (document.body) add(); else addEventListener('DOMContentLoaded', add);
  let x = 0, y = 0;
  addEventListener('mousemove', e => { x = e.clientX; y = e.clientY;
    dot.style.left = x + 'px'; dot.style.top = y + 'px'; }, true);
  addEventListener('mousedown', () => {
    dot.style.transform = 'scale(.65)';
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;z-index:2147483646;left:' + x + 'px;top:' + y + 'px;'
      + 'width:44px;height:44px;border-radius:50%;border:3px solid #58a6ff;'
      + 'pointer-events:none;animation:lgRipple .6s ease-out forwards;';
    (document.body || root).appendChild(r);
    setTimeout(() => r.remove(), 650);
  }, true);
  addEventListener('mouseup', () => { dot.style.transform = 'scale(1)'; }, true);
})();`;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Still screenshots (status + settings; OTA pair only when LUXDMX_OTA=1)
// ─────────────────────────────────────────────────────────────────────────────
async function shoot(browser) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 1400 });

  // Status page — staged with a lit, labelled grid for a compelling hero image.
  // We snapshot the device's existing labels and restore them afterward, and
  // blackout + leave manual mode so the device ends exactly as we found it.
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const DEMO_LABELS = {
    '1': 'Front Wash L', '2': 'Front Wash R', '5': 'Haze',
    '9': 'Mover 1', '10': 'Mover 2', '17': 'Blinder',
  };
  const origLabels = await page.evaluate(async () => {
    try { return await (await fetch('/labels.json')).json(); } catch { return {}; }
  });
  await page.evaluate((demo) => {
    send({ type: 'mode', manual: true });
    // Smooth value sweep across the first rows so the grid looks alive
    for (let ch = 1; ch <= 160; ch++) {
      const v = Math.round(70 + 120 * (0.5 + 0.5 * Math.sin(ch / 7)) + (ch % 5) * 8);
      send({ type: 'set', ch, val: Math.min(255, v) });
    }
    labels = demo;
    applyLabels();
    fetch('/labels', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                       body: JSON.stringify(demo) });
  }, DEMO_LABELS);
  await page.waitForTimeout(2500);              // let WS echo values back + render
  await page.screenshot({ path: OUT + '/screenshot-status.png', fullPage: false });
  console.log('status done');

  // Restore device: original labels, blackout, manual mode off
  await page.evaluate((orig) => {
    labels = orig || {};
    applyLabels();
    fetch('/labels', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                       body: JSON.stringify(labels) });
    send({ type: 'blackout' });
    send({ type: 'mode', manual: false });
  }, origLabels);
  await page.waitForTimeout(1000);

  await page.goto(BASE + '/config', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + '/screenshot-config.png', fullPage: true });
  console.log('config done');

  if (RUN_OTA) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/config', { waitUntil: 'domcontentloaded' });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}),
      page.click('form[action="/ota/github"] button[type="submit"]'),
    ]);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: OUT + '/screenshot-ota-progress.png', fullPage: false });
    console.log('ota progress done');

    console.log('waiting for device to reboot...');
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(3000);
      try {
        const resp = await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 5000 });
        if (resp && resp.ok()) {
          await page.waitForTimeout(2000);
          await page.setViewportSize({ width: 1280, height: 1400 });
          await page.screenshot({ path: OUT + '/screenshot-after-ota.png', fullPage: false });
          console.log('after-ota done');
          break;
        }
      } catch { /* still rebooting */ }
    }
  }
  await page.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Web-UI walkthrough video — demonstrates every interactive control.
//    Does NOT submit any form that reboots/flashes (Save, Reset, OTA install).
//    Leaves the device as found (manual mode off, blackout, demo label cleared).
// ─────────────────────────────────────────────────────────────────────────────
async function recordDemo(browser) {
  const ctx = await browser.newContext({
    viewport: { width: VID_W, height: VID_H },
    deviceScaleFactor: 1,
    recordVideo: { dir: VID_RAW, size: { width: VID_W, height: VID_H } },
  });
  await ctx.addInitScript(CURSOR_JS);
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(20000);

  const SLOW = 1.5;                              // global pacing multiplier
  const ease = t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
  const pause = ms => page.waitForTimeout(Math.round(ms * SLOW));
  let cur = { x: VID_W / 2, y: VID_H / 2 };

  // Smoothly glide the (visible) cursor from its last position to (x, y).
  async function glide(x, y, ms = 520) {
    const dur = ms * SLOW, steps = Math.max(14, Math.round(dur / 16));
    const sx = cur.x, sy = cur.y;
    for (let i = 1; i <= steps; i++) {
      const e = ease(i / steps);
      await page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
      await page.waitForTimeout(16);
    }
    cur = { x, y };
  }
  const boxOf = async sel => page.locator(sel).first().boundingBox();
  async function moveTo(sel, frac = 0.5) {
    const b = await boxOf(sel);
    if (!b) return null;
    const x = b.x + b.width * frac, y = b.y + b.height / 2;
    await glide(x, y);
    return { x, y, b };
  }
  async function click(sel, frac = 0.5) {
    const p = await moveTo(sel, frac);
    if (!p) return;
    await pause(220);
    await page.mouse.down(); await page.waitForTimeout(70); await page.mouse.up();
    await pause(360);
  }

  // Butter-smooth, eased programmatic scroll (captured frame-by-frame in the video).
  async function smoothScroll(targetY, ms = 1300) {
    await page.evaluate(({ targetY, ms }) => new Promise(res => {
      const startY = window.scrollY, dist = targetY - startY, t0 = performance.now();
      (function step(now) {
        const t = Math.min(1, (now - t0) / ms);
        const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        window.scrollTo(0, startY + dist * e);
        if (t < 1) requestAnimationFrame(step); else res();
      })(performance.now());
    }), { targetY, ms: ms * SLOW });
    await pause(120);
  }
  async function scrollToEl(sel, margin = 150) {
    const y = await page.evaluate(s => window.scrollY + document.querySelector(s).getBoundingClientRect().top, sel);
    await smoothScroll(Math.max(0, y - margin));
  }

  // Open a <select> in-page (size = option count) so the expanded list is visible
  // in the recording, glide over to the chosen option, pick it, then collapse.
  async function pickOption(sel, value) {
    await moveTo(sel);
    await pause(250);
    await page.locator(sel).first().evaluate(el => {
      el.dataset.lgz = el.style.zIndex; el.style.position = 'relative'; el.style.zIndex = '50';
      el.size = el.options.length;
    });
    await pause(550);
    const ob = await page.evaluate(({ sel, value }) => {
      const el = document.querySelector(sel);
      const opt = [...el.options].find(o => o.value === value) || el.options[0];
      const r = opt.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, { sel, value });
    await glide(ob.x, ob.y, 460);
    await pause(250);
    await page.mouse.down(); await page.waitForTimeout(70); await page.mouse.up();
    await page.locator(sel).first().evaluate((el, v) => {
      el.value = v; el.size = 0; el.style.zIndex = el.dataset.lgz || ''; el.blur();
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await pause(550);
  }

  try {
  // ── STATUS PAGE ────────────────────────────────────────────────────────────
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await pause(3000);                            // let live stats + WebSocket tick in

  // Enable manual override so we can drive the grid for the demo
  await click('#modeSwitch');
  await pause(600);

  // Light up the grid with a colourful pattern (over the live WebSocket)
  await page.evaluate(() => {
    let i = 1;
    const t = setInterval(() => {
      for (let k = 0; k < 24 && i <= 240; k++, i++) {
        const v = Math.round(127 + 127 * Math.sin(i / 9));
        send({ type: 'set', ch: i, val: v });
      }
      if (i > 240) clearInterval(t);
    }, 90);
  });
  await pause(2600);

  // Open a channel, name it, sweep the slider, use quick buttons, identify
  await click('#ch7');
  await pause(700);
  await click('#ch-label');
  await page.fill('#ch-label', '');
  await page.type('#ch-label', 'Front Wash L', { delay: 90 });
  await page.keyboard.press('Tab');            // commit label (onchange)
  await pause(800);

  // Sweep the slider thumb left→right→mid for a visible fade
  {
    const s = await page.locator('#ch-slider').boundingBox();
    if (s) {
      const y = s.y + s.height / 2;
      await glide(s.x + 6, y, 400);
      await page.mouse.down();
      await glide(s.x + s.width - 6, y, 1100);     // sweep up
      await pause(350);
      await glide(s.x + 6, y, 1100);               // sweep down
      await pause(250);
      await glide(s.x + s.width * 0.6, y, 800);    // settle mid
      await page.mouse.up();
      await pause(600);
    }
  }
  await click('button[onclick="setQuick(0)"]');     // Off
  await pause(450);
  await click('button[onclick="setQuick(128)"]');   // 50%
  await pause(450);
  await click('button[onclick="setQuick(255)"]');   // Full
  await pause(550);
  await click('button[onclick="identify()"]');      // Identify flash
  await pause(1700);
  await click('button[onclick="closeModal()"]');    // Done
  await pause(800);

  // Blackout everything
  await click('button[onclick="sendBlackout()"]');
  await pause(1600);

  // ── SETTINGS PAGE ────────────────────────────────────────────────────────────
  await page.goto(BASE + '/config', { waitUntil: 'domcontentloaded' });
  await pause(2200);

  // Protocol dropdown — expand it so every option is visible, then pick
  await scrollToEl('#proto-sel', 200);
  await pickOption('#proto-sel', '1');              // sACN only
  await pickOption('#proto-sel', '2');              // Both (back to device default)

  // Universe spinner (hint text below updates live)
  await click('#uni-inp');
  await page.fill('#uni-inp', '4'); await page.dispatchEvent('#uni-inp', 'input'); await pause(1000);
  await page.fill('#uni-inp', '0'); await page.dispatchEvent('#uni-inp', 'input'); await pause(700);

  // Network — static IP toggle reveals the address fields
  await scrollToEl('.card:has(#static-sw)', 130);
  await click('#static-sw'); await pause(1400);     // reveal fields
  await click('#static-sw'); await pause(900);      // hide again

  // Status LED type — expand the dropdown to show all three options
  await scrollToEl('#led-type', 200);
  await pickOption('#led-type', '1');               // Plain GPIO
  await pickOption('#led-type', '2');               // WS2812 RGB (back to device default)

  // Device card (hostname / OTA password)
  await scrollToEl('#dev-host', 160);
  await moveTo('#dev-host'); await pause(1000);

  // Firmware Update — auto-update toggle + the live GitHub version table
  await scrollToEl('#auto-update-sw', 150);
  await moveTo('#auto-update-sw'); await pause(1100);
  await scrollToEl('#ver-rows', 160);
  await pause(1600);

  // Danger zone confirm checkbox (do NOT submit)
  await scrollToEl('#confirm-reset', 200);
  await click('#confirm-reset'); await pause(1000);
  await click('#confirm-reset'); await pause(800);  // un-tick again

  // Smooth scroll back to the top to round off the settings tour
  await smoothScroll(0, 1500);
  await pause(800);

  // ── Leave the device exactly as found ───────────────────────────────────────
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await pause(1800);
  await page.evaluate(() => {
    delete labels['7'];
    fetch('/labels', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                       body: JSON.stringify(labels) });
    send({ type: 'blackout' });
    send({ type: 'mode', manual: false });
  });
  await pause(1200);
  } finally {
    await ctx.close();   // always flush the .webm + close WS/HTTP, even on error
  }

  // Find the recorded webm
  const webm = readdirSync(VID_RAW).filter(f => f.endsWith('.webm')).map(f => VID_RAW + '/' + f)[0];
  if (!webm) { console.log('no video produced'); return; }
  console.log('raw video:', webm);

  // Convert to MP4 (linked in README) and an inline-playing GIF
  const mp4 = OUT + '/demo.mp4';
  const gif = OUT + '/demo.gif';
  const pal = VID_RAW + '/palette.png';
  console.log('encoding mp4...');
  execSync(`ffmpeg -y -i "${webm}" -movflags +faststart -pix_fmt yuv420p `
         + `-vf "scale=${VID_W}:-2" -c:v libx264 -preset slow -crf 18 "${mp4}"`, { stdio: 'inherit' });
  console.log('encoding gif...');
  // Short, inline-friendly teaser (the YouTube link carries the full tour).
  const GIF_T = '28', GIF_VF = 'fps=10,scale=760:-1:flags=lanczos';
  execSync(`ffmpeg -y -t ${GIF_T} -i "${webm}" -vf "${GIF_VF},palettegen=max_colors=128:stats_mode=diff" "${pal}"`, { stdio: 'inherit' });
  execSync(`ffmpeg -y -t ${GIF_T} -i "${webm}" -i "${pal}" -filter_complex `
         + `"${GIF_VF}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" "${gif}"`, { stdio: 'inherit' });
  console.log('video done:', mp4, gif);
}

// ─────────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
try {
  if (RUN_SHOTS) await shoot(browser);
  if (RUN_VIDEO) {
    if (existsSync(VID_RAW)) rmSync(VID_RAW, { recursive: true, force: true });
    await recordDemo(browser);
  }
} finally {
  await browser.close();
}
console.log('all done');
