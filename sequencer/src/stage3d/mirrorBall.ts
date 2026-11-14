// A mirror ball at work: its own mirrors (a sphere of small tiles, sparkling where a light hits it),
// and what it throws: every tile that faces a light hitting the ball reflects that light, a dot
// where the reflected ray meets the room (walls, ceiling, floor: hitRoom), and in haze a thin ray
// from the ball to it. The ball turns (the scene spins it), so the dots sweep round the room.
//
// Which lights hit it: a beam whose cone takes in the ball (the pinspots aimed at it), by how much
// of the ball it covers. Each tile is a fixed normal on the ball, turned with it: its reflection of
// a light coming in along d is d - 2 (d . n) n, when the tile faces the light.
import * as THREE from 'three';
import { hitRoom, type Room } from './geometry';
import type { Lit } from './rig';

export const BALL_TILES = 260;
const MAX_DOTS = 600;            // (two or three lights on a ball, each throwing its half of the tiles)

// the ball's tiles: their normals evenly over the sphere (a Fibonacci spiral)
const TILES: THREE.Vector3[] = Array.from({ length: BALL_TILES }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / BALL_TILES, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
  return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
});

// The mirrors on the ball: a texture of small square tiles, the grout dark between them
export function mirrorTiles(): THREE.Texture | null {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#202226'; g.fillRect(0, 0, 256, 128);
  let s = 3;
  for (let y = 0; y < 128; y += 8) for (let x = 0; x < 256; x += 8) {
    s = (s * 16807) % 2147483647; const v = 170 + (s % 80);
    g.fillStyle = `rgb(${v},${v},${v + 6})`; g.fillRect(x + 1, y + 1, 6, 6);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// a mirror ball: a sphere of small mirror tiles, sparkling a little in any light (rig light makes it
// sparkle more: Stage3D). A room's own ball turns at BALL_SPIN radians a second (about five turns a
// minute); one on a DMX motor as its channel says (rig.ts).
export const BALL_SPIN = 0.5;
export function mirrorBall(r: number) {
  const tex = mirrorTiles();
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 18), new THREE.MeshStandardMaterial({ color: 0xe8ecf2, map: tex ?? undefined, metalness: 0.9, roughness: 0.18, flatShading: true, emissive: 0xffffff, emissiveMap: tex ?? undefined, emissiveIntensity: 0.12 }));
  m.name = 'mirror ball'; m.userData.live = true;
  return m;
}

export interface Ball { obj: THREE.Object3D; r: number; holder?: THREE.Object3D }

// A mirror ball never hangs dead still: on its chain it sways a little and twists back and forth a
// few degrees, and its motor, when it runs, turns it round on top of that. `speed`: the motor's
// radians a second (0: stopped). Called every frame with the time in seconds.
export function ballMotion(o: THREE.Object3D, t: number, speed: number) {
  const u = o.userData as { spun?: number; at?: number };
  const dt = u.at === undefined ? 0 : Math.min(0.1, Math.max(0, t - u.at));
  u.at = t; u.spun = ((u.spun ?? 0) + speed * dt) % (Math.PI * 2);
  o.rotation.set(0.02 * Math.sin(t * 0.43), u.spun + 0.07 * Math.sin(t * 0.31) + 0.03 * Math.sin(t * 0.77 + 1), 0.016 * Math.sin(t * 0.57 + 2));
}
export class MirrorDots {
  readonly group = new THREE.Group();
  private dots: THREE.InstancedMesh;
  private rays: THREE.InstancedMesh;
  private rayMat: THREE.MeshBasicMaterial;
  // what each ball got this frame (for the tests and the ball's sparkle): its light's level
  lastHit: number[] = [];
  lastDots = 0;
  constructor() {
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3 });
    this.dots = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 10), dotMat, MAX_DOTS);
    this.rayMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.15, depthWrite: false, blending: THREE.AdditiveBlending });
    this.rays = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 4, 1, true).translate(0, 0.5, 0), this.rayMat, MAX_DOTS);
    for (const m of [this.dots, this.rays]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, new THREE.Color(0)); this.group.add(m); }
    this.group.name = 'mirror dots'; this.group.userData.dots = this;
  }

  // every frame: the balls as the scene has them now (turned), the lights that are on, the room
  update(balls: Ball[], lit: readonly Lit[], room: Room, haze: number) {
    let n = 0;
    this.lastHit = [];
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), N = new THREE.Vector3(), R = new THREE.Vector3(), C = new THREE.Color();
    const UP = new THREE.Vector3(0, 0, 1), FACE = new THREE.Quaternion(), YUP = new THREE.Vector3(0, 1, 0), OUT = new THREE.Vector3(), SZ = new THREE.Vector3(), centre = new THREE.Vector3(), turn = new THREE.Quaternion();
    for (const b of balls) {
      b.obj.updateWorldMatrix(true, false);
      centre.setFromMatrixPosition(b.obj.matrixWorld); turn.setFromRotationMatrix(b.obj.matrixWorld);
      let got = 0;
      for (const l of lit) {
        // (how much of the ball the beam takes in: the ball's distance from its axis against the
        // cone's radius there)
        const to = P.copy(centre).sub(l.p), along = to.dot(l.d);
        if (along <= 0.2) continue;
        const off = to.addScaledVector(l.d, -along).length(), radius = along * Math.tan((Math.max(1, l.deg) / 2) * Math.PI / 180) + b.r;
        if (off > radius) continue;
        const take = l.level * Math.min(1, (b.r * b.r * 4) / (radius * radius) + 0.35) * (1 - off / radius * 0.5);
        if (take < 0.01) continue;
        got = Math.max(got, l.level);
        const din = R.copy(centre).sub(l.p).normalize();
        for (const t0 of TILES) {
          if (n >= MAX_DOTS) break;
          const tn = N.copy(t0).applyQuaternion(turn);
          const dn = din.dot(tn);
          if (dn >= -0.05) continue;                                   // (faces away from the light)
          const out = OUT.copy(din).addScaledVector(tn, -2 * dn).normalize();
          const from = P.copy(centre).addScaledVector(tn, b.r);
          const h = hitRoom({ x: from.x, y: from.y, z: from.z }, { x: out.x, y: out.y, z: out.z }, room);
          if (!h) continue;
          const dist = Math.hypot(h.x - from.x, h.y - from.y, h.z - from.z);
          // a dot: facing out of the surface it's on, bigger the further it's thrown
          const size = 0.03 + dist * 0.011;
          FACE.setFromUnitVectors(UP, N.set(h.n.x, h.n.y, h.n.z));
          M.compose(S.set(h.x + h.n.x * 0.01, h.y + h.n.y * 0.01, h.z + h.n.z * 0.01), FACE, SZ.set(size, size, size));
          this.dots.setMatrixAt(n, M);
          this.dots.setColorAt(n, C.copy(l.c).multiplyScalar(Math.min(1.6, take * 1.8)));
          // its ray through the haze, from the tile to the dot
          Q.setFromUnitVectors(YUP, out);
          M.compose(from, Q, S.set(0.003 + dist * 0.0005, dist, 0.003 + dist * 0.0005));
          this.rays.setMatrixAt(n, M);
          this.rays.setColorAt(n, C.copy(l.c).multiplyScalar(Math.min(1, take)));
          n++;
        }
      }
      this.lastHit.push(got);
      // (the ball itself sparkles with the light on it)
      const mat = (b.obj as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (mat && 'emissiveIntensity' in mat) mat.emissiveIntensity = 0.12 + got * 1.3;
    }
    this.lastDots = n;
    this.dots.count = n; this.rays.count = n;
    // (thin rays that only show in haze: a whiff of them without, clearer the hazier it is)
    this.rayMat.opacity = Math.min(0.2, 0.008 + haze * 0.07);
    for (const m of [this.dots, this.rays]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
  dispose() { for (const m of [this.dots, this.rays]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } }
}
