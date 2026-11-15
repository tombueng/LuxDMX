// What goes on the wire, the same from the page and the output thread (wire.ts).
import { describe, expect, it } from 'vitest';
import { HEARTBEAT_MS, due, linkFrame, linkRoutes, type Sent } from './wire';

describe('only what changed, plus a heartbeat', () => {
  it('a new frame goes; the same again waits for the heartbeat; a change goes at once', () => {
    const sent: Sent = new Map(), a = new Uint8Array([1, 2, 3]);
    expect(due(sent, 0, a, 0)).toBe(true);
    expect(due(sent, 0, a.slice(), 100)).toBe(false);
    expect(due(sent, 0, a, HEARTBEAT_MS)).toBe(true);
    expect(due(sent, 0, new Uint8Array([1, 2, 4]), HEARTBEAT_MS + 10)).toBe(true);
    // (each universe on its own)
    expect(due(sent, 1, a, HEARTBEAT_MS + 10)).toBe(true);
  });
  it('kept as a copy: the frame changed in place after it went still counts as a change', () => {
    const sent: Sent = new Map(), a = new Uint8Array([5]);
    due(sent, 0, a, 0);
    a[0] = 6;
    expect(due(sent, 0, a, 10)).toBe(true);
  });
});

describe("Link's frame and routes", () => {
  it("'D', version 1, the universe low byte first, priority 100, then the channels", () => {
    expect([...linkFrame(300, new Uint8Array([9, 8]))]).toEqual([68, 1, 44, 1, 100, 0, 9, 8]);
  });
  it('each universe with its protocol, the nodes picked by Link', () => {
    expect(JSON.parse(linkRoutes(new Set([0, 3]), 'sacn'))).toEqual({ type: 'routes', routes: [{ uni: 0, proto: 'sacn', to: 'auto' }, { uni: 3, proto: 'sacn', to: 'auto' }] });
  });
});
