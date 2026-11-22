// @vitest-environment happy-dom
// The box's name is kept for the next start: a tablet switched on again (nothing connected yet) can
// say "the bar's box isn't connected" instead of an address nobody knows.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Bridge, PROBE_MS, QUIET_MS } from './bridge';

describe('Bridge', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  // the box's window, as this page sees it
  const boxWindow = () => {
    const win = { closed: false, postMessage: vi.fn(), close() { this.closed = true; } };
    vi.stubGlobal('open', () => win);
    const hellos = () => win.postMessage.mock.calls.filter((c) => c[0]?.type === 'hello').length;
    return { win, hellos };
  };

  // Its window reloaded (F5 in it) waits for a hello and takes nothing; the "socket closed" it says
  // on the way out didn't always get here, and this said "connected" while the lights got nothing.
  // Crashed or hanging: the same. It says its stats every second, so quiet is the sign.
  it('its page gone quiet while connected: asked with a hello; a live one answers and stays; two unanswered: lost', () => {
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const { win, hellos } = boxWindow();
    const b = new Bridge('h', () => {});
    b.open();
    b.handle({ type: 'ready', name: 'x' });
    win.postMessage.mockClear();
    const at = (ms: number) => { clock += ms; b.watch(); };
    at(1000);
    expect(hellos()).toBe(0);                                 // (a second without a word: nothing)
    at(QUIET_MS);
    expect(hellos()).toBe(1);
    expect(b.state).toBe('ready');
    at(50); b.handle({ type: 'status', ws: 'open' });         // a live page answers at once
    at(QUIET_MS - 100);
    expect(hellos()).toBe(1);
    expect(b.state).toBe('ready');
    // quiet again and nobody answers: two hellos, PROBE_MS apart, then lost
    at(200); at(50);
    expect(hellos()).toBe(2);
    at(PROBE_MS);
    expect(hellos()).toBe(3);
    expect(b.state).toBe('ready');
    at(PROBE_MS);
    expect(b.state).toBe('reconnecting');                     // (the red bar; its hellos go on from here)
    expect(b.lostAt).toBeGreaterThan(0);
    b.close();
    vi.restoreAllMocks();
  });

  it('a page that says ready again is a new one (its window reloaded): a new page for the output thread, every frame goes again', () => {
    const { win } = boxWindow();
    const b = new Bridge('h', () => {});
    b.open();
    b.handle({ type: 'ready', name: 'x' });
    const first = b.page;
    b.handle({ type: 'port', ok: 1 });
    expect(b.portTaken).toBe(true);
    const frames = () => win.postMessage.mock.calls.filter((c) => c[0]?.type === 'dmx').length;
    const look = new Uint8Array([255, 0, 0]);
    b.send(0, look); b.send(0, look);
    expect(frames()).toBe(1);                                 // (only what changed)
    b.handle({ type: 'ready', name: 'x' });
    expect(b.page).toBe(first + 1);
    expect(b.portTaken).toBe(false);                          // (the old page's channel went with it)
    b.send(0, look);
    expect(frames()).toBe(2);                                 // (the new page has had nothing yet)
    b.close();
  });

  it('remembers the name a box gave and knows it at the next start', () => {
    const b = new Bridge('192.168.1.50', () => {});
    expect(b.name).toBe('');
    b.handle({ type: 'ready', name: 'Bar box', outputs: [{ en: true, uni: 0 }], ip: '192.168.1.50' });
    expect(b.name).toBe('Bar box');
    expect(new Bridge('192.168.1.50', () => {}).name).toBe('Bar box');
    expect(new Bridge('192.168.1.51', () => {}).name).toBe('');
  });

  it('notes when it was lost after being live', () => {
    const b = new Bridge('h', () => {});
    b.handle({ type: 'ready', name: 'x' });
    expect(b.lostAt).toBe(0);
    b.handle({ type: 'status', ws: 'closed' });
    expect(b.state === 'closed' || b.state === 'reconnecting').toBe(true);
    expect(b.lostAt).toBeGreaterThan(0);
  });

  it('says slow or stalled from what its page counts, not from its first second, and back when it is fine', () => {
    const b = new Bridge('h', () => {});
    b.handle({ type: 'ready', name: 'x' });
    const stats = (fps: number, drops: number) => b.handle({ type: 'stats', fps, drops });
    stats(0, 2); stats(0, 2); stats(0, 2);
    expect(b.slow).toBe('');                       // (three seconds in: still warming up, said "hardly answers" here)
    stats(0, 2);
    expect(b.slow).toBe('stalled');
    for (const f of [0, 0, 0, 0]) stats(f, 0);
    expect(b.slow).toBe('');                       // an idle show: nothing to send, nothing skipped: fine
    for (const f of [1, 1, 1]) stats(f, 6);
    expect(b.slow).toBe('slow');                   // a look a second, frames skipped
    for (const f of [4, 4, 4]) stats(f, 0);
    expect(b.slow).toBe('');                       // a still look's heartbeat: fine
    for (const f of [30, 30, 30]) stats(f, 10);
    expect(b.slow).toBe('');                       // busy but keeping up
    b.handle({ type: 'status', ws: 'closed' });
    expect(b.slow).toBe('');                       // (not connected: that's the red bar's)
  });
});
