// Finding a song's tempo and parts away from the page (analyze.ts): the DMX output and the 3D stage
// share the page, so the few hundred milliseconds of sums happen here.
import { analyzeSong } from './analyze';

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
self.onmessage = (e: MessageEvent<{ samples: Float32Array; rate: number }>) => {
  try { post({ ok: true, result: analyzeSong(e.data.samples, e.data.rate) }); }
  catch (err) { post({ ok: false, why: String(err) }); }
};
