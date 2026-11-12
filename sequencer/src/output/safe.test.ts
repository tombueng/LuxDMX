// Frames made safe (Blind, the page closing, a frame that fails): every channel that fires a
// machine at 0, its own programs included, a light's colour and dimmer as they were.
import { describe, expect, it } from 'vitest';
import { atmosAndMachines, machinesSafe, zeroedFrames } from './safe';
import type { Fixture, FixtureMode } from '../model/types';

const flame: FixtureMode = { name: 'm', channels: [{ name: 'Fire', attr: 'flame' }, { name: 'Program', attr: 'effectMacro', ranges: [{ from: 0, to: 9, label: 'Off' }, { from: 10, to: 255, label: 'Auto 1' }] }] };
const spot: FixtureMode = { name: 'm', channels: [{ name: 'Dimmer', attr: 'intensity' }, { name: 'Program', attr: 'effectMacro' }] };
const fx = (id: string, address: number): Fixture => ({ id, name: id, typeId: 't', mode: 'm', universe: 0, address, x: 0, y: 0 });

describe('safe frames', () => {
  it('zero a machine\'s fire and its programs; a light\'s own program and dimmer stay', () => {
    const d = new Uint8Array(512); d.set([255, 133, 200, 90], 0);
    const modes: Record<string, FixtureMode> = { f: flame, s: spot };
    for (const which of [atmosAndMachines, machinesSafe]) {
      const out = zeroedFrames(new Map([[0, d]]), [fx('f', 1), fx('s', 3)], (f) => modes[f.id], which).get(0)!;
      expect([...out.slice(0, 4)]).toEqual([0, 0, 200, 90]);
    }
  });
});
