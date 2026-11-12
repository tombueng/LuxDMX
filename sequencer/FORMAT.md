# The LuxDMX show format

A show is one JSON file, usually named `<name>.luxdmx.json`. This document describes format
version **1.2.0** (1.1.0 specified effects and live pages; 1.2.0 added single cells of pixel
lights in cues, presets, groups and effects, fixture numbers, a cue's own times for colour,
position and beam, the console's MIDI controls, `settings.recordChanges`, a type's `physical` and
RDM ids, and new attributes. A 1.0.0 reader opens newer files and keeps what it doesn't know untouched; a show with
cells says so in `requiredFeatures`, so an older reader refuses it instead of playing it wrong). The TypeScript types in `src/model/types.ts` are the same thing in code.

The format is open: read it, write it, generate it from a script. Nothing in it is encrypted or
tied to this app. A JSON Schema for checking files is in `schema/luxdmx-show.schema.json` (it
allows unknown fields everywhere, like readers must).

## Versioning, and what readers must do

```json
{
  "format": "luxdmx-show",
  "formatVersion": "1.2.0",
  "minReaderVersion": "1.0.0",
  "requiredFeatures": [],
  ...
}
```

- `format` is always `"luxdmx-show"`.
- `formatVersion` is the [semver](https://semver.org) version of the format the file was written
  with. Minor versions only add fields; a major version changes the meaning of existing ones.
- `minReaderVersion` is the oldest format version that can still read this file correctly. A
  reader that's older than this must refuse the file and say so.
- `requiredFeatures` lists features a reader must understand to play the show correctly. A reader
  that doesn't know one of them must refuse the file. The one there is: `cells`, written when a
  cue, a preset, a group or an effect uses single cells of pixel lights (`cells` in Values, Groups,
  Effects). A file without any has none.
- A writer keeps a newer `formatVersion` and `minReaderVersion` it found in the file (it doesn't
  write its own older numbers over them).
- **Unknown fields must be kept.** A reader that finds a field it doesn't know (anywhere, at any
  depth) keeps it and writes it back unchanged when it saves. That's what lets an older app open a
  newer show, edit it, and save it without destroying what it didn't understand.
- `extensions` is the place for data that isn't part of the format: use a reverse-domain key
  (`"org.example.mytool": {...}`). Readers keep it like any other unknown field.
- Older files are upgraded on load by one migration per format version, in order. A migration is
  never changed once released.
- **What can't be used is mended, never played.** A file can hold anything (written by hand,
  damaged on the way), and nothing in it may stop the lights. The app reads it like this: an
  entry of a list that isn't an object (a `null`), or has no id or the id of
  one before it, is left out; a number written as text (`"0"`) is that number; a number outside
  its range is brought into it (levels 0 to 1, tempos (`bpm`) 20 to 300, fades and waits 0 to
  3600 s, effect `speed` 0.05 to 3600, `blocks` 1 to 512, a fog button's `max` 1 to 60 s, 10 s
  when it has none, a timeline's `duration` at most a day); something that isn't a number where one goes (or is endless, like `1e999`) is
  left out, so its default plays. A fixture whose `universe` or `address` can't be read, or is
  out of range, is left out (it would light something else).

## Conventions

- All levels are numbers from 0 to 1 (not percent, not DMX). DMX values (0 to 255) only appear
  where the file talks about channels directly (`raw` values, channel ranges, defaults).
- Times are seconds (decimals allowed).
- IDs are strings, unique within their list, and never shown to users. Names are what users see.
- Colours are `{ "r": 0..1, "g": 0..1, "b": 0..1 }`; colour wheel slots use `"#rrggbb"`.
- Universes are Art-Net port-addresses (0 to 32767), the number set on a LuxDMX output.
  Addresses are 1 to 512.

## Top level

| Field | Type | Meaning |
|---|---|---|
| `format`, `formatVersion`, `minReaderVersion`, `requiredFeatures` | | see above |
| `meta` | object | `name`, `created`, `modified` (ISO 8601 times), `app` (what wrote it) |
| `fixtureTypes` | FixtureType[] | every non-built-in type the show uses, so the file is self-contained |
| `fixtures` | Fixture[] | the patch |
| `groups` | Group[] | |
| `presets` | Preset[] | |
| `cueLists` | CueList[] | everything that plays |
| `effects` | Effect[] | chases, rainbows, moves: see Effects |
| `pages` | Page[] | live control pages: see Pages |
| `outputs` | object | `devices`: `[{ "host": "192.168.1.50" }]`, the LuxDMX boxes to send to |
| `settings` | object | `bpm`: tempo for beat-based cues and effects; `stage`: `{ image, opacity }`, a picture (data: URL) drawn under the stage; `marks`: the stage's marks, below |
| `timeline`, `setlist` | object | the song that's up, and the other songs of the set: see The timeline, The set list |
| `extensions` | object | anything else, under reverse-domain keys |

## Fixture types

```json
{
  "id": "ofl:cameo/flat-pro-18",
  "manufacturer": "Cameo",
  "model": "Flat Pro 18",
  "source": "ofl",
  "ref": "cameo/flat-pro-18",
  "physical": { "panDeg": 540, "tiltDeg": 270 },
  "modes": [
    { "name": "6 ch", "channels": [
      { "name": "Dimmer", "attr": "intensity" },
      { "name": "Red", "attr": "red" },
      { "name": "Pan fine", "attr": "pan", "fine": true },
      { "name": "Shutter", "attr": "shutter", "ranges": [
        { "from": 0, "to": 7, "label": "Closed", "kind": "closed" },
        { "from": 8, "to": 15, "label": "Open", "kind": "open" },
        { "from": 16, "to": 255, "label": "Strobe slow-fast", "kind": "strobe" } ] },
      { "name": "Iris", "attr": "iris", "span": [0, 191], "ranges": [ ... ] }
    ] }
  ]
}
```

- `source`: `generic` (built in), `ofl` (Open Fixture Library), `gdtf`, `qxf` (QLC+), `user`.
- `physical` (optional): `panDeg`, `tiltDeg`, how far pan and tilt go from 0 to 255, in degrees;
  `rollDeg`, how far a third axis (roll) turns (360 when not said); `beamDeg`, the beam's opening
  angle in degrees, `[narrowest, widest]` (zoomed in and out; the same twice for a light without a
  zoom), from the fixture file (OFL `physical.lens.degreesMinMax` or a zoom's angles, GDTF a zoom
  in degrees or the beam's `BeamAngle`, QLC+ `Lens DegreesMin/DegreesMax`). The 3D stage draws the
  beam at that angle; without it, a guess for its kind. `travel` and `hoistSpeed`, for a winch:
  how far its load goes from the top down (metres, 0.1 to 100) and its top speed (metres a second,
  0.01 to 10); the 3D stage moves it so (4 m and 0.4 m/s when not said).
- `rdm` (optional): what the real fixture says it is over RDM, so a light found on the line is
  patched with this type: `maker` (its ESTA manufacturer id), `model` (its device model id) and
  `modes`, its RDM personalities by number (`{ "1": "6 ch" }`, the name of this type's mode).
  A GDTF file brings them along; a copy of a type made for one light leaves them out.
- Built-in generic types (ids starting with `gen-`) are not stored in the file; a reader that
  doesn't know one should treat the fixture's channels as `raw`.
- A channel's `attr` says what it does:

| attr | meaning |
|---|---|
| `intensity` | dimmer |
| `red`, `green`, `blue`, `white`, `warmWhite`, `coolWhite`, `amber`, `uv`, `lime`, `cyan`, `magenta`, `yellow` | colour emitters / CMY flags |
| `cct` | colour temperature, 0 = warm, 255 = cool |
| `colorWheel` | colour wheel; slots are `ranges` with a `color` |
| `pan`, `tilt` | position; `fine: true` marks the low byte of a 16-bit pair |
| `strobe` | 0 = no strobe, then slow to fast |
| `shutter` | `ranges` with `kind` `open`, `closed`, `strobe` |
| `gobo` | gobo wheel; slots are `ranges` |
| `gobo2` | a second gobo wheel (most profile spots have a static and a rotating one); slots are `ranges` |
| `goboRotation`, `gobo2Rotation`, `prism`, `prismRotation`, `zoom`, `focus`, `iris`, `frost` | beam (each wheel's rotation, the prism and its turning) |
| `animation`, `animationRotation` | an animation wheel: how far it's in (or which part), and its turning |
| `panRotation`, `tiltRotation` | endless pan / tilt: turning round and round (ranges: off, CW, stop, CCW, or an index) |
| `roll`, `rollRotation` | a third axis (the head turning round its own beam, over the type's `physical.rollDeg`), and its endless turning |
| `hoist` | a winch (kinetics): how far down its load is, 0 at the top of its travel, 1 at the bottom. Sent only while the machines are armed, within the light's `hoistLimits` (a `raw` number on its channel is never sent); safe, or armed with nothing setting it, the last value sent armed is held (never 0, its top). A winch's motion enable is an `enable` channel; it stays shut while the winch's place isn't known |
| `effectMacro` | the light's own built-in effects (programs, chases); each is a range of the channel, picked by its place in the list |
| `effectSpeed` | the speed of those effects |
| `colorMacro` | the light's own colour programs (fades, chases); each is a range, picked like the effects |
| `fog`, `haze`, `fan` | atmospherics |
| `confetti`, `bubbles`, `flame`, `sparks`, `co2` | effect machines: confetti fires once each time it rises past 50 %, the others run while above 0 |
| `enable` | a machine's own safety / enable channel: the app drives it, on (its range labelled enable, armed, active or ready, else 255) while the machines are armed, 0 while they're safe; a look or a raw value never sets it |
| `speed` | pan/tilt or internal effect speed |
| `control` | reset, lamp, internal programs: sits at its `default`, never driven |
| `raw` | anything else: its `default`, unless a cue sets it by channel index |

A mode can say where its pixels are, `layout`, for a ring or a matrix. Cells count in data order.
It has to fit the mode's pixels, or it's dropped with a note and the light runs as a strip.

```json
{ "kind": "rings", "rings": [60, 48, 40, 32, 24, 16, 12, 8, 1], "ccw": false, "turn": 0 }
{ "kind": "matrix", "cols": 16, "rows": 16, "zigzag": true, "vertical": false, "from": "tl" }
```

`rings`: LEDs per ring, in the order the data runs through them. A bigger ring is further out, the
steps between rings are even, each ring starts at the top and runs clockwise (`ccw` the other way;
`turn` degrees turns it all). `matrix`: lines of LEDs from the corner `from` (`tl`, `tr`, `bl`, `br`,
top left unless it says), along the rows (`vertical`: along the columns); `zigzag`: every second
line runs back.

A mode with more than 512 channels runs on over the following universes from its `universe` and
`address`, with whole pixels on each: `floor(room / size) * size` channels, where `size` is its
channels per cell (3: 170 pixels a universe, 4: 128).

- `default` is the DMX value sent when nothing drives the channel. `cell` (0-based) marks which
  pixel of a multi-cell fixture a channel belongs to. `span: [from, to]` is the DMX range the
  attribute moves through when it only owns part of the channel (an iris on 0..191 with effects
  above): value 0 sends `from`, 1 sends `to`.

## Fixtures

```json
{ "id": "f1", "name": "PAR 1", "num": 1, "typeId": "gen-drgb", "mode": "4 ch",
  "universe": 0, "address": 1, "x": 0.25, "y": 0.1, "invertPan": false }
```

`x`, `y` place the fixture on the 2D stage (0 to 1, top left is 0,0). `mode` is the mode's name.
`num` is its number (a whole number from 1, each once), what the console and typed commands go by
("5 @ full"). It stays when other fixtures are added, deleted or moved in the list. A file without
numbers, or with a number used twice, gets them in list order after the highest one.

For the 3D stage (all optional; without them a fixture hangs on the nearest truss or stands on
the deck, by its kind, under its 2D place):

- `p3`: `{ "x", "y", "z" }` in metres, y up; the deck's top is at y 1.2, its middle at x 0, z 0;
  the audience is at +z. `x`, `y` (2D) follow it.
- `rot`: `{ "yaw", "pitch", "roll" }` in degrees, applied yaw (about up), then pitch, then roll.
  Its own up is where a standing moving head's base faces (and a fixed light's beam); front is +z.
  Hanging is `roll: 180`.
- `panOffset`, `tiltOffset`: degrees, where DMX 50 % really points (calibration). The pan and
  tilt range come from the fixture's own `panDeg`, `tiltDeg` when it has them, else from the
  type's `physical` (`panDeg`, `tiltDeg`; 540 and 270 if unknown). A head at tilt 50 % points
  straight along its base's up; pan 50 % tilts it towards its front.
- `panDeg`, `tiltDeg`: this light's own pan and tilt range in degrees (1 to 1080), for a type that
  doesn't say or says wrong. Optional.
- `beamDeg`: this light's own beam angle, `[narrowest, widest]` in degrees (0.5 to 180), over its
  type's `physical.beamDeg`. Optional.
- `hoistLimits`: a winch's soft limits, `[highest, lowest]` as parts of its travel (0 the top, 1 the
  bottom): whatever a cue says, its `hoist` is sent within them. Optional (none: its whole travel);
  anything that isn't two numbers from 0 to 1 is left out with a note.
- `swapPanTilt`: `true` sends what a cue has as pan to the light's tilt channel and tilt to its
  pan channel. `invertPan` / `invertTilt` and the offsets are the motors' own (after the swap).
  Optional, default `false`.
- `panReversed`, `tiltReversed`: `true` when this light's pan (tilt) turns the other way round
  from what its type says. Only the model follows it (the 3D stage, Aim, the mounting picture: the
  range counts backwards); the DMX is the same. `invertPan` / `invertTilt` turn what goes out
  round instead, and the model with it. Optional, default `false`.
- `uid`: the real light this fixture is, its RDM UID (`"MMMM:DDDDDDDD"`, the maker's ESTA id and
  the light's own number, hex). Set when the fixture was patched from the rig or matched to a light
  found with RDM; the rig check follows the light by it wherever its address goes. Optional.
- `led`: how a pixel light's LEDs really light, set by hand: `{ "gamma": 2.2, "bright": 150, "maxMa":
  500, "maPerCh": 20, "idleMa": 1 }`, any of them (gamma 1 to 4, brightness 0 to 255 as on a box's
  pixel port, the power cap in mA with 0 for none, mA per channel at full and per dark pixel). Only
  for the stage pictures: the DMX is the same. Unset: what the box playing it says about its port,
  else a port as it comes (2.2, 255, no cap, 20, 1). Optional.
- `layout`: a ring or a matrix wired or hung differently from its type, the same shape as a mode's
  `layout` (below the channel list above). It counts only when it has as many pixels as the type's
  layout; one that doesn't is ignored and the type's is used. Optional, set by the light's LEDs tab.

## Groups

```json
{ "id": "g1", "name": "Front", "fixtures": ["f1", "f2", "f3"], "auto": false }
```

The order of `fixtures` is the order effects run in. `auto: true` marks groups the app made from
the patch (it may rebuild them). `cells` (optional, numbers from 0) makes it a group of some cells
of its lights ("Rim": `[0, 1, ... 59]` on discs): selecting it picks those cells, and an effect on
the group (without `cells` of its own) runs on just them, in this order.

## Values

The state of one fixture. Every field is optional: a missing field means "not touched".

```json
{ "intensity": 0.8, "color": { "r": 1, "g": 0.5, "b": 0 }, "white": 0, "pan": 0.5, "tilt": 0.3,
  "strobe": 0, "gobo": 0.5, "zoom": 1, "fog": 0, "raw": { "7": 200 } }
```

- Numeric attributes: `intensity`, `white`, `amber`, `uv`, `cct`, `pan`, `tilt`, `strobe`, `zoom`,
  `focus`, `iris`, `frost`, `prism`, `goboRotation`, `gobo`, `fog`, `haze`, `fan`, `speed`,
  `confetti`, `bubbles`, `flame`, `sparks`, `co2`, `gobo2`, `gobo2Rotation`, `prismRotation`,
  `animation`, `animationRotation`, `effectMacro`, `effectSpeed`, `colorMacro`, `goboShake`,
  `goboScroll`, `gobo2Shake`, `gobo2Scroll`, `panRotation`, `tiltRotation`, `roll`, `rollRotation`,
  `hoist`.
- `gobo`, `gobo2`, `effectMacro` and `colorMacro` pick a slot by its position in the channel's slot
  list (0 = first, 1 = last; a channel without ranges takes it as a plain level). They jump to the
  new slot when a fade starts, they don't fade through the ones in between.
- `goboShake` / `gobo2Shake` (0..1: 0 still, then how fast) and `goboScroll` / `gobo2Scroll`
  (-1..1: counter-clockwise .. clockwise, 0 not running, the only attributes below 0) are a gobo
  wheel's own functions: the gobo on it shaking, and the whole wheel running round through its
  gobos. They go out on the wheel channel's other ranges (a range named "Shake 3 ..." for the third
  slot, counting Open; "... rotation CW / CCW ..." for running round; "fast..slow" in the name
  turns the speed round); a channel without such ranges just shows the slot. They jump like the
  slots. (Added in 1.2.0; an older reader leaves them out.)
- `raw` sets channels by their index in the fixture's mode (as a string key) to a DMX value.
- `cells` sets single cells of a fixture made of cells (a pixel bar, a ring, each LED of a pixel
  head: the channels with a `cell`), by cell index from 0 (as a string key). A cell takes
  `intensity`, `color`, `white`, `amber` and `uv` (values or preset references, like the fixture's
  own), and on a fixture whose cells are heads (a moving bar: `pan` or `tilt` channels with a
  `cell`) also `pan` and `tilt`, where that head points (a `tilt` for the whole bar tilts every
  head, as `color` does); on one whose cells are winches (`hoist` channels with a `cell`), `hoist`.
  A position preset of a moving bar keeps each head's own `pan` / `tilt` as `cells` in its values
  (or its `perFixture` entry); a cue referring to the preset's `pan` or `tilt` gets them too. What a cell doesn't set, it takes from the fixture's own values, so
  `{ "intensity": 0, "cells": { "0": { "intensity": 1 } } }` lights only the first cell and
  `{ "color": { "preset": "p-blue" }, "cells": { "3": { "color": { "preset": "p-red" } } } }` makes
  cell 3 red and every other cell blue.
  - In a play, cues add up cell by cell like everything else: a later cue that sets cell 5 keeps
    the cell 2 an earlier one set. A later cue that sets a fixture's own colour (or level) for
    the whole light takes the cells with it (all blue means every cell blue).
  - Intensity is highest-takes-precedence per cell across lists, like the fixture's own: a list
    that doesn't name cells lights all of them at its level.
  - Effects on cells (a pixel chase) run on top of what the cues set.
  - Cell numbers past the fixture's cells are kept but do nothing.
- Any attribute can instead hold a preset reference: `"color": { "preset": "p-warm" }`.
- How a colour reaches a fixture is the reader's job (the app does: RGB direct; white extracted
  onto a white emitter when `white` isn't set; CMY inverted; colour wheel nearest slot; on a
  fixture that only has warm/cool white or a colour temperature channel, a whitish colour sets the
  temperature (warm white 0, white 0.5, cool white 1) when `cct` isn't set, and a real colour
  leaves it alone. A warm/cool pair with no `cct` runs both whites at full).

## Presets

```json
{ "id": "p-warm", "name": "Warm white", "kind": "color",
  "values": { "color": { "r": 1, "g": 0.78, "b": 0.5 } },
  "perFixture": { "f7": { "color": { "r": 1, "g": 0.7, "b": 0.45 } } } }
```

`kind` is `color`, `position`, `beam` or `intensity`. `values` apply to every fixture that has the
attribute; `perFixture` overrides them per fixture (positions usually live there). Presets don't
reference other presets.

## Cue lists

Everything that plays is a cue list: a scene is a list with one cue, a chase is a looping list
whose cues advance on their own, a theatre show is a list you step through with GO.

```json
{
  "id": "l1", "name": "Show", "end": "stop",
  "priority": "normal", "releaseTime": 2, "restart": "first",
  "cues": [
    { "id": "c1", "name": "Opening", "fade": 3, "fadeOut": 1, "delay": 0,
      "advance": { "mode": "manual" },
      "values": { "f1": { "intensity": 1, "color": { "preset": "p-warm" } } },
      "effects": ["e1"], "actions": [ { "do": "start", "list": "l2" } ], "note": "on the downbeat" }
  ]
}
```

- `end`: `stop` (stay on the last cue), `loop` (back to the first), `release` (fade out).
- `priority` (`low`, `normal`, `high`), `releaseTime` (seconds, default 2) and `restart` (`first`
  or `resume`) are optional.
- `play` (optional): `true` runs the list as a play (Record goes after the cue on stage, the live
  page shows the whole list), `false` as a set of moods; unset, a list with standby notes or cues
  that follow on is taken for a play.
- `bpm` (optional) is the song's tempo: when a set list makes this the list GO plays, the show
  tempo (`settings.bpm`) is set to it. Following the music overrides it while it's on.
- A cue's `values` lists only the fixtures it sets. Fixtures it doesn't list keep what the list had
  for them.
- `fade` is the crossfade time. `fadeOut` (intensity going down) and `delay` (before the fade
  starts) are optional. `times` (optional): `{ "color": 0, "position": 4, "beam": 2 }`, a fade of
  its own in seconds for colour (`color`, `cct`), position (`pan`, `tilt`) and the beam (zoom,
  focus, iris, frost, prism, gobos, animation and their rotations); one not given uses `fade`.
  Intensity and white, amber, UV keep `fade` / `fadeOut`.
- `num` (optional) is the cue's number as in a script (`20.5`). A list without numbers is numbered by
  position; once a cue went in between two others every cue carries its own, and readers should
  show `num` when present, the position (1, 2, 3) otherwise.
- `effects` lists effect ids that run while the cue is on stage. They fade in with the cue's fade,
  and fade out with the fade of the next cue that doesn't list them (or with the release).
- `advance` says what happens after the cue:

| mode | fields | next cue starts |
|---|---|---|
| `manual` | | on GO |
| `wait` | `time` | `time` seconds after this cue started |
| `follow` | `time` | `time` seconds after this cue's fade finished |
| `beats` | `beats` | after that many beats at `settings.bpm` |

- `actions` run when the cue starts:

| do | fields | |
|---|---|---|
| `start` | `list` | start that list (from its first cue) if it isn't running |
| `go` | `list` | GO on that list |
| `release` | `list` | fade that list out over its release time |
| `stop` | `list` | stop that list at once |
| `master` | `list`, `level` | set that list's level (0 to 1) |
| `blackout` | `on` | blackout on or off |
| `goto` | `list`, `cue` | play that cue (by id) of that list, whatever it was on (house lights up at the interval) |

How a cue plays depends on the list. In a play (`play: true`; a file without `play` is a play
when any cue has a `note` or a `follow` advance, decided once when it's opened) and in a list
that steps by itself (any `wait` or `beats` advance: a chase, a sequence) it fades to the look it
has when the list is played from the top (every cue up to it, each over what came before:
tracking). So GO, Back and a jump to any cue all land on the
same look, a light only a later cue set goes out when the list jumps back before it, and a GO
during a fade lets the lights the new cue doesn't mention finish where they were going. In a list
of looks (everything else: every cue advanced by hand) a cue sets the lights it names and leaves
the others as they are, whatever order the looks are played in. In both, `fog` and `haze` (and
the effect machines: `confetti`, `bubbles`, `flame`, `sparks`, `co2`) belong to the cue that sets
them: the next cue that doesn't set them takes them to 0.

`{ "do": "off" }` is a cue action too: every list fades out and effects stop (not a blackout,
the next look comes up).

## The timetable

`settings.marks` (optional): marks on the real stage (bits of tape) that moving heads are steered
onto to work out where they really hang (Focus and calibrate):
`[{ "id": "fl", "name": "Front left", "p": { "x": -3.6, "y": 1.2, "z": 2.5 } }]`, in metres in the 3D
stage's frame (x to the audience's right, y up from the floor, z towards the audience). Without it
the app suggests a rectangle on the deck and its middle. A mark that can't be read is left out with
a note.

`settings.schedule` (optional) runs actions by the clock while the app is open:

```json
"schedule": [ { "id": "s1", "at": "17:00", "do": { "do": "goto", "list": "l1", "cue": "c1" } },
              { "id": "s2", "at": "22:00", "days": [5, 6], "do": { "do": "goto", "list": "l1", "cue": "c4" } } ]
```

- `at`: local time `HH:MM`; `days` (optional): 0 = Sunday to 6 = Saturday, none = every day; `do`:
  a cue action (see above).
- `sun` (optional): `"set"` or `"rise"`: the entry comes at that day's sunset or sunrise instead,
  plus `offset` minutes (optional, -720 to 720; negative is before). It moves with the seasons and
  doesn't come on a day the sun doesn't set or rise there. `at` then holds the time it had on the
  day it was set, which is what an app that doesn't know `sun` plays.
- `settings.scheduleOff` (optional): `true` switches the timetable off. `settings.schedulePause`
  (optional): ms since 1970; until then nothing plays by the clock (entries that come meanwhile are
  skipped, not played later). Gone once it's over.
- `settings.place` (optional): `{ "lat": 52.52, "lon": 13.4, "name"?: "..." }`, where the show is
  (degrees, north and east positive), for the sun. Without it the app guesses from the device's
  time zone (its city). Sunrise and sunset are worked out in the app, no internet needed.
- Every few seconds the app plays the latest entry whose time came since it last looked (when it
  last looked is kept per show in the browser, so an app switched on again plays what came while
  it was off, even across midnight). Catching up puts the look on at once, without its fade or
  actions. An app that never looked before, with nothing playing, plays the latest entry that
  came at all (what should be on now). Entries that aren't well-formed are dropped on load.

## The 3D stage's venue

`settings.stage3d` (optional): `hideVenue: true` leaves out the built-in stage (band, truss, PA,
crowd); `model`: `{ "name", "store", "scale", "x", "y", "z", "yaw" }`, your own venue as a glTF
model kept in the browser that loaded it (`store` is its key there), placed in metres and turned
in degrees about up. Another browser asks for the file again. `room`: the built-in room, `"hall"`
(the big stage, also when it's left out) or `"pub"` (a small club or pub: a smaller deck under a
low ceiling with two little trusses), or one of the demos' rooms: `"club"` (a DJ on a 12 m stage
with truss on four towers and one over the dance floor), `"party"` (no stage: a 12 x 12 m square
of truss over the crowd on four legs, the DJ's table on the floor) or `"truss"` (an empty room with
one straight truss on two towers). Lights without a `p3` of their own go where their plan
position puts them in that room; a `p3` stays where it is in metres in either. Any other value is
dropped on load (the big stage).

`settings.bandName` (optional): the band's name, 1 to 60 characters, painted on the 3D stage's
banners, screens and kick drum. Left out, the banners show the band's own picture. Longer names
are cut to 60 on load, an empty one is dropped.

## The timeline

`timeline` (optional) is a song with things placed on it (seconds from its start):

```json
"timeline": { "duration": 594.3, "bpm": 126, "demo": true, "items": [
  { "id": "t1", "at": 0, "lane": "list:l1", "do": { "do": "goto", "list": "l1", "cue": "c1" } },
  { "id": "t2", "at": 30.5, "lane": "fx", "do": { "do": "effect", "effect": "e1", "on": true }, "len": 15.2 },
  { "id": "t3", "at": 91.4, "lane": "special", "do": { "do": "burst", "attr": "confetti", "seconds": 1 } } ] }
```

- `audio` (optional): `{ "name", "duration", "store" }`, a song kept in the browser that made the
  show (`store` is its key there); another browser asks for the file. `demo: true`: the app's own
  demo beat instead. Neither: silent, its own clock.
- A song picked from the app's demo songs also has `audio.catalog` (its id in the app's list, so
  another browser can download it again) and `audio.credit` (`"Title" by Artist, CC BY`: the
  credit its licence asks for, kept with the show). Both are text; anything else is dropped.
- `sections` (optional): the song's parts, `[{ "name": "Chorus", "at": 52.3, "energy": 0.9 }, ...]`:
  a name (1 to 40 characters), where it starts (seconds) and, if known, how hard it hits (0..1).
  Drawn on the ruler; things snap to them. A reader keeps the ones that make sense, in time order,
  one per moment. The demo beat has its own and needs none here.
- `bpm` and `offset` (seconds before the first beat) draw the grid things snap to.
- An item's `do` is a cue action (see above), `{ "do": "effect", "effect", "on" }` (with `len`: it
  runs that long), or `{ "do": "burst", "attr", "seconds" }`: the effect machines with that channel
  (`confetti`, `flame`, `sparks`, `co2`, `bubbles`), the fog machines (`fog`), or every light
  (`strobe`, `blinder`) for that long (30 s at most). `lane` says which track it's drawn on
  (`list:<id>`, `fx`, `special`).
- A reader that plays the show from a point puts each list on the latest cue placed before it,
  runs the effects whose bars cover it, and keeps the blackout as the items before it left it.
- `name` (optional, up to 80 characters): what the song is called in the set list. Without one
  the app shows its file's name (or "Demo beat", or "Song 2").
- `lead` and `tail` (optional, seconds, 0 to 600 each; none when left out): time for the show
  before the song starts (an intro, the walk-on) and after it ends (the cheer, the house lights).
  The song keeps its own clock: it starts at 0 and ends at `duration`, so things before it have
  times below 0 (down to `-lead`) and things after it times past `duration` (up to
  `duration + tail`). Played from the start, the show begins at `-lead`; it's over at
  `duration + tail`. A reader leaves out items before `-lead` (a file without `lead`: anything
  below 0, as before). `sections`, `offset` and the beat grid are the song's: they stay at 0 or later.
- `crowd` (optional): the crowd's sound, in time order, on a track of its own:

  ```json
  "crowd": [
    { "id": "k1", "at": -32, "do": { "do": "crowd", "mood": "chatter", "level": 0.55 } },
    { "id": "k2", "at": -18, "do": { "do": "crowd", "mood": "cheer", "level": 0.6 }, "len": 4 },
    { "id": "k3", "at": 0, "do": { "do": "cheer", "level": 1 }, "len": 4 } ]
  ```

  `{ "do": "crowd", "mood", "level" }`: from `at` on the crowd chats while it waits (`chatter`)
  or cheers (`cheer`), this loud (0..1; a `cheer` at 0 is a quiet crowd), getting there over `len`
  seconds (0 to 60; left out: at once) from wherever it was. An older file's `clap` (clapping along
  on the beat, gone since it sounded ugly) is read as `cheer` at a third of its level. `{ "do": "cheer", "level" }`: a cheer that swells up and dies away over its `len` (at most
  30 s; 4 when it can't be read). A reader drops moments it can't read (an unknown mood, a level
  that isn't a number, an id used twice, before `-lead`) and brings a level outside 0..1 inside.
  It's sound only: nothing goes out to the lights.

## The set list

A show can hold the songs of a whole gig, in the order they're played. `timeline` is always the
song that's up (the one the Timeline screen shows and Play plays); `setlist` (optional) holds the
others around it. The set in order is `before`, then `timeline`, then `after`:

```json
"timeline": { "name": "Whiskey", "duration": 200.1, "bpm": 126, "offset": 0.98, "items": [ ... ] },
"setlist": {
  "before": [ { "name": "Ragazzi", "duration": 190.5, "bpm": 155.8, "items": [ ... ] } ],
  "after": [ { "name": "Going To Hell", "duration": 211.5, "bpm": 180, "items": [ ... ] } ],
  "between": { "list": "l1", "cue": "l1c1" },
  "countIn": 1
}
```

- Every song in `before` and `after` is a timeline like the one above (its own song, tempo,
  parts and items). The patch, cue lists, effects and pages are the whole set's.
- `between` (optional): the cue a song that plays to its end goes to (a look for talking between
  songs). Without it the last look of the song stays.
- `countIn` (optional): bars of clicks (0 to 2) before a song played from its start. Without it,
  Play from the start begins a beat before the song's first downbeat (`offset`).
- A file without `setlist` is a set of one. A reader that doesn't know `setlist` keeps it and plays
  the song that's up. Songs that can't be read are left out; a file with songs in `setlist` but no
  `timeline` gets the first of `after` (or the last of `before`) as the song that's up.
- Going to another song is not another show: a reader keeps what's playing, and puts each list
  the new song plays on the first cue placed for it, as a jump (its machines stay quiet).

## Locking for the service

`settings.lockPin` (optional): digits that unlock a show locked for the service (staff-proofing,
not security: anyone with the file can read it). `settings.lockPage`: the live page it was locked
on, the only one shown while locked. A page's `locked` is the lock itself; a reader that imports a
file should open it unlocked. A page with `"go": false` (a staff page of looks) shows no GO or Back:
its looks are tapped, not stepped through.

## Recording

`settings.recordChanges` (optional, `true`): Record and Update keep only what the programmer
holds (a play tracks through); without it each touched fixture goes into the cue with its whole
look.

## The console's MIDI controls

`settings.consoleMidi` (optional): the console's faders on a MIDI controller, a list of
`{ "to": "list:l1", "midi": { "kind": "cc", "ch": 1, "num": 7 } }`. `to` is `grand` (the grand
master), `list:<id>` (a cue list's fader), `group:<id>` (a group's master) or `light:<id>` (a
light's level); `kind` is `cc` or `note`, `ch` 1 to 16, `num` 0 to 127. One control moves one
fader. They work in every view, not just on the console.

## How several cue lists combine (for readers that play shows)

- Intensity: the highest value wins across running lists (HTP), each scaled by its list level.
- Everything else: the list that moved last wins (LTP), lists with a higher `priority` first.
- Releasing a list fades its contribution out over `releaseTime`, back to what's underneath.
- The grand master and blackout apply last.

## Effects

An effect runs one of the built-in shapes over a group (or a list of fixtures), in their order.
Every effect is a function of where it is in its cycle and which element it looks at, so two
readers that follow this section produce the same output.

```json
{ "id": "e1", "name": "Rainbow on the bars", "kind": "rainbow", "group": "g2",
  "params": { "speed": 8, "tempo": true, "spread": 1, "colors": [ { "r": 1, "g": 0, "b": 0 } ] } }
```

- `group` is a group id; without one, `fixtures` (an ordered list of fixture ids) says where it
  runs.
- `cells` (optional, numbers from 0): on lights made of cells, the effect runs on just these, in
  this order (a chase round a ring's rim, `[0, 1, ... 59]`), and the light's other cells keep what
  the cues give them. Without it a pixel effect runs over every cell. Lights without cells aren't
  affected by it.
- `params` holds the knobs. Every knob is optional; a missing one takes the effect's default
  (below), and an unknown one is kept.

| knob | type | default | meaning |
|---|---|---|---|
| `speed` | 0.05..3600 | per effect | beats per cycle when `tempo` is on, seconds per cycle when off |
| `tempo` | bool | `true` | follow `settings.bpm` |
| `size` | 0..1 | per effect | how deep / how far (moves: fraction of the full pan/tilt range) |
| `spread` | 0..1 | per effect | 0 = every element together, 1 = spread evenly over one cycle |
| `direction` | string | `forward` | `forward`, `backward`, `bounce`, `in` (outside to centre), `out`, `random` |
| `blocks` | int 1..512 | 1 | neighbours that move together |
| `width` | 0..1 | 0 | how much of a cycle a step is on; 0 = one element's share |
| `colors` | Colour[] | per effect | the palette colour effects use |
| `low`, `high` | 0..1 | 0, 1 | the intensity range |
| `lightUp` | bool | `true` | colour and move effects also switch their lights on at `level`; a light a cue or the programmer sets keeps that level, and as its cue list fades out the effect takes over |
| `level` | 0..1 | 1 | the effect's own fader |
| `contrast` | number | `0` | -1 to 1: an S-curve on the element's level between `low` and `high`. Up: dim gets dimmer, bright gets brighter. Down: softer. Dark and full stay where they are. Pixel and intensity effects |
| `pixels` | bool | `true` | a multi-cell fixture (pixel bar) runs as one element per cell |
| `order` | string | `list` | which light comes first: `list` (the group's order), `x` (left to right on the stage), `y` (back to front), `centre` (nearest the middle of the lights first) |
| `formula` | string | `hsv(x - c, 1, 1)` | the `formula` effect's expression (see "Your own effects" below), at most 500 characters |
| `picture` | string | `""` | the `picture` effect's picture or animation, packed (below); empty: the built-in sample |
| `mapping` | string | `auto` | how a picture lies on the lights: `line`, `wall` or `auto` (below) |
| `text` | string | `LUXDMX` | the `scrollText` effect's words, at most 200 characters: capitals, numbers and the usual signs |
| `script` | string | `""` | the `script` effect (an add-on): its program and knobs as JSON, `{ "id", "name", "frame", "pixel", "params", "uses", "speed", "defaults" }` (ADDONS.md; `speed`: the Speed its `t` runs at 1:1; `defaults`: its own starting knobs). Knob ids are names like `glow` (a letter, then letters and digits, never one every object has such as `toString`); a script with any other is left dark |
| `vals` | object | `{}` | the `script` effect's own knobs by id: numbers, a choice's value, true / false, colours as `#rrggbb` |

**Elements and phase.** The elements are the target fixtures in order; with `pixels`, a fixture
with cells becomes one element per cell. Moves only use fixtures with pan/tilt, colour effects only
fixtures that do colour. For element `i` of `n`:

1. `direction` reorders: `random` shuffles once (stable per effect), `in` folds the list so both
   ends come first (`k = min(i, n-1-i)`, `m = ceil(n/2)`), `out` is `in` reversed, `backward`
   reverses. `blocks` then divides: `k = floor(k / blocks)`, `m = ceil(m / blocks)`.
2. The effect's cycle position `c` is the fractional part of `t / speed` (`t` in beats or seconds
   since the effect started). With `bounce`, `c` runs there and back: `tri(c) * (m-1)/m`.
3. The element's phase is `frac(c - spread * k / m)`.

**The built-in effects** (`kind`), what they compute from the phase:

| kind | category | default speed / spread | output |
|---|---|---|---|
| `circle` | move | 4 / 0 | pan `0.5·size·sin(2πφ)`, tilt `0.5·size·cos(2πφ)` |
| `figure8` | move | 8 / 0 | pan `0.5·size·sin(2πφ)`, tilt `0.25·size·sin(4πφ)` |
| `pan` | move | 4 / 0 | pan `0.5·size·sin(2πφ)` |
| `tilt` | move | 2 / 0.5 | tilt `0.5·size·sin(2πφ)` |
| `fan` | move | 8 / 0 | pan `(k/(m-1) - 0.5)·size·sine(c)` |
| `cross` | move | 4 / 0 | pan `±0.5·size·sin(2πc)`, left half against right half |
| `swing` | move | 4 / 0.25 | pan as `pan`, tilt dips `-0.2·size·|cos(2πφ)|` |
| `ballyhoo` | move | 8 / 1, random | two sines per axis with a random offset per element |
| `rainbow` | colour | 8 / 1 | hue = φ, saturation = size |
| `colorChase` | colour | 4 / 1 | `colors[floor(φ·len)]` |
| `colorFade`, `gradient` | colour | 16 / 0, 16 / 0.5 | smooth along `colors` at φ |
| `random` | colour | 1 / 0 | a random palette colour per element per cycle |
| `police` | colour | 1 / 0 | first half `colors[0]`, second half `colors[1]`, double flashes |
| `fire` | colour | 2 s / 1 | palette and intensity follow smooth noise |
| `ocean` | colour | 6 s / 0.7 | palette with noise, intensity `sine(φ)` |
| `chase`, `pingpong` | intensity | 2 / 1 | `high` while φ < width (default `1/m`), else `low`; `pingpong` bounces |
| `pulse`, `wave` | intensity | 2 / 0, 4 / 1 | `low + (high-low)·sine(φ)` |
| `alternate` | intensity | 1 / 0 | odd and even elements take turns |
| `fill` | intensity | 4 | elements light up in order, then go dark in order |
| `meteor` | intensity | 2 | a head with a tail of length `width` (default 0.35) |
| `sparkle` | intensity | 0.5 / 0 | random elements flash; `size` is the share that does |
| `strobe` | intensity | 0.25 / 0 | `high` while φ < width (default 0.2) |
| `lightning` | intensity | 3 s / 0 | random white double flashes over the look (it stays as it is between them), `size` is how likely, `high` how bright |
| `candle` | intensity | 1 s / 0 | gentle noise between `low` (0.55) and `high` |
| `sound` | intensity | `low` 0.1 | `low + (high-low)·loudness·size`: pulses with the music (with the microphone; without it loudness counts as full, a plain look) |
| `vu` | intensity | default direction `out` | a level meter: element k of m is at `high` while `(k+0.5)/m ≤ loudness·(0.4+size)`, else at `low` |

`sine(x) = 0.5 - 0.5·cos(2πx)`, `tri(x)` goes 0 → 1 → 0 over a cycle. The exact noise and random
functions are in `src/engine/effects.ts`; a reader may use its own, those effects are random
by nature.

**The pixel shows** (category pixel, after WLED's and FastLED's classics) colour and light their
elements together, like `formula` below: the colour at full goes to `color`, the brightness to
intensity (scaled into `low`..`high`). An unlit element keeps a colour of the palette, so a raised
`low` shows it dimly. Pixel 0 of a light is its bottom: shows that rise or fall (`fire2012`,
`bouncing`, `ripple`, `fireworks`, `matrix`, `rain`, `popcorn`, `meteorRain`) run up each light of
a group on its own when the lights have several cells (`backward` turns them round, `in` and `out`
mirror them), and along the group when every light is a single cell. Their "speed" scales time
(at the default it moves like the original); `size` is the one extra knob each has:

| kind | name | default speed | `size` sets | default `colors` |
|---|---|---|---|---|
| `theater` | Theater chase | 1/4 beat a step | the gap (2 to 6) | Rainbow |
| `fire2012` | Flames | 1 s | how high | Heat |
| `twinkle` | Twinkles | 4 s | the share twinkling | Party |
| `juggle` | Juggle | 8 s | the trails | Rainbow |
| `sinelon` | Sinelon | 4 s a swing | the trail | Rainbow |
| `pride` | Colour waves | 10 s | | Rainbow |
| `bouncing` | Bouncing balls | 1 s | how many balls (1 to 8) | Candy |
| `ripple` | Ripples | 1 s | how many drops | Ocean |
| `fireworks` | Fireworks | 1 s | how often | Rainbow |
| `matrix` | Matrix rain | 1 s | how many drops | Matrix |
| `aurora` | Aurora | 1 s | how many curtains | Aurora |
| `plasma` | Plasma | 1 s | 1 closes the dark gaps | Sunset |
| `glitter` | Rainbow with glitter | 5 s | how much glitter | Rainbow |
| `heartbeat` | Heartbeat | 1.1 s a beat | how long it glows | two reds |
| `scanner` | Dual scanner | 4 beats there and back | the trails | red, blue |
| `meteorRain` | Meteor rain | 4 beats a pass | the tail | violet to white |
| `lightning1d` | Lightning along the strip | 1 s | how often | white, pale blue |
| `rain` | Rain drips | 1 s | how many drops | two blues |
| `popcorn` | Popcorn | 1 s | how many kernels | Party |
| `gradientChase` | Gradient chase | 2 beats a band | (`spread` sets the bands, 1 = 3) | Neon |

Like `fire` and `sparkle`, most are random by nature: the code in `src/engine/pixels.ts` is the
reference, and a reader may use its own randomness.

**Rings and matrices** (category pixel): `eye`, `reactor`, `supernova`, `radar`, `blackHole`, `warp`,
`galaxy`, `hypno`, `mandala`, `tunnel`, `plasmaClouds`, `lavaLamp`, `campfire`, `codeRain`, `raindrops`,
`skyRockets`, `kickRings`, `bigHeart`, `equaliser`, `scrollText`, `wiringTest`. They work from each
pixel's place on its light's `layout` (a line through the middle on a light without one); `spread`
shifts one light of the group against the next, in rounds. The code in `src/engine/shapes.ts` is
the reference.

**Your own effects: `formula` and `picture`** (category pixel). Both colour and light their
elements together. Their output is a colour with its brightness: the colour at full goes to
`color`, its brightest channel to intensity (scaled into `low`..`high`), so a light with a dimmer
and one without show the same.

`formula` (default speed 4) evaluates `params.formula` once per element. It is a small expression
language read by the app's own parser, never run as code: a show file can't do anything with it
but light pixels. A reader that can't read a formula leaves those elements dark.

- Numbers (`1`, `0.5`, `.5`, `2e3`), `( )`, the operators `+ - * / % ^` (`%` is the floored
  remainder, `-0.25 % 1` is `0.75`; `^` is a power, right to left, before a leading minus),
  comparisons `< <= > >= == !=` and `&& || !` (they give 1 or 0), and `a ? b : c`.
- Names: `x` (the element's place along the group, 0..1), `u` (along its own light), `i`, `n`
  (`k` and `m` above), `row`, `rows` (which light, how many), `t` (seconds since the effect
  started), `beat` (beats since then), `c` (the cycle position), `phase` (the element's phase),
  `bass` (the loudness, 0..1), `rnd` (a random number per element that stays), `size` (the knob),
  `pi`, `tau`.
- Functions: `sin cos tan` (radians); `wave(v)` = `sine(v)`, `triangle(v)` = `tri(frac(v))`,
  `square(v, on = 0.5)` = 1 while `frac(v) < on` (all in turns: 1.0 is once round); `abs floor ceil
  frac sqrt exp log`, `pow(a, b)`, `min(…)`, `max(…)` (2 to 6 values), `clamp(v, lo = 0, hi = 1)`,
  `mix(a, b, t)`, `step(edge, v)`, `smoothstep(a, b, v)`, `noise(x, y = 0)` (smooth value noise
  0..1), `random(a, b = 0)` (a stable random 0..1 for those numbers); `hsv(h, s, v)`,
  `rgb(r, g, b)` and `pal(p)` (the palette at `p`, as in `along`) make colours.
- A number result is a brightness, in the palette colour at `x`. A colour result sets colour and
  brightness (each channel kept in 0..1, NaN counts as 0). Maths on a colour works channel by
  channel (`hsv(x, 1, 1) * 0.5`); where `? :` mixes a colour and a number, the number is that
  brightness in the palette colour at `x`.
- Every function gives a real number whatever it gets (`log(0)`, `sqrt(-1)`, `pow(10, 400)`): NaN
  counts as 0, endless as ±1e9 (`pal(1 / x)` at `x = 0` is the palette's start). A result of the
  operators that is endless (`1 / 0`) counts as full brightness, NaN as dark.
- Limits: 500 characters, 24 brackets (or signs) inside each other, 250 parts.

`script` (an add-on, made from a `.luxfx` package: ADDONS.md) runs `params.script`: its `frame`
part once a frame, its `pixel` part once per element, in the luxfx-1 language (the formula's,
with `let`, `fn`, `sum` / `maxof` / `minof` and the names of a ring or a matrix), its own knobs
from `params.vals`. Its `t` is the seconds since it started times `script.speed / params.speed`
(so Speed works on it); `c` is the round as for every effect. A program that doesn't read, or
that does too much in a frame, stops that effect with a note; the rest of the frame goes on. The
show keeps the whole program, so it plays wherever the show is opened.

`picture` (default 8 s, tempo off) shows `params.picture`, packed as text:

```
pic1:<w>x<h>:<ms of frame 1>,<ms of frame 2>,...:<base64>
```

`w` x `h` is at most 160 x 120, at most 64 frames (a still picture has one, with time `0`; an
animation's frames last at least 20 ms each). The base64 is a zlib stream (RFC 1950) of the frames'
RGB bytes, row by row, one frame after the other, filtered: in the first frame every byte is
stored as its difference to the byte 3 before (the same colour of the pixel before; the first
pixel as it is), in every later frame as its difference to the same byte of the frame before, all
mod 256. See-through parts of a GIF are black (off). The app keeps a packed picture under about
400 KB by scaling it down.

The picture's columns lie along the lights, pixel `cx = x·(w-1)` (bilinear between pixels). The
round position `r = frac(t / speed)` (with `bounce`, `tri(r)`) picks the moment:

- `auto` on a ring, a disc or a matrix: each LED shows the picture where it is: across
  `(sx / sw + 1) / 2`, down `(1 - sy / sh) / 2` (`sw`, `sh`: how far the light's LEDs reach, 1 and 1
  on a ring, 1 and 7/31 on a 32 x 8 panel), over the middle of the picture cut to the light's own
  shape (what sticks out over the sides is cropped, nothing stays black).
- `line`: the lights are one line across the picture. A still scrolls through its rows, one pass
  per round: row `r·h`, the last row blending into the first (with `bounce`, row `tri(r)·(h-1)`).
  An animation plays its frames over a round (frame times scaled to fill it, so `speed` set to the
  frames' total plays it at its own pace) and shows its middle row, `(h-1)/2`.
- `wall`: one picture row per light: light `row` of `rows` shows row `row/(rows-1)·(h-1)`, its
  cells along that row by `u`. A still stands still; an animation plays as on a line.
- `auto`: `wall` when the group is several lights and has more elements than lights (pixel bars),
  `line` otherwise.

**Mixing.** Effects run after the cue lists and the programmer: moves add their offsets to pan
and tilt, colour effects blend the colour, intensity effects set intensity (all by the effect's
weight × `level`). Intensity effects apply last. A cue's effects fade with the cue; effects
started by hand fade in and out in 0.4 s.

## Pages

Live pages are grids of controls for playing the show.

```json
{ "id": "pg1", "name": "Songs", "locked": false, "widgets": [
  { "id": "w1", "type": "cue", "list": "l1", "cue": "c3", "key": "1" },
  { "id": "w2", "type": "list", "list": "l2", "action": "toggle", "label": "Fog timer", "color": "#8a94a3" },
  { "id": "w3", "type": "fog", "fixtures": ["f9"], "level": 1, "burst": 3, "max": 10 }
] }
```

Every widget has `id`, `type` and optional `label`, `color` (`#rrggbb`), `size` (1 or 2 cells
wide), `key` (one keyboard key that presses it) and `midi` (a MIDI control that presses or moves
it: `{ "kind": "note" | "cc", "ch": 1..16, "num": 0..127 }`; a note or a control above half
presses a button, a control moves a fader). By `type`:

| type | fields | what it does |
|---|---|---|
| `list` | `list`, `action` | `go`, `back`, `toggle`, `flash` (on while held), `release`, `solo` (start it, release the other lists that aren't `high` priority), `select` (GO and Space play this list from now on: a song in a set list) |
| `cue` | `list`, `cue` | go straight to that cue |
| `effect` | `effect`, `action` | `toggle` or `flash` an effect by hand |
| `fader` | `target`, `ref` | `grand` master, `bpm`, `list` level or `effect` level (`ref` is its id) |
| `fog` | `fixtures`, `level`, `burst`, `max` | fog while held, switched off after `max` seconds even if still held |
| `group` | `group`, `level`, `strobe`, `white` | flash a group while held (optionally strobing; `white`: full white, a blinder) |
| `cuelist` | `list` | the whole list as rows (number, name, fade, what follows, note), the cue on stage lit; holding a row jumps to it |
| `song` | `do` | the set list: `play` (play or pause the song that's up), `next` (the next song up, stopped at its start, its first look on), `part` (on the next beat, a jump to the next part of the song). A `do` that isn't one of these: left out |
| `special` | `do`, `seconds` | `blackout`, `releaseAll`, `tap`, `stopEffects`, `blinder` (every light full white while held), `drop` (the blinder, strobes going and a fog burst, while held), `fadeOut` (the grand master to 0 over `seconds`, default 5, and back on the next press) |
| `label` | | a heading across the page |

A show without pages gets a page generated from its contents; it's only written to the file once
someone edits it.
