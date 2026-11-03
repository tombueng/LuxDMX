# Plan

What gets built, in which order, and how each step is proven. VISION.md says why. Every
phase ends with tests that run in CI against a fake LuxDMX (`test/fake-luxdmx.mjs`, the real
bridge page, frame-by-frame timestamps) plus a run on a real box (WT32 on the bench). A phase
isn't done until both pass.

## The model

Six things, nothing else at the top level:

1. **Fixture types** (what the channels mean) and **fixtures** (a type at an address, on the stage).
2. **Groups**: ordered selections. Order matters for effects.
3. **Presets**: named colour / position / beam / intensity values. By reference: a cue that uses
   "Warm White" follows when you change it. Matched by attribute, so "Red" works on an RGB PAR, an
   RGBW bar and a colour-wheel mover alike (nearest slot).
4. **Cue lists**: the only thing that plays. A scene is a list with one cue, a chase is a list that
   loops with step times, a theatre show is a list with manual GOs. Several run at once.
5. **Effects**: a waveform or colour sequence on a group (speed in beats, size, spread, direction,
   mirror, blocks). Playable on their own from a button, or stored in a cue.
6. **Pages**: the live surface. Buttons, solo rows, faders, pickers, fog, tap, masters.

### Values

A fixture's state is attributes, never raw channels: intensity, colour (as a colour, resolved per
fixture: RGB, RGBW, RGBA, RGBWAUV, CMY, colour wheel), pan/tilt, beam (gobo, zoom, focus, prism,
frost), strobe/shutter, fog/haze, speed, and raw channels for anything else. Each attribute holds
either a value or a preset reference.

### Cues

- A cue stores a full look for the fixtures it touches (cue-only, no tracking). Fixtures it doesn't
  touch are left alone.
- Timing: fade, and behind "advanced" a separate fade out and a delay.
- Advance: manual GO, after X s, when the fade is done (follow), after N beats.
- End of list: loop, stop on the last cue, or release.
- Actions, picked from a list: start / stop / release another cue list, set a master, blackout.
  That's the whole "macro" system (fog timers, "house to 10 % then start the preshow").

### Playing several things at once

- Intensity: highest wins across cue lists (HTP), scaled by each list's master, the group masters
  and the grand master.
- Everything else: the most recently started cue list wins (LTP). Advanced: priority low / normal /
  high per list (house lights, safety looks).
- Release fades back to what's underneath over the list's release time (default 2 s).
- The programmer (what you're editing) sits on top of everything.

### Effects

- Intensity waveforms: sine, ramp up, ramp down, square (with width), triangle, random, flicker.
- Colour: step through 2-4 colours or a theme, rainbow, gradient.
- Position: circle, figure eight, pan sweep, tilt sweep, fan, random (ballyhoo).
- Knobs every effect has: speed (beats, following the speed master), size, spread (0 = all
  together, 100 % = evenly across the group), direction (forward, backward, in, out, random),
  mirror. Advanced: blocks of N, width, base mode (relative to the cue or absolute).
- Built-ins with the names people know: chase, pulse, sparkle, strobe, wave, fill, meteor, fire,
  candle, lightning, colour chase, rainbow, gradient, circle, figure eight, ballyhoo, fan.
- Same engine everywhere: deterministic `f(t, i, n, params)`, so preview, playback and export match.

### Pages

- Widgets: button (target + action: go, back, toggle, flash, solo, release, blackout, tap), solo
  row (one of N looks), fader (cue list master, group master, grand master, speed, effect size),
  colour picker, position pad, fog (hold + timed burst with a hard max), clock, label.
- Modes: edit, play, locked (PIN), fullscreen. Widgets show live state (running, fading, holding).
- A fixed bar on every page: grand master, blackout, tap/BPM, speed ×2 ÷2.
- Touch first; the busking page is generated from the patch.
- Inputs: keyboard keys and Web MIDI (where the browser has it) with "move the control now" learn.

### Files

- Our format: JSON, `format: "luxdmx-show"`, semver `formatVersion`, `minReaderVersion`,
  `requiredFeatures`, `extensions`; unknown fields are kept and written back; one migration per
  version; a JSON Schema and FORMAT.md that explain every field. Shows are self-contained (fixture
  types are embedded).
- Import: Open Fixture Library fixtures, QLC+ `.qxf` fixtures, QLC+ `.qxw` workspaces (fixtures,
  groups, scenes, chasers, sequences, EFX shapes onto our effects; the rest kept as raw XML so an
  export doesn't lose it).
- Export: QLC+ `.qxw` (fixtures, scenes, chasers), our format, CSV of channel values.

## Phases

Status 2026-10-27 morning: phases 1 to 8 done and tested (unit 87, e2e 47 on the fake box, 3 on
the WT32). QLC+ `.qxw` import/export done (CSV and a JSON Schema not yet). Phase 9: an independent
code review (24 findings) and UX review (top 10 plus ~30 more) came back overnight; the high and
medium code findings and most of the UX top 10 are fixed, each with a test. Also added beyond the
plan: command palette (Ctrl+K), shortcut sheet, MIDI learn, tablet and phone layouts, stage zoom,
undo toasts, a Worker clock so output keeps running in a background tab.

| # | Phase | Proof (fake box in CI, then the WT32) |
|---|---|---|
| 1 | **Foundation**: model v1, format (schema, migrations, unknown fields kept), undo/redo, engine rewrite (several cue lists, HTP/LTP, masters), FORMAT.md | unit: merge rules, fades, migrations, round trip with unknown fields. e2e: two lists at once, master scaling, undo |
| 2 | **Fixtures**: attribute set, generic library (incl. fog, strobe, RGBA, RGBWAUV, CCT, 16-bit mover, pixel bar), colour resolution (RGBW white extraction, CMY, nearest wheel slot), OFL search + import (build-time index, pinned commit), GDTF import (pro gear), QLC+ `.qxf` import, all-channels view with range labels, fixture editor, live channel wizard, address conflict warnings | unit: colour resolution, OFL and qxf parsing on real files. e2e: OFL fixture patched and driven; wizard pokes the right channel |
| 3 | **Presets and groups**: auto groups and presets on patch, by-reference presets, position presets, programmer v2 (beam, raw channels) | unit: preset resolution on mixed fixtures. e2e: change a preset, recorded cue follows on output |
| 4 | **Cue lists v2**: advance modes, loop/stop/release, actions, priority, release time, fog timer as a cue list | e2e with timestamps: follow and wait times, 3 s / 117 s style fog loop (shortened), actions start another list |
| 5 | **Effects**: engine, built-ins, knobs, effects in cues and on their own, live preview, BPM/tap | unit: waveforms, spread/mirror/blocks math. e2e: measured waveform period and phase spread on the fake box |
| 6 | **Pages**: widgets, modes, lock, fixed bar, generated busking page, keyboard + Web MIDI learn, mobile layout | e2e: every widget action, flash vs toggle, solo row, lock; phone viewport |
| 7 | **Content**: venue templates (band, DJ/party, theatre, church, cinema, bar), colour themes | e2e: each template loads and produces output |
| 8 | **Files**: QLC+ `.qxw` import/export, CSV, JSON Schema published | unit: round trips on real QLC+ sample workspaces. e2e: import a workspace and play it |
| 9 | **Review**: independent agents (code, UX/complexity, tests), fixes, user guide, full run on the WT32 | review findings closed, full e2e suite green on both |

### Later (needs firmware or a decision from Thomas)

- Show runs on the LuxDMX (player in the firmware, export format, upload), schedules with sunset.
  Spelled out below in "The show on the box".
- Publishing on GitHub Pages and the public bridge test (Chrome local network access, Firefox,
  Safari).
- The firmware side of the bridge as a PR (e2e spec, docs).
- Audio beat detection, music-reactive auto show, setlists, user effect scripts in a Worker,
  pixel matrix effects, OSC (needs the node to relay it).


## The show on the box (Thomas, 2026-10-28: "send a project to one LuxDMX controller so that it can play the show automatically and autonomously, plannable by schedule, cron, or triggered by hardware IO, network request")

Requirement, not built yet (needs firmware work and a go):

- **Send it**: the app renders what should run on its own (looks, cue lists, effects, a timeline
  show without its sound) into the box's own format (keyframes and changes per universe, DESIGN.md
  "Standalone playback"), as named items, and uploads it to one box over its bridge or HTTP. The box
  keeps it in flash (size per board, a checksum, a version) and says what it has.
- **Play it**: the box plays an item as its lowest-priority source. A console or Art-Net/sACN
  taking over wins (HTP/LTP as the box is set up); when they go away, the box does what it's set
  to: hold, go back to its own show, or dark.
- **Start it**:
  - by the clock: times and weekdays, dates, sunset/sunrise for a stored place, cron-style rules
    for the odd ones; time from NTP, an RTC where fitted, and a clear rule for a box without time;
  - by hardware: GPIO inputs (a button, a contact, a motion sensor) with debounce, each mapped to
    play, stop, next or a given item;
  - by the network: an HTTP request with a token, OSC, ArtTrigger;
  - at power on.
- **Safety**: confetti, flames, sparks and CO2 never fire from the box on their own unless that
  item was sent with "unattended machines allowed" (off unless set, per item); fog keeps its
  maximum on-time; an input can be an emergency stop (everything to its safe state, dark if set).
- **See and stop it**: the box's page lists its items, what plays now, what's next by the clock,
  and has Stop and Test; the app shows the same for each box and can switch the schedule off.
- **Tests**: export → upload → trigger by HTTP → measured frames on the fake box; firmware unit
  tests; on the WT32: the clock, a GPIO input and a network trigger, with the console taking over.

## UX overhaul (Thomas, 2026-10-26: "not appealing, lacks detail, can't move or modify things")

The first slices worked but looked like a form. What changes, across all phases:

- **Two modes in the top bar: Program and Live.** Program = build the show (patch, stage,
  programmer, cues). Live = big buttons and faders to play it. Hobbyists think in exactly these two.
- **Shows live in the browser**: a show manager (IndexedDB) with thumbnails, last change, counts;
  new (blank or from a template), open, duplicate, rename, delete, export, import. Autosave.
- **Every list item is a real object**: icon, live state, the important details at a glance,
  drag & drop to reorder, multi-select (click, Shift, Ctrl), cut / copy / paste / duplicate /
  delete with the usual keys, a context menu, and inline editing. That goes for fixtures, cues,
  groups, presets and effects alike. Copy/paste also works between shows (clipboard).
- **Cues are cards with a picture of the look**: a mini stage showing each fixture's colour and
  intensity at that cue, plus fade, advance and effect badges; "update from stage" re-records one.
- **The stage shows fixtures as what they are**: PAR, moving head with its beam (pan/tilt drawn),
  pixel bar with its cells, fog machine, strobe; labels and addresses on demand; select by group.
- **Effects with presets you can see**: every effect card animates a preview on a little row of
  fixtures; moving-head presets (circle, figure eight, fan, sweep, ballyhoo), colour and intensity
  presets (rainbow, colour chase, pulse, sparkle, fire, lightning, police, ocean...).
- **Explanations where they're needed**: every panel has a short "what is this" line and a ?
  with more, empty states say what to do next, a first-run guide walks through the first light.
- Every one of these gets an e2e test. Visual quality gets an independent UX review at the end.

## Pro gear

Hobbyist first is about the workflow, not the fixtures. Pro moving lights have to work fully: GDTF
import in phase 2 (pro manufacturers publish GDTF), multiple modes, 16-bit, CMY + colour wheels,
gobo wheels, shutter/strobe ranges, beam attributes, multi-cell fixtures, and an all-channels view
where every channel can be set through its labelled ranges. No hard universe limit: a show can
spread over several LuxDMX boxes. The e2e for phase 2 includes a real pro spot profile from OFL
and one from GDTF.

## Rethinking, pass 1 (against the research)

- *Cue lists only, no separate scene/chase objects.* Kept: one concept covers scene, chase, fog
  timer and theatre stack. The UI still says "scene" when a list has one cue, so nobody has to know.
- *Presets by reference.* Kept: it's the one pro feature QLC+ users ask for, and it makes a show
  editable. The rule stays simple: picking a preset stores the reference, touching the value by
  hand replaces it for that attribute only.
- *Tracking.* Out, per research; cue-only is what everyone understands.
- *Effects inside cues and on their own.* Both: bands busk effects from buttons, theatre stores
  them in cues.
- *Schedules.* Bars and cinemas need them, but a browser that has to stay open all night is no
  answer. Moved to "Later" together with playback on the node, where they belong.
- *Fog.* Not a special system: a widget for hold/burst, and the timer is a looping cue list with a
  hard maximum on time.
- *Channel wizard.* Moved into phase 2, it's the thing nobody else has for cheap fixtures.

## Rethinking, pass 2 (is it too much?)

- *Six concepts* is the floor: without presets shows can't be edited, without pages there's no
  live use. Nothing else becomes a top-level concept (no "scenes", "chasers", "macros", "shows").
- *Priority low/normal/high, fade out, delay, blocks, width, base mode*: advanced fold only, with
  defaults that are right for 95 % of shows.
- *Engine in a Worker*: not now. The engine stays pure and DOM-free so it can move later; measure
  output jitter in the e2e (frame timestamps). Real show safety comes from playback on the node.
- *Undo by snapshot* of the whole show (shows are small), not by command objects. Less code, fewer
  bugs.
- *Page widget zoo*: eight widget types cover every recipe in the research. No matrix, animation,
  audio triggers or frames-in-frames.
- *QLC+ export*: only fixtures, scenes and chasers. Effects and pages don't map cleanly; say so in
  the export dialog instead of half-converting.
- *Colour themes*: just preset sets with a name, no new concept.
- *Every phase keeps the simple path short*: a test per phase checks the first-light path still
  takes the same few clicks (template, patch, colour, record).
