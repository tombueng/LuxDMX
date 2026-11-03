// A decoded song to its tempo, first downbeat and parts (analyze.ts), in the browser: the sound
// made mono at 11 kHz by the browser's own audio renderer (off the page), the sums in a worker. No
// worker (an old browser, the unit tests): on the page, in slices of a few milliseconds.
import { analyzeSteps, RATE, type SongAnalysis } from './analyze';

export async function analyzeAudio(buf: AudioBuffer): Promise<SongAnalysis> {
  const samples = await monoOf(buf);
  // (handed to the worker, not copied: when it fails they're made again for the page)
  return (await inWorker(samples)) ?? (await inSlices(samples.byteLength ? samples : await monoOf(buf)));
}

// the song as one channel at RATE
async function monoOf(buf: AudioBuffer): Promise<Float32Array> {
  try {
    const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * RATE)), RATE);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination); src.start();
    return (await ctx.startRendering()).getChannelData(0).slice();
  } catch {
    // (no offline renderer: the channels averaged and thinned out, a bit at a time)
    const step = buf.sampleRate / RATE, n = Math.floor(buf.length / step), out = new Float32Array(n), chs = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
    for (let i = 0; i < n; i += 65536) {
      for (let j = i, e = Math.min(n, i + 65536); j < e; j++) {
        const a = Math.floor(j * step), b = Math.max(a + 1, Math.floor((j + 1) * step));
        let s = 0; for (const ch of chs) for (let k = a; k < b; k++) s += ch[k];
        out[j] = s / ((b - a) * chs.length);
      }
      await pause();
    }
    return out;
  }
}

function inWorker(samples: Float32Array): Promise<SongAnalysis | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(null);
  let w: Worker;
  try { w = new Worker(new URL('./analyze.worker.ts', import.meta.url), { type: 'module' }); } catch { return Promise.resolve(null); }
  return new Promise((done) => {
    const end = (r: SongAnalysis | null) => { clearTimeout(timer); w.terminate(); done(r); };
    // (a worker that never answers: the page does it after all)
    const timer = setTimeout(() => end(null), 30000);
    w.onmessage = (e: MessageEvent<{ ok: boolean; result?: SongAnalysis }>) => end(e.data.ok && e.data.result ? e.data.result : null);
    w.onerror = () => end(null);
    w.postMessage({ samples, rate: RATE }, [samples.buffer]);
  });
}

// On the page: never more than about 12 ms at a time, then the page gets its turn.
async function inSlices(samples: Float32Array): Promise<SongAnalysis> {
  const it = analyzeSteps(samples, RATE);
  for (;;) {
    const t0 = performance.now();
    for (;;) {
      const r = it.next();
      if (r.done) return r.value;
      if (performance.now() - t0 > 12) break;
    }
    await pause();
  }
}
const pause = () => new Promise<void>((r) => setTimeout(r, 0));
