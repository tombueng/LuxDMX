# LumiGate board catalog

Board descriptors for the visual pin picker in the device `/config` page (issue #12).

This folder is published by GitHub Pages together with the rest of `web/`, so the
config page fetches it from `https://tombueng.github.io/LumiGate/boards/`.

## How it is used

The three **core boards** (`lumigate_v3`, `esp32s3-devkitc-1`, `esp32-devkitc`) are
also baked into the firmware (`src/pages/config.html`) so the picker works fully
offline on an isolated stage LAN. This catalog:

- lets the config page lazily discover **additional / community boards** beyond the
  three built-ins (fetched on demand, then cached in the browser's `localStorage`),
- hosts optional **board photos** (online-only; never embedded in firmware flash),
- documents the descriptor format for contributors.

If the catalog cannot be reached, the page degrades silently to the built-in boards
plus manual GPIO entry.

## Files

| File | Purpose |
|---|---|
| `index.json` | catalog index: `{ "boards": [ {id, name, mcu, builtin}, ... ] }` |
| `<id>.json` | one descriptor per board |
| `img/<id>.png` | optional board photo referenced by a descriptor's `photo` field |

## Descriptor schema

```jsonc
{
  "id": "esp32s3-devkitc-1",        // matches /info.json "board" + the file name
  "name": "ESP32-S3 DevKitC-1",
  "mcu": "esp32s3",                  // "esp32" | "esp32s3" — picks the family fallback rules
  "photo": "img/esp32s3.png",       // optional, online-only
  "cols": [                         // two columns drawn as the two header rows
    [ { "gpio": 4, "silk": "IO4", "flags": [] }, ... ],   // left column, top -> bottom
    [ { "gpio": 1, "silk": "IO1", "flags": [] }, ... ]    // right column, top -> bottom
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

The core descriptors are generated so they cannot drift from the hardware. The
LumiGate v3 descriptor is derived directly from the PCB netlist source
(`hardware/lumigate.py`):

```sh
python hardware/gen_board_descriptor.py
```

## Adding a board

1. Add `<id>.json` following the schema above (copy a built-in as a starting point).
2. Add an entry to `index.json`.
3. Optionally add `img/<id>.png`.
4. Open a PR. Once merged to `master`, GitHub Pages redeploys and every device's
   config page can pick it from the dropdown.
