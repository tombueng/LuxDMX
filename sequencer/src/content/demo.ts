// The big demo: a festival stage in a hall, built round its moving heads. Over a hundred of them:
// washes and beam heads taking turns along the back truss, twenty spots on the mid truss, washes on
// the front one, a row of beams standing on the deck, heads on the side towers and in the pit, spots
// on the side trusses, washes at the deck's front edge. With strobes and blinders, a wall of pixel
// strips, a pixel line along the deck edge, LED bars and every effect machine; and a show on the
// timeline cued to a real song (its parts, and where it hits hardest, measured in catalog.ts) or to
// the demo beat (ten minutes made here: grooves, builds, drops).
//
// Two lists play it. The looks: colour, level and the effects, a new one every four bars where the
// music is busy and at once where it slams back in. And the moves: where the heads point, a pair of
// shapes taking turns on the beat (every two beats in a chorus, every bar in a verse, every beat in
// the bar after a slam), rising through a build, on the band and dark when the band stops dead.
// Every pixel show plays somewhere in it (most on the wall), and the live page has a button for each
// machine.
//
// Around the song, half a minute of show before it (the house lights, then dark and the crowd
// cheering, searchlights over the crowd, the backdrop coming up as the cheering grows, strobes and
// the blinders as the band walks on) and a few seconds after it (the blinders on the crowd, the
// house lights up). The crowd's sound is on its own track: it cheers only at the beginning, the
// loudest as the music starts, and has died away by CROWD_GONE seconds into the song.
import type { Color, Cue, Fixture, Values } from '../model/types';
import type { BurstAttr, CrowdAction, CrowdItem, TimelineAction, TimelineItem } from '../model/timeline';
import type { CatalogHit, CatalogSong } from '../timeline/catalog';
import { DEMO_BPM, DEMO_SECONDS, sectionStarts } from '../timeline/beat';
import { DECK, D, TRUSS, W, aimAt, defaultPlace, faceBand, worldToPlan, type V3 } from '../stage3d/geometry';
import { Builder, C, gobo, on, turn, profile, spotGobo, type Dress } from './templates';

export const DEMO_NAME = 'We Are Not The Band: live';
// seconds of show before the song starts and after it ends
export const DEMO_LEAD = 32, DEMO_TAIL = 14;
// the crowd cheers only at the beginning: by this far into the song it has died away (seconds)
export const CROWD_GONE = 12;

// the song the demo plays (its parts, tempo and length, where it hits; the file comes down separately)
export type DemoSong = Pick<CatalogSong, 'id' | 'bpm' | 'offset' | 'duration' | 'sections' | 'hits'>;

// the generic heads' optics (library.ts): 540° of pan, 270° of tilt
const OPTICS = { panDeg: 540, tiltDeg: 270, panOffset: 0, tiltOffset: 0, invertPan: false, invertTilt: false };
const stand = { yaw: 0, pitch: 0, roll: 0 };
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function buildDemo(song?: DemoSong) {
  const b = new Builder(DEMO_NAME);
  const s = b.s;
  s.settings.bpm = song ? Math.round(song.bpm) : DEMO_BPM;
  const place = (ids: string[], fn: (f: Fixture, i: number, n: number) => void) => b.place(ids, fn);
  const spread = (i: number, n: number, width: number) => (n > 1 ? i / (n - 1) - 0.5 : 0) * width;
  const onPlan = (f: Fixture) => { const q = worldToPlan(f.p3!.x, f.p3!.z); f.x = q.x; f.y = q.y; };

  // ---- the rig, by truss and by universe (each its own, so nothing runs past 512)
  // the back truss: washes and beam heads taking turns along it, strobes in between
  const backWash = b.add('gen-wash', 8, 'Back wash', 0.13, { universe: 0, x0: 0.05, x1: 0.89 });
  const backBeam = b.add('gen-spotgobo', 8, 'Back beam', 0.13, { universe: 0, x0: 0.11, x1: 0.95 });
  const backStrobe = b.add('gen-strobe', 8, 'Back strobe', 0.13, { universe: 0, x0: 0.1, x1: 0.9 });
  // the mid truss: twenty profile spots (two gobo wheels, prisms, an animation wheel)
  const spot = b.add('gen-profile', 20, 'Spot', 0.5, { universe: 1, x0: 0.04, x1: 0.96 });
  // the front truss: washes, blinders, strobes
  const frontWash = b.add('gen-wash', 16, 'Front wash', 0.88, { universe: 2, x0: 0.04, x1: 0.96 });
  const blinder = b.add('gen-blinder2', 12, 'Blinder', 0.88, { universe: 2, x0: 0.06, x1: 0.94 });
  const strobe = b.add('gen-strobe', 8, 'Strobe', 0.88, { universe: 2, x0: 0.1, x1: 0.9 });
  // the pixel wall: twenty strips, two to a universe (3 to 12)
  const strip: string[] = [];
  for (let u = 0; u < 10; u++) strip.push(...b.add('gen-strip60', 2, `Strip ${u * 2 + 1}`, 0.04, { universe: 3 + u, x0: 0.05 + u * 0.095, x1: 0.09 + u * 0.095 }));
  const ledBar = b.add('gen-bar12', 10, 'LED bar', 0.3, { universe: 13, x0: 0.1, x1: 0.9 });
  // the heads in the pit and the beams standing on the deck
  const floorHead = b.add('gen-mover8', 20, 'Floor head', 0.98, { universe: 14, x0: 0.02, x1: 0.98 });
  const beam = b.add('gen-spotgobo', 16, 'Beam', 0.08, { universe: 14, x0: 0.04, x1: 0.96 });
  // the towers and the side trusses
  const towerHead = b.add('gen-spotgobo', 12, 'Tower head', 0.5, { universe: 15 });
  const crowdBlinder = b.add('gen-blinder2', 8, 'Crowd blinder', 0.9, { universe: 15 });
  const sideSpot = b.add('gen-profile', 8, 'Side spot', 0.5, { universe: 15, x0: 0.01, x1: 0.99 });
  const towerStrobe = b.add('gen-strobe', 8, 'Tower strobe', 0.5, { universe: 15, x0: 0.02, x1: 0.98 });
  // the machines
  const confetti = b.add('gen-confetti', 4, 'Confetti', 0.97, { universe: 16, x0: 0.15, x1: 0.85 });
  const flame = b.add('gen-flame', 6, 'Flame', 0.96, { universe: 16, x0: 0.08, x1: 0.92 });
  const sparks = b.add('gen-sparks', 6, 'Sparks', 0.94, { universe: 16, x0: 0.12, x1: 0.88 });
  const co2 = b.add('gen-co2', 4, 'CO2', 0.92, { universe: 16, x0: 0.2, x1: 0.8 });
  const bubbles = b.add('gen-bubbles', 2, 'Bubbles', 0.9, { universe: 16, x0: 0.02, x1: 0.98 });
  const haze = b.add('gen-hazer', 2, 'Hazer', 0.1, { universe: 16, x0: 0.03, x1: 0.97 });
  const fog = b.add('gen-fog', 2, 'Fog', 0.96, { universe: 16, x0: 0.3, x1: 0.7 });
  confetti.push(...b.add('gen-confetti', 2, 'Confetti', 0.97, { universe: 16, x0: 0.3, x1: 0.7, from: 5 }));
  flame.push(...b.add('gen-flame', 2, 'Flame', 0.96, { universe: 16, x0: 0.4, x1: 0.6, from: 7 }));
  sparks.push(...b.add('gen-sparks', 2, 'Sparks', 0.94, { universe: 16, x0: 0.04, x1: 0.96, from: 7 }));
  co2.push(...b.add('gen-co2', 2, 'CO2', 0.92, { universe: 16, x0: 0.05, x1: 0.95, from: 5 }));
  bubbles.push(...b.add('gen-bubbles', 2, 'Bubbles', 0.6, { universe: 16, x0: 0.01, x1: 0.99, from: 3 }));
  haze.push(...b.add('gen-hazer', 2, 'Hazer', 0.6, { universe: 16, x0: 0.02, x1: 0.98, from: 3 }));
  // washes standing at the deck's front edge (between the machines), the pixel line along it
  const deckWash = b.add('gen-wash', 6, 'Deck wash', 0.97, { universe: 17, x0: 0.12, x1: 0.88 });
  const edge: string[] = [];
  for (let k = 0; k < 7; k++) edge.push(...b.add('gen-strip60', 1, `Edge ${k + 1}`, 0.99, { universe: 18 + Math.floor(k / 2), x0: 0.08 + k * 0.14, x1: 0.08 + k * 0.14 }));

  // ---- where they really are (3D): the hung heads where the 3D stage hangs them anyway (written
  // down, so the moves can be aimed), the strips a wall of columns at the back (standing on the
  // deck), the floor heads in the pit, the tower heads clamped to the insides of the truss towers
  // (their heads towards the stage), the beams on the deck before the wall, the side spots hanging
  // from the side trusses, the crowd blinders on the towers facing the audience, the machines and
  // the deck washes along the front
  place([...backWash, ...backBeam, ...spot, ...frontWash], (f) => { const d = defaultPlace(f, 'mover'); f.p3 = d.p; f.rot = d.rot; });
  // (stood upright, their cells to the front: rolled on end, then turned a quarter so they face the
  // audience; rolled alone, they faced the side)
  place(strip, (f, i, n) => { f.p3 = { x: (i / (n - 1) - 0.5) * (W - 1), y: DECK + 1.05, z: -D / 2 + 0.35 }; f.rot = { yaw: 90, pitch: 0, roll: 90 }; });
  place(floorHead, (f, i, n) => { f.p3 = { x: spread(i, n, W + 2), y: 0, z: D / 2 + 1.0 }; f.rot = { ...stand }; });
  // (on the deck behind the band, leaning well out towards the audience: not into the roof)
  place(ledBar, (f, i, n) => { f.p3 = { x: (i / (n - 1) - 0.5) * (W - 3), y: DECK, z: -1.0 }; f.rot = { yaw: 0, pitch: 50, roll: 0 }; });
  place(beam, (f, i, n) => { f.p3 = { x: spread(i, n, W - 1.4), y: DECK, z: -D / 2 + 0.95 }; f.rot = { ...stand }; });
  place(towerHead, (f, i) => {
    const side = i % 2 ? 1 : -1, k = Math.floor(i / 2);
    f.p3 = { x: side * (W / 2 + 0.65), y: 1.5 + Math.floor(k / 3), z: TRUSS[k % 3].z };
    f.rot = { yaw: 0, pitch: 0, roll: side * 90 };
    onPlan(f);
  });
  place(towerStrobe, (f, i) => { const side = i % 2 ? 1 : -1, k = Math.floor(i / 2); f.p3 = { x: side * (W / 2 + 0.6), y: 4.8 + (k % 2) * 0.9, z: [-3.3, 3.4][k >> 1] }; f.rot = { yaw: -side * 90, pitch: 75, roll: 0 }; });
  place(sideSpot, (f, i) => { const side = i % 2 ? 1 : -1, k = Math.floor(i / 2); f.p3 = { x: side * (W / 2 + 0.9), y: TRUSS[0].y + 0.6 - 0.35, z: -2.4 + k * 1.6 }; f.rot = { yaw: 0, pitch: 0, roll: 180 }; });
  place(crowdBlinder, (f, i) => { const side = i % 2 ? 1 : -1, k = Math.floor(i / 2); f.p3 = { x: side * (W / 2 + 0.9), y: 3 + k * 1.1, z: 3.6 }; f.rot = { yaw: side * -20, pitch: 80, roll: 0 }; });
  // the pixel line on the deck's front face, shining at the audience
  place(edge, (f, i, n) => { f.p3 = { x: spread(i, n, 12), y: DECK - 0.12, z: D / 2 + 0.03 }; f.rot = { yaw: 0, pitch: 90, roll: 0 }; });
  for (const [ids, z] of [[confetti, D / 2 - 0.4], [flame, D / 2 - 0.3], [sparks, D / 2 - 0.55], [co2, D / 2 - 0.7], [fog, D / 2 - 0.2]] as const)
    place([...ids], (f, i, n) => { f.p3 = { x: (n > 1 ? i / (n - 1) - 0.5 : 0) * (W - 1.5), y: DECK, z }; f.rot = { yaw: ids === fog ? faceBand(f.p3) : 0, pitch: 0, roll: 0 }; });
  // (in the gaps between the flames, sparks, confetti and CO2)
  place(deckWash, (f, i) => { f.p3 = { x: [-5.35, -3.2, -1.85, 1.85, 3.2, 5.35][i], y: DECK, z: D / 2 - 0.25 }; f.rot = { ...stand }; onPlan(f); });
  place(bubbles, (f, i) => { const side = i % 2 ? 1 : -1; f.p3 = { x: side * (W / 2 + 0.6), y: i < 2 ? 6.5 : 5.2, z: i < 2 ? 3.4 : -0.2 }; f.rot = { yaw: 0, pitch: 0, roll: 0 }; });
  place(haze, (f, i) => { const side = i % 2 ? 1 : -1; f.p3 = { x: side * (W / 2 - 0.5), y: DECK, z: i < 2 ? -D / 2 + 1 : 0.6 }; f.rot = { yaw: side * -90, pitch: 0, roll: 0 }; });

  // ---- groups and effects
  const BEAMS = [backBeam, spot, sideSpot, towerHead, floorHead, beam], WASHES = [backWash, frontWash, deckWash];
  const air = BEAMS.flat(), wash = WASHES.flat();
  const g = {
    backWash: b.group('Back washes', backWash), backBeam: b.group('Back beams', backBeam), spot: b.group('Spots', spot), frontWash: b.group('Front washes', frontWash),
    deckWash: b.group('Deck washes', deckWash), beam: b.group('Beams', beam), floorHead: b.group('Floor heads', floorHead), towerHead: b.group('Tower heads', towerHead),
    sideSpot: b.group('Side spots', sideSpot), air: b.group('Beam heads', air), wash: b.group('Washes', wash),
    blinder: b.group('Blinders', blinder), strobe: b.group('Strobes', [...strobe, ...backStrobe, ...towerStrobe]), strip: b.group('Pixel wall', strip),
    ledBar: b.group('LED bars', ledBar), edge: b.group('Deck edge', edge),
  };
  const e = {
    // the wall's colour and level
    rainbow: b.effect('Rainbow wall', 'rainbow', g.strip, { speed: 6 }), chase: b.effect('Wall chase', 'chase', g.strip, { speed: 1, size: 0.3 }),
    meteor: b.effect('Wall meteors', 'meteor', g.strip, { speed: 2 }), sparkle: b.effect('Wall sparkle', 'sparkle', g.strip, {}),
    fire: b.effect('Wall fire', 'fire', g.strip, { speed: 1 }), ocean: b.effect('Wall ocean', 'ocean', g.strip, { speed: 0.5 }),
    // the pixel shows: the wall is the big canvas, the deck edge and the LED bars the frame
    aurora: b.effect('Aurora', 'aurora', g.strip, {}), fire2012: b.effect('Wall flames', 'fire2012', g.strip, {}),
    matrix: b.effect('Matrix rain', 'matrix', g.strip, {}), plasma: b.effect('Plasma', 'plasma', g.strip, {}),
    fireworks: b.effect('Fireworks', 'fireworks', g.strip, {}), rain: b.effect('Rain', 'rain', g.strip, {}),
    twinkle: b.effect('Twinkles', 'twinkle', g.strip, {}), bouncing: b.effect('Bouncing balls', 'bouncing', g.strip, {}),
    ripple: b.effect('Ripples', 'ripple', g.strip, {}), meteorRain: b.effect('Meteor rain', 'meteorRain', g.strip, {}),
    pride: b.effect('Colour waves', 'pride', g.strip, {}), glitter: b.effect('Rainbow glitter', 'glitter', g.strip, {}),
    heartbeat: b.effect('Heartbeat', 'heartbeat', g.ledBar, {}), popcorn: b.effect('Popcorn', 'popcorn', g.strip, {}),
    // your own formula: a rainbow running diagonally over the wall (x along the wall, u up each strip)
    formula: b.effect('Formula: diagonal rainbow', 'formula', g.strip, { formula: 'hsv(x + u * 0.5 - t * 0.25, 1, 1)' }),
    // and a picture: with none loaded it's the painted sunset over the sea, scrolling along the edge
    picture: b.effect('Picture: sunset along the edge', 'picture', g.edge, { mapping: 'line' }),
    // the heads' moves, locked to the beat (speed: beats a turn), around where the moves list points them
    beamFan: b.effect('Beam fan', 'fan', g.beam, { size: 0.16, speed: 4 }), beamBally: b.effect('Beam ballyhoo', 'ballyhoo', g.beam, { size: 0.3, speed: 8 }),
    beamCircle: b.effect('Beam circles', 'circle', g.beam, { size: 0.12, speed: 4, spread: 0.5 }), beamWave: b.effect('Beam slow wave', 'tilt', g.beam, { size: 0.12, speed: 16, spread: 1 }),
    spotCircle: b.effect('Spot circles', 'circle', g.spot, { size: 0.14, speed: 4, spread: 0.5 }), spotBally: b.effect('Spot ballyhoo', 'ballyhoo', g.spot, { size: 0.3, speed: 8 }),
    spotFig8: b.effect('Spot figure eight', 'figure8', g.spot, { size: 0.16, speed: 8 }), backSwing: b.effect('Back beam swing', 'swing', g.backBeam, { size: 0.2, speed: 4, spread: 0.5 }),
    floorWave: b.effect('Floor wave', 'tilt', g.floorHead, { size: 0.18, speed: 4, spread: 1 }), floorSwing: b.effect('Floor swing', 'swing', g.floorHead, { size: 0.22, speed: 4 }),
    towerCross: b.effect('Tower cross', 'cross', g.towerHead, { size: 0.14, speed: 4 }), sideSweep: b.effect('Side spot sweep', 'pan', g.sideSpot, { size: 0.2, speed: 8, spread: 0.5 }),
    airBally: b.effect('All beams ballyhoo', 'ballyhoo', g.air, { size: 0.25, speed: 8 }),
    // their light on the beat
    airHits: b.effect('Beams on the beat', 'strobe', g.air, { speed: 1, width: 0.3 }), air8ths: b.effect('Beams in eighths', 'strobe', g.air, { speed: 0.5, width: 0.4 }),
    floorChase: b.effect('Floor chase', 'chase', g.floorHead, { speed: 2, width: 0.15 }), beamPing: b.effect('Beam ping-pong', 'pingpong', g.beam, { speed: 4, width: 0.2 }),
    spotAlt: b.effect('Spots odd and even', 'alternate', g.spot, { speed: 2 }), towerChase: b.effect('Tower chase', 'chase', g.towerHead, { speed: 1, width: 0.25 }),
    // and their colour
    airColours: b.effect('Beam colour chase', 'colorChase', g.air, { speed: 4 }), washColours: b.effect('Wash colours', 'random', g.wash, { speed: 4 }),
    floorColours: b.effect('Floor colour chase', 'colorChase', g.floorHead, { speed: 2 }), pulse: b.effect('Back wash pulse', 'pulse', g.backWash, {}),
    lightning: b.effect('Lightning', 'lightning', g.frontWash, { size: 0.4 }), strobeHits: b.effect('Strobe hits', 'strobe', g.strobe, { speed: 0.5 }),
  };

  // the deck edge's and the LED bars' own shows in the look's colours (they go with the stage, never a
  // rainbow of their own): an effect for each show in each set of colours
  const painted = new Map<string, string>();
  const SHOW = { scanner: 'scanner', sinelon: 'sinelon', gradientChase: 'gradient chase', juggle: 'juggle', theater: 'theater chase' };
  const paint = (where: 'edge' | 'ledBar', kind: keyof typeof SHOW, ...cols: (keyof typeof C)[]) => {
    const k = `${where}:${kind}:${cols.join()}`, words = cols.map((c) => c.replace(/[A-Z]/g, (m) => ` ${m.toLowerCase()}`)).join(', ');
    if (!painted.has(k)) painted.set(k, b.effect(`${where === 'edge' ? 'Edge' : 'LED bar'} ${SHOW[kind]}: ${words}`, kind, g[where], { colors: cols.map((c) => C[c]) }));
    return painted.get(k)!;
  };
  const scanWhite = paint('edge', 'scanner', 'white', 'cool');

  // ---- the lists: the looks, the haze under them, the moves above them (so a look never moves a head)
  const L = b.list('Show', { color: '#ff3d7f' });
  const H = b.list('Haze', { color: '#8a94a3' });
  const M = b.list('Moves', { color: '#3db8ff', priority: 'high' });
  b.machines();                                     // a one-shot list per machine, for the live page

  // ---- the looks: every light dark but what the look lights, the beams narrow, the washes wide
  const all = [air, wash, blinder, strobe, backStrobe, towerStrobe, crowdBlinder, strip, ledBar, edge].flat();
  // (the gobo heads open, no prism, still: each look dresses them itself, nothing carries over)
  const PROFILES = [...spot, ...sideSpot], GOBO_SPOTS = [...backBeam, ...beam, ...towerHead];
  const dark: [string[], Values][] = [[all, { intensity: 0 }], [PROFILES, profile()], [GOBO_SPOTS, spotGobo()]];
  const pf = (ids: string[], d: Dress): [string[], Values] => [ids, profile(d)];
  const sg = (ids: string[], d: Dress): [string[], Values] => [ids, spotGobo(d)];
  // Each look's gobos, as a lighting designer dresses them: breakups and the animation wheel in the
  // riffs, leaves for a warm verse, water for a cool one, a tunnel and a line prism in a build, stars
  // through a turning prism in a drop, glass gobos in colour for the finale, space and fire
  const dress: Record<string, [string[], Values][]> = {
    intro: [sg(beam, { gobo: 'Dots', spin: 0.2 }), sg(backBeam, { gobo: 'Ring' })],
    wake: [pf(spot, { gobo: 'Ring of dots', prism: '3-facet prism', prismSpin: 0.4 }), sg(towerHead, { gobo: 'Star' })],
    riffRed: [pf(spot, { gobo: 'Breakup', anim: 0.7 }), sg(beam, { gobo: 'Bars' }), pf(sideSpot, { gobo: 'Spiral', spin: 0.6 })],
    riffIce: [pf(spot, { gobo: 'Water', anim: 0.6 }), pf(sideSpot, { gobo: 'Breakup', gobo2: 'Snowflake', spin: -0.3 }), sg(towerHead, { gobo: 'Dots' })],
    riffGold: [pf(spot, { gobo: 'Stars', gobo2: 'Fire glass', spin: 0.5 }), sg(beam, { gobo: 'Star', spin: 0.4 })],
    warm: [pf(spot, { gobo: 'Leaves', frost: 0.25 })],
    cyan: [pf(spot, { gobo: 'Water', anim: 0.8 }), pf(sideSpot, { gobo: 'Tunnel', spin: 0.3 })],
    build: [pf(spot, { gobo: 'Tunnel', spin: 0.9, prism: '5-facet linear prism', prismSpin: 0.5 }), sg(beam, { gobo: 'Spiral', spin: 0.8 })],
    lift: [sg(beam, { gobo: 'Ring' }), pf(spot, { gobo: 'Ring of dots', spin: 0.6 })],
    riser: [pf(spot, { gobo: 'Ring of dots', prism: '8-facet prism', prismSpin: 1 })],
    drop: [pf(spot, { gobo: 'Stars', prism: '3-facet prism', prismSpin: 0.7 }), sg(beam, { gobo: 'Triangles', spin: 0.6 }), pf(sideSpot, { gobo2: 'Rainbow glass', spin: 0.4 })],
    redblue: [pf(spot, { gobo: 'Spiral', spin: -0.7 }), sg(beam, { gobo: 'Bars' }), sg(towerHead, { gobo: 'Ring' })],
    white: [pf(spot, { gobo: 'Ring of dots', prism: '8-facet prism', prismSpin: 0.8 }), sg(beam, { prism: 'in' }), sg(backBeam, { prism: 'in' })],
    final: [pf(spot, { gobo2: 'Rainbow glass', spin: 0.6, prism: '3-facet prism', prismSpin: -0.5 }), sg(beam, { gobo: 'Star', spin: 0.5 }), pf(sideSpot, { gobo2: 'Galaxy glass', spin: 0.3 }),
      sg(towerHead, { gobo: 'Flower', spin: 0.4 })],
    solo: [pf(spot, { gobo: 'Tunnel', spin: 0.3, iris: 0.5 }), pf(sideSpot, { gobo: 'Flower', spin: -0.4 })],
    sunset: [[sideSpot, on(0.6, C.white, { zoom: 0.3 })], pf(sideSpot, { gobo2: 'Fire glass', spin: 0.15 })],
    space: [pf(spot, { gobo: 'Stars', gobo2: 'Galaxy glass', spin: 0.2, frost: 0.1 })],
    breakdown: [sg(beam, { gobo: 'Bars' }), sg(backBeam, { gobo: 'Ring' })],
    outro: [sg(beam, { gobo: 'Flower', spin: 0.1 })],
    aurora: [sg(beam, { gobo: 'Ring' }), [sideSpot, on(0.7, C.white, { zoom: 0.3 })], pf(sideSpot, { gobo2: 'Aurora', spin: 0.2 })],
    matrix: [pf(spot, { gobo2: 'Grid' }), sg(beam, { prism: 'in' })],
    plasma: [pf(spot, { gobo2: 'Galaxy glass', spin: 0.3 })],
    fireworks: [pf(spot, { gobo: 'Stars', prism: '3-facet prism', prismSpin: 0.9 }), sg(beam, { gobo: 'Star' })],
    rain: [pf(spot, { gobo: 'Water', anim: 1 }), sg(beam, { gobo: 'Bars' })],
    flames: [pf(spot, { gobo: 'Breakup', gobo2: 'Fire glass', anim: 0.8 }), sg(beam, { gobo: 'Flower', spin: 0.5 })],
    bounce: [sg(beam, { gobo: 'Dots' })],
    ripple: [sg(backBeam, { gobo: 'Ring', spin: 0.3 })],
    meteors: [pf(spot, { gobo: 'Ring of dots', spin: 0.5 }), sg(beam, { gobo: 'Triangles' })],
    pride: [pf(spot, { gobo2: 'Rainbow glass', spin: 0.5 })],
    popcorn: [sg(beam, { gobo: 'Dots', spin: 0.6 }), pf(spot, { gobo: 'Ring of dots', prism: '3-facet prism' })],
    heartbeat: [sg(beam, { gobo: 'Ring' })],
    glitter: [pf(spot, { gobo: 'Stars', prism: '8-facet prism', prismSpin: 0.6 }), sg(beam, { prism: 'in' })],
    juggle: [pf(spot, { gobo: 'Flower', spin: 0.4 })],
    formula: [pf(spot, { gobo: 'Spiral', spin: 0.5 }), pf(sideSpot, { gobo: 'Tunnel', spin: -0.5 })],
    reveal: [pf(spot, { gobo: 'Breakup', frost: 0.2 }), pf(sideSpot, { gobo: 'Breakup' })],
    walkon: [pf(spot, { gobo: 'Ring of dots', prism: '3-facet prism', prismSpin: 0.6 })],
  };
  const alt = (ids: string[], a: Color, c2: Color, level = 1, more: Values = {}): [string[], Values][] =>
    [[ids.filter((_, i) => i % 2 === 0), on(level, a, more)], [ids.filter((_, i) => i % 2 === 1), on(level, c2, more)]];
  const narrow = (level: number, c?: Color, more: Values = {}) => on(level, c, { zoom: 0, ...more });
  // every beam head in a colour (or two, taking turns along each row); every wash
  const beams = (level: number, c: Color, c2?: Color, more: Values = {}): [string[], Values][] =>
    BEAMS.flatMap((ids) => (c2 ? alt(ids, c, c2, level, { zoom: 0, ...more }) : [[ids, narrow(level, c, more)] as [string[], Values]]));
  const washes = (level: number, c: Color, c2?: Color, zoom = 0.5): [string[], Values][] =>
    WASHES.flatMap((ids) => (c2 ? alt(ids, c, c2, level, { zoom }) : [[ids, on(level, c, { zoom })] as [string[], Values]]));
  const look = (name: string, parts: [string[], Values][], effects: string[] = [], fade = 0): Cue => b.cue(L, name, [...dark, ...parts], { fade, effects });
  const at: Record<string, string> = {};
  // (a look's gobos on top of its colours: dress[key])
  const mk = (key: string, c: Cue) => { at[key] = c.id; for (const [ids, v] of dress[key] ?? []) for (const id of ids) c.values[id] = { ...c.values[id], ...v }; };
  mk('intro', look('Intro: blue haze', [[backWash, on(0.45, C.deepBlue, { zoom: 0.8 })], [frontWash, on(0.2, C.deepBlue, { zoom: 0.8 })], [beam, narrow(0.7, C.white)], [backBeam, narrow(0.4, C.ice)], [strip, on(0.6)], [edge, on(0.3, C.deepBlue)]],
    [e.lightning, e.aurora, e.beamWave], 4));
  // the busy parts between the singing: riffs
  mk('wake', look('Band in: white beams', [...beams(1, C.white), ...washes(0.7, C.deepBlue), [strip, on(1, C.white)], [edge, on(1, C.white)]],
    [e.meteor, e.beamFan, e.spotCircle, e.floorWave, paint('edge', 'scanner', 'white', 'ice')]));
  mk('riffRed', look('Riff: red and white', [...beams(1, C.red, C.white), ...washes(0.8, C.red, C.orange), [strip, on(1)], [edge, on(1, C.red)]],
    [e.fire2012, e.beamFan, e.floorWave, e.spotCircle, e.towerCross, paint('edge', 'sinelon', 'red', 'white')]));
  mk('riffIce', look('Riff: ice and blue', [...beams(1, C.ice, C.blue), ...washes(0.8, C.blue, C.deepBlue), [strip, on(1, C.cyan)], [edge, on(1, C.ice)]],
    [e.chase, e.beamBally, e.spotAlt, e.backSwing, e.floorChase, e.sideSweep, paint('edge', 'gradientChase', 'ice', 'blue', 'white')]));
  mk('riffGold', look('Riff: gold', [...beams(1, C.gold, C.white), ...washes(0.8, C.amber, C.orange), [strip, on(1)], [edge, on(1, C.amber)]],
    [e.fire, e.beamPing, e.spotFig8, e.floorSwing, e.towerChase, paint('edge', 'juggle', 'gold', 'amber', 'white')]));
  // the verses: a colour each, the heads moving gently
  mk('warm', look('Verse: warm', [...washes(0.8, C.amber, C.orange, 0.6), [spot, narrow(0.8, C.warm)], [beam, narrow(0.8, C.warm, { gobo: gobo('Flower'), goboRotation: turn('gen-spotgobo', 0.4) })], [floorHead, narrow(0.6, C.amber)],
    [strip, on(0.8)], [ledBar, on(0.6, C.amber)], [edge, on(0.8, C.amber)]], [e.fire, e.spotCircle, e.floorWave, paint('edge', 'sinelon', 'amber', 'orange')], 1));
  mk('cyan', look('Verse: cyan sweep', [...washes(0.7, C.cyan, C.blue), [spot, narrow(1, C.white)], [sideSpot, narrow(1, C.cyan)], [floorHead, narrow(0.8, C.cyan)], [backBeam, narrow(0.8, C.ice)],
    [strip, on(0.9, C.cyan)], [edge, on(0.9, C.cyan)]], [e.chase, e.sideSweep, e.backSwing, paint('edge', 'juggle', 'cyan', 'blue', 'ice')], 1));
  // the build-ups, and a lift into a slam
  mk('build', look('Build: rising', [...beams(0.9, C.white), ...washes(0.5, C.cool, undefined, 0.2), [strip, on(1, C.white)], [ledBar, on(0.8, C.white)], [edge, on(1, C.white)]],
    [e.meteorRain, scanWhite, e.beamFan, e.spotBally, e.floorWave], 1));
  mk('lift', look('Lift: white, rising', [...beams(0.8, C.white), [strip, on(0.4, C.white)], [edge, on(1, C.white)]], [scanWhite, e.beamWave], 0));
  mk('riser', look('Riser: eighths', [...beams(1, C.white), [strip, on(0.5, C.white)], [edge, on(1, C.white)]], [e.air8ths, scanWhite], 0));
  // the band stopping dead: dark, a few spots on the band
  mk('stop', look('Stop: on the band', [[spot.slice(6, 14), narrow(1, C.white)]], [], 0));
  // the choruses
  mk('drop', look('Drop: full colour', [...beams(1, C.magenta, C.white), ...washes(0.9, C.magenta, C.purple), [strip, on(1)], [ledBar, on(1, C.magenta)], [edge, on(1, C.magenta)]],
    [e.rainbow, e.beamBally, e.spotBally, e.floorWave, e.towerCross, e.sideSweep, paint('edge', 'gradientChase', 'magenta', 'purple', 'white')]));
  mk('redblue', look('Drop: red and blue', [...beams(1, C.red, C.blue), ...washes(0.9, C.blue, C.red), [strip, on(1, C.red)], [edge, on(1, C.red)]],
    [e.meteor, e.beamFan, e.spotAlt, e.floorChase, e.backSwing, paint('edge', 'scanner', 'red', 'blue')]));
  mk('white', look('Drop: white heat', [...beams(1, C.white, undefined, { prism: 1 }), ...washes(1, C.white, undefined, 0.3), [strip, on(1, C.white)], [strobe, on(1, undefined, { strobe: 0.5 })],
    [backStrobe, on(1, undefined, { strobe: 0.6 })], [edge, on(1, C.white)]], [e.sparkle, e.beamCircle, e.spotBally, e.towerChase, e.floorSwing]));
  mk('final', look('Final: everything', [...alt(backBeam, C.green, C.cyan), ...alt(spot, C.white, C.yellow), ...alt(beam, C.magenta, C.cyan), ...alt(floorHead, C.yellow, C.green), [towerHead, narrow(1, C.white)], [sideSpot, narrow(1, C.yellow)],
    [air, { zoom: 0 }], ...washes(1, C.green, C.magenta), [strip, on(1)], [ledBar, on(1)], [edge, on(1)]],
  [e.rainbow, e.airBally, e.floorWave, e.towerCross, e.sideSweep, e.washColours, paint('edge', 'gradientChase', 'green', 'cyan', 'magenta', 'yellow'),
    paint('ledBar', 'theater', 'green', 'cyan', 'magenta', 'yellow')]));
  mk('solo', look('Solo: the guitar', [[spot, narrow(1, C.white)], ...alt(beam, C.green, C.cyan), ...alt(floorHead, C.cyan, C.green), [backBeam, narrow(1, C.green)], [towerHead, narrow(1, C.cyan)], [sideSpot, narrow(1, C.white)],
    ...washes(0.6, C.deepBlue), [strip, on(1)], [edge, on(1, C.green)]], [e.sparkle, e.floorChase, e.beamBally, e.spotFig8, e.towerChase, paint('edge', 'juggle', 'green', 'cyan', 'white')]));
  // the quiet parts
  mk('sunset', look('Break: sunset', [...washes(0.6, C.orange, C.pink, 0.7), [backBeam, narrow(0.5, C.amber)], [strip, on(0.6)], [edge, on(1)]], [e.ocean, e.twinkle, e.picture], 3));
  mk('space', look('Break: deep space', [...washes(0.4, C.deepBlue, C.purple, 0.7), [spot, narrow(0.6, C.cool)], [strip, on(0.5, C.purple)],
    [beam, narrow(0.8, C.lavender, { gobo: gobo('Star'), goboRotation: turn('gen-spotgobo', 0.6) })], [edge, on(0.4, C.purple)]], [e.spotFig8, e.lightning, e.twinkle], 4));
  mk('breakdown', look('Breakdown: red pillars', [[beam, narrow(1, C.red)], [backBeam, narrow(0.6, C.red)], [backWash, on(0.3, C.red, { zoom: 0.8 })], [strip, on(0.4, C.red)], [ledBar, on(1, C.red)], [edge, on(0.5, C.red)]],
    [e.heartbeat, e.beamWave], 2));
  mk('outro', look('Outro: embers', [[backWash, on(0.4, C.red)], [frontWash, on(0.25, C.orange)], [beam, narrow(0.5, C.red)], [strip, on(0.5)], [edge, on(0.4, C.red)]], [e.fire2012, e.beamWave], 5));
  mk('end', look('The end', [], [], 6));
  // the pixel shows, a look each (the wall shows them, the heads dress the colour)
  mk('aurora', look('Wall: aurora', [...washes(0.5, C.teal, C.deepBlue, 0.7), [strip, on(1)], [beam, narrow(0.7, C.teal)], [backBeam, narrow(0.6, C.green)], [edge, on(0.5, C.teal)]], [e.aurora, e.beamCircle, e.twinkle], 3));
  mk('matrix', look('Wall: matrix rain', [...washes(0.6, C.green, undefined, 0.6), [spot, narrow(1, C.green)], [beam, narrow(1, C.green, { prism: 1 })], [floorHead, narrow(1, C.green)], [strip, on(1)], [ledBar, on(0.6, C.green)], [edge, on(0.8, C.green)]],
    [e.matrix, e.beamFan, e.floorChase, paint('edge', 'scanner', 'green', 'white')], 1));
  mk('plasma', look('Wall: plasma', [...washes(0.8, C.purple, C.blue), [spot, narrow(0.9, C.lavender)], [beam, narrow(0.9, C.purple, { gobo: gobo('Star'), goboRotation: turn('gen-spotgobo', 0.8) })], [strip, on(1)], [edge, on(1, C.purple)]],
    [e.plasma, e.spotFig8, paint('edge', 'juggle', 'purple', 'blue', 'lavender')], 1));
  mk('fireworks', look('Wall: fireworks', [...washes(0.3, C.deepBlue), ...beams(1, C.white), [strip, on(1)], [edge, on(1, C.white)]], [e.fireworks, e.spotBally, e.beamBally, e.floorWave]));
  mk('rain', look('Wall: rain', [...washes(0.5, C.blue, C.cyan, 0.7), [beam, narrow(0.8, C.ice)], [spot, narrow(0.6, C.ice)], [strip, on(1)], [edge, on(0.6, C.ice)]], [e.rain, paint('edge', 'sinelon', 'ice', 'blue'), e.beamWave], 3));
  mk('flames', look('Wall: flames', [...beams(1, C.amber, C.red), ...washes(0.9, C.red, C.orange), [strip, on(1)], [ledBar, on(0.8, C.red)], [edge, on(1, C.orange)]],
    [e.fire2012, e.beamBally, e.floorSwing, e.towerCross], 1));
  mk('bounce', look('Wall: bouncing balls', [...washes(0.7, C.yellow, C.cyan), [floorHead, narrow(1, C.yellow)], [beam, narrow(1, C.cyan)], [strip, on(1)], [ledBar, on(1)], [edge, on(1, C.yellow)]],
    [e.bouncing, e.floorWave, e.beamPing, paint('ledBar', 'theater', 'yellow', 'cyan')], 0.5));
  mk('ripple', look('Wall: ripples', [...washes(0.5, C.cyan, C.blue, 0.7), [backBeam, narrow(0.6, C.cyan)], [strip, on(1)], [edge, on(0.6, C.cyan)]], [e.ripple, e.beamWave], 3));
  mk('meteors', look('Wall: meteor rain', [...beams(1, C.white), ...washes(0.6, C.cool), [strip, on(1)], [ledBar, on(0.6, C.white)], [edge, on(1, C.white)]],
    [e.meteorRain, e.beamFan, e.spotCircle, paint('edge', 'gradientChase', 'white', 'cool', 'ice')], 1));
  mk('pride', look('Wall: colour waves', [...beams(1, C.white), ...washes(0.8, C.white), [strip, on(1)], [edge, on(1)]], [e.pride, e.washColours, e.airColours, paint('edge', 'juggle', 'red', 'yellow', 'green', 'cyan', 'blue', 'magenta'), e.floorWave], 0.5));
  mk('popcorn', look('Wall: popcorn', [...beams(1, C.yellow, C.magenta), ...washes(0.8, C.magenta, C.yellow), [strip, on(1)], [edge, on(1, C.magenta)]],
    [e.popcorn, e.beamBally, e.floorSwing, paint('edge', 'sinelon', 'yellow', 'magenta')]));
  mk('heartbeat', look('Heartbeat', [[backWash, on(0.3, C.red)], [beam, narrow(0.6, C.red)], [strip, on(0.6, C.red)], [ledBar, on(1, C.red)], [edge, on(0.6, C.red)]], [e.heartbeat, e.pulse, e.glitter], 3));
  mk('glitter', look('Wall: rainbow glitter', [...beams(1, C.white, undefined, { prism: 1 }), ...washes(0.8, C.white, undefined, 0.4), [strip, on(1)], [edge, on(1, C.white)]],
    [e.glitter, e.beamCircle, e.spotFig8, paint('edge', 'gradientChase', 'white', 'ice')]));
  mk('juggle', look('Edge: juggle', [...washes(0.7, C.purple, C.cyan), [backBeam, narrow(1, C.cyan)], [spot, narrow(0.8, C.purple)], [strip, on(0.8)], [edge, on(1, C.purple)]], [paint('edge', 'juggle', 'purple', 'cyan'), e.chase, e.spotCircle], 1));
  mk('formula', look('Wall: your own formula', [...washes(0.6, C.purple, C.magenta), [spot, narrow(0.8, C.white)], [sideSpot, narrow(1, C.magenta)], [strip, on(1)], [ledBar, on(1)], [edge, on(0.8, C.magenta)]],
    [e.formula, paint('ledBar', 'theater', 'purple', 'magenta', 'white'), e.sideSweep], 2));
  mk('strobe', look('Strobe hits', [...washes(0.6, C.white), ...beams(1, C.white), [strip, on(0.5, C.white)], [strobe, on(1)], [backStrobe, on(1)], [towerStrobe, on(1)], [edge, on(1, C.white)]],
    [e.strobeHits, e.sparkle, e.airHits]));
  // around the song: the house lights (warm on the audience), dark, searchlights over the crowd, the
  // backdrop coming up slowly behind them, the band walking on in strobes, the thank-you on the crowd
  mk('house', look('House lights', [[crowdBlinder, on(0.3, C.warm)], [frontWash, on(0.35, C.warm, { zoom: 1 })], [deckWash, on(0.3, C.warm, { zoom: 1 })], [floorHead, on(0.45, C.warm, { zoom: 1 })]], [], 3));
  mk('houseDown', look('House lights down', [], [], 3));
  const searchlights: [string[], Values][] = [[backBeam, narrow(0.9, C.white)], [spot, narrow(0.8, C.white)], [sideSpot, narrow(0.9, C.cool)], [towerHead, narrow(0.9, C.white)], [floorHead, narrow(0.7, C.ice)]];
  mk('search', look('Searchlights', searchlights, [], 1));
  mk('reveal', look('Reveal: the backdrop', [...searchlights, [strip, on(0.8, C.deepBlue)], [backWash, on(0.6, C.deepBlue, { zoom: 0.8 })], [ledBar, on(0.5, C.blue)], [edge, on(0.4, C.deepBlue)]], [e.aurora], 10));
  mk('walkon', look('Walk-on: strobes', [[strobe, on(1, undefined, { strobe: 0.7 })], [backStrobe, on(1, undefined, { strobe: 0.6 })], [towerStrobe, on(1, undefined, { strobe: 0.8 })],
    [strip, on(0.5, C.deepBlue)], [backWash, on(0.4, C.deepBlue, { zoom: 0.8 })], [spot, narrow(0.9, C.white)], [beam, narrow(0.8, C.white)]], [e.airHits], 0));
  mk('thanks', look('Thank you: on the crowd', [[crowdBlinder, on(1, C.warm)], [blinder, on(0.7, C.warm)], [frontWash, on(0.6, C.warm, { zoom: 1 })], [floorHead, narrow(0.9, C.white)]], [], 0.3));

  // ---- the moves: a shape is a spot for every head to aim at, worked out for where it hangs or
  // stands (the first spot it can reach); the second of a pair that takes turns is worked out from
  // the first, the shortest way between them, so the heads get there on the beat
  type Aim = (p: V3, hung: boolean) => V3[];
  const isWash = new Set(wash), moving = [...BEAMS, ...WASHES];
  const pos = new Map<string, Record<string, { pan: number; tilt: number }>>();
  const shape = (name: string, aimAir: Aim, aimWash: Aim, near?: string) => {
    const v: Record<string, { pan: number; tilt: number }> = {};
    for (const ids of moving) for (const f of b.fx(ids)) {
      const ref = near ? pos.get(near)?.[f.id] : undefined, hung = Math.abs(f.rot!.roll) > 135;
      for (const t of (isWash.has(f.id) ? aimWash : aimAir)(f.p3!, hung)) {
        const a = aimAt(f.p3!, f.rot!, t, OPTICS, ref);
        if (a) { v[f.id] = { pan: r4(a.pan), tilt: r4(a.tilt) }; break; }
      }
    }
    pos.set(name, v);
  };
  const upright = (p: V3, hung: boolean): V3[] => [{ x: p.x, y: p.y + (hung ? -20 : 20), z: p.z }];   // straight up (or down, from a truss)
  const onBand = (p: V3): V3[] => [{ x: p.x * 0.6, y: DECK, z: -0.8 }];
  const onCrowd = (p: V3): V3[] => [{ x: p.x * 1.1, y: 0, z: 9.5 }];
  shape('Fan out', (p) => [{ x: p.x * 2.6, y: p.y + 10, z: p.z + 6 }, { x: p.x * 2, y: p.y + 4, z: p.z + 8 }], onBand);
  shape('Cross', (p) => [{ x: -p.x * 1.2, y: p.y + 8, z: p.z + 7 }, { x: -p.x, y: p.y + 3, z: p.z + 8 }], onBand, 'Fan out');
  // (a head on a tower can't lean out away from the stage: it goes up instead)
  shape('Lean left', (p) => [{ x: p.x - 8, y: p.y + 6, z: p.z + 4 }, { x: p.x - 8, y: p.y + 2, z: p.z + 5 }, { x: p.x, y: p.y + 8, z: p.z + 4 }], onBand);
  shape('Lean right', (p) => [{ x: p.x + 8, y: p.y + 6, z: p.z + 4 }, { x: p.x + 8, y: p.y + 2, z: p.z + 5 }, { x: p.x, y: p.y + 8, z: p.z + 4 }], onBand, 'Lean left');
  shape('Crowd', (p) => [p.y < 1 ? { x: p.x * 1.3, y: 7, z: 14 } : { x: p.x * 1.15, y: 1.7, z: 11 }], onCrowd);
  // (a hung head reaches 45° above level at most: as high as it goes)
  shape('Sky', (p) => [{ x: p.x * 1.4, y: p.y + 14, z: p.z + 2 }, { x: p.x * 1.4, y: p.y + 6, z: p.z + 8 }, { x: p.x * 1.4, y: p.y + 4, z: p.z + 9 }], onBand, 'Crowd');
  shape('Centre', () => [{ x: 0, y: 9.5, z: 5 }], (p) => [{ x: p.x * 0.3, y: DECK, z: -1 }], 'Fan out');
  shape('Wide', (p) => [{ x: p.x * 2.4, y: 0.5, z: 10 }, { x: p.x * 0.5, y: 0.5, z: 10 }], onCrowd, 'Centre');
  shape('Tunnel', (p) => [{ x: -p.x * 0.7, y: 6, z: 13 }], onCrowd);
  shape('Pillars', upright, upright, 'Tunnel');
  shape('Band', (p) => [p.y < 1 ? { x: p.x, y: 6, z: 1 } : { x: p.x * 0.2, y: DECK + 1.4, z: -1.6 }], onBand);
  // the intro's searchlights: over the crowd, from one side of the hall to the other (and up, for a
  // head that can't reach)
  const sweep = (side: number) => (p: V3): V3[] => [p.y < 1 ? { x: side * 7 + p.x * 0.3, y: 7, z: 14 } : { x: side * 6 + p.x * 0.3, y: 1.6, z: 11 },
    { x: p.x + side * 6, y: p.y + 4, z: p.z + 6 }, { x: p.x, y: p.y + 8, z: p.z + 4 }];
  shape('Sweep left', sweep(-1), (p) => [{ x: -5 + p.x * 0.3, y: 0, z: 9 }]);
  shape('Sweep right', sweep(1), (p) => [{ x: 5 + p.x * 0.3, y: 0, z: 9 }], 'Sweep left');
  // a cue for each, snapped (no fade: as fast as the heads go) or gliding
  const mv: Record<string, string> = {};
  const move = (name: string, fade = 0) => {
    const key = `${name}|${fade}`;
    return (mv[key] ??= b.cue(M, fade ? `${name}, slowly` : name, Object.entries(pos.get(name)!).map(([id, v]) => [[id], v] as [string[], Values]), { fade }).id);
  };
  for (const n of pos.keys()) move(n);

  // haze (a cue of its own list, so it runs under every look)
  b.cue(H, 'Haze', [[haze, { haze: 0.35, fan: 0.5 }]], { fade: 0 });
  const tune: DemoSong = song ?? { id: 'demo-beat', bpm: DEMO_BPM, offset: 0, duration: DEMO_SECONDS, sections: sectionStarts().map((x) => ({ name: x.name, at: x.at, energy: x.energy })) };
  const tl = songShow(tune, { show: L.id, moves: M.id, looks: at, move, effects: { ...e, scanner: scanWhite }, haze: { list: H.id, cue: H.cues[0].id } });
  s.timeline = song ? tl : { demo: true, duration: DEMO_SECONDS, bpm: DEMO_BPM, offset: 0, items: tl.items, lead: tl.lead, tail: tl.tail, crowd: tl.crowd };
  return b.done();
}

// What a part of a song is, for its lights: from its name (Intro, Verse, Pre-chorus, Chorus, Solo,
// Break, Bridge, Instrumental, Outro, Drop, Build), else from how hard it hits.
type PartKind = 'intro' | 'verse' | 'build' | 'chorus' | 'solo' | 'break' | 'inst' | 'outro';
export function partKind(name: string, energy = 0.7): PartKind {
  const n = name.toLowerCase();
  if (n.startsWith('intro')) return 'intro';
  if (n.startsWith('outro')) return 'outro';
  if (/pre-?chorus|build/.test(n)) return 'build';
  if (/chorus|drop|hook/.test(n)) return 'chorus';
  if (n.startsWith('solo')) return 'solo';
  if (/break|bridge/.test(n)) return 'break';
  if (n.startsWith('verse')) return 'verse';
  if (n.startsWith('instrumental')) return 'inst';
  return energy >= 0.9 ? 'chorus' : energy < 0.5 ? 'break' : 'verse';
}

// The looks each kind of part takes turns with (going on through the list the next time that kind
// comes round), every `LOOK_BARS` bars; the last chorus has its own, the biggest.
const POOLS: Record<PartKind, string[]> = {
  intro: ['intro', 'aurora'],
  verse: ['warm', 'matrix', 'cyan', 'plasma', 'bounce', 'juggle', 'formula', 'rain'],
  build: ['build', 'meteors', 'flames'],
  chorus: ['drop', 'redblue', 'white', 'popcorn', 'pride', 'fireworks', 'glitter'],
  solo: ['solo', 'white', 'fireworks', 'strobe', 'glitter'],
  break: ['sunset', 'space', 'ripple', 'heartbeat', 'rain'],
  inst: ['wake', 'riffRed', 'riffIce', 'riffGold', 'flames'],
  outro: ['outro'],
};
const LAST_CHORUS = ['final', 'fireworks', 'white', 'glitter', 'strobe', 'final'];
const LOOK_BARS: Record<PartKind, number> = { intro: 8, verse: 4, build: 4, chorus: 4, solo: 4, break: 8, inst: 4, outro: 8 };
// How the heads move in each kind of part: beats between snaps (0: they glide), and how many bars a
// pair of shapes lasts before the next pair takes over.
const MOVE_BEATS: Record<PartKind, number> = { intro: 0, verse: 4, build: 4, chorus: 2, solo: 2, inst: 2, break: 0, outro: 0 };
const PAIR_BARS: Record<PartKind, number> = { intro: 8, verse: 8, build: 4, chorus: 4, solo: 4, break: 8, inst: 4, outro: 8 };
const PAIRS: [string, string][] = [['Fan out', 'Cross'], ['Lean left', 'Lean right'], ['Crowd', 'Sky'], ['Centre', 'Fan out'], ['Tunnel', 'Pillars'], ['Wide', 'Centre']];
// a build-up climbs: from the crowd up into the sky, a step a bar
const CLIMB = ['Crowd', 'Cross', 'Fan out', 'Sky'];

interface Cueing {
  show: string; moves: string;                     // the lists
  looks: Record<string, string>;                   // the looks: key -> cue id
  move: (shape: string, fade?: number) => string;  // a shape's cue on the moves list
  effects: Record<string, string>;
  haze: { list: string; cue: string };
}
interface Part { name: string; at: number; end: number; energy: number; kind: PartKind; bars: number; lastChorus: boolean }

// Where a song without measured hits hits: a slam where a chorus (or a solo, or a riff after
// something quieter) starts, a drum fill in the last bar of a build-up, the last chord where the
// outro starts.
function guessHits(parts: Part[], bar: number): CatalogHit[] {
  const hits: CatalogHit[] = [];
  parts.forEach((p, i) => {
    const prev = parts[i - 1];
    if (p.kind === 'chorus' || ((p.kind === 'solo' || p.kind === 'inst') && prev && prev.energy < p.energy - 0.05)) hits.push({ at: p.at, kind: 'slam' });
    if (p.kind === 'build' && p.bars >= 2 && parts[i + 1]) hits.push({ at: p.end - bar, kind: 'fill' });
    if (p.kind === 'outro' && i === parts.length - 1) hits.push({ at: p.at, kind: 'end' });
  });
  return hits;
}

// The show on a song (or the demo beat): the looks taking turns through each part, the moves on
// its beat, the hits where it hits (a slam: a new look at once, the heads snapping on every beat of
// the first bar and flashing with it, CO2, the blinders and two short shots of flame; a stop: dark, a few spots on the band,
// then the eighths into the slam; a dip or a fill: the heads rising, flashing in eighths), the
// machines where the parts ask for them, and the stage going dark as it rings out.
function songShow(song: DemoSong, c: Cueing) {
  const beat = 60 / song.bpm, bar = 4 * beat, dur = song.duration, eps = 1e-3;
  const seen: Partial<Record<PartKind, number>> = {};
  const parts: Part[] = song.sections.map((x, i, a) => {
    const end = i + 1 < a.length ? a[i + 1].at : dur, energy = Number.isFinite(x.energy) ? x.energy : 0.7, kind = partKind(x.name, energy);
    seen[kind] = (seen[kind] ?? 0) + 1;
    return { name: x.name, at: x.at, end, energy, kind, bars: Math.max(1, Math.round((end - x.at) / bar)), lastChorus: false };
  });
  const choruses = parts.filter((p) => p.kind === 'chorus');
  if (choruses.length > 1) choruses[choruses.length - 1].lastChorus = true;
  const hits = [...(song.hits ?? guessHits(parts, bar))].sort((a, b) => a.at - b.at);
  const slams = hits.filter((h) => h.kind === 'slam');
  const partAt = (t: number) => parts.find((p) => t >= p.at - eps && t < p.end - eps) ?? parts[parts.length - 1];

  // what goes where, by time: the looks and the moves (a later entry at the same time wins), and
  // the rest as timeline items
  const looks = new Map<number, string>(), moves = new Map<number, string>();
  const pinned = new Set<number>();                // looks that start a part or answer a hit: they stay
  const items: TimelineItem[] = [], crowd: CrowdItem[] = [];
  let n = 0;
  const key = (t: number) => Math.round(t * 1000) / 1000;
  const cr = (t: number, a: CrowdAction, len: number) => { crowd.push({ id: `dc${crowd.length + 1}`, at: key(t), do: a, len }); };
  const put = (t: number, lane: string, a: TimelineAction, len?: number) => {
    const at = Math.max(0, Math.min(dur, key(t)));
    items.push({ id: `dt${++n}`, at, lane, do: a, ...(len ? { len: Math.max(0.1, Math.min(len, dur - at)) } : {}) });
  };
  const bursts = new Set<string>();
  const burst = (t: number, attr: BurstAttr, seconds: number) => {
    const at = Math.max(0, key(t)), k = `${at}:${attr}`;
    if (at >= dur || bursts.has(k)) return;
    bursts.add(k);
    put(at, 'special', { do: 'burst', attr, seconds: Math.min(30, Math.max(0.1, seconds)) });
  };
  // the flame columns: short shots, the second two beats after the first
  const flames = (t: number) => { burst(t, 'flame', 0.3); burst(t + 2 * beat, 'flame', 0.3); };
  const fx = (t: number, effect: string, len: number) => { if (t < dur - 0.1) put(t, 'fx', { do: 'effect', effect, on: true }, len); };
  const clear = (m: Map<number, string>, a: number, z: number) => { for (const t of [...m.keys()]) if (t >= a - eps && t < z - eps) m.delete(t); };

  // where the look and move patterns start over: each part, each slam and each time the drums come
  // in (a hit in the middle of a part gets its new look at once, and the patterns go on from there)
  const starts = [...new Set([...parts.map((p) => key(p.at)), ...hits.filter((h) => h.kind === 'slam' || h.kind === 'drums').map((h) => key(h.at))])].sort((a, b) => a - b);
  const turn: Partial<Record<PartKind | 'last', number>> = {};
  let pair = 0;
  starts.forEach((t, i) => {
    const p = partAt(t), end = Math.min(p.end, starts[i + 1] ?? dur), segBars = Math.max(1, Math.round((end - t) / bar));
    const nextPart = parts[parts.indexOf(p) + 1];
    // the looks: the part's own list, going on where its kind last left off (a break right before
    // the last chorus: the red pillars)
    const pool = p.lastChorus ? LAST_CHORUS : p.kind === 'break' && nextPart?.lastChorus ? ['breakdown'] : POOLS[p.kind];
    const tk = p.lastChorus ? 'last' : p.kind;
    // (not one for just the last bar before the next part or slam)
    for (let k = 0; k === 0 || k + 2 <= segBars; k += LOOK_BARS[p.kind]) { const v = turn[tk] ?? 0; turn[tk] = v + 1; looks.set(key(t + k * bar), pool[v % pool.length]); }
    pinned.add(key(t));
    // the moves
    const every = MOVE_BEATS[p.kind];
    if (p.kind === 'build') for (let k = 0; k < segBars; k++) moves.set(key(t + k * bar), CLIMB[Math.min(CLIMB.length - 1, Math.floor((k * CLIMB.length) / segBars))]);
    else if (every) {
      for (let k = 0; k < segBars; k += PAIR_BARS[p.kind]) {
        const [a, z] = PAIRS[pair++ % PAIRS.length];
        for (let j = 0; j * every < Math.min(PAIR_BARS[p.kind], segBars - k) * 4; j++) moves.set(key(t + k * bar + j * every * beat), j % 2 ? z : a);
      }
    } else if (p.kind === 'outro') { moves.set(key(t), 'Centre'); if (segBars > 2) moves.set(key(t + 2 * bar), 'Pillars|slow'); }
    else {
      // the quiet parts glide: up, then straight up and down, every four bars; into the next part
      for (let k = 0; k === 0 || k + 2 <= segBars; k += 4) moves.set(key(t + k * bar), k / 4 % 2 ? 'Sky|slow' : 'Pillars|slow');
      if (p.kind === 'intro' && segBars >= 2) { clear(moves, end - bar, end); moves.set(key(end - bar), 'Fan out|slow'); }
    }
  });

  // the machines and the effects each kind of part asks for
  const barBurst = (t: number, bars: number) => {
    // flames on the 8s, sparks on the 4s in between
    for (let k = 4; k < bars; k += 4) if (k % 8) burst(t + k * bar, 'sparks', 3); else burst(t + k * bar, 'flame', 0.3);
  };
  const seenKind: Partial<Record<PartKind, number>> = {};
  for (const p of parts) {
    const nth = seenKind[p.kind] ?? 0;
    seenKind[p.kind] = nth + 1;
    if (p.kind === 'intro') burst(p.at, 'fog', 8);
    if (p.kind === 'build') { burst(p.end - 0.5, 'co2', 0.5); fx(p.at, c.effects.scanner, Math.max(1, p.bars - 1) * bar); }
    if (p.kind === 'chorus') {
      burst(p.at, 'co2', 1.5); burst(p.at, 'blinder', 0.6); flames(p.at);
      if (nth === 0 || p.lastChorus) burst(p.at, 'confetti', 1);
      if (p.lastChorus && p.bars >= 16) burst(p.at + 8 * bar, 'confetti', 1);
      barBurst(p.at, p.bars);
      // a bar of the heads flashing on every beat, the second half of each chorus
      if (p.bars >= 8) fx(p.at + Math.floor(p.bars / 2) * bar, c.effects.airHits, bar);
    }
    if (p.kind === 'solo') {
      burst(p.at, 'blinder', 0.6); flames(p.at);
      for (let k = 2; k < p.bars; k += 2) burst(p.at + k * bar, 'sparks', 2.5);
      fx(p.at, c.effects.strobeHits, Math.min(4, p.bars) * bar);
    }
    if (p.kind === 'break') {
      burst(p.at, 'fog', 6);
      if (p.energy < 0.6 && p.bars > 2) burst(p.at + bar, 'bubbles', Math.min(30, (p.bars - 2) * bar));
    }
    if (p.kind === 'inst') barBurst(p.at, p.bars);
    if (p.kind === 'verse' && p.bars >= 12) fx(p.at + 8 * bar, c.effects.floorChase, Math.min(4, p.bars - 8) * bar);
  }

  // the hits, over the patterns
  for (const h of hits) {
    const next = slams.find((x) => x.at > h.at + eps), p = partAt(h.at);
    // (a stop, a dip or a fill runs into the slam after it, at most two bars on)
    const to = next && next.at - h.at <= 2 * bar + eps ? next.at : Math.min(dur, h.at + bar);
    if (h.kind === 'slam') {
      // the first bar: the heads snap on every beat and flash with it, the machines go off
      let [a, z] = [moves.get(key(h.at)) ?? 'Fan out', [...moves.entries()].find(([t, v]) => t > h.at + eps && v !== moves.get(key(h.at)))?.[1] ?? 'Cross'];
      // (the heads move on the slam itself, even when what led into it ended on its first shape)
      const before = [...moves.entries()].filter(([t]) => t < h.at - eps).sort((x, y) => x[0] - y[0]).at(-1)?.[1];
      if (before === a) [a, z] = [z, a];
      clear(moves, h.at, h.at + bar);
      for (let j = 0; j < 4; j++) moves.set(key(h.at + j * beat), j % 2 ? z : a);
      fx(h.at, c.effects.airHits, bar);
      burst(h.at, 'blinder', 0.5); burst(h.at, 'co2', 1.2);
      if (p.kind === 'solo' || p.kind === 'chorus' || h === slams[0]) flames(h.at);
      burst(h.at, 'strobe', 0.25);
    }
    if (h.kind === 'drums') { burst(h.at, 'strobe', 0.25); burst(h.at, 'co2', 0.6); }
    if (h.kind === 'stop') {
      // dark, a few spots on the band; the last two beats flash in eighths, the heads up
      clear(looks, h.at, to); clear(moves, h.at, to);
      looks.set(key(h.at), 'stop'); moves.set(key(h.at), 'Band'); pinned.add(key(h.at));
      if (to - h.at >= 3 * beat - eps) { looks.set(key(to - 2 * beat), 'riser'); moves.set(key(to - 2 * beat), 'Sky'); pinned.add(key(to - 2 * beat)); }
    }
    if (h.kind === 'dip') {
      // the heads rise slowly; the last two beats flash in eighths, the heads flicking left and right
      clear(looks, h.at, to); clear(moves, h.at, to);
      looks.set(key(h.at), 'lift'); moves.set(key(h.at), 'Sky|slow'); pinned.add(key(h.at));
      if (to - h.at >= 3 * beat - eps) { looks.set(key(to - 2 * beat), 'riser'); moves.set(key(to - 2 * beat), 'Lean left'); moves.set(key(to - beat), 'Lean right'); pinned.add(key(to - 2 * beat)); }
      burst(to - beat, 'strobe', beat);
    }
    if (h.kind === 'fill') {
      // a beat at a time into the slam: the heads crossing and opening, flashing in eighths
      clear(looks, h.at, to); clear(moves, h.at, to);
      looks.set(key(h.at), 'riser'); pinned.add(key(h.at));
      for (let t = h.at, j = 0; t < to - eps; t += beat, j++) moves.set(key(t), j % 2 ? 'Fan out' : 'Cross');
      burst(to - beat, 'strobe', beat);
    }
  }

  // the end: the blinders, CO2 and confetti on the last chord (where the outro starts), the heads
  // meeting over the crowd, then dark as the song rings out
  const last = [...hits].reverse().find((h) => h.kind === 'end');
  const outro = [...parts].reverse().find((p) => p.kind === 'outro');
  const hit = last ? last.at : outro ? outro.at : Math.max(0, dur - 4 * bar);
  burst(Math.max(0, hit), 'blinder', 1.2);
  burst(Math.max(0, hit), 'confetti', 1);
  burst(Math.max(0, hit), 'co2', 1);
  const endAt = key(Math.max(hit + bar, dur - 7));
  clear(looks, endAt, dur + 1);
  looks.set(endAt, 'end'); pinned.add(endAt);

  // the crowd only at the beginning: loudest as the music starts, then dying away under it (nothing
  // in the song, no cheering after it; the show around the song has the rest)
  cr(0, { do: 'cheer', level: 1 }, 8); cr(0, { do: 'crowd', mood: 'cheer', level: 0.95 }, 0.5);
  cr(4, { do: 'crowd', mood: 'cheer', level: 0 }, CROWD_GONE - 4);
  // and the show around the song
  aroundShow(song, c, (t, lane, a) => { items.push({ id: `dt${++n}`, at: key(t), lane, do: a }); }, cr);
  // a look from the pattern that a hit or a part cuts off within a bar goes (it would only flash by)
  const lt = [...looks.keys()].sort((a, b) => a - b);
  lt.forEach((t, i) => { if (!pinned.has(t) && i + 1 < lt.length && lt[i + 1] - t < bar - eps) looks.delete(t); });

  for (const [t, k] of [...looks].sort((a, b) => a[0] - b[0])) put(t, `list:${c.show}`, { do: 'goto', list: c.show, cue: c.looks[k] });
  let lastMove = '';
  for (const [t, m] of [...moves].sort((a, b) => a[0] - b[0])) {
    if (m === lastMove) continue;                  // (already there)
    lastMove = m;
    const [name, slow] = m.split('|');
    put(t, `list:${c.moves}`, { do: 'goto', list: c.moves, cue: c.move(name, slow ? 2 * bar : 0) });
  }
  // (the haze comes on with the house lights, before the song: aroundShow)
  put(Math.max(0, dur - 6), `list:${c.haze.list}`, { do: 'release', list: c.haze.list });
  items.sort((a, b) => a.at - b.at);
  crowd.sort((a, b) => a.at - b.at);
  return {
    duration: dur, bpm: song.bpm, offset: song.offset, items, lead: DEMO_LEAD, tail: DEMO_TAIL, crowd,
    sections: song.sections.map((x) => ({ name: x.name, at: x.at, ...(Number.isFinite(x.energy) ? { energy: x.energy } : {}) })),
  };
}

// The show around the song: DEMO_LEAD seconds before it starts and DEMO_TAIL after it ends (the
// song's clock: before it is below 0). The house lights on and people chatting while they wait,
// the haze going; the house lights down and a cheer; searchlights sweeping the crowd side to side;
// the backdrop coming up slowly as the cheering grows; strobes and the blinders
// as the band walks on, the crowd roaring; a breath in the dark with the band in its spots, then
// the song. After it the blinders on the crowd and the house lights up, people talking again (the
// crowd cheers only at the beginning).
function aroundShow(song: DemoSong, c: Cueing, add: (t: number, lane: string, a: TimelineAction) => void, cr: (t: number, a: CrowdAction, len: number) => void) {
  const dur = song.duration, S = -DEMO_LEAD;
  const look = (t: number, k: string) => add(t, `list:${c.show}`, { do: 'goto', list: c.show, cue: c.looks[k] });
  const move = (t: number, name: string, fade = 0) => add(t, `list:${c.moves}`, { do: 'goto', list: c.moves, cue: c.move(name, fade) });
  const burst = (t: number, attr: BurstAttr, seconds: number) => add(t, 'special', { do: 'burst', attr, seconds });
  look(S, 'house'); move(S, 'Crowd'); add(S, `list:${c.haze.list}`, { do: 'goto', list: c.haze.list, cue: c.haze.cue });
  cr(S, { do: 'crowd', mood: 'chatter', level: 0.55 }, 0);
  look(S + 5, 'houseDown'); burst(S + 6, 'fog', 6);
  cr(S + 5, { do: 'cheer', level: 0.8 }, 5); cr(S + 5, { do: 'crowd', mood: 'cheer', level: 0.45 }, 3);
  look(S + 8, 'search');
  for (let t = S + 8, k = 0; t < -8.5; t += 4, k++) move(t, k % 2 ? 'Sweep right' : 'Sweep left', 3.5);
  look(S + 14, 'reveal'); cr(S + 14, { do: 'crowd', mood: 'cheer', level: 0.6 }, 4); cr(S + 14, { do: 'cheer', level: 0.6 }, 4);
  look(-8, 'walkon'); move(-8, 'Band'); burst(-8, 'blinder', 0.8); burst(-4, 'blinder', 0.5);
  cr(-8, { do: 'cheer', level: 1 }, 6); cr(-8, { do: 'crowd', mood: 'cheer', level: 0.8 }, 1);
  look(-2, 'stop');
  look(dur + 0.5, 'thanks'); move(dur + 0.5, 'Crowd');
  look(dur + 6, 'house'); cr(dur + 6, { do: 'crowd', mood: 'chatter', level: 0.3 }, 3);
}
