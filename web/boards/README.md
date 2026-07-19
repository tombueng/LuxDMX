# LuxDMX board catalog

Board descriptors for the visual pin picker in the device `/config` page (issue #12).

This folder is deployed to luxdmx.org alongside the site, so the config page
fetches it from `https://luxdmx.org/web/boards/`.

## How it is used

The six **core boards** (`luxdmx_v6`, `luxdmx_v5`, `esp32s3-devkitc-1`, `esp32-devkitc`,
`esp32-devkit-v1`, `xiao-esp32s3`) are also baked into the firmware
(`src/pages/config.html`) so the picker works fully offline on an isolated stage LAN.
This catalog:

- lets the config page lazily discover **all the other supported boards** beyond the
  built-ins (fetched on demand, then cached in the browser's `localStorage`),
- documents the descriptor format for contributors.

`luxdmx_v5` and `luxdmx_v4` are **previous revisions of our own board**, kept as legacy
descriptors. The current revision is `luxdmx_v6` (that is what the template and `BOARD_ID`
say), but an older board still reports or has saved its own id and fetches this catalog to
draw its pinout. Deleting a descriptor would break the picker on those boards, so they stay.
v5 shares the v6 pin map and is a built-in, so a v5 keeps working with no network at all; v4
differs and is catalog-only (an old board already carries its own copy in its firmware).

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

`phys` models a board as one row of pins down each side (`L`/`R`). Boards whose pins are on
a 2xN dual-row header per side (e.g. the LOLIN S3 Mini) or on four separate edges (Arduino
form-factor, e.g. the Metro ESP32-S3) don't fit that yet, so they stay on the fallback
renderer until the model grows a multi-column option.

Curated so far (validated by `validate_physical.mjs`): the four classics — ESP32 DevKitC
(38), NodeMCU-32S (38), ESP32 DevKit v1 (30), ESP32-S3 DevKitC-1 (44) — plus, from vendor
pinout diagrams: ESP32-S3 DevKitM-1, XIAO ESP32-S3, Adafruit Feather S3, Adafruit QT Py S3,
Unexpected Maker ProS3, TinyS3, Heltec WiFi LoRa 32 V3, LilyGO T-Display-S3, M5Stack AtomS3.
To check the curated data is well-formed:

```sh
node web/boards/validate_physical.mjs
```

The validator auto-discovers every `<id>.json` that has a `phys` block, so adding one needs
no edit there.

### Fixed wiring (`hardwired`) and headers — for boards with a fixed pinout

A purpose-built board (the **LuxDMX v6**) wires nearly everything in copper, so the picker
should not let you change those pins. Two optional fields drive that, keyed on the
**detected** board (what `/info.json` reports), not the dropdown:

```jsonc
"hardwired": [                                  // pins/fields fixed by the board
  { "field": "o0_tx", "gpio": 17, "label": "DMX A · TX → DI" },   // locks the o0_tx input to 17
  { "field": "o0_port", "val": 1, "label": "DMX A · UART port" }, // a non-pin field (no gpio)
  // ...
],
"headers": [                                    // physical connectors that ARE user-wirable
  { "ref": "J4", "name": "Display header", "pins": [
    { "pin": 1, "silk": "3V3" }, { "pin": 3, "silk": "SDA", "gpio": 4 } /* ... */ ] }
]
```

For each `hardwired` entry the config page sets the matching form field (`field`) to its
fixed value (`val`, or the `gpio` if no `val`), **disables** it, hides its pin-pick button,
and drops in a hidden mirror so the value still POSTs. The `headers` are rendered as small
pin tables so the user sees exactly which pins on the display/expansion connectors they can
actually wire to. Boards without `hardwired`/`headers` behave exactly as before.

`phys`, `hardwired` and `headers` are hand-curated; a regenerator must preserve them.

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

Every descriptor is generated from authoritative pinout data: LuxDMX from the PCB netlist
(`hardware/scripts/luxdmx.py`), the hand-tuned dev boards from published header pinouts, and the
long tail auto-derived from the arduino-esp32 core `variants/<dir>/pins_arduino.h`.

Run it with no arguments and it **checks** the committed catalog instead of overwriting it: it
regenerates everything in memory and compares, so a descriptor that has drifted from the hardware
fails the run. `--write` actually regenerates.

```sh
python hardware/scripts/gen_board_descriptor.py           # check for drift (exit 1 if any)
python hardware/scripts/gen_board_descriptor.py --write   # regenerate
```

The comparison is on parsed JSON, not bytes, because the committed files are hand-formatted
(compact, column-aligned pin tables) and that formatting is worth keeping. Formatting is not
drift; content is. Two things are curated rather than derived, since they are read off the real
board: the physical header layouts in `hardware/scripts/board_phys.json` (the `phys` key) and the
display labels on the LuxDMX board's fixed pins. Every GPIO number is derived, so the pin data
can't drift even though the cosmetics are hand-kept. `luxdmx_v4` is frozen and not regenerated.

## Adding a board

Add it to the board list in `hardware/scripts/gen_board_descriptor.py` (an `auto_board(...)` entry
is usually enough - pass the arduino-esp32 variant directory), then re-run the generator
and open a PR. Once merged to `master`, GitHub Pages redeploys and every device's config
page can pick it from the dropdown.
