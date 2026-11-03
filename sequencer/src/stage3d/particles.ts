// What the effect machines throw into the air, as points with a little physics: confetti that
// flutters down, bubbles that drift and pop, flames, cold sparks, CO2 jets and fog. Each machine
// fires while its channel is up (confetti: one burst per rise of the channel).
//
// Fog, like the real thing: it leaves the nozzle as a hard, narrow jet that brakes within a few
// metres as it pulls air in (and widens as it goes), then it's a cloud. The cloud spreads from
// where it's thick into where it's thin (worked out on a coarse grid over the room, `Air`: so it
// never piles up against the backdrop), rolls in slow swirls, drifts towards the audience with the
// room's air, lies low and rises as it mixes, and spills off the deck's edges. Within 10 to 20 s a
// burst covers the stage; it gets thinner as it spreads, and it's gone 28 to 38 s after it left
// the nozzle, fading out (never popping). A hazer's fine haze is blown out by its fan, rises and
// spreads further, so it fills the room evenly; it clears on the same clock. How foggy the whole
// room is (`fogginess`, the beams' haze) is added up from the same puffs, so it follows the fog.
import * as THREE from 'three';
import { DECK, floorAt, shownRoom } from './geometry';
import type { Sfx } from './rig';

// (`glow`: the light a cold spark fountain throws round itself, big soft sprites at its foot)
type Kind = Sfx | 'fog' | 'glow';
// (a fog puff as `puffs('fog')` gives it: `spin` = what it is, JET, CLOUD or HAZE; `r` its own
// random number)
export interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; age: number; size: number; r: number; g: number; b: number; a: number; spin: number }
const SPECS: Record<Kind, { max: number; additive: boolean; tex: 'dot' | 'ring' | 'soft' | 'square' | 'fog' }> = {
  confetti: { max: 12000, additive: false, tex: 'square' }, bubbles: { max: 4000, additive: false, tex: 'ring' },
  flame: { max: 3000, additive: true, tex: 'soft' }, sparks: { max: 16000, additive: true, tex: 'dot' },
  co2: { max: 4000, additive: false, tex: 'soft' }, fog: { max: 6000, additive: true, tex: 'fog' },
  glow: { max: 800, additive: true, tex: 'soft' },
};
// the deck (fog lies on it, and rolls off its edges down to the hall floor)
// (what's under a particle: the deck of the room shown, or its floor: geometry.ts floorAt)

// ---- fog
export const JET = -1, CLOUD = 0, HAZE = 1;
export const FOG = {
  // the cloud lives this long (s): gone at most LIFE + SPREAD after it left the nozzle
  LIFE: 20, SPREAD: 15,
  // ... and fades out over the last part of its life (from this share of it on)
  FADE: 0.45,
  // the air in the room drifts towards the audience (m/s)
  DRIFT: 0.12,
  // the jet: braking, linear (1/s) and with its speed (1/m): it carries about 6 m at full
  DRAG: 0.7, DRAG2: 0.32,
  // a hazer's fan: brakes more gently (its haze drifts on further)
  HAZE_DRAG: 0.3,
  // the cloud's puffs per second at full, of the puffs a machine makes (the rest is the jet)
  CLOUD_RATE: 60, JET_RATE: 330, HAZE_RATE: 10,
  // most cloud puffs alive at once (the room fills without thousands of huge sprites)
  KEPT: 2400,
};
// how much fog fills the room (the sum of the puffs' weights at which `fogginess` is 1): a small
// room fills sooner (the hall 900, the pub 520: by its floor, to the power 0.21, for every room)
const fullOf = (w: { x: number; z0: number; z1: number }) => 900 * Math.pow(Math.max(1, 2 * w.x * (w.z1 - w.z0)) / 1968, 0.21);
// a haze puff counts for more than a cloud puff (there are far fewer: a hazer running at full keeps
// the hall at about 0.6)
const HAZE_WEIGHT = 3;
// how the air moves the cloud (`Air`): how fast it spreads (D, m²/s), how thin is thin (puffs a
// m²), how fast at most (m/s), how strong the swirls are
const FOG_AIR = { D: 1.0, thin: 0.4, max: 1.4, swirl: 0.4 }, HAZE_AIR = { D: 4, thin: 0.05, max: 1.5, swirl: 0.3 };
const smooth = (a: number, b: number, x: number) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
// how much of a fog puff is left at an age (1 until FADE of its life, then smoothly to 0)
export const fade = (age: number, life: number) => 1 - smooth(FOG.FADE * life, life, age);

// The air over the room's floor on a coarse grid (about 1 m): how many cloud puffs are in each
// cell (blurred a little), and from that how the air carries them: away from where the cloud is
// thick into where it's thin (spreading like ink in water: v = -D grad(n) / n), plus slow swirls
// (a stream function: they turn the cloud over without bunching it). The walls let nothing through
// and push nothing into them, so the fog doesn't pile up against the backdrop.
export class Air {
  nx = 0; nz = 0; x0 = 0; z0 = 0; cx = 1; cz = 1;
  n = new Float32Array(0); private tmp = new Float32Array(0); ux = new Float32Array(0); uz = new Float32Array(0);
  private sx = new Float32Array(0); private cxs = new Float32Array(0); private sz = new Float32Array(0); private czs = new Float32Array(0);
  vx = 0; vz = 0;           // what at() found
  // the grid over x0..x1, z0..z1
  fit(x0: number, x1: number, z0: number, z1: number) {
    const nx = Math.max(2, Math.min(48, Math.ceil(x1 - x0))), nz = Math.max(2, Math.min(48, Math.ceil(z1 - z0)));
    if (nx * nz !== this.n.length || nx !== this.nx) {
      const c = nx * nz; this.n = new Float32Array(c); this.tmp = new Float32Array(c); this.ux = new Float32Array(c); this.uz = new Float32Array(c);
      this.sx = new Float32Array(nx * 2); this.cxs = new Float32Array(nx * 2); this.sz = new Float32Array(nz * 2); this.czs = new Float32Array(nz * 2);
    }
    this.nx = nx; this.nz = nz; this.x0 = x0; this.z0 = z0; this.cx = (x1 - x0) / nx; this.cz = (z1 - z0) / nz;
  }
  clear() { this.n.fill(0); }
  // a puff at (x, z), shared out over the four cells round it
  add(x: number, z: number, w: number) {
    const nx = this.nx, nz = this.nz, fx = (x - this.x0) / this.cx - 0.5, fz = (z - this.z0) / this.cz - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const i0 = i < 0 ? 0 : i >= nx ? nx - 1 : i, i1 = i + 1 < 0 ? 0 : i + 1 >= nx ? nx - 1 : i + 1;
    const j0 = j < 0 ? 0 : j >= nz ? nz - 1 : j, j1 = j + 1 < 0 ? 0 : j + 1 >= nz ? nz - 1 : j + 1, n = this.n;
    n[j0 * nx + i0] += w * (1 - tx) * (1 - tz); n[j0 * nx + i1] += w * tx * (1 - tz);
    n[j1 * nx + i0] += w * (1 - tx) * tz; n[j1 * nx + i1] += w * tx * tz;
  }
  // how the air moves, cell by cell, at time t (s)
  solve(t: number, o: { D: number; thin: number; max: number; swirl: number }) {
    const { nx, nz, n, tmp, ux, uz } = this, area = this.cx * this.cz;
    // blurred (1 2 1 each way; at a wall the cell counts for the one beyond it)
    for (let j = 0; j < nz; j++) for (let i = 0, r = j * nx; i < nx; i++) tmp[r + i] = (n[r + (i > 0 ? i - 1 : 0)] + 2 * n[r + i] + n[r + (i < nx - 1 ? i + 1 : i)]) * 0.25 / area;
    for (let j = 0; j < nz; j++) { const a = (j > 0 ? j - 1 : 0) * nx, b = j * nx, c = (j < nz - 1 ? j + 1 : j) * nx; for (let i = 0; i < nx; i++) n[b + i] = (tmp[a + i] + 2 * tmp[b + i] + tmp[c + i]) * 0.25; }
    // the swirls: psi = A sin(0.55x + 0.21t) sin(0.5z - 0.17t) + A/2 sin(1.1x - 0.3t + 1.3) sin(0.9z + 0.26t + 0.4)
    const A = o.swirl, B = o.swirl * 0.5, sx = this.sx, cxs = this.cxs, sz = this.sz, czs = this.czs;
    for (let i = 0; i < nx; i++) { const x = this.x0 + (i + 0.5) * this.cx; sx[i * 2] = Math.sin(0.55 * x + 0.21 * t); cxs[i * 2] = Math.cos(0.55 * x + 0.21 * t); sx[i * 2 + 1] = Math.sin(1.1 * x - 0.3 * t + 1.3); cxs[i * 2 + 1] = Math.cos(1.1 * x - 0.3 * t + 1.3); }
    for (let j = 0; j < nz; j++) { const z = this.z0 + (j + 0.5) * this.cz; sz[j * 2] = Math.sin(0.5 * z - 0.17 * t); czs[j * 2] = Math.cos(0.5 * z - 0.17 * t); sz[j * 2 + 1] = Math.sin(0.9 * z + 0.26 * t + 0.4); czs[j * 2 + 1] = Math.cos(0.9 * z + 0.26 * t + 0.4); }
    const kx = 1 / (2 * this.cx), kz = 1 / (2 * this.cz), m2 = o.max * o.max;
    for (let j = 0; j < nz; j++) {
      const a = (j > 0 ? j - 1 : 0) * nx, b = j * nx, c = (j < nz - 1 ? j + 1 : j) * nx;
      for (let i = 0; i < nx; i++) {
        const here = n[b + i], k = -o.D / (here + o.thin);
        let vx = (n[b + (i < nx - 1 ? i + 1 : i)] - n[b + (i > 0 ? i - 1 : 0)]) * kx * k, vz = (n[c + i] - n[a + i]) * kz * k;
        const s = vx * vx + vz * vz; if (s > m2) { const f = o.max / Math.sqrt(s); vx *= f; vz *= f; }
        ux[b + i] = vx + A * 0.5 * sx[i * 2] * czs[j * 2] + B * 0.9 * sx[i * 2 + 1] * czs[j * 2 + 1];
        uz[b + i] = vz - A * 0.55 * cxs[i * 2] * sz[j * 2] - B * 1.1 * cxs[i * 2 + 1] * sz[j * 2 + 1];
      }
    }
  }
  // how the air moves at (x, z): into vx, vz
  at(x: number, z: number) {
    const nx = this.nx, nz = this.nz, fx = (x - this.x0) / this.cx - 0.5, fz = (z - this.z0) / this.cz - 0.5;
    // (outside the grid: the edge cells)
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const i0 = i < 0 ? 0 : i >= nx ? nx - 1 : i, i1 = i + 1 < 0 ? 0 : i + 1 >= nx ? nx - 1 : i + 1;
    const j0 = j < 0 ? 0 : j >= nz ? nz - 1 : j, j1 = j + 1 < 0 ? 0 : j + 1 >= nz ? nz - 1 : j + 1;
    const a = j0 * nx + i0, b = j0 * nx + i1, c = j1 * nx + i0, d = j1 * nx + i1, ux = this.ux, uz = this.uz;
    this.vx = (ux[a] * (1 - tx) + ux[b] * tx) * (1 - tz) + (ux[c] * (1 - tx) + ux[d] * tx) * tz;
    this.vz = (uz[a] * (1 - tx) + uz[b] * tx) * (1 - tz) + (uz[c] * (1 - tx) + uz[d] * tx) * tz;
  }
}

function sprite(kind: 'dot' | 'ring' | 'soft' | 'square' | 'fog') {
  const c = document.createElement('canvas'); c.width = c.height = kind === 'fog' ? 128 : 64;
  const g = c.getContext('2d');
  if (!g) return new THREE.CanvasTexture(c);
  if (kind === 'fog') {
    // a billow, not a disc: lumpy noise inside a soft round edge
    const img = g.createImageData(128, 128), h = (x: number, y: number) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };
    const vn = (x: number, y: number) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v; };
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const dx = (x - 63.5) / 64, dy = (y - 63.5) / 64, r = Math.sqrt(dx * dx + dy * dy);
      const n = vn(x / 22, y / 22) * 0.55 + vn(x / 11 + 7, y / 11 + 3) * 0.3 + vn(x / 5.5 + 2, y / 5.5 + 9) * 0.15;
      const a = Math.max(0, 1 - r) ** 1.6 * (0.35 + 0.9 * n);
      const i = (y * 128 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.min(255, a * 255);
    }
    g.putImageData(img, 0, 0);
  } else if (kind === 'square') { g.fillStyle = '#fff'; g.fillRect(14, 22, 36, 20); }
  else if (kind === 'ring') {
    const gr = g.createRadialGradient(32, 32, 18, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(24, 22, 4, 0, Math.PI * 2); g.fill();
  } else {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    // (a spark: a hard white-hot core and only a thin glow round it, not a soft blob)
    if (kind === 'dot') { gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,1)'); gr.addColorStop(0.32, 'rgba(255,255,255,0.25)'); gr.addColorStop(0.6, 'rgba(255,255,255,0)'); }
    else { gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); }
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// the points' shader: `uBody` set = the fog's grey body (its own colour, normal blending), else each
// point's own colour; `aRot` turns a fog puff's picture (no two billows alike)
const VERT = `attribute vec4 aColor; attribute float aSize; attribute float aRot; uniform float uScale; varying vec4 vColor; varying float vRot;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = max(0.05, -mv.z);
    vColor = aColor; vRot = aRot; vColor.a *= smoothstep(0.6, 2.5, d) * step(0.0, -mv.z);
    gl_PointSize = min(360.0, aSize * uScale / d); gl_Position = projectionMatrix * mv;
  }`;
const FRAG = `uniform sampler2D map; uniform vec4 uBody; varying vec4 vColor; varying float vRot;
  void main() {
    vec2 q = gl_PointCoord - 0.5; float c = cos(vRot), s = sin(vRot); q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    vec4 t = texture2D(map, q + 0.5);
    float a = clamp(vColor.a * t.a * (uBody.a > 0.0 ? uBody.a : 1.0), 0.0, 1.0); if (!(a >= 0.01)) discard;
    gl_FragColor = vec4((uBody.a > 0.0 ? uBody.rgb : clamp(vColor.rgb, 0.0, 4.0)) * t.rgb, a);
  }`;

// What every kind's sprites share: the buffers that go to the graphics card and the materials.
class Sprites {
  readonly points: THREE.Points;
  readonly body?: THREE.Points;      // fog: the grey of the fog itself (it hides a little of what's behind)
  protected pos: Float32Array; protected col: Float32Array; protected size: Float32Array; protected rot: Float32Array;
  protected drawn = 0;
  constructor(readonly kind: Kind) {
    const s = SPECS[kind];
    this.pos = new Float32Array(s.max * 3); this.col = new Float32Array(s.max * 4); this.size = new Float32Array(s.max); this.rot = new Float32Array(s.max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    const map = sprite(s.tex);
    // (a particle right at the camera fades out instead of filling the screen: the size is capped
    // and anything nearer than a couple of metres goes; a NaN never reaches the picture)
    const mat = (body: boolean) => new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, uScale: { value: 400 }, uBody: { value: new THREE.Vector4(0, 0, 0, body ? 0.5 : 0) } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: s.additive && !body ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    if (kind === 'fog') { this.body = new THREE.Points(geo, mat(true)); this.body.frustumCulled = false; }
    this.points = new THREE.Points(geo, mat(false)); this.points.frustumCulled = false;
  }
  // (only the live part of the buffers goes up)
  protected upload(live: number) {
    const g = this.points.geometry;
    g.setDrawRange(0, live);
    for (const [a, n] of [['position', 3], ['aColor', 4], ['aSize', 1], ['aRot', 1]] as const) { const at = g.getAttribute(a) as THREE.BufferAttribute; at.clearUpdateRanges(); if (live) at.addUpdateRange(0, live * n); at.needsUpdate = true; }
  }
}

// confetti, bubbles, flames, sparks, CO2: a list of pieces
class Cloud extends Sprites {
  private ps: P[] = [];
  // Full: confetti takes the place of the oldest pieces (what lies on the floor longest goes
  // first); anything else waits for room.
  add(p: P) {
    if (this.ps.length < SPECS[this.kind].max) this.ps.push(p);
    else if (this.kind === 'confetti') { this.ps[this.ring] = p; this.ring = (this.ring + 1) % this.ps.length; }
  }
  private ring = 0;
  get count() { return this.ps.length; }
  get list(): readonly P[] { return this.ps; }
  step(dt: number, wind: number) {
    const k = this.kind;
    // (in place: no new arrays each frame for thousands of puffs)
    let live = 0;
    for (const p of this.ps) { p.age += dt; if (p.age < p.life) this.ps[live++] = p; }
    this.ps.length = live;
    // nothing alive now or last frame: nothing to send to the graphics card
    if (!live && !this.drawn) return;
    this.drawn = live;
    for (const p of this.ps) {
      const f = p.age / p.life;
      if (k === 'confetti') {
        // falls slowly once the shot runs out, tumbling (the sprite flickers), lies where it lands
        p.vy -= 9.8 * dt; const drag = p.vy < 0 ? 4.2 : 0.55; p.vx -= p.vx * drag * dt; p.vz -= p.vz * drag * dt; p.vy -= p.vy * drag * dt;
        p.vx += Math.sin(p.age * 3 + p.spin) * 0.6 * dt + wind * dt;
        const floor = floorAt(p.x, p.z);
        // (it lies where it lands for half a minute, fading out over its last two seconds)
        if (p.y <= floor + 0.01) { p.y = floor + 0.01; p.vx = p.vy = p.vz = 0; }
        p.a = Math.min(1, (p.life - p.age) * 0.5);
      } else if (k === 'bubbles') {
        p.vy += (0.25 - p.vy) * dt; p.vx += (Math.sin(p.age * 2 + p.spin) * 0.3 + wind - p.vx) * dt; p.a = 0.75 * Math.min(1, (p.life - p.age) * 3);
      } else if (k === 'flame') {
        // (a column of fire, not a wall of light: see-through, deep orange as it rises)
        p.vy += 2 * dt; p.size *= 1 + dt * 1.1; const h = 1 - f;
        p.r = 0.9; p.g = 0.22 + 0.55 * h * h; p.b = 0.06 * h * h * h; p.a = f < 0.8 ? 0.5 * h + 0.08 : (1 - f) * 1.2;
      } else if (k === 'sparks') {
        // (white-hot, brighter than white, cooling to orange as they fall)
        p.vy -= 9.8 * dt; p.a = 1 - f * f; p.r = 2.6 * (1 - 0.35 * f); p.g = 2.0 - 1.3 * f; p.b = 1.1 * (1 - f) * (1 - f);
      } else if (k === 'glow') {
        p.a = p.spin * (1 - f);                    // (`spin`: how bright it was born)
      } else if (k === 'co2') {
        // a white column that stops dead and hangs a moment (it swells to a cloud, never a wall)
        p.vx -= p.vx * 2.5 * dt; p.vy -= p.vy * 2.0 * dt; p.vz -= p.vz * 2.5 * dt; p.size += (2.6 - p.size) * dt * 1.3; p.a = 0.5 * (1 - f) * (1 - f);
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    const pos = this.pos, col = this.col, size = this.size;
    for (let i = 0; i < live; i++) {
      const p = this.ps[i], j = i * 4;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[j] = p.r; col[j + 1] = p.g; col[j + 2] = p.b; col[j + 3] = p.a;
      // (confetti tumbles while it falls: its size flickers; lying on the floor it's still)
      size[i] = k !== 'confetti' ? p.size : p.vy === 0 && p.vx === 0 ? p.size * 0.7 : p.size * (0.35 + 0.65 * Math.abs(Math.sin(p.age * 9 + p.spin)));
    }
    this.upload(live);
  }
}

// The fog and the haze: thousands of puffs every frame, so they're kept in flat arrays, one per
// number (a list of objects is several times slower to go through), and gone through twice a step.
const LK = 8;                         // beams a puff can be lit by at once
class Fog extends Sprites {
  private readonly max = SPECS.fog.max;
  n = 0;
  readonly x = new Float32Array(this.max); readonly y = new Float32Array(this.max); readonly z = new Float32Array(this.max);
  readonly vx = new Float32Array(this.max); readonly vy = new Float32Array(this.max); readonly vz = new Float32Array(this.max);
  readonly age = new Float32Array(this.max); readonly life = new Float32Array(this.max); readonly sz = new Float32Array(this.max);
  readonly a = new Float32Array(this.max); readonly seed = new Float32Array(this.max); readonly what = new Int8Array(this.max);
  // which beams each puff is in: LK pairs of beam key, weight
  private lk = new Float32Array(this.max * LK * 2); private lkn = new Uint8Array(this.max);
  kept = 0;                 // the cloud puffs among them (the jet's and the haze's aren't)
  fogginess = 0;
  // the air that carries the cloud and the haze (see Air)
  private air = new Air();
  private hazeAir = new Air();
  private aired = -1;       // when the air was last worked out (20 times a second is plenty: it's slow)
  constructor() { super('fog'); }
  get count() { return this.n; }
  // (`late`: how far into this step it leaves the nozzle; it only moves for the rest of the step, so
  // the puffs of one step come out spread along the jet, not in a clump: a low frame rate gives the
  // same smooth jet)
  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, seed: number, what: number, late = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = -late; this.life[i] = life; this.sz[i] = size; this.a[i] = 0; this.seed[i] = seed; this.what[i] = what; this.lkn[i] = 0;
    if (what === CLOUD) this.kept++;
  }
  // (puff `from` into place `to`)
  private move(from: number, to: number) {
    this.x[to] = this.x[from]; this.y[to] = this.y[from]; this.z[to] = this.z[from]; this.vx[to] = this.vx[from]; this.vy[to] = this.vy[from]; this.vz[to] = this.vz[from];
    this.age[to] = this.age[from]; this.life[to] = this.life[from]; this.sz[to] = this.sz[from]; this.a[to] = this.a[from]; this.seed[to] = this.seed[from]; this.what[to] = this.what[from];
    this.lkn[to] = this.lkn[from]; this.lk.copyWithin(to * LK * 2, from * LK * 2, (from + 1) * LK * 2);
  }
  // the puffs as they are now (for the tests and the stats)
  get list(): P[] {
    return Array.from({ length: this.n }, (_, i) => ({ x: this.x[i], y: this.y[i], z: this.z[i], vx: this.vx[i], vy: this.vy[i], vz: this.vz[i], life: this.life[i], age: this.age[i], size: this.sz[i], r: this.seed[i], g: 0, b: 0, a: this.a[i], spin: this.what[i] }));
  }
  get middle() { let x = 0, z = 0; for (let i = 0; i < this.n; i++) { x += this.x[i]; z += this.z[i]; } const n = Math.max(1, this.n); return { x: x / n, z: z / n }; }
  // the fog's own grey (lit a little by the stage): `a` how much of what's behind it hides
  setBody(r: number, g: number, b: number, a: number) { ((this.body?.material as THREE.ShaderMaterial | undefined)?.uniforms.uBody.value as THREE.Vector4 | undefined)?.set(r, g, b, a); }
  // which beams each puff is in (a few hundred puffs a frame, in turn: thousands of puffs and
  // hundreds of beams every frame is too slow); how bright they are comes from the beams' levels
  // every frame (`levels`), so a strobe or a blackout shows in the fog at once
  private cursor = 0;
  private bs = new Float32Array(0);
  levels = new Float32Array(0);      // per beam key: level, r, g, b (this frame)
  light(beams: Beam[], budget: number) {
    const n = this.n, todo = Math.min(n, budget), nb = beams.length, lk = this.lk;
    // each beam's numbers once, flat (not per puff)
    const B = this.bs.length >= nb * 8 ? this.bs : (this.bs = new Float32Array(nb * 8 + 64));
    for (let i = 0; i < nb; i++) { const bm = beams[i], o = i * 8; B[o] = bm.p.x; B[o + 1] = bm.p.y; B[o + 2] = bm.p.z; B[o + 3] = bm.d.x; B[o + 4] = bm.d.y; B[o + 5] = bm.d.z; B[o + 6] = Math.tan((bm.deg / 2) * Math.PI / 180); B[o + 7] = bm.key ?? i; }
    for (let j = 0; j < todo; j++) {
      const q = (this.cursor + j) % n, half = this.sz[q] * 0.5, px = this.x[q], py = this.y[q], pz = this.z[q], at = q * LK * 2;
      let c = 0;
      for (let i = 0, o = 0; i < nb && c < LK; i++, o += 8) {
        const vx = px - B[o], vy = py - B[o + 1], vz = pz - B[o + 2], along = vx * B[o + 3] + vy * B[o + 4] + vz * B[o + 5];
        if (along <= 0) continue;
        const ox = vx - B[o + 3] * along, oy = vy - B[o + 4] * along, oz = vz - B[o + 5] * along, rad = along * B[o + 6] + half, off2 = ox * ox + oy * oy + oz * oz;
        if (off2 >= rad * rad) continue;
        lk[at + c * 2] = B[o + 7]; lk[at + c * 2 + 1] = (1 - Math.sqrt(off2) / rad) * 1.6 / (1 + along * 0.04); c++;
      }
      this.lkn[q] = c;
    }
    this.cursor = n ? (this.cursor + todo) % n : 0;
  }
  // The puffs a step on (see the top of the file), and how foggy the room is now.
  step(dt: number, clock: number) {
    const room = shownRoom(), dk = room.deck, wl = room.walls, pub = room.id === 'pub', deckY = DECK;
    // the room's inside: in front of the backdrop, between the walls, under the ceiling
    const zb = dk.z0 + 0.3, xw = wl.x - 0.3, zf = wl.z1 - 0.3, top = room.ceiling - 0.4;
    // how big a puff swells (smaller under a pub's low ceiling), how high the haze goes
    const big = pub ? 3.2 : 4.5, bigHaze = pub ? 3.6 : 5.2, hazeUp = Math.min(6, room.ceiling * 0.5);
    // the air over the room (the hall's out to 16 m each side and 36 m from the backdrop: plenty)
    const air = this.air, hair = this.hazeAir, gx = Math.min(xw, 16), gz = Math.min(zf, zb + 36);
    const fresh = clock - this.aired >= 0.049 || clock < this.aired;
    if (fresh) { this.aired = clock; air.fit(-gx, gx, zb, gz); air.clear(); hair.fit(-gx, gx, zb, gz); hair.clear(); }
    const X = this.x, Y = this.y, Z = this.z, VX = this.vx, VY = this.vy, VZ = this.vz, AGE = this.age, LIFE = this.life, SZ = this.sz, AL = this.a, SEED = this.seed, WHAT = this.what;
    // 1: older; the dead out (the last puff takes its place); the cloud and the haze onto their grids
    let n = this.n, kept = 0, hazes = 0;
    for (let i = 0; i < n;) {
      AGE[i] += dt;
      if (AGE[i] >= LIFE[i]) { n--; if (i < n) this.move(n, i); continue; }
      const w = WHAT[i];
      if (w === CLOUD) { kept++; if (fresh) air.add(X[i], Z[i], 1); } else if (w === HAZE) { hazes++; if (fresh) hair.add(X[i], Z[i], 1); }
      i++;
    }
    this.n = n; this.kept = kept;
    if (!n) this.fogginess = 0;
    // nothing alive now or last frame: nothing to send to the graphics card
    if (!n && !this.drawn) return;
    this.drawn = n;
    if (fresh && kept) air.solve(clock, FOG_AIR);
    if (fresh && hazes) hair.solve(clock, HAZE_AIR);
    // 2: on, and into the buffers
    const D1 = FOG.DRAG, D2 = FOG.DRAG2, D3 = FOG.HAZE_DRAG, drift = FOG.DRIFT, pos = this.pos, col = this.col, size = this.size, rot = this.rot, L = this.levels, lk = this.lk, lkn = this.lkn;
    // The braking is worked out exactly over the step (dr/dt = -(l + c r) r has a closed form): what's
    // left of the speed is E / (1 + q), how far it carries ln(1 + q) / (c r) per m/s, with
    // q = c r (1 - E) / l, E = exp(-l dt). So a slow frame carries the jet as far as many quick ones.
    const E1 = Math.exp(-D1 * dt), E3 = Math.exp(-D3 * dt), G1 = (1 - E1) / D1, G3 = (1 - E3) / D3;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let x = X[i], y = Y[i], z = Z[i], vx = VX[i], vy = VY[i], vz = VZ[i], s = SZ[i];
      const age = AGE[i], w = WHAT[i], floor = x <= dk.x && x >= -dk.x && z >= dk.z0 && z <= dk.z1 ? deckY : 0;
      // (a puff that left the nozzle part way through this step moves for that part only)
      const h = age < dt ? Math.max(0, age) : dt, part = h < dt;
      let a: number;
      if (w === JET) {
        // the jet: brakes hard (it pulls in the air round it) and widens as it goes; gone in a second
        const E = part ? Math.exp(-D1 * h) : E1, G = part ? (1 - E) / D1 : G1;
        const sp = Math.sqrt(vx * vx + vy * vy + vz * vz), q = D2 * sp * G, f = age / LIFE[i];
        const d = q > 1e-6 ? Math.log1p(q) / (D2 * sp) : G, k = E / (1 + q);
        x += vx * d; y += vy * d; z += vz * d; vx *= k; vy *= k; vz *= k;
        s += sp * d * 0.3;
        a = 0.26 * Math.min(1, f * 6) * (1 - f);
      } else {
        // the cloud and the haze: the jet's push brakes the same way, then the air carries them
        // (spreading, swirling, drifting to the audience); the cloud lies low and rises as it mixes
        // (over the deck's edge it sinks to the floor), the haze rises further and spreads further
        const cloud = w === CLOUD, A = cloud ? air : hair, l = cloud ? D1 : D3;
        const E = part ? Math.exp(-l * h) : cloud ? E1 : E3, G = part ? (1 - E) / l : cloud ? G1 : G3;
        A.at(x, z);
        const hy = cloud ? floor + 0.3 + Math.min(1.8, age * 0.07) : floor + 1 + (hazeUp - 1) * Math.min(1, age / 25) * (0.3 + 0.7 * SEED[i]);
        const tx = A.vx, ty = (hy - y) * (cloud ? 0.5 : 0.3), tz = A.vz + drift * (cloud ? 1 : 0.6), rx = vx - tx, ry = vy - ty, rz = vz - tz;
        const r = Math.sqrt(rx * rx + ry * ry + rz * rz), q = D2 * r * G, d = q > 1e-6 ? Math.log1p(q) / (D2 * r) : G, k = E / (1 + q);
        x += tx * h + rx * d; y += ty * h + ry * d; z += tz * h + rz * d;
        vx = tx + rx * k; vy = ty + ry * k; vz = tz + rz * k;
        // what's left of it: it fades out at the end, never pops; thinner the more it has spread
        const left = fade(age, LIFE[i]), mixed = age >= 10 ? 1 : smooth(0, 10, age);
        if (cloud) {
          // (it widens with the way the jet's push carried it, then swells slowly)
          s = Math.min(big, s + Math.max(0, r * d - h) * 0.3 + (big - s) * h * 0.07);
          a = 0.22 * Math.min(1, age * 4) * left * Math.min(1.2, 1.3 / s);
          sum += mixed * left;
        } else {
          s = Math.min(bigHaze, s + (bigHaze - s) * h * 0.06);
          a = 0.07 * Math.min(1, age / 3) * left;
          sum += HAZE_WEIGHT * mixed * left;
        }
      }
      // (nothing goes through the backdrop, the walls, the deck or the ceiling)
      if (z < zb) { z = zb; if (vz < 0) vz *= -0.3; } else if (z > zf) { z = zf; if (vz > 0) vz *= -0.3; }
      if (x < -xw) { x = -xw; if (vx < 0) vx *= -0.3; } else if (x > xw) { x = xw; if (vx > 0) vx *= -0.3; }
      if (y < floor + 0.05) { y = floor + 0.05; if (vy < 0) vy = 0; } else if (y > top) { y = top; if (vy > 0) vy = 0; }
      X[i] = x; Y[i] = y; Z[i] = z; VX[i] = vx; VY[i] = vy; VZ[i] = vz; SZ[i] = s; AL[i] = a;
      // fog adds light (it never darkens what's behind it): a faint grey of its own (the body),
      // bright where a beam is in it: the light of the beams it's in, at their level now, their
      // colour kept (a red beam makes red fog, not white): only the brightest channel is held at 1.2
      let cr = 0, cg = 0, cb = 0;
      for (let m = 0, o0 = i * LK * 2, c = lkn[i]; m < c; m++) { const o = lk[o0 + m * 2] * 4, lv = L[o]; if (lv > 0) { const k = lv * lk[o0 + m * 2 + 1]; cr += L[o + 1] * k; cg += L[o + 2] * k; cb += L[o + 3] * k; } }
      const most = Math.max(cr, cg, cb), k2 = most > 1.2 ? 1.2 / most : 1, j = i * 4;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      col[j] = cr * k2; col[j + 1] = cg * k2; col[j + 2] = cb * k2; col[j + 3] = Math.min(0.8, a * 1.6);
      size[i] = s; rot[i] = SEED[i] * 6.283 + age * 0.05;
    }
    this.fogginess = sum / fullOf(room.walls);
    this.upload(n);
  }
}

export interface Emitter { id: string; kind: Sfx | 'fog'; x: number; y: number; z: number; dir?: { x: number; y: number; z: number }; haze?: boolean }
// a beam that lights what's in the air (fog takes its colour where it passes through)
export interface Beam { p: { x: number; y: number; z: number }; d: { x: number; y: number; z: number }; c: { r: number; g: number; b: number }; level: number; deg: number; key?: number }

export class Particles {
  readonly group = new THREE.Group();
  private clouds = {} as Record<Exclude<Kind, 'fog'>, Cloud>;
  private smoke = new Fog();
  private was = new Map<string, number>();
  private acc = new Map<string, number>();
  constructor() {
    for (const k of Object.keys(SPECS) as Kind[]) if (k !== 'fog') { this.clouds[k] = new Cloud(k); this.group.add(this.clouds[k].points); }
    this.group.add(this.smoke.body!, this.smoke.points);
  }
  get count() { return Object.values(this.clouds).reduce((n, c) => n + c.count, 0) + this.smoke.count; }
  // fog lit by the beams going through it (some of it each frame: plenty for slow fog)
  light(beams: Beam[]) {
    const fog = this.smoke;
    // every beam's level and colour by its key, this frame
    const top = beams.reduce((m, b, i) => Math.max(m, b.key ?? i), 0), L = fog.levels.length >= (top + 1) * 4 ? fog.levels : (fog.levels = new Float32Array((top + 1) * 4 + 64));
    L.fill(0);
    beams.forEach((b, i) => { const o = (b.key ?? i) * 4; L[o] = b.level; L[o + 1] = b.c.r; L[o + 2] = b.c.g; L[o + 3] = b.c.b; });
    if (fog.count) fog.light(beams, 800);
  }
  // the fog's own grey: lit a little by the stage (`c`, about the average light on it)
  ambient(r: number, g: number, b: number) { this.smoke.setBody(0.055 + r * 0.22, 0.06 + g * 0.22, 0.07 + b * 0.22, 0.5); }
  get fog() { return { count: this.smoke.count, room: this.fogginess, ...this.smoke.middle }; }
  // how much fog is in the whole room (0..1), from the fog and haze in the air now: it comes up as a
  // burst spreads (one fog machine at full fills the room in about 15 s), stays while the machines
  // run, and is gone with the fog, about half a minute after they stop
  get fogginess() { return Math.min(1, this.smoke.fogginess); }
  // the puffs of a kind as they are now (for the tests)
  puffs(kind: Kind): readonly P[] { return kind === 'fog' ? this.smoke.list : this.clouds[kind].list; }
  private clock = 0;
  setScale(px: number) { for (const c of [...Object.values(this.clouds), this.smoke]) for (const o of [c.points, c.body]) if (o) (o.material as THREE.ShaderMaterial).uniforms.uScale.value = px; }
  // each machine with what its channel says now (0..1)
  step(dt: number, machines: { e: Emitter; v: number }[]) {
    dt = Math.min(dt, 0.1);           // (a slow frame: the machines still put out what they should)
    const rnd = Math.random;
    this.clock += dt;
    for (const { e, v } of machines) {
      // (a machine seen for the first time, e.g. the 3D stage just opened: what it already holds
      // isn't a new shot)
      const before = this.was.get(e.id) ?? v;
      this.was.set(e.id, v);
      // (fog and haze go into `fog`, everything else into its own list)
      const c = this.clouds[e.kind as Sfx], fog = this.smoke;
      if (e.kind === 'confetti') {
        if (v > 0.5 && before <= 0.5) for (let i = 0; i < 2500; i++) {
          const a = rnd() * Math.PI * 2, s = 2.5 + rnd() * 4.5, col = new THREE.Color().setHSL(rnd(), 0.85, 0.6);
          c.add({ x: e.x, y: e.y + 0.4, z: e.z, vx: Math.cos(a) * s, vy: 16 + rnd() * 9, vz: Math.sin(a) * s + 2, life: 27 + rnd() * 4, age: 0, size: 0.15, r: col.r, g: col.g, b: col.b, a: 1, spin: rnd() * 6 });
        }
        continue;
      }
      if (v < 0.03) continue;
      // continuous ones: so many a second at full
      const rate = { bubbles: 240, flame: 700, sparks: 2200, co2: 900, fog: e.haze ? FOG.HAZE_RATE : FOG.JET_RATE + FOG.CLOUD_RATE, confetti: 0 }[e.kind] * v;
      // a spark fountain lights up round itself: a soft warm glow at its foot and up its middle
      if (e.kind === 'sparks') {
        let g = (this.acc.get(`${e.id}:glow`) ?? 0) + 50 * dt;
        for (; g >= 1; g--) for (const [y, size, a] of [[0.5, 2.6, 0.06], [1.6, 3.4, 0.035]] as const)
          this.clouds.glow.add({ x: e.x, y: e.y + y, z: e.z, vx: 0, vy: 0, vz: 0, life: 0.12, age: 0, size, r: 1, g: 0.62, b: 0.28, a: a * v, spin: a * v });
        this.acc.set(`${e.id}:glow`, g);
      }
      let n = (this.acc.get(e.id) ?? 0) + rate * dt;
      for (; n >= 1; n--) {
        const j = () => rnd() - 0.5;
        if (e.kind === 'bubbles') c.add({ x: e.x + j() * 0.6, y: e.y + 0.4, z: e.z + 0.2, vx: j() * 1.8, vy: 0.5 + rnd() * 0.6, vz: 1 + rnd() * 2, life: 10 + rnd() * 8, age: 0, size: 0.1 + rnd() * 0.2, r: 0.85, g: 0.95, b: 1, a: 0.7, spin: rnd() * 6 });
        else if (e.kind === 'flame') c.add({ x: e.x + j() * 0.15, y: e.y + 0.35, z: e.z + j() * 0.15, vx: j() * 0.45, vy: (7 + rnd() * 4) * (0.4 + 0.6 * v), vz: j() * 0.45, life: 0.5 + rnd() * 0.4, age: 0, size: 0.3 + rnd() * 0.22, r: 1, g: 0.9, b: 0.4, a: 1, spin: 0 });
        else if (e.kind === 'sparks') c.add({ x: e.x, y: e.y + 0.35, z: e.z, vx: j() * 2, vy: (4 + rnd() * 3) * (0.4 + v * 1.2), vz: j() * 2, life: 0.8 + rnd() * 1.0, age: 0, size: 0.075, r: 2.6, g: 2, b: 1.1, a: 1, spin: 0 });
        else if (e.kind === 'co2') c.add({ x: e.x, y: e.y + 0.35, z: e.z, vx: j() * 0.8, vy: 15 + rnd() * 8, vz: j() * 0.8, life: 1.3 + rnd() * 0.8, age: 0, size: 0.3, r: 0.95, g: 0.97, b: 1, a: 0.6, spin: 0 });
        else if (e.haze) {
          // a hazer's fan blows its fine haze a few metres out, in a wide fan
          const d = e.dir ?? { x: 0, y: 0, z: 1 }, sp = 3 + rnd() * 2, w = j() * 0.8 * sp;
          fog.add(e.x + d.x * 0.3, e.y + 0.4, e.z + d.z * 0.3, d.x * sp - d.z * w, 0.1 + rnd() * 0.3, d.z * sp + d.x * w, FOG.LIFE + rnd() * FOG.SPREAD, 1.6 + rnd() * 1.2, rnd(), HAZE, rnd() * dt);
        } else {
          // a blast: 12 to 20 m/s out of the nozzle (harder the higher the channel), a narrow cone.
          // Most of it is the jet (gone in a second or so); one puff in six or seven stays as the
          // cloud (half a minute), so the room fills without thousands of huge sprites
          const d = e.dir ?? { x: 0, y: 0, z: 1 }, sp = (12 + rnd() * 8) * (0.6 + 0.4 * v), w = j() * 0.24 * sp;
          const cloud = rnd() * (FOG.JET_RATE + FOG.CLOUD_RATE) < FOG.CLOUD_RATE && fog.kept < FOG.KEPT;
          fog.add(e.x + d.x * 0.35, e.y + 0.22, e.z + d.z * 0.35, d.x * sp - d.z * w, d.y * sp + 0.1 + rnd() * 0.4, d.z * sp + d.x * w,
            cloud ? FOG.LIFE + rnd() * FOG.SPREAD : 0.9 + rnd() * 0.6, 0.25 + rnd() * 0.2, rnd(), cloud ? CLOUD : JET, rnd() * dt);
        }
      }
      this.acc.set(e.id, n);
    }
    for (const c of Object.values(this.clouds)) c.step(dt, 0.08);
    this.smoke.step(dt, this.clock);
  }
}
