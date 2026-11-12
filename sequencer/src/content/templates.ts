// Starter shows. Each one is a typical rig with fixtures where they'd hang, groups, and cues that
// already look right, so the first light is one click away. Every fixture is a generic type, so the
// template works with whatever cheap PAR you own; patch addresses can be changed later. They're
// generous on purpose (movers, pixel bars, strobes, blinders, haze and the effect machines): it's
// quicker to delete what you don't have than to build what you'd like to try.
// The first lights, groups, effects and cues of each are the small rig these started as (the
// tests lean on those), everything else comes after them.
import { emptyShow } from '../model/format';
import { GENERIC, modeOf } from '../model/library';
import { slotsOf } from '../engine/render';
import type { ChannelAttr, Color, Cue, CueList, Effect, Fixture, Group, Show, Values } from '../model/types';
import { D, DECK, W, aimRot, defaultPlace, planToWorld } from '../stage3d/geometry';
import { addStandardPresets } from './presets';

export const C = {
  red: { r: 1, g: 0, b: 0 }, orange: { r: 1, g: 0.45, b: 0 }, amber: { r: 1, g: 0.65, b: 0.1 }, yellow: { r: 1, g: 0.9, b: 0 },
  green: { r: 0, g: 1, b: 0.1 }, cyan: { r: 0, g: 0.9, b: 1 }, blue: { r: 0, g: 0.15, b: 1 }, deepBlue: { r: 0.05, g: 0, b: 0.6 },
  purple: { r: 0.55, g: 0, b: 1 }, magenta: { r: 1, g: 0, b: 0.75 }, pink: { r: 1, g: 0.3, b: 0.6 },
  warm: { r: 1, g: 0.72, b: 0.42 }, white: { r: 1, g: 1, b: 1 }, cool: { r: 0.8, g: 0.9, b: 1 },
  lavender: { r: 0.6, g: 0.45, b: 1 }, teal: { r: 0, g: 0.75, b: 0.6 }, gold: { r: 1, g: 0.78, b: 0.3 }, ice: { r: 0.55, g: 0.85, b: 1 },
} satisfies Record<string, Color>;

// The gobo wheel of the generic spot (library.ts, gen-spotgobo): a cue stores the slot as a fraction.
const GOBOS = ['Open', 'Dots', 'Star', 'Ring', 'Bars', 'Flower', 'Triangles', 'Spiral'] as const;
export const gobo = (name: (typeof GOBOS)[number]) => GOBOS.indexOf(name) / (GOBOS.length - 1);

// A generic type's slot or named range as the value a cue stores, by its name (a name it doesn't
// have is a mistake in the demo, said at once): a slot (a gobo, a colour) is its place on its wheel;
// a range is a point in it (`at`: 0 its start, 1 its end), as the channel sends it.
function channelOf(typeId: string, attr: ChannelAttr) {
  const c = modeOf(GENERIC.find((g) => g.id === typeId), '')?.channels.find((x) => x.attr === attr && !x.fine && x.cell === undefined);
  if (!c) throw new Error(`${typeId} has no ${attr} channel`);
  return c;
}
export function slotValue(typeId: string, attr: ChannelAttr, label: string): number {
  const slots = slotsOf(channelOf(typeId, attr)), i = slots.findIndex((r) => r.label === label);
  if (i < 0) throw new Error(`${typeId} ${attr}: no slot "${label}"`);
  return slots.length > 1 ? i / (slots.length - 1) : 0;
}
export function rangeValue(typeId: string, attr: ChannelAttr, label: string, at = 0.5): number {
  const r = channelOf(typeId, attr).ranges?.find((x) => x.label === label);
  if (!r) throw new Error(`${typeId} ${attr}: no range "${label}"`);
  return Math.round(r.from + (r.to - r.from) * Math.max(0, Math.min(1, at))) / 255;
}

// the slot names of a generic type's wheel, in order (the test truss walks through them)
export const slotNames = (typeId: string, attr: ChannelAttr) => slotsOf(channelOf(typeId, attr)).map((r) => r.label ?? '');

// How a gobo head is dressed in a look: its gobos (by the slot's name), turning (-1..1: CCW..CW, how
// fast), a prism (its range's name) turning too, the animation wheel (how far in), iris and frost.
// Every look dresses all its gobo heads (unset: open, no prism, still), so nothing carries over from
// the look before.
export interface Dress { gobo?: string; gobo2?: string; spin?: number; prism?: string; prismSpin?: number; anim?: number; iris?: number; frost?: number; shake?: number; scroll?: number }
const spinOf = (typeId: string, attr: ChannelAttr, spin?: number) =>
  !spin ? rangeValue(typeId, attr, 'Stop') : spin > 0 ? rangeValue(typeId, attr, 'Rotation CW fast..slow', 1 - Math.min(1, spin)) : rangeValue(typeId, attr, 'Rotation CCW slow..fast', Math.min(1, -spin));
// the Profile spot (gen-profile): two wheels, prisms, animation, iris, frost
export const profile = (d: Dress = {}): Values => ({
  gobo: slotValue('gen-profile', 'gobo', d.gobo ?? 'Open'), gobo2: slotValue('gen-profile', 'gobo2', d.gobo2 ?? 'Open'),
  goboRotation: spinOf('gen-profile', 'goboRotation', d.spin), prism: rangeValue('gen-profile', 'prism', d.prism ?? 'Open'),
  prismRotation: spinOf('gen-profile', 'prismRotation', d.prism ? d.prismSpin : 0),
  animation: d.anim ? rangeValue('gen-profile', 'animation', 'In (how far)', d.anim) : 0,
  animationRotation: spinOf('gen-profile', 'animationRotation', d.anim ? 0.5 : 0), iris: d.iris ?? 0, frost: d.frost ?? 0,
  goboShake: d.shake ?? 0, goboScroll: d.scroll ?? 0,
});
// the generic gobo spot (gen-spotgobo): one wheel turning either way, a plain prism that turns too
export const spotGobo = (d: Dress = {}): Values => ({
  gobo: slotValue('gen-spotgobo', 'gobo', d.gobo ?? 'Open'), goboRotation: spinOf('gen-spotgobo', 'goboRotation', d.spin), prism: d.prism ? 1 : 0,
  prismRotation: spinOf('gen-spotgobo', 'prismRotation', d.prism ? d.prismSpin : 0),
});
// a gobo turning on a head (-1..1: CCW .. CW, how fast), as its rotation channel's ranges send it
export const turn = (typeId: string, spin: number) => spinOf(typeId, 'goboRotation', spin);

// The effect machines, each as a one-shot cue list: a GO (a tap on the live page, a cue's action,
// the timeline) fires it for a few seconds and it ends by itself. Nothing in a template leaves a
// machine running.
export type Machine = 'confetti' | 'co2' | 'sparks' | 'flame' | 'bubbles';
const SHOTS: { attr: Machine; list: string; cue: string; secs: number; color: string; also?: Values }[] = [
  { attr: 'confetti', list: 'Confetti', cue: 'Shot', secs: 0.5, color: '#ff4fd8' },
  { attr: 'co2', list: 'CO2', cue: '1.5 s jet', secs: 1.5, color: '#bfe9ff' },
  { attr: 'sparks', list: 'Sparks', cue: '3 s of sparks', secs: 3, color: '#ffd23f' },
  { attr: 'flame', list: 'Flames', cue: 'A short shot', secs: 0.4, color: '#ff6a1a' },
  { attr: 'bubbles', list: 'Bubbles', cue: '20 s of bubbles', secs: 20, color: '#7fd8ff', also: { fan: 1 } },
];

export class Builder {
  s: Show;
  private next = new Map<number, number>();
  private n = 0;
  constructor(name: string) { this.s = emptyShow(name); }
  // `count` fixtures of a generic type in a row across the stage at height y. `from`: the number
  // the names start at (a second row of "Side 3", "Side 4").
  add(typeId: string, count: number, name: string, y: number, opts: { universe?: number; x0?: number; x1?: number; from?: number } = {}): string[] {
    const t = GENERIC.find((g) => g.id === typeId)!;
    const width = modeOf(t, '')!.channels.length;
    const u = opts.universe ?? 0, x0 = opts.x0 ?? 0.12, x1 = opts.x1 ?? 0.88, from = opts.from ?? 1;
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const address = this.next.get(u) ?? 1;
      this.next.set(u, address + width);
      const id = `f${++this.n}`;
      const f: Fixture = { id, name: count > 1 || from > 1 ? `${name} ${i + from}` : name, typeId, mode: t.modes[0].name, universe: u, address,
        x: count > 1 ? x0 + (x1 - x0) * i / (count - 1) : (x0 + x1) / 2, y };
      this.s.fixtures.push(f);
      ids.push(id);
    }
    return ids;
  }
  fx(ids: string[]) { return ids.map((id) => this.s.fixtures.find((f) => f.id === id)!); }
  // put lights on the plan by hand: at height y, at these x (a row shared by several kinds)
  at(ids: string[], y: number, xs: number[]) { this.fx(ids).forEach((f, i) => { f.y = y; f.x = xs[i]; }); return ids; }
  // where they really are in 3D (when hung or stood somewhere the plan can't say)
  place(ids: string[], fn: (f: Fixture, i: number, n: number) => void) { this.fx(ids).forEach((f, i, a) => fn(f, i, a.length)); }
  // standing on the deck at its front edge, tipped up and back towards the band (uplights)
  uplights(ids: string[]) { this.place(ids, (f) => { f.p3 = { x: planToWorld(f.x, f.y).x, y: DECK, z: D / 2 - 0.25 }; f.rot = { yaw: 180, pitch: 25, roll: 0 }; }); }
  group(name: string, fixtures: string[]): string {
    const g: Group = { id: `g${this.s.groups.length + 1}`, name, fixtures };
    this.s.groups.push(g);
    return g.id;
  }
  list(name: string, extra: Partial<CueList> = {}): CueList {
    const l: CueList = { id: `l${this.s.cueLists.length + 1}`, name, cues: [], end: 'stop', ...extra };
    this.s.cueLists.push(l);
    return l;
  }
  effect(name: string, kind: string, group: string, params: Record<string, unknown> = {}): string {
    const e: Effect = { id: `e${this.s.effects.length + 1}`, name, kind, group, params };
    this.s.effects.push(e);
    return e.id;
  }
  done(): Show { addStandardPresets(this.s); return this.s; }
  cue(l: CueList, name: string, parts: [string[], Values][], extra: Partial<Cue> = {}): Cue {
    const values: Record<string, Values> = {};
    for (const [ids, v] of parts) for (const id of ids) values[id] = { ...values[id], ...v };
    const c: Cue = { id: `${l.id}c${l.cues.length + 1}`, name, values, fade: 2, advance: { mode: 'manual' }, ...extra };
    l.cues.push(c);
    return c;
  }
  // The fixtures with a channel for `attr`.
  having(attr: ChannelAttr) { return this.s.fixtures.filter((f) => modeOf(GENERIC.find((g) => g.id === f.typeId), f.mode)?.channels.some((c) => c.attr === attr)).map((f) => f.id); }
  // A one-shot list: one cue that sets `values` for `secs` seconds, then the list lets go at once.
  shot(name: string, ids: string[], values: Values, secs: number, cue: string, color: string): CueList {
    const l = this.list(name, { end: 'release', releaseTime: 0, color });
    this.cue(l, cue, [[ids, values]], { fade: 0, advance: { mode: 'wait', time: secs } });
    return l;
  }
  // A one-shot list for each kind of effect machine in the rig (the live page shows them as buttons).
  machines(): Partial<Record<Machine, CueList>> {
    const out: Partial<Record<Machine, CueList>> = {};
    for (const m of SHOTS) {
      const ids = this.having(m.attr);
      if (ids.length) out[m.attr] = this.shot(m.list, ids, { [m.attr]: 1, ...m.also }, m.secs, m.cue, m.color);
    }
    return out;
  }
  // Haze for the whole night, on its own list (a toggle with the fog on the live page).
  haze(ids: string[], level = 0.35): CueList {
    const l = this.list('Haze', { color: '#8a94a3' });
    this.cue(l, 'Haze on', [[ids, { haze: level, fan: 0.5 }]], { fade: 0 });
    return l;
  }
}
export const on = (intensity: number, color?: Color, more: Values = {}): Values => ({ intensity, ...(color ? { color } : {}), ...more });
// a cue's action: fire a machine's shot (or any list) with the cue
const fire = (...lists: (CueList | undefined)[]) => lists.filter((l): l is CueList => !!l).map((l) => ({ do: 'start' as const, list: l.id }));
// odd and even lights in two colours
const split = (ids: string[], a: Color, b: Color, level = 1, more: Values = {}): [string[], Values][] =>
  [[ids.filter((_, i) => i % 2 === 0), on(level, a, more)], [ids.filter((_, i) => i % 2 === 1), on(level, b, more)]];

export interface Template { name: string; icon: string; blurb: string; build: () => Show }

export const TEMPLATES: Template[] = [
  {
    name: 'Band', icon: 'mover', blurb: 'PARs, spots, washes, pixel bars, blinders, strobes, haze and every effect machine. Looks for a whole gig.',
    build: () => {
      const b = new Builder('Band night');
      const front = b.add('gen-drgb', 4, 'Front', 0.7);
      const back = b.add('gen-drgbwauvs', 4, 'Back', 0.22);
      const movers = b.add('gen-mover16', 2, 'Mover', 0.06, { x0: 0.2, x1: 0.8 });
      const fog = b.add('gen-fog', 1, 'Fog', 0.54, { x0: 0.5, x1: 0.5 });
      // the bigger rig: spots between the movers and strobes on the back truss, pixel bars on the
      // risers, washes on the mid truss, blinders on the front truss, the machines on the deck
      const spots = b.add('gen-spotgobo', 4, 'Spot', 0.06, { x0: 0.32, x1: 0.68 });
      const washes = b.add('gen-wash', 6, 'Wash', 0.54, { x0: 0.1, x1: 0.9 });
      const bars = b.add('gen-bar16', 4, 'Bar', 0.38, { x0: 0.2, x1: 0.8 });
      const blinders = b.at(b.add('gen-blinder2', 4, 'Blinder', 0.86), 0.86, [0.3, 0.43, 0.57, 0.7]);
      const strobes = b.add('gen-strobe', 2, 'Strobe', 0.06, { x0: 0.06, x1: 0.94 });
      const hazer = b.add('gen-hazer', 1, 'Hazer', 0.22, { x0: 0.03, x1: 0.03 });
      b.add('gen-confetti', 2, 'Confetti', 0.86, { x0: 0.16, x1: 0.84 });
      b.add('gen-flame', 2, 'Flame', 0.86, { x0: 0.05, x1: 0.95 });
      b.add('gen-sparks', 2, 'Sparks', 0.38, { x0: 0.05, x1: 0.95 });
      b.add('gen-co2', 2, 'CO2', 0.7, { x0: 0.25, x1: 0.75 });
      b.add('gen-bubbles', 1, 'Bubbles', 0.22, { x0: 0.5, x1: 0.5 });
      b.group('Front', front);
      const gBack = b.group('Back', back), gMov = b.group('Movers', movers);
      const gSpot = b.group('Spots', spots), gWash = b.group('Washes', washes), gBar = b.group('Pixel bars', bars);
      b.group('Blinders', blinders); b.group('Strobes', strobes);
      const sweep = b.effect('Movers sweep', 'pan', gMov, { size: 0.3, speed: 8 });
      const circle = b.effect('Movers circle', 'circle', gMov, { size: 0.3, speed: 4 });
      const wave = b.effect('Back wave', 'wave', gBack, { low: 0.35, speed: 4 });
      const bally = b.effect('Spots ballyhoo', 'ballyhoo', gSpot, { speed: 8 });
      const fan = b.effect('Spots fan', 'fan', gSpot, { size: 0.5, speed: 8 });
      const swing = b.effect('Washes swing', 'swing', gWash, { size: 0.25, speed: 8 });
      const chase = b.effect('Wash colours', 'colorChase', gWash, { speed: 4 });
      const lightning = b.effect('Lightning', 'lightning', gBack, { size: 0.6 });
      const scanner = b.effect('Bar scanner', 'scanner', gBar, {});
      const meteors = b.effect('Bar meteor rain', 'meteorRain', gBar, {});
      const heart = b.effect('Bar heartbeat', 'heartbeat', gBar, {});
      const fire2012 = b.effect('Bar fire', 'fire2012', gBar, {});
      const twinkle = b.effect('Bar twinkles', 'twinkle', gBar, {});
      const pride = b.effect('Bar colour waves', 'pride', gBar, {});
      const lights = [front, back, movers, spots, washes, bars, blinders, strobes].flat();
      const dark: [string[], Values][] = [[lights, { intensity: 0 }]];
      // the lists: the songs and the fog timer as they were, then haze and the machines' shots
      const songs = b.list('Songs', { play: false });                  // looks to pick (a note is a reminder, not a play)
      const fl = b.list('Fog timer', { end: 'loop', color: '#8a94a3' });
      b.haze(hazer);
      const m = b.machines();
      // the four the band started with (every light named, so a look never inherits the last one)
      b.cue(songs, 'Walk-in', [...dark, [front, on(0.4, C.warm)], [back, on(0.3, C.deepBlue)], [movers, on(0, C.white, { pan: 0.5, tilt: 0.3 })],
        [washes, on(0.3, C.deepBlue, { pan: 0.5, tilt: 0.55, zoom: 0.8 })], [bars, on(0.35, C.warm)], [spots, on(0, C.white, { pan: 0.5, tilt: 0.5 })]], { fade: 3, effects: [twinkle] });
      b.cue(songs, 'Verse', [...dark, [front, on(0.7, C.warm)], [back, on(0.8, C.red)], [movers, on(0.6, C.amber, { pan: 0.5, tilt: 0.55 })],
        [washes, on(0.6, C.orange, { pan: 0.5, tilt: 0.55, zoom: 0.6 })], [spots, on(0.5, C.amber, { pan: 0.5, tilt: 0.52, gobo: gobo('Dots'), zoom: 0.2 })], [bars, on(0.6, C.red)]], { effects: [sweep, wave, meteors] });
      b.cue(songs, 'Chorus', [...dark, [front, on(1, C.white)], [back, on(1, C.magenta)], [movers, on(1, C.cyan, { pan: 0.5, tilt: 0.75 })],
        [washes, on(1, C.purple, { pan: 0.5, tilt: 0.6, zoom: 0.4 })], [spots, on(1, C.white, { pan: 0.5, tilt: 0.7, zoom: 0.05 })], [bars, on(1)]], { fade: 0.5, effects: [circle, bally, pride] });
      b.cue(songs, 'Ballad', [...dark, [front, on(0.5, C.warm)], [back, on(0.6, C.blue)], [movers, on(0.3, C.purple, { pan: 0.5, tilt: 0.4 })],
        [washes, on(0.4, C.deepBlue, { pan: 0.5, tilt: 0.5, zoom: 1 })], [spots, on(0.5, C.lavender, { pan: 0.5, tilt: 0.52, gobo: gobo('Star'), goboRotation: turn('gen-spotgobo', 0.4), zoom: 0.3 })], [bars, on(0.3, C.blue)]], { fade: 4, effects: [twinkle] });
      b.cue(songs, 'Intro: thunder', [...dark, [back, on(0.25, C.deepBlue)], [washes, on(0.35, C.deepBlue, { pan: 0.5, tilt: 0.5, zoom: 0.9 })],
        [spots, on(1, C.white, { pan: 0.5, tilt: 0.5, zoom: 0, gobo: gobo('Open') })], [strobes, on(0)]], { fade: 3, effects: [lightning, fan] });
      b.cue(songs, 'Rock out', [...dark, ...split(back, C.red, C.white), [front, on(0.9, C.white)], [movers, on(1, C.red, { pan: 0.5, tilt: 0.7 })],
        [washes, on(1, C.red, { pan: 0.5, tilt: 0.6, zoom: 0.3 })], [spots, on(1, C.white, { pan: 0.5, tilt: 0.7, zoom: 0.05, prism: 1 })], [bars, on(1, C.red)]], { fade: 0.2, effects: [bally, swing, scanner] });
      b.cue(songs, 'Guitar solo', [...dark, [front, on(0.2, C.red)], [back, on(0.4, C.red)], [movers, on(1, C.white, { pan: 0.42, tilt: 0.56 })],
        [spots, on(1, C.white, { pan: 0.42, tilt: 0.58, zoom: 0 })], [washes, on(0.5, C.red, { pan: 0.5, tilt: 0.5, zoom: 0.2 })], [bars, on(0.8, C.orange)]], { fade: 1, effects: [meteors] });
      b.cue(songs, 'Drum solo', [...dark, [back, on(1, C.amber)], [washes, on(0.8, C.amber, { pan: 0.5, tilt: 0.52, zoom: 0.1 })], [bars, on(1, C.red)],
        [spots, on(1, C.amber, { pan: 0.5, tilt: 0.5, zoom: 0, gobo: gobo('Ring') })], [strobes, on(1, undefined, { strobe: 0.4 })]], { fade: 0.2, effects: [heart, chase] });
      b.cue(songs, 'Love song', [...dark, [front, on(0.6, C.pink)], [back, on(0.5, C.magenta)], [washes, on(0.5, C.pink, { pan: 0.5, tilt: 0.55, zoom: 1 })],
        [spots, on(0.4, C.pink, { pan: 0.5, tilt: 0.55, gobo: gobo('Flower'), goboRotation: turn('gen-spotgobo', 0.3) })], [bars, on(0.4)]], { fade: 5, effects: [pride, sweep] });
      b.cue(songs, 'Big finish', [...dark, [lights, on(1, C.white)], [movers, { pan: 0.5, tilt: 0.75 }], [washes, { pan: 0.5, tilt: 0.7, zoom: 0.5 }],
        [spots, { pan: 0.5, tilt: 0.75, zoom: 0.05 }], [strobes, { strobe: 0.7 }]], { fade: 0, effects: [bally, swing], actions: fire(m.confetti, m.co2, m.sparks), note: 'Confetti, CO2 and sparks' });
      b.cue(songs, 'Encore', [...dark, [front, on(0.8, C.amber)], [back, on(1, C.orange)], [movers, on(1, C.orange, { pan: 0.5, tilt: 0.7 })],
        [washes, on(0.9, C.red, { pan: 0.5, tilt: 0.6, zoom: 0.5 })], [spots, on(1, C.amber, { pan: 0.5, tilt: 0.7, zoom: 0.1 })], [bars, on(1)]], { fade: 0.5, effects: [fire2012, circle, bally], actions: fire(m.flame) });
      b.cue(songs, 'Blackout', [[lights, on(0)]], { fade: 0 });
      b.cue(fl, 'Fog on', [[fog, { fog: 1 }]], { fade: 0, advance: { mode: 'wait', time: 3 } });
      b.cue(fl, 'Fog off', [[fog, { fog: 0 }]], { fade: 0, advance: { mode: 'wait', time: 117 } });
      return b.done();
    },
  },
  {
    name: 'DJ / Party', icon: 'bar', blurb: 'PARs, beams, washes, pixel battens, uplights, strobes, blinders, haze, CO2, confetti and more. Party moods.',
    build: () => {
      const b = new Builder('Party');
      const pars = b.add('gen-rgb', 8, 'PAR', 0.7);
      const bars = b.add('gen-bar8', 2, 'Bar', 0.22, { x0: 0.22, x1: 0.78 });
      const movers = b.add('gen-mover8', 2, 'Mover', 0.06, { x0: 0.17, x1: 0.83 });
      const strobe = b.add('gen-strobe', 1, 'Strobe', 0.06, { x0: 0.5, x1: 0.5 });
      b.add('gen-fog', 1, 'Fog', 0.22, { x0: 0.5, x1: 0.5 });
      // the bigger rig, all on the same universe: beams and two more strobes on the back truss
      // with the heads, washes on the mid truss, pixel battens on the deck, uplights at the front
      // edge, blinders at the sides, the machines on the deck behind the booth. (The plan keeps
      // room a third of the way in from each side, between the bars and the washes, for lights
      // you add.)
      const beams = b.at(b.add('gen-spotgobo', 4, 'Beam', 0.06), 0.06, [0.28, 0.39, 0.61, 0.72]);
      const washes = b.at(b.add('gen-wash', 4, 'Wash', 0.38), 0.38, [0.155, 0.42, 0.58, 0.845]);
      const battens = b.at(b.add('gen-bar16', 4, 'Batten', 0.54), 0.54, [0.2, 0.37, 0.63, 0.8]);
      const ups = b.add('gen-drgbw', 8, 'Uplight', 0.86, { x0: 0.06, x1: 0.94 });
      b.uplights(ups);
      const blinders = b.add('gen-blinder2', 2, 'Blinder', 0.38, { x0: 0.05, x1: 0.95 });
      const sideStrobes = b.add('gen-strobe', 2, 'Strobe', 0.06, { x0: 0.06, x1: 0.94, from: 2 });
      const hazer = b.add('gen-hazer', 1, 'Hazer', 0.38, { x0: 0.5, x1: 0.5 });
      b.add('gen-co2', 2, 'CO2', 0.22, { x0: 0.05, x1: 0.95 });
      b.at(b.add('gen-confetti', 2, 'Confetti', 0.38), 0.38, [0.25, 0.75]);
      b.add('gen-sparks', 2, 'Sparks', 0.54, { x0: 0.06, x1: 0.94 });
      b.at(b.add('gen-flame', 2, 'Flame', 0.22), 0.22, [0.42, 0.58]);
      b.add('gen-bubbles', 1, 'Bubbles', 0.54, { x0: 0.5, x1: 0.5 });
      const gPar = b.group('PARs', pars), gBar = b.group('Bars', bars), gMov = b.group('Movers', movers);
      b.group('Strobe', strobe);
      const gBeam = b.group('Beams', beams), gWash = b.group('Washes', washes), gBat = b.group('Battens', battens), gUp = b.group('Uplights', ups);
      b.group('Audience', blinders); b.group('Strobes', [...strobe, ...sideStrobes]);
      const fade = b.effect('PAR colour fade', 'colorFade', gPar, { speed: 16, spread: 0.5 });
      const alt = b.effect('PARs alternate', 'alternate', gPar, { speed: 1 });
      const meteor = b.effect('Bar meteor', 'meteor', gBar, { speed: 2 });
      const ocean = b.effect('Ocean', 'ocean', gPar, {});
      const fireFx = b.effect('Fire', 'fire', gPar, {});
      const rainbow = b.effect('Rainbow', 'rainbow', gBar, { speed: 8 });
      const bally = b.effect('Ballyhoo', 'ballyhoo', gMov, {});
      const fig8 = b.effect('Figure eight', 'figure8', gMov, {});
      // sound to light: they react to the microphone (♪), and sit at a plain level without it
      const pulse = b.effect('Sound pulse', 'sound', gPar, {});
      b.effect('Bars VU meter', 'vu', gBar, {});
      const beamFan = b.effect('Beam fan', 'fan', gBeam, { size: 0.6, speed: 8 });
      const beamCircle = b.effect('Beam circles', 'circle', gBeam, { size: 0.35, speed: 4, spread: 0.5 });
      const beamBally = b.effect('Beam ballyhoo', 'ballyhoo', gBeam, { speed: 8 });
      const washChase = b.effect('Wash colour chase', 'colorChase', gWash, { speed: 2 });
      const upRainbow = b.effect('Uplight rainbow', 'rainbow', gUp, { speed: 8 });
      const random = b.effect('PAR random colours', 'random', gPar, { speed: 1 });
      // the pixel shows, on the battens
      const px = (name: string, kind: string, params: Record<string, unknown> = {}) => b.effect(name, kind, gBat, params);
      const theater = px('Theater chase', 'theater'), juggle = px('Juggle', 'juggle'), sinelon = px('Sinelon', 'sinelon'), bouncing = px('Bouncing balls', 'bouncing');
      const ripple = px('Ripples', 'ripple'), works = px('Fireworks', 'fireworks'), matrix = px('Matrix rain', 'matrix'), plasma = px('Plasma', 'plasma');
      const glitter = px('Rainbow glitter', 'glitter'), popcorn = px('Popcorn', 'popcorn'), gradient = px('Gradient chase', 'gradientChase'), rain = px('Rain', 'rain');
      const lights = [pars, bars, movers, strobe, beams, washes, battens, ups, blinders, sideStrobes].flat();
      const dark: [string[], Values][] = [[[...beams, ...washes, ...battens, ...ups, ...blinders, ...sideStrobes], { intensity: 0 }]];
      const ml = b.list('Moods', { play: false });
      b.haze(hazer);
      const m = b.machines();
      const evenOdd = (ids: string[], a: Color, c: Color): [string[], Values][] => [[ids.filter((_, i) => i % 2 === 0), on(1, a)], [ids.filter((_, i) => i % 2 === 1), on(1, c)]];
      const head = (pan: number, tilt: number, more: Values = {}): Values => ({ pan, tilt, ...more });
      // the six it started with, now lighting the whole rig
      b.cue(ml, 'Warm-up', [...dark, [pars, on(0.6, C.purple)], [bars, on(0.5, C.blue)], [movers, on(0.4, C.cyan, head(0.5, 0.6))],
        [washes, on(0.4, C.purple, head(0.5, 0.55, { zoom: 0.8 }))], [ups, on(0.5, C.blue)], [battens, on(0.4, C.purple)]], { fade: 3, effects: [fade, fig8, sinelon] });
      b.cue(ml, 'Red / blue', [...dark, ...evenOdd(pars, C.red, C.blue), [bars, on(1, C.magenta)], [movers, on(1, C.white, head(0.5, 0.7))],
        ...split(washes, C.red, C.blue, 1, head(0.5, 0.6, { zoom: 0.4 })), ...split(ups, C.blue, C.red), [beams, on(1, C.white, head(0.5, 0.7, { zoom: 0 }))], [battens, on(1, C.red)]], { effects: [alt, meteor, fig8, beamFan] });
      b.cue(ml, 'Ocean', [...dark, [pars, on(0.8, C.cyan)], [bars, on(0.8, C.blue)], [movers, on(0.7, C.blue, head(0.5, 0.5))],
        [washes, on(0.7, C.teal, head(0.5, 0.55, { zoom: 1 }))], [ups, on(0.8, C.blue)], [battens, on(0.7, C.cyan)]], { fade: 3, effects: [ocean, ripple] });
      b.cue(ml, 'Fire', [...dark, ...evenOdd(pars, C.red, C.orange), [bars, on(1, C.amber)], [movers, on(0.8, C.orange, head(0.5, 0.8))],
        [washes, on(1, C.orange, head(0.5, 0.6, { zoom: 0.6 }))], [ups, on(1, C.red)], [battens, on(1, C.orange)]], { effects: [fireFx, bally], actions: fire(m.flame) });
      b.cue(ml, 'Bass', [...dark, [pars, on(1, C.magenta)], [bars, on(1, C.blue)], [movers, on(0.8, C.magenta, head(0.5, 0.65))],
        [washes, on(0.8, C.blue, head(0.5, 0.6, { zoom: 0.5 }))], [ups, on(1, C.magenta)], [battens, on(1, C.blue)]], { fade: 1, effects: [pulse, bally, popcorn] });
      b.cue(ml, 'Full on', [[lights, on(1, C.white)], [movers, head(0.5, 0.7)], [beams, head(0.5, 0.75, { zoom: 0 })], [washes, head(0.5, 0.65, { zoom: 0.5 })], [strobe, { strobe: 0 }]],
        { fade: 0.3, effects: [rainbow, bally, beamBally, upRainbow, glitter] });
      b.cue(ml, 'Neon', [...dark, ...evenOdd(pars, C.pink, C.cyan), [bars, on(1, C.magenta)], [movers, on(1, C.cyan, head(0.5, 0.7))],
        [beams, on(1, C.magenta, head(0.5, 0.72, { zoom: 0 }))], [washes, on(1, C.pink, head(0.5, 0.6, { zoom: 0.4 }))], [ups, on(1, C.cyan)], [battens, on(1)]], { fade: 0.5, effects: [gradient, washChase, beamFan] });
      b.cue(ml, 'Matrix', [...dark, [pars, on(0.3, C.green)], [bars, on(1, C.green)], [movers, on(0.8, C.green, head(0.5, 0.75))],
        [beams, on(1, C.green, head(0.5, 0.78, { zoom: 0, prism: 1 }))], [washes, on(0.5, C.green, head(0.5, 0.55, { zoom: 0.2 }))], [ups, on(0.6, C.green)], [battens, on(1, C.green)]], { fade: 1, effects: [matrix, beamFan] });
      b.cue(ml, 'Fireworks', [...dark, [pars, on(0.2, C.deepBlue)], [movers, on(1, C.white, head(0.5, 0.8))], [beams, on(1, C.white, head(0.5, 0.8, { zoom: 0 }))],
        [washes, on(0.4, C.deepBlue, head(0.5, 0.5, { zoom: 1 }))], [ups, on(0.4, C.deepBlue)], [battens, on(1)]], { fade: 0.5, effects: [works, beamBally, bally], actions: fire(m.sparks) });
      b.cue(ml, 'Disco', [...dark, [pars, on(1, C.white)], [bars, on(1)], [movers, on(1, C.white, head(0.5, 0.65))],
        [beams, on(1, C.white, head(0.5, 0.65, { gobo: gobo('Dots'), prism: 1, zoom: 0.2 }))], [washes, on(0.6, C.purple, head(0.5, 0.55, { zoom: 0.7 }))], [ups, on(1, C.magenta)], [battens, on(1)]],
      { fade: 1, effects: [random, beamCircle, rainbow, glitter] });
      b.cue(ml, 'Plasma', [...dark, [pars, on(0.7, C.purple)], [bars, on(0.8, C.blue)], [movers, on(0.6, C.purple, head(0.5, 0.6))],
        [washes, on(0.8, C.lavender, head(0.5, 0.58, { zoom: 0.8 }))], [ups, on(0.8, C.purple)], [battens, on(1)]], { fade: 2, effects: [plasma, fig8] });
      b.cue(ml, 'Rain', [...dark, [pars, on(0.4, C.blue)], [bars, on(0.6, C.cyan)], [beams, on(1, C.ice, head(0.5, 0.52, { zoom: 0 }))],
        [washes, on(0.5, C.deepBlue, head(0.5, 0.5, { zoom: 1 }))], [ups, on(0.7, C.cyan)], [battens, on(1, C.ice)]], { fade: 2, effects: [rain, beamCircle] });
      b.cue(ml, 'Juggle', [...dark, ...evenOdd(pars, C.yellow, C.purple), [bars, on(1, C.yellow)], [movers, on(1, C.yellow, head(0.5, 0.7))],
        [washes, on(0.8, C.purple, head(0.5, 0.6, { zoom: 0.5 }))], [ups, on(0.8, C.yellow)], [battens, on(1)]], { fade: 0.5, effects: [juggle, fig8, washChase] });
      b.cue(ml, 'Bounce', [...dark, [pars, on(0.8, C.orange)], [bars, on(1, C.amber)], [beams, on(1, C.amber, head(0.5, 0.7, { zoom: 0.05 }))],
        [washes, on(0.7, C.orange, head(0.5, 0.6, { zoom: 0.4 }))], [ups, on(0.8, C.orange)], [battens, on(1)]], { fade: 0.5, effects: [bouncing, beamBally] });
      b.cue(ml, 'Theater lights', [...dark, [pars, on(0.7, C.gold)], [bars, on(1, C.gold)], [washes, on(0.6, C.warm, head(0.5, 0.55, { zoom: 0.8 }))],
        [ups, on(0.7, C.gold)], [battens, on(1, C.gold)]], { fade: 1, effects: [theater, alt] });
      b.cue(ml, 'Peak time', [[lights, on(1, C.white)], [movers, head(0.5, 0.75)], [beams, head(0.5, 0.8, { zoom: 0, prism: 1 })], [washes, head(0.5, 0.7, { zoom: 0.3 })],
        [[...strobe, ...sideStrobes], { strobe: 0.85 }], [battens, on(1)]], { fade: 0, effects: [beamBally, bally, glitter, popcorn], actions: fire(m.co2, m.confetti), note: 'CO2 and confetti' });
      b.cue(ml, 'Wind down', [...dark, [pars, on(0.4, C.amber)], [bars, on(0.4, C.orange)], [movers, on(0.2, C.amber, head(0.5, 0.5))],
        [washes, on(0.3, C.orange, head(0.5, 0.5, { zoom: 1 }))], [ups, on(0.4, C.amber)], [battens, on(0.6)]], { fade: 6, effects: [sinelon, fade], actions: fire(m.bubbles) });
      return b.done();
    },
  },
  {
    name: 'Theatre', icon: 'dimmer', blurb: 'Dimmers, a coloured cyc, booms, specials, spots with gobos, footlights, house lights on their own list. A GO cue list with fog, snow-white bubbles and a confetti finale.',
    build: () => {
      const b = new Builder('Play');
      const front = b.add('gen-dimmer', 6, 'Front', 0.7, { x0: 0.15, x1: 0.85 });
      const cyc = b.at(b.add('gen-rgbw', 4, 'Cyc', 0.06), 0.06, [0.18, 0.36, 0.64, 0.82]);
      // over the audience, between the footlights (so the names don't meet)
      const house = b.add('gen-dimmer', 2, 'House', 0.86, { x0: 0.3, x1: 0.7 });
      // the rest of a well-stocked stage: booms at the sides, specials, moving spots and washes over
      // the stage, footlights, a ground row for the cyc, a lightning strobe, the machines
      const side = [...b.add('gen-drgbw', 2, 'Boom', 0.38, { x0: 0.05, x1: 0.95 }), ...b.add('gen-drgbw', 2, 'Boom', 0.54, { x0: 0.05, x1: 0.95, from: 3 })];
      const specials = b.at(b.add('gen-dimmer', 4, 'Special', 0.54), 0.54, [0.25, 0.45, 0.55, 0.75]);
      const spots = b.at(b.add('gen-spotgobo', 4, 'Spot', 0.38), 0.38, [0.2, 0.4, 0.6, 0.8]);
      const washes = b.at(b.add('gen-wash', 4, 'Wash', 0.54), 0.54, [0.15, 0.35, 0.65, 0.85]);
      const foot = b.add('gen-bar8', 4, 'Footlight', 0.86, { x0: 0.2, x1: 0.8 });
      const ground = b.add('gen-bar12', 3, 'Ground row', 0.22, { x0: 0.25, x1: 0.75 });
      const lightningStrobe = b.add('gen-strobe', 1, 'Lightning', 0.06, { x0: 0.5, x1: 0.5 });
      const blinders = b.add('gen-blinder2', 2, 'Blinder', 0.86, { x0: 0.06, x1: 0.94 });
      const fog = b.add('gen-fog', 1, 'Fog', 0.22, { x0: 0.06, x1: 0.06 });
      const hazer = b.add('gen-hazer', 1, 'Hazer', 0.06, { x0: 0.94, x1: 0.94 });
      b.add('gen-confetti', 1, 'Confetti', 0.86, { x0: 0.5, x1: 0.5 });
      b.add('gen-co2', 1, 'CO2', 0.22, { x0: 0.94, x1: 0.94 });
      b.add('gen-sparks', 2, 'Sparks', 0.7, { x0: 0.05, x1: 0.95 });
      b.at(b.add('gen-flame', 2, 'Flame', 0.22), 0.22, [0.375, 0.625]);
      b.add('gen-bubbles', 1, 'Bubbles', 0.06, { x0: 0.06, x1: 0.06 });
      // in 3D: the front light on the front truss, the booms on stands at the sides aimed across
      b.place(front, (f) => { const d = defaultPlace({ x: f.x, y: 0.8 }, 'dimmer'); f.p3 = d.p; f.rot = d.rot; });
      b.place(side, (f) => { const s = f.x < 0.5 ? -1 : 1; f.p3 = { x: s * (W / 2 - 0.4), y: DECK + 1.8, z: (f.y - 0.5) * D }; f.rot = aimRot(f.p3, { x: -s * 2, y: DECK + 1.2, z: f.p3.z }); });
      b.group('Front', front); const gCyc = b.group('Cyc', cyc); b.group('House', house);
      b.group('Booms', side); b.group('Specials', specials);
      const gSpot = b.group('Spots', spots), gWash = b.group('Washes', washes), gFoot = b.group('Footlights', foot), gGround = b.group('Ground row', ground);
      const storm = b.effect('Storm', 'lightning', gCyc, { size: 0.7 });
      const flash = b.effect('Lightning strobe', 'lightning', b.group('Lightning', lightningStrobe), { size: 0.7 });
      const aurora = b.effect('Aurora on the cyc', 'aurora', gGround, {});
      const stars = b.effect('Stars', 'twinkle', gGround, {});
      const hearth = b.effect('Fireplace', 'fire2012', gGround, {});
      const rain = b.effect('Rain on the cyc', 'rain', gGround, {});
      const marquee = b.effect('Footlight chase', 'theater', gFoot, {});
      const waltz = b.effect('Spots waltz', 'circle', gSpot, { size: 0.3, speed: 6 });
      const drift = b.effect('Cyc drift', 'colorFade', gCyc, { speed: 30, tempo: false, spread: 0.5, colors: [C.deepBlue, C.purple, C.blue] });
      const sway = b.effect('Washes sway', 'swing', gWash, { size: 0.15, speed: 8 });
      const extra = [side, specials, spots, washes, foot, ground, lightningStrobe, blinders].flat();
      const out: [string[], Values][] = [[extra, { intensity: 0 }]];
      const down = (more: Values = {}): Values => ({ pan: 0.5, tilt: 0.5, ...more });
      // the house list goes round (full, half, out, full again); show cues call its cues by name
      const hl = b.list('House lights', { priority: 'high', color: '#ffaa1c', releaseTime: 8, end: 'loop' });
      const hFull = b.cue(hl, 'House full', [[house, on(1)]], { fade: 3 });
      b.cue(hl, 'House half', [[house, on(0.5)]], { fade: 5 });
      const hOut = b.cue(hl, 'House out', [[house, on(0)]], { fade: 8 });
      const show = b.list('Show');
      b.haze(hazer, 0.25);
      const fogShot = b.shot('Fog burst', fog, { fog: 1 }, 5, '5 s of fog', '#8a94a3');
      const m = b.machines();
      b.cue(show, 'Preset', [...out, [front, on(0.3)], [cyc, on(0.4, C.deepBlue)], [ground, on(0.3, C.deepBlue)]], { fade: 3, note: 'Audience coming in', actions: [{ do: 'goto', list: hl.id, cue: hFull.id }] });
      b.cue(show, 'Scene 1', [...out, [front, on(0.85)], [cyc, on(0.7, C.warm)], [side, on(0.6, C.warm)], [ground, on(0.5, C.amber)]], { fade: 4, actions: [{ do: 'goto', list: hl.id, cue: hOut.id }], note: 'House lights fade out with it' });
      b.cue(show, 'Night', [...out, [front, on(0.3)], [cyc, on(0.6, C.blue)], [side, on(0.3, C.deepBlue)], [ground, on(0.6)], [washes, on(0.3, C.deepBlue, down({ zoom: 1 }))]], { fade: 6, effects: [stars] });
      b.cue(show, 'Sunrise', [...out, [front, on(0.8)], [cyc, on(1, C.orange)], [side, on(0.7, C.gold)], [ground, on(1, C.orange)], [washes, on(0.5, C.amber, down({ zoom: 1 }))]], { fade: 10 });
      b.cue(show, 'Storm', [...out, [front, on(0.25)], [cyc, on(0.35, C.deepBlue)], [side, on(0.4, C.ice)], [ground, on(0.5)], [lightningStrobe, on(0)], [washes, on(0.4, C.deepBlue, down({ zoom: 0.8 }))]],
        { fade: 2, effects: [storm, flash, rain, sway], actions: [{ do: 'start', list: fogShot.id }], note: 'Thunder on the sound cue, fog with it' });
      b.cue(show, 'Dream', [...out, [front, on(0.2, undefined)], [cyc, on(0.6, C.lavender)], [ground, on(0.8)], [specials, on(0.5)],
        [spots, on(0.8, C.lavender, down({ tilt: 0.55, gobo: gobo('Star'), goboRotation: turn('gen-spotgobo', 0.4), zoom: 0.4, focus: 0.5 }))], [washes, on(0.5, C.purple, down({ zoom: 1 }))]],
      { fade: 8, effects: [aurora, drift, waltz], actions: fire(m.bubbles), note: 'Bubbles with the music' });
      b.cue(show, 'Ballroom', [...out, [front, on(0.7)], [cyc, on(0.8, C.gold)], [side, on(0.8, C.warm)], [ground, on(0.6, C.amber)],
        [spots, on(1, C.white, down({ tilt: 0.6, gobo: gobo('Dots'), prism: 1, zoom: 0.5 }))], [washes, on(0.6, C.gold, down({ zoom: 0.7 }))]], { fade: 4, effects: [waltz] });
      b.cue(show, 'Fireside', [...out, [front, on(0.35, undefined)], [cyc, on(0.3, C.red)], [specials, on(0.6)], [ground, on(1)], [side, on(0.4, C.orange)]],
        { fade: 5, effects: [hearth], actions: fire(m.flame), note: 'Flames on the bang' });
      b.cue(show, 'Finale', [...out, [front, on(1)], [cyc, on(1, C.magenta)], [side, on(1, C.white)], [ground, on(1)], [foot, on(1, C.gold)], [blinders, on(1)],
        [spots, on(1, C.white, down({ tilt: 0.7, zoom: 0.1 }))], [washes, on(1, C.pink, down({ tilt: 0.6, zoom: 0.4 }))]],
      { fade: 1, effects: [marquee, waltz], actions: fire(m.confetti, m.sparks, m.co2), note: 'Confetti, sparks and CO2 on the last note' });
      b.cue(show, 'Bows', [...out, [front, on(1)], [cyc, on(0.8, C.warm)], [side, on(0.8, C.warm)], [foot, on(1, C.gold)], [ground, on(0.6, C.amber)]], { fade: 2, effects: [marquee] });
      b.cue(show, 'End', [[[...front, ...cyc, ...extra], on(0)]], { fade: 3, actions: [{ do: 'goto', list: hl.id, cue: hFull.id }], note: 'House lights up with it' });
      // the show first, house lights second (then the haze, the fog and the machines)
      [b.s.cueLists[0], b.s.cueLists[1]] = [show, hl];
      return b.done();
    },
  },
  {
    name: 'Church', icon: 'sun', blurb: 'Warm/cool white front light, a colour wash, altar and choir light, moving washes. Looks for services, weddings and Christmas.',
    build: () => {
      const b = new Builder('Sunday service');
      const front = b.add('gen-wwcw', 4, 'Front', 0.75);
      const wash = b.add('gen-drgbw', 4, 'Wash', 0.2);
      // the rest: the altar and the lectern, the choir, moving washes for the band, the walls lit
      // from below, blinders for a concert, haze, and the happy machines (bubbles, confetti, sparks)
      const altar = b.add('gen-cct', 2, 'Altar', 0.47, { x0: 0.42, x1: 0.58 });
      const lectern = b.add('gen-cct', 1, 'Lectern', 0.55, { x0: 0.18, x1: 0.18 });
      const choir = b.add('gen-wwcw', 4, 'Choir', 0.34, { x0: 0.2, x1: 0.8 });
      const heads = b.add('gen-wash', 4, 'Head', 0.09, { x0: 0.2, x1: 0.8 });
      const walls = [...b.add('gen-drgbw', 3, 'Wall', 0.32, { x0: 0.02, x1: 0.02 }), ...b.add('gen-drgbw', 3, 'Wall', 0.32, { x0: 0.98, x1: 0.98, from: 4 })];
      b.place(walls, (f, i) => { const side = i < 3 ? -1 : 1, k = i % 3; f.y = 0.3 + k * 0.2; f.p3 = { x: side * 6.6, y: DECK, z: -3 + k * 2.6 }; f.rot = { yaw: -side * 90, pitch: 12, roll: 0 }; });
      const blinders = b.add('gen-blinder2', 2, 'Blinder', 0.88, { x0: 0.3, x1: 0.7 });
      const battens = b.add('gen-bar16', 2, 'Batten', 0.47, { x0: 0.25, x1: 0.75 });
      const hazer = b.add('gen-hazer', 1, 'Hazer', 0.55, { x0: 0.82, x1: 0.82 });
      b.add('gen-bubbles', 1, 'Bubbles', 0.92, { x0: 0.5, x1: 0.5 });
      b.add('gen-confetti', 2, 'Confetti', 0.95, { x0: 0.1, x1: 0.9 });
      b.add('gen-sparks', 2, 'Sparks', 0.64, { x0: 0.3, x1: 0.7 });
      b.group('Front', front); const gWash = b.group('Wash', wash);
      b.group('Altar', [...altar, ...lectern]); const gChoir = b.group('Choir', choir); const gHead = b.group('Heads', heads); const gWall = b.group('Walls', walls);
      b.group('Blinders', blinders); const gBat = b.group('Battens', battens);
      const drift = b.effect('Walls slow colours', 'colorFade', gWall, { speed: 40, tempo: false, spread: 0.5, colors: [C.purple, C.deepBlue, C.magenta] });
      const candle = b.effect('Candlelight', 'candle', gChoir, {});
      const sway = b.effect('Heads sway', 'swing', gHead, { size: 0.15, speed: 8 });
      const sweep = b.effect('Heads sweep', 'pan', gHead, { size: 0.25, speed: 8 });
      const rainbow = b.effect('Walls rainbow', 'rainbow', gWall, { speed: 16 });
      const aurora = b.effect('Batten aurora', 'aurora', gBat, {});
      const stars = b.effect('Batten twinkles', 'twinkle', gBat, {});
      const gradient = b.effect('Wash gradient', 'gradient', gWash, { colors: [C.blue, C.purple, C.magenta] });
      const sparkle = b.effect('Walls sparkle', 'sparkle', gWall, { size: 0.4 });
      const extra = [altar, lectern, choir, heads, walls, blinders, battens].flat();
      const out: [string[], Values][] = [[extra, { intensity: 0 }]];
      const aim = (tilt: number, more: Values = {}): Values => ({ pan: 0.5, tilt, ...more });
      const l = b.list('Service', { play: false });
      b.haze(hazer, 0.2);
      const m = b.machines();
      b.cue(l, 'Welcome', [...out, [front, on(0.7, undefined, { cct: 0.35 })], [wash, on(0.6, C.warm)], [walls, on(0.5, C.warm)], [altar, on(0.6, undefined, { cct: 0.3 })]], { fade: 3 });
      b.cue(l, 'Worship', [...out, [front, on(0.5, undefined, { cct: 0.3 })], [wash, on(0.9, C.purple)], [walls, on(0.8, C.purple)], [heads, on(0.6, C.lavender, aim(0.6, { zoom: 0.7 }))], [battens, on(0.7)]], { fade: 4, effects: [sway, aurora] });
      b.cue(l, 'Sermon', [...out, [front, on(1, undefined, { cct: 0.55 })], [wash, on(0.3, C.warm)], [lectern, on(1, undefined, { cct: 0.5 })], [walls, on(0.3, C.warm)]], { fade: 3 });
      b.cue(l, 'Prayer', [...out, [front, on(0.25, undefined, { cct: 0.2 })], [wash, on(0.4, C.deepBlue)], [altar, on(0.5, undefined, { cct: 0.15 })], [walls, on(0.3, C.deepBlue)]], { fade: 6 });
      b.cue(l, 'Choir', [...out, [front, on(0.5, undefined, { cct: 0.4 })], [wash, on(0.5, C.warm)], [choir, on(1, undefined, { cct: 0.3 })], [walls, on(0.5, C.gold)]], { fade: 3 });
      b.cue(l, 'Readings', [...out, [front, on(0.6, undefined, { cct: 0.45 })], [wash, on(0.3, C.cool)], [lectern, on(1, undefined, { cct: 0.6 })], [walls, on(0.2, C.cool)]], { fade: 2 });
      b.cue(l, 'Communion', [...out, [front, on(0.4, undefined, { cct: 0.2 })], [wash, on(0.4, C.amber)], [altar, on(1, undefined, { cct: 0.2 })], [walls, on(0.4, C.amber)]], { fade: 5 });
      b.cue(l, 'Baptism', [...out, [front, on(0.6, undefined, { cct: 0.5 })], [wash, on(0.6, C.cyan)], [walls, on(0.6, C.ice)], [heads, on(0.5, C.cyan, aim(0.55, { zoom: 1 }))]], { fade: 3, effects: [drift], actions: fire(m.bubbles) });
      b.cue(l, 'Wedding', [...out, [front, on(0.8, undefined, { cct: 0.35 })], [wash, on(0.7, C.pink)], [walls, on(0.8, C.pink)], [altar, on(0.8, undefined, { cct: 0.3 })],
        [heads, on(0.6, C.pink, aim(0.58, { zoom: 0.9 }))]], { fade: 4, effects: [sweep], actions: fire(m.bubbles) });
      b.cue(l, 'Just married', [...out, [front, on(1, undefined, { cct: 0.4 })], [wash, on(1, C.gold)], [walls, on(1, C.gold)], [heads, on(1, C.white, aim(0.7, { zoom: 0.3 }))], [blinders, on(0.6)]],
        { fade: 0.5, effects: [sweep], actions: fire(m.confetti, m.sparks), note: 'Confetti and sparks as they walk out' });
      b.cue(l, 'Christmas Eve', [...out, [front, on(0.3, undefined, { cct: 0.1 })], [wash, on(0.5, C.red)], [walls, on(0.6, C.green)], [choir, on(0.8, undefined, { cct: 0 })], [altar, on(0.7, undefined, { cct: 0 })], [battens, on(0.8, C.gold)]],
        { fade: 6, effects: [candle, stars] });
      b.cue(l, 'Easter morning', [...out, [front, on(0.9, undefined, { cct: 0.5 })], [wash, on(1, C.gold)], [walls, on(1, C.yellow)], [heads, on(0.8, C.warm, aim(0.6, { zoom: 1 }))]], { fade: 10 });
      b.cue(l, 'Kids church', [...out, [front, on(0.8, undefined, { cct: 0.5 })], [wash, on(0.8, C.green)], [walls, on(1)], [heads, on(0.8, C.yellow, aim(0.65, { zoom: 0.6 }))], [battens, on(1)]], { fade: 2, effects: [rainbow, sway, sparkle], actions: fire(m.bubbles) });
      b.cue(l, 'Worship concert', [...out, [front, on(0.6, undefined, { cct: 0.4 })], ...split(wash, C.blue, C.purple), [walls, on(1, C.blue)], [heads, on(1, C.white, aim(0.7, { zoom: 0.2 }))], [blinders, on(0)], [battens, on(1, C.blue)]],
        { fade: 1, effects: [sweep, drift, gradient, stars] });
      b.cue(l, 'Goodbye', [...out, [front, on(0.7, undefined, { cct: 0.35 })], [wash, on(0.6, C.warm)], [walls, on(0.5, C.warm)]], { fade: 4 });
      return b.done();
    },
  },
  {
    name: 'Cinema', icon: 'moon', blurb: 'House lights, coloured wall washers, a marquee chase, a stage for premieres with spots, confetti and CO2.',
    build: () => {
      const b = new Builder('Cinema');
      const house = b.add('gen-dimmer', 4, 'House', 0.54);
      const walls = b.add('gen-rgb', 6, 'Wall', 0.06);
      // a stage in front of the screen for premieres and live events, the screen's marquee lights,
      // step lights, a starry ceiling, haze for the spots and the premiere machines
      const marquee = b.add('gen-bar16', 4, 'Marquee', 0.22, { x0: 0.2, x1: 0.8 });
      const stage = b.at(b.add('gen-drgbw', 4, 'Stage', 0.38), 0.38, [0.06, 0.32, 0.68, 0.94]);
      const spots = b.at(b.add('gen-spotgobo', 2, 'Spot', 0.38), 0.38, [0.19, 0.81]);
      const steps = b.add('gen-rgb', 6, 'Step', 0.7);
      const ceiling = b.add('gen-bar8', 4, 'Ceiling', 0.86, { x0: 0.2, x1: 0.8 });
      const hazer = b.add('gen-hazer', 1, 'Hazer', 0.54, { x0: 0.5, x1: 0.5 });
      b.add('gen-confetti', 2, 'Confetti', 0.86, { x0: 0.06, x1: 0.94 });
      b.add('gen-co2', 2, 'CO2', 0.22, { x0: 0.05, x1: 0.95 });
      b.add('gen-sparks', 2, 'Sparks', 0.38, { x0: 0.44, x1: 0.56 });
      b.add('gen-bubbles', 1, 'Bubbles', 0.86, { x0: 0.5, x1: 0.5 });
      b.group('House', house); const gWall = b.group('Walls', walls);
      const gMarq = b.group('Marquee', marquee), gStage = b.group('Stage', stage), gSpot = b.group('Spots', spots), gStep = b.group('Steps', steps), gCeil = b.group('Ceiling', ceiling);
      const chase = b.effect('Marquee chase', 'theater', gMarq, {});
      const scan = b.effect('Marquee scanner', 'scanner', gMarq, {});
      const stars = b.effect('Starry ceiling', 'twinkle', gCeil, {});
      const glitter = b.effect('Ceiling glitter', 'glitter', gCeil, {});
      const searchlight = b.effect('Searchlights', 'pan', gSpot, { size: 0.4, speed: 8, spread: 0.5 });
      const wallFade = b.effect('Walls colour fade', 'colorFade', gWall, { speed: 30, tempo: false, spread: 0.6 });
      const stepChase = b.effect('Step chase', 'chase', gStep, { speed: 2, low: 0.3 });
      const stageColours = b.effect('Stage colours', 'colorChase', gStage, { speed: 4 });
      const flicker = b.effect('Horror flicker', 'candle', gWall, { low: 0.1 });
      const extra = [marquee, stage, spots, steps, ceiling].flat();
      const out: [string[], Values][] = [[extra, { intensity: 0 }]];
      const l = b.list('Screening', { play: false });
      b.haze(hazer, 0.2);
      const m = b.machines();
      b.cue(l, 'Walk-in', [...out, [house, on(1)], [walls, on(0.8, C.amber)], [marquee, on(0.8, C.gold)], [steps, on(0.6, C.amber)], [ceiling, on(0.4)]], { fade: 3, effects: [chase, stars] });
      b.cue(l, 'Preshow', [...out, [house, on(0.4)], [walls, on(0.6, C.purple)], [marquee, on(0.4, C.purple)], [steps, on(0.4, C.purple)], [ceiling, on(0.5)]], { fade: 5, effects: [stars] });
      b.cue(l, 'Feature', [...out, [house, on(0)], [walls, on(0)], [steps, on(0.15, C.blue)]], { fade: 8 });
      b.cue(l, 'Credits', [...out, [house, on(0.3)], [walls, on(0.3, C.deepBlue)], [steps, on(0.3, C.blue)], [ceiling, on(0.4)]], { fade: 5, effects: [stars] });
      b.cue(l, 'Exit', [...out, [house, on(1)], [walls, on(0.6, C.warm)], [marquee, on(0.6, C.gold)], [steps, on(0.8, C.warm)]], { fade: 3, effects: [chase, stepChase] });
      b.cue(l, 'Trailers', [...out, [house, on(0.15)], [walls, on(0.3, C.blue)], [steps, on(0.3, C.blue)], [ceiling, on(0.3)]], { fade: 4, effects: [stars] });
      b.cue(l, 'Intermission', [...out, [house, on(0.7)], [walls, on(0.7, C.magenta)], [marquee, on(1, C.magenta)], [steps, on(0.6, C.magenta)], [ceiling, on(0.6)]], { fade: 3, effects: [scan, glitter, wallFade] });
      b.cue(l, 'Red carpet', [...out, [house, on(0.5)], [walls, on(0.8, C.red)], [marquee, on(1, C.gold)], [stage, on(0.8, C.red)], [steps, on(0.8, C.red)], [ceiling, on(0.8)],
        [spots, on(1, C.white, { pan: 0.5, tilt: 0.7, zoom: 0.05, gobo: gobo('Star') })]], { fade: 2, effects: [chase, searchlight, glitter] });
      b.cue(l, 'Premiere applause', [...out, [house, on(0.8)], [walls, on(1, C.gold)], [marquee, on(1, C.gold)], [stage, on(1, C.white)], [steps, on(1, C.gold)], [ceiling, on(1)],
        [spots, on(1, C.white, { pan: 0.5, tilt: 0.6, zoom: 0.3 })]], { fade: 0.5, effects: [chase, glitter, stageColours], actions: fire(m.confetti, m.co2, m.sparks), note: 'Confetti, CO2 and sparks' });
      b.cue(l, 'Kids matinee', [...out, [house, on(0.8)], [walls, on(0.8, C.yellow)], [marquee, on(0.8)], [steps, on(0.8, C.green)], [ceiling, on(0.6)]], { fade: 2, effects: [scan, stageColours], actions: fire(m.bubbles) });
      b.cue(l, 'Horror night', [...out, [house, on(0)], [walls, on(0.5, C.red)], [steps, on(0.2, C.red)], [marquee, on(0.3, C.red)]], { fade: 3, effects: [flicker] });
      b.cue(l, 'Sci-fi night', [...out, [house, on(0.1)], [walls, on(0.6, C.cyan)], [marquee, on(0.8, C.cyan)], [steps, on(0.4, C.cyan)], [ceiling, on(0.8)],
        [spots, on(0.8, C.cyan, { pan: 0.5, tilt: 0.65, zoom: 0.1, gobo: gobo('Spiral'), goboRotation: turn('gen-spotgobo', 0.8) })]], { fade: 3, effects: [stars, scan, searchlight] });
      return b.done();
    },
  },
  {
    name: 'Bar', icon: 'palette', blurb: 'Colour PARs and warm white, glowing shelves, a little dance floor with heads and a strobe. Moods with long, calm fades, and a party.',
    build: () => {
      const b = new Builder('Bar');
      const pars = b.add('gen-drgbw', 6, 'PAR', 0.3);
      const warm = b.add('gen-wwcw', 2, 'Counter', 0.7, { x0: 0.35, x1: 0.65 });
      // the back bar's shelves (pixel bars), a small dance floor with two heads, pinspots on a
      // mirror ball, a strobe, fog, and a few machines for the big nights
      const shelves = b.add('gen-bar12', 4, 'Shelf', 0.12, { x0: 0.2, x1: 0.8 });
      const dance = b.add('gen-drgbwauvs', 4, 'Dance', 0.5, { x0: 0.2, x1: 0.8 });
      const heads = b.add('gen-mover8', 2, 'Head', 0.5, { x0: 0.04, x1: 0.96 });
      const pins = b.add('gen-dimmer', 2, 'Pinspot', 0.62, { x0: 0.42, x1: 0.58 });
      const strobe = b.add('gen-strobe', 1, 'Strobe', 0.5, { x0: 0.5, x1: 0.5 });
      b.add('gen-fog', 1, 'Fog', 0.88, { x0: 0.08, x1: 0.08 });
      b.add('gen-bubbles', 1, 'Bubbles', 0.88, { x0: 0.92, x1: 0.92 });
      b.add('gen-confetti', 1, 'Confetti', 0.9, { x0: 0.3, x1: 0.3 });
      b.add('gen-co2', 1, 'CO2', 0.9, { x0: 0.7, x1: 0.7 });
      b.add('gen-sparks', 2, 'Sparks', 0.8, { x0: 0.15, x1: 0.85 });
      const gPar = b.group('PARs', pars);
      b.group('Counter', warm);
      const gShelf = b.group('Shelves', shelves), gDance = b.group('Dance floor', dance), gHead = b.group('Heads', heads);
      b.group('Pinspots', pins); b.group('Strobe', strobe);
      const drift = b.effect('Slow colour drift', 'colorFade', gPar, { speed: 60, tempo: false, spread: 0.5, colors: [C.purple, C.magenta, C.deepBlue] });
      const aurora = b.effect('Shelf aurora', 'aurora', gShelf, {});
      const twinkle = b.effect('Shelf twinkles', 'twinkle', gShelf, {});
      const heart = b.effect('Shelf heartbeat', 'heartbeat', gShelf, {});
      const gradient = b.effect('Shelf gradient', 'gradientChase', gShelf, {});
      const plasma = b.effect('Shelf plasma', 'plasma', gShelf, {});
      const danceChase = b.effect('Dance colour chase', 'colorChase', gDance, { speed: 2 });
      const bally = b.effect('Heads ballyhoo', 'ballyhoo', gHead, {});
      const mirror = b.effect('Mirror ball sparkle', 'sparkle', gDance, { size: 0.4 });
      const extra = [shelves, dance, heads, pins, strobe].flat();
      const out: [string[], Values][] = [[extra, { intensity: 0 }]];
      const l = b.list('Moods', { play: false });
      const m = b.machines();
      b.cue(l, 'Daytime', [...out, [pars, on(0.5, C.warm)], [warm, on(0.9, undefined, { cct: 0.6 })], [shelves, on(0.4, C.warm)]], { fade: 10 });
      b.cue(l, 'After work', [...out, [pars, on(0.6, C.amber)], [warm, on(0.7, undefined, { cct: 0.35 })], [shelves, on(0.6, C.amber)]], { fade: 15, effects: [twinkle] });
      b.cue(l, 'Evening', [...out, [pars, on(0.5, C.purple)], [warm, on(0.5, undefined, { cct: 0.2 })], [shelves, on(0.6)]], { fade: 20, effects: [drift, aurora] });
      b.cue(l, 'Late night', [...out, [pars, on(0.35, C.deepBlue)], [warm, on(0.3, undefined, { cct: 0.1 })], [shelves, on(0.4, C.deepBlue)]], { fade: 20, effects: [twinkle] });
      b.cue(l, 'Happy hour', [...out, [pars, on(0.7, C.orange)], [warm, on(0.8, undefined, { cct: 0.4 })], [shelves, on(0.8)], [dance, on(0.4, C.orange)]], { fade: 5, effects: [gradient] });
      b.cue(l, 'Cocktail hour', [...out, [pars, on(0.6, C.teal)], [warm, on(0.6, undefined, { cct: 0.3 })], [shelves, on(0.7, C.teal)], [pins, on(0.6)]], { fade: 8, effects: [plasma] });
      b.cue(l, 'Jazz night', [...out, [pars, on(0.4, C.amber)], [warm, on(0.4, undefined, { cct: 0.15 })], [shelves, on(0.3, C.amber)], [dance, on(0.5, C.blue)], [pins, on(0.4)]], { fade: 10, effects: [heart] });
      b.cue(l, 'Karaoke', [...out, [pars, on(0.7, C.magenta)], [warm, on(0.5, undefined, { cct: 0.3 })], [shelves, on(0.8)], [dance, on(1, C.white)], [heads, on(1, C.white, { pan: 0.5, tilt: 0.6 })]],
        { fade: 2, effects: [gradient, mirror] });
      b.cue(l, 'Party', [...out, [pars, on(0.8, C.purple)], [warm, on(0.3, undefined, { cct: 0.2 })], [shelves, on(1)], [dance, on(1, C.magenta)], [heads, on(1, C.cyan, { pan: 0.5, tilt: 0.65 })], [pins, on(1)]],
        { fade: 1, effects: [danceChase, bally, plasma, mirror] });
      b.cue(l, 'Birthday!', [...out, [pars, on(1, C.pink)], [warm, on(0.6, undefined, { cct: 0.4 })], [shelves, on(1)], [dance, on(1, C.gold)], [heads, on(1, C.gold, { pan: 0.5, tilt: 0.6 })], [pins, on(1)]],
        { fade: 0.5, effects: [danceChase, bally, mirror], actions: fire(m.confetti, m.sparks), note: 'Confetti and sparks with the cake' });
      b.cue(l, 'Last call', [...out, [pars, on(0.6, C.amber)], [warm, on(0.8, undefined, { cct: 0.5 })], [shelves, on(0.5, C.amber)]], { fade: 5 });
      b.cue(l, 'Lights up', [...out, [pars, on(1, C.white)], [warm, on(1, undefined, { cct: 0.8 })], [shelves, on(0.6, C.white)], [dance, on(1, C.white)]], { fade: 3 });
      return b.done();
    },
  },
];
