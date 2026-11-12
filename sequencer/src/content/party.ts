// The party demo: no stage (geometry.ts ROOMS.party). A square of aluminium truss over the crowd on
// four legs with a span across its middle; moving heads all round it (spots on the ends, washes
// along the sides, more washes standing on the floor at the legs), pixel strips round the square
// facing in and down on the crowd, LED bars up the legs, PARs and strobes on the middle span,
// blinders over the DJ looking at the crowd, CO2 jets and confetti on the truss, bubbles, fog
// behind the DJ's table and hazers in the corners; a speaker stack in each corner of the room. A
// show cued to a house song's parts (catalog.ts).
import type { Color, Cue, Fixture, Show, Values } from '../model/types';
import { ROOMS, aimRot, type V3 } from '../stage3d/geometry';
import { DEMO_BPM } from '../timeline/beat';
import { Builder, C, gobo, on, turn, spotGobo, type Dress } from './templates';
import { cueParts, inRoom } from './cueing';
import type { DemoSong } from './demo';

export const PARTY_NAME = 'House party';
export const PARTY_SONG = 'on-my-way';
const R = ROOMS.party;
// the square: its half width, its front and back spans and the middle one (bottom chord heights)
export const SQUARE = { x: 6, z0: R.truss[0].z, zm: R.truss[1].z, z1: R.truss[2].z, y: R.truss[0].y };
const HANG = 0.35, hy = SQUARE.y - HANG, top = SQUARE.y + 0.3;
const hung = { yaw: 0, pitch: 0, roll: 180 }, stand = { yaw: 0, pitch: 0, roll: 0 };
// a bar stood upright on a leg, its cells towards the yaw `deg` (0: +z)
const upright = (deg: number) => ({ yaw: 90 + deg, pitch: 0, roll: 90 });

export function buildParty(song?: DemoSong): Show {
  const b = new Builder(PARTY_NAME);
  const s = b.s;
  s.settings.bpm = song ? Math.round(song.bpm) : DEMO_BPM;
  inRoom(s, 'party');
  const place = (ids: string[], fn: (f: Fixture, i: number, n: number) => void) => b.place(ids, fn);
  const put = (ids: string[], ps: [number, number, number][], rot: Fixture['rot'] | ((p: V3, i: number) => Fixture['rot'])) =>
    place(ids, (f, i) => { const [x, y, z] = ps[i], p = { x, y, z }; f.p3 = p; f.rot = typeof rot === 'function' ? rot(p, i) : { ...rot! }; });
  const { x: X, z0: Z0, zm: ZM, z1: Z1 } = SQUARE;
  const sides = [-4.5, -1.5, 1.5, 4.5], along = [3.9, 6.3, 8.7, 11.1];

  // ---- the rig. Universe 0: heads, PARs, strobes, blinders and the machines; 1: the LED bars on the
  // legs; 2 to 9: the strips round the square
  const spot = b.add('gen-spotgobo', 8, 'Spot', 0.05, { universe: 0, x0: 0.1, x1: 0.9 });
  const wash = b.add('gen-wash', 8, 'Side wash', 0.5, { universe: 0, x0: 0, x1: 1 });
  const floorWash = b.add('gen-wash', 4, 'Floor wash', 0.5, { universe: 0, x0: 0.02, x1: 0.98 });
  const par = b.add('gen-drgbwauvs', 6, 'Middle PAR', 0.5, { universe: 0, x0: 0.08, x1: 0.92 });
  const strobe = b.add('gen-strobe', 4, 'Strobe', 0.5, { universe: 0, x0: 0.16, x1: 0.84 });
  const blinder = b.add('gen-blinder2', 4, 'Blinder', 0.02, { universe: 0, x0: 0.25, x1: 0.75 });
  const fog = b.add('gen-fog', 2, 'Fog', 0, { universe: 0, x0: 0.4, x1: 0.6 });
  const hazer = b.add('gen-hazer', 2, 'Hazer', 1, { universe: 0, x0: 0, x1: 1 });
  const co2 = b.add('gen-co2', 4, 'CO2', 0.5, { universe: 0, x0: 0, x1: 1 });
  const confetti = b.add('gen-confetti', 2, 'Confetti', 0.02, { universe: 0, x0: 0.3, x1: 0.7 });
  const bubbles = b.add('gen-bubbles', 2, 'Bubbles', 0.98, { universe: 0, x0: 0.3, x1: 0.7 });
  const legBar = b.add('gen-bar16', 8, 'Leg bar', 0.5, { universe: 1, x0: 0, x1: 1 });
  const ring: string[] = [];
  for (let u = 0; u < 8; u++) ring.push(...b.add('gen-strip144', 1, `Ring strip ${u + 1}`, u < 2 ? 0 : u < 4 ? 1 : 0.5, { universe: 2 + u, x0: u < 4 ? 0.3 + (u % 2) * 0.4 : u < 6 ? 0 : 1, x1: u < 4 ? 0.3 + (u % 2) * 0.4 : u < 6 ? 0 : 1 }));

  // ---- where they really are: round the square, under it, on top of it, on the legs, on the floor
  // spots under the front and back spans, washes under the side spans
  put(spot, [...sides.map((x): [number, number, number] => [x, hy, Z0]), ...sides.map((x): [number, number, number] => [x, hy, Z1])], hung);
  put(wash, [...along.map((z): [number, number, number] => [-X, hy, z]), ...along.map((z): [number, number, number] => [X, hy, z])], hung);
  // washes standing on the floor inside each leg; PARs and strobes on the middle span, looking down
  const legs: [number, number][] = [[-X, Z0], [X, Z0], [-X, Z1], [X, Z1]];
  put(floorWash, legs.map(([x, z]): [number, number, number] => [x * 0.92, 0, z + (z < ZM ? 0.5 : -0.5)]), stand);
  put(par, [-5, -3, -1, 1, 3, 5].map((x): [number, number, number] => [x, hy, ZM]), (p) => aimRot(p, { x: p.x * 0.9, y: 0, z: ZM + (p.x < 0 ? -1.5 : 1.5) }));
  put(strobe, [-4, -2, 2, 4].map((x): [number, number, number] => [x, hy, ZM]), (p) => aimRot(p, { x: p.x, y: 0, z: ZM }));
  // the blinders over the DJ, looking out at the crowd
  put(blinder, [-3, -0.6, 0.6, 3].map((x): [number, number, number] => [x, hy, Z0]), (p) => aimRot(p, { x: p.x, y: 1.6, z: 10 }));
  // the machines: fog behind the DJ's table blowing past him; hazers in the far corners; CO2 jets and
  // confetti on top of the truss pointing in over the crowd, bubbles on top of the back span
  put(fog, [[-0.8, 0, -0.95], [0.8, 0, -0.95]], stand);
  put(hazer, [[-8.6, 0, 16.4], [8.6, 0, 16.4]], (p) => ({ yaw: p.x < 0 ? 135 : -135, pitch: 0, roll: 0 }));
  put(co2, [[-X, top, 4.5], [X, top, 4.5], [-X, top, 10.5], [X, top, 10.5]], (p) => ({ yaw: p.x < 0 ? 90 : -90, pitch: 30, roll: 0 }));
  put(confetti, [[-3, top, Z0], [3, top, Z0]], { yaw: 0, pitch: 30, roll: 0 });
  put(bubbles, [[-3, top, Z1], [3, top, Z1]], { yaw: 180, pitch: 0, roll: 0 });
  // LED bars up the inside of each leg (two each), facing the middle of the square
  place(legBar, (f, i) => {
    const [x, z] = legs[i >> 1], to = Math.atan2(-x, ZM - z) * 180 / Math.PI;
    f.p3 = { x: x + Math.sign(-x) * 0.2, y: 1.3 + (i % 2) * 1.2, z: z + Math.sign(ZM - z) * 0.2 }; f.rot = upright(Math.round(to));
  });
  // the strips: two along each side of the square on its inner face, tipped down onto the crowd
  place(ring, (f, i) => {
    const side = i >> 1, k = i % 2 ? 1 : -1;
    if (side < 2) { const z = side ? Z1 : Z0; f.p3 = { x: k * 2.9, y: SQUARE.y + 0.15, z: z + (side ? -0.2 : 0.2) }; f.rot = { yaw: side ? 180 : 0, pitch: 120, roll: 0 }; }
    else { const x = side === 2 ? -X : X; f.p3 = { x: x + (side === 2 ? 0.2 : -0.2), y: SQUARE.y + 0.15, z: ZM + k * 2.9 }; f.rot = { yaw: side === 2 ? 90 : -90, pitch: 120, roll: 0 }; }
  });

  // ---- groups and effects
  const g = {
    spot: b.group('Spots', spot), wash: b.group('Side washes', wash), floorWash: b.group('Floor washes', floorWash), par: b.group('Middle PARs', par),
    strobe: b.group('Strobes', strobe), blinder: b.group('Blinders', blinder), legBar: b.group('Leg bars', legBar), ring: b.group('Ring strips', ring),
  };
  const e = {
    ringRainbow: b.effect('Ring rainbow', 'rainbow', g.ring, { speed: 8 }), ringChase: b.effect('Ring chase', 'chase', g.ring, { speed: 1, size: 0.3 }),
    ringPride: b.effect('Ring colour waves', 'pride', g.ring, {}), ringTwinkle: b.effect('Ring twinkles', 'twinkle', g.ring, {}), ringMeteor: b.effect('Ring meteor rain', 'meteorRain', g.ring, {}),
    ringJuggle: b.effect('Ring juggle', 'juggle', g.ring, {}), ringPlasma: b.effect('Ring plasma', 'plasma', g.ring, {}), ringFireworks: b.effect('Ring fireworks', 'fireworks', g.ring, {}),
    ringGlitter: b.effect('Ring glitter', 'glitter', g.ring, {}), ringRipple: b.effect('Ring ripples', 'ripple', g.ring, {}), ringScanner: b.effect('Ring scanner', 'scanner', g.ring, {}),
    ringPopcorn: b.effect('Ring popcorn', 'popcorn', g.ring, {}), ringGradient: b.effect('Ring gradient chase', 'gradientChase', g.ring, {}), ringAurora: b.effect('Ring aurora', 'aurora', g.ring, {}),
    legTheater: b.effect('Leg bar theater chase', 'theater', g.legBar, {}), legHeart: b.effect('Leg bar heartbeat', 'heartbeat', g.legBar, {}), legSinelon: b.effect('Leg bar sinelon', 'sinelon', g.legBar, {}),
    circle: b.effect('Spot circles', 'circle', g.spot, { speed: 4, size: 0.3 }), bally: b.effect('Spot ballyhoo', 'ballyhoo', g.spot, { speed: 2 }), fan: b.effect('Spot fan', 'fan', g.spot, { size: 0.5, speed: 8 }),
    fig8: b.effect('Spot figure eight', 'figure8', g.spot, { speed: 6, size: 0.25 }), washSwing: b.effect('Wash swing', 'swing', g.wash, { size: 0.25, speed: 8 }),
    washCircle: b.effect('Wash circles', 'circle', g.wash, { speed: 8, size: 0.2 }), washColours: b.effect('Wash colours', 'random', g.wash, { speed: 2 }),
    floorTilt: b.effect('Floor wash tilt', 'tilt', g.floorWash, { speed: 2 }), parPulse: b.effect('PAR pulse', 'pulse', g.par, {}), parChase: b.effect('PAR colour chase', 'colorChase', g.par, { speed: 2 }),
    parFade: b.effect('PAR colour fade', 'colorFade', g.par, { speed: 16, spread: 0.5 }), strobeHits: b.effect('Strobe hits', 'strobe', g.strobe, { speed: 0.5 }),
  };

  // ---- the looks
  const L = b.list('Party', { color: '#ff7a3d' });
  const haze = b.haze(hazer);
  b.machines();
  const lights = [spot, wash, floorWash, par, strobe, blinder, legBar, ring].flat();
  // (the gobo spots open, no prism, still: each look dresses them itself, nothing carries over)
  const dark: [string[], Values][] = [[lights, { intensity: 0 }], [spot, spotGobo()]];
  const sg = (d: Dress): [string[], Values] => [spot, spotGobo(d)];
  // each look's gobos, thrown on the dancers from the square of truss
  const dress: Record<string, [string[], Values][]> = {
    intro: [sg({ gobo: 'Flower', spin: 0.2 })], sunset: [sg({ gobo: 'Ring' })], teal: [sg({ gobo: 'Dots', spin: 0.3 })], juggle: [sg({ gobo: 'Star', spin: 0.4 })],
    build: [sg({ gobo: 'Spiral', spin: 0.9 })], drop: [sg({ gobo: 'Triangles', spin: 0.6, prism: 'in' })], dropGold: [sg({ gobo: 'Star', spin: 0.5 })],
    dropWaves: [sg({ gobo: 'Bars', spin: 0.3 })], fireworks: [sg({ gobo: 'Star', prism: 'in' })], popcorn: [sg({ gobo: 'Dots', spin: 0.6 })],
    bubbles: [sg({ gobo: 'Ring', spin: 0.2 })], ripple: [sg({ gobo: 'Spiral', spin: 0.2 })], final: [sg({ gobo: 'Flower', spin: 0.6, prism: 'in' })], outro: [sg({ gobo: 'Ring', spin: 0.1 })],
  };
  const alt = (ids: string[], a: Color, c2: Color, level = 1, more: Values = {}): [string[], Values][] => [[ids.filter((_, i) => i % 2 === 0), on(level, a, more)], [ids.filter((_, i) => i % 2 === 1), on(level, c2, more)]];
  const look = (name: string, parts: [string[], Values][], effects: string[] = [], fade = 2): Cue => b.cue(L, name, [...dark, ...parts], { fade, effects });
  // hung heads tilted a little out over the crowd; the floor washes up into the truss
  const out = (tilt: number, more: Values = {}): Values => ({ pan: 0.5, tilt, ...more });
  const looks: Record<string, string> = {};
  // (a look's gobos on top of its colours: dress[key])
  const mk = (key: string, c: Cue) => { looks[key] = c.id; for (const [ids, v] of dress[key] ?? []) for (const id of ids) c.values[id] = { ...c.values[id], ...v }; };
  mk('intro', look('Intro: warm welcome', [[wash, on(0.5, C.amber, out(0.5, { zoom: 0.9 }))], [ring, on(0.5)], [legBar, on(0.4, C.amber)], [par, on(0.3, C.warm)]], [e.ringAurora, e.legSinelon], 4));
  mk('sunset', look('Groove: sunset', [...alt(wash, C.orange, C.pink, 0.8, out(0.55, { zoom: 0.6 })), [spot, on(0.8, C.amber, out(0.6, { zoom: 0.15, gobo: gobo('Dots') }))], [ring, on(0.9, C.orange)],
    [legBar, on(0.7, C.pink)], [par, on(0.6, C.amber)], [floorWash, on(0.6, C.orange, out(0.5, { zoom: 0.5 }))]], [e.ringGradient, e.circle, e.washSwing, e.legTheater]));
  mk('teal', look('Groove: teal and pink', [...alt(wash, C.teal, C.pink, 0.8, out(0.55, { zoom: 0.5 })), [spot, on(1, C.white, out(0.62, { zoom: 0.05 }))], [ring, on(1)], [legBar, on(0.8, C.teal)],
    [par, on(0.6, C.pink)]], [e.ringPlasma, e.fan, e.parFade, e.legSinelon]));
  mk('juggle', look('Groove: juggling colours', [...alt(wash, C.purple, C.cyan, 0.8, out(0.55)), [ring, on(1)], [legBar, on(0.8)], [spot, on(0.8, C.lavender, out(0.62, { zoom: 0.1, gobo: gobo('Flower'), goboRotation: turn('gen-spotgobo', 0.4) }))]],
    [e.ringJuggle, e.fig8, e.washCircle, e.legTheater], 1));
  mk('build', look('Build: rising', [[wash, on(0.8, C.white, out(0.55, { zoom: 0.2 }))], [spot, on(1, C.white, out(0.62, { zoom: 0.05 }))], [ring, on(1, C.white)], [legBar, on(1, C.white)],
    [floorWash, on(1, C.white, out(0.5, { zoom: 0.1 }))]], [e.ringMeteor, e.bally, e.floorTilt, e.ringScanner], 1));
  mk('drop', look('Drop: full colour', [...alt(wash, C.magenta, C.purple, 1, out(0.6, { zoom: 0.3 })), [spot, on(1, C.white, out(0.65, { zoom: 0.05 }))], [ring, on(1)], [legBar, on(1)], [par, on(1, C.magenta)],
    ...alt(floorWash, C.cyan, C.purple, 1, out(0.45, { zoom: 0.2 }))], [e.ringRainbow, e.bally, e.washSwing, e.parPulse, e.washColours, e.floorTilt, e.legTheater], 0));
  mk('dropGold', look('Drop: gold and white', [...alt(wash, C.gold, C.white, 1, out(0.6, { zoom: 0.3 })), [spot, on(1, C.gold, out(0.65, { zoom: 0.03, prism: 1 }))], [ring, on(1, C.gold)], [legBar, on(1, C.white)],
    [par, on(1, C.amber)], [floorWash, on(1, C.white, out(0.45, { zoom: 0.1 }))]], [e.ringChase, e.fan, e.washCircle, e.parChase], 0));
  mk('dropWaves', look('Drop: colour waves', [[wash, on(0.9, undefined, out(0.6, { zoom: 0.4 }))], [ring, on(1)], [legBar, on(1)], [par, on(0.9)], [spot, on(1, C.yellow, out(0.62, { zoom: 0.05 }))]],
    [e.ringPride, e.washColours, e.parChase, e.circle, e.legSinelon], 0.5));
  mk('fireworks', look('Drop: fireworks', [[wash, on(0.4, C.deepBlue, out(0.55))], [spot, on(1, C.white, out(0.68, { zoom: 0.03 }))], [ring, on(1)], [floorWash, on(1, C.white, out(0.5, { zoom: 0 }))]],
    [e.ringFireworks, e.bally, e.floorTilt], 0));
  mk('popcorn', look('Drop: popcorn', [...alt(wash, C.magenta, C.yellow, 1, out(0.6)), [ring, on(1)], [legBar, on(1, C.magenta)], [par, on(1, C.yellow)]], [e.ringPopcorn, e.washSwing, e.parPulse], 0));
  mk('bubbles', look('Break: bubbles', [[wash, on(0.5, C.ice, out(0.5, { zoom: 0.9 }))], [ring, on(0.7)], [legBar, on(0.4, C.cyan)], [spot, on(0.6, C.lavender, out(0.6, { zoom: 0.1, gobo: gobo('Star'), goboRotation: turn('gen-spotgobo', 0.4) }))]],
    [e.ringTwinkle, e.legHeart, e.fig8], 4));
  mk('ripple', look('Break: ripples', [[wash, on(0.5, C.cyan, out(0.5, { zoom: 0.9 }))], [ring, on(1)], [legBar, on(0.5, C.blue)]], [e.ringRipple, e.legHeart], 3));
  mk('strobe', look('Strobe hits', [[wash, on(0.6, C.white, out(0.6))], [ring, on(0.5, C.white)], [strobe, on(1)], [spot, on(1, C.white, out(0.65, { zoom: 0 }))]], [e.strobeHits, e.bally], 0));
  mk('final', look('Final drop: everything', [...alt(wash, C.green, C.cyan, 1, out(0.6, { zoom: 0.3 })), [spot, on(1, C.white, out(0.66, { zoom: 0.04 }))], ...alt(floorWash, C.yellow, C.magenta, 1, out(0.45)),
    [ring, on(1)], [legBar, on(1)], [par, on(1, C.green)], [blinder, on(0.15)]], [e.ringRainbow, e.ringGlitter, e.bally, e.washSwing, e.floorTilt, e.parPulse, e.washColours, e.legTheater], 0));
  mk('outro', look('Outro: last song', [[wash, on(0.4, C.amber, out(0.5, { zoom: 0.9 }))], [ring, on(0.5, C.orange)], [legBar, on(0.3, C.amber)]], [e.ringTwinkle], 5));
  mk('end', look('The end', [], [], 6));

  s.timeline = cueParts(song, {
    list: L.id, looks, end: 'end', haze: { list: haze.id, cue: haze.cues[0].id },
    sets: {
      intro: [['intro']], verse: [['sunset', 'teal'], ['juggle', 'sunset'], ['teal', 'juggle']], build: [['build']],
      chorus: [['drop', 'dropGold'], ['dropWaves', 'popcorn', 'drop'], ['fireworks', 'dropGold', 'dropWaves']], solo: [['strobe', 'fireworks']],
      break: [['bubbles', 'ripple'], ['ripple', 'bubbles']], inst: [['teal', 'dropGold'], ['popcorn', 'juggle']], outro: [['outro']],
    },
    lastChorus: ['final', 'fireworks', 'strobe', 'dropGold', 'final'],
    moments: (p, c) => {
      const { bar } = c;
      if (p.kind === 'intro') c.burst(p.at, 'fog', 6);
      if (p.kind === 'build') {
        c.fx(p.at, e.ringScanner, Math.max(1, p.bars - 2));
        if (p.bars >= 3) c.burst(p.end - 2 * bar, 'strobe', 2 * bar - 0.2);
        c.burst(p.end - 0.5, 'co2', 0.5);
      }
      // a drop: CO2 and the blinders as it lands, CO2 again every 8 bars, confetti on the first and the last
      if (p.kind === 'chorus') {
        c.burst(p.at, 'co2', 1.5); c.burst(p.at, 'blinder', 0.6);
        if (p.n === 0 || p.lastChorus) c.burst(p.at, 'confetti', 1);
        for (let k = 8; k < p.bars; k += 8) c.burst(p.at + k * bar, 'co2', 1);
      }
      // a break: bubbles over the crowd and fog from behind the DJ
      if (p.kind === 'break') { c.burst(p.at, 'fog', 6); if (p.bars > 2) c.burst(p.at + bar, 'bubbles', Math.min(30, (p.bars - 2) * bar)); }
      if (p.kind === 'verse' && p.bars >= 16) c.fx(p.at + 8 * bar, e.legTheater, Math.min(16, p.bars - 8));
    },
  });
  return b.done();
}
