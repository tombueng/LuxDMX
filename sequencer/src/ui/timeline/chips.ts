// What the timeline's palette offers (a cue, an effect, a moment, a change of the crowd) and how
// each is said on the tracks. A chip dragged carries itself as text of its own type.
import type { BurstAttr, CrowdAction, TimelineAction } from '../../model/timeline';

export type Chip = { kind: 'cue'; list: string; cue: string } | { kind: 'fx'; effect: string } | { kind: 'burst'; attr: BurstAttr; s: number }
  | { kind: 'act'; a: TimelineAction } | { kind: 'crowd'; a: CrowdAction; len: number };
export const DT = 'application/x-luxdmx-timeline';

// the crowd's moments: how it sounds from there on (got to over the bar's length), or a cheer
export const CROWD: { label: string; a: CrowdAction; len: number; tip: string }[] = [
  { label: 'Chatter', a: { do: 'crowd', mood: 'chatter', level: 0.5 }, len: 2, tip: 'People talking while they wait' },
  { label: 'Cheering', a: { do: 'crowd', mood: 'cheer', level: 0.5 }, len: 2, tip: 'The crowd cheers from here on' },
  { label: 'Roar', a: { do: 'crowd', mood: 'cheer', level: 1 }, len: 1, tip: 'As loud as they get' },
  { label: 'Quiet', a: { do: 'crowd', mood: 'cheer', level: 0 }, len: 3, tip: 'The crowd goes quiet' },
  { label: 'Cheer!', a: { do: 'cheer', level: 1 }, len: 4, tip: 'A cheer that swells up and dies away' },
];
export const crowdLabel = (a: CrowdAction) => {
  const pc = `${Math.round(a.level * 100)} %`;
  if (a.do === 'cheer') return `Cheer! ${pc}`;
  if (a.level === 0) return 'Crowd quiet';
  return `${a.mood === 'chatter' ? 'Chatter' : a.level >= 0.95 ? 'Roar' : 'Cheering'} ${pc}`;
};
// the machine moments (and a strobe or blinder hit, any light does those), their length in seconds
export const BURSTS: { attr: BurstAttr; label: string; s: number }[] = [
  { attr: 'confetti', label: 'Confetti', s: 1 }, { attr: 'flame', label: 'Flames', s: 1.5 }, { attr: 'sparks', label: 'Sparks', s: 4 },
  { attr: 'co2', label: 'CO2 jet', s: 2 }, { attr: 'bubbles', label: 'Bubbles', s: 8 }, { attr: 'fog', label: 'Fog', s: 5 },
  { attr: 'strobe', label: 'Strobe hit', s: 2 }, { attr: 'blinder', label: 'Blinder hit', s: 1 }];
export const ARMED_ONLY: string[] = ['confetti', 'flame', 'sparks', 'co2'];
export const burstLabel = (attr: BurstAttr) => BURSTS.find((b) => b.attr === attr)?.label ?? attr;
