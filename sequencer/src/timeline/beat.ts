// The demo beat: a ten-minute club track made here, live, with WebAudio (no file, no rights to
// clear): kick, hats, claps, a bass line, pads and risers, in sections that build and drop. The
// timeline plays it like a song; its sections are what the demo show is cued to.

export const DEMO_BPM = 126;
// The big demo plays a real song unless the demo beat is picked: this one (catalog.ts; hard rock
// with stops and slams measured beat by beat, which the demo's moving heads hit).
export const DEMO_SONG = 'ready-to-go';
// sections in bars (4 beats): what plays, and how hard (0..1, also the waveform's height)
export const SECTIONS: { name: string; bars: number; kick: boolean; hats: boolean; bass: boolean; pad: boolean; riser: boolean; energy: number }[] = [
  { name: 'Intro', bars: 16, kick: false, hats: false, bass: false, pad: true, riser: false, energy: 0.25 },
  { name: 'Groove', bars: 32, kick: true, hats: true, bass: false, pad: true, riser: false, energy: 0.5 },
  { name: 'Build', bars: 16, kick: true, hats: true, bass: true, pad: false, riser: true, energy: 0.7 },
  { name: 'Drop', bars: 32, kick: true, hats: true, bass: true, pad: true, riser: false, energy: 1 },
  { name: 'Break', bars: 16, kick: false, hats: false, bass: false, pad: true, riser: false, energy: 0.3 },
  { name: 'Build 2', bars: 16, kick: true, hats: true, bass: true, pad: false, riser: true, energy: 0.75 },
  { name: 'Drop 2', bars: 48, kick: true, hats: true, bass: true, pad: true, riser: false, energy: 1 },
  { name: 'Groove 2', bars: 32, kick: true, hats: true, bass: true, pad: false, riser: false, energy: 0.6 },
  { name: 'Break 2', bars: 16, kick: false, hats: true, bass: false, pad: true, riser: false, energy: 0.35 },
  { name: 'Build 3', bars: 16, kick: true, hats: true, bass: true, pad: false, riser: true, energy: 0.8 },
  { name: 'Final drop', bars: 48, kick: true, hats: true, bass: true, pad: true, riser: false, energy: 1 },
  { name: 'Outro', bars: 24, kick: true, hats: false, bass: false, pad: true, riser: false, energy: 0.35 },
];
export const BAR_S = (60 / DEMO_BPM) * 4;
export const DEMO_SECONDS = SECTIONS.reduce((s, x) => s + x.bars, 0) * BAR_S;
export function sectionAt(t: number) {
  let at = 0;
  for (const s of SECTIONS) { const end = at + s.bars * BAR_S; if (t < end) return { ...s, start: at, end }; at = end; }
  const l = SECTIONS[SECTIONS.length - 1]; return { ...l, start: at - l.bars * BAR_S, end: at };
}
export function sectionStarts() { let at = 0; return SECTIONS.map((s) => { const r = { name: s.name, at, end: at + s.bars * BAR_S, bars: s.bars, energy: s.energy }; at += s.bars * BAR_S; return r; }); }

// how loud it is over time, for the waveform (n buckets)
export function demoPeaks(n: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const t = ((i + 0.5) / n) * DEMO_SECONDS, s = sectionAt(t), beat = (t / (60 / DEMO_BPM)) % 1;
    const pulse = s.kick ? 0.55 + 0.45 * Math.exp(-beat * 6) : 0.7;
    const rise = s.riser ? 0.5 + 0.5 * ((t - s.start) / (s.end - s.start)) : 1;
    return Math.min(1, s.energy * pulse * rise + 0.04);
  });
}

// Plays it from `from` seconds on an AudioContext; returns stop(). Notes are scheduled a little
// ahead (a timer looks every 50 ms), so a busy page doesn't stutter the beat.
// `until` (seconds on the song's clock): every beat up to there is put in at once, no timer (for a
// render's mix in an OfflineAudioContext, whose clock only runs when it renders)
export function playDemo(ctx: BaseAudioContext, out: AudioNode, from: number, until?: number): () => void {
  const beatS = 60 / DEMO_BPM, t0 = ctx.currentTime - from;
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const master = ctx.createGain(); master.gain.value = 0.55; master.connect(out);
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(master);
  let nextBeat = Math.max(0, Math.ceil(from / beatS)), stopped = false;
  const ROOTS = [45, 45, 41, 43];      // A, A, F, G (the bass and pads follow it, a bar each)
  const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

  function kick(at: number) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(42, at + 0.12);
    g.gain.setValueAtTime(1.0, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.42);
    o.connect(g).connect(comp); o.start(at); o.stop(at + 0.45);
  }
  function hat(at: number, open = false, vol = 0.18) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; f.type = 'highpass'; f.frequency.value = 7500;
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + (open ? 0.22 : 0.05));
    s.connect(f).connect(g).connect(comp); s.start(at, Math.random() * 0.5); s.stop(at + 0.25);
  }
  function clap(at: number) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 0.8;
    g.gain.setValueAtTime(0.35, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.16);
    s.connect(f).connect(g).connect(comp); s.start(at, Math.random() * 0.5); s.stop(at + 0.2);
  }
  function bass(at: number, note: number) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = hz(note);
    f.type = 'lowpass'; f.frequency.setValueAtTime(900, at); f.frequency.exponentialRampToValueAtTime(160, at + beatS * 0.45); f.Q.value = 6;
    g.gain.setValueAtTime(0.28, at); g.gain.exponentialRampToValueAtTime(0.001, at + beatS * 0.48);
    o.connect(f).connect(g).connect(comp); o.start(at); o.stop(at + beatS * 0.5);
  }
  function pad(at: number, root: number, len: number, vol = 0.07) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1400;
    g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(vol, at + len * 0.3); g.gain.linearRampToValueAtTime(0.0001, at + len);
    f.connect(g).connect(comp);
    for (const [iv, det] of [[12, -7], [15, 6], [19, 0], [24, 4]]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(root + iv); o.detune.value = det; o.connect(f); o.start(at); o.stop(at + len + 0.05); }
  }
  function riser(at: number, len: number) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; s.loop = true; f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(300, at); f.frequency.exponentialRampToValueAtTime(9000, at + len);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.16, at + len);
    s.connect(f).connect(g).connect(comp); s.start(at); s.stop(at + len);
  }

  // every beat before `horizon` (on the context's clock) not put in yet; false once the song is over
  function schedule(horizon: number): boolean {
    while (t0 + nextBeat * beatS < horizon) {
      const at = Math.max(ctx.currentTime, t0 + nextBeat * beatS), t = nextBeat * beatS;
      if (t >= DEMO_SECONDS) return false;
      const s = sectionAt(t), inBar = nextBeat % 4, bar = Math.floor(nextBeat / 4), root = ROOTS[bar % 4];
      if (s.kick) kick(at);
      if (s.hats) { hat(at + beatS / 2, true, 0.14); if (s.energy > 0.6) { hat(at + beatS / 4); hat(at + (beatS * 3) / 4); } }
      if (s.kick && (inBar === 1 || inBar === 3) && s.energy > 0.45) clap(at);
      if (s.bass) { bass(at + beatS / 2, root); if (s.energy > 0.9) bass(at + (beatS * 3) / 4, root + 12); }
      if (s.pad && inBar === 0) pad(at, root, beatS * 4, s.kick ? 0.05 : 0.08);
      if (s.riser && inBar === 0 && bar === Math.floor(s.start / BAR_S)) riser(at, s.end - t);
      nextBeat++;
    }
    return true;
  }
  if (until !== undefined) { schedule(t0 + until); return () => undefined; }
  const timer = setInterval(() => {
    if (stopped) return;
    if (!schedule(ctx.currentTime + 0.25)) clearInterval(timer);
  }, 50);
  return () => { stopped = true; clearInterval(timer); master.gain.setTargetAtTime(0, ctx.currentTime, 0.05); setTimeout(() => master.disconnect(), 400); };
}
