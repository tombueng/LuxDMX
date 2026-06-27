# LuxDMX board catalog

Board descriptors for the visual pin picker in the device `/config` page (issue #12).

This folder is deployed to luxdmx.org alongside the site, so the config page
fetches it from `https://luxdmx.org/web/boards/`.

## How it is used

The five **core boards** (`luxdmx_v4`, `esp32s3-devkitc-1`, `esp32-devkitc`,
`esp32-devkit-v1`, `xiao-esp32s3`) are also baked into the firmware
(`src/pages/config.html`) so the picker works fully offline on an isolated stage LAN.
This catalog:

- lets the config page lazily discover **all the other supported boards** beyond the
  built-ins (fetched on demand, then cached in the browser's `localStorage`),
- documents the descriptor format for contributors.

The picker draws its own **horizontal pin diagram** from each descriptor's two pin
columns. There are no board photos or realistic graphics. If the catalog cannot be
reached, the page degrades silently to the built-in boards plus manual GPIO entry.

## Files

| File | Purpose |
|---|---|
| `index.json` | catalog index: `{ "boards": [ {id, name, mcu, builtin}, ... ] }` |
| `<id>.json` | one descriptor per board |

## Descriptor schema

```jsonc
{
  "id": "esp32s3-devkitc-1",        // matches /info.json "board" + the file name
  "name": "ESP32-S3 DevKitC-1",
  "mcu": "esp32s3",                  // "esp32" | "esp32s3" — picks the family fallback rules
  "cols": [                         // two columns drawn as the top + bottom pin rows
    [ { "gpio": 4, "silk": "IO4", "flags": [] }, ... ],   // top row, left -> right
    [ { "gpio": 1, "silk": "IO1", "flags": [] }, ... ]    // bottom row, left -> right
  ],
  "preset": {                       // "Apply template" fills these fields
    "ledType": 2, "ledPin": 48,
    "dispType": 1, "dispsda": 8, "dispscl": 9,
    "outputs": [ { "en": true, "uni": 0, "port": 1, "tx": 17, "rx": 18, "rts": -1 } ]
  },
  "phys": {                         // OPTIONAL curated physical header (issue #17)
    "usb": "bottom",                // which edge the USB connector is on: top|bottom|left|right
    "pins": [                       // EVERY physical pin in its real row, both sides
      { "pos": 1, "side": "L", "silk": "3V3", "type": "power" },
      { "pos": 1, "side": "R", "silk": "GND", "type": "gnd" },
      { "pos": 4, "side": "L", "silk": "IO4", "gpio": 4, "type": "gpio" }
      // ...
    ]
  }
}
```

### Physical header (`phys`) — optional

`cols` gives the GPIO/signal pins; it has no power rails and its column placement is
approximate. `phys` adds the board's **real, full header** so the picker can draw a
wire-by-it diagram: the USB connector on the correct edge, every pin (including the
power rails) in its true position, and the board's own silk labels.

| field | meaning |
|---|---|
| `usb` | edge the USB/programming connector sits on (`top`/`bottom`/`left`/`right`) so the board is drawn the right way up |
| `pins[]` | one entry per physical pin |
| `pins[].pos` | row index down one side, `1` = nearest the USB end |
| `pins[].side` | `"L"` (left header) or `"R"` (right header), board viewed with USB toward you |
| `pins[].silk` | the label printed on the board (`3V3`, `GND`, `EN`, `D21`, `IO4`, `VP`, ...) |
| `pins[].gpio` | the GPIO number — only on `type:"gpio"` pins; omitted for everything else |
| `pins[].type` | `power` \| `gnd` \| `en` \| `gpio` \| `nc` |

Only `type:"gpio"` pins are clickable/assignable; `power`/`gnd`/`en`/`nc` pins are shown
greyed and inert (so you can wire VCC/GND/EN by the diagram but can't assign a signal to
them). Every `gpio` listed in `phys` must also exist in `cols`. Boards **without** `phys`
fall back to the original horizontal two-column diagram, so this is fully optional.

Curated so far (validated by `validate_physical.mjs`): **ESP32 DevKitC (38-pin)**,
**NodeMCU-32S (38-pin)**, **ESP32 DevKit v1 (DOIT, 30-pin)**, **ESP32-S3 DevKitC-1
(44-pin)**. To check the curated data is well-formed:

```sh
node web/boards/validate_physical.mjs
```

### Pin `flags`

| flag | meaning | severity in validator |
|---|---|---|
| `strapping` | boot strapping pin | warning |
| `input-only` | cannot drive an output | error if used as an output |
| `usb-jtag` | native USB D+/D- | warning |
| `serial` | USB-UART console | error |
| `flash` | wired to SPI flash | error |
| `reserved:eth-spi` | used by the W5500 Ethernet SPI bus | error |
| `reserved:eth-rmii` | used by an RMII PHY | error |
| (none) | free GPIO | ok |

Pad colour: green = free, amber = caution (`strapping`/`usb-jtag`/`input-only`),
red = do-not-use (`flash`/`serial`/`reserved:*`), blue ring = currently assigned.

## Regenerating

Every descriptor is generated so it cannot drift from the hardware: LuxDMX v4 from the
PCB netlist (`hardware/luxdmx.py`), the hand-tuned dev boards from published header
pinouts, and the long tail auto-derived from the arduino-esp32 core
`variants/<dir>/pins_arduino.h`:

```sh
python hardware/gen_board_descriptor.py
```

## Adding a board

Add it to the board list in `hardware/gen_board_descriptor.py` (an `auto_board(...)` entry
is usually enough - pass the arduino-esp32 variant directory), then re-run the generator
and open a PR. Once merged to `master`, GitHub Pages redeploys and every device's config
page can pick it from the dropdown.
