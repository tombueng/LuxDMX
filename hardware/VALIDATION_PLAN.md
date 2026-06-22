# LumiGate v4 — Pre-fabrication validation plan

Goal: be as close to certain as possible that a fabricated + assembled board works on the first spin.
Multilayer + assembly errors are effectively unfixable, so over-validate. This plan is worked top to
bottom; findings + fixes are logged in VALIDATION.md (the status matrix) and VALIDATION_REPORT.md (the
detailed write-up). Re-run the whole thing after any change.

## A. Connectivity & schematic intent
- [ ] ERC clean (SKiDL) — every pin accounted for, no accidental shorts/floats
- [ ] Net-by-net diff: every net's membership matches the intended schematic (power, SPI, UART, DMX, iso)
- [ ] No net merged/split by a typo; no single-pin nets; no two nets that should be one
- [ ] Power tree: every IC VCC/GND pin actually on the right rail; EP/thermal pads grounded
- [ ] DNP / no-connect pins intentional (W5500 RSVD/NC, USB SBU, etc.)

## B. GPIO / pin-mux (ESP32-S3 + W5500)
- [ ] Every ESP32-S3 GPIO used is valid for its function (SPI, UART, DMX UART, LED, I2C/SPI on J6)
- [ ] Strapping pins (IO0/IO3/IO45/IO46) at safe boot levels; no bus contention at reset
- [ ] No input-only pin used as output; no flash/PSRAM pins (IO26-32 / SPI) reused
- [ ] W5500 SPI mode pins (PMODE) + INT/RST/CS correct; UART0 flash/console free
- [ ] DMX2 UART pins routable to a hardware UART; LED pins safe at boot

## C. Per-part: ratings, values, datasheet
- [ ] For EVERY component: V rating > worst-case V, I/P rating > worst-case, with margin
- [ ] Recompute every R/C/L value from first principles (dividers, RC, term, decoupling, FB, xtal load)
- [ ] Diodes/TVS: standoff/clamp vs rail; Schottky Vf + If + reverse V; PTC hold/trip
- [ ] Electrolytics/MLCC: voltage derating (MLCC DC-bias!), ripple current, temp
- [ ] Modules (B0505S, DP9900M): input range, isolation, load regulation, efficiency, thermal
- [ ] LCSC live stock + correct LCSC number for every line of the BOM

## D. Power integrity
- [ ] +5V rail budget incl. PTC + ferrites + SS54 drop; B0505S >=4.5V worst case
- [ ] +3V3 buck: Vout, inductor saturation/ripple, Cout ripple, FB divider
- [ ] Trace width vs current (done: widen_power) + via current; plane current
- [ ] Inrush + bulk cap sizing; brown-out / power-sequencing (ESP32 BOD)
- [ ] PoE: 802.3af class, DP9900M load, magjack rating

## E. Signal integrity / EMC
- [ ] Ethernet 100BASE-TX: diff-pair length match, termination (TCT/RCT bias), magjack pinout
- [ ] SPI @ W5500 clock: length/loading; crystal load caps vs CL spec
- [ ] DMX/RS-485: termination, fail-safe bias, CM choke, TVS order, slew
- [ ] Decoupling placement (done) + return paths across the iso void
- [ ] Conducted/radiated EMC story: CM chokes, ferrites, chassis bond, cable shields
- [ ] Crystal layout: ground guard, load, drive level

## F. Isolation / safety
- [ ] Surface creepage (DRC 4mm DMX / 2.5mm PoE) — clean
- [ ] Inner-plane vertical isolation; no copper crossing a barrier
- [ ] Isolation voltage of each barrier part (B0505S, ISO3086, DP9900M, magjack) vs intended class
- [ ] Iso reference caps / soft-ground decision documented

## G. Footprints / 3D / orientation (mechanical)
- [ ] Every footprint matches the real part datasheet (pad pitch, pin count, pin-1, courtyard)
- [ ] Pin-1 / polarity orientation correct for every polarized part (diodes, modules, USB-C, XLR, ICs)
- [ ] 3D models present + aligned; connectors overhang the edge correctly for the panel
- [ ] Mounting holes (M3), board size, connector reach, no body collisions

## H. Simulation
- [ ] SPICE (ngspice/WSL): diode-OR + PTC + ferrite load step; buck loop; LED currents; DMX bias
- [ ] RC/timing (EN reset, auto-reset); crystal load; TVS clamp transient if modelable
- [ ] Any other modelable critical node

## I. DFM / fab
- [ ] JLCPCB 4-layer rules: min track/space/drill/annular; stackup; impedance note
- [ ] Solder-mask slivers, silk-over-pad, acid traps, copper-to-edge
- [ ] Gerber/BOM/CPL generation sanity; assembly orientation marks; fiducials
- [ ] Panelization / tooling not needed (single board)

## J. New / creative ideas (extend as we go)
- [ ] Thermal: B0505S x2 + DP9900M + buck dissipation vs board copper (rough thermal)
- [ ] Worst-case-analysis (tolerance stack) on the FB divider, CC resistors, term
- [ ] Reverse-power / hot-plug / ESD path review at every connector
- [ ] "What fails open vs short" FMEA on each protection part
- [ ] Cross-check the firmware pin map (src/main.cpp + /config) against the netlist
- [ ] Compare against WIZnet W5500 + Espressif ESP32-S3 reference-design checklists

Open questions (postponed, do not block): logged at the bottom of VALIDATION_REPORT.md.
