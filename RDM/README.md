# LuxDMX RDM Simulator & Analyzer (RP2350)

A cycle-accurate, **multi-fixture RDM (E1.20) simulator** and, longer term, a standalone
**DMX/RDM analyzer**, built on the **Pimoroni Pico Plus 2 W** (RP2350B). The goal is a bench
tool that's better than anything on the market: put a whole rig's worth of virtual RDM
fixtures on one RS485 bus, behave (and misbehave) like real hardware, and measure exactly how
a controller — specifically LuxDMX's ESP32-S3 — copes.

> Prototyping now, built as a real product. Lives in this `RDM/` subfolder so it can be pulled
> out into its own repo later.

## Why RP2350
PIO gives exact 250 kBaud break / MAB / turnaround (and can mangle it on demand), which an MCU
UART can't; dual Cortex-M33 + 8 MB PSRAM hold hundreds of fixtures + an on-wire capture; the RM2
radio drives the web UI and the eventual RDM-over-network work.

## Hardware / wiring
- Pimoroni Pico Plus 2 W (RP2350B, 8 MB PSRAM, WiFi/BT, 16 MB flash, USB-C).
- MAX3485 (3.3 V) half-duplex RS485 transceiver:
  - `GP0` → RO (RX)   `GP1` → DI (TX)   `GP2` → DE+RE (low = receive)
  - A/B on the bus with the DUT, common DMX ground, 120 Ω termination.
- The transceiver's RO/DI can be wired either way — auto-detect is on the roadmap (see below).

## Web UI (WiFi)
The sim brings up its own WiFi access point and serves a self-contained dashboard — no internet
needed, styling is embedded.
- **SSID:** `LuxDMX-RDM-Sim`  **password:** `luxrdm-sim`  **URL:** `http://192.168.42.1/`
  (exact IP is printed on the serial `[boot]` line).
- Tabs: **Dashboard** (live metrics + RDM activity feed + bus-health bars), **Fixtures** (table +
  bulk generate), **RDM Monitor** (discovery-tree log + found devices), **Analyzer** (DMX
  framing-error counter + refresh/slots/break, Swisson-style, plus RDM integrity + E1.11/E1.20
  reference), **Stress/Fuzz** (fault injection), **Settings** (turnaround, count).
- JSON API: `GET /api/status|/api/metrics|/api/fixtures|/api/log`, `POST /api/config|/api/unmute|/api/fuzz|/api/analyzer/reset`.
- WiFi runs on core 0; the RDM engine runs on core 1 with its own PIO state machines (claimed before
  the radio inits), so the web UI never disturbs RDM timing — verified on hardware.

## Console (USB serial, 115200, one command per line)
```
t<us>   responder turnaround delay (E1.20 window 176..2000 us)
f<n>    active fixture count (1..200), regenerates the virtual bus
r       un-mute all fixtures      v  toggle per-DUB depth trace     ?  status
m       metrics (reAsk, resp, rdmReq, badCsum, rxStall, muted)
a       DMX analyzer stats (framing errors / refresh / slots / break);  ar  resets the window
```
The sim auto-reports each discovery sweep: `[disc#N] discovered X/Y (…missed) responses=… S3-dropped-replies=… turnaround=…`.

## Status
- **M0** bring-up (USB, activity LED) — **done**
- **M1.1** PIO DMX receive (channel-accurate) — **done**
- **M1.2** decode RDM requests (custom PIO RX + message-length framing) — **done**, verified on wire
- **M1.3** reply within the turnaround: DISC_UNIQUE_BRANCH response + DISC_MUTE ACK — **done**
- **M2** many fixtures + real binary-search discovery — **working** (controller walks a deep tree
  and discovers virtual fixtures). Crowded-bus reliability: **root-caused** to ~30% RDM *request*
  corruption at the half-duplex turnarounds (the S3 catches our *responses* fine). See below.
- **M3** GET/SET PID set (DEVICE_INFO, SOFTWARE_VERSION_LABEL, DEVICE_MODEL_DESCRIPTION,
  MANUFACTURER_LABEL, SUPPORTED_PARAMETERS, DMX_START_ADDRESS, IDENTIFY_DEVICE; NACK others) — **done**
- **M4** fault injection (drop % of replies, late turnaround, corrupt checksum, flaky mute) — **core done**,
  wired to the web Stress tab; more quirks (runt breaks, baud drift) on the list
- **M6** WiFi AP + self-contained web UI + JSON API — **done**, RDM-timing-safe (verified on hardware)
- **DMX framing-error analyzer (issue #64)** — the sim now counts DMX framing errors on the wire like
  a Swisson tester (dedicated pio1 SM samples 8 data + stop bit; break/frame from the inter-slot gap).
  Built to test the "core-separation" fix for [#64](https://github.com/tombueng/LuxDMX/issues/64) —
  **firmware + rig done**, A/B measurement is the next bench step. See `docs/ISSUE_64_CORE_SEPARATION.md`.
- **Reliability investigation** — `docs/RDM_S3_RX_RELIABILITY.md` + `docs/FINDINGS.md`. Headline:
  **no S3 RDM-RX bug** (the S3 catches its responses, reAsk ≈ 0). ~30% of requests arrive corrupt at
  the sim = **~9% rig physical layer** (bias present, controller reset both ruled out) + **~21% the
  sim's own half-duplex turnaround**. To close: logic-analyzer capture (S3 serial = COM5) + a real
  PCB front end for the sim. Do NOT loosen the checksum-validating decoder to hide it.

## Roadmap
- **Close the reliability finding**: logic-analyzer capture of a turnaround; add fail-safe bias and
  re-run the crowded-bus sweep; also re-check the physical RS485 wiring.
- **M5** bus-load model + DMX latency/refresh/flicker meter (how much does RDM traffic hurt DMX?).
- **M4+** more fuzz quirks: runt/short breaks, baud drift, preamble-length variation, NACK storms.
- **M7** RDM over Art-Net (ArtRdm) / sACN (E1.31 level + E1.33).
- **Analyzer** standalone DMX/RDM analyzer product (same PIO capture + PSRAM ring buffer core).
- **Web UI next**: per-fixture inline edit, sensor sim, timing-scope (µs break/MAB/turnaround view),
  DMX channel monitor, record/replay of a controller's transaction stream, CSV/PCAP export.

## Feature vision (why it beats what's on the market)
Bench RDM testers today are either expensive closed boxes or a USB dongle + PC app. This aims to be:
- **A crowded bus in one box** — dozens–hundreds of fixtures with independent UID / address /
  footprint / personality / sensors / mute state, from a single node, no rack of real fixtures.
- **Deliberately hostile** — every out-of-spec timing and malformed-packet trick real fixtures pull,
  toggleable, so a controller gets stress-tested, not just happy-path.
- **Measuring, not just talking** — direct metrics (dropped replies, turnaround histogram, discovery
  tree depth, DMX jitter under RDM load) instead of "seems to work".
- **Standalone + networked** — runs headless on the bench or driven from a web UI; bridges to
  Art-Net/sACN so you can test network→wire RDM.
- **Open** — reproducible, scriptable, and hackable, unlike closed testers.

### Backlog of feature ideas (grow this list continuously)
- Scenario/record-replay: capture a real controller's transaction stream and replay/mutate it.
- Per-fixture fault injection UI (drop N% of responses, add jitter, wrong checksum, NACK storms).
- Sub-devices and proxies (DISC binding UID, managed proxies) for deep discovery tests.
- Sensor simulation with live-changing values + status messages / queued messages.
- Full E1.37-1/-2 PID coverage (dimmer curves, lock states, power, IP settings).
- Discovery collision realism: true overlapping collision waveforms (not just single-responder).
- Timing scope view: break/MAB/turnaround measured to the microsecond, pass/fail vs E1.20 limits.
- DMX side: framerate/flicker analysis, per-slot value graphs, break-length + MBB measurement.
- Export: CSV/JSON transaction logs, PCAP-like capture, shareable test reports.
- Conformance suite: automated E1.20 controller test checklist with pass/fail + evidence.
- Multi-node: several of these boxes on one bus for very large / multi-manufacturer rigs.
- USB or network control API so it slots into CI for the LuxDMX firmware.

## Build & flash
```
pio run -e pico_plus_2w -t upload      # auto-resets into BOOTSEL
```
Serial console 115200 (assert DTR — the RP2350 USB CDC gates output on it).
