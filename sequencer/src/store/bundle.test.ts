// A show with its songs in one .zip: what the show names goes in (each song once, the venue model),
// comes out under the same keys; a song the browser hasn't got is left out and said; a zip of
// someone else's with a show file in it still opens; anything else says what's wrong.
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { bundle, isZip, storedOf, unbundle } from './bundle';
import { emptyShow } from '../model/format';
import type { Show } from '../model/types';

function show(): Show {
  const s = emptyShow();
  s.timeline = { audio: { name: 'Two.mp3', duration: 3, store: 'abc:Two.mp3' }, duration: 3, items: [] } as unknown as Show['timeline'];
  s.setlist = { before: [{ audio: { name: 'One.mp3', duration: 2, store: 'abc:One.mp3' }, duration: 2, items: [] }], after: [
    { audio: { name: 'Two.mp3', duration: 3, store: 'abc:Two.mp3' }, duration: 3, items: [] },          // (the same file twice in the set)
    { demo: true, duration: 30, items: [] },
    { audio: { name: 'Gone.mp3', duration: 1, store: 'abc:Gone.mp3' }, duration: 1, items: [] },
  ] } as unknown as Show['setlist'];
  s.settings.stage3d = { model: { name: 'club.glb', store: 'model:club', scale: 1, x: 0, y: 0, z: 0, yaw: 0 } };
  return s;
}
const bytes = (n: number, k: number) => new Blob([new Uint8Array(n).map((_, i) => (i * k) & 255)]);
const store: Record<string, Blob> = { 'abc:One.mp3': bytes(1000, 3), 'abc:Two.mp3': bytes(2000, 7), 'model:club': bytes(500, 11) };
const get = { song: async (k: string) => store[k], model: async (k: string) => store[k] };

describe('a show with its songs', () => {
  it('names each song once (the one up and the set\'s), and the venue', () => {
    const st = storedOf(show());
    expect(st.songs.map((s) => s.key)).toEqual(['abc:One.mp3', 'abc:Two.mp3', 'abc:Gone.mp3']);
    expect(st.model).toEqual({ key: 'model:club', name: 'club.glb' });
    expect(storedOf(emptyShow())).toEqual({ songs: [], model: undefined });
  });
  it('goes into a zip and comes out the same, under the same keys; a missing song is said', async () => {
    const s = show(), json = JSON.stringify({ name: 'x' });
    const b = await bundle(json, s, get);
    expect(b.songs).toBe(2);
    expect(b.missing).toEqual(['Gone.mp3']);
    const raw = new Uint8Array(await b.blob.arrayBuffer());
    expect(isZip(raw)).toBe(true);
    const u = unbundle(raw);
    expect(u.json).toBe(json);
    expect(u.songs.map((x) => x.key)).toEqual(['abc:One.mp3', 'abc:Two.mp3']);
    for (const x of u.songs) expect(new Uint8Array(await x.blob.arrayBuffer())).toEqual(new Uint8Array(await store[x.key].arrayBuffer()));
    expect(u.model?.key).toBe('model:club');
    expect(new Uint8Array(await u.model!.blob.arrayBuffer())).toEqual(new Uint8Array(await store['model:club'].arrayBuffer()));
  });
  it('a zip with only a show file in it opens; no show in it, or not a zip, says so', () => {
    const plain = zipSync({ 'party.luxdmx.json': strToU8('{"a":1}') });
    expect(unbundle(plain)).toEqual({ json: '{"a":1}', songs: [], model: undefined });
    expect(() => unbundle(zipSync({ 'a.txt': strToU8('hi') }))).toThrow(/no show/);
    expect(() => unbundle(strToU8('PK\u0003\u0004 not really'))).toThrow(/could not read/);
    expect(isZip(strToU8('{"format"'))).toBe(false);
  });
});
