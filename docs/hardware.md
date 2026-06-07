# Hardware Plan — LumiGate Carrier PCB (Ethernet + WiFi + isolated DMX/RDM)

A carrier ("baseboard") that a ready-made **Olimex ESP32-POE-ISO** module plugs into, adding an
**isolated RS485 DMX/RDM** output, **USB-C power**, and an **addressable RGB status LED**.

> **Design goal** — keep all machine-placed parts in the **LCSC/JLC library** so the board
> auto-assembles at JLCPCB/PCBWay; only the **module sockets + XLR + USB-C** are hand-soldered
> through-hole. This is what makes the design cleanly **re-orderable by anyone** from the published
> files. See [rdm.md](rdm.md) for the firmware/RDM context that drives the transceiver choice.

---

## 1. Module choice

| | Detail |
|---|---|
| **Module** | **Olimex ESP32-POE-ISO** (primary) — plain **ESP32-POE** is a drop-in alternative (same footprint/pinout, no Ethernet isolation) |
| **MCU** | **ESP32-WROOM-32E** (classic dual-core Xtensa LX6, 4 MB flash, 520 KB RAM, WiFi + BT). The original ESP32 is required — only it has the **EMAC** for native RMII Ethernet (S2/S3/C3 do not). |
| **Ethernet** | LAN8710 PHY on RMII; **POE-ISO adds 3000 VDC galvanic isolation** of the Ethernet supply |
| **Power in** | **Three user-selectable options:** (1) **PoE** via RJ45, (2) module **micro-USB**, or (3) **optional carrier USB-C** (populate only if wanted) — all feed the module 5 V rail |
| **Onboard LEDs** | PWR / CHRG / Ethernet LNK / ACT only — **none are GPIO-controllable**, so we add our own RGB |
| **Flashing** | Module micro-USB (onboard USB-serial) or OTA (already configured). Carrier USB-C is **power-only**. |

Why POE-ISO: we already build an **isolated** DMX front end, so an isolated-Ethernet module yields a
fully isolated product (Ethernet + DMX + power references all separated). ~€5 over the plain POE.

---

## 2. Block diagram

```
 Power: PoE (RJ45) │ module micro-USB │ optional carrier USB-C ── all OR'd onto module 5V
                  ▼
            [Olimex ESP32-POE-ISO]  (regulates 3V3 on-board)
               │ 3V3   │ GND   │ GPIO4   │ GPIO36 │ GPIO32 │ GPIO33
               │       │       │ (TX/DI) │ (RX/RO)│ (EN)   │ (RGB)
        ┌──────┴───────┴───────┴─────────┴────────┴────────┴────────┐
        │ LOGIC DOMAIN  (GND1, 3V3)                                   │
        │   DI ◄─TX   RO ─►RX   DE+/RE ◄─EN (+10k pulldown)           │
        │                    ADM2587E                                 │
        │     ‖ isolation barrier ‖  + integrated isoPower (VISO)     │
        │ BUS DOMAIN  (GND2, VISO)                                    │
        │   Y─A ──┬───────────────┬────► XLR-5 pin 3 (Data+)          │
        │   Z─B ──┼──[120Ω jmp]───┤────► XLR-5 pin 2 (Data−)          │
        │         └──[SM712 TVS]──┘                                   │
        │                    GND2 ───────► XLR-5 pin 1 (shield)       │
        └────────────────────────────────────────────────────────────┘
   5V ─► [74LVC1G125 buffer] ─► WS2812B RGB (DIN), data from GPIO33
```

---

## 3. GPIO assignment

Reserved on this board: **0/12/18/19/21/22/23/25/26/27** (Ethernet), **1/3** (programming UART),
**2** (microSD), **6–11** (flash). Strapping pins avoided for driven lines: **0/2/5/12/15**.
WROVER variant also uses **16/17** (PSRAM) → avoided for cross-variant safety.

| Net | ADM2587E / device pin | ESP32-POE pin | Header pin | Rationale |
|---|---|---|---|---|
| `DMX_TX` | `DI` (driver in) | **GPIO4** | EXT1.9 | Olimex-recommended safe output |
| `DMX_RX` | `RO` (receiver out) | **GPIO36** | EXT2.2 | input-only pin — valid UART RX, frees a real GPIO |
| `DMX_EN` | `DE` + `/RE` (tied) | **GPIO32** | EXT2.6 | free, non-strapping output |
| `RGB_DIN` | WS2812 DIN (via buffer) | **GPIO33** | EXT2.5 | free, non-strapping output |

All driven lines (4/32/33) are non-strapping; RX uses input-only GPIO36.
> ⚠ **GPIO35 is NOT free on the POE-ISO** (wired to LiPo battery sense) — that's why RX uses GPIO36.
> **GPIO33 is free only on the standard WROOM-32E variant**; the **WROVER** variant remaps it
> (GPIO16→GPIO33), so if anyone builds with a POE-ISO-WROVER the RGB pin must move.

### 3.1 Olimex ESP32-POE-ISO header pinout (Rev.I, verified)
Two 1×10 female-header sockets, 2.54 mm pitch, **25.4 mm (1") apart**. **Pin 1 (+5V) is at the end
OPPOSITE the RJ45/USB** — the USB and Ethernet connectors are on the pin-10 end and overhang it
(USB ~7 mm, RJ45 ~39 mm beyond pin 10), per the Rev.I PCB.

**Mechanical stack-up (verified to mate, 2026-06-07):** the module mounts on the carrier via a
matched pair of headers — **2× 1×10 male pin header (2.54 mm)** soldered into the Olimex EXT1/EXT2,
plugging into **2× 1×10 female socket strip (2.54 mm)** on the carrier (footprint `U1`). Both sides
measured identical: 10 pins, **2.54 mm pitch**, **25.40 mm row spacing** → they plug straight in.
The module then floats ~8.5 mm above the carrier on the sockets (clears all carrier SMD beneath).

| Pin | EXT1 | EXT2 |
|---|---|---|
| 1 | **+5V** | GPIO39 (in) |
| 2 | **+3.3V** | **GPIO36** → DMX_RX |
| 3 | **GND** | GPIO35 (batt sense) |
| 4 | ESP_EN | GPIO34 (button) |
| 5 | GPIO0 | **GPIO33** → RGB |
| 6 | GPIO1 | **GPIO32** → DMX_EN |
| 7 | GPIO2 | GPIO16 |
| 8 | GPIO3 | GPIO15 |
| 9 | **GPIO4** → DMX_TX | GPIO14 |
| 10 | GPIO5 | GPIO13 |

---

## 4. Net table by section

### 4.1 Module socket + power
Power comes from **PoE** (module RJ45) or the **module micro-USB** out of the box. The USB-C
**support circuit (F1, D2, D3, Rcc1/2) is always populated** so every board has the same SMT
assembly; **only the USB-C connector (J_USB) is the hand-solder option** — solder it to add a USB-C
inlet. D3 ORs USB-C onto the 5 V rail so it's safe even if PoE/micro-USB are also connected; with the
connector unfitted, `VBUS_C` simply floats and the passives sit idle.

| From | Net | To | Populate |
|---|---|---|---|
| F1 (polyfuse) → **D3 Schottky** | `VBUS_C` → `5V` | ORs USB-C onto 5 V rail | always |
| D2 (SMAJ5.0A) | `VBUS_C` → GND | VBUS surge clamp | always |
| Rcc1, Rcc2 (5.1 kΩ each) | CC1/CC2 → GND | sink advertisement (required for 5 V from a charger) | always |
| **USB-C receptacle** | VBUS/CC/GND | the connector itself | **optional (hand-solder)** |
| `5V` | `5V` | module **5V** pin (also fed internally by PoE / micro-USB) | always |
| Module **3V3** out | `3V3` | ADM2587E VCC, logic pull-ups, decoupling | always |
| Module **GND** | `GND` (= GND1) | logic ground | always |

### 4.2 Logic interface (ESP ↔ ADM2587E, GND1 / 3V3 domain)
| From | Net | To |
|---|---|---|
| GPIO4 | `DMX_TX` | ADM2587E `DI` (opt 0 Ω series, DNP 33 Ω) |
| ADM2587E `RO` | `DMX_RX` | GPIO36 (opt 0 Ω series) |
| GPIO32 | `DMX_EN` | ADM2587E `DE` **and** `/RE` (tied); **10 kΩ pull-down to GND1** |
| `3V3` | VCC | ADM2587E VCC + **0.1 µF ∥ 10 µF** to GND1 |

`DMX_EN`: HIGH = transmit, LOW = receive (esp_dmx enable/RTS pin). The 10 kΩ pull-down forces
**receive** at power-up so the board never drives the bus before firmware takes control. If RDM
discovery behaves inverted, flip the firmware EN-polarity flag (see [rdm.md](rdm.md) Phase 1).

### 4.3 Isolated RS485 / DMX bus (GND2 / VISO domain)
| From | Net | To |
|---|---|---|
| ADM2587E `Y` | — | tie to `A` (2-wire half-duplex) |
| ADM2587E `Z` | — | tie to `B` (2-wire half-duplex) |
| `A` (=Data+) | `DMX_A` | XLR-5 **pin 3**; 120 Ω via **JP1** to `B`; SM712 ch.1 |
| `B` (=Data−) | `DMX_B` | XLR-5 **pin 2**; SM712 ch.2 |
| ADM2587E `VISOOUT` (pin 12) | `VISO` | **must be tied to `VISOIN` (pin 19)** per datasheet; **0.1 µF ∥ 10 µF** to GND2. Do not feed an external supply into it — the 12↔19 link is the isoPower output looping back to its input. |
| `GND2` | bus common | XLR-5 **pin 1** (shield) |
| (DNP) bias R's | — | `A`↑3V3iso, `B`↓GND2 pads — ADM2587E has fail-safe, fit only if a fixture misbehaves |

XLR-5 pins **4/5** = NC pads (optional 2nd data link). A/B↔pin polarity note on silk: if a console
reads inverted, swap pin 2/3 (the classic DMX A/B confusion).

### 4.4 RGB status LED
| From | Net | To |
|---|---|---|
| GPIO33 | `RGB_DIN` | 74LVC1G125 input (A); buffer VCC = `5V` |
| 74LVC1G125 output (Y) | — | ~330 Ω series → WS2812B `DIN` |
| `5V` | LED VDD | WS2812B + **0.1 µF** decoupling |

Buffer shifts 3.3 V data to a clean 5 V level for full brightness/reliability. Cheap fallback:
power the WS2812 at 3.3 V and omit the buffer (works on most parts, slightly dimmer).

---

## 5. BOM (machine-placed = LCSC; hand-solder marked ✋)

| Ref | Part | Pkg | LCSC | Notes |
|---|---|---|---|---|
| U1 | **ADM2587EBRWZ** | SOIC-20W | C12081 | isolated transceiver + isoPower |
| U2 | 74LVC1G125 | SOT-23-5 | basic | 3.3→5 V data buffer (RGB) |
| D1 | **SM712** (CDSOT23-SM712) | SOT-23 | stocked | RS485 TVS |
| D2 | SMAJ5.0A | SMB | basic | USB-C VBUS TVS |
| D3 | SS34 Schottky | SMA | basic | USB-C ORing diode |
| F1 | Polyfuse ~1 A | 1206 | basic | USB-C VBUS |
| R1 | 120 Ω | 0805 | basic | termination (via JP1) |
| R2 | 10 kΩ | 0805 | basic | DMX_EN pull-down |
| R3–R5 | 0 Ω (opt 33 Ω) | 0805 | basic | logic series, fit 0 Ω |
| R6 | 330 Ω | 0805 | basic | RGB data series |
| Rcc1/2 | 5.1 kΩ | 0805 | basic | USB-C CC pull-downs |
| Rb1/2 | bias | 0805 | — | DNP (fail-safe option) |
| C1,C3 | 0.1 µF | 0805 | basic | VCC + VISO decoupling |
| C2,C4 | 10 µF | 0805/1206 | basic | VCC + VISO bulk |
| C5 | 0.1 µF | 0805 | basic | 3V3 header bulk |
| C6 | 0.1 µF | 0805 | basic | RGB decoupling |
| LED1 | WS2812B / SK6812 | 5050 | basic | status RGB |
| J1 | **XLR-5 PCB-mount** (Neutrik NC5 / generic) | THT | ✋ | DMX out |
| J_USB | USB-C receptacle (power) | THT/SMD | basic | power inlet — **only optional/hand-solder part** |
| J2/J3 | 2× female headers (match ESP32-POE) | THT | ✋ | module socket |
| JP1 | 2-pin header / solder-bridge | THT | ✋ | termination select |

---

## 6. Firmware changes (PlatformIO)

Add an `esp32-poe` env to [platformio.ini](../platformio.ini) (LAN8710 PHY, different power/clock
pins than the WT32-ETH01 LAN8720) with carrier pin defaults:

```ini
; ── Olimex ESP32-POE / POE-ISO (carrier PCB) ────────────────────────────────
[env:esp32-poe]
board       = esp32-poe-iso        ; or esp32-poe
upload_speed = 460800
build_flags =
    ${env.build_flags}
    -DUSE_ETHERNET
    -DDEF_DMX_TX_PIN=4
    -DDEF_DMX_RX_PIN=36
    -DDEF_RDM_EN_PIN=32            ; DE/RE enable (RDM Phase 1)
    -DDEF_LED_PIN=33
    -DDEF_LED_TYPE=2              ; WS2812 RGB
    ; ETH PHY type/addr/clock/power pins set per Olimex (LAN8710, GPIO12 power)
```

Pair with the [rdm.md](rdm.md) Phase 1 work: add `rdmEnablePin` + EN-polarity config (NVS + /config).

---

## 7. Layout notes (for the KiCad step)

- 2-layer is fine. Maintain the **isolation keep-out gap** under the ADM2587E barrier (no copper, no
  traces bridging GND1↔GND2); split the ground plane into **GND1** and **GND2** with the gap under U1.
- Decoupling caps right at U2's VDD and VISOOUT/VISOIN pins, on their respective ground sides; keep
  the short VISOOUT(12)↔VISOIN(19) link tight to the chip.
- Keep `A/B` traces short and as a pair from U1 → SM712 → JP1 → XLR; terminator close to the connector.
- USB-C VBUS: short, wide; CC resistors near the receptacle.
- Place WS2812 where the indicator is visible through the enclosure; buffer near the LED.

---

## 7b. Design source (schematic-as-code)

The electrical design is captured in [../hardware/lumigate_carrier.py](../hardware/lumigate_carrier.py)
(SKiDL) and generated to a KiCad netlist [../hardware/lumigate_carrier.net](../hardware/lumigate_carrier.net).
ERC passes with **0 errors**; U2's pin numbers are datasheet-verified. Import the netlist into Pcbnew
to begin layout. See [../hardware/README.md](../hardware/README.md) for regeneration + the footprint TODO.

## 8. Open-source / ordering

- Publish Gerbers + **BOM** + **CPL** (pick-and-place) + schematic + this doc under **CERN-OHL-S**
  (hardware) — firmware keeps its own license.
- Anyone can order from **JLCPCB / PCBWay** (China) or **Aisler / Eurocircuits** (EU) by uploading the
  three files; only the module, XLR, USB-C and headers are hand-soldered.
- Optionally list it in the **PCBWay / JLCPCB shared-project** store for one-click ordering.

---

## 9. Open points

- [x] Olimex ESP32-POE-ISO **header pinout** — verified from Rev.I (see §3.1). Two 1×10, 2.54 mm,
      25.4 mm apart.
- [ ] Confirm the **longitudinal alignment / board origin** of EXT1↔EXT2 against the Rev.I dimension
      drawing before finalising the `Olimex_ESP32-POE-ISO_socket` footprint (signal order is locked;
      only the exact x/y of pin 1 needs the mechanical drawing).
- [ ] Confirm exact ETH PHY config flags for the `esp32-poe-iso` board in the firmware.
- [ ] Choose XLR vendor (Neutrik NC5FBH vs generic) → fixes J1 footprint.
- [ ] Decide enclosure → drives connector edge placement.
