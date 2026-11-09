// A video file for a Picture effect: the browser decodes it (MP4, WebM, whatever it can play),
// frames are taken off it at an even pace and packed like an animated GIF's (gif.ts). At most the
// Picture effect's frames (64), from the first seconds of the clip: an LED matrix plays a short
// loop, not a film. Nothing of the file leaves the computer.
import { FrameKeeper, PictureError, fitSize, packFitting, shrink, type Loaded } from './gif';
import { PICTURE_LIMITS } from './custom';

export const VIDEO = { fps: 12, seconds: 8 };
export const isVideo = (f: Blob & { name?: string }) => /^video\//.test(f.type) || /\.(mp4|m4v|webm|mov|ogv|mkv)$/i.test(f.name ?? '');

const once = (el: HTMLMediaElement, ok: string, ms = 8000) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => { done(); reject(new PictureError('That video took too long to read')); }, ms);
  const yes = () => { done(); resolve(); };
  const no = () => { done(); reject(new PictureError('That video could not be read (MP4 or WebM, as this browser plays them)')); };
  const done = () => { clearTimeout(t); el.removeEventListener(ok, yes); el.removeEventListener('error', no); };
  el.addEventListener(ok, yes); el.addEventListener('error', no);
});

export async function loadVideo(file: Blob): Promise<Loaded> {
  if (typeof document === 'undefined') throw new PictureError('This browser can\'t read videos');
  const url = URL.createObjectURL(file), v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  try {
    await once(v, 'loadedmetadata');
    if (!v.videoWidth || !v.videoHeight) throw new PictureError('That file has no picture in it');
    const length = Number.isFinite(v.duration) && v.duration > 0 ? Math.min(v.duration, VIDEO.seconds) : VIDEO.seconds;
    const n = Math.max(1, Math.min(PICTURE_LIMITS.frames, Math.round(length * VIDEO.fps))), step = length / n;
    // (the browser scales a big frame down first, we take it from there, as for a photo)
    const [cw, ch] = fitSize(v.videoWidth, v.videoHeight, 640, 640), [w, h] = fitSize(cw, ch);
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new PictureError('This browser can\'t read videos');
    const keep = new FrameKeeper();
    for (let i = 0; i < n; i++) {
      v.currentTime = Math.min(length - 0.001, (i + 0.5) * step);
      await once(v, 'seeked');
      ctx.drawImage(v, 0, 0, cw, ch);
      keep.add(shrink(ctx.getImageData(0, 0, cw, ch).data, 4, cw, ch, w, h), Math.round(step * 1000));
    }
    const { frames, delays } = keep.done();
    const fit = packFitting(w, h, frames, delays);
    return { ...fit, frames: frames.length, ms: delays.reduce((a, b) => a + b, 0), from: { w: v.videoWidth, h: v.videoHeight, frames: n } };
  } finally {
    v.removeAttribute('src'); v.load();
    URL.revokeObjectURL(url);
  }
}
