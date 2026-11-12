// Rendering the 3D stage to a video frame by frame instead of recording it as it plays: the show
// runs on a clock of its own (render/showAt.ts), each frame is drawn at the full size and handed to
// the browser's encoder (WebCodecs, through mediabunny), and the song is mixed in afterwards from
// its file. Slower than real time at 4K and 8K, but never a dropped or doubled frame: what a
// computer can't draw 30 times a second it draws as often as it can, and the file doesn't know.
// The pure parts are here (sizes, bitrates, the codecs tried, time left, the file being written);
// Stage3D.svelte drives it.

export type RenderSize = '1080p' | 'vertical' | '4k' | '8k';
export const RENDER_SIZES: Record<RenderSize, { w: number; h: number; label: string; says: string }> = {
  '1080p': { w: 1920, h: 1080, label: '1080p', says: '1920 x 1080' },
  vertical: { w: 1080, h: 1920, label: '9:16', says: '1080 x 1920, for phones' },
  '4k': { w: 3840, h: 2160, label: '4K', says: '3840 x 2160' },
  '8k': { w: 7680, h: 4320, label: '8K', says: '7680 x 4320' },
};
export const RENDER_ORDER: RenderSize[] = ['1080p', 'vertical', '4k', '8k'];
export const RENDER_FPS = [25, 30, 50, 60] as const;
export type RenderFps = (typeof RENDER_FPS)[number];

// About 0.14 bits a pixel a frame (beams in haze band badly when starved): 1080p at 30 frames a
// second is 8.7 Mbit/s, 4K 35, 8K 139, about what YouTube asks for; never under 8 or over 200.
export const renderBits = (w: number, h: number, fps: number) => Math.round(Math.max(8e6, Math.min(200e6, w * h * fps * 0.14)));

// frames for a stretch of seconds (at least one)
export const frameCount = (seconds: number, fps: number) => Math.max(1, Math.round(Math.max(0, seconds) * fps));

// Seconds left, from the frames done so far; undefined for the first few (the shaders compile and
// the encoder warms up: a guess from them is far off)
export function timeLeft(done: number, total: number, ms: number): number | undefined {
  if (done < 5 || !(ms > 0)) return undefined;
  return ((ms / done) * Math.max(0, total - done)) / 1000;
}

// The codecs tried, in this order: H.264 plays everywhere; HEVC and AV1 take 8K on graphics cards
// that encode them (H.264 stops at about 4K on most); VP9 last (slow, but every Chrome has it).
// All of them go in an MP4.
export const VIDEO_CODECS = ['avc', 'hevc', 'av1', 'vp9'] as const;
export const AUDIO_CODECS = ['aac', 'opus'] as const;
export const CODEC_NAMES: Record<string, string> = { avc: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9', aac: 'AAC', opus: 'Opus' };

// What this graphics card can draw into, from WebGL: the biggest picture (renderbuffer), the
// biggest viewport, the biggest texture. A size past any of them can't be rendered here: said in
// words, with what it can do. Undefined: it fits.
export interface CardLimits { renderbuffer: number; viewport: [number, number]; texture: number }
export function tooBig(w: number, h: number, c: CardLimits, label: string): string | undefined {
  const most = Math.min(c.renderbuffer, c.texture, c.viewport[0], c.viewport[1]);
  if (w <= most && h <= most) return undefined;
  return `This graphics card draws at most ${most} pixels across, ${label} needs ${Math.max(w, h)}. Try a smaller size, or another browser or computer.`;
}

// The file as mediabunny writes it: front to back, then back for a few bytes at the end (the size
// of the media data, at its start). Each part older than the last two becomes a Blob at once (the
// browser keeps big Blobs on disk when it must), so an 8K render doesn't sit in memory twice. A
// write past the end leaves zeros in the gap; a write over what's there changes it in place.
export class ChunkFile {
  private parts: { at: number; size: number; data: Uint8Array | Blob }[] = [];
  size = 0;
  constructor(private keep = 2) {}
  async write(data: Uint8Array, at: number) {
    if (at > this.size) this.append(new Uint8Array(at - this.size));
    if (at === this.size) { this.append(data.slice()); return; }
    for (const p of this.parts) {
      const a = Math.max(at, p.at), b = Math.min(at + data.length, p.at + p.size);
      if (a >= b) continue;
      const bytes = p.data instanceof Uint8Array ? p.data : new Uint8Array(await p.data.arrayBuffer());
      bytes.set(data.subarray(a - at, b - at), a - p.at);
      p.data = bytes;
    }
    if (at + data.length > this.size) this.append(data.slice(this.size - at));
  }
  private append(d: Uint8Array) {
    this.parts.push({ at: this.size, size: d.length, data: d });
    this.size += d.length;
    for (let i = 0; i < this.parts.length - this.keep; i++) {
      const p = this.parts[i];
      if (p.data instanceof Uint8Array) p.data = new Blob([p.data as Uint8Array<ArrayBuffer>]);
    }
  }
  blob(type = 'video/mp4'): Blob { return new Blob(this.parts.map((p) => p.data as BlobPart), { type }); }
  // what mediabunny's StreamTarget writes into
  writable(): WritableStream<{ type: 'write'; data: Uint8Array; position: number }> {
    return new WritableStream({ write: (c) => this.write(c.data, c.position) });
  }
}

// "Club night 3D 4K 2026-11-11 21.14.mp4"
export function renderName(show: string, size: RenderSize, when: Date): string {
  const name = show.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim() || 'Show';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${name} 3D ${RENDER_SIZES[size].label} ${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())} ${p(when.getHours())}.${p(when.getMinutes())}.mp4`;
}
