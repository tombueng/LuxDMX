# RDM Plan — Remote Device Management (E1.20) for LuxDMX

Add **RDM** to LuxDMX: auto-discovery + bidirectional comms, on top of the existing
Art-Net / sACN → DMX output.

> **TL;DR** — RDM needs a transceiver whose **DE/RE (direction) pin is controlled by a GPIO**,
> plus galvanic isolation and a 120 Ω terminator. The current **Waveshare TTL→RS485 (C)** is
> *auto-direction* and **cannot do RDM**. **Note:** Amazon.de/eBay.de don't sell RDM-capable *isolated*
> boards — they're all auto-direction. Routes (see §3): **(A)** MikroE "RS485 Isolator" Click;
> **(B)** ADM2587E chip + breakout; **(C, chosen default — cheapest/no-solder)** a **3.3 V MAX3485
> board with an `EN` pin** (e.g. "RS485 V2.01", ~€1–2, **non-isolated**); **(D)** custom assembled
> PCB for isolated-at-volume. Firmware: `esp_dmx` (already used) supports RDM; cost is **one extra
> "enable" GPIO**.

---

## What RDM can do

RDM (ANSI **E1.20**) is a bidirectional layer over DMX512 — same two wires & connector, but the
controller can now query and configure fixtures, interleaved between normal DMX frames.

| Capability | What it gives LuxDMX |
|---|---|
| **Discovery** | Auto-find every RDM fixture by 48-bit **UID** (16-bit ESTA mfr ID + 32-bit device ID). |
| **Remote addressing** | Read/**set each fixture's DMX start address** over the wire — no DIP switches. |
| **Identify** | Real `IDENTIFY_DEVICE` flash to locate a fixture (better than our set-to-full trick). |
| **Device info** | Model, manufacturer, firmware, **DMX footprint**, current **personality/mode** + mode list. |
| **Labels** | Read/write a human **device label** stored in the fixture. |
| **Sensors / health** | Temperature, voltage, fan RPM, **lamp hours**, device hours, power cycles. |
| **Status / errors** | Pull queued **status messages** (warnings/faults) from fixtures. |
| **Config / reset** | Pan/tilt invert, display, fail/hold behaviour, self-test, **reset / factory defaults**. |
| **Sub-devices** | Address sub-fixtures inside one physical unit. |

**On the wire:** normal DMX uses start code `0x00`; RDM uses `0xCC`. Only the controller initiates —
it sends a request, **turns the bus around to receive** (the reason we need the GPIO-controlled
`EN`/DE-RE pin), the addressed fixture replies, then the controller resumes DMX. Discovery is a
binary search over the UID space (`DISC_UNIQUE_BRANCH` + mute/un-mute), ~hundreds of ms to ~1 s.
Timing is strict (~2 ms response window) — **esp_dmx handles all of it.**

## RDM × Art-Net × E1.31 — the key architecture fact

| Transport | Carries RDM? | Notes |
|---|---|---|
| **Physical DMX (RS485)** | ✅ | Where RDM actually happens; LuxDMX is the line's **RDM controller**. |
| **Art-Net** | ✅ | RDM opcodes `ArtTodRequest`/`ArtTodData`/`ArtTodControl` (Table-of-Devices) + `ArtRdm` (tunnel GET/SET). LuxDMX can be an **Art-Net→RDM gateway** for PC consoles. |
| **sACN / E1.31** | ❌ | E1.31 is **one-way streaming only — no RDM.** RDM-over-IP is a separate standard, **RDMnet (E1.33)** (broker/LLRP, heavy) → **out of scope.** |

Consequences for the design:
- RDM lives on the **physical line**; LuxDMX is its controller regardless of input protocol.
- RDM is **always** exposed through our **own web UI / REST / WebSocket** (discover, address, identify,
  sensors) — independent of Art-Net/sACN.
- **Optionally** re-exposed over **Art-Net** (gateway role) so a desk/PC manages fixtures *through* us.
- In **sACN mode RDM still works locally** (web UI); there's just no sACN transport. We do **not**
  implement RDMnet.
- Library note: `esp_dmx` gives RDM controller + discovery; `rstephan/ArtnetWifi` has **no** Art-Net
  RDM opcodes, so the gateway role (Phase 4) means handling `ArtTod*`/`ArtRdm` ourselves.

---

## 1. Why this needs new hardware

RDM turns the half-duplex DMX line *around*: the controller stops driving, switches its
transceiver to **receive**, and the addressed fixture briefly drives the bus back. That handover
must be timed by firmware → the MCU must own the **DE/RE** (Driver-Enable / Receiver-Enable) pin.

- **Auto-direction** transceivers (Waveshare "C", Mornsun "automatic", M5Stack DMX/RS485 units)
  decide direction from line activity. They add latency and never expose control → **RDM impossible**.
- For RDM you need a chip where **DE and /RE are pins** — usually shorted together and driven by
  one ESP32 GPIO (esp_dmx calls this the *enable*/RTS pin).

---

## 2. Firmware feasibility — already supported

`someweisguy/esp_dmx` (the lib LuxDMX already uses, v4.x) supports **RDM controller + discovery**:
`rdm_discover_devices_simple()` and `rdm_discover_with_callback()`. It expects DE+/RE tied to one
GPIO and a **120 Ω terminator** on the bus (required for RDM). 3.3 V transceivers wire directly;
5 V ones need a level shifter.

### Pin budget
| Build | DMX TX | DMX RX | New: DE/RE enable |
|---|---|---|---|
| ESP32 DevKit (WROOM-32) | GPIO17 | GPIO16 | any free GPIO (e.g. **GPIO4** or GPIO21) |
| ESP32-S3 DevKitC-1 | (current) | (current) | any free GPIO |
| **WT32-ETH01** | GPIO4 | GPIO5 | ⚠ GPIO16/17 taken by LAN8720 — pick another free pin (GPIO12/14/15/33, mind strapping) |

RDM costs **one extra GPIO** (the enable line) vs the current output-only wiring.

---

## 3. Hardware options

### Tier 1 — Isolated transceiver breakouts with controllable DE/RE  ★ best fit for a bare ESP32

Small boards: TTL side (RO/DI/DE/RE/VCC/GND) ↔ isolated RS485 side (A/B/GND).
Wire DI←ESP32 TX, RO→ESP32 RX, DE+RE→one enable GPIO. Add a 120 Ω terminator at the line end.

> ### ⚠ Reality check on availability (checked Jun 2026)
> **Amazon.de / eBay.de do NOT carry RDM-capable isolated boards.** Their "isolated RS485 modules"
> are almost all **auto-direction** (Mornsun TD-series clones, M5Stack units, "magnetic isolation
> TTL-RS485" boards) — the UART side has only RXD/TXD and switches direction automatically, so they
> **cannot do RDM**. RDM-capable isolated boards come from **electronics distributors** (Mouser,
> Digikey, TME, Bürklin, RS, LCSC), not consumer marketplaces. The two realistic routes are:
> **(A)** a MikroE "RS485 Isolator" Click board, or **(B)** buy the isolated transceiver *chip* and
> put it on a cheap SOIC-20→DIP breakout adapter or a small JLCPCB board (what most DMX builders do).

#### Route A — Ready-made boards (distributor-stocked, verified live)

mikroBUS "Click" boards don't need a mikroBUS host — wire the 2×8 header pins straight to the ESP32
(UART + the direction pin). The **enable/DE** line is on the mikroBUS **CS** (or RST) pin.

| Product | Chip / isolation | Logic | Status / price | Verified link |
|---|---|---|---|---|
| **RS485 Isolator 5 Click** (MIKROE-6887) | **ISO1452 (TI), 5 kVrms** | 3.0–5.5 V iso side | ✅ current production | [mikroe.com](https://www.mikroe.com/rs485-isolator-5-click) |
| **RS485 Isolator 3 Click** (MIKROE-5597) | isolated 5 kV | 3.3/5 V | ✅ current | [Digikey](https://www.digikey.com/en/product-highlight/m/mikroelektronika/mikroe-5597-rs485-isolator-3-click-board) |
| **RS485 Isolator 2 Click** | isolated | 3.3/5 V | ✅ current | [Mouser EU](https://eu.mouser.com/new/mikroe/mikroe-rs485-isolator-2-click/) |
| **RS485 Isolator Click** (MIKROE-2673) | **ADM2682E, 5 kVrms**, ±15 kV ESD | 3.3 V **or** 5 V (jumper) | ⚠ legacy, still stocked; ~€50 at Bürklin | [Bürklin](https://www.buerklin.com/en/Products/Active-Devices/Programming-%26-Development-Systems/System-Design-Kits-/RS485-Isolator-click-MIKROE-2673/p/74S7540) · [mikroe](https://www.mikroe.com/rs485-isolator-click) · [TME](https://www.tme.eu/en/details/mikroe-2673/add-on-boards/mikroe/rs485-isolator-click/) |
| **ElecDev ADM2587E Isolated Breakout** | ADM2587E (self-powered), 2.5 kV | 3.3/5 V | Tindie (hand-made; check seller status) | [Tindie](https://www.tindie.com/products/deltain/rs485rs422-isolated-transceiver-breakout/) |
| **ElecDev ADM2587E Isolated Arduino Shield** | ADM2587E, 2.5 kV | 3.3/5 V | Tindie | [Tindie](https://www.tindie.com/products/deltain/rs-485rs-422-isolated-transceiver-arduino-shield/) |
| **Futurlec RS422/RS485 Isolation Mini Board** | isolated | 5 V (level-shift) | small finished board | [futurlec](https://www.futurlec.com/RS422_Isolation_Board.shtml) |

> The MikroE Click "Isolator" boards are the dependable choice: in stock at major distributors that
> ship to Germany, real datasheets, DE controllable. Downside: mikroBUS pin-mapping + price (~€20–50).

#### Route B — Buy the chip + a breakout (cheapest, most flexible)

The isolated transceiver chips are cheap and **in stock**. Solder onto a **SOIC-20 (1.27 mm) → DIP
breakout adapter** (~€1, Amazon.de/AliExpress) for breadboarding, or design a 2 cm² PCB at JLCPCB.
This is how `luksal/ESP32-DMX` and most ESP32 DMX/RDM builds are done.

| Chip | Isolation | Self-powered (isoPower)? | Notes for RDM | In-stock chip link |
|---|---|---|---|---|
| **ADM2587EBRWZ** ★ | 2.5 kV, ±15 kV ESD | ✅ yes | **Slew-limited → low EMI**, ideal for 250 k DMX. DE+/RE | [LCSC ~$5.9](https://www.lcsc.com/product-detail/RS-485-RS-422-ICs_Analog-Devices-ADM2587EBRWZ-REEL7_C12081.html) · [Digikey](https://www.digikey.com/en/products/detail/analog-devices-inc/ADM2587EBRWZ/2261070) |
| **ADM2582EBRWZ** | 2.5 kV, ±15 kV ESD | ✅ yes | Full-speed variant of the above | [LCSC](https://www.lcsc.com/search?q=ADM2582EBRWZ) · [Digikey](https://www.digikey.com/en/products/result?keywords=ADM2582EBRWZ) |
| **ADM2682EBRIZ / ADM2687EBRIZ** | **5 kV**, ±15 kV ESD | ✅ yes | 2687 = slew-limited (best EMI) | [LCSC](https://www.lcsc.com/search?q=ADM2682E) · [Digikey](https://www.digikey.com/en/products/result?keywords=ADM2682E) |
| **MAX14854** | 2.75 kV | ✅ yes | DE/RE, 3.3 V | [LCSC](https://www.lcsc.com/search?q=MAX14854) · [Digikey](https://www.digikey.com/en/products/result?keywords=MAX14854) |
| **CA-IS3082W** (Chipanalog) | ≤5 kV | ✗ add B0505S | cheapest (~$0.5), DE/RE | [LCSC ~$0.5](https://www.lcsc.com/search?q=CA-IS3082W) |
| **TI ISO1410 / ISO1452** | **5 kV**, robust EMC | ✗ add B0505S | DE/RE (ISO1452 = the 5 Click chip) | [LCSC](https://www.lcsc.com/search?q=ISO1410) · [Digikey](https://www.digikey.com/en/products/result?keywords=ISO1410) |
| **ADM2486 / ADM2483** | 2.5 kV (signal) | ✗ add B0505S | **ADM2486 proven for DMX** (luksal, dir=GPIO4) | [LCSC](https://www.lcsc.com/search?q=ADM2486) · [Digikey](https://www.digikey.com/en/products/result?keywords=ADM2486) |

Helpers for Route B: **SOIC-20 → DIP adapter** ([Amazon.de](https://www.amazon.de/s?k=SOP20+SOIC20+adapter+1.27)) and,
for the non-isoPower chips, a **B0505S** isolated DC-DC ([LCSC](https://www.lcsc.com/search?q=B0505S)).

**Self-powered (isoPower) vs not:** ADM258xE / ADM268xE / MAX1485x have an isolated DC-DC inside →
single 3.3 V/5 V supply, nothing else. ISO14xx / CA-IS3082W / ADM2483/2486 are *signal-only* →
feed the bus side from an isolated supply (B0505S). Prefer an isoPower part to keep the BOM tiny.

#### Route C — Budget, no-solder, ≤ $10 (non-isolated)  ★ default for the public DIY build

A plain **3.3 V MAX3485 board that breaks out an `EN` (direction) pin** — e.g. the blue **"RS485
V2.01"** with header `EN · VCC · RXD · TXD · GND` / `GND · A · B` (sold as a RAKSTORE 2-pack on
Amazon.de, ~€1–2 each). **MAX3485 is the 3.3 V chip** (no level-shifting), and since MAX3485 has no
shutdown pin, `EN` can only be wired to the transceiver's **DE//RE → it's the single direction line
esp_dmx needs**. No soldering, no pin-lifting, no tying pins together.

| Module | ESP32 |
|---|---|
| VCC → **3.3 V** · GND → GND | |
| **TXD** | TX (GPIO17) |
| **RXD** | RX (GPIO16) |
| **EN** (direction) | enable GPIO (e.g. GPIO4) |
| A / B | XLR pin 3 / pin 2 (+ **120 Ω** at the line's far end) |

- **EN polarity:** usually HIGH = transmit, LOW = receive → maps straight to esp_dmx's enable pin;
  if discovery acts backwards, invert the enable polarity in firmware (one flag).
- **RXD/TXD gotcha:** these boards label by data path — wire same-name to same-name (TXD→ESP32 TX,
  RXD→ESP32 RX). If no data flows, **swap RXD↔TXD** (the #1 thing to check).
- **Buying rule:** the board must expose an **`EN`** pin (or full `RO/RE/DE/DI`). If the TTL side is
  only `VCC/GND/RXD/TXD` with **no enable pin**, it's auto-direction → **no RDM**.
- **Trade-off:** non-isolated. Fine for home/bench/short runs; for pro/long-cable use, offer the
  isolated **custom assembled PCB** (see *Route D*) as an upgrade.

#### Route D — Custom assembled PCB (JLCPCB / PCBWay), isolated, plug-and-play at volume

For an isolated board you can hand to others fully soldered, order a small **PCBA (turnkey)** run.
Rough estimates (exact via their online quote with Gerber + BOM; chip dominates parts cost):

| Design (isolated, RDM-capable) | parts/bd | ~10 bd | ~50 bd | ~100 bd |
|---|---|---|---|---|
| **CA-IS3082W + B0505S** (budget) | ~$2–3 | ~$11–14 | **~$6–8** | **~$4–6** |
| **ADM2587E** (self-powered, premium) | ~$6–7 | ~$16–20 | ~$11–13 | ~$9–11 |

- **JLCPCB is usually cheapest** for small PCBA, and **CA-IS3082W is LCSC-stocked** → low assembly
  surcharge. ≤ $10/board (isolated, assembled) is realistic at **~50+ pcs**.
- Bonus: list it in the **JLCPCB/PCBWay community store** so other builders order the finished board
  directly.

**Verified NOT suitable (look tempting, fail the RDM test):**
- **LeoNerd RS485 Isolator** (Tindie) — `/RE` tied to ground by design → not controllable; 1 kV. ❌
- **inpublic "ESP32 2-Universe DMX Breakout"** (Tindie, $35) — **not isolated**, WLED output-only. ❌
- Any Amazon.de/eBay.de **"isolated RS485 module"** with only RXD/TXD on the TTL side, or sold as
  **"automatic"/"no DE-RE"** (Mornsun TD-clones, M5Stack units) — auto-direction, **no RDM**. ❌
- Amazon "Anncus ADM2587E" / eBay "ADM2582E" listings — **bare chips**, not boards (= Route B parts). 

### Tier 2 — Ready-made DMX/RDM boards (XLR onboard, less wiring)

| Board | Isolation | RDM / bidirectional | Form factor | Notes | Link |
|---|---|---|---|---|---|
| **SparkFun ESP32 DMX-to-LED Shield** | 1 kVDC (opto + DC-DC) | ✅ send **and** receive (`initRead`/`initWrite` → has a direction pin) | ESP32 shield, XLR-3 in+out | Lowest-effort if you want XLR onboard; isolation is modest (1 kV) | [SparkFun guide](https://learn.sparkfun.com/tutorials/sparkfun-esp32-dmx-to-led-shield/all) |
| **Conceptinetics 2.5 kV Isolated DMX/RDM Shield R2** | 2.5 kVrms | ✅ explicit **Master / Slave / RDM transponder** | Arduino shield (5 V → level-shift for ESP32) | Purpose-built for RDM; jumper-select dir pin (D2/D3/D4). $44.95, *seller currently on break* | [Tindie](https://www.tindie.com/products/Conceptinetics/25kv-isolated-dmx-512-shield-for-arduino-r2/) |

### Tier 3 — DIY: non-isolated 3.3 V transceiver + add your own isolation

1. **3.3 V transceiver with DE/RE** (esp_dmx's recommended parts):
   - **Waveshare RS485 Board (3.3 V)** — SP3485, DE/RE exposed, 3.3 V (not isolated) — [waveshare](https://www.waveshare.com/rs485-board-3.3v.htm)
   - **SparkFun RS-485 Transceiver Breakout** — [sparkfun](https://www.sparkfun.com/sparkfun-transceiver-breakout-rs-485.html)
   - generic **MAX3485 / SP3485** module (3.3 V) or **MAX485** (5 V) — AliExpress, cents each
2. **Add isolation** between ESP32 and that transceiver:
   - **Digital isolator** on RO/DI/DE lines: ADuM1201/ADuM1402, Si8621/Si8642, or ISO7321
   - **Isolated DC-DC** for the bus side: **B0505S** (1 kV) or B0505S-2W/3 kV — [LCSC](https://www.lcsc.com/search?q=B0505S)
   - This is exactly what the integrated isoPower parts in Tier 1 do for you in one package — only
     worth it if you already have the discretes.

### ❌ Do **not** use for RDM (auto-direction — can't turn the bus on command)

| Module | Why it fails |
|---|---|
| **Waveshare TTL→RS485 (C)** *(current module)* | Automatic direction, no DE/RE pin |
| **Mornsun TD301D485H / TD501D485H** (and "-A/-E" auto variants) | "Automatic switching … no send/receive control signals" |
| **M5Stack DMX Unit (CA-IS3092W, U183)** | Grove exposes only TX/RX → auto/fixed direction, no GPIO control |
| **M5Stack Isolated RS485 Unit (CA-IS3082W)** | Same — Grove TX/RX only, auto-direction |
| Any module advertised **"automatic flow control" / "no DE-RE needed"** | By definition cannot be turned around for RDM |

> The M5Stack units use perfectly good *chips* (CA-IS309x/308x **do** have DE/RE) — it's the board
> wiring (Grove TX/RX only) that removes control. The same chip on a **Route B breakout** is fine.

### Hardware recommendation
- **Chosen default (cheap, no-solder, public DIY):** a **3.3 V MAX3485 board with an `EN` pin**
  (Route C, e.g. "RS485 V2.01", ~€1–2). Plug-and-play, RDM-capable, **non-isolated**.
- **Isolated, plug-and-play for others:** custom **PCBA** (Route D) — CA-IS3082W+B0505S, ≤ $10/bd at ~50+.
- **Most reliable single board to source:** a **MikroE "RS485 Isolator" Click** (Route A) — stocked
  at Mouser/Digikey/TME/Bürklin, DE controllable.
- **Cheapest isolated single-unit:** an **ADM2587E** chip on a SOIC-20 breakout (Route B).
- **Known-good DMX reference to copy:** ADM2486 per `luksal/ESP32-DMX` (dir = GPIO4).

---

## 4. Implementation plan (firmware + UI)

> Status: **not started.** Order/confirm the transceiver before firmware work (the enable-pin GPIO
> needs to be known/wired to test discovery).

### Architecture — bus ownership & concurrency
The **40 Hz DMX output task becomes the single owner of the RS485 bus.** RDM transactions interleave
*between* DMX frames in that same task: `send DMX frame → if an RDM request is queued, service it
(send 0xCC packet, flip EN→RX, read reply, flip EN→TX) → repeat`. esp_dmx's send/receive +
discovery calls are designed for exactly this loop.

- **Producers** (web UI, REST, Art-Net) push requests onto an **RDM request queue**; the bus task is
  the only consumer → no bus contention with the live DMX stream.
- **Results** go back via a queue/callback → WebSocket push / REST response / Art-Net reply.
- **Cadence:** full discovery **on demand** (a "Discover" button) and/or a slow background sweep
  (e.g. every 30–60 s, configurable, off by default). GET/SET are on-demand and quick (~5–10 ms each).
- DMX refresh keeps running between RDM packets, so passthrough is only marginally affected (a full
  discovery sweep is the only noticeable pause — document it).

### Data model — Table of Devices (TOD)
Per discovered fixture: `uid` (mfr:device), `manufacturerLabel`, `modelDescription`, `swVersion`,
`dmxStartAddress`, `dmxFootprint`, `currentPersonality` + `personalityCount`, `subDeviceCount`,
`identifying` flag, `sensors[]` (name/value/unit), `lastSeen`. Persist `uid → userLabel` (and
optionally the cached metadata) in NVS, mirroring how channel labels work today.

### Phase 0 — Hardware
- [ ] Choose & order hardware (default: **3.3 V MAX3485 board with `EN` pin** [Route C, non-isolated];
      isolated alt: custom PCBA [Route D] or MikroE Click [Route A]) + a 120 Ω terminator.
- [ ] Bench-wire: DI←TX, RO→RX, DE+RE(or EN)→enable GPIO, A/B to an RDM-capable test fixture.
- [ ] Pick the enable GPIO per build (ESP32: GPIO4/21; WT32-ETH01: a free non-strap pin).

### Phase 1 — DMX path with controllable direction
- [ ] Add an **`rdmEnablePin`** config value (NVS + `/config` + `/info.json`), default per board;
      add an **EN-polarity** flag (TX-active-high vs low) so any board variant works.
- [ ] Initialise esp_dmx with the enable pin instead of relying on auto-direction.
- [ ] Verify normal DMX output is unchanged (regression: Art-Net/sACN → DMX still works at 40 Hz).

### Phase 2 — RDM discovery (controller) + web UI
- [ ] Run discovery on the bus task (esp_dmx discovery API); build the **TOD** (see data model).
- [ ] `GET /rdm.json` (TOD) + push TOD over the existing WebSocket; **Discover** button.
- [ ] New **"Fixtures (RDM)"** card on the status page (reuse the table/modal styling).

### Phase 3 — RDM get/set (the useful bit)
- [ ] Read PIDs: `DEVICE_INFO`, `DMX_START_ADDRESS`, `DEVICE_LABEL`, `IDENTIFY_DEVICE`,
      `SOFTWARE_VERSION_LABEL`, `DMX_PERSONALITY(_DESCRIPTION)`, `SENSOR_VALUE`, `STATUS_MESSAGES`.
- [ ] Write: **set DMX start address**, set device label, **toggle identify**, set personality —
      via WebSocket/REST from the Fixtures card.
- [ ] Flag **address conflicts / overlaps** across the TOD (using footprints + start addresses);
      optionally auto-derive channel labels from RDM model/personality.

### Phase 4 — Art-Net RDM gateway (optional / advanced)
- [ ] Handle `ArtTodRequest` / `ArtTodControl` (AtcFlush triggers discovery) → reply `ArtTodData`
      with the TOD UID list.
- [ ] Handle `ArtRdm` (and `ArtRdmSub`): tunnel the GET/SET to the wire, return the response.
- [ ] (Requires extending UDP handling — `rstephan/ArtnetWifi` has no RDM opcodes.) Lets QLC+/consoles
      discover & manage fixtures **through** LuxDMX.
- [ ] **sACN note:** no equivalent — sACN mode = local-RDM-only via the web UI (no RDMnet/E1.33).

### Phase 5 — Polish
- [ ] Persist TOD labels (and cached metadata) in NVS; timing/interleave tuning vs the 40 Hz stream.
- [ ] Update README: hardware/BOM (new transceiver), wiring diagram, feature table, REST/WS API,
      and **flip the RDM roadmap checkbox** (the current "RDM unsupported (auto-direction)" note
      becomes the reason for the swap).
- [ ] Re-record the web-UI walkthrough (`docs/screenshot.mjs`) to include RDM discovery + addressing.

---

## Sources
- esp_dmx (RDM support, enable-pin wiring): <https://github.com/someweisguy/esp_dmx>
- luksal/ESP32-DMX (isolated ADM2486, dir = GPIO4): <https://github.com/luksal/ESP32-DMX>
- ADI isolated RS-485 in DMX512: <https://www.analog.com/en/resources/analog-dialogue/articles/isolated-rs-485-in-dmx512-lighting.html>
- ADM2582E/2587E datasheet: <https://www.analog.com/media/en/technical-documentation/data-sheets/adm2582e-2587e.pdf>
- ADM2682E/2687E datasheet: <https://www.analog.com/media/en/technical-documentation/data-sheets/adm2682e-adm2687e.pdf>
- MAX14852/14854: <https://www.analog.com/en/products/max14854.html>
- TI ISO1410 / ISO3082: <https://www.ti.com/product/ISO3082>
- Chipanalog CA-IS3082W (LCSC): <https://lcsc.com/product-detail/isolated-rs-485-422-transceivers_chipanalog-ca-is3082w_C528766.html>
- MikroE RS485 Isolator Click (ADM2682E, MIKROE-2673): <https://www.mikroe.com/rs485-isolator-click>
- ElecDev ADM2587E isolated breakout / shield (Tindie): <https://www.tindie.com/products/deltain/rs485rs422-isolated-transceiver-breakout/> · <https://www.tindie.com/products/deltain/rs-485rs-422-isolated-transceiver-arduino-shield/>
- Futurlec RS422/RS485 isolation mini board: <https://www.futurlec.com/RS422_Isolation_Board.shtml>
- SparkFun ESP32 DMX shield: <https://learn.sparkfun.com/tutorials/sparkfun-esp32-dmx-to-led-shield/all>
- Conceptinetics 2.5 kV Isolated DMX/RDM shield: <https://www.tindie.com/products/Conceptinetics/25kv-isolated-dmx-512-shield-for-arduino-r2/>
- Mornsun TD301D485H (auto-direction): <https://www.mornsun-power.com/html/products-detail/TD301D485H.html>
- M5Stack DMX Unit / Isolated RS485 Unit (auto, Grove TX/RX only): <https://docs.m5stack.com/en/unit/Unit-DMX> · <https://docs.m5stack.com/en/unit/iso485>
