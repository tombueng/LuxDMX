// The big demo: a couple of hundred lights, over half of them moving heads, nothing sharing a
// channel or running past a universe, a ten-minute show on the timeline whose every item points at
// something real, every pixel show playing on it, and it validates. On its song: the looks and the
// moves hitting where the song hits, the heads on its beat. Around the song: half a minute of intro
// before it (house lights, dark, searchlights, the backdrop, the walk-on) and the cheer after it,
// with the crowd's sound following all of it.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { buildDemo, CROWD_GONE, DEMO_LEAD, DEMO_TAIL, partKind } from './demo';
import { spanOf } from '../model/timeline';
import { crowdAt, loudness } from '../audio/crowd';
import { CATALOG } from '../timeline/catalog';
import { buskingPage } from './busking';
import { serializeShow } from '../model/format';
import { modeOf, typeMap } from '../model/library';
import { EFFECT_MAP } from '../engine/effects';
import { compile } from '../engine/formula';
import { DEMO_SECONDS, DEMO_SONG, sectionStarts } from '../timeline/beat';

describe('the big demo', () => {
  const s = buildDemo();
  it('has a couple of hundred lights of every kind, each where it fits in its universe', () => {
    expect(s.fixtures.length).toBeGreaterThanOrEqual(200);
    const types = typeMap(s), used = new Map<string, string>();
    for (const f of s.fixtures) {
      const n = modeOf(types.get(f.typeId), f.mode)!.channels.length;
      expect(f.address + n - 1, f.name).toBeLessThanOrEqual(512);
      for (let c = 0; c < n; c++) { const k = `${f.universe}.${f.address + c}`; expect(used.get(k), `${f.name} on ${k}`).toBeUndefined(); used.set(k, f.name); }
    }
    for (const t of ['gen-wash', 'gen-mover16', 'gen-spotgobo', 'gen-strip60', 'gen-confetti', 'gen-flame', 'gen-sparks', 'gen-co2', 'gen-bubbles', 'gen-hazer', 'gen-blinder2', 'gen-strobe'])
      expect(s.fixtures.some((f) => f.typeId === t), t).toBe(true);
  });
  it('over a hundred moving heads, more than all its other lights, in fewer than 40 universes, each where it fits in 3D', () => {
    expect(s.fixtures.length).toBeGreaterThanOrEqual(200);
    const types = typeMap(s), heads = s.fixtures.filter((f) => modeOf(types.get(f.typeId), f.mode)!.channels.some((c) => c.attr === 'pan'));
    const machines = s.fixtures.filter((f) => /confetti|flame|sparks|co2|bubbles|hazer|fog/.test(f.typeId));
    expect(heads.length).toBeGreaterThanOrEqual(100);
    expect(heads.length).toBeGreaterThan(s.fixtures.length - machines.length - heads.length);
    expect(new Set(s.fixtures.map((f) => f.universe)).size).toBeLessThan(40);
    expect(new Set(s.fixtures.map((f) => f.name)).size, 'names are unique').toBe(s.fixtures.length);
    for (const f of s.fixtures) if (f.p3) {
      expect(Math.abs(f.p3.x), f.name).toBeLessThan(10); expect(Math.abs(f.p3.z), f.name).toBeLessThan(7);
      expect(f.p3.y, f.name).toBeGreaterThanOrEqual(0); expect(f.p3.y, f.name).toBeLessThan(10);
      for (const v of [f.rot!.yaw, f.rot!.pitch, f.rot!.roll]) expect(Number.isFinite(v), f.name).toBe(true);
    }
  });
  it('every pixel show plays in it (the wall, the deck edge, the LED bars), and a formula that works', () => {
    const shows = ['theater', 'fire2012', 'twinkle', 'juggle', 'sinelon', 'pride', 'bouncing', 'ripple', 'fireworks', 'matrix', 'aurora',
      'plasma', 'glitter', 'heartbeat', 'scanner', 'meteorRain', 'rain', 'popcorn', 'gradientChase', 'formula', 'picture'];
    for (const e of s.effects) expect(EFFECT_MAP.has(e.kind), `${e.name}: ${e.kind}`).toBe(true);
    // played: in a look that's on the timeline, or as a bar of its own
    const L = s.cueLists[0], tl = s.timeline!.items;
    const onTimeline = new Set(tl.flatMap((i) => (i.do.do === 'goto' && i.do.list === L.id ? [i.do.cue] : [])));
    const played = new Set([...L.cues.filter((c) => onTimeline.has(c.id)).flatMap((c) => c.effects ?? []), ...tl.flatMap((i) => (i.do.do === 'effect' ? [i.do.effect] : []))]);
    for (const kind of shows) expect(s.effects.some((e) => e.kind === kind && played.has(e.id)), kind).toBe(true);
    for (const e of s.effects.filter((x) => x.kind === 'formula')) expect(() => compile(String(e.params.formula))).not.toThrow();
  });
  it('the live page has a button for each effect machine', () => {
    const w = buskingPage(s).widgets.filter((x) => x.id.startsWith('sfx-'));
    expect(w.map((x) => s.cueLists.find((l) => x.type === 'list' && l.id === x.list)?.name)).toEqual(['Confetti', 'CO2', 'Sparks', 'Flames', 'Bubbles']);
  });
  it('a ten-minute timeline on the demo beat, everything on it real, every section cued', () => {
    const tl = s.timeline!;
    expect(tl.demo).toBe(true);
    expect(tl.duration).toBeCloseTo(DEMO_SECONDS, 3);
    const sp = spanOf(tl);
    for (const i of tl.items) {
      expect(i.at).toBeGreaterThanOrEqual(sp.from); expect(i.at).toBeLessThanOrEqual(sp.to);
      const a = i.do;
      if (a.do === 'goto') expect(s.cueLists.find((l) => l.id === a.list)?.cues.some((c) => c.id === a.cue)).toBe(true);
      if (a.do === 'effect') expect(s.effects.some((e) => e.id === a.effect)).toBe(true);
    }
    for (const sec of sectionStarts()) expect(tl.items.some((i) => i.do.do === 'goto' && i.at >= sec.at && i.at < sec.end), sec.name).toBe(true);
    expect(tl.items.filter((i) => i.do.do === 'burst' && i.do.attr === 'confetti').length).toBeGreaterThanOrEqual(3);
  });
  it('validates against the published schema', () => {
    const schema = JSON.parse(fs.readFileSync('schema/luxdmx-show.schema.json', 'utf8'));
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    const ok = validate(JSON.parse(serializeShow(JSON.parse(JSON.stringify(s)))));
    expect(ok ? [] : validate.errors!.map((e) => `${e.instancePath} ${e.message}`)).toEqual([]);
  });
});

// The demo on a real song: its parts on the ruler, a look in every one, the big moments on the
// choruses, the haze off and the stage dark as the song ends. For every song in the catalog (any of
// them can be picked for it).
describe('the big demo on a song', () => {
  const song = CATALOG.find((x) => x.id === DEMO_SONG)!;
  const s = buildDemo(song), tl = s.timeline!;
  const at = (attr: string) => tl.items.filter((i) => i.do.do === 'burst' && i.do.attr === attr).map((i) => i.at);
  it('plays the song, not the demo beat: its tempo, first downbeat, length and parts', () => {
    expect(tl.demo).toBeUndefined();
    expect(tl.duration).toBe(song.duration);
    expect(tl.bpm).toBe(song.bpm); expect(tl.offset).toBe(song.offset);
    expect(tl.sections!.map((x) => x.name)).toEqual(song.sections.map((x) => x.name));
  });
  it('the demo song is hard rock, where it hits measured', () => {
    expect(song.genre).toBe('hardrock');
    expect(song.hits!.filter((h) => h.kind === 'slam').length).toBeGreaterThanOrEqual(5);
    expect(song.hits!.filter((h) => h.kind === 'stop').length).toBeGreaterThanOrEqual(2);
  });
  const show = s.cueLists.find((l) => l.name === 'Show')!, moves = s.cueLists.find((l) => l.name === 'Moves')!;
  const beat = 60 / song.bpm, bar = 4 * beat;
  const gotos = (l: { id: string }) => tl.items.filter((i) => i.do.do === 'goto' && i.do.list === l.id);
  const cueName = (i: (typeof tl.items)[number]) => [...show.cues, ...moves.cues].find((c) => c.id === (i.do as { cue: string }).cue)!.name;
  it('every slam changes the look at once, fires the blinders and CO2, and the heads snap on every beat of its first bar', () => {
    for (const h of song.hits!.filter((x) => x.kind === 'slam')) {
      expect(gotos(show).some((i) => Math.abs(i.at - h.at) < 2e-3), `look at ${h.at}`).toBe(true);
      expect(at('blinder').some((t) => Math.abs(t - h.at) < 2e-3), `blinder at ${h.at}`).toBe(true);
      expect(at('co2').some((t) => Math.abs(t - h.at) < 2e-3), `co2 at ${h.at}`).toBe(true);
      const snaps = gotos(moves).filter((i) => i.at > h.at - 2e-3 && i.at < h.at + bar - 2e-3);
      expect(snaps.length, `snaps after ${h.at}`).toBe(4);
      // (and the heads flash with it)
      expect(tl.items.some((i) => i.do.do === 'effect' && Math.abs(i.at - h.at) < 2e-3 && s.effects.find((e) => e.id === (i.do as { effect: string }).effect)!.name === 'Beams on the beat')).toBe(true);
    }
  });
  it('a stop goes dark but for spots on the band, then flashes in eighths into the slam', () => {
    for (const h of song.hits!.filter((x) => x.kind === 'stop')) {
      const on = gotos(show).filter((i) => i.at > h.at - 2e-3 && i.at < h.at + bar - 2e-3).map(cueName);
      expect(on).toEqual(['Stop: on the band', 'Riser: eighths']);
      expect(gotos(moves).filter((i) => Math.abs(i.at - h.at) < 2e-3).map(cueName)).toEqual(['Band']);
    }
  });
  it('the heads move on the beat: every two beats through a chorus, every snap on the song\'s beat grid', () => {
    // (in the song: before and after it there's no beat to be on)
    for (const i of gotos(moves)) {
      const b = (i.at - song.offset) / beat;
      if (i.at > 0.01 && i.at < song.duration) expect(Math.abs(b - Math.round(b)), `move at ${i.at}`).toBeLessThan(0.01);
    }
    for (const c of song.sections.filter((x) => partKind(x.name, x.energy) === 'chorus')) {
      const snaps = gotos(moves).filter((i) => i.at > c.at + bar && i.at < c.at + 4 * bar - 1e-3);
      expect(snaps.length, c.name).toBeGreaterThanOrEqual(5);
    }
  });
  it('a new look at least every four bars where the music is busy', () => {
    const parts = song.sections.map((x, i, a) => ({ ...x, end: i + 1 < a.length ? a[i + 1].at : song.duration }));
    for (const p of parts.filter((x) => ['chorus', 'inst', 'solo', 'verse'].includes(partKind(x.name, x.energy)))) {
      const t = [p.at, ...gotos(show).filter((i) => i.at > p.at + 1e-3 && i.at < p.end - 1e-3).map((i) => i.at), p.end];
      for (let k = 1; k < t.length; k++) expect(t[k] - t[k - 1], `${p.name} at ${t[k - 1]}`).toBeLessThan(5 * bar + 1e-3);
    }
  });
  it("the deck edge and the LED bars go with the stage: their shows in the look's own colours, a rainbow only in the rainbow looks", () => {
    const edge = new Set(s.groups.filter((x) => x.name === 'Deck edge' || x.name === 'LED bars').map((x) => x.id));
    for (const c of show.cues) for (const id of c.effects ?? []) {
      const fx = s.effects.find((x) => x.id === id)!;
      if (!edge.has(fx.group!) || ['picture', 'heartbeat'].includes(fx.kind) || /colour waves|everything/i.test(c.name)) continue;
      expect(Array.isArray(fx.params.colors), `${c.name}: ${fx.name}`).toBe(true);
      expect((fx.params.colors as unknown[]).length, `${c.name}: ${fx.name}`).toBeLessThanOrEqual(3);
    }
  });
  it('the flame columns fire in short shots', () => {
    const shots = tl.items.filter((i) => i.do.do === 'burst' && i.do.attr === 'flame');
    expect(shots.length).toBeGreaterThan(10);
    for (const i of shots) expect((i.do as { seconds: number }).seconds).toBeLessThanOrEqual(0.4);
    expect(s.cueLists.find((l) => l.name === 'Flames')!.cues[0].advance).toEqual({ mode: 'wait', time: 0.4 });
  });
  it('the moves list sits over the looks and only points the heads: pan and tilt for every head, in every shape', () => {
    expect(moves.priority).toBe('high');
    const types = typeMap(s), heads = s.fixtures.filter((f) => modeOf(types.get(f.typeId), f.mode)!.channels.some((c) => c.attr === 'pan'));
    for (const c of moves.cues) {
      expect(Object.keys(c.values).sort(), c.name).toEqual(heads.map((f) => f.id).sort());
      for (const v of Object.values(c.values)) expect(Object.keys(v).sort()).toEqual(['pan', 'tilt']);
    }
    for (const c of show.cues) for (const v of Object.values(c.values)) { expect(v.pan).toBeUndefined(); expect(v.tilt).toBeUndefined(); }
  });
  it('flames and CO2 on every chorus, confetti on the first and the last, a blackout as it ends', () => {
    const choruses = song.sections.filter((x) => partKind(x.name, x.energy) === 'chorus');
    expect(choruses.length).toBeGreaterThan(1);
    for (const c of choruses) {
      expect(at('co2').some((t) => Math.abs(t - c.at) < 1e-6), c.name).toBe(true);
      expect(at('flame').some((t) => Math.abs(t - c.at) < 1e-6), c.name).toBe(true);
    }
    expect(at('confetti').some((t) => t === choruses[0].at)).toBe(true);
    expect(at('confetti').some((t) => t === choruses.at(-1)!.at)).toBe(true);
    const end = tl.items.filter((i) => i.do.do === 'goto' && s.cueLists.some((l) => l.cues.some((c) => c.id === (i.do as { cue: string }).cue && c.name === 'The end')));
    expect(end.length).toBe(1);
    expect(end[0].at).toBeGreaterThan(song.duration - 12); expect(end[0].at).toBeLessThan(song.duration);
    expect(tl.items.some((i) => i.do.do === 'release' && i.at > song.duration - 8)).toBe(true);
  });
  for (const x of CATALOG) it(`every part of "${x.title}" gets a look, everything on it is real and inside the song`, () => {
    const d = buildDemo(x), t = d.timeline!;
    const parts = x.sections.map((p, i, a) => ({ ...p, end: i + 1 < a.length ? a[i + 1].at : x.duration }));
    for (const p of parts) expect(t.items.some((i) => i.do.do === 'goto' && i.at >= p.at - 1e-6 && i.at < p.end), p.name).toBe(true);
    const sp = spanOf(t);
    for (const i of [...t.items, ...(t.crowd ?? [])]) {
      expect(i.at).toBeGreaterThanOrEqual(sp.from); expect(i.at + (i.len ?? 0)).toBeLessThanOrEqual(sp.to + 1e-6);
      // (the song's own things in the song; only the intro and the cheer around it)
      if ('lane' in i && i.lane === 'fx') { expect(i.at).toBeGreaterThanOrEqual(0); expect(i.at + (i.len ?? 0)).toBeLessThanOrEqual(x.duration + 1e-6); }
      const a = i.do;
      if (a.do === 'goto') expect(d.cueLists.find((l) => l.id === a.list)?.cues.some((c) => c.id === a.cue)).toBe(true);
      if (a.do === 'effect') expect(d.effects.some((e) => e.id === a.effect)).toBe(true);
    }
  });
  it('validates against the published schema', () => {
    const schema = JSON.parse(fs.readFileSync('schema/luxdmx-show.schema.json', 'utf8'));
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    const ok = validate(JSON.parse(serializeShow(JSON.parse(JSON.stringify(s)))));
    expect(ok ? [] : validate.errors!.map((e) => `${e.instancePath} ${e.message}`)).toEqual([]);
  });
  it('names its parts the way the songs do', () => {
    expect(['Intro', 'Verse 2', 'Pre-chorus', 'Chorus 3', 'Solo', 'Bridge', 'Break', 'Instrumental 2', 'Outro', 'Drop', 'Build'].map((n) => partKind(n)))
      .toEqual(['intro', 'verse', 'build', 'chorus', 'solo', 'break', 'break', 'inst', 'outro', 'chorus', 'build']);
    expect(partKind('Something', 0.95)).toBe('chorus'); expect(partKind('Something', 0.3)).toBe('break');
  });
});

// Around the song: the intro before its 0 and the cheer after its end, on the song and on the demo
// beat alike, the crowd's sound following the show.
describe('the big demo around its song', () => {
  const song = CATALOG.find((x) => x.id === DEMO_SONG)!;
  for (const [what, s] of [['on its song', buildDemo(song)], ['on the demo beat', buildDemo()]] as const) {
    const tl = s.timeline!, dur = tl.duration;
    const show = s.cueLists.find((l) => l.name === 'Show')!, moves = s.cueLists.find((l) => l.name === 'Moves')!, haze = s.cueLists.find((l) => l.name === 'Haze')!;
    const named = (l: typeof show, from: number, to: number) => tl.items.filter((i) => i.do.do === 'goto' && i.do.list === l.id && i.at >= from && i.at < to)
      .map((i) => [i.at, l.cues.find((c) => c.id === (i.do as { cue: string }).cue)!.name] as const);
    it(`${what}: half a minute before the song and a few seconds after it`, () => {
      expect(tl.lead).toBe(DEMO_LEAD); expect(tl.tail).toBe(DEMO_TAIL);
      expect(DEMO_LEAD).toBeGreaterThanOrEqual(25); expect(DEMO_LEAD).toBeLessThanOrEqual(40);
      expect(spanOf(tl)).toEqual({ from: -DEMO_LEAD, to: dur + DEMO_TAIL });
    });
    it(`${what}: the intro: house lights, dark, searchlights, the backdrop coming up, the walk-on, the band in its spots, then the song`, () => {
      expect(named(show, -DEMO_LEAD, 0).map(([, n]) => n)).toEqual(['House lights', 'House lights down', 'Searchlights', 'Reveal: the backdrop', 'Walk-on: strobes', 'Stop: on the band']);
      expect(named(show, -DEMO_LEAD, 0)[0][0]).toBe(-DEMO_LEAD);                       // (the very start)
      expect(named(show, 0, 0.001).length).toBe(1);                                    // the song's own first look on its 0
      // the backdrop comes up slowly; the house lights fade
      expect(show.cues.find((c) => c.name === 'Reveal: the backdrop')!.fade).toBeGreaterThanOrEqual(6);
      // the haze is up with the house lights, before anything else happens
      expect(named(haze, -DEMO_LEAD, 0).map(([t]) => t)).toEqual([-DEMO_LEAD]);
      // the searchlights sweep the crowd, side to side, gliding
      const sweeps = named(moves, -DEMO_LEAD, 0).filter(([, n]) => n.startsWith('Sweep'));
      expect(sweeps.length).toBeGreaterThanOrEqual(3);
      sweeps.forEach(([, n], k) => expect(n).toBe(k % 2 ? 'Sweep right, slowly' : 'Sweep left, slowly'));
      // the band walks on: strobes, and the blinders before the song
      const bl = tl.items.filter((i) => i.do.do === 'burst' && i.do.attr === 'blinder' && i.at < 0);
      expect(bl.length).toBeGreaterThanOrEqual(2);
      expect(show.cues.find((c) => c.name === 'Walk-on: strobes')!.values[s.fixtures.find((f) => f.name === 'Strobe 1')!.id].strobe).toBeGreaterThan(0);
    });
    it(`${what}: after the song the blinders on the crowd, then the house lights up; nothing past the end`, () => {
      expect(named(show, dur, dur + DEMO_TAIL + 1).map(([, n]) => n)).toEqual(['Thank you: on the crowd', 'House lights']);
      const thanks = show.cues.find((c) => c.name === 'Thank you: on the crowd')!;
      for (const f of s.fixtures.filter((x) => x.name.startsWith('Crowd blinder'))) expect(thanks.values[f.id].intensity).toBe(1);
      // (times kept to the millisecond)
      for (const i of [...tl.items, ...(tl.crowd ?? [])]) expect(i.at + (i.len ?? 0)).toBeLessThanOrEqual(dur + DEMO_TAIL + 1e-3);
    });
    it(`${what}: the crowd cheers only at the beginning: chats while it waits, cheers as the lights go down and more as the backdrop comes up, roars as the band comes on and louder still when the music starts, then dies away; after the song people talk, no cheer`, () => {
      const c = tl.crowd!, lv = (t: number) => loudness(crowdAt(c, t));
      expect(c.length).toBeGreaterThan(6);
      expect(crowdAt(c, -DEMO_LEAD + 1).chatter).toBeGreaterThan(0.4);
      expect(crowdAt(c, -DEMO_LEAD + 1).cheer).toBe(0);
      expect(lv(-DEMO_LEAD + 6)).toBeGreaterThan(lv(-DEMO_LEAD + 1));                 // the house lights go down: a cheer
      expect(crowdAt(c, -12).cheer).toBeGreaterThan(0.4);                             // the backdrop: cheering
      expect(lv(-7)).toBeGreaterThan(lv(-12));                                        // the walk-on: a roar
      expect(lv(0.6)).toBeGreaterThan(lv(-0.5));                                      // the music starts: louder
      expect(lv(0.6)).toBeGreaterThan(0.9);
      // then it dies away under the music, and nothing more: no cheer in the song or after it
      expect(lv(CROWD_GONE / 2)).toBeLessThan(lv(0.6));
      for (let t = CROWD_GONE; t < dur + DEMO_TAIL; t += 0.5) { const s = crowdAt(c, t); expect(s.cheer + s.swell, `at ${t}`).toBe(0); }
      expect(c.filter((x) => x.do.do === 'cheer' && x.at > 0)).toEqual([]);
      // the house lights up after the song: people talking again
      expect(crowdAt(c, dur + DEMO_TAIL - 0.5).chatter).toBeGreaterThan(0.2);
      for (const x of c) { expect(x.do.level).toBeGreaterThanOrEqual(0); expect(x.do.level).toBeLessThanOrEqual(1); }
    });
  }
  it('on its song: the crowd cheers only at the beginning, not on the slams and stops (the lights have those)', () => {
    const tl = buildDemo(song).timeline!, cheers = (tl.crowd ?? []).filter((x) => x.do.do === 'cheer').map((x) => x.at);
    for (const h of song.hits!.filter((x) => (x.kind === 'slam' || x.kind === 'stop') && x.at > 0)) expect(cheers.some((t) => Math.abs(t - h.at) < 2e-3), `${h.kind} at ${h.at}`).toBe(false);
    expect(loudness(crowdAt(tl.crowd, song.hits!.find((x) => x.at > 0)!.at + 0.5))).toBeLessThan(loudness(crowdAt(tl.crowd, 0.6)));
  });
});
