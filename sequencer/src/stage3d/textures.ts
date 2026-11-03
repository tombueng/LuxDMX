// Textures for the venue, painted here on canvases (nothing to download, nothing to license): a
// stage floor, brushed aluminium, a speaker grille, fabric with print, rack panels, tolex, drum
// wraps, concrete. Each made once and shared.
import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();
function make(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, o: { repeat?: [number, number]; color?: boolean } = {}) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  // (no 2D canvas, as in a test runner: a blank texture, the shapes still build)
  // (painted once on the CPU: reading pixels back from it stays cheap)
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (ctx) draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (o.color !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...o.repeat); }
  cache.set(key, t);
  return t;
}
// plain white (a part without a picture of its own, so it can share a shader with those that have one)
export const white = () => make('white', 4, 4, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); });
// seeded noise so every load paints the same
function rnd(seed: number) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
// (written straight into the pixels: thousands of little rectangles through the canvas are slow)
function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, color: (r: () => number) => string, size: number, seed = 7) {
  const r = rnd(seed), img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < n; i++) {
    const c = color(r), v = c.slice(c.indexOf('(') + 1, -1).split(','), cr = +v[0], cg = +v[1], cb = +v[2], a = v.length > 3 ? +v[3] : 1;
    const x0 = r() * w, y0 = r() * h, x1 = Math.min(w, Math.ceil(x0 + size * (0.5 + r()))), y1 = Math.min(h, Math.ceil(y0 + size * (0.5 + r())));
    for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) { const k = (y * w + x) * 4; d[k] += (cr - d[k]) * a; d[k + 1] += (cg - d[k + 1]) * a; d[k + 2] += (cb - d[k + 2]) * a; }
  }
  g.putImageData(img, 0, 0);
}

// black vinyl stage floor (Marley): matte, faint seams, scuffs
export const stageFloor = () => make('floor', 1024, 1024, (g, w, h) => {
  g.fillStyle = '#17181b'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 9000, (r) => `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + r() * 0.03})`, 2);
  const r = rnd(3);
  for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(255,255,255,${0.02 + r() * 0.03})`; g.lineWidth = 1 + r() * 2; g.beginPath(); const x = r() * w, y = r() * h; g.moveTo(x, y); g.quadraticCurveTo(x + (r() - 0.5) * 120, y + (r() - 0.5) * 120, x + (r() - 0.5) * 200, y + (r() - 0.5) * 200); g.stroke(); }
  g.fillStyle = 'rgba(0,0,0,0.5)'; for (let x = 0; x < w; x += w / 4) g.fillRect(x, 0, 2, h);
  // gaffer-tape marks (spike marks) here and there
  for (let i = 0; i < 6; i++) { g.save(); g.translate(r() * w, r() * h); g.rotate(r() * 3); g.fillStyle = ['#e8d43a', '#e6e6e6', '#3aa0e6'][i % 3]; g.globalAlpha = 0.75; g.fillRect(-14, -3, 28, 6); g.fillRect(-3, -14, 6, 28); g.restore(); }
}, { repeat: [4, 3] });

// concrete hall floor
export const concrete = () => make('concrete', 1024, 1024, (g, w, h) => {
  g.fillStyle = '#2a2b2e'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 30000, (r) => `rgba(${Math.floor(r() * 80 + 20)},${Math.floor(r() * 80 + 20)},${Math.floor(r() * 80 + 25)},0.18)`, 3);
  const r = rnd(9);
  for (let i = 0; i < 40; i++) { const gr = g.createRadialGradient(r() * w, r() * h, 0, r() * w, r() * h, 40 + r() * 140); gr.addColorStop(0, `rgba(0,0,0,${0.05 + r() * 0.1})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; for (let x = 0; x <= w; x += w / 2) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); g.beginPath(); g.moveTo(0, x); g.lineTo(w, x); g.stroke(); }
}, { repeat: [12, 12] });

// brushed aluminium: fine streaks along one way (truss tubes, barricade, rigging)
export const brushed = () => make('brushed', 256, 256, (g, w, h) => {
  g.fillStyle = '#b8bec6'; g.fillRect(0, 0, w, h);
  const r = rnd(5);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '40,45,55'},${0.03 + r() * 0.08})`; g.fillRect(0, r() * h, w, 0.6 + r()); }
}, { repeat: [1, 6] });

// a speaker grille: round holes in black steel
export const grille = () => make('grille', 256, 256, (g, w, h) => {
  g.fillStyle = '#16171a'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#050505';
  for (let y = 4; y < h; y += 8) for (let x = (y / 8) % 2 ? 8 : 4; x < w; x += 8) { g.beginPath(); g.arc(x, y, 2.6, 0, Math.PI * 2); g.fill(); }
}, { repeat: [6, 2] });

// black tolex (amps, road cases) with a faint grain
export const tolex = () => make('tolex', 256, 256, (g, w, h) => {
  g.fillStyle = '#1a1a1c'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 6000, (r) => `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.04 + r() * 0.05})`, 1.5, 11);
}, { repeat: [2, 2] });

// woven fabric for banners: a weave over whatever's printed (drawn by the caller)
function weave(g: CanvasRenderingContext2D, w: number, h: number) {
  g.globalAlpha = 0.07;
  g.fillStyle = '#000'; for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  g.fillStyle = '#fff'; for (let x = 0; x < w; x += 3) g.fillRect(x, 0, 1, h);
  g.globalAlpha = 1;
}
// Text that fits: the biggest size up to `max` at which it fits in `width`
export function fit(g: CanvasRenderingContext2D, text: string, font: (px: number) => string, width: number, max: number) {
  // (text scales with its size: measure once at the biggest, then once more to be sure)
  g.font = font(max);
  const w0 = g.measureText(text).width;
  if (w0 <= width) return max;
  let px = Math.max(8, Math.floor((max * width) / w0));
  g.font = font(px);
  while (px > 8 && g.measureText(text).width > width) { px -= 1; g.font = font(px); }
  return px;
}
export interface BannerStyle { w: number; h: number; bg?: string; accent?: string; logo?: boolean }
// a printed banner: the name big (glowing, outlined in the accent colour), a line under it
function paintBanner(g: CanvasRenderingContext2D, w: number, h: number, lines: string[], o: BannerStyle) {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, o.bg ?? '#0c0b14'); gr.addColorStop(1, '#030305');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const acc = o.accent ?? '#ff2d78';
  if (o.logo !== false) {
    // a burst of rays behind the name, and a halftone fade, like a tour backdrop
    g.save(); g.translate(w / 2, h * 0.46);
    for (let i = 0; i < 48; i++) { g.rotate(Math.PI / 24); g.fillStyle = i % 2 ? `${acc}22` : '#ffffff08'; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, -w * 0.035); g.lineTo(w, w * 0.035); g.fill(); }
    g.restore();
    for (let y = h * 0.62; y < h; y += 14) for (let x = 0; x < w; x += 14) { const s = ((y - h * 0.62) / (h * 0.38)) * 5; g.fillStyle = `${acc}55`; g.beginPath(); g.arc(x + ((y / 14) % 2) * 7, y, s, 0, Math.PI * 2); g.fill(); }
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((t, i) => {
    const max = i ? h * 0.085 : h * 0.24;
    const px = fit(g, t, (p) => `${i ? 700 : 900} ${p}px Impact, "Arial Black", "Helvetica Neue", sans-serif`, w * 0.9, max);
    const y = lines.length > 1 ? h * (i ? 0.72 : 0.44) : h / 2;
    if (!i) { g.shadowColor = acc; g.shadowBlur = px * 0.25; g.fillStyle = '#fff4ea'; g.fillText(t, w / 2, y); g.shadowBlur = 0; g.lineWidth = Math.max(2, px * 0.025); g.strokeStyle = acc; g.strokeText(t, w / 2, y); }
    else { g.fillStyle = '#d4dbe8'; g.fillText(t, w / 2, y); }
  });
  weave(g, w, h);
}
export function banner(key: string, lines: string[], o: BannerStyle) {
  return make(`banner:${key}`, o.w, o.h, (g, w, h) => paintBanner(g, w, h, lines, o));
}

// ---- pictures that change: the band's name (set in the show) on the banners, the kick drum
// One canvas and its texture, painted again in place when the words change (the same texture
// object: the venue's baked meshes keep drawing it). Not cached: each venue has its own.
export function liveCanvas(w: number, h: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const draw = (p: typeof paint) => { const g = c.getContext('2d'); if (g) { g.clearRect(0, 0, w, h); p(g, w, h); } t.needsUpdate = true; };
  draw(paint);
  return { t, canvas: c, draw };
}
// a printed banner whose words can change
export function liveBanner(lines: string[], o: BannerStyle) {
  const l = liveCanvas(o.w, o.h, (g, w, h) => paintBanner(g, w, h, lines, o));
  return { t: l.t, set: (next: string[]) => l.draw((g, w, h) => paintBanner(g, w, h, next, o)) };
}

// The band's name laid out to fill a w x h box: on one line, or on two when that makes the letters
// bigger (split between words, as even as it goes). px: the letters' size; lead: a line's height
// in px. measure(text, px): how wide the text is at that size (it grows in step with the size).
export function nameLayout(text: string, measure: (s: string, px: number) => number, w: number, h: number, lead = 1.08): { lines: string[]; px: number } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length || !(w > 0) || !(h > 0)) return { lines: [], px: 0 };
  const options: string[][] = [[words.join(' ')]];
  for (let i = 1; i < words.length; i++) options.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
  let best = { lines: options[0], px: 0 };
  for (const lines of options) {
    const wide = Math.max(...lines.map((l) => measure(l, 100))) / 100;
    const px = Math.floor(Math.min(h / (lines.length * lead), wide > 0 ? w / wide : Infinity));
    // (one line wins a tie: a name reads best in one go)
    if (px > best.px) best = { lines, px };
  }
  return { lines: best.lines, px: Math.max(1, best.px) };
}
const NAME_FONT = (px: number) => `900 ${px}px Impact, Anton, "Arial Black", "Helvetica Neue", sans-serif`;
// (rough concrete for the band's banner: a small noise tile, repeated: cheap to paint big)
let grit: HTMLCanvasElement | undefined;
function gritTile() {
  if (grit) return grit;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (g) speckle(g, 256, 256, 7000, (r) => `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.05 + r() * 0.12})`, 2.2, 91);
  return (grit = c);
}
// The band's name in the style of their banner picture: dark concrete with a few neon tubes, the
// name in heavy leaning letters with a thick black edge (the first line white, the second orange,
// or the last word orange on one line), worn like a dry brush, on woven cloth
export function paintBandName(g: CanvasRenderingContext2D, w: number, h: number, name: string) {
  g.fillStyle = '#141416'; g.fillRect(0, 0, w, h);
  const r = rnd(97);
  // concrete slabs and stains
  for (let i = 0; i < 18; i++) { const x = r() * w, y = r() * h, s = (0.2 + r() * 0.5) * h; g.fillStyle = `rgba(${r() < 0.5 ? '70,70,74' : '6,6,8'},${0.18 + r() * 0.25})`; g.fillRect(x - s / 2, y - s / 2, s * (0.8 + r()), s); }
  const tile = gritTile(), pat = g.createPattern(tile, 'repeat');
  if (pat) { g.fillStyle = pat; g.fillRect(0, 0, w, h); }
  const vg = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
  // neon tubes along the edges
  const tube = (pts: [number, number][], c: string) => {
    g.save(); g.strokeStyle = c; g.lineWidth = Math.max(2, h * 0.008); g.lineJoin = 'round'; g.shadowColor = c; g.shadowBlur = h * 0.04;
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h))); g.stroke(); g.stroke(); g.restore();
  };
  tube([[0.1, 0.62], [0.1, 0.12], [0.36, 0.12], [0.42, 0.02]], '#3fe4ff');
  tube([[0.69, 0.0], [0.72, 0.05], [0.81, 0.05], [0.81, 0.0]], '#ff3fb4');
  tube([[0.64, 0.98], [0.66, 0.9], [0.86, 0.9], [0.9, 0.84]], '#ff9a2e');
  tube([[0.53, 0.84], [0.62, 0.8]], '#ff3fb4');
  // the name on its own layer (worn there, then laid on the concrete)
  const lay = document.createElement('canvas'); lay.width = w; lay.height = h;
  const t = lay.getContext('2d');
  if (t) {
    const text = name.toUpperCase(), lean = 0.13;
    t.textBaseline = 'middle';
    const { lines, px: px0 } = nameLayout(text, (s, p) => { t.font = NAME_FONT(p); return t.measureText(s).width; }, w * 0.8, h * 0.72);
    let px = px0;
    // (measured once more at the size used: never wider than the box)
    t.font = NAME_FONT(px);
    while (px > 8 && Math.max(...lines.map((l) => t.measureText(l).width)) > w * 0.8) { px -= 2; t.font = NAME_FONT(px); }
    const lh = px * 1.02, top = h / 2 - ((lines.length - 1) * lh) / 2;
    const WHITE = '#f4f1ea', ORANGE = '#f0a03c';
    // each line in pieces of colour: [text, colour]
    const pieces = lines.map((l, i): [string, string][] => {
      if (lines.length > 1) return [[l, i ? ORANGE : WHITE]];
      const ws = l.split(' ');
      return ws.length > 1 ? [[ws.slice(0, -1).join(' ') + ' ', WHITE], [ws[ws.length - 1], ORANGE]] : [[l, WHITE]];
    });
    t.save(); t.translate(w / 2, 0); t.transform(1, 0, -lean, 1, 0, 0);
    for (const pass of ['edge', 'fill'] as const) pieces.forEach((ps, i) => {
      const y = top + i * lh, total = ps.reduce((a, [s]) => a + t.measureText(s).width, 0);
      let x = -total / 2 + lean * y;
      for (const [s, c] of ps) {
        if (pass === 'edge') { t.lineJoin = 'round'; t.lineWidth = px * 0.14; t.strokeStyle = '#050505'; t.shadowColor = 'rgba(0,0,0,0.85)'; t.shadowBlur = px * 0.1; t.shadowOffsetY = px * 0.05; t.strokeText(s, x, y); t.shadowBlur = 0; t.shadowOffsetY = 0; }
        else { t.fillStyle = c; t.fillText(s, x, y); }
        x += t.measureText(s).width;
      }
    });
    t.restore();
    // a dry brush: streaks worn out of the letters along the stroke
    t.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) {
      const x = r() * w, y = top - lh / 2 + r() * lh * lines.length, L = px * (0.1 + r() * 0.5);
      t.strokeStyle = `rgba(0,0,0,${0.25 + r() * 0.5})`; t.lineWidth = 1 + r() * px * 0.02;
      t.beginPath(); t.moveTo(x, y); t.lineTo(x + L * 0.25, y - L); t.stroke();
    }
    t.globalCompositeOperation = 'source-over';
    g.drawImage(lay, 0, 0);
  }
  weave(g, w, h);
}
// a kick drum's front head: black, the band's logo (or its name) in a ring (matte: a drum skin, not a lamp)
export function paintKick(g: CanvasRenderingContext2D, w: number, h: number, name: string) {
  g.fillStyle = '#121214'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#8c2030'; g.lineWidth = 6; g.beginPath(); g.arc(w / 2, h / 2, 92, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#c9c4b8'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const { lines, px } = nameLayout(name.toUpperCase(), (s, p) => { g.font = `900 ${p}px Impact, "Arial Black", sans-serif`; return g.measureText(s).width; }, 150, 110);
  g.font = `900 ${Math.min(54, px)}px Impact, "Arial Black", sans-serif`;
  lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * Math.min(54, px) * 1.05));
  speckle(g, w, h, 1500, (r) => `rgba(255,255,255,${0.02 + r() * 0.03})`, 1.5, 77);
}

// a rack unit's front: brushed panel, vents, knobs and little screens
export const rackFront = (seed: number) => make(`rack:${seed}`, 256, 512, (g, w, h) => {
  g.fillStyle = '#0d0e10'; g.fillRect(0, 0, w, h);
  const r = rnd(seed + 1), u = h / 20;
  for (let i = 0; i < 20;) {
    const size = r() < 0.3 ? 2 : 1, y = i * u;
    g.fillStyle = ['#23262c', '#2b2f36', '#1b1d22'][Math.floor(r() * 3)]; g.fillRect(6, y + 1, w - 12, size * u - 2);
    g.fillStyle = '#888'; g.fillRect(8, y + u / 2 - 1, 3, 3); g.fillRect(w - 11, y + u / 2 - 1, 3, 3);
    const kind = r();
    if (kind < 0.35) { g.fillStyle = '#000'; for (let x = 30; x < w - 40; x += 6) g.fillRect(x, y + 4, 3, size * u - 8); }       // vents
    else if (kind < 0.7) { for (let x = 30; x < w - 40; x += 22) { g.fillStyle = '#c9ccd2'; g.beginPath(); g.arc(x, y + size * u / 2, 5, 0, Math.PI * 2); g.fill(); } }   // knobs
    else { g.fillStyle = '#0b2a3a'; g.fillRect(30, y + 4, 90, size * u - 8); g.fillStyle = '#4fd1ff'; g.font = '10px monospace'; g.fillText('CH 01 -12dB', 34, y + size * u / 2 + 3); }   // a screen
    i += size;
  }
});

// a drum's wrap: sparkle finish
export const sparkle = (hex: string) => make(`sparkle:${hex}`, 256, 128, (g, w, h) => {
  g.fillStyle = hex; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 2500, (r) => `rgba(255,255,255,${0.1 + r() * 0.35})`, 1.2, 21);
});

// screens: a lighting desk's (cue buttons, the fixture sheet), the FOH's meters, a laptop's
export const screen = (kind: 'desk' | 'meters' | 'sheet' | 'laptop') => make(`screen:${kind}`, 512, 256, (g, w, h) => {
  g.fillStyle = '#05080c'; g.fillRect(0, 0, w, h);
  const r = rnd(kind === 'desk' ? 4 : kind === 'sheet' ? 6 : 8);
  if (kind === 'desk') {
    for (let i = 0; i < 24; i++) { const x = 10 + (i % 8) * 62, y = 12 + Math.floor(i / 8) * 78; g.fillStyle = `hsl(${Math.floor(r() * 360)},70%,${30 + r() * 25}%)`; g.fillRect(x, y, 54, 60); g.fillStyle = '#fff'; g.font = '11px sans-serif'; g.fillText(`Cue ${i + 1}`, x + 4, y + 14); }
  } else if (kind === 'sheet') {
    g.font = '10px monospace';
    for (let y = 0; y < 22; y++) { g.fillStyle = y % 2 ? '#0c1218' : '#101820'; g.fillRect(0, y * 11.6, w, 11.6); for (let c = 0; c < 8; c++) { const v = Math.floor(r() * 100); g.fillStyle = c ? (v > 60 ? '#ffd24a' : '#7fd4ff') : '#c8c8c8'; g.fillText(c ? String(v) : `${101 + y}`, 6 + c * 62, y * 11.6 + 9); } }
  } else if (kind === 'laptop') {
    g.fillStyle = '#1a1f2a'; g.fillRect(0, 0, w, 18); g.fillStyle = '#2a7ad8'; g.fillRect(0, 18, 90, h - 18);
    for (let i = 0; i < 6; i++) { g.fillStyle = `hsl(${(i * 47) % 360},60%,45%)`; g.fillRect(110, 34 + i * 34, 150 + r() * 220, 22); }
  } else {
    for (let i = 0; i < 32; i++) { const x = 8 + i * 15.5, v = r(); g.fillStyle = '#123'; g.fillRect(x, 20, 10, h - 40); g.fillStyle = v > 0.8 ? '#ff4040' : v > 0.6 ? '#ffc040' : '#40e070'; g.fillRect(x, 20 + (h - 40) * (1 - v), 10, (h - 40) * v); }
  }
});

// denim: diagonal twill and wear, light grey (the trousers' colour tints it)
export const denim = () => make('denim', 256, 256, (g, w, h) => {
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h);
  for (let i = -h; i < w; i += 3) { g.strokeStyle = `rgba(0,0,0,${0.08 + ((i * 7) % 5) * 0.012})`; g.lineWidth = 1; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); }
  speckle(g, w, h, 2500, (r) => `rgba(255,255,255,${0.05 + r() * 0.1})`, 2, 11);
}, { repeat: [2, 2] });
// knitted wool (a beanie)
export const knit = () => make('knit', 128, 128, (g, w, h) => {
  g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 8) for (let y = 0; y < h; y += 8) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(x + 2, y + 4, 2, 4, 0.4, 0, Math.PI * 2); g.ellipse(x + 6, y + 4, 2, 4, -0.4, 0, Math.PI * 2); g.fill(); }
}, { repeat: [4, 2] });
// a T-shirt: its colour, and a print on the chest (a band name, a logo) or nothing
export const shirtPrint = (color: number, print: string) => make(`shirt:${color}:${print}`, 512, 256, (g, w, h) => {
  const hex = '#' + color.toString(16).padStart(6, '0');
  g.fillStyle = hex; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 1500, (r) => `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},0.05)`, 2, 5);
  // a hem at the bottom, a collar at the top
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, h - 10, w, 3); g.fillRect(0, 4, w, 4);
  if (!print) return;
  const lum = ((color >> 16) & 255) * 0.3 + ((color >> 8) & 255) * 0.59 + (color & 255) * 0.11, ink = lum > 140 ? '#151515' : '#f2efe6';
  // (the front of the shirt is the middle of the picture; the chest is the upper half)
  g.save(); g.translate(w / 2, h * 0.43); g.fillStyle = ink; g.strokeStyle = ink;
  const lines = print.split('|');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (lines[0] === '*') { g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.stroke(); g.font = 'bold 28px sans-serif'; g.fillText('★', 0, 2); }
  else lines.forEach((l, i) => { g.font = `${i ? '' : 'bold '}${i ? 13 : 19}px sans-serif`; g.fillText(l, 0, (i - (lines.length - 1) / 2) * 20, 104); });
  g.restore();
});

// ---- the crowd: shirts, faces, flags

// Every crowd shirt in one picture (one draw for all the torsos): 4 x 8 shirts of 256 x 128, each
// wrapped round a body with the back in the left half and the front in the right half (the sides
// at the edges). The first PLAIN are white and take each person's colour (plain, stripes, flannel,
// a hoodie...); the rest are band shirts in their own colours, print on the front and the back.
export const SHIRT_COLS = 4, SHIRT_ROWS = 8, PLAIN_SHIRTS = 8;
type Motif = 'tour' | 'big' | 'star' | 'bolt' | 'wave' | 'number' | 'circle' | 'none';
const BAND_SHIRTS: { bg: string; ink: string; front: string; back: Motif; sub?: string }[] = [
  { bg: '#111114', ink: '#f2efe6', front: 'WANTB', back: 'tour', sub: 'WORLD TOUR' },
  { bg: '#121212', ink: '#e8d43a', front: 'NOISE FLOOR', back: 'wave' },
  { bg: '#ecebe6', ink: '#1a1a1a', front: 'THE DMX', back: 'big' },
  { bg: '#8c1c1c', ink: '#f4ecd8', front: 'PAR CANS', back: 'star' },
  { bg: '#1b2440', ink: '#f2efe6', front: 'BLACKOUT', back: 'tour', sub: 'EUROPE' },
  { bg: '#5e6066', ink: '#111111', front: 'FOG MACHINE', back: 'circle' },
  { bg: '#0f0f10', ink: '#ff3d8a', front: 'STROBE KIDS', back: 'bolt' },
  { bg: '#1f4a2c', ink: '#f2e6c4', front: 'GOBO', back: 'big' },
  { bg: '#c99a2e', ink: '#1a1408', front: 'LUX', back: 'number' },
  { bg: '#f1f0ea', ink: '#c2202a', front: 'FEEDBACK', back: 'wave' },
  { bg: '#101012', ink: '#52d6e8', front: 'HAZE', back: 'tour', sub: 'SUMMER' },
  { bg: '#3a1830', ink: '#f2c6e0', front: 'THE CUES', back: 'star' },
  { bg: '#141414', ink: '#e04a1c', front: 'LOW END', back: 'bolt' },
  { bg: '#2c2f36', ink: '#e6e6e6', front: 'MOSH', back: 'number' },
  { bg: '#0d0d0f', ink: '#ffffff', front: 'WE ARE NOT|THE BAND', back: 'tour', sub: 'LIVE TONIGHT' },
  { bg: '#e8462a', ink: '#141414', front: 'DROP', back: 'circle' },
  { bg: '#121216', ink: '#9ae05a', front: 'NO SIGNAL', back: 'wave' },
  { bg: '#24345c', ink: '#f6d04a', front: 'UNIVERSE 1', back: 'number' },
  { bg: '#f2f2ee', ink: '#1d3fa0', front: 'CUE 99', back: 'star' },
  { bg: '#151515', ink: '#d9d9d9', front: 'CREW', back: 'big' },
  { bg: '#6b2a8a', ink: '#ffffff', front: 'GLITTER', back: 'star' },
  { bg: '#0f1a12', ink: '#e8e0c8', front: 'FADER', back: 'circle' },
  { bg: '#b8b8b2', ink: '#202020', front: 'SUB BASS', back: 'wave' },
  { bg: '#191919', ink: '#ffb02e', front: 'ENCORE', back: 'tour', sub: 'ONE MORE' },
];
// a band shirt's colour (its sleeves are the same), or undefined for a plain (tinted) one
export const shirtColor = (i: number): number | undefined => i < PLAIN_SHIRTS ? undefined : parseInt(BAND_SHIRTS[(i - PLAIN_SHIRTS) % BAND_SHIRTS.length].bg.slice(1), 16);
export const SHIRTS = PLAIN_SHIRTS + BAND_SHIRTS.length;
export const shirtAtlas = () => make('shirts', 1024, 1024, (g) => {
  const cw = 256, ch = 128;
  const cell = (i: number, draw: (r: () => number) => void) => {
    g.save(); g.translate((i % SHIRT_COLS) * cw, Math.floor(i / SHIRT_COLS) * ch); g.beginPath(); g.rect(0, 0, cw, ch); g.clip(); draw(rnd(31 + i * 7)); g.restore();
  };
  const fabric = (bg: string, r: () => number) => {
    g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
    for (let k = 0; k < 250; k++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},0.05)`; g.fillRect(r() * cw, r() * ch, 2, 2); }
    // soft folds, a collar at the top, a hem at the bottom
    for (let k = 0; k < 6; k++) { const x = r() * cw, gr = g.createLinearGradient(x - 10, 0, x + 10, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - 10, ch * 0.3, 20, ch * 0.7); }
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, 0, cw, 4); g.fillRect(0, ch - 7, cw, 2);
  };
  // plain shirts: white, with what makes them different in grey (the person's colour tints it all)
  const plain: ((r: () => number) => void)[] = [
    () => {},
    () => { g.fillStyle = '#9a9a9a'; g.beginPath(); g.arc(212, 34, 6, 0, Math.PI * 2); g.fill(); },
    () => { g.fillStyle = 'rgba(0,0,0,0.32)'; for (let y = 10; y < ch - 8; y += 14) g.fillRect(0, y, cw, 6); },
    () => { g.fillStyle = 'rgba(0,0,0,0.22)'; for (let x = 0; x < cw; x += 20) g.fillRect(x, 0, 8, ch); for (let y = 0; y < ch; y += 20) g.fillRect(0, y, cw, 8); g.fillStyle = 'rgba(255,255,255,0.25)'; for (let x = 0; x < cw; x += 20) g.fillRect(x + 12, 0, 1, ch); },
    () => { g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; g.strokeRect(172, 84, 40, 22); g.beginPath(); g.moveTo(186, 6); g.lineTo(184, 30); g.moveTo(198, 6); g.lineTo(200, 30); g.stroke(); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(30, 0, 68, 16); },
    () => { g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, cw, 9); g.fillRect(0, ch - 12, cw, 10); },
    () => { g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(cw, 0); g.lineTo(cw, 18); g.lineTo(150, 34); g.lineTo(106, 34); g.lineTo(0, 18); g.fill(); },
    () => { g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.moveTo(178, 0); g.lineTo(192, 22); g.lineTo(206, 0); g.fill(); },
  ];
  plain.forEach((d, i) => cell(i, (r) => { fabric('#f2f2f2', r); d(r); }));
  BAND_SHIRTS.forEach((s, k) => cell(PLAIN_SHIRTS + k, (r) => {
    fabric(s.bg, r);
    g.fillStyle = s.ink; g.strokeStyle = s.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    // the front: the band's name on the chest
    const lines = s.front.split('|');
    lines.forEach((l, i) => { const px = fit(g, l, (p) => `900 ${p}px Impact, "Arial Black", sans-serif`, 72, 20); g.fillText(l, 192, 40 + (i - (lines.length - 1) / 2) * (px + 2)); });
    // the back: a tour list, a big name, a number, a picture
    const cx = 64, cy = 52;
    if (s.back === 'tour') {
      g.font = `900 ${fit(g, s.sub ?? 'TOUR', (p) => `900 ${p}px Impact, "Arial Black", sans-serif`, 84, 16)}px Impact, "Arial Black", sans-serif`; g.fillText(s.sub ?? 'TOUR', cx, 22);
      g.font = '7px sans-serif'; for (let i = 0; i < 9; i++) g.fillText(`${String(3 + i * 3).padStart(2, '0')}.${['06', '07', '08'][i % 3]}  ${['BERLIN', 'LONDON', 'PARIS', 'OSLO', 'MADRID', 'ROMA', 'WIEN', 'PRAHA', 'DUBLIN'][i]}`, cx, 36 + i * 8.5);
    } else if (s.back === 'big') { const px = fit(g, lines[0], (p) => `900 ${p}px Impact, "Arial Black", sans-serif`, 88, 34); g.font = `900 ${px}px Impact, "Arial Black", sans-serif`; g.fillText(lines[0], cx, cy); }
    else if (s.back === 'number') { g.font = '900 52px Impact, "Arial Black", sans-serif'; g.fillText(String(1 + Math.floor(r() * 23)), cx, cy + 8); g.font = '900 12px sans-serif'; g.fillText(lines[0], cx, 18); }
    else if (s.back === 'star') { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 12 : 30; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.fill(); }
    else if (s.back === 'bolt') { g.beginPath(); g.moveTo(cx + 8, 16); g.lineTo(cx - 16, 56); g.lineTo(cx - 2, 56); g.lineTo(cx - 10, 92); g.lineTo(cx + 18, 46); g.lineTo(cx + 3, 46); g.closePath(); g.fill(); }
    else if (s.back === 'wave') { g.lineWidth = 4; g.beginPath(); for (let x = -40; x <= 40; x += 2) g.lineTo(cx + x, cy + Math.sin(x * 0.25) * 18 * Math.cos(x * 0.04)); g.stroke(); }
    else if (s.back === 'circle') { g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, 26, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(cx, cy, 10, 0, Math.PI * 2); g.fill(); }
    // a little wear on the print
    for (let i = 0; i < 160; i++) { g.fillStyle = s.bg; g.globalAlpha = 0.5; g.fillRect(r() * cw, r() * ch * 0.8, 1.5, 1.5); }
    g.globalAlpha = 1;
  }));
}, { color: true });

// a face for the crowd's heads (a sphere's map: the front is a quarter of the way along), drawn in
// greys on white so each person's skin colour tints it: brows, eyes, the shadow of the nose, lips
export const crowdFace = () => make('face', 256, 128, (g, w, h) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  const cx = 64;
  // cheeks and the eye sockets: soft shading
  const soft = (x: number, y: number, rx: number, ry: number, c: string) => { const gr = g.createRadialGradient(x, y, 0, x, y, rx); gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.save(); g.translate(x, y); g.scale(1, ry / rx); g.translate(-x, -y); g.fillStyle = gr; g.fillRect(x - rx, y - rx, rx * 2, rx * 2); g.restore(); };
  for (const sx of [-1, 1]) { soft(cx + sx * 14, 61, 9, 6, 'rgba(120,80,70,0.35)'); soft(cx + sx * 17, 80, 10, 8, 'rgba(210,90,90,0.18)'); }
  soft(cx, 74, 5, 9, 'rgba(110,70,60,0.3)');
  for (const sx of [-1, 1]) {
    g.fillStyle = '#f7f3ee'; g.beginPath(); g.ellipse(cx + sx * 14, 62, 4.6, 2.4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a1c14'; g.beginPath(); g.arc(cx + sx * 14, 62, 2.1, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4a3428'; g.save(); g.translate(cx + sx * 14, 55.5); g.rotate(sx * -0.12); g.fillRect(-6, -1.2, 12, 2.6); g.restore();
  }
  g.fillStyle = 'rgba(150,60,60,0.75)'; g.beginPath(); g.ellipse(cx, 90, 7.5, 2.2, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(60,20,20,0.6)'; g.fillRect(cx - 7, 89.5, 14, 1);
  // a little stubble shadow round the jaw on some heads is the hair's job; the back stays plain
}, { color: true });

// flags people wave: 2 x 2 in one picture (the pole on the left of each)
export const FLAGS = 4;
export const flagAtlas = () => make('flags', 512, 320, (g) => {
  const cw = 256, ch = 160;
  const cell = (i: number, draw: () => void) => { g.save(); g.translate((i % 2) * cw, Math.floor(i / 2) * ch); g.beginPath(); g.rect(0, 0, cw, ch); g.clip(); draw(); g.restore(); };
  cell(0, () => { ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'].forEach((c, i) => { g.fillStyle = c; g.fillRect(0, (i * ch) / 6, cw, ch / 6 + 1); }); });
  cell(1, () => {
    g.fillStyle = '#0c0b14'; g.fillRect(0, 0, cw, ch); g.fillStyle = '#ff2d78'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${fit(g, 'WANTB', (p) => `900 ${p}px Impact, "Arial Black", sans-serif`, cw * 0.8, 70)}px Impact, "Arial Black", sans-serif`; g.fillText('WANTB', cw / 2, ch / 2);
    g.strokeStyle = '#ff2d78'; g.lineWidth = 4; g.strokeRect(10, 10, cw - 20, ch - 20);
  });
  cell(2, () => { for (let y = 0; y < 5; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 32, y * 32, 32, 32); } });
  cell(3, () => {
    ['#1a7a6e', '#f2c230', '#5a2a82'].forEach((c, i) => { g.fillStyle = c; g.fillRect((i * cw) / 3, 0, cw / 3 + 1, ch); });
    g.fillStyle = '#ffffff'; g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 12 : 28; g.lineTo(cw / 2 + Math.cos(a) * r, ch / 2 + Math.sin(a) * r); } g.fill();
  });
  // cloth: a weave and a few creases
  weave(g, 512, 320);
}, { color: true });

// ---- the gear and the hall

// road-case stencils: white spray paint on the case's black, one word per row
export const STENCILS = ['WANTB  BACKLINE', 'FRAGILE', 'STAGE LEFT', 'DRUMS', 'GTR 1', 'BASS RIG', 'MON WORLD', 'LX 07'];
export const stencils = () => make('stencils', 512, 512, (g, w) => {
  // (on the case's own black, so it needs no see-through: it shares a shader with the case)
  g.fillStyle = '#1a1a1c'; g.fillRect(0, 0, w, 512);
  speckle(g, w, 512, 3000, (rr) => `rgba(${rr() < 0.5 ? '255,255,255' : '0,0,0'},${0.04 + rr() * 0.05})`, 1.5, 43);
  const r = rnd(41);
  STENCILS.forEach((t, i) => {
    const y = i * 64 + 32;
    g.fillStyle = '#f2f0e8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const px = fit(g, t, (p) => `900 ${p}px "Arial Black", Impact, sans-serif`, w * 0.86, 44);
    g.font = `900 ${px}px "Arial Black", Impact, sans-serif`; g.fillText(t, w / 2, y);
    // the stencil's bridges (gaps in the letters) and overspray
    g.fillStyle = '#1a1a1c';
    for (let x = 30; x < w - 30; x += 11 + r() * 9) g.fillRect(x, y - 2, 2, 4);
    for (let k = 0; k < 120; k++) { g.fillStyle = `rgba(242,240,232,${0.15 + r() * 0.3})`; g.fillRect(w / 2 + (r() - 0.5) * w * 0.9, y + (r() - 0.5) * px * 1.2, 1, 1); }
  });
});

// black stage skirt (molton) hanging in folds
export const pleats = () => make('pleats', 256, 64, (g, w, h) => {
  for (let x = 0; x < w; x++) { const v = 14 + Math.round(9 * (0.5 + 0.5 * Math.sin((x / w) * Math.PI * 2 * 8)) + 4 * Math.sin((x / w) * Math.PI * 2 * 19)); g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(x, 0, 1, h); }
  speckle(g, w, h, 600, (r) => `rgba(255,255,255,${0.02 + r() * 0.03})`, 1, 17);
}, { repeat: [1, 1] });

// a guitar cab's grille cloth: dark with a salt-and-pepper weave
export const cabCloth = () => make('cabcloth', 256, 256, (g, w, h) => {
  g.fillStyle = '#1d1c1a'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 4) for (let x = (y / 4) % 2 ? 0 : 2; x < w; x += 4) { g.fillStyle = (x * 7 + y * 13) % 5 ? 'rgba(200,190,170,0.18)' : 'rgba(230,220,200,0.32)'; g.fillRect(x, y, 2, 2); }
}, { repeat: [2, 2] });

// the back of an LED wall: a grid of cabinets, each with handles, a status light and connectors
export const ledBack = () => make('ledback', 256, 256, (g, w, h) => {
  g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#2a2d33'; g.fillRect(3, 3, w - 6, h - 6);
  g.fillStyle = '#1d2024'; g.fillRect(24, 24, w - 48, h - 48);
  g.fillStyle = '#5b6068'; for (const y of [10, h - 18]) g.fillRect(w / 2 - 34, y, 68, 8);
  g.fillStyle = '#121316'; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(70 + i * 38, h / 2 + 50, 8, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#3aff6a'; g.fillRect(40, h / 2 - 40, 6, 6);
  g.fillStyle = 'rgba(255,255,255,0.08)'; for (let y = 40; y < h - 40; y += 6) g.fillRect(40, y, w - 80, 2);
}, { repeat: [1, 1] });

// the hall: painted concrete block walls (one picture is 6.4 x 3.2 m; the walls set their own UVs)
export const hallWall = () => make('hallwall', 512, 256, (g, w, h) => {
  g.fillStyle = '#2c2d33'; g.fillRect(0, 0, w, h);
  const r = rnd(61), bw = 32, bh = 16;
  for (let y = 0; y < h; y += bh) for (let x = ((y / bh) % 2) * (bw / 2) - bw; x < w; x += bw) {
    const v = 52 + Math.floor(r() * 14); g.fillStyle = `rgb(${v},${v + 1},${v + 5})`; g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
  }
  speckle(g, w, h, 5000, (rr) => `rgba(${rr() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + rr() * 0.05})`, 1.5, 63);
  // damp streaks and scuffs low down
  for (let i = 0; i < 12; i++) { const x = r() * w, gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = gr; g.fillRect(x, 0, 4 + r() * 10, h); }
}, { repeat: [1, 1] });
// the roof: corrugated steel deck, dark
export const roofDeck = () => make('roofdeck', 256, 256, (g, w, h) => {
  for (let x = 0; x < w; x++) { const v = 38 + Math.round(12 * (0.5 + 0.5 * Math.sin((x / w) * Math.PI * 2 * 8))); g.fillStyle = `rgb(${v},${v + 1},${v + 4})`; g.fillRect(x, 0, 1, h); }
}, { repeat: [1, 1] });
// an exit sign: green, white letters, the running man and an arrow
export const exitSign = () => make('exit', 256, 128, (g, w, h) => {
  g.fillStyle = '#0b8a3e'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.arc(42, 30, 8, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(40, 42); g.lineTo(34, 72); g.lineTo(22, 98); g.moveTo(34, 72); g.lineTo(52, 86); g.lineTo(56, 104); g.moveTo(38, 52); g.lineTo(22, 60); g.moveTo(39, 50); g.lineTo(56, 60); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 52px "Arial Black", Impact, sans-serif'; g.fillText('EXIT', 160, 66, 140);
  g.beginPath(); g.moveTo(96, 108); g.lineTo(226, 108); g.moveTo(212, 98); g.lineTo(226, 108); g.lineTo(212, 118); g.lineWidth = 5; g.stroke();
});
// a stage box's front: 4 x 8 XLR sockets with their numbers
export const stageBoxPanel = () => make('stagebox', 256, 128, (g, w, h) => {
  g.fillStyle = '#2a2d31'; g.fillRect(0, 0, w, h);
  g.font = '8px sans-serif'; g.textAlign = 'center';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
    const x = 18 + c * 30, y = 18 + r * 30;
    g.fillStyle = '#0d0e10'; g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6a6f78'; for (const [dx, dy] of [[-4, -2], [4, -2], [0, 4]]) { g.beginPath(); g.arc(x + dx, y + dy, 1.4, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#d8dce2'; g.fillText(String(r * 8 + c + 1), x + 12, y - 8);
  }
});
// a cable ramp seen from above: a yellow lid in the middle, black ramps either side
export const cableRamp = () => make('ramp', 64, 256, (g, w, h) => {
  g.fillStyle = '#161616'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#e6c21a'; g.fillRect(w * 0.3, 0, w * 0.4, h);
  g.fillStyle = 'rgba(0,0,0,0.5)'; for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 2);
  g.fillStyle = 'rgba(255,255,255,0.06)'; for (let y = 0; y < h; y += 6) { g.fillRect(0, y, w * 0.28, 2); g.fillRect(w * 0.72, y, w * 0.28, 2); }
}, { repeat: [1, 1] });
// the drummer's rug: a worn patterned carpet
export const rug = () => make('rug', 512, 512, (g, w, h) => {
  g.fillStyle = '#5a1418'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#1f2a4a'; g.lineWidth = 26; g.strokeRect(24, 24, w - 48, h - 48);
  g.strokeStyle = '#d8c79a'; g.lineWidth = 6; g.strokeRect(46, 46, w - 92, h - 92); g.strokeRect(12, 12, w - 24, h - 24);
  g.fillStyle = '#1f2a4a'; g.beginPath(); g.moveTo(w / 2, 110); g.lineTo(w - 150, h / 2); g.lineTo(w / 2, h - 110); g.lineTo(150, h / 2); g.closePath(); g.fill();
  g.fillStyle = '#d8c79a'; g.beginPath(); g.moveTo(w / 2, 160); g.lineTo(w - 200, h / 2); g.lineTo(w / 2, h - 160); g.lineTo(200, h / 2); g.closePath(); g.fill();
  g.fillStyle = '#7a1c22'; g.beginPath(); g.arc(w / 2, h / 2, 40, 0, Math.PI * 2); g.fill();
  const r = rnd(71);
  for (let i = 0; i < 160; i++) { g.fillStyle = ['#d8c79a', '#1f2a4a', '#8a2a2a'][i % 3]; g.fillRect(70 + r() * (w - 140), 70 + r() * (h - 140), 4, 4); }
  speckle(g, w, h, 9000, (rr) => `rgba(${rr() < 0.5 ? '255,255,255' : '0,0,0'},${0.04 + rr() * 0.06})`, 2, 73);
});
// a kick drum's front head with the band's logo (paintKick)
export const kickHead = () => make('kickhead', 256, 256, (g, w, h) => paintKick(g, w, h, 'WANTB'));
// a mixing desk's or a lighting desk's top: strips of knobs, buttons, little screens, fader slots
export const consoleTop = (kind: 'sound' | 'light') => make(`console:${kind}`, 1024, 512, (g, w, h) => {
  g.fillStyle = '#26292e'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 4000, (r) => `rgba(255,255,255,${0.02 + r() * 0.03})`, 1.5, 81);
  const r = rnd(kind === 'sound' ? 83 : 85);
  const knob = (x: number, y: number, rr: number, cap = '#c9ccd2') => { g.fillStyle = '#0c0d0f'; g.beginPath(); g.arc(x, y, rr + 2, 0, Math.PI * 2); g.fill(); g.fillStyle = cap; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 2; const a = r() * Math.PI * 1.5 - Math.PI * 1.25; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); g.stroke(); };
  const btn = (x: number, y: number, c: string, bw = 18, bh = 10) => { g.fillStyle = '#0c0d0f'; g.fillRect(x - 1, y - 1, bw + 2, bh + 2); g.fillStyle = c; g.fillRect(x, y, bw, bh); };
  if (kind === 'sound') {
    // 24 channel strips on the left, the master section and its screen on the right
    for (let c = 0; c < 24; c++) {
      const x = 14 + c * 30;
      g.fillStyle = '#1a2c3a'; g.fillRect(x, 10, 26, 14); g.fillStyle = '#7fd4ff'; g.fillRect(x + 3, 15, 14 + r() * 6, 3);
      for (let k = 0; k < 6; k++) knob(x + 13, 44 + k * 26, 7, k === 5 ? '#e8b030' : '#c9ccd2');
      btn(x + 4, 206, r() < 0.15 ? '#ff4040' : '#5a1a1a'); btn(x + 4, 222, r() < 0.1 ? '#ffd040' : '#5a4a1a'); btn(x + 4, 238, '#2a5a2a');
      g.fillStyle = '#0a0b0c'; g.fillRect(x + 11, 268, 4, 220);
      for (let y = 272; y < 486; y += 12) { g.fillStyle = '#555'; g.fillRect(x + 4, y, 3, 1); }
    }
    g.fillStyle = '#060708'; g.fillRect(744, 16, 266, 170);
    for (let k = 0; k < 12; k++) btn(748 + (k % 6) * 44, 200 + Math.floor(k / 6) * 22, ['#3a6aa0', '#a03a3a', '#3aa05a'][k % 3], 36, 14);
    for (let k = 0; k < 4; k++) knob(770 + k * 62, 270, 14);
    g.fillStyle = '#0a0b0c'; for (let k = 0; k < 4; k++) g.fillRect(782 + k * 62, 300, 5, 190);
  } else {
    // a fader wing on the left (faders at the front, by the hands), the programmer in the middle
    // (encoders, keys, a trackball), executors on the right
    for (let c = 0; c < 15; c++) {
      const x = 16 + c * 26;
      btn(x, 30, '#1a1d22', 20, 12); g.fillStyle = r() < 0.4 ? '#ffb030' : '#40c0ff'; g.fillRect(x + 2, 32, 16, 3);
      btn(x, 160, '#3a3d44', 20, 14); btn(x, 180, '#3a3d44', 20, 14); btn(x, 200, '#3a3d44', 20, 14);
      g.fillStyle = '#0a0b0c'; g.fillRect(x + 8, 250, 4, 230);
    }
    for (let k = 0; k < 4; k++) knob(450 + k * 70, 60, 22, '#3a3d44');
    for (let y = 0; y < 5; y++) for (let x = 0; x < 4; x++) btn(450 + x * 44, 120 + y * 34, '#4a4d54', 36, 26);
    g.fillStyle = '#0c0d0f'; g.beginPath(); g.arc(700, 380, 34, 0, Math.PI * 2); g.fill(); g.fillStyle = '#7a8088'; g.beginPath(); g.arc(700, 380, 26, 0, Math.PI * 2); g.fill();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) btn(640 + x * 40, 120 + y * 30, ['#b02a2a', '#2a8a3a', '#2a5ab0', '#b0902a'][(x + y) % 4], 32, 20);
    for (let c = 0; c < 8; c++) { const x = 790 + c * 28; btn(x, 30, '#1a1d22', 20, 12); g.fillStyle = '#0a0b0c'; g.fillRect(x + 8, 250, 4, 230); }
  }
});

// ---- the pub
// old brick walls (one picture is 2.0 x 1.0 m: 8 courses), soot and paint wear; the walls set their own UVs
export const brick = () => make('brick', 512, 256, (g, w, h) => {
  g.fillStyle = '#3a3330'; g.fillRect(0, 0, w, h);
  const r = rnd(101), bw = 64, bh = 32;
  for (let y = 0; y < h; y += bh) for (let x = ((y / bh) % 2) * (bw / 2) - bw; x < w; x += bw) {
    const v = r(), red = 96 + Math.floor(v * 46), gr = 44 + Math.floor(v * 22), bl = 32 + Math.floor(v * 14);
    g.fillStyle = r() < 0.08 ? `rgb(${red - 40},${gr - 18},${bl - 10})` : `rgb(${red},${gr},${bl})`; g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
  }
  speckle(g, w, h, 9000, (rr) => `rgba(${rr() < 0.5 ? '255,235,220' : '0,0,0'},${0.04 + rr() * 0.07})`, 1.8, 103);
  // soot rising, a little old white paint left here and there
  for (let i = 0; i < 10; i++) { const x = r() * w, gg = g.createLinearGradient(0, 0, 0, h); gg.addColorStop(0, 'rgba(0,0,0,0.25)'); gg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gg; g.fillRect(x, 0, 30 + r() * 60, h); }
  for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(220,214,200,${0.06 + r() * 0.08})`; g.fillRect(r() * w, r() * h, 10 + r() * 40, 6 + r() * 20); }
}, { repeat: [1, 1] });
// floorboards along the room (one picture is 2 x 2 m: 14 boards), worn where people stand
export const boards = () => make('boards', 512, 512, (g, w, h) => {
  const r = rnd(107), bw = w / 14;
  for (let i = 0; i < 14; i++) {
    const v = r(); g.fillStyle = `rgb(${70 + Math.floor(v * 30)},${44 + Math.floor(v * 18)},${26 + Math.floor(v * 10)})`; g.fillRect(i * bw, 0, bw, h);
    // grain along the board, a joint across it somewhere
    for (let k = 0; k < 7; k++) { g.strokeStyle = `rgba(20,10,4,${0.12 + r() * 0.18})`; g.lineWidth = 1; g.beginPath(); const x = i * bw + r() * bw; g.moveTo(x, 0); g.bezierCurveTo(x + (r() - 0.5) * 6, h / 3, x + (r() - 0.5) * 6, (2 * h) / 3, x, h); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(i * bw, 0, 1.5, h); g.fillRect(i * bw, Math.floor(r() * h), bw, 2);
  }
  speckle(g, w, h, 5000, (rr) => `rgba(${rr() < 0.5 ? '255,230,200' : '0,0,0'},${0.03 + rr() * 0.05})`, 1.5, 109);
}, { repeat: [1, 1] });
// dark varnished wood: the bar, the panelling
export const darkWood = () => make('darkwood', 256, 256, (g, w, h) => {
  g.fillStyle = '#3b2416'; g.fillRect(0, 0, w, h);
  const r = rnd(113);
  for (let k = 0; k < 60; k++) { g.strokeStyle = `rgba(${r() < 0.3 ? '120,70,40' : '18,8,3'},${0.15 + r() * 0.25})`; g.lineWidth = 1 + r() * 1.5; g.beginPath(); const y = r() * h; g.moveTo(0, y); g.bezierCurveTo(w / 3, y + (r() - 0.5) * 10, (2 * w) / 3, y + (r() - 0.5) * 10, w, y); g.stroke(); }
}, { repeat: [1, 1] });
// a neon sign: glass tubes on a black board (lit: bright enough to glow)
export const neonSign = (text: string, color: string) => make(`neon:${text}:${color}`, 1024, 256, (g, w, h) => {
  g.fillStyle = '#060607'; g.fillRect(0, 0, w, h);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `italic 700 ${fit(g, text, (p) => `italic 700 ${p}px "Brush Script MT", "Segoe Script", cursive, sans-serif`, w * 0.86, 150)}px "Brush Script MT", "Segoe Script", cursive, sans-serif`;
  g.lineJoin = 'round'; g.strokeStyle = color; g.shadowColor = color;
  for (const [lw, blur] of [[16, 40], [9, 18], [4, 4]] as const) { g.lineWidth = lw; g.shadowBlur = blur; g.strokeText(text, w / 2, h / 2); }
  g.shadowBlur = 0; g.lineWidth = 2; g.strokeStyle = '#ffffff'; g.strokeText(text, w / 2, h / 2);
});
