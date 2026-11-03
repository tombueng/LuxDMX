// The fixture library: the Open Fixture Library (652 fixtures, MIT) and QLC+'s library (1781,
// Apache-2.0), searched together from two small indexes shipped with the app (public/ofl,
// public/qlc, built by scripts/). Picking one fetches that single fixture at the pinned commit and
// converts it; the show then keeps its own copy, so nothing depends on the network afterwards.
import type { FixtureType } from '../model/types';
import { fromOfl, oflUrl } from '../import/ofl';
import { fromQxf, qlcUrl } from '../import/qxf';

export interface Entry {
  source: 'ofl' | 'qlc';
  key: string;
  name: string;
  manufacturer: string;
  categories?: string[];
  modes?: [string, number, number?][];     // name, channels, its RDM personality (when known)
  rdm?: [number, number];                  // its RDM maker (ESTA) and model ids (when known)
  alt?: Entry;            // the same fixture in the other library (search results only)
}

let entries: Entry[] | null = null;
let commits = { ofl: '', qlc: '' };

export async function loadCatalog(base = import.meta.env.BASE_URL): Promise<Entry[]> {
  if (entries) return entries;
  const [ofl, qlc] = await Promise.all([
    fetch(`${base}ofl/index.json`).then((r) => r.json()),
    fetch(`${base}qlc/index.json`).then((r) => r.json()),
  ]);
  commits = { ofl: ofl.commit, qlc: qlc.commit };
  entries = [
    ...ofl.fixtures.map((f: { k: string; n: string; m: string; c: string[]; modes: [string, number, number?][]; r?: [number, number] }) =>
      ({ source: 'ofl', key: f.k, name: f.n, manufacturer: f.m, categories: f.c, modes: f.modes, ...(f.r ? { rdm: f.r } : {}) })),
    ...qlc.fixtures.map((f: { k: string; n: string; m: string }) => ({ source: 'qlc', key: f.k, name: f.n, manufacturer: f.m })),
  ];
  return entries;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

// Every word has to match somewhere in "manufacturer model"; exact model hits come first.
export function search(all: Entry[], query: string, limit = 60): Entry[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const scored: [number, Entry][] = [];
  for (const e of all) {
    const hay = norm(`${e.manufacturer} ${e.name}`);
    if (!words.every((w) => hay.includes(w))) continue;
    const name = norm(e.name);
    let score = 0;
    if (name === words.join(' ')) score -= 100;
    if (name.startsWith(words[words.length - 1])) score -= 10;
    if (e.source === 'ofl') score -= 1;            // richer descriptions: show them first on a tie
    scored.push([score + hay.length / 100, e]);
  }
  // A fixture in both libraries shows once: the Open Fixture Library one (it says more per mode),
  // with the other one at hand as `alt`.
  const seen = new Map<string, Entry>(), out: Entry[] = [];
  for (const [, e] of scored.sort((a, b) => a[0] - b[0])) {
    const k = `${norm(e.manufacturer).replace(/ /g, '')}|${norm(e.name).replace(/ /g, '')}`;
    const first = seen.get(k);
    if (first) { first.alt ??= e; continue; }
    if (out.length >= limit) continue;
    const copy = { ...e };
    seen.set(k, copy);
    out.push(copy);
  }
  return out;
}

// What people search for most, for an empty search box.
export const POPULAR_MAKERS = ['Cameo', 'Eurolite', 'Stairville', 'American DJ', 'Chauvet', 'Showtec', 'Varytec', 'beamZ', 'Martin', 'Robe', 'Clay Paky', 'Elation'];

// A QLC+ library fixture by manufacturer and model, as a QLC+ workspace names it.
export async function findQlc(manufacturer: string, model: string): Promise<FixtureType | undefined> {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const e = (await loadCatalog()).find((x) => x.source === 'qlc' && n(x.manufacturer) === n(manufacturer) && n(x.name) === n(model));
  return e ? fetchType(e) : undefined;
}

export async function fetchType(e: Entry): Promise<FixtureType> {
  if (e.source === 'ofl') {
    const r = await fetch(oflUrl(e.key, commits.ofl || undefined));
    if (!r.ok) throw new Error(`couldn't load ${e.manufacturer} ${e.name} (${r.status})`);
    return fromOfl(e.key, await r.json(), e.manufacturer);
  }
  const r = await fetch(qlcUrl(e.key, commits.qlc || undefined));
  if (!r.ok) throw new Error(`couldn't load ${e.manufacturer} ${e.name} (${r.status})`);
  const t = fromQxf(await r.text(), e.key);
  return { ...t, id: `qlc:${e.key}` };
}
