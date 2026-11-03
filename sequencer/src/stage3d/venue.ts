// The venue around the lights: a dark hall (block walls, a steel roof, doors and exit signs), the
// deck (a vinyl stage floor, black molton round it), aluminium truss on towers with chain hoists,
// the band's backdrop and two LED walls with banners under them, the band with a drum kit (mics on
// it), backline (cabs, heads, pedalboards, spare guitars), DI and stage boxes with their cables
// taped down, monitor world (desk, engineer, in-ear rack, side fills), line arrays and subs, racks
// and road cases in the wings, a barricade with a banner, the audience (crowd.ts), and FOH on its
// riser: sound and lighting desks with their engineers, a camera on a tripod; two follow spots on
// scaffold towers at the back (gear.ts). Materials are physically based (they catch the beams and
// the environment); textures come from textures.ts. Built once; everything that never moves is
// then baked into a few dozen meshes (gear.ts bake); the band, the crowd and the screens move with
// the beat (animate()).
//
// Or a small club / pub (Room 'pub' in geometry.ts): the same band on a smaller deck across the end
// of a room with brick walls and a low ceiling, two little trusses hung from it, a PA on poles, TVs
// on the walls, a bar at the back with its bartender, a few dozen people.
//
// The band's name (settings.bandName) goes on the banners, the screens and the kick drum; without
// one the backdrop and the scrims show the band's own picture. setBand() paints them again in place:
// the venue isn't built again for it.
//
// The demos' own rooms (a club with a DJ, a party room, the test truss) are built in rooms.ts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { D, DECK, ROOMS, TRUSS, W, type RoomId } from './geometry';
import { banner, boards, brick, concrete, darkWood, exitSign, grille, liveBanner, liveCanvas, nameLayout, neonSign, paintKick, pleats, rackFront, rug, screen, sparkle, stageFloor } from './textures';
import { ARM, HIP, Person, SOLE, twoBone, type Look } from './people';
import { bandSurface, type BandSurface } from './bandArt';
import { buildCrowd, crowdBeatLen, type Crowd } from './crowd';
import { buildRoom, isDemoRoom, softwareGL, type Stage } from './rooms';
import {
  aimMic, ampHead, bake, cab, cameraTripod, clipMic, crewMember, desk, diBox, floorCable, followSpot, gearMats, guitarOnStand, hall, HALL,
  iemRack, ledWall, movingMeshes, pedalboard, rampRun, roadCase, rod, scaffold, sideFill, stageBox, tube, waterCrate, house,
} from './gear';

export const BAND = 'WE ARE NOT THE BAND';
// Where the band and what's theirs stand, by room: on the big stage as they always did; in the pub
// closer together on the smaller deck (the same people and instruments, real sizes). x, z on the
// deck; the riser [x, z, width, depth]; the players' cables run past `cableZ` to `cableEnd`.
type XZ = [number, number];
const LAYOUT: Record<'hall' | 'pub', { riser: [number, number, number, number]; kit: XZ; mic: XZ; guitar: XZ; bass: XZ; keys: XZ; cableZ: number; cableEnd: XZ }> = {
  hall: { riser: [0, -2.6, 3.4, 2.6], kit: [0, -2.4], mic: [0, 2.0], guitar: [-3.6, 1.2], bass: [3.6, 1.2], keys: [-4.6, -1.6], cableZ: -1.4, cableEnd: [0.8, -1.9] },
  pub: { riser: [0, -0.35, 2.8, 2.2], kit: [0, -0.15], mic: [0, 2.7], guitar: [-2.5, 2.1], bass: [2.5, 2.1], keys: [-3.15, -0.8], cableZ: 0.9, cableEnd: [1.7, -0.6] },
};
// The drum kit in its own space (on the riser, the kick drum's back head at z = -0.12): the throne
// (where the drummer sits), the snare; the hi-hat (its bottom cymbal's height and size); the two
// pedals (where each footboard's heel end is, the kick pedal's axle height and where its beater
// swings). A footboard is `len` long and rises at `rest` radians, `down` when pressed.
// The fretting hand: how far it's rolled round the neck from straight under it (towards the front:
// the wrist stays under the neck, the forearm comes in at a wrist players can hold), its elbow's way
const FRET = { roll: 1.2, pole: [0.6, -0.4, -0.7] as [number, number, number] };
export const KIT = {
  throne: { z: -0.65 },
  snare: { x: 0.33, y: 0.64, z: -0.12 },
  hat: { x: 0.5, y: 0.88, z: 0.05, r: 0.17 },
  kick: { x: -0.04, z: -0.47, axle: 0.13, beat: -0.16 },
  hatPedal: { x: 0.48, z: -0.27 },
};
export const PEDAL = { len: 0.27, rest: 0.4, down: 0.19 };
// the pub's room: walls at x = ±PUB.x, the stage's back wall at z0, the bar's at z1, the ceiling
export const PUB = { x: 4.6, z0: -1.8, z1: 14.6, h: ROOMS.pub.ceiling };
// two high tables by the walls, and the table with the laptop that runs the lights (x, z)
const PUB_TABLES: XZ[] = [[-3.85, 9.2], [3.85, 7.9]], PUB_LAPTOP: XZ = [3.65, 11.0];
const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05, ...o });
const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
// an object put somewhere (turned, scaled): returned, to add on
const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, r?: [number, number, number], sc?: [number, number, number]) => {
  o.position.set(x, y, z); if (r) o.rotation.set(...r); if (sc) o.scale.set(...sc); return o;
};

export interface Venue extends Stage {
  group: THREE.Group; animate: (t: number, beat: number, energy: number, col: THREE.Color, music?: boolean) => void; crowdCount: number;
  // the band and the mics in front of them (for the tests: hands on things, mics at mouths)
  band: Person[]; mics: { stand: THREE.Object3D; person?: Person; singing?: () => boolean }[];
  // the drum kit as it's played (for the tests): the drummer, his sticks, where their tips land on
  // each drum (his space), a bar's hits, the pedals (their angles now, the boards, where the ball of
  // each foot goes); the guitar and bass players and their guitars
  drums: {
    p: Person; sticks: { L: THREE.Mesh; R: THREE.Mesh }; tips: Record<string, THREE.Vector3>;
    hits: (bar: number) => Record<'L' | 'R' | 'kick', [number, string][]>;
    pedals: { kick: number; hat: number; beater: number; open: number };
    kick: { board: THREE.Object3D; beater: THREE.Object3D; ball: () => THREE.Vector3 }; hat: { board: THREE.Object3D; top: THREE.Object3D; ball: () => THREE.Vector3 };
  };
  strummers: { p: Person; guitar: THREE.Object3D; bass: boolean }[];
  // the audience; the crew at work (hands on desks, a pan bar, follow spot handles: where each
  // wrist was sent and what the hand is on); the drum mics and the drum each points at
  crowd: Crowd;
  crew: { p: Person; wrists: { L?: THREE.Vector3; R?: THREE.Vector3 }; on: { L?: THREE.Vector3; R?: THREE.Vector3 } }[];
  drumMics: { mic: THREE.Object3D; drum: THREE.Object3D; r: number; h: number }[];
  // what the baking did: meshes merged, the meshes they became, their vertices
  baked: { meshes: number; batches: number; verts: number };
  room: RoomId;
  // the band's name on the banners, screens and kick drum (empty: their picture); and what each of
  // those pictures shows now, for the tests (its words, '' for the picture; its texture's version)
  setBand: (name?: string) => void;
  bandInfo: () => { name: string; surfaces: { what: string; shows: string; uuid: string; version: number }[] };
}

// The hall or the pub, with the band (a Venue); any other room is one of the demos' (a Stage).
export function buildVenue(o?: { crowd?: number; room?: 'hall' | 'pub'; band?: string }): Venue;
export function buildVenue(o?: { crowd?: number; room?: RoomId; band?: string }): Stage;
export function buildVenue(o: { crowd?: number; room?: RoomId; band?: string } = {}): Venue | Stage {
  if (isDemoRoom(o.room)) return buildRoom(o.room, o);
  const room = o.room === 'pub' ? 'pub' : 'hall', pub = room === 'pub', L = LAYOUT[room];
  const M = {
    ...gearMats(),
    floor: std({ map: concrete(), roughness: 0.88 }),
    deck: std({ map: stageFloor(), roughness: 0.72 }),
    drape: std({ map: pleats(), roughness: 1 }),
  };
  const group = new THREE.Group();
  const add = <T extends THREE.Object3D>(o: T, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); group.add(o); return o; };
  const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[], r = 0) => new THREE.Mesh(r ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d), m);
  const cyl = (rt: number, rb: number, h: number, m: THREE.Material, seg = 16) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);

  // ---- what shows the band: their picture or name (bandArt.ts), banners printed with the name,
  // the screens (painted ten times a second with the name), the kick drum's head
  const surfaces: { what: string; s: BandSurface }[] = [];
  const printed: { what: string; t: THREE.Texture; set: (name: string) => void; shows: () => string }[] = [];
  let bandName = '', screenName = BAND, lastScreen = -1;
  const showsBand = (what: string, aspect: number, fallback: THREE.Texture) => { const s = bandSurface(aspect, fallback); surfaces.push({ what, s }); return s.t; };
  const printBand = (what: string, o: Parameters<typeof liveBanner>[1]) => {
    let now = BAND;
    const b = liveBanner([BAND], o);
    printed.push({ what, t: b.t, set: (n) => { now = n || BAND; b.set([now]); }, shows: () => now });
    return b.t;
  };
  const scr = document.createElement('canvas'); scr.width = 1024; scr.height = 576;
  const scrTex = new THREE.CanvasTexture(scr); scrTex.colorSpace = THREE.SRGBColorSpace;
  const scrMat = new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false });
  scrMat.userData.live = true;            // (never baked: see Stage.screens)
  function paintScreens(t: number, beat: number, energy: number, col: THREE.Color) {
    const g = scr.getContext('2d'), w = scr.width, h = scr.height;
    if (!g) return;                     // (no 2D canvas: a test runner)
    const c = `rgb(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)})`;
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#05030a'); gr.addColorStop(1, '#100518'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const pulse = Math.pow(Math.max(0, Math.cos((beat % 1) * Math.PI * 2)), 4) * energy;
    for (let i = 0; i < 14; i++) { g.strokeStyle = c; g.globalAlpha = 0.12 + 0.25 * pulse; g.lineWidth = 6; g.beginPath(); g.arc(w / 2, h / 2, ((t * 120 + i * 60) % 840), 0, Math.PI * 2); g.stroke(); }
    g.globalAlpha = 1; g.textAlign = 'center'; g.textBaseline = 'middle';
    // (the name fits the screen in whatever bold font this computer has: on two lines if that's bigger)
    const font = (px: number) => `900 ${px}px Impact, "Arial Black", sans-serif`;
    const { lines, px } = nameLayout(screenName, (s, p) => { g.font = font(p); return g.measureText(s).width; }, w * 0.88, 220);
    const size = Math.min(92, px), top = h / 2 - 20 - ((lines.length - 1) * size * 1.05) / 2;
    g.font = font(size); g.shadowColor = c; g.shadowBlur = 30 + 50 * pulse; g.fillStyle = '#fff';
    lines.forEach((l, i) => g.fillText(l, w / 2, top + i * size * 1.05)); g.shadowBlur = 0;
    g.font = '700 34px sans-serif'; g.fillStyle = '#cfd6e4'; g.fillText('LIVE', w / 2, top + (lines.length - 1) * size * 1.05 + 82);
    scrTex.needsUpdate = true;
  }

  // ---- truss: box truss spans, couplers every 3 m; chain hoists to the roof
  const chord = (L: number) => new THREE.CylinderGeometry(0.025, 0.025, L, 10);
  function truss(a: THREE.Vector3, b: THREE.Vector3, size = 0.3) {
    const dir = new THREE.Vector3().subVectors(b, a), L = dir.length(), s = size / 2, parts: THREE.BufferGeometry[] = [];
    for (const [x, z] of [[-s, -s], [s, -s], [s, s], [-s, s]]) parts.push(chord(L).translate(x, L / 2, z));
    const n = Math.max(1, Math.round(L / size));
    for (let i = 0; i < n; i++) {
      const y0 = (i / n) * L, y1 = ((i + 1) / n) * L;
      for (const [x0, z0, x1, z1] of [[-s, -s, s, -s], [s, -s, s, s], [s, s, -s, s], [-s, s, -s, -s]]) {
        const from = new THREE.Vector3(i % 2 ? x0 : x1, y0, i % 2 ? z0 : z1), to = new THREE.Vector3(i % 2 ? x1 : x0, y1, i % 2 ? z1 : z0);
        const d = new THREE.CylinderGeometry(0.011, 0.011, from.distanceTo(to), 6);
        d.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
        parts.push(d.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2));
      }
    }
    for (let y = 0; y <= L; y += 3) parts.push(new THREE.BoxGeometry(size + 0.03, 0.03, size + 0.03).translate(0, Math.min(L, y), 0));
    const m = new THREE.Mesh(merge(parts), M.alu);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()); m.position.copy(a);
    group.add(m);
  }
  function hoist(x: number, y: number, z: number) {
    const g = new THREE.Group();
    g.add(at(cyl(0.11, 0.11, 0.32, M.black), 0, 0.45, 0));
    g.add(at(box(0.18, 0.16, 0.26, M.black), 0, 0.62, 0));
    g.add(at(cyl(0.012, 0.012, 6, M.chrome, 5), 0, 3.6, 0));
    g.add(at(cyl(0.015, 0.015, 0.3, M.chrome, 5), 0, 0.15, 0));
    add(g, x, y, z);
  }

  // ---- the pub: brick walls, a low ceiling on dark beams, floorboards, the deck across the end of
  // the room (its front printed with the name), the band's banner on the wall behind it, two little
  // trusses hung from the ceiling, a PA on poles, TVs on the walls showing what the screens show,
  // the bar at the back (counter, taps, stools, bottles on the back bar, a neon sign, lamps), two
  // high tables, the laptop's table, a door with its exit sign
  function buildPub() {
    const { x: X, z0: Z0, z1: Z1, h: H } = PUB, Lr = Z1 - Z0, zc = (Z0 + Z1) / 2, room = ROOMS.pub;
    const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    // (walls and ceiling unlit, as the hall's: the house light is their colour; a plane facing in,
    // its picture su x sv metres)
    const wall = (w: number, h: number, m: THREE.Material, su: number, sv: number) => {
      const p = new THREE.PlaneGeometry(w, h), uv = p.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / su, uv.getY(i) * h / sv);
      return new THREE.Mesh(p, m);
    };
    const wallM = house(new THREE.MeshBasicMaterial({ map: brick(), color: 0x8c817a }));
    group.add(at(wall(Lr, H, wallM, 2, 1), -X, H / 2, zc, [0, Math.PI / 2, 0]), at(wall(Lr, H, wallM, 2, 1), X, H / 2, zc, [0, -Math.PI / 2, 0]));
    group.add(at(wall(2 * X, H, wallM, 2, 1), 0, H / 2, Z0), at(wall(2 * X, H, wallM, 2, 1), 0, H / 2, Z1, [0, Math.PI, 0]));
    // dark wood panelling up to 1.1 m round the room (not behind the stage)
    const panel = house(new THREE.MeshBasicMaterial({ map: darkWood(), color: 0x9a8c84 })), pz = (D / 2 + Z1) / 2, pl = Z1 - D / 2;
    group.add(at(wall(pl, 1.1, panel, 1.2, 1.1), -X + 0.02, 0.55, pz, [0, Math.PI / 2, 0]), at(wall(pl, 1.1, panel, 1.2, 1.1), X - 0.02, 0.55, pz, [0, -Math.PI / 2, 0]));
    // the ceiling, and beams across it (both out of the way when the camera looks down from above)
    group.add(at(wall(2 * X, Lr, house(new THREE.MeshBasicMaterial({ map: darkWood(), color: 0x4a4440 })), 1.5, 3), 0, H, zc, [Math.PI / 2, 0, 0]));
    const beam = std({ map: darkWood(), roughness: 0.7 }); beam.userData.hideAbove = H - 0.6;
    for (let z = Z0 + 1.6; z < Z1; z += 2.4) add(box(2 * X, 0.24, 0.2, beam), 0, H - 0.12, z);
    // floorboards along the room (a picture is 2 x 2 m)
    const fl = new THREE.PlaneGeometry(2 * X, Lr);
    { const uv = fl.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * X, uv.getY(i) * Lr / 2); }
    add(new THREE.Mesh(fl.rotateX(-Math.PI / 2), std({ map: boards(), roughness: 0.62 })), 0, 0, zc);

    // the deck from wall to wall, its front printed; three steps up at the front, stage right
    const { x: dx, z0: dz0, z1: dz1 } = room.deck, dd = dz1 - dz0;
    const deckGeo = new THREE.BoxGeometry(2 * dx, DECK, dd);
    { const uv = deckGeo.attributes.uv; for (const [f, len] of [[0, dd], [1, dd], [5, 2 * dx]] as const) for (let i = f * 4; i < f * 4 + 4; i++) uv.setX(i, uv.getX(i) * len / 1.9); }
    const skirt = std({ map: printBand('skirt', { w: 2048, h: 270, logo: false }), roughness: 0.95 });
    add(new THREE.Mesh(deckGeo, [M.drape, M.drape, M.deck, M.black, skirt, M.drape]), 0, DECK / 2, (dz0 + dz1) / 2).name = 'deck';
    for (let i = 0; i < 3; i++) { const h = (DECK / 4) * (3 - i); add(box(0.9, h, 0.3, [M.black, M.black, M.deck, M.black, M.black, M.black]), -2.9, h / 2, dz1 + 0.15 + i * 0.3); }
    // the band's banner on the wall behind the stage (under the trusses' lights, seen from the bar)
    const BW = 8.0, BH = 2.9, back = new THREE.PlaneGeometry(BW, BH, 48, 3);
    { const p = back.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 2.4) * 0.04); back.computeVertexNormals(); }
    add(new THREE.Mesh(back, std({ map: showsBand('backdrop', BW / BH, banner('back', [BAND, 'WORLD TOUR · LIVE TONIGHT'], { w: 2048, h: 1024 })), roughness: 0.96 })), 0, DECK + 0.2 + BH / 2, Z0 + 0.12);
    // two trusses on steel wire from the ceiling (the lights hang under them: geometry.ts ROOMS.pub)
    for (const t of room.truss) {
      const y = t.y + 0.15;
      truss(P(-X + 0.35, y, t.z), P(X - 0.35, y, t.z));
      for (const x of [-2.6, 2.6]) { add(cyl(0.005, 0.005, H - (y + 0.15), M.chrome, 4), x, (H + y + 0.15) / 2, t.z); add(box(0.05, 0.06, 0.03, M.steel), x, y + 0.18, t.z); }
    }
    // the PA: a top on a pole over a sub, either side in front of the stage, turned in a little
    const cabMats = [M.tolex, M.tolex, M.tolex, M.tolex, M.grille, M.tolex];
    for (const sx of [-1, 1]) {
      const pa = new THREE.Group();
      pa.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.62, 0.7, 2, 0.02), cabMats), 0, 0.31, 0));
      pa.add(at(cyl(0.019, 0.019, 1.15, M.black, 8), 0, 0.62 + 0.575, 0));
      pa.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.66, 0.36, 2, 0.02), cabMats), 0, 0.62 + 1.1 + 0.33, 0));
      pa.rotation.y = -sx * 0.25; add(pa, sx * 4.0, 0, D / 2 + 0.6);
    }
    // TVs high on the side walls, turned towards the room: they show what the LED walls do in the hall
    for (const sx of [-1, 1]) {
      const tv = new THREE.Group();
      tv.add(at(box(1.32, 0.78, 0.06, M.plastic), 0, 0, 0), at(new THREE.Mesh(new THREE.PlaneGeometry(1.26, 0.71), scrMat), 0, 0, 0.031), at(box(0.08, 0.08, 0.4, M.steel), 0, 0, -0.22));
      tv.rotation.y = -sx * (Math.PI / 2 - 0.45); add(tv, sx * (X - 0.45), 3.75, 6.2);
    }

    // ---- the bar: the counter (a foot rail along it, taps on it), stools in front, the back bar
    // with bottles on lit shelves in front of a mirror, a neon sign over it, lamps over the counter
    const wood = std({ map: darkWood(), roughness: 0.38 }), BZ = Z1 - 1.6, bx0 = -X, bx1 = 2.3, bl = bx1 - bx0, bxc = (bx0 + bx1) / 2;
    add(box(bl, 1.0, 0.55, wood), bxc, 0.5, BZ + 0.05);
    add(box(bl + 0.08, 0.06, 0.78, wood), bxc + 0.04, 1.03, BZ - 0.02);
    add(rod(P(bx0 + 0.1, 0.2, BZ - 0.42), P(bx1 - 0.1, 0.2, BZ - 0.42), 0.022, M.brass, 10));
    for (let x = bx0 + 0.6; x < bx1; x += 1.2) add(rod(P(x, 0.02, BZ - 0.24), P(x, 0.2, BZ - 0.42), 0.012, M.brass, 6));
    const handle = std({ color: 0xc8a046, roughness: 0.4 });
    for (let i = 0; i < 5; i++) {
      const x = -2.6 + i * 0.32;
      add(cyl(0.02, 0.02, 0.3, M.chrome, 8), x, 1.21, BZ + 0.15); add(rod(P(x, 1.3, BZ + 0.15), P(x, 1.25, BZ + 0.02), 0.008, M.chrome, 6));
      add(cyl(0.012, 0.016, 0.16, i % 2 ? M.black : handle, 8), x, 1.44, BZ + 0.15);
    }
    for (let i = 0; i < 6; i++) {
      const x = -3.9 + i * 1.05, z = BZ - 0.78, ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 6, 16), M.steel);
      add(cyl(0.19, 0.17, 0.06, wood, 16), x, 0.78, z); add(cyl(0.025, 0.025, 0.75, M.steel, 8), x, 0.38, z); add(cyl(0.2, 0.22, 0.02, M.steel, 16), x, 0.01, z);
      ring.rotation.x = Math.PI / 2; add(ring, x, 0.3, z);
    }
    add(box(2 * X - 0.2, 0.95, 0.5, wood), 0, 0.475, Z1 - 0.28);
    add(at(new THREE.Mesh(new THREE.PlaneGeometry(6.6, 1.4), M.glass), 0, 1.95, Z1 - 0.02, [0, Math.PI, 0]));
    const glass = [0x2f6b2a, 0x8a4a12, 0xd8e2e0, 0x24406e, 0x6a1420].map((color) => std({ color, roughness: 0.15, metalness: 0.1 }));
    const strip = new THREE.MeshBasicMaterial({ color: 0xffb060, toneMapped: false });
    for (const [k, y] of [1.5, 1.95, 2.4].entries()) {
      add(box(6.4, 0.03, 0.24, wood), 0, y, Z1 - 0.14); add(box(6.4, 0.012, 0.02, strip), 0, y - 0.025, Z1 - 0.03);
      for (let i = 0; i < 18; i++) {
        const x = -3.0 + i * 0.35 + (k % 2) * 0.12, m = glass[(i * 3 + k) % glass.length], tall = (i + k) % 3 ? 0 : 0.05;
        add(cyl(0.036, 0.036, 0.2 + tall, m, 10), x, y + 0.115 + tall / 2, Z1 - 0.13);
        add(cyl(0.012, 0.036, 0.05, m, 10), x, y + 0.24 + tall, Z1 - 0.13); add(cyl(0.012, 0.012, 0.07, m, 8), x, y + 0.3 + tall, Z1 - 0.13);
      }
    }
    add(at(new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: neonSign('Live Music', '#ff4fa8'), toneMapped: false })), 0, 3.35, Z1 - 0.03, [0, Math.PI, 0]));
    const bulb = new THREE.MeshBasicMaterial({ color: 0xffc27a, toneMapped: false });
    for (const x of [-3.2, -1.4, 0.4]) { add(cyl(0.004, 0.004, 1.0, M.black, 4), x, H - 0.5, BZ); add(cyl(0.05, 0.16, 0.16, M.black, 16), x, H - 1.08, BZ); add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), bulb), x, H - 1.17, BZ); }
    // high tables with a couple of glasses on them; the laptop's table (a LuxDMX box beside it)
    const beer = std({ color: 0xd8901c, roughness: 0.2 });
    for (const [x, z] of PUB_TABLES) {
      add(cyl(0.34, 0.34, 0.04, wood, 20), x, 1.08, z); add(cyl(0.04, 0.04, 1.06, M.steel, 8), x, 0.53, z); add(cyl(0.26, 0.28, 0.03, M.steel, 16), x, 0.015, z);
      for (const [gx, gz] of [[0.1, 0.05], [-0.12, -0.08]]) add(cyl(0.035, 0.03, 0.14, beer, 10), x + gx, 1.17, z + gz);
    }
    const [lx, lz] = PUB_LAPTOP;
    add(box(0.9, 0.04, 0.6, wood), lx, 1.0, lz);
    for (const [ex, ez] of [[-0.4, -0.25], [0.4, -0.25], [-0.4, 0.25], [0.4, 0.25]]) add(box(0.04, 0.98, 0.04, M.steel), lx + ex, 0.49, lz + ez);
    const lap = new THREE.Group(); lap.add(at(box(0.33, 0.015, 0.23, M.plastic), 0, 0.008, 0));
    const lid = box(0.33, 0.22, 0.01, M.plastic); lid.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), new THREE.MeshBasicMaterial({ map: screen('desk') })), 0, 0, 0.006));
    lap.add(at(lid, 0, 0.11, -0.12, [-0.25, 0, 0])); lap.rotation.y = Math.PI; add(lap, lx, 1.02, lz);
    add(box(0.18, 0.05, 0.12, M.plastic), lx - 0.32, 1.045, lz - 0.1); add(new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 4), M.ledBlue), lx - 0.26, 1.06, lz - 0.04);
    // a door out, its exit sign over it
    const dg = new THREE.Group(), door = std({ color: 0x23262b, metalness: 0.5, roughness: 0.5 });
    dg.add(at(box(1.0, 2.1, 0.05, door), 0, 1.05, 0.03), at(box(0.6, 0.04, 0.05, M.chrome), 0.15, 1.0, 0.08), at(box(0.5, 0.25, 0.05, M.plastic), 0, 2.4, 0.03));
    dg.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.22), new THREE.MeshBasicMaterial({ map: exitSign(), toneMapped: false })), 0, 2.4, 0.056));
    dg.rotation.y = Math.PI / 2; add(dg, -X, 0, 10.6);
  }

  // (the hall's backdrop banner: the crowd's flags carry it too)
  let backdrop: { map: THREE.Texture; aspect: number } | undefined;
  if (pub) buildPub();
  else {
  // ---- the hall (walls, roof, doors), its concrete floor, and the deck (one box: its top is the
  // stage floor, its front the skirt print, black molton in folds round the rest)
  group.add(hall(M));
  const floorGeo = new THREE.PlaneGeometry(2 * HALL.x, HALL.z1 - HALL.z0);
  // (the floor's picture keeps its size: 10 m a tile, as on the old 120 m floor)
  { const uv = floorGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (2 * HALL.x) / 120, uv.getY(i) * (HALL.z1 - HALL.z0) / 120); }
  add(new THREE.Mesh(floorGeo.rotateX(-Math.PI / 2), M.floor), 0, 0, (HALL.z0 + HALL.z1) / 2);
  const skirt = std({ map: printBand('skirt', { w: 4096, h: 256, logo: false }), roughness: 0.95 });
  const deckGeo = new THREE.BoxGeometry(W + 4, DECK, D + 0.4);
  // (the molton's folds every 24 cm whatever the side's length: faces +x, -x and -z)
  { const uv = deckGeo.attributes.uv; for (const [f, len] of [[0, D + 0.4], [1, D + 0.4], [5, W + 4]] as const) for (let i = f * 4; i < f * 4 + 4; i++) uv.setX(i, uv.getX(i) * len / 1.9); }
  const deck = add(new THREE.Mesh(deckGeo, [M.drape, M.drape, M.deck, M.black, skirt, M.drape]), 0, DECK / 2, -0.2);
  deck.name = 'deck';
  for (let i = 0; i < 5; i++) add(box(1.3, (DECK / 5) * (i + 1), 0.3, [M.black, M.black, M.deck, M.black, M.black, M.black]), W / 2 + 2.65, ((DECK / 5) * (i + 1)) / 2, D / 2 - 0.45 - i * 0.3);

  // ---- truss on towers
  for (const t of TRUSS) {
    const xl = -W / 2 - 0.9, xr = W / 2 + 0.9, y = t.y + 0.15;
    truss(new THREE.Vector3(xl, y, t.z), new THREE.Vector3(xr, y, t.z));
    for (const x of [xl, xr]) { truss(new THREE.Vector3(x, 0, t.z), new THREE.Vector3(x, y + 0.15, t.z)); add(box(0.9, 0.05, 0.9, M.alu), x, 0.025, t.z); }
    for (const x of [-W / 4, W / 4]) hoist(x, y + 0.15, t.z);
  }
  for (const x of [-W / 2 - 0.9, W / 2 + 0.9]) truss(new THREE.Vector3(x, TRUSS[0].y + 0.6, TRUSS[0].z), new THREE.Vector3(x, TRUSS[2].y + 0.6, TRUSS[2].z));

  // ---- the backdrop (fabric with soft folds) and two LED screens beside the deck
  const back = new THREE.PlaneGeometry(W + 2, 7.2, 64, 4);
  { const p = back.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 2.1) * 0.06); back.computeVertexNormals(); }
  // (the band's own banner artwork; the painted one until it has loaded)
  // (the crowd's flags carry the same banner)
  backdrop = { map: showsBand('backdrop', (W + 2) / 7.2, banner('back', [BAND, 'WORLD TOUR · LIVE TONIGHT'], { w: 2048, h: 1024 })), aspect: (W + 2) / 7.2 };
  add(new THREE.Mesh(back, std({ map: backdrop.map, roughness: 0.96 })), 0, DECK + 3.8, -D / 2 - 0.3);
  // (LED walls hung from bumpers with chains to the roof: cabinets on the back, the picture in front)
  for (const sx of [-1, 1]) { const lw = ledWall(M, 5.4, 3.2, scrMat, HALL.h - 0.9, 6.2); lw.rotation.y = -sx * 0.25; add(lw, sx * (W / 2 + 4.6), 6.2, D / 2 - 0.6); }

  // ---- PA: line arrays (rounded cabinets, a grille front) on frames with hoists; subs on the floor
  const cabMats = [M.tolex, M.tolex, M.tolex, M.tolex, M.grille, M.tolex];
  for (const sx of [-1, 1]) {
    const la = new THREE.Group();
    let y = 0, a = 0;
    for (let i = 0; i < 10; i++) {
      const cab = new THREE.Mesh(new RoundedBoxGeometry(1.24, 0.32, 0.58, 2, 0.02), cabMats); cab.position.set(0, y, 0); cab.rotation.x = a; la.add(cab);
      la.add(at(box(0.04, 0.3, 0.5, M.alu), -0.64, y, 0), at(box(0.04, 0.3, 0.5, M.alu), 0.64, y, 0));
      // rigging pins in the side plates, a badge on the grille, handles on the sides
      for (const ex of [-0.665, 0.665]) for (const ez of [-0.2, 0.2]) la.add(at(cyl(0.012, 0.012, 0.02, M.chrome, 6), ex, y + 0.1, ez, [0, 0, Math.PI / 2]));
      la.add(at(box(0.1, 0.022, 0.004, M.piping), -0.5, y - 0.12, 0.292));
      y -= 0.32 * Math.cos(a); a += 0.025 + i * 0.012;
    }
    la.add(at(box(1.4, 0.1, 0.7, M.alu), 0, 0.24, 0));
    for (const ex of [-0.5, 0.5]) { la.add(at(box(0.06, 0.12, 0.06, M.steel), ex, 0.35, 0)); la.add(at(cyl(0.012, 0.012, HALL.h - 0.9 - 11.6 - 0.4, M.chrome, 5), ex, 0.41 + (HALL.h - 0.9 - 11.6 - 0.4) / 2, 0)); }
    // (hung high: from the front and from FOH the hang clears the LED walls)
    la.rotation.y = -sx * 0.2; add(la, sx * (W / 2 + 2.5), 11.6, D / 2 + 0.3);
  }
  for (const x of [-6.2, -4.9, 4.9, 6.2]) for (let k = 0; k < 2; k++) {
    add(new THREE.Mesh(new RoundedBoxGeometry(1.15, 0.62, 0.85, 2, 0.02), cabMats), x, 0.31 + k * 0.63, D / 2 + 0.8);
    for (const ex of [-0.58, 0.58]) add(rod(new THREE.Vector3(x + ex, 0.4 + k * 0.63, D / 2 + 0.6), new THREE.Vector3(x + ex, 0.4 + k * 0.63, D / 2 + 1.0), 0.01, M.chrome, 6));
    add(box(0.14, 0.03, 0.004, M.piping), x - 0.4, 0.07 + k * 0.63, D / 2 + 1.226);
  }
  // front fills on the stage lip
  for (const x of [-4, -1.4, 1.4, 4]) { const f = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.22, 0.3, 2, 0.015), cabMats); f.rotation.x = 0.25; add(f, x, DECK + 0.11, D / 2 - 0.2); }

  // ---- the side of the stage: racks, road cases, a desk, behind a black scrim with the logo
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const h = 1.15 + (i % 2) * 0.35, rack = new THREE.Group();
      rack.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.62, h, 0.72, 2, 0.02), M.tolex), 0, h / 2, 0));
      rack.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.5, h - 0.1), std({ map: rackFront(i + (sx > 0 ? 9 : 0)), roughness: 0.6, metalness: 0.4, emissive: 0x112233, emissiveIntensity: 0.25 })), 0, h / 2, 0.362));
      for (const e of [-0.31, 0.31]) rack.add(at(box(0.02, h, 0.74, M.caseAlu), e, h / 2, 0));
      // (a row in the wing on the deck, fronts towards the stage, clear of the truss towers)
      for (const [ex, ey] of [[-0.24, 0.12], [0.24, 0.12], [-0.24, h - 0.12], [0.24, h - 0.12]]) rack.add(at(cyl(0.035, 0.035, 0.03, M.rubber, 10), ex, ey, 0.37, [Math.PI / 2, 0, 0]));
      rack.rotation.y = -sx * Math.PI / 2; add(rack, sx * (W / 2 + 1.55), DECK, -4.3 + i * 0.75);
    }
    // road cases in the wing, on the deck: stencilled, on casters, one on top of another
    for (const [k, z, up] of (sx > 0 ? [[6, -1.2, 0], [0, -1.2, 1]] : [[3, -1.2, 0], [0, -1.2, 1], [4, -0.25, 0]]) as [number, number, number][]) {
      const c = roadCase(M, 0.9, 0.62, 0.6, { wheels: !up, stencil: k });
      c.rotation.y = -sx * Math.PI / 2; add(c, sx * (W / 2 + 1.6), DECK + (up ? 0.73 : 0), z);
    }
    // the band's banner hanging under the LED screen on this side: in the screen's own plane, at its
    // angle (facing the audience), from the screen's bottom edge down to 1.6 m (clear of the stage
    // stairs and the truss towers); the racks are behind it
    const SW = 5, SH = 3;
    const scrimGeo = new THREE.PlaneGeometry(SW, SH, 32, 2);
    { const p = scrimGeo.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 3) * 0.03); scrimGeo.computeVertexNormals(); }
    const scrim = new THREE.Mesh(scrimGeo, std({ map: showsBand(sx < 0 ? 'scrim left' : 'scrim right', SW / SH, banner('scrim', [BAND], { w: 1024, h: 614, bg: '#08080c' })), roughness: 1, side: THREE.DoubleSide }));
    scrim.rotation.y = -sx * 0.25; add(scrim, sx * (W / 2 + 4.6), 4.6 - SH / 2, D / 2 - 0.6);
  }
  }
  // a drum riser with a carpet, and the drummer's rug on it
  add(box(L.riser[2], 0.4, L.riser[3], [M.drape, M.drape, std({ color: 0x2a1418, roughness: 1 }), M.black, M.drape, M.drape]), L.riser[0], DECK + 0.2, L.riser[1]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.9).rotateX(-Math.PI / 2), std({ map: rug(), roughness: 1 })), L.kit[0], DECK + 0.402, L.kit[1] - 0.05);

  // ---- the band: jointed people (people.ts); every hand on something, every mic at a mouth
  const band: { p: Person; play: (beat: number, energy: number, t: number) => void }[] = [];
  const mics: Venue['mics'] = [];
  function guitar(color: number, bass = false) {
    const g = new THREE.Group(), s = new THREE.Shape();
    s.moveTo(-0.17, 0); s.bezierCurveTo(-0.23, 0.17, -0.07, 0.2, -0.1, 0.32); s.bezierCurveTo(-0.15, 0.43, 0.15, 0.43, 0.1, 0.32);
    s.bezierCurveTo(0.07, 0.2, 0.23, 0.17, 0.17, 0); s.bezierCurveTo(0.13, -0.13, -0.13, -0.13, -0.17, 0);
    g.add(new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 18 }), std({ color, roughness: 0.25, metalness: 0.15 })));
    g.add(at(box(0.12, 0.14, 0.006, std({ color: 0xf2efe6, roughness: 0.4 })), 0.02, 0.12, 0.054));
    const L = bass ? 0.86 : 0.66;
    g.add(at(box(0.048, L, 0.022, std({ color: 0x4a2a14, roughness: 0.5 })), 0, 0.32 + L / 2, 0.03));
    g.add(at(box(0.08, 0.16, 0.02, std({ color: 0x111111, roughness: 0.4 })), 0, 0.32 + L + 0.07, 0.03));
    // (the six strings: one mesh)
    g.add(new THREE.Mesh(merge(Array.from({ length: 6 }, (_, i) => new THREE.BoxGeometry(0.003, L, 0.003).translate(-0.015 + i * 0.006, 0.32 + L / 2, 0.045))), M.chrome));
    g.userData.neck = L;
    return g;
  }
  // a mic stand at `base` with its mic pointing at `mouth` (both in the stand's parent's
  // coordinates): straight, or a boom reaching in from the side; the grille a hand's width from the
  // mouth. `look`: a mic that points somewhere else (an overhead hangs at `mouth` looking at `look`)
  function micStand(base: THREE.Vector3, mouth: THREE.Vector3, boom = true, look?: THREE.Vector3) {
    const g = new THREE.Group(); g.position.copy(base);
    const m = mouth.clone().sub(base), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 3; i++) { const leg = cyl(0.008, 0.008, 0.36, M.black, 5); leg.rotation.z = 1.2; leg.rotation.y = (i * Math.PI * 2) / 3; leg.position.y = 0.06; g.add(leg); }
    const H = look ? m.y - 0.45 : boom ? m.y - 0.3 : m.y - 0.24, top = new THREE.Vector3(0, H, 0);
    g.add(at(cyl(0.011, 0.011, H, M.black, 8), 0, H / 2, 0));
    // the mic: its grille end 6 cm short of the mouth (or at `mouth`, looking at `look`)
    const dir = look ? look.clone().sub(base).sub(m).normalize() : m.clone().sub(top).normalize();
    const head = look ? m.clone() : m.clone().addScaledVector(dir, -0.06), tail = head.clone().addScaledVector(dir, -0.18);
    const mic = new THREE.Group(); mic.position.copy(head); mic.quaternion.setFromUnitVectors(up, dir);
    mic.add(at(cyl(0.024, 0.016, 0.15, M.black, 14), 0, -0.1, 0));
    mic.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.027, 16, 12), M.grille), 0, -0.012, 0));
    mic.add(at(cyl(0.0255, 0.0255, 0.012, M.chrome, 14), 0, -0.035, 0));
    g.add(mic);
    // the boom (or the clip on a straight stand) from the pole top to the mic's tail
    const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number) => { const v = b.clone().sub(a); if (v.length() < 0.01) return; const c = cyl(r, r, v.length(), M.black, 6); c.position.copy(a).addScaledVector(v, 0.5); c.quaternion.setFromUnitVectors(up, v.normalize()); g.add(c); };
    rod(top, tail, boom || look ? 0.008 : 0.007);
    if (boom || look) g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), M.black), top.x, top.y, top.z));
    g.userData.mic = mic;
    return g;
  }
  function wedge() {
    const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.56, 0); s.lineTo(0.1, 0.38); s.lineTo(0, 0.38); s.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.6, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 }); geo.translate(0, 0, -0.3); geo.rotateY(Math.PI / 2);
    const g = new THREE.Group(); g.add(new THREE.Mesh(geo, M.tolex));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.44), M.grille); face.rotation.x = -Math.PI / 2 + 0.69; face.position.set(0, 0.2, 0.29); g.add(face);
    return g;
  }
  function amp(x: number, z: number) {
    const g = new THREE.Group();
    g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.76, 0.8, 0.38, 2, 0.02), [M.tolex, M.tolex, M.tolex, M.tolex, std({ map: grille(), color: 0x998877, roughness: 0.9 }), M.tolex]), 0, 0.4, 0));
    g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.76, 0.26, 0.36, 2, 0.02), M.tolex), 0, 0.95, 0));
    g.add(at(box(0.6, 0.06, 0.01, M.brass), 0, 0.95, 0.185));
    for (let i = 0; i < 6; i++) g.add(at(cyl(0.012, 0.012, 0.02, M.chrome, 8), -0.22 + i * 0.09, 0.95, 0.19, [Math.PI / 2, 0, 0]));
    add(g, x, DECK, z);
  }
  // the kick drum's front head: the band's logo, or its name
  let kickShows = 'WANTB';
  const kick = liveCanvas(256, 256, (g, w, h) => paintKick(g, w, h, kickShows));
  printed.push({ what: 'kick drum', t: kick.t, set: (n) => { kickShows = n || 'WANTB'; kick.draw((g, w, h) => paintKick(g, w, h, kickShows)); }, shows: () => kickShows });
  function drumKit() {
    const g = new THREE.Group(), hoop = M.chrome, head = std({ color: 0xece6d8, roughness: 0.55 });
    const wrap = std({ map: sparkle('#7a0f22'), roughness: 0.3, metalness: 0.35 });
    const drums: { d: THREE.Object3D; r: number; h: number }[] = []; g.userData.drums = drums;
    const drum = (r: number, h: number, x: number, y: number, z: number, rx = 0, front?: THREE.Material) => {
      const d = new THREE.Group(); drums.push({ d, r, h });
      d.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 28, 1, true), wrap));
      for (const sy of [-1, 1]) {
        const top = new THREE.Mesh(new THREE.CircleGeometry(r, 28), sy < 0 || !front ? head : front); top.rotation.x = -sy * Math.PI / 2; top.position.y = (sy * h) / 2; d.add(top);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 6, 28), hoop); ring.rotation.x = Math.PI / 2; ring.position.y = (sy * h) / 2; d.add(ring);
      }
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; d.add(at(box(0.015, h * 0.5, 0.02, hoop), Math.cos(a) * (r + 0.008), 0, Math.sin(a) * (r + 0.008))); }
      d.position.set(x, y, z); d.rotation.x = rx; g.add(d);
    };
    // (the snare and the toms tipped towards the drummer, as they're set up)
    drum(0.29, 0.44, 0, 0.3, 0.1, Math.PI / 2, std({ map: kick.t, color: 0xb8b8b8, roughness: 0.92 }));
    drum(0.18, 0.14, KIT.snare.x, KIT.snare.y, KIT.snare.z, -0.12); drum(0.13, 0.16, -0.12, 0.8, 0.05, -0.32); drum(0.15, 0.18, 0.15, 0.82, 0.05, -0.32); drum(0.2, 0.36, -0.44, 0.42, -0.2);
    const cymbal = (x: number, y: number, z: number, r: number, tilt: number) => {
      g.add(at(cyl(0.01, 0.012, y, M.chrome, 6), x, y / 2, z));
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.12, r, 0.018, 32), M.brass); c.position.set(x, y, z); c.rotation.z = tilt; g.add(c);
    };
    cymbal(-0.62, 1.36, 0.15, 0.25, 0.25); cymbal(0.46, 1.46, 0.25, 0.23, -0.3); cymbal(-0.2, 1.52, 0.36, 0.27, 0.15);
    // the hi-hat: a stand on three legs, the bottom cymbal fixed, the top one on the pull rod (it moves
    // with the pedal: the drummer's part)
    const H = KIT.hat;
    g.add(at(cyl(0.011, 0.013, H.y, M.chrome, 6), H.x, H.y / 2, H.z), at(cyl(0.005, 0.005, 0.22, M.chrome, 5), H.x, H.y + 0.1, H.z));
    for (let i = 0; i < 3; i++) { const a = 1.2 + (i * Math.PI * 2) / 3; g.add(rod(new THREE.Vector3(H.x, 0.22, H.z), new THREE.Vector3(H.x + Math.cos(a) * 0.24, 0.01, H.z + Math.sin(a) * 0.24), 0.006, M.chrome, 5)); }
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(H.r, H.r * 0.12, 0.016, 32), M.brass), H.x, H.y, H.z));
    g.add(at(cyl(0.17, 0.17, 0.08, std({ color: 0x1a1a1a, roughness: 0.6 }), 16), 0, 0.52, KIT.throne.z));
    g.add(at(cyl(0.025, 0.025, 0.48, M.chrome, 8), 0, 0.24, KIT.throne.z));
    // the two pedals' frames (what doesn't move): base plates, the kick pedal's posts and axle
    for (const p of [KIT.kick, KIT.hatPedal]) g.add(at(box(0.1, 0.012, PEDAL.len + 0.04, M.steel), p.x, 0.006, p.z + (PEDAL.len + 0.04) / 2 - 0.02));
    const K = KIT.kick;
    for (const sx of [-1, 1]) g.add(at(box(0.014, K.axle, 0.02, M.steel), K.x + sx * 0.06, K.axle / 2, K.beat));
    g.add(at(cyl(0.006, 0.006, 0.13, M.chrome, 6), K.x, K.axle, K.beat, [0, 0, Math.PI / 2]));
    return g;
  }
  const kit = drumKit(); add(kit, L.kit[0], DECK + 0.4, L.kit[1]);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const smooth = (x: number) => { const k = clamp01(x); return k * k * (3 - 2 * k); };
  const frac = (x: number) => x - Math.floor(x);
  // 1 on the beat, falling off to 0 half way to the next (k: how sharp)
  const onBeat = (b: number, k = 4) => Math.pow(Math.abs(Math.cos(Math.PI * frac(b))), k);
  // 1 on every `every`-th beat, 0 a beat or more either side of it
  const near = (b: number, every: number) => { const d = Math.abs(b / every - Math.round(b / every)) * every; return d < 1 ? Math.pow(Math.cos((Math.PI * d) / 2), 2) : 0; };
  // the beats a second (the crowd measures the beat's length from the count)
  const rate = () => 1 / crowdBeatLen();
  // A jump that lands on a beat (every `every` beats): how high off the floor, `h` at the top; it's
  // in the air as long as a ball thrown that high would be
  const jumpAt = (b: number, h: number, every = 1) => {
    if (h < 0.005) return 0;
    const air = Math.min(0.8 * every, 2 * Math.sqrt((2 * h) / 9.81) * rate()), to = every * (1 - frac(b / every));
    if (to > air) return 0;
    const s = 1 - to / air; return 4 * h * s * (1 - s);
  };
  // Who's at their mic when, in an 8 bar phrase (32 beats), on bar lines: the singer sings bars 1 to
  // 6 and steps back for the last two (when it's loud enough to); the others sing along in bars 5 and
  // 6 (a chorus) and move about the rest of the time. A move takes a beat: the hips all the way
  // through, the left foot steps in its first half, the right one in its second (each lifted a bit).
  const PHRASE = 32;
  const inPhrase = (b: number) => frac(b / PHRASE) * PHRASE;
  const moveOf = (p: number, from: number, to: number) => {
    const go = clamp01(p - from), back = clamp01(p - (to - 1));
    const foot = (k: number) => smooth(2 * go - k) * (1 - smooth(2 * back - k));
    const lift = (k: number) => 0.06 * (Math.sin(Math.PI * clamp01(2 * go - k)) + Math.sin(Math.PI * clamp01(2 * back - k)));
    return { hips: smooth(go) * (1 - smooth(back)), L: foot(0), R: foot(1), liftL: lift(0), liftR: lift(1) };
  };
  // (the feet where they stand, moved by `d` (x, z) as far as each has got; lifted; off the floor)
  const STAND = { x: HIP.x + 0.02, y: 0.085, z: 0.03 };
  const stand = (pp: Person, m: ReturnType<typeof moveOf>, dx: number, dz: number, up = 0, stomp = { L: 0, R: 0 }) => {
    pp.foot('L', V(STAND.x + dx * m.L, STAND.y + up + m.liftL + stomp.L, STAND.z + dz * m.L));
    pp.foot('R', V(-STAND.x + dx * m.R, STAND.y + up + m.liftR + stomp.R, STAND.z + dz * m.R));
  };
  // what moves with the band but isn't a person (the pedals, the hi-hat's top): never baked or frozen
  const alive: THREE.Object3D[] = [];

  // ---- the drummer on the throne: a stick in each fist (out between the thumb and the fingers,
  // forward and in a little), the right foot on the kick pedal, the left on the hi-hat's. The right
  // hand keeps eighths on the hi-hat (crossed over the left), the left the backbeat on the snare,
  // the kick on 1 and 3 (every beat when it's loud), a fill round the toms ends every fourth bar and
  // the crash starts the next. He turns a little towards what he plays and nods on the beat (bangs
  // his head when it's loud).
  const STICK = { tip: 0.29, butt: 0.12 };
  type Drum = 'snare' | 'hat' | 'crash' | 'tom1' | 'tom2' | 'floor' | 'kick';
  type Hits = Record<'L' | 'R' | 'kick', [number, Drum][]>;
  function barHits(bar: number, e: number): Hits {
    const h: Hits = { L: [], R: [], kick: [] }, fill = bar % 4 === 3 ? (e > 0.6 ? 2 : 3) : 4;
    for (let b = 0; b < fill; b += 0.5) h.R.push([b, b === 0 && (bar % 4 === 0 || e > 0.85) ? 'crash' : 'hat']);
    for (const b of [1, 3]) if (b < fill) h.L.push([b, 'snare']);
    // the fill: sixteenths hand to hand, the toms first, then the floor tom and the snare
    for (let b = fill; b < 4; b += 0.25) { const late = (b - fill) / (4 - fill) >= 0.5, right = (b - fill) % 0.5 === 0; (right ? h.R : h.L).push([b, right ? (late ? 'floor' : 'tom1') : late ? 'snare' : 'tom2']); }
    for (const b of e > 0.6 ? [0, 1, 2, 3] : [0, 2]) h.kick.push([b, 'kick']);
    return h;
  }
  // (a bar's hits are settled the first time it's played: a change of mood mid-bar waits for the next)
  const played = new Map<number, Hits>();
  const hitsOf = (bar: number, e: number) => {
    let h = played.get(bar);
    if (!h) { h = barHits(bar, e); played.set(bar, h); if (played.size > 8) played.delete(played.keys().next().value!); }
    return h;
  };
  // the hit before (or on) beat b and the next one, for a hand or the kick
  const around = (who: 'L' | 'R' | 'kick', b: number, e: number) => {
    const bar = Math.floor(b / 4);
    let pt = -Infinity, pd: Drum = 'snare', nt = Infinity, nd: Drum = 'snare';
    for (let k = bar - 2; k <= bar + 2; k++) for (const [at, dr] of hitsOf(k, e)[who]) {
      const tt = k * 4 + at;
      if (tt <= b && tt > pt) { pt = tt; pd = dr; } else if (tt > b && tt < nt) { nt = tt; nd = dr; }
    }
    return { pt, pd, nt, nd };
  };
  // How far a stick is wound up between two hits (0 on each): quick strokes rise and fall in one go;
  // with time to spare it rests a little up, bounces up after a hit and winds up for the next
  const raise = (b: number, pt: number, nt: number) => {
    const span = nt - pt, after = b - pt, before = nt - b;
    if (span <= 0.6) return Math.sin((Math.PI * after) / span);
    const wind = before < 0.5 ? Math.sin(Math.PI * (1 - before / 0.5)) : 0;
    const bounce = after < 0.3 ? 0.45 * Math.sin((Math.PI * after) / 0.3) : 0;
    return Math.max(wind, bounce, 0.35 * Math.min(1, after / 0.3, before / 0.2));
  };
  const drummer = new Person({ skin: 0xd9a07a, shirt: 0x252a36, pants: 0x1a1c22, shoes: 0x111111, hair: 0x2b1d14, style: 'long', beard: true, print: 'WANTB|world tour' });
  const kitInfo = {} as Venue['drums'];
  {
    const d = drummer;
    d.group.position.set(0, 0, KIT.throne.z); kit.add(d.group);
    d.pose({ seat: 0.57 });
    const K = (p: THREE.Vector3) => p.add(V(0, 0, -KIT.throne.z));           // the kit's space -> his
    const drums = kit.userData.drums as { d: THREE.Object3D; r: number; h: number }[];
    // where a tip lands: on a drum's head, `inset` from its middle towards him; on the hi-hat's top
    // near its edge; on the crash's edge
    const head = (i: number, inset: number) => { const { d: dr, h } = drums[i]; dr.updateMatrix(); return K(V(0, h / 2 + 0.008, inset).applyMatrix4(dr.matrix)); };
    const tips: Record<Exclude<Drum, 'kick'>, THREE.Vector3> = {
      snare: head(1, -0.05), tom1: head(2, -0.04), tom2: head(3, -0.04), floor: head(4, -0.07),
      hat: K(V(KIT.hat.x - 0.06, KIT.hat.y + 0.032, KIT.hat.z - 0.08)), crash: K(V(-0.48, 1.36, -0.03)),
    };
    // Where each hand is with its stick down on a drum: the arm reaches the tip with the forearm, the
    // hand and the stick in one line (as drummers hold them), the elbow out to its side for that drum
    // (well off the line to the hand, so it never flips; crossing over to the hi-hat down and forward,
    // the upper arm in front of the body, never in it). He turns a little towards the right hand's drum
    // (the hi-hat's on his left, the floor tom and the crash on his right).
    const elbows: Record<'L' | 'R', Partial<Record<Drum, THREE.Vector3>>> = {
      L: { snare: V(1, -0.3, -0.5), tom2: V(0.9, -0.4, -0.4) },
      R: { hat: V(-0.8, -0.5, 0.5), crash: V(-0.9, -0.3, -0.1), tom1: V(-0.9, -0.25, -0.3), floor: V(-0.9, -0.5, -0.4) },
    };
    const turns: Partial<Record<Drum, number>> = { hat: 0.16, snare: 0.04, tom2: 0.04, tom1: 0, floor: -0.16, crash: -0.14 };
    const onDrum: Record<'L' | 'R', Partial<Record<Drum, { g: THREE.Vector3; d: THREE.Vector3; pole: THREE.Vector3; turn: number }>>> = { L: {}, R: {} };
    for (const s of ['L', 'R'] as const) for (const [k, pole] of Object.entries(elbows[s]) as [Exclude<Drum, 'kick'>, THREE.Vector3][]) {
      const turn = turns[k] ?? 0;
      d.lean({ x: 0.12, y: turn });
      const S = d.arms[s].root.position.clone().applyMatrix4(d.body.matrix), n = pole.clone().applyQuaternion(d.body.quaternion).normalize();
      const dir = tips[k].clone().sub(twoBone(S, tips[k], ARM.a, ARM.b + 0.08 + STICK.tip, n)).normalize();
      onDrum[s][k] = { g: tips[k].clone().addScaledVector(dir, -STICK.tip), d: dir, pole: pole.clone().normalize(), turn };
    }
    d.lean();
    const wood = std({ color: 0xd8b98a, roughness: 0.6 });
    const stickGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.0062, 0.0085, STICK.tip + STICK.butt, 8).translate(0, (STICK.tip - STICK.butt) / 2, 0).toNonIndexed(),
      new THREE.SphereGeometry(0.0075, 8, 6).scale(1, 1.4, 1).translate(0, STICK.tip, 0).toNonIndexed(),
    ])!;
    const sticks = { L: new THREE.Mesh(stickGeo, wood), R: new THREE.Mesh(stickGeo, wood) };
    d.inHand('L', sticks.L); d.inHand('R', sticks.R);
    // the pedals: a footboard hinged at its heel end, the kick's beater on its axle, the hi-hat's top
    // cymbal on its pull rod (they go into the kit; the drummer moves them)
    const board = (p: { x: number; z: number }) => {
      const g = new THREE.Group(); g.position.set(p.x, 0.02, p.z);
      g.add(at(box(0.085, 0.016, PEDAL.len, M.alu), 0, 0.008, PEDAL.len / 2)); kit.add(g); alive.push(g); return g;
    };
    const kickBoard = board(KIT.kick), hatBoard = board(KIT.hatPedal);
    const felt = std({ color: 0x1c1c1e, roughness: 0.95 });
    const beater = new THREE.Group(); beater.position.set(KIT.kick.x, KIT.kick.axle, KIT.kick.beat);
    beater.add(new THREE.Mesh(mergeGeometries([new THREE.CylinderGeometry(0.004, 0.004, 0.17, 6).translate(0, 0.085, 0).toNonIndexed(), new THREE.CylinderGeometry(0.028, 0.028, 0.05, 14).rotateZ(Math.PI / 2).translate(0, 0.19, 0).toNonIndexed()])!, felt));
    kit.add(beater); alive.push(beater);
    const hatTop = new THREE.Mesh(new THREE.CylinderGeometry(KIT.hat.r * 0.12, KIT.hat.r, 0.016, 32), M.brass);
    hatTop.position.set(KIT.hat.x, KIT.hat.y + 0.014, KIT.hat.z); kit.add(hatTop); alive.push(hatTop);
    // a point on a footboard's top (`s` along it from the heel end) at angle `phi`, in his space
    const onBoard = (p: { x: number; z: number }, phi: number, s: number) => K(V(p.x, 0.02 + 0.016 * Math.cos(phi) + s * Math.sin(phi), p.z - 0.016 * Math.sin(phi) + s * Math.cos(phi)));
    // the ankle for a foot whose ball is on that point, its toes up by `pitch`
    const ankleOver = (ball: THREE.Vector3, pitch: number) => ball.clone().sub(V(0, SOLE.y * Math.cos(pitch) + SOLE.ball * Math.sin(pitch), -SOLE.y * Math.sin(pitch) + SOLE.ball * Math.cos(pitch)));
    const BALL = 0.19;     // where the ball of the foot is on a footboard (from its heel end)
    // a hand's stick at beat b: the hand moving between drums, the stick wound up about the wrist
    const stickAt = (s: 'L' | 'R', b: number, e: number) => {
      const { pt, pd, nt, nd } = around(s, b, e), A = onDrum[s][pd]!, B = onDrum[s][nd]!, span = nt - pt;
      const m = span <= 0.6 ? smooth((b - pt) / span) : smooth((b - (nt - 0.5)) / 0.35);
      const g = A.g.clone().lerp(B.g, m), dir = A.d.clone().lerp(B.d, m).normalize();
      d.arms[s].pole.copy(A.pole).lerp(B.pole, m);
      // (on the way between two drums far apart the stick keeps more in line with the forearm)
      if (pd !== nd) {
        const S = d.arms[s].root.position.clone().applyMatrix4(d.body.matrix), fl = g.clone().sub(twoBone(S, g, ARM.a, ARM.b + 0.08, d.arms[s].pole.clone().applyQuaternion(d.body.quaternion))).normalize();
        dir.lerp(fl, 0.6 * Math.sin(Math.PI * m)).normalize();
      }
      const turn = A.turn + (B.turn - A.turn) * m;
      const up = raise(b, pt, nt), th = up * (s === 'L' || nd === 'crash' ? 1.3 : 1) * (0.32 + 0.5 * e);
      const lift = V(0, 1, 0).addScaledVector(dir, -dir.y).normalize();
      dir.multiplyScalar(Math.cos(th)).addScaledVector(lift, Math.sin(th)).normalize();
      g.y += up * (0.015 + 0.04 * e); g.z -= up * 0.015;
      return { g, dir, turn };
    };
    const pedals = { kick: PEDAL.rest, hat: PEDAL.down, beater: 0, open: 0 };
    band.push({ p: d, play: (b, e) => {
      const r = stickAt('R', b, e), l = stickAt('L', b, e);
      // the kick: the board goes down on each kick (the foot comes down over the last sixth of a beat)
      // and springs back; the heel's up off the board (more when it's loud) and drops on the kick
      const k = around('kick', b, e), press = Math.pow(Math.max(clamp01(1 - (k.nt - b) / 0.16), clamp01(1 - (b - k.pt) / 0.3)), 1.5);
      const kp = PEDAL.rest - (PEDAL.rest - PEDAL.down) * press, heel = 0.16 + 0.22 * e * (1 - press);
      // the hi-hat: the ball of the foot holds it shut, the heel keeps time; loud, it opens on the "and"
      const open = smooth((e - 0.65) / 0.25) * Math.pow(Math.max(0, Math.sin(Math.PI * frac(b))), 6);
      const hp = PEDAL.down + (PEDAL.rest - PEDAL.down) * 0.55 * open, tap = (0.06 + 0.16 * e) * (1 - onBeat(b, 2));
      pedals.kick = kp; pedals.hat = hp; pedals.open = open; pedals.beater = -0.7 + (0.7 + 0.063) * press;
      kickBoard.rotation.x = -kp; hatBoard.rotation.x = -hp; beater.rotation.x = pedals.beater;
      hatTop.position.y = KIT.hat.y + 0.014 + 0.03 * open;
      // he leans in, turns a little after his right hand (the hi-hat's on his left), dips on a kick
      d.lean({ x: 0.1 + 0.05 * e, y: r.turn, drop: 0.012 * press * e });
      d.head.rotation.set(0.05 + (0.04 + 0.3 * e * e) * onBeat(b, 6), 0.3 * r.g.x, 0);
      for (const [s, x] of [['L', l], ['R', r]] as const) d.hold(s, x.g, { shape: 'fist', axis: x.dir, palm: V(s === 'L' ? -0.35 : 0.35, -1, 0.15), follow: true });
      d.foot('R', ankleOver(onBoard(KIT.kick, kp, BALL), kp + heel), kp + heel);
      d.foot('L', ankleOver(onBoard(KIT.hatPedal, hp, BALL), hp + 0.05 + tap), hp + 0.05 + tap);
      d.update();
    } });
    Object.assign(kitInfo, {
      p: d, sticks, tips, pedals, hits: (bar: number) => played.get(bar) ?? barHits(bar, 0),
      kick: { board: kickBoard, beater, ball: () => onBoard(KIT.kick, pedals.kick, BALL) }, hat: { board: hatBoard, top: hatTop, ball: () => onBoard(KIT.hatPedal, pedals.hat, BALL) },
    });
  }

  // ---- the singer, the guitarist, the bass player and the keys player
  const front = [
    { x: L.mic[0], z: L.mic[1], look: { skin: 0xe7b58f, shirt: 0x8b1e3f, pants: 0x16171c, shoes: 0xeeeeee, hair: 0x3a2414, style: 'long', print: 'WE ARE NOT|THE BAND' }, inst: 'mic' },
    { x: L.guitar[0], z: L.guitar[1], look: { skin: 0xc98d68, shirt: 0x1f3b6b, pants: 0x23262e, shoes: 0x222222, hair: 0x111111, style: 'cap', hat: 0x111111, print: '*' }, inst: 'guitar', gc: 0xd94f1c },
    { x: L.bass[0], z: L.bass[1], look: { skin: 0x8d5a3b, shirt: 0x1e4d2b, pants: 0x2a2d35, shoes: 0x1a1a1a, hair: 0x161616, style: 'curly', beard: true }, inst: 'bass', gc: 0x2c5fd9 },
    { x: L.keys[0], z: L.keys[1], look: { skin: 0xf0c4a0, shirt: 0x4a3b6b, pants: 0x1d1e24, shoes: 0x2a2a2a, hair: 0x9a6a34, style: 'bun', sleeves: 'long' }, inst: 'keys' },
  ] as const;
  const strummers: Venue['strummers'] = [];
  let keysPlayer: Person | undefined;
  front.forEach((pl, i) => {
    const pp = new Person(pl.look as Look), g = pp.group; add(g, pl.x, DECK, pl.z);
    // (the mic goes where the mouth is while they sing: leaning over the keys or the guitar a little)
    const atMic = pl.inst === 'keys' ? 0.1 : pl.inst === 'mic' ? 0 : 0.08;
    pp.lean({ x: atMic, drop: 0.012 });
    const mouth = pp.mouth();
    // their head on the beat: a nod, a headbang when it's loud and they're free to
    const nod = (b: number, e: number, free: number) => (0.04 + (0.05 + 0.32 * e * e) * free) * onBeat(b, 6) - 0.02;
    if (pl.inst === 'mic') {
      // the singer: a straight stand, the mic at the mouth; the left hand on it while she sings, the
      // right one reaching out to the crowd on the loud parts. Stepped back she jumps (loud) or claps
      // over her head on the beat, and comes back to the mic for the next phrase.
      const st = micStand(V(0, 0, 0.36), mouth, false); g.add(st);
      st.updateMatrixWorld(true);
      const mic = st.userData.mic as THREE.Object3D;
      const micAt = V(0, -0.11, 0).applyMatrix4(mic.matrix).applyMatrix4(st.matrix), micDir = V(0, 1, 0).applyQuaternion(mic.quaternion);
      let out = 0;
      mics.push({ stand: st, person: pp, singing: () => out < 1e-4 });
      band.push({ p: pp, play: (b, e, t) => {
        const want = smooth((e - 0.3) / 0.25), m = moveOf(inPhrase(b), 24, 32), D = -0.42 * want, z0 = D * m.hips;
        out = want * m.hips;
        // stepped back on a loud part she jumps on every beat (the knees dip as she lands)
        const loud = smooth((e - 0.6) / 0.15), free = smooth((out - 0.85) / 0.15);
        const jump = jumpAt(b, 0.14 * loud * free), dip = 0.04 * loud * free * onBeat(b, 8);
        // (at the mic the knees give only a little: the mouth stays on it)
        const bob = (0.005 + 0.007 * e + (0.01 + 0.03 * e) * free) * onBeat(b, 2);
        pp.lean({ x: -0.03 * out + 0.06 * free * onBeat(b, 3), z: 0.03 * Math.sin(b * Math.PI) * (0.3 + e), drop: 0.012 + bob + dip - jump, shift: { z: z0 } });
        stand(pp, m, 0, D, jump);
        if (out < 0.08) {
          // at the mic: the left hand on it, the right one reaching out to the crowd now and then
          pp.hold('L', micAt, { shape: 'fist', axis: micDir, palm: V(-1, 0, -0.4) });
          const up = e * (0.5 + 0.5 * Math.sin(t * 0.7));
          pp.hand('R', V(-0.3 - 0.1 * up, 0.9 + 0.75 * up, 0.08 + 0.25 * up + z0));
        } else if (loud < 0.5) {
          // claps over her head on the beat
          const c = onBeat(b, 3);
          for (const [s, sx] of [['L', 1], ['R', -1]] as const) pp.hand(s, V(sx * (0.018 + 0.18 * (1 - c)), 1.76 + 0.04 * c + jump, 0.2 + z0), { fingers: V(0, 1, 0.15), palm: V(-sx, 0, 0) });
        } else {
          // both fists up, pumping on the beat
          const pump = 0.16 * onBeat(b, 2);
          for (const [s, sx] of [['L', 1], ['R', -1]] as const) pp.hold(s, V(sx * 0.24, 1.7 + pump + jump, 0.16 + z0), { shape: 'fist', fingers: V(sx * 0.15, 1, 0.1), palm: V(0, 0, -1) });
        }
        pp.head.rotation.x = out < 0.08 ? 0.05 * Math.sin(b * Math.PI * 2) * e : nod(b, e, 1);
        pp.update();
      } });
    } else if (pl.inst === 'guitar' || pl.inst === 'bass') {
      // a guitar on a strap: neck up to the player's left; it hangs from the body (it leans and bobs
      // with the player), flat in front of the belly with a little air (never into it)
      const bass = pl.inst === 'bass', gt = guitar(pl.gc, bass); pp.body.add(gt);
      gt.rotation.set(-0.18, 0, -1.1); gt.position.set(-0.24, 0.92, 0.175); gt.updateMatrix();     // (its top tipped up a little, as players hold it)
      // (the fretting elbow down by the side, the strumming one out to the right and forward)
      pp.arms.L.pole.set(FRET.pole[0], FRET.pole[1], FRET.pole[2]); pp.arms.R.pole.set(-0.8, -0.1, 1.3);
      const NL = gt.userData.neck as number, G = (x: number, y: number, z: number) => V(x, y, z).applyMatrix4(gt.matrix);
      const strap = new THREE.CatmullRomCurve3([G(0, -0.1, 0.02), V(-0.2, 1.0, -0.06), V(-0.02, 1.27, -0.13), V(0.16, 1.47, -0.03), V(0.15, 1.36, 0.1), G(0, 0.33, 0.03)]);
      pp.body.add(new THREE.Mesh(new THREE.TubeGeometry(strap, 48, 0.012, 5), std({ color: 0x1b1b1b, roughness: 0.8 })));
      // backing vocals: a boom stand in front, a little to the side, reaching in
      const bv = micStand(V(pl.x < 0 ? 0.25 : -0.25, 0, 0.62), mouth, true); g.add(bv);
      let out = 1;
      mics.push({ stand: bv, person: pp, singing: () => out < 1e-4 });
      // in the guitar's space as the body is now: a point, a direction (into the person's space)
      const at3 = (x: number, y: number, z: number) => V(x, y, z).applyMatrix4(gt.matrix).applyMatrix4(pp.body.matrix);
      const dir3 = (x: number, y: number, z: number) => V(x, y, z).transformDirection(gt.matrix).transformDirection(pp.body.matrix);
      // the chords: a fret a bar (the hand slides there just before the bar line); where the hand is
      // for a fret (just behind it, from the nut down the neck: a 648 mm scale, a bass's 864 mm)
      const FRETS = bass ? [5, 5, 7, 9] : [5, 3, 7, 5], scale = bass ? 0.864 : 0.648;
      const fretY = (n: number) => 0.32 + NL - scale * (1 - Math.pow(2, -(n - 0.45) / 12));
      const side = Math.sign(pl.x) || 1;
      band.push({ p: pp, play: (b, e) => {
        // a step back from the mic (and out to the side) except in the chorus; there, free, they
        // groove harder: knees on the beat, a headbang, a stomp, rocking back on the one of every
        // other bar; on the loudest parts a jump that lands on the next phrase's first beat
        const m = moveOf(inPhrase(b), 15, 25);
        out = 1 - m.hips;
        const free = out, loud = smooth((e - 0.45) / 0.35);
        const stomp = loud * free * 0.05, sL = stomp * Math.max(0, Math.sin(2 * Math.PI * frac(b / 2))), sR = stomp * Math.max(0, -Math.sin(2 * Math.PI * frac(b / 2)));
        const jump = jumpAt(b, 0.16 * smooth((e - 0.8) / 0.15) * free, PHRASE);
        const rockBack = free * loud * near(b, 8);
        const bob = (0.005 + 0.007 * e + (0.008 + 0.04 * e) * free) * onBeat(b, 2);
        const dz = -(0.2 + 0.08 * e), dx = side * 0.12;
        pp.lean({ x: atMic + free * (0.06 * e * onBeat(b, 4) - 0.2 * rockBack), z: free * side * 0.06 * loud * Math.sin(Math.PI * b), drop: 0.012 + bob - jump, shift: { x: dx * free, z: dz * free } });
        // (they step away from the mic: the same move the other way round)
        stand(pp, { hips: free, L: 1 - m.L, R: 1 - m.R, liftL: m.liftL, liftR: m.liftR }, dx, dz, jump, { L: sL, R: sR });
        // the left hand round the neck at the chord's fret (thumb behind, wrist under it), sliding to
        // the next chord just before the bar line
        const bar = Math.floor(b / 4), slide = smooth((frac(b / 4) * 4 - 3.75) / 0.25);
        const y = fretY(FRETS[bar % 4]) + (fretY(FRETS[(bar + 1) % 4]) - fretY(FRETS[bar % 4])) * slide + 0.003 * Math.sin(b * Math.PI * 8) * loud;
        pp.hold('L', at3(0, y, 0.03), { shape: 'fret', axis: dir3(0, 1, 0), palm: dir3(-Math.sin(FRET.roll), 0, -Math.cos(FRET.roll)) });
        // the right hand strums across the strings (down on the beat, up on the "and"), over the
        // pickups: fingers towards the high strings, the palm to the top; a flick of the wrist with it
        const sw = Math.sin(2 * Math.PI * b), A = bass ? 0.022 + 0.015 * e : 0.035 + 0.035 * e;
        const x = A * Math.sign(sw) * Math.pow(Math.abs(sw), 0.7), w = -0.25 * Math.cos(2 * Math.PI * b) * (bass ? 0.3 : 1);
        pp.hold('R', at3(x, bass ? 0.1 : 0.16, 0.088), { shape: 'fist', fingers: dir3(Math.cos(w), 0, Math.sin(w)), palm: dir3(Math.sin(w), 0, -Math.cos(w)) });
        pp.head.rotation.x = nod(b, e, free);
        pp.update();
      } });
      strummers.push({ p: pp, guitar: gt, bass });
      amp(pl.x + (pl.x < 0 ? -0.6 : 0.6), pl.z - 1.6);
    } else {
      // keys: both hands on the keyboard, wandering along it; swaying (more when not singing)
      const kb = new THREE.Group();
      kb.add(at(new THREE.Mesh(new RoundedBoxGeometry(1.25, 0.08, 0.36, 2, 0.015), std({ color: 0x1a1a1d, roughness: 0.4 })), 0, 0.98, 0));
      kb.add(at(box(1.15, 0.02, 0.15, std({ color: 0xf4f4f0, roughness: 0.35 })), 0, 1.03, -0.08));
      for (let k = 0; k < 36; k++) if ([1, 3, 6, 8, 10].includes(k % 12)) kb.add(at(box(0.018, 0.025, 0.09, std({ color: 0x0a0a0a, roughness: 0.3 })), -0.56 + (k * 1.12) / 36, 1.045, -0.11));
      for (const lx of [-0.45, 0.45]) { const leg = cyl(0.015, 0.015, 1.3, M.black, 6); leg.rotation.z = lx > 0 ? 0.6 : -0.6; leg.position.set(lx, 0.48, 0); kb.add(leg); }
      kb.position.set(0, 0, 0.5); g.add(kb);
      const kv = micStand(V(0.55, 0, 0.75), mouth, true); g.add(kv); keysPlayer = pp;
      let out = 1;
      mics.push({ stand: kv, person: pp, singing: () => out < 1e-4 });
      band.push({ p: pp, play: (b, e) => {
        const m = moveOf(inPhrase(b), 15, 25);
        out = 1 - m.hips;
        const sway = out * (0.3 + 0.7 * e), bob = (0.005 + 0.007 * e + 0.02 * e * out) * onBeat(b, 2);
        pp.lean({ x: atMic + out * 0.05 * e * onBeat(b, 4), z: 0.07 * sway * Math.sin(Math.PI * b), drop: 0.012 + bob, shift: { x: 0.04 * sway * Math.sin(Math.PI * b) } });
        stand(pp, { hips: 0, L: 0, R: 0, liftL: 0, liftR: 0 }, 0, 0);
        const w = Math.sin(b * 0.5) * 0.12, press = (o: number) => 0.012 * Math.max(0, Math.sin((b + o) * Math.PI * 2));
        // (loud, the right hand comes off the keys and up on the first beat of every other bar)
        const wave = out * smooth((e - 0.7) / 0.2) * near(b - 0.5, 8);
        pp.hold('L', V(0.2 + w, 1.045 - press(0), 0.42), { fingers: V(0, -0.5, 1), palm: V(0, -1, 0) });
        pp.hold('R', V(-0.22 + w * 0.7, 1.045 - press(0.5) + 0.75 * wave, 0.42 - 0.1 * wave), { fingers: V(0, -0.5 + 1.5 * wave, 1 - wave), palm: V(0, -1 + wave, wave) });
        pp.head.rotation.x = 0.22 + nod(b, e, out);
        pp.update();
      } });
    }
    g.rotation.y = -pl.x * 0.05;
    const wd = wedge(); wd.rotation.y = Math.PI; add(wd, pl.x, DECK, pl.z + 1.4);
    const cable = new THREE.CatmullRomCurve3([[pl.x, pl.z + 0.4], [pl.x * 0.8, pl.z - 0.4], [pl.x * 0.4, L.cableZ], L.cableEnd].map(([x, z]) => new THREE.Vector3(x, DECK + 0.015, z)));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(cable, 40, 0.012, 6), M.rubber));
    // a setlist taped to the floor, a towel, a bottle
    const sl = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.3).rotateX(-Math.PI / 2), std({ map: banner(`setlist${i}`, ['SET', '1 Intro · 2 Groove · 3 Drop'], { w: 210, h: 300, bg: '#f3f1ea', logo: false }), roughness: 0.9 }));
    sl.rotation.y = 0.2; add(sl, pl.x + 0.4, DECK + 0.004, pl.z + 0.9);
    add(cyl(0.035, 0.035, 0.22, std({ color: 0x9fd0ff, roughness: 0.1, transparent: true, opacity: 0.55 }), 12), pl.x - 0.45, DECK + 0.11, pl.z + 0.7);
  });
  // (feet that step, jump and work pedals are never baked; the keys player's never leave the floor:
  // his shoes go into the stage like everything else that stays put)
  for (const b of band) { b.play(0, 0, 0); alive.push(b.p.body, ...(b.p === keysPlayer ? [] : [b.p.legs.L.root, b.p.legs.R.root])); }
  // overhead mics on the riser, pointing down into the kit
  for (const x of [-1.2, 1.2]) group.add(micStand(new THREE.Vector3(L.kit[0] + x, DECK + 0.4, L.kit[1] + 0.9), new THREE.Vector3(L.kit[0] + x * 0.4, DECK + 0.4 + 2.0, L.kit[1] + 0.1), true, new THREE.Vector3(L.kit[0] + x * 0.15, DECK + 0.4 + 0.8, L.kit[1])));

  // ---- backline: a 4x12 with a head for the guitar, an 8x10 with a head for the bass, pedalboards
  // in front of the players with their cables to the amps, DI boxes, the stage box the band's cables
  // run to (in front of the riser) and the snakes from it to monitor world and, under a cable ramp
  // through the crowd, to FOH. Cables on the floor are gaffer-taped down.
  const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, yaw = 0) => { o.position.set(x, y, z); o.rotation.y = yaw; group.add(o); return o; };
  // (the pedalboards in front of the guitar and the bass, their cables to the amps beside them)
  for (const sx of [-1, 1]) {
    const pl = sx < 0 ? L.guitar : L.bass, amp = [pl[0] + sx * 0.6, pl[1] - 1.6];
    const pb = put(pedalboard(M, sx > 0 ? 11 : 5), pl[0] + sx * 0.12, DECK, pl[1] + 0.52, -sx * 0.18);
    pb.updateMatrix(); const out = (pb.userData.out as THREE.Vector3).clone().applyMatrix4(pb.matrix);
    group.add(floorCable(M, [[out.x, out.z], [amp[0] - sx * 0.25, amp[1] + 1.5], [amp[0] - sx * 0.1, amp[1] + 0.7], [amp[0], amp[1] + 0.25]], DECK, { tape: 1.0 }));
  }
  if (!pub) {
  const gtrCab = put(cab(M, '4x12'), -5.05, DECK, -0.45, 0.15); put(ampHead(M, M.brass), -5.05, DECK + gtrCab.userData.top, -0.47, 0.15);
  const bassCab = put(cab(M, '8x10'), 5.0, DECK, -0.5, -0.15); put(ampHead(M, M.caseAlu, 0.62), 5.0, DECK + bassCab.userData.top, -0.52, -0.15);
  put(diBox(M), 4.6, DECK, 0.08, -0.3); group.add(floorCable(M, [[4.6, -0.02], [3.2, -0.8], [1.6, -0.95], [1.12, -0.95]], DECK, { tape: 1.2 }));
  put(diBox(M, 0x7a2a2a), -3.75, DECK, -0.95, 0.2); group.add(floorCable(M, [[-3.7, -1.05], [-2.0, -1.0], [0.3, -0.92], [0.66, -0.95]], DECK, { tape: 1.2 }));
  put(stageBox(M, 14), 0.9, DECK, -1.0);
  group.add(floorCable(M, [[1.15, -1.13], [3.0, -1.2], [5.6, -1.15], [7.35, -0.6], [7.6, 0.6]], DECK, { r: 0.022, tape: 1.5 }));
  group.add(floorCable(M, [[0.85, -0.8], [0.7, -0.5], [0.62, 0.5], [0.62, 2.5], [0.62, 4.42]], DECK, { r: 0.022, tape: 1.1 }));
  group.add(tube([V(0.62, DECK + 0.022, 4.42), V(0.62, DECK + 0.01, 4.56), V(0.62, DECK - 0.4, 4.64), V(0.62, 0.05, 4.7), V(0.62, 0.03, 4.9)], 0.022, M.rubber, 16, 6));
  group.add(rampRun([0.62, 4.85], [0.62, D / 2 + 14.9]));
  } else {
    // the pub: DI boxes, the stage box beside the riser and its multicore off to the side
    put(diBox(M), 3.55, DECK, 1.0, -0.3); group.add(floorCable(M, [[3.55, 0.9], [2.7, -0.4], [2.15, -0.95]], DECK, { tape: 1.0 }));
    put(diBox(M, 0x7a2a2a), -2.2, DECK, -1.25, 0.2); group.add(floorCable(M, [[-2.15, -1.35], [-1.5, -1.5], [1.4, -1.5], [1.65, -1.1]], DECK, { tape: 1.2 }));
    put(stageBox(M, 10), 1.85, DECK, -0.95, -0.3);
    group.add(floorCable(M, [[2.1, -1.1], [3.4, -1.35], [4.45, -1.4]], DECK, { r: 0.02, tape: 1.0 }));
  }

  // ---- drum mics: clip mics on the snare and toms pointing into their heads, a kick mic in front of
  // the logo head on a short stand, a pencil mic over the hi-hat; cables down to a sub-snake on the riser
  const drumMics: Venue['drumMics'] = [];
  {
    const list = kit.userData.drums as { d: THREE.Object3D; r: number; h: number }[];
    const snake = V(1.2, 0, -1.05);
    const sub = stageBox(M, 0); sub.scale.setScalar(0.6); sub.position.copy(snake); sub.rotation.y = -0.4; kit.add(sub);
    const cableTo = (from: THREE.Vector3, side: number, tail = 0.1) => kit.add(tube([from, from.clone().add(V(side * 0.12, -0.12, 0.05)), V(side * 0.48, 0.012, from.z + 0.15), V(side < 0 ? -0.3 : 0.62, 0.012, 0.72 + tail), V(0.75, 0.012, 0.6), V(1.0, 0.012, -0.2), snake.clone().add(V(-0.05, 0.05, 0.12))], 0.005, M.rubber, 40, 5));
    for (const [i, a] of [[1, 0.9], [2, -0.5], [3, 0.6], [4, -0.9]] as const) {
      const { d, r, h } = list[i]; d.updateMatrix();
      const P = (x: number, y: number, z: number) => V(x, y, z).applyMatrix4(d.matrix), sa = Math.sin(a), ca = Math.cos(a);
      // the grille a few cm over the head near the rim, pointing in at the head a third of the way in
      const tip = P(sa * r * 0.78, h / 2 + 0.055, ca * r * 0.78), target = P(sa * r * 0.3, h / 2, ca * r * 0.3);
      const mic = aimMic(clipMic(M), tip, target); kit.add(mic);
      const axis = target.clone().sub(tip).normalize(), back = tip.clone().addScaledVector(axis, -0.1);
      kit.add(rod(P(sa * (r + 0.012), h / 2 + 0.01, ca * (r + 0.012)), back, 0.006, M.black, 6));
      cableTo(tip.clone().addScaledVector(axis, -0.125), Math.sign(sa), i * 0.02);
      drumMics.push({ mic, drum: d, r, h });
    }
    const k = list[0]; k.d.updateMatrix();
    const kc = V(0, k.h / 2, 0).applyMatrix4(k.d.matrix), ktip = kc.clone().add(V(0.07, -0.06, 0.1));
    const km = aimMic(clipMic(M, 'kick'), ktip, kc); kit.add(km);
    const kAxis = kc.clone().sub(ktip).normalize(), kb = V(0.42, 0, 0.66), kTop = kb.clone().add(V(0, 0.28, 0));
    for (let j = 0; j < 3; j++) { const ang = (j / 3) * Math.PI * 2; kit.add(rod(kb.clone().add(V(0, 0.05, 0)), kb.clone().add(V(Math.cos(ang) * 0.18, 0, Math.sin(ang) * 0.18)), 0.006, M.black, 5)); }
    kit.add(rod(kb, kTop, 0.009, M.black, 6)); kit.add(rod(kTop, ktip.clone().addScaledVector(kAxis, -0.17), 0.007, M.black, 6));
    drumMics.push({ mic: km, drum: k.d, r: k.r, h: k.h });
    // (a pencil mic over the hi-hat, from the back, clamped to its stand)
    const hh = V(KIT.hat.x, KIT.hat.y + 0.02, KIT.hat.z), htip = hh.clone().add(V(0.08, 0.18, 0.13)), hm = aimMic(clipMic(M, 'pencil'), htip, hh.clone().add(V(-0.03, 0, 0.03))); kit.add(hm);
    kit.add(rod(V(KIT.hat.x, KIT.hat.y - 0.2, KIT.hat.z), htip.clone().addScaledVector(hh.clone().sub(htip).normalize(), -0.13), 0.006, M.black, 6));
    cableTo(htip.clone().addScaledVector(hh.clone().sub(htip).normalize(), -0.14), 1, 0.08);
  }

  // the people at work (their hands on desks, a pan bar, handles, a counter)
  const crew: Venue['crew'] = [];
  const work = (look: Look, x: number, y: number, z: number, yaw: number, hands: { L?: THREE.Vector3; R?: THREE.Vector3 }, lean?: number) => {
    const c = crewMember(look, x, y, z, yaw, hands, lean); group.add(c.p.group); crew.push(c); return c;
  };
  // a point in o's own space, in the venue's
  const inVenue = (o: THREE.Object3D, p: THREE.Vector3) => { group.updateMatrixWorld(true); return p.clone().applyMatrix4(o.matrixWorld); };
  let FZ = 0;
  if (pub) {
    // ---- the pub's corners: a spare guitar, a case, water; the bartender with both hands on the
    // counter; the band's mate at the laptop that runs the lights
    put(guitarOnStand(M, 'acoustic', 0xc8a070), 3.95, DECK, 0.15, -Math.PI / 2 + 0.3);
    put(roadCase(M, 0.9, 0.62, 0.6, { wheels: true, stencil: 0 }), 3.95, DECK, -1.05, -Math.PI / 2);
    put(waterCrate(M), -4.0, DECK, 3.75, 0.3);
    work({ skin: 0xe8b896, shirt: 0x1d1d22, pants: 0x1a1a1e, shoes: 0x151515, hair: 0x5a3a22, style: 'bun', print: 'BAR' }, -1.5, 0, PUB.z1 - 1.0, Math.PI, { L: V(-1.75, 1.07, PUB.z1 - 1.45), R: V(-1.22, 1.07, PUB.z1 - 1.45) }, 0.14);
    work({ skin: 0xc98d68, shirt: 0x2a3a5a, pants: 0x23262e, shoes: 0xeeeeee, hair: 0x161210, style: 'cap', hat: 0x8a1f1f }, PUB_LAPTOP[0], 0, PUB_LAPTOP[1] + 0.55, Math.PI, { L: V(PUB_LAPTOP[0] - 0.1, 1.04, PUB_LAPTOP[1] + 0.1), R: V(PUB_LAPTOP[0] + 0.13, 1.04, PUB_LAPTOP[1] + 0.1) }, 0.15);
  } else {
  // ---- monitor world, stage left: the desk on its case facing the band, the engineer at it with
  // both hands on faders, the in-ear rack beside them; side fills either side of the stage. Stage
  // right: the guitar tech's spare guitars on stands, a case with a laptop, water.
  const mon = put(desk(M, 'monitor'), W / 2 + 1.0, DECK, 0.85, Math.PI / 2);
  work({ skin: 0xc98d68, shirt: 0x111111, pants: 0x1a1a1e, shoes: 0x111111, hair: 0x161210, style: 'cap', hat: 0x111111, print: 'CREW' },
    W / 2 + 1.62, DECK, 0.85, -Math.PI / 2, { L: inVenue(mon, mon.userData.hands.L), R: inVenue(mon, mon.userData.hands.R) });
  put(iemRack(M), W / 2 + 1.55, DECK, -0.35);
  for (const sx of [-1, 1]) put(sideFill(M), sx * 6.95, DECK, 1.35, sx > 0 ? -1.28 : 1.28);
  ([['single', 0xc04a1a], ['acoustic', 0xc8a070], ['bass', 0x141414]] as const).forEach(([kind, c], i) => put(guitarOnStand(M, kind, c), -(W / 2 + 1.35), DECK, 0.75 + i * 0.55, Math.PI / 2));
  const tech = put(roadCase(M, 0.9, 0.78, 0.55, { stencil: 4 }), -(W / 2 + 1.4), DECK, 2.7, Math.PI / 2);
  { const lap = new THREE.Group(); lap.add(at(box(0.33, 0.015, 0.23, M.plastic), 0, 0.008, 0)); const l = box(0.33, 0.22, 0.01, M.plastic); l.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), new THREE.MeshBasicMaterial({ map: screen('laptop') })), 0, 0, 0.006)); lap.add(at(l, 0, 0.11, -0.12, [-0.25, 0, 0])); lap.position.set(0.1, 0.79, 0); tech.add(lap); }
  put(waterCrate(M), -(W / 2 + 0.85), DECK, 3.35, 0.3); put(waterCrate(M), W / 2 + 1.5, DECK, 2.1, -0.2);

  // ---- road cases on the hall floor beside the stage and behind it (stencilled, some stacked)
  for (const [x, z, yaw, k, up] of [[-10.3, -1.2, 0.1, 0, 0], [-10.3, -1.2, 0.1, 3, 1], [-10.5, -2.5, -0.05, 4, 0], [10.4, -1.5, -0.1, 6, 0], [10.4, -2.7, 0.05, 7, 0], [10.4, -2.7, 0.05, 1, 1],
    [-3.2, -6.6, 0.2, 0, 0], [-2.0, -6.9, -0.1, 3, 0], [3.4, -7.2, 0.3, 5, 0], [3.4, -7.2, 0.3, 1, 1]] as [number, number, number, number, number][]) {
    put(roadCase(M, 1.0, 0.75, 0.65, { wheels: !up, stencil: k }), x, up ? 0.86 : 0, z, yaw);
  }

  // ---- barricade with a banner
  for (let x = -12; x <= 12; x += 1.2) {
    const f = new THREE.Group(); f.add(at(box(1.15, 1.1, 0.05, M.alu), 0, 0.55, 0)); f.add(at(box(1.15, 0.03, 0.9, M.alu), 0, 0.02, 0.45));
    add(f, x, 0, D / 2 + 1.8);
  }
  const fence = new THREE.Mesh(new THREE.PlaneGeometry(25, 0.9), std({ map: printBand('barricade', { w: 4096, h: 160, accent: '#36d6e7', logo: false }), roughness: 0.9 }));
  fence.rotation.y = Math.PI; add(fence, 0, 0.6, D / 2 + 1.77);

  // ---- FOH: a carpeted riser behind the crowd (no roof: it's indoors, and the front view looks over
  // it), a barrier round it, the sound and lighting desks with their engineers, a rack, a camera on
  // a tripod with its operator
  FZ = D / 2 + 17; const FH = 0.3;
  const foh = put(new THREE.Group(), 0, 0, FZ);
  foh.add(at(box(6.4, FH, 4.0, [M.drape, M.drape, std({ color: 0x18181c, roughness: 1 }), M.black, M.drape, M.drape]), 0, FH / 2, 0));
  const rail = (x: number, z: number, yaw: number) => { const f = new THREE.Group(); f.add(at(box(1.15, 1.1, 0.05, M.alu), 0, 0.55, 0)); f.add(at(box(1.15, 0.03, 0.6, M.alu), 0, 0.02, 0.3)); foh.add(at(f, x, 0, z, [0, yaw, 0])); };
  for (let x = -2.4; x <= 2.41; x += 1.2) rail(x, -2.25, Math.PI);
  for (const sx of [-1, 1]) for (let z = -1.6; z <= 1.61; z += 1.2) rail(sx * 3.45, z, sx * Math.PI / 2);
  const sd = desk(M, 'sound'), ld = desk(M, 'light'); foh.add(at(sd, -1.45, FH, -0.55), at(ld, 1.45, FH, -0.55));
  const outboard = roadCase(M, 0.62, 1.0, 0.7, { stencil: 0 }); outboard.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.6), std({ map: rackFront(23), roughness: 0.6, metalness: 0.4, emissive: 0x112233, emissiveIntensity: 0.25 })), 0, 0.5, 0.352)); foh.add(at(outboard, -2.75, FH, 0.55, [0, Math.PI / 2, 0]));
  const cam = cameraTripod(M); foh.add(cam);
  { const cx = 2.65, cz = -1.35; at(cam, cx, FH, cz, [0, Math.atan2(-cx, -(FZ + cz)), 0]); }
  group.updateMatrixWorld(true);
  const deskHands = (dk: THREE.Object3D) => ({ L: inVenue(dk, dk.userData.hands.L), R: inVenue(dk, dk.userData.hands.R) });
  work({ skin: 0xf1c8a8, shirt: 0x3a3d44, pants: 0x2a3a5a, shoes: 0x222222, hair: 0x7a5230, style: 'short', beard: true, sleeves: 'long' }, -1.45, FH, FZ + 0.07, Math.PI, deskHands(sd));
  work({ skin: 0xe0ac86, shirt: 0x121212, pants: 0x141418, shoes: 0x151515, hair: 0x3a2414, style: 'beanie', hat: 0x2a4a2a, print: 'LX' }, 1.45, FH, FZ + 0.07, Math.PI, deskHands(ld));
  { const p = inVenue(cam, V(-0.08, 0, -0.36)); work({ skin: 0x9c6544, shirt: 0x1f2f3b, pants: 0x222222, shoes: 0x111111, hair: 0x161210, style: 'curly' }, p.x, FH, p.z, cam.rotation.y, { L: inVenue(cam, cam.userData.hands.L), R: inVenue(cam, cam.userData.hands.R) }, 0.1); }

  // ---- two follow spots on scaffold towers at the back of the hall, on the singer, an operator
  // behind each with both hands on its handles
  for (const sx of [-1, 1]) {
    const T = V(sx * 10.6, 0, FZ + 3.2), top = 2.62, target = V(0, DECK + 1.6, 2.0);
    group.add(at(scaffold(M, 2.4, 2.6), T.x, 0, T.z));
    const d = V(target.x - T.x, 0, target.z - T.z).normalize(), sp = T.clone().addScaledVector(d, 0.45).setY(top);
    const spot = followSpot(M, target.clone().sub(sp)); spot.position.copy(sp); group.add(spot);
    const h = spot.userData.hands as { L: THREE.Vector3; R: THREE.Vector3 }, op = sp.clone().addScaledVector(d, -1.2);
    work(sx < 0 ? { skin: 0xf6d5bb, shirt: 0x111111, pants: 0x141418, shoes: 0x151515, hair: 0x9a6a34, style: 'bun', print: 'CREW' } : { skin: 0x7a4e34, shirt: 0x111111, pants: 0x1a1a1e, shoes: 0x111111, hair: 0x161210, style: 'short', print: 'CREW' },
      op.x, top, op.z, Math.atan2(d.x, d.z), { L: h.L.clone().add(sp), R: h.R.clone().add(sp) });
  }
  }

  // ---- the audience (crowd.ts): from behind the barricade back to FOH, round its riser; in the pub
  // a few dozen between the PA and the bar stools, round the tables (nobody on shoulders, no flags)
  // (a computer drawing without a graphics chip, like the test browser, gets a smaller crowd)
  const crowd = pub
    ? buildCrowd(o.crowd ?? (softwareGL() ? 24 : 40), {
      z0: D / 2 + 1.2, z1: PUB.z1 - 3.0, spread: () => PUB.x - 0.7, riders: 0, flags: 0,
      keepOut: (x, z) => PUB_TABLES.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < 0.75) || (x > PUB_LAPTOP[0] - 0.8 && z > PUB_LAPTOP[1] - 0.6),
    })
    : buildCrowd(o.crowd ?? (softwareGL() ? 160 : 420), {
      z0: D / 2 + 2.6, z1: D / 2 + 15.8, spread: (z) => Math.min(14.5, 6 + (z - D / 2) * 0.6),
      keepOut: (x, z) => Math.abs(x) < 3.75 && z > FZ - 2.6, banner: backdrop, flags: 10,
    });
  group.add(crowd.group);
  let shown = 0;

  // the band's name everywhere it shows (empty: their picture, and the printed name they had)
  function setBand(n?: string) {
    const name = (n ?? '').trim();
    if (name === bandName) return;
    bandName = name;
    for (const { s } of surfaces) s.show(name);
    for (const p of printed) p.set(name.toUpperCase());
    screenName = name.toUpperCase() || BAND; lastScreen = -1;
  }
  const bandInfo = () => ({
    name: bandName,
    surfaces: [...surfaces.map(({ what, s }) => ({ what, shows: s.shown(), t: s.t })), ...printed.map((p) => ({ what: p.what, shows: p.shows(), t: p.t })), { what: 'screens', shows: screenName, t: scrTex as THREE.Texture }]
      .map(({ what, shows, t }) => ({ what, shows, uuid: t.uuid, version: t.version })),
  });

  // The beat as the engine counts it moves in steps (40 a second, the frames come at 60): the band
  // plays on a clock that runs on at the tempo between them and is pulled gently onto the count (a
  // jump in the song, or a moment out of order as the tests ask for, is taken as it is)
  let clock = NaN, clockT = 0;
  const beatAt = (t: number, beat: number) => {
    const dt = t - clockT; clockT = t;
    if (!(dt > 0 && dt < 0.1) || !Number.isFinite(clock)) return (clock = beat);
    clock += dt / crowdBeatLen();
    const err = beat - clock;
    if (Math.abs(err) > 0.25) clock = beat; else clock += err * 0.15;
    return clock;
  };
  let rest: number | null = null;
  function animate(t: number, beat: number, energy: number, col: THREE.Color, music = true) {
    // (the crowd comes in on the second frame: the first, with the stage and the hall, shows sooner)
    if (!crowd.group.visible && ++shown > 1) crowd.group.visible = true;
    crowd.update(t, beat, energy, col);
    // the band moves with the crowd's excitement (it follows the lights: calm in a quiet intro, all
    // out at a drop). No music: they stop where the last bar began (sticks down on the drums, the
    // strumming hands still) and wait, not miming to nothing
    if (!music) rest ??= Math.floor((Number.isFinite(clock) ? clock : beat) / 4) * 4;
    else rest = null;
    const b = rest ?? beatAt(t, beat), e = rest === null ? crowd.excitement() : 0;
    for (const m of band) m.play(b, e, t);
    // the screens: ten times a second is plenty (not while they show the live camera)
    if (scrMat.map === scrTex && (t - lastScreen > 0.1 || t < lastScreen)) { lastScreen = t; paintScreens(t, beat, energy, col); }
  }
  // Everything that never moves is baked into a few meshes (hundreds of props: a few dozen draws).
  // What moves is found by playing a few moments and looking (the band; the crowd and the screens
  // move through their shaders and pictures). What's left gets its matrices once.
  const white = new THREE.Color(1, 1, 1);
  const live = movingMeshes(group, (k) => animate(k * 1.37, k ? 2.3 + k * 3.9 : 0, k ? 0.85 : 0, white));
  // (the band's bodies and limbs, the pedals and the hi-hat's top move whatever the moments played
  // showed: never baked into the stage, never frozen)
  const kept = new Set(alive);
  const baked = bake(group, (x) => live.has(x) || kept.has(x) || x === crowd.group);
  const moving = new Set<THREE.Object3D>([...band.map((b) => b.p.group), ...alive]);
  const freeze = (x: THREE.Object3D) => { if (moving.has(x)) return; x.updateMatrix(); x.matrixAutoUpdate = false; x.children.forEach(freeze); };
  group.children.forEach(freeze);
  crowd.group.visible = false;
  setBand(o.band);
  return { group, animate, crowdCount: crowd.count, band: band.map((b) => b.p), mics, drums: kitInfo, strummers, crowd, crew, drumMics, baked, room, setBand, bandInfo, screens: { mat: scrMat, painted: scrTex } };
}
