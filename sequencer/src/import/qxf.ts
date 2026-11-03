// QLC+ fixture definition (.qxf) -> our FixtureType. QLC+'s library (1781 fixtures, Apache-2.0)
// and every .qxf a user made themselves. Channels say what they are either by a Preset
// ("IntensityRed", "PositionPan") or by a Group ("Intensity" + <Colour>, "Shutter", "Gobo") with
// capability ranges; modes list channels by name. Effect machines (fog, flames, CO2...) are named
// from their own words in machines.ts.
import type { Channel, ChannelAttr, ChannelRange, FixtureMode, FixtureType } from '../model/types';
import { kid, kids, num, parseXml, text } from './xml';
import { machineAttrs, machineSpan, needsSpan, type FixtureClass } from './machines';

export const QLC_COMMIT = 'fb21860d8cb73dd817b2a9b0e3cab25830790fa6';
export const qlcUrl = (path: string, commit = QLC_COMMIT) =>
  `https://raw.githubusercontent.com/mcallegari/qlcplus/${commit}/resources/fixtures/${path}`;

const COLOUR: Record<string, ChannelAttr> = {
  Red: 'red', Green: 'green', Blue: 'blue', White: 'white', Amber: 'amber', UV: 'uv', Lime: 'lime',
  Cyan: 'cyan', Magenta: 'magenta', Yellow: 'yellow',
};

// Channel presets that say everything about a channel on their own.
function fromPreset(p: string): { attr: ChannelAttr; fine?: boolean } | undefined {
  const fine = p.endsWith('Fine');
  const base = fine ? p.slice(0, -4) : p;
  if (base === 'IntensityMasterDimmer' || base === 'IntensityDimmer') return { attr: 'intensity', fine };
  const col = /^Intensity(Red|Green|Blue|White|Amber|UV|Lime|Cyan|Magenta|Yellow)$/.exec(base);
  if (col) return { attr: COLOUR[col[1]], fine };
  if (base === 'PositionPan' || base === 'PositionXAxis') return { attr: 'pan', fine };
  if (base === 'PositionTilt' || base === 'PositionYAxis') return { attr: 'tilt', fine };
  if (base.startsWith('Speed')) return { attr: 'speed', fine };
  if (base === 'ColorWheel') return { attr: 'colorWheel', fine };
  if (/^Color(CTO|CTC|CTB)Mixer$/.test(base)) return { attr: 'cct', fine };
  if (base === 'GoboWheel') return { attr: 'gobo', fine };
  if (base === 'GoboIndex') return { attr: 'goboRotation', fine };
  if (base.startsWith('ShutterStrobe')) return { attr: 'strobe', fine };
  if (base.startsWith('ShutterIris')) return { attr: 'iris', fine };
  if (base.startsWith('BeamFocus')) return { attr: 'focus', fine };
  if (base.startsWith('BeamZoom')) return { attr: 'zoom', fine };
  return { attr: 'raw', fine };
}

function fromGroup(group: string, colour: string, name: string, ranges: ChannelRange[]): ChannelAttr {
  const n = name.toLowerCase();
  switch (group) {
    case 'Intensity': return colour && colour !== 'Generic' ? (COLOUR[colour] ?? 'raw') : 'intensity';
    case 'Colour': return ranges.filter((r) => r.color).length >= 2 ? 'colorWheel' : /cto|ctc|ctb|temperature/.test(n) ? 'cct' : 'raw';
    case 'Gobo': return /rot|index/.test(n) ? 'goboRotation' : 'gobo';
    case 'Speed': return 'speed';
    case 'Pan': return 'pan';
    case 'Tilt': return 'tilt';
    case 'Shutter': return ranges.some((r) => r.kind === 'open' || r.kind === 'closed') ? 'shutter' : /iris/.test(n) ? 'iris' : 'strobe';
    case 'Prism': return /rot/.test(n) ? 'raw' : 'prism';
    case 'Beam': return /zoom/.test(n) ? 'zoom' : /focus/.test(n) ? 'focus' : /iris/.test(n) ? 'iris' : /frost/.test(n) ? 'frost' : 'raw';
    case 'Effect': return /fog|smoke/.test(n) ? 'fog' : /haze/.test(n) ? 'haze' : /fan/.test(n) ? 'fan' : 'raw';
    case 'Maintenance': return 'control';
    default: return 'raw';
  }
}

function kindOf(cap: Element): Pick<ChannelRange, 'kind' | 'color'> {
  const p = cap.getAttribute('Preset') ?? '';
  if (p === 'ShutterOpen') return { kind: 'open' };
  if (p === 'ShutterClose') return { kind: 'closed' };
  if (/^(Strobe|Pulse|RampUp|RampDown)/.test(p)) return { kind: 'strobe' };
  const color = p.startsWith('ColorMacro') || p.startsWith('ColorDoubleMacro') ? cap.getAttribute('Res1') : cap.getAttribute('Color');
  if (color && /^#[0-9a-f]{6}$/i.test(color)) return { kind: 'slot', color: color.toLowerCase() };
  if (p === 'GoboMacro' || cap.getAttribute('Res')) return { kind: 'slot' };
  return { kind: 'other' };
}

// QLC+'s fixture types: fog machines and hazers, the light types (never a machine), and the rest
// ("Effect", "Other", "Fan"), where a machine says what it is in its name.
const LIGHT_TYPES = ['Color Changer', 'Moving Head', 'Scanner', 'Flower', 'LED Bar (Beams)', 'LED Bar (Pixels)', 'Strobe', 'Laser', 'Dimmer'];
const classOf = (type: string): FixtureClass => (type === 'Smoke' ? 'smoke' : type === 'Hazer' ? 'hazer' : LIGHT_TYPES.includes(type) ? 'light' : 'maybe');

export function fromQxf(xml: string, ref?: string): FixtureType {
  const root = parseXml(xml).documentElement;
  if (root.localName !== 'FixtureDefinition') throw new Error('not a QLC+ fixture definition (.qxf)');
  const manufacturer = text(kid(root, 'Manufacturer')) || 'Unknown';
  const model = text(kid(root, 'Model')) || 'Fixture';

  const byName = new Map<string, Channel>();
  const rangesOf = new Map<string, ChannelRange[]>();
  for (const c of kids(root, 'Channel')) {
    const name = c.getAttribute('Name') ?? '';
    const ch: Channel = { name, attr: 'raw' };
    const def = c.getAttribute('Default');
    if (def) ch.default = Math.round(num(def));
    const preset = c.getAttribute('Preset');
    if (preset) {
      const p = fromPreset(preset)!;
      ch.attr = p.attr;
      if (p.fine) ch.fine = true;
    } else {
      const g = kid(c, 'Group');
      const ranges: ChannelRange[] = kids(c, 'Capability').map((cap) => ({
        from: Math.round(num(cap.getAttribute('Min'))), to: Math.round(num(cap.getAttribute('Max'), 255)),
        label: text(cap) || 'Range', ...kindOf(cap),
      }));
      rangesOf.set(name, ranges);
      if (g?.getAttribute('Byte') === '1') ch.fine = true;
      ch.attr = fromGroup(text(g), text(kid(c, 'Colour')), name, ranges);
      if (ranges.length > 1 && !ch.fine) ch.ranges = ranges;
      // A continuous attribute that only owns part of the channel (strobe 16..255 after "open").
      const main = ranges.length > 1 ? ranges.filter((r) => r.kind !== 'open' && r.kind !== 'closed').sort((a, b) => (b.to - b.from) - (a.to - a.from))[0] : undefined;
      if (main && ['strobe', 'zoom', 'focus', 'iris', 'frost', 'speed', 'intensity', 'cct', 'fog', 'haze', 'fan'].includes(ch.attr)) ch.span = [main.from, main.to];
      if (ch.attr === 'shutter' && !ch.ranges) ch.attr = 'strobe';
    }
    byName.set(name, ch);
  }
  // The machines: what their channels fire or make, and a level that sends 0 for off.
  const chans = [...byName.values()];
  const attrs = machineAttrs(classOf(text(kid(root, 'Type'))), `${manufacturer} ${model}`,
    chans.map((ch) => ({ name: ch.name, attr: ch.attr, caps: (rangesOf.get(ch.name) ?? []).map((r) => r.label) })));
  chans.forEach((ch, i) => {
    const before = ch.attr;
    ch.attr = attrs[i];
    if (!needsSpan(before, ch.attr)) return;
    const span = machineSpan(ch.attr, rangesOf.get(ch.name) ?? []);
    if (span) ch.span = span; else delete ch.span;
  });

  const modes: FixtureMode[] = kids(root, 'Mode').map((m) => {
    const entries = kids(m, 'Channel').map((c) => ({ n: Math.round(num(c.getAttribute('Number'))), name: text(c) })).sort((a, b) => a.n - b.n);
    const channels: Channel[] = [];
    for (const e of entries) {
      while (channels.length < e.n) channels.push({ name: '(unused)', attr: 'raw' });
      channels.push({ ...(byName.get(e.name) ?? { name: e.name, attr: 'raw' }) });
    }
    kids(m, 'Head').forEach((h, cell) => {
      for (const c of kids(h, 'Channel')) { const i = Math.round(num(text(c))); if (channels[i]) channels[i].cell = cell; }
    });
    return { name: m.getAttribute('Name') ?? 'Default', channels };
  });

  const focus = kid(kid(root, 'Physical'), 'Focus');
  return {
    id: `qxf:${manufacturer}/${model}`, manufacturer, model, source: 'qxf', ref, modes,
    physical: focus ? { panDeg: num(focus.getAttribute('PanMax')) || undefined, tiltDeg: num(focus.getAttribute('TiltMax')) || undefined } : undefined,
  };
}
