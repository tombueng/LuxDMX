// The test truss: an empty room with one straight truss (geometry.ts ROOMS.truss) holding two of
// every kind of light the app knows (spots, washes, PARs, strobes, blinders and fresnels hung under
// it, LED bars and pixel strips on its front), and two of every machine on the floor in front (fog,
// hazer, confetti, flames, sparks, CO2, bubbles). For trying lights out: a list that walks through
// each kind (named for what it tests), a chase round them all, a button per machine on the live
// page, and a little show on the demo beat that goes through the list once and then chases.
import type { Cue, CueAction, CueList, Show, Values } from '../model/types';
import type { TimelineItem } from '../model/timeline';
import { ROOMS, aimRot } from '../stage3d/geometry';
import { BAR_S, DEMO_BPM, DEMO_SECONDS } from '../timeline/beat';
import { Builder, C, gobo, on } from './templates';
import { inRoom } from './cueing';

export const TRUSS_NAME = 'Test truss';
const R = ROOMS.truss, T = R.truss[0];
// the kinds on the truss, left to right as the audience sees it, and the machines on the floor
export const TRUSS_KINDS = ['spot', 'wash', 'par', 'strobe', 'blinder', 'fresnel', 'bar', 'strip'] as const;
export const TRUSS_MACHINES = ['fog', 'hazer', 'confetti', 'flame', 'sparks', 'co2', 'bubbles'] as const;
const hung = { yaw: 0, pitch: 0, roll: 180 };

export function buildTrussTest(): Show {
  const b = new Builder(TRUSS_NAME);
  const s = b.s;
  s.settings.bpm = DEMO_BPM;
  inRoom(s, 'truss');
  // ---- two of each, all on universes 0 and 1 (one box runs it)
  const spot = b.add('gen-spotgobo', 2, 'Spot', 0.05, { universe: 0, x0: 0.04, x1: 0.13 });
  const wash = b.add('gen-wash', 2, 'Wash', 0.05, { universe: 0, x0: 0.21, x1: 0.3 });
  const par = b.add('gen-drgbwauvs', 2, 'PAR', 0.05, { universe: 0, x0: 0.38, x1: 0.47 });
  const strobe = b.add('gen-strobe', 2, 'Strobe', 0.05, { universe: 0, x0: 0.53, x1: 0.62 });
  const blinder = b.add('gen-blinder2', 2, 'Blinder', 0.05, { universe: 0, x0: 0.7, x1: 0.79 });
  const fresnel = b.add('gen-dimmer', 2, 'Fresnel', 0.05, { universe: 0, x0: 0.87, x1: 0.96 });
  const bar = b.add('gen-bar12', 2, 'LED bar', 0.2, { universe: 0, x0: 0.06, x1: 0.2 });
  const strip = b.add('gen-strip60', 2, 'Pixel strip', 0.2, { universe: 1, x0: 0.6, x1: 0.85 });
  const machine = (type: string, name: string, x0: number) => b.add(type, 2, name, 0.85, { universe: 0, x0, x1: x0 + 0.06 });
  const fog = machine('gen-fog', 'Fog', 0.02), hazer = machine('gen-hazer', 'Hazer', 0.16), confetti = machine('gen-confetti', 'Confetti', 0.3);
  const flame = machine('gen-flame', 'Flame', 0.44), sparks = machine('gen-sparks', 'Sparks', 0.58), co2 = machine('gen-co2', 'CO2', 0.72), bubbles = machine('gen-bubbles', 'Bubbles', 0.86);

  // ---- on the truss: the hung lights a metre apart under it (the fixed ones aimed at the floor in
  // front), the bars and strips on its front face tipped down a little; the machines in a row in front
  const hy = T.y - 0.35, face = T.z + 0.2, mid = T.y + 0.15;
  const hang = [spot, wash, par, strobe, blinder, fresnel].flat();
  b.place(hang, (f, i) => {
    const p = { x: -5.5 + i, y: hy, z: T.z };
    // (the moving heads hang straight, the fixed lights are aimed)
    f.p3 = p; f.rot = i < 4 ? { ...hung } : aimRot(p, { x: p.x * 0.7, y: 0, z: 4.5 });
  });
  b.place(bar, (f, i) => { f.p3 = { x: -4.6 + i * 1.3, y: mid, z: face }; f.rot = { yaw: 0, pitch: 110, roll: 0 }; });
  b.place(strip, (f, i) => { f.p3 = { x: 1.6 + i * 2.8, y: mid, z: face }; f.rot = { yaw: 0, pitch: 110, roll: 0 }; });
  const machines = [fog, hazer, confetti, flame, sparks, co2, bubbles].flat();
  b.place(machines, (f, i) => {
    f.p3 = { x: -6.5 + i, y: 0, z: 4.0 };
    // (fog and haze blow back under the truss, where the beams are; the rest point up)
    f.rot = i < 4 ? { yaw: 180, pitch: 0, roll: 0 } : { yaw: 0, pitch: 0, roll: 0 };
  });

  // ---- groups and effects
  const g = {
    spot: b.group('Spots', spot), wash: b.group('Washes', wash), par: b.group('PARs', par), strobe: b.group('Strobes', strobe),
    blinder: b.group('Blinders', blinder), fresnel: b.group('Fresnels', fresnel), bar: b.group('LED bars', bar), strip: b.group('Pixel strips', strip),
  };
  const e = {
    circle: b.effect('Spots: circles', 'circle', g.spot, { speed: 4, size: 0.3 }), spotFan: b.effect('Spots: fan', 'fan', g.spot, { size: 0.5, speed: 8 }),
    washSwing: b.effect('Washes: swing', 'swing', g.wash, { size: 0.3, speed: 8 }), washRainbow: b.effect('Washes: rainbow', 'rainbow', g.wash, { speed: 8 }),
    parFade: b.effect('PARs: colour fade', 'colorFade', g.par, { speed: 8, spread: 0.5 }), barRainbow: b.effect('LED bars: rainbow', 'rainbow', g.bar, { speed: 4 }),
    barChase: b.effect('LED bars: theater chase', 'theater', g.bar, {}), stripRainbow: b.effect('Pixel strips: rainbow', 'rainbow', g.strip, { speed: 4 }),
    stripMeteor: b.effect('Pixel strips: meteor rain', 'meteorRain', g.strip, {}), stripScanner: b.effect('Pixel strips: scanner', 'scanner', g.strip, {}),
    fresnelWave: b.effect('Fresnels: breathing', 'pulse', g.fresnel, { speed: 4 }),
  };

  // ---- the test list: a cue per thing to check, in order (every light named in every cue, so a
  // cue never keeps what the one before left on)
  const L = b.list('Test', { color: '#36d6e7' });
  const haze = b.haze(hazer);
  const m = b.machines();
  // fog has no one-shot of its own in the builder: a three second shot that ends by itself
  const fogShot = b.shot('Fog shot', fog, { fog: 1 }, 3, '3 s of fog', '#8a94a3');
  const chase = b.list('Chase', { end: 'loop', color: '#ffd23f' });
  const lights = [spot, wash, par, strobe, blinder, fresnel, bar, strip].flat();
  const dark: [string[], Values][] = [[lights, { intensity: 0 }]];
  const work: [string[], Values][] = [[fresnel, on(0.3)]];        // a little light to see the machines by
  const down = (more: Values = {}): Values => ({ pan: 0.5, tilt: 0.62, ...more });
  const fire = (...ls: (CueList | undefined)[]): CueAction[] => ls.filter((l): l is CueList => !!l).map((l) => ({ do: 'start', list: l.id }));
  const test = (name: string, parts: [string[], Values][], o: Partial<Cue> = {}) => b.cue(L, name, [...dark, ...parts], { fade: 1, ...o });
  const at: Record<string, Cue> = {};
  at.off = test('All off', [], { fade: 0 });
  at.spotWhite = test('Spots: open white', [[spot, on(1, C.white, down({ zoom: 0.2 }))]]);
  at.spotMove = test('Spots: pan and tilt', [[spot, on(1, C.white, down({ zoom: 0.1 }))]], { effects: [e.circle] });
  at.spotGobo = test('Spots: gobos and prism', [[spot, on(1, C.white, down({ zoom: 0.3, gobo: gobo('Star'), goboRotation: 0.3, prism: 1 }))]]);
  at.spotColour = test('Spots: colour', [[[spot[0]], on(1, C.red, down())], [[spot[1]], on(1, C.blue, down())]]);
  at.washColour = test('Washes: colour', [[wash, on(1, C.white, down({ zoom: 0.5 }))]], { effects: [e.washRainbow] });
  at.washZoom = test('Washes: zoom, narrow to wide', [[wash, on(1, C.cyan, down({ zoom: 1 }))]], { fade: 4 });
  at.washMove = test('Washes: pan and tilt', [[wash, on(1, C.magenta, down({ zoom: 0.3 }))]], { effects: [e.washSwing] });
  at.par = test('PARs: red and green', [[[par[0]], on(1, C.red)], [[par[1]], on(1, C.green)]]);
  at.parFade = test('PARs: colour fade', [[par, on(1)]], { effects: [e.parFade] });
  at.bar = test('LED bars: every cell', [[bar, on(1)]], { effects: [e.barRainbow] });
  at.barChase = test('LED bars: chase', [[bar, on(1, C.amber)]], { effects: [e.barChase] });
  at.strip = test('Pixel strips: rainbow', [[strip, on(1)]], { effects: [e.stripRainbow] });
  at.stripMeteor = test('Pixel strips: meteor rain', [[strip, on(1, C.ice)]], { effects: [e.stripMeteor] });
  at.strobe = test('Strobes: flash', [[strobe, on(1, undefined, { strobe: 0.6 })]], { fade: 0 });
  at.blinder = test('Blinders: full', [[blinder, on(1)]], { fade: 0 });
  at.fresnel = test('Fresnels: slow fade up', [[fresnel, on(1)]], { fade: 4 });
  at.all = test('Everything: full white', [[lights, on(1, C.white)], [spot, down({ zoom: 0.3 })], [wash, down({ zoom: 0.6 })]], { fade: 0.5 });
  at.fog = test('Fog: a 3 s shot', work, { actions: fire(fogShot) });
  at.haze = test('Hazers: haze on', work, { actions: fire(haze) });
  at.confetti = test('Confetti: one shot', work, { actions: fire(m.confetti) });
  at.flame = test('Flames: 1 s', work, { actions: fire(m.flame) });
  at.sparks = test('Sparks: 3 s', work, { actions: fire(m.sparks) });
  at.co2 = test('CO2: a 1.5 s jet', work, { actions: fire(m.co2) });
  at.bubbles = test('Bubbles: 20 s', work, { actions: fire(m.bubbles) });
  at.end = test('Done: all off', [], { fade: 2, actions: [{ do: 'release', list: haze.id }] });
  // the chase: each kind in turn, half a second each, round and round
  const kinds: [string, string[], Values][] = [['Spots', spot, on(1, C.white, down({ zoom: 0.1 }))], ['Washes', wash, on(1, C.cyan, down({ zoom: 0.5 }))], ['PARs', par, on(1, C.magenta)],
    ['LED bars', bar, on(1, C.yellow)], ['Pixel strips', strip, on(1, C.green)], ['Blinders', blinder, on(1)], ['Fresnels', fresnel, on(1)], ['Strobes', strobe, on(1, undefined, { strobe: 0.7 })]];
  for (const [name, ids, v] of kinds) b.cue(chase, `Chase: ${name}`, [...dark, [ids, v]], { fade: 0, advance: { mode: 'wait', time: 0.5 } });

  // ---- the little show on the demo beat: through the test list, four bars a cue, then the chase
  const items: TimelineItem[] = [];
  let n = 0;
  const put = (t: number, lane: string, a: TimelineItem['do']) => items.push({ id: `tt${++n}`, at: t, lane, do: a });
  const order = [at.spotWhite, at.spotMove, at.spotGobo, at.spotColour, at.washColour, at.washZoom, at.washMove, at.par, at.parFade, at.bar, at.barChase,
    at.strip, at.stripMeteor, at.strobe, at.blinder, at.fresnel, at.all, at.haze, at.fog, at.confetti, at.flame, at.sparks, at.co2, at.bubbles];
  order.forEach((c, i) => put(i * 4 * BAR_S, `list:${L.id}`, { do: 'goto', list: L.id, cue: c.id }));
  const chaseAt = order.length * 4 * BAR_S;
  put(chaseAt, `list:${L.id}`, { do: 'goto', list: L.id, cue: at.off.id });
  put(chaseAt, `list:${chase.id}`, { do: 'goto', list: chase.id, cue: chase.cues[0].id });
  put(DEMO_SECONDS - 8, `list:${chase.id}`, { do: 'release', list: chase.id });
  put(DEMO_SECONDS - 8, `list:${L.id}`, { do: 'goto', list: L.id, cue: at.end.id });
  s.timeline = { demo: true, duration: DEMO_SECONDS, bpm: DEMO_BPM, offset: 0, items };
  return b.done();
}
