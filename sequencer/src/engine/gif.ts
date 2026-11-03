// Pictures in: our own GIF decoder (every frame of an animated GIF, with its timing, transparency
// and disposal), and still pictures (PNG, JPG, WebP) through the browser. Browsers only show a GIF,
// they don't hand out its frames, so we read the file ourselves. Nothing here keeps a whole
// animation at full size: each frame goes to `onFrame` as soon as it's drawn (and is scaled down
// there), the decoder reuses one canvas. The app loads this file only when a picture is picked.
import { zlibSync } from 'fflate';
import { PICTURE_LIMITS } from './custom';

export class PictureError extends Error {}

// A GIF is read in one go, so a huge one must not stall the page for long: at most this big, this
// many frames, and this much work (pixels drawn and handed on, over all frames; about 5 s).
export const GIF_LIMITS = { side: 4096, frames: 1000, pixels: 100_000_000 };

export interface GifInfo { width: number; height: number; frames: number }

// Read a GIF. `onFrame` gets every frame as it looks on screen (RGBA at the GIF's size; the buffer
// is reused, copy what you keep) and its time in ms. Returning false stops early.
export function decodeGif(bytes: Uint8Array, onFrame: (rgba: Uint8ClampedArray, delay: number, width: number, height: number) => boolean | void): GifInfo {
  const sig = String.fromCharCode(...bytes.subarray(0, 6));
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new PictureError('That is not a GIF');
  let p = 6;
  const need = (n: number) => { if (p + n > bytes.length) throw new PictureError('The GIF ends too early'); };
  const u16 = () => { need(2); const v = bytes[p] | (bytes[p + 1] << 8); p += 2; return v; };
  const u8 = () => { need(1); return bytes[p++]; };
  const width = u16(), height = u16(), flags = u8();
  u8(); u8();                                            // background colour (browsers clear to transparent) and aspect
  if (!width || !height) throw new PictureError('The GIF has no size');
  if (width > GIF_LIMITS.side || height > GIF_LIMITS.side) throw new PictureError(`The GIF is too big (${width} × ${height}, ${GIF_LIMITS.side} at most)`);
  const table = (size: number) => { const n = 3 * (1 << (size + 1)); need(n); const t = bytes.subarray(p, p + n); p += n; return t; };
  const global = flags & 0x80 ? table(flags & 7) : undefined;

  const canvas = new Uint8ClampedArray(width * height * 4);
  let saved: Uint8ClampedArray | undefined;
  let delay = 100, transparent = -1, disposal = 0, frames = 0, work = 0;

  // Data sub-blocks, joined (the image data of a frame is cut into blocks of at most 255 bytes).
  const blocks = (): Uint8Array => {
    const parts: Uint8Array[] = [];
    let len = 0;
    for (;;) {
      const n = u8();
      if (!n) break;
      need(n);
      parts.push(bytes.subarray(p, p + n)); len += n; p += n;
    }
    const out = new Uint8Array(len);
    let o = 0;
    for (const b of parts) { out.set(b, o); o += b.length; }
    return out;
  };
  const skip = () => { for (;;) { const n = u8(); if (!n) return; need(n); p += n; } };

  try {
    while (p < bytes.length) {
      const kind = u8();
      if (kind === 0x3b) break;                            // the end
      if (kind === 0x21) {                                 // an extension
        const label = u8();
        if (label === 0xf9) {                              // timing, transparency and disposal of the next frame
          const size = u8();
          need(size);
          if (size < 4) { p += size; skip(); continue; }
          const f = bytes[p];
          disposal = (f >> 2) & 7;
          const cs = bytes[p + 1] | (bytes[p + 2] << 8);
          // like browsers: 0 or 10 ms means "as fast as you like", which they show at 100 ms
          delay = cs <= 1 ? 100 : cs * 10;
          transparent = f & 1 ? bytes[p + 3] : -1;
          p += size;
          skip();
        } else skip();
        continue;
      }
      if (kind !== 0x2c) throw new PictureError('The GIF has something unknown in it');
      const left = u16(), top = u16(), w = u16(), h = u16(), f = u8();
      if (w > GIF_LIMITS.side || h > GIF_LIMITS.side) throw new PictureError('A frame of the GIF is too big');
      const colors = f & 0x80 ? table(f & 7) : global;
      const interlaced = (f & 0x40) !== 0;
      const minSize = u8();
      const data = blocks();
      if (!colors) throw new PictureError('A frame of the GIF has no colours');
      if (minSize < 1 || minSize > 11) throw new PictureError('The GIF is damaged');
      const idx = new Uint8Array(w * h);
      const got = lzw(data, minSize, idx);

      if (disposal === 3) saved = canvas.slice();
      const ncol = colors.length / 3;
      for (let y = 0; y < h; y++) {
        const sy = interlaced ? deinterlace(y, h) : y;
        const cy = top + sy;
        if (cy >= height) continue;
        for (let x = 0; x < w; x++) {
          const cx = left + x;
          if (cx >= width || y * w + x >= got) break;
          const c = idx[y * w + x];
          if (c === transparent || c >= ncol) continue;
          const o = (cy * width + cx) * 4;
          canvas[o] = colors[c * 3]; canvas[o + 1] = colors[c * 3 + 1]; canvas[o + 2] = colors[c * 3 + 2]; canvas[o + 3] = 255;
        }
      }
      const go = onFrame(canvas, delay, width, height);
      frames++;
      // what's left for the next frame
      if (disposal === 2) {
        for (let y = top; y < Math.min(height, top + h); y++) canvas.fill(0, (y * width + left) * 4, (y * width + Math.min(width, left + w)) * 4);
      } else if (disposal === 3 && saved) canvas.set(saved);
      delay = 100; transparent = -1; disposal = 0;
      work += w * h + width * height;
      if (go === false || frames >= GIF_LIMITS.frames || work >= GIF_LIMITS.pixels) break;
    }
  } catch (e) {
    // a GIF cut short still shows the frames it has
    if (!(e instanceof PictureError) || !frames) throw e;
  }
  if (!frames) throw new PictureError('The GIF has no pictures in it');
  return { width, height, frames };
}

// Interlaced rows come in four passes: every 8th from 0, every 8th from 4, every 4th from 2, every 2nd from 1.
function deinterlace(i: number, h: number): number {
  const passes = [[0, 8], [4, 8], [2, 4], [1, 2]];
  for (const [start, stepY] of passes) {
    const n = Math.ceil((h - start) / stepY);
    if (start < h && i < n) return start + i * stepY;
    if (start < h) i -= n;
  }
  return 0;
}

// The GIF's LZW: codes of growing width (up to 12 bits), a clear code to start over. Damaged data
// stops the frame there (what's missing stays transparent), it never reads or writes out of bounds.
export function lzw(data: Uint8Array, minSize: number, out: Uint8Array): number {
  const clear = 1 << minSize, eoi = clear + 1;
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let size = minSize + 1, mask = (1 << size) - 1, next = eoi + 1;
  let prev = -1, first = 0, o = 0;
  let acc = 0, bits = 0, p = 0;
  while (o < out.length) {
    while (bits < size && p < data.length) { acc |= data[p++] << bits; bits += 8; }
    if (bits < size) break;
    let code = acc & mask;
    acc >>>= size; bits -= size;
    if (code === clear) { size = minSize + 1; mask = (1 << size) - 1; next = eoi + 1; prev = -1; continue; }
    if (code === eoi) break;
    if (prev === -1) {
      if (code >= clear) break;
      out[o++] = code; prev = code; first = code;
      continue;
    }
    const inCode = code;
    let sp = 0;
    if (code > next || (code === next && next >= 4096)) break;
    if (code === next) { stack[sp++] = first; code = prev; }
    while (code > eoi) { stack[sp++] = suffix[code]; code = prefix[code]; if (sp > 4096) return o; }
    first = suffix[code];
    stack[sp++] = first;
    if (next < 4096) {
      prefix[next] = prev; suffix[next] = first; next++;
      if (next > mask && size < 12) { size++; mask = (1 << size) - 1; }
    }
    prev = inCode;
    while (sp && o < out.length) out[o++] = stack[--sp];
  }
  return o;
}

// ---------------------------------------------------------------- any picture file, packed

// Scale a frame down by averaging the pixels each new one covers; transparent counts as black (a
// light that's off). `ch`: 4 for RGBA in, 3 for RGB. Out: RGB.
export function shrink(src: ArrayLike<number>, ch: 3 | 4, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh * 3);
  for (let dy = 0; dy < dh; dy++) {
    const y0 = Math.floor(dy * sh / dh), y1 = Math.max(y0 + 1, Math.floor((dy + 1) * sh / dh));
    for (let dx = 0; dx < dw; dx++) {
      const x0 = Math.floor(dx * sw / dw), x1 = Math.max(x0 + 1, Math.floor((dx + 1) * sw / dw));
      let r = 0, g = 0, b = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * sw + x) * ch, a = ch === 4 ? src[i + 3] / 255 : 1;
        r += src[i] * a; g += src[i + 1] * a; b += src[i + 2] * a;
      }
      const n = (y1 - y0) * (x1 - x0), o = (dy * dw + dx) * 3;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}
// The size a picture is kept at: as it is, or scaled down (same shape) to fit `w` x `h`.
export function fitSize(sw: number, sh: number, w = PICTURE_LIMITS.w, h = PICTURE_LIMITS.h): [number, number] {
  const k = Math.min(1, w / sw, h / sh);
  return [Math.max(1, Math.round(sw * k)), Math.max(1, Math.round(sh * k))];
}

// Pack a picture for the show file (custom.ts unpacks it; the format is in FORMAT.md).
export function packPicture(w: number, h: number, frames: Uint8Array[], delays: number[]): string {
  const size = w * h * 3, raw = new Uint8Array(size * frames.length);
  const f0 = frames[0];
  for (let i = 0; i < size; i++) raw[i] = (f0[i] - (i >= 3 ? f0[i - 3] : 0)) & 255;
  for (let f = 1; f < frames.length; f++) {
    const a = frames[f], b = frames[f - 1], o = f * size;
    for (let i = 0; i < size; i++) raw[o + i] = (a[i] - b[i]) & 255;
  }
  const z = zlibSync(raw, { level: 9 });
  let bin = '';
  for (let i = 0; i < z.length; i += 0x8000) bin += String.fromCharCode(...z.subarray(i, i + 0x8000));
  return `pic1:${w}x${h}:${(frames.length > 1 ? delays : [0]).map((d) => Math.round(d)).join(',')}:${btoa(bin)}`;
}

// A long animation keeps at most `max` frames: every second one goes (its time added to the one
// before) until it fits, so the whole thing still takes as long.
export class FrameKeeper {
  frames: Uint8Array[] = [];
  delays: number[] = [];
  private every = 1;
  private seen = 0;
  constructor(private max = PICTURE_LIMITS.frames) {}
  add(rgb: Uint8Array, delay: number) {
    if (this.seen++ % this.every === 0) { this.frames.push(rgb); this.delays.push(delay); }
    else this.delays[this.delays.length - 1] += delay;
    if (this.frames.length >= this.max * 2) this.halve();
  }
  done() { while (this.frames.length > this.max) this.halve(); return this; }
  private halve() {
    const f: Uint8Array[] = [], d: number[] = [];
    for (let i = 0; i < this.frames.length; i += 2) { f.push(this.frames[i]); d.push(this.delays[i] + (this.delays[i + 1] ?? 0)); }
    this.frames = f; this.delays = d; this.every *= 2;
  }
}

export interface Loaded { packed: string; w: number; h: number; frames: number; ms: number; from: { w: number; h: number; frames: number } }

// Pack frames: as big as allowed, smaller until the packed text fits the budget.
export function packFitting(w: number, h: number, frames: Uint8Array[], delays: number[], chars = PICTURE_LIMITS.chars): { packed: string; w: number; h: number } {
  let packed = packPicture(w, h, frames, delays), cw = w, ch = h, cur = frames;
  for (let tries = 0; packed.length > chars && tries < 12 && (cw > 2 || ch > 2); tries++) {
    const k = Math.min(0.9, Math.sqrt(chars / packed.length) * 0.95);
    const [nw, nh] = [Math.max(1, Math.round(cw * k)), Math.max(1, Math.round(ch * k))];
    cur = cur.map((f) => shrink(f, 3, cw, ch, nw, nh));
    cw = nw; ch = nh;
    packed = packPicture(cw, ch, cur, delays);
  }
  return { packed, w: cw, h: ch };
}

// A picture file (PNG, JPG, WebP, GIF), read, scaled down and packed for a Picture effect.
export async function loadPicture(file: Blob): Promise<Loaded> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const keep = new FrameKeeper();
  let w = 0, h = 0, from = { w: 0, h: 0, frames: 0 };
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    const info = decodeGif(bytes, (rgba, delay, gw, gh) => {
      [w, h] = fitSize(gw, gh);
      keep.add(shrink(rgba, 4, gw, gh, w, h), delay);
    });
    from = { w: info.width, h: info.height, frames: info.frames };
  } else {
    if (typeof createImageBitmap !== 'function') throw new PictureError('This browser can\'t read pictures');
    let bmp: ImageBitmap;
    try { bmp = await createImageBitmap(file); } catch { throw new PictureError('That picture could not be read (PNG, JPG, WebP or GIF)'); }
    // the browser scales a big photo down first (well, and fast), we take it from there
    const [cw, ch] = fitSize(bmp.width, bmp.height, 640, 640);
    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(cw, ch).getContext('2d');
    else { const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; ctx = cv.getContext('2d'); }
    from = { w: bmp.width, h: bmp.height, frames: 1 };
    if (!ctx) { bmp.close(); throw new PictureError('This browser can\'t read pictures'); }
    ctx.drawImage(bmp, 0, 0, cw, ch);
    bmp.close();
    [w, h] = fitSize(cw, ch);
    keep.add(shrink(ctx.getImageData(0, 0, cw, ch).data, 4, cw, ch, w, h), 0);
  }
  const { frames, delays } = keep.done();
  const fit = packFitting(w, h, frames, delays);
  return { ...fit, frames: frames.length, ms: frames.length > 1 ? delays.reduce((a, b) => a + b, 0) : 0, from };
}
