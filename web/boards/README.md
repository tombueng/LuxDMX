# LumiGate board catalog

Board descriptors for the visual pin picker in the device `/config` page (issue #12).

This folder is published by GitHub Pages together with the rest of `web/`, so the
config page fetches it from `https://tombueng.github.io/LumiGate/boards/`.

## How it is used

The five **core boards** (`lumigate_v4`, `esp32s3-devkitc-1`, `esp32-devkitc`,
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
  }
}
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

Every descriptor is generated so it cannot drift from the hardware: LumiGate v4 from the
PCB netlist (`hardware/lumigate.py`), the hand-tuned dev boards from published header
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
