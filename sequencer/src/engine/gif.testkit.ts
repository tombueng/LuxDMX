// Small picture writers for the tests (unit and e2e): a GIF with frames, timing, transparency,
// disposal and interlacing, and a PNG. Not part of the app.
import { zlibSync } from 'fflate';

export interface GifFrame {
  w: number; h: number; left?: number; top?: number;
  indices: ArrayLike<number>;        // colour numbers, row by row
  delay?: number;                    // ms (stored in hundredths)
  transparent?: number;              // this colour number is see-through
  disposal?: 0 | 1 | 2 | 3;          // what happens after: 1 keep, 2 clear the rectangle, 3 back to before
  palette?: number[][];              // a local colour table
  interlace?: boolean;
}

const tableBits = (n: number) => { let b = 1; while ((1 << b) < n) b++; return b; };

function lzwEncode(idx: ArrayLike<number>, minSize: number): number[] {
  const clear = 1 << minSize, eoi = clear + 1;
  let size = minSize + 1, next = eoi + 1, dict = new Map<number, number>();
  const out: number[] = [];
  let acc = 0, bits = 0;
  const write = (code: number) => { acc |= code << bits; bits += size; while (bits >= 8) { out.push(acc & 255); acc >>>= 8; bits -= 8; } };
  write(clear);
  let prefix = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], hit = dict.get(prefix * 256 + k);
    if (hit !== undefined) { prefix = hit; continue; }
    write(prefix);
    if (next < 4096) { dict.set(prefix * 256 + k, next++); if (next > (1 << size) && size < 12) size++; }
    else { write(clear); dict = new Map(); size = minSize + 1; next = eoi + 1; }
    prefix = k;
  }
  write(prefix);
  // the reader adds one more entry on that last code, so the end code may be one bit wider
  if (next >= (1 << size) && size < 12) size++;
  write(eoi);
  if (bits) out.push(acc & 255);
  return out;
}

export function encodeGif(width: number, height: number, palette: number[][], frames: GifFrame[]): Uint8Array {
  const b: number[] = [];
  const u16 = (v: number) => b.push(v & 255, v >> 8);
  const table = (pal: number[][]) => { const n = 1 << tableBits(pal.length); for (let i = 0; i < n; i++) b.push(...(pal[i] ?? [0, 0, 0])); };
  for (const ch of 'GIF89a') b.push(ch.charCodeAt(0));
  u16(width); u16(height);
  b.push(0x80 | 0x70 | (tableBits(palette.length) - 1), 0, 0);
  table(palette);
  // loop for ever (NETSCAPE2.0)
  b.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  for (const f of frames) {
    b.push(0x21, 0xf9, 4, ((f.disposal ?? 0) << 2) | (f.transparent !== undefined ? 1 : 0));
    u16(Math.round((f.delay ?? 100) / 10));
    b.push(f.transparent ?? 0, 0);
    b.push(0x2c); u16(f.left ?? 0); u16(f.top ?? 0); u16(f.w); u16(f.h);
    const pal = f.palette ?? palette;
    b.push((f.palette ? 0x80 | (tableBits(pal.length) - 1) : 0) | (f.interlace ? 0x40 : 0));
    if (f.palette) table(f.palette);
    let idx: ArrayLike<number> = f.indices;
    if (f.interlace) {
      const rows: number[] = [];
      for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < f.h; y += step) rows.push(y);
      idx = rows.flatMap((y) => Array.from({ length: f.w }, (_, x) => f.indices[y * f.w + x]));
    }
    const minSize = Math.max(2, tableBits(pal.length));
    const data = lzwEncode(idx, minSize);
    b.push(minSize);
    for (let i = 0; i < data.length; i += 255) { const part = data.slice(i, i + 255); b.push(part.length, ...part); }
    b.push(0);
  }
  b.push(0x3b);
  return new Uint8Array(b);
}

// ---- PNG

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (d: Uint8Array) => { let c = 0xffffffff; for (const v of d) c = CRC[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function encodePng(w: number, h: number, rgba: ArrayLike<number>): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const rows = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) for (let i = 0; i < w * 4; i++) rows[y * (w * 4 + 1) + 1 + i] = rgba[y * w * 4 + i];
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(rows)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
