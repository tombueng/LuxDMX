// The rooms that come with the demos (geometry.ts ROOMS): a club (the DJ on a stage framed by truss
// on four towers, a truss over the dance floor, a speaker stack either side, a bar at the back, a
// mirror ball), a party room (no stage: a square of truss over the crowd on four legs, a speaker
// stack in each corner, the DJ's table on the floor) and an empty room with one straight truss for
// trying lights out (a table with the laptop at the side, a few cases). The truss is built from the
// room's list of pieces (`frame`), so lights placed on it in a show sit on it here. The crowd is the
// same crowd as the hall's (crowd.ts: smaller, no flags), the DJ the one in dj.ts. Built once, then
// everything that never moves is baked (gear.ts), as the hall is.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { D, DECK, DJ_BOOTH, ROOMS, type Room, type RoomId, type Seg } from './geometry';
import { at, bake, box, cyl, gearMats, movingMeshes, roadCase, std, waterCrate, type Mats, house } from './gear';
import { concrete, exitSign, hallWall, neonSign, pleats, roofDeck, screen, stageFloor } from './textures';
import { buildCrowd, type Crowd } from './crowd';
import { beatClock, djBooth, djPerson } from './dj';
import type { Person } from './people';

// What the 3D stage needs of any room (the hall's and the pub's venue has more: the band).
export interface Stage {
  group: THREE.Group; room: RoomId; crowdCount: number;
  // (music: whether any is playing: without it the band or the DJ stands still, not miming)
  animate: (t: number, beat: number, energy: number, col: THREE.Color, music?: boolean) => void;
  // the act's name where the room shows one (the DJ booth's front); what each such picture shows now
  setBand: (name?: string) => void;
  bandInfo: () => { name: string; surfaces: { what: string; shows: string; uuid: string; version: number }[] };
  // what the baking did: meshes merged, the meshes they became, their vertices
  baked: { meshes: number; batches: number; verts: number };
  crowd?: Crowd;
  // the LED screens' (and TVs') material, where the room has them: its picture is the painted one
  // (`painted`) unless the 3D view puts the live camera on it
  screens?: { mat: THREE.MeshBasicMaterial; painted: THREE.Texture };
  // the DJ (for the tests): the person, how far the left hand is up, the booth (the person's parent)
  dj?: { p: Person; raised: () => number; booth: THREE.Object3D };
}
export type DemoRoom = 'club' | 'party' | 'truss';
export const isDemoRoom = (r: unknown): r is DemoRoom => r === 'club' || r === 'party' || r === 'truss';

// Is WebGL drawn in software here (no graphics chip: SwiftShader, llvmpipe)? Hundreds of people cost
// a second a frame there.
export function softwareGL() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info'), name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|software/i.test(name);
  } catch { return false; }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
const P3 = (p: [number, number, number]) => V(p[0], p[1], p[2]);

// A piece of 0.3 m box truss along its middle line: four chords, zigzag lacing on each face,
// couplers every 3 m (one mesh)
export function trussPiece(seg: Seg, m: THREE.Material, size = 0.3) {
  const a = P3(seg[0]), b = P3(seg[1]), dir = b.clone().sub(a), L = dir.length(), s = size / 2, parts: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[-s, -s], [s, -s], [s, s], [-s, s]]) parts.push(new THREE.CylinderGeometry(0.025, 0.025, L, 8).translate(x, L / 2, z));
  const n = Math.max(1, Math.round(L / size));
  for (let i = 0; i < n; i++) {
    const y0 = (i / n) * L, y1 = ((i + 1) / n) * L;
    for (const [x0, z0, x1, z1] of [[-s, -s, s, -s], [s, -s, s, s], [s, s, -s, s], [-s, s, -s, -s]]) {
      const from = V(i % 2 ? x0 : x1, y0, i % 2 ? z0 : z1), to = V(i % 2 ? x1 : x0, y1, i % 2 ? z1 : z0);
      const d = new THREE.CylinderGeometry(0.011, 0.011, from.distanceTo(to), 5);
      d.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), to.clone().sub(from).normalize()));
      parts.push(d.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2));
    }
  }
  for (let y = 0; y <= L; y += 3) parts.push(new THREE.BoxGeometry(size + 0.03, 0.03, size + 0.03).translate(0, Math.min(L, y), 0));
  const mesh = new THREE.Mesh(merge(parts), m);
  mesh.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize()); mesh.position.copy(a);
  return mesh;
}

// A speaker stack: subs on the floor, a top on them, the grilles to the front (+z)
function paStack(M: Mats, subs = 2) {
  const g = new THREE.Group(), cab = [M.tolex, M.tolex, M.tolex, M.tolex, M.grille, M.tolex];
  for (let k = 0; k < subs; k++) {
    g.add(at(new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.6, 0.8, 2, 0.02), cab), 0, 0.3 + k * 0.61, 0));
    g.add(at(box(0.14, 0.03, 0.004, M.piping), -0.34, 0.06 + k * 0.61, 0.402));
  }
  const top = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.95, 0.5, 2, 0.02), cab); top.rotation.x = -0.08;
  g.add(at(top, 0, subs * 0.61 + 0.48, 0.05));
  return g;
}

// The walls (facing in, unlit as the hall's are: the colour stands in for the house light), the floor
// and the ceiling on steel beams (out of the way when the camera looks down from above)
function shell(group: THREE.Group, M: Mats, r: Room, o: { wall: THREE.Material; su: number; sv: number; floor: THREE.Material; ceiling: THREE.Material; tile?: number }) {
  const { x: X, z0: Z0, z1: Z1 } = r.walls, H = r.ceiling, L = Z1 - Z0, zc = (Z0 + Z1) / 2;
  const wall = (w: number, h: number, m: THREE.Material, su: number, sv: number) => {
    const p = new THREE.PlaneGeometry(w, h), uv = p.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / su, uv.getY(i) * h / sv);
    return new THREE.Mesh(p, m);
  };
  group.add(at(wall(L, H, o.wall, o.su, o.sv), -X, H / 2, zc, [0, Math.PI / 2, 0]), at(wall(L, H, o.wall, o.su, o.sv), X, H / 2, zc, [0, -Math.PI / 2, 0]));
  group.add(at(wall(2 * X, H, o.wall, o.su, o.sv), 0, H / 2, Z0), at(wall(2 * X, H, o.wall, o.su, o.sv), 0, H / 2, Z1, [0, Math.PI, 0]));
  group.add(at(wall(2 * X, L, o.ceiling, 4, 4), 0, H, zc, [Math.PI / 2, 0, 0]));
  const t = o.tile ?? 10;
  group.add(at(wall(2 * X, L, o.floor, t, t), 0, 0, zc, [-Math.PI / 2, 0, 0]));
  const steel = std({ color: 0x2a2d33, metalness: 0.6, roughness: 0.55 }); steel.userData.hideAbove = H - 0.6;
  for (let z = Z0 + 3; z < Z1; z += 5) group.add(at(box(2 * X, 0.4, 0.2, steel), 0, H - 0.2, z));
  // a door out with its exit sign, on each side wall
  const exit = new THREE.MeshBasicMaterial({ map: exitSign(), toneMapped: false }), door = std({ color: 0x23262b, metalness: 0.5, roughness: 0.5 });
  for (const sx of [-1, 1]) {
    const d = new THREE.Group();
    d.add(at(box(1.8, 2.2, 0.05, door), 0, 1.1, 0.03), at(box(1.4, 0.05, 0.05, M.chrome), 0, 1.0, 0.08), at(box(0.62, 0.32, 0.06, M.plastic), 0, 2.55, 0.03));
    d.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.28), exit), 0, 2.55, 0.062));
    d.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2; group.add(at(d, sx * X, 0, Z1 - 4));
  }
}

// Every piece of the room's truss, a base plate under each tower, chain hoists up to the ceiling for
// a span that hangs (one with no tower under its ends)
function frame(group: THREE.Group, M: Mats, r: Room) {
  const segs = r.frame ?? [], up = (s: Seg) => Math.abs(s[0][0] - s[1][0]) < 1e-6 && Math.abs(s[0][2] - s[1][2]) < 1e-6;
  for (const s of segs) group.add(trussPiece(s, M.alu));
  for (const s of segs.filter(up)) group.add(at(box(0.8, 0.05, 0.8, M.alu), s[0][0], 0.025, s[0][2]));
  const feet = segs.filter(up).map((s) => s[0]);
  for (const s of segs.filter((x) => !up(x) && Math.abs(x[0][2] - x[1][2]) < 1e-6)) {
    const z = s[0][2], x0 = Math.min(s[0][0], s[1][0]), x1 = Math.max(s[0][0], s[1][0]);
    if (feet.some((f) => Math.abs(f[2] - z) < 1e-6)) continue;
    for (const x of [x0 + (x1 - x0) * 0.25, x0 + (x1 - x0) * 0.75]) {
      const y = s[0][1] + 0.15, H = r.ceiling;
      group.add(at(cyl(0.11, 0.11, 0.3, M.black), x, y + 0.3, z), at(cyl(0.012, 0.012, H - y - 0.45, M.chrome, 5), x, (H + y + 0.45) / 2, z));
    }
  }
}

export function buildRoom(id: DemoRoom, o: { crowd?: number; band?: string } = {}): Stage {
  const r = ROOMS[id], M = gearMats(), group = new THREE.Group();
  const soft = softwareGL();
  let crowd: Crowd | undefined, dj: Stage['dj'];
  let booth: ReturnType<typeof djBooth> | undefined, boothName = '', boothShows = '';
  let djPlay: ((b: number, e: number) => void) | undefined;
  const DEFAULT = id === 'club' ? 'CLUB NIGHT' : 'HOUSE PARTY';

  if (id === 'club') {
    shell(group, M, r, { wall: house(new THREE.MeshBasicMaterial({ map: hallWall(), color: 0x4a4a52 })), su: 6.4, sv: 3.2, floor: std({ map: concrete(), color: 0x8a8a90, roughness: 0.7 }), ceiling: house(new THREE.MeshBasicMaterial({ color: 0x0b0b0d })) });
    // the deck across the room's end (black sides, the pixel line on its front), steps up at the side
    const { x: dx, z0, z1 } = r.deck, dd = z1 - z0;
    const deckGeo = new THREE.BoxGeometry(2 * dx, DECK, dd);
    { const uv = deckGeo.attributes.uv; for (const [f, len] of [[0, dd], [1, dd], [5, 2 * dx]] as const) for (let i = f * 4; i < f * 4 + 4; i++) uv.setX(i, uv.getX(i) * len / 1.9); }
    const drape = std({ map: pleats(), roughness: 1 });
    group.add(at(new THREE.Mesh(deckGeo, [drape, drape, std({ map: stageFloor(), roughness: 0.72 }), M.black, M.black, drape]), 0, DECK / 2, (z0 + z1) / 2)).name = 'deck';
    for (let i = 0; i < 3; i++) { const h = (DECK / 4) * (3 - i); group.add(at(box(0.3, h, 0.9, [M.black, M.black, std({ map: stageFloor(), roughness: 0.72 }), M.black, M.black, M.black]), -dx - 0.15 - i * 0.3, h / 2, 2.2)); }
    // black drapes behind the pixel wall, from the deck up to the back truss
    const back = new THREE.PlaneGeometry(2 * dx, 6, 48, 2);
    { const p = back.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 2.4) * 0.04); back.computeVertexNormals(); }
    group.add(at(new THREE.Mesh(back, drape), 0, DECK + 3, z0 + 0.05));
    frame(group, M, r);
    // the PA: a stack either side of the stage, turned in towards the dance floor
    for (const sx of [-1, 1]) { const pa = paStack(M); pa.rotation.y = -sx * 0.3; group.add(at(pa, sx * 8.1, 0, D / 2 - 0.1)); }
    // the bar at the back: the counter, a lit shelf behind it, a neon sign, stools
    const bz = r.walls.z1 - 1.9, wood = std({ color: 0x1c1a1a, roughness: 0.4 }), strip = new THREE.MeshBasicMaterial({ color: 0x40c8ff, toneMapped: false });
    group.add(at(box(10, 1.05, 0.6, wood), -2.5, 0.525, bz), at(box(10.1, 0.05, 0.75, M.steel), -2.5, 1.07, bz - 0.05), at(box(10, 0.02, 0.02, strip), -2.5, 0.15, bz - 0.31));
    group.add(at(box(9, 0.04, 0.3, wood), -2.5, 1.6, r.walls.z1 - 0.2), at(box(9, 0.012, 0.02, strip), -2.5, 1.575, r.walls.z1 - 0.06));
    group.add(at(new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: neonSign('Bar', '#36d6e7'), toneMapped: false })), -2.5, 2.9, r.walls.z1 - 0.03, [0, Math.PI, 0]));
    for (let i = 0; i < 7; i++) { const x = -6.8 + i * 1.4; group.add(at(cyl(0.18, 0.16, 0.05, M.black, 14), x, 0.78, bz - 0.7), at(cyl(0.025, 0.025, 0.76, M.steel, 8), x, 0.38, bz - 0.7), at(cyl(0.2, 0.22, 0.02, M.steel, 14), x, 0.01, bz - 0.7)); }
    // a mirror ball over the dance floor
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.32, 18, 12), std({ color: 0xe8ecf2, metalness: 1, roughness: 0.08, flatShading: true }));
    group.add(at(ball, 0, r.ceiling - 1.1, 12), at(cyl(0.008, 0.008, 0.78, M.chrome, 5), 0, r.ceiling - 0.39, 12));
  } else if (id === 'party') {
    shell(group, M, r, { wall: house(new THREE.MeshBasicMaterial({ map: hallWall(), color: 0x9a9aa0 })), su: 6.4, sv: 3.2, floor: std({ map: concrete(), roughness: 0.85 }), ceiling: house(new THREE.MeshBasicMaterial({ map: roofDeck(), color: 0x8a8a90 })) });
    frame(group, M, r);
    // a speaker stack in each corner of the room, turned to the middle of the square
    const { x: X, z0: Z0, z1: Z1 } = r.walls;
    for (const [x, z] of [[-X + 1.1, Z0 + 0.9], [X - 1.1, Z0 + 0.9], [-X + 1.1, Z1 - 0.9], [X - 1.1, Z1 - 0.9]]) {
      const pa = paStack(M); pa.rotation.y = Math.atan2(-x, r.zc - z); group.add(at(pa, x, 0, z));
    }
    // the DJ's road cases against the back wall, water
    group.add(at(roadCase(M, 1.0, 0.75, 0.65, { wheels: true, stencil: 7 }), -2.4, 0, Z0 + 0.6), at(roadCase(M, 1.0, 0.75, 0.65, { stencil: 0 }), -2.4, 0.86, Z0 + 0.6), at(waterCrate(M), 2.2, 0, Z0 + 0.5, [0, 0.3, 0]));
  } else {
    shell(group, M, r, { wall: house(new THREE.MeshBasicMaterial({ map: hallWall(), color: 0xa4a4a8 })), su: 6.4, sv: 3.2, floor: std({ map: concrete(), roughness: 0.85 }), ceiling: house(new THREE.MeshBasicMaterial({ map: roofDeck(), color: 0x9a9aa0 })) });
    frame(group, M, r);
    // the bench at the side: a table with the laptop that runs the lights and a LuxDMX box; cases
    const wood = std({ color: 0x6e5236, roughness: 0.7 }), tx = r.walls.x - 1.4, tz = 7;
    group.add(at(box(0.8, 0.04, 1.6, wood), tx, 0.9, tz));
    for (const [ex, ez] of [[-0.35, -0.75], [0.35, -0.75], [-0.35, 0.75], [0.35, 0.75]]) group.add(at(box(0.04, 0.88, 0.04, M.steel), tx + ex, 0.44, tz + ez));
    const lap = new THREE.Group(), lid = box(0.33, 0.22, 0.01, M.plastic);
    lap.add(at(box(0.33, 0.015, 0.23, M.plastic), 0, 0.008, 0));
    lid.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), new THREE.MeshBasicMaterial({ map: screen('desk') })), 0, 0, 0.006));
    lap.add(at(lid, 0, 0.11, -0.12, [-0.25, 0, 0])); lap.rotation.y = -Math.PI / 2; group.add(at(lap, tx, 0.92, tz));
    group.add(at(box(0.18, 0.05, 0.12, M.plastic), tx, 0.945, tz - 0.45), at(new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 4), M.ledBlue), tx - 0.06, 0.96, tz - 0.45));
    group.add(at(roadCase(M, 1.0, 0.75, 0.65, { wheels: true, stencil: 7 }), -r.walls.x + 1.0, 0, 8, [0, Math.PI / 2, 0]), at(roadCase(M, 1.0, 0.75, 0.65, { stencil: 1 }), -r.walls.x + 1.0, 0.86, 8, [0, Math.PI / 2, 0]));
    group.add(at(roadCase(M, 0.9, 0.62, 0.6, { wheels: true, stencil: 3 }), -r.walls.x + 1.0, 0, 9.3, [0, Math.PI / 2 + 0.1, 0]));
  }

  // ---- the DJ and the booth (club: on the deck; party: on the floor)
  const spot = DJ_BOOTH[id];
  if (spot) {
    booth = djBooth(M, DEFAULT); boothShows = DEFAULT;
    const d = djPerson(), holder = new THREE.Group();
    holder.add(booth.group, d.p.group); group.add(at(holder, spot.booth.x, spot.booth.y, spot.booth.z));
    dj = { p: d.p, raised: d.raised, booth: holder };
    djPlay = d.play;
    d.play(0, 0);
  }

  // ---- the crowd (crowd.ts, the hall's people: fewer, no flags), facing the DJ
  if (id === 'club') {
    const W = r.walls;
    crowd = buildCrowd(o.crowd ?? (soft ? 100 : 240), {
      z0: D / 2 + 1.0, z1: W.z1 - 3.4, spread: () => W.x - 1.4, flags: 0,
      keepOut: (x, z) => (Math.abs(x) > 7.2 && z < D / 2 + 1.4),
    });
  } else if (id === 'party') {
    const W = r.walls, legs: [number, number][] = [[-6, 1.5], [6, 1.5], [-6, 13.5], [6, 13.5]];
    crowd = buildCrowd(o.crowd ?? (soft ? 90 : 200), {
      z0: 2.2, z1: 14.8, spread: () => W.x - 1.6, flags: 0,
      keepOut: (x, z) => legs.some(([lx, lz]) => Math.hypot(x - lx, z - lz) < 1.1) || (Math.abs(x) > W.x - 2.4 && z > W.z1 - 3.2),
    });
  }
  if (crowd) group.add(crowd.group);

  const clock = beatClock();
  let shown = 0, rest: number | null = null;
  function animate(t: number, beat: number, energy: number, col: THREE.Color, music = true) {
    if (crowd) {
      // (the crowd comes in on the second frame: the first, with the room, shows sooner)
      if (!crowd.group.visible && ++shown > 1) crowd.group.visible = true;
      crowd.update(t, beat, energy, col);
    }
    // no music: the DJ stops where the last beat was, hands still, and waits
    if (!music) { rest ??= Math.floor(beat); djPlay?.(rest, 0); return; }
    rest = null;
    djPlay?.(clock(t, beat), crowd ? crowd.excitement() : Math.min(1, energy));
  }
  // what never moves is baked; the DJ and the crowd move
  const white = new THREE.Color(1, 1, 1);
  const live = movingMeshes(group, (k) => animate(k * 1.37, k ? 2.3 + k * 3.9 : 0, k ? 0.85 : 0, white));
  const keep = new Set<THREE.Object3D>(dj ? [dj.p.group] : []);
  const inKept = (x: THREE.Object3D) => { for (let p: THREE.Object3D | null = x; p; p = p.parent) if (keep.has(p)) return true; return false; };
  const baked = bake(group, (x) => live.has(x) || inKept(x) || (!!crowd && x === crowd.group));
  const freeze = (x: THREE.Object3D) => { if (dj && x === dj.p.group) return; x.updateMatrix(); x.matrixAutoUpdate = false; x.children.forEach(freeze); };
  group.children.forEach(freeze);
  if (crowd) crowd.group.visible = false;

  function setBand(n?: string) {
    const name = (n ?? '').trim();
    if (!booth || name === boothName) return;
    boothName = name; boothShows = name.toUpperCase() || DEFAULT;
    booth.set(boothShows);
  }
  setBand(o.band);
  return {
    group, room: id, crowdCount: crowd?.count ?? 0, animate, setBand, baked, crowd, dj,
    bandInfo: () => ({ name: boothName, surfaces: booth ? [{ what: 'booth', shows: boothShows, uuid: booth.t.uuid, version: booth.t.version }] : [] }),
  };
}
