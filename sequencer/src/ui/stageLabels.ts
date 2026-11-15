// Names that don't run into each other on the 2D plan: each label goes under its light, or beside
// it (right, then left), above it only last (the front row the other way round, clear of the
// audience's edge). One that fits nowhere is left out (hover shows it; a selected light always gets
// its name). A name must read as its own light's: no other light clearly nearer to it. Like the
// labels on a map. Pure: StageView hands in the lights, their widths and the plan's size.
import type { Fixture } from '../model/types';

export type At = { x: number; y: number; anchor: 'middle' | 'start' | 'end' };
export interface Labels {
  fixtures: Fixture[]; selected: readonly string[];
  text: (f: Fixture) => string;           // what its label says
  halfW: (id: string) => number;          // half a light's symbol's width on the plan
  size: number; px: number; W: number; H: number; edge: number;
}

// (a crowded plan, a short screen: when not even 70 % of the names fit at the size asked, they're
// tried a size smaller, and the size that fits more wins; `lpx` the interface's size, `px` its normal)
export function bestLabels(o: Labels, lpx: number): { at: Map<string, At | null>; fs: number } {
  const a = placeLabels(o, 12 * lpx), n = o.fixtures.length, shown = (m: Map<string, At | null>) => [...m.values()].filter(Boolean).length;
  if (shown(a) >= n * 0.7) return { at: a, fs: 12 * lpx };
  const b = placeLabels(o, 10.5 * lpx);
  if (shown(b) >= n * 0.7 || lpx === o.px) return shown(b) > shown(a) ? { at: b, fs: 10.5 * lpx } : { at: a, fs: 12 * lpx };
  // (bigger than they fit: the normal sizes then)
  const c = placeLabels(o, 10.5 * o.px);
  return [{ at: a, fs: 12 * lpx }, { at: b, fs: 10.5 * lpx }, { at: c, fs: 10.5 * o.px }].reduce((x, y) => (shown(y.at) > shown(x.at) ? y : x));
}

export function placeLabels(o: Labels, fs: number): Map<string, At | null> {
  const { fixtures, selected, text: labelText, halfW, size, px, W, H, edge: EDGE } = o;
  const out = new Map<string, At | null>();
  // Boxes (the lights' bodies, then each placed name) go into columns of the stage, so a name
  // only checks what's near it: a big rig stays quick while a light is dragged around.
  type Box = { x0: number; x1: number; y0: number; y1: number; id?: string };
  const G = 160 * px, grid = new Map<number, Box[]>();
  const cols = (b: Box) => { const out: number[] = []; for (let c = Math.floor(b.x0 / G); c <= Math.floor(b.x1 / G); c++) out.push(c); return out; };
  const put = (b: Box) => { for (const c of cols(b)) { const l = grid.get(c); if (l) l.push(b); else grid.set(c, [b]); } };
  const hits = (b: Box, self: string) => cols(b).some((c) => grid.get(c)?.some((o) => o.id !== self && o.x0 < b.x1 && b.x0 < o.x1 && o.y0 < b.y1 && b.y0 < o.y1));
  for (const f of fixtures) { const w = halfW(f.id), x = f.x * W, y = f.y * H; put({ id: f.id, x0: x - w, x1: x + w, y0: y - size * 0.7, y1: y + size * 0.7 }); }
  // the word "audience" at the front edge is in the way too
  put({ id: 'audience', x0: W / 2 - 34 * px, x1: W / 2 + 34 * px, y0: H - 30, y1: H - 12 });
  // and so are the stage's measurements, "14 m wide" at the top and "9 m deep" at the side
  put({ id: 'wide', x0: W / 2 - 32 * px, x1: W / 2 + 32 * px, y0: 2 * px, y1: 24 * px });
  put({ id: 'deep', x0: 8 * px, x1: 22 * px, y0: H / 2 - 28 * px, y1: H / 2 + 28 * px });
  // (a name reads as the light nearest to it: every other light clearly further from the label
  // than its own, else it's left out rather than mistaken for that one's)
  // (above it, the last resort, it has to be clearly its own: that's where a name read as the
  // light in the row before)
  // (distances to the edge of a light's symbol: a long bar's name at its end is next to it)
  const gapTo = (o: Fixture, cx: number, cy: number) => { const w = halfW(o.id), h = size * 0.7, x = o.x * W, y = o.y * H; return Math.hypot(Math.max(x - w - cx, 0, cx - x - w), Math.max(y - h - cy, 0, cy - y - h)); };
  const ownest = (f: Fixture, b: Box, k: number) => {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, own = gapTo(f, cx, cy);
    for (const o of fixtures) if (o !== f && Math.abs(cx - o.x * W) < own * k + halfW(o.id) && gapTo(o, cx, cy) < own * k) return false;
    return true;
  };
  const sel = new Set(selected);
  const order = [...fixtures].sort((a, b) => Number(sel.has(b.id)) - Number(sel.has(a.id)));
  for (const f of order) {
    const x = f.x * W, y = f.y * H, half = labelText(f).length * fs * 0.3 + 2 * px, side = halfW(f.id) + 4 * px;
    const below = y + size * 1.15 + 13 * px, above = y - size * 1.1 - 4 * px, mid = y + fs * 0.35;
    // under it, else beside it (level with it: it can't be read as another's), above only last
    // (a name above sat right under the light in the row before and read as that one's); the
    // front row the other way round, clear of the audience's edge
    const [first, last] = y > H * 0.86 ? [above, below] : [below, above];
    const tries: At[] = [{ x, y: first, anchor: 'middle' }, { x: x + side, y: mid, anchor: 'start' }, { x: x - side, y: mid, anchor: 'end' }, { x, y: last, anchor: 'middle' }];
    let at: At | null = null;
    for (const [n, t] of tries.entries()) {
      const x0 = t.anchor === 'middle' ? t.x - half : t.anchor === 'start' ? t.x : t.x - 2 * half, x1 = x0 + 2 * half;
      const b: Box = { x0, x1, y0: t.y - fs * 0.9, y1: t.y + fs * 0.3, id: `label:${f.id}` };
      // (inside the plan both ways: a name over a light in the back row stuck out of the top)
      if (x0 >= 0 && x1 <= W && b.y0 >= -H * EDGE && b.y1 <= H * (1 + EDGE) && !hits(b, f.id) && (n < 3 || ownest(f, b, 1.15))) { at = t; put(b); break; }
    }
    out.set(f.id, at ?? (sel.has(f.id) ? tries[0] : null));
  }
  return out;
}