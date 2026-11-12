// The low-poly bodies of the lights and machines, one geometry per look (instanced by rig.ts).
// Each is built around where its light comes out: the lens at the origin, the beam along +y, the
// body behind it (-y). A moving head comes in three parts (base, yoke, head) that turn separately.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Look = 'spot' | 'wash' | 'par' | 'blinder' | 'strobe' | 'bar' | 'disc' | 'panel' | 'fog' | 'confetti' | 'bubbles' | 'flame' | 'sparks' | 'co2' | 'fresnel' | 'headbar' | 'winch';
const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));

// moving heads: the head turns about the yoke's arms at PIVOT; its lens is HEAD_LENS above that
export { PIVOT_UP as PIVOT } from './geometry';
export function headParts(look: 'spot' | 'wash') {
  const base = merge([new THREE.BoxGeometry(0.42, 0.16, 0.34).translate(0, 0.08, 0), new THREE.BoxGeometry(0.16, 0.06, 0.02).translate(0, 0.09, 0.175)]);
  const yoke = merge([
    new THREE.CylinderGeometry(0.11, 0.11, 0.05, 12).translate(0, 0.185, 0),
    new THREE.BoxGeometry(0.36, 0.05, 0.14).translate(0, 0.2, 0),
    new THREE.BoxGeometry(0.05, 0.3, 0.14).translate(-0.18, 0.36, 0),
    new THREE.BoxGeometry(0.05, 0.3, 0.14).translate(0.18, 0.36, 0),
  ]);
  // a spot: a long narrow head; a wash: short and round, a big front lens
  const head = look === 'spot'
    ? merge([new THREE.CylinderGeometry(0.1, 0.13, 0.42, 12).translate(0, 0.0, 0), new THREE.CylinderGeometry(0.115, 0.115, 0.05, 12).translate(0, 0.22, 0), new THREE.BoxGeometry(0.3, 0.06, 0.06).translate(0, 0, 0)])
    : merge([new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(0, 0.02, 0), new THREE.CylinderGeometry(0.15, 0.16, 0.08, 14).translate(0, 0.1, 0), new THREE.BoxGeometry(0.3, 0.06, 0.06)]);
  return { base, yoke, head, lens: look === 'spot' ? 0.25 : 0.145, lensR: look === 'spot' ? 0.09 : 0.14 };
}

// where the light comes out (no geometry made: the renderer asks every frame)
const LENS: Partial<Record<Look, { at: number; r: number; lamps?: [number, number][] }>> = {
  spot: { at: 0.25, r: 0.09 }, wash: { at: 0.145, r: 0.14 }, par: { at: 0, r: 0.11 }, fresnel: { at: 0, r: 0.1 },
  blinder: { at: 0, r: 0.12, lamps: [[-0.15, 0], [0.15, 0]] }, strobe: { at: 0, r: 0.2 },
};
export function lensOf(look: Look) { const l = LENS[look] ?? { at: 0, r: 0.1 }; return { at: l.at, r: l.r, lamps: l.lamps ?? [[0, 0]] as [number, number][] }; }

// A moving bar: a mount on the truss (or the floor), the bar turning on it (its pan), and its heads
// in a row along the bar, each tilting about the bar's length. The bar is a metre long here (scaled
// to its heads); a head's lens is HEADBAR_LENS above where it turns.
export const HEADBAR_PIVOT = 0.17, HEADBAR_LENS = 0.13, HEADBAR_PITCH = 0.26;
export function headBarParts() {
  const base = merge([new THREE.BoxGeometry(0.24, 0.08, 0.2).translate(0, 0.04, 0), new THREE.CylinderGeometry(0.06, 0.06, 0.06, 10).translate(0, 0.11, 0)]);
  const bar = merge([new THREE.BoxGeometry(1, 0.08, 0.16).translate(0, 0.15, 0), new THREE.BoxGeometry(1, 0.02, 0.18).translate(0, 0.2, 0)]);
  const head = merge([new THREE.CylinderGeometry(0.06, 0.07, 0.2, 12).translate(0, 0.03, 0), new THREE.CylinderGeometry(0.072, 0.072, 0.02, 12).translate(0, 0.13, 0)]);
  return { base, bar, head };
}

// A kinetic winch: its motor box on the truss, a cable (a metre long here, scaled to how far it's
// let out) and the load on it, an LED ball WINCH_BALL across.
export const WINCH_BALL = 0.24, WINCH_BOX = 0.14;
export function winchParts() {
  const box = merge([new THREE.BoxGeometry(0.22, WINCH_BOX, 0.18).translate(0, 0, 0), new THREE.CylinderGeometry(0.05, 0.05, 0.2, 12).rotateZ(Math.PI / 2).translate(0, -0.02, 0)]);
  const cable = new THREE.CylinderGeometry(0.005, 0.005, 1, 5).translate(0, -0.5, 0);
  const ball = new THREE.SphereGeometry(WINCH_BALL / 2, 20, 14);
  return { box, cable, ball };
}

// fixed lights and machines, standing on their up (the beam / what they throw goes up)
export function body(look: Look): { geo: THREE.BufferGeometry; lensR: number; lenses?: [number, number][] } {
  switch (look) {
    case 'par': return { geo: merge([new THREE.CylinderGeometry(0.12, 0.14, 0.3, 12).translate(0, -0.15, 0), new THREE.TorusGeometry(0.17, 0.012, 4, 12, Math.PI).rotateY(Math.PI / 2).translate(0, -0.15, 0)]), lensR: 0.11 };
    case 'fresnel': return { geo: merge([new THREE.BoxGeometry(0.22, 0.32, 0.22).translate(0, -0.17, 0), new THREE.CylinderGeometry(0.1, 0.1, 0.04, 12).translate(0, -0.01, 0)]), lensR: 0.1 };
    case 'blinder': {
      // a 2-lite: two lamps in a frame, side by side
      return { geo: merge([new THREE.BoxGeometry(0.62, 0.12, 0.3).translate(0, -0.06, 0), new THREE.TorusGeometry(0.33, 0.012, 4, 12, Math.PI).rotateY(Math.PI / 2).translate(0, -0.06, 0)]), lensR: 0.12, lenses: [[-0.15, 0], [0.15, 0]] };
    }
    case 'strobe': return { geo: merge([new THREE.BoxGeometry(0.55, 0.1, 0.24).translate(0, -0.05, 0), new THREE.BoxGeometry(0.6, 0.02, 0.05).translate(0, -0.1, -0.13)]), lensR: 0.2 };
    case 'bar': return { geo: new THREE.BoxGeometry(1, 0.08, 0.1).translate(0, -0.04, 0), lensR: 0 };
    // the board behind a LED ring or a matrix (scaled to its size)
    case 'disc': return { geo: new THREE.CylinderGeometry(0.5, 0.5, 0.02, 48).translate(0, -0.01, 0), lensR: 0 };
    case 'panel': return { geo: new THREE.BoxGeometry(1, 0.02, 1).translate(0, -0.01, 0), lensR: 0 };
    case 'fog': return { geo: merge([new THREE.BoxGeometry(0.5, 0.3, 0.62).translate(0, 0.15, 0), new THREE.CylinderGeometry(0.05, 0.06, 0.12, 8).rotateX(Math.PI / 2).translate(0, 0.17, 0.36)]), lensR: 0 };
    case 'confetti': return { geo: merge([new THREE.BoxGeometry(0.4, 0.12, 0.4).translate(0, 0.06, 0), new THREE.CylinderGeometry(0.09, 0.11, 0.7, 10).translate(0, 0.45, 0)]), lensR: 0 };
    case 'bubbles': return { geo: merge([new THREE.BoxGeometry(0.42, 0.26, 0.32).translate(0, 0.13, 0), new THREE.TorusGeometry(0.12, 0.015, 4, 14).translate(0, 0.32, 0.17)]), lensR: 0 };
    case 'flame': return { geo: merge([new THREE.BoxGeometry(0.42, 0.34, 0.42).translate(0, 0.17, 0), new THREE.CylinderGeometry(0.04, 0.06, 0.18, 8).translate(0, 0.43, 0)]), lensR: 0 };
    case 'sparks': return { geo: merge([new THREE.BoxGeometry(0.4, 0.22, 0.4).translate(0, 0.11, 0), new THREE.CylinderGeometry(0.1, 0.05, 0.12, 10).translate(0, 0.28, 0)]), lensR: 0 };
    case 'co2': return { geo: merge([new THREE.CylinderGeometry(0.12, 0.14, 0.2, 10).translate(0, 0.1, 0), new THREE.CylinderGeometry(0.035, 0.05, 0.6, 8).translate(0, 0.5, 0)]), lensR: 0 };
    default: return { geo: new THREE.BoxGeometry(0.3, 0.3, 0.3).translate(0, -0.15, 0), lensR: 0.1 };
  }
}
