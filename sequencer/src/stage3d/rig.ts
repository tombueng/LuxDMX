// The lights in 3D: a body per kind of light (stage3d/models.ts, instanced, so a few hundred cost
// little), a lens that glows in the light's colour, a beam in the haze and a pool where it lands.
// Moving heads turn their yoke (pan) and head (tilt) the way the real ones do (geometry.ts).
// Updated every frame from what the engine puts on stage.
import * as THREE from 'three';
import { shapeH, shapeW, type Places } from '../model/pixelLayout';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Resolved } from '../model/types';
import { cellLookAt } from '../engine/resolve';
import { wholeLook } from '../engine/cuelook';
import type { FixtureKind } from '../model/library';
import { headAngles, headLocal, hitFloor, RAD, toWorld, type Optics, type Rot, type V3 } from './geometry';
import { PAN_SPEED, ROLL_SPEED, TILT_SPEED, slew, type Axis } from './motion';
import { body, headBarParts, headParts, HEADBAR_LENS, HEADBAR_PITCH, HEADBAR_PIVOT, lensOf, PIVOT, WINCH_BALL, WINCH_BOX, winchParts, type Look } from './models';
import { ATLAS_CELLS, PLAIN_WHEEL, prismOf, rotationOf } from './gobos';

export type Sfx = 'confetti' | 'bubbles' | 'flame' | 'sparks' | 'co2';
export interface RigFixture { id: string; name: string; kind: FixtureKind; look: Look; cells: number; p: V3; rot: Rot; optics: Optics; sfx?: Sfx; fog?: boolean; hazer?: boolean; shape?: Places; size?: number;
  gobos?: GoboWheel[]; prism?: { ranges?: Ranges; rot?: Ranges }; anim?: { rot?: Ranges };
  // more than two axes: endless pan / tilt (their turning channels' ranges; null: a channel without
  // ranges), a third axis (roll: how far it turns), and its endless turning
  axes?: { panRot?: Ranges | null; tiltRot?: Ranges | null; rollDeg?: number; rollRot?: Ranges | null };
  // its beam's opening angle, narrowest and widest (its data, or its own); none: a guess for its kind
  beam?: [number, number];
  heads?: number;    // a moving bar's heads (its cells that tilt on their own)
  headCells?: number[];   // which cells they are (in order along the bar)
  headPan?: boolean;      // its heads pan each on their own too
  barPan?: boolean;       // the bar itself pans (a pan channel of the whole light)
  // a winch: its travel (m) and speed (m/s), its soft limits (parts of its travel)
  winch?: { travel: number; speed: number; limits?: [number, number] } }   // a moving bar's heads (its cells that tilt on their own)
type Ranges = { from: number; to: number; label?: string }[];
// A gobo wheel of a light (gobos.ts): the pattern of each of its slots (null: open; none listed: a
// plain level, a few patterns spread over it), and its rotation channel's ranges
export interface GoboWheel { attr: 'gobo' | 'gobo2'; slots: (number | null)[]; rotAttr: 'goboRotation' | 'gobo2Rotation'; rot?: { from: number; to: number; label?: string }[] }

// An axis that can also turn round and round (endless pan, tilt or roll): while its turning
// channel turns (a CW or CCW range), the motor runs on at that speed (half a wheel's: half a turn a
// second at most); when it stops, it goes to its position the short way round (once: after that a
// move is a move). Otherwise a plain move at the motor's speed (motion.ts).
export function axisTo(a: Axis, target: number, dt: number, speed: number, ranges: Ranges | null | undefined, x: number | undefined): number {
  if (ranges !== undefined && typeof x === 'number') {
    const r = rotationOf(ranges ?? undefined, x);
    if ('speed' in r && r.speed !== 0) {
      if (!Number.isFinite(a.at)) a.at = target;
      const deg = ((r.speed * 180) / Math.PI) * 0.5;
      a.at += deg * Math.min(0.5, Math.max(0, dt)); a.v = deg; a.spun = true;
      if (Math.abs(a.at) > 3600) a.at -= Math.sign(a.at) * 3600;          // (the same place, smaller numbers)
      return a.at;
    }
  }
  if (a.spun && Number.isFinite(a.at)) { a.at = target + ((((a.at - target) % 360) + 540) % 360) - 180; a.v = 0; a.spun = false; }
  return slew(a, target, dt, speed);
}
// no gobo: no pattern on either wheel, not turned, sharp
// (the two wheels' cells, their turns, the animation wheel's amount and run, the frost, the focus)
const NO_GOBO = [-1, -1, 0, 0, 0, 0, 0, -1] as const;
const goboAttr = (n: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 4).fill(-1), 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
const fxAttr = (n: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
// the throw a focus value is sharp at: near at 0, far at 1 (a head focused for the floor is soft on a
// wall twice as close)
const FOCUS_NEAR = 2, FOCUS_FAR = 22;
const MAX_BEAM = 26;           // metres: a beam that hits nothing fades out by then
const LENS_GAP = 0.018;        // the glowing lens sits this far in front of its face (no flicker against it)
const UP = new THREE.Vector3(0, 1, 0);
// scratch objects for the frame (a few hundred lights: no garbage every frame)
const E = new THREE.Euler(), BASE = new THREE.Matrix4(), YOKE = new THREE.Matrix4(), HEAD = new THREE.Matrix4(), TMP = new THREE.Matrix4(), TMP2 = new THREE.Matrix4();
const LP = new THREE.Vector3(), DIR = new THREE.Vector3(), CP = new THREE.Vector3(), C2 = new THREE.Color();
const PU = new THREE.Vector3(), PW = new THREE.Vector3(), PD = new THREE.Vector3(), XAX = new THREE.Vector3(1, 0, 0);

export interface Lit { key: number; p: THREE.Vector3; d: THREE.Vector3; c: THREE.Color; level: number; deg: number }
// The gobo atlas read in the shaders (gobos.ts drawAtlas: CELLS x CELLS patterns, each on a round
// plate 0.92 of its cell). p: where in the beam's cross-section (-1..1 across); g: the two wheels'
// patterns (x, y: their cells, -1 none) and their turns (z, w); fx: the animation wheel (x: how far
// in, y: how far it has run) and how blurred the picture is (z: frost and focus). In colour: a glass
// gobo tints the light.
const GOBO_GLSL = `
  vec3 goboCell(float cell, vec2 p, float ang, float soft) {
    if (cell < 0.0) return vec3(1.0);
    float c = cos(ang), s = sin(ang);
    vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    if (dot(q, q) > 1.0) return vec3(0.0);
    vec2 uv = 0.5 + q * 0.46;
    vec2 cx = vec2(mod(cell, ${ATLAS_CELLS}.0), floor(cell / ${ATLAS_CELLS}.0));
    vec2 t = vec2((cx.x + uv.x) / ${ATLAS_CELLS}.0, 1.0 - (cx.y + uv.y) / ${ATLAS_CELLS}.0);
    return textureLod(uGobos, t, soft * 3.0).rgb;
  }
  float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y); }
  // the animation wheel: a breakup disc sliding through the beam (as far in as it is, as far as it has run)
  float animAt(vec2 p, vec2 fx) {
    if (fx.x <= 0.0) return 1.0;
    float n = gNoise(p * 3.0 + vec2(fx.y, 0.0)) * 0.62 + gNoise(p * 6.5 + vec2(fx.y * 1.6, 2.7)) * 0.38;
    return mix(1.0, smoothstep(0.4, 0.6, n), fx.x);
  }
  bool hasGobo(vec4 g, vec4 fx) { return g.x >= 0.0 || g.y >= 0.0 || fx.x > 0.0; }
  vec3 goboAt(vec2 p, vec4 g, vec4 fx) { return goboCell(g.x, p, g.z, fx.z) * goboCell(g.y, p, g.w, fx.z) * animAt(p, fx.xy); }`;
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
  private beamGobo!: THREE.InstancedBufferAttribute;
  private beamFx!: THREE.InstancedBufferAttribute;
  private poolGobo!: THREE.InstancedBufferAttribute;
  private poolFx!: THREE.InstancedBufferAttribute;
  // prisms' and animation wheels' state per light: how far turned / run (radians), and what's shown (tests)
  private prismTurn = new Map<string, number>();
  private animRun = new Map<string, number>();
  private fxNow = new Map<string, { prism: { facets: number; linear: boolean; turn: number } | null; anim: number; soft: number; iris: number; shake: [number, number]; scroll: [number, number] }>();
  // where each light's gobo wheels have turned to (radians), and what they show now (for the tests)
  private goboTurn = new Map<string, [number, number]>();
  private goboNow = new Map<string, [number, number]>();
  private goboDrawn = new Map<string, [number, number]>();   // (each wheel's angle as drawn: its turn, a shake, the head's roll)
  // the atlas of every pattern (gobos.ts): until it's drawn, beams have no gobos
  setGobos(tex: THREE.Texture | null) { this.beamMat.uniforms.uGobos.value = tex; this.beamMat.uniforms.uHasGobos.value = tex ? 1 : 0; }
  goboOf(id: string) {
    const g = this.goboNow.get(id), a = this.goboDrawn.get(id) ?? this.goboTurn.get(id), fx = this.fxNow.get(id);
    return g || fx ? { cells: g ? [...g] : [-1, -1], turn: a ? [...a] : [0, 0], ...(fx ? structuredClone(fx) : {}) } : undefined;
  }
  private poolMat: THREE.ShaderMaterial;
  private hitIds: string[] = [];
  beamCount = 0;      // beams drawn the last frame (tests)
  // every light's beam this frame, lit or not (the venue's wash lights, the fog): `key` stays the
  // same for a light while the rig isn't rebuilt (the fog remembers which beams it's in)
  readonly lit: Lit[] = [];
  private litPool: Lit[] = [];
  private sel!: THREE.InstancedMesh;
  // where each moving head's motors are (motion.ts), and when they were last moved
  private heads = new Map<string, { p: Axis; t: Axis; r: Axis }>();
  // a moving bar's motors: the bar's pan, each head's tilt (and where they are now, for the tests)
  // a winch's load: how far down it is now (m), at the winch's speed
  private winches = new Map<string, Axis>();
  private winchNow = new Map<string, number>();
  winchOf(id: string) { return this.winchNow.get(id); }
  private barHeads = new Map<string, { p: Axis; t: Axis[]; hp: Axis[]; pan?: number; tilts: number[]; pans: number[] }>();
  barOf(id: string) { const m = this.barHeads.get(id); return m ? { pan: m.pan ?? 0, tilts: [...m.tilts], pans: [...m.pans] } : undefined; }
  // A winch's height on the wire (live, not armed: where it's held, the real one doesn't move): a
  // part of its travel; null: held but nobody knows where (it stays where it's drawn); undefined:
  // draw what the show says
  winchWire?: (id: string) => number | null | undefined;
  private headsAt = -1;

  constructor() {
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uHaze: { value: 0.5 }, uGobos: { value: null }, uHasGobos: { value: 0 } },
      vertexShader: `
        attribute float aLevel; attribute vec4 aGobo; attribute vec4 aFx;
        varying float vLevel; varying vec3 vColor; varying float vAlong; varying vec3 vN; varying vec3 vView; varying float vDist; varying vec3 vAxis;
        varying vec4 vGobo; varying vec4 vFx; varying vec3 vLocal; varying vec3 vCam;
        void main() {
          vLevel = aLevel; vColor = instanceColor; vAlong = position.y;
          vGobo = aGobo; vFx = aFx; vLocal = position;
          // (the camera in the cone's own space: a gobo's fingers are worked out there)
          vCam = aGobo.x >= 0.0 || aGobo.y >= 0.0 || aFx.x > 0.0 ? (inverse(modelMatrix * instanceMatrix) * vec4(cameraPosition, 1.0)).xyz : vec3(0.0);
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vView = normalize(cameraPosition - wp.xyz);
          vAxis = normalize(mat3(modelMatrix * instanceMatrix) * vec3(0.0, 1.0, 0.0));
          vDist = distance(cameraPosition, wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float uHaze; uniform sampler2D uGobos; uniform float uHasGobos;
        varying float vLevel; varying vec3 vColor; varying float vAlong; varying vec3 vN; varying vec3 vView; varying float vDist; varying vec3 vAxis;
        varying vec4 vGobo; varying vec4 vFx; varying vec3 vLocal; varying vec3 vCam;
        ${GOBO_GLSL}
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
          // a gobo: the light that gets through it, along the line of sight inside the cone (its
          // fingers in the haze), sampled from where the line enters the cone to this far side
          vec3 tint = vec3(1.0);
          if (uHasGobos > 0.5 && hasGobo(vGobo, vFx) && a > 0.0) {
            vec3 o = vCam, d = vLocal - vCam;
            float A = d.x * d.x + d.z * d.z - d.y * d.y, B = 2.0 * (o.x * d.x + o.z * d.z - o.y * d.y), C = o.x * o.x + o.z * o.z - o.y * o.y;
            float t0 = 0.0;
            if (!(C < 0.0 && o.y > 0.0) && abs(A) > 1e-6) {
              float q = B * B - 4.0 * A * C;
              if (q > 0.0) {
                float r1 = (-B - sqrt(q)) / (2.0 * A), r2 = (-B + sqrt(q)) / (2.0 * A);
                float lo = min(r1, r2), hi = max(r1, r2);
                // (the root that isn't this far side, on the lamp's side of the cone)
                t0 = abs(hi - 1.0) < abs(lo - 1.0) ? lo : hi;
                if (!(t0 > 0.0 && t0 < 1.0) || o.y + d.y * t0 < 0.0) t0 = 0.0;
              }
            }
            vec3 g = vec3(0.0);
            for (int i = 0; i < 10; i++) {
              vec3 p = o + d * mix(t0, 1.0, (float(i) + 0.5) / 10.0);
              g += p.y > 1e-3 ? goboAt(p.xz / p.y, vGobo, vFx) : vec3(0.0);
            }
            g /= 10.0;
            float m = max(g.r, max(g.g, g.b));
            a *= m * 1.35;
            tint = m > 1e-3 ? g / m : vec3(1.0);
          }
          if (!(a > 0.0)) discard;
          gl_FragColor = vec4(clamp(vColor * tint, 0.0, 1.0), min(a, 1.0));
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    });
    this.poolMat = new THREE.ShaderMaterial({
      uniforms: { uGobos: this.beamMat.uniforms.uGobos, uHasGobos: this.beamMat.uniforms.uHasGobos },
      vertexShader: `
        attribute float aLevel; attribute vec4 aGobo; attribute vec4 aFx; varying float vLevel; varying vec3 vColor; varying vec2 vUv; varying vec4 vGobo; varying vec4 vFx;
        void main() { vLevel = aLevel; vColor = instanceColor; vUv = uv; vGobo = aGobo; vFx = aFx; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform sampler2D uGobos; uniform float uHasGobos;
        varying float vLevel; varying vec3 vColor; varying vec2 vUv; varying vec4 vGobo; varying vec4 vFx;
        ${GOBO_GLSL}
        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p), a = vLevel * (1.0 - smoothstep(0.45, 1.0, r)) * 0.7;
          vec3 c = vColor;
          // a gobo: its picture, sharp (as sharp as the focus and the frost let it be), a glass one in colour
          if (uHasGobos > 0.5 && hasGobo(vGobo, vFx)) {
            vec3 g = goboAt(p / 0.82, vGobo, vFx);
            float m = max(g.r, max(g.g, g.b));
            a = vLevel * (1.0 - smoothstep(0.82, 1.0, r)) * 0.95 * m;
            if (m > 1e-3) c *= g / m;
          }
          gl_FragColor = vec4(c, a);
        }`,
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
    const lamps = list.reduce((s, f) => s + (f.look === 'blinder' ? 2 : f.look === 'headbar' ? (f.heads ?? 1) : 1), 0) + 1;
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
      if (look === 'winch') {
        const w = winchParts();
        this.parts.set('winch:box', add(w.box, yokeMat, count));
        this.parts.set('winch:cable', add(w.cable, new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.3, metalness: 0.8 }), count));
        const ball = add(w.ball, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), count);
        ball.setColorAt(0, new THREE.Color(0));
        this.parts.set('winch:ball', ball);
      } else if (look === 'headbar') {
        const h = headBarParts();
        this.parts.set('headbar:base', add(h.base, paint, count));
        this.parts.set('headbar:bar', add(h.bar, yokeMat, count));
        this.parts.set('headbar:head', add(h.head, paint, list.filter((f) => f.look === 'headbar').reduce((s, f) => s + (f.heads ?? 1), 0)));
      } else if (look === 'spot' || look === 'wash') {
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
    // (a head with a prism has up to 8 beams and pictures)
    const facets = list.reduce((s, f) => s + (f.prism ? 7 : 0), 0);
    this.beams = add(cone, this.beamMat, lamps + facets + cells);
    this.beamLevel = new THREE.InstancedBufferAttribute(new Float32Array(lamps + facets + cells), 1); this.beamLevel.setUsage(THREE.DynamicDrawUsage);
    this.beams.geometry.setAttribute('aLevel', this.beamLevel);
    this.beamGobo = goboAttr(lamps + facets + cells); this.beams.geometry.setAttribute('aGobo', this.beamGobo);
    this.beamFx = fxAttr(lamps + facets + cells); this.beams.geometry.setAttribute('aFx', this.beamFx);
    this.pools = add(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), this.poolMat, lamps + facets);
    this.poolLevel = new THREE.InstancedBufferAttribute(new Float32Array(lamps + facets), 1); this.poolLevel.setUsage(THREE.DynamicDrawUsage);
    this.pools.geometry.setAttribute('aLevel', this.poolLevel);
    this.poolGobo = goboAttr(lamps + facets); this.pools.geometry.setAttribute('aGobo', this.poolGobo);
    this.poolFx = fxAttr(lamps + facets); this.pools.geometry.setAttribute('aFx', this.poolFx);
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
  // A light's gobos now: the cell of each wheel's pattern (-1: open), how far each has turned, and
  // how soft (frost). The wheel's slot from its value as render.ts sends it (the nearest slot).
  private gb: number[] = [...NO_GOBO];
  private goboFor(f: RigFixture, v: Resolved | undefined, dt: number, t: number): readonly number[] {
    const turn = this.goboTurn.get(f.id) ?? [0, 0];
    const out = this.gb, R = v as Record<string, unknown> | undefined, step = Math.max(0, Math.min(0.5, dt));
    out[0] = out[1] = -1; out[2] = out[3] = 0;
    const shake: [number, number] = [0, 0], scroll: [number, number] = [0, 0];
    (f.gobos ?? []).slice(0, 2).forEach((w, k) => {
      const x = R?.[w.attr];
      let cell = -1;
      if (typeof x === 'number') {
        const c = x > 0 ? (x < 1 ? x : 1) : 0;
        if (w.slots.length) {
          let i = Math.round(c * (w.slots.length - 1));
          // the wheel running through its slots (a raw value in such a range): the next one so often
          const sc = R?.[`${w.attr}Scroll`];
          if (typeof sc === 'number' && sc !== 0) {
            scroll[k] = sc;
            const n = w.slots.length;
            i = (((i + Math.floor(t * (0.5 + 3.5 * Math.abs(sc))) * Math.sign(sc)) % n) + n) % n;
          }
          cell = w.slots[i] ?? -1;
        } else if (c > 0.02) cell = PLAIN_WHEEL[Math.min(PLAIN_WHEEL.length - 1, Math.floor(c * PLAIN_WHEEL.length))];
      }
      const rx = R?.[w.rotAttr];
      if (typeof rx === 'number') {
        const r = rotationOf(w.rot, rx);
        turn[k] = 'angle' in r ? r.angle : (turn[k] + r.speed * step) % (Math.PI * 2);
      }
      // a slot shaking: back and forth, faster as asked
      const sh = R?.[`${w.attr}Shake`];
      const wobble = typeof sh === 'number' && sh > 0 ? Math.sin(t * Math.PI * 2 * (1.5 + 6 * sh)) * 0.3 : 0;
      if (typeof sh === 'number' && sh > 0) shake[k] = sh;
      out[k] = cell; out[2 + k] = turn[k] + wobble + this.rollNow;
    });
    // the animation wheel: as far in as its value, running as its rotation channel says
    const am = f.anim && typeof v?.animation === 'number' ? Math.max(0, Math.min(1, v.animation)) : 0;
    let run = this.animRun.get(f.id) ?? 0;
    if (am > 0) {
      const ar = typeof v?.animationRotation === 'number' ? rotationOf(f.anim!.rot, v.animationRotation) : { speed: 0.6 };
      run = 'angle' in ar ? ar.angle : run + ar.speed * 0.35 * step;
      this.animRun.set(f.id, run);
    }
    out[4] = am; out[5] = run;
    out[6] = typeof v?.frost === 'number' ? Math.max(0, Math.min(1, v.frost)) : 0;
    out[7] = typeof v?.focus === 'number' ? Math.max(0, Math.min(1, v.focus)) : -1;
    this.goboTurn.set(f.id, turn);
    this.goboNow.set(f.id, [out[0], out[1]]);
    this.goboDrawn.set(f.id, [out[2], out[3]]);
    const fx = this.fxNow.get(f.id) ?? { prism: null, anim: 0, soft: 0, iris: 0, shake: [0, 0] as [number, number], scroll: [0, 0] as [number, number] };
    fx.anim = am; fx.shake = shake; fx.scroll = scroll;
    this.fxNow.set(f.id, fx);
    return out;
  }
  // a prism in: so many facets, round or in a line, turned so far (null: out)
  private prismFor(f: RigFixture, v: Resolved | undefined, dt: number): { facets: number; linear: boolean; turn: number } | null {
    const p = prismOf(f.prism!.ranges, typeof v?.prism === 'number' ? v.prism : 0);
    let turn = this.prismTurn.get(f.id) ?? 0;
    if (p && typeof v?.prismRotation === 'number') {
      const r = rotationOf(f.prism!.rot, v.prismRotation);
      turn = 'angle' in r ? r.angle : (turn + r.speed * Math.max(0, Math.min(0.5, dt))) % (Math.PI * 2);
    }
    this.prismTurn.set(f.id, turn);
    return p ? { ...p, turn: turn + this.rollNow } : null;
  }
  headOf(id: string) { const m = this.heads.get(id); return m ? { pan: m.p.at, tilt: m.t.at, roll: Number.isFinite(m.r.at) ? m.r.at : 0 } : undefined; }
  // the roll of the head being drawn (radians): its gobos and prism turn with it
  private rollNow = 0;
  // each light's beam angle as drawn (degrees, before the iris), for the tests
  private beamNow = new Map<string, number>();
  beamOf(id: string) { return this.beamNow.get(id); }
  // The frame round the selected lights: 1 shown, 0 faded away (while their look is worked on, so an
  // effect isn't hidden behind it). It fades in a moment, and an unlit selected light's lens and
  // cells stop showing the selection colour too.
  marks = 1;
  marksNow() { const m = this.sel.material as THREE.MeshBasicMaterial; return { opacity: m.opacity, visible: this.sel.visible, framed: this.sel.count }; }

  update(stage: Record<string, Resolved | undefined>, t: number, haze: number, selected: Set<string>) {
    const dt = this.headsAt < 0 ? 1 : t - this.headsAt; this.headsAt = t;
    const selMat = this.sel.material as THREE.MeshBasicMaterial;
    selMat.opacity += (0.9 * this.marks - selMat.opacity) * Math.min(1, Math.max(0, dt) * 14);
    this.sel.visible = selMat.opacity > 0.02;
    const marked = this.marks > 0.5;
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
    let lastSoft = 0;
    const beamAt = (p: THREE.Vector3, dir: THREE.Vector3, deg: number, level: number, c: THREE.Color, maxLen = MAX_BEAM, pool = true, gobo: readonly number[] = NO_GOBO) => {
      if (level < 0.01 || nb >= this.beams.instanceMatrix.count) return;
      const hit = hitFloor(p, dir), L = Math.max(0.05, hit ? Math.min(maxLen, Math.hypot(hit.x - p.x, hit.y - p.y, hit.z - p.z)) : maxLen), r = Math.max(0.01, L * Math.tan((deg / 2) * RAD));
      // the picture's blur: the frost, and how far the focus is off for this throw
      const soft = Math.min(1, gobo[6] + (gobo[7] >= 0 ? Math.abs(gobo[7] - Math.max(0, Math.min(1, (L - FOCUS_NEAR) / (FOCUS_FAR - FOCUS_NEAR)))) * 1.6 : 0));
      lastSoft = soft;
      this.beamGobo.setXYZW(nb, gobo[0], gobo[1], gobo[2], gobo[3]); this.beamFx.setXYZW(nb, gobo[4], gobo[5], soft, 0);
      if (!Number.isFinite(L + r + dir.x + dir.y + dir.z)) return;
      qb.setFromUnitVectors(UP, dir); mb.compose(p, qb, sb.set(r, L, r)); this.beams.setMatrixAt(nb, mb); this.beams.setColorAt(nb, c); this.beamLevel.setX(nb, level); nb++;
      if (pool && hit && L < maxLen && np < this.pools.instanceMatrix.count) {
        const rr = Math.max(0.15, r) / Math.max(0.35, Math.abs(dir.y));
        qb.setFromAxisAngle(UP, Math.atan2(dir.x, dir.z)); mb.compose(pb.set(hit.x, hit.y + 0.01, hit.z), qb, sb.set(Math.max(0.15, r), 1, rr));
        this.pools.setMatrixAt(np, mb); this.pools.setColorAt(np, c); this.poolLevel.setX(np, level * (1 - L / MAX_BEAM) * 1.2);
        this.poolGobo.setXYZW(np, gobo[0], gobo[1], gobo[2], gobo[3]); this.poolFx.setXYZW(np, gobo[4], gobo[5], soft, 0); np++;
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
      const level = lightOf(wholeLook(v), t), inSel = selected.has(f.id), isSel = inSel && marked;   // (a head lit only by its cells has a beam too)
      if (f.shape) m4.compose(pos, q, sc.set(f.size! * shapeW(f.shape) + 0.06, 0.2, f.size! * shapeH(f.shape) + 0.06));
      else if (f.look === 'headbar') m4.compose(pos, q, sc.set(HEADBAR_PITCH * (f.heads ?? 1) + 0.15, 0.45, 0.35));
      else if (f.look === 'winch') m4.compose(pos, q, sc.set(0.4, 0.4, 0.4));
      else m4.compose(pos, q, sc.set(f.kind === 'bar' ? Math.max(1, f.cells / 30) : 0.6, 0.7, 0.6));
      this.hit.setMatrixAt(nh++, m4); this.hitIds.push(f.id);
      if (inSel && ns < this.sel.instanceMatrix.count) this.sel.setMatrixAt(ns++, m4);   // (placed while it fades out too)
      if (f.look === 'spot' || f.look === 'wash') {
        const h = lensOf(f.look);
        // the head where its motors have got to, on its way to where the DMX says
        const want = headAngles(typeof v?.pan === 'number' ? v.pan : 0.5, typeof v?.tilt === 'number' ? v.tilt : 0.5, f.optics);
        let m = this.heads.get(f.id);
        if (!m) this.heads.set(f.id, (m = { p: { at: NaN, v: 0 }, t: { at: NaN, v: 0 }, r: { at: NaN, v: 0 } }));
        const ax = f.axes;
        const a = {
          p: axisTo(m.p, want.p, dt, PAN_SPEED, ax?.panRot, v?.panRotation),
          t: axisTo(m.t, want.t, dt, TILT_SPEED, ax?.tiltRot, v?.tiltRotation),
          r: ax?.rollDeg ? axisTo(m.r, ((typeof v?.roll === 'number' ? v.roll : 0.5) - 0.5) * ax.rollDeg, dt, ROLL_SPEED, ax.rollRot, v?.rollRotation) : 0,
        };
        this.rollNow = a.r * RAD;
        put(`${f.look}:base`, base);
        const yoke = YOKE.copy(base).multiply(TMP.makeRotationY(a.p * RAD)); put(`${f.look}:yoke`, yoke);
        const head = HEAD.copy(yoke).multiply(TMP.makeTranslation(0, PIVOT, 0)).multiply(TMP2.makeRotationX(a.t * RAD));
        if (a.r) head.multiply(TMP2.makeRotationY(a.r * RAD));      // (the roll: round its own beam)
        put(`${f.look}:head`, head);
        const lp = LP.set(0, h.at, 0).applyMatrix4(head);
        const d = toWorld(headLocal(a.p, a.t), f.rot);
        const dir = DIR.set(d.x, d.y, d.z);
        const zoom = typeof v?.zoom === 'number' ? v.zoom : f.look === 'wash' ? 0.5 : 0.25;
        // (its real angle over its zoom; unset zoom: where its zoom channel sits, the narrowest)
        const deg = f.beam ? f.beam[0] + (f.beam[1] - f.beam[0]) * (typeof v?.zoom === 'number' ? v.zoom : 0) : f.look === 'wash' ? 10 + zoom * 40 : 3 + zoom * 26;
        this.beamNow.set(f.id, deg);
        lensAt(lp, dir, h.r, lensCol(level, isSel));
        const g = f.gobos?.length || f.anim ? this.goboFor(f, v, dt, t) : NO_GOBO;
        // the iris closes the beam down (to about a third)
        const iris = typeof v?.iris === 'number' ? Math.max(0, Math.min(1, v.iris)) : 0, degI = deg * (1 - 0.68 * iris);
        const lvl = level * (f.look === 'wash' ? 0.8 : 1.15), from = CP.copy(lp).addScaledVector(dir, 0.03);
        const pr = f.prism ? this.prismFor(f, v, dt) : null;
        if (!pr) beamAt(from, dir, degI, lvl, col, MAX_BEAM, true, g);
        else {
          // a prism: the beam split into its facets, a few degrees off the axis (round: in a ring;
          // linear: in a row), turning with the prism
          const u = PU.crossVectors(dir, Math.abs(dir.y) < 0.95 ? UP : XAX).normalize(), w = PW.crossVectors(dir, u).normalize();
          const spread = Math.tan((4 + 1.4 * pr.facets) * RAD);
          for (let k = 0; k < pr.facets; k++) {
            const a = pr.turn + (pr.linear ? 0 : (k * Math.PI * 2) / pr.facets), off = pr.linear ? spread * (pr.facets > 1 ? (2 * k) / (pr.facets - 1) - 1 : 0) : spread;
            const dk = PD.copy(dir).addScaledVector(u, Math.cos(a) * off).addScaledVector(w, Math.sin(a) * off).normalize();
            beamAt(from, dk, degI, lvl * 0.78, col, MAX_BEAM, true, g);
          }
        }
        if (f.gobos?.length || f.anim || f.prism) {
          const fx = this.fxNow.get(f.id) ?? { prism: null, anim: 0, soft: 0, iris: 0, shake: [0, 0] as [number, number], scroll: [0, 0] as [number, number] };
          fx.prism = pr; fx.iris = iris; fx.soft = lastSoft;
          this.fxNow.set(f.id, fx);
        }
        pushLit(fi, lp, dir, col, level, deg);
      } else if (f.look === 'headbar') {
        // a moving bar: the bar pans as one; each head tilts on its own (its cell's tilt, else the
        // bar's), each motor at a real head's speed; each head its own beam in its cell's colour
        const n = f.heads ?? 1;
        let m = this.barHeads.get(f.id);
        if (!m || m.t.length !== n) this.barHeads.set(f.id, (m = { p: { at: NaN, v: 0 }, t: Array.from({ length: n }, () => ({ at: NaN, v: 0 })), hp: Array.from({ length: n }, () => ({ at: NaN, v: 0 })), tilts: [], pans: [] }));
        // (heads that pan each: the bar turns only by a pan of its own; their motors at the middle
        // unless set when it has one, as on the wire)
        const barPan = f.barPan ?? true;
        const pa = slew(m.p, headAngles(barPan && typeof v?.pan === 'number' ? v.pan : 0.5, 0.5, f.optics).p, dt, PAN_SPEED);
        put('headbar:base', base);
        const bar = YOKE.copy(base).multiply(TMP.makeRotationY(pa * RAD));
        put('headbar:bar', TMP2.copy(bar).multiply(TMP.makeScale(HEADBAR_PITCH * n + 0.1, 1, 1)));
        for (let k = 0; k < n; k++) {
          const cv = cellLookAt(v, f.headCells?.[k] ?? k, Math.max(f.cells, n)) ?? v;
          const tilt = typeof cv?.tilt === 'number' ? cv.tilt : typeof v?.tilt === 'number' ? v.tilt : 0.5;
          const ta = slew(m.t[k], headAngles(0.5, tilt, f.optics).t, dt, TILT_SPEED);
          const hp = f.headPan ? slew(m.hp[k], headAngles(typeof cv?.pan === 'number' && cv !== v ? cv.pan : barPan ? 0.5 : typeof v?.pan === 'number' ? v.pan : 0.5, 0.5, f.optics).p, dt, PAN_SPEED) : 0;
          const head = HEAD.copy(bar).multiply(TMP.makeTranslation((k - (n - 1) / 2) * HEADBAR_PITCH, HEADBAR_PIVOT, 0));
          if (f.headPan) head.multiply(TMP2.makeRotationY(hp * RAD));
          head.multiply(TMP2.makeRotationX(ta * RAD));
          m.pans[k] = hp;
          put('headbar:head', head);
          const cl = lightOf(cv, t);
          const lp = LP.set(0, HEADBAR_LENS, 0).applyMatrix4(head), dir = DIR.set(0, 1, 0).transformDirection(head);
          const deg = f.beam ? f.beam[0] + (f.beam[1] - f.beam[0]) * (typeof cv?.zoom === 'number' ? cv.zoom : 0) : 4;
          lensAt(lp, dir, 0.06, cl > 0.01 ? C2.copy(col).multiplyScalar(0.6 + cl * 1.4) : isSel ? sel : off);
          beamAt(CP.copy(lp).addScaledVector(dir, 0.02), dir, deg, cl * 1.1, col);
          if (cl > 0.01) pushLit(fi * 64 + k, lp, dir, col, cl, deg);
          m.tilts[k] = ta;
        }
        m.pan = pa;
      } else if (f.look === 'winch' && f.winch) {
        // a winch: the cable straight down from its box (whichever way the box is hung), the ball
        // on it going down and up at the winch's real speed, never past its soft limits
        const w = f.winch, lim = w.limits ?? [0, 1];
        let a = this.winches.get(f.id);
        if (!a) this.winches.set(f.id, (a = { at: NaN, v: 0 }));
        // (nothing says where: it stays where it is, as the real one is held)
        const wire = this.winchWire?.(f.id);
        const here = Number.isFinite(a.at) ? a.at / w.travel : lim[0];
        const want = wire === null ? here : wire !== undefined ? wire : typeof v?.hoist === 'number' ? Math.max(lim[0], Math.min(lim[1], v.hoist)) : here;
        const drop = slew(a, want * w.travel, dt, w.speed, Math.max(0.2, w.speed * 2));
        put('winch:box', TMP.makeTranslation(pos.x, pos.y, pos.z));
        const len = WINCH_BOX / 2 + Math.max(0.01, drop);
        put('winch:cable', TMP.makeTranslation(pos.x, pos.y - WINCH_BOX / 2, pos.z).multiply(TMP2.makeScale(1, len, 1)));
        const bp = CP.set(pos.x, pos.y - WINCH_BOX / 2 - len - WINCH_BALL / 2, pos.z);
        const ball = this.parts.get('winch:ball');
        if (ball) { const i = counts.get('winch:ball') ?? 0; put('winch:ball', TMP.makeTranslation(bp.x, bp.y, bp.z)); ball.setColorAt(i, level > 0.01 ? C2.copy(col).multiplyScalar(0.35 + level * 1.2) : isSel ? sel : C2.set(0x24262c)); }
        if (level > 0.01) pushLit(fi, bp, DIR.set(0, -1, 0), col, level * 0.35, 150);
        this.winchNow.set(f.id, drop);
      } else if (f.shape) {
        // a ring or a matrix: its board in the light's x-z plane, its pixels on it, facing its up
        const at = f.shape, S = f.size! / 2, dot = Math.max(0.006, 2 * at.dot * S);
        put(f.look, TMP.copy(base).multiply(TMP2.makeScale(2 * S * shapeW(at) + 0.04, 1, 2 * S * shapeH(at) + 0.04)));
        const dir = DIR.copy(UP).applyQuaternion(q);
        for (let i = 0; i < at.n; i++) {
          const cl = lightOf(cellLookAt(v, i, at.n) ?? v, t);
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
          const cv = cellLookAt(v, i, f.cells) ?? v;
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
        const deg = f.beam ? f.beam[0] + (f.beam[1] - f.beam[0]) * (typeof v?.zoom === 'number' ? v.zoom : 0) : f.look === 'strobe' ? 50 : f.look === 'blinder' ? 55 : f.look === 'par' ? 24 : 30;
        this.beamNow.set(f.id, deg);
        const lamps = b.lamps;
        for (const [lx, lz] of lamps) {
          const lp = LP.set(lx, 0, lz).applyMatrix4(base);
          lensAt(lp, dir, b.r, lensCol(level, isSel));
          beamAt(CP.copy(lp).addScaledVector(dir, 0.03), dir, deg, level * (f.look === 'strobe' ? 0.4 : 1) / Math.sqrt(lamps.length), col, f.look === 'strobe' || f.look === 'blinder' ? 10 : MAX_BEAM);
        }
        pushLit(fi, pos, dir, col, level, deg);
      }
    }
    for (const [k, mesh] of this.parts) { mesh.count = counts.get(k) ?? 0; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    this.lens.count = nl; this.beams.count = nb; this.pools.count = np; this.cells.count = nc; this.hit.count = nh; this.sel.count = ns;
    for (const m of [this.lens, this.beams, this.pools, this.cells, this.hit, this.sel]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    for (const a of [this.beamGobo, this.beamFx, this.poolGobo, this.poolFx]) a.needsUpdate = true;
    this.beamLevel.needsUpdate = true; this.poolLevel.needsUpdate = true;
    this.beamCount = nb;
  }
}
