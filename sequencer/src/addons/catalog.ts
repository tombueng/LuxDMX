// A repository of add-ons (ADDONS.md): an index.json and the packages next to it, plain files on
// any web server. Ours is in public/addons/ (made from themes.ts by addons.test.ts) and is the
// default. Read strictly, like a package: what isn't right is left out and said.
import { PACKAGE_FORMAT, PACKAGE_VERSION, readPackage, type EffectPackage, type Fit, type Standard } from './package';
import type { Source, Theme } from './themes';

export const REPO_FORMAT = 'luxdmx-addons';
export interface RepoEntry {
  id: string; kind: 'effect'; version: string; name: string; author: string; license: string;
  description: string; tags: string[]; fits: Fit[]; file: string; size: number; sha256: string;
}
export interface Repo { format: typeof REPO_FORMAT; formatVersion: number; name: string; maintainer: string; themes: { id: string; name: string }[]; addons: RepoEntry[] }

// One of our theme effects as a package (`uses`: the standard knobs that change it, measured).
export function themePackage(theme: Theme, s: Source, uses: Standard[]): EffectPackage {
  return {
    format: PACKAGE_FORMAT, formatVersion: PACKAGE_VERSION, id: `luxdmx.${s.id}`, version: '1.0.0', name: s.name,
    author: { name: 'LuxDMX', url: 'https://github.com/tombueng/LuxDMX' }, license: 'MIT', description: s.description,
    tags: [theme.id, ...(s.tags ?? [])], category: 'pixel', fits: ['ring', 'disc', 'matrix'], uses, params: s.params ?? [],
    defaults: { speed: 8, tempo: false, spread: 0, ...s.defaults }, code: { lang: 'luxfx-1', ...(s.frame ? { frame: s.frame } : {}), pixel: s.pixel },
  };
}

// ---------------------------------------------------------------- reading one
export class RepoError extends Error {}
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : '');
// a file in the repository: a plain path below it, nothing that climbs out or goes elsewhere
const FILE = /^(?!.*\.\.)[a-z0-9][a-z0-9/_.-]{0,120}\.luxfx$/;

export function readRepo(text: string): { repo: Repo; problems: string[] } {
  if (text.length > 1_000_000) throw new RepoError('Its index is too big');
  let v: unknown;
  try { v = JSON.parse(text); } catch { throw new RepoError('Its index isn\'t readable (not JSON)'); }
  if (!isObj(v) || v.format !== REPO_FORMAT) throw new RepoError('That isn\'t a LuxDMX add-on repository');
  if (typeof v.formatVersion !== 'number' || v.formatVersion > 1) throw new RepoError('It was made for a newer LuxDMX Sequencer');
  const problems: string[] = [], addons: RepoEntry[] = [];
  for (const [i, a] of (Array.isArray(v.addons) ? v.addons : []).slice(0, 500).entries()) {
    if (!isObj(a) || a.kind !== 'effect' || !s(a.id, 81) || !s(a.name, 60) || !FILE.test(s(a.file, 128)) || !/^[0-9a-f]{64}$/.test(s(a.sha256, 64))) { problems.push(`Entry ${i + 1} isn't readable, left out`); continue; }
    addons.push({ id: a.id as string, kind: 'effect', version: s(a.version, 20) || '1.0.0', name: a.name as string, author: s(a.author, 60), license: s(a.license, 40),
      description: s(a.description, 1000), tags: Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === 'string' && t.length <= 24).slice(0, 12) : [],
      fits: Array.isArray(a.fits) ? (a.fits as Fit[]).filter((f) => typeof f === 'string') : [], file: a.file as string, size: typeof a.size === 'number' ? a.size : 0, sha256: a.sha256 as string });
  }
  const themes = (Array.isArray(v.themes) ? v.themes : []).filter((t): t is { id: string; name: string } => isObj(t) && !!s(t.id, 24) && !!s(t.name, 40)).map((t) => ({ id: t.id, name: t.name })).slice(0, 50);
  return { repo: { format: REPO_FORMAT, formatVersion: 1, name: s(v.name, 60) || 'Add-ons', maintainer: s(v.maintainer, 200), themes, addons }, problems };
}

async function sha256(bytes: Uint8Array): Promise<string | null> {
  const c = globalThis.crypto?.subtle;
  if (!c) return null;     // (a page that isn't https or localhost has no subtle crypto: the size still counts)
  const h = await c.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A repository at `base` (ending in /): its index and every package in it, each checked against
// what the index says (size in bytes, sha256 of the file as it is) and read strictly. No
// credentials go with the requests.
export async function loadRepo(base: string, fetcher: typeof fetch = fetch): Promise<{ repo: Repo; packages: EffectPackage[]; problems: string[] }> {
  const get = async (path: string) => new Uint8Array(await (await reach(path)).arrayBuffer());
  const reach = async (path: string) => {
    let r: Response;
    try { r = await fetcher(new URL(path, new URL(base, globalThis.location?.href ?? 'http://x/')).href, { credentials: 'omit', cache: 'no-cache' }); }
    catch { throw new RepoError(`${path} can't be reached: the address is wrong, it's offline, or it doesn't let other sites read it`); }
    if (!r.ok) throw new RepoError(`${path}: the server says ${r.status}${r.status === 404 ? ' (not there)' : ''}`);
    return r;
  };
  const text = (b: Uint8Array) => new TextDecoder().decode(b);   // (UTF-8, a byte order mark dropped)
  const { repo, problems } = readRepo(text(await get('index.json')));
  const packages: EffectPackage[] = [];
  await Promise.all(repo.addons.map(async (a) => {
    try {
      const bytes = await get(a.file);
      if (a.size && bytes.length !== a.size) throw new RepoError(`its size (${bytes.length} bytes) isn't what the index says (${a.size})`);
      const h = await sha256(bytes);
      if (h && h !== a.sha256) throw new RepoError('it isn\'t the file the index names (sha256)');
      const p = readPackage(text(bytes));
      if (p.id !== a.id) throw new RepoError(`it says it's ${p.id}`);
      packages.push(p);
    } catch (e) { problems.push(`${a.name}: ${e instanceof Error ? e.message : String(e)}`); }
  }));
  // in the index's order
  const at = new Map(repo.addons.map((a, i) => [a.id, i]));
  packages.sort((x, y) => (at.get(x.id) ?? 0) - (at.get(y.id) ?? 0));
  return { repo, packages, problems };
}

// An address that can be a source: https (or this computer, for trying one out), ending in /.
export function sourceUrl(text: string): string | null {
  let u: URL;
  try { u = new URL(text.trim()); } catch { return null; }
  const local = u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) return null;
  if (u.username || u.password) return null;
  u.hash = ''; u.search = '';
  if (!u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/index\.json$/, '/').replace(/([^/])$/, '$1/');
  return u.href;
}
