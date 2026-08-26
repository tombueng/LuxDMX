// Minimal Art-Net 4 RDM controller for the e2e suite: build/parse ArtPoll, ArtTodRequest,
// ArtTodControl and ArtRdm, plus the E1.20 RDM message layer. Pure Node dgram, no deps.
// Mirrors docs/tests/artnet_rdm_ctrl.py. Unicasts to the device so it works on any host
// (the broadcast-ArtPoll path is validated on the rig, not here).
import dgram from 'dgram';

export const ART_PORT = 6454;
const ID = 'Art-Net\0';
export const OP_POLL = 0x2000, OP_POLLREPLY = 0x2100, OP_TODREQUEST = 0x8000,
             OP_TODDATA = 0x8100, OP_TODCONTROL = 0x8200, OP_RDM = 0x8300, OP_ADDRESS = 0x6000;
// ArtAddress Command bytes (Art-Net 4 selects the port by BindIndex, so the "...0" variants are used).
export const AC_CANCEL_MERGE = 0x01, AC_MERGE_LTP0 = 0x10, AC_MERGE_HTP0 = 0x50, AC_BQP0 = 0xe0;
export const CC_GET = 0x20, CC_SET = 0x30;
export const PID_DEVICE_INFO = 0x0060, PID_SW_LABEL = 0x00c0,
             PID_DMX_START_ADDRESS = 0x00f0, PID_IDENTIFY = 0x1000, PID_SENSOR_VALUE = 0x0201;

// ---- RDM message (with 0xCC start code + 16-bit checksum) ----
export function buildRdm(dest, src, cc, pid, pd = Buffer.alloc(0), tn = 1) {
  const body = Buffer.alloc(24 + pd.length);
  body[0] = 0xcc; body[1] = 0x01; body[2] = 24 + pd.length;
  uidTo(body, 3, dest); uidTo(body, 9, src);
  body[15] = tn & 0xff; body[16] = 1; body[17] = 0;      // TN, PortID=1, MsgCount=0
  body.writeUInt16BE(0, 18);                             // SubDevice = root
  body[20] = cc; body.writeUInt16BE(pid, 21); body[23] = pd.length;
  pd.copy(body, 24);
  let ck = 0; for (const b of body) ck += b;
  return Buffer.concat([body, Buffer.from([(ck >> 8) & 0xff, ck & 0xff])]);
}
export function parseRdm(msg) {
  if (msg.length < 26 || msg[0] !== 0xcc || msg[1] !== 0x01) return null;
  const mlen = msg[2];
  if (mlen + 2 > msg.length) return null;
  let ck = 0; for (let i = 0; i < mlen; i++) ck += msg[i];
  if (ck !== msg.readUInt16BE(mlen)) return { badChecksum: true };
  const pdl = msg[23];
  return { src: uidFrom(msg, 9), respType: msg[16], cc: msg[20], pid: msg.readUInt16BE(21),
           pd: msg.slice(24, 24 + pdl) };
}
function uidTo(b, o, uid) { b.writeUInt16BE(uid[0], o); b.writeUInt32BE(uid[1], o + 2); }
function uidFrom(b, o) { return [b.readUInt16BE(o), b.readUInt32BE(o + 2)]; }
export const uidStr = (u) => u[0].toString(16).padStart(4, '0').toUpperCase() + ':' +
                             u[1].toString(16).padStart(8, '0').toUpperCase();
export function parseUidStr(s) { const [m, d] = s.split(':'); return [parseInt(m, 16), parseInt(d, 16)]; }

// ---- Art-Net RDM packets ----
function artHead(op, extra) {
  const b = Buffer.concat([Buffer.from(ID, 'latin1'), Buffer.alloc(2 + extra)]);
  b.writeUInt16LE(op, 8);
  return b;
}
export function buildArtPoll() { const b = artHead(OP_POLL, 4); b[10] = 0; b[11] = 14; b[12] = 0; b[13] = 0x10; return b; }
export function buildTodRequest(pa) {
  const b = artHead(OP_TODREQUEST, 15); b[10] = 0; b[11] = 14;
  b[21] = (pa >> 8) & 0x7f; b[22] = 0; b[23] = 1; b[24] = pa & 0xff; return b;
}
export function buildTodControl(pa, flush = true) {
  const b = artHead(OP_TODCONTROL, 14); b[10] = 0; b[11] = 14;
  b[21] = (pa >> 8) & 0x7f; b[22] = flush ? 1 : 0; b[23] = pa & 0xff; return b;
}
export function buildArtRdm(pa, rdmFull) {
  const b = artHead(OP_RDM, 14); b[10] = 0; b[11] = 14; b[12] = 1;
  b[21] = (pa >> 8) & 0x7f; b[22] = 0; b[23] = pa & 0xff;
  return Buffer.concat([b, rdmFull.slice(1)]);   // RDM packet without the 0xCC start code
}
export function parseTodData(p) {
  if (p.length < 28) return null;
  const n = p[27], uids = [];
  for (let i = 0; i < n; i++) { const o = 28 + i * 6; if (o + 6 <= p.length) uids.push(uidFrom2(p, o)); }
  return { portAddress: (p[21] << 8) | p[23], uidTotal: p.readUInt16BE(24), uids };
}
function uidFrom2(b, o) { return [b.readUInt16BE(o), b.readUInt32BE(o + 2)]; }
export function parseArtRdm(p) { return p.length < 25 ? null : parseRdm(Buffer.concat([Buffer.from([0xcc]), p.slice(24)])); }
// ArtAddress: remote node/port config. Command @106, BindIndex @13 picks the port.
// opts.short / opts.long program the node names (ShortName @14 x18, LongName @32 x64); an omitted
// name leaves the field zeroed, which the node reads as "don't touch this".
// opts.net / opts.sub / opts.swOut program the 15-bit port-address. Art-Net only applies those when
// bit 7 of the byte is set, so pass the raw value and this sets the bit for you; omit to leave alone.
export function buildArtAddress(bindIndex, cmd, opts = {}) {
  const b = artHead(OP_ADDRESS, 97);   // 8 (ID) + 2 (op) + 97 = 107 bytes
  b[10] = 0; b[11] = 14; b[13] = bindIndex; b[106] = cmd;
  if (opts.net   != null) b[12]  = 0x80 | (opts.net   & 0x7f);
  if (opts.sub   != null) b[104] = 0x80 | (opts.sub   & 0x0f);
  if (opts.swOut != null) b[100] = 0x80 | (opts.swOut & 0x0f);
  if (opts.short != null) b.write(String(opts.short).slice(0, 17), 14, 'latin1');
  if (opts.long  != null) b.write(String(opts.long).slice(0, 63),  32, 'latin1');
  return b;
}
// The whole 15-bit port-address split the way ArtAddress wants it.
export function uniParts(uni) {
  return { net: (uni >> 8) & 0x7f, sub: (uni >> 4) & 0x0f, swOut: uni & 0x0f };
}
export function parsePollReply(p) {
  if (p.length < 200 || p.toString('latin1', 0, 8) !== ID) return null;
  return { ip: `${p[10]}.${p[11]}.${p[12]}.${p[13]}`,
           short: p.toString('latin1', 26, 44).replace(/\0.*$/, ''),
           long: p.toString('latin1', 44, 108).replace(/\0.*$/, ''),
           // The 15-bit port-address this reply's port carries, split across three fields.
           netSwitch: p[18] & 0x7f, subSwitch: p[19] & 0x0f,
           bindIndex: p.length > 211 ? p[211] : 0,
           universe: ((p[18] & 0x7f) << 8) | ((p[19] & 0x0f) << 4) | (p[190] & 0x0f),
           numPorts: p.readUInt16BE(172),
           portTypes: [...p.slice(174, 178)], swOut: [...p.slice(190, 194)],
           status1: p[23], goodOutput: [...p.slice(182, 186)], goodOutputB: p.length > 213 ? p[213] : 0,
           status3: p.length > 217 ? p[217] : 0, bqPolicy: p.length > 228 ? p[228] : null,
           // RefreshRate = fields 51/52 of ArtPollReply, big-endian, in Hz.
           refreshRate: p.length > 227 ? p.readUInt16BE(226) : null,
           // GoodOutputB bit6: set = continuous output style, clear = delta (frame triggered by ArtDmx).
           outputStyle: p.length > 213 ? ((p[213] & 0x40) ? 'continuous' : 'delta') : null,
           // Status3 bits 7-6: 0 = hold last state, 1 = outputs to zero, 2 = to full, 3 = failsafe scene.
           failsafe: p.length > 217 ? ((p[217] >> 6) & 0x03) : null };
}

// ---- transport ----
export class ArtRdmClient {
  constructor(host, myUid = [0x7ff0, 1]) {
    this.host = host; this.myUid = myUid; this.tn = 1;
    this.sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.pending = [];
    this.sock.on('message', (msg) => { for (const cb of this.pending) cb(msg); });
    this.ready = new Promise((res) => this.sock.bind(ART_PORT, () => { try { this.sock.setBroadcast(true); } catch {} res(); }));
  }
  async close() { this.sock.close(); }
  _send(buf) { return new Promise((r) => this.sock.send(buf, ART_PORT, this.host, () => r())); }
  // Wait up to `ms` for a datagram whose opcode == op (and optional predicate).
  _recv(op, ms, pred) {
    return new Promise((resolve) => {
      const cb = (msg) => {
        if (msg.length >= 10 && msg.toString('latin1', 0, 8) === ID && msg.readUInt16LE(8) === op && (!pred || pred(msg))) {
          this.pending = this.pending.filter((x) => x !== cb); clearTimeout(t); resolve(msg);
        }
      };
      this.pending.push(cb);
      const t = setTimeout(() => { this.pending = this.pending.filter((x) => x !== cb); resolve(null); }, ms);
    });
  }
  async poll(ms = 2000) { await this._send(buildArtPoll()); const m = await this._recv(OP_POLLREPLY, ms); return m && parsePollReply(m); }
  // Every ArtPollReply the node sends for one ArtPoll: it emits one per enabled output, each with
  // its own BindIndex and port-address, so a single poll() only ever shows you output A.
  async pollAll(ms = 1200) { await this._send(buildArtPoll()); return this._collect(OP_POLLREPLY, ms); }
  // Same, but for the reply burst an ArtAddress triggers.
  async addressAll(bindIndex, cmd, opts = {}, ms = 1200) {
    await this._send(buildArtAddress(bindIndex, cmd, opts));
    return this._collect(OP_POLLREPLY, ms);
  }
  // Gather every matching datagram for `ms` instead of resolving on the first one. Filtered to the
  // device under test: any other Art-Net node on the LAN answers a poll too.
  _collect(op, ms) {
    return new Promise((resolve) => {
      const out = [];
      const cb = (msg) => {
        if (msg.length >= 10 && msg.toString('latin1', 0, 8) === ID && msg.readUInt16LE(8) === op) {
          const r = parsePollReply(msg); if (r && r.ip === this.host) out.push(r);
        }
      };
      this.pending.push(cb);
      setTimeout(() => { this.pending = this.pending.filter((x) => x !== cb); resolve(out); }, ms);
    });
  }
  async todRequest(pa, ms = 3000) { await this._send(buildTodRequest(pa)); const m = await this._recv(OP_TODDATA, ms); return m && parseTodData(m); }
  async todFlush(pa) { await this._send(buildTodControl(pa, true)); }
  // ArtAddress remote port config (merge mode, BackgroundQueuePolicy, ...). Answered by ArtPollReply.
  async address(bindIndex, cmd, ms = 2000) {
    await this._send(buildArtAddress(bindIndex, cmd));
    const m = await this._recv(OP_POLLREPLY, ms); return m && parsePollReply(m);
  }
  async rdm(pa, dest, cc, pid, pd = Buffer.alloc(0), retries = 2, ms = 2500) {
    for (let a = 0; a <= retries; a++) {
      this.tn = (this.tn % 255) + 1;
      await this._send(buildArtRdm(pa, buildRdm(dest, this.myUid, cc, pid, pd, this.tn)));
      const start = Date.now();
      while (Date.now() - start < ms) {
        const m = await this._recv(OP_RDM, ms - (Date.now() - start));
        if (!m) break;
        const r = parseArtRdm(m);
        if (r && !r.badChecksum && r.pid === pid && r.src[0] === dest[0] && r.src[1] === dest[1]) return r;
      }
    }
    return null;
  }
  async deviceInfo(pa, uid) {
    const r = await this.rdm(pa, uid, CC_GET, PID_DEVICE_INFO);
    if (!r || r.respType !== 0 || r.pd.length < 19) return null;
    const d = r.pd;
    return { model: d.readUInt16BE(2), footprint: d.readUInt16BE(10),
             persCur: d[12], persCount: d[13], dmxAddr: d.readUInt16BE(14), sensorCount: d[18] };
  }
  async setDmxAddress(pa, uid, addr) {
    const pd = Buffer.alloc(2); pd.writeUInt16BE(addr, 0);
    const r = await this.rdm(pa, uid, CC_SET, PID_DMX_START_ADDRESS, pd);
    return !!(r && r.respType === 0);
  }
}
