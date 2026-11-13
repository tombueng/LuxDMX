// The gallery's animations for the README (sequencer/docs/media/gallery/*.webp): each item of
// src/content/gallery.ts drawn frame by frame by the app's own preview renderer (stage3d/preview.ts
// frames()), then made into an animated WebP with ffmpeg (a sixth of a GIF's size, and all the
// colours; --gif makes GIFs instead, their own palette each).
//
//   node tools/gallery/capture.mjs [--url http://127.0.0.1:5173/] [--only gobos,prism] [--w 480 --h 270 --secs 4 --fps 20] [--gif]
//
// Needs the dev server running (npm run dev). Google Chrome on the graphics card when it's there.
// The frames and the GIFs land in docs/media/gallery/ (frames in its .frames/ folder, kept to look
// at; gitignored). ffmpeg runs at low priority on cores 10-15 (the machine stays usable).
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg('url', 'http://127.0.0.1:5173/');
const W = +arg('w', 480), H = +arg('h', 270), SECS = +arg('secs', 4), FPS = +arg('fps', 20);
const ONLY = arg('only', '')?.split(',').filter(Boolean) ?? [];
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);       // (the sequencer's folder)
const OUT = path.join(ROOT, 'docs/media/gallery'), FRAMES = path.join(OUT, '.frames');
fs.mkdirSync(FRAMES, { recursive: true });

const GPU_CHROME = '/usr/bin/google-chrome';
const useGpu = fs.existsSync(GPU_CHROME) && !process.argv.includes('--no-gpu');
const browser = await chromium.launch({ headless: true, executablePath: useGpu ? GPU_CHROME : undefined, args: useGpu ? ['--ignore-gpu-blocklist', '--enable-gpu'] : ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL_);
await page.waitForFunction(() => !!(window).__luxdmx, null, { timeout: 30000 });
const items = await page.evaluate(async () => (await import('/src/content/gallery.ts')).GALLERY);
for (const g of items) {
  if (ONLY.length && !ONLY.includes(g.id)) continue;
  const t0 = Date.now();
  // the preview module and its frames (a dynamic import pulls three.js in once)
  const urls = await page.evaluate(async ({ g, W, H, SECS, FPS }) => {
    const { GENERIC } = await import('/src/model/library.ts');
    const { frames } = await import('/src/stage3d/preview.ts');
    const type = GENERIC.find((t) => t.id === g.type), extra = g.extra ? GENERIC.find((t) => t.id === g.extra) : undefined;
    return frames({ type, copies: g.copies, focus: g.focus, extra }, { w: W, h: H, n: Math.round(SECS * FPS), fps: FPS });
  }, { g, W, H, SECS, FPS });
  const dir = path.join(FRAMES, g.id);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  urls.forEach((u, i) => fs.writeFileSync(path.join(dir, `${String(i).padStart(4, '0')}.png`), Buffer.from(u.split(',')[1], 'base64')));
  const GIF = process.argv.includes('--gif'), gif = path.join(OUT, `${g.id}.${GIF ? 'gif' : 'webp'}`);
  const enc = GIF ? ['-filter_complex', '[0:v]split[a][b];[a]palettegen=max_colors=192:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a']
    : ['-c:v', 'libwebp', '-lossless', '0', '-q:v', '72', '-compression_level', '6'];
  const r = spawnSync('nice', ['-n', '19', 'taskset', '-c', '10-15', 'ffmpeg', '-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(dir, '%04d.png'),
    ...enc, '-loop', '0', '-an', gif], { stdio: 'inherit' });
  const kb = fs.existsSync(gif) ? Math.round(fs.statSync(gif).size / 1024) : 0;
  console.log(`${g.id.padEnd(10)} ${urls.length} frames  ${kb} kB  ${((Date.now() - t0) / 1000).toFixed(1)} s${r.status ? '  ffmpeg failed' : ''}`);
}
await browser.close();
