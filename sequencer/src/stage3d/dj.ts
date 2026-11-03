// The DJ and the booth: a table with two players and a mixer on it, a laptop on a stand, headphones,
// a printed front (the act's name), and the DJ behind it (people.ts) playing along: nodding on the
// beat, knees bouncing, the right hand working the mixer (the crossfader, then the EQ, then the
// filter, a new move every two bars), the left on the left player's jog wheel, and up in the air,
// pumping on the beat, when the music drops. Metres; the booth's own space has the floor at y = 0
// and its front (the crowd's side) towards +z; the DJ stands behind it at -z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Person } from './people';
import { at, box, cyl, std, type Mats } from './gear';
import { liveBanner, screen } from './textures';
import { crowdBeatLen } from './crowd';

// the booth: width, depth, the table top's height; where the DJ stands (booth space)
export const BOOTH = { w: 2.4, d: 0.7, h: 1.0, dj: -0.55 };
// what's on the table (booth space): the mixer's middle and its controls, the players' jog wheels
const TOP = BOOTH.h + 0.02;
export const DECKS = {
  mixer: new THREE.Vector3(0, TOP + 0.09, -0.06),
  fader: new THREE.Vector3(0, TOP + 0.095, -0.21),
  eq: [new THREE.Vector3(-0.035, TOP + 0.11, 0.0), new THREE.Vector3(0.035, TOP + 0.11, -0.045)],
  filter: new THREE.Vector3(0.0, TOP + 0.11, -0.12),
  jog: { L: new THREE.Vector3(0.4, TOP + 0.115, -0.1), R: new THREE.Vector3(-0.4, TOP + 0.115, -0.1) },
};

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const k = clamp01(x); return k * k * (3 - 2 * k); };
const frac = (x: number) => x - Math.floor(x);
const onBeat = (b: number, k = 4) => Math.pow(Math.abs(Math.cos(Math.PI * frac(b))), k);

// The booth in its own space. `name`: what its front says (set() paints it again in place).
export function djBooth(M: Mats, name: string) {
  const g = new THREE.Group(), { w, d, h } = BOOTH;
  // the table: a black box, the front printed, a top a little bigger than it
  const front = liveBanner([name], { w: 1536, h: 512, accent: '#7a5cff' });
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [M.black, M.black, M.black, M.black, std({ map: front.t, roughness: 0.9 }), M.black]), 0, h / 2, 0));
  g.add(at(box(w + 0.1, 0.04, d + 0.1, M.plastic), 0, h + 0.02 - 0.02, 0));
  // the players: a body, the jog wheel (a platter in a ring), a little screen, play and cue buttons
  const body = std({ color: 0x1d1e22, roughness: 0.45, metalness: 0.3 }), platter = std({ color: 0x3a3d44, roughness: 0.35, metalness: 0.7 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x40a0ff, toneMapped: false }), green = new THREE.MeshBasicMaterial({ color: 0x40e070, toneMapped: false }), amber = new THREE.MeshBasicMaterial({ color: 0xffa020, toneMapped: false });
  const scr = new THREE.MeshBasicMaterial({ map: screen('laptop'), toneMapped: false });
  for (const sx of [-1, 1]) {
    const p = new THREE.Group(), j = sx > 0 ? DECKS.jog.L : DECKS.jog.R;
    p.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.33, 0.1, 0.42, 2, 0.015), body), 0, 0.05, 0));
    p.add(at(cyl(0.105, 0.105, 0.012, M.chrome, 28), 0, 0.106, -0.04), at(cyl(0.09, 0.09, 0.016, platter, 28), 0, 0.112, -0.04));
    p.add(at(cyl(0.11, 0.11, 0.004, glow, 28), 0, 0.1, -0.04));
    p.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), scr), 0, 0.102, 0.15, [-Math.PI / 2, 0, 0]));
    p.add(at(cyl(0.018, 0.018, 0.01, green, 12), -0.12, 0.103, -0.16), at(cyl(0.018, 0.018, 0.01, amber, 12), -0.12, 0.103, -0.11));
    g.add(at(p, j.x, TOP, j.z + 0.04));
  }
  // the mixer: channel faders, rows of knobs, the crossfader near the DJ, level meters
  const mx = new THREE.Group(), knob = std({ color: 0x0c0c0e, roughness: 0.4 }), cap = std({ color: 0xd8d8d8, roughness: 0.5 });
  mx.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.09, 0.4, 2, 0.012), body), 0, 0.045, 0));
  for (let c = 0; c < 4; c++) {
    const x = -0.105 + c * 0.07;
    for (let r = 0; r < 4; r++) mx.add(at(cyl(0.011, 0.012, 0.018, knob, 10), x, 0.099, 0.15 - r * 0.045));
    mx.add(at(box(0.012, 0.012, 0.022, cap), x, 0.096, -0.07 - (c % 2) * 0.03));
    for (let k = 0; k < 6; k++) mx.add(at(box(0.008, 0.002, 0.006, k > 4 ? amber : green), x + 0.022, 0.091, -0.02 - k * 0.011));
  }
  mx.add(at(box(0.024, 0.014, 0.012, cap), 0, 0.097, -0.15));
  g.add(at(mx, DECKS.mixer.x, TOP, DECKS.mixer.z));
  // headphones on the table beside the mixer, the laptop on its stand on the right, a bottle of water
  const phones = new THREE.Group();
  phones.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.01, 6, 20, Math.PI), M.black), 0, 0.02, 0, [Math.PI / 2, 0, 0]));
  for (const sx of [-1, 1]) phones.add(at(cyl(0.045, 0.045, 0.03, M.black, 14), sx * 0.085, 0.02, 0, [0, 0, Math.PI / 2]));
  g.add(at(phones, -0.75, TOP, 0.14, [0, 0.5, 0]));
  const stand = new THREE.Group(), lid = box(0.34, 0.22, 0.01, M.plastic);
  stand.add(at(box(0.26, 0.02, 0.24, M.alu), 0, 0.12, 0), at(box(0.02, 0.12, 0.02, M.alu), -0.1, 0.06, 0.08), at(box(0.02, 0.12, 0.02, M.alu), 0.1, 0.06, 0.08));
  stand.add(at(box(0.34, 0.015, 0.24, M.plastic), 0, 0.14, 0));
  lid.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.19), scr), 0, 0, -0.006, [0, Math.PI, 0]));
  stand.add(at(lid, 0, 0.25, 0.12, [0.3, 0, 0]));
  g.add(at(stand, -0.86, TOP, -0.02));
  g.add(at(cyl(0.035, 0.035, 0.22, M.bottle, 12), 0.85, TOP + 0.11, 0.15));
  return { group: g, t: front.t, set: (n: string) => front.set([n]) };
}

// The DJ in the booth's space (standing behind it). play(beat, excitement 0..1) moves them.
export function djPerson() {
  const p = new Person({ skin: 0xc98d68, shirt: 0x151518, pants: 0x1a1a1e, shoes: 0xeeeeea, hair: 0x161210, style: 'cap', hat: 0x101010, print: 'DJ' });
  p.group.position.set(0, 0, BOOTH.dj);
  p.group.updateMatrix();
  // (the person's own space: the booth's moved by where they stand)
  const own = (v: THREE.Vector3) => v.clone().add(V(0, 0, -BOOTH.dj));
  // where the right hand goes on the mixer, by two-bar phrase: the crossfader, the EQ, the filter
  const MOVES = [DECKS.fader, DECKS.eq[0], DECKS.filter, DECKS.eq[1]].map(own);
  const jog = own(DECKS.jog.L);
  const down = { fingers: V(0, -0.55, 1), palm: V(0, -1, 0) };
  let raised = 0;
  return {
    p,
    // how far the left hand is up (0 on the jog wheel, 1 in the air), for the tests
    raised: () => raised,
    play(b: number, e: number) {
      // the body: bent over the decks, knees bouncing on the beat (harder when it's loud), swaying
      const bob = (0.01 + 0.035 * e) * onBeat(b, 2);
      // (straighter with a hand in the air)
      raised = smooth((e - 0.72) / 0.14);
      p.lean({ x: 0.2 - 0.1 * raised + 0.04 * onBeat(b, 3) * e, z: 0.035 * Math.sin(Math.PI * b) * (0.4 + e), drop: 0.015 + bob });
      // the right hand on the mixer: a new control every two bars, sliding over in the last beat
      const phrase = b / 8, k = Math.floor(phrase), slide = smooth((frac(phrase) * 8 - 7));
      const a = MOVES[((k % 4) + 4) % 4], c = MOVES[(((k + 1) % 4) + 4) % 4], wig = 0.012 * Math.sin(b * Math.PI);
      const r = a.clone().lerp(c, slide).add(V(wig * (a === MOVES[0] ? 3 : 1), 0.012 + 0.04 * Math.sin(Math.PI * slide), 0));
      p.hold('R', r, { shape: 'open', ...down });
      // the left hand: on the jog wheel (nudging it round), up in the air on the drops, pumping on the beat
      const turn = b * 0.6, nudge = V(Math.cos(turn) * 0.035, 0.012, Math.sin(turn) * 0.035);
      const air = V(0.27, 1.88 + 0.05 * onBeat(b, 2), 0.22);
      const hand = jog.clone().add(nudge).lerp(air, raised);
      const fingers = down.fingers.clone().lerp(V(0, 1, 0.2), raised).normalize(), palm = down.palm.clone().lerp(V(0, 0.1, 1), raised).normalize();
      p.hold('L', hand, { shape: 'open', fingers, palm });
      // the head: nodding on the beat (banging on a drop), looking down at the decks
      p.head.rotation.x = 0.12 + (0.05 + 0.2 * e) * onBeat(b, 3) - 0.1 * raised;
      p.update();
    },
  };
}

// The beat as the frames see it: the engine's count moves in steps, so the DJ plays on a clock that
// runs on at the tempo between them and is pulled gently onto the count (a jump is taken as it is).
export function beatClock() {
  let clock = NaN, clockT = 0;
  return (t: number, beat: number) => {
    const dt = t - clockT; clockT = t;
    if (!(dt > 0 && dt < 0.1) || !Number.isFinite(clock)) return (clock = beat);
    clock += dt / crowdBeatLen();
    const err = beat - clock;
    if (Math.abs(err) > 0.25) clock = beat; else clock += err * 0.15;
    return clock;
  };
}
