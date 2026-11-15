// The catalog's songs kept for offline (the browser's Cache Storage, a cache of its own the app's
// updates leave alone). A song played once online is kept; the demos' and the templates' songs all
// come down in the background as soon as one of them is used, so every demo plays at a venue
// without internet. Where the browser has no Cache Storage (a page from a plain-http address) this
// does nothing and the songs come down each time, as before.

export const SONG_CACHE = 'luxdmx-songs';
const ok = () => typeof caches !== 'undefined' && typeof location !== 'undefined';
// (a song's place in the cache: an address that's never fetched, only a name)
const keyOf = (id: string) => new URL(`./offline-songs/${encodeURIComponent(id)}`, location.href).href;

export async function keptSong(id: string): Promise<File | null> {
  if (!ok()) return null;
  try {
    const r = await (await caches.open(SONG_CACHE)).match(keyOf(id));
    if (!r) return null;
    const b = await r.blob();
    return new File([b], decodeURIComponent(r.headers.get('x-name') ?? `${id}.mp3`), { type: b.type || 'audio/mpeg' });
  } catch { return null; }
}
export async function keepSong(id: string, file: File): Promise<void> {
  if (!ok()) return;
  try {
    await (await caches.open(SONG_CACHE)).put(keyOf(id), new Response(file, { headers: { 'content-type': file.type || 'audio/mpeg', 'x-name': encodeURIComponent(file.name) } }));
  } catch { /* storage full or blocked: it comes down again next time */ }
}
// which of these songs are here offline
export async function keptIds(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!ok()) return out;
  try {
    const c = await caches.open(SONG_CACHE);
    for (const id of ids) if (await c.match(keyOf(id))) out.add(id);
  } catch { /* none, then */ }
  return out;
}

// The demos' and the templates' songs, one after the other in the background, those not kept yet.
// `get`: how a song comes down (the catalog's download, which keeps it). Stops when offline.
let busy: Promise<void> | null = null;
export function keepDemoSongs(ids: string[], get: (id: string) => Promise<unknown>): Promise<void> {
  if (!ok() || busy) return busy ?? Promise.resolve();
  busy = (async () => {
    // (asked once: the browser may then keep the songs and shows even when it's short of room)
    try { await navigator.storage?.persist?.(); } catch { /* fine */ }
    const have = await keptIds(ids);
    for (const id of ids) {
      if (have.has(id)) continue;
      if (navigator.onLine === false) break;
      try { await get(id); } catch { /* that one later */ }
    }
  })().finally(() => { busy = null; });
  return busy;
}
