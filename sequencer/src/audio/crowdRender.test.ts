// The crowd in a render (renderCrowd, render/audio.ts): the same sounds as when the show plays, on
// an offline context whose 0 is the render's start. Before the song they chat (the festival waits
// half a minute for the band), the cheering comes up where the track says, a cheer is there at its
// moment, the same each time, at the crowd's volume, nothing at all at volume 0.
import { describe, expect, it } from 'vitest';
import type { CrowdItem } from '../model/timeline';
import { renderCrowd } from './crowd';

// a context that only notes what's set up on it
function fakeCtx() {
  const starts: { what: 'loop' | 'shot'; when: number }[] = [], gains: { ramps: [number, number][]; value: number }[] = [];
  const node = () => ({ connect: (x: unknown) => x });
  const ctx = {
    createGain: () => { const g = { value: 1, ramps: [] as [number, number][], setValueAtTime(v: number, t: number) { g.ramps.push([t, v]); }, linearRampToValueAtTime(v: number, t: number) { g.ramps.push([t, v]); } }; gains.push(g); return { ...node(), gain: g }; },
    createBufferSource: () => { const s = { ...node(), buffer: null as unknown, loop: false, playbackRate: { value: 1 }, start(when: number) { starts.push({ what: s.loop ? 'loop' : 'shot', when }); } }; return s; },
    createBuffer: (_c: number, len: number, rate: number) => ({ duration: len / rate, copyToChannel() {} }),
    createStereoPanner: () => ({ ...node(), pan: { value: 0 } }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, starts, gains };
}
// (as the festival: chatting while it waits, a cheer as the band comes on, cheering from the chorus)
const TRACK: CrowdItem[] = [
  { id: 'c1', at: -32, do: { do: 'crowd', mood: 'chatter', level: 0.7 } },
  { id: 'c2', at: -2, len: 4, do: { do: 'cheer', level: 1 } },
  { id: 'c3', at: 10, len: 2, do: { do: 'crowd', mood: 'cheer', level: 0.9 } },
];
const at = (ramps: [number, number][], t: number) => ramps.reduce((v, [x, y]) => (x <= t ? y : v), 0);

describe('the crowd in a render', () => {
  it('chatting before the song, cheering where the track says, a cheer at its moment, at its volume', async () => {
    const f = fakeCtx(), out = { connect: (x: unknown) => x } as unknown as AudioNode;
    await renderCrowd(f.ctx, out, TRACK, -32, 20, 0.6);
    const [master, chat, cheer] = f.gains;
    expect(master.value).toBe(0.6);
    expect(f.starts.filter((s) => s.what === 'loop')).toHaveLength(3);
    expect(at(chat.ramps, 5)).toBeGreaterThan(0.3);            // (half a minute before the song: chatting)
    expect(at(cheer.ramps, 5)).toBeLessThan(0.05);
    expect(at(cheer.ramps, 46)).toBeGreaterThan(0.5);          // (12 s into the song: cheering)
    // the cheer as the band comes on (30 s in)
    expect(f.starts.some((s) => s.what === 'shot' && s.when >= 30 && s.when < 32)).toBe(true);
    for (const s of f.starts) { expect(s.when).toBeGreaterThanOrEqual(0); expect(s.when).toBeLessThan(52); }
  }, 60000);
  it('the same every time; nothing at volume 0', async () => {
    const a = fakeCtx(), b = fakeCtx(), out = { connect: (x: unknown) => x } as unknown as AudioNode;
    await renderCrowd(a.ctx, out, TRACK, -32, 20, 0.8);
    await renderCrowd(b.ctx, out, TRACK, -32, 20, 0.8);
    expect(b.starts).toEqual(a.starts);
    const z = fakeCtx();
    await renderCrowd(z.ctx, out, TRACK, -32, 20, 0);
    expect(z.starts).toHaveLength(0);
  }, 60000);
});
