import type { FixtureType } from '../model/types';

// Shows saved in this browser (IndexedDB). Each record keeps the show file as text plus what the
// show manager lists: name, last change, how many fixtures and cues, a little picture of the stage.
export interface ShowMeta {
  id: string;
  name: string;
  modified: string;      // ISO time
  fixtures: number;
  cues: number;
  thumb: string;         // SVG markup of the stage
}
interface Rec extends ShowMeta { json: string }

const DB = 'luxdmx-sequencer', STORE = 'shows', TYPES = 'types', META = 'meta';
let dbp: Promise<IDBDatabase> | null = null;
// Called when another tab (an older version of the app) keeps the database from upgrading.
export let onBlocked: () => void = () => {};
export const setOnBlocked = (f: () => void) => { onBlocked = f; };

// Version 1: shows. 2: my fixtures. 3: a small record per show for the list (so listing the shows
// doesn't read every show in full).
function db(): Promise<IDBDatabase> {
  if (!dbp) dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 3);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(TYPES)) d.createObjectStore(TYPES, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(META)) {
        const meta = d.createObjectStore(META, { keyPath: 'id' });
        const cur = req.transaction!.objectStore(STORE).openCursor();
        cur.onsuccess = () => { const c = cur.result; if (!c) return; const { json: _j, ...m } = c.value as Rec; meta.put(m); c.continue(); };
      }
    };
    req.onblocked = () => onBlocked();
    req.onsuccess = () => {
      const d = req.result;
      // A newer tab wants to upgrade: let it (this tab reopens on its next save).
      d.onversionchange = () => { d.close(); dbp = null; };
      resolve(d);
    };
    req.onerror = () => { dbp = null; reject(req.error); };
  });
  return dbp;
}
function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>, store = STORE): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const r = run(d.transaction(store, mode).objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

export async function listShows(): Promise<ShowMeta[]> {
  const all = await tx<ShowMeta[]>('readonly', (s) => s.getAll() as IDBRequest<ShowMeta[]>, META);
  return all.sort((a, b) => b.modified.localeCompare(a.modified));
}
export async function showModified(id: string): Promise<string | undefined> {
  return (await tx<ShowMeta | undefined>('readonly', (s) => s.get(id) as IDBRequest<ShowMeta | undefined>, META))?.modified;
}
export async function readShow(id: string): Promise<string | undefined> {
  return (await tx<Rec | undefined>('readonly', (s) => s.get(id) as IDBRequest<Rec | undefined>))?.json;
}
export async function writeShow(meta: ShowMeta, json: string): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction([STORE, META], 'readwrite');
    t.objectStore(STORE).put({ ...meta, json });
    t.objectStore(META).put(meta);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
export async function deleteShow(id: string): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction([STORE, META], 'readwrite');
    t.objectStore(STORE).delete(id);
    t.objectStore(META).delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// "My fixtures": every fixture type you made or imported, kept in the browser so the next show can
// use it too (the show keeps its own copy as well, so files stay self-contained).
export async function listMyTypes(): Promise<FixtureType[]> {
  return (await tx<FixtureType[]>('readonly', (s) => s.getAll() as IDBRequest<FixtureType[]>, TYPES)).sort((a, b) => `${a.manufacturer} ${a.model}`.localeCompare(`${b.manufacturer} ${b.model}`));
}
export async function saveMyType(t: FixtureType): Promise<void> { await tx('readwrite', (s) => s.put(JSON.parse(JSON.stringify(t))), TYPES); }
export async function deleteMyType(id: string): Promise<void> { await tx('readwrite', (s) => s.delete(id), TYPES); }
