// Big files kept in this browser (IndexedDB): songs for the timeline, 3D models for the stage. They
// are megabytes; the show file only names them. A show opened on another computer asks again.
const DB = 'luxdmx-audio', STORE = 'songs', MODELS = 'models';

function open(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => { for (const s of [STORE, MODELS]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
    r.onblocked = () => fail(new Error('another tab holds an older version of the song store'));
  });
}
async function put(store: string, key: string, blob: Blob) {
  const db = await open();
  await new Promise<void>((ok, fail) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(blob, key); tx.oncomplete = () => ok(); tx.onerror = () => fail(tx.error); });
  db.close();
}
async function get(store: string, key: string): Promise<Blob | undefined> {
  const db = await open();
  const b = await new Promise<Blob | undefined>((ok, fail) => { const r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => ok(r.result as Blob | undefined); r.onerror = () => fail(r.error); });
  db.close();
  return b;
}
export const putSong = (key: string, blob: Blob) => put(STORE, key, blob);
export const getSong = (key: string) => get(STORE, key);
export const putModel = (key: string, blob: Blob) => put(MODELS, key, blob);
export const getModel = (key: string) => get(MODELS, key);
