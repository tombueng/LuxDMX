// What a light or a machine does when it gets a value, for safety: plain light (try it as often as
// you like), atmosphere (fog, haze, bubbles: repeatable, but fog can set off smoke detectors and
// uses fluid), once (confetti: used up when it fires) and hazard (flames, sparks, CO2: dangerous).
// Once and hazard only reach the wire while a person has armed the machines (app.sfxArmed); the
// 2D and 3D stages show them either way. Scrubbing a timeline never fires a moment at all.
import type { ChannelAttr, Cue, CueAction, FixtureMode, Show } from './types';

export type Risk = 'light' | 'atmosphere' | 'once' | 'hazard';
export const ATTR_RISK: Partial<Record<ChannelAttr, Risk>> = {
  fog: 'atmosphere', haze: 'atmosphere', bubbles: 'atmosphere',
  confetti: 'once',
  flame: 'hazard', sparks: 'hazard', co2: 'hazard',
  // a winch moves a load over people: dangerous; it waits for Arm too, but held, never sent to 0
  // (0 is its top: a winch sent there on a safe frame would run all the way up)
  hoist: 'hazard',
};
// the attributes that hold where they are while safe (instead of 0): a winch's position
export const HELD: ChannelAttr[] = ['hoist'];
export const isHeld = (a: string) => (HELD as string[]).includes(a);
// A machine that waits for Arm (it has a gated channel): its own programs (built-in effects and
// colour programs) can fire it too, so they wait for Arm as well, and mark a cue as it does.
export const isMachine = (m: FixtureMode | undefined) => !!m && m.channels.some((c) => isGated(c.attr));
// a winch (its LED ball is still a light: it isn't a machine in the lists, only on the wire)
export const isKinetic = (m: FixtureMode | undefined) => !!m && m.channels.some((c) => isHeld(c.attr));
// A winch's own programs and control channels (a wave program, homing, a reset) move it too: while
// safe they're held at their "off" (the range that says no function / off / stop, at its middle; 0
// without one). Its colour programs are its ball's light, not motion.
export const KINETIC_CTL = ['effectMacro', 'control'];
const CTL_OFF = /\b(off|no\s*function|none|nothing|stop(ped)?|standby|idle|disabled?|no\s*effect|manual|normal)\b/i;
export function kineticOff(c: { ranges?: { from: number; to: number; label: string }[] }): number {
  const r = c.ranges?.find((x) => CTL_OFF.test(x.label));
  return r ? Math.round((r.from + r.to) / 2) : 0;
}
export const MACHINE_PROGRAMS = ['effectMacro', 'colorMacro'] as const;
// the attributes that wait for the machines to be armed
export const GATED = (Object.keys(ATTR_RISK) as ChannelAttr[]).filter((a) => (ATTR_RISK[a] === 'once' || ATTR_RISK[a] === 'hazard') && !(HELD as string[]).includes(a));
export const isGated = (a: string) => (GATED as string[]).includes(a);
// The longest an armed machine stays on in one go (seconds). A shot is short (confetti, a flame,
// a CO2 jet: a second or two; sparks a few seconds); anything holding one open longer (a recorded
// look, a cue nobody moves on from) is cut off, and that machine waits until it has been off.
export const MAX_ON: Partial<Record<ChannelAttr, number>> = { confetti: 5, flame: 5, co2: 5, sparks: 30 };

// A machine's own safety / enable channel (attribute 'enable') follows the arming. On while armed:
// the value its range list calls enabled, live, armed, active or ready, or "safety off" (never
// "pre-enable", a test mode, "safe", "disarmed"); full when it has no list. Off while safe: a value
// outside every enabling range (0 unless 0 enables it: then the range that says safe, disabled or
// off). A list that says nothing enables it: never on (the machine won't fire: safe).
const ENABLED = /\b(enabled?|armed|active|ready|unlock(ed)?|live)\b/i;
const NOT_ENABLED = /\b(disabled?|disarmed|unarmed|inactive|not|no|off|pre-?enabled?|test|safe)\b/i;
export const enables = (label: string) => /\bsafety\s*off\b/i.test(label) || (ENABLED.test(label) && !NOT_ENABLED.test(label));
const mid = (r: { from: number; to: number }) => Math.round((r.from + r.to) / 2);
export function enableValue(ranges?: { from: number; to: number; label: string }[]): { on?: number; off: number } {
  if (!ranges?.length) return { on: 255, off: 0 };
  const yes = ranges.filter((x) => enables(x.label)), no = ranges.filter((x) => !enables(x.label));
  const inYes = (v: number) => yes.some((x) => v >= x.from && v <= x.to);
  const safe = no.find((x) => /\b(safe|disabled?|disarmed|off)\b/i.test(x.label)) ?? no[0];
  const off = !inYes(0) ? 0 : safe ? mid(safe) : 0;
  return yes.length && !inYes(off) ? { on: mid(yes[0]), off } : { off };
}

const ORDER: Risk[] = ['light', 'atmosphere', 'once', 'hazard'];
// the most serious of a fixture's attributes
export function riskOf(attrs: Iterable<string>): Risk {
  let r: Risk = 'light';
  for (const a of attrs) { const x = ATTR_RISK[a as ChannelAttr]; if (x && ORDER.indexOf(x) > ORDER.indexOf(r)) r = x; }
  return r;
}
const worse = (a: Risk, b: Risk): Risk => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a);
// What a cue sets off: the most serious thing in its values, and in the lists its actions play
// (a "Big finish" that starts the confetti and the CO2 lists fires them). For marks on tiles, cards
// and the timeline, so nobody presses one without knowing.
// `machineOf`: a fixture's risk when it's a machine (its programs fire it), for the cue's values
// that are a machine's programs.
// `channel`: what one of a fixture's channels fires, by number (a cue's raw values: "channel 1 at
// 255" on a flame projector is its fire)
export interface MachineOf { (fixtureId: string): Risk | undefined; channel?: (fixtureId: string, ch: number) => Risk | undefined }
export function cueRisk(show: Pick<Show, 'cueLists'>, cue: Pick<Cue, 'values' | 'actions'>, seen = new Set<string>(), machineOf?: MachineOf): Risk {
  let r: Risk = 'light';
  for (const [fid, v] of Object.entries(cue.values ?? {})) {
    r = worse(r, riskOf(Object.keys(v ?? {})));
    // (one of several winches moved by a cell of its own)
    for (const c of Object.values(v?.cells ?? {})) if (c) r = worse(r, riskOf(Object.keys(c)));
    if (machineOf && v && MACHINE_PROGRAMS.some((k) => (v as Record<string, unknown>)[k] !== undefined)) { const m = machineOf(fid); if (m) r = worse(r, m); }
    if (machineOf?.channel && v?.raw) for (const [ch, x] of Object.entries(v.raw)) { if (!(Number(x) > 0)) continue; const c = machineOf.channel(fid, +ch); if (c) r = worse(r, c); }
  }
  for (const a of cue.actions ?? []) r = worse(r, actionRisk(show, a, seen, machineOf));
  return r;
}
export function actionRisk(show: Pick<Show, 'cueLists'>, a: CueAction, seen = new Set<string>(), machineOf?: MachineOf): Risk {
  if (a.do !== 'start' && a.do !== 'go' && a.do !== 'goto') return 'light';
  const l = show.cueLists.find((x) => x.id === a.list);
  if (!l || seen.has(l.id)) return 'light';
  seen.add(l.id);
  const cues = a.do === 'goto' ? l.cues.filter((c) => c.id === a.cue) : l.cues;
  return cues.reduce<Risk>((r, c) => worse(r, cueRisk(show, c, seen, machineOf)), 'light');
}
export function listRisk(show: Pick<Show, 'cueLists'>, id: string, machineOf?: MachineOf): Risk { return actionRisk(show, { do: 'start', list: id }, undefined, machineOf); }
// a short mark for it ('' for plain light and atmosphere): a warning sign, or 1× for confetti
export const MARK_HINT: Record<Risk, string> = { light: '', atmosphere: '', once: 'fires once (confetti)', hazard: 'fires a machine (flames, sparks or CO2)' };

export const RISK_LABEL: Record<Risk, string> = {
  light: 'Light',
  atmosphere: 'Fog, haze or bubbles',
  once: 'Fires once',
  hazard: 'Dangerous',
};
export const RISK_HINT: Record<Risk, string> = {
  light: 'Safe to try as often as you like.',
  atmosphere: 'Repeatable. Fog can set off smoke detectors and uses fluid.',
  once: 'Used up when it fires (confetti). Only fires while the machines are armed.',
  hazard: 'Flames, sparks or CO2. Only fires while the machines are armed, and never from scrubbing the timeline.',
};
