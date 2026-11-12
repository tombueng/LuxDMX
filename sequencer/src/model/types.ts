import type { ScheduleEntry } from './schedule';
import type { Place } from './sun';
import type { SetList, Timeline } from './timeline';
// The show model, v1. FORMAT.md documents every field; this file is the source of truth for the
// types. Everything here is plain data, so a show saves as JSON exactly as it sits in memory, and
// fields this version doesn't know (from a newer app) survive a load/save untouched.

// ---------------------------------------------------------------- fixture types

// What one DMX channel does.
export type ChannelAttr =
  | 'intensity'
  | 'red' | 'green' | 'blue' | 'white' | 'warmWhite' | 'coolWhite' | 'amber' | 'uv' | 'lime'
  | 'cyan' | 'magenta' | 'yellow'
  | 'cct'                 // colour temperature, warm (0) .. cool (255)
  | 'colorWheel'          // slots described by ranges
  | 'pan' | 'tilt'
  | 'panRotation' | 'tiltRotation'   // endless pan / tilt: turning round and round (ranges: stop, CW, CCW, or an index)
  | 'roll' | 'rollRotation'          // a third axis (the head or bar turning round its beam), and its endless turning
  | 'hoist'                          // a winch: how far down it has let its load (0 at the top of its travel, 1 at the bottom)
  | 'strobe'              // 0 = no strobe, then slow .. fast
  | 'shutter'             // ranges: open / closed / strobe
  | 'gobo' | 'goboRotation' | 'prism' | 'zoom' | 'focus' | 'iris' | 'frost'
  | 'gobo2' | 'gobo2Rotation'   // a second gobo wheel (slots by ranges) and its rotation
  | 'prismRotation'
  | 'animation' | 'animationRotation'   // an animation wheel: how far in (or which part), and its turning
  | 'effectMacro' | 'effectSpeed'       // the light's own built-in effects (picked by their ranges) and their speed
  | 'colorMacro'                        // its own colour programs (picked by their ranges)
  | 'fog' | 'haze' | 'fan'
  | 'confetti' | 'bubbles' | 'flame' | 'sparks' | 'co2'   // effect machines (fire, run while up)
  | 'enable'              // a machine's own safety / enable channel: on while armed, 0 while safe
  | 'speed'               // pan/tilt or effect speed
  | 'control'             // reset, lamp, macros: never driven, sits at its default
  | 'raw';                // anything else: default value unless a cue sets it by channel

export interface ChannelRange {
  from: number;           // DMX 0..255, inclusive
  to: number;
  label: string;
  kind?: 'open' | 'closed' | 'strobe' | 'slot' | 'other';
  color?: string;         // '#rrggbb' for a colour wheel slot
}

export interface Channel {
  name: string;
  attr: ChannelAttr;
  fine?: boolean;         // low byte of the nearest coarse channel with the same attr (16 bit)
  default?: number;       // DMX value when nothing drives it
  ranges?: ChannelRange[];
  cell?: number;          // pixel bars: which cell (0-based) this channel belongs to
  span?: [number, number]; // DMX range the attribute moves through, when it doesn't use the whole
                           // channel (an iris from 0 to 191, effects above): value 0 -> from, 1 -> to
}

// Where the pixels of a ring, a disc or a matrix really are, so an effect can draw on them. Cells
// count in data order (model/pixelLayout.ts works out each one's place).
//   rings: LEDs per ring in the order the data runs through them (rim first: 60, 48, ... 1). A
//     bigger ring is further out. Each ring starts at the top and runs clockwise (`ccw` the other
//     way, `turn` degrees turns the whole thing).
//   matrix: rows of LEDs from the corner `from` (top left unless it says), along the rows
//     (`vertical`: along the columns); `zigzag`: every second row runs back.
export type PixelLayout =
  | { kind: 'rings'; rings: number[]; ccw?: boolean; turn?: number }
  | { kind: 'matrix'; cols: number; rows: number; zigzag?: boolean; vertical?: boolean; from?: 'tl' | 'tr' | 'bl' | 'br' };

export interface FixtureMode {
  name: string;
  channels: Channel[];
  layout?: PixelLayout;   // a ring or a matrix (`cell` says which pixel a channel belongs to)
}

export interface FixtureType {
  id: string;
  manufacturer: string;
  model: string;
  source: 'generic' | 'ofl' | 'gdtf' | 'qxf' | 'user';
  ref?: string;           // where it came from (OFL key, file name)
  modes: FixtureMode[];
  // rollDeg: how far its third axis turns (360 when not said); beamDeg: its beam's opening angle in
  // degrees, narrowest and widest (zoom in and out; the same twice: no zoom), from its data sheet
  // travel, hoistSpeed: a winch's travel in metres (from the top of it down) and how fast it goes (m/s)
  physical?: { panDeg?: number; tiltDeg?: number; rollDeg?: number; beamDeg?: [number, number]; travel?: number; hoistSpeed?: number };
  // the light's RDM maker (ESTA) and model ids, and which of its modes each RDM personality is (by
  // number): a light found on the line is patched with this type and the right mode
  rdm?: { maker: number; model: number; modes?: Record<string, string> };
}

// ---------------------------------------------------------------- values

export interface Color { r: number; g: number; b: number }   // 0..1 each
export interface PresetRef { preset: string }

export type NumAttr =
  | 'intensity' | 'white' | 'amber' | 'uv' | 'cct'
  | 'pan' | 'tilt' | 'strobe' | 'zoom' | 'focus' | 'iris' | 'frost' | 'prism' | 'goboRotation'
  | 'gobo' | 'fog' | 'haze' | 'fan' | 'speed'
  | 'gobo2' | 'gobo2Rotation' | 'prismRotation' | 'animation' | 'animationRotation' | 'effectMacro' | 'effectSpeed' | 'colorMacro'
  | 'confetti' | 'bubbles' | 'flame' | 'sparks' | 'co2'
  // a gobo wheel's own functions, on its channel's ranges (render.ts): the gobo shaking (0 still,
  // up to 1 fastest) and the whole wheel running round (-1..1: counter-clockwise .. clockwise, 0 not)
  | 'goboShake' | 'goboScroll' | 'gobo2Shake' | 'gobo2Scroll'
  // more axes than pan and tilt: endless pan / tilt, a third axis (roll) and its endless turning
  | 'panRotation' | 'tiltRotation' | 'roll' | 'rollRotation'
  // a winch (kinetics): how far down its load is, 0 at the top of its travel, 1 at the bottom
  | 'hoist';

// One fixture's state. Every number is 0..1 (gobo, gobo2, effectMacro, colorMacro: the slot's
// position in its range list, as a fraction). Each attribute is either a value or a reference to a preset. Missing = not touched.
export type Values = { [K in NumAttr]?: number | PresetRef } & {
  color?: Color | PresetRef;
  raw?: Record<string, number>;   // channel index in the mode -> DMX value, for channels we don't model
  // a light made of cells (a pixel bar, a ring, each LED of a pixel head): what single cells show,
  // by cell index (as a string key): what makes light (intensity, color, white, amber, uv), and on a
  // light whose cells are heads (a moving bar) where each points (pan, tilt). A cell that isn't
  // named (or doesn't name one of those) shows what the light as a whole shows.
  cells?: Record<string, CellValues>;
};
export type CellAttr = 'intensity' | 'white' | 'amber' | 'uv';
// a head of its own among the cells (a moving bar's heads, each with its own tilt and pan): where it points
export type CellMove = 'pan' | 'tilt' | 'hoist';
export type CellValues = { [K in CellAttr | CellMove]?: number | PresetRef } & { color?: Color | PresetRef };
export const CELL_ATTRS: CellAttr[] = ['intensity', 'white', 'amber', 'uv'];
export const CELL_MOVES: CellMove[] = ['pan', 'tilt', 'hoist'];

// Values with every preset looked up: what the engine works with.
export type Resolved = { [K in NumAttr]?: number } & { color?: Color; raw?: Record<string, number>; cells?: Resolved[];   // cells: per pixel, from effects
  cellVals?: Record<string, Resolved>;   // what single cells were set to (Values.cells): sparse, colours and the like
  cellLvl?: Float64Array;                // each cell's level, when the engine worked them out per cell (HTP across lists)
  draw?: Color };   // what the light looks like, for drawing only (a white fixture asked for "Purple" still looks white)

// ---------------------------------------------------------------- patch

export interface Fixture {
  id: string;
  name: string;
  num?: number;           // its number (from 1, unique): "5 @ full" and the console go by it; kept when others come and go (model/numbers.ts)
  typeId: string;
  mode: string;
  universe: number;       // Art-Net port-address, as set on the LuxDMX output
  address: number;        // 1..512
  x: number;              // stage position 0..1
  y: number;
  invertPan?: boolean;
  invertTilt?: boolean;
  // the 3D stage (stage3d/geometry.ts): where it is (metres, y up), how it's turned (degrees), and
  // where its DMX 50 % really points (calibration, degrees). Unset: from its kind and 2D place.
  p3?: { x: number; y: number; z: number };
  rot?: { yaw: number; pitch: number; roll: number };
  panOffset?: number;
  tiltOffset?: number;
  // the light's own pan and tilt range in degrees, for a type that doesn't say (or says wrong);
  // swapPanTilt: what a cue sends as pan goes to its tilt channel and the other way round
  // (model/fixtureSetup.ts, the light's setup)
  panDeg?: number;
  tiltDeg?: number;
  beamDeg?: [number, number];   // this light's own beam angle, narrowest and widest (over its type's)
  // a winch's soft limits: how high and how low it may go, as parts of its travel (0 the top, 1 the
  // bottom): whatever a cue says, the winch is sent within them
  hoistLimits?: [number, number];
  swapPanTilt?: boolean;
  // its own pan (tilt) turns the other way round from what its type says: the picture, Aim and the
  // 3D stage follow the real one; what goes out on the wire stays the same (invert changes that)
  panReversed?: boolean;
  tiltReversed?: boolean;
  // the real light this fixture is (its RDM UID, "MMMM:DDDDDDDD"): set when it was patched from the
  // rig or matched to it, so the app knows it wherever its address goes (rdm/match.ts)
  uid?: string;
  // a ring or a matrix wired or hung differently from its type: its own layout, with the same
  // number of pixels (model/pixelLayout.ts; the light's LEDs tab sets it)
  layout?: PixelLayout;
  // how its LEDs really light, set by hand (model/ledCurve.ts: gamma, brightness 0..255, power cap
  // and current model); unset: what the box's pixel port says, or a port as it comes
  led?: { gamma?: number; bright?: number; maxMa?: number; maPerCh?: number; idleMa?: number };
}

// A mark on the real stage (a bit of tape): its place in metres, x to the audience's right, y up,
// z towards the audience (stage3d/geometry.ts).
export interface StageMark { id: string; name: string; p: { x: number; y: number; z: number } }

export interface Group {
  id: string;
  name: string;
  fixtures: string[];     // ordered: effects run along this order
  cells?: number[];       // some cells of its lights only ("Rim": the rings' outer LEDs), in order: selecting it picks them, an effect on it runs on them
  auto?: boolean;         // made by the app from the patch (rebuilt when the patch changes)
}

export type PresetKind = 'color' | 'position' | 'beam' | 'intensity';

export interface Preset {
  id: string;
  name: string;
  kind: PresetKind;
  values: Values;                         // for every fixture (matched by attribute)
  perFixture?: Record<string, Values>;    // overrides, e.g. each mover's own pan/tilt
  auto?: boolean;
}

// ---------------------------------------------------------------- playback

export type Advance =
  | { mode: 'manual' }
  | { mode: 'wait'; time: number }        // seconds after the cue started
  | { mode: 'follow'; time: number }      // seconds after the cue's fade finished
  | { mode: 'beats'; beats: number };     // beats after the cue started (speed master tempo)

export type CueAction =
  | { do: 'start' | 'stop' | 'release' | 'go'; list: string }
  | { do: 'master'; list: string; level: number }
  | { do: 'goto'; list: string; cue: string }      // play that cue of the list (house lights up, whatever they were on)
  | { do: 'blackout'; on: boolean }
  | { do: 'off' };                                 // everything off: every list fades out, effects stop (not a blackout: the next look comes up)

export interface Cue {
  id: string;
  name: string;
  values: Record<string, Values>;   // by fixture id; fixtures not listed are left alone
  fade: number;                     // seconds
  fadeOut?: number;                 // advanced: intensity going down
  delay?: number;                   // advanced: seconds before the fade starts
  // advanced: a fade of its own for colour, position and the beam (seconds; not set: the fade), as
  // desks have: a quick colour change while the heads take their time to move
  times?: CueTimes;
  advance: Advance;
  effects?: string[];               // effect ids running while this cue is on
  actions?: CueAction[];
  note?: string;
  num?: number;                     // its number (20.5); none: its place in the list (see model/cuenum.ts)
}

export interface CueList {
  id: string;
  name: string;
  cues: Cue[];
  end: 'loop' | 'stop' | 'release';
  priority?: 'low' | 'normal' | 'high';   // advanced; default normal
  releaseTime?: number;                    // seconds, default 2
  restart?: 'first' | 'resume';            // what starting it again does, default first
  color?: string;                          // button colour on pages
  bpm?: number;                            // the song's tempo: picking this list for GO sets it
  play?: boolean;                          // run as a play (see isPlay); unset: guessed from its cues
}

// An effect running on a group (or a list of fixtures), in their order. `kind` is one of the
// built-in effects (FORMAT.md lists them), `params` its knobs; a missing knob uses the default.
export interface Effect {
  id: string;
  name: string;
  kind: string;
  group?: string;                   // a group id: its fixtures, in its order
  fixtures?: string[];              // or these fixtures, in this order (used when there's no group)
  cells?: number[];                 // on lights with cells: only these (a chase round a ring's rim), in this order
  params: Record<string, unknown>;
}

// Live pages: grids of buttons and faders for playing the show.
export type ListAction = 'go' | 'back' | 'toggle' | 'flash' | 'release' | 'solo' | 'select';   // select: GO plays this list (a song in a set list)
export interface CueTimes { color?: number; position?: number; beam?: number }
export interface MidiBinding { kind: 'note' | 'cc'; ch: number; num: number }   // ch 1..16
// A console fader on a MIDI control: `to` is 'grand', 'list:<id>', 'group:<id>' or 'light:<id>'
export interface ConsoleMidi { to: string; midi: MidiBinding }
interface WidgetBase { id: string; label?: string; color?: string; size?: 1 | 2; key?: string; midi?: MidiBinding }
export type Widget = WidgetBase & (
  | { type: 'list'; list: string; action: ListAction }                  // a cue list button
  | { type: 'cue'; list: string; cue: string }                          // go straight to one cue
  | { type: 'effect'; effect: string; action: 'toggle' | 'flash' }
  | { type: 'fader'; target: 'grand' | 'list' | 'effect' | 'bpm'; ref?: string }
  | { type: 'fog'; fixtures: string[]; level: number; burst: number; max: number }   // seconds
  | { type: 'group'; group: string; level: number; strobe?: number; white?: boolean }    // flash a group while held (white: a blinder)
  | { type: 'special'; do: 'blackout' | 'releaseAll' | 'tap' | 'stopEffects' | 'blinder' | 'drop' | 'fadeOut'; seconds?: number }   // seconds: fadeOut's time (5)
  | { type: 'label' }
  | { type: 'cuelist'; list: string }                                  // a whole list, the way a play is run
  | { type: 'song'; do: 'play' | 'next' | 'part' }                     // the set list: play / pause the song, next song, next part
);

export interface Page {
  id: string;
  name: string;
  widgets: Widget[];
  locked?: boolean;
  go?: false;           // a page without GO and Back (a staff page of looks: tapped, never stepped into "All off")
}

// host: a LuxDMX box's address, or 'link' for LuxDMX Link on this computer (Art-Net / sACN to any
// node); proto: what Link sends (Art-Net unless said)
export interface VenueModel { name: string; store: string; scale: number; x: number; y: number; z: number; yaw: number }
export interface Device { host: string; proto?: 'artnet' | 'sacn' | 'both' }

export interface Show {
  format: 'luxdmx-show';
  formatVersion: string;            // semver of the format this file was written with
  minReaderVersion: string;         // oldest format version that can read it safely
  requiredFeatures: string[];       // a reader that doesn't know one of these must refuse
  meta: { name: string; created: string; modified: string; app: string };
  fixtureTypes: FixtureType[];      // every non-generic type the show uses, so it's self-contained
  fixtures: Fixture[];
  groups: Group[];
  presets: Preset[];
  cueLists: CueList[];
  effects: Effect[];
  pages: Page[];
  outputs: { devices: Device[] };
  // stage.image: a data: URL drawn under the stage; schedule: the timetable (model/schedule.ts)
  // lockPin: the PIN that unlocks a show locked for the service (staff-proofing, not security);
  // lockPage: the live page it was locked on (the only one shown while locked)
  // place: where the show is, for the timetable's sunrise and sunset (unset: guessed from the time zone)
  // scheduleOff: the timetable switched off; schedulePause: not playing until then (ms since 1970)
  // stage3d.model: your own venue for the 3D stage (a .glb kept in the browser: store is its key);
  // stage3d.room: the built-in room ('pub': a small club or pub; unset: the big stage in a hall)
  // bandName: the band's name on the 3D stage's banners and screens (unset: the band's picture)
  // marks: tape on the real stage, where they are (metres, the 3D stage's frame): heads are steered
  // onto them to work out where they really hang (model/calibrate.ts), and to point at
  settings: { bpm: number; marks?: StageMark[]; stage?: { image?: string; opacity?: number }; stage3d?: { model?: VenueModel; hideVenue?: boolean; room?: 'hall' | 'pub' | 'club' | 'party' | 'truss' }; bandName?: string; schedule?: ScheduleEntry[]; scheduleOff?: boolean; schedulePause?: number; place?: Place; lockPin?: string; lockPage?: string; consoleMidi?: ConsoleMidi[]; recordChanges?: boolean };
  timeline?: Timeline;              // a song with cues, effects and moments on it (model/timeline.ts): the one that's up
  setlist?: SetList;                // the other songs of the set, before and after it, in order (model/timeline.ts)
  extensions: Record<string, unknown>;
}
