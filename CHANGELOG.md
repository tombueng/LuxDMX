# Version history

What changed, newest first. Firmware versions are the release builds (`v1.0.N`, see
[Releases](https://github.com/tombueng/LuxDMX/releases)); a box with auto-update on picks them up by
itself. The sequencer has no version number of its own: it's the page at
[tombueng.github.io/LuxDMX/sequencer](https://tombueng.github.io/LuxDMX/sequencer/) and you always
get the newest one.

## Unreleased

**Sequencer**

A long round of testing it the way people use it (on a laptop, an upright tablet and a phone; a DJ,
a church volunteer, a theatre tech, a band). Mostly fixes, a few things that were missing:

- Recording a rainbow (or any colour or move effect that switches its lights on) gave a cue that
  played the lights dark. It plays them lit, as they were.
- Undo of a Record puts the stage back as it was, not just the list; the lock for the service isn't
  an undo step any more (Ctrl+Z after unlocking locked again); a locked page has no rig.
- Groups keep their number when you reorder them, so `group 5` stays the same group.
- A tap on the padlock asks: with a PIN or without. On a touch screen, **+ Add** adds lights and
  groups to the selection.
- An effect button on Live stops the effect even when the cue on stage runs it.
- The timeline shows what lies after a shorter song (and moves it in on a tap), Fit fits, an effect
  dropped on a part of the song runs to the end of that part, parts move to the playhead.
- Live's cue list follows the list GO plays; GO at the end of a list says so.
- The cue sheet says each light's level, and a list prints its own.
- New lights land clear of the ones on stage; names on the plan stay inside it and read as their own
  light's; the plan keeps its lights apart on a narrow screen.
- The top bar fits an upright iPad and counts the interface size (120 % on a laptop).
- The box's window can be reloaded: the app takes it back by itself.
- Big rigs are quick again: a Record with 320 lights and 40 cues took 5 s, adding 200 lights to a
  big rig froze the page for 12 s. Both take moments now.
- The same show in two tabs: the out-of-date one says **changed in another tab** and takes the
  newer version on a tap, instead of quietly saving over it.
- A browser that won't keep the show (storage full or blocked) says **not saved** in red, instead
  of "saving…" for ever.
- By keyboard alone the whole thing works now without the focus getting lost: Space presses a
  Live button you tabbed to, the arrows move a cue on the timeline, Escape cancels a rename, and
  a screen reader hears percentages and headings where it heard 0.7 and buttons that did nothing.
- A box on slow Wi-Fi is said (in orange, with how much gets through) instead of looking fine while
  a chase stood still; a box that keeps dropping out doesn't make the page jump; with two boxes the
  red bar says which universes and which box.
- On the beat: the BPM field takes only real tempos (typing 90 went through 9 BPM), Tap puts the
  beat where you tap, cues that go on after N beats don't drift any more, and the stage, Auto GO
  and the effects on the wire stay on the same beat after the page was busy for a moment.
- In a German browser: the cue sheet CSV opens in German Excel (';', 2,5, umlauts), decimals with a
  comma work everywhere, AltGr+Q gives @ on the console, file names keep their umlauts.
- Colour is never the only sign: On stage and ARMED in words on a phone too, armed chips striped,
  a patch clash marked, picked cue cards dashed, faint text lighter.
- The printed cue sheet and patch: page numbers and the show's name on every page, lights in runs
  (the big demo's cue sheet went from 62 pages to 12), long notes wrap instead of shrinking the page.
- A show night doesn't wear the app down: an hour of playing, switching and editing left memory,
  listeners and the output rate flat, and playing (GO, Live buttons) no longer saves after each press.
- Add fixtures is one dialog with the search box on top, live as you type over the built-in types
  and the 2400+ library fixtures. Every tile plays its light in 3D: spots sweep and run their gobos
  and prisms, washes breathe, PARs run the colours, bars chase. All in one WebGL context, only the
  tiles on the screen, so it stays smooth. The old library popup is gone.
- 3D: **Your stage** in the Venue panel: your real stage at its size (width, depth, a riser or
  not, how many trusses and how high). The room, crowd and camera moves are built for it, the
  lights hang on its trusses, the plan is that stage.
- 3D: **Measure** next to Aim: two clicks give the distance (across, up or down); one light gives
  its height above the deck or floor and where its beam lands, how far and how wide.
- 3D: **Selected** next to the camera views flies the camera to the selected lights, and **Show it
  in 3D** in a light's right-click menu opens the 3D stage and does the same.
- A gallery, **What the 3D stage draws** (Ctrl+K "gallery", or from Add fixtures and the
  welcome): 22 live tiles, gobos turning, prisms, heads in a fan, pixel bars, discs, winches,
  flames, sparks, confetti, CO2, fog with a light through it. The README has them as animations,
  made by the app itself (`tools/gallery/capture.mjs`).
- One place to start a show: **New show…** in Shows opens the start dialog (Shows lost its own
  template list); its **Empty stage** is a new show; an empty show has one **Add lights** on the
  stage instead of four buttons in four places.
- The welcome is two rows of tiles: the demo shows (each with its own music menu, and they fold away
  for good once you don't need them), and the everyday starts (empty, the templates, a show file).
  Every demo and template also comes as **Lights only**: the rig placed, nothing programmed.
- Render: the 3D view keeps the video's shape while it renders (a 4K render showed twice as wide),
  and closing or reloading the page during a render asks first. On the dev server, code changes
  wait until the render is done instead of breaking it off.
- Render: "the song from the playhead" takes a length, so a short clip has its sound. The only short
  one used to be "the look as it is", which has no sound and didn't say so.
- Lots of smaller things: cut-off numbers, dialogs that closed on a typo, focus after dialogs, help
  notes off the screen, empty states that now say what to do, one name for saving a show file.

## 2026-11-12

**Sequencer**

- Pixel lights cell by cell: single LEDs of a bar, a ring or a matrix in the programmer, in cues,
  presets, groups and effects. The fixture editor can repeat a channel block N times as cells.
- A console mode if you know desks: command line (`1 thru 4 @ 50`, `goto cue 5`), fixed fixture
  numbers, faders, encoders, palettes, cue list faders, MIDI learn.
- Real gobos in the 3D stage, about a hundred patterns incl. glass gobos, plus prisms, animation
  wheels, shake, scroll, iris and focus. The demo shows use them a lot.
- Beam angles come from the fixture files (OFL, GDTF, QLC+) now, not from a guess.
- More than two axes: endless pan and tilt, a roll axis, moving bars whose heads tilt on their own.
- Winches. They only move while the machines are armed, stay where they are when made safe (never
  back to 0, that's the top) and have soft limits per winch.
- Render the 3D stage to a video, frame by frame, up to 4K or 8K, with the song.
- Pan and tilt calibration for any moving head, also when its profile doesn't name the channels.
- Second gobo wheel, prism rotation, animation wheel, built-in effects and colour programs get
  their own controls. Separate fade times for colour, position and beam.
- Show files are format 1.2.0 when they use cells; an older sequencer refuses such a file instead
  of playing it wrong.
- Fixed: a tab that started blind could still send the live show through its output thread.

**Firmware**

- The OTA and AP passwords never show up in `/info.json`. A tickbox clears them, the AP password
  is 8 to 63 characters, and a new OTA password counts right away.
- README: how to keep the box on a network of its own (Art-Net and sACN have no passwords).

## 2026-11-10

- The license is Apache-2.0 now, with a warranty disclaimer in the README.

## 2026-11-03 to 11-09 (v1.0.287 to v1.0.298)

- The sequencer is out: a lighting console in the browser, on GitHub Pages. The box serves a little
  bridge so a browser can send DMX and a phone can play the show through it.
- LED rings and matrices as fixtures, with effects made for them (#159).
- LED wiring per light, trying a light's channels one by one, focus calibration, effects as
  add-ons (#161).
- sACN: the socket opens on the task that reads it; status page fixed on phones.
- ESPAsyncWebServer pinned to upstream's fix for torn WebSocket frame headers.

## October 2026 (v1.0.261 to v1.0.285)

- Up to four WiFi networks, it joins whichever is there (#120).
- Download the whole config as a file and restore it (#108).
- The display switches off after a while (#134).
- Classic ESP32: the web UI no longer runs it out of heap, and works on WiFi again (#135).
- The PSRAM image gets an 8 MB flash header, so it boots on an N8R8.

## August and September 2026 (v1.0.240 to v1.0.258)

- Art-Net: a console can rename the node and set the universes (ArtAddress, #130).
- `/config` never invents settings it could then save (#133).
- The S3 PSRAM image actually enables PSRAM now (#127).
- A wedged W5500 link recovers by itself instead of sitting there unreachable (#115).
- RDM keeps its fixtures when an output gets a new universe (#118).
- A per-output warning when a Continuous output beats a mismatched source (#126).
- Delta output follows content changes, not packet arrivals (#123). Encoder steps apply (#125).
- A board profile for the Radig ESP32-S3 DMX/RDM node (#122).

## July 2026 (v1.0.129 to v1.0.237)

- DMX output driven by RMT: no framing errors under load (#65). esp_dmx is gone (#112).
- RDM over Art-Net, with a bus scheduler that keeps DMX smooth (#71), and an RDM page with
  fixtures and sensor charts (#72). Slow fixtures no longer get lost in discovery (#114).
- DM9051 SPI Ethernet (#69). Our own first-run setup portal instead of WiFiManager (#67).
- Output rate per port, or following the console (#104). The output frame can't be read half
  written any more (#106). Restart only when a setting needs it (#105).
- Restart the box remotely and update it from a URL (#111). OTA: retries a scheduled update
  (#83), checks the version over plain HTTP (#82), never reports a cut-off upload as done (#99).
- ArtIpProg remote IP config, off by default (#116). Pick the universe on the unit itself (#94).
- One status language for the LEDs (#79). Tests that measure the DMX wire and the RDM bus (#113).
- Hardware: v5 with protected DMX512-A outputs (#60), then one board called v6 (#102).

## June 2026 (v1.0.62 to v1.0.126)

- WT32-ETH01 Ethernet (#1), an optional OLED status panel (#5).
- Flash from the browser (#7).
- A pin picker that draws the real header (#12, #54).
- W5500 Ethernet on any board (#22), and picking the wired chip at runtime (#28).
- HTP/LTP merging of two sources, with sACN priority (#23).
- Renamed from LumiGate to LuxDMX (#39).
- What to do on signal loss (#44). Config from a schema, also over serial (#49).
- One-click firmware update with a real progress dialog (#52). Hostname over DHCP (#59).
