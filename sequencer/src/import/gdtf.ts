// GDTF (.gdtf, DIN SPEC 15800) -> our FixtureType. It's what pro manufacturers publish (GDTF
// Share). A .gdtf is a zip; description.xml has DMX modes made of channels, each with an offset
// ("1" = 8 bit, "1,2" = 16 bit), a standard attribute name ("Dimmer", "ColorAdd_R", "Gobo1") and
// channel functions/sets that become our labelled ranges. GDTF names fog, haze, fans and blowers;
// flames, sparks, CO2 and confetti come under made-up or general attributes, so effect machines
// are named from their own words in machines.ts.
import { unzipSync, strFromU8 } from 'fflate';
import type { Channel, ChannelAttr, ChannelRange, FixtureMode, FixtureType } from '../model/types';
import { kid, kids, num, parseXml } from './xml';
import { machineAttrs, machineSpan, needsSpan, type ChannelFacts } from './machines';
import { matrixForGrid } from '../model/pixelLayout';
// (attributes that make light: the ones a cell, a pixel, has)
const CELL_LIGHT = new Set<ChannelAttr>(['intensity', 'red', 'green', 'blue', 'white', 'warmWhite', 'coolWhite', 'amber', 'uv', 'lime', 'cyan', 'magenta', 'yellow', 'cct']);

function attrOf(a: string, wheelIndex: Map<string, number>): ChannelAttr {
  if (a === 'Dimmer') return 'intensity';
  if (a === 'Pan') return 'pan';
  if (a === 'Tilt') return 'tilt';
  if (a === 'PanRotate') return 'panRotation';
  if (a === 'TiltRotate') return 'tiltRotation';
  if (/^(Roll|Rot|HeadRoll|Rotation)$/.test(a)) return 'roll';
  if (/^(RollRotate|RotRotate|HeadRollRotate)$/.test(a)) return 'rollRotation';
  const add: Record<string, ChannelAttr> = {
    ColorAdd_R: 'red', ColorAdd_G: 'green', ColorAdd_B: 'blue', ColorAdd_W: 'white', ColorAdd_WW: 'warmWhite',
    ColorAdd_CW: 'coolWhite', ColorAdd_A: 'amber', ColorAdd_RY: 'amber', ColorAdd_UV: 'uv', ColorAdd_L: 'lime', ColorAdd_GY: 'lime',
    ColorSub_C: 'cyan', ColorSub_M: 'magenta', ColorSub_Y: 'yellow', ColorRGB_Red: 'red', ColorRGB_Green: 'green', ColorRGB_Blue: 'blue',
  };
  if (add[a]) return add[a];
  if (/^Color\d+$/.test(a)) return wheelIndex.get(a) === 0 ? 'colorWheel' : 'raw';     // only the first wheel follows the colour
  if (/^(CTO|CTC|CTB)$/.test(a)) return 'cct';
  if (/^Gobo\d+$/.test(a)) return a === 'Gobo1' ? 'gobo' : a === 'Gobo2' ? 'gobo2' : 'raw';
  if (/^Gobo1Pos(Rotate)?$/.test(a)) return 'goboRotation';
  if (/^Gobo2Pos(Rotate)?$/.test(a)) return 'gobo2Rotation';
  if (/^Prism\d+Pos(Rotate)?$/.test(a)) return 'prismRotation';
  if (/^Prism\d+$/.test(a)) return 'prism';
  if (/^AnimationWheel\d*$/.test(a)) return 'animation';
  if (/^AnimationWheel\d*Pos(Rotate)?$/.test(a) || /^AnimationIndexRotate\d*$/.test(a)) return 'animationRotation';
  if (/^Effects\d*$/.test(a)) return 'effectMacro';
  if (/^Effects\d*Rate$/.test(a) || /^ColorMacro\d*Rate$/.test(a)) return 'effectSpeed';
  if (/^(ColorMacro|ColorEffects)\d*$/.test(a)) return 'colorMacro';
  if (/^AnimationSystem\d*$/.test(a)) return 'animation';
  if (a === 'Zoom') return 'zoom';
  if (/^Focus\d+$/.test(a)) return 'focus';
  if (a === 'Iris') return 'iris';
  if (/^Frost\d+$/.test(a)) return 'frost';
  if (/^Shutter\d+$/.test(a)) return 'shutter';
  if (/^Shutter\d+Strobe/.test(a) || a === 'StrobeFrequency') return 'strobe';
  if (/^Fog\d*$/.test(a) || a === 'FogOutput') return 'fog';
  if (/^Haze\d*$/.test(a)) return 'haze';
  if (/^(Fan|Blower)\d*$/.test(a)) return 'fan';
  if (/^(PanTiltSpeed|MSpeed|PositionMSpeed)/.test(a)) return 'speed';
  if (/^(Control|Reset|Lamp|Function|Fixture|Display|Dmx)/.test(a)) return 'control';
  return 'raw';
}

// "32768/2" -> value at that many bytes, scaled to 8 bit.
function dmx8(s: string | null | undefined): number | undefined {
  if (!s) return undefined;
  const [v, b] = s.split('/');
  const bytes = parseInt(b ?? '1', 10) || 1;
  return Math.max(0, Math.min(255, Math.floor(parseFloat(v) / 2 ** (8 * (bytes - 1)))));
}

// CIE xyY (GDTF colours) -> '#rrggbb', at full brightness (only the hue matters for a wheel slot).
export function xyYToHex(s: string): string | undefined {
  const [x, y] = s.split(',').map(Number);
  if (!(y > 0)) return undefined;
  const X = x / y, Y = 1, Z = (1 - x - y) / y;
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, b = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  const m = Math.max(r, g, b, 1e-6);
  [r, g, b] = [r, g, b].map((v) => Math.max(0, v / m));
  const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  return '#' + [r, g, b].map((v) => Math.round(Math.min(1, gamma(v)) * 255).toString(16).padStart(2, '0')).join('');
}

export function fromGdtf(bytes: Uint8Array, ref?: string): FixtureType {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error('not a GDTF file (not a zip)'); }
  const desc = files['description.xml'];
  if (!desc) throw new Error('not a GDTF file (no description.xml)');
  return fromGdtfXml(strFromU8(desc), ref);
}

export function fromGdtfXml(xml: string, ref?: string): FixtureType {
  const ft = kid(parseXml(xml).documentElement, 'FixtureType');
  if (!ft) throw new Error('not a GDTF description');
  const manufacturer = ft.getAttribute('Manufacturer') || 'Unknown';
  const model = ft.getAttribute('LongName') || ft.getAttribute('Name') || 'Fixture';
  // the fixture's own words for its attributes ("Effects1" may be shown as "Flame")
  const pretty = new Map(kids(kid(kid(ft, 'AttributeDefinitions'), 'Attributes'), 'Attribute').map((a) => [a.getAttribute('Name') ?? '', a.getAttribute('Pretty') ?? '']));
  const made: { chs: Channel[]; ranges: ChannelRange[]; facts: ChannelFacts }[] = [];

  const wheels = new Map<string, { name: string; color?: string }[]>();
  const wheelIndex = new Map<string, number>();
  for (const w of kids(kid(ft, 'Wheels'), 'Wheel'))
    wheels.set(w.getAttribute('Name') ?? '', kids(w, 'Slot').map((s) => ({ name: s.getAttribute('Name') ?? '', color: s.getAttribute('Color') ? xyYToHex(s.getAttribute('Color')!) : undefined })));

  let panDeg: number | undefined, tiltDeg: number | undefined, zoomDeg: [number, number] | undefined;
  const where = geometryPlaces(kid(ft, 'Geometries')), parents = geometryParents(kid(ft, 'Geometries'));
  const modes: FixtureMode[] = kids(kid(ft, 'DMXModes'), 'DMXMode').map((mode) => {
    const slots: Channel[] = [];
    const slotGeom: string[] = [], slotAttr: string[] = [];   // per DMX slot: geometry and GDTF attribute
    const geomOrder = new Map<string, string[]>();        // attribute -> geometries it appears on
    for (const dc of kids(kid(mode, 'DMXChannels'), 'DMXChannel')) {
      const offs = (dc.getAttribute('Offset') ?? '').split(',').map((o) => parseInt(o, 10)).filter((o) => o > 0);
      if (!offs.length || (dc.getAttribute('DMXBreak') ?? '1') !== '1') continue;   // virtual, or a second DMX break
      const lc = kid(dc, 'LogicalChannel');
      const attrName = lc?.getAttribute('Attribute') ?? '';
      const fns = kids(lc, 'ChannelFunction');
      const wheel = fns.map((f) => f.getAttribute('Wheel')).find(Boolean) ?? (attrName.startsWith('Color') ? attrName : '');
      if (/^Color\d+$/.test(attrName) && !wheelIndex.has(attrName)) wheelIndex.set(attrName, wheelIndex.size);
      const attr = attrOf(attrName, wheelIndex);
      const geom = dc.getAttribute('Geometry') ?? '';
      const g = geomOrder.get(attrName) ?? []; if (!g.includes(geom)) g.push(geom); geomOrder.set(attrName, g);

      // Ranges: channel sets where there are several, else the functions.
      const ranges: ChannelRange[] = [];
      fns.forEach((f, fi) => {
        const fFrom = dmx8(f.getAttribute('DMXFrom')) ?? 0;
        const fTo = fi + 1 < fns.length ? Math.max(fFrom, (dmx8(fns[fi + 1].getAttribute('DMXFrom')) ?? 256) - 1) : 255;
        const fAttr = f.getAttribute('Attribute') ?? attrName;
        const label = f.getAttribute('CustomName') || f.getAttribute('Name') || fAttr;
        const sets = kids(f, 'ChannelSet').filter((s) => s.getAttribute('Name'));
        if (sets.length > 1 || (sets.length === 1 && wheels.has(wheel))) {
          sets.forEach((s, si) => {
            const from = dmx8(s.getAttribute('DMXFrom')) ?? fFrom;
            const to = si + 1 < sets.length ? Math.max(from, (dmx8(sets[si + 1].getAttribute('DMXFrom')) ?? fTo + 1) - 1) : fTo;
            const slotI = parseInt(s.getAttribute('WheelSlotIndex') ?? '0', 10);
            const slot = slotI > 0 ? wheels.get(wheel)?.[slotI - 1] : undefined;
            const name = s.getAttribute('Name') ?? '';
            ranges.push({ from, to, label: name || slot?.name || label, ...kind(fAttr, name, slot) });
          });
        } else {
          ranges.push({ from: fFrom, to: fTo, label, ...kind(fAttr, label, undefined) });
        }
        if (fAttr === 'Pan' || fAttr === 'Tilt') {
          const span = Math.abs(num(f.getAttribute('PhysicalTo')) - num(f.getAttribute('PhysicalFrom')));
          if (span > 1) { if (fAttr === 'Pan') panDeg = span; else tiltDeg = span; }
        }
        // (a zoom in degrees: the beam's narrowest and widest)
        if (fAttr === 'Zoom' && !zoomDeg) {
          const a = num(f.getAttribute('PhysicalFrom')), b = num(f.getAttribute('PhysicalTo'));
          if (a > 0 && b > 0 && a !== b && Math.max(a, b) <= 180) zoomDeg = [Math.min(a, b), Math.max(a, b)];
        }
      });
      const def = dmx8(fns[0]?.getAttribute('Default') ?? dc.getAttribute('Default'));
      const name = attrName + (geom && geomOrder.get(attrName)!.length > 1 ? ` ${geom}` : '');
      const coarse: Channel = { name, attr };
      if (def !== undefined) coarse.default = def;
      const useful = ranges.filter((r) => r.to > r.from || ranges.length <= 3);
      if (useful.length > 1 && !['pan', 'tilt', 'intensity', 'red', 'green', 'blue', 'white', 'amber', 'uv', 'lime', 'cyan', 'magenta', 'yellow', 'warmWhite', 'coolWhite'].includes(attr))
        coarse.ranges = useful;
      if (coarse.attr === 'shutter' && !coarse.ranges) coarse.attr = 'strobe';
      slots[offs[0] - 1] = coarse;
      slotGeom[offs[0] - 1] = geom; slotAttr[offs[0] - 1] = attrName;
      offs.slice(1).forEach((o, i) => { slots[o - 1] = i === 0 ? { name: `${name} fine`, attr, fine: true } : { name: `${name} fine ${i + 1}`, attr: 'raw' }; slotGeom[o - 1] = geom; slotAttr[o - 1] = attrName; });
      const words = [attrName, pretty.get(attrName), ...fns.flatMap((f) => [f.getAttribute('Attribute'), f.getAttribute('Name'), f.getAttribute('CustomName')])];
      made.push({ chs: [coarse, ...(offs.length > 1 ? [slots[offs[1] - 1]] : [])], ranges, facts: {
        name: [...new Set(words.filter(Boolean))].join(' '), attr: coarse.attr, caps: ranges.map((r) => r.label), plain: /^(Fog|Haze|Fan|Blower)\d*$|^FogOutput$/.test(attrName) } });
    }
    // Attributes repeated on several geometries are cells (pixels of a bar), numbered by geometry
    // in the order the DMX channels first meet them: the same LED is the same cell for its red and
    // its white, also when the main beam has a red and no white.
    // Pan and tilt on several geometries are heads (a moving bar's): each the same cell as the light
    // under it (its tilt sits on the head's axis, its colour on the beam below that).
    const channels: Channel[] = [];
    const cellGeoms: string[] = [];
    const repeated = (i: number) => { const gl = geomOrder.get(slotAttr[i]); return !!slotGeom[i] && !!gl && gl.length > 1 && !!slots[i]; };
    const isCell = (i: number) => repeated(i) && CELL_LIGHT.has(slots[i]!.attr);
    const isHead = (i: number) => repeated(i) && (slots[i]!.attr === 'pan' || slots[i]!.attr === 'tilt');
    for (let i = 0; i < slots.length; i++) if (isCell(i) && !cellGeoms.includes(slotGeom[i])) cellGeoms.push(slotGeom[i]);
    // (the cell of a head: the light geometry it holds, else one of its own)
    const under = (head: string, g: string) => { for (let x: string | undefined = g; x; x = parents.get(x)) if (x === head) return true; return false; };
    // (no tree in the file: the same number at the end of the name, Yoke2 with Head2)
    const tailNum = (g: string) => /(\d+)\s*$/.exec(g)?.[1];
    const headCell = (g: string) => {
      let k = cellGeoms.findIndex((cg) => under(g, cg));
      if (k < 0 && tailNum(g)) k = cellGeoms.findIndex((cg) => tailNum(cg) === tailNum(g));
      if (k < 0) { cellGeoms.push(g); k = cellGeoms.length - 1; }
      return k;
    };
    for (let i = 0; i < slots.length; i++) {
      const c = slots[i] ?? { name: '(unused)', attr: 'raw' as ChannelAttr };
      if (isCell(i)) c.cell = cellGeoms.indexOf(slotGeom[i]);
      else if (isHead(i)) c.cell = headCell(slotGeom[i]);
      channels.push(c);
    }
    // (cells on a flat grid in the file's geometry: a matrix panel, laid out as it's built)
    const layout = cellGeoms.length >= 4 ? gridLayout(cellGeoms.map((g) => where.get(g))) : undefined;
    return { name: mode.getAttribute('Name') ?? 'Default', channels, ...(layout ? { layout } : {}) };
  });
  // The machines (no category in GDTF: a machine says what it is in its name).
  const attrs = machineAttrs('maybe', [manufacturer, ft.getAttribute('Name'), ft.getAttribute('ShortName'), ft.getAttribute('LongName')].join(' '), made.map((x) => x.facts));
  made.forEach(({ chs, ranges }, i) => {
    const before = chs[0].attr;
    if (attrs[i] === before) return;
    for (const c of chs) c.attr = attrs[i];   // (its fine byte goes with it)
    if (needsSpan(before, attrs[i])) { const span = machineSpan(attrs[i], ranges); if (span) chs[0].span = span; }
  });

  // RDM: its maker and model ids, and the mode each personality is (any software version: the first that says)
  const ftrdm = ft.getElementsByTagName('FTRDM')[0];
  let rdm: FixtureType['rdm'];
  if (ftrdm) {
    const hex = (v: string | null) => (v && /^(0x)?[0-9a-f]+$/i.test(v) ? parseInt(v.replace(/^0x/i, ''), 16) : NaN);
    const maker = hex(ftrdm.getAttribute('ManufacturerID')), dev = hex(ftrdm.getAttribute('DeviceModelID'));
    if (Number.isFinite(maker) && Number.isFinite(dev)) {
      const map: Record<string, string> = {};
      for (const p of Array.from(ftrdm.getElementsByTagName('DMXPersonality'))) {
        const n = hex(p.getAttribute('Value')), m = p.getAttribute('DMXMode');
        if (Number.isFinite(n) && m && modes.some((x) => x.name === m) && !(String(n) in map)) map[String(n)] = m;
      }
      rdm = { maker, model: dev, ...(Object.keys(map).length ? { modes: map } : {}) };
    }
  }
  // the beam's opening angle: the zoom's degrees, else the beam's own (BeamAngle on its Beam geometry)
  let beamDeg = zoomDeg;
  if (!beamDeg) for (const b of Array.from(ft.getElementsByTagName('Beam'))) {
    const a = num(b.getAttribute('BeamAngle'));
    if (a > 0 && a <= 180) { beamDeg = [a, a]; break; }
  }
  return { id: `gdtf:${manufacturer}/${model}`, manufacturer, model, source: 'gdtf', ref, modes, physical: { panDeg, tiltDeg, ...(beamDeg ? { beamDeg } : {}) }, ...(rdm ? { rdm } : {}) };
}

function kind(attr: string, name: string, slot?: { color?: string }): Pick<ChannelRange, 'kind' | 'color'> {
  const n = name.toLowerCase();
  if (/^Shutter\d+$/.test(attr)) return { kind: /open/.test(n) ? 'open' : /close/.test(n) ? 'closed' : 'strobe' };
  if (/^Shutter\d+Strobe|Strobe/.test(attr)) return { kind: 'strobe' };
  if (slot) return { kind: 'slot', color: slot.color ?? (/open|white/.test(n) ? '#ffffff' : undefined) };
  return { kind: 'other' };
}

// Where each named geometry sits (metres, its translation added up through its parents; turns are
// left out: pixels of a panel sit side by side).
// each geometry's parent (by name): a head's axis holds its beam
function geometryParents(root: Element | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (el: Element, parent?: string) => {
    for (const c of Array.from(el.children)) {
      const name = c.getAttribute('Name') ?? undefined;
      if (name && parent && !out.has(name)) out.set(name, parent);
      walk(c, name ?? parent);
    }
  };
  if (root) walk(root);
  return out;
}
function geometryPlaces(root: Element | null | undefined): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  const walk = (el: Element, at: [number, number, number]) => {
    for (const c of Array.from(el.children)) {
      const m = /^\{[^}]*?,\s*([-\d.eE+]+)\}\s*\{[^}]*?,\s*([-\d.eE+]+)\}\s*\{[^}]*?,\s*([-\d.eE+]+)\}/.exec(c.getAttribute('Position') ?? '');
      const p: [number, number, number] = m ? [at[0] + +m[1], at[1] + +m[2], at[2] + +m[3]] : at;
      const name = c.getAttribute('Name');
      if (name && !out.has(name)) out.set(name, p);
      walk(c, p);
    }
  };
  if (root) walk(root, [0, 0, 0]);
  return out;
}
// Cells whose places make a full grid (columns across x, rows up z, or along y when it's flat):
// the matrix wiring that puts each one there. Anything else (a row, rings, gaps): none.
function gridLayout(pts: ([number, number, number] | undefined)[]) {
  if (pts.some((p) => !p)) return undefined;
  const ps = pts as [number, number, number][];
  const spread = (k: number) => Math.max(...ps.map((p) => p[k])) - Math.min(...ps.map((p) => p[k]));
  const up = spread(2) > 1e-6 ? 2 : 1;
  if (spread(0) < 1e-6 || spread(up) < 1e-6) return undefined;
  const ranks = (k: number) => { const vs: number[] = []; for (const p of ps) { const v = Math.round(p[k] * 1e4) / 1e4; if (!vs.includes(v)) vs.push(v); } vs.sort((a, b) => a - b); return (v: number) => vs.indexOf(Math.round(v * 1e4) / 1e4); };
  const col = ranks(0), row = ranks(up);
  const cols = Math.max(...ps.map((p) => col(p[0]))) + 1, rows = Math.max(...ps.map((p) => row(p[up]))) + 1;
  if (cols < 2 || rows < 2 || cols * rows !== ps.length) return undefined;
  const seen = new Set(ps.map((p) => `${col(p[0])},${row(p[up])}`));
  if (seen.size !== ps.length) return undefined;
  return matrixForGrid(cols, rows, (i) => [col(ps[i][0]), row(ps[i][up])]);
}
