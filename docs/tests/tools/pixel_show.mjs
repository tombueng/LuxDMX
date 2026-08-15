// Drive a pixel port with patterns a human can judge at a glance.
//
// Two things are hard to check from JSON and obvious on a strip: whether the colour order is
// right (send pure red and see red), and how many LEDs are actually on the thing (walk one
// pixel along it and count). Everything else the e2e suite already covers.
//
// Usage: node docs/tests/tools/pixel_show.mjs <host> [universe] [count]
import dgram from 'node:dgram';
import { artDmxPacket } from '../lib/net.mjs';

const HOST  = process.argv[2] || 'dmx-gateway.local';
const UNI   = Number(process.argv[3] || 0);
const COUNT = Number(process.argv[4] || 60);
const STEP  = Number(process.argv[5] || 45);   // ms per pixel in the chase; raise it to count along

const sock = dgram.createSocket('udp4');
let seq = 0;
const send = (buf) => new Promise((r) => sock.send(artDmxPacket(UNI, buf, (seq = (seq % 255) + 1)), 6454, HOST, r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A frame is 512 channels; a port takes as many as its pixel count needs, the rest is ignored.
function solid(r, g, b) {
  const d = Buffer.alloc(512);
  for (let i = 0; i < COUNT && i * 3 + 2 < 512; i++) { d[i * 3] = r; d[i * 3 + 1] = g; d[i * 3 + 2] = b; }
  return d;
}
function single(idx, r, g, b) {
  const d = Buffer.alloc(512);
  if (idx * 3 + 2 < 512) { d[idx * 3] = r; d[idx * 3 + 1] = g; d[idx * 3 + 2] = b; }
  return d;
}

// Hold a frame for a while: WS281x has no refresh of its own, but the gateway's latch policy
// and its source-lost timeout both want to see a stream rather than one packet.
async function hold(buf, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { await send(buf); await sleep(25); }
}

console.log(`Ziel ${HOST}, Universum ${UNI}, ${COUNT} Pixel`);
console.log('1) Farbtest: rot, gruen, blau, dann gedimmtes weiss, je 2 s');
for (const [name, c] of [['rot', [255, 0, 0]], ['gruen', [0, 255, 0]], ['blau', [0, 0, 255]], ['weiss (gedimmt)', [60, 60, 60]]]) {
  console.log('   ->', name);
  await hold(solid(...c), 2000);
}

console.log('2) Lauflicht: ein weisses Pixel, zwei Runden - zaehl mit');
for (let lap = 0; lap < 2; lap++)
  for (let i = 0; i < COUNT; i++) { await send(single(i, 120, 120, 120)); await sleep(STEP); }

await hold(solid(0, 0, 0), 300);
sock.close();

const px = await fetch(`http://${HOST}/pixels.json`).then((r) => r.json());
const p = px.ports[0];
console.log(`fertig. in=${p.inFps} out=${p.outFps} latches=${p.latches} partials=${p.partials} ma=${p.ma} scale=${p.scale}/256`);
