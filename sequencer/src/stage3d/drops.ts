// The painted drops a fly bar lowers into a theatre (rig.ts): a forest, a city by night, a starry
// sky, a castle at sunset, the sea, a sky of clouds. Painted once each on a canvas, like a scene
// painter's cloth: big shapes, a few colours, so the stage's light still colours them.
import * as THREE from 'three';

export const DROP_PICTURES = ['forest', 'city', 'stars', 'castle', 'sea', 'clouds'] as const;
export type DropPicture = (typeof DROP_PICTURES)[number];
export const isDropPicture = (p: unknown): p is DropPicture => (DROP_PICTURES as readonly string[]).includes(p as string);

const made = new Map<string, THREE.Texture>();
// (a plain colour without a 2D canvas: the tests' page)
export function dropTexture(name: string): THREE.Texture | null {
  const key = isDropPicture(name) ? name : 'forest';
  const had = made.get(key);
  if (had) return had;
  const c = document.createElement('canvas'); c.width = 512; c.height = 288;
  const g = c.getContext('2d');
  if (!g) return null;
  paint(g, key, c.width, c.height);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  made.set(key, tex);
  return tex;
}

function paint(g: CanvasRenderingContext2D, k: DropPicture, W: number, H: number) {
  let s = 11;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const sky = (top: string, mid: string, low: string) => { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, top); gr.addColorStop(0.6, mid); gr.addColorStop(1, low); g.fillStyle = gr; g.fillRect(0, 0, W, H); };
  const hills = (y: number, amp: number, col: string, f = 0.012) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 8) g.lineTo(x, y + Math.sin(x * f + y) * amp + Math.sin(x * f * 3.1) * amp * 0.35); g.lineTo(W, H); g.fill(); };
  if (k === 'forest') {
    sky('#7fb6d6', '#cfe3c8', '#a8c890');
    hills(190, 14, '#5d8a5a'); hills(220, 10, '#3d6a3c');
    for (let i = 0; i < 46; i++) {
      const x = rnd() * W, h = 70 + rnd() * 120, y = H - rnd() * 40, w = h * 0.38;
      g.fillStyle = '#4a3020'; g.fillRect(x - 3, y - h * 0.25, 6, h * 0.25);
      g.fillStyle = ['#1f4a26', '#2b5e2e', '#173a1d'][i % 3];
      g.beginPath(); g.moveTo(x, y - h); g.lineTo(x - w / 2, y - h * 0.2); g.lineTo(x + w / 2, y - h * 0.2); g.fill();
    }
  } else if (k === 'city') {
    sky('#060a1e', '#1a2250', '#3a2a50');
    for (let i = 0; i < 60; i++) { g.fillStyle = '#fff8'; g.fillRect(rnd() * W, rnd() * H * 0.45, 1.5, 1.5); }
    for (let x = 0; x < W;) {
      const w = 24 + rnd() * 46, h = 60 + rnd() * 170;
      g.fillStyle = ['#0c0f1c', '#12162a', '#0a0c16'][Math.floor(rnd() * 3)]; g.fillRect(x, H - h, w, h);
      for (let wy = H - h + 8; wy < H - 6; wy += 11) for (let wx = x + 5; wx < x + w - 6; wx += 9) if (rnd() < 0.42) { g.fillStyle = rnd() < 0.8 ? '#ffd27a' : '#9ad4ff'; g.fillRect(wx, wy, 4, 5); }
      x += w + 2;
    }
  } else if (k === 'stars') {
    sky('#02030a', '#0a1430', '#1a2a50');
    for (let i = 0; i < 260; i++) { const r = rnd() < 0.08 ? 2 : 1; g.fillStyle = rnd() < 0.15 ? '#cfe0ff' : '#ffffff'; g.fillRect(rnd() * W, rnd() * H * 0.8, r, r); }
    g.fillStyle = '#fff6d8'; g.beginPath(); g.arc(W * 0.75, H * 0.25, 26, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0a1430'; g.beginPath(); g.arc(W * 0.75 + 10, H * 0.25 - 6, 24, 0, Math.PI * 2); g.fill();
    hills(250, 8, '#05070e', 0.02);
  } else if (k === 'castle') {
    sky('#2a1a4a', '#d8664a', '#f2b45a');
    g.fillStyle = '#ffd58a'; g.beginPath(); g.arc(W * 0.3, H * 0.62, 34, 0, Math.PI * 2); g.fill();
    hills(225, 12, '#2a1828');
    g.fillStyle = '#1a0f1c';
    const cx = W * 0.58, base = 230;
    g.fillRect(cx - 70, base - 90, 140, 90);
    for (const [x, h, w] of [[-80, 150, 34], [80, 150, 34], [-20, 190, 30], [30, 170, 26]] as const) {
      g.fillRect(cx + x - w / 2, base - h, w, h);
      g.beginPath(); g.moveTo(cx + x - w / 2 - 4, base - h); g.lineTo(cx + x, base - h - 34); g.lineTo(cx + x + w / 2 + 4, base - h); g.fill();
    }
    for (let x = cx - 70; x < cx + 70; x += 14) g.fillRect(x, base - 100, 8, 10);
    g.fillStyle = '#ffc860'; for (const [x, y] of [[-20, 140], [30, 120], [-80, 110], [80, 100], [0, 60]]) g.fillRect(cx + x - 3, base - y, 6, 9);
  } else if (k === 'sea') {
    sky('#3a6ea8', '#a8d0e8', '#e8f0e0');
    g.fillStyle = '#1e5a8a'; g.fillRect(0, H * 0.55, W, H * 0.45);
    for (let y = H * 0.58; y < H; y += 12) { g.strokeStyle = '#7fb8d8aa'; g.lineWidth = 2; g.beginPath(); for (let x = 0; x <= W; x += 6) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 3); g.stroke(); }
    g.fillStyle = '#ffffffcc'; for (let i = 0; i < 4; i++) { const x = rnd() * W, y = 30 + rnd() * 70; g.beginPath(); g.ellipse(x, y, 40, 10, 0, 0, Math.PI * 2); g.fill(); }
  } else {
    sky('#4a90d8', '#8cc0ec', '#dceaf6');
    for (let i = 0; i < 14; i++) {
      const x = rnd() * W, y = 30 + rnd() * (H - 90);
      g.fillStyle = '#ffffffdd';
      for (let k2 = 0; k2 < 5; k2++) { g.beginPath(); g.arc(x + k2 * 16 - 32, y + Math.sin(k2) * 6, 14 + rnd() * 10, 0, Math.PI * 2); g.fill(); }
    }
  }
}
