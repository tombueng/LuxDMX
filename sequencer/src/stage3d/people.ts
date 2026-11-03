// People for the stage: a jointed body (hips, spine, neck, head; shoulder, elbow and wrist; hip,
// knee and ankle) with faces, hair styles, hats, printed shirts, jeans and sneakers. Arms and legs
// are chains: a two-bone solver puts each hand and foot exactly where it should be (on a guitar
// neck, on the keys, round a mic, on a drum stick, on the floor), so a hand is always at the end
// of its arm and an arm always on its shoulder. Metres, y up, a person faces +z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { denim, knit, shirtPrint } from './textures';

export type HairStyle = 'short' | 'long' | 'bun' | 'curly' | 'mohawk' | 'shaved' | 'beanie' | 'cap';
export interface Look {
  skin: number; shirt: number; pants: number; shoes: number; hair: number; style: HairStyle;
  beard?: boolean; print?: string; sleeves?: 'short' | 'long'; hat?: number;
}

// lengths (a 1.80 m person): upper arm, forearm, thigh, shin
export const ARM = { a: 0.29, b: 0.26 }, LEG = { a: 0.43, b: 0.42 };
export const SHOULDER = { x: 0.2, y: 1.43, z: -0.01 }, HIP = { x: 0.095, y: 0.93, z: 0 };
export const MOUTH = new THREE.Vector3(0, 1.615, 0.1);
// a shoe from its ankle: how far down the sole is, where the heel, the ball and the toe are (along z)
export const SOLE = { y: -0.089, heel: -0.07, ball: 0.11, toe: 0.18 };

// Hands. In a hand's own space the wrist is at the origin, the fingers point down -y, the palm faces
// -z and the thumb is on +x for the right hand (the left hand is the same mirrored: thumb on -x).
// A hand is open, a fist round a stick, or round a guitar neck (thumb behind it, fingers hooked over
// onto the fretboard). `at`: the middle of what it holds; `axis`: which way that runs (out past the
// thumb), for the right hand.
export type HandShape = 'open' | 'fist' | 'fret';
export const GRIP: Record<HandShape, { at: THREE.Vector3; axis: THREE.Vector3 }> = {
  open: { at: new THREE.Vector3(0, -0.075, -0.03), axis: new THREE.Vector3(1, 0, 0) },
  // (a stick leaves a fist between the thumb and the first knuckle, 30 degrees off the fingers' line)
  fist: { at: new THREE.Vector3(0, -0.08, -0.03), axis: new THREE.Vector3(0.5, -0.866, 0).normalize() },
  fret: { at: new THREE.Vector3(0, -0.102, -0.05), axis: new THREE.Vector3(1, 0, 0) },
};
// How a hand is turned, in the person's space: which way its palm faces, and either where its
// fingers point from the wrist or which way what it holds runs (`axis`, towards the thumb's side).
// `follow` (with an axis): the hand turns about what it holds until its fingers carry on from the
// forearm as well as they can (no bent-back wrists); `palm` is then only the first guess.
export interface HandAim { shape?: HandShape; palm: THREE.Vector3; fingers?: THREE.Vector3; axis?: THREE.Vector3; follow?: boolean }
const mirrorX = (v: THREE.Vector3, side: 'L' | 'R') => (side === 'L' ? new THREE.Vector3(-v.x, v.y, v.z) : v.clone());
// the turn that takes a hand's own space to the person's for this aim
export function aimHand(side: 'L' | 'R', aim: HandAim): THREE.Quaternion {
  const shape = aim.shape ?? 'open';
  // two directions in the hand (fingers or the held axis, and the palm) and where they should point
  const u1 = aim.axis ? mirrorX(GRIP[shape].axis, side) : new THREE.Vector3(0, -1, 0), u2 = new THREE.Vector3(0, 0, -1);
  const w1 = (aim.axis ?? aim.fingers ?? new THREE.Vector3(0, -1, 0)).clone().normalize();
  const w2 = aim.palm.clone().addScaledVector(w1, -aim.palm.dot(w1));
  if (w2.lengthSq() < 1e-8) w2.set(0, 0, 1).addScaledVector(w1, -w1.z);
  w2.normalize();
  const U = new THREE.Matrix4().makeBasis(u1, u2, u1.clone().cross(u2)), W = new THREE.Matrix4().makeBasis(w1, w2, w1.clone().cross(w2));
  return new THREE.Quaternion().setFromRotationMatrix(W.multiply(U.transpose()));
}

// Two bones from S of lengths a and b, reaching for T, the joint bent towards `pole`: where the
// joint (elbow, knee) goes. A target out of reach gets the limb stretched towards it.
export function twoBone(S: THREE.Vector3, T: THREE.Vector3, a: number, b: number, pole: THREE.Vector3): THREE.Vector3 {
  const d = new THREE.Vector3().subVectors(T, S);
  const len = Math.min(Math.max(d.length(), Math.abs(a - b) + 1e-4), a + b - 1e-4);
  const dir = d.lengthSq() > 1e-12 ? d.normalize() : new THREE.Vector3(0, -1, 0);
  const cosA = Math.max(-1, Math.min(1, (a * a + len * len - b * b) / (2 * a * len))), sinA = Math.sqrt(1 - cosA * cosA);
  // the pole without its part along the limb: the side the joint bends to
  const n = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (n.lengthSq() < 1e-10) n.set(0, 0, 1).addScaledVector(dir, -dir.z);
  n.normalize();
  return S.clone().addScaledVector(dir, a * cosA).addScaledVector(n, a * sinA);
}

const DOWN = new THREE.Vector3(0, -1, 0);
const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.02, ...o });
const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; };
// a limb piece hanging down from its joint: tapered, with a ball at the top
const limbGeo = (r0: number, r1: number, L: number) => once(`limb:${r0}:${r1}:${L}`, () => mergeGeometries([new THREE.CylinderGeometry(r0, r1, L, 18, 3).translate(0, -L / 2, 0).toNonIndexed(), new THREE.SphereGeometry(r0, 18, 12).toNonIndexed()])!);
const limb = (r0: number, r1: number, L: number, m: THREE.Material) => mesh(limbGeo(r0, r1, L), m);
// pieces of one material put together into one mesh (fewer draw calls for the same detail)
class Parts {
  private by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) { const l = this.by.get(m) ?? []; l.push((g.index ? g.toNonIndexed() : g.clone()).translate(x, y, z)); this.by.set(m, l); }
  into(o: THREE.Object3D) { for (const [m, l] of this.by) o.add(new THREE.Mesh(mergeGeometries(l)!, m)); }
}

// A chain: root pivot (at the shoulder or hip), joint pivot (elbow or knee), end pivot (wrist or ankle).
export class Chain {
  readonly root = new THREE.Object3D(); readonly joint = new THREE.Object3D(); readonly end = new THREE.Object3D();
  constructor(readonly a: number, readonly b: number, at: { x: number; y: number; z: number }, readonly pole: THREE.Vector3) {
    this.root.position.set(at.x, at.y, at.z);
    this.joint.position.set(0, -a, 0); this.end.position.set(0, -b, 0);
    this.root.add(this.joint); this.joint.add(this.end);
  }
  // reach T (in the coordinates of root's parent); `level`: keep the end piece square with the body
  reach(T: THREE.Vector3, level = false) {
    const S = this.root.position, E = twoBone(S, T, this.a, this.b, this.pole);
    this.root.quaternion.setFromUnitVectors(DOWN, E.clone().sub(S).normalize());
    const u = T.clone().sub(E).applyQuaternion(this.root.quaternion.clone().invert());
    if (u.lengthSq() > 1e-12) this.joint.quaternion.setFromUnitVectors(DOWN, u.normalize());
    if (level) this.end.quaternion.copy(this.root.quaternion.clone().multiply(this.joint.quaternion).invert());
  }
  // where the end is now, in root's parent's coordinates
  tip(): THREE.Vector3 {
    this.root.updateMatrix(); this.joint.updateMatrix(); this.end.updateMatrix();
    return new THREE.Vector3().applyMatrix4(this.root.matrix.clone().multiply(this.joint.matrix).multiply(this.end.matrix));
  }
  elbow(): THREE.Vector3 { this.root.updateMatrix(); this.joint.updateMatrix(); return new THREE.Vector3().applyMatrix4(this.root.matrix.clone().multiply(this.joint.matrix)); }
}

const cache = new Map<string, THREE.BufferGeometry>();
const once = (k: string, f: () => THREE.BufferGeometry) => { let g = cache.get(k); if (!g) { g = f(); cache.set(k, g); } return g; };

// the body's outline turned round (a lathe), squashed front to back
function torsoGeo(part: 'hips' | 'shirt') {
  return once(`torso-${part}`, () => {
    const prof = part === 'hips'
      ? [[0, 0.84], [0.12, 0.85], [0.165, 0.9], [0.176, 0.96], [0.168, 1.01], [0.16, 1.045], [0, 1.05]]
      : [[0, 0.99], [0.166, 0.995], [0.162, 1.06], [0.168, 1.14], [0.178, 1.22], [0.19, 1.3], [0.196, 1.37], [0.19, 1.42], [0.165, 1.465], [0.115, 1.5], [0.06, 1.522], [0, 1.53]];
    const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 40, Math.PI);
    g.scale(1, 1, 0.64); g.computeVertexNormals();
    return g;
  });
}
// a capsule from a to b (a thumb)
function capsule(r: number, a: THREE.Vector3, b: THREE.Vector3) {
  const d = b.clone().sub(a);
  return new THREE.CapsuleGeometry(r, d.length(), 3, 8).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()))
    .translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2).toNonIndexed();
}
// A hand in its own space (see GRIP): the right one; the left one is it mirrored (the triangles
// turned round so it still faces out)
function handGeo(side: 'L' | 'R', shape: HandShape): THREE.BufferGeometry {
  return once(`hand:${shape}:${side}`, (): THREE.BufferGeometry => {
    if (side === 'L') {
      const g: THREE.BufferGeometry = handGeo('R', shape).clone().scale(-1, 1, 1);
      for (const a of Object.values(g.attributes) as THREE.BufferAttribute[]) {
        for (let i = 0; i + 2 < a.count; i += 3) for (let c = 0; c < a.itemSize; c++) { const v = a.getComponent(i + 1, c); a.setComponent(i + 1, c, a.getComponent(i + 2, c)); a.setComponent(i + 2, c, v); }
      }
      g.computeBoundingSphere();
      return g;
    }
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    // (rounded boxes come without an index already)
    const palm = new RoundedBoxGeometry(0.074, 0.09, 0.03, 2, 0.012).translate(0, -0.05, 0);
    if (shape === 'fist') return mergeGeometries([
      // the palm, the fingers folded over towards the palm (round the stick), the thumb along them
      new RoundedBoxGeometry(0.076, 0.085, 0.034, 2, 0.013).translate(0, -0.047, 0),
      new RoundedBoxGeometry(0.074, 0.05, 0.054, 2, 0.017).translate(0, -0.098, -0.02),
      capsule(0.0125, V(0.041, -0.045, -0.02), V(0.024, -0.1, -0.046)),
    ])!;
    if (shape === 'fret') return mergeGeometries([
      // the fingers straight on from the knuckles, then hooked over towards the palm's side (onto the
      // fretboard); the thumb round behind (behind the neck)
      palm,
      new RoundedBoxGeometry(0.07, 0.04, 0.022, 2, 0.01).translate(0, -0.108, -0.004),
      new RoundedBoxGeometry(0.066, 0.022, 0.048, 2, 0.01).translate(0, -0.124, -0.028),
      capsule(0.012, V(0.034, -0.03, -0.012), V(0.016, -0.084, -0.07)),
    ])!;
    // open: the fingers curled a little towards the palm, the thumb beside them
    return mergeGeometries([
      palm,
      new RoundedBoxGeometry(0.07, 0.075, 0.024, 2, 0.011).translate(0, -0.0375, 0).rotateX(0.45).translate(0, -0.09, 0),
      capsule(0.012, V(0.04, -0.035, -0.006), V(0.05, -0.08, -0.03)),
    ])!;
  });
}
function shoeGeo() {
  return once('shoe', () => new RoundedBoxGeometry(0.1, 0.075, 0.27, 3, 0.035).translate(0, -0.045, 0.055));
}

export class Person {
  readonly group = new THREE.Group();       // at the floor between the feet
  readonly body = new THREE.Group();        // what bobs and leans
  readonly head = new THREE.Group();        // turns at the neck
  readonly arms: { L: Chain; R: Chain };    // L is the person's left (+x: they face +z)
  readonly legs: { L: Chain; R: Chain };
  private feet = { L: new THREE.Vector3(HIP.x + 0.02, 0.085, 0.03), R: new THREE.Vector3(-HIP.x - 0.02, 0.085, 0.03) };
  // how far each foot's toes are tipped up (radians: on a pedal), from level
  private pitch = { L: 0, R: 0 };
  readonly hands = { L: new THREE.Vector3(0.24, 0.9, 0.05), R: new THREE.Vector3(-0.24, 0.9, 0.05) };
  // a hand turned on purpose (its turn in the person's space, its shape), or hanging on from the forearm
  private aims: { L?: { q: THREE.Quaternion; shape: HandShape }; R?: { q: THREE.Quaternion; shape: HandShape } } = {};
  // a hand holding something: where, and how (see hold())
  private grips: { L?: { p: THREE.Vector3; aim: HandAim }; R?: { p: THREE.Vector3; aim: HandAim } } = {};
  private handMesh!: { L: THREE.Mesh; R: THREE.Mesh };
  // where the body's hips are when it stands straight (sitting: lower)
  private base = 0;

  constructor(o: Look) {
    const skin = std({ color: o.skin, roughness: 0.55 }), shirt = std({ color: 0xffffff, map: shirtPrint(o.shirt, o.print ?? ''), roughness: 0.92 });
    const pants = std({ color: o.pants, map: denim(), roughness: 0.95 }), shoes = std({ color: o.shoes, roughness: 0.7 }), sole = std({ color: 0xeeeeea, roughness: 0.8 });
    const hair = std({ color: o.hair, roughness: 0.75 });
    this.group.add(this.body);
    this.body.add(mesh(torsoGeo('hips'), pants), mesh(torsoGeo('shirt'), shirt));
    this.body.add(mesh(new THREE.CylinderGeometry(0.047, 0.055, 0.13, 18), skin, 0, 1.545, -0.005));
    // the head: skull, jaw, nose, ears, eyes, brows, mouth
    this.head.position.set(0, 1.6, 0); this.body.add(this.head);
    const h = this.head, y0 = -1.6, P = new Parts(), white = std({ color: 0xf4f1ea, roughness: 0.3 }), iris = std({ color: 0x2a1c12, roughness: 0.2 }), lips = std({ color: 0x7a3a34, roughness: 0.6 });
    P.add(new THREE.SphereGeometry(0.1, 36, 28).scale(0.9, 1.1, 1), skin, 0, y0 + 1.69, 0);
    P.add(new THREE.SphereGeometry(0.075, 28, 18).scale(0.95, 0.75, 1.05), skin, 0, y0 + 1.625, 0.025);
    P.add(new THREE.ConeGeometry(0.017, 0.05, 12).rotateX(Math.PI / 2.4), skin, 0, y0 + 1.672, 0.1);
    for (const sx of [-1, 1]) {
      P.add(new THREE.SphereGeometry(0.022, 12, 10).scale(0.45, 1.1, 0.8), skin, sx * 0.088, y0 + 1.675, -0.005);
      P.add(new THREE.SphereGeometry(0.013, 12, 10), white, sx * 0.034, y0 + 1.7, 0.083);
      P.add(new THREE.SphereGeometry(0.0075, 10, 8), iris, sx * 0.034, y0 + 1.7, 0.094);
      P.add(new THREE.BoxGeometry(0.03, 0.007, 0.01).rotateZ(sx * -0.12), hair, sx * 0.035, y0 + 1.722, 0.09);
    }
    P.add(new THREE.BoxGeometry(0.034, 0.007, 0.008), lips, 0, y0 + 1.618, 0.104);       // (on the jaw, not in it)
    // a beard: round the jaw and the chin, under the cheeks (the mouth shows)
    if (o.beard) P.add(new THREE.SphereGeometry(0.08, 24, 14, Math.PI / 2 - 1.25, 2.5, Math.PI * 0.5, Math.PI * 0.36).scale(0.98, 0.95, 1.06), hair, 0, y0 + 1.66, 0.012);
    this.hairdo(o, hair, skin, P);
    P.into(h);
    // arms: shoulder ball, upper arm in a sleeve, forearm, hand
    const pole = (sx: number) => new THREE.Vector3(sx * 0.6, -0.4, -0.7);
    this.arms = { L: new Chain(ARM.a, ARM.b, { ...SHOULDER, x: SHOULDER.x }, pole(1)), R: new Chain(ARM.a, ARM.b, { ...SHOULDER, x: -SHOULDER.x }, pole(-1)) };
    const hm = { L: mesh(handGeo('L', 'open'), skin), R: mesh(handGeo('R', 'open'), skin) };
    this.handMesh = hm;
    for (const s of ['L', 'R'] as const) {
      // (the upper arm, its sleeve and the shoulder: one mesh per material)
      const c = this.arms[s], long = o.sleeves === 'long', up = new Parts();
      up.add(limbGeo(0.05, 0.043, ARM.a), long ? shirt : skin);
      if (!long) up.add(new THREE.CylinderGeometry(0.062, 0.056, 0.16, 18, 1, true).translate(0, -0.07, 0), shirt);
      up.add(new THREE.SphereGeometry(0.062, 18, 12), shirt);
      up.into(c.root);
      c.joint.add(limb(0.042, 0.032, ARM.b, long ? shirt : skin));
      if (long) c.joint.add(mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.02, 14).translate(0, -ARM.b + 0.01, 0), shirt));
      c.end.add(hm[s]);
      this.body.add(c.root);
    }
    // legs: from the hips in the jeans, shoes on the feet
    const knee = new THREE.Vector3(0, 0.15, 1);
    this.legs = { L: new Chain(LEG.a, LEG.b, { ...HIP, x: HIP.x }, knee), R: new Chain(LEG.a, LEG.b, { ...HIP, x: -HIP.x }, knee) };
    for (const c of [this.legs.L, this.legs.R]) {
      c.root.add(limb(0.078, 0.058, LEG.a, pants)); c.joint.add(limb(0.056, 0.043, LEG.b, pants));
      c.end.add(mesh(shoeGeo(), shoes), mesh(new THREE.BoxGeometry(0.104, 0.018, 0.27).translate(0, -0.08, 0.055), sole));
      this.group.add(c.root);
    }
    this.pose();
  }

  private hairdo(o: Look, hair: THREE.Material, skin: THREE.Material, P: Parts) {
    const y0 = -1.6;
    // A cap over the skull down to a hairline: high at the forehead (the eyes and brows stay free),
    // lower over the ears, down to the nape at the back. `front`/`back`: how far down from the crown
    // (as a share of half a turn) the hairline goes at the front and at the back.
    const cap = (r: number, front: number, back: number) => {
      const g = new THREE.SphereGeometry(r, 40, 24, 0, Math.PI * 2, 0, Math.PI * back), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), th = Math.acos(Math.max(-1, Math.min(1, y / r))), az = Math.atan2(x, z);
        const line = Math.PI * (front + (back - front) * (1 - Math.cos(az)) / 2);
        if (th > line) p.setXYZ(i, r * Math.sin(line) * Math.sin(az), r * Math.cos(line), r * Math.sin(line) * Math.cos(az));
      }
      return g.scale(0.92, 1.1, 1.02);
    };
    // (a little roughness in the hair: the vertices pushed in and out)
    const rough = (g: THREE.BufferGeometry, k: number) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const s = 1 + (Math.sin(p.getX(i) * 140) * Math.sin(p.getY(i) * 170) * Math.sin(p.getZ(i) * 120)) * k; p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s); } g.computeVertexNormals(); return g; };
    // is this point (on the head, from its middle) below the hairline? (curls, the hair under a cap)
    const belowLine = (x: number, y: number, z: number, front: number, back: number) => {
      const th = Math.acos(Math.max(-1, Math.min(1, y / Math.hypot(x, y, z)))), az = Math.atan2(x, z);
      return th > Math.PI * (front + (back - front) * (1 - Math.cos(az)) / 2);
    };
    const s = o.style;
    if (s === 'short' || s === 'long' || s === 'bun') P.add(rough(cap(0.107, 0.27, 0.6), 0.02), hair, 0, y0 + 1.7, -0.008);
    if (s === 'long') {
      const back = new THREE.CylinderGeometry(0.1, 0.13, 0.36, 28, 6, true, Math.PI * 0.6, Math.PI * 0.8);
      P.add(rough(back.scale(1, 1, 0.95), 0.03), hair, 0, y0 + 1.55, -0.015);
    }
    if (s === 'bun') P.add(rough(new THREE.SphereGeometry(0.05, 18, 14), 0.04), hair, 0, y0 + 1.79, -0.07);
    if (s === 'curly') {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 140; i++) {
        const u = (i * 0.618) % 1, v = (i / 140) * 0.62, a = u * Math.PI * 2, th = v * Math.PI;
        const x = Math.sin(th) * Math.cos(a) * 0.115, y = Math.cos(th) * 0.125, z = Math.sin(th) * Math.sin(a) * 0.115 - 0.01;
        if (belowLine(x, y, z + 0.01, 0.25, 0.62)) continue;
        parts.push(new THREE.SphereGeometry(0.034, 10, 8).translate(x, y, z).toNonIndexed());
      }
      P.add(mergeGeometries(parts)!, hair, 0, y0 + 1.69, -0.01);
    }
    if (s === 'mohawk') {
      P.add(cap(0.103, 0.27, 0.58), std({ color: 0x3a2a22, roughness: 0.9, transparent: true, opacity: 0.35 }), 0, y0 + 1.7, -0.006);
      for (let i = 0; i < 9; i++) { const a = -0.5 + i * 0.14; P.add(new THREE.BoxGeometry(0.022, 0.07, 0.04), hair, 0, y0 + 1.7 + Math.cos(a) * 0.12, Math.sin(a) * 0.12 - 0.01); }
    }
    if (s === 'shaved') P.add(cap(0.102, 0.27, 0.58), std({ color: 0x2b211b, roughness: 0.95, transparent: true, opacity: 0.25 }), 0, y0 + 1.7, -0.006);
    if (s === 'beanie') {
      // a knitted hat down to just above the brows, its cuff round the forehead
      const kn = std({ color: o.hat ?? 0x8a1f1f, map: knit(), roughness: 1 });
      P.add(rough(cap(0.112, 0.33, 0.55).scale(1, 1.08, 1), 0.01), kn, 0, y0 + 1.715, -0.008);
      P.add(new THREE.TorusGeometry(0.1, 0.016, 10, 40).rotateX(Math.PI / 2).scale(0.92, 1, 1.02).rotateX(-0.25), kn, 0, y0 + 1.755, -0.012);
      P.add(new THREE.SphereGeometry(0.03, 12, 10), kn, 0, y0 + 1.86, -0.01);
    }
    if (s === 'cap') {
      // a baseball cap: crown, peak forward over the brows; the hair shows at the sides and back
      const c = std({ color: o.hat ?? 0x1d2b4a, roughness: 0.8 });
      P.add(cap(0.11, 0.33, 0.44), c, 0, y0 + 1.715, -0.006);
      P.add(new THREE.CylinderGeometry(0.1, 0.1, 0.008, 28, 1, false, -Math.PI / 2, Math.PI).scale(0.85, 1, 1.25).rotateX(0.12), c, 0, y0 + 1.75, 0.07);
      const under = rough(new THREE.SphereGeometry(0.104, 24, 10, Math.PI / 2 + 1.1, Math.PI * 2 - 2.2, Math.PI * 0.44, Math.PI * 0.16).scale(0.92, 1.1, 1.02), 0.02);
      P.add(under, std({ color: o.hair, roughness: 0.75 }), 0, y0 + 1.71, -0.012);
    }
    void skin;
  }

  // stand (or sit: `seat` = the height the hips rest at; the feet go where `feet` says)
  pose(o: { seat?: number; feet?: { L: THREE.Vector3; R: THREE.Vector3 } } = {}) {
    if (o.seat !== undefined) { this.base = o.seat - 0.9; this.body.position.y = this.base; }
    if (o.feet) { this.feet.L.copy(o.feet.L); this.feet.R.copy(o.feet.R); }
    this.update();
  }
  // Bend the body at the hips (radians: forward, turned to its left, tipped to its right), the hips
  // lowered by `drop` (knees bent) and moved by `shift` (over a foot, a step back): the hips stay
  // where they are otherwise, so a seated person doesn't slide on the seat
  lean(o: { x?: number; y?: number; z?: number; drop?: number; shift?: { x?: number; z?: number } } = {}) {
    const b = this.body;
    b.rotation.set(o.x ?? 0, o.y ?? 0, o.z ?? 0, 'YXZ');
    b.position.set(0, -HIP.y, 0).applyEuler(b.rotation).add(new THREE.Vector3(o.shift?.x ?? 0, this.base + HIP.y - (o.drop ?? 0), o.shift?.z ?? 0));
    b.updateMatrix();
  }
  // Where a hand goes, in the person's own coordinates (the arms follow): `at` is the wrist; `aim`
  // turns the hand (else it hangs on from the forearm)
  hand(side: 'L' | 'R', at: THREE.Vector3, aim?: HandAim) {
    this.grips[side] = undefined;
    this.hands[side].copy(at);
    if (aim) this.aims[side] = { q: aimHand(side, aim), shape: aim.shape ?? 'open' }; else this.aims[side] = undefined;
    this.handMesh[side].geometry = handGeo(side, aim?.shape ?? 'open');
  }
  // A hand holding something at `p` (a stick, a neck), turned as `aim` says: the wrist goes where the
  // middle of the grip is on `p`
  hold(side: 'L' | 'R', p: THREE.Vector3, aim: HandAim) {
    this.grips[side] = { p: p.clone(), aim };
    this.grasp(side, p, aim);
  }
  private grasp(side: 'L' | 'R', p: THREE.Vector3, aim: HandAim) {
    const shape = aim.shape ?? 'open', q = aimHand(side, aim);
    this.hands[side].copy(p).sub(mirrorX(GRIP[shape].at, side).applyQuaternion(q));
    this.aims[side] = { q, shape };
    this.handMesh[side].geometry = handGeo(side, shape);
  }
  // a foot: its ankle at `at`, its toes tipped up by `pitch` (radians)
  foot(side: 'L' | 'R', at: THREE.Vector3, pitch = 0) { this.feet[side].copy(at); this.pitch[side] = pitch; }
  // put the limbs where the hands and feet are wanted (after the body moved)
  update() {
    this.body.updateMatrix();
    const inv = this.body.matrix.clone().invert();
    for (const s of ['L', 'R'] as const) {
      const c = this.arms[s], g = this.grips[s];
      c.reach(this.hands[s].clone().applyMatrix4(inv));
      // A hand that follows its forearm: turned about what it holds so the fingers lie between that
      // and the forearm's line (the palm from the two). The forearm's line from an arm reaching the
      // grip with the hand's length added (it hardly depends on how the hand is turned). With the
      // forearm nearly along what's held, which way it turns is up to the palm asked for (it pulls a
      // little all the time: the hand turns smoothly, never flips).
      if (g?.aim.follow && g.aim.axis) {
        const S = c.root.position.clone().applyMatrix4(this.body.matrix), pole = c.pole.clone().applyQuaternion(this.body.quaternion);
        const ax = g.aim.axis.clone().normalize(), fa = g.p.clone().sub(twoBone(S, g.p, ARM.a, ARM.b + 0.08, pole)).normalize();
        const f = s === 'R' ? ax.clone().cross(fa) : fa.clone().cross(ax), h = g.aim.palm.clone().addScaledVector(ax, -g.aim.palm.dot(ax)).normalize();
        this.grasp(s, g.p, { ...g.aim, palm: f.addScaledVector(h, 0.25) });
        c.reach(this.hands[s].clone().applyMatrix4(inv));
      }
      // a turned hand: the wrist undoes the turns of the body, the upper arm and the forearm
      const a = this.aims[s];
      if (a) c.end.quaternion.copy(this.body.quaternion).multiply(c.root.quaternion).multiply(c.joint.quaternion).invert().multiply(a.q);
      else c.end.quaternion.identity();
    }
    // legs hang off the body's hips but the feet stay put on the floor (or on a pedal)
    for (const s of ['L', 'R'] as const) {
      const c = this.legs[s];
      c.root.position.set(s === 'L' ? HIP.x : -HIP.x, HIP.y, HIP.z).applyMatrix4(this.body.matrix);
      c.reach(this.feet[s], true);
      if (this.pitch[s]) c.end.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -this.pitch[s]));
    }
  }
  // where the mouth is, in the person's coordinates
  mouth(): THREE.Vector3 { this.body.updateMatrix(); this.head.updateMatrix(); return MOUTH.clone().applyMatrix4(this.body.matrix); }
  // where a hand really is now (in the person's coordinates)
  handAt(side: 'L' | 'R'): THREE.Vector3 { this.body.updateMatrix(); return this.arms[side].tip().applyMatrix4(this.body.matrix); }
  // the hand's own space in the person's, as it really is now (for the tests: grip, fingers, palm)
  handMatrix(side: 'L' | 'R'): THREE.Matrix4 {
    const c = this.arms[side];
    this.body.updateMatrix(); c.root.updateMatrix(); c.joint.updateMatrix(); c.end.updateMatrix();
    return this.body.matrix.clone().multiply(c.root.matrix).multiply(c.joint.matrix).multiply(c.end.matrix);
  }
  // where the middle of what a hand holds really is now (the person's space)
  gripAt(side: 'L' | 'R'): THREE.Vector3 { return mirrorX(GRIP[this.aims[side]?.shape ?? 'open'].at, side).applyMatrix4(this.handMatrix(side)); }
  // Put a thing in a hand: its origin at the middle of the grip, its +y along what the hand holds
  // (a stick: towards its tip). It moves with the hand from then on.
  inHand(side: 'L' | 'R', o: THREE.Object3D, shape: HandShape = 'fist') {
    o.position.copy(mirrorX(GRIP[shape].at, side));
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), mirrorX(GRIP[shape].axis, side));
    this.arms[side].end.add(o);
  }
}
