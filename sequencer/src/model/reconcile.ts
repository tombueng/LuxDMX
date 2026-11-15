// Bring a show (the live one, a Svelte $state proxy) to equal another (an undo step, parsed from its
// text) by changing only what differs: an object keeps its identity and gets its changed fields, a
// list of things with ids keeps the ones still there (matched by id) and takes the new ones in their
// places. So an undo on a big rig redraws what changed, not every row, card and light (replacing
// the whole show made Svelte rebuild all of it: most of a second on the festival).
// Objects with a prototype of their own (the raw fixture types and cell maps, app.svelte.ts) are
// never changed in place: one that's the same as before (as text) stays, else the new one goes in.
// Nor is an effect's `params` (the engine keeps what it worked out from them, a formula compiled, a
// picture unpacked, by the object: a changed one has to be a new object).
const ATOMIC = new Set(['params']);

const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const ided = (a: unknown[]) => a.length > 0 && a.every((x) => plain(x) && typeof x.id === 'string');

// `to` made equal to `from` where it can be (changed in place); what to put where `to` was.
// `note.moved`: a field was added to a thing that was there, so the text of `to` may list its
// fields in another order than `from`'s (everything else keeps `from`'s order)
export function reconcile<T>(to: T, from: T, note: { moved: boolean } = { moved: false }): T {
  if (Object.is(to, from)) return to;
  if (to === null || from === null || typeof to !== 'object' || typeof from !== 'object') return from;
  if (Array.isArray(to) && Array.isArray(from)) return reconcileArray(to, from, note) as T;
  if (plain(to) && plain(from)) {
    const t = to as Record<string, unknown>, f = from as Record<string, unknown>;
    for (const k of Object.keys(t)) if (!(k in f)) delete t[k];
    for (const k of Object.keys(f)) {
      if (!(k in t)) note.moved = true;
      const v = ATOMIC.has(k) ? same(t[k], f[k]) : reconcile(t[k], f[k], note);
      if (!Object.is(v, t[k])) t[k] = v;
    }
    return to;
  }
  // (raw things, or a thing of another kind: kept when the same, else the new one)
  if (!Array.isArray(to) && !Array.isArray(from) && Object.getPrototypeOf(to) === Object.getPrototypeOf(from) && JSON.stringify(to) === JSON.stringify(from)) return to;
  return from;
}

// (kept when the same as text, else the new one)
const same = (to: unknown, from: unknown) => (Object.is(to, from) || JSON.stringify(to) === JSON.stringify(from) ? to : from);

function reconcileArray(to: unknown[], from: unknown[], note: { moved: boolean }): unknown[] {
  let out: unknown[];
  if (ided(from) && to.every((x) => plain(x) && typeof x.id === 'string')) {
    const was = new Map((to as { id: string }[]).map((x) => [x.id, x]));
    out = (from as { id: string }[]).map((x) => { const old = was.get(x.id); return old ? reconcile(old, x, note) : x; });
  } else out = from.map((x, i) => (i < to.length ? reconcile(to[i], x, note) : x));
  if (out.length === to.length && out.every((x, i) => Object.is(x, to[i]))) return to;
  to.splice(0, to.length, ...out);
  return to;
}
