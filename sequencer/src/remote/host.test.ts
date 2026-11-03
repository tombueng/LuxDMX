// @vitest-environment happy-dom
// The laptop's side of the phone remote, without a browser: the code, held buttons and their
// safety timeout, and every message small enough for the box.
import { describe, expect, it } from 'vitest';
import { BUDGET, HOLD_MS, RemoteHost } from './host.svelte';
import type { Bridge } from '../output/bridge';
import type { Widget } from '../model/types';

function rig(widgets: Widget[]) {
  const fired: string[] = [];
  const sent: Record<string, any>[] = [];
  const app = {
    pages: [{ id: 'p', name: 'Live', widgets }],
    show: { meta: { name: 'Gig' }, cueLists: [], groups: [{ id: 'g', name: 'PARs', fixtures: ['a'] }], effects: [], settings: { bpm: 120 } },
    status: {}, fx: {}, fogUntil: {}, blackout: false, grandMaster: 1, bpm: 120, liveList: undefined, cueLooksOf: new Map(),
    engine: { status: () => ({ master: 1 }) }, effectParams: () => ({ level: 1 }),
    lockedOut: () => false,
    fireWidget: (w: Widget, down: boolean) => fired.push(`${w.id}:${down ? 'down' : 'up'}`),
    setFader: (w: Widget, v: number) => fired.push(`${w.id}=${v}`),
    fogBurst: (w: Widget) => fired.push(`${w.id}:burst`),
    go: () => fired.push('go'), back: () => fired.push('back'),
  };
  const bridge = { relay: (m: Record<string, any>) => sent.push(m) } as unknown as Bridge;
  sessionStorage.clear();
  const host = new RemoteHost(app as never);
  host.start();
  // the host sends a message per clock tick: run the clock for a while
  const drain = (from: number, ms = 3000) => { for (let t = from; t < from + ms; t += 25) host.tick(t); };
  const from = (m: Record<string, unknown>) => host.handle(bridge, { code: host.code, rid: 'ph', ...m });
  return { host, app, fired, sent, from, drain };
}
const flash: Widget = { id: 'fl', type: 'group', group: 'g', level: 1 };
const scene: Widget = { id: 'sc', type: 'special', do: 'tap', label: 'Tap' };

describe('phone remote, the laptop side', () => {
  it('a wrong code gets nothing, not even an answer', () => {
    const { host, fired, sent } = rig([scene]);
    host.handle({ relay: () => sent.push({}) } as unknown as Bridge, { k: 'tap', code: '0000', rid: 'x', w: 'sc' });
    host.tick(1000);
    expect(fired).toEqual([]);
    expect(sent).toEqual([]);
    expect(host.phones).toBe(0);
  });

  it('a press on a plain button is a tap; a held one stays down until up', () => {
    const { from, fired } = rig([scene, flash]);
    from({ k: 'hello' });
    from({ k: 'down', w: 'sc' });
    expect(fired).toEqual(['sc:down', 'sc:up']);
    from({ k: 'down', w: 'fl' });
    from({ k: 'down', w: 'fl' });                     // said twice: still one press
    expect(fired.slice(2)).toEqual(['fl:down']);
    from({ k: 'up', w: 'fl' });
    expect(fired.slice(2)).toEqual(['fl:down', 'fl:up']);
  });

  it('a held button the phone stops talking about lets go after the safety time', () => {
    const { host, from, fired } = rig([flash]);
    const t0 = performance.now();
    from({ k: 'hello' });
    from({ k: 'down', w: 'fl' });
    host.tick(t0 + HOLD_MS - 100);
    expect(fired).toEqual(['fl:down']);
    host.tick(t0 + HOLD_MS + 50);
    expect(fired).toEqual(['fl:down', 'fl:up']);
  });

  it('"still holding" keeps it; a lost "up" is caught by the next "alive"', () => {
    const { host, from, fired } = rig([flash]);
    from({ k: 'hello' });
    from({ k: 'down', w: 'fl' });
    from({ k: 'alive', held: ['fl'] });
    host.tick(performance.now() + HOLD_MS - 50);
    expect(fired).toEqual(['fl:down']);
    from({ k: 'alive', held: [] });                   // the finger is off, the "up" never came
    expect(fired).toEqual(['fl:down', 'fl:up']);
  });

  it('switching it off or a new code lets go of everything and tells the phones', () => {
    const { host, from, fired, sent } = rig([flash]);
    from({ k: 'hello' });
    from({ k: 'down', w: 'fl' });
    const old = host.code;
    host.newCode();
    expect(fired).toEqual(['fl:down', 'fl:up']);
    expect(sent.at(-1)).toMatchObject({ k: 'bye', code: old, host: 1 });
    expect(host.code).not.toBe(old);
    from({ k: 'down', w: 'fl', code: old });          // new code: the old phone's press does nothing
    expect(fired).toEqual(['fl:down', 'fl:up']);
  });

  it('a big page goes out in parts, each small enough for the box', () => {
    const many: Widget[] = Array.from({ length: 120 }, (_, i) => ({ id: `w${i}`, type: 'special', do: 'tap', label: `A long button name number ${i} ✨` }));
    const { from, sent, drain } = rig(many);
    from({ k: 'hello' });
    drain(performance.now() + 1000);
    const tiles = sent.filter((m) => m.k === 'tiles');
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.flatMap((m) => m.tiles).map((t: { id: string }) => t.id)).toEqual(many.map((w) => w.id));
    // every message fits one TCP segment on the box (~1.4 KB), multi-byte labels counted in bytes
    for (const m of sent) expect(new TextEncoder().encode(JSON.stringify({ relay: m })).length).toBeLessThanOrEqual(BUDGET);
    expect(sent.every((m) => m.host === 1)).toBe(true);
    const states = sent.filter((m) => m.k === 'state');
    expect(new Set(states.flatMap((m) => Object.keys(m.d))).size).toBe(120);
  });

  it('a second phone joining gets the layout again, under the same version (no redraw elsewhere)', () => {
    const { from, sent, drain } = rig([scene, flash]);
    from({ k: 'hello' });
    const t0 = performance.now() + 1000;
    drain(t0, 1000);
    const v = sent.find((m) => m.k === 'layout')!.v;
    sent.length = 0;
    from({ k: 'hello', rid: 'second' });
    drain(t0 + 1000, 1000);
    expect(sent.filter((m) => m.k === 'layout').map((m) => m.v)).toEqual([v]);
    expect(sent.some((m) => m.k === 'tiles')).toBe(true);
  });

  it('one box added twice: every message comes twice, and counts once', () => {
    const { from, fired } = rig([scene]);
    from({ k: 'hello', n: 1 });
    from({ k: 'tap', w: 'sc', n: 2 });
    from({ k: 'tap', w: 'sc', n: 2 });
    expect(fired).toEqual(['sc:down', 'sc:up']);
  });

  it('a guest removed lets go of what it held, gets a bye of its own, and is ignored after', () => {
    const { host, from, fired, sent } = rig([flash, scene]);
    from({ k: 'hello', rid: 'guest' });
    from({ k: 'down', w: 'fl', rid: 'guest' });
    host.remove('guest');
    expect(fired).toEqual(['fl:down', 'fl:up']);
    expect(sent.at(-1)).toMatchObject({ k: 'bye', to: 'guest', host: 1 });
    from({ k: 'tap', w: 'sc', rid: 'guest' });
    expect(fired).toEqual(['fl:down', 'fl:up']);
    expect(host.phones).toBe(0);
  });

  it('blackout from a phone is the state it asks for, so a repeat cannot undo it', () => {
    const { app, from } = rig([scene]);
    from({ k: 'hello' });
    from({ k: 'bo', on: true }); from({ k: 'bo', on: true });
    expect(app.blackout).toBe(true);
  });

  it('a message marked as the laptop\'s own is never taken from a phone', () => {
    const { fired, from } = rig([scene]);
    from({ k: 'tap', w: 'sc', host: 1 });
    expect(fired).toEqual([]);
  });

  it('nothing is sent while no phone is there', () => {
    const { host, sent } = rig([scene]);
    host.tick(performance.now() + 1000);
    expect(sent).toEqual([]);
  });
});

describe('phone remote, locked for the service', () => {
  it('phones get the locked page only, and a press for a button on another page does nothing', () => {
    const { app, from, fired } = rig([scene]);
    const other: Widget = { id: 'bl', type: 'special', do: 'blinder', label: 'Blinder' };
    (app as any).pages = [{ id: 'p', name: 'Looks', widgets: [scene] }, { id: 'm', name: 'Main', widgets: [other] }];
    (app as any).locked = true; (app.show.settings as any).lockPage = 'p';
    from({ k: 'hello' });
    from({ k: 'down', w: 'bl' });
    expect(fired).toEqual([]);
    from({ k: 'down', w: 'sc' });
    expect(fired).toEqual(['sc:down', 'sc:up']);
  });
});

describe('phone remote, kept on', () => {
  it('kept on: on again with the same code after a restart', async () => {
    const { host } = rig([scene]);
    host.newCode();                                       // (the other tests' remotes are still on with theirs)
    host.setKeep(true);
    const code = host.code;
    (host as any).others?.close();                        // that tab is gone (closed, the tablet off)
    sessionStorage.clear();                               // a cold start: nothing in the tab
    const again = new RemoteHost({ ...(host as any).app } as never);
    expect(again.code).toBe(code);
    await new Promise((ok) => setTimeout(ok, 350));
    expect(again.on).toBe(true);
    again.stop();
    localStorage.clear();
  });
  it('not twice: a second tab while the first has it on stays off', async () => {
    const { host } = rig([scene]);
    host.setKeep(true);
    sessionStorage.clear();
    const second = new RemoteHost({ ...(host as any).app } as never);
    await new Promise((ok) => setTimeout(ok, 350));
    expect(second.on).toBe(false);
    host.stop();
    localStorage.clear();
  });
});

describe('a reload with a second tab that has its own remote on', () => {
  const SESSION_KEY = 'luxdmx.seq.remote', KEEP_KEY = 'luxdmx.seq.remote.keep';
  it('comes back on with its own code; a code another tab has stays that tab\'s, "keep it on" too', async () => {
    const { installLocks, settle } = await import('../app.harness');
    const L = installLocks();
    try {
      localStorage.clear(); sessionStorage.clear();
      L.as('A');
      const a = new RemoteHost({} as never);
      a.start(); await settle(20);
      const codeA = a.code, sessA = sessionStorage.getItem(SESSION_KEY)!;
      sessionStorage.clear();
      L.as('B');
      const b = new RemoteHost({} as never);
      b.start(); b.setKeep(true); await settle(20);
      expect(b.code).not.toBe(codeA);
      // A reloads (its locks go, its session stays): its own code, on again
      L.releaseAll('A');
      sessionStorage.clear(); sessionStorage.setItem(SESSION_KEY, sessA);
      L.as('A');
      const a2 = new RemoteHost({} as never); await settle(20);
      expect([a2.code, a2.on]).toEqual([codeA, true]);
      expect(JSON.parse(localStorage.getItem(KEEP_KEY)!).code).toBe(b.code);
      // a tab whose session says on with B's code (an old copy): off, and B's "keep it on" stays
      sessionStorage.clear(); sessionStorage.setItem(SESSION_KEY, JSON.stringify({ on: true, code: b.code }));
      L.as('C');
      const c = new RemoteHost({} as never); await settle(20);
      expect(c.on).toBe(false);
      expect(JSON.parse(localStorage.getItem(KEEP_KEY)!).code).toBe(b.code);
    } finally { L.uninstall(); }
  });
});
