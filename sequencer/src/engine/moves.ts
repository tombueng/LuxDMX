// More moves for moving heads: shapes drawn with the beam (a square, a star, a heart, a spirograph),
// sweeps with a character (a searchlight that stops and looks, wipers, a head bang on the beat) and
// group figures (heads weaving against each other, focusing on one point and opening up again).
//
// Like the first eight (effects.ts), every one is an offset around where the head points, never more
// than half its Size either way, worked out from where it is in its round: Speed is how long one
// round takes, Spread shifts one head against the next.
import { TAU, frac, noise, sine, type EffectDef, type Elem, type EffectParams } from './fxkit';

const { sin, cos, abs, exp, min, max, PI } = Math;
const S = (p: EffectParams) => 0.5 * p.size;
const ss = (a: number, b: number, x: number) => { const t = min(1, max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Along a closed path through corner points (-1..1 each way), at an even speed: a polygon traced by
// the beam. (the corners in order; the last one joins the first)
function polygon(pts: [number, number][], ph: number): [number, number] {
  const n = pts.length, at = frac(ph) * n, i = Math.floor(at) % n, f = at - Math.floor(at);
  const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
  return [ax + (bx - ax) * f, ay + (by - ay) * f];
}
const corners = (n: number, turn = 0, skip = 1): [number, number][] =>
  Array.from({ length: n }, (_, k) => { const a = TAU * ((k * skip) / n) + turn; return [sin(a), cos(a)]; });
const SQUARE: [number, number][] = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
const TRIANGLE = corners(3), STAR = corners(5, 0, 2);
// the four places the Step move jumps between
const STEPS: [number, number][] = [[-0.8, -0.8], [0.8, 0.8], [-0.8, 0.8], [0.8, -0.8]];

const at = (p: EffectParams, x: number, y: number) => ({ pan: S(p) * x, tilt: S(p) * y });
const mv = (id: string, name: string, blurb: string, defaults: EffectDef['defaults'], run: (e: Elem, p: EffectParams) => { pan?: number; tilt?: number }): EffectDef =>
  ({ id, name, category: 'move', blurb, defaults: { size: 0.3, spread: 0, ...defaults }, run });

export const MOVE_EFFECTS: EffectDef[] = [
  // ---- shapes drawn with the beam
  mv('square', 'Square', 'The beam traces a square round where it points, corner to corner.', { speed: 8 },
    (e, p) => { const [x, y] = polygon(SQUARE, e.phase); return at(p, x, y); }),
  mv('triangle', 'Triangle', 'A triangle, point up, drawn round where the head points.', { speed: 6 },
    (e, p) => { const [x, y] = polygon(TRIANGLE, e.phase); return at(p, x, y); }),
  mv('star', 'Star', 'A five-pointed star in one line, the way you draw it without lifting the pen.', { speed: 10 },
    (e, p) => { const [x, y] = polygon(STAR, e.phase); return at(p, x, y); }),
  mv('heart', 'Heart', 'The beam draws a heart. For a wedding, aimed at a wall or the haze.', { speed: 8, size: 0.35 },
    (e, p) => {
      const t = TAU * e.phase, x = 16 * sin(t) ** 3, y = 13 * cos(t) - 5 * cos(2 * t) - 2 * cos(3 * t) - cos(4 * t);
      return at(p, x / 17, (y + 2.5) / 15);
    }),
  mv('spiral', 'Spiral', 'Circles that open up and close in again, four loops a round.', { speed: 8 },
    (e, p) => { const r = 0.12 + 0.88 * sine(e.phase), a = TAU * 4 * e.phase; return at(p, r * sin(a), r * cos(a)); }),
  mv('flower', 'Flower', 'Three petals traced from the middle out and back.', { speed: 8 },
    (e, p) => { const a = PI * e.phase, r = cos(3 * a); return at(p, r * sin(a), r * cos(a)); }),
  mv('knot', 'Knot', 'A loop that crosses itself: three swings across to two up and down.', { speed: 12 },
    (e, p) => { const a = TAU * e.phase; return at(p, sin(3 * a + PI / 2), sin(2 * a)); }),
  mv('uprightEight', 'Upright eight', 'A figure eight standing up: a loop above, a loop below.', { speed: 8 },
    (e, p) => { const a = TAU * e.phase; return at(p, 0.5 * sin(2 * a), sin(a)); }),
  mv('spirograph', 'Spirograph', 'Loops inside loops, like the toy: it takes three turns to close.', { speed: 24, size: 0.4 },
    (e, p) => { const a = 3 * TAU * e.phase; return at(p, (2 * cos(a) + 5 * cos((2 / 3) * a)) / 7, (2 * sin(a) - 5 * sin((2 / 3) * a)) / 7); }),

  // ---- sweeps with a character
  mv('bounce', 'Bounce', 'Like a ball bouncing across the room: four bounces there and back.', { speed: 8 },
    (e, p) => at(p, sin(TAU * e.phase), 2 * abs(sin(4 * PI * e.phase)) - 1)),
  mv('zigzag', 'Zigzag', 'Across and back while the beam zigzags up and down.', { speed: 8 },
    (e, p) => { const u = frac(e.phase); return at(p, 2 * (u < 0.5 ? u * 2 : 2 - u * 2) - 1, 2 * (frac(u * 6) < 0.5 ? frac(u * 6) * 2 : 2 - frac(u * 6) * 2) - 1); }),
  mv('searchlight', 'Searchlight', 'A slow sweep that stops at each end and looks around a little.', { speed: 12, tempo: false, size: 0.45 },
    (e, p) => { const u = frac(e.phase), pos = ss(0.08, 0.42, u) - ss(0.58, 0.92, u); return at(p, 2 * pos - 1, 0.18 * sin(TAU * 3 * u)); }),
  mv('wipers', 'Wipers', 'Windscreen wipers: an arc across, over the top, and back.', { speed: 2 },
    (e, p) => { const a = (PI / 2) * sin(TAU * e.phase); return at(p, sin(a), 2 * cos(a) - 1); }),
  mv('headBang', 'Head bang', 'The heads snap down on every beat and come up again.', { speed: 1, size: 0.25 },
    (e, p) => ({ tilt: S(p) * (1 - 2 * exp(-6 * frac(e.phase))) })),
  mv('step', 'Step', 'Jumps between four places on the beat, a hard move each time.', { speed: 4 },
    (e, p) => { const u = frac(e.phase) * 4, i = Math.floor(u) % 4, f = ss(0, 0.12, u - Math.floor(u)), [ax, ay] = STEPS[(i + 3) % 4], [bx, by] = STEPS[i]; return at(p, ax + (bx - ax) * f, ay + (by - ay) * f); }),
  mv('wander', 'Wander', 'Each head drifts on its own, slowly, never the same way twice.', { speed: 6, tempo: false, spread: 1 },
    (e, p) => { const t = e.total + p.spread * e.k; return at(p, 2 * noise(e.seed * 97 + 3, t) - 1, 2 * noise(e.seed * 97 + 11, t * 0.8) - 1); }),
  mv('shake', 'Shake', 'A small nervous shake, for the moment before it all goes off.', { speed: 4, tempo: false, size: 0.12, spread: 1 },
    (e, p) => { const t = e.total * 14 + p.spread * e.k * 3; return at(p, 2 * noise(e.seed * 53 + 5, t) - 1, 2 * noise(e.seed * 53 + 23, t * 1.1) - 1); }),

  // ---- the group together
  mv('weave', 'Weave', 'Neighbours sweep against each other: every other head goes the other way.', { speed: 4 },
    (e, p) => { const s = e.k % 2 ? -1 : 1, a = TAU * e.phase; return at(p, s * sin(a), 0.35 * cos(2 * a)); }),
  mv('mirrorCircles', 'Mirror circles', 'Circles, the left half turning one way and the right half the other.', { speed: 4 },
    (e, p) => { const a = TAU * e.phase; return at(p, (e.x < 0.5 ? 1 : -1) * sin(a), cos(a)); }),
  mv('focus', 'Focus point', 'The beams meet in one point, open up again, and the point drifts round.', { speed: 8 },
    (e, p) => { const toward = e.m > 1 ? (0.5 - e.x) * 1.2 : 0, a = TAU * e.cycle; return at(p, toward * sine(e.cycle) + 0.4 * sin(a), 0.4 * cos(a)); }),
];
