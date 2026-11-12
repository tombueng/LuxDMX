# Version history

What changed, newest first. Firmware versions are the release builds (`v1.0.N`, see
[Releases](https://github.com/tombueng/LuxDMX/releases)); a box with auto-update on picks them up by
itself. The sequencer has no version number of its own: it's the page at
[tombueng.github.io/LuxDMX/sequencer](https://tombueng.github.io/LuxDMX/sequencer/) and you always
get the newest one.

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
