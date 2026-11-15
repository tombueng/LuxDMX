// The add-ons the app knows: our repository (public/addons/, next to the app), loaded when the
// effect library first opens and kept for the session (the service worker keeps the files for
// offline use).
import { loadRepo, sourceUrl } from './catalog';
export { sourceUrl };
import { readPackage, type EffectPackage } from './package';
import { ADDON_SOURCES, ADDONS_IMPORTED } from '../store/kept';

// packages someone imported from a file, kept in this browser (a few, a couple of MB at most)
function stored(): EffectPackage[] {
  return ADDONS_IMPORTED.get().flatMap((t) => { try { return [readPackage(JSON.stringify(t))]; } catch { return []; } });
}

export const DEFAULT_REPO = 'addons/';

// Someone else's repository, as it was loaded (or why it couldn't be).
export interface Source { url: string; name: string; state: 'loading' | 'ready' | 'failed'; packages: EffectPackage[]; problems: string[] }


class Addons {
  state = $state<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  packages = $state.raw<EffectPackage[]>([]);
  themes = $state.raw<{ id: string; name: string }[]>([]);
  problems = $state.raw<string[]>([]);
  imported = $state.raw<EffectPackage[]>(typeof localStorage !== 'undefined' ? stored() : []);
  // an imported package (the same id again replaces it); false when this browser can't keep it
  keep(p: EffectPackage): boolean {
    this.imported = [p, ...this.imported.filter((x) => x.id !== p.id)].slice(0, 30);
    return ADDONS_IMPORTED.set(this.imported);
  }
  forget(id: string) {
    this.imported = this.imported.filter((x) => x.id !== id);
    ADDONS_IMPORTED.set(this.imported);
  }
  async load() {
    if (this.state === 'loading' || this.state === 'ready') return;
    this.state = 'loading';
    try {
      const base = new URL(DEFAULT_REPO, typeof document !== 'undefined' ? document.baseURI : 'http://localhost/').href;
      const r = await loadRepo(base);
      this.packages = r.packages; this.themes = r.repo.themes; this.problems = r.problems;
      this.state = 'ready';
    } catch (e) {
      this.problems = [e instanceof Error ? e.message : String(e)];
      this.state = 'failed';
    }
  }
  byId(id: string) { return this.packages.find((p) => p.id === id); }

  // ---- other people's repositories (Settings: More sources), kept in this browser
  others = $state.raw<Source[]>([]);
  private started = false;
  private saved(): string[] {
    return ADDON_SOURCES.get().filter((x) => !!sourceUrl(x)).slice(0, 20);
  }
  private save() { ADDON_SOURCES.set(this.others.map((s) => s.url)); }
  private async fetchSource(url: string): Promise<Source> {
    try {
      const r = await loadRepo(url);
      return { url, name: r.repo.name, state: 'ready', packages: r.packages, problems: r.problems };
    } catch (e) { return { url, name: url, state: 'failed', packages: [], problems: [e instanceof Error ? e.message : String(e)] }; }
  }
  // the saved ones, once a session
  loadOthers() {
    if (this.started || typeof localStorage === 'undefined') return;
    this.started = true;
    const urls = this.saved();
    this.others = urls.map((url) => ({ url, name: url, state: 'loading', packages: [], problems: [] }));
    for (const url of urls) void this.fetchSource(url).then((s) => { this.others = this.others.map((x) => (x.url === url ? s : x)); });
  }
  // A new one: kept only once it loads. Says why when it doesn't.
  async addSource(text: string): Promise<{ ok: true; source: Source } | { ok: false; why: string }> {
    const url = sourceUrl(text);
    if (!url) return { ok: false, why: 'That isn\'t an address a source can have: https://… (or http://localhost for trying one out)' };
    if (new URL(DEFAULT_REPO, document.baseURI).href === url) return { ok: false, why: 'That\'s ours: it\'s always there' };
    if (this.others.some((s) => s.url === url)) return { ok: false, why: 'That one is already there' };
    const s = await this.fetchSource(url);
    if (s.state !== 'ready') return { ok: false, why: s.problems[0] ?? 'It couldn\'t be loaded' };
    this.others = [...this.others, s];
    this.save();
    return { ok: true, source: s };
  }
  removeSource(url: string) { this.others = this.others.filter((s) => s.url !== url); this.save(); }
  // every add-on the library can offer, by id (ours, imported, other sources)
  find(id: string) { return this.packages.find((p) => p.id === id) ?? this.imported.find((p) => p.id === id) ?? this.others.flatMap((s) => s.packages).find((p) => p.id === id); }
}
export const addons = new Addons();
