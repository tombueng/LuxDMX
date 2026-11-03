import { describe, expect, it } from 'vitest';
import { current, inWords, nextUp, passed, validEntry, type ScheduleEntry } from './schedule';

const e = (id: string, at: string, days?: number[]): ScheduleEntry => ({ id, at, days, do: { do: 'blackout', on: false } });
const bar = [e('open', '17:00'), e('eve', '21:00'), e('late', '00:00'), e('dj', '22:00', [5, 6])];
const at = (y: number, mo: number, d: number, h: number, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s);

describe('the timetable', () => {
  it('plays the latest entry that came since it last looked', () => {
    expect(passed(bar, at(2026, 10, 28, 20, 59, 58), at(2026, 10, 28, 21, 0, 3))?.id).toBe('eve');
    expect(passed(bar, at(2026, 10, 28, 21, 0, 3), at(2026, 10, 28, 21, 0, 8))).toBeUndefined();   // nothing twice
    expect(passed(bar, at(2026, 10, 28, 16, 0), at(2026, 10, 28, 22, 10))?.id).toBe('eve');        // slept: the latest of 17:00 and 21:00
  });
  it('a tablet that slept across midnight catches up with what came last', () => {
    expect(passed(bar, at(2026, 10, 28, 20, 0), at(2026, 10, 29, 0, 30))?.id).toBe('late');
    expect(passed([e('eve', '21:00')], at(2026, 10, 28, 20, 0), at(2026, 10, 29, 0, 30))?.id).toBe('eve');
  });
  it('an entry edited to a time already past doesn\'t fire (it isn\'t "since the last look")', () => {
    expect(passed([e('x', '02:00')], at(2026, 10, 28, 14, 58, 0), at(2026, 10, 28, 14, 58, 5))).toBeUndefined();
  });
  it('Friday 22:00 is DJ night, not the evening look', () => {
    expect(passed(bar, at(2026, 10, 30, 21, 59, 58), at(2026, 10, 30, 22, 0, 1))?.id).toBe('dj');
  });
  it('the first time, with nothing playing, what should be on now: last night\'s look after midnight too', () => {
    const shop = [e('open', '17:00'), e('eve', '21:00')];
    expect(current(shop, at(2026, 10, 29, 0, 30))?.id).toBe('eve');
    expect(current(shop, at(2026, 10, 29, 9, 0))?.id).toBe('eve');
    expect(current(shop, at(2026, 10, 29, 17, 5))?.id).toBe('open');
    expect(current(bar, at(2026, 10, 31, 1, 0))?.id).toBe('late');
    expect(current([e('dj', '22:00', [5])], at(2026, 11, 2, 12, 0))?.id).toBe('dj');
    expect(current([], at(2026, 11, 2, 12, 0))).toBeUndefined();
  });
  it('says what comes next and when', () => {
    const wed = at(2026, 10, 28, 18, 14);
    const n = nextUp(bar, wed)!;
    expect(n.entry.id).toBe('eve');
    expect(inWords(n.when, wed)).toBe('in 2 h 46 min');
    const late = nextUp(bar, at(2026, 10, 28, 23, 0))!;
    expect(late.entry.id).toBe('late');
    expect(inWords(late.when, at(2026, 10, 28, 23, 0))).toBe('in 1 h 0 min');
    expect(inWords(at(2026, 10, 30, 22, 0), at(2026, 10, 28, 9, 0))).toBe('on Friday at 22:00');
  });
  it('only well-formed entries come in from a file', () => {
    expect(validEntry(e('a', '21:00'))).toBe(true);
    expect(validEntry({ id: 'a', at: 2100, do: {} })).toBe(false);
    expect(validEntry({ id: 'a', at: '25:00', do: {} })).toBe(false);
    expect(validEntry({ id: 'a', at: '21:00', days: [7], do: {} })).toBe(false);
  });
});
