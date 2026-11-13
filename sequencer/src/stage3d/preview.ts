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
import { Rig, type RigFixture } from './rig';
import { rigFixtureFull } from './rigOf';
import { microShow, type MicroShow } from './microShow';
import { drawAtlas } from './gobos';
import { loadGoboFonts } from './goboFonts';
import { aimRot, HALL, pivotOf, type V3 } from './geometry';
import { kindOf } from '../model/library';
import { load } from '../perf/load.svelte';
import type { Fixture, FixtureMode, FixtureType } from '../model/types';

export interface PreviewLight { type: FixtureType; mode?: string }
export interface PreviewHandle { set(light: PreviewLight): void; hover(on: boolean): void; destroy(): void; readonly does: string[] }

const OFF = 400;                 // metres off to the side of every room: no deck, the floor at 0
const HANG = 2.7;                // a hung light this high (low: the light big, its pool still in the picture)
interface Slot {
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; rig: Rig; rf: RigFixture; show: MicroShow;
  cam: { at: THREE.Vector3; from: THREE.Vector3 }; visible: boolean; hover: boolean; last: number; phase: number; drawn: number;
}

let renderer: THREE.WebGLRenderer | null = null, scene: THREE.Scene, camera: THREE.PerspectiveCamera;
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
  renderer = null; goboTex = null; spare.length = 0;
}

// the light as the 3D stage would draw it, put in the preview's room: hung from the pipe, or
// standing on the floor facing the camera
function placed(light: PreviewLight): { rf: RigFixture; m: FixtureMode | undefined; cam: Slot['cam'] } {
  const t = light.type, m = t.modes.find((x) => x.name === light.mode) ?? t.modes[0], k = kindOf(m);
  const f = { id: 'preview', name: t.model, typeId: t.id, mode: m?.name ?? '', universe: 0, address: 1, x: 0.5, y: 0.5 } as Fixture;
  const rf = rigFixtureFull(f, m, k, t, HALL);
  const hung = rf.look === 'spot' || rf.look === 'wash' || rf.look === 'par' || rf.look === 'fresnel' || rf.look === 'blinder' || rf.look === 'strobe' || rf.look === 'headbar';
  if (hung) {
    rf.p = { x: OFF, y: HANG, z: 0 };
    // heads hang straight down; a fixed light tips to the floor in front of it
    rf.rot = k === 'mover' ? { yaw: 0, pitch: 0, roll: 180 } : aimRot(rf.p, { x: OFF, y: 0, z: 0.35 });
    const piv = pivotOf(rf.p, rf.rot);
    const at = new THREE.Vector3(OFF, rf.look === 'headbar' ? 1.6 : 1.42, 0.4);
    return { rf, m, cam: { at, from: at.clone().add(new THREE.Vector3(0.8, 0.5 + (piv.y - HANG) * 0.2, 3.35)) } };
  }
  // standing: a bar, a ring or a matrix, a machine
  const size = rf.size ?? (rf.look === 'bar' ? Math.max(1, rf.cells / 30) : 0.6);
  const lift = rf.shape ? size / 2 + 0.3 : 0;
  rf.p = { x: OFF, y: lift, z: 0 };
  rf.rot = rf.shape ? { yaw: 0, pitch: 90, roll: 0 } : rf.look === 'bar' ? { yaw: 0, pitch: 60, roll: 0 } : rf.look === 'fog' ? { yaw: 0, pitch: 0, roll: 0 } : { yaw: 0, pitch: 0, roll: 0 };
  const h = rf.shape ? lift : rf.look === 'bar' ? 0.3 : 0.45;
  const at = new THREE.Vector3(OFF, h, 0), d = Math.max(2.2, size * 2.4);
  return { rf, m, cam: { at, from: at.clone().add(new THREE.Vector3(0.35 * d, 0.32 * d, d)) } };
}

function draw(s: Slot, now: number) {
  if (!renderer) return;
  const w = s.canvas.width, h = s.canvas.height;
  if (!w || !h) return;
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x !== w || size.y !== h) { renderer.setSize(w, h, false); }
  camera.aspect = w / h; camera.updateProjectionMatrix();
  camera.position.copy(s.cam.from); camera.lookAt(s.cam.at);
  for (const o of slots.values()) o.rig.group.visible = o === s;
  const t = now / 1000 + s.phase;
  s.rig.update({ preview: s.show.at(t) }, t, 2.6, new Set());   // (thick haze: the beams show in a small picture)
  renderer.render(scene, camera);
  s.ctx.drawImage(renderer.domElement, 0, 0, w, h);
  s.last = now; s.drawn++;
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

// A canvas showing a light: its micro show, live while it's on the screen.
export function preview(canvas: HTMLCanvasElement, light: PreviewLight): PreviewHandle {
  const none: PreviewHandle = { set() {}, hover() {}, destroy() {}, does: [] };
  if (!setup()) return none;
  const ctx = canvas.getContext('2d');
  if (!ctx) return none;
  let { rf, m, cam } = placed(light);
  const rig = spare.pop() ?? new Rig();
  scene.add(rig.group);
  if (goboTex) rig.setGobos(goboTex);
  rig.build([rf]);
  const s: Slot = { canvas, ctx, rig, rf, show: microShow(rf, m), cam, visible: false, hover: false, last: 0, phase: Math.random() * 8, drawn: 0 };
  slots.set(canvas, s);
  io?.observe(canvas);
  if (!raf) raf = requestAnimationFrame(frame);
  return {
    get does() { return s.show.does; },
    set(l) { ({ rf, m, cam } = placed(l)); s.rf = rf; s.cam = cam; s.show = microShow(rf, m); rig.build([rf]); s.last = 0; },
    hover(on) { s.hover = on; },
    destroy() {
      io?.unobserve(canvas); slots.delete(canvas);
      scene?.remove(rig.group); if (spare.length < 48) spare.push(rig);
      idleSince = performance.now();
    },
  };
}

// (for the tests and the QA tools: how many previews there are and how often each was drawn)
export const previewStats = () => ({ slots: slots.size, live: !!renderer, lost, drawn: [...slots.values()].map((s) => s.drawn) });
export const _place = (light: PreviewLight): { look: string; p: V3 } => { const { rf } = placed(light); return { look: rf.look, p: rf.p }; };
if (import.meta.env.DEV) (globalThis as unknown as { __previews: typeof previewStats }).__previews = previewStats;
