// Real fixtures as they are (a start: sim/fixtures-research/ has the sources, manuals and photos).
// A profile says what the generic look can't: the size, the cells on the face as the manual numbers
// them (row by row from the top left, seen from the front), each cell's beam, a warm white's colour,
// and for a moving head its base, yoke and head and where it tilts. The 3D stage draws a light whose
// type matches one this way (rig.ts); every other light keeps its kind's look.

export interface Profile {
  name: string;
  match: (manufacturer: string, model: string) => boolean;
  cells: { cols: number; rows: number; pitch: number; size: number; square?: boolean };
  beamDeg: number;
  // a white light (its channels are dimmers only): its colour temperature (K)
  white?: number;
  // a panel that doesn't move (a blinder): its plate, w x h, d deep
  panel?: { w: number; h: number; d: number };
  // a moving head: its base (w x h x d), the yoke's arms (how high, how far apart), the head (its
  // face w x h, d deep), the tilt axis's height
  head?: { base: [number, number, number]; arms: { top: number; span: number }; face: [number, number]; depth: number; pivot: number };
}

export const PROFILES: Profile[] = [
  // Stairville LED Matrix Blinder 5x5 (MK II, and the MK I with the same housing): a 450 x 450 x 115 mm
  // black plate, 25 warm white 3 W LEDs (2800 K) behind 63 mm round lenses about 87.5 mm apart, 55°
  // each, no movement (manual 526644 V4, p.13 and p.34)
  {
    name: 'Stairville LED Matrix Blinder 5x5',
    match: (m, n) => /stairville/i.test(m) && /matrix\s*blinder\s*5\s*x\s*5/i.test(n) && !/rgb/i.test(n),
    panel: { w: 0.45, h: 0.45, d: 0.115 }, cells: { cols: 5, rows: 5, pitch: 0.0875, size: 0.063 }, beamDeg: 55, white: 2800,
  },
  // Showtec Phantom Matrix FX (40062): a moving head with a 5 x 5 RGBW matrix, 4 W a cell behind
  // square 45° optics about 60 mm apart, the head's face 312 mm wide; 445 mm across the yoke, 530 mm
  // tall, the base 290 x 200 mm; tilts at about 345 mm (manual NL V1 p.9, p.41)
  {
    name: 'Showtec Phantom Matrix FX',
    match: (m, n) => /showtec/i.test(m) && /phantom\s*matrix\s*fx/i.test(n),
    head: { base: [0.29, 0.1, 0.2], arms: { top: 0.42, span: 0.43 }, face: [0.312, 0.32], depth: 0.09, pivot: 0.345 },
    cells: { cols: 5, rows: 5, pitch: 0.06, size: 0.052, square: true }, beamDeg: 45,
  },
];

export const profileOf = (manufacturer = '', model = '') => PROFILES.find((p) => p.match(manufacturer, model));

// A cell's place on the face (metres, the face's middle at 0): x to the right seen from the front,
// z down (the top row first)
export function cellAt(p: Profile, i: number): [number, number] {
  const { cols, rows, pitch } = p.cells, c = i % cols, r = Math.floor(i / cols) % rows;
  return [(c - (cols - 1) / 2) * pitch, (r - (rows - 1) / 2) * pitch];
}

// the colour of a warm white at `k` kelvin (near enough, for drawing): r, g, b in 0..1
export function whiteOf(k: number): [number, number, number] {
  const t = Math.max(1500, Math.min(10000, k)) / 100;
  const r = t <= 66 ? 1 : Math.min(1, 1.292936 * Math.pow(t - 60, -0.1332047592));
  const g = t <= 66 ? Math.min(1, Math.max(0, 0.3900815788 * Math.log(t) - 0.6318414438)) : Math.min(1, 1.129890861 * Math.pow(t - 60, -0.0755148492));
  const b = t >= 66 ? 1 : t <= 19 ? 0 : Math.min(1, Math.max(0, 0.5432067891 * Math.log(t - 10) - 1.1962540891));
  return [r, g, b];
}
