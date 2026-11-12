// Generic fixture types, built in. Most cheap hobby gear is one of these channel orders; the manual's
// channel table says which. Anything else: the Open Fixture Library, a QLC+ .qxf, or the wizard.
import type { PixelLayout, Channel, ChannelAttr, FixtureMode, FixtureType, Show } from './types';
import { layoutCells } from './pixelLayout';

const ch = (name: string, attr: ChannelAttr, extra: Partial<Channel> = {}): Channel => ({ name, attr, ...extra });
const I = ch('Dimmer', 'intensity'), R = ch('Red', 'red'), G = ch('Green', 'green'), B = ch('Blue', 'blue');
const W = ch('White', 'white'), A = ch('Amber', 'amber'), UV = ch('UV', 'uv'), S = ch('Strobe', 'strobe');

function gen(id: string, model: string, channels: Channel[]): FixtureType {
  return { id, manufacturer: 'Generic', model, source: 'generic', modes: [{ name: `${channels.length} ch`, channels }] };
}

function pixelBar(cells: number): FixtureType {
  const channels: Channel[] = [];
  for (let c = 0; c < cells; c++)
    channels.push(ch(`Red ${c + 1}`, 'red', { cell: c }), ch(`Green ${c + 1}`, 'green', { cell: c }), ch(`Blue ${c + 1}`, 'blue', { cell: c }));
  return gen(`gen-bar${cells}`, `Pixel bar, ${cells} RGB cells`, channels);
}
// A pixel strip (WS2811/WS2812/SK6812 on the box's pixel port, or a pixel controller): one light
// with a cell per pixel, so a rainbow or a chase runs along it (not 50 lights in the list).
function pixelStrip(pixels: number, white = false): FixtureType {
  const channels: Channel[] = [];
  for (let c = 0; c < pixels; c++) {
    channels.push(ch(`Red ${c + 1}`, 'red', { cell: c }), ch(`Green ${c + 1}`, 'green', { cell: c }), ch(`Blue ${c + 1}`, 'blue', { cell: c }));
    if (white) channels.push(ch(`White ${c + 1}`, 'white', { cell: c }));
  }
  return gen(`gen-strip${pixels}${white ? 'w' : ''}`, `Pixel strip, ${pixels} ${white ? 'RGBW pixels (SK6812)' : 'RGB pixels (WS2811/WS2812)'}`, channels);
}

// A ring, a disc of rings or a matrix: a strip with a shape, so effects can draw on it.
// (app-made ones come from here too: the ring and matrix maker)
export function pixelShape(id: string, model: string, layout: PixelLayout, white = false, source: FixtureType['source'] = 'generic'): FixtureType {
  const n = layoutCells(layout), channels: Channel[] = [];
  for (let c = 0; c < n; c++) {
    channels.push(ch(`Red ${c + 1}`, 'red', { cell: c }), ch(`Green ${c + 1}`, 'green', { cell: c }), ch(`Blue ${c + 1}`, 'blue', { cell: c }));
    if (white) channels.push(ch(`White ${c + 1}`, 'white', { cell: c }));
  }
  const t = gen(id, model, channels);
  t.source = source;
  if (source !== 'generic') t.manufacturer = '';
  t.modes[0].layout = layout;
  return t;
}
const disc = (...rings: number[]) => pixelShape(`gen-disc${rings.reduce((a, b) => a + b, 0)}`, `LED disc, ${rings.reduce((a, b) => a + b, 0)} pixels on ${rings.length} rings (WS2812)`, { kind: 'rings', rings });
const ring = (n: number) => pixelShape(`gen-ring${n}`, `LED ring, ${n} pixels (WS2812)`, { kind: 'rings', rings: [n] });
const matrix = (cols: number, rows: number, vertical = false, from?: 'br') => pixelShape(`gen-matrix${cols}x${rows}`, `LED matrix, ${cols} x ${rows} (WS2812)`, { kind: 'matrix', cols, rows, zigzag: true, vertical, ...(from ? { from } : {}) });

// An endless axis's turning channel: off (the axis goes to its position), then turning one way and the
// other with a stop between
const endless = (name: string, attr: ChannelAttr) => ch(name, attr, { ranges: [
  { from: 0, to: 9, label: 'Off' }, { from: 10, to: 127, label: 'Rotation CW fast..slow' },
  { from: 128, to: 137, label: 'Stop' }, { from: 138, to: 255, label: 'Rotation CCW slow..fast' }] });
// The rotation channel of a wheel or a prism, as real heads have it: an angle, then spinning one way
// and the other with a stop between
const turning = (name: string, attr: ChannelAttr) => ch(name, attr, { ranges: [
  { from: 0, to: 127, label: 'Index 0..360°' }, { from: 128, to: 189, label: 'Rotation CW fast..slow' },
  { from: 190, to: 193, label: 'Stop' }, { from: 194, to: 255, label: 'Rotation CCW slow..fast' }] });
// a gobo wheel's slots ten values each from 0, then a shake range for each gobo, then the wheel running
// round both ways
function wheel(name: string, attr: ChannelAttr, gobos: string[], shake: boolean): Channel {
  const slots = ['Open', ...gobos].map((label, i) => ({ from: i * 8, to: i * 8 + 7, label, kind: 'slot' as const }));
  const at = slots.length * 8, room = shake ? 120 : 0, each = shake ? Math.floor(room / gobos.length) : 0;
  const shakes = shake ? gobos.map((g, i) => ({ from: at + i * each, to: at + i * each + each - 1, label: `Shake ${i + 2} (${g}) slow..fast`, kind: 'other' as const })) : [];
  const rest = at + room, half = Math.floor((255 - rest) / 2);
  return ch(name, attr, { ranges: [...slots, ...shakes,
    { from: rest, to: rest + half, label: 'Wheel rotation CW fast..slow', kind: 'other' },
    { from: rest + half + 1, to: 255, label: 'Wheel rotation CCW slow..fast', kind: 'other' }] });
}
function headBar(n: number): FixtureType {
  const heads: Channel[] = [];
  for (let k = 0; k < n; k++) heads.push(ch(`Tilt ${k + 1}`, 'tilt', { cell: k, default: 128 }), ch(`Dimmer ${k + 1}`, 'intensity', { cell: k }),
    ch(`Red ${k + 1}`, 'red', { cell: k }), ch(`Green ${k + 1}`, 'green', { cell: k }), ch(`Blue ${k + 1}`, 'blue', { cell: k }), ch(`White ${k + 1}`, 'white', { cell: k }));
  return gen(`gen-headbar${n}`, `Moving bar, ${n} heads with their own tilt, RGBW (${2 + n * 6} ch)`, [ch('Pan', 'pan', { default: 128 }), ch('Speed', 'speed'), ...heads]);
}
function profile(): FixtureType {
  return gen('gen-profile', 'Profile spot, 16-bit, CMY, 2 gobo wheels, animation, prisms (22 ch)', [
    ch('Pan', 'pan', { default: 128 }), ch('Pan fine', 'pan', { fine: true }), ch('Tilt', 'tilt', { default: 128 }), ch('Tilt fine', 'tilt', { fine: true }),
    ch('Speed', 'speed'), I,
    ch('Shutter', 'shutter', { default: 32, ranges: [{ from: 0, to: 31, label: 'Closed', kind: 'closed' }, { from: 32, to: 63, label: 'Open', kind: 'open' }, { from: 64, to: 255, label: 'Strobe slow..fast', kind: 'strobe' }] }),
    ch('Cyan', 'cyan'), ch('Magenta', 'magenta'), ch('Yellow', 'yellow'),
    ch('Colour wheel', 'colorWheel', { ranges: [['Open', '#ffffff'], ['Red', '#ff2020'], ['Orange', '#ff8a1a'], ['Green', '#20e060'], ['Blue', '#2050ff'], ['Magenta', '#ff30d0'], ['CTO', '#ffb070'], ['UV', '#7a30ff']]
      .map(([label, color], i) => ({ from: i * 16, to: i * 16 + 15, label, color, kind: 'slot' as const })) }),
    wheel('Gobo 1 (rotating)', 'gobo', ['Breakup', 'Leaves', 'Water', 'Stars', 'Ring of dots', 'Spiral', 'Tunnel', 'Flower'], true),
    turning('Gobo 1 rotation', 'goboRotation'),
    wheel('Gobo 2 (fixed)', 'gobo2', ['Rainbow glass', 'Fire glass', 'Window', 'Snowflake', 'Triangle', 'Galaxy glass', 'Grid', 'Aurora'], false),
    ch('Animation wheel', 'animation', { ranges: [{ from: 0, to: 9, label: 'Out' }, { from: 10, to: 255, label: 'In (how far)' }] }),
    turning('Animation rotation', 'animationRotation'),
    ch('Prism', 'prism', { ranges: [{ from: 0, to: 9, label: 'Open' }, { from: 10, to: 89, label: '3-facet prism' }, { from: 90, to: 169, label: '5-facet linear prism' }, { from: 170, to: 255, label: '8-facet prism' }] }),
    turning('Prism rotation', 'prismRotation'),
    ch('Iris', 'iris'), ch('Zoom', 'zoom'), ch('Focus', 'focus'), ch('Frost', 'frost'),
  ]);
}

// The beam's opening angle (narrowest, widest) of the generic heads, as such lights have it on their
// data sheets; the rest leave it to the 3D stage's guess for their kind
const BEAMS: Record<string, [number, number]> = {
  'gen-mover8': [14, 14], 'gen-mover16': [12, 12], 'gen-wash': [7, 50], 'gen-spotgobo': [13, 30], 'gen-profile': [5, 50],
  'gen-endless': [3, 42], 'gen-roll': [2, 18], 'gen-headbar4': [4, 4],
};
export const GENERIC: FixtureType[] = [
  gen('gen-dimmer', 'Dimmer', [I]),
  gen('gen-rgb', 'RGB', [R, G, B]),
  gen('gen-drgb', 'Dimmer + RGB', [I, R, G, B]),
  gen('gen-rgbd', 'RGB + Dimmer', [R, G, B, I]),
  gen('gen-rgbw', 'RGBW', [R, G, B, W]),
  gen('gen-drgbw', 'Dimmer + RGBW', [I, R, G, B, W]),
  gen('gen-drgbws', 'Dimmer + RGBW + Strobe', [I, R, G, B, W, S]),
  // the cheap PARs with built-in programs: mode and speed stay at 0 for DMX control
  gen('gen-drgbsms', 'Dimmer + RGB + Strobe + Mode + Speed (7 ch PAR)', [I, R, G, B, S, ch('Mode', 'control'), ch('Program speed', 'raw')]),
  gen('gen-drgbwsms', 'Dimmer + RGBW + Strobe + Mode + Speed (8 ch PAR)', [I, R, G, B, W, S, ch('Mode', 'control'), ch('Program speed', 'raw')]),
  gen('gen-rgba', 'RGBA', [R, G, B, A]),
  gen('gen-drgbwauvs', 'Dimmer + RGBWA-UV + Strobe (6-in-1 PAR)', [I, R, G, B, W, A, UV, S]),
  gen('gen-cct', 'Dimmer + colour temperature', [I, ch('Colour temperature', 'cct')]),
  gen('gen-wwcw', 'Warm white + cool white', [ch('Warm white', 'warmWhite'), ch('Cool white', 'coolWhite')]),
  gen('gen-strobe', 'Strobe (dimmer + rate)', [I, ch('Rate', 'strobe')]),
  gen('gen-fog', 'Fog machine', [ch('Fog', 'fog')]),
  gen('gen-hazer', 'Hazer (haze + fan)', [ch('Haze', 'haze'), ch('Fan', 'fan')]),
  gen('gen-haze1', 'Hazer, 1 channel', [ch('Haze', 'haze')]),
  gen('gen-mover8', 'Moving head, 8 ch', [ch('Pan', 'pan', { default: 128 }), ch('Tilt', 'tilt', { default: 128 }), I, R, G, B, S, ch('Speed', 'speed')]),
  gen('gen-mover16', 'Moving head, 16-bit (11 ch)', [
    ch('Pan', 'pan', { default: 128 }), ch('Pan fine', 'pan', { fine: true }), ch('Tilt', 'tilt', { default: 128 }),
    ch('Tilt fine', 'tilt', { fine: true }), ch('Speed', 'speed'), I, S, R, G, B, W]),
  pixelBar(8), pixelBar(12), pixelBar(16), pixelBar(24),
  // (170 RGB or 128 RGBW pixels fill a universe)
  pixelStrip(30), pixelStrip(50), pixelStrip(60), pixelStrip(100), pixelStrip(144), pixelStrip(150), pixelStrip(170),
  pixelStrip(30, true), pixelStrip(60, true), pixelStrip(100, true), pixelStrip(128, true),
  // rings and matrices (over 170 pixels: they run on over the next universe, as a box's pixel port does)
  ring(12), ring(16), ring(24), ring(60),
  disc(16, 12, 8, 1), disc(24, 16, 12, 8, 1), disc(32, 24, 16, 12, 8, 1), disc(31, 28, 24, 20, 16, 12, 8, 4, 1), disc(60, 48, 40, 32, 24, 16, 12, 8, 1),
  // (the 16 x 16: as a real flexible panel here is wired, up and down its columns from the bottom right)
  matrix(8, 8), matrix(16, 16, true, 'br'), matrix(32, 8, true),
  // effect machines: they fire or run while their channel is up (the 3D stage shows what they throw)
  gen('gen-confetti', 'Confetti cannon', [ch('Fire', 'confetti')]),
  gen('gen-bubbles', 'Bubble machine', [ch('Bubbles', 'bubbles'), ch('Fan', 'fan')]),
  gen('gen-flame', 'Flame projector', [ch('Flame', 'flame')]),
  gen('gen-sparks', 'Cold spark machine', [ch('Height', 'sparks')]),
  gen('gen-co2', 'CO2 jet', [ch('Jet', 'co2')]),
  gen('gen-blinder2', 'Blinder, 2-lite', [I]),
  gen('gen-wash', 'Wash moving head, 16-bit + zoom (14 ch)', [
    ch('Pan', 'pan', { default: 128 }), ch('Pan fine', 'pan', { fine: true }), ch('Tilt', 'tilt', { default: 128 }), ch('Tilt fine', 'tilt', { fine: true }),
    ch('Speed', 'speed'), I, S, R, G, B, W, ch('Zoom', 'zoom'), ch('Mode', 'control'), ch('Reset', 'control')]),
  // the typical LED spot: a gobo wheel (slots in 10s, the first one open), a rotating prism, zoom and focus
  // (the gobo and the prism turn either way: index, CW, stop, CCW, as real heads have it)
  gen('gen-spotgobo', 'Spot moving head, 16-bit + gobos + prism (17 ch)', [
    ch('Pan', 'pan', { default: 128 }), ch('Pan fine', 'pan', { fine: true }), ch('Tilt', 'tilt', { default: 128 }), ch('Tilt fine', 'tilt', { fine: true }),
    ch('Speed', 'speed'), I, S, R, G, B, W,
    ch('Gobo', 'gobo', { ranges: ['Open', 'Dots', 'Star', 'Ring', 'Bars', 'Flower', 'Triangles', 'Spiral'].map((label, i) => ({ from: i * 10, to: i * 10 + 9, label, kind: 'slot' as const })) }),
    turning('Gobo rotation', 'goboRotation'), ch('Prism', 'prism'), ch('Zoom', 'zoom'), ch('Focus', 'focus'), turning('Prism rotation', 'prismRotation')]),
  // a head that turns round and round: endless pan and tilt (a turning range each way, or off: the
  // position), as hybrid beam heads have them
  gen('gen-endless', 'Moving head, endless pan and tilt, 16-bit (14 ch)', [
    ch('Pan', 'pan', { default: 128 }), ch('Pan fine', 'pan', { fine: true }), ch('Tilt', 'tilt', { default: 128 }), ch('Tilt fine', 'tilt', { fine: true }),
    endless('Pan rotation', 'panRotation'), endless('Tilt rotation', 'tiltRotation'), ch('Speed', 'speed'), I, S, R, G, B, W, ch('Zoom', 'zoom')]),
  // a beam head with a third axis: it turns round its beam too (a roll), to an angle or on and on
  { ...gen('gen-roll', 'Beam head with a third axis (roll), endless (13 ch)', [
    ch('Pan', 'pan', { default: 128 }), ch('Tilt', 'tilt', { default: 128 }), ch('Roll', 'roll', { default: 128 }), endless('Roll rotation', 'rollRotation'),
    I, R, G, B,
    ch('Gobo', 'gobo', { ranges: ['Open', 'Bars', 'Triangles', 'Dots', 'Star'].map((label, i) => ({ from: i * 10, to: i * 10 + 9, label, kind: 'slot' as const })) }),
    ch('Gobo rotation', 'goboRotation'), ch('Prism', 'prism', { ranges: [{ from: 0, to: 9, label: 'Open' }, { from: 10, to: 255, label: '5-facet linear prism' }] }), ch('Zoom', 'zoom'), ch('Speed', 'speed')]),
    physical: { rollDeg: 360 } },
  // a moving bar: the bar pans, each of its four heads tilts on its own (a cell each, with its own
  // dimmer and RGBW): waves and fans run along the heads
  headBar(4),
  // a kinetic winch with an LED ball on it: its height (16-bit, 0 at the top), how fast, its motion
  // enable (the machines' Arm opens it), and the ball's light
  { ...gen('gen-winch', 'Kinetic winch with an LED ball (8 ch)', [
    ch('Height', 'hoist'), ch('Height fine', 'hoist', { fine: true }), ch('Speed', 'speed'),
    ch('Motion enable', 'enable', { ranges: [{ from: 0, to: 99, label: 'Safe' }, { from: 100, to: 255, label: 'Motion enabled' }] }),
    I, R, G, B]), physical: { travel: 4, hoistSpeed: 0.5 } },
  // a big profile spot as touring rigs have them: CMY and a colour wheel, a rotating gobo wheel (each
  // gobo can shake; the wheel can run round), a fixed wheel with glass gobos, an animation wheel,
  // three prisms that turn, iris, zoom, focus and frost; the rotation channels index or spin
  profile(),
];
for (const t of GENERIC) if (BEAMS[t.id]) t.physical = { ...t.physical, beamDeg: BEAMS[t.id] };

// A cue list that only switches fog or haze (a fog timer): it lives with the fog, not with the songs.
// A play: a list run cue by cue, with standby notes or cues that follow on by themselves (not a set
// of moods to pick from). The list can say so itself (its settings), else it's guessed.
export function isPlay(l: { play?: boolean; cues: { note?: string; advance: { mode: string } }[] }): boolean {
  return l.play ?? l.cues.some((c) => !!c.note || c.advance.mode === 'follow');
}

// A list of looks: picked by hand, a look at a time (not a play, not a chase): a look sets the
// lights it names and leaves the rest as they are. A play, or a chase (every step goes on by
// itself), adds up from the top, so going round comes back to step 1's look. One timed look among
// the others doesn't make a list of looks a chase.
export function isLooks(l: { play?: boolean; cues: { note?: string; advance: { mode: string } }[] }): boolean {
  return !isPlay(l) && !(l.cues.length > 0 && l.cues.every((c) => c.advance.mode !== 'manual'));
}

export function isFogTimer(l: { cues: { values: Record<string, Record<string, unknown>> }[] }): boolean {
  const vals = l.cues.flatMap((c) => Object.values(c.values));
  return vals.some((v) => 'fog' in v || 'haze' in v) && vals.every((v) => Object.keys(v).every((k) => k === 'fog' || k === 'haze'));
}

export function typeMap(show: Pick<Show, 'fixtureTypes'>): Map<string, FixtureType> {
  return new Map([...GENERIC, ...show.fixtureTypes].map((t) => [t.id, t]));
}

export function modeOf(t: FixtureType | undefined, name: string): FixtureMode | undefined {
  if (!t) return undefined;
  return t.modes.find((m) => m.name === name) ?? t.modes[0];
}

export const typeLabel = (t: FixtureType) => (t.manufacturer === 'Generic' ? t.model : `${t.manufacturer} ${t.model}`);

// What a fixture can do, for showing the right controls.
export function caps(m: FixtureMode | undefined) {
  const has = (...a: ChannelAttr[]) => !!m?.channels.some((c) => a.includes(c.attr));
  return {
    intensity: has('intensity'),
    color: has('red', 'green', 'blue', 'cyan', 'magenta', 'yellow', 'colorWheel'),
    white: has('white'),
    amber: has('amber'),
    uv: has('uv'),
    cct: has('cct', 'warmWhite', 'coolWhite'),
    position: has('pan', 'tilt'),   // (a moving bar's heads too: their pan and tilt are cells')
    strobe: has('strobe', 'shutter'),
    beam: has('gobo', 'prism', 'zoom', 'focus', 'iris', 'frost'),
    fog: has('fog', 'haze'),
    sfx: has('confetti', 'bubbles', 'flame', 'sparks', 'co2'),
    cells: m ? Math.max(0, ...m.channels.map((c) => (c.cell ?? -1) + 1)) : 0,
    // cells that are heads of their own (a moving bar): those with a pan or tilt channel of their own
    heads: m ? new Set(m.channels.filter((c) => c.cell !== undefined && (c.attr === 'pan' || c.attr === 'tilt')).map((c) => c.cell)).size : 0,
    // which of pan and tilt its heads have of their own (a bar that pans as one, its heads tilting each)
    cellMoves: (['pan', 'tilt', 'hoist'] as const).filter((a) => !!m?.channels.some((c) => c.attr === a && c.cell !== undefined)),
  };
}

// The cells that are heads of their own (a moving bar's), in order; remembered per mode
const headCache = new WeakMap<FixtureMode, number[]>();
export function headCellsOf(m: FixtureMode): number[] {
  let h = headCache.get(m);
  if (!h) { h = [...new Set(m.channels.filter((c) => c.cell !== undefined && (c.attr === 'pan' || c.attr === 'tilt')).map((c) => c.cell!))].sort((a, b) => a - b); headCache.set(m, h); }
  return h;
}

// The same, remembered per mode (it's asked for every frame and in every list row).
const capsCache = new WeakMap<FixtureMode, ReturnType<typeof caps>>();
export function capsOf(m: FixtureMode | undefined) {
  if (!m) return caps(undefined);
  let c = capsCache.get(m);
  if (!c) { c = caps(m); capsCache.set(m, c); }
  return c;
}

// What kind of thing a fixture is, for its icon and how the stage draws it.
export type FixtureKind = 'mover' | 'bar' | 'fog' | 'sfx' | 'strobe' | 'par' | 'dimmer' | 'other';
export function kindOf(m: FixtureMode | undefined): FixtureKind {
  if (!m) return 'other';
  const c = caps(m);
  if (c.position || c.heads) return 'mover';
  if (c.cells > 1) return 'bar';
  if (c.sfx) return 'sfx';
  if (c.fog) return 'fog';
  if (c.color || c.white || c.cct) return 'par';
  if (c.strobe) return 'strobe';
  if (c.intensity) return 'dimmer';
  return 'other';
}
export const KIND_LABEL: Record<FixtureKind, string> = {
  mover: 'Moving head', bar: 'Pixel bar', fog: 'Fog / haze', sfx: 'Effect machine', strobe: 'Strobe', par: 'Colour light', dimmer: 'Dimmer', other: 'Other',
};
