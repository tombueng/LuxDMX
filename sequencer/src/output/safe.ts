// Frames made safe: the channels of some attributes at 0 (fog, haze, the machines), and a machine's
// own safety / enable channel at its safe value, which isn't always 0. The page and the output
// thread use the same rule.
import { enableValue, isGated, isKinetic, isMachine, KINETIC_CTL, kineticOff, MACHINE_PROGRAMS } from '../model/safety';
import type { Fixture, FixtureMode } from '../model/types';

export const ATMOS_AND_MACHINES = ['fog', 'haze', 'confetti', 'bubbles', 'flame', 'sparks', 'co2', 'enable'];
export const atmosAndMachines = (a: string) => ATMOS_AND_MACHINES.includes(a);
export const machinesSafe = (a: string) => isGated(a) || a === 'enable';

// a copy of these frames with the channels of `which` attributes made safe
export function zeroedFrames(frames: Map<number, Uint8Array>, fixtures: Fixture[], modeOf: (f: Fixture) => FixtureMode | undefined, which: (attr: string) => boolean) {
  const out = new Map([...frames].map(([u, d]) => [u, d.slice()] as const));
  // (made safe from the machines: a machine's own programs too, a flame projector's "Auto 1" fires it)
  const machinesToo = which('flame');
  for (const f of fixtures) {
    const m = modeOf(f), d = out.get(f.universe);
    if (!m || !d) continue;
    const programs = machinesToo && isMachine(m), winch = machinesToo && isKinetic(m);
    m.channels.forEach((c, i) => {
      const at = f.address - 1 + i;
      if (at < 0 || at >= 512) return;
      // (a winch's own programs and control channels: at their off, they'd move it)
      if (winch && KINETIC_CTL.includes(c.attr)) { d[at] = kineticOff(c); return; }
      if (!(which(c.attr) || (programs && (MACHINE_PROGRAMS as readonly string[]).includes(c.attr)))) return;
      d[at] = c.attr === 'enable' ? enableValue(c.ranges).off : 0;
    });
  }
  return out;
}
