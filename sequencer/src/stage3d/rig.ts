// The lights in 3D: a body per kind of light (stage3d/models.ts, instanced, so a few hundred cost
// little), a lens that glows in the light's colour, a beam in the haze and a pool where it lands.
// Moving heads turn their yoke (pan) and head (tilt) the way the real ones do (geometry.ts).
// Updated every frame from what the engine puts on stage.
import * as THREE from 'three';
import { shapeH, shapeW, type Places } from '../model/pixelLayout';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Resolved } from '../model/types';
import type { FixtureKind } from '../model/library';
import { headAngles, headLocal, hitFloor, RAD, toWorld, type Optics, type Rot, type V3 } from './geometry';
import { PAN_SPEED, TILT_SPEED, slew, type Axis } from './motion';
import { body, headParts, lensOf, PIVOT, type Look } from './models';

export type Sfx = 'confetti' | 'bubbles' | 'flame' | 'sparks' | 'co2';
export interface RigFixture { id: string; name: string; kind: FixtureKind; look: Look; cells: number; p: V3; rot: Rot; optics: Optics; sfx?: Sfx; fog?: boolean; hazer?: boolean; shape?: Places; size?: number }

const MAX_BEAM = 26;           // metres: a beam that hits nothing fades out by then
const LENS_GAP = 0.018;        // the glowing lens sits this far in front of its face (no flicker against it)
const UP = new THREE.Vector3(0, 1, 0);
// scratch objects for the frame (a few hundred lights: no garbage every frame)
const E = new THREE.Euler(), BASE = new THREE.Matrix4(), YOKE = new THREE.Matrix4(), HEAD = new THREE.Matrix4(), TMP = new THREE.Matrix4(), TMP2 = new THREE.Matrix4();
const LP = new THREE.Vector3(), DIR = new THREE.Vector3(), CP = new THREE.Vector3(), C2 = new THREE.Color();

export interface Lit { key: number; p: THREE.Vector3; d: THREE.Vector3; c: THREE.Color; level: number; deg: number }
// the edges of a unit box as thin bars (a frame round a selected light; scaled like its hit box)
function selFrame() {
  const parts: THREE.BufferGeometry[] = [], t = 0.035;
  for (const ax of [0, 1, 2]) for (const a of [-0.5, 0.5]) for (const b of [-0.5, 0.5]) {
    const g = new THREE.BoxGeometry(ax === 0 ? 1 + t : t, ax === 1 ? 1 + t : t, ax === 2 ? 1 + t : t);
    g.translate(ax === 0 ? 0 : a, ax === 1 ? 0 : ax === 0 ? a : b, ax === 2 ? 0 : b);
    parts.push(g.toNonIndexed());
  }
  return mergeGeometries(parts)!;
}

export class Rig {
  readonly group = new THREE.Group();
  private list: RigFixture[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private parts = new Map<string, THREE.InstancedMesh>();
  private lens!: THREE.InstancedMesh;
  private beams!: THREE.InstancedMesh;
  private pools!: THREE.InstancedMesh;
  private cells!: THREE.InstancedMesh;
  private hit!: THREE.InstancedMesh;
  private beamLevel!: THREE.InstancedBufferAttribute;
  private poolLevel!: THREE.InstancedBufferAttribute;
  private beamMat: THREE.ShaderMaterial;
  private poolMat: THREE.ShaderMaterial;
  private hitIds: string[] = [];
  beamCount = 0;      // beams drawn the last frame (tests)
  // every light's beam this frame, lit or not (the venue's wash lights, the fog): `key` stays the
  // same for a light while the rig isn't rebuilt (the fog remembers which beams it's in)
  readonly lit: Lit[] = [];
  private litPool: Lit[] = [];
  private sel!: THREE.InstancedMesh;
  // where each moving head's motors are (motion.ts), and when they were last moved
  private heads = new Map<string, { p: Axis; t: Axis }>();
  private headsAt = -1;

  constructor() {
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uHaze: { value: 0.5 } },
      vertexShader: `
        attribute float aLevel; varying float vLevel; varying vec3 vColor; varying float vAlong; varying vec3 vN; varying vec3 vView; varying float vDist; varying vec3 vAxis;
        void main() {
          vLevel = aLevel; vColor = instanceColor; vAlong = position.y;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vView = normalize(cameraPosition - wp.xyz);
          vAxis = normalize(mat3(modelMatrix * instanceMatrix) * vec3(0.0, 1.0, 0.0));
          vDist = distance(cameraPosition, wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float uHaze; varying float vLevel; varying vec3 vColor; varying float vAlong; varying vec3 vN; varying vec3 vView; varying float vDist; varying vec3 vAxis;
        void main() {
          // (guarded: a NaN here would be smeared into big black blocks by the glow)
          float nl = length(vN), along = clamp(vAlong, 0.0, 1.0);
          float edge = nl > 1e-5 ? abs(dot(vN / nl, normalize(vView))) : 1.0;
          // brightest along the axis, soft at the rim (only the far side of the cone is drawn: one
          // layer, not two); fading out right at the camera (a beam into the lens isn't a white wall)
          float body = pow(edge, 1.7);
          float hot = 1.0 + 0.7 * pow(1.0 - along, 8.0);
          float near = smoothstep(0.6, 4.5, vDist);
          // haze throws light mostly onwards: a beam coming at you glows, one going away is faint
          float fwd = dot(normalize(vAxis), normalize(vView));
          float phase = mix(0.3, 1.5, smoothstep(-0.5, 0.95, fwd));
          float a = vLevel * uHaze * pow(1.0 - along, 1.3) * body * 0.24 * hot * near * phase;
          if (!(a > 0.0)) discard;
          gl_FragColor = vec4(clamp(vColor, 0.0, 1.0), min(a, 1.0));
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    });
    this.poolMat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aLevel; varying float vLevel; varying vec3 vColor; varying vec2 vUv;
        void main() { vLevel = aLevel; vColor = instanceColor; vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        varying float vLevel; varying vec3 vColor; varying vec2 vUv;
        void main() { float r = length(vUv - 0.5) * 2.0; float a = vLevel * (1.0 - smoothstep(0.45, 1.0, r)) * 0.7; gl_FragColor = vec4(vColor, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
  }

  // lights come or go (or another type): build the instances again
  build(list: RigFixture[]) {
    // (the old ones let go of their buffers and materials: lights come and go a lot while patching)
    for (const m of this.meshes) {
      this.group.remove(m); m.geometry.dispose(); m.dispose();
      if (m.material !== this.beamMat && m.material !== this.poolMat) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
    }
    this.meshes = []; this.parts.clear();
    this.list = list;
    const n = Math.max(1, list.length);
    const lamps = list.reduce((s, f) => s + (f.look === 'blinder' ? 2 : 1), 0) + 1;
    const cells = Math.max(1, list.reduce((s, f) => s + (f.kind === 'bar' ? f.cells : 0), 0));
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number) => {
      const m = new THREE.InstancedMesh(geo, mat, count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = 0;
      this.group.add(m); this.meshes.push(m); return m;
    };
    const paint = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.42, metalness: 0.55 });
    const yokeMat = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.38, metalness: 0.65 });
    const machine = new THREE.MeshStandardMaterial({ color: 0x2d3038, roughness: 0.5, metalness: 0.4 });
    const looks = new Set(list.map((f) => f.look));
    for (const look of looks) {
      const count = list.filter((f) => f.look === look).length;
      if (look === 'spot' || look === 'wash') {
        const h = headParts(look);
        this.parts.set(`${look}:base`, add(h.base, paint, count));
        this.parts.set(`${look}:yoke`, add(h.yoke, yokeMat, count));
        this.parts.set(`${look}:head`, add(h.head, paint, count));
      } else {
        const b = body(look);
        this.parts.set(look, add(b.geo, ['fog', 'confetti', 'bubbles', 'flame', 'sparks', 'co2'].includes(look) ? machine : paint, count));
      }
    }
    this.lens = add(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), lamps);
    const cone = new THREE.CylinderGeometry(1, 0, 1, 28, 1, true).translate(0, 0.5, 0);
    this.beams = add(cone, this.beamMat, lamps + cells);
    this.beamLevel = new THREE.InstancedBufferAttribute(new Float32Array(lamps + cells), 1); this.beamLevel.setUsage(THREE.DynamicDrawUsage);
    this.beams.geometry.setAttribute('aLevel', this.beamLevel);
    this.pools = add(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), this.poolMat, lamps);
    this.poolLevel = new THREE.InstancedBufferAttribute(new Float32Array(lamps), 1); this.poolLevel.setUsage(THREE.DynamicDrawUsage);
    this.pools.geometry.setAttribute('aLevel', this.poolLevel);
    this.cells = add(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), cells);
    // what a click finds (invisible boxes round each light)
    this.hit = add(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }), n);
    // the selected lights: an orange frame round each, drawn over everything
    this.sel = add(selFrame(), new THREE.MeshBasicMaterial({ color: 0xffaa1c, toneMapped: false, depthTest: false, transparent: true, opacity: 0.9 }), n);
    this.sel.renderOrder = 20;
    for (const m of [this.lens, this.beams, this.pools, this.cells]) m.setColorAt(0, new THREE.Color(0));
  }
  // the same lights in new places (moved or turned): nothing to rebuild
  place(list: RigFixture[]) { this.list = list; }

  // which light a ray hits (a click on the 3D stage)
  pick(ray: THREE.Raycaster): string | undefined {
    const h = ray.intersectObject(this.hit, false)[0];
    return h?.instanceId !== undefined ? this.hitIds[h.instanceId] : undefined;
  }

  // where a moving head's motors have got to (degrees), for the tests
  headOf(id: string) { const m = this.heads.get(id); return m ? { pan: m.p.at, tilt: m.t.at } : undefined; }

  update(stage: Record<string, Resolved | undefined>, t: number, haze: number, selected: Set<string>) {
    const dt = this.headsAt < 0 ? 1 : t - this.headsAt; this.headsAt = t;
    this.beamMat.uniforms.uHaze.value = haze;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    const counts = new Map<string, number>();
    const put = (key: string, m: THREE.Matrix4) => { const mesh = this.parts.get(key); if (!mesh) return; const i = counts.get(key) ?? 0; if (i >= mesh.instanceMatrix.count) return; mesh.setMatrixAt(i, m); counts.set(key, i + 1); };
    let nl = 0, nb = 0, np = 0, nc = 0, nh = 0, ns = 0;
    this.hitIds = [];
    this.lit.length = 0;
    // (the same objects every frame: no garbage for hundreds of lights)
    const pushLit = (key: number, p: THREE.Vector3, d: THREE.Vector3, c: THREE.Color, level: number, deg: number) => {
      const l = (this.litPool[this.lit.length] ??= { key: 0, p: new THREE.Vector3(), d: new THREE.Vector3(), c: new THREE.Color(), level: 0, deg: 0 });
      l.key = key; l.p.copy(p); l.d.copy(d); l.c.copy(c); l.level = level; l.deg = deg; this.lit.push(l);
    };
    const col = new THREE.Color(), off = new THREE.Color(0x07080a), sel = new THREE.Color(0xffaa1c);
    // (their own scratch: the light's position and turn are still needed after them)
    const qb = new THREE.Quaternion(), mb = new THREE.Matrix4(), sb = new THREE.Vector3(), pb = new THREE.Vector3();
    const lensAt = (p: THREE.Vector3, dir: THREE.Vector3, r: number, c: THREE.Color) => {
      if (nl >= this.lens.instanceMatrix.count) return;
      qb.setFromUnitVectors(UP, dir); mb.compose(pb.copy(p).addScaledVector(dir, LENS_GAP), qb, sb.set(r, r, r)); this.lens.setMatrixAt(nl, mb); this.lens.setColorAt(nl, c); nl++;
    };
    const beamAt = (p: THREE.Vector3, dir: THREE.Vector3, deg: number, level: number, c: THREE.Color, maxLen = MAX_BEAM, pool = true) => {
      if (level < 0.01 || nb >= this.beams.instanceMatrix.count) return;
      const hit = hitFloor(p, dir), L = Math.max(0.05, hit ? Math.min(maxLen, Math.hypot(hit.x - p.x, hit.y - p.y, hit.z - p.z)) : maxLen), r = Math.max(0.01, L * Math.tan((deg / 2) * RAD));
      if (!Number.isFinite(L + r + dir.x + dir.y + dir.z)) return;
      qb.setFromUnitVectors(UP, dir); mb.compose(p, qb, sb.set(r, L, r)); this.beams.setMatrixAt(nb, mb); this.beams.setColorAt(nb, c); this.beamLevel.setX(nb, level); nb++;
      if (pool && hit && L < maxLen && np < this.pools.instanceMatrix.count) {
        const rr = Math.max(0.15, r) / Math.max(0.35, Math.abs(dir.y));
        qb.setFromAxisAngle(UP, Math.atan2(dir.x, dir.z)); mb.compose(pb.set(hit.x, hit.y + 0.01, hit.z), qb, sb.set(Math.max(0.15, r), 1, rr));
        this.pools.setMatrixAt(np, mb); this.pools.setColorAt(np, c); this.poolLevel.setX(np, level * (1 - L / MAX_BEAM) * 1.2); np++;
      }
    };
    const lightOf = (v: Resolved | undefined, strobeT: number) => {
      const c = v?.color, w = typeof v?.white === 'number' ? v.white : 0;
      col.setRGB(Math.min(1, (c ? c.r : 1) + w * 0.85), Math.min(1, (c ? c.g : 1) + w * 0.85), Math.min(1, (c ? c.b : 1) + w * 0.8));
      let level = typeof v?.intensity === 'number' ? v.intensity : 0;
      const s = typeof v?.strobe === 'number' ? v.strobe : 0;
      if (s > 0.02 && Math.floor(strobeT * (2 + 10 * s) * 2) % 2 === 1) level = 0;
      return level;
    };
    const lensCol = (level: number, isSel: boolean) => (level > 0.01 ? C2.copy(col).multiplyScalar(0.6 + level * 1.4) : isSel ? sel : off);

    for (let fi = 0; fi < this.list.length; fi++) {
      const f = this.list[fi], v = stage[f.id];
      pos.set(f.p.x, f.p.y, f.p.z);
      q.setFromEuler(E.set(f.rot.pitch * RAD, f.rot.yaw * RAD, f.rot.roll * RAD, 'YXZ'));
      const base = BASE.compose(pos, q, sc.set(1, 1, 1));
      const level = lightOf(v, t), isSel = selected.has(f.id);
      if (f.shape) m4.compose(pos, q, sc.set(f.size! * shapeW(f.shape) + 0.06, 0.2, f.size! * shapeH(f.shape) + 0.06));
      else m4.compose(pos, q, sc.set(f.kind === 'bar' ? Math.max(1, f.cells / 30) : 0.6, 0.7, 0.6));
      this.hit.setMatrixAt(nh++, m4); this.hitIds.push(f.id);
      if (isSel && ns < this.sel.instanceMatrix.count) this.sel.setMatrixAt(ns++, m4);
      if (f.look === 'spot' || f.look === 'wash') {
        const h = lensOf(f.look);
        // the head where its motors have got to, on its way to where the DMX says
        const want = headAngles(typeof v?.pan === 'number' ? v.pan : 0.5, typeof v?.tilt === 'number' ? v.tilt : 0.5, f.optics);
        let m = this.heads.get(f.id);
        if (!m) this.heads.set(f.id, (m = { p: { at: NaN, v: 0 }, t: { at: NaN, v: 0 } }));
        const a = { p: slew(m.p, want.p, dt, PAN_SPEED), t: slew(m.t, want.t, dt, TILT_SPEED) };
        put(`${f.look}:base`, base);
        const yoke = YOKE.copy(base).multiply(TMP.makeRotationY(a.p * RAD)); put(`${f.look}:yoke`, yoke);
        const head = HEAD.copy(yoke).multiply(TMP.makeTranslation(0, PIVOT, 0)).multiply(TMP2.makeRotationX(a.t * RAD)); put(`${f.look}:head`, head);
        const lp = LP.set(0, h.at, 0).applyMatrix4(head);
        const d = toWorld(headLocal(a.p, a.t), f.rot);
        const dir = DIR.set(d.x, d.y, d.z);
        const zoom = typeof v?.zoom === 'number' ? v.zoom : f.look === 'wash' ? 0.5 : 0.25;
        const deg = f.look === 'wash' ? 10 + zoom * 40 : 3 + zoom * 26;
        lensAt(lp, dir, h.r, lensCol(level, isSel));
        beamAt(CP.copy(lp).addScaledVector(dir, 0.03), dir, deg, level * (f.look === 'wash' ? 0.8 : 1.15), col);
        pushLit(fi, lp, dir, col, level, deg);
      } else if (f.shape) {
        // a ring or a matrix: its board in the light's x-z plane, its pixels on it, facing its up
        const at = f.shape, S = f.size! / 2, dot = Math.max(0.006, 2 * at.dot * S);
        put(f.look, TMP.copy(base).multiply(TMP2.makeScale(2 * S * shapeW(at) + 0.04, 1, 2 * S * shapeH(at) + 0.04)));
        const dir = DIR.copy(UP).applyQuaternion(q);
        for (let i = 0; i < at.n; i++) {
          const cl = lightOf(v?.cells?.[i] ?? v, t);
          const cp = CP.set(at.x[i] * S, 0.006, -at.y[i] * S).applyMatrix4(base);
          const cc = cl > 0.01 ? C2.copy(col).multiplyScalar(0.5 + cl * 1.3) : isSel ? sel : off;
          m4.compose(cp, q, sc.set(dot, 0.012, dot)); this.cells.setMatrixAt(nc, m4); this.cells.setColorAt(nc, cc); nc++;
        }
        lightOf(v, t);
        pushLit(fi, pos, dir, col, level * 0.4, 60);
      } else if (f.kind === 'bar') {
        // the bar lies along its x; its cells shine along its up
        const L = f.cells > 24 ? f.cells / 30 : 1;
        put('bar', TMP.copy(base).multiply(TMP2.makeScale(L + 0.04, 1, 1)));
        const dir = DIR.copy(UP).applyQuaternion(q);
        for (let i = 0; i < f.cells; i++) {
          const cv = v?.cells?.[i] ?? v;
          const cl = lightOf(cv, t);
          const cp = CP.set(-L / 2 + (L * (i + 0.5)) / f.cells, 0.012, 0).applyMatrix4(base);
          const cc = cl > 0.01 ? C2.copy(col).multiplyScalar(0.5 + cl * 1.3) : isSel ? sel : off;
          m4.compose(cp, q, sc.set((L / f.cells) * 0.86, 0.016, 0.07)); this.cells.setMatrixAt(nc, m4); this.cells.setColorAt(nc, cc); nc++;
          if (f.cells <= 24) beamAt(cp, dir, 30, cl * 0.6, col, 5, false);
        }
        pushLit(fi, pos, dir, col, level * 0.6, 40);
      } else if (f.fog || f.sfx) {
        put(f.look, base);
      } else {
        // PARs, blinders, strobes, fresnels: pointing along their up (hung: down at the deck)
        put(f.look, base);
        const b = lensOf(f.look), dir = DIR.copy(UP).applyQuaternion(q);
        const deg = f.look === 'strobe' ? 50 : f.look === 'blinder' ? 55 : f.look === 'par' ? 24 : 30;
        const lamps = b.lamps;
        for (const [lx, lz] of lamps) {
          const lp = LP.set(lx, 0, lz).applyMatrix4(base);
          lensAt(lp, dir, b.r, lensCol(level, isSel));
          beamAt(CP.copy(lp).addScaledVector(dir, 0.03), dir, deg, level * (f.look === 'strobe' ? 0.4 : 1) / Math.sqrt(lamps.length), col, f.look === 'strobe' || f.look === 'blinder' ? 10 : MAX_BEAM);
        }
        pushLit(fi, pos, dir, col, level, deg);
      }
    }
    for (const [k, mesh] of this.parts) { mesh.count = counts.get(k) ?? 0; mesh.instanceMatrix.needsUpdate = true; }
    this.lens.count = nl; this.beams.count = nb; this.pools.count = np; this.cells.count = nc; this.hit.count = nh; this.sel.count = ns;
    for (const m of [this.lens, this.beams, this.pools, this.cells, this.hit, this.sel]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    this.beamLevel.needsUpdate = true; this.poolLevel.needsUpdate = true;
    this.beamCount = nb;
  }
}
