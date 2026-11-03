// Playing a song with a band: Play from the start comes in on the band's "one", the parts to jump
// on to, and the beat a jump waits for.
import { describe, expect, it } from 'vitest';
import { beatAfter, partAfter, partAt, partsOf, startOf } from './gig';
import { DEMO_SECONDS, sectionStarts } from './beat';
import type { Timeline } from '../model/timeline';

const tl = (o: Partial<Timeline> = {}): Timeline => ({ duration: 180, bpm: 120, offset: 1.5, items: [], ...o });

describe('Play from the start', () => {
  it('starts a beat before the first downbeat: pressed on the drummer\'s "four", the song\'s "one" lands with the band', () => {
    expect(startOf(tl())).toEqual({ from: 1, downbeat: 1.5, clicks: [] });                    // 120 BPM: a beat is 0.5 s
    expect(startOf(tl({ bpm: 155.8, offset: 1.765 })).from).toBeCloseTo(1.765 - 60 / 155.8, 6);
    expect(startOf(tl({ offset: 0.2 })).from).toBe(0);                                       // (never before the song)
    expect(startOf(tl({ offset: undefined })).from).toBe(0);
    expect(startOf(tl({ bpm: undefined })).from).toBe(0);                                    // no tempo: from the very start
  });
  it('a count-in: a bar of clicks on the beat, the song coming in on its first downbeat (the clock starts before 0)', () => {
    const s = startOf(tl(), 1);
    expect(s.from).toBe(-0.5);                                                              // 1.5 s - 4 beats of 0.5 s
    expect(s.clicks).toEqual([-0.5, 0, 0.5, 1]);
    expect(s.downbeat).toBe(1.5);
    expect(startOf(tl(), 2).clicks).toHaveLength(8);
    expect(startOf(tl(), 7).clicks).toHaveLength(8);                                        // (two bars at most)
    expect(startOf(tl({ bpm: undefined }), 1)).toEqual({ from: 0, downbeat: 0, clicks: [] });
  });
});

describe('the parts of a song', () => {
  const sections = [{ name: 'Intro', at: 0 }, { name: 'Verse', at: 16.2 }, { name: 'Solo', at: 92.4 }, { name: 'Chorus', at: 153.3 }];
  it('its sections; the one after where it is (not the one starting right there), and the one it is in', () => {
    const parts = partsOf(tl({ sections }));
    expect(parts.map((p) => p.name)).toEqual(['Intro', 'Verse', 'Solo', 'Chorus']);
    expect(partAfter(parts, 0)?.name).toBe('Verse');
    expect(partAfter(parts, 16.2)?.name).toBe('Solo');                                      // (at a part's start: the next one)
    expect(partAfter(parts, 100)?.name).toBe('Chorus');
    expect(partAfter(parts, 160)).toBeUndefined();                                          // the last part: nothing after it
    expect(partAt(parts, 100)?.name).toBe('Solo');
  });
  it('the demo beat has its own; a song without any: its cues are the parts', () => {
    expect(partsOf(tl({ demo: true, duration: DEMO_SECONDS })).map((p) => p.at)).toEqual(sectionStarts().map((s) => s.at));
    const items = [
      { id: 'b', at: 41.8, lane: 'list:L', do: { do: 'goto' as const, list: 'L', cue: 'v' } },
      { id: 'a', at: 14.1, lane: 'list:L', do: { do: 'goto' as const, list: 'L', cue: 'v' } },
      { id: 'c', at: 14.1, lane: 'list:H', do: { do: 'goto' as const, list: 'H', cue: 'h' } },
      { id: 'm', at: 20, lane: 'special', do: { do: 'burst' as const, attr: 'confetti' as const, seconds: 1 } },
    ];
    expect(partsOf(tl({ items }), (i) => (i.do.do === 'goto' ? i.do.cue : '')).map((p) => [p.name, p.at])).toEqual([['v', 14.1], ['v', 41.8]]);
  });
});

describe('the beat a jump waits for', () => {
  it('the next beat of the song (its grid starts at the first downbeat), never the one it is on', () => {
    expect(beatAfter(tl(), 4.2)).toBeCloseTo(4.5, 9);
    expect(beatAfter(tl(), 4.5)).toBeCloseTo(5, 9);
    expect(beatAfter(tl({ offset: 0.25 }), 0)).toBeCloseTo(0.25, 9);
    expect(beatAfter(tl({ bpm: undefined }), 3.3)).toBe(3.3);                              // no tempo: at once
  });
});
