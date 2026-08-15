// An effect player that drives a pixel port over real Art-Net.
//
// Deliberately a HOST-side generator, not firmware. A gateway's job is to put what it is sent
// on the wire; effects belong in whatever is feeding it. So this is also a decent load test:
// 40 fps of genuinely changing content is what a console looks like, and "the same few LEDs
// glitch" shows up here far more honestly than on a static frame.
//
// The disc geometry matters. A ring layout drawn as if it were a straight strip looks like
// noise, so the effects are written against RINGS: concentric circles, each with its own pixel
// count, plus a centre LED. Default is the 47-LED disc on the bench (24 + 16 + 6 + 1).
//
// Usage: node docs/tests/tools/pixel_fx.mjs <host> [universe] [rings] [seconds-per-effect]
//        node docs/tests/tools/pixel_fx.mjs dmx-gateway.local 0 24,16,6,1 12
import dgram from 'node:dgram';
import { artDmxPacket } from '../lib/net.mjs';

const HOST  = process.argv[2] || 'dmx-gateway.local';
const UNI   = Number(process.argv[3] || 0);
const RINGS = (process.argv[4] || '24,16,6,1').split(',').map(Number);
const SECS  = Number(process.argv[5] || 12);
const FPS   = 40;

const COUNT = RINGS.reduce((a, b) => a + b, 0);
// Index ranges per ring, outermost first, so an effect can address "the third ring" directly.
const RING = [];
{
  let at = 0;
  for (const n of RINGS) { RING.push({ start: at, n }); at += n; }
}
const CENTRE = COUNT - 1;

// --- colour -----------------------------------------------------------------
// h in turns (0..1, wraps), s and v in 0..1. Turns rather than degrees because every effect
// here works in fractions of a circle anyway.
function hsv(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// A frame is an array of [r,g,b] per pixel.
const black = () => Array.from({ length: COUNT }, () => [0, 0, 0]);
const add = (px, [r, g, b]) => { px[0] = Math.min(255, px[0] + r); px[1] = Math.min(255, px[1] + g); px[2] = Math.min(255, px[2] + b); };

// --- effects ----------------------------------------------------------------
// Each takes the frame time t in seconds and returns a frame. Keep them cheap: this runs 40
// times a second and the interesting part is on the other end of the wire.

// Every ring is its own rainbow, and they turn at different speeds and directions. The shear
// between neighbouring rings is what makes a disc look alive rather than like a colour wheel.
function rainbowSpin(t) {
  const px = black();
  RING.forEach((ring, ri) => {
    const dir = ri % 2 ? -1 : 1;
    const speed = 0.12 + ri * 0.05;
    for (let i = 0; i < ring.n; i++) {
      const angle = ring.n > 1 ? i / ring.n : 0;
      px[ring.start + i] = hsv(angle * dir + t * speed, 1, 1);
    }
  });
  return px;
}

// A comet on every ring, each a little behind the one outside it, so the head spirals inward.
// The tail is an exponential decay rather than a hard length: that reads as motion blur.
function cometSpiral(t) {
  const px = black();
  RING.forEach((ring, ri) => {
    if (ring.n === 1) { px[ring.start] = hsv(t * 0.2, 0.6, 0.35 + 0.35 * Math.sin(t * 4)); return; }
    const head = (t * (0.55 + ri * 0.12)) % 1;
    const hue  = t * 0.08 + ri * 0.06;
    for (let i = 0; i < ring.n; i++) {
      let d = (i / ring.n) - head;
      d = ((d % 1) + 1) % 1;                       // distance BEHIND the head, 0..1
      const v = Math.pow(1 - d, 14);               // steep tail
      if (v > 0.004) px[ring.start + i] = hsv(hue, 0.85, v);
    }
  });
  return px;
}

// Pulses leaving the centre. Each ring lights when the wavefront passes its radius, so the
// disc reads as water rather than as four independent circles.
function ripple(t) {
  const px = black();
  const period = 1.6;
  for (let wave = 0; wave < 3; wave++) {
    const age = (t - wave * (period / 3)) % period;
    if (age < 0) continue;
    const front = age / period;                    // 0 = centre, 1 = outer edge
    const hue = 0.55 + wave * 0.12;
    RING.forEach((ring, ri) => {
      const radius = 1 - ri / Math.max(1, RING.length - 1);   // outer ring = 1
      const v = Math.max(0, 1 - Math.abs(radius - front) * 6) * (1 - front * 0.5);
      if (v <= 0.01) return;
      for (let i = 0; i < ring.n; i++) add(px[ring.start + i], hsv(hue, 0.7, v));
    });
  }
  return px;
}

// Two counter-rotating hands, like a clock that has given up. Where they cross, the colours
// add and the pixel goes white, which is the whole point of the effect.
function crossingHands(t) {
  const px = black();
  const hands = [{ speed: 0.35, hue: 0.0 }, { speed: -0.22, hue: 0.45 }];
  for (const h of hands) {
    const a = (t * h.speed) % 1;
    RING.forEach((ring) => {
      if (ring.n === 1) return;
      for (let i = 0; i < ring.n; i++) {
        let d = Math.abs((i / ring.n) - ((a % 1) + 1) % 1);
        d = Math.min(d, 1 - d);                    // shortest way round
        const v = Math.max(0, 1 - d * ring.n * 0.55);
        if (v > 0.02) add(px[ring.start + i], hsv(h.hue, 0.9, v * v));
      }
    });
  }
  px[CENTRE] = hsv(t * 0.1, 0.3, 0.5);
  return px;
}

// Fire, seen from above: hot in the middle, licking outwards, never quite the same twice.
// Deterministic noise (sines at incommensurable frequencies) so it does not need a PRNG.
function fire(t) {
  const px = black();
  RING.forEach((ring, ri) => {
    const radius = ri / Math.max(1, RING.length - 1);        // 0 = outer, 1 = centre
    for (let i = 0; i < ring.n; i++) {
      const a = ring.n > 1 ? i / ring.n : 0;
      const n = 0.5 + 0.5 * Math.sin(a * 12.9 + t * 3.1)
                    * Math.sin(a * 7.3 - t * 2.3 + ri)
                    * Math.sin(t * 1.7 + ri * 2.1);
      const heat = Math.max(0, Math.min(1, n * (0.35 + radius * 0.8)));
      // Black-body-ish ramp: red -> orange -> yellow, white only at the very top.
      px[ring.start + i] = hsv(0.02 + heat * 0.10, 1 - Math.pow(heat, 3) * 0.7, Math.pow(heat, 1.6));
    }
  });
  return px;
}

// Sparkle over a dim base. Individual pixels flash and decay; the base keeps the disc from
// looking broken between flashes.
const sparkleState = new Float32Array(COUNT);
function sparkle(t) {
  const px = black();
  for (let i = 0; i < COUNT; i++) {
    sparkleState[i] *= 0.86;
    // Deterministic "randomness": a hash of index and time bucket.
    const r = Math.abs(Math.sin(i * 12.9898 + Math.floor(t * FPS) * 78.233) * 43758.5453) % 1;
    if (r > 0.985) sparkleState[i] = 1;
    const base = 0.06 + 0.04 * Math.sin(t * 1.2 + i * 0.3);
    px[i] = hsv(0.58 + 0.1 * Math.sin(t * 0.3), 0.55 - sparkleState[i] * 0.5,
                Math.min(1, base + sparkleState[i]));
  }
  return px;
}

// The classic theatre chase, one lit pixel in every three, marching. Included because it is
// the effect everyone recognises and it makes timing glitches obvious: a dropped frame in a
// hard-edged pattern is visible in a way a smooth gradient hides.
function theatreChase(t) {
  const px = black();
  const step = Math.floor(t * 12);
  const hue = t * 0.05;
  RING.forEach((ring) => {
    for (let i = 0; i < ring.n; i++)
      if ((i + step) % 3 === 0) px[ring.start + i] = hsv(hue, 0.8, 0.9);
  });
  return px;
}

const EFFECTS = [
  ['Rainbow-Spin (Ringe gegenlaeufig)', rainbowSpin],
  ['Komet, spiralt nach innen',         cometSpiral],
  ['Ripple aus der Mitte',              ripple],
  ['Zwei kreuzende Zeiger',             crossingHands],
  ['Feuer von oben',                    fire],
  ['Funkeln',                           sparkle],
  ['Theatre-Chase',                     theatreChase],
];

// --- transport ---------------------------------------------------------------
const sock = dgram.createSocket('udp4');
let seq = 0;
function send(px) {
  const d = Buffer.alloc(512);
  for (let i = 0; i < COUNT && i * 3 + 2 < 512; i++) {
    d[i * 3] = px[i][0]; d[i * 3 + 1] = px[i][1]; d[i * 3 + 2] = px[i][2];
  }
  return new Promise((r) => sock.send(artDmxPacket(UNI, d, (seq = (seq % 255) + 1)), 6454, HOST, r));
}

console.log(`${COUNT} Pixel in ${RINGS.length} Ringen (${RINGS.join(' + ')}), Universum ${UNI} -> ${HOST}`);
const t0 = Date.now();
for (const [name, fx] of EFFECTS) {
  console.log(`  ${name}`);
  const until = Date.now() + SECS * 1000;
  while (Date.now() < until) {
    await send(fx((Date.now() - t0) / 1000));
    await new Promise((r) => setTimeout(r, 1000 / FPS));
  }
}
await send(black());
sock.close();
