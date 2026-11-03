// @vitest-environment happy-dom
// Before and after the song on the timeline: Play from the start begins at the start of the time
// before the song, a cue placed there comes on before the song does (on the wire), the song starts
// at its own 0, the show ends at the end of the time after it; Home goes to the very start, a jump
// into the intro puts the stage there, Next part from the intro goes to the song's first part; the
// crowd follows the show (its level rising when the music starts) and hangs off the player's bus
// (so a recording of the stage gets it). An old song without that time plays as it always did.
import { describe, expect, it } from 'vitest';
import { freshApp, smallShow } from '../app.harness';
import type { Timeline, TimelineItem } from '../model/timeline';

const goto = (id: string, at: number, cue: string): TimelineItem => ({ id, at, lane: 'list:L', do: { do: 'goto', list: 'L', cue } });
const P1 = 0;

async function around(o: Partial<Timeline> = {}) {
  const h = await freshApp();
  const { app } = h;
  smallShow(app);
  // a 6 s song (120 BPM, its first downbeat at 0.5 s) with 3 s before it and 2 s after it
  app.show.timeline = { duration: 6, bpm: 120, offset: 0.5, lead: 3, tail: 2, sections: [{ name: 'Intro', at: 0 }, { name: 'Verse', at: 2 }],
    items: [goto('w', -2.5, 'c2'), goto('s', 0.5, 'c1')],
    crowd: [{ id: 'k1', at: -3, do: { do: 'crowd', mood: 'chatter', level: 0.5 } }, { id: 'k2', at: -1, do: { do: 'crowd', mood: 'cheer', level: 0.6 }, len: 0.5 },
      { id: 'k3', at: 0, do: { do: 'crowd', mood: 'cheer', level: 1 }, len: 0.3 }, { id: 'k4', at: 0, do: { do: 'cheer', level: 1 }, len: 3 }], ...o } as Timeline;
  app.checkpoint();
  const run = async (ms: number, until?: () => boolean) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms && !until?.()) { h.tick(); await new Promise((r) => setTimeout(r, 20)); }
    h.tick();
  };
  return { ...h, run };
}

describe('the time before and after the song', () => {
  it('Play from the start begins before the song: a cue there comes on before the song does, the song at its own 0, the show over at the end of the time after it', async () => {
    const { app, sent, run } = await around();
    const P = app.timeline;
    expect(P.start).toBe(-3); expect(P.end).toBe(8); expect(P.duration).toBe(6);
    await P.prepare();
    expect(P.position).toBe(-3);                                         // (at the top: where Play starts)
    await P.play();
    expect(P.position).toBeCloseTo(-3, 1);
    await run(1500, () => P.position > -2.3);
    expect(P.position).toBeLessThan(0);
    expect(app.status.L.cue).toBe('c2');                                 // the intro's cue, before the song
    expect(sent.at(-1)!.data[P1]).toBe(128);                             // (on the wire)
    // the crowd: chatting while it waits
    expect(P.crowd.state.chatter).toBeCloseTo(0.5, 2);
    // into the song: its cue on its downbeat, and the crowd louder when the music starts
    const before = P.crowd.level;
    P.seek(-0.4);
    await run(1500, () => P.position > 0.6);
    expect(app.status.L.cue).toBe('c1');
    expect(P.crowd.level).toBeGreaterThan(before);
    // to the end of the time after it: over, there
    P.seek(7.6);
    await run(500, () => P.playing);
    await run(1500, () => !P.playing);
    expect(P.playing).toBe(false);
    expect(P.position).toBe(8);
  }, 20000);
  it('Home is the very start; a jump into the intro puts the stage there; Next part from the intro goes to the song', async () => {
    const { app, run } = await around();
    const P = app.timeline;
    P.seek(4);
    P.seek(P.start);
    expect(P.position).toBe(-3);
    P.seek(-1);
    await run(60);
    expect(app.status.L.cue).toBe('c2');
    expect(app.engine.jumped.has('L')).toBe(true);                      // (a jump: quiet)
    expect(app.nextPart.bind(app)).not.toThrow();
    expect(P.position).toBe(0);                                          // the song's first part
    app.nextPart();
    expect(P.position).toBe(2);
  });
  it('an old song without time around it plays as before: from a beat before its first downbeat, never below 0', async () => {
    const { app, run } = await around({ lead: undefined, tail: undefined, crowd: undefined, items: [goto('s', 0.5, 'c1')] });
    const P = app.timeline;
    expect(P.start).toBe(0); expect(P.end).toBe(6);
    await P.play();
    expect(P.position).toBeCloseTo(0, 6);                                // (120 BPM, downbeat 0.5: from 0)
    await run(800, () => P.position > 0.6);
    expect(app.status.L.cue).toBe('c1');
    P.seek(-5);
    expect(P.position).toBe(0);
    P.pause();
  });
  it('the crowd hangs off the bus with the song (a recording gets it), at its own volume, and can be left out', async () => {
    (globalThis as any).AudioContext = FakeAudio;
    try {
      const { app, run } = await around();
      const P = app.timeline;
      P.setCrowd(0.5, true);
      expect(localStorage.getItem('luxdmx.seq.crowdVol')).toBe('0.5');
      const rec = P.audioStream();
      expect(rec).toEqual({ id: 'recording' });
      await P.play();
      await run(200);
      const node = P.crowd.node as unknown as Node;
      expect(node).toBeDefined();
      expect(node.to).toContain(P.bus);                                   // into the bus: the speakers and the recording
      expect(P.bus.to).toContain(P.tap);
      P.setCrowd(0.5, false);
      expect(node.gain.target).toBe(0);
      expect(localStorage.getItem('luxdmx.seq.crowd')).toBe('off');
      P.setCrowd(0.7, true);
      expect(node.gain.target).toBe(0.7);
      P.pause();
    } finally { delete (globalThis as any).AudioContext; }
  });
});

// A stand-in for the browser's sound (happy-dom has none): nodes that remember what they're connected to.
class Param { value = 1; target = 1; setValueAtTime() { return this; } exponentialRampToValueAtTime() { return this; } setTargetAtTime(v: number) { this.target = v; return this; } }
class Node { gain = new Param(); offset = new Param(); frequency = new Param(); playbackRate = new Param(); to: Node[] = []; connect(n: Node) { this.to.push(n); return n; } disconnect() { this.to = []; } start() {} stop() {} }
class FakeAudio {
  state = 'running'; destination = new Node(); sampleRate = 48000;
  get currentTime() { return performance.now() / 1000; }
  createGain() { return new Node(); } createOscillator() { return new Node(); } createConstantSource() { return new Node(); } createBufferSource() { return new Node(); }
  createMediaStreamDestination() { return Object.assign(new Node(), { stream: { id: 'recording' } }); }
  resume() { return Promise.resolve(); } close() { return Promise.resolve(); }
}
