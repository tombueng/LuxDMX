// The small band's demo: the festival's big stage in the hall, lit with what a band that plays
// clubs and town fests owns. Four wash heads on the front truss lighting the band, four beam heads
// standing on the deck at the back, two small heads on each side, ten wide LED columns as the
// backdrop, a row of LED PARs on the mid truss, two strobes, two blinders, a hazer and a fog
// machine. A show cued to a rock song's parts (catalog.ts), or to the demo beat.
//
// Built to be cut down (or grown): nothing in it knows how many lights there are. Every row is
// spread over its truss or its edge by count, every head aims at a point worked out from where it
// stands in its row (the left one further left), and every effect runs on a group. Every look puts
// light on the cheap layer (the PARs and the columns) and on the heads, so a band with only the
// PARs and the columns gets every look, and one with only heads too. buildBand takes the counts.
import type { Color, Cue, Fixture, Show, Values } from '../model/types';
import { D, DECK, TRUSS, W, aimAt, aimRot, defaultPlace, faceBand, worldToPlan, type V3 } from '../stage3d/geometry';
import { BAR_FACE } from '../stage3d/lightSize';
import { DEMO_BPM } from '../timeline/beat';
import { Builder, C, on, spotGobo, type Dress } from './templates';
import { cueParts, inRoom } from './cueing';
import type { DemoSong } from './demo';

export const BAND_NAME = 'Band on a small rig';
export const BAND_SONG = 'whiskey-hotel';
// how many of each: heads on the front truss, standing at the back, on the sides (half each side),
// LED columns, PARs on the mid truss
export interface BandRig { front: number; back: number; side: number; columns: number; pars: number }
export const BAND_RIG: BandRig = { front: 4, back: 4, side: 4, columns: 10, pars: 8 };
// the columns: 2.4 m tall, four times as wide as an LED bar comes (40 cm of face)
export const COLUMN = { h: 2.4, face: 4 * BAR_FACE };

// the generic heads' optics (library.ts): 540° of pan, 270° of tilt
const OPTICS = { panDeg: 540, tiltDeg: 270, panOffset: 0, tiltOffset: 0, invertPan: false, invertTilt: false };
const hung = { yaw: 0, pitch: 0, roll: 180 }, stand = { yaw: 0, pitch: 0, roll: 0 };
// i of n spread evenly from a to b (one alone in the middle)
const across = (i: number, n: number, a: number, b: number) => (n > 1 ? a + ((b - a) * i) / (n - 1) : (a + b) / 2);
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function buildBand(song?: DemoSong, rig: BandRig = BAND_RIG): Show {
  const b = new Builder(BAND_NAME);
  const s = b.s;
  s.settings.bpm = song ? Math.round(song.bpm) : DEMO_BPM;
  inRoom(s, 'hall');
  const fx = (ids: string[]) => b.fx(ids);
  // a light at p (with its plan position to match)
  const put = (f: Fixture, p: V3, rot: Fixture['rot']) => { const q = worldToPlan(p.x, p.z); f.x = q.x; f.y = q.y; f.p3 = { x: r4(p.x), y: r4(p.y), z: r4(p.z) }; f.rot = rot; };
  // hung under a truss where its plan puts it (as the 3D stage hangs it)
  const hang = (ids: string[], z: number, half: number, kind: 'mover' | 'par' | 'strobe' | 'dimmer') =>
    fx(ids).forEach((f, i, a) => { const q = worldToPlan(across(i, a.length, -half, half), z); f.x = q.x; f.y = q.y; const d = defaultPlace(f, kind); put(f, d.p, kind === 'mover' ? { ...hung } : d.rot); });
  const [FRONT, MID, BACK] = [TRUSS[2], TRUSS[1], TRUSS[0]];

  // ---- the rig, on two universes (a box with two outputs plays all of it): 0 the heads, the PARs,
  // the strobes, the blinders and the machines (205 channels); 1 the columns (360)
  const front = b.add('gen-wash', rig.front, 'Front wash', 0.88, { universe: 0 });
  const back = b.add('gen-spotgobo', rig.back, 'Back head', 0.1, { universe: 0 });
  const side = b.add('gen-mover8', rig.side, 'Side head', 0.5, { universe: 0 });
  const par = b.add('gen-drgbw', rig.pars, 'PAR', 0.5, { universe: 0 });
  const strobe = b.add('gen-strobe', 2, 'Strobe', 0.13, { universe: 0 });
  const blinder = b.add('gen-blinder2', 2, 'Blinder', 0.88, { universe: 0 });
  const hazer = b.add('gen-hazer', 1, 'Hazer', 0.05, { universe: 0 });
  const fog = b.add('gen-fog', 1, 'Fog', 0.95, { universe: 0 });
  const column = b.add('gen-bar12', rig.columns, 'Column', 0.04, { universe: 1 });

  // ---- where they are: washes along the front truss, PARs along the mid one, strobes on the back
  // one, blinders at the ends of the front truss (out past the washes, however many) looking at the
  // crowd; the beam heads in a row on the deck before the columns, the side heads on the deck's side
  // edges, the columns standing in a row along the back of the deck (stood on end, their cells to
  // the front), the hazer in a back corner, the fog machine at a front corner blowing at the band
  hang(front, FRONT.z, W / 2 - 2, 'mover');
  hang(par, MID.z, W / 2 - 1.5, 'par');
  hang(strobe, BACK.z, 2, 'strobe');
  hang(blinder, FRONT.z, W / 2 - 0.8, 'dimmer');
  for (const f of fx(blinder)) f.rot = aimRot(f.p3!, { x: f.p3!.x, y: 1.6, z: 16 });
  fx(back).forEach((f, i, a) => put(f, { x: across(i, a.length, -(W / 2 - 1.5), W / 2 - 1.5), y: DECK, z: -D / 2 + 1.1 }, { ...stand }));
  // (half on each side, front to back; one alone on the left)
  fx(side).forEach((f, i, a) => {
    const sd = i % 2 ? 1 : -1, k = Math.floor(i / 2), m = sd < 0 ? Math.ceil(a.length / 2) : Math.floor(a.length / 2);
    put(f, { x: sd * (W / 2 - 0.45), y: DECK, z: across(k, m, -2, 2) }, { ...stand });
  });
  fx(column).forEach((f, i, a) => {
    put(f, { x: across(i, a.length, -(W / 2 - 0.7), W / 2 - 0.7), y: DECK + COLUMN.h / 2, z: -D / 2 + 0.35 }, { yaw: 90, pitch: 0, roll: 90 });
    f.dims = { w: COLUMN.h, h: COLUMN.face };
  });
  for (const f of fx(hazer)) put(f, { x: -(W / 2 - 0.4), y: DECK, z: -D / 2 + 0.5 }, { yaw: 60, pitch: 0, roll: 0 });
  for (const f of fx(fog)) { const p = { x: W / 2 - 0.6, y: DECK, z: D / 2 - 0.5 }; put(f, p, { yaw: faceBand(p), pitch: 0, roll: 0 }); }

  // ---- groups and effects (only for what's there: a rig without side heads has no side group)
  const grp = (name: string, ids: string[]) => (ids.length ? b.group(name, ids) : undefined);
  const g = {
    front: grp('Front washes', front), back: grp('Back heads', back), side: grp('Side heads', side), heads: grp('Heads', [...front, ...back, ...side]),
    par: grp('PAR row', par), column: grp('LED columns', column), strobe: grp('Strobes', strobe), blinder: grp('Blinders', blinder),
  };
  const fxOn = (name: string, kind: string, group: string | undefined, params: Record<string, unknown> = {}) => (group ? b.effect(name, kind, group, params) : undefined);
  const e = {
    colRainbow: fxOn('Column rainbow', 'rainbow', g.column, { speed: 6 }), colChase: fxOn('Column chase', 'chase', g.column, { speed: 1, size: 0.3 }),
    colMeteor: fxOn('Column meteors', 'meteor', g.column, { speed: 2 }), colFire: fxOn('Column fire', 'fire', g.column, { speed: 1 }),
    colSparkle: fxOn('Column sparkle', 'sparkle', g.column, {}), colOcean: fxOn('Column ocean', 'ocean', g.column, { speed: 0.5 }),
    colTheater: fxOn('Column theater chase', 'theater', g.column, {}), colHeart: fxOn('Column heartbeat', 'heartbeat', g.column, {}),
    colGradient: fxOn('Column gradient chase', 'gradientChase', g.column, {}),
    parChase: fxOn('PAR colour chase', 'colorChase', g.par, { speed: 2 }), parPulse: fxOn('PAR pulse', 'pulse', g.par, {}), parFade: fxOn('PAR colour fade', 'colorFade', g.par, { speed: 16, spread: 0.5 }),
    backFan: fxOn('Back head fan', 'fan', g.back, { size: 0.5, speed: 8 }), backCircle: fxOn('Back head circles', 'circle', g.back, { speed: 4, size: 0.2 }),
    backBally: fxOn('Back head ballyhoo', 'ballyhoo', g.back, { speed: 2 }), frontSwing: fxOn('Front wash swing', 'swing', g.front, { size: 0.15, speed: 8 }),
    sideFig8: fxOn('Side head figure eight', 'figure8', g.side, { speed: 6, size: 0.2 }), strobeHits: fxOn('Strobe hits', 'strobe', g.strobe, { speed: 0.5 }),
  };

  // ---- aiming by where a head stands in its row: u from -1 (the left end) to 1 (the right end), 0
  // alone; a side head's side (-1 left, 1 right)
  const rowU = (ids: string[]) => {
    const xs = fx(ids).map((f) => f.p3!.x), lo = Math.min(...xs), hi = Math.max(...xs), mid = (lo + hi) / 2, half = (hi - lo) / 2;
    return (f: Fixture) => (half > 1e-6 ? (f.p3!.x - mid) / half : 0);
  };
  const uOf = { front: rowU(front), back: rowU(back) };
  type Aim = (u: number, sd: number) => V3;
  const aim = (ids: string[], at: Aim, more: Values = {}, u = rowU(ids)): [string[], Values][] => fx(ids).map((f) => {
    const a = aimAt(f.p3!, f.rot!, at(u(f), Math.sign(f.p3!.x) || 1), OPTICS) ?? { pan: 0.5, tilt: 0.5 };
    return [[f.id], { pan: r4(a.pan), tilt: r4(a.tilt), ...more }];
  });
  // the shapes, each a point for a head by its place in its row
  const AIM = {
    // the front washes: on the band, on the deck before it, out over the crowd
    band: ((u) => ({ x: u * 4, y: DECK + 1.2, z: -1.2 })) as Aim, deck: ((u) => ({ x: u * 3, y: DECK, z: 1 })) as Aim, crowd: ((u) => ({ x: u * 7, y: 1.2, z: 12 })) as Aim,
    // the back heads: a fan high over the crowd, crossing in a V, straight up, all to one point
    fan: ((u) => ({ x: u * 12, y: 10, z: 8 })) as Aim, cross: ((u) => ({ x: -u * 6, y: 7, z: 12 })) as Aim, up: ((u) => ({ x: u * 2, y: 15, z: 0 })) as Aim, point: (() => ({ x: 0, y: 5, z: 10 })) as Aim,
    // the side heads: across the band from their side, out over the crowd on their side, up
    across: ((_u, sd) => ({ x: -sd * 4, y: DECK + 1.5, z: -1 })) as Aim, out: ((_u, sd) => ({ x: sd * 10, y: 6, z: 12 })) as Aim, sky: ((_u, sd) => ({ x: sd * 2, y: 12, z: 1 })) as Aim,
  };
  const sideU = () => 0;
  const F = (at: Aim, lvl: number, c?: Color, more: Values = {}) => aim(front, at, on(lvl, c, more), uOf.front);
  const B = (at: Aim, lvl: number, c?: Color, d: Dress = {}) => aim(back, at, on(lvl, c, spotGobo(d)), uOf.back);
  const S = (at: Aim, lvl: number, c?: Color) => aim(side, at, on(lvl, c), sideU);
  // odd and even in two colours
  const alt = (ids: string[], a: Color, c2: Color, level = 1): [string[], Values][] => [[ids.filter((_, i) => i % 2 === 0), on(level, a)], [ids.filter((_, i) => i % 2 === 1), on(level, c2)]];

  // ---- the looks: each one the PARs and the columns (the cheap layer) and the heads over them
  const L = b.list('Show', { color: '#e8553a' });
  const haze = b.haze(hazer);
  b.machines();
  const lights = [front, back, side, par, column, strobe, blinder].flat();
  // (all dark, the beam heads open and still: each look sets what it wants, nothing carries over)
  const dark: [string[], Values][] = [[lights, { intensity: 0 }], [back, spotGobo()]];
  const looks: Record<string, string> = {};
  const look = (key: string, name: string, parts: [string[], Values][], effects: (string | undefined)[] = [], fade = 2): Cue => {
    const c = b.cue(L, name, [...dark, ...parts], { fade, effects: effects.filter((x): x is string => !!x) });
    looks[key] = c.id;
    return c;
  };
  look('intro', 'Intro: blue, the band in warm light', [[par, on(0.5, C.deepBlue)], [column, on(0.35, C.blue)], ...F(AIM.band, 0.6, C.warm, { zoom: 0.7 }),
    ...B(AIM.up, 0.5, C.blue, { gobo: 'Dots', spin: 0.2 }), ...S(AIM.sky, 0.4, C.blue)], [e.colOcean], 4);
  look('verseRed', 'Verse: red and amber', [...alt(par, C.red, C.amber, 0.8), [column, on(0.6, C.orange)], ...F(AIM.band, 0.8, C.warm, { zoom: 0.5 }),
    ...B(AIM.fan, 0.7, C.red, { gobo: 'Ring' }), ...S(AIM.across, 0.6, C.amber)], [e.colFire, e.backFan], 2);
  look('verseBlue', 'Verse: blue and teal', [...alt(par, C.blue, C.teal, 0.8), [column, on(0.7, C.cyan)], ...F(AIM.band, 0.8, C.cool, { zoom: 0.5 }),
    ...B(AIM.cross, 0.7, C.cyan, { gobo: 'Dots', spin: 0.3 }), ...S(AIM.across, 0.6, C.blue)], [e.colGradient, e.backCircle], 2);
  look('verseWarm', 'Verse: warm, slow', [[par, on(0.7, C.amber)], [column, on(0.5, C.gold)], ...F(AIM.band, 0.9, C.warm, { zoom: 0.6 }),
    ...B(AIM.up, 0.6, C.gold, { gobo: 'Flower', spin: 0.2 }), ...S(AIM.sky, 0.5, C.amber)], [e.colHeart], 2);
  look('build', 'Build: white, rising', [[par, on(0.9, C.white)], [column, on(1, C.white)], ...F(AIM.deck, 1, C.white, { zoom: 0.2 }),
    ...B(AIM.up, 1, C.white, { gobo: 'Spiral', spin: 0.9 }), ...S(AIM.sky, 1, C.white)], [e.colMeteor, e.backBally, e.parPulse], 1);
  look('chorusRed', 'Chorus: red and white', [...alt(par, C.red, C.white, 1), [column, on(1, C.red)], ...F(AIM.band, 1, C.white, { zoom: 0.4 }),
    ...B(AIM.fan, 1, C.white, { gobo: 'Star', prism: 'in' }), ...S(AIM.out, 1, C.red)], [e.colChase, e.backFan, e.parChase], 0);
  look('chorusPink', 'Chorus: magenta and cyan', [...alt(par, C.magenta, C.cyan, 1), [column, on(1)], ...F(AIM.crowd, 0.9, C.magenta, { zoom: 0.3 }),
    ...B(AIM.cross, 1, C.cyan, { gobo: 'Triangles', spin: 0.6 }), ...S(AIM.out, 1, C.magenta)], [e.colRainbow, e.backBally, e.frontSwing, e.parFade], 0);
  look('chorusGold', 'Chorus: gold', [[par, on(1, C.gold)], [column, on(1, C.amber)], ...F(AIM.band, 1, C.gold, { zoom: 0.4 }),
    ...B(AIM.point, 1, C.gold, { gobo: 'Star', spin: 0.5 }), ...S(AIM.across, 1, C.white)], [e.colTheater, e.backCircle, e.sideFig8], 0);
  look('solo', 'Solo: beams and strobes', [[par, on(0.4, C.purple)], [column, on(0.8, C.white)], ...F(AIM.band, 0.7, C.lavender, { zoom: 0.2 }),
    ...B(AIM.point, 1, C.white, { gobo: 'Bars', prism: 'in', prismSpin: 0.5 }), ...S(AIM.across, 1, C.purple), [strobe, on(0.8)]], [e.colSparkle, e.backBally, e.strobeHits, e.sideFig8], 0.5);
  look('break', 'Break: deep blue', [[par, on(0.4, C.deepBlue)], [column, on(0.3, C.blue)], ...F(AIM.band, 0.4, C.ice, { zoom: 0.8 }),
    ...B(AIM.up, 0.4, C.deepBlue, { gobo: 'Ring', spin: 0.1 }), ...S(AIM.sky, 0.3, C.deepBlue)], [e.colOcean], 3);
  look('inst', 'Instrumental: colour chase', [[par, on(1)], [column, on(1)], ...F(AIM.band, 0.9, C.white, { zoom: 0.4 }),
    ...B(AIM.fan, 1, C.green, { gobo: 'Dots', spin: 0.6 }), ...S(AIM.out, 0.8, C.yellow)], [e.parChase, e.colGradient, e.backFan], 0.5);
  look('final', 'Last chorus: everything', [...alt(par, C.red, C.gold, 1), [column, on(1)], ...F(AIM.crowd, 1, C.white, { zoom: 0.3 }),
    ...B(AIM.fan, 1, C.white, { gobo: 'Star', prism: 'in', prismSpin: 0.6 }), ...S(AIM.out, 1, C.gold), [blinder, on(0.15)]], [e.colRainbow, e.backBally, e.frontSwing, e.parPulse, e.sideFig8], 0);
  look('outro', 'Outro: warm', [[par, on(0.5, C.amber)], [column, on(0.4, C.orange)], ...F(AIM.band, 0.6, C.warm, { zoom: 0.8 }),
    ...B(AIM.up, 0.4, C.amber, { gobo: 'Flower', spin: 0.1 }), ...S(AIM.sky, 0.3, C.amber)], [e.colHeart], 5);
  look('end', 'The end', [], [], 6);

  s.timeline = cueParts(song, {
    list: L.id, looks, end: 'end', crowd: 'concert', haze: { list: haze.id, cue: haze.cues[0].id },
    sets: {
      intro: [['intro']], verse: [['verseRed', 'verseBlue'], ['verseBlue', 'verseWarm'], ['verseWarm', 'verseRed']], build: [['build']],
      chorus: [['chorusRed', 'chorusPink'], ['chorusPink', 'chorusGold'], ['chorusGold', 'chorusRed']], solo: [['solo', 'chorusGold']],
      break: [['break']], inst: [['inst', 'verseBlue'], ['inst']], outro: [['outro']],
    },
    lastChorus: ['final', 'chorusPink', 'final'],
    moments: (p, c) => {
      const { bar } = c;
      if (p.kind === 'intro') c.burst(p.at, 'fog', 5);
      // a build: the strobes for its last two bars
      if (p.kind === 'build' && p.bars >= 3) c.burst(p.end - 2 * bar, 'strobe', 2 * bar - 0.2);
      // a chorus: the blinders as it lands, the strobes on the last one
      if (p.kind === 'chorus') { c.burst(p.at, 'blinder', 0.6); if (p.lastChorus) c.burst(p.at, 'strobe', bar); }
      if (p.kind === 'break') c.burst(p.at, 'fog', 4);
      if (p.kind === 'solo' && p.bars >= 8 && e.strobeHits) c.fx(p.at + 4 * bar, e.strobeHits, 2);
    },
  });
  return b.done();
}
