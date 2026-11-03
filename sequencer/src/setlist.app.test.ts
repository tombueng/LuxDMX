// @vitest-environment happy-dom
// A gig in one show (the set list): Next song is not another show, so nothing goes dark, haze and
// the lists running stay, the machines stay as armed or safe as they were, and nothing fires; Play
// from the start comes in on the band's "one"; Next part jumps on the next beat and never fires
// what it jumps over; a moment fires only when the song plays into it; Sound here off mutes the
// speakers while the clock (and a recording) go on.
import { describe, expect, it } from 'vitest';
import { freshApp, smallShow } from './app.harness';
import { buskingPage } from './content/busking';
import { setOptions, type Timeline, type TimelineItem } from './model/timeline';

const goto = (id: string, at: number, list: string, cue: string): TimelineItem => ({ id, at, lane: `list:${list}`, do: { do: 'goto', list, cue } });
const burst = (id: string, at: number, attr: 'confetti' | 'flame'): TimelineItem => ({ id, at, lane: 'special', do: { do: 'burst', attr, seconds: 1 } });
const manual = { mode: 'manual' as const };
// channels on the fake box (universe 0): P1 1, P2 2, fog 3, flame 10, confetti 11
const P1 = 0, FOG = 2, FLAME = 9, CONFETTI = 10;

// The band's show: two moods (L), haze of its own (H), a finale with flames held (F), a look for
// between songs (B); two songs, the first one up.
async function gig() {
  const h = await freshApp();
  const { app } = h;
  smallShow(app);
  app.show.fixtures.push(
    { id: 'fl', name: 'Flame', typeId: 'gen-flame', mode: '', universe: 0, address: 10, x: 0.3, y: 0.9 },
    { id: 'cf', name: 'Confetti', typeId: 'gen-confetti', mode: '', universe: 0, address: 11, x: 0.7, y: 0.9 },
  );
  app.show.cueLists.push(
    { id: 'H', name: 'Haze', end: 'stop', cues: [{ id: 'h1', name: 'Haze', values: { fg: { fog: 0.4 } }, fade: 0, advance: manual }] },
    { id: 'F', name: 'Finale', end: 'stop', cues: [{ id: 'f1', name: 'Big finish', values: { p2: { intensity: 1 }, fl: { flame: 1 } }, fade: 0, advance: manual }] },
    { id: 'B', name: 'Between', end: 'stop', cues: [{ id: 'b1', name: 'Talk', values: { p2: { intensity: 0.3 } }, fade: 0, advance: manual }] },
  );
  const one: Timeline = { name: 'Ragazzi', duration: 12, bpm: 120, offset: 0.5, items: [goto('a', 0.5, 'L', 'c1'), burst('x', 6, 'confetti'), goto('f', 8, 'F', 'f1'), burst('y', 9.5, 'confetti')],
    sections: [{ name: 'Intro', at: 0 }, { name: 'Verse', at: 2 }, { name: 'Solo', at: 4 }, { name: 'Chorus', at: 8 }] };
  const two: Timeline = { name: 'Whiskey', duration: 10, bpm: 120, offset: 1, items: [goto('b', 1, 'L', 'c2'), burst('z', 1.6, 'confetti')] };
  app.show.timeline = one;
  app.show.setlist = { before: [], after: [two] };
  app.checkpoint();
  // every moment the timeline fires
  const fired: string[] = [];
  const real = app.doTimeline.bind(app);
  app.doTimeline = (a: { do: string; attr?: string }, x: boolean) => { if (a.do === 'burst') fired.push(a.attr!); return real(a, x); };
  // the app's clock for a while (the page's clock: no sound device here)
  const run = async (ms: number, until?: () => boolean) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms && !until?.()) { h.tick(); await new Promise((r) => setTimeout(r, 20)); }
    h.tick();
  };
  return { ...h, fired, run };
}
const on = (sent: { data: number[] }[], from: number, ch: number) => sent.slice(from).map((f) => f.data[ch]);

describe('Next song is not another show', () => {
  it('nothing goes dark, haze and the other lists stay, armed stays armed, and nothing fires', async () => {
    const { app, sent, tick, fired } = await gig();
    app.armMachines(true);
    app.go('H'); app.go('L');
    tick(3);
    expect(sent.at(-1)!.data[P1]).toBe(255);
    const n = sent.length, undo = app.canUndo;
    app.nextSong();
    tick(6);
    expect(app.show.timeline.name).toBe('Whiskey');
    expect(app.timeline.playing).toBe(false);
    expect(app.timeline.position).toBe(0);
    // never dark: the light and the haze in every frame across it
    expect(Math.min(...on(sent, n, P1))).toBeGreaterThan(0);
    expect(Math.min(...on(sent, n, FOG))).toBe(102);
    // its first look is up (the mood its first cue plays), as a jump: quiet
    expect(app.status.L.cue).toBe('c2');
    expect(sent.at(-1)!.data[P1]).toBe(128);
    expect(app.engine.jumped.has('L')).toBe(true);
    // not another show: still armed, still on stage, the haze list running, nothing fired
    expect(app.sfxArmed).toBe(true);
    expect(app.engine.armed).toBe(true);
    expect(app.output).toBe('live');
    expect(app.engine.isOn('H')).toBe(true);
    expect(fired).toEqual([]);
    expect(Math.max(...on(sent, n, CONFETTI), ...on(sent, n, FLAME))).toBe(0);
    // (the song that's up is saved with the show: an undo step, not a new show)
    expect(app.canUndo || undo).toBe(true);
    // the end of the set says so and stays
    app.songAt = -1e9;
    app.nextSong();
    expect(app.show.timeline.name).toBe('Whiskey');
  });

  it('Play from the start comes in a beat before the first downbeat; a moment fires when the song plays into it', async () => {
    const { app, sent, fired, run } = await gig();
    app.armMachines(true);
    app.nextSong();
    await app.timeline.play();
    // Whiskey: first downbeat at 1 s, 120 BPM: it starts at 0.5 s (pressed on "four")
    expect(app.timeline.position).toBeCloseTo(0.5, 2);
    const n = sent.length;
    await run(2000, () => app.timeline.position > 1.9);
    expect(app.status.L.cue).toBe('c2');
    expect(app.engine.jumped.has('L')).toBe(false);                 // (played into: a real cue)
    expect(fired).toEqual(['confetti']);
    expect(Math.max(...on(sent, n, CONFETTI))).toBe(255);           // armed and played into: it fires
    app.timeline.pause();
  });

  it('Next part waits for the beat, then jumps: the confetti it skips never fires, the flames it lands on stay quiet; played on, the next one fires', async () => {
    const { app, sent, fired, run } = await gig();
    app.armMachines(true);
    app.timeline.seek(4.2);                                          // in the Solo
    await app.timeline.play();
    const n = sent.length;
    app.nextPart();
    // the beat: 4.5 s (120 BPM from the downbeat at 0.5 s), then on to the Chorus at 8 s
    expect(app.timeline.pending?.to.name).toBe('Chorus');
    expect(app.timeline.pending?.at).toBeCloseTo(4.5, 6);
    await run(1500, () => app.timeline.position >= 8);
    expect(app.timeline.position).toBeGreaterThanOrEqual(8);
    expect(app.timeline.position).toBeLessThan(8.6);
    expect(fired).toEqual([]);                                       // the confetti at 6 s was jumped over
    expect(app.status.F.cue).toBe('f1');                             // the finale is on (its look)...
    expect(app.engine.jumped.has('F')).toBe(true);                   // ...but jumped onto: quiet
    await run(300);
    expect(Math.max(...on(sent, n, CONFETTI), ...on(sent, n, FLAME))).toBe(0);
    expect(sent.at(-1)!.data[1]).toBe(255);                          // (P2 at full from the finale's look)
    // playing on into the confetti at 9.5 s: that one fires
    await run(2500, () => fired.length > 0);
    expect(fired).toEqual(['confetti']);
    await run(100);
    expect(Math.max(...on(sent, n, CONFETTI))).toBe(255);
    app.timeline.pause();
  });

  it('Next part while stopped jumps at once; pressed again while one waits, it goes one further; at the last part it says so', async () => {
    const { app, fired } = await gig();
    app.nextPart();
    expect(app.timeline.position).toBe(2);                          // Intro -> Verse
    app.nextPart();
    expect(app.timeline.position).toBe(4);
    await app.timeline.play();
    app.nextPart(); app.nextPart();
    expect(app.timeline.pending?.to.name).toBe('Chorus');           // Solo -> Chorus (two presses: one further)
    app.timeline.pause();
    expect(app.timeline.pending).toBe(null);                        // (a pause lets go of it)
    app.timeline.seek(8.5);
    expect(app.timeline.nextPart()).toBeUndefined();                // the last part
    expect(fired).toEqual([]);
  });

  it('a song that ends by itself keeps its last look; with a look between songs, that one comes up, quietly', async () => {
    const { app, sent, run } = await gig();
    setOptions(app.show, { between: { list: 'B', cue: 'b1' } });
    app.show.timeline.duration = 1.2;
    app.show.timeline.offset = 0;
    await app.timeline.play();
    const n = sent.length;
    await run(2500, () => !app.timeline.playing);
    expect(app.timeline.playing).toBe(false);
    expect(app.timeline.position).toBe(1.2);
    await run(100);
    expect(app.status.L.cue).toBe('c1');                            // its last look stays
    expect(app.status.B.cue).toBe('b1');                            // and the look between songs is up
    expect(app.engine.jumped.has('B')).toBe(true);
    expect(Math.min(...on(sent, n + 2, P1))).toBeGreaterThan(0);  // never dark
  });

  it('a count-in: a bar of clicks first (the clock before 0, the count on), then the song from its first downbeat', async () => {
    const { app, run } = await gig();
    setOptions(app.show, { countIn: 1 });
    app.nextSong();                                                  // Whiskey: downbeat at 1 s, 120 BPM: clicks from -1 s
    await app.timeline.play();
    await run(200);
    expect(app.timeline.clock).toBeLessThan(0);
    expect(app.timeline.count).toBe(1);
    expect(app.timeline.position).toBe(0);
    await run(1500, () => app.timeline.count === 4);
    expect(app.timeline.count).toBe(4);
    await run(1500, () => app.timeline.clock > 1.05);
    expect(app.timeline.count).toBe(0);
    expect(app.status.L.cue).toBe('c2');                            // the song's first cue, on its downbeat
    app.timeline.pause();
  });
});

describe('the set list on a live page', () => {
  it('the generated page has Play, Next song and Next part when the show has a song, with keys; a show without has none', async () => {
    const { app } = await gig();
    const w = buskingPage(app.show).widgets.filter((x) => x.type === 'song');
    expect(w.map((x) => [(x as { do: string }).do, x.key, x.size])).toEqual([['play', ',', 2], ['next', '.', 2], ['part', '-', undefined]]);
    delete app.show.timeline; delete app.show.setlist;
    expect(buskingPage(app.show).widgets.some((x) => x.type === 'song')).toBe(false);
  });
  it('the buttons: a nervous double tap on Next song skips one song, not two; Play plays and pauses', async () => {
    const { app } = await gig();
    app.show.setlist.after.push({ name: 'Encore', duration: 5, items: [] });
    const next = { id: 'n', type: 'song', do: 'next' }, play = { id: 'p', type: 'song', do: 'play' };
    app.fireWidget(next, true); app.fireWidget(next, false);
    app.fireWidget(next, true); app.fireWidget(next, false);
    expect(app.show.timeline.name).toBe('Whiskey');
    app.fireWidget(play, true);
    await new Promise((r) => setTimeout(r, 30));
    expect(app.timeline.playing).toBe(true);
    await new Promise((r) => setTimeout(r, 320));
    app.fireWidget(play, true);
    expect(app.timeline.playing).toBe(false);
  });
  it('what the three buttons say follows the song, and costs next to nothing a frame', async () => {
    const { app } = await gig();
    const { widgetFace } = await import('./ui/widgetFace');
    const tiles = (['play', 'next', 'part'] as const).map((d) => ({ id: d, type: 'song' as const, do: d }));
    app.timeline.seek(4.2);
    expect(tiles.map((w) => [widgetFace(app, w).label, widgetFace(app, w).sub])).toEqual([['Play', 'Ragazzi · 0:04 / 0:12'], ['Next song', 'Whiskey'], ['Next part', 'Chorus']]);
    // (the Live page asks for them on every frame while the song plays: 3 tiles, 10 s of frames)
    const t0 = performance.now();
    for (let i = 0; i < 400; i++) for (const w of tiles) widgetFace(app, w);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(300);
  });
  it('a reload keeps the song that is up and where it was', async () => {
    const { app, run } = await gig();
    app.nextSong();
    app.timeline.seek(3);
    await run(500);
    const saved = JSON.parse(sessionStorage.getItem('luxdmx.seq.playing') ?? '{}');
    expect(saved.tl).toMatchObject({ song: 1, pos: 3, playing: false });
  });
});

// A stand-in for the browser's sound (happy-dom has none): nodes that remember what they're connected to.
class Param { value = 1; setValueAtTime() { return this; } exponentialRampToValueAtTime() { return this; } }
class Node { gain = new Param(); offset = new Param(); frequency = new Param(); to: Node[] = []; connect(n: Node) { this.to.push(n); return n; } disconnect() { this.to = []; } start() {} stop() {} }
class FakeAudio {
  state = 'running'; destination = new Node();
  get currentTime() { return performance.now() / 1000; }
  createGain() { return new Node(); } createOscillator() { return new Node(); } createConstantSource() { return new Node(); }
  createMediaStreamDestination() { return Object.assign(new Node(), { stream: { id: 'recording' } }); }
  resume() { return Promise.resolve(); } close() { return Promise.resolve(); }
}

describe('Sound here', () => {
  it('off: the speakers get nothing, the song plays on its clock and a recording still gets it; kept in this browser', async () => {
    (globalThis as any).AudioContext = FakeAudio;
    try {
      const { app, run } = await gig();
      const P = app.timeline;
      expect(P.soundHere).toBe(true);
      P.setSoundHere(false);
      expect(localStorage.getItem('luxdmx.seq.sound')).toBe('off');
      const rec = P.audioStream();                                   // the 3D stage's recorder asks for the sound
      expect(rec).toEqual({ id: 'recording' });
      setOptions(app.show, { countIn: 1 });                           // (clicks: the speakers get them, not a recording)
      await P.play();
      await run(400);
      const bus = P.bus, gain = P.gain, ctx = P.ctx;
      expect(gain.gain.value).toBe(0);                                // the speakers: nothing
      expect(bus.to).toContain(gain);
      expect(bus.to).toContain(P.tap);                                // the recording hangs off the bus, at full level
      expect(gain.to).toContain(ctx.destination);
      expect(P.clock).toBeGreaterThan(-1.4);                          // the clock runs (from -1.5 s: a bar of clicks before 0.5 s)
      await run(1500, () => P.position > 0.2);
      expect(P.position).toBeGreaterThan(0.2);
      P.setSoundHere(true);
      expect(gain.gain.value).toBe(P.volume);
      expect(localStorage.getItem('luxdmx.seq.sound')).toBe(null);
      P.pause();
    } finally { delete (globalThis as any).AudioContext; }
  });
});
