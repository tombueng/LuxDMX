// The main colours of a picture (a poster, an album cover, the venue), as light colours: k-means
// on the pixels, weighted towards saturated ones (a grey wall says little about the mood), then
// pushed to full brightness, because a light's brightness is its intensity, not its colour.
import type { Color } from '../model/types';

// `rgba` as from a canvas (4 bytes a pixel). Returns up to `k` colours, most used first.
export function pictureColors(rgba: ArrayLike<number>, want = 5): Color[] {
  const k = want + 3;                       // a few more clusters than asked, then the most distinct
  const px: [number, number, number, number][] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;                                     // transparent
    const r = rgba[i] / 255, g = rgba[i + 1] / 255, b = rgba[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < 0.12) continue;                                            // black says nothing
    const sat = max ? (max - min) / max : 0;
    px.push([r, g, b, 0.15 + sat * sat]);
  }
  if (!px.length) return [];
  // start from the most different colours (each next one the pixel farthest from those taken), so a
  // small bright patch gets a cluster of its own; deterministic: same picture, same colours
  const step = Math.max(1, Math.floor(px.length / 1500));
  const sample = px.filter((_, i) => i % step === 0);
  const dist = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  let centres: number[][] = [sample.reduce((best, x) => (x[3] > best[3] ? x : best), sample[0]).slice(0, 3)];
  const near = sample.map((x) => dist(x, centres[0]));
  while (centres.length < Math.min(k, sample.length)) {
    let far = 0;
    near.forEach((d, i) => { if (d > near[far]) far = i; });
    if (near[far] < 1e-4) break;
    const c = sample[far].slice(0, 3);
    centres.push(c);
    sample.forEach((x, i) => { near[i] = Math.min(near[i], dist(x, c)); });
  }
  let weight: number[] = [];
  for (let it = 0; it < 12; it++) {
    const sum = centres.map(() => [0, 0, 0, 0]);
    for (const [r, g, b, w] of px) {
      let best = 0, bd = Infinity;
      centres.forEach((c, j) => { const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2; if (d < bd) { bd = d; best = j; } });
      const s = sum[best]; s[0] += r * w; s[1] += g * w; s[2] += b * w; s[3] += w;
    }
    centres = sum.map((s, j) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centres[j]));
    weight = sum.map((s) => s[3]);
  }
  // Most used first, but a poster's small orange band beats a fourth shade of its big purple:
  // colours closer than ~20° of hue to one already taken are skipped.
  const hueSat = (c: number[]) => {
    const max = Math.max(...c), min = Math.min(...c), d = max - min, sat = max ? d / max : 0;
    let h = 0;
    if (d > 0) h = max === c[0] ? ((c[1] - c[2]) / d + 6) % 6 : max === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
    return { h: h * 60, sat };
  };
  const cands = centres.map((c, j) => ({ c, w: weight[j], ...hueSat(c) })).filter((x) => x.w > 0).sort((a, b) => b.w - a.w);
  const picked: typeof cands = [];
  for (const x of cands) {
    if (picked.length >= want) break;
    const near = picked.some((p) => (x.sat < 0.25 && p.sat < 0.25) || (x.sat >= 0.25 && p.sat >= 0.25 && Math.min(Math.abs(x.h - p.h), 360 - Math.abs(x.h - p.h)) < 22));
    if (!near) picked.push(x);
  }
  return picked.map(({ c }) => { const max = Math.max(...c) || 1; return { r: c[0] / max, g: c[1] / max, b: c[2] / max }; });
}
