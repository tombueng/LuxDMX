// @vitest-environment happy-dom
// The box's name is kept for the next start: a tablet switched on again (nothing connected yet) can
// say "the bar's box isn't connected" instead of an address nobody knows.
import { describe, it, expect, beforeEach } from 'vitest';
import { Bridge } from './bridge';

describe('Bridge', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

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
    stats(0, 0); stats(0, 0); stats(0, 0);
    expect(b.slow).toBe('');                       // (three seconds in: still warming up, said "hardly answers" here)
    stats(0, 0);
    expect(b.slow).toBe('stalled');
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
