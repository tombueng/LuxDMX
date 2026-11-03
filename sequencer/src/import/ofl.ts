// Open Fixture Library JSON -> our FixtureType.
//
// OFL describes a fixture by its channels' capabilities ("Strobe 1 Hz to 20 Hz on DMX 16..131").
// We keep two things from that: what the channel is for (our attribute, so the programmer and
// presets can drive it) and its labelled DMX ranges (so every function stays reachable by hand in
// the all-channels view). OFL's own docs say its format can change at any time, so it's converted
// once on import and the show keeps our version. Data: MIT, (c) Florian & Felix Edelmann.
// Effect machines (fog, flames, CO2...) are named from their own words in machines.ts.
import type { Channel, ChannelAttr, ChannelRange, FixtureMode, FixtureType } from '../model/types';
import { machineAttrs, machineSpan, needsSpan, type ChannelFacts, type FixtureClass } from './machines';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export const OFL_COMMIT = '6c612f1712082db2588c5e14873f937e0c59aa0d';
export const oflUrl = (key: string, commit = OFL_COMMIT) =>
  `https://cdn.jsdelivr.net/gh/OpenLightingProject/open-fixture-library@${commit}/fixtures/${key}.json`;

const COLOR_ATTR: Record<string, ChannelAttr> = {
  Red: 'red', Green: 'green', Blue: 'blue', White: 'white', 'Warm White': 'warmWhite', 'Cold White': 'coolWhite',
  Amber: 'amber', UV: 'uv', Lime: 'lime', Cyan: 'cyan', Magenta: 'magenta', Yellow: 'yellow',
};

interface Resolved { key: string; ch: Json; fineIndex: number; pixel?: string; pixelIndex?: number }

export function fromOfl(key: string, j: Json, manufacturer: string): FixtureType {
  const wheels: Record<string, Json> = j.wheels ?? {};
  const avail: Record<string, Json> = { ...(j.availableChannels ?? {}) };
  const pixels = pixelKeys(j.matrix);
  const groups = Object.keys(j.matrix?.pixelGroups ?? {});

  // Template channels resolved for every pixel and pixel group ("Red $pixelKey" -> "Red 3").
  const pixelOf = new Map<string, { pixel: string; index?: number }>();
  for (const [tk, tc] of Object.entries<Json>(j.templateChannels ?? {})) {
    for (const [pk, idx] of [...pixels.map((p, i) => [p, i] as const), ...groups.map((g) => [g, undefined] as const)]) {
      const k = tk.replaceAll('$pixelKey', pk);
      if (!avail[k]) avail[k] = { ...tc, name: k, fineChannelAliases: tc.fineChannelAliases?.map((a: string) => a.replaceAll('$pixelKey', pk)) };
      pixelOf.set(k, { pixel: pk, index: idx });
    }
  }
  // Fine aliases ("Pan fine" -> Pan, byte 1) and switching aliases ("Red 1 / Speed" -> its default channel).
  const fineOf = new Map<string, { key: string; index: number }>();
  for (const [k, c] of Object.entries<Json>(avail)) (c.fineChannelAliases ?? []).forEach((a: string, i: number) => fineOf.set(a, { key: k, index: i + 1 }));
  const switching = new Map<string, string>();
  for (const c of Object.values<Json>(avail))
    for (const cap of caps(c)) for (const [alias, target] of Object.entries<string>(cap.switchChannels ?? {})) if (!switching.has(alias)) switching.set(alias, target);

  const resolve = (k: string): Resolved | undefined => {
    const sw = switching.get(k) ?? k;
    const f = fineOf.get(sw);
    const base = f ? f.key : sw;
    const ch = avail[base];
    if (!ch) return undefined;
    const px = pixelOf.get(base);
    return { key: base, ch, fineIndex: f?.index ?? 0, pixel: px?.pixel, pixelIndex: px?.index };
  };

  const made: { ch: Channel; ranges: ChannelRange[]; facts: ChannelFacts }[] = [];
  const modes: FixtureMode[] = (j.modes ?? []).map((m: Json) => {
    const channels: Channel[] = [];
    for (const entry of expandMode(m.channels ?? [], pixels, groups, j.matrix)) {
      if (entry === null) { channels.push({ name: '(unused)', attr: 'raw' }); continue; }
      const r = resolve(entry);
      if (!r) { channels.push({ name: entry, attr: 'raw' }); continue; }
      const ranges: ChannelRange[] = [];
      const ch = convertChannel(entry, r, wheels, ranges);
      channels.push(ch);
      const list = caps(r.ch);
      made.push({ ch, ranges, facts: { name: entry, attr: ch.attr, caps: list.map((cap: Json) => capLabel(cap, wheels, r.key)),
        plain: list.every((cap: Json) => SETTLED.has(cap.type)) } });
    }
    return { name: m.name, channels };
  });
  // The machines: what their channels fire or make, and a level that sends 0 for off.
  const attrs = machineAttrs(classOf(j.categories ?? []), `${manufacturer} ${j.name} ${key}`, made.map((x) => x.facts));
  made.forEach(({ ch, ranges }, i) => {
    const before = ch.attr;
    ch.attr = attrs[i];
    if (!needsSpan(before, ch.attr)) return;
    const span = machineSpan(ch.attr, ranges);
    if (span) ch.span = span; else delete ch.span;
  });

  const ang = (type: string) => {
    for (const c of Object.values<Json>(j.availableChannels ?? {}))
      for (const cap of caps(c)) if (cap.type === type && cap.angleStart && cap.angleEnd) return Math.abs(deg(cap.angleEnd) - deg(cap.angleStart));
    return undefined;
  };
  return {
    id: `ofl:${key}`, manufacturer, model: j.name, source: 'ofl', ref: key, modes,
    physical: { panDeg: ang('Pan'), tiltDeg: ang('Tilt') },
  };
}

// ---------------------------------------------------------------- channels

// OFL's categories: fog machines and hazers, the light ones (never a machine, even with "Effect"
// next to them: an LED panel's "Fireworks" program), and the rest, where a machine says what it is
// in its name.
const LIGHT_CATEGORIES = ['Color Changer', 'Moving Head', 'Scanner', 'Barrel Scanner', 'Flower', 'Pixel Bar', 'Matrix', 'Blinder', 'Strobe', 'Dimmer', 'Laser'];
function classOf(categories: string[]): FixtureClass {
  if (categories.includes('Hazer') && !categories.includes('Smoke')) return 'hazer';
  if (categories.includes('Smoke')) return 'smoke';
  return categories.some((c) => LIGHT_CATEGORIES.includes(c)) ? 'light' : 'maybe';
}
// Capabilities that say plainly what a channel is, none of them a machine's trigger: fog itself,
// fog type, timers, speeds, maintenance.
const SETTLED = new Set(['Fog', 'FogOutput', 'FogType', 'Time', 'Speed', 'EffectSpeed', 'EffectDuration', 'SoundSensitivity',
  'Rotation', 'Pan', 'Tilt', 'PanContinuous', 'TiltContinuous', 'PanTiltSpeed', 'Maintenance', 'NoFunction']);

function convertChannel(name: string, r: Resolved, wheels: Record<string, Json>, allRanges: ChannelRange[]): Channel {
  const c = r.ch;
  const list = caps(c);
  const bits = 8 * (1 + (c.fineChannelAliases?.length ?? 0));
  const res = c.dmxValueResolution ? parseInt(c.dmxValueResolution, 10) : bits;   // "8bit" / "16bit"
  const to8 = (v: number) => Math.max(0, Math.min(255, Math.floor(v / 2 ** (res - 8))));
  const ch: Channel = { name, attr: 'raw' };
  if (r.fineIndex > 0) ch.fine = true;
  if (r.pixelIndex !== undefined) ch.cell = r.pixelIndex;

  const def = c.defaultValue;
  if (r.fineIndex === 0 && def !== undefined) ch.default = typeof def === 'string' && def.endsWith('%') ? Math.round(parseFloat(def) * 2.55) : to8(Number(def));

  const ranges: ChannelRange[] = list.length > 1 ? list.map((cap: Json) => {
    const [a, b] = cap.dmxRange ?? [0, 2 ** res - 1];
    return { from: to8(a), to: to8(b), label: capLabel(cap, wheels, r.key), ...rangeKind(cap, wheels, r.key) };
  }) : [];
  if (ranges.length && r.fineIndex === 0) ch.ranges = ranges;
  allRanges.push(...ranges);

  // What the channel is for: the single capability, or the one covering most of the channel.
  const main = list.length === 1 ? list[0] : [...list].sort((x: Json, y: Json) => span(y) - span(x)).find((x: Json) => x.type !== 'NoFunction') ?? list[0];
  const types = new Set(list.map((x: Json) => x.type));
  let attr: ChannelAttr = 'raw';
  if (types.has('WheelSlot')) {
    const wheel = wheels[list.find((x: Json) => x.type === 'WheelSlot').wheel ?? r.key];
    const kinds = new Set((wheel?.slots ?? []).map((s: Json) => s.type));
    attr = kinds.has('Color') ? 'colorWheel' : kinds.has('Gobo') ? 'gobo' : 'raw';
  } else if (types.has('ShutterStrobe') && [...types].every((t) => ['ShutterStrobe', 'NoFunction', 'StrobeSpeed', 'StrobeDuration'].includes(t as string))) {
    attr = 'shutter';
  } else if ([...types].every((t) => t === 'Maintenance' || t === 'NoFunction')) {
    attr = 'control';
  } else {
    attr = attrOf(main);
    if (attr !== 'raw' && list.length > 1 && main.dmxRange) ch.span = [to8(main.dmxRange[0]), to8(main.dmxRange[1])];
  }
  // Colour presets on a pixel bar would fight the RGB channels: leave them at their default.
  if (main.type === 'ColorPreset') attr = 'raw';
  ch.attr = attr;
  if (attr === 'shutter' && !ch.ranges) ch.attr = 'strobe';
  return ch;
}

function attrOf(cap: Json): ChannelAttr {
  switch (cap.type) {
    case 'Intensity': return 'intensity';
    case 'ColorIntensity': return COLOR_ATTR[cap.color] ?? 'raw';
    case 'ColorTemperature': return 'cct';
    case 'Pan': return 'pan';
    case 'Tilt': return 'tilt';
    case 'PanTiltSpeed': return 'speed';
    case 'StrobeSpeed': return 'strobe';
    case 'ShutterStrobe': return 'shutter';
    case 'Zoom': case 'BeamAngle': return 'zoom';
    case 'Focus': return 'focus';
    case 'Iris': return 'iris';
    case 'Frost': return 'frost';
    case 'Prism': return 'prism';
    case 'WheelSlotRotation': case 'WheelRotation': return 'goboRotation';
    case 'Fog': case 'FogOutput': return cap.fogType === 'Haze' ? 'haze' : 'fog';
    case 'Maintenance': return 'control';
    default: return 'raw';
  }
}

function rangeKind(cap: Json, wheels: Record<string, Json>, chName: string): Pick<ChannelRange, 'kind' | 'color'> {
  if (cap.type === 'ShutterStrobe') {
    const e = cap.shutterEffect;
    return { kind: e === 'Open' ? 'open' : e === 'Closed' ? 'closed' : 'strobe' };
  }
  if (cap.type === 'WheelSlot') {
    const slot = slotOf(cap, wheels, chName);
    if (!slot) return { kind: 'slot' };
    const color = slot.type === 'Open' ? '#ffffff' : slot.colors?.[0];
    return color ? { kind: 'slot', color } : { kind: 'slot' };
  }
  return { kind: 'other' };
}

function slotOf(cap: Json, wheels: Record<string, Json>, chName: string): Json | undefined {
  const w = wheels[cap.wheel ?? chName];
  const n = cap.slotNumber;
  if (!w || typeof n !== 'number' || !Number.isInteger(n)) return undefined;   // between two slots
  return w.slots?.[n - 1];
}

function capLabel(cap: Json, wheels: Record<string, Json>, chName: string): string {
  if (cap.comment) return cap.comment;
  const se = (a: string) => (cap[`${a}Start`] !== undefined ? `${cap[`${a}Start`]}..${cap[`${a}End`]}` : cap[a]);
  switch (cap.type) {
    case 'NoFunction': return 'No function';
    case 'ShutterStrobe': return [cap.shutterEffect, se('speed')].filter(Boolean).join(' ');
    case 'WheelSlot': {
      const s = slotOf(cap, wheels, chName);
      return s ? (s.name ?? (s.type === 'Open' ? 'Open' : `${s.type} ${cap.slotNumber}`)) : `Slot ${cap.slotNumber ?? se('slotNumber')}`;
    }
    case 'WheelRotation': case 'WheelSlotRotation': return `Rotation ${se('speed') ?? se('angle') ?? ''}`.trim();
    case 'WheelShake': return `Shake ${cap.slotNumber ?? ''} ${se('shakeSpeed') ?? ''}`.trim();
    case 'Effect': return cap.effectName ?? cap.effectPreset ?? 'Effect';
    case 'ColorPreset': return cap.colors ? `Colour ${cap.colors.join(' ')}` : 'Colour preset';
    case 'Maintenance': return 'Maintenance';
    default: {
      const detail = ['speed', 'angle', 'brightness', 'distance', 'openPercent', 'frostIntensity', 'colorTemperature', 'fogOutput', 'parameter']
        .map((a) => se(a)).find((x) => x !== undefined);
      return detail ? `${cap.type} ${detail}` : cap.type;
    }
  }
}

// ---------------------------------------------------------------- modes and matrices

function caps(c: Json): Json[] { return c?.capabilities ?? (c?.capability ? [c.capability] : []); }
function span(c: Json) { return c.dmxRange ? c.dmxRange[1] - c.dmxRange[0] : 1e9; }
function deg(s: string | number) { return typeof s === 'number' ? s : parseFloat(s); }

function pixelKeys(m: Json): string[] {
  if (!m) return [];
  if (m.pixelKeys) return (m.pixelKeys as Json[][][]).flat(2).filter((k): k is string => typeof k === 'string');
  const [x = 1, y = 1, z = 1] = m.pixelCount ?? [];
  const keys: string[] = [];
  const dims = [x, y, z].filter((d) => d > 1).length;
  for (let k = 1; k <= z; k++) for (let j = 1; j <= y; j++) for (let i = 1; i <= x; i++)
    keys.push(dims <= 1 ? String(i * j * k) : dims === 2 ? `(${i}, ${j})` : `(${i}, ${j}, ${k})`);
  return keys;
}

function expandMode(entries: Json[], pixels: string[], groups: string[], _matrix: Json): (string | null)[] {
  const out: (string | null)[] = [];
  for (const e of entries) {
    if (e === null || typeof e === 'string') { out.push(e); continue; }
    if (e.insert !== 'matrixChannels') continue;
    const keys: string[] = Array.isArray(e.repeatFor) ? e.repeatFor : e.repeatFor === 'eachPixelGroup' ? groups : pixels;
    const tpl: (string | null)[] = e.templateChannels ?? [];   // (null: an unused channel in every pixel)
    const at = (t: string | null, k: string) => (t === null ? null : t.replaceAll('$pixelKey', k));
    if (e.channelOrder === 'perChannel') for (const t of tpl) for (const k of keys) out.push(at(t, k));
    else for (const k of keys) for (const t of tpl) out.push(at(t, k));
  }
  return out;
}
