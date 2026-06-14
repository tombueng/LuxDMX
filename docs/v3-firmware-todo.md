# LumiGate v3 firmware branch — TODO

Branch: `feature/lumigate-v3-firmware`

This branch moves the **whole firmware to arduino-esp32 v3 (ESP-IDF 5.5)** so the
standalone **LumiGate v3 board** (ESP32-S3 + W5500 SPI-Ethernet + 5 status LEDs)
is supported. It is a **major framework jump** and is **not yet validated on real
hardware** — do **not** merge to `master` until the "Must-fix before merge" boxes
are checked.

## What's done (implemented + compiles)

All five PlatformIO envs build green on arduino-esp32 v3.3.9 / IDF 5.5.4
(`lumigate_v3`, `esp32dev`, `esp32s3dev`, `wt32eth01`, `wokwi`):

- **W5500 SPI-Ethernet** — `ETH.begin(ETH_PHY_W5500, …)` (lwIP netif; web UI /
  Art-Net / sACN / OTA run over it unchanged), behind `USE_ETH_SPI`. Pins
  SCLK=12 MOSI=11 MISO=13 CS=10 INT=14 RST=9 (SPI3). New `[env:lumigate_v3]`.
- **5-LED status panel** — `ledType=3`, concurrent states R=1/G=2/Y=6/B=7/W=15
  (no-network / up / DMX-activity / conflict / identify). Config + web UI added.
- **Framework bump** — `platformio.ini` pinned to pioarduino `55.03.39`. RMII
  `ETH.begin()` (wt32eth01) updated to the v3 arg order.
- **esp_dmx 4.1.0 on IDF 5.5** — build-time fix in `extra_scripts.py`
  (`uart_periph_signal[].module` removed in IDF 5; UART2 guard).
- Renamed local `BOOT_PIN` → `CFG_BOOT_PIN` (v3 defines its own `BOOT_PIN`).
- Fixed a pre-existing wokwi SIM bug (`onDmxFrame` → `routeFrame`).

## Must-fix before merge

- [ ] **BLOCKER #1 — the v3 firmware compiles but does NOT boot on real hardware.**
      When this work was briefly released (v1.0.70), the **ESP32-S3 firmware boot-looped**
      (green LED blinking) after an OTA flash and **bricked the device**. So the v3 build is
      runtime-broken, not merely unverified. Root-cause this before anything else. Suspects:
      early-boot brownout-register write on S3/IDF5 (`WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0)`),
      partition/flash config under v3, or esp_dmx runtime on IDF 5.5. Reproduce over USB with the
      serial monitor + exception decoder. (Tracked in issue #11.)
- [ ] **Real-hardware bring-up of the v3 board** (`pio run -e lumigate_v3 -t upload`):
  - [ ] W5500: link up, DHCP lease, static IP; Art-Net **and** sACN received over wired Ethernet
  - [ ] OTA update over Ethernet
  - [ ] DMX output on the XLR (TX=17); RDM direction via DE/RE on GPIO8
  - [ ] All 5 status LEDs physically correct (mapping + blink timings)
  - [ ] BOOT/RST buttons; USB-C flashing via CH340 auto-reset
- [ ] **esp_dmx runtime on IDF 5.5** — it now *compiles* with the periph_module patch;
      verify DMX actually transmits correctly at runtime (break/MAB/timing) on both UART1 and UART2.
- [ ] **Regression-test the already-released boards on v3** (this is a v2→v3 major bump —
      compile-only is not enough): flash real `esp32dev`, `esp32s3dev`, `wt32eth01` and confirm
      WiFi/Ethernet + DMX + web UI + OTA still work.
- [ ] **CI / release pipeline on v3**:
  - [ ] pioarduino `55.03.39` toolchain-installer bug — `idf_tools.py do_strip_container_dirs`
        aborts on the toolchain archive's stray `package.json`, so the compiler isn't installed.
        Local builds currently need a **host patch outside the repo**. Decide a reproducible fix:
        pin a clean pioarduino release, or add a CI pre-install patch step. **CI will fail without it.**
  - [ ] Also: `pio` must run from a native shell (PowerShell/cmd), not Git-Bash/MSys (idf_tools refuses MSys).
  - [ ] Confirm the GitHub Actions firmware build/release workflow builds all envs (incl. `lumigate_v3`) on v3.

## Should-do

- [ ] Run the Playwright e2e suite (`docs/tests`) against a live v3 device.
- [ ] Decide version bump (**major** for the framework migration?) + changelog entry.
- [ ] v3 display header (J4): default/document the OLED pins (I2C SDA=4 SCL=5; SPI 39/40/41/42/38) and test a panel.
      (NB: the visual pin picker's v3 template — issue #12, branch `feature/lumigate-pin-picker` —
      already pre-fills these J4 pins; they still need a physical panel test.)
- [x] Visual pin picker + per-board templates (issue #12) — clickable board diagram, live
      pin validation, and a v3 "Apply template" generated from `hardware/lumigate.py`.
      Frontend-only + a tiny `/info.json` board/mcu hint; compiles green on esp32dev.
      See `docs/pin-picker.md`. (UI not yet exercised on real v3 hardware.)
- [ ] Optional: upstream the esp_dmx IDF5 + UART2 patches to someweisguy/esp_dmx.
- [ ] Optional: clean up v3 deprecation warnings (`send_P`, const-qualifier).

## References

- Firmware work commit: `4ca9476`
- Build caveats + platform pin: `platformio.ini`, `extra_scripts.py` (`patch_esp_dmx`), `hardware/README.md`
