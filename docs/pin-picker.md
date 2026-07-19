# Visual pin picker (issue #12)

Idiot-proof GPIO configuration for the device `/config` page: templates, a clickable
board diagram, and live constraint-aware validation, without bloating firmware flash.

## Why

LuxDMX exposes a lot of GPIO fields (status LED, 5-LED panel, mono/colour display,
two DMX outputs x TX/RX/RTS). Typing raw GPIO numbers invites mix-ups between *pin
number* vs *GPIO number* vs the silk label, and accidental use of strapping, flash,
input-only or Ethernet-reserved pins. The picker removes the guesswork.

## Design decision: a generated diagram, not photos

Each board is a small **JSON descriptor**. A generic renderer draws an interactive,
horizontal **diagram** from it (pins along the horizon, vertical silk+GPIO labels,
assigned-function callouts above/below, status colours), where every pad is a real
clickable element bound to its GPIO number, so there is no pixel imagemap to drift.
One descriptor drives three features:

- the **diagram / picker** (`cols`),
- the **template** (`preset`),
- the **validator** (per-pin `flags`).

There are deliberately **no board photos and no realistic/Fritzing graphics**: too few
ESP32/-S3 boards have clean-license images to make that worthwhile, and a photo is both
the heaviest asset and the least precise click target. The generated diagram works the
same for every board and is a few KB of JSON, so the whole catalog fits where a single
~400 KB photo would not.

### Flash budget (measured)

App partition `0x1E0000` ≈ 1.875 MB. The picker adds only a few KB to the gzipped
`config.html` embed; the per-board catalog is fetched online and never embedded, so the
firmware footprint stays small regardless of how many boards the catalog grows to.

## Architecture

```
src/pages/config.html      renderer + validator + 5 built-in descriptors (offline)
src/main.cpp /info.json     adds "board" + "mcu" so the UI auto-selects the right rules
web/boards/                 catalog (index.json + per-board JSON) -> GitHub Pages
hardware/scripts/gen_board_descriptor.py   descriptor generator + drift check (see below)
```

### Deployment split

| Part | Location | Why |
|---|---|---|
| Renderer + validator | firmware flash | small, must work offline |
| 5 core descriptors (LuxDMX v6, ESP32 DevKitC, ESP32 DevKit v1, ESP32-S3 DevKitC-1, XIAO S3) | firmware flash | covers our HW + the common dev boards, fully offline |
| The rest of the catalog | GitHub Pages, lazy-fetched + `localStorage` cache | keeps flash small |

The core flow never depends on the network. On an isolated stage LAN the built-in
boards and manual GPIO entry still work; catalog fetch failures degrade silently.

## Board auto-detection

`/info.json` carries a compile-time `board` and `mcu` id (`src/main.cpp`):

| Build | `board` | `mcu` |
|---|---|---|
| `wt32eth01` (USE_ETHERNET) | `wt32eth01` | `esp32` |
| `esp32s3dev` | `esp32s3-devkitc-1` | `esp32s3` |
| `esp32dev` | `esp32-devkitc` | `esp32` |
| `esp32s3dev` + `-DBOARD_LUXDMX_V6` | `luxdmx_v6` | `esp32s3` |

The **LuxDMX v6** has no dedicated build — it runs the released `esp32s3dev` firmware (so it reports
`esp32s3-devkitc-1`) and gets its fixed pin map from the **LuxDMX v6** board template applied in
`/config`. Only a source build with the `-DBOARD_LUXDMX_V6` escape hatch reports `luxdmx_v6` from
detection alone.

The older **v4** revision lives in the online catalog only, as a legacy descriptor.

Detection is only the **fallback**, because it is compile-time and can't tell a v6 from a bare
DevKitC. The board you pick is saved on the device (config key `board`, reported back as
`/info.json` `boardSel`) when you hit Save, and that saved pick is what the dropdown restores on
every later visit, so a reboot or a firmware update no longer drops it back to the detected board.
`Custom / manual` is a real choice too, so it sticks instead of snapping to detection. Only a
device that has never had a board picked falls back to the detected id, and if that matches no
descriptor, to **Custom**, which still validates against the chip family rules for `mcu`. The board
can also be switched from a dropdown inside the pin-picker popup itself.

The pick is UI state: the firmware itself never reads it, it only stores it. Copper-pin locks and
the diagram follow it (see below), nothing else does.

## Validation rules

Per active GPIO field, value `>= 0`:

- **duplicate** — same GPIO assigned to two roles -> error
- **flags** from the selected descriptor, or from the chip-family fallback for Custom:

| flag | severity |
|---|---|
| `flash`, `serial`, `range`, `reserved:*` | error |
| `input-only` used as an output | error |
| `strapping`, `usb-jtag`, `absent` (not broken out on this board) | warning |

Errors disable **Save & Restart**; warnings do not.

The `reserved:eth-spi` / `reserved:eth-rmii` flag guards the Ethernet bus against *other*
roles, but it is **not** raised against the Ethernet role fields themselves
(CS/SCK/MOSI/MISO/INT/RST, or the RMII MDC/MDIO/PWR/CLK) — those fields legitimately own
those GPIOs, so a board that hard-wires its own W5500 never flags its own pins (that used
to block Save on the LuxDMX v4). On a board that fixes its pins in copper the hard-wired
fields are locked read-only; an **Advanced: unlock the fixed GPIO pins** toggle re-enables
them for anyone who reworked the board.

The lock follows the **selected** board, not only the one the firmware auto-detects. That
matters because the v6 ships as the generic `esp32s3dev` build (it reports
`esp32s3-devkitc-1`): the moment you pick **LuxDMX v6** in the dropdown, its W5500 / DMX /
LED pins snap to the board values and lock, so you can't accidentally move the Ethernet or
DMX pins. Switch the board back (or hit Advanced unlock) to edit them again.

**Header pins stay editable.** Pins that reach a user header are deliberately *not* in
`hardwired`, so they stay pickable even on a fixed-pin board. On the LuxDMX v6 that's the
J4 display header (SDA/SCL/SCK/MOSI/CS/DC/RST) and the J6 expansion header — you can point
the display at the J4 defaults or wire it to J6 instead, whatever you soldered. The board
card lists each header's pinout, and the diagram tags every header GPIO with its physical
header pin (e.g. `G4 · J4.3`, tooltip `GPIO4 · J4 pin 3 (SDA)`). This is also where future
add-on inputs (buttons, a rotary encoder) will bind — any header GPIO is fair game.

Family fallbacks:

```
esp32   : flash 6-11, serial 1/3, input-only 34/35/36/39, strapping 0/2/5/12/15, max 39
esp32s3 : flash 26-32, serial 43/44, usb-jtag 19/20, strapping 0/3/45/46, max 48
```

## Physical header diagram (issue #17)

The plain descriptor (`cols`) only lists the GPIO/signal pins, so the old diagram had
no 3V3 / 5V / VIN / GND / EN to wire VCC/GND by, the column order was approximate, and
the labels were `Gxx`/`IOxx` rather than the board's silk. Boards that ship a curated
`phys` block now render a faithful **physical header** instead:

- every pin in its real row, the USB connector on the correct edge (board the right way up),
- power / GND / EN pins shown but greyed and **non-assignable** (you can wire VCC/GND/EN
  by it, but a signal can't be dropped on a rail),
- each pin labelled with the board's own silk (`D21`, `3V3`, `GND`, ...) plus the GPIO
  number where the silk hides it,
- GPIO pins stay clickable / assignable with the same status colours and callouts as before.

Boards without `phys` keep the original horizontal two-column diagram, so it degrades
gracefully. The `phys` fields are documented in
[web/boards/README.md](../web/boards/README.md#physical-header-phys--optional). Curated
boards: ESP32 DevKitC (38-pin), NodeMCU-32S (38-pin), ESP32 DevKit v1 (DOIT, 30-pin),
ESP32-S3 DevKitC-1 (44-pin). The four built-in offline boards carry the same data inline
in `config.html`. Validate the curated data with:

```sh
node web/boards/validate_physical.mjs
```

## Descriptor schema and adding boards

See [web/boards/README.md](../web/boards/README.md) for the JSON schema, the `flags`
table, and the contribution flow. The generator doubles as a gate: run it with no arguments
and it checks every committed descriptor against the hardware sources, exiting non-zero if
one has drifted. `--write` regenerates.

```sh
python hardware/scripts/gen_board_descriptor.py           # check for drift
python hardware/scripts/gen_board_descriptor.py --write   # regenerate
```

## Board coverage

**33 boards** spanning every esp32 / esp32s3 board the firmware runs on (see
[../web/boards/ROADMAP.md](../web/boards/ROADMAP.md) for the full list). Descriptor data
is sourced authoritatively, not guessed:

- **LuxDMX v6** is derived from `hardware/scripts/luxdmx.py` (the PCB netlist source), so its
  diagram, template and Ethernet-reserved-pin rules cannot drift from the real board: the
  generator's check run compares them on every invocation. (That file still carries the board's
  v5.x revision markings; the hardware sources have not been renumbered, only the
  firmware/web-facing board name has.)
- **Hand-tuned** boards (DevKitC / DevKit v1 / NodeMCU / S3 DevKitC-1, Feather / QtPy /
  XIAO / WT32-ETH01) use their real, published header order.
- **Every other board** is auto-generated by `auto_board()` from the arduino-esp32 core's
  `variants/<dir>/pins_arduino.h` (authoritative GPIO numbers / silk names / flags;
  physical column placement approximate).

Variants genuinely differ in pinout/layout, so each is its own descriptor: the 30-pin
DOIT board omits the flash pins (6-11); the PICO-based Feather ESP32 V2 frees GPIO6-11
and reserves 16/17 for its embedded flash; the Ethernet boards reserve their RMII pins.
OLED boards (Heltec) pre-configure the mono display on "Apply template"; TFT boards
(LilyGO T-Display-S3, M5Stack) leave the display off (mono OLED + SSD1351 colour SPI are
the only supported panels for now).

## Roadmap / possible follow-ups

- More board descriptors in the catalog (one `auto_board()` line each; PRs welcome).
- Optional device-side storage of a custom descriptor (today: browser `localStorage`).
