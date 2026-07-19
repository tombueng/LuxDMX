// A truncated firmware upload must FAIL, loudly, and must not reboot you.
//
// POST /ota/upload streams straight into flash. The handler used to discard every return
// value (Update.begin / write / end), and an upload that stops mid-stream never delivers
// the multipart `final` chunk -- so Update.end() was never reached and Update.hasError()
// stayed false, because a partial image isn't an error, it's just incomplete. The handler
// then rendered "Firmware updated" and scheduled a reboot, and the box came back on the
// OLD image. Seen in the wild: 2 of 4 real uploads cut off at 8-20%, every one reported
// success. Nothing bricked only because the boot partition was never switched, which is
// one bug away from a success page over a dead device.
//
// Reproduced deterministically here by sending a multipart body with an exact
// Content-Length whose closing boundary is missing: the server reads every declared byte,
// so the request completes cleanly and can still answer, but the upload handler never gets
// its `final` chunk. Measured against the buggy firmware (1.0.194) that yields:
//
//     no closing boundary (truncated)    status=200  page="Firmware updated"   <-- the bug
//     closing boundary (complete)        status=200  page="Update failed"      <-- correct
//
// Destructive by nature (it writes the device's OTA slot), so it needs LUXDMX_WRITE=1. It
// never completes a valid upload, so the running firmware is never replaced.
//
// Run:  LUXDMX_WRITE=1 LUXDMX_URL=http://<ip> node docs/tests/ota-upload-truncated.mjs
import net from 'node:net';

const URL_BASE = process.env.LUXDMX_URL || 'http://dmx-gateway.local';
const HOST = new URL(URL_BASE).hostname;
const PORT = Number(new URL(URL_BASE).port || 80);
const BOUNDARY = '----luxdmxTruncTest';

function check(name, cond) { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); return cond ? 0 : 1; }
const getJson = async (p) => (await fetch(`${URL_BASE}${p}`, { signal: AbortSignal.timeout(4000) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Post a multipart upload. `closeBoundary:false` omits the terminating boundary, which is
// what a stream that died mid-transfer looks like to the upload handler.
function upload({ closeBoundary, bytes = 32768, magic = 0xe9 }) {
  return new Promise((resolve) => {
    const head = Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="update"; filename="firmware.bin"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`);
    const payload = Buffer.alloc(bytes, 0x5a);
    payload[0] = magic;                                   // ESP32 app images start with 0xE9
    const tail = closeBoundary ? Buffer.from(`\r\n--${BOUNDARY}--\r\n`) : Buffer.alloc(0);
    const body = Buffer.concat([head, payload, tail]);
    const sock = net.connect(PORT, HOST, () => {
      sock.write(`POST /ota/upload HTTP/1.1\r\nHost: ${HOST}\r\n` +
        `Content-Type: multipart/form-data; boundary=${BOUNDARY}\r\n` +
        `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n`);
      sock.write(body);
    });
    let raw = '';
    sock.setTimeout(25000, () => sock.destroy());
    sock.on('data', (d) => { raw += d.toString('latin1'); });
    const done = () => resolve({
      status: (raw.match(/^HTTP\/1\.[01] (\d{3})/) || [])[1] || null,
      claimedSuccess: /Firmware updated/.test(raw),
      claimedFailure: /Update failed/.test(raw),
      raw,
    });
    sock.on('close', done);
    sock.on('error', done);
  });
}

// A failed upload must not reboot the device. On the buggy firmware it scheduled one 800ms
// later, so the box drops off the network; poll straight through that window.
async function stayedUpFor(ms) {
  const until = Date.now() + ms;
  let misses = 0;
  while (Date.now() < until) {
    try { await getJson('/info.json'); } catch { misses++; }
    await sleep(250);
  }
  return misses;
}

async function waitAlive(timeoutMs = 90000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { return await getJson('/info.json'); } catch { await sleep(2000); }
  }
  return null;
}

if (process.env.LUXDMX_WRITE !== '1') {
  console.log('SKIP  ota-upload-truncated: needs LUXDMX_WRITE=1 (writes the device OTA slot)');
  process.exit(0);
}

let fails = 0;
const before = await getJson('/info.json');
console.log(`  device ${before.hostname} on ${before.version}\n`);

// ---- THE bug: a stream that never finishes must not be called a success ----
const trunc = await upload({ closeBoundary: false });
console.log(`  truncated upload -> status=${trunc.status} success=${trunc.claimedSuccess}`);
fails += check('a truncated upload is NOT reported as "Firmware updated"', !trunc.claimedSuccess);
fails += check('a truncated upload does not answer 200', trunc.status !== '200');
fails += check('a truncated upload says the update failed', trunc.claimedFailure);

// ---- and it must not reboot us over it ------------------------------------
const misses = await stayedUpFor(6000);
fails += check(`device did not reboot after the failed upload (${misses} unreachable polls)`, misses === 0);

// ---- a complete but invalid image is still rejected (was already correct) --
const bad = await upload({ closeBoundary: true });
fails += check('a complete but invalid image is rejected', !bad.claimedSuccess);

// ---- a file that isn't firmware at all ------------------------------------
const junk = await upload({ closeBoundary: true, bytes: 4096, magic: 0x42 });
fails += check('a file that is not an ESP32 image is rejected', !junk.claimedSuccess);

// ---- through all of that, the device kept its firmware and its DMX ---------
const after = await waitAlive();
fails += check('device is still reachable', !!after);
if (after) {
  fails += check(`still running the original firmware (${before.version})`, after.version === before.version);
  fails += check('DMX outputs were not left muted',
    JSON.stringify(after.outputs) === JSON.stringify(before.outputs));
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll truncated-upload checks passed');
process.exit(fails ? 1 : 0);
