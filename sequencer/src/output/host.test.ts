// The page's side of the output thread (host.svelte.ts): a command given on the page goes to the
// thread once, with its moment; what the engine does by itself within a frame (a cue that waits its
// turn and goes on) isn't sent: the thread's engine does the same in its own frame.
import { expect, it, vi } from 'vitest';
import { Engine } from '../engine/engine';
import { emptyShow } from '../model/format';
import type { Show } from '../model/types';

it('a GO goes to the thread; the cue that follows by itself in a frame does not', async () => {
  const posted: { t: string; m?: string }[] = [];
  (globalThis as unknown as { Worker: unknown }).Worker = class { onmessage: unknown; onerror: unknown; postMessage(m: { t: string; m?: string }) { posted.push(m); } terminate() {} };
  const { OutputThread } = await import('./host.svelte');
  const s: Show = emptyShow();
  s.fixtures.push({ id: 'd', name: 'D', typeId: 'gen-dimmer', mode: '', universe: 0, address: 1, x: 0.5, y: 0.5 } as never);
  s.cueLists.push({ id: 'L', name: 'L', cues: [
    { id: 'c1', name: 'One', values: { d: { intensity: 0.3 } }, fade: 0, advance: { mode: 'wait', time: 0.5 } },
    { id: 'c2', name: 'Two', values: { d: { intensity: 0.8 } }, fade: 0, advance: { mode: 'manual' } },
  ] } as never);
  let now = 0;
  const eng = new Engine(() => s, () => now), host = new OutputThread();
  expect(host.start(eng, () => s)).toBe(true);
  eng.go('L');
  const calls = () => posted.filter((m) => m.t === 'call').map((m) => m.m);
  expect(calls()).toEqual(['go']);
  for (now = 0; now < 2; now += 0.025) eng.tick();
  expect(eng.status('L').index).toBe(1);                       // (it went on to Two by itself)
  expect(calls()).toEqual(['go']);                             // (and the thread wasn't told)
  vi.unstubAllGlobals();
});

it('LuxDMX Link is the thread\'s to send to only once the thread\'s own socket to it is up', async () => {
  let worker: { onmessage: (e: { data: unknown }) => void } | null = null;
  (globalThis as unknown as { Worker: unknown }).Worker = class { onmessage: unknown; onerror: unknown; constructor() { worker = this as never; } postMessage() {} terminate() {} };
  const { OutputThread } = await import('./host.svelte');
  const { LINK } = await import('./link');
  const host = new OutputThread(), s = emptyShow();
  host.start(new Engine(() => s), () => s);
  const link = { host: LINK } as never, stats = (l: boolean) => worker!.onmessage({ data: { t: 'stats', rate: 40, worst: 25, late: 0, ms: 1, sent: 0, to: 0, quiet: false, unis: 0, link: l } });
  stats(false);
  expect(host.running).toBe(true);
  expect(host.serves(link)).toBe(false);                    // (the page goes on sending to Link)
  stats(true);
  expect(host.serves(link)).toBe(true);
  vi.unstubAllGlobals();
});

// Live's "Stop effects" stops the effects the cues on stage run as well: that has to reach the
// thread, or the screen shows them stopped while the wire keeps sending them
it('"Stop effects" muting the cues\' effects goes to the thread too', async () => {
  const posted: { t: string; m?: string }[] = [];
  (globalThis as unknown as { Worker: unknown }).Worker = class { onmessage: unknown; onerror: unknown; postMessage(m: { t: string; m?: string }) { posted.push(m); } terminate() {} };
  const { OutputThread } = await import('./host.svelte');
  const s: Show = emptyShow();
  s.fixtures.push({ id: 'p', name: 'P', typeId: 'gen-drgb', mode: '', universe: 0, address: 1, x: 0.5, y: 0.5 } as never);
  s.effects.push({ id: 'e1', name: 'Pulse', kind: 'pulse', fixtures: ['p'], params: { speed: 1 } } as never);
  s.cueLists.push({ id: 'L', name: 'L', cues: [{ id: 'c1', name: 'One', values: { p: { intensity: 1 } }, effects: ['e1'], fade: 0, advance: { mode: 'manual' } }] } as never);
  let now = 0;
  const eng = new Engine(() => s, () => now), host = new OutputThread();
  expect(host.start(eng, () => s)).toBe(true);
  eng.go('L');
  for (now = 0; now < 1; now += 0.025) eng.tick();
  eng.stopAllEffects(); eng.muteCueEffects();
  expect(posted.filter((m) => m.t === 'call').map((m) => m.m)).toEqual(['go', 'stopAllEffects', 'muteCueEffects']);
  vi.unstubAllGlobals();
});
