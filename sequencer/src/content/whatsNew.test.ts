import { describe, expect, it } from 'vitest';
import { whatsNew } from './whatsNew';
import { buskingPage } from './busking';
import { emptyShow } from '../model/format';
import type { Show } from '../model/types';

const show = (): Show => ({
  ...emptyShow(),
  fixtures: [
    { id: 'p1', name: 'PAR 1', typeId: 'gen-drgb', mode: '', universe: 0, address: 1, x: 0.2, y: 0.2 },
    { id: 'p2', name: 'PAR 2', typeId: 'gen-drgb', mode: '', universe: 0, address: 5, x: 0.4, y: 0.2 },
  ],
  cueLists: [{ id: 'L', name: 'Looks', end: 'stop', play: false, cues: [
    { id: 'a', name: 'Warm', values: { p1: { intensity: 1 } }, fade: 0, advance: { mode: 'manual' } }] }],
});

describe("what's new for a page someone made their own", () => {
  it('a look, a list, an effect and a group made later; nothing that is on a page already', () => {
    const s = show();
    const page = { ...buskingPage(s), id: 'mine' };
    page.widgets = page.widgets.filter((w) => w.type !== 'special' || w.do !== 'tap');   // taken off on purpose
    s.cueLists[0].cues.push({ id: 'b', name: 'Cool', values: { p2: { intensity: 1 } }, fade: 0, advance: { mode: 'manual' } });
    s.cueLists.push({ id: 'H', name: 'Halloween', end: 'loop', play: false, cues: [] });
    s.effects.push({ id: 'fire', name: 'Fire', kind: 'fire', fixtures: ['p1'], params: {} } as never);
    s.groups.push({ id: 'g', name: 'PARs', fixtures: ['p1', 'p2'] });
    const add = whatsNew(s, [page]);
    const what = add.map((w) => (w.type === 'cue' ? `cue:${w.cue}` : w.type === 'list' ? `list:${w.list}` : w.type === 'effect' ? `effect:${w.effect}` : w.type === 'group' ? `group:${w.group}` : w.type));
    expect(what.sort()).toEqual(['cue:b', 'effect:fire', 'group:g', 'list:H']);
  });
  it('nothing when the page has it all', () => {
    const s = show();
    expect(whatsNew(s, [buskingPage(s)])).toEqual([]);
  });
});
