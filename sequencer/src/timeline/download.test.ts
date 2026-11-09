// Downloading a demo song: the artist's file first, our copy when that fails, progress as it comes,
// and what went wrong in plain words.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SongError, creditOf, downloadSong, fileNameOf } from './download';
import type { CatalogSong } from './catalog';

const song: CatalogSong = {
  id: 'test', title: 'Night Bus', artist: 'The Testers', genre: 'rock', vocals: true, license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  page: 'https://example.org/night-bus', url: 'https://example.org/night-bus.mp3', mirror: 'songs/test.mp3', sha256: '0'.repeat(64), bpm: 120, offset: 0.5, duration: 180,
  sections: [{ name: 'Intro', at: 0.5, energy: 0.3 }, { name: 'Chorus', at: 30.5, energy: 1 }],
};
// a response whose body arrives in pieces (an MP3: it starts with its ID3 tag, unless `head` says otherwise)
const ID3 = [0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0, 0];
const streamed = (chunks: number[], headers: Record<string, string> = {}, head: number[] = ID3) => new Response(new ReadableStream({
  start(c) { chunks.forEach((n, i) => { const b = new Uint8Array(n); if (!i) b.set(head.slice(0, n)); c.enqueue(b); }); c.close(); },
}), { headers });
const text = (s: string) => [...new TextEncoder().encode(s)];
// a response that never comes (or never says more): the next address after `stallMs`
const never = () => new Promise<Response>(() => {});
const stuck = (n: number) => new Response(new ReadableStream({ start(c) { const b = new Uint8Array(n); b.set(ID3); c.enqueue(b); } }), { headers: { 'content-type': 'audio/mpeg' } });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('downloading a demo song', () => {
  it("from the artist's own file, with progress, as a file named after the song", async () => {
    const fetch = vi.fn(async () => streamed([1000, 2000, 3000], { 'content-length': '6000', 'content-type': 'audio/mpeg' }));
    vi.stubGlobal('fetch', fetch);
    const seen: [number, number][] = [];
    const f = await downloadSong(song, (got, total) => seen.push([got, total]));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual([song.url, expect.anything()]);
    expect(seen).toEqual([[0, 6000], [1000, 6000], [3000, 6000], [6000, 6000]]);
    expect(f.name).toBe('The Testers - Night Bus.mp3');
    expect(f.type).toBe('audio/mpeg');
    expect(f.size).toBe(6000);
  });
  it('from our copy when the artist\'s file is blocked or gone', async () => {
    for (const first of [() => { throw new TypeError('Failed to fetch'); }, () => new Response('no', { status: 404 })]) {
      const fetch = vi.fn().mockImplementationOnce(async () => first()).mockImplementationOnce(async () => streamed([500], { 'content-type': 'audio/ogg' }));
      vi.stubGlobal('fetch', fetch);
      const f = await downloadSong(song, () => {});
      expect(fetch.mock.calls.map((c) => c[0])).toEqual([song.url, song.mirror]);
      expect(f.size).toBe(500);
      expect(f.name).toBe('The Testers - Night Bus.ogg');
    }
  });
  it('our copy here isn\'t there either (a local server): the one on the public site', async () => {
    const fetch = vi.fn()
      .mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); })
      .mockImplementationOnce(async () => new Response('<!doctype html><html>', { headers: { 'content-type': 'text/html' } }))
      .mockImplementationOnce(async () => streamed([700], { 'content-type': 'audio/mpeg' }));
    vi.stubGlobal('fetch', fetch);
    const f = await downloadSong(song, () => {});
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([song.url, song.mirror, 'https://tombueng.github.io/LuxDMX/sequencer/songs/test.mp3']);
    expect(f.size).toBe(700);
  });
  it('neither works: says so in plain words, and when the computer is offline, that', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(downloadSong(song, () => {})).rejects.toThrow(SongError);
    await expect(downloadSong(song, () => {})).rejects.toThrow(/"Night Bus" can't be downloaded right now/);
    vi.stubGlobal('navigator', { onLine: false });
    await expect(downloadSong(song, () => {})).rejects.toThrow(/this computer is offline/);
  });
  it('an empty file counts as not there', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamed([])));
    await expect(downloadSong(song, () => {})).rejects.toThrow(SongError);
  });
  it('stopped by the person: it stops, no message about the site', async () => {
    const ctl = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_u: string, o: { signal: AbortSignal }) => { ctl.abort(); o.signal.throwIfAborted(); return streamed([1]); }));
    await expect(downloadSong(song, () => {}, ctl.signal)).rejects.not.toThrow(SongError);
  });
  it("a page with status 200 (the host's \"file not found\") isn't the song: our copy is", async () => {
    for (const [page, headers] of [
      [text('<!DOCTYPE html><html><body>Not here</body></html>'), { 'content-type': 'text/html; charset=utf-8' }],
      [text('<!DOCTYPE html><html><body>Not here</body></html>'), { 'content-type': 'audio/mpeg' }],      // says it's a song, isn't
      [text('{"error":"gone"}'), { 'content-type': 'application/json' }],
      [text('<?xml version="1.0"?><Error>NoSuchKey</Error>'), { 'content-type': 'application/octet-stream' }],
    ] as [number[], Record<string, string>][]) {
      const fetch = vi.fn().mockImplementationOnce(async () => streamed([page.length + 4000], headers, page))
        .mockImplementationOnce(async () => streamed([700], { 'content-type': 'audio/mpeg' }));
      vi.stubGlobal('fetch', fetch);
      const f = await downloadSong(song, () => {});
      expect(fetch.mock.calls.map((c) => c[0])).toEqual([song.url, song.mirror]);
      expect(f.size).toBe(700);
    }
  });
  it('an MP3 a host calls text/html (Jamendo does) is still the song, as audio/mpeg', async () => {
    const fetch = vi.fn(async () => streamed([3000], { 'content-type': 'text/html' }, text('ID3')));
    vi.stubGlobal('fetch', fetch);
    const f = await downloadSong(song, () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(f.size).toBe(3000);
    expect(f.type).toBe('audio/mpeg');
  });
  it('takes the formats a song comes in, whatever the server calls them', async () => {
    const heads: Record<string, number[]> = {
      mp3: [0xff, 0xfb, 0x90, 0x64], ogg: text('OggS'), flac: text('fLaC'), wav: [...text('RIFF'), 0, 0, 0, 0, ...text('WAVE')],
      m4a: [0, 0, 0, 0x20, ...text('ftypM4A ')], webm: [0x1a, 0x45, 0xdf, 0xa3],
    };
    for (const [kind, head] of Object.entries(heads)) {
      const fetch = vi.fn(async () => streamed([100], { 'content-type': 'application/octet-stream' }, head));
      vi.stubGlobal('fetch', fetch);
      expect((await downloadSong(song, () => {})).size, kind).toBe(100);
      expect(fetch, kind).toHaveBeenCalledTimes(1);
    }
    // and nothing it doesn't know, whatever the type says
    vi.stubGlobal('fetch', vi.fn(async () => streamed([100], { 'content-type': 'audio/mpeg' }, [0, 0, 0, 0])));
    await expect(downloadSong(song, () => {})).rejects.toThrow(SongError);
  });
  it('an address that never answers, or goes quiet halfway, is given up after a while', async () => {
    for (const first of [never, async () => stuck(2000)]) {
      const fetch = vi.fn().mockImplementationOnce(first).mockImplementationOnce(async () => streamed([300], { 'content-type': 'audio/mpeg' }));
      vi.stubGlobal('fetch', fetch);
      const t0 = Date.now();
      const f = await downloadSong(song, () => {}, undefined, 60);
      expect(fetch.mock.calls.map((c) => c[0])).toEqual([song.url, song.mirror]);
      expect(f.size).toBe(300);
      expect(Date.now() - t0).toBeLessThan(1000);
    }
    // the quiet address was stopped (its request aborted), not left running
    let aborted = false;
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(async (_u: string, o: { signal: AbortSignal }) => { o.signal.addEventListener('abort', () => (aborted = true)); return never(); })
      .mockImplementationOnce(async () => streamed([300])));
    await downloadSong(song, () => {}, undefined, 60);
    expect(aborted).toBe(true);
  });
  it('a slow download that keeps coming is not given up', async () => {
    const slow = () => new Response(new ReadableStream({
      async start(c) { for (let i = 0; i < 5; i++) { const b = new Uint8Array(100); if (!i) b.set(ID3); c.enqueue(b); await new Promise((r) => setTimeout(r, 40)); } c.close(); },
    }), { headers: { 'content-type': 'audio/mpeg' } });
    const fetch = vi.fn(async () => slow());
    vi.stubGlobal('fetch', fetch);
    const f = await downloadSong(song, () => {}, undefined, 120);      // 200 ms in all, never 120 ms without a byte
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(f.size).toBe(500);
  });
  it('the credit and the file name', () => {
    expect(creditOf(song)).toBe('"Night Bus" by The Testers, CC BY');
    expect(fileNameOf({ title: 'A/B: "C"?', artist: 'D  E' }, 'x.wav')).toBe('D E - AB C.wav');
  });
});
