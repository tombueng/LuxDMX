// The little animation a package shows in the picker: the effect played on what it's made for
// (a disc, a 16 x 16 matrix, a strip, a row of lights or of heads seen from above), a couple of
// seconds of it, packed like a Picture effect's frames (pic1:, FORMAT.md). Made when a package is
// made; a repository serves it inside the package, so the picker never runs anyone's effect to
// show it.
import { EFFECT_MAP, paramsOf, runEffect, type Where } from '../engine/effects';
import { packPicture } from '../engine/gif';
import { placesFor, type Places } from '../model/pixelLayout';
import { effectOfPackage, type EffectPackage } from './package';

export const PREVIEW = { side: 32, frames: 24, ms: 83 };

const DISC = placesFor({ kind: 'rings', rings: [32, 24, 16, 12, 8, 1] });
const MATRIX = placesFor({ kind: 'matrix', cols: 16, rows: 16 });

// [r, g, b] 0..1 per element for one moment
type Px = [number, number, number];
function frameOf(kind: string, params: Record<string, unknown>, where: Where[], t: number): Px[] {
  const def = EFFECT_MAP.get(kind)!, p = { ...paramsOf(kind, params), look: true };
  const total = p.tempo ? (t * 2) / p.speed : t / p.speed;
  return runEffect(def, p, where.length, total, 7, where, { beats: t * 2, secs: t }).map((o): Px => {
    const c = o.color ?? { r: 1, g: 1, b: 1 }, i = o.intensity ?? (o.color ? 1 : 0), s = o.strike ?? 0;
    return [Math.min(1, c.r * i + s), Math.min(1, c.g * i + s), Math.min(1, c.b * i + s)];
  });
}
const shapeWhere = (at: Places): Where[] => Array.from({ length: at.n }, (_, i) => ({ u: 0.5, row: 0, rows: 1, at, cell: i }));

// The animation as pic1 frames: w x h RGB.
export function previewOf(pkg: EffectPackage): string {
  const { kind, params } = effectOfPackage(pkg), S = PREVIEW.side;
  const shape = pkg.fits.some((f) => f === 'ring' || f === 'disc') ? DISC : pkg.fits.includes('matrix') && !pkg.fits.includes('strip') ? MATRIX : undefined;
  const frames: Uint8Array[] = [];
  for (let k = 0; k < PREVIEW.frames; k++) {
    const t = 1.5 + (k * PREVIEW.ms) / 1000, img = new Uint8Array(S * S * 3);
    const put = (x: number, y: number, c: Px, r: number) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const px = Math.round(x) + dx, py = Math.round(y) + dy;
        if (px < 0 || py < 0 || px >= S || py >= S) continue;
        const o = (py * S + px) * 3;
        img[o] = Math.max(img[o], Math.round(c[0] * 255)); img[o + 1] = Math.max(img[o + 1], Math.round(c[1] * 255)); img[o + 2] = Math.max(img[o + 2], Math.round(c[2] * 255));
      }
    };
    if (shape) {
      const cs = frameOf(kind, params, shapeWhere(shape), t), R = S / 2 - 1.5;
      for (let i = 0; i < shape.n; i++) put(S / 2 - 0.5 + shape.x[i] * R, S / 2 - 0.5 - shape.y[i] * R, cs[i], shape.round ? 0 : 0);
    } else if (pkg.category === 'move') {
      // heads from above: where each one points, a dot moving round its own place
      const n = 6, where = Array.from({ length: n }, (_, i): Where => ({ u: i / (n - 1), row: i, rows: n }));
      const def = EFFECT_MAP.get(kind)!, p = { ...paramsOf(kind, params), look: true }, total = p.tempo ? (t * 2) / p.speed : t / p.speed;
      runEffect(def, p, n, total, 7, where, { beats: t * 2, secs: t }).forEach((o, i) => {
        const cx = 3 + (i * (S - 6)) / (n - 1), cy = S / 2;
        put(cx + ((o.pan ?? 0.5) - 0.5) * 10, cy + ((o.tilt ?? 0.5) - 0.5) * 20, [1, 0.85, 0.5], 1);
      });
    } else {
      // a strip (pixels in a line) and a row of lights under it
      const strip = Array.from({ length: S }, (_, i): Where => ({ u: i / (S - 1), row: 0, rows: 1 }));
      frameOf(kind, params, strip, t).forEach((c, i) => { for (let y = 9; y < 15; y++) put(i, y, c, 0); });
      const lights = Array.from({ length: 6 }, (_, i): Where => ({ u: i / 5, row: i, rows: 6 }));
      frameOf(kind, params, lights, t).forEach((c, i) => put(3 + (i * (S - 6)) / 5, 22, c, 2));
    }
    frames.push(img);
  }
  return packPicture(S, S, frames, frames.map(() => PREVIEW.ms));
}
