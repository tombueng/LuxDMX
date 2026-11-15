// lerpResolved goes over only what b sets (it walked all 41 number attributes for every light of
// every list each frame): the same results as walking all of them, for any mix of attributes,
// times of their own, snapping gobos and a strobe that waits for the end.
import { describe, expect, it } from 'vitest';
import { lerpResolved, TIME_FAMILY } from './resolve';
import type { NumAttr, Resolved } from '../model/types';

const NUM: NumAttr[] = ['intensity', 'white', 'amber', 'uv', 'cct', 'pan', 'tilt', 'strobe', 'zoom', 'focus', 'iris',
  'frost', 'prism', 'goboRotation', 'gobo', 'fog', 'haze', 'fan', 'speed', 'confetti', 'bubbles', 'flame', 'sparks', 'co2',
  'gobo2', 'gobo2Rotation', 'prismRotation', 'animation', 'animationRotation', 'effectMacro', 'effectSpeed', 'colorMacro',
  'goboShake', 'goboScroll', 'gobo2Shake', 'gobo2Scroll', 'panRotation', 'tiltRotation', 'roll', 'rollRotation', 'hoist'];
const START = ['gobo', 'prism', 'gobo2', 'effectMacro', 'colorMacro', 'goboShake', 'goboScroll', 'gobo2Shake', 'gobo2Scroll'];
// the number part as it was: every attribute, each looked up in the lists
function before(a: Resolved, b: Resolved, t: number, tI: number, tBy?: { color: number; position: number; beam: number }) {
  const out: Resolved = { ...a };
  for (const k of NUM) {
    const x = a[k], y = b[k];
    if (y === undefined) continue;
    if (x === undefined) { out[k] = y; continue; }
    const fam = tBy ? TIME_FAMILY[k] : undefined;
    const tt = k === 'intensity' ? tI : fam ? tBy![fam] : t;
    out[k] = START.includes(k) ? (tt > 0 ? y : x) : k === 'strobe' ? (tt >= 1 ? y : x) : x + (y - x) * tt;
  }
  return out;
}
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const some = (): Resolved => Object.fromEntries(NUM.filter(() => rnd() < 0.3).map((k) => [k, Math.round(rnd() * 100) / 100])) as Resolved;

describe('a light between two looks', () => {
  it('the same as walking every attribute, whatever is set and whenever', () => {
    for (let i = 0; i < 2000; i++) {
      const a = some(), b = some(), t = [0, 0.3, 1][i % 3], tI = rnd(), tBy = i % 2 ? { color: rnd(), position: rnd(), beam: rnd() } : undefined;
      const got = lerpResolved(a, b, t, tI, undefined, tBy) as Record<string, unknown>;
      const want = before(a, b, t, tI, tBy) as Record<string, unknown>;
      for (const k of NUM) expect(got[k], `${k} at ${t}`).toBe(want[k]);
    }
  });
  it("what b sets that isn't a number attribute isn't taken by that loop", () => {
    const out = lerpResolved({ intensity: 0 }, { intensity: 1, color: { r: 1, g: 0, b: 0 } } as Resolved, 0.5);
    expect(out.intensity).toBe(0.5);
    expect(out.color).toEqual({ r: 1, g: 0, b: 0 });
  });
});
