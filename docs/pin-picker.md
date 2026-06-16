# Visual pin picker (issue #12)

Idiot-proof GPIO configuration for the device `/config` page: templates, a clickable
board diagram, and live constraint-aware validation, without bloating firmware flash.

## Why

LumiGate exposes a lot of GPIO fields (status LED, 5-LED panel, mono/colour display,
two DMX outputs x TX/RX/RTS). Typing raw GPIO numbers invites mix-ups between *pin
number* vs *GPIO number* vs the silk label, and accidental use of strapping, flash,
input-only or Ethernet-reserved pins. The picker removes the guesswork.

## Design decision: data-driven SVG, not photos

Each board is a small **JSON descriptor**. A generic renderer draws an interactive SVG
board from it, where every pin is a real clickable element bound to its GPIO number, so
there is no pixel imagemap to drift. One descriptor drives three features:

- the **diagram / picker** (`cols`),
- the **template** (`preset`),
- the **validator** (per-pin `flags`).

A photo would be both the heaviest asset and the least precise click target. SVG/JSON
descriptors are a few KB gzipped, so hundreds fit where a single ~400 KB photo would not.

### Flash budget (measured)

App partition `0x1E0000` ≈ 1.875 MB. The whole feature added ~7.5 KB to the gzipped
`config.html` embed (esp32dev: 1,545,744 → 1,553,292 bytes), leaving ~400 KB free.
Board photos are therefore kept **online only** (GitHub Pages), never embedded.

## Architecture

```
src/pages/config.html      renderer + validator + 3 built-in descriptors (offline)
src/main.cpp /info.json     adds "board" + "mcu" so the UI auto-selects the right rules
web/boards/                 catalog (index.json + per-board JSON + photos) -> GitHub Pages
hardware/gen_board_descriptor.py   generates the v3 descriptor from the PCB source
```

### Deployment split

| Part | Location | Why |
|---|---|---|
| Renderer + validator | firmware flash | small, must work offline |
| 3 core descriptors (v3, ESP32 DevKitC, ESP32-S3 DevKitC-1) | firmware flash | covers our HW + the common dev boards, fully offline |
| Long-tail / community boards | GitHub Pages, lazy-fetched + `localStorage` cache | keeps flash small |
| Board photos | GitHub Pages only | too heavy for flash |

The core flow never depends on the network. On an isolated stage LAN the three built-in
boards and manual GPIO entry still work; catalog/photo fetch failures degrade silently.

## Board auto-detection

`/info.json` carries a compile-time `board` and `mcu` id (`src/main.cpp`):

| Build | `board` | `mcu` |
|---|---|---|
| `lumigate_v3` (USE_ETH_SPI) | `lumigate_v3` | `esp32s3` |
| `wt32eth01` (USE_ETHERNET) | `wt32eth01` | `esp32` |
| `esp32s3dev` | `esp32s3-devkitc-1` | `esp32s3` |
| `esp32dev` | `esp32-devkitc` | `esp32` |

If the id matches a descriptor, the board is preselected; otherwise the page falls back
to **Custom**, which still validates against the chip family rules for `mcu`.

## Validation rules

Per active GPIO field, value `>= 0`:

- **duplicate** — same GPIO assigned to two roles -> error
- **flags** from the selected descriptor, or from the chip-family fallback for Custom:

| flag | severity |
|---|---|
| `flash`, `serial`, `range`, `reserved:*` | error |
| `input-only` used as an output | error |
| `strapping`, `usb-jtag`, `absent` (not broken out on this board) | warning |

Errors disable **Save & Restart**; warnings do not. Family fallbacks:

```
esp32   : flash 6-11, serial 1/3, input-only 34/35/36/39, strapping 0/2/5/12/15, max 39
esp32s3 : flash 26-32, serial 43/44, usb-jtag 19/20, strapping 0/3/45/46, max 48
```

## Descriptor schema and adding boards

See [web/boards/README.md](../web/boards/README.md) for the JSON schema, the `flags`
table, and the contribution flow. Regenerate the generated descriptors with:

```sh
python hardware/gen_board_descriptor.py
```

The LumiGate v3 descriptor is parsed straight from `hardware/lumigate.py` (the PCB
netlist source), so its diagram, template and Ethernet-reserved-pin rules cannot drift
from the real board.

## Board coverage

Built-in (offline) descriptors cover the common variants, which differ in pinout/layout:
LumiGate v3, ESP32 DevKitC (WROOM-32, 38-pin), ESP32 DevKit v1 (DOIT, 30-pin),
ESP32-S3 DevKitC-1 (44-pin), Seeed XIAO ESP32-S3. The 30-pin DOIT board notably omits
the flash pins (6-11) and has a different header layout than the 38-pin DevKitC, so a
single "ESP32" photo would mislead. That is exactly why the clickable diagram is
data-driven per variant.

Photos are optional online-only overlays from sources we may redistribute (own renders,
CC0, or CC-BY/CC-BY-SA with attribution); see [../web/boards/CREDITS.md](../web/boards/CREDITS.md).

## Roadmap / possible follow-ups

- More community board descriptors in the catalog (PRs welcome).
- A `wt32eth01` descriptor with the exact RMII-reserved pins.
- Optional device-side storage of a custom descriptor (today: browser `localStorage`).
