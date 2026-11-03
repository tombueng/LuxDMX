// The rig against the show, and what a light found with RDM is in the fixture library.
import { describe, expect, it } from 'vitest';
import { checkRig, fixesFor, freeRun, guessProfile, type LibEntry, type PatchedFixture } from './match';
import { fromBox } from './box';
import type { RdmDevice } from './types';

const dev = (uid: string, uni: number, addr: number, footprint: number, more: Partial<RdmDevice> = {}): RdmDevice => ({
  uid, via: 'box', uni, addr, footprint, maker: '', model: '', modelId: 0, label: '', category: 0, mode: 1, modes: 1,
  software: '', softwareId: 0, identify: false, sensors: [], status: { type: 0, id: 0, count: 0 }, ...more,
});
const fx = (id: string, universe: number, address: number, channels: number, uid?: string): PatchedFixture => ({ id, name: id, universe, address, channels, ...(uid ? { uid } : {}) });

describe('the rig against the show', () => {
  it('a light at its fixture\'s address with its channel count matches; nothing else to say', () => {
    const r = checkRig([dev('0001:00000001', 0, 1, 8)], [fx('a', 0, 1, 8)], new Set([0]));
    expect(r.devices[0]).toEqual({ uid: '0001:00000001', fixture: 'a', problems: [], clashWith: [] });
    expect([r.ok, r.issues, r.silent]).toEqual([1, 0, []]);
  });
  it('a fixture that knows its light follows it to another address (address), and to another mode (mode)', () => {
    const r = checkRig([dev('0001:00000001', 0, 20, 12)], [fx('a', 0, 1, 8, '0001:00000001')], new Set([0]));
    expect(r.devices[0].fixture).toBe('a');
    expect(r.devices[0].problems).toEqual(['address', 'mode']);
  });
  it('lights sharing channels clash; a light the show doesn\'t know is unpatched; a fixture with nothing answering is silent', () => {
    const r = checkRig([dev('0001:00000001', 0, 1, 8), dev('0001:00000002', 0, 5, 8), dev('0001:00000003', 1, 1, 4)],
      [fx('a', 0, 1, 8), fx('b', 0, 100, 4), fx('c', 2, 1, 4)], new Set([0, 1]));
    expect(r.devices.map((d) => d.problems)).toEqual([['clash'], ['unpatched', 'clash'], ['unpatched']]);
    expect(r.devices[0].clashWith).toEqual(['0001:00000002']);
    // (universe 2 wasn't scanned: c isn't silent)
    expect(r.silent).toEqual(['b']);
  });
  it('one fixture is one light: a second light at the same address doesn\'t take it too', () => {
    const r = checkRig([dev('0001:00000001', 0, 1, 4), dev('0001:00000002', 0, 1, 4)], [fx('a', 0, 1, 4)], new Set([0]));
    expect(r.devices.map((d) => d.fixture)).toEqual(['a', undefined]);
  });
  it('the fixes: the light to the patch\'s address or the patch to the light\'s; the mode either way when there is one with those channels', () => {
    const d = dev('0001:00000001', 0, 20, 12, { modeList: [{ n: 1, name: '8ch', footprint: 8 }, { n: 2, name: '12ch', footprint: 12 }], mode: 2, modes: 2 });
    const f = [fx('a', 0, 1, 8, d.uid)], c = checkRig([d], f, new Set([0])).devices[0];
    expect(fixesFor(d, c, f, () => [{ name: 'Basic', channels: 8 }, { name: 'Extended', channels: 12 }])).toEqual([
      { to: 'light', kind: 'address', uid: d.uid, addr: 1, fixture: 'a' },
      { to: 'show', kind: 'address', fixture: 'a', universe: 0, addr: 20, uid: d.uid },
      { to: 'light', kind: 'mode', uid: d.uid, mode: 1, fixture: 'a' },
      { to: 'show', kind: 'mode', fixture: 'a', mode: 'Extended', uid: d.uid },
    ]);
    // a light the show doesn't know: patch it
    const u = dev('0001:00000009', 0, 300, 4);
    expect(fixesFor(u, checkRig([u], [], new Set([0])).devices[0], [])).toEqual([{ to: 'show', kind: 'patch', uid: u.uid }]);
  });
  it('the first free run of channels', () => {
    expect(freeRun([{ address: 1, channels: 8 }, { address: 9, channels: 4 }], 6)).toBe(13);
    expect(freeRun([{ address: 1, channels: 8 }, { address: 20, channels: 4 }], 6)).toBe(9);
    expect(freeRun([{ address: 1, channels: 510 }], 6)).toBe(0);
  });
});

describe('which profile a light is', () => {
  const lib: LibEntry[] = [
    { source: 'ofl', key: 'robe/robin-600e-spot', name: 'Robin 600E Spot', manufacturer: 'Robe', modes: [['Mode 1', 37, 1], ['Mode 2', 49, 2]] },
    { source: 'ofl', key: 'etc/colorsource-par', name: 'ColorSource PAR', manufacturer: 'ETC', modes: [['5ch', 5, 1], ['1ch', 1, 3]], rdm: [0x6574, 513] },
    { source: 'qlc', key: 'Robe/Robe-Robin-600E-Spot.qxf', name: 'Robin 600E Spot', manufacturer: 'Robe' },
    { source: 'ofl', key: 'robe/robin-600e-wash', name: 'Robin 600E Wash', manufacturer: 'Robe', modes: [['M1', 37]] },
  ];
  it('by its RDM maker and model ids, and its mode by personality and channels: sure', () => {
    const g = guessProfile(dev('6574:00000001', 0, 1, 1, { modelId: 513, mode: 3 }), lib);
    expect(g).toEqual({ entry: lib[1], mode: '1ch', sure: true });
  });
  it('by its maker\'s and model\'s names, the mode with its channel count: a guess', () => {
    const g = guessProfile(dev('5253:00000001', 0, 1, 49, { maker: 'Robe lighting s.r.o.', model: 'Robin 600E Spot', modelId: 7 }), lib);
    expect(g?.entry.key).toBe('robe/robin-600e-spot'); expect(g?.mode).toBe('Mode 2'); expect(g?.sure).toBe(false);
  });
  it('nothing like it: no guess', () => {
    expect(guessProfile(dev('1234:00000001', 0, 1, 3, { maker: 'Nobody', model: 'Thing' }), lib)).toBeUndefined();
  });
});

describe("a box's RDM answer", () => {
  it('reads its devices, sensors and scan, and survives an older or broken answer', () => {
    const r = fromBox('bar-box', {
      available: true, busy: false, scanned: true, discStage: 0, discFound: 1, rdmLines: [{ line: 0, uni: 3 }],
      devices: [{ uid: '1a2b:0000ff01', uni: 3, addr: 17, footprint: 12, model: 42, pers: 2, persCount: 3, identify: false, sw: '1.2', mfg: 'Maker', modelName: 'Spot 1', label: 'SL 1', cat: 0x0101, swVer: 5,
        sensors: [{ name: 'Head', value: 41, lo: 20, hi: 55, rec: 0, type: 0, poll: true, unit: 'C' }], stType: 3, stId: 7, stCount: 1 }, { uid: 'nope' }],
    });
    expect(r.devices).toHaveLength(1);
    expect(r.devices[0]).toMatchObject({ uid: '1A2B:0000FF01', via: 'bar-box', uni: 3, addr: 17, footprint: 12, mode: 2, modes: 3, maker: 'Maker', model: 'Spot 1', label: 'SL 1', status: { type: 3, id: 7, count: 1 } });
    expect(r.devices[0].sensors[0]).toEqual({ name: 'Head', value: 41, lo: 20, hi: 55, unit: 'C', type: 0 });
    expect(r.scan).toEqual({ busy: false, found: 1, stage: 'done' });
    expect(r.lines).toEqual([{ line: 0, uni: 3 }]);
    expect(fromBox('x', null)).toEqual({ devices: [], scan: { busy: false, found: 0, stage: 'idle' }, lines: [], available: true });
  });
});
