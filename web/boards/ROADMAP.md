# Board catalog roadmap

Target list of the most widespread ESP32 / ESP32-S3 dev boards for the pin picker.
(The firmware only runs on the **esp32** and **esp32s3** families, so C3/C6/S2/H2/P4
boards are out of scope.)

Legend: **Status** done = descriptor shipped · plan = to add. **Variant** = the Arduino
core `variants/<dir>/pins_arduino.h` we read for authoritative GPIOs (almost all exist
locally). **Fritzing** = real CC-BY-SA board graphic to research next (✓/✗/? TBD).
🌐 = wired-Ethernet board (especially relevant for a DMX gateway).

## ESP32 (classic, Xtensa / WROOM-32 etc.)

| # | Board | Variant | Status | Fritzing |
|---|---|---|---|---|
| 1 | ESP32 DevKitC V4 (WROOM-32, 38-pin) | `esp32` | done | ? |
| 2 | DOIT ESP32 DevKit v1 (30-pin) | `doitESP32devkitV1` | done | ? |
| 3 | NodeMCU-32S | `nodemcu-32s` | done | ? |
| 4 | WEMOS LOLIN D32 | `d32` | plan | ? |
| 5 | WEMOS LOLIN D32 Pro | `d32_pro` | plan | ? |
| 6 | WEMOS LOLIN32 | `lolin32` | plan | ? |
| 7 | WEMOS LOLIN32 Lite | `lolin32-lite` | plan | ? |
| 8 | Adafruit HUZZAH32 Feather | `feather_esp32` | plan | ? |
| 9 | Adafruit Feather ESP32 V2 (PICO) | `adafruit_feather_esp32_v2` | done | ? |
| 10 | SparkFun ESP32 Thing | `esp32thing` | plan | ? |
| 11 | SparkFun ESP32 Thing Plus | `esp32thing_plus` | plan | ? |
| 12 | LilyGO TTGO T-Display (1.14" TFT) | `lilygo_t_display` | plan | ? |
| 13 | Heltec WiFi Kit 32 (OLED) | `heltec_wifi_kit_32` | plan | ? |
| 14 | Heltec WiFi LoRa 32 V3 | `heltec_wifi_lora_32_V3` | plan | ? |
| 15 | M5Stack Core | `m5stack_core` | plan | ? |
| 16 | 🌐 WT32-ETH01 (Ethernet, LAN8720) | (custom) | done | ? |
| 17 | 🌐 Olimex ESP32-POE / POE-ISO | `esp32-poe(-iso)` | plan | ? |
| 18 | 🌐 Olimex ESP32-Gateway | `esp32-gateway` | plan | ? |
| 19 | 🌐 wESP32 (PoE) | `wesp32` | plan | ? |

## ESP32-S3

| # | Board | Variant | Status | Fritzing |
|---|---|---|---|---|
| 20 | LumiGate v3 (S3 + W5500) | (PCB source) | done | ✓ own render |
| 21 | ESP32-S3 DevKitC-1 (44-pin) | `esp32s3` | done | ? |
| 22 | ESP32-S3 DevKitM-1 (MINI) | (custom) | plan | ? |
| 23 | Seeed XIAO ESP32-S3 | `XIAO_ESP32S3` | done | ? |
| 24 | Adafruit Feather ESP32-S3 | `adafruit_feather_esp32s3` | done | ? |
| 25 | Adafruit QT Py ESP32-S3 | `adafruit_qtpy_esp32s3_n4r2` | done | ? |
| 26 | Adafruit Metro ESP32-S3 | `adafruit_metro_esp32s3` | plan | ? |
| 27 | WEMOS LOLIN S3 | `lolin_s3` | plan | ? |
| 28 | WEMOS LOLIN S3 Mini | `lolin_s3_mini` | plan | ? |
| 29 | Unexpected Maker FeatherS3 | `um_feathers3` | plan | ? |
| 30 | Unexpected Maker ProS3 | `um_pros3` | plan | ? |
| 31 | Unexpected Maker TinyS3 | `um_tinys3` | plan | ? |
| 32 | SparkFun ESP32-S3 Thing Plus | `sparkfun_esp32s3_thing_plus` | plan | ? |
| 33 | LilyGO T-Display-S3 (TFT) | `lilygo_t_display_s3` | plan | ? |
| 34 | M5Stack AtomS3 | `m5stack_atoms3` | plan | ? |
| 35 | M5Stack CoreS3 | `m5stack_cores3` | plan | ? |

## Notes

- **Accurate GPIOs**: pinouts come from `variants/<dir>/pins_arduino.h` (authoritative),
  generated via `hardware/gen_board_descriptor.py`; LumiGate v3 from `hardware/lumigate.py`.
- **Boards with built-in peripherals** (Heltec/LilyGO TFT+OLED+LoRa, M5Stack) consume many
  GPIOs internally; their descriptors should mark those pins reserved (per-board work).
- **Pin layout vs functional grouping**: DevKit-class boards get true physical column
  layouts; compact/named-pin boards (Feather, QtPy, XIAO) use the functional pad set with
  accurate GPIOs (physical placement approximate).
- **Fritzing column** is filled in the next step: for each board, find an official
  CC-BY-SA Fritzing part, verify provenance, and (if clean) add the graphic as an
  online-only overlay with attribution in [CREDITS.md](CREDITS.md). The board-style SVG
  remains the always-available, MIT-clean default.

Done so far: **10** descriptors (5 built-in offline + 5 catalog). Target list above: ~35.
