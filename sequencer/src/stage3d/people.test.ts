// @vitest-environment happy-dom
// The people on the stage: a hand is at the end of its arm and where it was sent, the arm stays on
// its shoulder with its own length, and every vocal mic points at its singer's mouth while they sing.
// The band plays like a band: the fretting hand round the guitar's neck (wrist under it, sliding
// to the next chord), the strumming hand across the strings, the drummer's sticks in his fists with
// their tips on the drums on the hits, his feet on the pedals (the kick on the beat), his arms whole
// and out of his body, nobody's wrist bent back; more of it when it's loud, all of it on the beat.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { aimHand, ARM, GRIP, Person, SHOULDER, twoBone, type HandShape } from './people';
import { buildVenue, KIT, PEDAL, type Venue } from './venue';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
// Play a moment. (Time steps back each call: the band takes the beat as given, not carried on at the
// tempo, and the crowd's excitement is the energy's at once.)
let clock = 0;
const play = (v: Venue, beat: number, energy: number) => { clock -= 1; v.animate(clock, beat, energy, new THREE.Color(1, 1, 1)); v.group.updateMatrixWorld(true); };
// the torso's outline (people.ts torsoGeo: radius by height), squashed front to back: how deep a
// point (in the body's own frame) is inside it (< 0: outside)
const PROF = [[0.84, 0.12], [0.9, 0.165], [0.96, 0.176], [1.01, 0.168], [1.06, 0.166], [1.14, 0.168], [1.22, 0.178], [1.3, 0.19], [1.37, 0.196], [1.42, 0.19], [1.465, 0.165], [1.5, 0.115]];
const radius = (y: number) => { for (let i = 1; i < PROF.length; i++) if (y <= PROF[i][0]) { const [y0, r0] = PROF[i - 1], [y1, r1] = PROF[i]; return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0); } return 0; };
const inTorso = (b: THREE.Vector3) => { const r = radius(b.y); return r <= 0 ? -1 : r - Math.hypot(b.x, b.z / 0.64); };
// a wrist: how far the hand is bent towards its palm (+) or back (-) from the forearm's line, and
// sideways (towards the thumb +) (degrees)
const wristOf = (p: Person, s: 'L' | 'R') => {
  const M = p.handMatrix(s), F = V(0, -1, 0).transformDirection(M), N = V(0, 0, -1).transformDirection(M), T = V(s === 'R' ? 1 : -1, 0, 0).transformDirection(M);
  const fa = p.handAt(s).sub(p.arms[s].elbow().applyMatrix4(p.body.matrix)).normalize();
  return { flex: (Math.atan2(-fa.dot(N), fa.dot(F)) * 180) / Math.PI, side: (Math.asin(Math.max(-1, Math.min(1, fa.dot(T)))) * 180) / Math.PI };
};

it('two bones reach a target in range exactly, keep their lengths, and bend towards the pole', () => {
  const S = V(0.2, 1.43, 0);
  for (const T of [V(0.3, 1.0, 0.3), V(-0.05, 1.2, 0.38), V(0.45, 1.5, 0.2), V(0.2, 0.95, 0.05)]) {
    const E = twoBone(S, T, ARM.a, ARM.b, V(0.6, -0.4, -0.7));
    expect(E.distanceTo(S)).toBeCloseTo(ARM.a, 6);
    expect(E.distanceTo(T)).toBeCloseTo(ARM.b, 6);
    // the elbow is on the pole's side of the line shoulder -> hand
    const dir = T.clone().sub(S).normalize(), off = E.clone().sub(S).addScaledVector(dir, -E.clone().sub(S).dot(dir));
    expect(off.dot(V(0.6, -0.4, -0.7))).toBeGreaterThan(0);
  }
  // out of reach: stretched straight at it
  const far = V(1.5, 1.43, 0), E = twoBone(S, far, ARM.a, ARM.b, V(0, -1, 0));
  expect(E.distanceTo(S)).toBeCloseTo(ARM.a, 4);
  expect(E.y).toBeCloseTo(1.43, 1);
});

it("a person's hands go where they are sent, at the end of arms that stay on the shoulders", () => {
  const p = new Person({ skin: 0xd0a080, shirt: 0x223344, pants: 0x111111, shoes: 0x222222, hair: 0x332211, style: 'short' });
  p.body.position.y = -0.03; p.body.rotation.x = 0.08;
  const want = { L: V(0.3, 1.1, 0.3), R: V(-0.25, 1.25, 0.35) };
  p.hand('L', want.L); p.hand('R', want.R); p.update();
  for (const s of ['L', 'R'] as const) {
    expect(p.handAt(s).distanceTo(want[s])).toBeLessThan(0.001);
    // the arm's root is the shoulder on the body (wherever the body leans)
    const sh = V(s === 'L' ? SHOULDER.x : -SHOULDER.x, SHOULDER.y, SHOULDER.z).applyMatrix4(p.body.matrix);
    const root = p.arms[s].root.position.clone().applyMatrix4(p.body.matrix);
    expect(root.distanceTo(sh)).toBeLessThan(1e-6);
    // the hand mesh hangs off the wrist, the forearm off the elbow
    expect(p.arms[s].end.children.length).toBeGreaterThan(0);
    expect(p.arms[s].joint.children).toContain(p.arms[s].end);
  }
});

describe('the band', () => {
  const v = buildVenue({ crowd: 20 });
  for (const [beat, energy] of [[0, 0], [2.3, 0.6], [15.75, 1], [31.2, 0.9]]) {
    it(`hands where they were sent, mics at the mouths of whoever sings (beat ${beat}, energy ${energy})`, () => {
      play(v, beat, energy);
      expect(v.band.length).toBe(5);
      for (const p of v.band) for (const s of ['L', 'R'] as const) {
        // (the drummer stretches a little for the hi-hat across the kit)
        expect(p.handAt(s).distanceTo(p.hands[s]), `${s} hand`).toBeLessThan(0.04);
      }
      expect(v.mics.length).toBe(4);
      for (const m of v.mics) if (m.singing?.()) expectAtMouth(m);
    });
  }
  it('without music the band stands still where the last bar began, not miming; with it they play again', () => {
    const hands = () => v.band.flatMap((p) => (['L', 'R'] as const).map((s) => p.handAt(s)));
    const still = (beat: number) => { clock -= 1; v.animate(clock, beat, 1, new THREE.Color(1, 1, 1), false); v.group.updateMatrixWorld(true); return hands(); };
    const a = still(9.3), b = still(9.8), c = still(11.4);
    for (let i = 0; i < a.length; i++) { expect(a[i].distanceTo(b[i])).toBeLessThan(1e-6); expect(a[i].distanceTo(c[i])).toBeLessThan(1e-6); }
    // (the music back: the hands move with the beat again)
    play(v, 12, 1); const d = hands(); play(v, 12.5, 1); const e = hands();
    expect(Math.max(...d.map((h, i) => h.distanceTo(e[i])))).toBeGreaterThan(0.03);
  });
  it('every mic is sung into, on bar lines; when it gets loud the singer steps back from hers for the end of a phrase and is back for the next', () => {
    for (const energy of [0.2, 0.6, 0.95]) {
      const sung = v.mics.map(() => 0), away: number[] = [];
      for (let beat = 0; beat < 64; beat += 0.125) {
        play(v, beat, energy);
        v.mics.forEach((m, i) => { if (m.singing!()) { sung[i]++; expectAtMouth(m); } });
        if (!v.mics[0].singing!()) away.push(beat % 32);
      }
      for (const n of sung) expect(n, `energy ${energy}`).toBeGreaterThan(40);
      // (the singer sings bars 1 to 6 of every 8, the others along in bars 5 and 6)
      if (energy < 0.3) expect(away).toEqual([]);
      else { expect(Math.min(...away)).toBeGreaterThanOrEqual(24); expect(Math.max(...away)).toBeLessThan(32); expect(away.length).toBeGreaterThan(80); }
    }
  });
  it('more when it is loud: the singer jumps (landing on the beat) and the guitar players bang their heads on the beat, still on their mics in the chorus', () => {
    const singer = v.mics[0].person!, gtr = v.strummers[0].p;
    const lift = (beat: number, e: number) => { play(v, beat, e); return Math.min(singer.legs.L.tip().y, singer.legs.R.tip().y) - 0.085; };
    // stepped back in bar 7: in the air between beats when it's loud, on the floor on them; not when it's calm
    let up = 0; for (let b = 26; b < 30; b += 0.05) up = Math.max(up, lift(b, 1));
    expect(up).toBeGreaterThan(0.08);
    for (const b of [26, 27, 28, 29]) expect(lift(b, 1), `on the floor on beat ${b}`).toBeLessThan(0.01);
    let calm = 0; for (let b = 26; b < 30; b += 0.05) calm = Math.max(calm, lift(b, 0.2));
    expect(calm).toBeLessThan(0.01);
    // the guitarist's nod: bigger when loud, down on the beat (bars 1 to 4: away from the mic)
    const nod = (e: number) => { let lo = 9, hi = -9; for (let b = 4; b < 6; b += 0.05) { play(v, b, e); lo = Math.min(lo, gtr.head.rotation.x); hi = Math.max(hi, gtr.head.rotation.x); } return hi - lo; };
    expect(nod(1)).toBeGreaterThan(0.3); expect(nod(0.2)).toBeLessThan(0.12);
    play(v, 5, 1); const onIt = gtr.head.rotation.x; play(v, 5.5, 1); expect(onIt).toBeGreaterThan(gtr.head.rotation.x + 0.2);
  });
  function expectAtMouth({ stand, person }: Venue['mics'][number]) {
    const mic = stand.userData.mic as THREE.Object3D;
    const head = new THREE.Vector3().setFromMatrixPosition(mic.matrixWorld);
    const axis = new THREE.Vector3(0, 1, 0).transformDirection(mic.matrixWorld);
    const mouth = person!.mouth().applyMatrix4(person!.group.matrixWorld);
    const to = mouth.clone().sub(head);
    expect(to.length(), 'grille to mouth').toBeLessThan(0.12);
    // (within 25 degrees: they move a little while they sing)
    expect(axis.dot(to.normalize()), 'points at the mouth').toBeGreaterThan(0.9);
  }
});

it('a hand holds things where it is told: the middle of its grip on the point, what it holds along the axis given, the palm the way asked', () => {
  const p = new Person({ skin: 0xd0a080, shirt: 0x223344, pants: 0x111111, shoes: 0x222222, hair: 0x332211, style: 'short' });
  for (const shape of ['fist', 'fret'] as HandShape[]) for (const s of ['L', 'R'] as const) {
    const at = V(s === 'L' ? 0.25 : -0.25, 1.05, 0.3), axis = V(s === 'L' ? -0.3 : 0.3, -0.2, 1).normalize(), palm = V(0, -1, 0);
    p.hold(s, at, { shape, axis, palm }); p.update();
    expect(p.gripAt(s).distanceTo(at), `${shape} ${s} grip`).toBeLessThan(1e-3);
    const M = p.handMatrix(s), held = (s === 'L' ? V(-GRIP[shape].axis.x, GRIP[shape].axis.y, 0) : GRIP[shape].axis.clone()).transformDirection(M);
    expect(held.dot(axis), `${shape} ${s} axis`).toBeGreaterThan(0.999);
    expect(V(0, 0, -1).transformDirection(M).dot(palm), `${shape} ${s} palm`).toBeGreaterThan(0.85);
    // the left hand is the right one mirrored: its thumb on the other side of the fingers
    const q = aimHand(s, { shape, axis, palm }), F = V(0, -1, 0).applyQuaternion(q), N = V(0, 0, -1).applyQuaternion(q), thumb = V(s === 'L' ? -1 : 1, 0, 0).applyQuaternion(q);
    expect(F.clone().cross(N).dot(thumb), `${s} thumb side`).toBeCloseTo(s === 'R' ? 1 : -1, 6);
  }
});

it('every hand shape faces out on both sides (the left hand is the right one mirrored, its triangles turned round)', () => {
  const p = new Person({ skin: 0xd0a080, shirt: 0x223344, pants: 0x111111, shoes: 0x222222, hair: 0x332211, style: 'short' });
  for (const shape of ['open', 'fist', 'fret'] as HandShape[]) for (const s of ['L', 'R'] as const) {
    p.hand(s, V(0, 1, 0.3), { shape, fingers: V(0, -1, 0), palm: V(0, 0, -1) });
    const g = (p.arms[s].end.children[0] as THREE.Mesh).geometry, pos = g.attributes.position, nor = g.attributes.normal;
    let out = 0, n = 0;
    const a = V(0, 0, 0), b = V(0, 0, 0), c = V(0, 0, 0), m = V(0, 0, 0);
    for (let i = 0; i + 2 < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
      const face = b.clone().sub(a).cross(c.clone().sub(a));
      if (face.lengthSq() < 1e-14) continue;
      m.fromBufferAttribute(nor, i).add(V(0, 0, 0).fromBufferAttribute(nor, i + 1)).add(V(0, 0, 0).fromBufferAttribute(nor, i + 2));
      n++; if (face.dot(m) > 0) out++;
    }
    expect(out / n, `${shape} ${s}`).toBeGreaterThan(0.98);
    // and the thumb's on its own side: +x for the right hand, -x for the left
    let tx = 0; for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i)) > 0.045) tx += Math.sign(pos.getX(i));
    expect(Math.sign(tx), `${shape} ${s} thumb`).toBe(s === 'R' ? 1 : -1);
  }
});

for (const room of ['hall', 'pub'] as const) describe(`the band in the ${room === 'hall' ? 'hall' : 'pub'}`, () => {
  const v = buildVenue({ crowd: 10, room });
  const toGuitar = (g: Venue['strummers'][number]) => g.p.body.matrix.clone().multiply(g.guitar.matrix).invert();

  it("the guitar and bass players' left hand holds the neck: its grip on the neck, fingers on the fretboard, the wrist under it, moving to the next chord at bar lines", () => {
    expect(v.strummers.length).toBe(2);
    for (const g of v.strummers) for (const energy of [0.2, 0.9]) {
      const along: number[] = [];
      for (let beat = 0; beat < 16; beat += 0.125) {
        play(v, beat, energy);
        const G = toGuitar(g), grip = g.p.gripAt('L').applyMatrix4(G), wrist = g.p.handAt('L').applyMatrix4(G);
        // (the neck runs along the guitar's y, its middle at x 0, z 0.03; the strings at z 0.045, the
        // high ones at +x: the bottom edge as it's played)
        expect(Math.hypot(grip.x, grip.z - 0.03), 'grip on the neck').toBeLessThan(0.02);
        expect(grip.y, 'on the neck, not the body').toBeGreaterThan(0.32 + 0.05);
        expect(grip.y).toBeLessThan(0.32 + (g.guitar.userData.neck as number));
        expect(wrist.x, 'the wrist under the neck').toBeGreaterThan(0.05);
        // the fingertips (the hooked fingers' ends) over the fretboard
        const tip = V(g.p === v.strummers[0].p ? 0 : 0, -0.124, -0.05).applyMatrix4(g.p.handMatrix('L')).applyMatrix4(G);
        expect(Math.abs(tip.x), 'fingertips across the fretboard').toBeLessThan(0.03);
        expect(tip.z, 'fingertips on the fretboard').toBeGreaterThan(0.035); expect(tip.z).toBeLessThan(0.07);
        // a wrist players can hold
        const w = wristOf(g.p, 'L');
        expect(w.flex, 'fretting wrist').toBeLessThan(75); expect(Math.abs(w.side)).toBeLessThan(40);
        along.push(grip.y);
        // (between chords the hand stays put: it only slides in the last quarter beat of a bar)
        if (beat % 4 < 3.75 && along.length > 1 && beat % 4 > 0) expect(Math.abs(grip.y - along[along.length - 2]), `still at beat ${beat}`).toBeLessThan(0.005);
      }
      expect(Math.max(...along) - Math.min(...along), 'up and down the neck').toBeGreaterThan(0.03);
    }
  });

  it('the strumming hand works across the strings over the pickups (down on the beat, up between), hardly along them', () => {
    for (const g of v.strummers) for (const energy of [0.2, 0.9]) {
      const x: number[] = [], y: number[] = [];
      for (let beat = 8; beat < 9; beat += 1 / 32) {
        play(v, beat, energy);
        const r = g.p.gripAt('R').applyMatrix4(toGuitar(g)); x.push(r.x); y.push(r.y);
        // over the guitar's top, not in it
        expect(r.z).toBeGreaterThan(0.06);
        const w = wristOf(g.p, 'R'); expect(Math.abs(w.flex)).toBeLessThan(45); expect(Math.abs(w.side)).toBeLessThan(40);
      }
      const across = Math.max(...x) - Math.min(...x), along = Math.max(...y) - Math.min(...y);
      expect(across, `${g.bass ? 'bass' : 'guitar'} across`).toBeGreaterThan(g.bass ? 0.02 : 0.06);
      expect(along).toBeLessThan(0.1 * across);
      // over the strings (they're at x -0.015 .. 0.015): the hand passes them both ways
      expect(Math.min(...x)).toBeLessThan(-0.015); expect(Math.max(...x)).toBeGreaterThan(0.015);
      // down (towards the high strings) through them on the beat, back up on the "and"
      expect(x[1]).toBeGreaterThan(x[0]); expect(x[17]).toBeLessThan(x[16]);
    }
  });

  it("the drummer's arms are whole through a bar and a fill: both pieces there, their own lengths, not in his body", () => {
    const d = v.drums.p;
    for (const s of ['L', 'R'] as const) {
      // (nothing of an arm baked into the stage: every piece still hangs off its joint and moves)
      const c = d.arms[s];
      for (const j of [c.root, c.joint, c.end]) expect(j.children.some((o) => (o as THREE.Mesh).isMesh && o.visible && o.matrixAutoUpdate), `${s} piece`).toBe(true);
    }
    const last: Partial<Record<'L' | 'R', THREE.Quaternion>> = {};
    for (const energy of [0.2, 0.6, 1]) for (let beat = 12; beat < 20; beat += 1 / 64) {
      play(v, beat, energy);
      for (const s of ['L', 'R'] as const) {
        // the hand turns smoothly: never flips over from one moment to the next
        const q = new THREE.Quaternion().setFromRotationMatrix(d.handMatrix(s));
        // (a quick stroke turns it some 10 to 20 degrees in a 64th of a beat; a flip would be 90 or more)
        if (last[s] && beat > 12) expect((q.angleTo(last[s]!) * 180) / Math.PI, `${s} hand turned at ${beat}`).toBeLessThan(25);
        last[s] = q;
        const c = d.arms[s], sh = c.root.position.clone(), el = c.elbow(), wr = c.tip();          // (the body's frame)
        expect(el.distanceTo(sh), `${s} upper arm at ${beat}`).toBeCloseTo(ARM.a, 4);
        expect(wr.distanceTo(el), `${s} forearm at ${beat}`).toBeCloseTo(ARM.b, 4);
        // the elbow and the upper arm out from the shoulder: outside the chest
        for (let k = 4; k <= 10; k++) expect(inTorso(sh.clone().lerp(el, k / 10)), `${s} upper arm in the body at ${beat}`).toBeLessThan(-0.01);
        for (let k = 0; k <= 10; k++) expect(inTorso(el.clone().lerp(wr, k / 10)), `${s} forearm in the body at ${beat}`).toBeLessThan(-0.01);
        expect(d.handAt(s).distanceTo(d.hands[s])).toBeLessThan(1e-3);
        const w = wristOf(d, s);
        expect(Math.abs(w.flex), `${s} wrist at ${beat}`).toBeLessThan(35); expect(Math.abs(w.side), `${s} wrist sideways at ${beat}`).toBeLessThan(50);
      }
    }
  });

  it('the sticks come out of his fists forward and in, their tips on the drums on every hit and up off them between', () => {
    const d = v.drums.p, tipOf = (s: 'L' | 'R') => V(0, 0.29, 0).applyMatrix4(v.drums.sticks[s].matrixWorld);
    const head = (drum: string) => v.drums.tips[drum].clone().applyMatrix4(d.group.matrixWorld);
    for (const s of ['L', 'R'] as const) expect(v.drums.sticks[s].parent, 'in the hand').toBe(d.arms[s].end);
    for (const energy of [0.2, 0.9]) for (const bar of [3, 4, 5]) {
      play(v, bar * 4 - 0.01, energy);
      const h = v.drums.hits(bar);
      expect(h.R.length).toBeGreaterThanOrEqual(6); expect(h.L.length).toBeGreaterThanOrEqual(1);
      for (const s of ['L', 'R'] as const) for (const [b, drum] of h[s]) {
        play(v, bar * 4 + b, energy);
        expect(tipOf(s).distanceTo(head(drum)), `${s} on the ${drum} at ${bar}:${b}`).toBeLessThan(0.015);
        // the stick from the middle of the fist (the grip) to the tip
        const grip = d.gripAt(s).applyMatrix4(d.group.matrixWorld);
        expect(grip.distanceTo(V(0, 0, 0).applyMatrix4(v.drums.sticks[s].matrixWorld))).toBeLessThan(1e-3);
        // forward, and in towards the middle (the snare: the left stick from the left)
        const dir = tipOf(s).sub(grip).normalize().transformDirection(d.group.matrixWorld.clone().invert());
        expect(dir.z, `${s} forward`).toBeGreaterThan(0.2);
        if (drum === 'snare' && s === 'L') expect(dir.x, 'in').toBeLessThan(0);
      }
      // the snare's backbeat stick, half way between its hits: up off the head
      play(v, bar * 4 + 2, energy);
      if (bar % 4 !== 3) expect(tipOf('L').distanceTo(head('snare')), 'up between hits').toBeGreaterThan(0.04);
    }
  });

  it("his right foot works the kick pedal (down on each kick: beats 1 and 3, every beat when it's loud), the left one sits on the hi-hat's; the balls of his feet stay on them", () => {
    const d = v.drums.p, kit = d.group.parent!;
    const ball = (s: 'L' | 'R') => V(0, -0.089, 0.11).applyMatrix4(d.legs[s].end.matrixWorld);
    // (a bar's hits are settled the first time it's played: a fresh bar for each energy)
    for (const [energy, bar, kicks] of [[0.2, 30, [0, 2]], [0.95, 40, [0, 1, 2, 3]]] as const) {
      play(v, bar * 4 - 0.01, energy);
      expect(v.drums.hits(bar).kick.map(([b]) => b)).toEqual(kicks);
      for (let beat = bar * 4; beat < bar * 4 + 4; beat += 1 / 16) {
        play(v, beat, energy);
        expect(ball('R').distanceTo(v.drums.kick.ball().applyMatrix4(d.group.matrixWorld)), 'on the kick pedal').toBeLessThan(0.01);
        expect(ball('L').distanceTo(v.drums.hat.ball().applyMatrix4(d.group.matrixWorld)), 'on the hi-hat pedal').toBeLessThan(0.01);
        const onKick = kicks.some((k) => Math.abs((beat % 4) - k) < 1e-6);
        if (onKick) {
          expect(v.drums.pedals.kick, `board down on ${beat}`).toBeCloseTo(PEDAL.down, 3);
          // the beater on the drum's back head
          const felt = V(0, 0.19, 0).applyMatrix4(v.drums.kick.beater.matrixWorld).applyMatrix4(kit.matrixWorld.clone().invert());
          expect(Math.abs(felt.z - (-0.12 - 0.028)), 'beater on the head').toBeLessThan(0.01);
        }
      }
      // half a beat after a kick (with no kick there) the board has come back up
      play(v, bar * 4 + (energy < 0.5 ? 1 : 0.5), energy);
      expect(v.drums.pedals.kick).toBeGreaterThan(PEDAL.down + 0.1);
    }
    // the hi-hat: shut under the foot, opening on the off-beats when it's loud
    play(v, 21, 1); const shut = v.drums.hat.top.position.y; play(v, 21.5, 1);
    expect(v.drums.hat.top.position.y).toBeGreaterThan(shut + 0.01);
    play(v, 21.5, 0.2); expect(v.drums.hat.top.position.y).toBeCloseTo(shut, 4);
    expect(shut).toBeCloseTo(KIT.hat.y + 0.014, 3);
  });
});

describe('faces stay free', () => {
  const styles = ['short', 'long', 'bun', 'curly', 'mohawk', 'shaved', 'beanie', 'cap'] as const;
  const firstHit = (p: Person, x: number, y: number) => {
    p.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(V(x, y, 1), V(0, 0, -1));
    const h = ray.intersectObject(p.group, true).find((i) => (i.object as THREE.Mesh).isMesh);
    return h ? ((h.object as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex() : -1;
  };
  for (const style of styles) for (const beard of [false, true]) {
    it(`${style}${beard ? ' with a beard' : ''}: eyes, nose and mouth aren't under hair or a hat`, () => {
      const p = new Person({ skin: 0xd0a080, shirt: 0x223344, pants: 0x111111, shoes: 0x222222, hair: 0x332211, style, beard, hat: 0x445566 });
      for (const sx of [-1, 1]) {
        // looking at each eye from the front: the eye (white or iris) is what's seen first
        expect([0xf4f1ea, 0x2a1c12], `${style} eye ${sx}`).toContain(firstHit(p, sx * 0.034, 1.7));
      }
      expect(firstHit(p, 0, 1.618), `${style} mouth`).toBe(0x7a3a34);
      expect(firstHit(p, 0, 1.672), `${style} nose`).toBe(0xd0a080);
    });
  }
});

describe('guitars hang in front of their players', () => {
  // the torso's outline (people.ts torsoGeo), squashed front to back
  const PROF = [[0.84, 0.12], [0.9, 0.165], [0.96, 0.176], [1.01, 0.168], [1.06, 0.166], [1.14, 0.168], [1.22, 0.178], [1.3, 0.19], [1.37, 0.196], [1.42, 0.19], [1.465, 0.165], [1.5, 0.115]];
  const radius = (y: number) => { for (let i = 1; i < PROF.length; i++) if (y <= PROF[i][0]) { const [y0, r0] = PROF[i - 1], [y1, r1] = PROF[i]; return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0); } return 0; };
  const segDist = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => { const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return p.distanceTo(a.clone().addScaledVector(ab, t)); };
  const v = buildVenue({ crowd: 10 });
  for (const beat of [0, 0.25, 0.5, 2.1, 7.75]) {
    it(`not in the body, not through an arm (beat ${beat})`, () => {
      v.animate(beat * 0.5, beat, 1, new THREE.Color(1, 1, 1));
      v.group.updateMatrixWorld(true);
      // (a guitar hangs on its player's body: it leans with it)
      const players = v.band.filter((p) => p.body.children.some((c) => c.userData.neck));
      expect(players.length).toBe(2);
      for (const p of players) {
        const gt = p.body.children.find((c) => c.userData.neck)!, bodyMesh = gt.children[0] as THREE.Mesh;
        p.body.updateMatrix(); gt.updateMatrix();
        const pos = bodyMesh.geometry.attributes.position, local: THREE.Vector3[] = [];
        for (let i = 0; i < pos.count; i += 3) local.push(V(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(bodyMesh.matrix).applyMatrix4(gt.matrix));
        const pts = local.map((q) => q.clone().applyMatrix4(p.body.matrix));
        // in the torso? (in the body's own frame)
        const inTorso = local.filter((b) => { const r = radius(b.y); return r > 0 && b.x * b.x + (b.z / 0.64) ** 2 < r * r; });
        expect(inTorso.length, 'guitar body points inside the torso').toBe(0);
        // through an upper arm or a forearm? Points along each, in the guitar's own frame: inside its
        // outline and within its thickness (plus the arm's radius) is through it; resting over its
        // edge, in front of the top, is how you play
        const toGuitar = p.body.matrix.clone().multiply(gt.matrix).multiply(bodyMesh.matrix).invert();
        const outline = (bodyMesh.geometry as THREE.ExtrudeGeometry).parameters.shapes as THREE.Shape;
        const poly = outline.getPoints(24);
        const inside = (x: number, y: number) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
        for (const s of ['L', 'R'] as const) {
          const c = p.arms[s], sh = c.root.position.clone().applyMatrix4(p.body.matrix), el = c.elbow().applyMatrix4(p.body.matrix), wr = p.handAt(s);
          const through: string[] = [];
          for (const [a, b, r, name] of [[sh, el, 0.047, 'upper arm'], [el, wr, 0.037, 'forearm']] as const) for (let k = 0; k <= 12; k++) {
            const q = a.clone().lerp(b, k / 12).applyMatrix4(toGuitar);
            if (inside(q.x, q.y) && q.z > -0.008 - r && q.z < 0.053 + r) through.push(`${name} ${k}/12 (${q.x.toFixed(3)}, ${q.y.toFixed(3)}, ${q.z.toFixed(3)})`);
          }
          expect(through, `${s} arm through the guitar`).toEqual([]);
        }
        void segDist; void pts;
      }
    });
  }
});
