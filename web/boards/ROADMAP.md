# Board catalog

The `/config` pin picker ships a descriptor for every ESP32 / ESP32-S3 board the
LumiGate firmware can run on. Each descriptor drives a **generated horizontal pin
diagram** (clickable pads, status colours, assignment callouts) plus a one-click
"Apply template" pin map. The firmware only runs on the **esp32** and **esp32s3**
families, so C3/C6/S2/H2/P4 boards are out of scope.

🌐 = wired-Ethernet board (especially relevant for a DMX gateway).
**Layout** = how the two pin columns are built: *header* = hand-tuned physical header
order; *auto* = generated from `variants/<dir>/pins_arduino.h` (GPIO numbers / silk /
flags are real, physical column placement is approximate).

## ESP32 (classic, Xtensa / WROOM-32 etc.)

| Board | Variant | Layout |
|---|---|---|
| ESP32 DevKitC V4 (WROOM-32, 38-pin) | `esp32` | header |
| DOIT ESP32 DevKit v1 (30-pin) | `doitESP32devkitV1` | header |
| NodeMCU-32S | `nodemcu-32s` | header |
| WEMOS LOLIN D32 | `d32` | header (30-pin) |
| WEMOS LOLIN32 | `lolin32` | header (30-pin) |
| WEMOS LOLIN32 Lite | `lolin32-lite` | header (30-pin) |
| Adafruit HUZZAH32 Feather | `feather_esp32` | auto |
| Adafruit Feather ESP32 V2 (PICO) | `adafruit_feather_esp32_v2` | header |
| SparkFun ESP32 Thing | `esp32thing` | auto |
| SparkFun ESP32 Thing Plus | `esp32thing_plus` | auto |
| Heltec WiFi Kit 32 (OLED) | `heltec_wifi_kit_32` | auto · OLED pre-config |
| 🌐 WT32-ETH01 (Ethernet, LAN8720) | (custom) | header |
| 🌐 Olimex ESP32-PoE | `esp32-poe` | auto |
| 🌐 Olimex ESP32-PoE-ISO | `esp32-poe-iso` | auto |
| 🌐 Olimex ESP32-Gateway | `esp32-gateway` | auto |
| 🌐 wESP32 (PoE) | `wesp32` | auto |

## ESP32-S3

| Board | Variant | Layout |
|---|---|---|
| LumiGate v3 (S3 + W5500) | (PCB source) | header |
| ESP32-S3 DevKitC-1 (44-pin) | `esp32s3` | header |
| ESP32-S3 DevKitM-1 | `esp32s3` | header |
| Seeed XIAO ESP32-S3 | `XIAO_ESP32S3` | header |
| Adafruit Feather ESP32-S3 | `adafruit_feather_esp32s3` | header |
| Adafruit QT Py ESP32-S3 | `adafruit_qtpy_esp32s3_n4r2` | header |
| Adafruit Metro ESP32-S3 | `adafruit_metro_esp32s3` | auto |
| WEMOS LOLIN S3 | `lolin_s3` | auto |
| WEMOS LOLIN S3 Mini | `lolin_s3_mini` | auto |
| Unexpected Maker FeatherS3 | `um_feathers3` | auto |
| Unexpected Maker ProS3 | `um_pros3` | auto |
| Unexpected Maker TinyS3 | `um_tinys3` | auto |
| SparkFun ESP32-S3 Thing Plus | `sparkfun_esp32s3_thing_plus` | auto |
| Heltec WiFi LoRa 32 V3 (OLED) | `heltec_wifi_lora_32_V3` | auto · OLED pre-config |
| LilyGO T-Display-S3 (TFT) | `lilygo_t_display_s3` | auto · TFT (display off) |
| M5Stack AtomS3 (TFT) | `m5stack_atoms3` | auto · TFT (display off) |
| M5Stack CoreS3 (TFT) | `m5stack_cores3` | auto · TFT (display off) |

## Notes

- **Accurate GPIOs**: pinouts come from `variants/<dir>/pins_arduino.h` (authoritative),
  generated via `hardware/gen_board_descriptor.py`; LumiGate v3 from `hardware/lumigate.py`.
- **Diagram only**: the picker draws its own horizontal SVG diagram from each board's two
  pin columns. There are no board photos or realistic/Fritzing graphics (too few clean-
  license images to be worth it) - the generated diagram is the interactive tool and works
  the same for every board.
- **Display pre-config**: boards with a built-in **mono I2C OLED** (SSD1306/SH1106) set the
  display preset on "Apply template" - e.g. Heltec WiFi Kit 32 / WiFi LoRa 32 V3. Boards
  with a **TFT** (ST7789 / ILI9342 - LilyGO T-Display-S3, M5Stack) leave the display off:
  the firmware only supports mono OLED and SSD1351 colour SPI for now (TFT is a separate
  feature). SSD1351 colour SPI is set via the GPIO fields.
- **Ethernet boards** mark the RMII PHY pins reserved + hard-wired so they are not reused.
- **Offline**: five core boards (LumiGate v3, ESP32 DevKitC, ESP32 DevKit v1, ESP32-S3
  DevKitC-1, XIAO ESP32-S3) are baked into `src/pages/config.html` and work with no network;
  the rest are fetched on demand from GitHub Pages.

Status: **33** board descriptors (5 baked-in offline + 28 catalog), every one with a
generated clickable pin diagram and an "Apply template" pin map, all GPIO-verified against
`pins_arduino.h`.
