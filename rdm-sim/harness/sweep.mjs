#!/usr/bin/env node
/*
  RDM HIL sweep harness
  ---------------------
  Drives the whole timing sweep against a live LumiGate (board A) and the RDM
  fixture simulator (board B) on the same RS485 bus. For each timing cell it:

    1. sets the sim's control channels on board A's DMX output (over board A's
       WebSocket), so the sim latches that timing profile,
    2. triggers an RDM discovery on board A,
    3. reads board A's /rdm.json and checks whether the sim was discovered,
    4. scores the cell against its expectation and prints a row.

  Board A runs the UNMODIFIED shipping firmware. Everything here goes through its
  existing WebSocket (ws://A/ws) and HTTP (GET /rdm.json). No Art-Net needed.

  Requirements: Node 22+ (uses the built-in global WebSocket and fetch).

  Usage:
    node sweep.mjs <board-A-host> [--addr N] [--out N] [--model 0xNNNN]
  Examples:
    node sweep.mjs 192.168.1.50
    node sweep.mjs lumigate.local --addr 1 --out 0
  Env equivalents: LUMIGATE_HOST, SIM_ADDR, SIM_OUT, SIM_MODEL,
                   SETTLE_MS, DISCOVER_TIMEOUT_MS
*/

// ---- args / config --------------------------------------------------------
const argv = process.argv.slice(2);
function flag(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const HOST  = (argv[0] && !argv[0].startsWith('--')) ? argv[0]
            : process.env.LUMIGATE_HOST;
const ADDR  = parseInt(flag('addr',  process.env.SIM_ADDR  ?? '1'), 10);
const OUT   = parseInt(flag('out',   process.env.SIM_OUT   ?? '0'), 10);
const MODEL = parseInt(flag('model', process.env.SIM_MODEL ?? '0x4C31'), 16) ||
              parseInt(process.env.SIM_MODEL ?? '0x4C31', 16);
const SETTLE_MS   = parseInt(process.env.SETTLE_MS ?? '400', 10);
const DISC_TIMEOUT = parseInt(process.env.DISCOVER_TIMEOUT_MS ?? '8000', 10);

if (!HOST) {
  console.error('usage: node sweep.mjs <board-A-host> [--addr N] [--out N] [--model 0xNNNN]');
  process.exit(2);
}
if (typeof WebSocket === 'undefined') {
  console.error('This needs Node 22+ (global WebSocket). Your node:', process.version);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- timing maps (must match rdm-sim/src/main.cpp) ------------------------
const fwd = {
  break: (v) => (v === 0 ? 176 : Math.round(40 + (v - 1) * (1000 - 40) / 254)),
  mab:   (v) => (v === 0 ? 12  : Math.round(12 + (v - 1) * (500 - 12) / 254)),
  turn:  (v) => Math.round(v * 3000 / 255),
  baud:  (v) => (v === 0 ? 250000 : Math.round(250000 + (v - 128) * 5000 / 127)),
};
const inv = {
  break: (us) => (us === 176 ? 0 : clamp(Math.round((us - 40) * 254 / 960) + 1, 1, 255)),
  mab:   (us) => (us === 12  ? 0 : clamp(Math.round((us - 12) * 254 / 488) + 1, 1, 255)),
  turn:  (us) => clamp(Math.round(us * 255 / 3000), 0, 255),
  baud:  (b)  => (b === 250000 ? 0 : clamp(Math.round((b - 250000) * 127 / 5000 + 128), 1, 255)),
};

// ---- board A WebSocket + HTTP ---------------------------------------------
function connect() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://${HOST}/ws`);
    ws.onopen = () => res(ws);
    ws.onerror = (e) => rej(new Error(`WS connect failed: ${e?.message || e}`));
    ws.onmessage = () => {};   // ignore board A's pushes
  });
}
function send(ws, obj) { ws.send(JSON.stringify(obj)); }

async function setChannel(ws, ch, val) {
  send(ws, { set: true, ch, val });
  await sleep(15);
}
async function applyProfile(ws, p) {
  // RGB cleared, then the four timing control channels
  await setChannel(ws, ADDR + 0, 0);
  await setChannel(ws, ADDR + 1, 0);
  await setChannel(ws, ADDR + 2, 0);
  await setChannel(ws, ADDR + 3, p.break);
  await setChannel(ws, ADDR + 4, p.mab);
  await setChannel(ws, ADDR + 5, p.turn);
  await setChannel(ws, ADDR + 6, p.baud);
}

async function getRdm() {
  const r = await fetch(`http://${HOST}/rdm.json`);
  if (!r.ok) throw new Error(`GET /rdm.json -> ${r.status}`);
  return r.json();
}

async function discover(ws) {
  send(ws, { rdm_discover: true });
  const t0 = Date.now();
  let seenBusy = false;
  await sleep(250);
  while (Date.now() - t0 < DISC_TIMEOUT) {
    let j;
    try { j = await getRdm(); } catch { await sleep(150); continue; }
    if (j.busy) { seenBusy = true; }
    else if (seenBusy || (Date.now() - t0 > 1500 && j.scanned)) return j;
    await sleep(150);
  }
  return getRdm();   // timed out, return whatever's there
}

// ---- sweep definition -----------------------------------------------------
const base = { break: 0, mab: 0, turn: 0, baud: 0 };
const cells = [];
const add = (label, profile, expect, axis, target) =>
  cells.push({ label, profile: { ...base, ...profile }, expect, axis, target });

add('baseline (spec timing)', {}, 'found');

// break length: floor is sub-spec (runt) up to long breaks
for (const us of [50, 88, 100, 176, 300, 500, 1000])
  add(`break=${us}us`, { break: inv.break(us) },
      us < 88 ? 'info' : 'found', 'break', us);

// mark-after-break
for (const us of [12, 20, 50, 100, 200])
  add(`mab=${us}us`, { mab: inv.mab(us) }, 'found', 'mab', us);

// bus turnaround: spec window is 176us..2ms; past 2ms should time out gracefully
for (const us of [176, 500, 1000, 2000, 2500])
  add(`turnaround=${us}us`, { turn: inv.turn(us) },
      us > 2000 ? 'miss' : 'found', 'turn', us);

// baud drift (real fixtures aren't exactly 250000)
for (const b of [245000, 248000, 250000, 252000, 255000])
  add(`baud=${b}`, { baud: inv.baud(b) }, 'found', 'baud', b);

// ---- run ------------------------------------------------------------------
function actualTiming(p) {
  return `break=${fwd.break(p.break)}us mab=${fwd.mab(p.mab)}us ` +
         `turn=${fwd.turn(p.turn)}us baud=${fwd.baud(p.baud)}`;
}

async function main() {
  console.log(`=== RDM HIL sweep against ${HOST} ===`);
  console.log(`sim: model=0x${MODEL.toString(16).toUpperCase()} addr=${ADDR} ` +
              `output=${OUT}  (board A unmodified)\n`);

  const ws = await connect();
  send(ws, { out: OUT });      // drive/monitor the bus output
  send(ws, { mode: true });    // hold manual values (no merge from a network source)
  await sleep(200);

  // sanity: is RDM even available on board A?
  const pre = await getRdm();
  if (!pre.available) {
    console.error('board A reports RDM not available (no enabled output with an ' +
                  'RTS/enable pin). Set an RTS pin on the bus output in /config.');
    process.exit(1);
  }

  let pass = 0, fail = 0, info = 0;
  const fails = [];

  for (const c of cells) {
    await applyProfile(ws, c.profile);
    await sleep(SETTLE_MS);     // let board A stream it and the sim latch
    const j = await discover(ws);
    const dev = (j.devices || []).find((d) => d.model === MODEL);
    const found = !!dev;

    let verdict;
    if (c.expect === 'found') { verdict = found ? 'PASS' : 'FAIL'; }
    else if (c.expect === 'miss') { verdict = found ? 'PASS?' : 'PASS'; }
    else { verdict = 'INFO'; }

    if (verdict === 'PASS') pass++;
    else if (verdict === 'FAIL') { fail++; fails.push(c.label); }
    else if (verdict === 'INFO') info++;

    const detail = found ? `found addr=${dev.addr} foot=${dev.footprint} pers=${dev.pers}`
                         : 'not found';
    const exp = c.expect === 'found' ? '' :
                c.expect === 'miss'  ? ' (expect timeout)' : ' (informational)';
    console.log(`  ${verdict.padEnd(5)} ${c.label.padEnd(26)} -> ${detail}${exp}`);
  }

  console.log(`\nsummary: ${pass} pass, ${fail} fail, ${info} info` +
              (fails.length ? `\nfailures: ${fails.join(', ')}` : ''));
  ws.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('harness error:', e.message); process.exit(1); });
