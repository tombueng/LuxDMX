// Drive a WS281x MATRIX over real Art-Net, with the power budget as a first-class input.
//
// The ring player next door draws against concentric rings; a matrix wants x/y, and the two
// look like noise in each other's geometry. This one also carries something the ring never
// needed: a current model. A 16x16 on a 1 A USB supply has almost no light budget, and the
// honest way to handle that is to compute what a frame costs and scale it down BEFORE it
// leaves the host, rather than letting the strip brown out the board it is plugged into.
//
//   mA = count * quiescent + sum(all channel bytes) / 255 * mAPerChannel
//
// Same two terms the firmware uses. The second one is the one every online calculator has;
// the first is the one they forget, and at 256 pixels it is 256 mA before anything lights up.
// So the budget below is what is left for LIGHT after the idle draw, and the frame is scaled
// to fit it. Effects that light a few pixels brightly therefore look bright; a full-field
// wash comes out dim, which is exactly the physics.
//
// Universe mapping matches the firmware's ALIGNED mode: whole pixels only, 170 RGB pixels per
// universe, so a 256-pixel port is universe U (pixels 0..169) and U+1 (pixels 170..255).
//
// Usage: node docs/tests/tools/pixel_matrix.mjs <host> [universe] [WxH] [budget-mA] [sec/effect]
//        node docs/tests/tools/pixel_matrix.mjs 192.168.178.59 3 16x16 250 12
import dgram from 'node:dgram';
import { artDmxPacket } from '../lib/net.mjs';

const HOST   = process.argv[2] || 'dmx-gateway.local';
const UNI0   = Number(process.argv[3] ?? 3);
const [W, H] = (process.argv[4] || '16x16').split('x').map(Number);
const BUDGET = Number(process.argv[5] ?? 250);      // mA available for LIGHT, idle excluded
const SECS   = Number(process.argv[6] ?? 12);
const SERPENTINE = process.env.PIX_LAYOUT !== 'progressive';
const FPS = 40;

const N = W * H;
const MA_PER_CH = 20.0;      // one WS2812B channel at 255
const MA_IDLE   = 1.0;       // per pixel, dark but powered
const PER_UNI   = 170;       // RGB pixels per universe in aligned mode

const sock = dgram.createSocket('udp4');
const fb = new Uint8Array(N * 3);

// Matrix index for (x, y). Cheap 16x16 panels are almost always serpentine: row 0 runs left
// to right, row 1 right to left. Getting this wrong makes every effect look like it is being
// torn in half, which is why it is a switch and not an assumption.
function idx(x, y) {
  const row = SERPENTINE && (y & 1) ? (W - 1 - x) : x;
  return y * W + row;
}
function put(x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = idx(x, y) * 3;
  fb[i] = r; fb[i + 1] = g; fb[i + 2] = b;
}
function hsv(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i % 6];
  return [r * 255 | 0, g * 255 | 0, b * 255 | 0];
}

// ── effects ────────────────────────────────────────────────────────────────
const FX = [
  ['Comet', (t) => {                       // sparse and bright: cheap in current
    const cx = (W - 1) / 2 + Math.cos(t * 1.1) * (W / 2 - 1.2);
    const cy = (H - 1) / 2 + Math.sin(t * 1.7) * (H / 2 - 1.2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const v = Math.max(0, 1 - d / 3.2) ** 2;
      if (v > 0.004) { const [r, g, b] = hsv(t * 0.09, 0.85, v); put(x, y, r, g, b); }
    }
  }],
  ['Rings', (t) => {                       // expanding circles from the centre
    const cx = (W - 1) / 2, cy = (H - 1) / 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const v = Math.max(0, Math.cos((d - t * 4.0) * 0.9)) ** 6;
      if (v > 0.004) { const [r, g, b] = hsv(0.55 + d * 0.02, 0.9, v); put(x, y, r, g, b); }
    }
  }],
  ['Rain', (t, st) => {                    // sparse drops, the cheapest thing that still reads
    st.drops ??= [];
    if (st.drops.length < 14 && Math.random() < 0.5)
      st.drops.push({ x: Math.random() * W | 0, y: -1, v: 6 + Math.random() * 10, h: Math.random() });
    for (const d of st.drops) d.y += d.v / FPS;
    st.drops = st.drops.filter((d) => d.y < H + 4);
    for (const d of st.drops) for (let k = 0; k < 5; k++) {
      const yy = Math.round(d.y - k);
      const [r, g, b] = hsv(d.h, 0.7, (1 - k / 5) ** 2);
      put(d.x, yy, r, g, b);
    }
  }],
  ['Plasma', (t) => {                      // full field: the budget will pull this right down
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = (Math.sin(x * 0.5 + t * 1.7) + Math.sin(y * 0.45 - t * 1.3)
               + Math.sin((x + y) * 0.34 + t * 0.9)) / 3;
      const [r, g, b] = hsv(0.5 + v * 0.35 + t * 0.05, 0.85, 0.35 + v * 0.3);
      put(x, y, r, g, b);
    }
  }],
  ['Scanner', (t) => {                     // one bright column sweeping, very cheap
    const cx = (W - 1) / 2 + Math.sin(t * 2.2) * (W - 1) / 2;
    for (let x = 0; x < W; x++) {
      const v = Math.max(0, 1 - Math.abs(x - cx) / 2.0) ** 2;
      if (v <= 0.004) continue;
      for (let y = 0; y < H; y++) {
        const [r, g, b] = hsv(0.0 + y * 0.006, 0.9, v * (0.55 + 0.45 * Math.sin(y * 0.4 - t * 3)));
        put(x, y, r, g, b);
      }
    }
  }],
  ['Plasma cloud', (t) => {
    // Only the peaks. The first version washed the whole panel and the budget then scaled it
    // to 35 %, which on 256 pixels is fog. So the field is computed, a cut is taken so that
    // roughly TARGET pixels survive, and only those are drawn - bright, on black. At 250 mA
    // the panel can afford about a dozen pixels at full colour, and that is the whole design
    // constraint: contrast is the only currency, brightness is not available.
    const TARGET = 26;
    const val = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = Math.sin(x * 0.31 + t * 0.53) * Math.cos(y * 0.27 - t * 0.41);
      const b = Math.sin((x + y) * 0.19 - t * 0.77);
      const c = Math.sin(Math.hypot(x - W / 2 + Math.sin(t * 0.3) * 3,
                                    y - H / 2 + Math.cos(t * 0.4) * 3) * 0.42 + t * 0.6);
      val[y * W + x] = (a + b * 0.7 + c * 0.9) / 2.6;
    }
    const sorted = Float32Array.from(val).sort();
    const cut = sorted[Math.max(0, N - TARGET)];
    const span = Math.max(0.05, sorted[N - 1] - cut);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = (val[y * W + x] - cut) / span;
      if (v <= 0) continue;
      const [r, g, b] = hsv(0.58 + v * 0.16 + t * 0.02, 0.85 - v * 0.5, 0.25 + v * 0.75);
      put(x, y, r, g, b);
    }
  }],
  ['Volcano', (t, st) => {
    // A fountain, not a fire field. The Doom-style version lit half the panel at mid heat and
    // came out at 11 % after scaling - all of it dim. This one keeps maybe twenty pixels lit
    // and lets them be properly bright: a small glowing crater, lava thrown up on ballistic
    // arcs, and black everywhere else.
    st.blobs ??= []; st.next ??= 0;
    const cx = (W - 1) / 2;
    const erupting = t < st.next && (st.next - t) > 1.4;
    if (t > st.next) { st.next = t + 3.2 + Math.random() * 3.0; }
    // crater: three columns on the bottom row, breathing
    const glow = 0.55 + 0.45 * Math.sin(t * 3.1);
    for (let dx = -1; dx <= 1; dx++) {
      const v = (dx === 0 ? 1.0 : 0.55) * (erupting ? 1.0 : glow);
      put(Math.round(cx + dx), H - 1, 255 * v | 0, 70 * v | 0, 0);
    }
    // launch lava
    const rate = erupting ? 0.9 : 0.30;
    if (st.blobs.length < 22 && Math.random() < rate)
      st.blobs.push({ x: cx + (Math.random() - 0.5) * 1.6, y: H - 1,
                      vx: (Math.random() - 0.5) * 5.5,
                      vy: -(9 + Math.random() * (erupting ? 12 : 6)), life: 1 });
    for (const b of st.blobs) {
      b.x += b.vx / FPS; b.y += b.vy / FPS; b.vy += 16 / FPS; b.life -= 0.55 / FPS;
    }
    st.blobs = st.blobs.filter((b) => b.life > 0 && b.y < H + 1);
    for (const b of st.blobs) {
      const v = Math.max(0, Math.min(1, b.life));
      // white-hot at launch, orange, then deep red as it falls and cools
      const r = 255, g = (200 * v * v) | 0, bl = (110 * v * v * v * v) | 0;
      put(Math.round(b.x), Math.round(b.y), r, g, bl);
    }
  }],
];

// ── power ──────────────────────────────────────────────────────────────────
function scaleToBudget() {
  let sum = 0, lit = 0;
  for (let i = 0; i < fb.length; i += 3)
    if (fb[i] || fb[i + 1] || fb[i + 2]) lit++;
  for (let i = 0; i < fb.length; i++) sum += fb[i];
  const mA = (sum / 255) * MA_PER_CH;
  if (mA <= BUDGET || mA === 0) return { lit, mA, k: 1 };
  const k = BUDGET / mA;
  for (let i = 0; i < fb.length; i++) fb[i] = Math.round(fb[i] * k);
  return { lit, mA: BUDGET, k };
}

function send(seq) {
  for (let u = 0, px = 0; px < N; u++) {
    const take = Math.min(PER_UNI, N - px);
    const slice = Buffer.from(fb.buffer, px * 3, take * 3);
    sock.send(artDmxPacket(UNI0 + u, slice, seq), 6454, HOST);
    px += take;
  }
}

const idle = (N * MA_IDLE) | 0;
console.log(`${W}x${H} = ${N} pixels on universe ${UNI0}..${UNI0 + Math.ceil(N / PER_UNI) - 1}`);
console.log(`Layout ${SERPENTINE ? 'serpentine' : 'progressive'}, ${FPS} fps -> ${HOST}`);
console.log(`Idle draw ${idle} mA (dark), light budget ${BUDGET} mA, together ~${idle + BUDGET} mA\n`);

let seq = 0, fx = 0, t0 = Date.now(), st = {};
const timer = setInterval(() => {
  const now = Date.now();
  if ((now - t0) / 1000 >= SECS) { fx = (fx + 1) % FX.length; t0 = now; st = {}; }
  fb.fill(0);
  FX[fx][1]((now / 1000) % 10000, st);
  const { lit, mA, k } = scaleToBudget();
  send(seq = (seq + 1) & 0xff);
  if (seq % 40 === 0)
    process.stdout.write(`\r  ${FX[fx][0].padEnd(12)} ${String(lit).padStart(3)} pixels lit,`
      + ` light ~${mA.toFixed(0).padStart(3)} mA (dimmed to ${(k * 100).toFixed(0)}%),`
      + ` total ~${(idle + mA).toFixed(0)} mA   `);
}, 1000 / FPS);

for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => {
  clearInterval(timer); fb.fill(0); send(++seq);
  setTimeout(() => { console.log('\nOff.'); sock.close(); process.exit(0); }, 120);
});
