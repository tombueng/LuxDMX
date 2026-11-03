// RDM through LuxDMX Link: the page's request goes out as JSON with an id, the answer with that id
// comes back to it; a Link that doesn't answer (older than 1.3.0) times out, and one that isn't
// connected says so at once.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkOutput } from './link';

class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 0; binaryType = ''; sent: string[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null; onclose: (() => void) | null = null;
  constructor(readonly url: string) { FakeSocket.last = this; }
  send(d: unknown) { if (typeof d === 'string') this.sent.push(d); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onmessage?.({ data: JSON.stringify({ type: 'hello', version: '1.3.0', nodes: [] }) }); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('RDM through LuxDMX Link', () => {
  it('asks with an id and gets the answer with that id', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.useFakeTimers();
    const l = new LinkOutput(() => {});
    vi.runOnlyPendingTimers();                    // (it connects on the next tick)
    const ws = FakeSocket.last!;
    ws.open();
    expect(l.state).toBe('ready');
    const p = l.rdm({ op: 'address', uid: '4C55:00000001', addr: 100 });
    const asked = JSON.parse(ws.sent.find((s) => s.includes('"rdm"'))!);
    expect(asked).toEqual({ type: 'rdm', id: asked.id, op: 'address', uid: '4C55:00000001', addr: 100 });
    ws.onmessage!({ data: JSON.stringify({ type: 'rdm', id: asked.id, ok: true, status: 200, data: { ok: true } }) });
    expect(await p).toEqual({ ok: true, status: 200, data: { ok: true } });
    // an older Link never answers
    const q = l.rdm({ op: 'list' }, 1000);
    vi.advanceTimersByTime(1001);
    expect(await q).toEqual({ ok: false, error: 'timeout' });
    l.close();
  });
  it('not connected: says so at once', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const l = new LinkOutput(() => {});
    expect(await l.rdm({ op: 'list' })).toEqual({ ok: false, error: 'unreachable' });
    l.close();
  });
});
