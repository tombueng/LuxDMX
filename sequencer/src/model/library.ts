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
  gen('gen-spotgobo', 'Spot moving head, 16-bit + gobos + prism (16 ch)', [
    ch('Pan', 'pan', { default: 128 }), ch('Pan fine', 'pan', { fine: true }), ch('Tilt', 'tilt', { default: 128 }), ch('Tilt fine', 'tilt', { fine: true }),
    ch('Speed', 'speed'), I, S, R, G, B, W,
    ch('Gobo', 'gobo', { ranges: ['Open', 'Dots', 'Star', 'Ring', 'Bars', 'Flower', 'Triangles', 'Spiral'].map((label, i) => ({ from: i * 10, to: i * 10 + 9, label, kind: 'slot' as const })) }),
    ch('Gobo rotation', 'goboRotation'), ch('Prism', 'prism'), ch('Zoom', 'zoom'), ch('Focus', 'focus')]),
];

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
    position: has('pan', 'tilt'),
    strobe: has('strobe', 'shutter'),
    beam: has('gobo', 'prism', 'zoom', 'focus', 'iris', 'frost'),
    fog: has('fog', 'haze'),
    sfx: has('confetti', 'bubbles', 'flame', 'sparks', 'co2'),
    cells: m ? Math.max(0, ...m.channels.map((c) => (c.cell ?? -1) + 1)) : 0,
  };
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
  if (c.position) return 'mover';
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
