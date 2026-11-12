// @vitest-environment happy-dom
// A light found over RDM that no library knows: a plain profile from what it says, and a pyro
// device's channels all waiting for Arm.
import { describe, expect, it } from 'vitest';
import { plainType } from './rig.svelte';
import { isMachine } from '../model/safety';
import type { RdmDevice } from './types';

const dev = (category: number): RdmDevice => ({ uid: '4C55:00000042', addr: 1, footprint: 3, maker: 'X', model: 'Y', modelId: 0x42, label: '', category, mode: 1, modes: 1,
  software: '', softwareId: 0, identify: false, sensors: [], status: { type: 0, id: 0, count: 0 } }) as unknown as RdmDevice;

describe('a plain profile from RDM', () => {
  it('a light: its channels by number, plain', () => {
    const t = plainType(dev(0x0101));
    expect(t.modes[0].channels.map((c) => c.attr)).toEqual(['raw', 'raw', 'raw']);
  });
  it('pyro (E1.20 category 0x0402): every channel waits for Arm', () => {
    const t = plainType(dev(0x0402));
    expect(t.modes[0].channels.map((c) => [c.name, c.attr])).toEqual([['Pyro 1', 'flame'], ['Pyro 2', 'flame'], ['Pyro 3', 'flame']]);
    expect(isMachine(t.modes[0])).toBe(true);
  });
});
