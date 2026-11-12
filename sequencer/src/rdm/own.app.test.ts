// @vitest-environment happy-dom
// A light found over RDM: a type of the show's own (or of this browser's "My fixtures") with its
// RDM maker and model ids comes first, in the mode its personality is.
import { describe, expect, it } from 'vitest';
import { freshApp } from '../app.harness';
import type { FixtureType } from '../model/types';
import type { RdmDevice } from './types';

const chs = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `C${i + 1}`, attr: 'raw' as const }));
const T = (id: string, extra: Partial<FixtureType> = {}): FixtureType => ({ id, manufacturer: 'Lux', model: id, source: 'user', modes: [{ name: 'Basic', channels: chs(6) }, { name: 'Full', channels: chs(11) }],
  rdm: { maker: 0x4c55, model: 0x10, modes: { '1': 'Basic', '2': 'Full' } }, ...extra });
const dev = (mode: number, footprint: number): RdmDevice => ({ uid: '4C55:00000001', modelId: 0x10, mode, footprint, addr: 1 } as unknown as RdmDevice);

describe('ownType', () => {
  it('the show\'s own type, in its personality\'s mode; the newest of two; else by channel count', async () => {
    const { app } = await freshApp();
    const { ownType } = await import('./rig.svelte');
    app.addType(T('user:old'));
    app.addType(T('user:new'));
    expect(ownType(dev(2, 11))).toMatchObject({ typeId: 'user:new', mode: 'Full' });
    expect(ownType(dev(1, 6))).toMatchObject({ typeId: 'user:new', mode: 'Basic' });
    expect(ownType(dev(9, 6))).toMatchObject({ mode: 'Basic' });             // (a personality it doesn't name: by channels)
    expect(ownType(dev(1, 7))).toBeUndefined();                              // (no mode with 7 channels)
    expect(ownType({ ...dev(1, 6), modelId: 0x99 })).toBeUndefined();        // (another model)
  });
  it('one of "My fixtures" the show doesn\'t have yet is added to the show', async () => {
    const { app } = await freshApp();
    const { ownType } = await import('./rig.svelte');
    app.myTypes = [T('user:mine')];                       // (as if saved in another show)
    expect(app.show.fixtureTypes.some((t: FixtureType) => t.id === 'user:mine')).toBe(false);
    const got = ownType(dev(2, 11))!;
    expect(got.mode).toBe('Full');
    expect(app.show.fixtureTypes.some((t: FixtureType) => t.id === got.typeId)).toBe(true);
  });
});
