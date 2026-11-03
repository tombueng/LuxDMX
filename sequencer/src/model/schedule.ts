// A timetable: at 17:00 the opening look, at 21:00 the evening one, after midnight the late one,
// DJ night on Fridays and Saturdays. Each entry does what a cue action does (play a cue of a list,
// start or release a list, blackout). It runs while the app is open (the tablet or laptop stays on).
//
// The rule is "what came since the last look": every few seconds the app plays the latest entry
// whose time came since it last looked (`passed`). A tablet that slept through 21:00, even past
// midnight, catches up when it wakes; one switched on later picks up what came while it was off;
// the very first time, with nothing playing, it puts on what should be on now (`current`). Editing
// an entry never fires it by itself: a time already past isn't "since the last look".
//
// An entry can go by the sun instead ("30 min after sunset"): its time moves with the date, for the
// show's place (model/sun.ts). Its `at` is then kept at the day's time it was set on, which is what
// an older app that doesn't know the sun plays.
import type { CueAction } from './types';
import { sunTimes, type Place } from './sun';

export interface ScheduleEntry {
  id: string;
  at: string;          // "HH:MM", local time
  sun?: 'rise' | 'set';  // by the sun instead (then `at` is only for older apps)
  offset?: number;     // minutes after (negative: before) sunrise or sunset
  days?: number[];     // 0 = Sunday ... 6 = Saturday; none or empty: every day
  do: CueAction;
}

export const minutesOf = (at: string) => { const [h, m] = String(at).split(':').map(Number); return Math.min(23, h || 0) * 60 + Math.min(59, m || 0); };
// What a show file may hold: well-formed entries only (a hand-written file mustn't stop the clock).
export const validEntry = (e: unknown): e is ScheduleEntry => !!e && typeof e === 'object' && typeof (e as ScheduleEntry).id === 'string'
  && /^([01]\d|2[0-3]):[0-5]\d$/.test(String((e as ScheduleEntry).at)) && !!(e as ScheduleEntry).do && typeof (e as ScheduleEntry).do === 'object'
  && (!(e as ScheduleEntry).days || (Array.isArray((e as ScheduleEntry).days) && (e as ScheduleEntry).days!.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)))
  && ((e as ScheduleEntry).sun === undefined || (e as ScheduleEntry).sun === 'rise' || (e as ScheduleEntry).sun === 'set')
  && ((e as ScheduleEntry).offset === undefined || (Number.isFinite((e as ScheduleEntry).offset) && Math.abs((e as ScheduleEntry).offset!) <= 720));
const onDay = (e: ScheduleEntry, day: number) => !e.days?.length || e.days.includes(day);

// The minute of the day an entry comes on `day` (by the sun: that day's sunrise or sunset there,
// plus its offset). None when the sun doesn't rise or set that day (far north).
export function minuteOn(e: ScheduleEntry, day: Date, place?: Place): number | undefined {
  if (!e.sun || !place) return minutesOf(e.at);
  const t = sunTimes(day, place)[e.sun];
  if (t === undefined) return undefined;
  const d = new Date(t + (e.offset ?? 0) * 60e3), m = d.getHours() * 60 + d.getMinutes();
  // an offset that runs over midnight stays on its day (the far ends of the day)
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()) / 864e5);
  return days < 0 ? 0 : days > 0 ? 23 * 60 + 59 : m;
}
const hhmmOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// the time an entry says, for that day ("21:00", or today's "17:42" for "at sunset")
export const timeOn = (e: ScheduleEntry, day: Date, place?: Place) => { const m = minuteOn(e, day, place); return m === undefined ? '' : hhmmOf(m); };

// The latest entry whose time came in (from, to] (by the clock, over the days in between).
export function passed(entries: ScheduleEntry[], from: Date, to: Date, place?: Place): ScheduleEntry | undefined {
  let best: ScheduleEntry | undefined, bestT = -Infinity;
  for (let d = 0; d < 8; d++) {
    const day = new Date(to.getFullYear(), to.getMonth(), to.getDate() - d);
    if (new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime() <= from.getTime()) break;   // (a day isn't always 24 h: the clocks change)
    for (const e of entries) {
      if (!onDay(e, day.getDay())) continue;
      const m = minuteOn(e, day, place);
      if (m === undefined) continue;
      const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60).getTime();
      if (t > from.getTime() && t <= to.getTime() && t > bestT) { best = e; bestT = t; }
    }
  }
  return best;
}

// What should be on now: the entry whose time came last, today or on the days before (a tablet
// switched on at 00:30 shows last night's 21:00 look, not nothing).
export function current(entries: ScheduleEntry[], now: Date, place?: Place): ScheduleEntry | undefined {
  const mins = now.getHours() * 60 + now.getMinutes();
  for (let d = 0; d < 8; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
    const c = byTime(entries, day, place).filter(([e, m]) => onDay(e, day.getDay()) && (d > 0 || m <= mins));
    if (c.length) return c[c.length - 1][0];
  }
  return undefined;
}
// a day's entries with their minute, earliest first (ones that don't come that day left out)
const byTime = (entries: ScheduleEntry[], day: Date, place?: Place) =>
  entries.map((e) => [e, minuteOn(e, day, place)] as const).filter((x): x is readonly [ScheduleEntry, number] => x[1] !== undefined).sort((a, b) => a[1] - b[1]);

// The next entry to come (today later, or the next days), and when.
export function nextUp(entries: ScheduleEntry[], now: Date, place?: Place): { entry: ScheduleEntry; when: Date } | undefined {
  const mins = now.getHours() * 60 + now.getMinutes();
  for (let d = 0; d < 8; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    const todays = byTime(entries, day, place).filter(([e, m]) => onDay(e, day.getDay()) && (d > 0 || m > mins));
    if (todays.length) {
      const [e, m] = todays[0];
      return { entry: e, when: new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60) };
    }
  }
  return undefined;
}

// When an entry that just ran was due, said the way people say it: "21:00", or "Sunday 11:00"
// when it was another day (a tablet that caught up after a weekend).
export function whenSaid(e: ScheduleEntry, now: Date, place?: Place): string {
  const m = minuteOn(e, now, place), mins = now.getHours() * 60 + now.getMinutes();
  if (onDay(e, now.getDay()) && m !== undefined && m <= mins) return hhmmOf(m);
  for (let d = 1; d < 8; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d), dm = minuteOn(e, day, place);
    if (onDay(e, day.getDay()) && dm !== undefined) return `${d === 1 ? 'yesterday' : DAY_NAMES[day.getDay()]} ${hhmmOf(dm)}`;
  }
  return e.at;
}
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "in 2 h 46 min", "in 5 min", "tomorrow at 17:00", "on Friday at 22:00"
export function inWords(when: Date, now: Date): string {
  const m = Math.round((when.getTime() - now.getTime()) / 60000);
  if (m < 60) return `in ${Math.max(1, m)} min`;
  if (m < 12 * 60) return `in ${Math.floor(m / 60)} h ${m % 60} min`;
  const hhmm = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const days = Math.round((new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 864e5);
  return days <= 0 ? `at ${hhmm}` : days === 1 ? `tomorrow at ${hhmm}` : `on ${DAY_NAMES[when.getDay()]} at ${hhmm}`;
}
