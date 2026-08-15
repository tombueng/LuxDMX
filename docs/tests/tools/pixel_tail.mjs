// Walk one lit pixel through the tail of a strip, slowly, so the LAST physical LED can be
// identified by watching rather than counted. The step number at which the last LED lights
// gives the exact pixel count, which is the one number the whole power/universe maths needs.
import dgram from 'node:dgram';
import { artDmxPacket } from '../lib/net.mjs';

const HOST = process.argv[2] || 'dmx-gateway.local';
const UNI  = Number(process.argv[3] || 0);
const FROM = Number(process.argv[4] || 40);
const TO   = Number(process.argv[5] || 59);
const HOLD = Number(process.argv[6] || 1800);

const sock = dgram.createSocket('udp4');
let seq = 0;
const frame = (idx) => {
  const d = Buffer.alloc(512);
  if (idx * 3 + 2 < 512) { d[idx*3] = 255; d[idx*3+1] = 255; d[idx*3+2] = 255; }
  return d;
};
for (let i = FROM; i <= TO; i++) {
  console.log(`  Schritt ${i - FROM + 1}: Pixel-Index ${i}`);
  const until = Date.now() + HOLD;
  while (Date.now() < until) {
    await new Promise((r) => sock.send(artDmxPacket(UNI, frame(i), (seq = (seq % 255) + 1)), 6454, HOST, r));
    await new Promise((r) => setTimeout(r, 25));
  }
}
sock.close();
console.log('durch.');
