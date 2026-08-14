# Pixel output (WS281x)

LuxDMX drives addressable LED strip from Art-Net or sACN, alongside the DMX outputs on the
same box. This page is the mapping model, the limits and the things that will bite you.

## What is supported

| | |
|---|---|
| Chips | WS2812 / WS2812B / WS2813 / **WS2815**, WS2811 (400 kHz mode), SK6812 / WS2814 / UCS2904 (RGBW) |
| Ports | up to 5 (board dependent, see [Backends](#backends)) |
| Protocols | Art-Net and sACN / E1.31, multi-universe, unicast or multicast |
| Sync | Art-Net `ArtSync` and E1.31 universe synchronisation |
| Per port | pixel count, first universe, start channel, colour order, brightness, gamma, power cap, latch policy |

Not supported, deliberately: **clocked** strip (APA102 / SK9822 / WS2801), effects and
pattern generators, and matrix/serpentine *mapping* (the live view can draw serpentine, the
patch itself is linear). This is a gateway, not a WLED.

## The mapping model

Each port is `{ first universe, start channel, pixel count }`. That expresses both directions
people actually need.

**Many universes into one port.** A count larger than one universe holds simply continues
into the next universe:

```
port 1: universe 0, channel 1, 1020 pixels   ->  universes 0,1,2,3,4,5
```

**One universe across several ports.** Give several ports the same universe and different
start channels:

```
port 1: universe 0, channel   1, 50 pixels   ->  channels   1..150
port 2: universe 0, channel 151, 50 pixels   ->  channels 151..300
port 3: universe 0, channel 301, 50 pixels   ->  channels 301..450
```

No special mode for either: internally a universe just has several *sinks*, and a DMX output
is the same thing taking all 512 channels.

### Universe packing

**Whole pixels per universe** (the default) never lets a pixel straddle a universe boundary.
An RGB universe therefore carries 170 pixels (510 channels) and RGBW carries 128 (512). A
start channel shortens only the *first* universe; every later one restarts at channel 1.
This is what consoles and other pixel controllers assume.

**Packed (512)** runs channels continuously across universes, so pixel 171 of an RGB port
begins in one universe and ends in the next. Only use it if your sender does the same.

## Limits, and which one bites first

**The wire.** WS281x is 800 kHz and 24 bits per pixel, so **30 µs per RGB pixel**, always.
Ports clock in parallel, so this is per-port length rather than a total:

| pixels/port | universes | frame time | max fps |
|---:|---:|---:|---:|
| 170 | 1 | 5.1 ms | 196 |
| 340 | 2 | 10.2 ms | 98 |
| 680 | 4 | 20.4 ms | 49 |
| 1020 | 6 | 30.6 ms | 32 |
| 2040 | 12 | 61 ms | 16 |

The settings page shows this figure live as you type a pixel count, because "2040 pixels" and
"16 fps" are the same statement.

**The network** is usually the real ceiling. Five ports of ~1000 pixels is about 30 universes;
at 32 fps that is roughly 960 packets a second. Expect to be network-bound somewhere around
30 to 50 universes.

**Power** is covered below and is the one that sets things on fire rather than merely
disappointing you.

## Latching: when a frame is pushed

A pixel frame usually spans several universes, so the port has to decide when it is complete.

- **On complete** (default) pushes as soon as every universe of the port has arrived since the
  last push. Output rate then equals input rate exactly, with no resampling.
- **On sync** waits for `ArtSync` / E1.31 sync.
- **Free-run** pushes at a fixed rate regardless. It can tear a multi-universe frame; it
  exists for odd sources.

Arrival is tracked as a **bitmask, not a sequence**, so universes arriving out of order are
fine. If a universe is missing, the frame is pushed anyway after ~120 ms with that slice
holding its previous content. **Nothing is ever dropped**: a lost packet costs one stale slice
for one frame, not a whole frame across every port. A latching strip holds whatever it was
last told, so never pushing is by far the worst outcome available.

Unlike DMX there is no refresh requirement, so there is no fixed-rate sampler and none of the
duplicate-frame stepping that issue #93 was about — unless you pick Free-run, which
reintroduces it by definition.

## Power

The estimate has two terms, and the second is the one every online calculator forgets:

```
mA = pixels × idle-mA-per-pixel        (the controller IC draws this even at black)
   + sum(all channel values) / 255 × mA-per-channel-at-255
```

A thousand *black* pixels still draws about an amp. `mA per channel at 255` stays unambiguous
across RGB and RGBW, where "full white" could mean three channels or four.

Presets are starting points only. The number that is actually reliable is printed on the reel:

```
W/m ÷ V ÷ (pixels/m) × 1000 = mA per pixel     then ÷ channels = mA per channel
14.4 W/m at 24 V, 60 px/m  ->  0.6 A/m  ->  10 mA/px  ->  3.3 mA/channel
```

| preset | V | ch | mA/ch at 255 | all channels on |
|---|---:|---:|---:|---:|
| WS2812B / SK6812 RGB | 5 | 3 | ~20 | ~60 mA/px |
| SK6812 RGBW | 5 | 4 | ~20 | ~80 mA/px |
| WS2815 | 12 | 3 | ~5.7 | ~17 mA/px |
| WS2811 24 V (6 LEDs/px) | 24 | 3 | ~3 | ~9 mA/px |
| WS2814 / UCS2904 RGBW 24 V | 24 | 4 | ~2.8 | ~11 mA/px |

**Higher voltage costs less current** for the same light, because the strip puts more LEDs in
series per pixel. Since a board's limit is copper, and copper only counts amps, 12 V or 24 V
strip gets far more out of the same hardware than 5 V does.

**The power cap** (`maxMa`, per port) scales the frame down when the estimate exceeds it, and
`/pixels.json` reports the `scale` actually applied so a dimmed output is never a mystery. Only
the lit term is scaled: the idle draw is there whatever you do.

The settings page also shows the **all-white worst case** next to the live figure. That is the
number worth looking at, because it tells you your headroom *before* somebody pushes a white
cue rather than after.

## Backends

The driver is picked at runtime from how many ports you ask for and how many RMT TX channels
the chip has. **DMX does not enter into it**: DMX output is a UART peripheral, so enabling all
three outputs costs zero RMT channels. What consumes them is one per pixel port, plus one more
if the status LED is a WS2812.

| board | ports asked for | backend | cost |
|---|---:|---|---|
| ESP32-S3 | up to 3 | RMT (4 TX channels) | ~3 B/pixel |
| ESP32-S3 | 4 or more (the carrier, full) | **LCD_CAM** | 72 B/pixel x2, shared by all ports |
| classic ESP32 | more, it has 8 TX channels | RMT | ~3 B/pixel |

RMT is tried first and LCD_CAM is the fallback, so the choice is automatic and reported in
`/pixels.json` as `backend`. Measured on the carrier (status LED off, one DMX output running):
1, 2 and 3 ports give `"backend":"rmt"`; the 4th switches it to `"backend":"lcd"`.

Three rather than four, because the first lane asks for a DMA channel and its larger symbol
buffer borrows the neighbouring channel's memory block — so it costs two of the four slots and
two more lanes fit in the rest. A WS2812 status LED takes another one.

Note the inversion: the *low-end* board is the one with RMT channels to spare. A WROOM-32
makes a genuinely good multi-port pixel node in a few KB of heap, while an S3 runs out of
channels at the 4th port and needs the parallel path — which is then also the cheaper one,
since all ports share a single expanded frame.

**LCD_CAM** clocks every lane together off the S3's parallel-LCD peripheral at 2.4 MHz with
GDMA, so it costs no RMT channel and ~0 CPU for the transmission. Each WS281x bit becomes three
slots (high / data / low) and the bus is 8 bits wide, so bit *k* of every slot byte is strip
*k*: **72 bytes per pixel in total, however many ports there are**. Adding a sixth or seventh
port is free in both time and memory. The expanded frame is double-buffered, preferably in
PSRAM; without PSRAM it falls back to internal DMA RAM, which works (30 px x 5 ports fits) but
eats into the same heap DMX needs.

Two consequences worth knowing. Every lane shares one clock, so all ports on this backend must
be the same LED chip. And the i80 API insists on a DC and a WR pin that we have no use for, so
they are pointed at an unrouted GPIO (`PIXLCD_GHOST_PIN`, default 45) — deliberately **not**
GPIO 0, which the reference drivers use and which is the BOOT button here.

> The LCD_CAM **data path** is proven on the carrier: five ports at 30 pixels, Art-Net on five
> universes, 39.6 fps in and ~39 fps out per port, 318 latches and 0 partial latches, with DMX
> output 1 running throughout. What is still **unverified is the electrical side** — the slot
> timings are arithmetic, so T0H/T1H and the reset gap have not been measured on a scope with a
> strip attached. Treat the waveform as unproven until that bench pass.

There is a subtlety worth knowing on the S3. An RMT channel asking for more than one memory
block borrows the *next* channel's, consuming two of the four slots, so a pixel port must fit
in a single block — which it does, and the driver falls back to that automatically after
trying for a DMA channel first. An `rmt_new_tx_channel ... register channel failed` line on the
console followed by `RMT backend up` is that fallback working, not an error.

**Nothing is allocated for a port that is off**, and disabling a port frees its buffers, so a
DMX-only box pays nothing for this feature.

## What a disabled feature costs

The rule is that an unused feature should not cost RAM. Where that holds and where it does not:

Measured on the carrier (S3 without PSRAM active, free heap from `/dmx.json`), because the
shape of this table is what decides whether a configuration fits:

| configuration | free heap | largest block |
|---|---:|---:|
| everything off | 126 KB | 82 KB |
| 1 DMX output | 60 KB | 32 KB |
| 3 DMX outputs | 34 KB | 24 KB |
| 3 DMX + 1 pixel port (30 px, RMT) | 26 KB | 12 KB |
| 1 DMX + 5 pixel ports (30 px, LCD_CAM) | 48 KB | 32 KB |

Two things fall out of that. The **first** DMX output is by far the most expensive single
thing on the box (~66 KB: the driver, its tasks and its buffers); each further output is
about 13 KB. And the parallel backend is *cheaper* than several RMT lanes, because the
expanded frame is shared.

It also marks a real limit: three DMX outputs plus two RMT pixel ports on a build **without**
PSRAM drops the largest free block below the ~12 KB that `sendJsonSafe` needs, at which point
every status endpoint answers `503 {"busy":1}` and `/config` is too heavy to serve — the box
keeps running but can no longer be reconfigured through the web UI. Recovery is a bare
`POST /config` with no fields, which is a *deliberate* property of the form semantics below:
every omitted checkbox reads as off, so an empty POST disables all outputs and pixel ports
while leaving pins, WiFi and IP settings untouched. On a full carrier, run the PSRAM build.

**Pixels off — costs nothing.** Framebuffers are allocated per enabled port and freed when a
port is disabled; the push task is created lazily on the first active port; the driver claims
no peripheral. A DMX-only box pays ~1.6 KB of static state (the per-port gamma tables) and
nothing else.

**DMX off — mostly free now, but not entirely.** The big one used to be the RDM device tables:
45.5 KB of internal RAM allocated at boot *regardless of configuration*, so a pure pixel node
carried a full RDM table for a bus it does not have. Those are now sized from the config — if
no enabled output has a direction (RTS) pin, RDM is impossible on that box and the tables
shrink to a single entry (~700 B).

They shrink rather than disappear on purpose: the tables are indexed in many places without a
null check (access is gated on `rdmCount` / `rdmAvailable()`, not on the pointer), so a
minimal allocation keeps every pointer valid and wins the same 45 KB without opening a new
class of null-dereference bug.

Still static regardless of configuration, and candidates if you need more headroom:

| buffer | size | note |
|---|---:|---|
| `senders[]` frame cache | 4.2 KB | since the receive-path split it only serves *merged DMX* universes, so it is dead weight on a pixel-only box |
| `g_sinks[]` routing table | 2.1 KB | deliberately static: it is read on the network task while being rebuilt on the loop task, and a fixed array cannot hand a reader a freed pointer |
| `dmxBuf[]` | 1.5 KB | one 513-byte frame per output |
| `g_seen[]` source index | 1.3 KB | who is sending what, no payload |

**The quickest lever if a box is tight**: `rdmmaxdev`. At the default cap of 64 the RDM tables
are ~45 KB; setting it to 16 saves ~34 KB immediately, no firmware change. Worth doing on any
installation that will never see 64 fixtures on one wire.

**PSRAM.** On a module that has it, the RDM tables and the pixel buffers prefer PSRAM and fall
back to internal RAM.

Getting that to actually happen turned out to hinge on the **board definition**, not on the
sdkconfig. The `esp32s3_psram` env originally built against `esp32-s3-devkitc-1`, which is the
**N8 variant without PSRAM** — the Arduino core then reports, verbatim on the console:

```
Embedded PSRAM    : No
Arduino Board     : Espressif ESP32-S3-DevKitC-1-N8 (8 MB QD, No PSRAM)
```

With that, `CONFIG_SPIRAM=y`, `memory_type = qio_opi` and even an explicit `-DBOARD_HAS_PSRAM`
are all inert: PSRAM never registers with the heap allocator, `heap_caps_get_total_size(
MALLOC_CAP_SPIRAM)` stays 0, and everything that says "prefer PSRAM" silently lands in internal
RAM. The env now uses `esp32-s3-devkitc1-n16r8`, which brings 16 MB flash, `qio_opi` and
`BOARD_HAS_PSRAM` with it.

Measured on an N16R8 with a 1000-pixel port and the full 64-device RDM table:

| | internal heap free | min free |
|---|---:|---:|
| wrong board (no PSRAM) | 57 KB | 47 KB |
| `esp32-s3-devkitc1-n16r8` | **115 KB** | **110 KB** |

`/dmx.json` reports `psram`, `psramFree`, `heap`, `heapMin`, `heapBlock` and `rdmCap`, so this
is checkable from outside instead of guessed at. If `psram` reads 0 on a module that has it,
check the board definition first.

## Configuration

Everything is live: applying a pixel setting never reboots, not even the data pin or the pixel
count. New buffers are built before the old ones are freed, so a config too large to allocate
is refused with the numbers in the message and the running strip keeps going.

The settings page works the arithmetic out for you: the universe range each port consumes, the
next free universe (so filling ports top to bottom just chains), the frame-rate ceiling, and
the current estimate. **Auto-assign universes** chains every enabled port end to end.

It also flags, without forbidding:

- two ports sharing universes (legitimate when they use different start channels, so it asks
  rather than refuses)
- a pixel port overlapping a DMX output's universe (almost always a mistake)

## Things that will bite you

**The status LED and pixel port 5 share a pin on the carrier.** The ESP32-S3 module's own
WS2812 sits on IO48, which is pixel port 5. Two drivers on one pin is the one combination that
genuinely breaks, so the firmware refuses it and the carrier template ships with the status LED
off. With port 5 unused you can turn the LED back on at `ledpin=48`, `ledtype=2`.

**5 V strip on a 12/24 V board.** The carrier's pixel rail is a fused pass-through and does not
care about voltage, but 5 V strip draws roughly 3.5× the current of 12 V strip for the same
pixel count, and the board's limit is amps. See `hardware-carrier/README.md`.

**sACN multicast is capped at 48 groups.** Beyond that, use unicast; the device logs exactly
how many universes it could not join rather than silently missing them.

**PSRAM cannot be switched on over OTA.** Octal PSRAM on the S3 is set up from the bootloader,
and OTA writes only the app partition — so an R8 module updated over the network keeps running
without PSRAM and reports `"psram":0` in `/dmx.json`, with no error anywhere. Switching a board
to the PSRAM build takes one full USB flash (bootloader included); after that OTA is fine
again.

**A pin on GPIO 19 or 20 costs you the USB console.** Those two are the S3's native USB D−/D+.
Nothing warns you at boot: the board enumerates normally, and the port disappears seconds later
when the app claims the pin — which reads exactly like a crashing board. It bit this project
when a carrier inherited a saved config from a v6 (Ethernet MISO on 19, DMX TX on 20). The
config page flags 19/20 as a warning, and the fix is to move the pin; note that the USB pad
does not come back from a software reboot, it needs the cable pulled.

**RDM does not apply to pixels.** RDM is a half-duplex conversation on RS-485; a WS281x strip
has one wire, one direction and nothing on the far end to answer. There is nothing to discover
and no start address to set. Pixel ports never appear in the RDM tab or a TOD. Configure them
over the web UI or Art-Net `ArtAddress`; RDM is for the DMX side.

## Live view and the status bar

The status page grows a **Pixel output** card when any port is enabled, with a tab per port.
The grid is the port's configured `viewCols` x `viewRows`, not auto-fill: a matrix layout is a
property of the installation, so guessing it is wrong more often than right. A cell is a
colour, not a number.

The **device does the decimation**: the browser says how many cells it is drawing and gets
back exactly that many. Payload is a few hundred bytes whatever the strip length, where the
raw frames would be hundreds of kB/s on a box already routing a thousand packets a second.
Cells are the per-channel **maximum** of the pixels they cover, not the average, so a single
lit pixel in a long strip stays visible and a running chase does not vanish at low zoom.

The navigation bar already carries ten stats, so it **adapts rather than grows**: `Pixels`
(total draw, amber when an all-white cue would exceed the rail, red when the live figure
already does), `Pix FPS` and `Universes` (arriving/expected) appear only when a pixel port is
enabled, and the DMX transmit-style chip hides on a pixel-only box.

## REST

| endpoint | what |
|---|---|
| `GET /pixels.json` | every port's config plus live state: universe span, in/out fps, latch and partial counters, mA live and worst case, the power-cap scale in use, and which backend is running |
| `GET /pixels/frame?port=N&cells=M` | framebuffer readback, hex, decimated to `M` cells by per-channel maximum |

The readback is what makes the mapping testable over the network instead of needing a logic
analyzer, and it is what `docs/tests/pixels.spec.mjs` asserts against.
