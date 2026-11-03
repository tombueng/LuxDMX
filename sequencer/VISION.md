# What the LuxDMX sequencer should become

A lighting console in the browser for people who light small shows: a band with eight PARs and two
cheap moving heads, a DJ, a school stage, a church, a cinema's house lights, a bar that wants
nice light at 18:00 every day. A handful to a few dozen fixtures, not a stadium.

It grew out of a look at pro consoles, hobbyist tools and what their users complain about, plus the
QLC+ and Open Fixture Library formats.

**Hobbyist first means how it's operated, not which gear it supports.** Pro fixtures (Robe, Martin,
Clay Paky, Ayrton, Chauvet Professional...) work fully: multiple modes, 16-bit, CMY, colour and gobo
wheels, shutter ranges, zoom/focus/iris/frost/prism, multi-cell fixtures, and every other channel
through its labelled ranges. They come from GDTF (what pro manufacturers publish), the Open Fixture
Library or QLC+. A semi-pro rig with a few universes of real moving lights is in scope; the
simple path just stays simple.

## Why anyone would use it instead of what exists

1. **Any browser, no install, no licence, no dongle.** Lightkey is Mac only and a subscription,
   ShowXpress and Daslight need the vendor's interface, DMXIS owners are stuck with a discontinued
   dongle, ONYX free dropped to one universe. We run in Chrome, Firefox, Safari, on a laptop or a
   tablet, and talk to cheap LuxDMX nodes.
2. **Light on stage in five minutes.** Patch from a library or a generic type, and the app builds
   groups, colour and position presets and a busking page on its own. Nobody has to learn what a
   programmer or a palette is before the first light comes on.
3. **Cheap fixtures without a profile are fine.** The channel wizard pokes one channel at a time on
   the real fixture while you watch, you say what it did. No other tool does that, and wrong
   manuals are the norm for cheap gear.
4. **One small model instead of a zoo.** Everything that plays is a cue list (a scene is a list
   with one cue, a chase is a looping list). Effects, presets and a live page on top. QLC+ has
   Scene, Chaser, Sequence, Collection, EFX, RGB Matrix, Show, Script.
5. **The phone is a first-class remote.** The live page is built for touch first. QLC+'s web access
   is "experimental", Lightkey has no app, MagicQ's remote needs ChamSys hardware.
6. **Later: the show runs on the node.** No laptop at showtime, schedules for bars and cinemas,
   the browser is only the editor and the remote. (Needs firmware work, see PLAN.md "Later".)
7. **Open, documented file format.** Versioned, with migrations and a published schema, plus QLC+
   import and export. Upgrades don't break shows.

## Who it's for, and what each needs on day one

| Who | Day one | Nice to have |
|---|---|---|
| Band | colours, a few chases, strobe and blackout on big buttons, fog on a button, tap tempo | songs/setlist, MIDI foot switch |
| DJ / party | busking page, effects that follow the beat, colour themes | music-reactive auto show |
| Small theatre, school | a GO cue list with fades, house lights on their own list | notes per cue |
| Church | a few looks on buttons for volunteers, locked so they can't break it | schedules |
| Cinema | house lights fade on cue (preshow, film, credits) | schedules, external trigger |
| Bar, restaurant | a few moods, slow fades | schedules, runs without a computer |

## Principles

- **No syntax.** Click, drag, pick. No command line.
- **Things look like what they do.** Colour swatches, a pad for position, fades as filling bars,
  effects with a live preview on the stage.
- **Sensible defaults everywhere,** so the simple path never asks a question it can answer itself.
- **Depth is opt-in.** Timing details, priorities, blocks and mirror, scripts: behind an "advanced"
  fold. A hobbyist never has to open it; a semi-pro finds what they expect there.
- **Can't break the show.** Undo, autosave, a locked live page, output never stops while editing.
- **Fewer concepts, not more features.** Before adding a concept, check if an existing one covers it.

## What we deliberately don't build

From the research, things hobbyists don't want and that make tools hard:

- Tracking cue lists, move-in-black, part cues, per-channel timing, the "update" semantics of
  pro desks. Cues are full looks with fades.
- A 3D visualiser. A 2D stage is enough.
- Timecode, DAW-style timelines with audio waveforms.
- DJ software integrations, a pixel/Christmas sequencer, media server features.
- Cloud accounts, subscriptions, native apps.
- A macro language. Cues get a few "also do" actions picked from a list instead.
- Deep MIDI mapping editors. "Move the control now" learn on buttons and faders is enough.
