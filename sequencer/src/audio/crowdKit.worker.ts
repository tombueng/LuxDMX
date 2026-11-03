// Making the crowd's sounds away from the page (crowdKit.ts): the DMX output and the 3D stage share
// the page, so the second or so of sums happens here. The sounds go back handed over, not copied.
import { makeKit, type Kit } from './crowdKit';

const post = (m: unknown, move: Transferable[] = []) => (self as unknown as Worker).postMessage(m, move);
self.onmessage = (e: MessageEvent<{ rate: number }>) => {
  try {
    const kit: Kit = makeKit(e.data.rate);
    const all = [...kit.chatter, ...kit.roar, ...kit.woos, ...kit.whistles];
    post({ ok: true, kit }, all.map((x) => x.buffer));
  } catch (err) { post({ ok: false, why: String(err) }); }
};
