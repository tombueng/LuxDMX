// Live previews of lights (the library's tiles, the gallery): each light in a small dark room,
// playing its micro show (microShow.ts), drawn with the 3D stage's own models and beams (rig.ts).
//
// One WebGL renderer for all of them (a page gets a dozen or so contexts at most): each frame it
// draws some of the previews in turn into the shared canvas and copies each picture into its tile's
// own 2D canvas. What's on the screen only, the one under the pointer first and every frame; the
// others share what time is left of the frame (fewer when the page is busy: perf/load).
// Loaded only when a preview is shown (three.js is big).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Rig, type RigFixture } from './rig';
import { rigFixtureFull } from './rigOf';
import { microShow, type MicroShow } from './microShow';
import { drawAtlas } from './gobos';
import { loadGoboFonts } from './goboFonts';
import { aimRot, HALL, pivotOf, ROOMS, showRoom, shownRoom, type Room, type V3, showWalls, wallsShown } from './geometry';
import { Particles } from './particles';
import type { Focus } from './microShow';
import { kindOf } from '../model/library';
import { load } from '../perf/load.svelte';
import type { Fixture, FixtureMode, FixtureType, Resolved } from '../model/types';

// a light, in one of its modes; `copies`: a row of them (the gallery's fans); `focus`: one thing
// shown off on its own (microShow.ts)
// `extra`: another light with it, hung over it shining at it (a wash through the fog)
export interface PreviewLight { type: FixtureType; mode?: string; copies?: number; focus?: Focus; extra?: FixtureType }
export interface PreviewHandle { set(light: PreviewLight): void; hover(on: boolean): void; destroy(): void; readonly does: string[] }

const OFF = 400;                 // metres off to the side of every room: no deck, the floor at 0
const HANG = 2.7;                // a hung light this high (low: the light big, its pool still in the picture)
// the room the previews are in, while they're drawn: no deck (the beams land on the floor at 0),
// walls far round the preview's spot (the fog stays inside a room's walls)
const ROOM: Room = { ...ROOMS.truss, deck: { x: -1, z0: -1.7, z1: -1.7 }, walls: { x: OFF + 20, z0: -8, z1: 14 }, ceiling: 7 };
interface Placed { list: RigFixture[]; m: FixtureMode | undefined; show: MicroShow; cam: { at: THREE.Vector3; from: THREE.Vector3 }; extra?: { rf: RigFixture; show: MicroShow } }
interface Slot extends Placed {
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; rig: Rig; particles?: Particles; stepped: number;
  visible: boolean; hover: boolean; last: number; phase: number; drawn: number;
}

let renderer: THREE.WebGLRenderer | null = null, scene: THREE.Scene, camera: THREE.PerspectiveCamera;
let composer: EffectComposer | null = null, bloom: UnrealBloomPass;
let goboTex: THREE.CanvasTexture | null = null;
let raf = 0, io: IntersectionObserver | null = null, lost = false, idleSince = 0;
const slots = new Map<HTMLCanvasElement, Slot>();
const spare: Rig[] = [];

function setup(): boolean {
  if (renderer) return true;
  if (lost) return false;
  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
    canvas.addEventListener('webglcontextlost', () => { lost = true; stop(); });
  } catch { lost = true; return false; }
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.setPixelRatio(1);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090d);
  camera = new THREE.PerspectiveCamera(50, 16 / 10, 0.05, 80);
  // (the floor fades into the dark: no horizon line across the picture)
  scene.fog = new THREE.Fog(0x07090d, 5, 12);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pm.dispose();
  scene.add(new THREE.HemisphereLight(0x8a96b0, 0x111114, 0.9));
  const key = new THREE.DirectionalLight(0xdfe6f5, 0.9); key.position.set(OFF - 3, 8, 6); key.target.position.set(OFF, 0, 0); scene.add(key, key.target);
  // a dark floor where the beams land (their pools and gobos show on it), fading into the dark
  const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x15181e, roughness: 0.85, metalness: 0.1 }));
  floor.position.set(OFF, -0.002, 0); scene.add(floor);
  // the gobo patterns (the symbol fonts first: until they're in, the beams have no gobos)
  void loadGoboFonts().then(() => {
    const c = document.createElement('canvas'); drawAtlas(c);
    goboTex = new THREE.CanvasTexture(c);
    goboTex.colorSpace = THREE.NoColorSpace; goboTex.generateMipmaps = true; goboTex.minFilter = THREE.LinearMipmapLinearFilter; goboTex.magFilter = THREE.LinearFilter;
    for (const s of slots.values()) s.rig.setGobos(goboTex);
  }).catch(() => {});
  // the glow round bright things, as on the 3D stage (a lens and a beam in haze glow)
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.9, 0.45, 0.55);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  io = new IntersectionObserver((es) => { for (const e of es) { const s = slots.get(e.target as HTMLCanvasElement); if (s) s.visible = e.isIntersecting; } });
  return true;
}
function stop() {
  cancelAnimationFrame(raf); raf = 0;
}
// nothing shown for a while: the graphics chip's memory goes back (it all comes again when needed)
function teardown() {
  stop(); io?.disconnect(); io = null;
  if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
  composer?.dispose(); composer = null;
  renderer = null; goboTex = null; spare.length = 0;
}

// the light as the 3D stage would draw it, put in the preview's room: hung (heads straight down,
// fixed lights tipped to the floor in front), or standing on the floor facing the camera; a row of
// them side by side, the camera back to see them all
function placed(light: PreviewLight): Placed {
  const t = light.type, m = t.modes.find((x) => x.name === light.mode) ?? t.modes[0], k = kindOf(m);
  const n = Math.max(1, Math.min(8, light.copies ?? 1));
  const one = (i: number) => rigFixtureFull({ id: `preview${i}`, name: t.model, typeId: t.id, mode: m?.name ?? '', universe: 0, address: 1, x: 0.5, y: 0.5 } as Fixture, m, k, t, HALL);
  const list = Array.from({ length: n }, (_, i) => one(i)), rf0 = list[0];
  const show = microShow(rf0, m, light.focus);
  const hung = ['spot', 'wash', 'par', 'fresnel', 'blinder', 'strobe', 'headbar'].includes(rf0.look);
  const size = rf0.size ?? (rf0.look === 'bar' ? Math.max(1, rf0.cells / 30) : rf0.look === 'winch' ? 0.5 : 0.6);
  const gap = hung ? (rf0.look === 'headbar' ? 1.4 : 0.95) : Math.max(0.9, size * 1.25);
  const xs = list.map((_, i) => OFF + (i - (n - 1) / 2) * gap);
  const wide = (n - 1) * gap;                        // how wide the row is
  if (hung) {
    list.forEach((rf, i) => {
      rf.p = { x: xs[i], y: HANG, z: 0 };
      rf.rot = k === 'mover' ? { yaw: 0, pitch: 0, roll: 180 } : aimRot(rf.p, { x: xs[i], y: 0, z: 0.35 });
    });
    const piv = pivotOf(rf0.p, rf0.rot), back = 1 + wide / 3.2;
    const at = new THREE.Vector3(OFF, rf0.look === 'headbar' ? 1.6 : 1.42, 0.4);
    return { list, m, show, cam: { at, from: at.clone().add(new THREE.Vector3(0.8 * back, (0.5 + (piv.y - HANG) * 0.2) * back, 3.35 * back)) } };
  }
  // standing: a bar, a ring or a matrix, a machine, a winch (it hangs from its box: up high)
  const winch = rf0.look === 'winch';
  const lift = rf0.shape ? size / 2 + 0.3 : winch ? HANG + 0.4 : 0;
  list.forEach((rf, i) => {
    rf.p = { x: xs[i], y: lift, z: 0 };
    rf.rot = rf.shape ? { yaw: 0, pitch: 90, roll: 0 } : rf.look === 'bar' ? { yaw: 0, pitch: 18, roll: 0 } : winch ? { yaw: 0, pitch: 0, roll: 180 } : { yaw: 0, pitch: 0, roll: 0 };
  });
  // (the machines: room above them for the flames, sparks and confetti)
  const machine = !!rf0.sfx || !!rf0.fog;
  const h = rf0.shape ? lift : rf0.look === 'bar' ? 0.3 : winch ? 1.9 : machine ? 1.3 : 0.45;
  const d = Math.max(machine ? 4.6 : winch ? 4.4 : rf0.shape ? 0.8 : 2.2, size * (rf0.shape ? 2.6 : 2.4), wide * 1.15 + 1.6 * (n > 1 ? 1 : 0));
  const at = new THREE.Vector3(OFF, h, 0);
  let extra: Placed['extra'];
  if (light.extra) {
    const xt = light.extra, xm = xt.modes[0], xk = kindOf(xm);
    const rf = rigFixtureFull({ id: 'previewX', name: xt.model, typeId: xt.id, mode: xm?.name ?? '', universe: 0, address: 1, x: 0.5, y: 0.5 } as Fixture, xm, xk, xt, HALL);
    rf.p = { x: OFF - 0.9, y: HANG + 0.6, z: -0.6 };
    rf.rot = aimRot(rf.p, { x: OFF + 0.5, y: 0.2, z: 1.2 });
    if (xk === 'mover') rf.rot = { yaw: 0, pitch: 0, roll: 180 };
    list.push(rf);
    extra = { rf, show: microShow(rf, xm, 'colour') };
  }
  return { list, m, show, extra, cam: { at, from: at.clone().add(new THREE.Vector3(0.3 * d, (machine ? 0.12 : 0.32) * d, d)) } };
}

const quat = new THREE.Quaternion(), euler = new THREE.Euler();
// the slot's picture at time t (seconds) into its own canvas
function drawAt(s: Slot, t: number, w: number, h: number) {
  if (!renderer) return;
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x !== w || size.y !== h) { renderer.setSize(w, h, false); composer?.setSize(w, h); }
  // (its walls are only where the fog stops, nothing to see: the light lands on the floor alone)
  const was = shownRoom(), walls = wallsShown(); showRoom(ROOM); showWalls(false);
  try { stage(s, t, w, h); } finally { showRoom(was); showWalls(walls); }
  // (the glow when the page has time for it; plain when it's busy. A disc or a matrix, all lit,
  // glows less: it went white)
  if (composer && load.level >= 1) { bloom.strength = s.list[0]?.shape ? 0.25 : 0.9; composer.render(); } else renderer.render(scene, camera);
  s.ctx.drawImage(renderer.domElement, 0, 0, w, h);
  s.drawn++;
}
// the lights, their values at t, and the machines' particles
function stage(s: Slot, t: number, w: number, h: number) {
  camera.aspect = w / h; camera.updateProjectionMatrix();
  camera.position.copy(s.cam.from); camera.lookAt(s.cam.at);
  for (const o of slots.values()) { o.rig.group.visible = o === s; if (o.particles) o.particles.group.visible = o === s; }
  s.rig.group.visible = true;
  const n = s.list.length - (s.extra ? 1 : 0), values: Record<string, Resolved> = {};
  s.list.forEach((f, i) => { values[f.id] = s.extra?.rf === f ? s.extra.show.at(t) : s.show.at(t, i, n); });
  // (a head over a machine points at it)
  if (s.extra && s.extra.rf.kind === 'mover') { const v = values[s.extra.rf.id]; v.pan = 0.62; v.tilt = 0.7; }
  if (s.extra) values[s.extra.rf.id].intensity = 0.5;     // (through fog: half is plenty)
  // (thick haze: the beams show in a small picture; a spot's narrow beam needs more)
  s.rig.update(values, t, s.list[0]?.look === 'spot' ? 4 : 2.6, new Set());
  // the machines: their flames, sparks, confetti and fog, on the show's clock (in steps of 0.1 s)
  if (s.particles) {
    s.particles.group.visible = true;
    const machines = s.list.filter((f) => f.sfx || f.fog).map((f) => {
      const v = values[f.id] as Record<string, number | undefined>;
      if (f.sfx) return { e: { id: `${f.id}:${f.sfx}`, kind: f.sfx, x: f.p.x, y: f.p.y, z: f.p.z }, v: v[f.sfx] ?? 0 };
      const fr = new THREE.Vector3(0, 0, 1).applyQuaternion(quat.setFromEuler(euler.set(f.rot.pitch * Math.PI / 180, f.rot.yaw * Math.PI / 180, f.rot.roll * Math.PI / 180, 'YXZ')));
      return { e: { id: `${f.id}:fog`, kind: 'fog' as const, x: f.p.x, y: f.p.y, z: f.p.z, dir: { x: fr.x, y: fr.y, z: fr.z }, haze: f.hazer }, v: Math.max(v.fog ?? 0, v.haze ?? 0) };
    });
    let dt = Math.max(0, Math.min(1, t - s.stepped));
    if (!s.stepped) dt = 0.05;
    s.stepped = t;
    for (; dt > 1e-4; dt -= 0.1) s.particles.step(Math.min(0.1, dt), machines);
    s.particles.light(s.rig.lit);
    s.particles.ambient(1.2, 1.2, 1.3);   // (fog with no light through it: grey enough to see)
    s.particles.setScale(h * 0.9);
  }
}
function draw(s: Slot, now: number) {
  const w = s.canvas.width, h = s.canvas.height;
  if (!w || !h) return;
  drawAt(s, now / 1000 + s.phase, w, h);
  s.last = now;
}

function frame() {
  raf = requestAnimationFrame(frame);
  if (!renderer || document.hidden) return;
  const now = performance.now();
  const shown = [...slots.values()].filter((s) => s.visible && s.canvas.isConnected);
  if (!shown.length) { if (now - idleSince > 30000 && !slots.size) teardown(); return; }
  idleSince = now;
  // the one under the pointer every frame; the rest the longest-waiting first, as time allows
  const budget = load.level >= 2 ? 6 : load.level === 1 ? 3.5 : 1.8;
  const t0 = performance.now();
  shown.sort((a, b) => (b.hover ? 1 : 0) - (a.hover ? 1 : 0) || a.last - b.last);
  for (const s of shown) {
    if (!s.hover && performance.now() - t0 > budget) break;
    if (!s.hover && now - s.last < 1000 / 30) continue;     // (never more than 30 a second)
    draw(s, now);
  }
  load.did(performance.now() - t0);
}

function slotFor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, light: PreviewLight): Slot {
  const p = placed(light);
  const rig = spare.pop() ?? new Rig();
  scene.add(rig.group);
  if (goboTex) rig.setGobos(goboTex);
  rig.build(p.list);
  const s: Slot = { ...p, canvas, ctx, rig, stepped: 0, visible: false, hover: false, last: 0, phase: Math.random() * 8, drawn: 0 };
  machinesOf(s);
  return s;
}
// a machine's flames, confetti or fog: their own particles (made when the slot shows a machine)
function machinesOf(s: Slot) {
  const want = s.list.some((f) => f.sfx || f.fog);
  if (want && !s.particles) { s.particles = new Particles(); scene.add(s.particles.group); }
  if (!want && s.particles) { scene.remove(s.particles.group); s.particles = undefined; }
  s.stepped = 0;
}
function free(s: Slot) {
  scene?.remove(s.rig.group); if (spare.length < 48) spare.push(s.rig);
  if (s.particles) scene?.remove(s.particles.group);
}

// A canvas showing a light: its micro show, live while it's on the screen.
export function preview(canvas: HTMLCanvasElement, light: PreviewLight): PreviewHandle {
  const none: PreviewHandle = { set() {}, hover() {}, destroy() {}, does: [] };
  if (!setup()) return none;
  const ctx = canvas.getContext('2d');
  if (!ctx) return none;
  const s = slotFor(canvas, ctx, light);
  slots.set(canvas, s);
  io?.observe(canvas);
  if (!raf) raf = requestAnimationFrame(frame);
  return {
    get does() { return s.show.does; },
    set(l) { Object.assign(s, placed(l)); s.rig.build(s.list); machinesOf(s); s.last = 0; },
    hover(on) { s.hover = on; },
    destroy() {
      io?.unobserve(canvas); slots.delete(canvas); free(s);
      idleSince = performance.now();
    },
  };
}

// A light's micro show as pictures (the gallery's GIFs, the tests): n frames at fps, w x h, from
// the start of its show, as PNG data URLs.
export async function frames(light: PreviewLight, o: { w: number; h: number; n: number; fps: number; from?: number }): Promise<string[]> {
  if (!setup()) return [];
  await loadGoboFonts().catch(() => {});
  for (let i = 0; i < 20 && !goboTex; i++) await new Promise((r) => setTimeout(r, 50));
  const canvas = document.createElement('canvas'); canvas.width = o.w; canvas.height = o.h;
  const s = slotFor(canvas, canvas.getContext('2d')!, light);
  const out: string[] = [];
  try {
    // (a second to settle first: the heads swing to where they start, the fog comes)
    const t0 = o.from ?? 0;
    for (let k = -Math.round(o.fps); k < o.n; k++) {
      drawAt(s, t0 + k / o.fps, o.w, o.h);
      if (k >= 0) out.push(canvas.toDataURL('image/png'));
      if ((k & 7) === 7) await new Promise((r) => setTimeout(r, 0));
    }
  } finally { free(s); }
  return out;
}

// (for the tests and the QA tools: how many previews there are and how often each was drawn)
export const previewStats = () => ({ slots: slots.size, live: !!renderer, lost, drawn: [...slots.values()].map((s) => s.drawn) });
export const _place = (light: PreviewLight): { look: string; p: V3 }[] => placed(light).list.map((rf) => ({ look: rf.look, p: rf.p }));
if (import.meta.env.DEV) Object.assign(globalThis, { __previews: previewStats, __previewFrames: frames });
