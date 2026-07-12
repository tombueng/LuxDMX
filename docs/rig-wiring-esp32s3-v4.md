# HIL rig wiring, ESP32-S3 (luxdmx_v4 pinout) + MAX485 + W5500

The hardware-in-the-loop bench with an **ESP32-S3** as the controller, wired to a MAX485
transceiver for DMX/RDM and a W5500 for wired Ethernet, with an RP2350 acting as the
DMX analyzer / ground-truth / RDM responder on the bus.

Firmware: `luxdmx_v4` env (RMT DMX + the crash fixes). Flash the factory image over USB:
`esptool --chip esp32s3 --port <COM> --baud 921600 write_flash 0x0 .pio/build/luxdmx_v4/firmware.factory.bin`
(a factory flash wipes NVS → fresh config below; set WiFi/`useeth` afterwards over the serial console).

## Controller pins (luxdmx_v4 config defaults)

| Signal | S3 GPIO | config key |
|---|---|---|
| Output 0 DMX out (DI) | **GPIO17** | `o0_tx=17` |
| Output 0 RDM rx (RO)  | **GPIO18** | `o0_rx=18` |
| Output 0 DE/RE (dir)  | **GPIO8**  | `o0_rts=8` |
| Status LED (5-panel)  | 1/2/6/7/15 | `ledtype=3`, `ledr/g/y/b/w` |

## S3 → MAX485 (DMX / RDM transceiver)

```
  S3 GPIO17 (o0_tx) ─────► DI            A ─┬───────────► DMX bus A ──► RP responder
  S3 GPIO18 (o0_rx) ◄───── RO   MAX485   B ─┤
  S3 GPIO8  (o0_rts)─────► DE + RE (tied)   │  220R bias: A→3V3, B→GND ; 120R term across A/B
  3V3 ──────────────────► VCC              GND ── common
  GND ──────────────────► GND
```
- Module is DE-only style: DE and RE tied together, driven by `o0_rts`. Receiver stays live so
  the controller reads its own echo / the RDM reply on `o0_rx`.
- **Gotcha (bit us):** if the module is silk-labelled **RXD/TXD** instead of DI/RO, cross them,
  the receive line is `TXD (=RO) → MCU RX (GPIO18)`, NOT name-matched. Name-matching floats the RX
  pin: RDM sends fine but no reply comes back and discovery finds 0.

## S3 → W5500 (SPI wired Ethernet)

| W5500 | S3 GPIO | config key |
|---|---|---|
| SCS / CS   | **GPIO10** | `ethcs=10` |
| SCLK / SCK | **GPIO12** | `ethsck=12` |
| MOSI / SI  | **GPIO11** | `ethmosi=11` |
| MISO / SO  | **GPIO13** | `ethmiso=13` |
| INT        | **GPIO14** | `ethint=14` |
| RST        | **GPIO9**  | `ethrst=9` |
| VCC        | 3V3 | n/a |
| GND        | GND | n/a |

- W5500 modules are **3.3 V logic**, power from 3V3, not 5 V.
- Enable it in firmware: set both `useeth=1` and `ethon=1` (serial console), then `save reboot`. A
  bare `key=value` only writes RAM, without `save` it's gone on the next boot. Default is off, so
  out-of-the-box the board comes up on WiFi.
- **Do NOT use the generic `esp32s3dev` env's default W5500 pins**, they're inherited from the
  classic-ESP32 base and include GPIO23/25, which don't exist on the S3. Use the pins above.
- **SPI clock (bit us):** the default `ethfreq=20` (20 MHz) is fine on the real v4 board but too fast
  for flying breadboard leads, the W5500 bring-up then HANGS in `ETH.begin()` (no serial after the
  banner, looks like a wiring fault but isn't). On this jumper-wire bench it comes up clean at
  `ethfreq=8`. Drop the clock before you suspect the wiring. Recover a hung board by re-flashing the
  factory image (resets the config).

## RP2350 analyzer / responder taps

```
  RP GP5  (ground-truth UART @250k) ◄── S3 GPIO17  (o0_tx, DMX out, logic-level tap, before/at DI)
  RP GP13 (reply capture)           ◄── S3 GPIO18  (o0_rx, the RDM reply line)
  RP transceiver A/B                ◄─► DMX bus A/B  (RP is the fixture responder + PIO analyzer)
  Common GND between S3, MAX485, W5500, and the RP, required.
```
- `gtRefresh`/`gtFramingErr` (the GP5 UART) are the authoritative "is the DMX output clean" numbers.
- **Gotcha (bit us):** GPIO16 vs GPIO17. If the DMX-out tap/DI land on GPIO16 instead of 17, the S3
  reports `outfps 40` but nothing reaches the analyzer. Confirm the out signal is on **GPIO17**.

## Verified on this rig (2026-07-09)
- RMT-DMA DMX output clean: 40.0 Hz, 0 framing errors (first real-S3 validation of the RMT path).
- RDM discovery 32 fixtures + GET DEVICE_INFO / SW label / sensor polling all good.
- Crash fixes hold: 15k pkt/s flood + WS + JSON poll, 0 reboots / 0 aborts, DMX stayed clean.

## S3-specific quirks found here (now handled)
- **Only one DMA-capable RMT channel** (was: `rmt: no free tx channels` on out1). The S3 has 4 RMT
  TX channels but the IDF driver can DMA only the *last* one ("Only the last channel has the DMA
  capability"). So out0 claims the DMA channel; out1 can't get a second one. `dmx_rmt.h` now tries
  DMA first and falls back to the non-DMA refill-ISR path, so both universes init (`outfps [40,40]`).
  The refill ISR runs on core 1, away from the core-0 network DMA that made DMA necessary for #64,
  so the fallback is safe.
- **Post-flood heap fragmentation (WiFi only).** Under a heavy flood `minFree` dips to ~1 KB; afterward
  the free heap is fine (~99 KB on WiFi) but too fragmented for one big contiguous response, the
  known esp-idf #13588 behaviour. `/dmx.json` is now streamed with `sendChunked` (small ~1.4 KB
  segments, no large alloc), and `sendJsonSafe` guards the remaining dynamic-JSON handlers to a clean
  503 instead of a `bad_alloc` crash. On the **wired** S3 (heap ~153 KB) the flood produced **zero**
  503s. If you want maximum headroom, run wired.
