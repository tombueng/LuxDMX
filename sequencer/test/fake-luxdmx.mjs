// A stand-in LuxDMX for the e2e tests: serves the real bridge page from the firmware sources
// (src/pages/bridge.html) on its own origin, takes the bridge's binary DMX frames on /ws, answers
// each one like the box (one byte, 'K'), and reports what arrived. So the whole path (app -> postMessage -> bridge -> WebSocket) runs exactly
// like against a box, minus the box.
//
//   node test/fake-luxdmx.mjs [port] [universes]      e.g. 8199 0,1
//
//   GET  /bridge        the real bridge page
//   GET  /remote        the real phone remote page (its /ws relay messages are passed on, like the box does)
//   GET  /info.json     { version, hostname, outputs: [{ en, uni }] }
//   GET  /frames.json   per universe: last frame, frame count, first/last arrival (ms)
//   GET  /history.json?uni=0&ch=1   every value channel `ch` had, with timestamps (for fades)
//   POST /reset         forget everything received (and the RDM rig as it was, answers on time);
//                       ?pyro=1 puts a pyro device nobody's library knows on the line too (E1.20
//                       category 0x0402)
//   POST /pixels?ports=10:2,12:1   pixel ports on these universes (GET /pixels.json reads them);
//                                  10:2:150:500 also says its brightness and power cap
//   POST /ws/test       { ackDelay: ms } answer each message that much later, { noAck: true } never
//   GET  /ws/stats.json { acks, early }: answers sent, and messages that came before the answer to
//                       the one before (the pages must wait: see the ack in the README)
//   GET  /rdm.json, /rdm/discover, /rdm/identify, /rdm/setaddr, /rdm/setpers, /rdm/setlabel
//                       the box's RDM controller, with a small made-up rig on the wire (RIG below)
//   POST /rdm/test      { drop: uid } one light goes quiet, { back: uid } it answers again
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.resolve(here, '../../src/pages/bridge.html');
const REMOTE = path.resolve(here, '../../src/pages/remote.html');
// someone else's add-on repository, for the tests that add one as another source (/repo/...)
const REPO = path.resolve(here, 'fixtures/addons-repo');
const port = +(process.argv[2] || 8199);
const unis = (process.argv[3] || '0,1').split(',').map(Number);

let frames = new Map();   // uni -> { data, count, first, last }
let pixelPorts = [];      // [universe, spans] of its enabled pixel ports

// ---- RDM: the lights on the box's lines, as its RDM controller would report them. A scan takes a
// moment (searching, then reading each light's details), like the box's; the spot's head warms up.
const RIG = () => [
  { uid: '5253:00000101', uni: unis[0], addr: 1, model: 0x0123, mfg: 'Robe lighting s.r.o.', modelName: 'Robin 600E Spot', label: 'SL Spot', cat: 0x0101,
    modes: [{ n: 1, name: 'Mode 1', footprint: 37 }, { n: 2, name: 'Mode 2', footprint: 49 }], pers: 1, sw: '2.4.1', swVer: 0x020401, temp: 38 },
  { uid: '4C55:00000001', uni: unis[0], addr: 40, model: 0x0006, mfg: 'LuxDMX Test', modelName: 'Par 6', label: '', cat: 0x0100,
    modes: [{ n: 1, name: '3 channel', footprint: 3 }, { n: 2, name: '5 channel', footprint: 5 }, { n: 3, name: '8 channel', footprint: 8 }], pers: 2, sw: '1.0', swVer: 0x0100 },
  { uid: '4C55:00000002', uni: unis[0], addr: 60, model: 0x0006, mfg: 'LuxDMX Test', modelName: 'Par 6', label: 'Par right', cat: 0x0100,
    modes: [{ n: 1, name: '3 channel', footprint: 3 }, { n: 2, name: '5 channel', footprint: 5 }, { n: 3, name: '8 channel', footprint: 8 }], pers: 3, sw: '1.0', swVer: 0x0100,
    status: { type: 3, id: 0x0020, count: 1 } },
  { uid: '4C55:00000010', uni: unis[1] ?? unis[0], addr: 1, model: 0x0010, mfg: 'LuxDMX Test', modelName: 'Head 11', label: '', cat: 0x0101,
    modes: [{ n: 1, name: '11 channel', footprint: 11 }], pers: 1, sw: '3.1', swVer: 0x0301, temp: 45 },
];
let rig = RIG(), rdmScan = { busy: false, stage: 0, found: 0, scanned: false, at: 0 }, quiet = new Set();
const rdmDev = (d) => ({ uid: d.uid, uni: d.uni, addr: d.addr, footprint: d.modes.find((m) => m.n === d.pers).footprint, model: d.model, pers: d.pers, persCount: d.modes.length,
  subs: 0, identify: !!d.identify, sw: d.sw, mfg: d.mfg, modelName: d.modelName, label: d.label, cat: d.cat, swVer: d.swVer, modes: d.modes,
  sensors: d.temp !== undefined ? [{ name: 'Head temperature', value: Math.round(d.temp), lo: 20, hi: Math.round(d.temp), rec: 0, type: 0, poll: true, unit: 'C' }] : [],
  stType: d.status?.type ?? 0, stId: d.status?.id ?? 0, stCount: d.status?.count ?? 0, hours: 1234 });
function rdmState() {
  const t = Date.now();
  if (rdmScan.busy) {
    const dt = t - rdmScan.at;
    rdmScan.stage = dt < 500 ? 1 : 2;
    rdmScan.found = Math.min(rig.length, Math.floor(dt / 250));
    if (dt > 1500) { rdmScan.busy = false; rdmScan.stage = 0; rdmScan.scanned = true; rdmScan.found = rig.filter((d) => !quiet.has(d.uid)).length; }
  }
  for (const d of rig) if (d.temp !== undefined) d.temp = Math.min(70, d.temp + 0.02);
  const shown = rdmScan.scanned ? rig.filter((d) => !quiet.has(d.uid)) : rig.slice(0, rdmScan.found);
  return { available: true, busy: rdmScan.busy, scanned: rdmScan.scanned, artnetRdm: true, discovering: rdmScan.busy, discStage: rdmScan.stage, discFound: rdmScan.found,
    rdmLines: unis.map((u, i) => ({ line: i, uni: u })), outputs: unis.map((u, i) => ({ i, uni: u, merge: 1 })), devices: shown.map(rdmDev) };
}
let history = [];         // { t, uni, data }   (capped)
let ackDelay = 0, noAck = false, wsStats = { acks: 0, early: 0 };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
  if (url.pathname === '/bridge' || url.pathname === '/remote') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(url.pathname === '/bridge' ? BRIDGE : REMOTE, 'utf8'));
  } else if (url.pathname === '/pixels.json') {
    json({ ports: pixelPorts.map(([uni, spans, bright = 255, maxMa = 0]) => ({ en: true, uni, spans, start: 1, count: spans * 170, bright, gamma: 220, maxMa, mAPerCh: 2000, quiesMa: 100 }))
      .concat({ en: false, uni: 999, spans: 0, start: 1, count: 0, bright: 255, gamma: 220, maxMa: 0, mAPerCh: 2000, quiesMa: 100 }) });
  } else if (url.pathname === '/drop' && req.method === 'POST') {
    // as if it restarted: every socket goes (the bridge page comes back by itself)
    for (const c of wss.clients) c.terminate();
    json({ ok: true });
  } else if (url.pathname === '/pixels' && req.method === 'POST') {
    // ?ports=10:2,12:1 the universes its pixel ports start on, and how many each spans (10:2:150:500:
    // brightness 150, a 500 mA cap; else 255 and none)
    pixelPorts = (url.searchParams.get('ports') ?? '').split(',').filter(Boolean).map((s) => s.split(':').map(Number));
    json({ ok: true });
  } else if (url.pathname === '/info.json') {
    json({ version: 'fake', hostname: 'fake-luxdmx', artShort: 'Fake LuxDMX', ip: '127.0.0.1', outputs: unis.map((u) => ({ en: true, uni: u })) });
  } else if (url.pathname.startsWith('/repo/')) {
    // (plain files, as any web server serves them, open to any page; nothing outside the folder)
    const f = path.resolve(REPO, '.' + url.pathname.slice('/repo'.length));
    if (!f.startsWith(REPO + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': f.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(f));
  } else if (url.pathname === '/frames.json') {
    const out = {};
    for (const [u, f] of frames) out[u] = { ch: [...f.data], count: f.count, first: f.first, last: f.last };
    json(out);
  } else if (url.pathname === '/history.json') {
    const u = +(url.searchParams.get('uni') ?? 0), ch = +(url.searchParams.get('ch') ?? 1);
    json(history.filter((h) => h.uni === u).map((h) => [h.t, h.data[ch - 1] ?? 0]));
  } else if (url.pathname === '/reset' && req.method === 'POST') {
    pixelPorts = [];
    frames = new Map(); history = []; ackDelay = 0; noAck = false; wsStats = { acks: 0, early: 0 }; for (const c of wss.clients) c.pending = false; rig = RIG();
    if (url.searchParams.get('pyro') === '1') rig.push({ uid: '7A70:00000001', uni: unis[0], addr: 100, model: 0x0042, mfg: 'Spark Co', modelName: 'Jet 2', label: '', cat: 0x0402,
      modes: [{ n: 1, name: '2 channel', footprint: 2 }], pers: 1, sw: '1.0', swVer: 0x0100 });
    rdmScan = { busy: false, stage: 0, found: 0, scanned: false, at: 0 }; quiet = new Set(); json({ ok: true });
  } else if (url.pathname === '/ws/stats.json') {
    json(wsStats);
  } else if (url.pathname === '/ws/test' && req.method === 'POST') {
    let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
      try { const m = JSON.parse(body || '{}'); if ('ackDelay' in m) ackDelay = +m.ackDelay || 0; if ('noAck' in m) noAck = !!m.noAck; } catch { /* ignore */ }
      json({ ok: true });
    });
  } else if (url.pathname === '/rdm.json') {
    json(rdmState());
  } else if (url.pathname.startsWith('/rdm/') && url.pathname !== '/rdm/test') {
    const op = url.pathname.slice(5), q = url.searchParams, d = rig.find((x) => x.uid === (q.get('uid') ?? '').toUpperCase());
    const bad = () => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"ok":false}'); };
    if (op === 'discover') { rdmScan = { busy: true, stage: 1, found: 0, scanned: false, at: Date.now() }; json({ ok: true, op }); }
    else if (!d || quiet.has(d.uid)) bad();
    else if (op === 'identify') { d.identify = q.get('on') === '1'; json({ ok: true, op }); }
    else if (op === 'setaddr') { const a = +(q.get('addr') ?? 0); if (a >= 1 && a <= 512) { d.addr = a; json({ ok: true, op }); } else bad(); }
    else if (op === 'setpers') { const n = +(q.get('pers') ?? 0); if (d.modes.some((m) => m.n === n)) { d.pers = n; json({ ok: true, op }); } else bad(); }
    else if (op === 'setlabel') { d.label = (q.get('label') ?? '').slice(0, 32); json({ ok: true, op }); }
    else bad();
  } else if (url.pathname === '/rdm/test' && req.method === 'POST') {
    let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
      try { const m = JSON.parse(body || '{}'); if (m.drop) quiet.add(String(m.drop).toUpperCase()); if (m.back) quiet.delete(String(m.back).toUpperCase()); } catch { /* ignore */ }
      json({ ok: true });
    });
  } else { res.writeHead(404); res.end('not found'); }
});

const wss = new WebSocketServer({ server, path: '/ws' });
// Like the box: one byte ('K') back for every DMX frame and relay message, none for the subscribes.
const ACK = Buffer.from('K');
function ack(ws) {
  ws.pending = true;
  const go = () => { ws.pending = false; if (ws.readyState === 1) { ws.send(ACK); wsStats.acks++; } };
  if (noAck) return;
  if (ackDelay) setTimeout(go, ackDelay); else go();
}
wss.on('connection', (ws) => {
  ws.on('message', (buf, isBinary) => {
    const answered = isBinary ? buf[0] === 0x44 : buf.toString().startsWith('{"relay":');
    if (answered) { if (ws.pending && !noAck) wsStats.early++; ack(ws); }
    // text: only the remote's relay messages are modelled, like the box: by role (a phone's to the
    // laptop's bridge, the laptop's to the phones), at most 4096 bytes, valid UTF-8 only
    if (!isBinary) {
      const t = buf.toString();
      if (t === '{"type":"relay"}') { ws.relay = 1; return; }                // a phone
      if (t === '{"type":"relay","host":1}') { ws.relay = 2; return; }       // the laptop's bridge
      if (!t.startsWith('{"relay":') || buf.length > 4096 || !Buffer.from(t).equals(buf)) return;
      const to = ws.relay === 2 ? 1 : 2;                                     // the laptop's to the phones, the rest to the laptop
      for (const c of wss.clients) if (c !== ws && c.relay === to && c.readyState === 1) c.send(t);
      return;
    }
    const b = new Uint8Array(buf);
    if (b.length < 7 || b[0] !== 0x44 || b[1] !== 1) return;
    const uni = (b[2] | (b[3] << 8)) & 0x7fff;
    const data = b.slice(6);
    const t = Date.now();
    const f = frames.get(uni) ?? { data, count: 0, first: t, last: t };
    f.data = data; f.count++; f.last = t;
    frames.set(uni, f);
    history.push({ t, uni, data });
    if (history.length > 20000) history.splice(0, history.length - 20000);
  });
});

// The box pushes a binary status frame to every /ws client ten times a second (the remote page uses
// them as its "the box is there" heartbeat): a stand-in of the same shape.
setInterval(() => { const f = Buffer.alloc(548); for (const c of wss.clients) if (c.readyState === 1) c.send(f); }, 100);

server.listen(port, '127.0.0.1', () => console.log(`fake LuxDMX on http://127.0.0.1:${port}, universes ${unis.join(',')}`));
