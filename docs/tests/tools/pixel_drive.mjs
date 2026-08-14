// Drive the pixel ports with real Art-Net and report what the device says came out.
//
// The point is to prove the whole chain on hardware -- socket -> universe mapping -> port
// framebuffer -> the output backend's DMA -- rather than just that the config stuck. A
// backend that reports itself as up but never clocks a frame looks identical in /pixels.json
// until you watch outFps.
//
// Usage: node docs/tests/tools/pixel_drive.mjs <host> [universes] [seconds]
import dgram from 'node:dgram';
import { artDmxPacket } from '../lib/net.mjs';

const HOST = process.argv[2] || 'dmx-gateway.local';
const UNIS = Number(process.argv[3] || 5);
const SECS = Number(process.argv[4] || 6);

const sock = dgram.createSocket('udp4');
const seq = new Array(UNIS).fill(0);

// A moving ramp rather than a constant: a stuck framebuffer and a live one both look "lit"
// if every channel holds the same value forever.
function frame(uni, t) {
  const d = Buffer.alloc(512);
  for (let i = 0; i < 512; i++) d[i] = (i + t * 8 + uni * 40) & 0xff;
  return d;
}

const before = await fetch(`http://${HOST}/pixels.json`).then((r) => r.json());
console.log('vorher :', before.ports.filter((p) => p.en)
  .map((p) => `P${p.idx + 1} in=${p.inFps} out=${p.outFps}`).join('  '));

const t0 = Date.now();
let sent = 0;
const timer = setInterval(() => {
  const t = Math.floor((Date.now() - t0) / 25);
  for (let u = 0; u < UNIS; u++) {
    seq[u] = (seq[u] % 255) + 1;
    sock.send(artDmxPacket(u, frame(u, t), seq[u]), 6454, HOST);
    sent++;
  }
}, 25);

await new Promise((r) => setTimeout(r, SECS * 1000));
clearInterval(timer);

const after = await fetch(`http://${HOST}/pixels.json`).then((r) => r.json());
console.log(`gesendet: ${sent} ArtDMX-Pakete auf ${UNIS} Universen in ${SECS}s`);
console.log('backend :', after.backend, ' Gesamtstrom:', after.ma, 'mA (worst', after.worstMa, 'mA)');
for (const p of after.ports.filter((q) => q.en))
  console.log(`  Port ${p.idx + 1}: in=${p.inFps} out=${p.outFps} latches=${p.latches} `
            + `partials=${p.partials} lost=${p.lost} ma=${p.ma}`);
sock.close();
