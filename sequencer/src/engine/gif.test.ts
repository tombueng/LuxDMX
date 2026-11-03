import { describe, expect, it } from 'vitest';
import { FrameKeeper, PictureError, decodeGif, fitSize, loadPicture, lzw, packFitting, packPicture, shrink } from './gif';
import { encodeGif, encodePng } from './gif.testkit';
import { PICTURE_LIMITS, unpackPicture } from './custom';

const PAL = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]];
const NAME: Record<string, string> = { '0,0,0,0': '.', '255,0,0,255': 'R', '0,255,0,255': 'G', '0,0,255,255': 'B', '255,255,255,255': 'W', '0,0,0,255': 'K' };
// A frame as letters, row by row ('.' = see-through), easy to read in a test.
const letters = (rgba: Uint8ClampedArray, w: number) => {
  const rows: string[] = [];
  for (let i = 0; i < rgba.length / 4; i += w) {
    let r = '';
    for (let x = 0; x < w; x++) r += NAME[Array.from(rgba.subarray((i + x) * 4, (i + x) * 4 + 4)).join()] ?? '?';
    rows.push(r);
  }
  return rows.join(' ');
};
function frames(gif: Uint8Array) {
  const out: { px: string; delay: number }[] = [];
  const info = decodeGif(gif, (rgba, delay, w) => { out.push({ px: letters(rgba, w), delay }); });
  return { info, out };
}

describe('GIF decoder', () => {
  it('reads one frame', () => {
    const gif = encodeGif(3, 2, PAL, [{ w: 3, h: 2, indices: [1, 2, 3, 3, 2, 1] }]);
    const { info, out } = frames(gif);
    expect(info).toEqual({ width: 3, height: 2, frames: 1 });
    expect(out).toEqual([{ px: 'RGB BGR', delay: 100 }]);
  });
  it('plays frames with their own timing; small frames draw over the last one', () => {
    const gif = encodeGif(4, 3, PAL, [
      { w: 4, h: 3, indices: Array(12).fill(1), delay: 200 },
      { w: 2, h: 1, left: 1, top: 1, indices: [2, 3], delay: 50 },
      { w: 1, h: 1, left: 3, top: 2, indices: [0], delay: 30 },
    ]);
    expect(frames(gif).out).toEqual([
      { px: 'RRRR RRRR RRRR', delay: 200 },
      { px: 'RRRR RGBR RRRR', delay: 50 },
      { px: 'RRRR RGBR RRRK', delay: 30 },
    ]);
  });
  it('a see-through colour leaves what was there; "clear" and "back to before" disposal', () => {
    const gif = encodeGif(3, 1, PAL, [
      { w: 3, h: 1, indices: [1, 1, 1], disposal: 1 },
      { w: 3, h: 1, indices: [2, 0, 2], transparent: 0, disposal: 2 },    // green at the ends, then cleared
      { w: 1, h: 1, left: 1, top: 0, indices: [3], disposal: 3 },          // blue in the middle, then undone
      { w: 1, h: 1, left: 0, top: 0, indices: [3] },
    ]);
    expect(frames(gif).out.map((f) => f.px)).toEqual(['RRR', 'GRG', '.B.', 'B..']);
  });
  it('reads interlaced frames and local colour tables', () => {
    const idx = Array.from({ length: 2 * 9 }, (_, i) => (Math.floor(i / 2) % 3) + 1);   // rows R, G, B, R, ...
    const gif = encodeGif(2, 9, PAL, [{ w: 2, h: 9, indices: idx, interlace: true, palette: [[0, 0, 0], [0, 0, 255], [255, 0, 0], [0, 255, 0]] }]);
    expect(frames(gif).out[0].px).toBe('BB RR GG BB RR GG BB RR GG');
  });
  it('gives "as fast as you like" frames 100 ms, like browsers', () => {
    const gif = encodeGif(1, 1, PAL, [{ w: 1, h: 1, indices: [1], delay: 0 }, { w: 1, h: 1, indices: [2], delay: 10 }, { w: 1, h: 1, indices: [3], delay: 20 }]);
    expect(frames(gif).out.map((f) => f.delay)).toEqual([100, 100, 20]);
  });
  it('agrees with a GIF from another encoder (Pillow: sub-frames, local tables, disposal)', () => {
    // made by investigations/sequencer-agents/B-custom/make-pil-gif.py; Pillow's own reading of it below
    const b64 = 'R0lGODlhBwAFAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQEDAAAACwAAAAABwAFAAAIDAABCBxIsKDBgwcDAgAh+QQJGQACACwCAAEAAwADAIH/AAAA/wAAAAAAAAAIBwADCBw4MCAAIfkEDAQAAAAsAAAAAAcABQCB/wAAAAD/////AAAACBYABQQIAKAggAACDRoUoHBhw4IMAQQEADs=';
    const gif = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const { info, out } = frames(gif);
    expect(info.frames).toBe(3);
    expect(out).toEqual([
      { px: 'RRRRRRR RRRRRRR RRRRRRR RRRRRRR RRRRRRR', delay: 120 },
      { px: 'RRRRRRR RRGGGRR RRGGGRR RRGGGRR RRRRRRR', delay: 250 },
      { px: 'WBBRRRR BWBRRRR RRWRRRR RRRWRRR RRRRWRR', delay: 40 },
    ]);
  });
  it('LZW: big, many-coloured frames (codes up to 12 bits and a fresh start)', () => {
    const pal = Array.from({ length: 256 }, (_, i) => [i, 255 - i, (i * 7) & 255]);
    const n = 96 * 96, idx = new Uint8Array(n);
    let s = 1;
    for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; idx[i] = (s >>> 16) & 255; }
    const gif = encodeGif(96, 96, pal, [{ w: 96, h: 96, indices: idx }]);
    decodeGif(gif, (rgba) => {
      let bad = 0;
      for (let i = 0; i < n; i++) if (rgba[i * 4] !== idx[i] || rgba[i * 4 + 1] !== 255 - idx[i]) bad++;
      expect(bad).toBe(0);
    });
  });
  it('damaged data never hangs or reads out of bounds; a GIF cut short keeps its frames', () => {
    let s = 7;
    for (let k = 0; k < 200; k++) {
      const data = new Uint8Array(64).map(() => { s = (s * 1664525 + 1013904223) >>> 0; return s >>> 24; });
      const out = new Uint8Array(100);
      expect(lzw(data, 2 + (k % 7), out)).toBeLessThanOrEqual(100);
    }
    const gif = encodeGif(2, 1, PAL, [{ w: 2, h: 1, indices: [1, 2] }, { w: 2, h: 1, indices: [3, 3] }]);
    const cut = gif.subarray(0, gif.length - 12);
    expect(frames(cut).info.frames).toBe(1);
    expect(() => decodeGif(gif.subarray(0, 20), () => {})).toThrow(PictureError);
    expect(() => decodeGif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), () => {})).toThrow('That is not a GIF');
    // a frame that claims to be enormous is refused before anything is made for it
    expect(() => decodeGif(encodeGif(2, 1, PAL, [{ w: 5000, h: 1, indices: Array(5000).fill(1) }]), () => {})).toThrow('A frame of the GIF is too big');
    expect(() => decodeGif(encodeGif(5000, 1, PAL, [{ w: 1, h: 1, indices: [1] }]), () => {})).toThrow(/too big/);
  });
});

describe('pictures: scaling, packing, the size budget', () => {
  it('scales down by averaging; see-through is black', () => {
    const rgba = [255, 0, 0, 255, 0, 0, 255, 255, 255, 255, 255, 0, 255, 255, 255, 255];   // red, blue, (white, see-through), white
    expect(Array.from(shrink(rgba, 4, 2, 2, 1, 1))).toEqual([128, 64, 128]);
    expect(Array.from(shrink(rgba, 4, 2, 2, 2, 2))).toEqual([255, 0, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255]);
    expect(fitSize(640, 480)).toEqual([160, 120]);
    expect(fitSize(1000, 100)).toEqual([160, 16]);
    expect(fitSize(30, 1)).toEqual([30, 1]);            // small ones stay as they are
  });
  it('packs and unpacks exactly, with each frame\'s time', () => {
    const w = 5, h = 3, a = new Uint8Array(w * h * 3), b = new Uint8Array(w * h * 3);
    for (let i = 0; i < a.length; i++) { a[i] = (i * 37) & 255; b[i] = (i * 11 + 200) & 255; }
    const packed = packPicture(w, h, [a, b], [120, 80]);
    expect(packed).toMatch(/^pic1:5x3:120,80:[A-Za-z0-9+/=]+$/);
    const pic = unpackPicture(packed);
    expect(pic.w).toBe(5); expect(pic.h).toBe(3);
    expect(Array.from(pic.frames[0])).toEqual(Array.from(a));
    expect(Array.from(pic.frames[1])).toEqual(Array.from(b));
    expect(pic.ends).toEqual([120, 200]);
    expect(pic.total).toBe(200);
    const still = unpackPicture(packPicture(w, h, [a], [999]));
    expect(still.delays).toEqual([0]);
  });
  it('a still background packs to almost nothing', () => {
    const f = new Uint8Array(160 * 120 * 3).map((_, i) => (i * 13) & 255);
    const packed = packPicture(160, 120, Array(64).fill(f), Array(64).fill(50));
    expect(packed.length).toBeLessThan(40_000);
  });
  it('unpacking refuses what is wrong or too big (never makes more than it says)', () => {
    const ok = packPicture(2, 2, [new Uint8Array(12).fill(9)], [0]);
    for (const bad of ['', 'pic1:2x2:0:', 'pic2:2x2:0:AAAA', ok.replace('2x2', '3x2'), ok.replace('2x2', '200x2'), ok.replace(':0:', ':0,0:'), ok.replace('pic1:2x2:0:', 'pic1:2x2:x:')]) {
      expect(() => unpackPicture(bad), bad.slice(0, 20)).toThrow();
    }
    // a "bomb": a small text that would inflate to far more than 2 x 2 pixels
    const bomb = packPicture(160, 120, [new Uint8Array(160 * 120 * 3)], [0]).replace('160x120', '2x2');
    expect(() => unpackPicture(bomb)).not.toThrow();
    expect(unpackPicture(bomb).frames[0].length).toBe(12);
  });
  it('a long animation keeps at most 64 frames and its whole length', () => {
    const k = new FrameKeeper();
    for (let i = 0; i < 300; i++) k.add(new Uint8Array([i & 255]), 40);
    k.done();
    expect(k.frames.length).toBeLessThanOrEqual(PICTURE_LIMITS.frames);
    expect(k.frames.length).toBeGreaterThan(32);
    expect(k.delays.reduce((a, b) => a + b, 0)).toBe(300 * 40);
    expect(k.frames.map((f) => f[0]).slice(0, 4)).toEqual([0, 8, 16, 24]);   // evenly: every 8th
    const few = new FrameKeeper();
    for (let i = 0; i < 10; i++) few.add(new Uint8Array([i]), 100);
    expect(few.done().frames.length).toBe(10);
  });
  it('a big, busy animation gets smaller until it fits the budget', () => {
    let s = 3;
    const frames = Array.from({ length: 64 }, () => new Uint8Array(160 * 120 * 3).map(() => { s = (s * 1664525 + 1013904223) >>> 0; return s >>> 24; }));
    const r = packFitting(160, 120, frames, Array(64).fill(40));
    expect(r.packed.length).toBeLessThanOrEqual(PICTURE_LIMITS.chars);
    expect(r.w).toBeLessThan(160);
    expect(r.w / r.h).toBeCloseTo(160 / 120, 0);
    const pic = unpackPicture(r.packed);
    expect(pic.frames.length).toBe(64);
    expect(pic.w).toBe(r.w);
  });
  it('loads a GIF file: scaled down to fit, frames and timing kept', async () => {
    const W = 320, H = 40, idx = new Uint8Array(W * H).map((_, i) => ((i % W) < W / 2 ? 1 : 2));
    const gif = encodeGif(W, H, PAL, [{ w: W, h: H, indices: idx, delay: 100 }, { w: W, h: H, indices: idx.map((v) => 3 - v + 1), delay: 300 }]);
    const r = await loadPicture(new Blob([gif as BlobPart]));
    expect([r.w, r.h, r.frames, r.ms]).toEqual([160, 20, 2, 400]);
    expect(r.from).toEqual({ w: 320, h: 40, frames: 2 });
    const pic = unpackPicture(r.packed);
    expect(Array.from(pic.frames[0].subarray(0, 3))).toEqual([255, 0, 0]);
    expect(Array.from(pic.frames[1].subarray(0, 3))).toEqual([0, 0, 255]);
  });
  it('the test PNG writer makes a real PNG (checked in the e2e, where the browser reads it)', () => {
    const png = encodePng(2, 1, [255, 0, 0, 255, 0, 0, 255, 255]);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
