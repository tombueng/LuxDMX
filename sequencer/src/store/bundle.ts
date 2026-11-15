// A show with its songs in one file (.luxdmx.zip), for taking it to another computer: the show file as
// it always is, and every song this browser keeps for it (the one that's up and the set's others)
// and its own 3D venue, under the keys the show names them by. Opened elsewhere, they go into that
// browser's store under the same keys, and the show finds them as if they'd always been there. (A
// plain show file only names its songs: on another computer each one had to be found again.)
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { songsOf } from '../model/timeline';
import type { Show } from '../model/types';

export interface Stored { key: string; name: string }
export interface Unbundled { json: string; songs: { key: string; blob: Blob }[]; model?: { key: string; blob: Blob } }
interface Manifest { format: 'luxdmx-bundle'; version: 1; show: string; songs: { key: string; file: string }[]; model?: { key: string; file: string } }

const SHOW = 'show.luxdmx.json', MANIFEST = 'manifest.json';

// the files this browser keeps for the show: its songs (each once) and its venue model
export function storedOf(show: Show): { songs: Stored[]; model?: Stored } {
  const seen = new Set<string>(), songs: Stored[] = [];
  for (const tl of songsOf(show)) {
    const a = tl.audio;
    if (a?.store && !seen.has(a.store)) { seen.add(a.store); songs.push({ key: a.store, name: a.name }); }
  }
  const m = show.settings.stage3d?.model;
  return { songs, model: m?.store ? { key: m.store, name: m.name } : undefined };
}

// (a name a zip takes anywhere: no slashes, nothing odd)
const safe = (n: string) => n.replace(/[^\w.\- ()]+/g, '_').slice(-120) || 'file';

// The bundle; `missing`: what the show names but this browser hasn't got (left out, said)
export async function bundle(json: string, show: Show, get: { song: (key: string) => Promise<Blob | undefined>; model: (key: string) => Promise<Blob | undefined> }) {
  const { songs, model } = storedOf(show);
  const files: Zippable = { [SHOW]: strToU8(json) };
  const man: Manifest = { format: 'luxdmx-bundle', version: 1, show: SHOW, songs: [] };
  const missing: string[] = [];
  let bytes = 0;
  for (const [i, s] of songs.entries()) {
    const b = await get.song(s.key).catch(() => undefined);
    if (!b) { missing.push(s.name); continue; }
    const file = `songs/${i + 1} ${safe(s.name)}`;
    // (songs are compressed already: stored as they are, no time spent squeezing them)
    files[file] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }];
    man.songs.push({ key: s.key, file }); bytes += b.size;
  }
  if (model) {
    const b = await get.model(model.key).catch(() => undefined);
    if (b) { const file = `venue/${safe(model.name)}`; files[file] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }]; man.model = { key: model.key, file }; bytes += b.size; }
    else missing.push(model.name);
  }
  files[MANIFEST] = strToU8(JSON.stringify(man, null, 1));
  return { blob: new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), songs: man.songs.length, bytes, missing };
}

export const isZip = (head: Uint8Array) => head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4;

// what's in a bundle (a zip that isn't one: an error that says so)
export function unbundle(bytes: Uint8Array): Unbundled {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error('could not read the file (a damaged .zip?)'); }
  const raw = files[MANIFEST];
  let man: Manifest | undefined;
  try { man = raw ? (JSON.parse(strFromU8(raw)) as Manifest) : undefined; } catch { man = undefined; }
  // (a zip without our manifest: a show file inside it is still opened, on its own)
  const showName = man?.show && files[man.show] ? man.show : Object.keys(files).find((n) => /\.json$/i.test(n) && n !== MANIFEST);
  if (!showName) throw new Error('there is no show in this .zip');
  const blob = (f: string) => new Blob([files[f] as Uint8Array<ArrayBuffer>]);
  return {
    json: strFromU8(files[showName]),
    songs: (man?.songs ?? []).filter((s) => typeof s.key === 'string' && files[s.file]).map((s) => ({ key: s.key, blob: blob(s.file) })),
    model: man?.model && files[man.model.file] ? { key: man.model.key, blob: blob(man.model.file) } : undefined,
  };
}
