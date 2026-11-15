// @vitest-environment happy-dom
// Saving a show settles however the browser ends the write: done, an error, or thrown away at its
// commit (a full disk aborts the transaction and only `abort` fires). It said "saving..." for good.
import { afterEach, describe, expect, it, vi } from 'vitest';

// a stand-in IndexedDB: one database, transactions that end the way `end` says
function fakeIdb(end: 'complete' | 'abort') {
  const tx = () => {
    const t: Record<string, unknown> = { error: end === 'abort' ? new DOMException('full', 'QuotaExceededError') : null };
    const store = { put: () => ({}), delete: () => ({}), get: () => { const r: Record<string, unknown> = { result: undefined }; return r; }, getAll: () => ({ result: [] }) };
    t.objectStore = () => store;
    setTimeout(() => (end === 'complete' ? (t.oncomplete as () => void)?.() : (t.onabort as () => void)?.()), 5);
    return t;
  };
  const db = { transaction: tx, objectStoreNames: { contains: () => true }, onversionchange: null };
  return { open: () => { const req: Record<string, unknown> = { result: db }; setTimeout(() => (req.onsuccess as () => void)?.(), 1); return req; } };
}
const meta = { id: 's1', name: 'S', modified: '2026-11-15T10:00:00Z', fixtures: 0, cues: 0, thumb: '' };

describe('saving a show', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  it('done: it resolves', async () => {
    vi.stubGlobal('indexedDB', fakeIdb('complete'));
    const { writeShow } = await import('./shows');
    await expect(writeShow(meta, '{}')).resolves.toBeUndefined();
  });
  it('thrown away at its commit (a full disk): it rejects, it doesn\'t wait for ever', async () => {
    vi.stubGlobal('indexedDB', fakeIdb('abort'));
    const { writeShow, deleteShow, listShows } = await import('./shows');
    await expect(writeShow(meta, '{}')).rejects.toThrow(/full/);
    await expect(deleteShow('s1')).rejects.toThrow(/full/);
    await expect(listShows()).rejects.toThrow(/full/);
  });
});

describe('keeping a song', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  it('thrown away at its commit: it rejects (and lets go of the database)', async () => {
    let closed = 0;
    const idb = fakeIdb('abort');
    vi.stubGlobal('indexedDB', { open: () => { const r = idb.open() as Record<string, unknown>; (r.result as Record<string, unknown>).close = () => closed++; return r; } });
    const { putSong } = await import('./audio');
    await expect(putSong('k', new Blob(['x']))).rejects.toThrow(/full/);
    expect(closed).toBe(1);
  });
});
