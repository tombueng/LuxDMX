// The output thread (thread.ts) on its own: it plays what the page last said; a page that goes
// silent (frozen, gone without a word) gets fog, haze and the machines off on the wire after a few
// seconds (their time limits live on the page), the lights' look as it was.
import { expect, it, vi } from 'vitest';
import { emptyShow } from '../model/format';

it('the page silent for five seconds: the fog goes off on the wire, the light stays', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const sent: number[][] = [];
  const g = globalThis as unknown as { self: unknown; postMessage: unknown };
  g.self = globalThis; g.postMessage = () => {};
  const { PAGE_SILENT_MS } = await import('./thread');
  const say = (data: unknown) => (globalThis as unknown as { onmessage: (e: { data: unknown }) => void }).onmessage({ data });
  const s = emptyShow();
  s.fixtures.push({ id: 'd', name: 'D', typeId: 'gen-dimmer', mode: '', universe: 0, address: 1, x: 0.5, y: 0.5 } as never,
    { id: 'f', name: 'Fog', typeId: 'gen-fog', mode: '', universe: 0, address: 2, x: 0.5, y: 0.5 } as never);
  const port = { postMessage: (m: { data?: Uint8Array }) => { if (m.data) sent.push([...m.data.slice(0, 3)]); }, close() {} };
  say({ t: 'init', origin: performance.timeOrigin });
  say({ t: 'show', json: JSON.stringify(s) });
  say({ t: 'policy', quiet: false, blind: null });
  say({ t: 'port', key: 'box', port, outputs: [{ en: true, uni: 0 }] });
  say({ t: 'inputs', v: { live: { d: { intensity: 1 }, f: { fog: 1 } } } });
  // talking every second: the fog stays on
  for (let i = 0; i < 4; i++) { vi.advanceTimersByTime(1000); say({ t: 'call', m: 'syncBeats', a: [i], at: 0 }); }
  expect(sent.at(-1)).toEqual([255, 255, 0]);
  // silent: a few seconds later the fog is off, the light still on
  vi.advanceTimersByTime(PAGE_SILENT_MS + 1000);
  expect(sent.at(-1)).toEqual([255, 0, 0]);
  vi.useRealTimers();
});
