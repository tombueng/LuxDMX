import { describe, expect, it } from 'vitest';
import { guessPlace, sunTimes } from './sun';
import { nextUp, passed, validEntry, type ScheduleEntry } from './schedule';

const BERLIN = { lat: 52.52, lon: 13.4 };
const utc = (t?: number) => (t === undefined ? 'none' : new Date(t).toISOString().slice(11, 16));
// a local calendar day whatever the test machine's zone (sunTimes takes the date, not the hour)
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

describe('sunrise and sunset', () => {
  it('Berlin at midsummer and midwinter (to a couple of minutes of the almanac)', () => {
    const near = (t: number | undefined, hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number), d = new Date(t!);
      expect(Math.abs(d.getUTCHours() * 60 + d.getUTCMinutes() - (h * 60 + m))).toBeLessThanOrEqual(2);
    };
    const jun = sunTimes(day(2026, 6, 21), BERLIN), dec = sunTimes(day(2026, 12, 21), BERLIN);
    near(jun.rise, '02:43'); near(jun.set, '19:33');        // 04:43 and 21:33 summer time
    near(dec.rise, '07:15'); near(dec.set, '14:54');        // 08:15 and 15:54
  });
  it('none at all in the polar night or the midnight sun', () => {
    const tromso = { lat: 69.65, lon: 18.96 };
    expect(sunTimes(day(2026, 12, 21), tromso)).toEqual({});
    expect(sunTimes(day(2026, 6, 21), tromso)).toEqual({});
    expect(utc(sunTimes(day(2026, 3, 20), tromso).set)).not.toBe('none');
  });
  it('a place from the time zone: its city, or its meridian when the zone is unknown', () => {
    expect(guessPlace('Europe/Berlin')).toMatchObject({ lat: 52.52, lon: 13.4, name: 'Berlin', guessed: true });
    const p = guessPlace('Etc/Unknown');
    expect(p.name).toBe('Unknown');
    expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
  });
});

describe('timetable entries by the sun', () => {
  // a place in this machine's own time zone (a show's sunset falls on its own day there)
  const HERE = guessPlace();
  const dusk: ScheduleEntry = { id: 'dusk', at: '18:00', sun: 'set', offset: 30, do: { do: 'blackout', on: false } };
  const close: ScheduleEntry = { id: 'close', at: '23:00', do: { do: 'off' } };
  it('come at that day\'s sunset plus the offset, moving with the seasons', () => {
    const jun = nextUp([dusk, close], new Date(sunTimes(day(2026, 6, 21), HERE).set! - 3600e3), HERE)!;
    const dec = nextUp([dusk, close], new Date(sunTimes(day(2026, 12, 21), HERE).set! - 3600e3), HERE)!;
    expect(jun.entry.id).toBe('dusk'); expect(dec.entry.id).toBe('dusk');
    expect(jun.when.getTime() - sunTimes(day(2026, 6, 21), HERE).set!).toBeGreaterThanOrEqual(29 * 60e3);
    expect(jun.when.getTime() - sunTimes(day(2026, 6, 21), HERE).set!).toBeLessThanOrEqual(30 * 60e3);
    expect(dec.when.getTime() - sunTimes(day(2026, 12, 21), HERE).set!).toBeLessThanOrEqual(30 * 60e3);
  });
  it('the clock passing it plays it; a day the sun doesn\'t set it doesn\'t come', () => {
    const set = sunTimes(day(2026, 10, 28), HERE).set! + 30 * 60e3;
    expect(passed([dusk, close], new Date(set - 5e3 - 60e3), new Date(set + 5e3), HERE)?.id).toBe('dusk');
    const north = { lat: 78.2, lon: 15.6 };      // Longyearbyen in December: no sunset, only closing
    expect(nextUp([dusk, close], day(2026, 12, 21), north)?.entry.id).toBe('close');
  });
  it('a show file may hold them; nonsense offsets or suns are dropped', () => {
    expect(validEntry(dusk)).toBe(true);
    expect(validEntry({ ...dusk, sun: 'noon' })).toBe(false);
    expect(validEntry({ ...dusk, offset: 99999 })).toBe(false);
    expect(validEntry({ ...dusk, offset: 'x' })).toBe(false);
  });
});
