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
  // a curtain or a drop: a thin line across the stage. Another light's name may sit on it (it reads,
  // with its dark outline) and is never taken for the cloth's own: four fly bars and a curtain
  // across the theatre's stage left out a third of its names.
  cloth?: (id: string) => boolean;
}

// (a crowded plan, a short screen: when not even three quarters of the names fit at the size asked,
// they're tried a size smaller, and the size that fits more wins; `lpx` the interface's size, `px`
// its normal)
export function bestLabels(o: Labels, lpx: number): { at: Map<string, At | null>; fs: number } {
  const a = placeLabels(o, 12 * lpx), n = o.fixtures.length, shown = (m: Map<string, At | null>) => [...m.values()].filter(Boolean).length;
  if (shown(a) >= n * 0.75) return { at: a, fs: 12 * lpx };
  const b = placeLabels(o, 10.5 * lpx);
  if (shown(b) >= n * 0.75 || lpx === o.px) return shown(b) > shown(a) ? { at: b, fs: 10.5 * lpx } : { at: a, fs: 12 * lpx };
  // (bigger than they fit: the normal sizes then)
  const c = placeLabels(o, 10.5 * o.px);
  return [{ at: a, fs: 12 * lpx }, { at: b, fs: 10.5 * lpx }, { at: c, fs: 10.5 * o.px }].reduce((x, y) => (shown(y.at) > shown(x.at) ? y : x));
}

export function placeLabels(o: Labels, fs: number): Map<string, At | null> {
  const { fixtures, selected, text: labelText, halfW, size, px, W, H, edge: EDGE } = o, cloth = o.cloth ?? (() => false);
  const halfH = (id: string) => (cloth(id) ? size * 0.4 : size * 0.7);
  const out = new Map<string, At | null>();
  // Boxes (the lights' bodies, then each placed name) go into columns of the stage, so a name
  // only checks what's near it: a big rig stays quick while a light is dragged around.
  type Box = { x0: number; x1: number; y0: number; y1: number; id?: string };
  const G = 160 * px, grid = new Map<number, Box[]>();
  const cols = (b: Box) => { const out: number[] = []; for (let c = Math.floor(b.x0 / G); c <= Math.floor(b.x1 / G); c++) out.push(c); return out; };
  const put = (b: Box) => { for (const c of cols(b)) { const l = grid.get(c); if (l) l.push(b); else grid.set(c, [b]); } };
  const hits = (b: Box, self: string) => cols(b).some((c) => grid.get(c)?.some((o) => o.id !== self && o.x0 < b.x1 && b.x0 < o.x1 && o.y0 < b.y1 && b.y0 < o.y1));
  // (a cloth isn't in the way: a name over its thin line reads, it has its dark outline)
  for (const f of fixtures) { if (cloth(f.id)) continue; const w = halfW(f.id), h = halfH(f.id), x = f.x * W, y = f.y * H; put({ id: f.id, x0: x - w, x1: x + w, y0: y - h, y1: y + h }); }
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
  const gapTo = (o: Fixture, cx: number, cy: number) => { const w = halfW(o.id), h = halfH(o.id), x = o.x * W, y = o.y * H; return Math.hypot(Math.max(x - w - cx, 0, cx - x - w), Math.max(y - h - cy, 0, cy - y - h)); };
  const ownest = (f: Fixture, b: Box, k: number) => {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, own = gapTo(f, cx, cy);
    for (const o of fixtures) if (o !== f && !cloth(o.id) && Math.abs(cx - o.x * W) < own * k + halfW(o.id) && gapTo(o, cx, cy) < own * k) return false;
    return true;
  };
  const sel = new Set(selected);
  // (the picked ones first, then the cloths: a few, and which drop is which is what a plan's for)
  const rank = (f: Fixture) => (sel.has(f.id) ? 2 : cloth(f.id) ? 1 : 0);
  const order = [...fixtures].sort((a, b) => rank(b) - rank(a));
  for (const f of order) {
    const x = f.x * W, y = f.y * H, half = labelText(f).length * fs * 0.3 + 2 * px, side = halfW(f.id) + 4 * px;
    const below = y + size * 1.15 + 13 * px, above = y - size * 1.1 - 4 * px, mid = y + fs * 0.35;
    // under it, else beside it (level with it: it can't be read as another's), above only last
    // (a name above sat right under the light in the row before and read as that one's); the
    // front row the other way round, clear of the audience's edge
    const [first, last] = y > H * 0.86 ? [above, below] : [below, above];
    // (a cloth across the stage: its name at one of its ends, inside the plan, just off its line;
    // the middle of the stage is where the lights' own names are)
    const end = Math.min(halfW(f.id), W / 2) - 4 * px, off = size * 0.4 + fs;
    const tries: At[] = cloth(f.id)
      ? [{ x: x + end, y: y + off, anchor: 'end' }, { x: x - end, y: y + off, anchor: 'start' }, { x: x + end, y: y - size * 0.4 - 3 * px, anchor: 'end' }, { x: x - end, y: y - size * 0.4 - 3 * px, anchor: 'start' }]
      : [{ x, y: first, anchor: 'middle' }, { x: x + side, y: mid, anchor: 'start' }, { x: x - side, y: mid, anchor: 'end' }, { x, y: last, anchor: 'middle' }];
    let at: At | null = null;
    for (const [n, t] of tries.entries()) {
      const x0 = t.anchor === 'middle' ? t.x - half : t.anchor === 'start' ? t.x : t.x - 2 * half, x1 = x0 + 2 * half;
      // (a name's box as the browser draws it: its font's ascent about the font size, its descent a
      // third; 0.9 and 0.3 let one name's top touch the bottom of the name above it)
      const b: Box = { x0, x1, y0: t.y - fs * 1.0, y1: t.y + fs * 0.35, id: `label:${f.id}` };
      // (inside the plan both ways: a name over a light in the back row stuck out of the top)
      if (x0 >= 0 && x1 <= W && b.y0 >= -H * EDGE && b.y1 <= H * (1 + EDGE) && !hits(b, f.id) && (n < 3 || ownest(f, b, 1.15))) { at = t; put(b); break; }
    }
    out.set(f.id, at ?? (sel.has(f.id) ? tries[0] : null));
  }
  return out;
}