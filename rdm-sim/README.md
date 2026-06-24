# RDM fixture simulator (hardware-in-the-loop test rig)

A second ESP32-S3 that pretends to be a DMX/RDM fixture, so we can test the
LumiGate RDM controller against a fixture whose timing we control. Board A runs
the real LumiGate firmware as the RDM controller; board B runs this firmware and
plays the fixture. Nothing about board A changes, it runs the shipping binary and
we read results back over its existing `/rdm.json` and WebSocket.

The sim does two things:

- **Content**: a correct, well-behaved RDM responder. Device info, set DMX
  address, identify, device label, software version, two personalities, all
  standard. Three DMX channels at its start address drive the onboard RGB LED, so
  you can also confirm the controller is reading the right slots.
- **Timing**: on command (over DMX) it mangles the timing of its RDM responses,
  break length, mark-after-break, bus turnaround, baud drift, so we can find out
  how robust the controller's receive path is. This is the half that actually
  matters, because receiving is the hard direction on the ESP32 and we have never
  pushed it against real-world timing variation.

A fresh sim with no control channels driven is a perfectly nice fixture, so
discovery and the content tests just work. It only misbehaves when told to.

## Wiring

Two ESP32-S3 boards, each with a MAX485 whose DE and /RE are tied together and
driven by one GPIO (the enable line). Bus is a short bench wire.

```
   ESP32-S3 #A (LumiGate)          MAX485 #A           MAX485 #B        ESP32-S3 #B (sim)
   TX/DI  ---------------------->  DI                        DI  <----------------  TX 17
   RX/RO  <----------------------  RO                        RO  ----------------->  RX 18
   EN     ---------------------->  DE+/RE                DE+/RE  <----------------  EN  8
   3V3    ---------------------->  VCC                      VCC  <----------------  3V3
   GND    ----------------------+  GND                      GND  +---------------  GND
                                |                              |
                              A o------------------------------o A   (120 ohm across A/B at each end)
                              B o------------------------------o B
                                + fail-safe bias on ONE node: ~680 ohm A->3V3, ~680 ohm B->GND
```

Notes that matter:

- **Power the MAX485 from 3.3 V, not 5 V.** A MAX485's RO idles near VCC; at 5 V
  that is ~5 V into a 3.3 V ESP32 RX pin, over the abs-max, slow damage. 3.3 V is
  below the MAX485 datasheet minimum but works fine on a short bench bus (RS485
  only needs 200 mV of difference). If you want fully in-spec, use a MAX3485, the
  3.3 V pin-compatible part.
- **120 ohm termination** across A/B at each end of the bus.
- **Fail-safe bias** (~680 ohm A->3V3, ~680 ohm B->GND on one node). Without it
  the bus floats during the RDM turnaround and throws spurious breaks/framing
  errors, which would fail the test for the wrong reason. Many MAX485 breakout
  modules already include bias and termination, check yours before adding more.
- **Common ground** between both boards.

### Sim pin map (board B)

| Signal | GPIO | MAX485 |
|---|---|---|
| DMX TX | 17 | DI |
| DMX RX | 18 | RO |
| Enable (DE+/RE) | 8 | DE + /RE tied together |
| RGB LED | 48 | onboard WS2812 (some S3 boards: 38) |

Override any of these with `-DSIM_TX_PIN=..`, `-DSIM_RX_PIN=..`, `-DSIM_EN_PIN=..`,
`-DRGB_LED_PIN=..` in `platformio.ini`.

On board A (LumiGate), enable RDM on a MAX485 output by giving that output a real
RTS/enable pin in `/config` (e.g. the v4 board already has DMX out 1 on
tx=17 rx=18 rts=8).

## Build and flash

```
pio run -e rdm_sim -t upload          # flash board B
pio device monitor -e rdm_sim         # watch its serial log
```

First build is slow: disabling the brownout detector forces an Arduino source
build, same as the main firmware.

## How you drive it (no UI, DMX + RDM only)

The sim is controlled entirely over the bus, like a real fixture:

- **RDM** sets its start address, personality, label, identify state.
- **DMX** drives the LED and, in personality 1, selects the timing profile.

### Personalities

| # | Name | Footprint | Channels |
|---|---|---|---|
| 1 | RGB + Timing Ctrl | 7 | +0 R, +1 G, +2 B, +3 break, +4 mab, +5 turnaround, +6 baud |
| 2 | RGB | 3 | +0 R, +1 G, +2 B (always spec-correct timing) |

Personality 1 is the fuzzer. Personality 2 is a plain fixture for pure content
tests. Switch personalities over RDM, like you would on a real fixture.

### Control-channel mapping (personality 1)

Value 0 means "spec default" on every axis except turnaround, so you can fuzz one
dimension and leave the rest clean.

| Channel | 0 | 1..255 |
|---|---|---|
| break | 176 us (default) | 40 us .. 1000 us (40 us = sub-spec runt) |
| mab | 12 us (default) | 12 us .. 500 us |
| turnaround | no delay | ~12 us .. 3000 us extra before the response |
| baud | 250000 (default) | ~245000 .. 255000 (centered at 128) |

## What to test

### Content (personality 2, or personality 1 with all control channels at 0)

- Discovery finds the sim's UID.
- DEVICE_INFO reads back (model, footprint, personality, software version).
- Set DMX start address, confirm the LED follows the new channels.
- Toggle identify, confirm the LED blinks white.
- Set device label, set personality, read them back.

### Timing (personality 1, sweep the control channels)

Drive the control channels from board A's DMX output, let a few frames settle,
then trigger an RDM discovery / GET on board A and see if it still works.

| Axis | Suggested sweep | Looking for |
|---|---|---|
| break | 88, 100, 176, 300, 500, 1000 us, plus a sub-88 runt | controller accepts long breaks; rejects the runt |
| mab | 12, 20, 50, 100, 200 us | tolerated across the range |
| turnaround | 176 us, 500 us, 1 ms, 2 ms, 2.5 ms | works up to 2 ms; times out *gracefully* past it |
| baud | 245k, 250k, 255k | tolerated (real fixtures are not exactly 250000) |

The DISC_UNIQUE_BRANCH response is the tightest timing in all of RDM and where
ESP32 controllers most often choke, so the break/turnaround sweeps during
discovery are the important ones.

## Automated sweep (host harness)

`harness/sweep.mjs` runs the whole timing matrix for you instead of poking
channels by hand. It talks to board A over its WebSocket (to set the sim's
control channels and trigger discovery) and reads `/rdm.json` to see what was
found, then prints a pass/fail table. Board A runs the unmodified firmware.

Needs Node 22+ (built-in `WebSocket` + `fetch`, no npm install).

```
node harness/sweep.mjs <board-A-host> [--addr N] [--out N] [--model 0xNNNN]
# e.g.
node harness/sweep.mjs 192.168.1.50
node harness/sweep.mjs lumigate.local --addr 1 --out 0
```

For each cell it sets the timing profile on board A's output, waits for the sim
to latch it, discovers, and scores:

```
=== RDM HIL sweep against 192.168.1.50 ===
sim: model=0x4C31 addr=1 output=0  (board A unmodified)

  PASS  baseline (spec timing)     -> found addr=1 foot=7 pers=1
  INFO  break=50us                 -> not found (informational)
  PASS  break=88us                 -> found addr=1 foot=7 pers=1
  ...
  PASS  turnaround=2500us          -> not found (expect timeout)
  ...
summary: 18 pass, 0 fail, 1 info
```

Expectations baked in: valid-range cells must be found; a >2 ms turnaround must
*not* be found (the controller should time out gracefully, not hang); the
sub-spec runt break is informational (report only). Exit code is non-zero if any
`found`-expected cell wasn't discovered, so it drops into CI later if you want.

The timing maps in the harness mirror the ones in `src/main.cpp`. If you change a
map in the firmware, change it in `harness/sweep.mjs` too.

## Reading results

- **Board A (controller)**: `GET /rdm.json` for the table of discovered devices,
  or watch the WebSocket push / the Fixtures card. This is the pass/fail signal.
- **Board B (sim)**: one serial status line per second with its address,
  personality, current RGB, identify state, RDM response count, and the exact
  timing it is applying. That is the oracle, it tells you what timing produced
  the result you see on board A.

## Limits (so we don't oversell it)

- A 2-node short bus will not reproduce reflections or long-cable problems a real
  32-fixture line would. Fine for protocol and timing validation.
- The fuzzer rides the same ESP32 UART and timer as everything else, so the
  timing it *generates* is bounded by the same silicon. Verify the emitted
  break/mab/turnaround once with a scope or logic analyzer to trust the numbers.
- This does not replace one real commercial RDM fixture (a moving head, an RDM
  dimmer). Do both: the fuzzer for breadth, a real fixture for the reality check.
