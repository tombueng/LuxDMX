import { describe, expect, it } from 'vitest';
import { ChunkFile, frameCount, RENDER_SIZES, renderBits, renderName, timeLeft, tooBig } from './offline';

describe('rendering the stage to a video', () => {
  it('has 4K and 8K at their real sizes, all even', () => {
    expect(RENDER_SIZES['4k']).toMatchObject({ w: 3840, h: 2160 });
    expect(RENDER_SIZES['8k']).toMatchObject({ w: 7680, h: 4320 });
    for (const s of Object.values(RENDER_SIZES)) { expect(s.w % 2).toBe(0); expect(s.h % 2).toBe(0); }
  });
  it('gives each size a bitrate that holds haze and beams, within sane bounds', () => {
    expect(renderBits(1920, 1080, 30)).toBeCloseTo(8.7e6, -5);
    expect(renderBits(3840, 2160, 30)).toBeCloseTo(34.8e6, -5);
    expect(renderBits(7680, 4320, 30)).toBeCloseTo(139.3e6, -5);
    expect(renderBits(7680, 4320, 60)).toBe(200e6);                // (capped)
    expect(renderBits(320, 240, 25)).toBe(8e6);                    // (floored)
  });
  it('counts frames and the time left (not from the first few)', () => {
    expect(frameCount(10, 30)).toBe(300);
    expect(frameCount(0, 30)).toBe(1);
    expect(frameCount(1.02, 25)).toBe(26);
    expect(timeLeft(3, 100, 3000)).toBeUndefined();
    expect(timeLeft(10, 100, 5000)).toBe(45);                      // 0.5 s a frame, 90 to go
    expect(timeLeft(100, 100, 5000)).toBe(0);
  });
  it('says when the graphics card can\'t draw that big, and what it can', () => {
    const card = { renderbuffer: 16384, viewport: [16384, 16384] as [number, number], texture: 16384 };
    expect(tooBig(7680, 4320, card, '8K')).toBeUndefined();
    const small = { renderbuffer: 8192, viewport: [4096, 4096] as [number, number], texture: 8192 };
    expect(tooBig(3840, 2160, small, '4K')).toBeUndefined();
    expect(tooBig(7680, 4320, small, '8K')).toMatch(/at most 4096 pixels across, 8K needs 7680/);
  });
  it('names the file with the size', () => {
    expect(renderName('Club: night', '8k', new Date(2026, 10, 11, 21, 4))).toBe('Club night 3D 8K 2026-11-11 21.04.mp4');
  });
});

describe('the file as it is written', () => {
  const bytes = async (f: ChunkFile) => [...new Uint8Array(await f.blob().arrayBuffer())];
  it('appends, fills a gap with zeros, and changes bytes already written (old parts are Blobs)', async () => {
    const f = new ChunkFile(1);
    await f.write(new Uint8Array([1, 2, 3, 4]), 0);
    await f.write(new Uint8Array([5, 6]), 4);
    await f.write(new Uint8Array([9]), 8);                        // (a gap of two)
    expect(await bytes(f)).toEqual([1, 2, 3, 4, 5, 6, 0, 0, 9]);
    // the size at the start of the media, written last (it reaches back into a part kept as a Blob)
    await f.write(new Uint8Array([7, 7, 7]), 3);
    expect(await bytes(f)).toEqual([1, 2, 3, 7, 7, 7, 0, 0, 9]);
    // over the end: the rest is added
    await f.write(new Uint8Array([8, 8, 8]), 7);
    expect(await bytes(f)).toEqual([1, 2, 3, 7, 7, 7, 0, 8, 8, 8]);
    expect(f.size).toBe(10);
  });
  it('keeps its own copy (the writer may reuse its buffer)', async () => {
    const f = new ChunkFile(), buf = new Uint8Array([1, 2]);
    await f.write(buf, 0); buf[0] = 9;
    expect(await bytes(f)).toEqual([1, 2]);
  });
  it('takes what a WritableStream is sent', async () => {
    const f = new ChunkFile(), w = f.writable().getWriter();
    await w.write({ type: 'write', data: new Uint8Array([1, 2, 3]), position: 0 });
    await w.write({ type: 'write', data: new Uint8Array([4]), position: 1 });
    await w.close();
    expect(await bytes(f)).toEqual([1, 4, 3]);
  });
});
