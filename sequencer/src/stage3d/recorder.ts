// Recording the 3D stage as a video file with its sound: the canvas as a video stream and the
// timeline's song (or the demo beat) as the sound, into the browser's MediaRecorder. MP4 (H.264
// and AAC) where the browser makes it, since that plays everywhere (phones, editors, messengers);
// WebM (VP9 and Opus) where it doesn't. Nothing here touches the scene: the stage draws as it
// always does, a take only listens to the canvas.

// 1080p: 1920 x 1080; vertical: 1080 x 1920 (9:16, for phones: Reels, Stories); shown: as on screen
export type VideoSize = 'shown' | '1080p' | 'vertical';
export const VIDEO_SIZES: VideoSize[] = ['1080p', 'vertical', 'shown'];
export interface VideoFormat { mime: string; ext: 'mp4' | 'webm' }

// frames a second in the file (the stage itself keeps drawing at the screen's rate)
export const FPS = 30;

// best first; the plain types last (a browser that names no codecs picks its own)
const FORMATS: VideoFormat[] = [
  { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1.4d0028,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1.42e028,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
  { mime: 'video/mp4', ext: 'mp4' },
];

// The best type this browser records (without sound: the same, minus the sound's codec)
export function pickFormat(supported: (mime: string) => boolean, sound = true): VideoFormat | undefined {
  for (const f of FORMATS) {
    const mime = sound ? f.mime : f.mime.replace(/,(mp4a\.40\.2|opus)$/, '');
    try { if (supported(mime)) return { mime, ext: f.ext }; } catch { /* a type it chokes on: the next */ }
  }
  return undefined;
}

// what the browser really made (it may name its own codecs): the file's ending
export const extOf = (mime: string, fallback: VideoFormat['ext'] = 'webm'): string =>
  /^video\/mp4/i.test(mime) ? 'mp4' : /^video\/webm/i.test(mime) ? 'webm' : /matroska/i.test(mime) ? 'mkv' : fallback;

// Can this browser record the stage at all (MediaRecorder, a canvas that streams, a type it makes)?
export function canRecord(): boolean {
  try {
    if (typeof MediaRecorder === 'undefined' || typeof MediaStream === 'undefined') return false;
    if (typeof HTMLCanvasElement === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return false;
    return !!pickFormat((t) => MediaRecorder.isTypeSupported(t));
  } catch { return false; }
}

// The picture of a take in pixels, even numbers (the encoders want them). 1080p is 1920 x 1080
// whatever the window is, vertical 1080 x 1920; "as shown" is what's drawn now, at most 4K (a big
// screen at 2x is more than an encoder takes).
export function takeSize(size: VideoSize, w: number, h: number, ratio: number): { w: number; h: number } {
  if (size === '1080p') return { w: 1920, h: 1080 };
  if (size === 'vertical') return { w: 1080, h: 1920 };
  const W = Math.max(2, w * ratio), H = Math.max(2, h * ratio);
  const k = Math.min(1, 3840 / Math.max(W, H), 2160 / Math.min(W, H));
  const even = (v: number) => Math.max(2, 2 * Math.floor(v / 2));
  return { w: even(W * k), h: even(H * k) };
}

// The lens for a tall take (narrower than it is high): the views are made for a wide picture, and
// the same lens on a tall one sees only the middle of the stage. This one is wide enough across for
// what has to be in the picture: points in the camera's space (x right, y up, z towards the
// viewer: in front of it is negative z), the band and the lights. Never narrower than `base`
// (degrees, top to bottom), never wider than `max`. A little room is left round the edges.
export function tallFov(aspect: number, points: { x: number; y: number; z: number }[], base: number, max = 75): number {
  let need = Math.tan((base * Math.PI) / 360);
  for (const p of points) {
    const d = -p.z;
    // (behind the camera or right at it: no help in framing)
    if (!(d > 0.5) || !Number.isFinite(p.x + p.y)) continue;
    need = Math.max(need, (Math.abs(p.x) / d / Math.max(0.1, aspect)) * 1.08, (Math.abs(p.y) / d) * 1.04);
  }
  return Math.min(max, (Math.atan(need) * 360) / Math.PI);
}

// A take that came out choppy: frames the stage drew a second during it (the file can't be smoother
// than that). Under 20 a second, a plain word on it and what to try; undefined when it's fine.
export function stutterNote(fps: number, size: VideoSize): string | undefined {
  if (!Number.isFinite(fps) || fps >= 20) return undefined;
  const why = size === '1080p' ? '1080p is heavy for this computer, try As shown, or close other tabs'
    : size === 'vertical' ? '1080 x 1920 is heavy for this computer, try As shown, or close other tabs'
      : 'close other tabs, or make the window smaller';
  return `The video stutters (${Math.max(0, Math.round(fps))} frames a second): ${why}.`;
}

// About 0.15 bits a pixel a frame: 1080p at 30 fps is 9 Mbit/s (haze and soft beams band badly
// when starved), never under 3 or over 20
export const videoBits = (w: number, h: number, fps = FPS) => Math.round(Math.max(3e6, Math.min(20e6, w * h * fps * 0.15)));

// "Club night 3D 2026-10-27 21.14.mp4": safe on every system (no / \ : * ? " < > |)
export function videoName(show: string, when: Date, ext: string): string {
  const name = show.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim() || 'Show';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${name} 3D ${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())} ${p(when.getHours())}.${p(when.getMinutes())}.${ext}`;
}

// 0:07, 12:34, 1:02:03
export function clock(secs: number): string {
  const s = Math.max(0, Math.floor(secs)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export const megabytes = (bytes: number) => (bytes / 1e6 < 10 ? (bytes / 1e6).toFixed(1) : String(Math.round(bytes / 1e6)));

export interface TakeOptions {
  canvas: HTMLCanvasElement;
  audio?: MediaStream;                  // the song; its tracks are shared, a take never stops them
  format: VideoFormat;
  videoBits: number;
  fps?: number;
  onError?: (message: string) => void;
}
// what a take needs from the browser (tests hand in their own)
export interface TakeEnv {
  Recorder: typeof MediaRecorder;
  Stream: typeof MediaStream;
  now: () => number;
  requestFrame?: boolean;               // the canvas stream takes frames when told (frame())
}
const browserEnv = (): TakeEnv => ({ Recorder: MediaRecorder, Stream: MediaStream, now: () => performance.now(),
  requestFrame: typeof CanvasCaptureMediaStreamTrack !== 'undefined' && typeof CanvasCaptureMediaStreamTrack.prototype.requestFrame === 'function' });

// One recording: starts when made, stop() ends it and gives the file. The parts come in every
// second, so a take that breaks off (an encoder error) still keeps what it had.
export class Take {
  readonly started: number;
  readonly startedAt = new Date();
  readonly mime: string;
  error = '';
  private parts: Blob[] = [];
  private video: MediaStreamTrack[];
  private rec: MediaRecorder;
  private done: Promise<Blob>;
  private env: TakeEnv;

  constructor(o: TakeOptions, env: TakeEnv = browserEnv()) {
    this.env = env;
    this.started = env.now();
    // The frame loop hands over every frame it draws (frame()) and a frame goes in once 85 % of a
    // video frame's time has passed: the browser's own limit at 30 skipped a third of them when
    // the frames came a little uneven (25 a second in the file at 57 drawn). Without requestFrame
    // the browser's own limit it is.
    this.every = 1000 / (o.fps ?? FPS);
    this.manual = !!env.requestFrame;
    this.video = o.canvas.captureStream(this.manual ? 0 : o.fps ?? FPS).getVideoTracks();
    const sound = o.audio?.getAudioTracks().filter((t) => t.readyState === 'live') ?? [];
    const stream = new env.Stream([...this.video, ...sound]);
    try {
      this.rec = new env.Recorder(stream, { mimeType: o.format.mime, videoBitsPerSecond: o.videoBits, audioBitsPerSecond: 192_000 });
    } catch (e) { this.release(); throw e; }
    this.mime = o.format.mime;
    this.rec.ondataavailable = (e) => { if (e.data?.size) this.parts.push(e.data); };
    this.rec.onerror = (e) => {
      const err = (e as Event & { error?: DOMException }).error;
      this.error = err?.message || err?.name || 'the recorder stopped';
      o.onError?.(this.error);
    };
    this.done = new Promise((resolve) => {
      this.rec.onstop = () => {
        this.release();
        this.ended ??= env.now();
        resolve(withDuration(new Blob(this.parts, { type: this.rec.mimeType || this.mime }), this.ended - this.started));
      };
    });
    try { this.rec.start(1000); } catch (e) { this.release(); throw e; }
  }
  private ended: number | undefined;
  private every: number;
  private manual: boolean;
  private lastFrame = -Infinity;
  // frames the stage drew during the take (all of them, not only those that went into the file)
  drawn = 0;
  get drawnFps() { const s = this.seconds; return s > 0 ? this.drawn / s : 0; }
  // the frame loop drew a frame (now: its time): into the video when it's time for one
  frame(now: number) {
    if (this.ended !== undefined) return;
    this.drawn++;
    if (!this.manual || now - this.lastFrame < this.every * 0.85) return;
    this.lastFrame = now;
    for (const t of this.video) (t as CanvasCaptureMediaStreamTrack).requestFrame?.();
  }
  get seconds() { return Math.max(0, ((this.ended ?? this.env.now()) - this.started) / 1000); }
  get recording() { return this.rec.state !== 'inactive'; }
  // ends the take (again: the same file); the canvas stream stops at once, the song's doesn't
  stop(): Promise<Blob> {
    this.ended ??= this.env.now();
    if (this.rec.state !== 'inactive') { try { this.rec.stop(); } catch { /* already ending */ } }
    for (const t of this.video) t.stop();
    return this.done;
  }
  private release() { for (const t of this.video) t.stop(); }
}

// ---- the length of a WebM file
// Chrome writes WebM as a live stream: nothing in it says how long it is, so players show no length
// and seek badly. The length goes into the file's Info header (only the first bytes change, the
// rest of a long take isn't copied); anything unexpected leaves the file as it was.
const EBML = 0x1a45dfa3, SEGMENT = 0x18538067, INFO = 0x1549a966, SEEKHEAD = 0x114d9b74, CLUSTER = 0x1f43b675, SCALE = 0x2ad7b1, DURATION = 0x4489;
// (EBML numbers: the count of leading zero bits in the first byte says how many bytes follow)
const vlen = (b: number) => { for (let i = 0; i < 8; i++) if (b & (0x80 >> i)) return i + 1; return 0; };
function readId(b: Uint8Array, p: number) {
  const l = vlen(b[p] ?? 0);
  if (!l || l > 4 || p + l > b.length) return undefined;
  let v = 0;
  for (let i = 0; i < l; i++) v = v * 256 + b[p + i];
  return { v, l };
}
function readSize(b: Uint8Array, p: number) {
  const l = vlen(b[p] ?? 0);
  if (!l || p + l > b.length) return undefined;
  let v = b[p] & (0xff >> l), unknown = v === 0xff >> l;
  for (let i = 1; i < l; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xff) unknown = false; }
  return { v: unknown ? -1 : v, l };
}
// a size in exactly l bytes (the element keeps its place), undefined when it doesn't fit
function sizeBytes(v: number, l: number): Uint8Array | undefined {
  if (v >= 2 ** (7 * l) - 1) return undefined;
  const out = new Uint8Array(l);
  for (let i = l - 1, x = v; i >= 0; i--, x = Math.floor(x / 256)) out[i] = x % 256;
  out[0] |= 0x80 >> (l - 1);
  return out;
}
// The file's first bytes with the length (ms) in its Info; undefined: leave the file as it is
export function webmDuration(head: Uint8Array, ms: number): Uint8Array<ArrayBuffer> | undefined {
  const e = readId(head, 0), es = e && readSize(head, e.l);
  if (e?.v !== EBML || !es || es.v < 0) return undefined;
  const sAt = e.l + es.l + es.v, s = readId(head, sAt), ss = s && readSize(head, sAt + s.l);
  if (s?.v !== SEGMENT || !ss) return undefined;
  for (let q = sAt + s.l + ss.l; q < head.length;) {
    const id = readId(head, q), sz = id && readSize(head, q + id.l);
    if (!id || !sz || sz.v < 0) return undefined;
    // (a SeekHead points at what comes after Info, which would move; Info is always before the clusters)
    if (id.v === SEEKHEAD || id.v === CLUSTER) return undefined;
    if (id.v !== INFO) { q += id.l + sz.l + sz.v; continue; }
    const body = q + id.l + sz.l, end = body + sz.v;
    if (end > head.length) return undefined;
    let scale = 1e6, dur = -1, durLen = 0;
    for (let r = body; r < end;) {
      const ci = readId(head, r), cs = ci && readSize(head, r + ci.l);
      if (!ci || !cs || cs.v < 0) return undefined;
      const at = r + ci.l + cs.l;
      if (ci.v === SCALE) { scale = 0; for (let k = 0; k < cs.v; k++) scale = scale * 256 + head[at + k]; }
      if (ci.v === DURATION) { dur = at; durLen = cs.v; }
      r = at + cs.v;
    }
    const units = (ms * 1e6) / (scale || 1e6);      // (in the file's time units: usually ms)
    if (dur >= 0) {
      // one that's there already: only a zero is filled in
      if (durLen !== 8 && durLen !== 4) return undefined;
      const out = head.slice(), dv = new DataView(out.buffer);
      if ((durLen === 8 ? dv.getFloat64(dur) : dv.getFloat32(dur)) > 0) return undefined;
      if (durLen === 8) dv.setFloat64(dur, units); else dv.setFloat32(dur, units);
      return out;
    }
    const el = new Uint8Array(11);
    el.set([0x44, 0x89, 0x88]);                     // Duration, 8 bytes: a 64-bit float
    new DataView(el.buffer).setFloat64(3, units);
    const infoSize = sizeBytes(sz.v + el.length, sz.l), segSize = ss.v < 0 ? undefined : sizeBytes(ss.v + el.length, ss.l);
    if (!infoSize || (ss.v >= 0 && !segSize)) return undefined;
    const out = new Uint8Array(head.length + el.length);
    out.set(head.subarray(0, end)); out.set(el, end); out.set(head.subarray(end), end + el.length);
    out.set(infoSize, q + id.l);
    if (segSize) out.set(segSize, sAt + s.l);
    return out;
  }
  return undefined;
}
// the file with its length written in (WebM; anything else as it is)
export async function withDuration(blob: Blob, ms: number): Promise<Blob> {
  if (!/webm/i.test(blob.type) || !(ms > 0)) return blob;
  try {
    const n = Math.min(blob.size, 65536), fixed = webmDuration(new Uint8Array(await blob.slice(0, n).arrayBuffer()), ms);
    return fixed ? new Blob([fixed, blob.slice(n)], { type: blob.type }) : blob;
  } catch { return blob; }
}

// Hands the file to the browser as a download
export function saveVideo(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  // (a long video takes a moment to hand over)
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
