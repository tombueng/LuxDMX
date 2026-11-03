# LuxDMX sequencer: design notes

> First draft from 2026-10-26. What the product should be is now in VISION.md, the model and the
> phases in PLAN.md (both rewritten after the research). This file keeps the technical notes:
> the bridge, the engine, formats and standalone playback.

A lighting console that runs in the browser. Easy for "a few PARs and a moving head", but with the
tools a real desk has: fixtures instead of raw channels, palettes, tracking cue lists, timed fades,
parametrised effects, live busking. No backend: it's a static site (GitHub Pages), the show lives in
the browser and in files. It drives LuxDMX boxes directly, and can hand a finished show to a box
that then plays it on its own.

Status: concept. The bridge underneath it works (see "Talking to LuxDMX").

## Who it's for

Hobbyists and enthusiasts: a band with eight PARs and two cheap moving heads, a club night, a
garden party, a shop window, a school stage. Not the touring LD who already knows an MA. Most
console software assumes you went through its training; this one shouldn't.

Rules that follow from that:

- **No syntax.** No command line, no "Fixture 1 Thru 8 At 50 Enter". You click, drag, pick.
- **Things look like what they do.** A colour is a colour swatch, a position is a dot on a pad,
  a fade is a bar that fills up, an effect shows a live preview of what it does to the group.
- **Sensible defaults everywhere.** A new cue fades in 2 s, a new effect runs at a pleasant speed
  across the selected fixtures, a new fixture goes to the next free address.
- **Depth is opt-in.** Per-attribute timing, tracking, scripts, wings and blocks exist, but they sit
  behind an "advanced" fold and never get in the way of the simple path.
- **Your fixture isn't in the library? Fine.** Most hobby gear is cheap PARs whose manual has a
  channel table. Typing that table in ("ch1 red, ch2 green, ch3 blue, ch4 dimmer, ch5 strobe")
  has to take a minute, not an evening.
- **Can't break the show.** Undo for everything, autosave, and the live output never stops because
  you're editing.

## What it should feel like

- Open the page, add fixtures from a library by typing their name, drag them onto the stage.
- Select fixtures, pick a colour, move a fader, hit record: that's a cue.
- Pick an effect ("rainbow", "circle", "chase"), turn spread and speed, done.
- Play it back live, or export it to a LuxDMX that runs it with no computer attached.
- Nothing about this needs the manual. The depth (timing per attribute, tracking, scripts) is there
  when you go looking for it.

## The model

Everything is stored as **attributes on fixtures**, not as channel values. A cue says "Spot 3: red,
70 %, pan 40°", and the patch turns that into channels at output time. Re-patch a fixture, swap a
model, change a mode: the show still works.

- **Fixture type**: from the Open Fixture Library (JSON, thousands of devices, open license), or
  imported from QLC+ `.qxf` / GDTF. Channels map to attributes: intensity, colour (RGB, RGBW, CMY,
  colour wheel slots), pan/tilt (+ fine), gobo, shutter/strobe, zoom, focus, prism, speed, and
  "raw" for anything we don't understand. Per channel the value ranges and what they mean. Modes.
  Multi-head fixtures (pixel bars) as several heads in one fixture.
- **Patch**: fixture instance = type + mode + universe + address + a name + a position on the stage.
  Universes map to output targets (see "Several nodes").
- **Groups**: ordered selections. The order matters for effects (spread runs along it); a group can
  also carry a 2D layout for matrix effects.
- **Palettes** (presets): named colour / position / beam looks per fixture. Cues reference palettes,
  so changing the "blue" palette changes every cue that uses it. This is the thing that makes big
  shows editable.
- **Programmer**: the live "what I'm building right now" layer. Selected fixtures, values touched.
  Record turns it into a cue.

## Playback

- **Cue lists with tracking**: a cue only stores what changes, values carry over until changed.
  Small to store, and it's how theatre and touring desks work. A "block" cue resets tracking.
- **Timing**: fade and delay per cue, overridable per attribute (colour snaps, intensity fades 3 s,
  position moves in 5 s), with easing curves. Timing can fan across a group (each fixture starts a
  bit later) using the same spread idea as effects.
- **Playbacks**: cue lists and effects on virtual faders and buttons, with HTP/LTP mixing between
  them (intensity HTP, everything else latest takes precedence). Tap tempo / BPM for speed.
- **Chasers and loops**: a cue list can loop, ping-pong, or follow a step time; loop start and end
  markers on the timeline.
- **Timeline shows** (later): tracks over time, cues and effects as clips, for installations and
  pre-programmed shows.

## Effects

An effect is a small script: a pure function from time and position in the group to attribute values.

```ts
export default effect({
  name: 'Rainbow',
  params: { speed: bpm(30), spread: percent(100), saturation: percent(100) },
  attrs: ['color'],
  run({ t, i, n, p }) {
    const hue = (t * p.speed / 60 + (i / n) * p.spread) % 1;
    return { color: hsv(hue, p.saturation, 1) };
  },
});
```

- `t` time in seconds, `i` the fixture's index in the group, `n` the group size, `p` the parameters.
- Parameters are declared with type and range, so the UI builds sliders, colour pickers and
  dropdowns for them automatically.
- Group controls every effect gets for free: **spread** (phase across the group), **blocks** (fixtures
  in step together), **wings** (mirror from the middle), **width** (how much of the group is "on").
  That's the MA3 phaser / ChamSys shapes idea.
- Built-ins: dimmer chase, sine/saw/square intensity, strobe, colour fade, rainbow, colour chase,
  pan/tilt circle, eight, line, fan, random/twinkle.
- **User scripts**: same API, written in the app or loaded from a file. They run in a Web Worker
  with a time budget per frame, no DOM, no network. A broken script stops its effect, not the show.
- Deterministic: same `t`, same output. That makes scrubbing, preview and export identical.

## Engine

- Runs on the page at 40 Hz, ticked by a clock in a Web Worker (browsers slow down timers in
  background tabs, not Workers), so a hidden tab keeps its output steady.
- Per frame: resolve cue list states (with fades) + effects + programmer into attribute values per
  fixture, merge (HTP/LTP), map to channels through the patch, write one 512-byte buffer per
  universe, send the universes that changed.
- Pure TypeScript with no DOM, so it's unit-testable and the export renderer is the same code.

## Talking to LuxDMX

Browsers can't send UDP, so there's no Art-Net or sACN from a web page. And the app is on https
while LuxDMX speaks plain http, which a browser won't mix.

- The app opens `http://<box>/bridge` as a small popup. That page lives on the box's own origin,
  so it can talk to the box's `/ws`. App and popup talk via `postMessage`.
- The popup asks once per site ("Allow ... to send DMX to this LuxDMX?"), only listens to the window
  that opened it, and only answers that origin.
- Frames go over the WebSocket as binary: `'D', 1, universe lo, universe hi, priority, 0, data`.
  The box takes them as one more source ("Web"), with the same merge, priority and signal loss as
  Art-Net and sACN.

- Only changes are sent, plus a heartbeat (4 Hz) so the box keeps the source. One message is on
  the wire at a time: the box answers each with one byte (`K`) and the popup sends the next only
  then, keeping just the newest frame per universe meanwhile, so a slow box skips looks instead of
  falling behind (and no frame header lands split across two packets, which the box's WebSocket
  library misread before firmware v1.0.288).
- **A reload of the app**: the popup stays open and keeps sending its stats to `window.opener`,
  which is now the reloaded app (same browsing context). The app takes it back without a click:
  only messages from the box's own origin count, it says hello, and the popup is ours once it
  answers with its live socket status. The box's outputs and name, said only in `ready`, are kept
  per tab in sessionStorage for this. A live popup whose box is no longer in the show is closed
  once nobody has claimed it for 4 s (the show may still be loading).
  What was playing (cue lists in play order, hand-started effects, masters, blackout, the view,
  the GO list, Auto GO and ♪; never held flashes) comes back from sessionStorage when the reload
  is less than a minute old.

## A phone as a remote

The show stays on the laptop; a phone plays its live page through the box. The box serves the
phone's page itself (`/remote`, plain JS, ~14 KB gzipped): no popup, no https, no app. Phones are
where popups and background tabs work worst, so the phone talks to `/ws` directly.

- The box relays: a `/ws` text message `{"relay":{...}}` goes, unread, by role: phones subscribe
  with `{"type":"relay"}`, the laptop's bridge with `{"type":"relay","host":1}`; the laptop's
  messages go to the phones, the phones' (and anyone else's) to the laptop, never back to the
  sender. The box takes 4 pages at a time and closes the newest non-DMX one beyond that (4001).
  4 KB at most (reassembled when it arrives in TCP pieces), valid UTF-8 only, 50/s per client,
  per-client queues like the status pushes, skipped when the heap is short. The bridge popup
  passes relay messages both ways.
- Every message has the four-digit `code` the laptop shows. Phone messages carry the phone's
  random `rid` (new per page load) and a sequence number `n` (the laptop ignores repeats, e.g. a box
  added twice); laptop messages carry `host: 1`, and a phone listens to nothing else. The laptop
  (`remote/host.svelte.ts`) ignores other codes and phones it removed. Not a password, it keeps
  stray phones out.
- Phone to laptop: `hello` (with a device guess for the laptop's list), `tap` / `down` / `up` (a
  widget id), `fader` (id, 0..1), `burst` (fog), `go`, `back`, `bo` (the wanted state), `bpm` (a
  tempo tapped and timed on the phone), `alive` (every 400 ms: what it holds, the page it shows),
  `bye`.
- Laptop to phone, only while a phone is there: `layout` (show name, pages) and `tiles` (each
  control's face without the moving parts: label, colour, symbol, size, whether it holds, a cue's
  main colours and number, an effect's colours), again when they change (looked at once a second)
  and every 10 s for a phone that missed a part; `state` (blackout, the GO bar, and per control on
  / small line / bar / fader) at most 5 times a second (sooner after a press, but never closer than
  80 ms; a fader drag doesn't speed it up) and at least every 2 s, only for the pages phones look
  at (at most 24 pages go to phones). Messages stay under 1.2 KB (one TCP segment) and go out at most one every 22 ms (a phone's queue
  on the box is 4 deep and also carries the status frames); a newer layout or state replaces one
  still waiting. `bye` ends it for everyone, `bye` with `to` for one phone.
- The faces come from `widgetFace()`, the same function the live page's tiles use, so both look
  alike. The phone redraws a page only when a new layout version is complete, and lets go of what
  it holds first.
- Safety: a held button stays held only while the phone says so in `alive`; the laptop lets go of
  anything not mentioned for 1.5 s, and of everything a phone held when it's gone 5 s, sends
  `bye`, is removed, re-joins, or the code changes; a held flash lets go after 30 s anyway (fog
  after its own maximum). The phone lets go itself when its page is hidden or loses focus, a key
  comes up anywhere, or the laptop goes quiet. A removed phone that keeps talking is told again.
- The phone tells the box link from the laptop link: the box's own status frames (10/s) are its
  heartbeat, so a socket that looks open after the Wi-Fi went is still "Can't reach the LuxDMX".
- On the phone: the hold buttons (Blinder, Drop, fog, flashes) are pinned above GO; Blackout on
  takes holding it a moment, off is a tap; when there's nothing to play it says why (no box, no
  laptop, ended, removed) with a code field instead of a dead GO. Over http there's no Wake Lock,
  so a silent looping video keeps the screen on (NoSleep.js).
- The laptop keeps the code for 12 hours across tabs, switches the remote back on after a reload
  of its tab (not in a copy of it), and says so when a phone is waiting for a remote that's off.

## Several nodes

- Every universe in the patch has a target: a LuxDMX (through its bridge) or, later, any Art-Net
  node through a LuxDMX acting as gateway (it re-sends those universes as Art-Net/sACN on the LAN).
- One popup per LuxDMX. How many universes one box takes over the WebSocket needs measuring:
  probably around ten on an S3, a few on a classic ESP32 on WiFi.
- The node list comes from the user (address), the box's `/info.json` says which universes its
  outputs use.

## Preview

- A compact version of the LuxDMX universe grid, per universe, live while playing.
- A 2D stage view: fixtures where you put them, RGB as a coloured disc, intensity as brightness,
  pan/tilt as a beam direction. Also how you select fixtures.
- 3D later (three.js; luxdmx.org already has a scene).

## Formats

| Format | Import | Export | Notes |
|---|---|---|---|
| Our project file | yes | yes | JSON, versioned, zipped with fixture types and user scripts |
| Open Fixture Library | yes | (via OFL itself) | primary fixture source |
| QLC+ `.qxf` fixtures | yes | yes | |
| QLC+ `.qxw` workspace | yes | yes | fixtures, scenes, chasers, sequences, shows. EFX shapes mapped onto our effects where they match, RGB matrix scripts are close to ours |
| GDTF / MVR | yes | later | open standards (MA3, Vectorworks) |
| grandMA2 XML exports | sequences, effects, presets | no | MA2 can export those objects as XML |
| ChamSys show files | maybe | no | text but undocumented, reverse engineering |
| MA3 / Hog shows | no | no | closed binary formats |
| Art-Net / sACN recording | yes | | from any console, raw channels, no fixture info |
| Wireshark pcap | yes | | same, offline |
| CSV | yes | yes | raw channel frames, for scripts and spreadsheets |
| LuxDMX playback file | | yes | rendered frames, see below |

## Standalone playback on LuxDMX

The app renders the show (effects included) into the box's own format: keyframe every few seconds,
then only the channels that changed, compressed in ~4 KB blocks. The box stores it (128 KB on every
board, megabytes on 16 MB S3 boards), plays it as the lowest-priority source, and falls back to it
when the console goes away. The box never needs to know about fixtures or effects.

## Browser extras

- Web MIDI: a cheap MIDI fader box becomes a desk (and covers the old MIDI request, #20).
- Web Audio: beat detection for sound-to-light, tap tempo from the music.
- Works offline once loaded (service worker), the show autosaves to IndexedDB, undo/redo.

## Slices

1. **MVP 1**: fixture library search + patch, groups, programmer (intensity, colour picker, pan/tilt),
   cues with fades, one cue list, live output to one or more LuxDMX, compact universe preview,
   project save/load.
2. **MVP 2**: effects engine, built-in effects with spread/blocks/wings, user scripts, palettes,
   2D stage view, playback faders.
3. **MVP 3**: tracking + per-attribute timing, timeline shows, QLC+ import/export, export to
   LuxDMX standalone playback.
4. **Later**: pixel mapping, Web MIDI, audio sync, Art-Net gateway for other nodes, GDTF/MVR, MA2 XML.

## Stack

TypeScript, Vite, a light UI framework (Svelte or Preact), IndexedDB for storage, the engine and
user scripts in Web Workers. Unit tests for the engine (deterministic, no browser needed),
Playwright e2e against a real LuxDMX for output. Hosted on GitHub Pages from `sequencer/` in the
LuxDMX repo.
