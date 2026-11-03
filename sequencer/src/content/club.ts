// The club demo: a DJ on a stage in a club (geometry.ts ROOMS.club). Twenty moving heads (spots on
// the back truss and on the deck behind the booth, washes on the front truss and at the deck's
// front), LEDs all round the stage (a wall of pixel strips behind the DJ, strips up the truss
// towers and along the front truss, LED bars on the deck, in front of the booth and in the pit, a
// pixel line along the deck's front edge), PARs, strobes and blinders, two fog machines behind the
// booth blowing past the DJ, hazers, CO2 jets, cold sparks and confetti. A show cued to a techno
// song's parts (catalog.ts): the drops get CO2, a strobe hit and the blinders, the breaks get fog.
import type { Color, Cue, Fixture, Show, Values } from '../model/types';
import { DECK, DJ_BOOTH, ROOMS, aimAt, aimRot, type V3 } from '../stage3d/geometry';
import { Builder, C, gobo, on } from './templates';
import { DEMO_BPM } from '../timeline/beat';
import { cueParts, inRoom } from './cueing';
import type { DemoSong } from './demo';

export const CLUB_NAME = 'Club night: the DJ';
export const CLUB_SONG = 'in-peace';
const R = ROOMS.club;
// where the DJ stands (on the deck, behind the booth)
const DJ_AT = DJ_BOOTH.club!.dj;
// the trusses: the bottom chord heights and where they are (back, front over the stage, the floor's)
const [BACK, FRONT, FLOOR] = R.truss, HANG = 0.35;
const OPTICS = { panDeg: 540, tiltDeg: 270, panOffset: 0, tiltOffset: 0, invertPan: false, invertTilt: false };
const hung = { yaw: 0, pitch: 0, roll: 180 }, stand = { yaw: 0, pitch: 0, roll: 0 };
// a strip stood upright, its cells towards the audience; one lying along x, its cells to the front
const upright = { yaw: 90, pitch: 0, roll: 90 }, facing = { yaw: 0, pitch: 90, roll: 0 };

export function buildClub(song?: DemoSong): Show {
  const b = new Builder(CLUB_NAME);
  const s = b.s;
  s.settings.bpm = song ? Math.round(song.bpm) : DEMO_BPM;
  inRoom(s, 'club');
  const place = (ids: string[], fn: (f: Fixture, i: number, n: number) => void) => b.place(ids, fn);
  const at = (ids: string[], xs: number[], y: number, z: number, rot: Fixture['rot'] | ((p: V3) => Fixture['rot'])) =>
    place(ids, (f, i) => { const p = { x: xs[i], y, z }; f.p3 = p; f.rot = typeof rot === 'function' ? rot(p) : { ...rot! }; });
  const even = (n: number, a: number, z: number) => Array.from({ length: n }, (_, i) => (n > 1 ? a + ((z - a) * i) / (n - 1) : (a + z) / 2));

  // ---- the rig, universe by universe (each fits in its 512)
  // universe 0: the heads, strobes, blinders, PARs and the machines
  const spot = b.add('gen-spotgobo', 6, 'Spot', 0.08, { universe: 0, x0: 0.1, x1: 0.9 });
  const strobe = b.add('gen-strobe', 4, 'Strobe', 0.08, { universe: 0, x0: 0.2, x1: 0.8 });
  const wash = b.add('gen-wash', 6, 'Wash', 0.92, { universe: 0, x0: 0.1, x1: 0.9 });
  const blinder = b.add('gen-blinder2', 4, 'Blinder', 0.92, { universe: 0, x0: 0.2, x1: 0.8 });
  const deckSpot = b.add('gen-spotgobo', 4, 'Deck spot', 0.3, { universe: 0, x0: 0.06, x1: 0.94 });
  const deckWash = b.add('gen-wash', 4, 'Deck wash', 0.99, { universe: 0, x0: 0.02, x1: 0.98 });
  const par = b.add('gen-drgbwauvs', 6, 'Floor PAR', 1, { universe: 0, x0: 0.05, x1: 0.95 });
  const fog = b.add('gen-fog', 2, 'Fog', 0.28, { universe: 0, x0: 0.44, x1: 0.56 });
  const hazer = b.add('gen-hazer', 2, 'Hazer', 0.05, { universe: 0, x0: 0.04, x1: 0.96 });
  const co2 = b.add('gen-co2', 4, 'CO2', 0.97, { universe: 0, x0: 0.06, x1: 0.94 });
  const sparks = b.add('gen-sparks', 2, 'Sparks', 0.98, { universe: 0, x0: 0.4, x1: 0.6 });
  const confetti = b.add('gen-confetti', 2, 'Confetti', 0.78, { universe: 0, x0: 0.03, x1: 0.97 });
  // universe 1: the LED bars (in front of the booth, on the deck before the pixel wall, in the pit)
  const boothBar = b.add('gen-bar16', 2, 'Booth bar', 0.66, { universe: 1, x0: 0.44, x1: 0.56 });
  const deckBar = b.add('gen-bar8', 8, 'Deck bar', 0.12, { universe: 1, x0: 0.06, x1: 0.94 });
  const pitBar = b.add('gen-bar12', 6, 'Pit bar', 1, { universe: 1, x0: 0.1, x1: 0.9 });
  // the pixel wall behind the DJ: sixteen strips standing on the deck, two to a universe (2 to 9)
  const wall: string[] = [];
  for (let u = 0; u < 8; u++) wall.push(...b.add('gen-strip60', 2, 'Wall strip', 0.02, { universe: 2 + u, x0: 0.04 + u * 0.12, x1: 0.1 + u * 0.12, from: u * 2 + 1 }));
  // the pixel line along the deck's front edge (10 to 12), up the four truss towers (13 to 16), along the front truss (17, 18)
  const edge: string[] = [];
  for (let u = 0; u < 3; u++) edge.push(...b.add('gen-strip60', 2, 'Edge', 1, { universe: 10 + u, x0: 0.08 + u * 0.3, x1: 0.22 + u * 0.3, from: u * 2 + 1 }));
  const portal: string[] = [];
  for (let u = 0; u < 4; u++) portal.push(...b.add('gen-strip144', 1, `Tower strip ${u + 1}`, u < 2 ? 0.1 : 0.9, { universe: 13 + u, x0: u % 2 ? 1 : 0, x1: u % 2 ? 1 : 0 }));
  const header: string[] = [];
  for (let u = 0; u < 2; u++) header.push(...b.add('gen-strip170', 1, `Header ${u + 1}`, 0.92, { universe: 17 + u, x0: u ? 0.75 : 0.25, x1: u ? 0.75 : 0.25 }));

  // ---- where they really are: hung under the trusses, standing on the deck, on the truss towers
  const hy = (t: { y: number }) => t.y - HANG;
  at(spot, even(6, -5, 5), hy(BACK), BACK.z, hung);
  at(strobe, [-4, -2, 2, 4], hy(BACK), BACK.z, (p) => aimRot(p, { x: p.x * 0.6, y: 1.6, z: 12 }));
  at(wash, even(6, -5, 5), hy(FRONT), FRONT.z, hung);
  at(blinder, [-4, -2, 2, 4], hy(FRONT), FRONT.z, (p) => aimRot(p, { x: p.x * 0.8, y: 1.6, z: 13 }));
  at(par, even(6, -6, 6), hy(FLOOR), FLOOR.z, (p) => aimRot(p, { x: p.x * 0.8, y: 0, z: FLOOR.z + 1.2 }));
  at(deckSpot, [-4.4, -2.2, 2.2, 4.4], DECK, -0.6, stand);
  at(deckWash, [-5.6, -3.3, 3.3, 5.6], DECK, 4.1, stand);
  // the fog machines on the deck behind the DJ, blowing forward past him; hazers in the back corners
  at(fog, [-0.6, 0.6], DECK, 0.15, stand);
  at(hazer, [-5.6, 5.6], DECK, -1.25, (p) => ({ yaw: p.x < 0 ? 90 : -90, pitch: 0, roll: 0 }));
  at(co2, [-4.45, -2.2, 2.2, 4.45], DECK, 4.1, stand);
  at(sparks, [-1.0, 1.0], DECK, 4.2, stand);
  at(confetti, [-5.6, 5.6], DECK, 3.0, { yaw: 0, pitch: 20, roll: 0 });
  // LED bars: leaning back against the booth's front; leaning out towards the audience on the deck
  // and in the pit
  at(boothBar, [-0.55, 0.55], DECK + 0.05, 2.12, { yaw: 0, pitch: 75, roll: 0 });
  at(deckBar, even(8, -5.25, 5.25), DECK + 0.05, -1.0, { yaw: 0, pitch: 50, roll: 0 });
  at(pitBar, even(6, -5, 5), 0.05, R.deck.z1 + 0.4, { yaw: 0, pitch: 60, roll: 0 });
  // strips: the wall standing on the deck (its middle 1 m up), the edge on the deck's front face, the
  // towers' strips on their front faces from 1 m up, the header on the front truss's front face
  at(wall, even(16, -5.4, 5.4), DECK + 1.05, -1.35, upright);
  at(edge, even(6, -5, 5), DECK - 0.12, R.deck.z1 + 0.03, facing);
  place(portal, (f, i) => { f.p3 = { x: i % 2 ? 6.6 : -6.6, y: 1.0 + 2.4, z: (i < 2 ? BACK.z : FRONT.z) + 0.2 }; f.rot = { ...upright }; });
  at(header, [-2.9, 2.9], FRONT.y + 0.15, FRONT.z + 0.2, facing);

  // ---- groups and effects
  const g = {
    spot: b.group('Spots', spot), wash: b.group('Washes', wash), deckSpot: b.group('Deck spots', deckSpot), deckWash: b.group('Deck washes', deckWash),
    strobe: b.group('Strobes', strobe), blinder: b.group('Blinders', blinder), par: b.group('Floor PARs', par), wall: b.group('Pixel wall', wall),
    edge: b.group('Deck edge', edge), portal: b.group('Tower strips', portal), header: b.group('Header', header), boothBar: b.group('Booth bars', boothBar),
    deckBar: b.group('Deck bars', deckBar), pitBar: b.group('Pit bars', pitBar),
  };
  const e = {
    aurora: b.effect('Wall aurora', 'aurora', g.wall, {}), plasma: b.effect('Wall plasma', 'plasma', g.wall, {}), matrix: b.effect('Wall matrix', 'matrix', g.wall, {}),
    meteors: b.effect('Wall meteor rain', 'meteorRain', g.wall, {}), rain: b.effect('Wall rain', 'rain', g.wall, {}), fireworks: b.effect('Wall fireworks', 'fireworks', g.wall, {}),
    pride: b.effect('Wall colour waves', 'pride', g.wall, {}), glitter: b.effect('Wall glitter', 'glitter', g.wall, {}), popcorn: b.effect('Wall popcorn', 'popcorn', g.wall, {}),
    twinkle: b.effect('Wall twinkles', 'twinkle', g.wall, {}), ripple: b.effect('Wall ripples', 'ripple', g.wall, {}), bouncing: b.effect('Wall bouncing balls', 'bouncing', g.wall, {}),
    flames: b.effect('Wall flames', 'fire2012', g.wall, {}), rainbow: b.effect('Wall rainbow', 'rainbow', g.wall, { speed: 6 }), lightning: b.effect('Wall lightning', 'lightning1d', g.wall, {}),
    scanner: b.effect('Edge scanner', 'scanner', g.edge, {}), sinelon: b.effect('Edge sinelon', 'sinelon', g.edge, {}), gradient: b.effect('Edge gradient chase', 'gradientChase', g.edge, {}),
    juggle: b.effect('Edge juggle', 'juggle', g.edge, {}), portalChase: b.effect('Tower chase', 'meteor', g.portal, { speed: 2 }), headerChase: b.effect('Header chase', 'gradientChase', g.header, {}),
    theater: b.effect('Deck bar theater chase', 'theater', g.deckBar, {}), heartbeat: b.effect('Booth heartbeat', 'heartbeat', g.boothBar, {}), pitWave: b.effect('Pit bar wave', 'wave', g.pitBar, {}),
    circle: b.effect('Spot circles', 'circle', g.spot, { speed: 4, size: 0.3 }), fan: b.effect('Spot fan', 'fan', g.spot, { size: 0.5, speed: 8 }), bally: b.effect('Spot ballyhoo', 'ballyhoo', g.spot, { speed: 2 }),
    fig8: b.effect('Spot figure eight', 'figure8', g.spot, { speed: 6, size: 0.25 }), deckFan: b.effect('Deck spot fan', 'fan', g.deckSpot, { size: 0.5, speed: 8 }),
    deckBally: b.effect('Deck spot ballyhoo', 'ballyhoo', g.deckSpot, { speed: 4 }), deckCross: b.effect('Deck spot cross', 'cross', g.deckSpot, { speed: 4 }),
    swing: b.effect('Wash swing', 'swing', g.wash, { size: 0.25, speed: 8 }), washColours: b.effect('Wash colours', 'random', g.wash, { speed: 2 }), deckSwing: b.effect('Deck wash swing', 'swing', g.deckWash, { speed: 4 }),
    pulse: b.effect('PAR pulse', 'pulse', g.par, {}), parChase: b.effect('PAR colour chase', 'colorChase', g.par, { speed: 2 }), strobeHits: b.effect('Strobe hits', 'strobe', g.strobe, { speed: 0.5 }),
  };

  // ---- the looks
  const L = b.list('Club', { color: '#7a5cff' });
  const haze = b.haze(hazer);
  b.machines();
  const lights = [spot, wash, deckSpot, deckWash, strobe, blinder, par, wall, edge, portal, header, boothBar, deckBar, pitBar].flat();
  const dark: [string[], Values][] = [[lights, { intensity: 0 }]];
  const alt = (ids: string[], a: Color, c2: Color, level = 1, more: Values = {}): [string[], Values][] => [[ids.filter((_, i) => i % 2 === 0), on(level, a, more)], [ids.filter((_, i) => i % 2 === 1), on(level, c2, more)]];
  const look = (name: string, parts: [string[], Values][], effects: string[] = [], fade = 2): Cue => b.cue(L, name, [...dark, ...parts], { fade, effects });
  // heads over the crowd (hung: tilted out towards the dance floor), beams from the deck (up and out)
  const out = (tilt: number, more: Values = {}): Values => ({ pan: 0.5, tilt, ...more });
  // the washes nearest the booth on the DJ (the pan and tilt that point them at him)
  const onDj = (id: string) => { const f = b.fx([id])[0]; return aimAt(f.p3!, f.rot!, { x: DJ_AT.x, y: DECK + 1.5, z: DJ_AT.z }, OPTICS) ?? { pan: 0.5, tilt: 0.5 }; };
  const djWash: [string[], Values][] = [wash[2], wash[3]].map((id) => [[id], on(0.9, C.lavender, { ...onDj(id), zoom: 0.25 })]);
  const looks: Record<string, string> = {};
  const mk = (key: string, c: Cue) => { looks[key] = c.id; };
  mk('intro', look('Intro: blue night', [[wash, on(0.35, C.deepBlue, out(0.55, { zoom: 0.8 }))], [wall, on(0.6)], [portal, on(0.5, C.deepBlue)], [header, on(0.4, C.deepBlue)],
    [boothBar, on(0.5, C.blue)], [deckSpot, on(0.9, C.white, out(0.5, { zoom: 0 }))], ...djWash], [e.aurora, e.sinelon], 4));
  mk('pulse', look('Groove: purple pulse', [...alt(wash, C.purple, C.magenta, 0.8, out(0.62, { zoom: 0.5 })), [spot, on(0.8, C.purple, out(0.66, { zoom: 0.1, gobo: gobo('Dots') }))], [wall, on(0.9)],
    [par, on(0.6, C.purple)], [edge, on(0.8, C.magenta)], [deckBar, on(0.7, C.magenta)], [portal, on(0.6, C.purple)], [boothBar, on(0.6, C.purple)]], [e.plasma, e.pulse, e.scanner, e.theater, e.fig8]));
  mk('cyan', look('Groove: cyan sweep', [...alt(wash, C.cyan, C.blue, 0.8, out(0.6, { zoom: 0.4 })), [spot, on(1, C.white, out(0.68, { zoom: 0.05 }))], [deckSpot, on(1, C.cyan, out(0.58, { zoom: 0 }))],
    [wall, on(1, C.cyan)], [portal, on(0.8, C.cyan)], [header, on(0.8, C.cyan)], [pitBar, on(0.8, C.cyan)], [edge, on(0.8)]], [e.matrix, e.fan, e.deckFan, e.portalChase, e.juggle, e.pitWave]));
  mk('red', look('Techno: red beams', [[wash, on(0.6, C.red, out(0.6, { zoom: 0.3 }))], [spot, on(1, C.red, out(0.7, { zoom: 0, prism: 1 }))], [deckSpot, on(1, C.red, out(0.6, { zoom: 0 }))],
    [wall, on(1, C.red)], [edge, on(1, C.red)], [deckBar, on(0.8, C.red)], [header, on(0.7, C.red)]], [e.meteors, e.deckCross, e.circle, e.gradient], 1));
  mk('bounce', look('Groove: bouncing', [...alt(wash, C.yellow, C.cyan, 0.8, out(0.6, { zoom: 0.5 })), [wall, on(1)], [deckWash, on(0.8, C.yellow, out(0.62, { zoom: 0.4 }))], [par, on(0.6, C.cyan)],
    [deckBar, on(0.8)], [edge, on(1)]], [e.bouncing, e.deckSwing, e.theater, e.sinelon], 1));
  mk('juggle', look('Groove: juggling', [...alt(wash, C.purple, C.cyan, 0.8, out(0.6)), [wall, on(0.8)], [edge, on(1)], [spot, on(0.8, C.lavender, out(0.66, { zoom: 0.1, gobo: gobo('Ring') }))]],
    [e.ripple, e.juggle, e.circle, e.headerChase], 1));
  mk('build', look('Build: rising', [[wash, on(0.7, C.cool, out(0.62, { zoom: 0.2 }))], [spot, on(1, C.white, out(0.7, { zoom: 0.05 }))], [deckSpot, on(1, C.white, out(0.55, { zoom: 0 }))],
    [wall, on(1, C.white)], [portal, on(1, C.white)], [header, on(1, C.white)], [deckBar, on(0.8, C.white)], [edge, on(1, C.white)], [pitBar, on(0.8, C.white)]], [e.meteors, e.bally, e.deckBally, e.scanner, e.portalChase], 1));
  mk('drop', look('Drop: full colour', [...alt(wash, C.magenta, C.purple, 1, out(0.65, { zoom: 0.3 })), [spot, on(1, C.white, out(0.7, { zoom: 0.05 }))], [deckSpot, on(1, C.magenta, out(0.6, { zoom: 0 }))],
    ...alt(deckWash, C.purple, C.cyan, 1, out(0.65, { zoom: 0.3 })), [wall, on(1)], [par, on(1, C.magenta)], [portal, on(1)], [header, on(1)], [edge, on(1)], [deckBar, on(1)], [pitBar, on(1, C.purple)], [boothBar, on(1, C.magenta)]],
  [e.rainbow, e.bally, e.deckFan, e.swing, e.pulse, e.washColours, e.gradient, e.headerChase], 0));
  mk('dropRW', look('Drop: red and white', [...alt(wash, C.red, C.white, 1, out(0.65, { zoom: 0.3 })), [spot, on(1, C.red, out(0.72, { zoom: 0.05 }))], ...alt(deckSpot, C.white, C.red, 1, out(0.6, { zoom: 0 })),
    [wall, on(1, C.red)], [portal, on(1, C.white)], [header, on(1, C.red)], [edge, on(1, C.white)], [deckBar, on(1, C.red)], [pitBar, on(1, C.white)], [par, on(1, C.red)]], [e.meteors, e.fan, e.deckCross, e.scanner, e.portalChase], 0));
  mk('dropUV', look('Drop: UV and white beams', [[wash, on(0.8, C.deepBlue, out(0.62, { zoom: 0.6 }))], [spot, on(1, C.white, out(0.7, { zoom: 0, prism: 1 }))], [deckSpot, on(1, C.white, out(0.58, { zoom: 0 }))],
    [wall, on(1)], [par, on(0.8, C.purple)], [portal, on(0.8, C.purple)], [edge, on(1, C.lavender)]], [e.glitter, e.fig8, e.deckBally, e.sinelon], 0));
  mk('fireworks', look('Drop: fireworks', [[wash, on(0.4, C.deepBlue, out(0.6))], [spot, on(1, C.white, out(0.75, { zoom: 0.03 }))], [deckSpot, on(1, C.white, out(0.6, { zoom: 0 }))], [wall, on(1)],
    [deckWash, on(1, C.white, out(0.65))], [header, on(1, C.white)], [edge, on(1)]], [e.fireworks, e.bally, e.deckBally, e.juggle], 0));
  mk('pride', look('Drop: colour waves', [[wash, on(0.9, undefined, out(0.64, { zoom: 0.4 }))], [wall, on(1)], [par, on(0.9)], [portal, on(1)], [header, on(1)], [edge, on(1)], [deckBar, on(1)], [pitBar, on(1)],
    [deckSpot, on(1, C.yellow, out(0.6, { zoom: 0 }))]], [e.pride, e.washColours, e.parChase, e.deckFan, e.theater, e.gradient], 0.5));
  mk('popcorn', look('Drop: popcorn', [...alt(wash, C.magenta, C.yellow, 1, out(0.65)), [wall, on(1)], [deckSpot, on(1, C.yellow, out(0.6, { zoom: 0 }))], [edge, on(1)], [deckBar, on(1, C.magenta)]],
    [e.popcorn, e.deckBally, e.swing, e.sinelon], 0));
  mk('break', look('Break: the DJ alone', [[wall, on(0.45)], [boothBar, on(0.6, C.purple)], [spot, on(0.5, C.lavender, out(0.6, { zoom: 0.1, gobo: gobo('Star'), goboRotation: 0.2 }))], ...djWash],
    [e.twinkle, e.heartbeat], 4));
  mk('rain', look('Break: rain', [[wash, on(0.4, C.blue, out(0.55, { zoom: 0.8 }))], [wall, on(1)], [edge, on(0.6, C.ice)], [deckSpot, on(0.7, C.ice, out(0.52, { zoom: 0 }))], ...djWash], [e.rain, e.sinelon], 3));
  mk('ripple', look('Break: ripples', [[wash, on(0.5, C.cyan, out(0.55, { zoom: 0.9 }))], [wall, on(1)], [edge, on(0.6, C.cyan)], ...djWash], [e.ripple, e.lightning], 3));
  mk('strobe', look('Strobe hits', [[wash, on(0.6, C.white, out(0.65))], [wall, on(0.5, C.white)], [strobe, on(1)], [edge, on(1, C.white)], [spot, on(1, C.white, out(0.7, { zoom: 0 }))]], [e.strobeHits, e.bally], 0));
  mk('final', look('Final drop: everything', [...alt(wash, C.green, C.cyan, 1, out(0.66, { zoom: 0.3 })), [spot, on(1, C.white, out(0.72, { zoom: 0.04 }))], ...alt(deckSpot, C.yellow, C.magenta, 1, out(0.6, { zoom: 0 })),
    ...alt(deckWash, C.magenta, C.yellow, 1, out(0.65)), [wall, on(1)], [par, on(1, C.green)], [portal, on(1)], [header, on(1)], [edge, on(1)], [deckBar, on(1)], [pitBar, on(1)], [boothBar, on(1)]],
  [e.rainbow, e.bally, e.deckBally, e.swing, e.deckSwing, e.pulse, e.washColours, e.theater, e.gradient, e.portalChase, e.headerChase, e.pitWave], 0));
  mk('outro', look('Outro: embers', [[wash, on(0.35, C.red, out(0.55, { zoom: 0.8 }))], [wall, on(0.6)], [edge, on(0.4, C.red)], [boothBar, on(0.4, C.red)], ...djWash.map(([ids, v]): [string[], Values] => [ids, { ...v, intensity: 0.5, color: C.orange }])],
    [e.flames], 5));
  mk('end', look('The end', [], [], 6));

  // ---- the show on the song (or on the demo beat)
  s.timeline = cueParts(song, {
    list: L.id, looks, end: 'end', haze: { list: haze.id, cue: haze.cues[0].id },
    sets: {
      intro: [['intro']], verse: [['pulse', 'cyan'], ['red', 'bounce'], ['juggle', 'pulse']], build: [['build']],
      chorus: [['drop', 'dropRW'], ['dropUV', 'fireworks', 'pride'], ['popcorn', 'drop', 'dropRW']], solo: [['strobe', 'fireworks']],
      break: [['break', 'rain'], ['ripple', 'break']], inst: [['red', 'cyan'], ['bounce', 'red']], outro: [['outro']],
    },
    lastChorus: ['final', 'fireworks', 'strobe', 'dropRW', 'final'],
    moments: (p, c) => {
      const { bar } = c;
      if (p.kind === 'intro') c.burst(p.at, 'fog', 6);
      // a build: the edge scans faster and faster, the strobes on its last two bars, CO2 into the drop
      if (p.kind === 'build') {
        c.fx(p.at, e.scanner, Math.max(1, p.bars - 2));
        if (p.bars >= 3) c.burst(p.end - 2 * bar, 'strobe', 2 * bar - 0.2);
        c.burst(p.end - 0.5, 'co2', 0.5);
      }
      // a drop: CO2, a strobe hit and the blinders as it lands; CO2 and sparks every 8 bars; confetti
      // on the first and the last
      if (p.kind === 'chorus') {
        c.burst(p.at, 'co2', 1.5); c.burst(p.at, 'blinder', 0.6); c.burst(p.at, 'strobe', bar / 2);
        if (p.n === 0 || p.lastChorus) c.burst(p.at, 'confetti', 1);
        for (let k = 8; k < p.bars; k += 8) { c.burst(p.at + k * bar, 'co2', 1); c.burst(p.at + k * bar, 'sparks', 2.5); }
        if (p.lastChorus && p.bars >= 16) c.burst(p.at + 8 * bar, 'confetti', 1);
      }
      if (p.kind === 'solo' || p.kind === 'inst') for (let k = 4; k < p.bars; k += 8) c.burst(p.at + k * bar, 'sparks', 2.5);
      // a break: fog rolls past the DJ (and again half way through a long one)
      if (p.kind === 'break') { c.burst(p.at, 'fog', 8); if (p.bars >= 16) c.burst(p.at + Math.floor(p.bars / 2) * bar, 'fog', 5); }
      if (p.kind === 'verse' && p.bars >= 16) c.fx(p.at + 8 * bar, e.theater, Math.min(16, p.bars - 8));
    },
  });
  return b.done();
}
