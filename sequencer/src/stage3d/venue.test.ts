// @vitest-environment happy-dom
// The venue: it builds with a small crowd, nothing in it is NaN, the crowd has what it should, every
// arm stays on its shoulder with the hand at the end of the forearm whatever the shader does to it,
// what hands hold is in the hands, people jump like people (and more of them when it's loud; arms go
// up and heads bang on the beat on the hard parts), the drum mics point into their drums, the crew's
// hands are on their desks, and the static parts end up in a few dozen meshes.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildVenue, PUB } from './venue';
import { onDeck, ROOMS } from './geometry';
import { CROWD_POLE, CROWD_RIDER, crowdMotion, crowdTurn, flagArm, flagSwing, flagTurn, type Motion } from './crowd';
import { ARM, SHOULDER } from './people';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const v = buildVenue({ crowd: 80 });
v.group.updateMatrixWorld(true);
const crowd = v.crowd;
const inst = (name: string) => crowd.parts.get(name)!;
const matrixAt = (name: string, i: number) => { const m = new THREE.Matrix4(); inst(name).getMatrixAt(i, m); return m; };
// a crowd instance's own motion numbers, as the shader reads them
function motionOf(name: string, i: number): Motion {
  const g = inst(name).geometry, a = g.attributes.aAnim as THREE.InstancedBufferAttribute, j = g.attributes.aJump as THREE.InstancedBufferAttribute;
  const part = (inst(name).material as THREE.Material).userData.part;
  return { phase: a.getX(i), keen: a.getY(i), amp: a.getZ(i), off: a.getW(i), h: j.getX(i), period: j.getY(i), bob: j.getZ(i), motion: part.uMotion.value as 0 | 1 | 2, raise: part.uRaise.value === 1 };
}
// the vertices of a range of a geometry (or the second pose's), as points
function points(g: THREE.BufferGeometry, [start, count]: [number, number], attr = 'position') {
  const p = g.attributes[attr] as THREE.BufferAttribute; return Array.from({ length: count }, (_, k) => V(p.getX(start + k), p.getY(start + k), p.getZ(start + k)));
}
const centroid = (ps: THREE.Vector3[]) => ps.reduce((a, b) => a.add(b), V(0, 0, 0)).multiplyScalar(1 / ps.length);

it('builds with a small crowd, and nothing in it is NaN', () => {
  let meshes = 0, bad = 0;
  v.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    for (const k of ['position', 'normal']) { const a = m.geometry.attributes[k]; if (a) for (let i = 0; i < a.array.length; i++) if (!Number.isFinite(a.array[i])) bad++; }
    if ((m as THREE.InstancedMesh).isInstancedMesh) for (const x of (m as THREE.InstancedMesh).instanceMatrix.array) if (!Number.isFinite(x)) bad++;
  });
  expect(meshes).toBeGreaterThan(100);
  expect(bad).toBe(0);
  expect(v.crowdCount).toBe(80);
});

it('the crowd: everyone has a body, a head and two arms; phones, flags and someone on shoulders', () => {
  for (const f of crowd.fans) for (const k of ['torso', 'legs', 'head', 'armL', 'armR']) expect(f.at[k], k).toBeDefined();
  // every instance belongs to exactly one person
  const used = new Map<string, number>();
  for (const f of crowd.fans) for (const [name] of Object.values(f.at)) used.set(name, (used.get(name) ?? 0) + 1);
  for (const [name, n] of used) expect(inst(name).count, name).toBe(n);
  expect(crowd.fans.filter((f) => f.arms.L === 'phone' || f.arms.R === 'phone').length).toBe((crowd.parts.get('phone:L')?.count ?? 0) + (crowd.parts.get('phone:R')?.count ?? 0));
  expect(crowd.fans.some((f) => f.flag)).toBe(true);
  expect(crowd.fans.some((f) => f.rider !== undefined)).toBe(true);
  // a mix of hair, hats, legs and shirts
  expect(new Set(crowd.fans.map((f) => f.hair)).size).toBeGreaterThanOrEqual(4);
  expect(new Set(crowd.fans.map((f) => f.pants)).size).toBe(3);
  expect(crowd.fans.some((f) => f.hat === 'cap') && crowd.fans.some((f) => f.hat === 'beanie')).toBe(true);
  expect(new Set(crowd.fans.map((f) => f.shirt)).size).toBeGreaterThan(15);
});

describe('arms', () => {
  const arms = [...crowd.parts.keys()].filter((k) => k.startsWith('arm:'));
  it('every pose: the shoulder stays at the shoulder and the hand at the wrist, turned and reaching as the shader does', () => {
    expect(arms.length).toBeGreaterThan(8);
    for (const name of arms) {
      const mesh = inst(name), g = mesh.geometry, marks = g.userData.marks as Record<string, [number, number]>, turnX = (mesh.material as THREE.Material).userData.part.uTurnX.value === 1;
      let amp = 0; for (let i = 0; i < mesh.count; i++) amp = Math.max(amp, Math.abs(motionOf(name, i).amp));
      const max = 1.25 * amp, raise = (mesh.material as THREE.Material).userData.part.uRaise.value === 1;
      // (an arm that goes up on the loud parts turns up to 2.85 radians about its shoulder)
      for (const reach of g.attributes.aPos2 ? [0, 0.5, 1] : [0]) for (const a of [0, max / 2, max, -max / 2, -max, ...(raise ? [-1.3, -2.55 - max, -2.85 - max] : [])]) {
        const at = (r: [number, number]) => { const p = points(g, r), q = g.attributes.aPos2 ? points(g, r, 'aPos2') : p; return p.map((x, k) => crowdTurn(x.clone().lerp(q[k], reach), a, turnX)); };
        const sh = centroid(at(marks.shoulder)), wrist = centroid(at(marks.wrist)), hand = at(marks.hand), hc = centroid(hand.map((x) => x.clone()));
        expect(sh.length(), `${name} shoulder (reach ${reach}, turn ${a.toFixed(2)})`).toBeLessThan(0.02);
        const d = hc.distanceTo(wrist);
        expect(d, `${name} hand at the wrist`).toBeGreaterThan(0.02); expect(d, `${name} hand at the wrist`).toBeLessThan(0.08);
        for (const p of hand) expect(p.distanceTo(wrist), `${name} hand in one piece`).toBeLessThan(0.13);
        // the forearm reaches from the elbow to the wrist: about its length from the shoulder at most
        expect(wrist.length(), `${name} arm length`).toBeLessThan(ARM.a + ARM.b + 0.01);
      }
    }
  });
  it('every arm sits on its own body: its shoulder at the torso, at every moment of the motion', () => {
    for (const [i, f] of crowd.fans.entries()) for (const side of ['L', 'R'] as const) {
      const [name, k] = f.at[`arm${side}`], m = matrixAt(name, k), root = V(0, 0, 0).applyMatrix4(m);
      const sx = side === 'L' ? 1 : -1, want = V(sx * (0.19 * f.girth + 0.01), SHOULDER.y, SHOULDER.z).applyMatrix4(crowd.frame(i));
      expect(root.distanceTo(want), `fan ${i} ${side}`).toBeLessThan(0.02);
      // and that point is on the shirt: within a shoulder ball of the torso's surface
      const [tn, tk] = f.at.torso, tm = matrixAt(tn, tk), tp = inst(tn).geometry.attributes.position as THREE.BufferAttribute;
      let near = Infinity; for (let j = 0; j < tp.count; j++) near = Math.min(near, V(tp.getX(j), tp.getY(j), tp.getZ(j)).applyMatrix4(tm).distanceTo(root));
      expect(near, `fan ${i} ${side} shoulder on the body`).toBeLessThan(0.062 * f.s + 0.02);
      // the body and the arm move up and down together: the same motion numbers in both
      const a = motionOf(tn, tk), b = motionOf(name, k);
      for (const [beat, e] of [[0.1, 0.2], [3.55, 1], [7.9, 0.7]]) {
        const ma = crowdMotion(a, beat * 0.5, beat, e), mb = crowdMotion(b, beat * 0.5, beat, e);
        expect(ma.lift - ma.bend).toBeCloseTo(mb.lift - mb.bend, 9);
      }
    }
  });
  it('what hands hold is in the hands: phones, flag poles, the shins of whoever sits on the shoulders', () => {
    const handOf = (f: (typeof crowd.fans)[number], side: 'L' | 'R') => {
      const [name, k] = f.at[`arm${side}`], g = inst(name).geometry;
      return centroid(points(g, (g.userData.marks as Record<string, [number, number]>).hand)).applyMatrix4(matrixAt(name, k));
    };
    let phones = 0, flags = 0, riders = 0;
    for (const [i, f] of crowd.fans.entries()) {
      for (const side of ['L', 'R'] as const) if (f.arms[side] === 'phone') {
        const [pn, pk] = f.at[`phone${side}`], pg = inst(pn).geometry, pp = pg.attributes.position as THREE.BufferAttribute;
        const c = centroid(Array.from({ length: pp.count }, (_, j) => V(pp.getX(j), pp.getY(j), pp.getZ(j)))).applyMatrix4(matrixAt(pn, pk));
        expect(c.distanceTo(handOf(f, side)), 'phone in the hand').toBeLessThan(0.08); phones++;
      }
      if (f.flag) {
        const F = crowd.frame(i), a = V(CROWD_POLE.x, CROWD_POLE.y0, CROWD_POLE.z).applyMatrix4(F), b = V(CROWD_POLE.x, CROWD_POLE.y1, CROWD_POLE.z).applyMatrix4(F);
        const line = new THREE.Line3(a, b);
        for (const side of ['L', 'R'] as const) expect(line.closestPointToPoint(handOf(f, side), true, V(0, 0, 0)).distanceTo(handOf(f, side)), 'hand on the pole').toBeLessThan(0.05);
        flags++;
      }
      if (f.rider !== undefined) {
        // the shins hang from the rider's knees to its ankles (its legs geometry, in its own space)
        const R = crowd.frame(f.rider);
        for (const side of ['L', 'R'] as const) {
          const sx = side === 'L' ? 1 : -1, shin = new THREE.Line3(V(sx * 0.19, 0.83, 0.38).applyMatrix4(R), V(sx * 0.19, 0.42, 0.4).applyMatrix4(R));
          expect(shin.closestPointToPoint(handOf(f, side), true, V(0, 0, 0)).distanceTo(handOf(f, side)), 'hands on the shins').toBeLessThan(0.08);
        }
        // and the rider sits on the shoulders, not floating or sunk in
        const seat = V(0, 0.84, 0).applyMatrix4(R).y, top = V(0, SHOULDER.y + 0.062, 0).applyMatrix4(crowd.frame(i)).y;
        expect(Math.abs(seat - top)).toBeLessThan(0.05);
        expect(CROWD_RIDER.k).toBeLessThan(1);
        riders++;
      }
    }
    expect(phones + flags + riders).toBeGreaterThan(3);
  });
  it('a flag is waved: the pole swings side to side, wider when it\'s loud, both hands staying on it all the way', () => {
    const hand = (name: string) => centroid(points(inst(name).geometry, (inst(name).geometry.userData.marks as Record<string, [number, number]>).hand));
    let checked = 0;
    for (const [i, f] of crowd.fans.entries()) if (f.flag) {
      const F = crowd.frame(i), m = { phase: f.phase, off: f.off };
      let widest = { 0.1: 0, 0.9: 0 } as Record<number, number>;
      for (const e of [0.1, 0.9]) for (let beat = 0; beat < 8; beat += 0.25) {
        const a = flagSwing(m, beat, e).angle;
        widest[e] = Math.max(widest[e], Math.abs(a));
        const pole = new THREE.Line3(flagTurn(V(CROWD_POLE.x, CROWD_POLE.y0, CROWD_POLE.z), a).applyMatrix4(F), flagTurn(V(CROWD_POLE.x, CROWD_POLE.y1, CROWD_POLE.z), a).applyMatrix4(F));
        for (const side of ['L', 'R'] as const) {
          const [name, k] = f.at[`arm${side}`], h = side === 'L' ? flagArm(hand(name), a) : hand(name);
          const w = h.applyMatrix4(matrixAt(name, k));
          // (the hand's middle, round the pole: up to 5 cm off its axis at rest, 2 more at the end of a swing)
          expect(pole.closestPointToPoint(w, true, V(0, 0, 0)).distanceTo(w), `${side} hand on the pole at beat ${beat}, energy ${e}`).toBeLessThan(0.07);
        }
        checked++;
      }
      expect(widest[0.9]).toBeGreaterThan(0.4); expect(widest[0.1]).toBeLessThan(0.25);
      widest = { 0.1: 0, 0.9: 0 };
    }
    expect(checked).toBeGreaterThan(0);
  });
  it('most flags carry the band\'s banner (the backdrop\'s own picture), printed to read the right way round from both sides', () => {
    const band = crowd.parts.get('cloth:band'), other = crowd.parts.get('cloth');
    expect(band, 'banner flags').toBeDefined();
    expect(band!.count).toBeGreaterThan(other?.count ?? 0);
    const mat = band!.material as THREE.MeshStandardMaterial;
    expect(mat.userData.part.uFlip.value).toBe(1);
    expect(v.bandInfo().surfaces.find((x) => x.what === 'backdrop')!.uuid).toBe(mat.map!.uuid);
  });
});

describe('jumping', () => {
  const keen = crowd.fans.reduce((a, f) => (f.keen < a.keen ? f : a));
  const m = (f: (typeof crowd.fans)[number]): Motion => ({ phase: f.phase, keen: f.keen, amp: 0, off: f.off, h: f.h, period: f.period, bob: f.bob, motion: 0 });
  it('a jump: knees bend first, a ballistic arc, landing on the beat with the knees bending again', () => {
    const mo = m(keen), B = 0.476, beats = mo.period;
    const at = (tau: number) => crowdMotion(mo, 0, (tau / B) - mo.off, 1, B);           // tau: seconds after a landing
    const T = B * beats;
    const air = Math.max(0.24, Math.min(0.75 * T, 2 * Math.sqrt((2 * mo.h) / 9.81)));
    expect(air).toBeGreaterThan(0.24); expect(air).toBeLessThan(0.38);
    // in the air: a parabola, its top half way, landing (no height) on the beat
    const top = at(T - air / 2).lift;
    expect(top).toBeCloseTo(mo.h, 3);
    expect(at(T - air / 4).lift).toBeCloseTo(0.75 * mo.h, 3);
    expect(at(T - 0.001).lift).toBeLessThan(0.01);
    expect(at(0).lift).toBe(0);
    expect(mo.h).toBeGreaterThanOrEqual(0.12); expect(mo.h).toBeLessThanOrEqual(0.25);
    // on the ground between jumps the knees bend 4 to 6 cm (after landing, before taking off)
    let bend = 0; for (let tau = 0; tau < T - air; tau += 0.005) bend = Math.max(bend, at(tau).bend);
    expect(bend).toBeGreaterThan(0.04); expect(bend).toBeLessThan(0.065);
    // raised arms reach up at the top
    expect(at(T - air / 2).top).toBeCloseTo(1, 3);
  });
  it('quiet: almost nobody jumps; at a drop about three in four of the front third and over half further back', () => {
    const z3 = Math.min(...crowd.fans.map((f) => f.z)) + (Math.max(...crowd.fans.map((f) => f.z)) - Math.min(...crowd.fans.map((f) => f.z))) / 3;
    const jumping = (f: (typeof crowd.fans)[number], e: number) => { let h = 0; for (let b = 0; b < 2; b += 0.02) h = Math.max(h, crowdMotion(m(f), 0, b, e).lift); return h > 0.05; };
    const share = (list: typeof crowd.fans, e: number) => list.filter((f) => jumping(f, e)).length / list.length;
    const front = crowd.fans.filter((f) => f.z < z3), back = crowd.fans.filter((f) => f.z >= z3);
    // (excitement: a quiet intro is 0, a drop 1; the lights' energy sets it, see the next test)
    expect(share(crowd.fans, 0.1)).toBeLessThan(0.04);
    expect(share(front, 1)).toBeGreaterThanOrEqual(0.68);
    expect(share(back, 1)).toBeGreaterThan(0.45); expect(share(back, 1)).toBeLessThan(0.7);
    // and in between (a groove), some of them
    expect(share(front, 0.5)).toBeGreaterThan(0.15); expect(share(front, 0.5)).toBeLessThan(share(front, 1));
    // most on every beat, some every other beat; whoever doesn't jump bobs on the beat
    const jumpers = crowd.fans.filter((f) => jumping(f, 1));
    expect(jumpers.filter((f) => f.period === 1).length).toBeGreaterThan(jumpers.length / 2);
    const still = crowd.fans.find((f) => !jumping(f, 1) && f.bob > 0)!;
    expect(crowdMotion(m(still), 0, -still.off, 1).bend).toBeGreaterThan(0.005);
    expect(crowdMotion(m(still), 0, 0.5 - still.off, 1).bend).toBeLessThan(0.001);
  });
});

describe('the hard parts', () => {
  const fansWith = (pred: (f: (typeof crowd.fans)[number]) => boolean) => crowd.fans.filter(pred);
  it('hanging arms go up (the keen ones first), pumping on the beat; calm, they hang', () => {
    const down = fansWith((f) => f.arms.L === 'down' && f.carrier === undefined && f.rider === undefined);
    expect(down.length).toBeGreaterThan(10);
    const up = (e: number, beat = 0) => down.filter((f) => { const [n, k] = f.at.armL, m = motionOf(n, k); expect(m.raise).toBe(true); return crowdMotion(m, 0, beat - m.off, e).angle < -2.2; }).length / down.length;
    expect(up(0.1)).toBe(0);
    expect(up(0.6)).toBeGreaterThan(0.1); expect(up(0.6)).toBeLessThan(up(1));
    expect(up(1)).toBeGreaterThan(0.45);
    // up there the hand is over the head; it pumps highest on the beat
    const f = down.find((x) => { const [n, k] = x.at.armL; return crowdMotion(motionOf(n, k), 0, 0, 1).angle < -2.2; })!, [n, k] = f.at.armL, m = motionOf(n, k);
    const g = inst(n).geometry, hand = centroid(points(g, (g.userData.marks as Record<string, [number, number]>).hand));
    const handAt = (beat: number) => crowdTurn(hand, crowdMotion(m, 0, beat - m.off, 1).angle, true).y + SHOULDER.y;
    expect(handAt(0)).toBeGreaterThan(1.85);
    expect(crowdMotion(m, 0, -m.off, 1).angle).toBeLessThan(crowdMotion(m, 0, 0.5 - m.off, 1).angle - 0.2);
    // (the phones, the flags and whoever's arms are already up don't)
    for (const name of ['arm:phone:L', 'arm:up:L', 'arm:flag:L', 'arm:carry:L']) if (crowd.parts.get(name)) expect((inst(name).material as THREE.Material).userData.part.uRaise.value).toBe(0);
  });
  it('the keen ones bang their heads, down hard on the beat; calm, everyone just nods', () => {
    const nod = (f: (typeof crowd.fans)[number], e: number) => { const [n, k] = f.at.head, m = motionOf(n, k); let lo = 9, hi = -9; for (let b = 0; b < 2; b += 0.02) { const a = crowdMotion(m, 0, b, e).angle; lo = Math.min(lo, a); hi = Math.max(hi, a); } return { swing: hi - lo, onBeat: crowdMotion(m, 0, -m.off, e).angle, between: crowdMotion(m, 0, 0.5 - m.off, e).angle }; };
    const keen = [...crowd.fans].filter((f) => f.carrier === undefined).sort((a, b) => a.keen - b.keen).slice(0, 10);
    for (const f of keen) {
      const loud = nod(f, 1), calm = nod(f, 0.1);
      expect(loud.swing, 'loud').toBeGreaterThan(2.5 * calm.swing);
      expect(loud.onBeat, 'down on the beat').toBeGreaterThan(loud.between + 0.08);
    }
    // the heads move with what's on them: hair and hats have the same motion numbers
    for (const f of crowd.fans) for (const part of ['hair', 'hat'] as const) if (f.at[part]) { const [n, k] = f.at[part], [hn, hk] = f.at.head; expect(motionOf(n, k)).toEqual(motionOf(hn, hk)); }
  });
});

it("the crowd's excitement follows the lights: calm in a quiet intro, up fast at a drop, down slower", () => {
  const U = (inst('torso').material as THREE.Material).userData.motion;
  let t = 100;
  const run = (energy: number, secs: number) => { for (let k = 0; k < secs * 60; k++) { t += 1 / 60; crowd.update(t, t * 2.1, energy, new THREE.Color(1, 1, 1)); } return U.uEnergy.value as number; };
  expect(run(0.22, 3)).toBe(0);
  expect(run(0.8, 1)).toBeGreaterThan(0.95);
  expect(run(0.22, 0.5)).toBeGreaterThan(0.4);
  expect(run(0.22, 4)).toBeLessThan(0.02);
  // and the beat's length from the beat count (2.1 beats a second here)
  expect(U.uBeatLen.value).toBeCloseTo(1 / 2.1, 2);
});

it('drum mics point into their drums, close to the head', () => {
  expect(v.drumMics.length).toBe(5);
  for (const { mic, drum, r, h } of v.drumMics) {
    const tip = V(0, 0, 0).applyMatrix4(mic.matrixWorld), axis = V(0, 1, 0).transformDirection(mic.matrixWorld);
    const c = V(0, h / 2, 0).applyMatrix4(drum.matrixWorld), n = V(0, 1, 0).transformDirection(drum.matrixWorld);
    const above = tip.clone().sub(c).dot(n);
    expect(above, 'outside the drum, over the head').toBeGreaterThan(0.01); expect(above).toBeLessThan(0.14);
    // where it points meets the head inside its rim
    const k = -above / axis.dot(n), hit = tip.clone().addScaledVector(axis, k);
    expect(k).toBeGreaterThan(0);
    expect(hit.distanceTo(c), 'aimed at the head').toBeLessThan(r * 0.8);
  }
});

it("the crew's hands are on what they work: desks, a camera's pan bar, the follow spots' handles", () => {
  expect(v.crew.length).toBe(6);
  for (const c of v.crew) for (const s of ['L', 'R'] as const) {
    if (!c.wrists[s]) continue;
    const hand = c.p.handAt(s).applyMatrix4(c.p.group.matrix);
    expect(hand.distanceTo(c.wrists[s]!), 'wrist where it was sent').toBeLessThan(0.02);
    expect(c.wrists[s]!.distanceTo(c.on[s]!), 'a hand away from what it holds').toBeLessThan(0.09);
  }
});

it('what never moves is baked into a few dozen meshes; what moves is the band, the crowd and the screens', () => {
  expect(v.baked.meshes).toBeGreaterThan(1000);
  expect(v.baked.batches).toBeLessThan(70);
  let loose = 0;
  v.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.name !== 'baked' && !(m as THREE.InstancedMesh).isInstancedMesh) loose++; });
  // (the band, its guitars and sticks, the pedals: each a few meshes per material)
  expect(loose).toBeLessThan(150);
  // the band still plays after baking: hands and mics as people.test.ts checks
  v.animate(1.3, 2.6, 0.8, new THREE.Color(1, 1, 1)); v.group.updateMatrixWorld(true);
  for (const p of v.band) for (const s of ['L', 'R'] as const) expect(p.handAt(s).distanceTo(p.hands[s])).toBeLessThan(0.04);
});

describe('the small club / pub', () => {
  const pub = buildVenue({ room: 'pub' });
  pub.group.updateMatrixWorld(true);
  it('builds: a few dozen people (not hundreds), nothing NaN, nobody on shoulders, no flags', () => {
    expect(pub.room).toBe('pub');
    expect(pub.crowdCount).toBeGreaterThanOrEqual(24); expect(pub.crowdCount).toBeLessThanOrEqual(60);
    expect(pub.crowdCount).toBeLessThan(buildVenue({ crowd: undefined }).crowdCount);
    let bad = 0;
    pub.group.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; const a = m.geometry.attributes.position; if (a) for (let i = 0; i < a.array.length; i++) if (!Number.isFinite(a.array[i])) bad++; });
    expect(bad).toBe(0);
    expect(pub.crowd.fans.some((f) => f.rider !== undefined || f.flag)).toBe(false);
  });
  it('everyone is inside the room: the crowd between the stage and the bar, the band on the small deck', () => {
    for (const f of pub.crowd.fans) { expect(Math.abs(f.x)).toBeLessThan(PUB.x - 0.3); expect(f.z).toBeGreaterThan(ROOMS.pub.deck.z1); expect(f.z).toBeLessThan(PUB.z1 - 2.5); }
    for (const p of pub.band) { const w = new THREE.Vector3().setFromMatrixPosition(p.group.matrixWorld); expect(onDeck(w.x, w.z, ROOMS.pub), 'on the deck').toBe(true); }
  });
  it('the same band plays: hands on their instruments, mics at mouths; the bartender and the laptop at work', () => {
    pub.animate(1.3, 2.6, 0.8, new THREE.Color(1, 1, 1)); pub.group.updateMatrixWorld(true);
    expect(pub.band.length).toBe(v.band.length);
    for (const p of pub.band) for (const s of ['L', 'R'] as const) expect(p.handAt(s).distanceTo(p.hands[s])).toBeLessThan(0.04);
    expect(pub.crew.length).toBe(2);
    for (const c of pub.crew) for (const s of ['L', 'R'] as const) {
      const hand = c.p.handAt(s).applyMatrix4(c.p.group.matrix);
      expect(hand.distanceTo(c.wrists[s]!), 'wrist where it was sent').toBeLessThan(0.02);
      expect(c.wrists[s]!.distanceTo(c.on[s]!)).toBeLessThan(0.09);
    }
    expect(pub.baked.batches).toBeLessThan(70);
  });
});

describe("the band's name", () => {
  it('starts with their picture; a name goes on the banners, screens and kick drum in place (the same textures, nothing built again)', () => {
    const b = buildVenue({ crowd: 10 }), before = b.bandInfo(), kids = b.group.children.length;
    expect(before.name).toBe('');
    expect(before.surfaces.map((s) => s.what)).toEqual(expect.arrayContaining(['backdrop', 'scrim left', 'scrim right', 'skirt', 'barricade', 'kick drum', 'screens']));
    expect(before.surfaces.find((s) => s.what === 'backdrop')!.shows).toBe('');          // (the picture)
    expect(before.surfaces.find((s) => s.what === 'skirt')!.shows).toBe('WE ARE NOT THE BAND');
    b.setBand('  The Rusty Nails ');
    const after = b.bandInfo();
    expect(after.name).toBe('The Rusty Nails');
    for (const s of after.surfaces) {
      const was = before.surfaces.find((x) => x.what === s.what)!;
      expect(s.uuid, s.what).toBe(was.uuid);
      expect(s.shows.toUpperCase(), s.what).toBe('THE RUSTY NAILS');
      if (s.what !== 'screens') expect(s.version, s.what).toBeGreaterThan(was.version);    // (the screens paint as they play)
    }
    expect(b.group.children.length).toBe(kids);
    // the same name again: nothing painted; none: their picture again
    const v1 = b.bandInfo().surfaces[0].version;
    b.setBand('The Rusty Nails'); expect(b.bandInfo().surfaces[0].version).toBe(v1);
    b.setBand('');
    expect(b.bandInfo().surfaces.find((s) => s.what === 'backdrop')!.shows).toBe('');
    expect(b.bandInfo().surfaces.find((s) => s.what === 'kick drum')!.shows).toBe('WANTB');
    // and it's built with one from the start
    expect(buildVenue({ crowd: 10, room: 'pub', band: 'Dogs' }).bandInfo().surfaces.find((s) => s.what === 'backdrop')!.shows).toBe('Dogs');
  });
});
