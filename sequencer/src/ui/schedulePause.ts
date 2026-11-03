// Pausing the timetable (the Live header's next-up chip and the timetable dialog offer the same):
// a party tonight in the room the window show lights, or a rehearsal that runs late.
import { app } from '../app.svelte';
import { ui, type MenuItem } from './ui.svelte';

// the next 06:00 (tonight's entries skipped, tomorrow's play)
export function morning(now = new Date()) {
  const d = new Date(now);
  d.setHours(6, 0, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}
export const hhmm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };   // (as the timetable says times)
const pause = (until: number, what: string) => { app.pauseSchedule(until); app.toastUndo(`Timetable paused ${what}`); };

export function pauseItems(): MenuItem[] {
  const off = !!app.show.settings.scheduleOff, paused = app.schedulePausedUntil;
  return [
    ...(off || paused ? [{ label: off ? 'Switch the timetable on' : 'Play the timetable again now', icon: 'play', run: () => { if (off) app.setScheduleOn(true); else app.pauseSchedule(null); ui.toast('The timetable plays again (from now on)'); } }, { sep: true }] : []),
    { label: 'Skip tonight (until 06:00)', icon: 'moon', disabled: off, run: () => pause(morning(), 'until 06:00') },
    { label: 'Pause for 3 hours', icon: 'clock', disabled: off, run: () => { const t = Date.now() + 3 * 3600e3; pause(t, `until ${hhmm(t)}`); } },
    ...(!off ? [{ label: 'Switch the timetable off', icon: 'stop', run: () => { app.setScheduleOn(false); app.toastUndo('Timetable off: nothing plays by the clock'); } }] : []),
  ];
}
