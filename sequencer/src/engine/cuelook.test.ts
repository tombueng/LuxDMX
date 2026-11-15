// The cue cards' and the QLC+ export's looks are what playback plays: what a cue doesn't mention
// carries on from the cues before it, fog, haze and the machines don't (they run in their own cue).
import { describe, expect, it } from 'vitest';
import { cueLooks } from './cuelook';
import { trackedLook } from './player';
import type { CueList } from '../model/types';

const list = { id: 'L', name: 'L', end: 'stop', play: true, cues: [
  { id: 'a', name: 'Bang', fade: 0, advance: { mode: 'manual' }, values: { flame: { flame: 1 }, haze: { haze: 0.6 }, par: { intensity: 0.3 } } },
  { id: 'b', name: 'Verse', fade: 0, advance: { mode: 'manual' }, values: { par: { intensity: 1 } } },
  { id: 'c', name: 'Chorus', fade: 0, advance: { mode: 'manual' }, values: { spot: { intensity: 0.5 } } },
] } as unknown as CueList;

describe('the looks of a play\'s cues', () => {
  it('a flame or haze cue: in its own look only', () => {
    const looks = cueLooks(list, new Map());
    expect(looks[0].flame?.flame).toBe(1); expect(looks[0].haze?.haze).toBe(0.6);
    expect(looks[1].flame?.flame).toBeUndefined(); expect(looks[2].haze?.haze).toBeUndefined();
  });
  it('the rest carries on: cue 3 still has the PAR of cue 2', () => {
    expect(cueLooks(list, new Map())[2].par?.intensity).toBe(1);
  });
  it('every cue the same as playback plays it', () => {
    const looks = cueLooks(list, new Map());
    for (let i = 0; i < list.cues.length; i++) expect(looks[i]).toEqual(trackedLook(list, i, new Map()));
  });
});
