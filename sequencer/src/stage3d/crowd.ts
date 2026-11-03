// The audience: a few hundred people who look like people, for a few dozen draw calls. Each body
// part is one instanced mesh (torsos in printed shirts from one picture, heads with faces, five
// hair styles, caps and beanies, jeans, shorts and skirts, arms in a handful of poses), so a person
// is a set of instances that share a place, a size and a phase. Nothing is updated per person per
// frame: jumping on the beat, nodding and waving arms happen in the vertex shader, driven by three
// numbers (time, beat, energy).
//
// Arms are built with the same two-bone solver as the band (people.ts): every pose starts at a
// shoulder and ends in a hand where the pose wants it (up in the air, round a phone, on a flag pole,
// on the shins of someone sitting on their shoulders). An arm and everything in that hand turn
// together about the shoulder, so a hand never leaves its arm and an arm never leaves its body.
// Metres, y up, a person faces +z in their own space (turned towards the stage when placed).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARM, HIP, SHOULDER, twoBone } from './people';
import { crowdFace, flagAtlas, FLAGS, knit, shirtAtlas, shirtColor, SHIRT_COLS, SHIRT_ROWS, SHIRTS, white } from './textures';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const NECK = V(0, 1.53, -0.005);              // where the head nods from
const RIDER = { k: 0.86, y: 0.77, z: -0.17 };  // someone on someone's shoulders: their size and seat
const POLE = { x: 0.07, z: 0.27, y0: 0.95, y1: 3.3 };   // a flag pole held in front
// Waving it: the pole swings side to side about the lower hand (a little above it), the upper hand
// (the left one) goes with it; the wrist that holds it, at rest (a hand's width back from the grip
// towards the left shoulder)
export const FLAG_PIVOT = V(POLE.x, 1.3, POLE.z);
const GRIP_HI = V(POLE.x, 1.72, POLE.z), SH_L = V(0.2, 1.43, -0.01);
export const FLAG_WRIST = GRIP_HI.clone().addScaledVector(SH_L.clone().sub(GRIP_HI).normalize(), 0.05);
const g3 = (v: THREE.Vector3) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;

// ---- the motion, in the vertex shader (shared by every crowd material). Each person has a phase,
// how keen they are to jump (the energy it takes), a beat offset, a jump height and period, and how
// much they bob at the knees; each part how far it turns (an arm at its shoulder, a head at its neck).
// A jump: knees bend (the body drops a few cm), take-off, a ballistic arc, landing on the beat with
// the knees bending again; raised arms reach up while in the air. On the loud parts hanging arms go
// up and pump on the beat (turned up about the shoulder: the keen ones first) and the keen ones
// bang their heads, down hard on the beat. crowdMotion() below is the same sums in TypeScript (the
// tests check arms and hands with it).
const U = { uTime: { value: 0 }, uBeat: { value: 0 }, uEnergy: { value: 0 }, uBeatLen: { value: 0.476 } };
const LEG = { ankle: 0.09, knee: 0.5, hip: 0.91 };       // where a standing leg bends (person space)
export const EXCITE = { from: 0.25, to: 0.7 };            // the lights' energy from quiet to a drop
// (what a part does is set by uniforms, not defines: every crowd part with the same kind of
// material shares one shader, so the 3D view has few shaders to compile when it opens)
const PARS = /* glsl */`
attribute vec4 aAnim;            // phase 0..1, energy it takes to jump, how far this part turns, beat offset
attribute vec4 aJump;            // jump height (m), every how many beats, knee bob (m), cell of the picture
// (a part in three colours keeps its tone in uv.x; an arm's pose at the top of a jump in aPos2)
attribute vec3 aColB; attribute vec3 aColC; attribute vec3 aPos2;
uniform float uTime; uniform float uBeat; uniform float uEnergy; uniform float uBeatLen;
// how this part moves (0 nods on the beat, 1 sways over two beats, 2 pumps on every beat), about
// x or z; colours by tone; legs that bend; an arm that reaches up in a jump; a flag; a picture cell
uniform float uMotion; uniform float uTurnX; uniform float uTones; uniform float uLegs; uniform float uReach; uniform float uFlag; uniform vec2 uAtlas; uniform float uCols; uniform float uRaise;
// a flag pole that swings; the arm that waves it
uniform float uPole; uniform float uWave;
// x: how high the body is off the ground, y: how far the knees have dropped it, z: 0..1 at the top of a jump
vec3 cJump() {
  float P = max(1.0, aJump.y), B = uBeatLen * P;
  float f = smoothstep(aAnim.y, aAnim.y + 0.12, uEnergy);
  float air = clamp(2.0 * sqrt(2.0 * aJump.x / 9.81), 0.24, 0.75 * B), g = B - air;
  float tau = fract((uBeat + aAnim.w) / P) * B;
  vec3 r = vec3(0.0);
  if (tau > g) { float s = (tau - g) / air; r.x = 4.0 * aJump.x * f * s * (1.0 - s); r.z = 4.0 * s * (1.0 - s) * f; }
  else r.y = 0.05 * f * sin(3.14159 * tau / g);
  float d = fract(uBeat + aAnim.w); d = min(d, 1.0 - d);
  r.y += aJump.z * (0.3 + 0.7 * uEnergy) * pow(cos(3.14159 * d), 6.0) * (1.0 - f);
  return r;
}
float cAngle() {
  float e = 0.3 + 0.7 * uEnergy, w, ph = uBeat + aAnim.w;
  if (uMotion < 0.5) w = mix(sin(6.28318 * ph) * e, 3.0 * pow(abs(cos(3.14159 * ph)), 6.0) - 0.6, smoothstep(aAnim.y + 0.25, aAnim.y + 0.45, uEnergy));
  else if (uMotion < 1.5) w = sin(3.14159 * ph) * e;
  else { float s = max(0.0, sin(6.28318 * ph)); w = (s * s - 0.3) * e; }
  float a = aAnim.z * (w + 0.25 * sin(uTime * 0.9 + 6.28318 * aAnim.x));
  if (uRaise > 0.5) { float k = 0.8 * aAnim.y + 0.1 + 0.2 * aAnim.x; a -= smoothstep(k, k + 0.15, uEnergy) * (2.55 + 0.3 * pow(abs(cos(3.14159 * ph)), 4.0)); }
  return a;
}
vec3 cTurn(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return uTurnX > 0.5 ? vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z) : vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z);
}
// ---- a flag being waved. The pole swings side to side about the lower hand, there and back every
// bar, wider when it's loud (fSwing: its angle, lag seconds ago; fSpeed: which way and how fast
// it's going then). The cloth hangs from the top of the pole and streams away from the way the pole
// goes; at each turn it swings round in front of the pole. Further out it follows a moment later
// (a wave runs out along it), it drops when the pole slows down, and ripples, faster when it's fast.
const vec3 FPIV = ${g3(FLAG_PIVOT)}, FTOP = ${g3(V(POLE.x, POLE.y1 - 0.02, POLE.z))}, FWR = ${g3(FLAG_WRIST)}, FSH = ${g3(SH_L)};
float fA() { return 0.2 + 0.25 * smoothstep(0.2, 0.8, uEnergy); }
float fPh(float lag) { return 6.28318 * ((uBeat + aAnim.w) * 0.25 + aAnim.x) - lag * 1.5708 / uBeatLen; }
float fSwing(float lag) { return fA() * sin(fPh(lag)); }
float fSpeed(float lag) { return fA() * cos(fPh(lag)); }
vec3 fRotN(vec3 n, float a) { float c = cos(a), s = sin(a); return vec3(c * n.x - s * n.y, s * n.x + c * n.y, n.z); }
vec3 fRot(vec3 p, float a) { return FPIV + fRotN(p - FPIV, a); }
vec3 fCloth(vec3 p0, out vec3 N) {
  float L = max(0.0, p0.x), u = uv.x, lag = 0.32 * u;
  float a = fSwing(lag), w = fSpeed(lag), sp = clamp(abs(w) / 0.3, 0.0, 1.0);
  float ang = atan(w * 3.0, 0.4);
  vec3 dir = vec3(sin(ang), 0.0, cos(ang)), side = vec3(dir.z, 0.0, -dir.x);
  float drop = (1.0 - 0.8 * sp) * 0.75 * u;
  float k = 10.0, wph = L * k - uTime * (7.0 + 9.0 * sp) + 6.28318 * aAnim.x, amp = (0.025 + 0.045 * sp) * u;
  float fl = amp * sin(wph) + 0.012 * u * sin(p0.y * 10.0 + uTime * 4.0);
  vec3 tU = normalize(dir * cos(drop) - vec3(0.0, sin(drop), 0.0) + side * (amp * k * cos(wph)));
  N = fRotN(normalize(cross(vec3(0.0, 1.0, 0.0), tU)), a);
  return fRot(FTOP + vec3(0.0, p0.y, 0.0) + dir * (L * cos(drop)) - vec3(0.0, L * sin(drop), 0.0) + side * fl, a);
}
// the waving arm (from its shoulder): turned so its wrist goes where the pole carries the grip,
// stretched a little where a straight arm couldn't reach
vec3 fRodr(vec3 v, vec3 ax, float an) { float c = cos(an), s = sin(an); return v * c + cross(ax, v) * s + ax * dot(ax, v) * (1.0 - c); }
void fArm(out vec3 ax, out float an, out float k) {
  vec3 h = FWR - FSH, t = fRot(FWR, fSwing(0.0)) - FSH, c = cross(h, t);
  float l = length(c); ax = l > 1e-6 ? c / l : vec3(0.0, 0.0, 1.0); an = atan(l, dot(h, t)); k = clamp(length(t) / length(h), 0.85, 1.15);
}
`;
function patchCrowd(this: THREE.Material, sh: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(sh.uniforms, U, this.userData.part);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uFlip;')
    .replace('#include <map_fragment>', `#ifdef USE_MAP
vec2 mUv = vMapUv; if (uFlip > 0.5 && !gl_FrontFacing) mUv.x = 1.0 - mUv.x;
diffuseColor *= texture2D(map, mUv);
#endif`);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\n${PARS}`)
    .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nif (uCols > 0.5) { float cc = mod(aJump.w, uCols), cr = floor(aJump.w / uCols + 0.001); vMapUv = vMapUv * uAtlas + vec2(cc * uAtlas.x, 1.0 - (cr + 1.0) * uAtlas.y); }\n#endif')
    .replace('#include <color_vertex>', `#include <color_vertex>
if (uTones > 0.5) vColor = uv.x < 0.5 ? instanceColor : (uv.x < 1.5 ? aColB : aColC);
vec3 cJ = cJump(); float cA = cAngle(); float cSy = max(1e-3, length(instanceMatrix[1].xyz));
vec3 fP = vec3(0.0), fN = vec3(0.0, 0.0, 1.0), fAx = vec3(0.0, 0.0, 1.0); float fAn = 0.0, fK = 1.0;
if (uFlag > 0.5) fP = fCloth(position, fN);
if (uWave > 0.5) fArm(fAx, fAn, fK);`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
if (uFlag > 0.5) objectNormal = fN;
if (uPole > 0.5) objectNormal = fRotN(objectNormal, fSwing(0.0));
if (uWave > 0.5) objectNormal = fRodr(objectNormal, fAx, fAn);
objectNormal = cTurn(objectNormal, cA);`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
if (uReach > 0.5) transformed = mix(transformed, aPos2, cJ.z);
if (uFlag > 0.5) transformed = fP;
if (uPole > 0.5) transformed = fRot(transformed, fSwing(0.0));
if (uWave > 0.5) transformed = fRodr(transformed, fAx, fAn) * fK;
transformed = cTurn(transformed, cA);
if (uLegs > 0.5) {
  // knees bend: the hips drop, the knees come forward, the feet stay where they are
  float c = cJ.y / cSy, hl = ${((LEG.hip - LEG.ankle) / 2).toFixed(3)};
  float fwd = sqrt(max(0.0, hl * hl - pow((2.0 * hl - c) * 0.5, 2.0)));
  float y = transformed.y;
  float tent = y < ${LEG.knee.toFixed(3)} ? clamp((y - ${LEG.ankle.toFixed(3)}) / ${(LEG.knee - LEG.ankle).toFixed(3)}, 0.0, 1.0) : clamp((${LEG.hip.toFixed(3)} - y) / ${(LEG.hip - LEG.knee).toFixed(3)}, 0.0, 1.0);
  transformed.z += fwd * tent; transformed.y -= c * clamp((y - ${LEG.ankle.toFixed(3)}) / ${(LEG.hip - LEG.ankle).toFixed(3)}, 0.0, 1.0);
} else transformed.y -= cJ.y / cSy;
transformed.y += cJ.x / cSy;`);
}
// a material for one part: how it moves (0 nods on the beat, 1 sways over two beats, 2 pumps on
// every beat), the axis it turns about, colours by tone, a cell of a picture, legs that bend, an
// arm that reaches up in a jump, an arm that goes up when it's loud
function crowdMat(m: THREE.Material, o: { motion?: 0 | 1 | 2; turnX?: boolean; tones?: boolean; atlas?: [number, number]; flag?: boolean; legs?: boolean; reach?: boolean; raise?: boolean; pole?: boolean; wave?: boolean; flip?: boolean }) {
  const u = (v: unknown) => ({ value: v });
  m.userData.part = { uMotion: u(o.motion ?? 0), uTurnX: u(o.turnX ? 1 : 0), uTones: u(o.tones ? 1 : 0), uLegs: u(o.legs ? 1 : 0), uReach: u(o.reach ? 1 : 0), uFlag: u(o.flag ? 1 : 0), uAtlas: u(new THREE.Vector2(...(o.atlas ?? [1, 1]))), uCols: u(o.atlas ? Math.round(1 / o.atlas[0]) : 0), uRaise: u(o.raise ? 1 : 0),
    uPole: u(o.pole ? 1 : 0), uWave: u(o.wave ? 1 : 0), uFlip: u(o.flip ? 1 : 0) };
  m.onBeforeCompile = patchCrowd;
  // (what drives it, for the tests: the same values the shader gets)
  m.userData.motion = U;
  return m;
}
// (a part without a picture gets a white one: every crowd part then shares one shader)
const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o, map: o.map ?? white() });

// The same motion in TypeScript: for one person's numbers at one moment, how high the body is, how
// far the knees dropped it, how far into a jump's top (0..1), and the turn of a part (radians)
export interface Motion { phase: number; keen: number; amp: number; off: number; h: number; period: number; bob: number; motion: 0 | 1 | 2; raise?: boolean }
const fract = (v: number) => v - Math.floor(v);
const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
export function crowdMotion(m: Motion, t: number, beat: number, energy: number, beatLen = 0.476) {
  const P = Math.max(1, m.period), B = beatLen * P, f = smooth(m.keen, m.keen + 0.12, energy);
  const air = Math.max(0.24, Math.min(0.75 * B, 2 * Math.sqrt((2 * m.h) / 9.81))), g = B - air, tau = fract((beat + m.off) / P) * B;
  let lift = 0, bend = 0, top = 0;
  if (tau > g) { const s = (tau - g) / air; lift = 4 * m.h * f * s * (1 - s); top = 4 * s * (1 - s) * f; } else bend = 0.05 * f * Math.sin((Math.PI * tau) / g);
  let d = fract(beat + m.off); d = Math.min(d, 1 - d);
  bend += m.bob * (0.3 + 0.7 * energy) * Math.pow(Math.cos(Math.PI * d), 6) * (1 - f);
  const e = 0.3 + 0.7 * energy, ph = beat + m.off;
  const sw = m.motion === 0 ? Math.sin(2 * Math.PI * ph) * e + (3 * Math.abs(Math.cos(Math.PI * ph)) ** 6 - 0.6 - Math.sin(2 * Math.PI * ph) * e) * smooth(m.keen + 0.25, m.keen + 0.45, energy)
    : m.motion === 1 ? Math.sin(Math.PI * ph) * e : (Math.max(0, Math.sin(2 * Math.PI * ph)) ** 2 - 0.3) * e;
  let angle = m.amp * (sw + 0.25 * Math.sin(t * 0.9 + 2 * Math.PI * m.phase));
  // (an arm that goes up when it's loud: up about the shoulder, pumping on the beat)
  if (m.raise) { const k = 0.8 * m.keen + 0.1 + 0.2 * m.phase; angle -= smooth(k, k + 0.15, energy) * (2.55 + 0.3 * Math.abs(Math.cos(Math.PI * ph)) ** 4); }
  return { lift, bend, top, angle };
}
// the turn the shader gives a part (about x for a nod or a pump, else about z)
export function crowdTurn(v: THREE.Vector3, a: number, turnX: boolean) {
  const c = Math.cos(a), s = Math.sin(a);
  return turnX ? V(v.x, c * v.y - s * v.z, s * v.y + c * v.z) : V(c * v.x - s * v.y, s * v.x + c * v.y, v.z);
}

// A flag being waved, in TypeScript (the shader's fSwing, fSpeed and fArm; the tests check the hands
// with it): the pole's angle (radians, about the person's z through FLAG_PIVOT) and which way it's
// going, lag seconds ago; a point carried round with the pole; where a point of the waving arm
// (from its shoulder) goes.
export function flagSwing(m: { phase: number; off: number }, beat: number, energy: number, beatLen = 0.476, lag = 0) {
  const A = 0.2 + 0.25 * smooth(0.2, 0.8, energy), ph = 2 * Math.PI * ((beat + m.off) * 0.25 + m.phase) - (lag * Math.PI / 2) / beatLen;
  return { angle: A * Math.sin(ph), speed: A * Math.cos(ph) };
}
export const flagTurn = (p: THREE.Vector3, a: number) => p.clone().sub(FLAG_PIVOT).applyAxisAngle(V(0, 0, 1), a).add(FLAG_PIVOT);
export function flagArm(v: THREE.Vector3, a: number) {
  const h = FLAG_WRIST.clone().sub(SH_L), t = flagTurn(FLAG_WRIST, a).sub(SH_L), c = h.clone().cross(t), l = c.length();
  const ax = l > 1e-6 ? c.divideScalar(l) : V(0, 0, 1), an = Math.atan2(l, h.dot(t)), k = Math.max(0.85, Math.min(1.15, t.length() / h.length()));
  return v.clone().applyAxisAngle(ax, an).multiplyScalar(k);
}

// ---- geometry: every piece indexed, with a uv (a part in three colours: uv.x says which, 0, 1 or 2)
function piece(g: THREE.BufferGeometry, uv?: [number, number]) {
  if (!g.index) { const n = g.attributes.position.count; g.setIndex(Array.from({ length: n }, (_, i) => i)); }
  const n = g.attributes.position.count;
  if (!g.attributes.uv || uv) { const a = new Float32Array(n * 2); if (uv) for (let i = 0; i < n; i++) { a[i * 2] = uv[0]; a[i * 2 + 1] = uv[1]; } g.setAttribute('uv', new THREE.BufferAttribute(a, 2)); }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  return g;
}
const join = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts)!;
// a thin part seen from both sides (hair hanging down, a skirt): the triangles again, turned round
function twoSided(g: THREE.BufferGeometry) {
  const b = g.clone(), ix = b.index!, nm = b.attributes.normal;
  for (let i = 0; i + 2 < ix.count; i += 3) { const a = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, a); }
  for (let i = 0; i < nm.count; i++) nm.setXYZ(i, -nm.getX(i), -nm.getY(i), -nm.getZ(i));
  return join([g, b]);
}
// a tapered rod from a to b (r0 at a, r1 at b)
function rod(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg = 7, tone = 0) {
  const d = b.clone().sub(a), L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize())).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return piece(g, [tone, 0]);
}
const ball = (p: THREE.Vector3, r: number, tone = 0, w = 8, h = 6) => piece(new THREE.SphereGeometry(r, w, h).translate(p.x, p.y, p.z), [tone, 0]);
// the hair's little roughness: vertices pushed in and out
function rough(g: THREE.BufferGeometry, k: number, f = 140) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const s = 1 + Math.sin(p.getX(i) * f) * Math.sin(p.getY(i) * (f + 30)) * Math.sin(p.getZ(i) * (f - 20)) * k; p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s); }
  g.computeVertexNormals(); return g;
}

// the shirt: the body's outline turned round, squashed front to back; the back of the shirt is a
// quarter of the way round the picture, the front three quarters (textures.ts shirtAtlas)
function torsoGeo() {
  const prof = [[0, 0.99], [0.166, 0.995], [0.162, 1.06], [0.168, 1.14], [0.178, 1.22], [0.19, 1.3], [0.196, 1.37], [0.19, 1.42], [0.165, 1.465], [0.115, 1.5], [0.06, 1.522], [0, 1.53]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 12, Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setY(i, (p.getY(i) - 0.99) / 0.54);
  g.scale(1, 1, 0.64); g.computeVertexNormals();
  return piece(g);
}
// hips and legs standing, the shorts' hem above the knee (tone 0 above it, 1 below, 2 the shoes)
function legsGeo(sit = false) {
  const hips = new THREE.LatheGeometry([[0, 0.84], [0.12, 0.85], [0.168, 0.91], [0.172, 1.0], [0, 1.02]].map(([r, y]) => new THREE.Vector2(r, y)), 10);
  hips.scale(1, 1, 0.64); hips.computeVertexNormals();
  const parts = [piece(hips, [0, 0])];
  for (const sx of [-1, 1]) {
    const hip = V(sx * HIP.x, HIP.y - 0.02, 0);
    const knee = sit ? V(sx * 0.19, 0.83, 0.38) : V(sx * 0.105, 0.5, 0.02), ankle = sit ? V(sx * 0.19, 0.42, 0.4) : V(sx * 0.115, 0.09, 0);
    const hem = hip.clone().lerp(knee, 0.62);
    parts.push(rod(hip, hem, 0.078, 0.066, 6, 0), rod(hem, knee, 0.066, 0.058, 6, 1), ball(knee, 0.058, 1, 6, 4), rod(knee, ankle, 0.056, 0.043, 6, 1));
    // a shoe: toes forward (pointing down a little on someone sitting high up)
    const shoe = new THREE.SphereGeometry(1, 7, 4).scale(0.052, 0.045, 0.13);
    if (sit) shoe.rotateX(0.5).translate(ankle.x, ankle.y - 0.03, ankle.z + 0.06); else shoe.translate(ankle.x, 0.045, 0.05);
    parts.push(piece(shoe, [2, 0]));
  }
  return join(parts);
}
// a skirt over the hips, flaring out
const skirtGeo = () => twoSided(piece(new THREE.CylinderGeometry(0.175, 0.255, 0.38, 14, 1, true).scale(1, 1, 0.72).translate(0, 0.8, 0)));
// the head round its nodding point at the neck: neck, skull with the face picture, nose, ears
// (pieces that aren't the face take a white spot of the picture: the skin colour tints them)
function headGeo() {
  const W = [0.75, 0.6] as [number, number];
  const skull = new THREE.SphereGeometry(0.1, 12, 9).scale(0.9, 1.12, 1).translate(0, 0.16, 0);
  return join([
    piece(new THREE.CylinderGeometry(0.047, 0.055, 0.15, 6, 1, true).translate(0, 0.01, 0), W), piece(skull),
    piece(new THREE.ConeGeometry(0.016, 0.045, 6).rotateX(Math.PI / 2.4).translate(0, 0.142, 0.1), W),
    piece(new THREE.SphereGeometry(0.022, 5, 4).scale(0.45, 1.1, 0.8).translate(0.088, 0.145, -0.005), W),
    piece(new THREE.SphereGeometry(0.022, 5, 4).scale(0.45, 1.1, 0.8).translate(-0.088, 0.145, -0.005), W),
  ]);
}
type Hair = 'short' | 'long' | 'pony' | 'bun' | 'curly' | 'bald';
type Hat = 'cap' | 'beanie' | undefined;
const capOf = (r: number, to: number, w = 12, h = 5) => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI * to).scale(0.92, 1.1, 1.02);
function hairGeo(s: Exclude<Hair, 'bald'>) {
  // (tipped back: the hairline sits higher at the front than at the back)
  const top = () => piece(rough(capOf(0.107, 0.54), 0.02).rotateX(-0.3).translate(0, 0.17, -0.012));
  if (s === 'short') return top();
  if (s === 'long') return join([top(), piece(rough(new THREE.CylinderGeometry(0.1, 0.13, 0.36, 9, 2, true, Math.PI * 0.6, Math.PI * 0.8), 0.03).translate(0, 0.02, -0.015))]);
  if (s === 'bun') return join([top(), piece(rough(new THREE.SphereGeometry(0.05, 7, 5), 0.04).translate(0, 0.26, -0.07))]);
  if (s === 'pony') return join([top(), rod(V(0, 0.2, -0.11), V(0, -0.03, -0.17), 0.034, 0.012, 7), piece(new THREE.TorusGeometry(0.03, 0.008, 4, 8).rotateX(1.2).translate(0, 0.19, -0.115))]);
  // curly: a big soft cloud of curls
  return piece(rough(new THREE.SphereGeometry(0.13, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1, 1.02, 1), 0.07, 90).rotateX(-0.25).translate(0, 0.155, -0.02));
}
function hatGeo(h: 'cap' | 'beanie') {
  if (h === 'cap') return join([
    piece(capOf(0.11, 0.45).translate(0, 0.18, -0.006)),
    piece(new THREE.CylinderGeometry(0.1, 0.1, 0.008, 9, 1, false, -Math.PI / 2, Math.PI).scale(0.85, 1, 1.25).rotateX(0.12).translate(0, 0.205, 0.07)),
    piece(new THREE.SphereGeometry(0.012, 6, 4).translate(0, 0.302, -0.006)),
  ]);
  return join([piece(rough(capOf(0.113, 0.5).scale(1, 1.12, 1), 0.01).rotateX(-0.15).translate(0, 0.18, -0.01)), piece(new THREE.CylinderGeometry(0.107, 0.109, 0.045, 12, 1, true).scale(0.92, 1, 1.02).rotateX(-0.15).translate(0, 0.2, -0.01))]);
}

// An arm from shoulder S to the wrist at W (both in the person's space), bent towards `pole`: a
// shoulder ball and a sleeve (tone 0), the arm (1), a hand (2) pointing on from the forearm. Built
// round the shoulder (S is the origin), so it can turn there. `fist`: a closed hand. W2: where the
// wrist goes at the top of a jump (the same pieces again: the shader blends between the two).
// userData.marks: the vertex ranges of the shoulder ball, the wrist end of the forearm and the hand.
export interface ArmPose { S: THREE.Vector3; E: THREE.Vector3; W: THREE.Vector3; hand: THREE.Vector3 }
function armPieces(S: THREE.Vector3, W0: THREE.Vector3, pole: THREE.Vector3, fist: boolean) {
  const E0 = twoBone(S, W0, ARM.a, ARM.b, pole);
  const W = E0.clone().add(W0.clone().sub(E0).normalize().multiplyScalar(ARM.b));     // (stretched if out of reach)
  const s = V(0, 0, 0), e = E0.clone().sub(S), w = W.clone().sub(S), dir = w.clone().sub(e).normalize();
  const sleeve = s.clone().lerp(e, 0.5);
  const hand = w.clone().addScaledVector(dir, fist ? 0.04 : 0.055);
  const hg = new THREE.SphereGeometry(1, 6, 4).scale(fist ? 0.042 : 0.038, fist ? 0.046 : 0.06, fist ? 0.04 : 0.018);
  hg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir)).translate(hand.x, hand.y, hand.z);
  // (the forearm's first ring of vertices is its wrist end: the rod's +y end is at w)
  const parts = [ball(s, 0.062, 0, 7, 5), rod(s, sleeve, 0.062, 0.056, 7, 0), rod(s, e, 0.05, 0.043, 6, 1), ball(e, 0.043, 1, 6, 4), rod(e, w, 0.042, 0.032, 6, 1), piece(hg, [2, 0])];
  return { parts, pose: { S: s, E: e, W: w, hand } satisfies ArmPose };
}
function armGeo(S: THREE.Vector3, W: THREE.Vector3, pole: THREE.Vector3, fist = false, W2?: THREE.Vector3) {
  const a = armPieces(S, W, pole, fist), g = join(a.parts);
  const counts = a.parts.map((p) => p.attributes.position.count), start = (i: number) => counts.slice(0, i).reduce((x, y) => x + y, 0);
  g.userData.marks = { shoulder: [0, counts[0]], wrist: [start(4), 7], hand: [start(5), counts[5]] };
  g.userData.pose = a.pose;
  if (W2) {
    const b = join(armPieces(S, W2, pole, fist).parts);
    g.setAttribute('aPos2', b.attributes.position);
    g.userData.reach = true;
  }
  return g;
}
// a phone held up in the hand at the end of an arm (in the arm's space): the screen faces the
// person (they film the stage); dark body, lit screen (vertex colours)
function phoneGeo(pose: ArmPose) {
  const c = pose.hand.clone().add(V(0, 0.035, -0.012));
  const body = new THREE.BoxGeometry(0.074, 0.15, 0.01).translate(c.x, c.y, c.z), scr = new THREE.PlaneGeometry(0.066, 0.135).rotateY(Math.PI).translate(c.x, c.y, c.z - 0.0056);
  const col = (g: THREE.BufferGeometry, v: number) => { g.deleteAttribute('uv'); g.deleteAttribute('normal'); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(v), 3)); return g.index ? g : g; };
  return mergeGeometries([col(body, 0.015), col(scr, 1)])!;
}

// ---- the people
export type ArmName = 'down' | 'hip' | 'up' | 'wave' | 'fist' | 'phone' | 'flag' | 'carry';
export interface Fan {
  x: number; z: number; yaw: number; s: number; girth: number; phase: number;
  // jumping: the energy it takes (over 1: never), how high (m), every how many beats, the beat
  // offset (friends jump together), the knee bob on the beat when not jumping (m)
  keen: number; h: number; period: number; off: number; bob: number;
  hair: Hair; hat: Hat; shirt: number; pants: 'jeans' | 'shorts' | 'skirt'; arms: { L: ArmName; R: ArmName };
  rider?: number; carrier?: number; flag?: boolean;
  // where its parts are drawn (for the tests): mesh name and instance
  at: Record<string, [string, number]>;
}
export interface Crowd {
  group: THREE.Group; count: number; fans: Fan[]; parts: Map<string, THREE.InstancedMesh>;
  update: (t: number, beat: number, energy: number, col: THREE.Color) => void;
  // how excited they are now (0 calm .. 1 at a drop: the lights' energy, smoothed; see update())
  excitement: () => number;
  // a person's own space (their place, size and turn; a rider's sits on its carrier's shoulders)
  frame: (i: number) => THREE.Matrix4;
}
// where the crowd stands: from z0 (the front) back to z1, across -spread(z)..spread(z), not where
// keepOut says; riders (on someone's shoulders) and flags: how many (unset: a few for a big crowd);
// the band's banner (its picture and how wide it is for its height): on most of the flags
export interface CrowdArea { z0: number; z1: number; spread: (z: number) => number; keepOut: (x: number, z: number) => boolean; riders?: number; flags?: number; banner?: { map: THREE.Texture; aspect: number } }

const SKIN = [0xf1c8a8, 0xe8b896, 0xe0ac86, 0xc98d68, 0xb07850, 0x9c6544, 0x7a4e34, 0x5e3a26, 0xf6d5bb];
const HAIR = [0x161210, 0x161210, 0x2b1d14, 0x2b1d14, 0x3a2414, 0x5a3a22, 0x7a5230, 0x9a6a34, 0xb08a50, 0xc8a060, 0xd9c08a, 0x8a8a88, 0x8a3a24], DYED = [0xd85a9a, 0x3a6ad8, 0x2aa07a, 0x8a4ad0];
const HATS = [0x111111, 0x1d2b4a, 0x8a1f1f, 0x2a4a2a, 0xd8d0c0, 0xe0b020, 0x5a2a6a, 0x3a3a3a];
const PLAINS = [0x2a2a30, 0x3b1f2b, 0x1f2f3b, 0x40403a, 0x5a1a1a, 0x1a3a2a, 0x222244, 0x6b6b6b, 0x111111, 0x7a5a20, 0x203a5a, 0xd8d8d0, 0xb03030, 0x2a6a8a, 0x8a6a9a, 0xe0a030];
const JEANS = [0x2a3a5a, 0x1e2a44, 0x3a4c6e, 0x5a6e8e, 0x141418, 0x2a2a2e, 0x4a4a48, 0x3a3226];
const SHORTS = [0xb8a47a, 0x5a6e8e, 0x2a2a2e, 0x6a7a4a];
const SKIRTS = [0x141414, 0x6a1a24, 0x2a2a4a, 0x3a3a3a, 0x8a5a2a];
const SHOES = [0xeeeeea, 0x151515, 0x2a2a2a, 0xd8d8d0, 0x8a2a2a, 0x2a4a8a, 0x6a4a2a];

export function buildCrowd(n: number, area: CrowdArea, seed = 777): Crowd {
  let st = seed;
  const rnd = () => ((st = (st * 16807) % 2147483647) / 2147483647);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length) % a.length];
  const weighted = <T>(w: [T, number][]) => { let r = rnd() * w.reduce((a, b) => a + b[1], 0); for (const [v, k] of w) { if ((r -= k) <= 0) return v; } return w[w.length - 1][0]; };

  // places: random with a minimum gap (denser at the front), around what's in the way
  const riders = area.riders ?? (n >= 12 ? Math.max(1, Math.round(n / 110)) : 0), flags = area.flags ?? (n >= 8 ? Math.max(1, Math.round(n / 85)) : 0);
  const spots: { x: number; z: number }[] = [], cell = 0.7, grid = new Map<string, { x: number; z: number }[]>();
  const gap = (z: number) => 0.46 + 0.011 * (z - area.z0);
  for (let tries = 0; spots.length < n - riders && tries < n * 60; tries++) {
    const z = area.z0 + Math.pow(rnd(), 0.85) * (area.z1 - area.z0), x = (rnd() * 2 - 1) * area.spread(z);
    if (area.keepOut(x, z)) continue;
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell), d = gap(z);
    let ok = true;
    for (let i = -1; i <= 1 && ok; i++) for (let j = -1; j <= 1 && ok; j++) for (const q of grid.get(`${gx + i},${gz + j}`) ?? []) if ((q.x - x) ** 2 + (q.z - z) ** 2 < d * d) { ok = false; break; }
    if (!ok) continue;
    const p = { x, z }; spots.push(p); const k = `${gx},${gz}`; grid.set(k, [...(grid.get(k) ?? []), p]);
  }
  // (who gets what is decided in a fixed order so the same seed always builds the same crowd)
  const mid = spots.map((p, i) => [p, i] as const).filter(([p]) => p.z > area.z0 + 2 && p.z < area.z0 + 9).map(([, i]) => i);
  const carriers = new Set<number>(), holders = new Set<number>();
  while (carriers.size < riders && mid.length) carriers.add(mid.splice(Math.floor(rnd() * mid.length), 1)[0]);
  while (holders.size < flags && mid.length) holders.add(mid.splice(Math.floor(rnd() * mid.length), 1)[0]);

  const fans: Fan[] = [];
  const person = (x: number, z: number, o: Partial<Fan> = {}): Fan => {
    const hat = weighted<Hat>([['cap', 10], ['beanie', 9], [undefined, 81]]);
    const hair = weighted<Hair>([['short', 30], ['long', 22], ['pony', 10], ['curly', 9], ['bun', 6], ['bald', hat ? 0 : 6]]);
    const arms = weighted<{ L: ArmName; R: ArmName }>([
      [{ L: 'down', R: 'down' }, 40], [{ L: 'up', R: 'down' }, 9], [{ L: 'down', R: 'up' }, 9], [{ L: 'up', R: 'up' }, 13], [{ L: 'fist', R: 'down' }, 5], [{ L: 'down', R: 'fist' }, 6],
      [{ L: 'wave', R: 'wave' }, 5], [{ L: 'hip', R: 'down' }, 3], [{ L: 'hip', R: 'hip' }, 2], [{ L: 'phone', R: 'down' }, 4], [{ L: 'down', R: 'phone' }, 6], [{ L: 'up', R: 'phone' }, 2]]);
    const f: Fan = {
      x, z, yaw: Math.atan2(-x, -z) + (rnd() - 0.5) * 0.5, s: 0.86 + rnd() * 0.22, girth: 0.86 + Math.pow(rnd(), 2) * 0.4, phase: rnd(),
      keen: 2, h: 0.12, period: 1, off: 0, bob: 0.012 + rnd() * 0.014,
      hair, hat, shirt: Math.floor(rnd() * SHIRTS), pants: weighted<Fan['pants']>([['jeans', 70], ['shorts', 16], ['skirt', 14]]), arms, at: {}, ...o,
    };
    fans.push(f); return f;
  };
  spots.forEach((p, i) => {
    if (carriers.has(i)) {
      // (they don't jump: someone sits on their shoulders)
      const c = person(p.x, p.z, { girth: 1, s: 0.98 + rnd() * 0.08, bob: 0, arms: { L: 'carry', R: 'carry' } });
      person(p.x, p.z, { girth: 1, s: c.s * RIDER.k, phase: c.phase, bob: 0, yaw: c.yaw, carrier: fans.length - 1, arms: pick([{ L: 'up', R: 'up' }, { L: 'wave', R: 'wave' }, { L: 'down', R: 'phone' }, { L: 'fist', R: 'up' }] as const) });
      c.rider = fans.length - 1;
    } else if (holders.has(i)) person(p.x, p.z, { girth: 1, flag: true, arms: { L: 'flag', R: 'flag' } });
    else person(p.x, p.z);
  });

  // Who jumps when: friends stand together, so keenness comes in clusters (a few groups with their
  // own beat, some every other beat), plus a bit of each person. Ranked within the front third and
  // the rest so that at full energy about three in four at the front and over half further back
  // jump, and almost nobody when it's quiet. The keenest jump highest.
  const third = area.z0 + (area.z1 - area.z0) / 3;
  const groups = Array.from({ length: Math.max(1, Math.round(n / 16)) }, () => {
    const z = area.z0 + Math.pow(rnd(), 0.9) * (area.z1 - area.z0);
    return { x: (rnd() * 2 - 1) * area.spread(z), z, k: rnd(), period: rnd() < 0.25 ? 2 : 1, off: rnd() < 0.5 ? 0 : 1 };
  });
  const near = (f: Fan) => groups.reduce((a, g) => ((g.x - f.x) ** 2 + (g.z - f.z) ** 2 < (a.x - f.x) ** 2 + (a.z - f.z) ** 2 ? g : a));
  const eager = fans.map((f) => { const g = near(f), d = Math.hypot(g.x - f.x, g.z - f.z); return { f, g, e: Math.exp(-(d * d) / 4) * (0.4 + 0.6 * g.k) + 0.45 * rnd() }; });
  // the energy it takes, by rank (0: the keenest): [rank, energy] points for the front and the back
  const curve = (q: number, pts: [number, number][]) => { for (let i = 1; i < pts.length; i++) if (q <= pts[i][0]) { const [q0, k0] = pts[i - 1], [q1, k1] = pts[i]; return k0 + ((q - q0) / (q1 - q0)) * (k1 - k0); } return pts[pts.length - 1][1]; };
  // (the energy here is the crowd's excitement, 0..1: see update())
  for (const [front, pts] of [[true, [[0, 0.08], [0.1, 0.16], [0.35, 0.34], [0.82, 0.74], [0.86, 1.05], [1, 1.6]]], [false, [[0, 0.14], [0.05, 0.26], [0.25, 0.5], [0.6, 0.8], [0.65, 1.1], [1, 1.8]]]] as const) {
    const list = eager.filter((x) => x.f.carrier === undefined && x.f.rider === undefined && (x.f.z < third) === front).sort((a, b) => b.e - a.e);
    list.forEach((x, i) => {
      const q = list.length > 1 ? i / (list.length - 1) : 0, f = x.f;
      f.keen = curve(q, pts as unknown as [number, number][]);
      f.h = 0.12 + 0.13 * Math.max(0, 1 - q / 0.6) * (0.6 + 0.4 * rnd());
      const own = Math.hypot(x.g.x - f.x, x.g.z - f.z) > 2.5 && rnd() < 0.5;
      f.period = own ? (rnd() < 0.2 ? 2 : 1) : x.g.period;
      f.off = (own ? (f.period === 2 && rnd() < 0.5 ? 1 : 0) : x.g.off) + (rnd() - 0.5) * 0.06;
    });
  }

  // ---- the parts: geometry, material, and the instances collected per part
  interface Rec { m: THREE.Matrix4; a: THREE.Color; b?: THREE.Color; c?: THREE.Color; anim: [number, number, number, number]; jump: [number, number, number, number]; cell?: number }
  const parts = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; recs: Rec[] }>();
  const part = (name: string, make: () => { geo: THREE.BufferGeometry; mat: THREE.Material }) => { let p = parts.get(name); if (!p) { p = { ...make(), recs: [] }; parts.set(name, p); } return p; };
  const put = (f: Fan, key: string, name: string, make: () => { geo: THREE.BufferGeometry; mat: THREE.Material }, r: Rec) => { const p = part(name, make); f.at[key] = [name, p.recs.length]; p.recs.push(r); };

  // the arm poses (the left arm; the right one is the same mirrored), wrists in the person's space
  const SL = V(SHOULDER.x, SHOULDER.y, SHOULDER.z);
  // (W2: where the wrist goes at the top of a jump: raised arms reach up, hanging ones swing out)
  const POSES: Record<Exclude<ArmName, 'flag' | 'carry'>, { W: THREE.Vector3; W2?: THREE.Vector3; pole: THREE.Vector3; fist?: boolean; motion: 0 | 1 | 2; turnX: boolean; amp: number }> = {
    down: { W: V(0.255, 0.9, 0.07), W2: V(0.33, 1.0, -0.02), pole: V(0.3, 0, -1), motion: 1, turnX: true, amp: 0.05 },
    hip: { W: V(0.215, 1.04, 0.03), pole: V(1, 0, -0.25), motion: 1, turnX: true, amp: 0.02 },
    up: { W: V(0.3, 1.94, 0.1), W2: V(0.25, 1.975, 0.04), pole: V(1, 0, -0.4), motion: 1, turnX: false, amp: 0.22 },
    wave: { W: V(0.52, 1.85, 0.06), W2: V(0.43, 1.94, 0.04), pole: V(0.3, -1, -0.3), motion: 1, turnX: false, amp: 0.3 },
    fist: { W: V(0.3, 1.86, 0.22), W2: V(0.27, 1.96, 0.1), pole: V(1, -0.6, -0.2), fist: true, motion: 2, turnX: true, amp: 0.35 },
    phone: { W: V(0.08, 1.78, 0.34), pole: V(1, -0.5, -0.3), motion: 1, turnX: false, amp: 0.03 },
  };
  const mir = (v: THREE.Vector3) => V(-v.x, v.y, v.z);
  const shoulder = (side: 'L' | 'R') => (side === 'L' ? SL.clone() : mir(SL));
  // a wrist that holds something at p: a hand's length back towards the shoulder (as the band's grip)
  const gripAt = (side: 'L' | 'R', p: THREE.Vector3, back = 0.075) => p.clone().addScaledVector(shoulder(side).sub(p).normalize(), back);
  const armMat = (motion: 0 | 1 | 2, turnX: boolean, reach = false, raise = false) => crowdMat(std({ roughness: 0.75 }), { motion, turnX, tones: true, reach, raise });
  const armPart = (name: ArmName, side: 'L' | 'R') => `arm:${name}:${side}`;
  const makeArm = (name: ArmName, side: 'L' | 'R') => () => {
    const S = shoulder(side);
    if (name === 'flag') {
      // both hands on the pole: the left one high (it waves the flag), the right one lower down
      const W = gripAt(side, V(POLE.x, side === 'L' ? 1.72 : 1.28, POLE.z), 0.05);
      return { geo: armGeo(S, W, side === 'L' ? V(1, -0.4, -0.3) : V(-1, -0.6, -0.2)), mat: side === 'L' ? crowdMat(std({ roughness: 0.75 }), { motion: 1, tones: true, wave: true }) : armMat(1, true) };
    }
    if (name === 'carry') {
      // holding the shins of the one on the shoulders (from the outside, at mid shin)
      const shin = riderShin(side).add(V(side === 'L' ? 0.045 : -0.045, 0, 0.025));
      return { geo: armGeo(S, gripAt(side, shin, 0.06), V(side === 'L' ? 1 : -1, -0.5, -0.3)), mat: armMat(1, true) };
    }
    const p = POSES[name], W = side === 'L' ? p.W : mir(p.W), pole = side === 'L' ? p.pole : mir(p.pole), W2 = p.W2 && (side === 'L' ? p.W2 : mir(p.W2));
    // (a hanging arm goes up on the loud parts)
    return { geo: armGeo(S, W, pole, p.fist, W2), mat: armMat(p.motion, p.turnX, !!W2, name === 'down') };
  };
  // where a rider's shin is (its middle), in its carrier's space
  function riderShin(side: 'L' | 'R') {
    const sx = side === 'L' ? 1 : -1, k = RIDER.k;
    const knee = V(sx * 0.19, 0.83, 0.38), ankle = V(sx * 0.19, 0.42, 0.4), mid = knee.lerp(ankle, 0.45);
    return V(mid.x * k, RIDER.y + mid.y * k, RIDER.z + mid.z * k);
  }

  const M = new THREE.Matrix4(), T = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = V(0, 1, 0);
  const frames: THREE.Matrix4[] = [];
  const frameOf = (f: Fan): THREE.Matrix4 => {
    if (f.carrier !== undefined) return frames[f.carrier].clone().multiply(T.makeTranslation(0, RIDER.y, RIDER.z)).multiply(new THREE.Matrix4().makeScale(RIDER.k, RIDER.k, RIDER.k));
    return new THREE.Matrix4().compose(V(f.x, 0, f.z), Q.setFromAxisAngle(Y, f.yaw), V(f.s, f.s, f.s));
  };
  const col = (h: number) => new THREE.Color(h);
  fans.forEach((f) => {
    const F = frameOf(f); frames.push(F);
    // (a rider jumps, bobs and sways with whoever carries it)
    const j = f.carrier !== undefined ? fans[f.carrier] : f;
    const anim = (amp: number): [number, number, number, number] => [f.phase, j.keen, amp, j.off];
    const jump: [number, number, number, number] = [j.h, j.period, j.bob, 0];
    const skin = col(pick(SKIN)), hairC = col(rnd() < 0.06 ? pick(DYED) : pick(HAIR));
    const band = shirtColor(f.shirt), tint = band === undefined ? col(pick(PLAINS)) : col(0xffffff).multiplyScalar(0.9 + rnd() * 0.1);
    const sleeve = band === undefined ? tint : col(band);
    const g = f.girth, gz = 0.55 + 0.45 * g;
    // the torso (its shirt's cell in the picture) and the legs, widened with the girth
    const TM = F.clone().multiply(M.makeScale(g, 1, gz));
    put(f, 'torso', 'torso', () => ({ geo: torsoGeo(), mat: crowdMat(std({ map: shirtAtlas(), roughness: 0.92 }), { atlas: [1 / SHIRT_COLS, 1 / SHIRT_ROWS] }) }),
      { m: TM, a: tint, anim: anim(0), jump, cell: f.shirt });
    const pantsC = col(f.pants === 'jeans' ? pick(JEANS) : f.pants === 'shorts' ? pick(SHORTS) : pick(SKIRTS)), shoes = col(pick(SHOES));
    const tights = f.pants === 'skirt' && rnd() < 0.5 ? col(0x151518) : skin;
    const legs = f.carrier !== undefined ? 'legs:sit' : 'legs';
    put(f, 'legs', legs, () => ({ geo: legsGeo(legs === 'legs:sit'), mat: crowdMat(std({ roughness: 0.92 }), { tones: true, legs: legs === 'legs' }) }),
      { m: TM, a: f.pants === 'skirt' ? tights : pantsC, b: f.pants === 'jeans' ? pantsC : f.pants === 'shorts' ? skin : tights, c: shoes, anim: anim(0), jump });
    if (f.pants === 'skirt') put(f, 'skirt', 'skirt', () => ({ geo: skirtGeo(), mat: crowdMat(std({ roughness: 0.9 }), {}) }), { m: TM, a: pantsC, anim: anim(0), jump });
    // the head and what's on it nod together at the neck
    const HM = F.clone().multiply(T.makeTranslation(NECK.x, NECK.y, NECK.z)), nod = 0.04 + rnd() * 0.08;
    put(f, 'head', 'head', () => ({ geo: headGeo(), mat: crowdMat(std({ map: crowdFace(), roughness: 0.6 }), { turnX: true }) }), { m: HM, a: skin, anim: anim(nod), jump });
    const hairStyle: Hair = f.hat && (f.hair === 'curly' || f.hair === 'bun') ? 'short' : f.hair;
    if (hairStyle !== 'bald') put(f, 'hair', `hair:${hairStyle}`, () => ({ geo: twoSided(hairGeo(hairStyle)), mat: crowdMat(std({ roughness: 0.8 }), { turnX: true }) }), { m: HM, a: hairC, anim: anim(nod), jump });
    if (f.hat) put(f, 'hat', `hat:${f.hat}`, () => ({ geo: hatGeo(f.hat!), mat: crowdMat(f.hat === 'beanie' ? std({ map: knit(), roughness: 1 }) : std({ roughness: 0.75 }), { turnX: true }) }), { m: HM, a: col(pick(HATS)), anim: anim(nod), jump });
    // the arms on the shoulders (further out on a wider body); what a hand holds turns with it
    const long = rnd() < 0.12;
    for (const side of ['L', 'R'] as const) {
      const name = f.arms[side], sx = side === 'L' ? 1 : -1;
      const AM = F.clone().multiply(T.makeTranslation(sx * (0.19 * g + 0.01), SHOULDER.y, SHOULDER.z));
      const amp = name === 'flag' || name === 'carry' ? 0 : POSES[name].amp * (0.6 + rnd() * 0.8);
      put(f, `arm${side}`, armPart(name, side), makeArm(name, side), { m: AM, a: sleeve, b: long ? sleeve : skin, c: skin, anim: anim(amp), jump });
      if (name === 'phone') {
        const pose = part(armPart(name, side), makeArm(name, side)).geo.userData.pose as ArmPose;
        put(f, `phone${side}`, `phone:${side}`, () => ({ geo: phoneGeo(pose), mat: crowdMat(new THREE.MeshBasicMaterial({ vertexColors: true }), { motion: 1 }) }), { m: AM, a: col(0xffffff), anim: anim(amp), jump });
      }
    }
    if (f.flag) {
      put(f, 'pole', 'pole', () => ({ geo: piece(new THREE.CylinderGeometry(0.012, 0.014, POLE.y1 - POLE.y0, 6).translate(POLE.x, (POLE.y0 + POLE.y1) / 2, POLE.z)), mat: crowdMat(std({ color: 0x9a9ca0, metalness: 0.6, roughness: 0.4 }), { pole: true }) }), { m: F, a: col(0xffffff), anim: anim(0), jump });
      // the cloth: in the person's own space, its top at the top of the pole (the shader hangs it
      // there and waves it). Most carry the band's banner, printed on both sides; the rest one of the
      // fans' own (FLAGS) in a smaller size
      const cloth = (w: number, h: number) => piece(new THREE.PlaneGeometry(w, h, 20, 6).translate(w / 2, -h / 2, 0));
      const k = Math.floor(rnd() * FLAGS);
      if (area.banner && rnd() < 0.75) {
        const w = 1.15, h = w / area.banner.aspect, map = area.banner.map;
        put(f, 'cloth', 'cloth:band', () => ({ geo: cloth(w, h), mat: crowdMat(std({ map, roughness: 0.9, side: THREE.DoubleSide }), { flag: true, flip: true }) }), { m: F, a: col(0xffffff), anim: anim(0), jump });
      } else put(f, 'cloth', 'cloth', () => ({ geo: cloth(0.9, 0.6), mat: crowdMat(std({ map: flagAtlas(), roughness: 0.9, side: THREE.DoubleSide }), { atlas: [0.5, 0.5], flag: true }) }),
        { m: F, a: col(0xffffff), anim: anim(0), jump, cell: k });
    }
  });

  // ---- one instanced mesh per part
  const group = new THREE.Group(), meshes = new Map<string, THREE.InstancedMesh>();
  for (const [name, p] of parts) {
    const k = p.recs.length, geo = p.geo;
    const mesh = new THREE.InstancedMesh(geo, p.mat, k);
    const A = new Float32Array(k * 3), B = new Float32Array(k * 3), C = new Float32Array(k * 3), anim = new Float32Array(k * 4), jump = new Float32Array(k * 4);
    p.recs.forEach((r, i) => {
      mesh.setMatrixAt(i, r.m);
      r.a.toArray(A, i * 3); (r.b ?? r.a).toArray(B, i * 3); (r.c ?? r.a).toArray(C, i * 3);
      anim.set(r.anim, i * 4); jump.set(r.jump, i * 4); if (r.cell !== undefined) jump[i * 4 + 3] = r.cell;
    });
    mesh.instanceColor = new THREE.InstancedBufferAttribute(A, 3);
    geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(anim, 4)); geo.setAttribute('aJump', new THREE.InstancedBufferAttribute(jump, 4));
    if ((p.mat.userData.part as Record<string, { value: number }>).uTones.value) { geo.setAttribute('aColB', new THREE.InstancedBufferAttribute(B, 3)); geo.setAttribute('aColC', new THREE.InstancedBufferAttribute(C, 3)); }
    // (never culled: the shader moves them, and they spread over the whole floor anyway)
    mesh.frustumCulled = false; mesh.name = `crowd ${name}`;
    group.add(mesh); meshes.set(name, mesh);
  }
  const phones = [...meshes].filter(([k]) => k.startsWith('phone:')).map(([, m]) => m.material as THREE.MeshBasicMaterial);
  const scr = new THREE.Color();
  let last: { t: number; beat: number } | undefined, lastT: number | undefined, excited = 0;
  return {
    group, count: fans.length, fans, parts: meshes, frame: (i) => frames[i].clone(), excitement: () => excited,
    update(t, beat, energy, c) {
      // the crowd's excitement from the lights' energy (what the stage hands us runs from about a
      // quarter in a quiet intro to 0.7 or more at a drop): it rises fast and calms down slower
      const dt = lastT === undefined ? 0 : Math.max(0, Math.min(0.1, t - lastT)); lastT = t;
      const want = Math.max(0, Math.min(1, (energy - EXCITE.from) / (EXCITE.to - EXCITE.from)));
      excited = dt ? excited + (want - excited) * Math.min(1, dt * (want > excited ? 4 : 1.2)) : want;
      U.uTime.value = t; U.uBeat.value = beat; U.uEnergy.value = excited;
      // how long a beat is (the jumps last their own time in seconds and land on the beat): measured
      // over half a second or more (the beat count moves in steps, not every frame)
      if (!last || beat < last.beat || t < last.t || (beat === last.beat && t - last.t > 2)) last = { t, beat };
      else if (t - last.t > 0.5 && beat > last.beat) { U.uBeatLen.value += (Math.max(0.25, Math.min(1.5, (t - last.t) / (beat - last.beat))) - U.uBeatLen.value) * 0.5; last = { t, beat }; }
      // the phones' screens show the stage: its colour, a little brighter than white light
      scr.setRGB(1, 1, 1).lerp(c, 0.55).multiplyScalar(1.5);
      for (const m of phones) m.color.copy(scr);
    },
  };
}
// (for the tests)
export const CROWD_RIDER = RIDER, CROWD_POLE = POLE, CROWD_LEG = LEG;
// how long a beat is now (seconds), as measured from the beat count (the band plays on it too)
export const crowdBeatLen = () => U.uBeatLen.value;
