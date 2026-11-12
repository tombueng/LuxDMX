// ArduinoOTA's login, without uploading anything: the invitation espota.py sends, and its answer
// to the box's challenge (core 3.3.1+: PBKDF2-HMAC-SHA256 over the password's SHA-256; older:
// MD5). Tells whether the box asks for a password and whether one is taken. After a login that's
// taken the box tries to fetch the firmware from a port nobody listens on, gives up and carries on.
import dgram from 'node:dgram';
import crypto from 'node:crypto';

const h = (alg, s) => crypto.createHash(alg).update(s).digest('hex');

// Only the invitation: the box's answer ('OK', 'AUTH <nonce>') or null, and the login left
// unanswered (ArduinoOTA then waits for it; the next packet of any kind ends that)
export async function otaInvite(host, port = 3232) {
  const sock = dgram.createSocket('udp4');
  await new Promise((r) => sock.bind(0, r));
  try {
    const got = new Promise((res) => { const t = setTimeout(() => res(null), 2000); sock.once('message', (m) => { clearTimeout(t); res(m.toString().trim()); }); });
    sock.send(`0 ${sock.address().port + 1} 1 ${h('md5', 'x')}\n`, port, host);
    return await got;
  } finally { sock.close(); }
}

// 'open' (no password asked), 'ok' (this one taken) or 'refused'
export async function otaLogin(host, password, port = 3232) {
  const sock = dgram.createSocket('udp4');
  await new Promise((r) => sock.bind(0, r));
  const answer = () => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('no answer from the box')), 10000);
    sock.once('message', (m) => { clearTimeout(t); res(m.toString().trim()); });
  });
  try {
    const size = 1, md5 = h('md5', 'x');
    // (the port the box would fetch the firmware from: one nobody listens on)
    sock.send(`0 ${sock.address().port + 1} ${size} ${md5}\n`, port, host);
    const inv = await answer();
    if (inv === 'OK') return 'open';
    if (!inv.startsWith('AUTH ')) throw new Error(`unexpected answer: ${inv}`);
    const nonce = inv.split(' ')[1], cnonceText = `probe.bin${size}${md5}${host}`;
    let cnonce, response;
    if (nonce.length === 32) {                       // (the old MD5 protocol)
      cnonce = h('md5', cnonceText);
      response = h('md5', `${h('md5', password)}:${nonce}:${cnonce}`);
    } else {
      cnonce = h('sha256', cnonceText);
      const key = crypto.pbkdf2Sync(h('sha256', password), `${nonce}:${cnonce}`, 10000, 32, 'sha256').toString('hex');
      response = h('sha256', `${key}:${nonce}:${cnonce}`);
    }
    sock.send(`200 ${cnonce} ${response}\n`, port, host);
    return (await answer()) === 'OK' ? 'ok' : 'refused';
  } finally { sock.close(); }
}
