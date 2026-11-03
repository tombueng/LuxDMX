// Effect machines in imported fixtures: which channels make fog, haze or bubbles, and which fire
// confetti, flames, sparks or CO2.
//
// The safety model (model/safety.ts) only works when a machine's channels carry those attributes:
// confetti, flames, sparks and CO2 send 0 until someone holds Arm, fog and haze go to 0 when the
// page closes. The fixture formats rarely say so plainly (QLC+ files a flame projector's fire
// channel under "Effect", OFL calls it an "EffectParameter", a fogger's output often comes in as a
// dimmer), so inside a fixture that IS a machine we go by its own words: its type or category, its
// name, its channels' names and value labels. Where a channel plainly fires the machine but we
// can't tell which kind it is, it gets a gated attribute: wrong that way, it only waits for arming.
// An ordinary light is never touched.
import type { ChannelAttr } from '../model/types';
import { enables, isGated } from '../model/safety';

export type Machine = 'fog' | 'haze' | 'bubbles' | 'confetti' | 'flame' | 'sparks' | 'co2';
// What the file says the fixture is: a light (never a machine), a fog machine or a hazer, or
// something that may be one (QLC+ "Effect" / "Other" / "Fan", OFL "Effect", GDTF: no category).
export type FixtureClass = 'light' | 'smoke' | 'hazer' | 'maybe';

export interface ChannelFacts {
  name: string;        // the channel's own name (GDTF: its attribute, pretty name and functions)
  caps: string[];      // its value labels
  attr: ChannelAttr;   // what the format's own rules made of it
  plain?: boolean;     // the format itself says what it is (OFL Fog, GDTF Fog(n), a timer): keep it
}

const MACHINES = new Set<string>(['fog', 'haze', 'bubbles', 'confetti', 'flame', 'sparks', 'co2']);
// what a machine's channel may have come in as; colours, wheels, pan/tilt and speeds stay as they are
const CANDIDATE = new Set<string>([...MACHINES, 'raw', 'intensity', 'strobe', 'shutter', 'control', 'fan']);
// only lights have these: a fixture with them is (also) a light (a fogger with LEDs)
const EMITTERS = new Set<string>(['red', 'green', 'blue', 'white', 'warmWhite', 'coolWhite', 'amber', 'uv', 'lime', 'cyan', 'magenta', 'yellow', 'colorWheel', 'gobo']);

// "Eco2Jet" -> "eco 2 jet", "StadiumShot III" -> "stadium shot iii", "Effects1" -> "effects 1".
// (CO2 is matched on the plain lower-case text, where "Eco2Jet" still says "co2".)
const norm = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2').toLowerCase();
const CO2 = /co-?2|co₂|cryo/;
const HAZE = /haze|faze/;
const FOG = /fog|smoke/;

// The machine a name says plainly ("Fire" isn't one: on a confetti cannon it just fires it).
function said(t: string, raw: string, kind?: Machine): Machine | undefined {
  if (/flame|pyro|ignit|burner/.test(t)) return 'flame';
  if (/spark(?!le)/.test(t)) return 'sparks';
  if (CO2.test(raw)) return 'co2';
  if (/confetti|streamer|hopper/.test(t)) return 'confetti';
  if (/bubble/.test(t)) return 'bubbles';
  if (HAZE.test(t)) return 'haze';
  if (FOG.test(t)) return kind === 'haze' ? 'haze' : 'fog';   // a hazer's "fog output" is its haze
  return undefined;
}

// What kind of machine a fixture is, from its type and its own name; undefined: not one we can name.
export function machineKind(cls: FixtureClass, words: string): Machine | undefined {
  if (cls === 'light') return undefined;
  const t = norm(words), raw = words.toLowerCase();
  if (/flame|pyro|ignit|burner|\bfire\b/.test(t)) return 'flame';      // ("Firefly", "Fireball", "Fireworks" are lights)
  if (/spark(?!le)/.test(t)) return 'sparks';
  // a "fogger CO2 FX" or a cryo fogger makes fog that looks like CO2
  if (CO2.test(raw) && !FOG.test(t) && !HAZE.test(t)) return 'co2';
  if (/confetti|streamer|\bshot\b|blaster|cannon/.test(t)) return 'confetti';
  if (/bubble/.test(t)) return 'bubbles';
  if (HAZE.test(t) || cls === 'hazer') return 'haze';
  if (FOG.test(t) || cls === 'smoke') return 'fog';
  if (/\bjet\b/.test(t)) return 'co2';                                // a jet that says nothing else: CO2, the usual one
  return undefined;
}

// Settings of a machine, not its output: a channel named like this keeps what the format made of
// it, unless its values say they make fog or fire flames (a timer whose top range fogs on its own).
const SETTING = /\b(modes?|programs?|macros?|chase|presets?|pattern|speed|rate|time|timer|interval|duration|delay|pause|sleep|temp|temperature|angle|direction|sound)\b/;
// A firing machine's interlock channel.
const INTERLOCK = /\b(safety|enable|enabled|arm|armed|interlock)\b/;
// Its safety and housekeeping: never an output, whatever the values say ("test mode, CO2 disabled").
const KEEP = /\b(safety|enable|enabled|arm|reset|heat|heater|heating|lamp|cool|cooling|prime|clean|clear|test|standby|power)\b/;
const KEEP_FIRING = /\b(safety|enable|enabled|reset|heat|heater|heating|lamp|cool|cooling|prime|clean|clear|standby)\b/;
// The light part of a machine (a fogger's LEDs).
const LED = /\b(leds?|lights?|bright|brightness|colou?rs?|rgb|red|green|blue|white|amber|uv|strobe|strobing|stroboscope|shutter)\b/;
const LED_DIMMER = /\b(dimmer|master)\b/;
// A channel that makes the machine go: its output, its trigger.
const TRIGGER = /\b(fire|trigger|go|shot|shoot|launch|release|valve|ignite|burst|blast|effects?|output)\b/;
const OUTPUT = /\b(on ?[-/]? ?off|pump|spray|spraying|amount|volume|density|level|intensity|emission|height|fountain|jet)\b/;
// value labels that say a value fires it
const FIRES = /\bfire\b|trigger|ignit|valve open|\bshot\b|launch|burst|blast/;
// ("Fan output level" is a fan; "Faze and fan" is haze)
function fanFirst(t: string) {
  const fan = t.search(/\b(fans?|blower)\b/);
  if (fan < 0) return false;
  const out = t.search(/fog|smoke|haze|faze|flame|spark|confetti|bubble|output|volume|amount|pump|density/);
  return out < 0 || fan < out;
}

function channelAttr(c: ChannelFacts, kind: Machine | undefined, lights: boolean): ChannelAttr {
  const base = c.attr;
  const t = norm(c.name), raw = c.name.toLowerCase();
  // its own safety / enable (an interlock): it follows the arming, so the person's Arm opens both
  // locks and Safe closes both (engine.ts). Only one we can work: no value list, or a value that
  // says it enables ("safe mode" and "test mode" lists stay what they were). Before the format's
  // own say: OFL files these as Maintenance.
  if (kind && isGated(kind) && INTERLOCK.test(t) && (!c.caps.length || c.caps.some(enables))) return 'enable';
  if (c.plain || !CANDIDATE.has(base)) return base;
  const capT = norm(c.caps.join(' | ')), capRaw = c.caps.join(' | ').toLowerCase();
  if (kind && !MACHINES.has(base) && base !== 'control' && fanFirst(t)) return 'fan';
  // (in a machine that fires, "test" and "power" may well fire it: those wait for arming too)
  if ((kind && isGated(kind) ? KEEP_FIRING : KEEP).test(t)) return base;
  const setting = SETTING.test(t);
  const named = setting ? undefined : said(t, raw, kind);
  if (named) return named;
  if (base === 'control' || base === 'fan' || MACHINES.has(base)) return base;
  // A light that may have a machine part: only what its channels' names say plainly (above), never
  // its value labels ("Flame red" on a colour macro, a "Flame" program)
  if (!kind && (lights || base === 'intensity')) return base;
  const fromCaps = said(capT, capRaw, kind);
  // a timer or program whose values fire a machine still fires it (a mode that makes fog stays a
  // mode: fog at half would pick a program)
  if (setting) return fromCaps && base !== 'intensity' && isGated(fromCaps) ? fromCaps : base;
  if (LED.test(t) || (lights && LED_DIMMER.test(t))) return base;
  if (!kind) {
    // A light that may have a machine part: only what its channels say plainly (above). A dark
    // "effect" fixture: what plainly fires it gets the best-fitting gated attribute.
    if (lights || base === 'intensity') return base;
    if (!TRIGGER.test(t) && !fromCaps && !FIRES.test(capT)) return base;
    const all = `${t} ${capT}`;
    return fromCaps ?? (/valve|\bjet\b/.test(all) ? 'co2' : /\bshot\b|launch|cannon|blast/.test(all) ? 'confetti' : 'flame');
  }
  // A fogger with LEDs has a real dimmer for them; a machine without, its "dimmer" is the output.
  if (base === 'intensity') return !lights || /\b(output|volume|amount|pump|density|spray|emission)\b/.test(t) ? kind : base;
  if (TRIGGER.test(t) || OUTPUT.test(t)) return kind;
  if (fromCaps) return fromCaps;
  return isGated(kind) && FIRES.test(capT) ? kind : base;
}

// The attribute of every channel of a fixture (all modes' channels, in any order), machines named.
export function machineAttrs(cls: FixtureClass, words: string, chans: ChannelFacts[]): ChannelAttr[] {
  if (cls === 'light') return chans.map((c) => c.attr);
  // (a strobe counts when it's called one: a fogger's "On-Off" comes in as a shutter)
  const lights = chans.some((c) => EMITTERS.has(c.attr) || ((c.attr === 'strobe' || c.attr === 'shutter') && LED.test(norm(c.name))));
  // A fixture with lamps that nothing but its name calls a machine is a light ("Jet Beam", "COB
  // Cannon Wash"): its channels say for themselves if one makes fog or fires something
  const lamp = lights || chans.some((c) => c.attr === 'shutter');
  const kind = cls === 'maybe' && lamp ? undefined : machineKind(cls, words);
  return chans.map((c) => channelAttr(c, kind, lights));
}

// Does a channel that became `after` (from `before`) need machineSpan: every machine channel, and a
// machine's fan we named (the format had it as a dimmer, with that dimmer's span).
export const needsSpan = (before: string, after: string) => MACHINES.has(after) || (after === 'fan' && before !== 'fan');

// Where a machine's level runs on its channel. 0 must reach the wire as 0 (off): the formats often
// start a fog range above a small dead band, and a span from there would send "a little fog" for
// off (a look without fog, the page closing). The gated machines use the whole channel (255 is
// "go" on every one we know); fog, haze, bubbles and fans stop below a top range that isn't output.
const NOT_OUTPUT = /prime|no ?function|auto|standby|shut ?down|heat|test|reset|maintenance|idle|clean|timer|mode|program/;
export function machineSpan(attr: ChannelAttr, ranges: { from: number; to: number; label: string }[]): [number, number] | undefined {
  if (isGated(attr) || !(MACHINES.has(attr) || attr === 'fan')) return undefined;
  const r = [...ranges].sort((a, b) => a.from - b.from);
  let top = 255;
  while (r.length > 1 && NOT_OUTPUT.test(norm(r[r.length - 1].label))) top = r.pop()!.from - 1;
  return top > 0 && top < 255 ? [0, top] : undefined;
}
