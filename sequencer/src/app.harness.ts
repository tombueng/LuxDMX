// For app-level unit tests (happy-dom): a fresh `app` (the singleton in app.svelte.ts) with its
// 40 Hz clock switched off, so the test drives tick() itself, and a fake box that records what
// would go out. Tests: `// @vitest-environment happy-dom`, then `const { app, sent, tick } = await freshApp()`.
import { vi } from 'vitest';
import type { Show } from './model/types';

export interface Sent { uni: number; data: number[] }

// `output`: whether this browser sends to the stage ('live', as most tests need) or is blind
export async function freshApp(opts: { keepStorage?: boolean; output?: 'live' | 'blind' } = {}) {
  // no Worker: the app falls back to setInterval; stub both so nothing ticks on its own
  (globalThis as any).Worker = class { onmessage: unknown; onerror: unknown; terminate() {} postMessage() {} };
  vi.resetModules();
  if (!opts.keepStorage) { localStorage.clear(); sessionStorage.clear(); }
  if (!opts.keepStorage || opts.output) sessionStorage.setItem('luxdmx.seq.output', opts.output ?? 'live');   // (this tab's; see app.output)
  const realSetInterval = globalThis.setInterval;
  (globalThis as any).setInterval = (fn: () => void, ms: number) => (ms === 25 ? 0 : realSetInterval(fn, ms));
  const mod = await import('./app.svelte');
  (globalThis as any).setInterval = realSetInterval;
  const app = mod.app as any;
  await app.init();
  const sent: Sent[] = [];
  const box = { state: 'ready', host: 'box', send: (uni: number, data: Uint8Array) => sent.push({ uni, data: [...data.slice(0, 16)] }), relay() {}, close() {}, open() {}, lostAt: 0, outputs: [] };
  app.bridges = [box];
  const tick = (n = 1) => { for (let i = 0; i < n; i++) app.tick(); };
  return { app, sent, tick, mod };
}

// Two dimmers at 1 and 2, a fog machine at 3 (universe 0); a list of two moods.
export function smallShow(app: any) {
  const s: Show = app.show;
  s.fixtures.push(
    { id: 'p1', name: 'P1', typeId: 'gen-dimmer', mode: '', universe: 0, address: 1, x: 0.2, y: 0.2 } as any,
    { id: 'p2', name: 'P2', typeId: 'gen-dimmer', mode: '', universe: 0, address: 2, x: 0.4, y: 0.2 } as any,
    { id: 'fg', name: 'Fog', typeId: 'gen-fog', mode: '', universe: 0, address: 3, x: 0.6, y: 0.2 } as any,
  );
  s.cueLists.push({ id: 'L', name: 'Moods', end: 'stop', cues: [
    { id: 'c1', name: 'Warm', values: { p1: { intensity: 1 }, p2: { intensity: 1 } }, fade: 0, advance: { mode: 'manual' } },
    { id: 'c2', name: 'Late', values: { p1: { intensity: 0.5 }, p2: { intensity: 0.2 } }, fade: 0, advance: { mode: 'manual' } },
  ] } as any);
  app.checkpoint();
}

// Web Locks for two "tabs" in one test (happy-dom has none): one lock manager, exclusive locks,
// ifAvailable, granted a moment later like the real one. `as(tab)` says who asks next;
// `releaseAll(tab)` is that tab being closed.
export function installLocks() {
  const held = new Map<string, { owner: string; release: () => void }>();
  let owner = 'tab-1';
  const locks = {
    request(name: string, opts: { ifAvailable?: boolean } | ((l: unknown) => unknown), cb?: (l: { name: string } | null) => unknown) {
      const fn = (typeof opts === 'function' ? opts : cb)!, o = typeof opts === 'function' ? {} : opts, me = owner;
      return Promise.resolve().then(async () => {
        if (held.has(name)) { if (o.ifAvailable) return fn(null); throw new Error('queued requests: not in this stand-in'); }
        let release!: () => void;
        const gone = new Promise<void>((r) => (release = r));
        held.set(name, { owner: me, release });
        try { await Promise.race([Promise.resolve(fn({ name })), gone]); } finally { if (held.get(name)?.owner === me) held.delete(name); }
      });
    },
    query: async () => ({ held: [...held.keys()].map((name) => ({ name })) }),
  };
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  return {
    held,
    as(o: string) { owner = o; },
    releaseAll(o: string) { for (const [k, h] of [...held]) if (h.owner === o) { held.delete(k); h.release(); } },
    uninstall() { delete (navigator as any).locks; },
  };
}
export const settle = async (n = 10) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
