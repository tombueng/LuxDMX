// The scenes the Cinema and Bar templates play in: real rooms, not the concert stage with a
// banner. Built from their room (geometry.ts ROOMS.cinema / ROOMS.bar) into the room's group;
// rooms.ts bakes what doesn't move. The templates hang their lights where these rooms have their
// places for them (content/scenePlaces.ts), so a template opens with every light installed.
//
// The cinema: a big screen between red velvet curtains, a stage in front of it for premieres,
// raked rows of red seats (an audience in many of them), aisles with step lights, acoustic panels
// on the side walls, a dark ceiling with a field of small stars, the projection booth's window at
// the back.
//
// The bar: a long, high bar along the back wall, its counter with a foot rail, a back bar of lit
// shelves full of bottles in front of a mirror, a neon sign, pendant lamps; stools with people on
// them, bartenders behind it; tables at the sides, a little dance floor in front with a mirror
// ball, a ceiling rail for the lights.
import * as THREE from 'three';
import { at, box, cyl, rod, std, house, crewMember, type Mats } from './gear';
import { darkWood, hallWall, neonSign, pleats, rug, stageFloor, brick, boards, concrete } from './textures';
import { DECK, type Room } from './geometry';
import { BAR, CHURCH, CINEMA, cinemaFloor, THEATRE } from './sceneSizes';
import type { Person } from './people';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
type Look = Parameters<typeof crewMember>[0];
const LOOKS: Look[] = [
  { skin: 0xe8b896, shirt: 0x1f2f3b, pants: 0x1e2a44, shoes: 0x151515, hair: 0x2b1d14, style: 'short' },
  { skin: 0xc98d68, shirt: 0x8a1f1f, pants: 0x141418, shoes: 0x1a1a1a, hair: 0x161210, style: 'long' },
  { skin: 0xf1c8a8, shirt: 0xd8d8d0, pants: 0x2a3a5a, shoes: 0xeeeeee, hair: 0xb08a50, style: 'bun' },
  { skin: 0x9c6544, shirt: 0x2a6a8a, pants: 0x23262e, shoes: 0x111111, hair: 0x161210, style: 'curly' },
  { skin: 0xe0ac86, shirt: 0x3b1f2b, pants: 0x1a1a1e, shoes: 0x151515, hair: 0x5a3a22, style: 'short', beard: true },
  { skin: 0xf6d5bb, shirt: 0xe0a030, pants: 0x3a3226, shoes: 0x2a2a2a, hair: 0x8a3a24, style: 'long' },
  { skin: 0x7a4e34, shirt: 0x5a1a1a, pants: 0x1e2a44, shoes: 0xd8d8d0, hair: 0x161210, style: 'shaved' },
  { skin: 0xe8b896, shirt: 0x203a5a, pants: 0x141418, shoes: 0x111111, hair: 0x3a2414, style: 'beanie', hat: 0x8a1f1f },
];

// ---- the cinema ------------------------------------------------------------------------------
export function buildCinema(group: THREE.Group, M: Mats, r: Room) {
  const add = (o: THREE.Object3D, x: number, y: number, z: number, rot?: [number, number, number]) => group.add(at(o, x, y, z, rot));
  const C = CINEMA, X = r.walls.x, Z0 = r.walls.z0, Z1 = r.walls.z1, H = r.ceiling;
  const wallMat = house(new THREE.MeshBasicMaterial({ map: hallWall(), color: 0x2a2228 }));
  const carpet = std({ map: rug(), color: 0x5a2030, roughness: 0.95 });
  const velvet = std({ map: pleats(), color: 0x8a0f1c, roughness: 0.85, emissive: 0x3a0408, emissiveIntensity: 0.9 });   // (lit a little, as a cinema's curtains are)
  const fabric = std({ color: 0x7a1018, roughness: 0.9 }), seatBack = std({ color: 0x5e0c14, roughness: 0.9 });
  const panel = std({ color: 0x1d2433, roughness: 0.95 }), trim = std({ color: 0xb08a50, metalness: 0.7, roughness: 0.35 });
  // the room: walls, a dark ceiling, the carpet
  const L = Z1 - Z0, zc = (Z0 + Z1) / 2;
  add(new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat), -X, H / 2, zc, [0, Math.PI / 2, 0]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat), X, H / 2, zc, [0, -Math.PI / 2, 0]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * X, H), wallMat), 0, H / 2, Z1, [0, Math.PI, 0]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * X, H), M.black), 0, H / 2, Z0 + 0.01);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * X, L), house(new THREE.MeshBasicMaterial({ color: 0x08080b }))), 0, H, zc, [Math.PI / 2, 0, 0]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * X, L), carpet), 0, 0.002, zc, [-Math.PI / 2, 0, 0]);
  // a field of small stars on the ceiling (the Ceiling bars make the bright ones)
  const star = new THREE.MeshBasicMaterial({ color: 0xfff3d6, toneMapped: false });
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 240; i++) add(new THREE.Mesh(new THREE.SphereGeometry(0.018 + rnd() * 0.02, 6, 4), star), (rnd() * 2 - 1) * (X - 0.5), H - 0.02, 2 + rnd() * (Z1 - 4));

  // the screen: a soft picture (a film's first frame), a black frame round it
  const scr = document.createElement('canvas'); scr.width = 512; scr.height = 218;
  const g = scr.getContext('2d');
  // (no 2D canvas, the tests' page: a blank screen)
  if (g) {
    const gr = g.createLinearGradient(0, 0, 0, 218); gr.addColorStop(0, '#2a3f66'); gr.addColorStop(0.55, '#d8865a'); gr.addColorStop(1, '#1a1410');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 218);
    g.fillStyle = '#0d0b0a'; g.beginPath(); g.moveTo(0, 170); for (let x = 0; x <= 512; x += 16) g.lineTo(x, 150 + Math.sin(x * 0.03) * 14 + Math.sin(x * 0.11) * 6); g.lineTo(512, 218); g.lineTo(0, 218); g.fill();
    g.fillStyle = '#fff3d6cc'; g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.fillText('NOW SHOWING', 256, 60);
  }
  const tex = new THREE.CanvasTexture(scr); tex.colorSpace = THREE.SRGBColorSpace;
  const screenMat = new THREE.MeshBasicMaterial({ map: tex, color: 0x9a9a9a });
  add(new THREE.Mesh(new THREE.PlaneGeometry(C.screenW, C.screenH), screenMat), 0, C.screenY + C.screenH / 2, C.screenZ);
  add(box(C.screenW + 0.6, C.screenH + 0.6, 0.08, M.black), 0, C.screenY + C.screenH / 2, C.screenZ - 0.06);
  // the curtains either side, gathered; the valance over the screen with a gold trim
  for (const sx of [-1, 1]) {
    const w = X - C.screenW / 2 - 0.2;
    add(new THREE.Mesh(new THREE.PlaneGeometry(w, H - 0.6, 24, 1).translate(0, 0, 0), velvet), sx * (C.screenW / 2 + 0.2 + w / 2), (H - 0.6) / 2, C.screenZ + 0.25);
    add(box(0.5, H - 0.6, 0.35, velvet), sx * (C.screenW / 2 + 0.35), (H - 0.6) / 2, C.screenZ + 0.3);
  }
  add(box(2 * X - 0.2, 1.1, 0.4, velvet), 0, C.screenY + C.screenH + 0.95, C.screenZ + 0.3);
  add(box(2 * X - 0.2, 0.06, 0.42, trim), 0, C.screenY + C.screenH + 0.38, C.screenZ + 0.3);

  // the stage in front of the screen (the room's deck): black, a gold edge, steps down in the middle
  const { x: dx, z0, z1 } = r.deck, dd = z1 - z0, top = std({ map: stageFloor(), roughness: 0.72 });
  add(new THREE.Mesh(new THREE.BoxGeometry(2 * dx, DECK, dd), [M.black, M.black, top, M.black, M.black, M.black]), 0, DECK / 2, (z0 + z1) / 2);
  add(box(2 * dx, 0.04, 0.03, trim), 0, DECK - 0.03, z1 + 0.01);
  for (let i = 0; i < 4; i++) { const h = (DECK / 4) * (4 - i); add(box(2.4, h, 0.32, carpet), 0, h / 2, z1 + 0.16 + 0.32 * i); }

  // the rows: each a step of carpet, red seats on it in three blocks (the aisles between), the
  // aisles' step lights; an audience in many of the seats
  const blocks: [number, number][] = [[-X + 1.0, C.aisles[0] - 0.6], [C.aisles[0] + 0.6, C.aisles[1] - 0.6], [C.aisles[1] + 0.6, X - 1.0]];
  const stepLed = new THREE.MeshBasicMaterial({ color: 0xffb060, toneMapped: false });
  const skin = [0xe8b896, 0xc98d68, 0xf1c8a8, 0x9c6544, 0x7a4e34].map((c) => std({ color: c, roughness: 0.6 }));
  const tops = [0x1f2f3b, 0x8a1f1f, 0xd8d8d0, 0x2a6a8a, 0x3b1f2b, 0x203a5a, 0xe0a030, 0x141418].map((c) => std({ color: c, roughness: 0.9 }));
  const hairs = [0x161210, 0x2b1d14, 0x5a3a22, 0xb08a50, 0x8a8a88].map((c) => std({ color: c, roughness: 0.8 }));
  for (let rr = 0; rr < C.rows; rr++) {
    const z = C.rowZ0 + rr * C.rowD, y = (rr + 1) * C.rowRise;
    add(box(2 * X, y, C.rowD, carpet), 0, y / 2, z + C.rowD / 2);
    for (const ax of C.aisles) add(box(0.6, 0.02, 0.02, stepLed), ax, y + 0.01, z + 0.02);
    for (const [a, b] of blocks) {
      for (let x = a + 0.3; x <= b - 0.25; x += 0.6) {
        const sz = z + 0.5;
        add(box(0.52, 0.12, 0.48, fabric), x, y + 0.42, sz);
        add(box(0.54, 0.62, 0.09, seatBack), x, y + 0.72, sz + 0.27, [-0.12, 0, 0]);
        add(box(0.06, 0.24, 0.5, M.black), x + 0.29, y + 0.52, sz);
        // (some 60 % of the seats taken, by a hash of where they are: the same audience every time)
        const h = Math.abs(Math.sin(x * 12.9898 + rr * 78.233) * 43758.5453) % 1;
        if (h < 0.6) {
          const k = Math.floor(h * 1000);
          add(box(0.38, 0.5, 0.24, tops[k % tops.length]), x, y + 0.78, sz + 0.05);
          add(new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10), skin[k % skin.length]), x, y + 1.17, sz + 0.02);
          add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairs[(k >> 3) % hairs.length]), x, y + 1.19, sz + 0.05);
        }
      }
    }
  }
  // the back: the rows end at a wall with the projection booth's window
  const rowsEnd = C.rowZ0 + C.rows * C.rowD, backY = C.rows * C.rowRise;
  add(box(2 * X, backY, Z1 - rowsEnd, carpet), 0, backY / 2, (rowsEnd + Z1) / 2);
  const win = new THREE.MeshBasicMaterial({ color: 0x4a6a9a, toneMapped: false });
  add(new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), win), 0, backY + 3.0, Z1 - 0.02, [0, Math.PI, 0]);
  // acoustic panels along the side walls, gold trims between them; the exits with their signs
  for (const sx of [-1, 1]) {
    for (let z = 2; z < Z1 - 2; z += 3) {
      add(box(0.12, 4.2, 2.6, panel), sx * (X - 0.07), cinemaFloor(z) + 3.4, z + 1.3);
      add(box(0.14, 4.2, 0.08, trim), sx * (X - 0.07), cinemaFloor(z) + 3.4, z + 2.75);
    }
  }
  return { animate: () => {} };
}

// ---- the bar --------------------------------------------------------------------------------
export function buildBar(group: THREE.Group, M: Mats, r: Room) {
  const add = (o: THREE.Object3D, x: number, y: number, z: number, rot?: [number, number, number]) => group.add(at(o, x, y, z, rot));
  const B = BAR, X = r.walls.x, Z0 = r.walls.z0, Z1 = r.walls.z1, H = r.ceiling, L = Z1 - Z0, zc = (Z0 + Z1) / 2;
  const wood = std({ map: darkWood(), roughness: 0.35 }), floor = std({ map: boards(), color: 0x8a6a4a, roughness: 0.6 });
  const wall = house(new THREE.MeshBasicMaterial({ map: brick(), color: 0x6a5048 }));
  // the room: brick, a dark ceiling, wooden boards; the dance floor's dark glossy squares
  add(new THREE.Mesh(new THREE.PlaneGeometry(L, H), wall), -X, H / 2, zc, [0, Math.PI / 2, 0]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(L, H), wall), X, H / 2, zc, [0, -Math.PI / 2, 0]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * X, H), wall), 0, H / 2, Z0);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * X, H), wall), 0, H / 2, Z1, [0, Math.PI, 0]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * X, L), house(new THREE.MeshBasicMaterial({ color: 0x0c0b0b }))), 0, H, zc, [Math.PI / 2, 0, 0]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * X, L), floor), 0, 0.002, zc, [-Math.PI / 2, 0, 0]);
  const gloss = std({ color: 0x0b0c10, roughness: 0.12, metalness: 0.4 });
  for (let i = 0; i < 6; i++) for (let k = 0; k < 4; k++) add(box(1.15, 0.01, 1.1, gloss), -B.dance.x + 0.6 + i * 1.2, 0.006, B.dance.z0 + 0.6 + k * 1.15);

  // the back bar: a big mirror, four shelves of bottles, each lit along its front edge
  const mirror = std({ color: 0x9aa4b0, metalness: 1, roughness: 0.05 });
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * B.counterX - 0.6, 2.0), mirror), 0, 2.05, B.backZ - 0.12);
  add(box(2 * B.counterX + 0.2, 1.05, 0.55, wood), 0, 0.52, B.backZ + 0.15);                        // (the low back counter, the fridges)
  const glass = [0x2f6b2a, 0x8a4a12, 0xd8e2e0, 0x24406e, 0x6a1420, 0xc8a046].map((color) => std({ color, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.85 }));
  const strip = new THREE.MeshBasicMaterial({ color: 0xffb060, toneMapped: false });
  B.shelves.forEach((y, k) => {
    add(box(2 * B.counterX - 0.6, 0.035, 0.28, wood), 0, y, B.backZ);
    add(box(2 * B.counterX - 0.6, 0.012, 0.02, strip), 0, y - 0.025, B.backZ + 0.13);
    for (let i = 0; i < 52; i++) {
      const x = -B.counterX + 0.55 + i * 0.21 + (k % 2) * 0.08, m = glass[(i * 5 + k * 3) % glass.length], tall = (i + k) % 3 ? 0 : 0.06;
      add(cyl(0.034, 0.034, 0.2 + tall, m, 10), x, y + 0.12 + tall / 2, B.backZ + 0.01);
      add(cyl(0.011, 0.034, 0.05, m, 10), x, y + 0.245 + tall, B.backZ + 0.01);
    }
  });
  add(new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.75), new THREE.MeshBasicMaterial({ map: neonSign('Cocktails', '#36d6e7'), toneMapped: false })), 0, 3.35, B.backZ - 0.1);
  // the counter: wood, a brass foot rail, a lit line under its top, taps, glasses
  const cl = 2 * B.counterX;
  add(box(cl, B.counterH - 0.06, 0.62, wood), 0, (B.counterH - 0.06) / 2, B.counterZ);
  add(box(cl + 0.1, 0.06, 0.82, std({ color: 0x1a1210, roughness: 0.25, metalness: 0.1 })), 0, B.counterH - 0.03, B.counterZ - 0.05);
  add(box(cl, 0.015, 0.02, strip), 0, B.counterH - 0.09, B.counterZ + 0.33);
  group.add(rod(V(-B.counterX, 0.22, B.counterZ + 0.46), V(B.counterX, 0.22, B.counterZ + 0.46), 0.024, M.brass, 10));
  for (let i = 0; i < 6; i++) { const x = -1.2 + i * 0.32; add(cyl(0.02, 0.02, 0.32, M.chrome, 8), x, B.counterH + 0.16, B.counterZ - 0.15); add(cyl(0.012, 0.016, 0.16, i % 2 ? M.black : M.brass, 8), x, B.counterH + 0.4, B.counterZ - 0.15); }
  const beer = std({ color: 0xd8901c, roughness: 0.2 }), wine = std({ color: 0x6a1420, roughness: 0.2 });
  // pendant lamps over the counter (their shades; two of them are the template's Counter lights)
  const bulb = new THREE.MeshBasicMaterial({ color: 0xffc27a, toneMapped: false });
  for (let x = -5; x <= 5.01; x += 2) { add(cyl(0.004, 0.004, H - 2.55, M.black, 4), x, (H + 2.55) / 2, B.counterZ); add(cyl(0.06, 0.2, 0.22, M.brass, 18), x, 2.5, B.counterZ); add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), bulb), x, 2.42, B.counterZ); }
  // stools along it; people on some, standing at it, two bartenders behind it
  const people: Person[] = [];
  const stoolXs = Array.from({ length: 13 }, (_, i) => -5.4 + i * 0.9);
  stoolXs.forEach((x, i) => {
    const z = B.counterZ + 0.85;
    add(cyl(0.2, 0.18, 0.06, std({ color: 0x3a1a12, roughness: 0.6 }), 16), x, 0.8, z); add(cyl(0.025, 0.025, 0.78, M.chrome, 8), x, 0.4, z); add(cyl(0.21, 0.23, 0.02, M.chrome, 16), x, 0.01, z);
    if (i % 2 === 0 || i === 7) {
      // (sitting on it, facing the bar, elbows on the counter, a drink in front)
      const look = LOOKS[i % LOOKS.length];
      const c = crewMember(look, x, 0, z + 0.05, Math.PI, { L: V(x + 0.18, B.counterH + 0.05, B.counterZ + 0.12), R: V(x - 0.2, B.counterH + 0.05, B.counterZ + 0.15) }, 0.12);
      c.p.pose({ seat: 0.83, feet: { L: V(0.13, 0.25, 0.3), R: V(-0.13, 0.25, 0.32) } });
      group.add(c.p.group); people.push(c.p);
      add(cyl(0.035, 0.03, 0.15, i % 4 ? beer : wine, 10), x + 0.05, B.counterH + 0.075, B.counterZ - 0.05);
    }
  });
  for (const [x, k] of [[-2.9, 3], [3.2, 5], [5.6, 6]] as const) {
    const c = crewMember(LOOKS[k], x, 0, B.counterZ + 0.7, Math.PI + 0.15, { R: V(x - 0.15, B.counterH + 0.04, B.counterZ + 0.2) }, 0.04);
    group.add(c.p.group); people.push(c.p);
  }
  for (const [x, k] of [[-1.6, 2], [2.4, 0]] as const) {
    const c = crewMember({ ...LOOKS[k], shirt: 0x111111, print: 'BAR' }, x, 0, B.counterZ - 0.75, 0, { L: V(x + 0.2, B.counterH + 0.03, B.counterZ - 0.3), R: V(x - 0.2, B.counterH + 0.03, B.counterZ - 0.3) }, 0.1);
    group.add(c.p.group); people.push(c.p);
  }
  // tables with chairs and a candle along the side walls; people at some
  const candle = new THREE.MeshBasicMaterial({ color: 0xffa040, toneMapped: false });
  for (const sx of [-1, 1]) for (const z of [1.2, 3.6, 6.0]) {
    const tx = sx * (X - 1.3);
    add(cyl(0.42, 0.42, 0.04, wood, 20), tx, 0.74, z); add(cyl(0.05, 0.05, 0.72, M.black, 8), tx, 0.37, z); add(cyl(0.28, 0.3, 0.03, M.black, 16), tx, 0.015, z);
    add(cyl(0.03, 0.03, 0.06, std({ color: 0xf0e8d8, roughness: 0.5 }), 8), tx, 0.79, z); add(new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), candle), tx, 0.83, z);
    for (const dz of [-0.62, 0.62]) { add(box(0.42, 0.04, 0.42, wood), tx, 0.46, z + dz); add(box(0.42, 0.5, 0.04, wood), tx, 0.72, z + dz + Math.sign(dz) * 0.2); for (const [ex, ez] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) add(box(0.03, 0.45, 0.03, M.black), tx + ex, 0.225, z + dz + ez); }
    if ((sx > 0) !== (z > 3)) {
      const c = crewMember(LOOKS[(Math.round(z) + (sx > 0 ? 3 : 0)) % LOOKS.length], tx, 0, z + 0.62, Math.PI, { L: V(tx + 0.15, 0.78, z + 0.2), R: V(tx - 0.15, 0.78, z + 0.22) }, 0.1);
      c.p.pose({ seat: 0.48, feet: { L: V(0.12, 0.09, 0.36), R: V(-0.12, 0.09, 0.38) } });
      group.add(c.p.group); people.push(c.p);
    }
  }
  // the ceiling rail the lights hang on (a square of pipe over the room, one over the dance floor)
  const pipe = std({ color: 0x1a1b1e, metalness: 0.6, roughness: 0.45 });
  for (const z of [-0.6, 2.4, 5.0, 7.4]) group.add(rod(V(-X + 0.6, B.rail, z), V(X - 0.6, B.rail, z), 0.025, pipe, 8));
  for (const x of [-X + 0.6, X - 0.6]) group.add(rod(V(x, B.rail, -0.6), V(x, B.rail, 7.4), 0.025, pipe, 8));
  // the mirror ball over the dance floor
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 14), std({ color: 0xe8ecf2, metalness: 1, roughness: 0.08, flatShading: true }));
  add(ball, B.ball.x, B.ball.y, B.ball.z); add(cyl(0.006, 0.006, H - B.ball.y - 0.28, M.chrome, 5), B.ball.x, (H + B.ball.y + 0.28) / 2, B.ball.z);
  ball.userData.live = true;
  return { people, animate: (t: number) => { ball.rotation.y = t * 0.6; } };
}

// ---- seats and the people in them (the cinema's way, for the theatre's stalls and balcony too) ----
type Add = (o: THREE.Object3D, x: number, y: number, z: number, rot?: [number, number, number]) => void;
function audienceMats() {
  return {
    skin: [0xe8b896, 0xc98d68, 0xf1c8a8, 0x9c6544, 0x7a4e34].map((c) => std({ color: c, roughness: 0.6 })),
    tops: [0x1f2f3b, 0x8a1f1f, 0xd8d8d0, 0x2a6a8a, 0x3b1f2b, 0x203a5a, 0xe0a030, 0x141418].map((c) => std({ color: c, roughness: 0.9 })),
    hairs: [0x161210, 0x2b1d14, 0x5a3a22, 0xb08a50, 0x8a8a88].map((c) => std({ color: c, roughness: 0.8 })),
  };
}
// a person sitting at (x, y = the seat's floor, z), facing the front (-z); `taken` decides who
function sitter(add: Add, A: ReturnType<typeof audienceMats>, x: number, y: number, z: number, k: number, seat = 0.42) {
  add(box(0.38, 0.5, 0.24, A.tops[k % A.tops.length]), x, y + seat + 0.36, z + 0.05);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10), A.skin[k % A.skin.length]), x, y + seat + 0.75, z + 0.02);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), A.hairs[(k >> 3) % A.hairs.length]), x, y + seat + 0.77, z + 0.05);
}
const taken = (x: number, r: number, share: number) => { const h = Math.abs(Math.sin(x * 12.9898 + r * 78.233) * 43758.5453) % 1; return h < share ? Math.floor(h * 1000) + 1 : 0; };
function seatRow(add: Add, M: Mats, A: ReturnType<typeof audienceMats>, mats: { seat: THREE.Material; back: THREE.Material }, y: number, z: number, blocks: [number, number][], r: number, share = 0.6) {
  for (const [a, b] of blocks) for (let x = a + 0.3; x <= b - 0.25; x += 0.6) {
    add(box(0.52, 0.12, 0.48, mats.seat), x, y + 0.42, z);
    add(box(0.54, 0.62, 0.09, mats.back), x, y + 0.72, z + 0.27, [-0.12, 0, 0]);
    add(box(0.06, 0.24, 0.5, M.black), x + 0.29, y + 0.52, z);
    const k = taken(x, r, share);
    if (k) sitter(add, A, x, y, z, k);
  }
}

// ---- the theatre ----------------------------------------------------------------------------
export function buildTheatre(group: THREE.Group, M: Mats, r: Room) {
  const add: Add = (o, x, y, z, rot) => { group.add(at(o, x, y, z, rot)); };
  const T = THEATRE, X = r.walls.x, Z0 = r.walls.z0, Z1 = r.walls.z1, H = r.ceiling, L = Z1 - Z0, zc = (Z0 + Z1) / 2;
  const wallMat = house(new THREE.MeshBasicMaterial({ map: hallWall(), color: 0x3a1a1e }));
  const carpet = std({ map: rug(), color: 0x6a1a24, roughness: 0.95 });
  const velvet = std({ map: pleats(), color: 0x8a0f1c, roughness: 0.85, emissive: 0x2a0306, emissiveIntensity: 0.9 });
  const gold = std({ color: 0xc8a046, metalness: 0.8, roughness: 0.3 }), cream = std({ color: 0xd8ccb0, roughness: 0.6 });
  const fabric = std({ color: 0x7a1018, roughness: 0.9 }), back = std({ color: 0x5e0c14, roughness: 0.9 }), A = audienceMats();
  add(new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat), -X, H / 2, zc, [0, Math.PI / 2, 0]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat), X, H / 2, zc, [0, -Math.PI / 2, 0]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * X, H), wallMat), 0, H / 2, Z1, [0, Math.PI, 0]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * X, H), M.black), 0, H / 2, Z0 + 0.01);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * X, L), house(new THREE.MeshBasicMaterial({ color: 0x120a0c }))), 0, H, zc, [Math.PI / 2, 0, 0]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * X, L), carpet), 0, 0.002, zc, [-Math.PI / 2, 0, 0]);
  // the stage and its apron (the deck), black; the cyclorama at the back, pale, for the lights to colour
  const { x: dx, z0, z1 } = r.deck, top = std({ map: stageFloor(), roughness: 0.72 });
  add(new THREE.Mesh(new THREE.BoxGeometry(2 * dx, DECK, z1 - z0), [M.black, M.black, top, M.black, M.black, M.black]), 0, DECK / 2, (z0 + z1) / 2);
  add(box(2 * dx, 0.05, 0.04, gold), 0, DECK - 0.03, z1 + 0.01);
  add(new THREE.Mesh(new THREE.PlaneGeometry(14, 8.4), std({ color: 0xd8dce4, roughness: 0.95 })), 0, DECK + 4.2, T.cycZ);
  // the proscenium: a deep frame round the opening, gold mouldings; the house curtain gathered at
  // the sides, its valance across the top; black legs in the wings
  const aw = T.arch.w, ah = T.arch.h, az = T.arch.z, side = X - aw / 2;
  for (const sx of [-1, 1]) {
    add(box(side, H, 0.8, cream), sx * (aw / 2 + side / 2), H / 2, az);
    add(box(0.14, ah, 0.86, gold), sx * (aw / 2 + 0.07), DECK + ah / 2, az);
    add(box(1.1, ah, 0.4, velvet), sx * (aw / 2 - 0.5), DECK + ah / 2, az - 0.5);
    for (const z of [-1.2, -3.6]) add(box(1.4, ah + 1, 0.1, M.black), sx * (aw / 2 - 0.3), DECK + (ah + 1) / 2, z);
    // the booms in the wings: a pipe on a base plate each (their lights clamped on, scenePlaces.ts)
    for (const z of [-1.2, 1.0]) { add(cyl(0.025, 0.025, 3.2, M.black, 8), sx * 7.2, DECK + 1.6, z); add(cyl(0.22, 0.22, 0.03, M.black, 16), sx * 7.2, DECK + 0.015, z); }
  }
  add(box(aw, H - DECK - ah, 0.8, cream), 0, DECK + ah + (H - DECK - ah) / 2, az);
  add(box(aw + 0.28, 0.16, 0.86, gold), 0, DECK + ah + 0.08, az);
  add(box(aw, 1.0, 0.4, velvet), 0, DECK + ah - 0.5, az - 0.5);
  // the stalls: gently raked rows, an aisle down the middle
  const S = T.stalls;
  for (let rr = 0; rr < S.rows; rr++) {
    const z = S.z0 + rr * S.d, y = (rr + 1) * S.rise;
    add(box(2 * X, y, S.d, carpet), 0, y / 2, z + S.d / 2);
    seatRow(add, M, A, { seat: fabric, back }, y, z + 0.5, [[-X + 1.2, -0.7], [0.7, X - 1.2]], rr, 0.7);
  }
  // the balcony over the back of the stalls: its floor stepping up, a gold-railed front, its seats
  const Bc = T.balcony, by = Bc.y;
  add(box(2 * X, 0.4, Z1 - Bc.z0, cream), 0, by - 0.2, (Bc.z0 + Z1) / 2);
  add(box(2 * X, 1.0, 0.25, cream), 0, by + 0.5, Bc.z0 + 0.12); add(box(2 * X, 0.08, 0.3, gold), 0, by + 1.02, Bc.z0 + 0.12);
  for (let rr = 0; rr < Bc.rows; rr++) {
    const z = Bc.z0 + 0.4 + rr * Bc.d, y = by + rr * Bc.rise;
    if (rr) add(box(2 * X, Bc.rise * rr, Bc.d, carpet), 0, by + (Bc.rise * rr) / 2, z + Bc.d / 2);
    seatRow(add, M, A, { seat: fabric, back }, y, z + 0.5, [[-X + 1.0, -0.7], [0.7, X - 1.0]], rr + 30, 0.55);
  }
  for (const sx of [-1, 1]) for (const z of [Bc.z0 + 1, Bc.z0 + 5]) add(cyl(0.18, 0.2, by, cream, 16), sx * (X - 2.4), by / 2, z);
  // a chandelier in the middle of the ceiling
  const glow = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
  add(cyl(0.01, 0.01, 1.6, gold, 4), 0, H - 0.8, 9); add(cyl(0.9, 0.3, 0.5, gold, 20), 0, H - 1.8, 9);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), glow), Math.cos(a) * 0.95, H - 1.55, 9 + Math.sin(a) * 0.95); }
  return { animate: () => {} };
}

// ---- the church -----------------------------------------------------------------------------
export function buildChurch(group: THREE.Group, M: Mats, r: Room) {
  const add: Add = (o, x, y, z, rot) => { group.add(at(o, x, y, z, rot)); };
  const Ch = CHURCH, X = r.walls.x, Z0 = r.walls.z0, Z1 = r.walls.z1, H = r.ceiling, L = Z1 - Z0, zc = (Z0 + Z1) / 2;
  const stone = house(new THREE.MeshBasicMaterial({ map: hallWall(), color: 0x8a8478 }));
  const slab = std({ map: concrete(), color: 0x9a948a, roughness: 0.85 }), oak = std({ map: darkWood(), color: 0x8a6a4a, roughness: 0.5 });
  const cloth = std({ color: 0xf2efe6, roughness: 0.8 }), gold = std({ color: 0xc8a046, metalness: 0.85, roughness: 0.28 });
  add(new THREE.Mesh(new THREE.PlaneGeometry(L, H), stone), -X, H / 2, zc, [0, Math.PI / 2, 0]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(L, H), stone), X, H / 2, zc, [0, -Math.PI / 2, 0]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * X, H), stone), 0, H / 2, Z1, [0, Math.PI, 0]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * X, H), stone), 0, H / 2, Z0 + 0.01);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * X, L), house(new THREE.MeshBasicMaterial({ color: 0x2a2018 }))), 0, H, zc, [Math.PI / 2, 0, 0]);
  add(new THREE.Mesh(new THREE.PlaneGeometry(2 * X, L), slab), 0, 0.002, zc, [-Math.PI / 2, 0, 0]);
  // the roof's beams across the nave
  for (let z = Z0 + 2; z < Z1; z += 4) { add(box(2 * X, 0.4, 0.3, oak), 0, H - 0.6, z); for (const sx of [-1, 1]) add(box(0.3, 2.4, 0.3, oak), sx * (X - 0.2), H - 1.8, z); }
  // stained glass: tall windows down both walls, a round one over the altar (their colours glow)
  const glass = (w: number, h: number, round: boolean, seed: number) => {
    const c = document.createElement('canvas'); c.width = 128; c.height = round ? 128 : 256;
    const g = c.getContext('2d');
    if (g) {
      const cols = ['#1d4fb0', '#c0242a', '#e0b030', '#2a8a4a', '#7a2ab0', '#e07020'];
      let s = seed;
      for (let y = 0; y < c.height; y += 16) for (let x = 0; x < c.width; x += 16) { s = (s * 16807) % 2147483647; g.fillStyle = cols[s % cols.length]; g.fillRect(x, y, 16, 16); }
      g.strokeStyle = '#111'; g.lineWidth = 3;
      for (let y = 0; y <= c.height; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
      for (let x = 0; x <= c.width; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.height); g.stroke(); }
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0x9a9a9a, toneMapped: false });
    return new THREE.Mesh(round ? new THREE.CircleGeometry(w / 2, 32) : new THREE.PlaneGeometry(w, h), mat);
  };
  Ch.windows.forEach((z, i) => {
    add(glass(1.4, 5.2, false, 11 + i), -X + 0.02, 6.4, z, [0, Math.PI / 2, 0]);
    add(glass(1.4, 5.2, false, 23 + i), X - 0.02, 6.4, z, [0, -Math.PI / 2, 0]);
  });
  add(glass(3.2, 3.2, true, 7), 0, 9.4, Z0 + 0.03);
  // the chancel (the deck): stone steps up to it from the nave; the altar with its cloth, candles and
  // the cross over it; the lectern; choir benches either side
  const { x: dx, z0, z1 } = r.deck;
  add(new THREE.Mesh(new THREE.BoxGeometry(2 * dx, DECK, z1 - z0), slab), 0, DECK / 2, (z0 + z1) / 2);
  for (let i = 0; i < 4; i++) { const h = (DECK / 4) * (4 - i); add(box(2 * dx - 2, h, 0.32, slab), 0, h / 2, z1 + 0.16 + 0.32 * i); }
  add(box(2.6, 1.0, 1.0, oak), 0, DECK + 0.5, Ch.altarZ); add(box(2.8, 0.04, 1.1, cloth), 0, DECK + 1.02, Ch.altarZ); add(box(2.8, 0.6, 0.02, cloth), 0, DECK + 0.72, Ch.altarZ + 0.56);
  const flame = new THREE.MeshBasicMaterial({ color: 0xffb050, toneMapped: false });
  for (const x of [-0.9, 0.9]) { add(cyl(0.03, 0.04, 0.5, gold, 10), x, DECK + 1.29, Ch.altarZ - 0.2); add(new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), flame), x, DECK + 1.58, Ch.altarZ - 0.2); }
  add(box(0.18, 2.6, 0.12, gold), 0, DECK + 4.4, Z0 + 0.2); add(box(1.4, 0.18, 0.12, gold), 0, DECK + 5.1, Z0 + 0.2);
  add(box(0.7, 1.15, 0.5, oak), Ch.lecternX, DECK + 0.58, -2.4); add(box(0.8, 0.05, 0.6, oak), Ch.lecternX, DECK + 1.2, -2.45, [0.3, 0, 0]);
  for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) { const x = sx * (3.9 + k * 0.8); add(box(0.5, 0.45, 3.6, oak), x, DECK + 0.23, -4.6); add(box(0.08, 0.9, 3.6, oak), x + sx * 0.25, DECK + 0.45, -4.6); }
  // the pews down the nave, an aisle in the middle, people in some
  const A = audienceMats(), P = Ch.pews;
  for (let rr = 0; rr < P.rows; rr++) {
    const z = P.z0 + rr * P.d;
    for (const [a, b] of P.blocks) {
      const w = b - a, cx = (a + b) / 2;
      add(box(w, 0.06, 0.42, oak), cx, 0.45, z); add(box(w, 0.6, 0.06, oak), cx, 0.78, z + 0.24); add(box(w, 0.4, 0.04, oak), cx, 0.95, z - 0.36);
      for (const ex of [a + 0.05, b - 0.05]) add(box(0.08, 0.95, 0.5, oak), ex, 0.47, z);
      for (let x = a + 0.4; x < b - 0.3; x += 0.62) { const k = taken(x, rr + 60, 0.45); if (k) sitter(add, A, x, 0, z, k, 0.45); }
    }
  }
  return { animate: () => {} };
}
