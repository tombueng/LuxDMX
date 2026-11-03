// Fetching a song of the catalog when someone picks it: from the artist's own file first, then
// from our copy, with progress as it comes in. What goes wrong is said in plain words.
import type { CatalogSong } from './catalog';

export class SongError extends Error {}

// "Title" by Artist, CC BY: the credit the licence asks for (kept with the show)
export const creditOf = (s: Pick<CatalogSong, 'title' | 'artist' | 'license'>) => `"${s.title}" by ${s.artist}, ${s.license}`;

const extOf = (url: string, type: string) => /ogg/.test(type) || /\.ogg(\?|$)/i.test(url) ? 'ogg' : /wav/.test(type) || /\.wav(\?|$)/i.test(url) ? 'wav' : 'mp3';
// "Artist - Title.mp3", nothing a file system minds
export const fileNameOf = (s: Pick<CatalogSong, 'title' | 'artist'>, url: string, type = '') =>
  `${s.artist} - ${s.title}`.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) + `.${extOf(url, type)}`;

// Whether a file starts the way a song does: MP3 (an ID3 tag, or the sync bits of its first frame;
// AAC too), Ogg, FLAC, WAV, MP4/M4A, WebM. A host answers a moved or missing file with a page of
// its own and status 200 often enough: that page is never taken for the song.
export function isAudio(b: Uint8Array): boolean {
  const at = (i: number, s: string) => [...s].every((ch, k) => b[i + k] === ch.charCodeAt(0));
  return at(0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) || at(0, 'OggS') || at(0, 'fLaC')
    || (at(0, 'RIFF') && at(8, 'WAVE')) || at(4, 'ftyp') || (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3);
}
// what a page or an error says it is, before its bytes come in
const notAudio = (type: string) => /^(text\/|application\/(json|xml|xhtml|javascript))/i.test(type);

// No answer, or no new bytes, for this long: that address is given up and the next one tried.
export const STALL_MS = 20_000;
// (it fails first, then lets go: a read that ends because it was let go mustn't count as the end)
function within<T>(p: Promise<T>, ms: number, giveUp: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, no) => { timer = setTimeout(() => { no(new Error('no answer')); giveUp(); }, ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

// The song as a file, as if it had been loaded from the disk. progress(got, total): bytes so far
// and the size (0 when the server doesn't say). `stallMs`: how long an address may stay silent.
export async function downloadSong(s: CatalogSong, progress: (got: number, total: number) => void, signal?: AbortSignal, stallMs = STALL_MS): Promise<File> {
  for (const url of [s.url, s.mirror].filter((u): u is string => !!u)) {
    signal?.throwIfAborted();
    // this address's own stop: the person's Cancel, or this address going silent
    const ctl = new AbortController(), stop = () => ctl.abort();
    signal?.addEventListener('abort', stop);
    try {
      const r = await within(fetch(url, { signal: ctl.signal }), stallMs, stop);
      if (!r.ok) { r.body?.cancel().catch(() => {}); continue; }
      // (what the server calls it doesn't decide: Jamendo sends its MP3s as text/html; the first
      // bytes do, below. It only names the file's type when it's a plausible one)
      const said = r.headers.get('content-type')?.split(';')[0].trim() || '', type = !said || notAudio(said) ? 'audio/mpeg' : said;
      const total = Number(r.headers.get('content-length')) || 0, parts: Uint8Array<ArrayBuffer>[] = [];
      let got = 0, head: Uint8Array | undefined;
      progress(0, total);
      if (r.body) {
        const rd = r.body.getReader();
        const drop = () => { stop(); rd.cancel().catch(() => {}); };
        for (;;) {
          const { done, value } = await within(rd.read(), stallMs, drop);
          if (done) break;
          parts.push(value as Uint8Array<ArrayBuffer>); got += value.length;
          // the first bytes say whether it's a song at all (an error page stops here, not at its end)
          if (!head && got >= 12) { head = first(parts, 12); if (!isAudio(head)) { drop(); break; } }
          progress(got, total);
        }
      } else { const b = new Uint8Array(await within(r.arrayBuffer(), stallMs, stop)); parts.push(b); got = b.length; progress(got, total); }
      if (!got || !isAudio(head ?? first(parts, 12))) continue;
      return new File(parts, fileNameOf(s, url, type), { type: type.startsWith('audio/') ? type : `audio/${extOf(url, type)}` });
    } catch (e) {
      if (signal?.aborted) throw e;
      // (blocked, silent too long, or the network dropped: the next address, if there is one)
    } finally {
      signal?.removeEventListener('abort', stop);
    }
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  throw new SongError(offline
    ? `"${s.title}" can't be downloaded: this computer is offline. Once it's online again, it can.`
    : `"${s.title}" can't be downloaded right now (its site may be down, or blocked on this network). Try again later, or load a song of your own.`);
}
// the first n bytes of what came in so far
function first(parts: Uint8Array[], n: number): Uint8Array {
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { if (o >= n) break; const k = Math.min(n - o, p.length); out.set(p.subarray(0, k), o); o += k; }
  return out.subarray(0, o);
}
