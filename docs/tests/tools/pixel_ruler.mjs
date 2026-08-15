// Put a ruler on the strip: blocks of ten in distinct colours, so the pixel COUNT can be read
// off in one look instead of counted off a chase. The last lit colour gives the block, the
// number of LEDs lit in it gives the remainder, and the two together are the exact count.
import dgram from 'node:dgram';
import { artDmxPacket } from '../lib/net.mjs';

const HOST = process.argv[2] || 'dmx-gateway.local';
const UNI  = Number(process.argv[3] || 0);
const MAX  = Number(process.argv[4] || 60);
const SECS = Number(process.argv[5] || 40);

const BLOCKS = [['rot',[255,0,0]], ['gruen',[0,255,0]], ['blau',[0,0,255]],
                ['gelb',[255,200,0]], ['tuerkis',[0,255,255]], ['magenta',[255,0,255]]];

const d = Buffer.alloc(512);
for (let i = 0; i < MAX && i * 3 + 2 < 512; i++) {
  const [, c] = BLOCKS[Math.floor(i / 10) % BLOCKS.length];
  // Every block's FIRST pixel is white, so block boundaries are unmistakable.
  const px = (i % 10 === 0) ? [255, 255, 255] : c;
  d[i * 3] = px[0]; d[i * 3 + 1] = px[1]; d[i * 3 + 2] = px[2];
}

console.log('Blockfarben, je 10 Pixel, erstes Pixel jedes Blocks weiss:');
BLOCKS.forEach(([n], i) => { if (i * 10 < MAX) console.log(`   ${String(i*10).padStart(2)}..${Math.min(i*10+9, MAX-1)}  ${n}`); });

const sock = dgram.createSocket('udp4');
let seq = 0;
const until = Date.now() + SECS * 1000;
while (Date.now() < until) {
  await new Promise((r) => sock.send(artDmxPacket(UNI, d, (seq = (seq % 255) + 1)), 6454, HOST, r));
  await new Promise((r) => setTimeout(r, 25));
}
sock.close();
console.log(`${SECS}s gehalten.`);
