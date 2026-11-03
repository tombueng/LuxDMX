// The gear round the band: backline (cabs, heads, pedalboards, spare guitars on stands), DI boxes
// and stage boxes with their cables taped down, drum mics, monitor world (desk, in-ear rack, side
// fills), FOH (sound and lighting desks), a camera on a tripod, follow spots on scaffold towers,
// road cases with stencils, a water crate, and the hall round it all. Real sizes, in metres, each
// piece built round where it stands on the floor, its front towards +z.
//
// Also the baker: everything that never moves is merged into one mesh per picture (colour,
// roughness and metalness go per vertex), so hundreds of props cost a few dozen draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Person, SHOULDER, type Look as PersonLook } from './people';
import { brushed, cabCloth, consoleTop, exitSign, grille, hallWall, ledBack, rackFront, roofDeck, screen, stageBoxPanel, stencils, STENCILS, tolex, cableRamp, white } from './textures';

export const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05, ...o });
// an object put somewhere (turned, scaled): returned, to add on
export const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, r?: [number, number, number], sc?: [number, number, number]) => {
  o.position.set(x, y, z); if (r) o.rotation.set(...r); if (sc) o.scale.set(...sc); return o;
};
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0);

// the materials the venue and its gear share (after baking only the pictures make a difference)
export function gearMats() {
  return {
    alu: std({ color: 0xdfe3e9, metalness: 0.92, roughness: 0.3, map: brushed() }),
    black: std({ color: 0x101113, roughness: 0.92 }),
    grille: std({ map: grille(), roughness: 0.75, metalness: 0.35 }),
    tolex: std({ map: tolex(), roughness: 0.85 }),
    chrome: std({ color: 0xe8ecf2, metalness: 1, roughness: 0.12 }),
    brass: std({ color: 0xc8a046, metalness: 0.95, roughness: 0.28 }),
    rubber: std({ color: 0x0a0a0b, roughness: 0.95 }),
    caseAlu: std({ color: 0xaab0b8, metalness: 0.85, roughness: 0.4 }),
    steel: std({ color: 0x2c2f35, metalness: 0.6, roughness: 0.5 }),
    plastic: std({ color: 0x1b1c1f, roughness: 0.5 }),
    gaffer: std({ color: 0x2e2e30, roughness: 0.6 }),
    cloth: std({ map: cabCloth(), roughness: 0.95 }),
    piping: std({ color: 0xd8cfb8, roughness: 0.6 }),
    ply: std({ color: 0x6e5236, roughness: 0.85 }),
    stencil: std({ map: stencils(), roughness: 0.7 }),
    ledRed: std({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 1.2 }),
    ledBlue: std({ color: 0x40a0ff, emissive: 0x40a0ff, emissiveIntensity: 1.2 }),
    tally: std({ color: 0xff1010, emissive: 0xff1010, emissiveIntensity: 2 }),
    glass: std({ color: 0x0a1420, metalness: 0.2, roughness: 0.08 }),
    bottle: std({ color: 0x9fd0ff, roughness: 0.1, transparent: true, opacity: 0.55 }),
  };
}
export type Mats = ReturnType<typeof gearMats>;

// ---- primitives (meshes)
const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => new THREE.Mesh(g, m);
export const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[]) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
export const rbox = (w: number, h: number, d: number, r: number, m: THREE.Material | THREE.Material[], seg = 1) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, r), m);
export const cyl = (rt: number, rb: number, h: number, m: THREE.Material, seg = 12) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
const sph = (r: number, m: THREE.Material, w = 10, h = 8) => new THREE.Mesh(new THREE.SphereGeometry(r, w, h), m);
// a rod from a to b
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, seg = 8) {
  const d = b.clone().sub(a), c = cyl(r, r, Math.max(1e-4, d.length()), m, seg);
  c.position.copy(a).addScaledVector(d, 0.5); c.quaternion.setFromUnitVectors(Y, d.normalize()); return c;
}
// a cable (a tube through the points)
// a rubber grip of length L at the end b of a handle coming from a
const grip = (a: THREE.Vector3, b: THREE.Vector3, r: number, L: number, m: THREE.Material) => { const u = b.clone().sub(a).normalize(); return rod(b.clone().addScaledVector(u, -L / 2), b.clone().addScaledVector(u, L / 2), r, m, 8); };
export const tube = (pts: THREE.Vector3[], r: number, m: THREE.Material, seg = 24, radial = 6) => mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, radial), m);

// A cable on the floor at height y through (x, z) points, taped down every so often with gaffer
// where people walk (the tape drapes over the cable onto the floor either side).
export function floorCable(M: Mats, pts: [number, number][], y: number, o: { r?: number; m?: THREE.Material; tape?: number } = {}) {
  const g = new THREE.Group(), r = o.r ?? 0.011;
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => V(x, y + r, z)));
  const L = curve.getLength();
  g.add(mesh(new THREE.TubeGeometry(curve, Math.max(8, Math.round(L * 6)), r, 6), o.m ?? M.rubber));
  if (o.tape) {
    const strip = new THREE.PlaneGeometry(0.05, 0.2, 1, 8).rotateX(-Math.PI / 2);
    const p = strip.attributes.position;
    for (let i = 0; i < p.count; i++) { const t = Math.abs(p.getZ(i)) / (r * 2.2); p.setY(i, 0.0015 + 2 * r * Math.max(0, 1 - t * t)); }
    strip.computeVertexNormals();
    for (let d = o.tape * 0.5; d < L; d += o.tape) {
      const u = d / L, at0 = curve.getPointAt(u), tan = curve.getTangentAt(u);
      const s = mesh(strip, M.gaffer); s.position.set(at0.x, y, at0.z); s.rotation.y = Math.atan2(tan.x, tan.z); g.add(s);
    }
  }
  return g;
}

// ---- road cases, cabs, heads

// a road case: tolex, aluminium edges, ball corners, handles, latches, a stencil, maybe casters
export function roadCase(M: Mats, w: number, h: number, d: number, o: { stencil?: number; wheels?: boolean } = {}) {
  const g = new THREE.Group(), lo = o.wheels ? 0.11 : 0, y = lo + h / 2;
  g.add(at(box(w, h, d, M.tolex), 0, y, 0));
  g.add(at(box(w + 0.008, 0.028, d + 0.008, M.caseAlu), 0, lo + h * 0.74, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(at(box(0.03, h, 0.03, M.caseAlu), sx * w / 2, y, sz * d / 2));
    for (const sy of [0, 1]) g.add(at(sph(0.022, M.chrome, 8, 6), sx * w / 2, lo + sy * h, sz * d / 2));
  }
  for (const sy of [0, 1]) for (const s of [-1, 1]) { g.add(at(box(w, 0.03, 0.03, M.caseAlu), 0, lo + sy * h, s * d / 2)); g.add(at(box(0.03, 0.03, d, M.caseAlu), s * w / 2, lo + sy * h, 0)); }
  // recessed handles on the ends, butterfly latches on the front
  for (const sx of [-1, 1]) { g.add(at(box(0.012, 0.08, 0.15, M.black), sx * (w / 2 + 0.002), lo + h * 0.58, 0)); g.add(at(cyl(0.008, 0.008, 0.12, M.chrome, 6), sx * (w / 2 + 0.012), lo + h * 0.58, 0, [Math.PI / 2, 0, 0])); }
  for (const lx of [-w / 4, w / 4]) g.add(at(box(0.05, 0.045, 0.012, M.chrome), lx, lo + h * 0.74, d / 2 + 0.008));
  if (o.stencil !== undefined) {
    const k = o.stencil % STENCILS.length, sw = Math.min(w * 0.8, 0.9), sh = Math.min(0.11, h * 0.22);
    const pl = new THREE.PlaneGeometry(sw, sh), uv = pl.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (k + 1 - uv.getY(i)) / STENCILS.length);
    g.add(at(mesh(pl, M.stencil), 0, lo + h * 0.4, d / 2 + 0.004));
  }
  if (o.wheels) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(at(box(0.05, 0.05, 0.05, M.steel), sx * (w / 2 - 0.07), lo - 0.025, sz * (d / 2 - 0.07)));
    g.add(at(cyl(0.045, 0.045, 0.035, M.rubber, 12), sx * (w / 2 - 0.07), 0.045, sz * (d / 2 - 0.07), [0, 0, Math.PI / 2]));
  }
  return g;
}
// a speaker cab: tolex, a front of cloth (guitar) or steel grille (bass), piping, corners, handles
export function cab(M: Mats, kind: '4x12' | '8x10' | '2x12') {
  const g = new THREE.Group(), [w, h, d] = kind === '8x10' ? [0.61, 1.33, 0.43] : kind === '4x12' ? [0.76, 0.76, 0.36] : [0.7, 0.5, 0.27];
  const lo = kind === '8x10' ? 0.08 : 0.02;
  g.add(at(rbox(w, h, d, 0.015, M.tolex), 0, lo + h / 2, 0));
  const front = kind === '8x10' ? M.grille : M.cloth;
  g.add(at(mesh(new THREE.PlaneGeometry(w - 0.07, h - 0.07), front), 0, lo + h / 2, d / 2 + 0.002));
  for (const [x, y, ww, hh] of [[0, h - 0.033, w - 0.05, 0.008], [0, 0.033, w - 0.05, 0.008], [w / 2 - 0.033, h / 2, 0.008, h - 0.05], [-w / 2 + 0.033, h / 2, 0.008, h - 0.05]]) g.add(at(box(ww, hh, 0.006, M.piping), x, lo + y, d / 2 + 0.003));
  g.add(at(box(0.16, 0.04, 0.006, M.brass), -w / 2 + 0.14, lo + h - 0.08, d / 2 + 0.006));
  for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) g.add(at(box(0.04, 0.04, 0.04, M.chrome), sx * (w / 2 - 0.012), lo + 0.012 + sy * (h - 0.024), sz * (d / 2 - 0.012)));
  for (const sx of [-1, 1]) { g.add(at(box(0.012, 0.06, 0.16, M.black), sx * (w / 2 + 0.004), lo + h * 0.7, 0)); g.add(at(cyl(0.007, 0.007, 0.13, M.chrome, 6), sx * (w / 2 + 0.013), lo + h * 0.7, 0, [Math.PI / 2, 0, 0])); }
  if (kind === '8x10') for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(cyl(0.035, 0.035, 0.03, M.rubber, 10), sx * (w / 2 - 0.08), 0.035, sz * (d / 2 - 0.08), [0, 0, Math.PI / 2]));
  else for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(cyl(0.02, 0.02, 0.02, M.rubber, 8), sx * (w / 2 - 0.06), 0.01, sz * (d / 2 - 0.06)));
  g.userData.top = lo + h;
  return g;
}
// an amp head: tolex, a control panel with knobs, a jewel light, a handle on top
export function ampHead(M: Mats, panel: THREE.Material, w = 0.72) {
  const g = new THREE.Group(), h = 0.26, d = 0.28;
  g.add(at(rbox(w, h, d, 0.015, M.tolex), 0, h / 2, 0));
  g.add(at(box(w - 0.06, 0.09, 0.008, panel), 0, h * 0.42, d / 2 + 0.002));
  for (let i = 0; i < 8; i++) g.add(at(cyl(0.011, 0.012, 0.018, i % 4 === 3 ? M.chrome : M.plastic, 8), -w / 2 + 0.1 + i * ((w - 0.2) / 7), h * 0.42, d / 2 + 0.012, [Math.PI / 2, 0, 0]));
  g.add(at(sph(0.008, M.ledRed, 6, 4), w / 2 - 0.05, h * 0.42, d / 2 + 0.008));
  g.add(at(box(w - 0.08, 0.06, 0.004, M.cloth), 0, h * 0.78, d / 2 + 0.002));
  g.add(at(box(0.2, 0.012, 0.035, M.black), 0, h + 0.006, 0));
  for (const sx of [-1, 1]) g.add(at(box(0.02, 0.025, 0.035, M.chrome), sx * 0.1, h + 0.006, 0));
  return g;
}

// ---- guitars and pedals

const BODY: Record<'solid' | 'single' | 'acoustic' | 'bass', [number, number][]> = {
  solid: [[0, 0], [0.12, 0.02], [0.17, 0.12], [0.14, 0.25], [0.155, 0.34], [0.11, 0.43], [0.03, 0.44], [-0.03, 0.42], [-0.06, 0.36], [-0.1, 0.39], [-0.14, 0.33], [-0.14, 0.25], [-0.17, 0.12], [-0.12, 0.02]],
  single: [[0, 0], [0.13, 0.02], [0.17, 0.13], [0.13, 0.25], [0.15, 0.36], [0.12, 0.46], [0.08, 0.42], [0.03, 0.37], [-0.03, 0.37], [-0.07, 0.42], [-0.1, 0.44], [-0.12, 0.33], [-0.13, 0.25], [-0.17, 0.13], [-0.13, 0.02]],
  acoustic: [[0, 0], [0.17, 0.04], [0.2, 0.16], [0.15, 0.27], [0.14, 0.33], [0.12, 0.43], [0.05, 0.47], [-0.05, 0.47], [-0.12, 0.43], [-0.14, 0.33], [-0.15, 0.27], [-0.2, 0.16], [-0.17, 0.04]],
  bass: [[0, 0], [0.14, 0.02], [0.18, 0.14], [0.135, 0.27], [0.15, 0.38], [0.12, 0.52], [0.08, 0.44], [0.03, 0.39], [-0.03, 0.39], [-0.07, 0.45], [-0.1, 0.48], [-0.12, 0.35], [-0.135, 0.27], [-0.18, 0.14], [-0.14, 0.02]],
};
// A guitar standing up: the body's bottom at the origin, the neck up +y, the strings facing +z.
// userData.neck: the height on the neck where a stand's yoke holds it; userData.depth: body depth.
export function guitar(M: Mats, kind: keyof typeof BODY, color: number) {
  const g = new THREE.Group(), depth = kind === 'acoustic' ? 0.1 : 0.045, s = new THREE.Shape();
  const pts = BODY[kind].map(([x, y]) => new THREE.Vector2(x, y));
  s.moveTo(pts[0].x, pts[0].y); s.splineThru([...pts.slice(1), pts[0]]);
  const body = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 6 });
  g.add(mesh(body, std({ color, roughness: kind === 'acoustic' ? 0.45 : 0.22, metalness: 0.1 })));
  const top = kind === 'acoustic' ? 0.47 : kind === 'bass' ? 0.39 : 0.37, L = kind === 'bass' ? 0.82 : kind === 'acoustic' ? 0.5 : 0.6, fz = depth + 0.008;
  const wood = std({ color: 0x5a3418, roughness: 0.55 }), board = std({ color: 0x2a1a10, roughness: 0.5 });
  g.add(at(box(0.05, L + 0.06, 0.022, wood), 0, top - 0.03 + (L + 0.06) / 2, depth - 0.012));
  g.add(at(box(0.048, L, 0.006, board), 0, top + L / 2, fz - 0.004));
  g.add(at(box(0.085, 0.18, 0.016, kind === 'acoustic' ? wood : board), kind === 'single' || kind === 'bass' ? 0.02 : 0, top + L + 0.09, depth - 0.01));
  const n = kind === 'bass' ? 4 : 6;
  for (let i = 0; i < n; i++) {
    const side = kind === 'single' || kind === 'bass' ? 1 : i < n / 2 ? -1 : 1, k = kind === 'single' || kind === 'bass' ? i : i % (n / 2);
    g.add(at(cyl(0.006, 0.006, 0.03, M.chrome, 6), (kind === 'single' || kind === 'bass' ? 0.06 : side * 0.05), top + L + 0.03 + k * (0.14 / (n / (kind === 'single' || kind === 'bass' ? 1 : 2))), depth - 0.01, [0, 0, Math.PI / 2]));
  }
  const bridge = kind === 'acoustic' ? 0.12 : 0.1;
  for (let i = 0; i < n; i++) g.add(at(box(0.0015, top + L - bridge, 0.0015, M.chrome), (i - (n - 1) / 2) * (kind === 'bass' ? 0.011 : 0.0075), (bridge + top + L) / 2, fz + 0.004));
  if (kind === 'acoustic') {
    g.add(at(mesh(new THREE.CircleGeometry(0.045, 16), M.black), 0, 0.3, depth + 0.0065));
    g.add(at(box(0.12, 0.025, 0.008, board), 0, bridge, depth + 0.009));
  } else {
    g.add(at(box(0.08, 0.025, 0.012, M.chrome), 0, bridge, fz));
    for (const py of kind === 'single' ? [0.17, 0.22, 0.28] : [0.16, 0.27]) g.add(at(box(kind === 'single' ? 0.075 : 0.085, kind === 'single' ? 0.02 : 0.04, 0.01, kind === 'single' ? M.piping : M.plastic), 0, py, fz));
    for (const [kx, ky] of [[0.09, 0.1], [0.11, 0.06], [0.07, 0.04]]) g.add(at(cyl(0.012, 0.013, 0.014, M.plastic, 10), kx, ky, fz, [Math.PI / 2, 0, 0]));
  }
  g.userData.neck = top + L * 0.82; g.userData.depth = depth;
  return g;
}
// a spare guitar resting on an A-frame stand: the body's bottom on the padded cradle, the neck in
// the yoke at the top; both touch the guitar where it really rests
export function guitarOnStand(M: Mats, kind: keyof typeof BODY, color: number) {
  const g = new THREE.Group(), gt = guitar(M, kind, color), lean = 0.27, d = gt.userData.depth as number;
  gt.position.set(0, 0.105, 0.02); gt.rotation.x = -lean; g.add(gt);
  gt.updateMatrix();
  const neck = V(0, gt.userData.neck, -0.008).applyMatrix4(gt.matrix), foot = V(0, 0, -0.012);
  // the post from the base up to just behind the neck, the yoke round it
  g.add(rod(foot, neck.clone().add(V(0, -0.03, -0.012)), 0.011, M.black));
  g.add(at(mesh(new THREE.TorusGeometry(0.03, 0.006, 5, 10, Math.PI), M.rubber), neck.x, neck.y - 0.012, neck.z - 0.02, [Math.PI / 2 - lean, 0, Math.PI]));
  // the legs (front pair) and the cradle under the body
  const cradle = V(0, 0.095, 0.02 + d / 2);
  for (const sx of [-1, 1]) { g.add(rod(V(sx * 0.17, 0, 0.16), V(sx * 0.11, 0.09, cradle.z), 0.01, M.black)); g.add(rod(V(sx * 0.17, 0, 0.16), foot, 0.01, M.black)); }
  g.add(rod(V(-0.12, 0.095, cradle.z), V(0.12, 0.095, cradle.z), 0.016, M.rubber));
  g.add(rod(foot, V(0, 0, -0.25), 0.01, M.black));
  return g;
}
// A pedalboard: an aluminium board, a row of pedals with knobs, footswitches and LEDs, patch cables
// between them. userData.out: where the cable to the amp leaves (back left corner).
export function pedalboard(M: Mats, seed: number) {
  const g = new THREE.Group(), w = 0.62, d = 0.32;
  const base = new THREE.Group(); base.rotation.x = 0.1; base.position.y = 0.035; g.add(base);
  base.add(at(box(w, 0.025, d, M.steel), 0, 0, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(0.04, 0.035, 0.04, M.rubber), sx * (w / 2 - 0.04), 0.018 - sz * 0.012, sz * (d / 2 - 0.04)));
  const COLORS = [0x2a8a3a, 0xe07020, 0x2a5ab0, 0xc8c8c0, 0xb02020, 0x7a3aa0, 0xe0c020];
  let s = seed; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pedals: { x: number; z: number; w: number }[] = [];
  let x = -w / 2 + 0.05;
  // the tuner first, then drives, modulation, delay, reverb; a wah at the end of the front row
  for (let i = 0; i < 6 && x < w / 2 - 0.08; i++) {
    const pw = 0.07 + (i === 0 ? 0.005 : r() * 0.02), pd = 0.12, z = i % 2 ? -0.07 : 0.06;
    const c = i === 0 ? 0x1a1a1a : COLORS[Math.floor(r() * COLORS.length)];
    const p = new THREE.Group(); at(p, x + pw / 2, 0.035, z);
    p.add(at(rbox(pw, 0.045, pd, 0.006, std({ color: c, roughness: 0.4, metalness: 0.3 })), 0, 0, 0));
    for (let k = 0; k < (i === 0 ? 0 : 2 + Math.floor(r() * 2)); k++) p.add(at(cyl(0.008, 0.009, 0.012, k % 2 ? M.piping : M.plastic, 8), -pw / 2 + 0.015 + k * ((pw - 0.03) / 2), 0.028, -0.03));
    p.add(at(cyl(0.008, 0.008, 0.012, M.chrome, 8), 0, 0.028, 0.035));
    p.add(at(sph(0.004, i === 0 ? M.ledBlue : M.ledRed, 6, 4), pw / 2 - 0.012, 0.024, 0.008));
    base.add(p); pedals.push({ x: x + pw / 2, z, w: pw });
    x += pw + 0.012;
  }
  // a wah in the front corner
  const wah = new THREE.Group(); at(wah, w / 2 - 0.06, 0.04, 0.06);
  wah.add(at(box(0.1, 0.05, 0.22, M.plastic), 0, 0, 0)); wah.add(at(box(0.09, 0.012, 0.2, M.rubber), 0, 0.03, 0, [-0.12, 0, 0]));
  base.add(wah);
  // patch cables pedal to pedal, over the top a little
  for (let i = 0; i + 1 < pedals.length; i++) {
    const a = pedals[i], b = pedals[i + 1];
    base.add(tube([V(a.x + a.w / 2, 0.04, a.z), V((a.x + b.x) / 2, 0.075, (a.z + b.z) / 2), V(b.x - b.w / 2, 0.04, b.z)], 0.0045, M.rubber, 8, 5));
  }
  g.userData.out = V(-w / 2 + 0.03, 0.03, -d / 2);
  return g;
}
// a DI box: a little steel box with a jack in and an XLR out
export function diBox(M: Mats, color = 0x2a4a8a) {
  const g = new THREE.Group();
  g.add(at(rbox(0.1, 0.05, 0.13, 0.006, std({ color, metalness: 0.5, roughness: 0.45 })), 0, 0.025, 0));
  g.add(at(cyl(0.008, 0.008, 0.012, M.chrome, 8), 0.02, 0.025, 0.068, [Math.PI / 2, 0, 0]));
  g.add(at(cyl(0.011, 0.011, 0.01, M.plastic, 10), 0, 0.025, -0.068, [Math.PI / 2, 0, 0]));
  g.add(at(box(0.012, 0.008, 0.006, M.chrome), -0.03, 0.052, 0.02));
  return g;
}
// a stage box: the XLR panel on the front, handles, plugged cables hanging out, a multicore behind
export function stageBox(M: Mats, plugged = 10) {
  const g = new THREE.Group(), w = 0.48, h = 0.3, d = 0.26;
  g.add(at(rbox(w, h, d, 0.012, M.steel), 0, h / 2, 0));
  g.add(at(mesh(new THREE.PlaneGeometry(w - 0.04, h - 0.06), std({ map: stageBoxPanel(), roughness: 0.5, metalness: 0.4 })), 0, h / 2, d / 2 + 0.002));
  for (const sx of [-1, 1]) g.add(rod(V(sx * (w / 2 + 0.015), h * 0.3, 0.06), V(sx * (w / 2 + 0.015), h * 0.3, -0.06), 0.009, M.chrome, 6));
  for (let i = 0; i < plugged; i++) {
    const c = i % 8, row = Math.floor(i / 8), px = -w / 2 + 0.02 + (w - 0.04) * (18 + c * 30) / 256, py = h / 2 + (h - 0.06) * (0.5 - (18 + row * 30) / 128);
    g.add(at(cyl(0.011, 0.011, 0.045, M.plastic, 8), px, py, d / 2 + 0.024, [Math.PI / 2, 0, 0]));
    g.add(tube([V(px, py, d / 2 + 0.045), V(px, py - 0.02, d / 2 + 0.09), V(px * 0.9, 0.012, d / 2 + 0.2 + c * 0.012)], 0.0055, M.rubber, 10, 5));
  }
  g.add(at(cyl(0.04, 0.04, 0.05, M.plastic, 12), 0, h * 0.5, -d / 2 - 0.02, [Math.PI / 2, 0, 0]));
  g.userData.multi = V(0, 0.03, -d / 2 - 0.06);
  return g;
}

// ---- mics

// A small drum mic on a rim clip: its grille at the origin, pointing along +y (like the vocal mics)
export function clipMic(M: Mats, kind: 'dyn' | 'pencil' | 'kick' = 'dyn') {
  const g = new THREE.Group();
  if (kind === 'kick') {
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10).scale(0.05, 0.085, 0.05), M.plastic), 0, -0.085, 0));
    g.add(at(sph(0.045, M.grille, 12, 8), 0, -0.02, 0));
  } else if (kind === 'pencil') {
    g.add(at(cyl(0.011, 0.011, 0.13, M.chrome, 10), 0, -0.065, 0));
    g.add(at(cyl(0.0115, 0.0115, 0.025, M.grille, 10), 0, -0.012, 0));
  } else {
    g.add(at(cyl(0.017, 0.015, 0.11, M.plastic, 10), 0, -0.07, 0));
    g.add(at(cyl(0.019, 0.019, 0.03, M.grille, 10), 0, -0.012, 0));
  }
  return g;
}
// put a mic's grille at `tip`, pointing at `target` (both in the parent's space)
export function aimMic(mic: THREE.Object3D, tip: THREE.Vector3, target: THREE.Vector3) {
  mic.position.copy(tip); mic.quaternion.setFromUnitVectors(Y, target.clone().sub(tip).normalize()); return mic;
}

// ---- monitor world

// an in-ear rack: a rack case on casters, transmitters behind the front, paddle antennas on top
export function iemRack(M: Mats) {
  const g = roadCase(M, 0.56, 0.42, 0.55, { wheels: true, stencil: 6 });
  g.add(at(mesh(new THREE.PlaneGeometry(0.48, 0.3), std({ map: rackFront(17), roughness: 0.6, metalness: 0.4, emissive: 0x112233, emissiveIntensity: 0.25 })), 0, 0.11 + 0.21, 0.282));
  for (const sx of [-1, 1]) {
    g.add(rod(V(sx * 0.18, 0.53, 0), V(sx * 0.2, 0.75, 0.02), 0.008, M.black));
    const pad = new THREE.Shape(); pad.moveTo(0, 0); pad.lineTo(0.09, 0.2); pad.lineTo(-0.09, 0.2); pad.closePath();
    g.add(at(mesh(new THREE.ExtrudeGeometry(pad, { depth: 0.012, bevelEnabled: false }), M.plastic), sx * 0.2, 0.74, 0.015, [0, sx * 0.4, 0]));
  }
  for (const x of [-0.08, 0.08]) g.add(at(cyl(0.003, 0.003, 0.2, M.black, 4), x, 0.63, 0.2));
  return g;
}
// a side fill: a sub with a top box on it
export function sideFill(M: Mats) {
  const g = new THREE.Group(), cabM = [M.tolex, M.tolex, M.tolex, M.tolex, M.grille, M.tolex];
  g.add(at(rbox(0.7, 0.6, 0.75, 0.02, cabM, 2), 0, 0.3, 0));
  const top = rbox(0.48, 0.72, 0.42, 0.02, cabM, 2); top.rotation.x = -0.06; g.add(at(top, 0, 0.6 + 0.36, 0.05));
  for (const sx of [-1, 1]) g.add(at(box(0.01, 0.05, 0.14, M.black), sx * 0.241, 1.1, 0.05));
  g.add(at(box(0.12, 0.03, 0.004, M.piping), 0.15, 1.2, 0.27));
  return g;
}

// A desk (sound, monitors or lighting) on a stand: a sloped top with its picture, fader caps,
// screens. userData.hands: where an engineer's hands rest (on faders), in the desk's space; the
// engineer stands at +z, facing -z.
export function desk(M: Mats, kind: 'sound' | 'monitor' | 'light') {
  const g = new THREE.Group(), w = kind === 'sound' ? 1.5 : kind === 'monitor' ? 1.05 : 1.3, d = 0.66, base = 0.82;
  const hf = 0.07, hb = 0.17, tilt = Math.atan2(hb - hf, d);
  // the stand: a road case (monitors) or a table with legs
  if (kind === 'monitor') g.add(roadCase(M, w + 0.06, base, d + 0.04, { stencil: 6 }));
  else {
    g.add(at(box(w + 0.2, 0.04, d + 0.02, M.black), 0, base - 0.02, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(box(0.04, base - 0.04, 0.04, M.steel), sx * (w / 2 + 0.05), (base - 0.04) / 2, sz * (d / 2)));
  }
  // the console: a wedge, the top sloping down towards the engineer
  const sh = new THREE.Shape(); sh.moveTo(-d / 2, 0); sh.lineTo(d / 2, 0); sh.lineTo(d / 2, hf); sh.lineTo(-d / 2, hb); sh.closePath();
  const body = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false }).translate(0, 0, -w / 2).rotateY(Math.PI / 2);
  g.add(at(mesh(body, M.plastic), 0, base, 0));
  const topLen = Math.hypot(d, hb - hf);
  const top = mesh(new THREE.PlaneGeometry(w - 0.02, topLen - 0.02), std({ map: consoleTop(kind === 'light' ? 'light' : 'sound'), roughness: 0.55, metalness: 0.2 }));
  top.rotation.x = -Math.PI / 2 + tilt; top.position.set(0, base + (hf + hb) / 2 + 0.002, 0); g.add(top);
  // a point on the top: u across (0 left .. 1 right as the engineer sees it), t from back (0) to front (1)
  const surf = (u: number, t: number, up = 0) => V((u - 0.5) * (w - 0.02), base + hb + (hf - hb) * t + up, -d / 2 + d * t);
  const caps = std({ color: 0xd8d8d8, roughness: 0.5 });
  const fader = (u: number, k: number) => { const p = surf(u, 0.49 + 0.45 * k, 0.012); const c = box(0.016, 0.018, 0.024, caps); c.position.copy(p); c.rotation.x = tilt; g.add(c); return p; };
  let s = kind === 'sound' ? 3 : kind === 'monitor' ? 5 : 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // (the two faders the hands are on sit pulled down near the front, the rest anywhere)
  const hands: Record<'L' | 'R', THREE.Vector3> = { L: V(0, 0, 0), R: V(0, 0, 0) };
  if (kind === 'light') {
    for (let c = 0; c < 15; c++) { const p = fader((26 + c * 26) / 1024, c === 11 ? 0.85 : 0.2 + r() * 0.7); if (c === 11) hands.L = p; }
    for (let c = 0; c < 8; c++) { const p = fader((800 + c * 28) / 1024, c === 1 ? 0.85 : r()); if (c === 1) hands.R = p; }
    // two touch screens on a stand at the back, a desk lamp
    for (const sx of [-1, 1]) {
      const scr = mesh(new THREE.PlaneGeometry(0.44, 0.3), new THREE.MeshBasicMaterial({ map: screen(sx < 0 ? 'desk' : 'sheet'), toneMapped: false }));
      const fr = box(0.47, 0.33, 0.02, M.plastic); fr.add(at(scr, 0, 0, 0.011));
      at(fr, sx * 0.25, base + hb + 0.24, -d / 2 + 0.02, [-0.25, -sx * 0.12, 0]); g.add(fr);
    }
    g.add(rod(V(0.58, base + hb, -d / 2 + 0.05), V(0.5, base + hb + 0.32, -d / 2 + 0.18), 0.006, M.black, 6));
    g.add(at(cyl(0.012, 0.03, 0.05, M.black, 10), 0.5, base + hb + 0.31, -d / 2 + 0.2, [0.6, 0, 0]));
  } else {
    const iL = kind === 'sound' ? 6 : 8, iR = kind === 'sound' ? 15 : 14;
    for (let c = 0; c < 24; c++) { const p = fader((27 + c * 30) / 1024, c === iL || c === iR ? 0.85 : 0.2 + r() * 0.6); if (c === iL) hands.L = p; if (c === iR) hands.R = p; }
    const scr = mesh(new THREE.PlaneGeometry(kind === 'sound' ? 0.42 : 0.3, kind === 'sound' ? 0.27 : 0.2), new THREE.MeshBasicMaterial({ map: screen('meters'), toneMapped: false }));
    const fr = box(kind === 'sound' ? 0.45 : 0.33, kind === 'sound' ? 0.3 : 0.23, 0.025, M.plastic); fr.add(at(scr, 0, 0, 0.013));
    at(fr, 0.32 * (w / 1.5) + 0.05, base + hb + 0.13, -d / 2 + 0.06, [-0.3, 0, 0]); g.add(fr);
    // the talkback mic on a gooseneck
    g.add(tube([V(-w / 2 + 0.1, base + hb, -d / 2 + 0.06), V(-w / 2 + 0.1, base + hb + 0.15, -d / 2 + 0.08), V(-w / 2 + 0.15, base + hb + 0.22, -d / 2 + 0.2)], 0.005, M.black, 10, 5));
    g.add(at(cyl(0.012, 0.009, 0.06, M.plastic, 8), -w / 2 + 0.16, base + hb + 0.22, -d / 2 + 0.22, [1.3, 0, 0]));
  }
  // hands: on those two faders' caps (their tops)
  g.userData.hands = { L: hands.L.clone().add(V(0, 0.01, 0)), R: hands.R.clone().add(V(0, 0.01, 0)) };
  g.userData.top = base + hb;
  return g;
}

// A person from people.ts put to work: standing at (x, y, z) turned by yaw, hands on the points
// given (in world space) or hanging. Returns the person and where its wrists were sent (world).
export function crewMember(look: PersonLook, x: number, y: number, z: number, yaw: number, hands: { L?: THREE.Vector3; R?: THREE.Vector3 }, lean = 0.06) {
  const p = new Person(look);
  p.group.position.set(x, y, z); p.group.rotation.y = yaw; p.group.updateMatrix();
  p.body.rotation.x = lean; p.body.position.y = -0.01; p.body.updateMatrix();
  const inv = p.group.matrix.clone().invert(), wrists: { L?: THREE.Vector3; R?: THREE.Vector3 } = {};
  for (const s of ['L', 'R'] as const) {
    const h = hands[s]; if (!h) continue;
    const local = h.clone().applyMatrix4(inv), sh = V(s === 'L' ? SHOULDER.x : -SHOULDER.x, SHOULDER.y, SHOULDER.z).applyMatrix4(p.body.matrix);
    // (the wrist a hand's length back from what the hand is on, towards the shoulder)
    const w = local.clone().addScaledVector(sh.sub(local).normalize(), 0.075);
    p.hand(s, w); wrists[s] = w.clone().applyMatrix4(p.group.matrix);
  }
  p.update();
  return { p, wrists, on: hands };
}

// ---- FOH and the camera

// a camera on a tripod: three legs and a spreader, a fluid head, the body, lens and hood, the
// viewfinder, a tally light, the pan bar. userData: where the operator's hands go (pan bar end,
// the zoom grip on the lens), in the camera's space; it looks along +z.
export function cameraTripod(M: Mats) {
  const g = new THREE.Group(), hy = 1.38;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6, foot = V(Math.sin(a) * 0.48, 0, Math.cos(a) * 0.48);
    g.add(rod(V(Math.sin(a) * 0.05, hy - 0.08, Math.cos(a) * 0.05), foot, 0.014, M.black, 6));
    g.add(rod(V(Math.sin(a) * 0.05, hy - 0.08, Math.cos(a) * 0.05).lerp(foot, 0.5), foot, 0.017, M.caseAlu, 6));
    g.add(rod(V(0, 0.32, 0), V(Math.sin(a) * 0.38, 0.32, Math.cos(a) * 0.38), 0.008, M.steel, 5));
  }
  g.add(at(cyl(0.07, 0.06, 0.08, M.black, 14), 0, hy - 0.04, 0));
  g.add(at(box(0.12, 0.08, 0.14, M.plastic), 0, hy + 0.04, 0));
  const cam = new THREE.Group(); at(cam, 0, hy + 0.08, 0); g.add(cam);
  cam.add(at(rbox(0.14, 0.17, 0.34, 0.02, M.plastic), 0, 0.085, -0.02));
  cam.add(at(cyl(0.055, 0.05, 0.24, M.black, 14), 0, 0.09, 0.27, [Math.PI / 2, 0, 0]));
  cam.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.058, 0.07, 14, 1, true), M.black), 0, 0.09, 0.42, [Math.PI / 2, 0, 0]));
  cam.add(at(mesh(new THREE.CircleGeometry(0.052, 14), M.glass), 0, 0.09, 0.39));
  cam.add(at(box(0.07, 0.05, 0.1, M.plastic), -0.1, 0.17, 0.05));
  cam.add(at(cyl(0.022, 0.022, 0.04, M.rubber, 10), -0.1, 0.17, -0.02, [Math.PI / 2, 0, 0]));
  cam.add(tube([V(0, 0.17, -0.12), V(0, 0.23, -0.06), V(0, 0.23, 0.08), V(0, 0.17, 0.14)], 0.009, M.black, 12, 5));
  cam.add(at(box(0.02, 0.012, 0.008, M.tally), 0.04, 0.17, 0.153));
  // the pan bar back to the operator's right (-x), and its handle end
  const bar0 = V(-0.05, hy + 0.04, -0.06), bar1 = V(-0.42, hy - 0.14, -0.12);
  g.add(rod(bar0, bar1, 0.012, M.black, 6));
  g.add(grip(bar0, bar1, 0.017, 0.12, M.rubber));
  // (a zoom rocker on the side of the body, under the operator's left hand)
  cam.add(at(box(0.03, 0.05, 0.08, M.rubber), 0.085, 0.03, -0.02));
  g.userData.hands = { R: bar1.clone(), L: V(0.1, hy + 0.08 + 0.03, -0.02) };
  return g;
}
// a follow spot on its stand: a long body with a lens at the front, the lamp house at the back
// and two handles there; turned on its yoke so it points at `target` (in the spot's space).
// userData.hands: the two handle grips (in the spot's space).
export function followSpot(M: Mats, target: THREE.Vector3) {
  const g = new THREE.Group(), hy = 1.12;
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2, foot = V(Math.sin(a) * 0.45, 0.05, Math.cos(a) * 0.45); g.add(rod(V(0, 0.55, 0), foot, 0.02, M.steel, 6)); g.add(at(cyl(0.04, 0.04, 0.03, M.rubber, 10), foot.x, 0.04, foot.z, [0, 0, Math.PI / 2])); }
  g.add(at(cyl(0.035, 0.04, 0.6, M.steel, 10), 0, 0.82, 0));
  const pan = new THREE.Group(); pan.position.y = hy; g.add(pan);
  const dir = target.clone().sub(V(0, hy, 0));
  pan.rotation.y = Math.atan2(dir.x, dir.z);
  const tilt = new THREE.Group(); pan.add(tilt);
  tilt.rotation.x = -Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
  pan.add(at(box(0.44, 0.04, 0.06, M.steel), 0, -0.02, 0));
  for (const sx of [-1, 1]) pan.add(at(box(0.03, 0.22, 0.06, M.steel), sx * 0.21, 0.08, 0));
  tilt.position.y = 0.16;
  tilt.add(at(cyl(0.17, 0.15, 1.05, std({ color: 0x1d1f23, roughness: 0.45, metalness: 0.5 }), 18), 0, 0, 0.12, [Math.PI / 2, 0, 0]));
  tilt.add(at(cyl(0.19, 0.19, 0.08, M.black, 18), 0, 0, 0.66, [Math.PI / 2, 0, 0]));
  tilt.add(at(mesh(new THREE.CircleGeometry(0.15, 18), M.glass), 0, 0, 0.701));
  tilt.add(at(rbox(0.32, 0.34, 0.36, 0.02, M.black), 0, 0.02, -0.52));
  for (let i = 0; i < 4; i++) tilt.add(at(box(0.34, 0.012, 0.3, M.steel), 0, 0.2 + i * 0.02, -0.52));
  for (let i = 0; i < 3; i++) tilt.add(at(cyl(0.06, 0.06, 0.02, M.chrome, 12), 0.18, 0, 0.0 + i * 0.16, [0, 0, Math.PI / 2]));
  const grips: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) {
    const a = V(sx * 0.12, -0.04, -0.68), b = V(sx * 0.2, -0.1, -0.86);
    tilt.add(rod(a, b, 0.012, M.steel, 6)); tilt.add(grip(a, b, 0.018, 0.12, M.rubber));
    grips.push(b);
  }
  g.updateMatrixWorld(true);
  // (the grips in the spot's own space: through the pan and tilt)
  const toG = (p: THREE.Vector3) => p.clone().applyMatrix4(tilt.matrixWorld).applyMatrix4(g.matrixWorld.clone().invert());
  g.userData.hands = { L: toG(grips[1]), R: toG(grips[0]) };
  return g;
}
// a scaffold tower: four standards, ledgers and braces, a plywood deck, a guard rail, a ladder
export function scaffold(M: Mats, w: number, h: number) {
  const g = new THREE.Group(), s = w / 2, galv = std({ color: 0x9aa0a6, metalness: 0.75, roughness: 0.45 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { g.add(at(cyl(0.024, 0.024, h + 1.05, galv, 8), sx * s, (h + 1.05) / 2, sz * s)); g.add(at(box(0.15, 0.01, 0.15, M.steel), sx * s, 0.005, sz * s)); }
  for (const y of [0.15, h / 2, h - 0.05, h + 0.5, h + 1.0]) for (const [a, b] of [[V(-s, y, -s), V(s, y, -s)], [V(s, y, -s), V(s, y, s)], [V(s, y, s), V(-s, y, s)], [V(-s, y, s), V(-s, y, -s)]]) g.add(rod(a, b, 0.02, galv, 6));
  for (const sz of [-1, 1]) g.add(rod(V(-s, 0.15, sz * s), V(s, h - 0.05, sz * s), 0.02, galv, 6));
  g.add(at(box(w + 0.04, 0.04, w + 0.04, M.ply), 0, h, 0));
  for (const sz of [-1, 1]) g.add(at(box(w, 0.15, 0.02, M.ply), 0, h + 0.09, sz * s));
  for (let y = 0.3; y < h; y += 0.3) g.add(rod(V(s + 0.06, y, -0.18), V(s + 0.06, y, 0.18), 0.012, galv, 6));
  for (const z of [-0.18, 0.18]) g.add(rod(V(s + 0.06, 0, z), V(s + 0.06, h + 1.0, z), 0.016, galv, 6));
  return g;
}
// a cable ramp along the floor from a to b (x, z): black ramps, a yellow lid (the snake to FOH under the crowd)
export function rampRun(a: [number, number], b: [number, number]) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), w = 0.5, h = 0.05, bg = new THREE.BoxGeometry(w, h, L), uv = bg.attributes.uv;
  // (the top's picture is 0.5 x 2 m: repeated along the run)
  for (let i = 8; i < 12; i++) uv.setY(i, uv.getY(i) * L / 2);
  const m = std({ map: cableRamp(), roughness: 0.8 }), black = std({ color: 0x141414, roughness: 0.9 });
  const r = new THREE.Mesh(bg, [black, black, m, black, black, black]);
  r.position.set((a[0] + b[0]) / 2, h / 2, (a[1] + b[1]) / 2); r.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
  return r;
}
// a crate of water bottles (a couple already gone)
export function waterCrate(M: Mats) {
  const g = new THREE.Group(), blue = std({ color: 0x2a5ab0, roughness: 0.55 }), w = 0.4, d = 0.3, h = 0.27;
  g.add(at(box(w, 0.02, d, blue), 0, 0.01, 0));
  for (const s of [-1, 1]) { g.add(at(box(w, h, 0.015, blue), 0, h / 2, s * d / 2)); g.add(at(box(0.015, h, d, blue), s * w / 2, h / 2, 0)); }
  const caps = std({ color: 0x2a6ae0, roughness: 0.4 });
  for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) {
    if ((i === 3 && k === 0) || (i === 1 && k === 2)) continue;
    const x = -w / 2 + 0.05 + i * 0.1, z = -d / 2 + 0.05 + k * 0.1;
    g.add(at(cyl(0.034, 0.034, 0.24, M.bottle, 10), x, 0.14, z)); g.add(at(cyl(0.015, 0.015, 0.02, caps, 8), x, 0.27, z));
  }
  return g;
}

// ---- screens and the hall

// An LED wall hung from a bumper: the front shows `face` (a picture the venue paints), the back is
// a grid of cabinets, the sides black; chains from the bumper up to the roof at `roof`.
export function ledWall(M: Mats, w: number, h: number, face: THREE.Material, roof: number, top: number) {
  const g = new THREE.Group(), back = std({ map: ledBack(), roughness: 0.6, metalness: 0.4 });
  const bg = new THREE.BoxGeometry(w, h, 0.14), uv = bg.attributes.uv;
  // (the back's picture repeats once per 0.5 m cabinet)
  for (let i = 40; i < 48; i++) uv.setXY(i, uv.getX(i) * w / 0.5, uv.getY(i) * h / 0.5);
  g.add(new THREE.Mesh(bg, [M.black, M.black, M.black, M.black, M.black, back]));
  g.add(at(mesh(new THREE.PlaneGeometry(w - 0.08, h - 0.08), face), 0, 0, 0.071));
  g.add(at(box(w + 0.1, 0.1, 0.18, M.alu), 0, h / 2 + 0.07, 0));
  // (`top`: where the wall's middle hangs; the chains run from the bumper up to the roof steel)
  const chain = roof - top - h / 2 - 0.12;
  for (const sx of [-1, 1]) { g.add(at(cyl(0.012, 0.012, chain, M.chrome, 5), sx * (w / 2 - 0.3), h / 2 + 0.12 + chain / 2, 0)); g.add(at(box(0.1, 0.06, 0.08, M.black), sx * (w / 2 - 0.3), h / 2 + 0.16, 0)); }
  return g;
}

// The hall: concrete floor, block walls, a steel-deck roof on I-beams, columns, doors with exit
// signs. Walls and roof face inwards (from outside you look straight in); the roof steel hides
// itself when the camera is above the roof (the top view looks down into the hall).
// An unlit wall or ceiling of a room: its colour at full house light, kept, so the 3D stage scales
// it with the Ambient slider (dark by default, black at 0: the house light is off at a show).
export function house<T extends THREE.MeshBasicMaterial>(m: T): T { m.userData.house = m.color.getHex(); return m; }
export const HALL = { x: 24, z0: -10, z1: 31, h: 15 };
export function hall(M: Mats) {
  const g = new THREE.Group(), { x: X, z0, z1, h: H } = HALL, L = z1 - z0, zc = (z0 + z1) / 2;
  // (walls and roof unlit: the show's light never reaches them anyway, and they cover half the
  // picture: a lit material there costs the most for nothing; the colour stands in for the house
  // light, and follows the Ambient slider: `house`)
  const wallM = house(new THREE.MeshBasicMaterial({ map: hallWall(), color: 0xbcbcbe })), roofM = house(new THREE.MeshBasicMaterial({ map: roofDeck(), color: 0xb0b0b4 }));
  // a wall: a plane facing in, its picture in metres (one picture is 6.4 x 3.2 m)
  const wall = (w: number, h: number, m: THREE.Material, su = 6.4, sv = 3.2) => {
    const p = new THREE.PlaneGeometry(w, h), uv = p.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / su, uv.getY(i) * h / sv);
    return mesh(p, m);
  };
  g.add(at(wall(L, H, wallM), -X, H / 2, zc, [0, Math.PI / 2, 0]));
  g.add(at(wall(L, H, wallM), X, H / 2, zc, [0, -Math.PI / 2, 0]));
  g.add(at(wall(2 * X, H, wallM), 0, H / 2, z0));
  g.add(at(wall(2 * X, H, wallM), 0, H / 2, z1, [0, Math.PI, 0]));
  g.add(at(wall(2 * X, L, roofM, 4, 4), 0, H, zc, [Math.PI / 2, 0, 0]));
  // columns along the side walls, I-beams across under the roof, purlins along (hidden from above)
  const steel = std({ color: 0x2a2d33, metalness: 0.6, roughness: 0.55 }); steel.userData.hideAbove = H - 1.2;
  for (let z = z0 + 3; z < z1; z += 6) {
    for (const sx of [-1, 1]) g.add(at(box(0.3, H, 0.4, M.steel), sx * (X - 0.15), H / 2, z));
    g.add(at(box(2 * X, 0.02, 0.26, steel), 0, H - 0.9, z)); g.add(at(box(2 * X, 0.7, 0.016, steel), 0, H - 0.55, z)); g.add(at(box(2 * X, 0.02, 0.26, steel), 0, H - 0.2, z));
  }
  for (let x = -X + 4; x < X; x += 4) g.add(at(box(0.08, 0.16, L, steel), x, H - 0.1, zc));
  // doors: steel double doors with a push bar, an exit sign above (both walls and at the back)
  const door = std({ color: 0x23262b, metalness: 0.5, roughness: 0.5 }), exit = new THREE.MeshBasicMaterial({ map: exitSign(), toneMapped: false });
  const doors: [number, number, number][] = [[-X, 0, 19], [X, 0, 19], [-X, 0, 2], [X, 0, 2], [-6, 0, z1], [6, 0, z1]];
  for (const [x, , z] of doors) {
    const d = new THREE.Group(), yaw = x === -X ? Math.PI / 2 : x === X ? -Math.PI / 2 : Math.PI;
    d.add(at(box(2.0, 2.3, 0.05, door), 0, 1.15, 0.03)); d.add(at(box(2.2, 2.45, 0.03, M.steel), 0, 1.2, 0.01));
    d.add(at(box(0.012, 2.25, 0.06, M.black), 0, 1.15, 0.06));
    for (const sx of [-1, 1]) d.add(at(box(0.8, 0.05, 0.05, M.chrome), sx * 0.5, 1.0, 0.09));
    d.add(at(box(0.62, 0.32, 0.06, M.plastic), 0, 2.75, 0.03)); d.add(at(mesh(new THREE.PlaneGeometry(0.56, 0.28), exit), 0, 2.75, 0.062));
    at(d, x, 0, z, [0, yaw, 0]); g.add(d);
  }
  return g;
}

// ---- the baker

// a material's look apart from its colour, roughness and metalness (those go per vertex): parts
// with the same key are drawn together. undefined: can't be baked (left as it is)
function keyOf(m: THREE.Material): string | undefined {
  if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile || m.vertexColors) return undefined;
  // (a house wall keeps its own material: its colour follows the Ambient slider, see `house`; the
  // LED screens keep theirs, the 3D view puts the live camera's picture on it)
  if (m.userData.house !== undefined || m.userData.live) return undefined;
  // (two-sided parts get their back faces as geometry; the roof steel's hiding is a uniform)
  const common = [m.transparent, m.opacity, m.side === THREE.BackSide ? 'back' : 'front', m.alphaTest, m.depthWrite, m.userData.hideAbove ?? '-'].join('|');
  if (m instanceof THREE.MeshStandardMaterial && !(m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    if (m.normalMap || m.roughnessMap || m.metalnessMap || m.aoMap || m.alphaMap || m.bumpMap || m.envMap || m.lightMap || m.displacementMap) return undefined;
    return ['std', m.map?.uuid ?? '-', m.emissive.getHexString(), m.emissiveIntensity, m.emissiveMap?.uuid ?? '-', m.flatShading, m.envMapIntensity, common].join('|');
  }
  if (m instanceof THREE.MeshBasicMaterial) {
    if (m.alphaMap || m.envMap || m.lightMap || m.aoMap || m.specularMap) return undefined;
    return ['basic', m.map?.uuid ?? '-', m.toneMapped, common].join('|');
  }
  return undefined;
}
// a baked material: roughness and metalness per vertex, and hiding (the roof steel) when the camera
// is above a height (a uniform, so every baked material shares one shader)
function patchBaked(this: THREE.Material, sh: THREE.WebGLProgramParametersWithUniforms) {
  sh.uniforms.uHideAbove = { value: this.userData.hideAbove ?? 1e9 };
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uHideAbove;\n#ifdef BAKED_RM\nattribute vec2 aRM;\nvarying vec2 vRM;\n#endif')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef BAKED_RM\nvRM = aRM;\n#endif')
    .replace('#include <project_vertex>', '#include <project_vertex>\nif (cameraPosition.y > uHideAbove) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\n#ifdef BAKED_RM\nvarying vec2 vRM;\n#endif')
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n#ifdef BAKED_RM\nroughnessFactor *= vRM.x;\n#endif')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n#ifdef BAKED_RM\nmetalnessFactor *= vRM.y;\n#endif');
}
function bakedMaterial(m: THREE.Material): THREE.Material {
  const common = { transparent: m.transparent, opacity: m.opacity, side: m.side === THREE.BackSide ? THREE.BackSide : THREE.FrontSide, alphaTest: m.alphaTest, depthWrite: m.depthWrite, vertexColors: true };
  let out: THREE.Material;
  if (m instanceof THREE.MeshStandardMaterial) {
    out = new THREE.MeshStandardMaterial({ ...common, map: m.map ?? white(), emissive: m.emissive, emissiveIntensity: m.emissiveIntensity, emissiveMap: m.emissiveMap, flatShading: m.flatShading, envMapIntensity: m.envMapIntensity, roughness: 1, metalness: 1 });
    out.defines = { BAKED_RM: '' };
  } else {
    const b = m as THREE.MeshBasicMaterial;
    out = new THREE.MeshBasicMaterial({ ...common, map: b.map ?? white(), toneMapped: b.toneMapped });
    out.defines = {};
  }
  out.userData.hideAbove = m.userData.hideAbove;
  out.onBeforeCompile = patchBaked;
  return out;
}
// a geometry's triangles from `start` for `count` indices (or vertices), with only what they use
// (copies of the plain arrays when it's the whole geometry: the common case, and the fast one)
const floats = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) =>
  (a as THREE.BufferAttribute).isBufferAttribute && a.array instanceof Float32Array && !a.normalized ? new Float32Array(a.array) : Float32Array.from({ length: a.count * a.itemSize }, (_, i) => a.getComponent(Math.floor(i / a.itemSize), i % a.itemSize));
function subset(g: THREE.BufferGeometry, start: number, count: number) {
  const n = g.index ? g.index.count : g.attributes.position.count, end = Math.min(n, start + count);
  const names = ['position', 'normal', 'uv'].filter((k) => g.attributes[k]);
  const out = new THREE.BufferGeometry();
  if (start === 0 && end === n) {
    for (const name of names) out.setAttribute(name, new THREE.BufferAttribute(floats(g.attributes[name]), g.attributes[name].itemSize));
    if (g.index) out.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array), 1));
    else { const ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; out.setIndex(new THREE.BufferAttribute(ix, 1)); }
    return out;
  }
  if (g.index) {
    const map = new Map<number, number>(), idx: number[] = [], src = g.index.array;
    for (let i = start; i < end; i++) { const v = src[i]; let k = map.get(v); if (k === undefined) { k = map.size; map.set(v, k); } idx.push(k); }
    for (const name of names) {
      const a = g.attributes[name], s = a.itemSize, from = floats(a), arr = new Float32Array(map.size * s);
      for (const [v, k] of map) for (let c = 0; c < s; c++) arr[k * s + c] = from[v * s + c];
      out.setAttribute(name, new THREE.BufferAttribute(arr, s));
    }
    out.setIndex(idx);
  } else {
    for (const name of names) { const a = g.attributes[name], s = a.itemSize; out.setAttribute(name, new THREE.BufferAttribute(floats(a).slice(start * s, end * s), s)); }
    const ix = new Uint32Array(end - start); for (let i = 0; i < ix.length; i++) ix[i] = i; out.setIndex(new THREE.BufferAttribute(ix, 1));
  }
  return out;
}
const RM_OF = (m: THREE.Material): [number, number] => (m instanceof THREE.MeshStandardMaterial ? [m.roughness, m.metalness] : [1, 0]);
function prepared(g: THREE.BufferGeometry, m: THREE.Material, mw: THREE.Matrix4) {
  const n = g.attributes.position.count;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  g.applyMatrix4(mw);
  // (a mirrored part's triangles turn round: put them back the right way)
  if (mw.determinant() < 0) { const ix = g.index!; for (let i = 0; i + 2 < ix.count; i += 3) { const a = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, a); } }
  // (a two-sided part: the same triangles again, turned round, normals reversed)
  if (m.side === THREE.DoubleSide) {
    const back = g.clone(), ix = back.index!, nm = back.attributes.normal;
    for (let i = 0; i + 2 < ix.count; i += 3) { const a = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, a); }
    for (let i = 0; i < nm.count; i++) nm.setXYZ(i, -nm.getX(i), -nm.getY(i), -nm.getZ(i));
    const both = mergeGeometries([g, back])!; g.dispose(); g = both;
  }
  const n2 = g.attributes.position.count;
  const c = (m as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1), [r, mt] = RM_OF(m);
  const col = new Float32Array(n2 * 3), rm = new Float32Array(n2 * 2);
  for (let i = 0; i < n2; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; rm[i * 2] = r; rm[i * 2 + 1] = mt; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aRM', new THREE.BufferAttribute(rm, 2));
  return g;
}
// Which meshes move: their place in the world before and after `play` (called with a few
// different moments); the rest is fixed and can be baked.
export function movingMeshes(root: THREE.Object3D, play: (k: number) => void) {
  const snap = () => { root.updateMatrixWorld(true); const m = new Map<THREE.Object3D, THREE.Matrix4>(); root.traverse((o) => { if ((o as THREE.Mesh).isMesh) m.set(o, o.matrixWorld.clone()); }); return m; };
  const a = snap(), moving = new Set<THREE.Object3D>();
  for (let k = 1; k <= 4; k++) {
    play(k);
    for (const [o, mw] of snap()) { const b = a.get(o); if (!b || mw.elements.some((v, i) => Math.abs(v - b.elements[i]) > 1e-6)) moving.add(o); }
  }
  play(0);
  return moving;
}
// Merge every mesh under root that doesn't move (and whose material can be) into one mesh per
// key; what's left of a baked mesh is an empty place holding its children.
export function bake(root: THREE.Object3D, keep: (o: THREE.Object3D) => boolean) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), by = new Map<string, { mat: THREE.Material; parts: THREE.BufferGeometry[] }>(), done: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D) => {
    if (keep(o) || !o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && m.geometry.attributes.position) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const groups = Array.isArray(m.material) && m.geometry.groups.length ? m.geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
      const keys = groups.map((gr) => { const mat = mats[gr.materialIndex ?? 0]; return mat ? keyOf(mat) : undefined; });
      if (keys.every((k) => k !== undefined)) {
        const mw = inv.clone().multiply(m.matrixWorld);
        groups.forEach((gr, i) => {
          const mat = mats[gr.materialIndex ?? 0], k = keys[i]!;
          let b = by.get(k); if (!b) by.set(k, (b = { mat, parts: [] }));
          b.parts.push(prepared(subset(m.geometry, gr.start, gr.count), mat, mw));
        });
        done.push(m);
      }
    }
    for (const c of o.children) walk(c);
  };
  for (const c of [...root.children]) walk(c);
  for (const m of done) {
    const parent = m.parent; if (!parent) continue;
    if (m.children.length) {
      const stub = new THREE.Object3D(); stub.position.copy(m.position); stub.quaternion.copy(m.quaternion); stub.scale.copy(m.scale); stub.userData = m.userData; stub.name = m.name;
      parent.add(stub); for (const c of [...m.children]) stub.add(c);
    }
    parent.remove(m);
  }
  let verts = 0;
  for (const b of by.values()) {
    const geo = mergeGeometries(b.parts)!; verts += geo.attributes.position.count;
    const out = new THREE.Mesh(geo, bakedMaterial(b.mat)); out.name = 'baked'; out.matrixAutoUpdate = false;
    root.add(out);
  }
  return { meshes: done.length, batches: by.size, verts };
}
