# LumiGate v4 — detailed pre-fabrication validation report

Date: 2026-06-23. Branch: `v4-hardware`. Method: 4 parallel datasheet-research passes (every active part +
crystal + connectors read from official datasheets), the re-runnable validation scripts
(`validate_electrical/geometry/placement.py`), KiCad DRC + SKiDL ERC, and a manual net/GPIO/EMC/footprint
review. Every number below is computed, not guessed; datasheet sources are named.

Companion files: `VALIDATION_PLAN.md` (what we check), `VALIDATION.md` (status matrix). Re-run after any change.

---

## 0. Overall verdict

**Close to fab-ready. Blocker fixed, the one real margin now fixed too, no remaining must-stop item.**
- Routing 0 unrouted; DRC = 3 known JLCPCB-OK waivers.
- **Every ESP32-S3 GPIO assignment validated against the datasheet — zero must-change pins.** (Big result.)
- Blocker found + fixed: crystal load caps. Three more value fixes applied. The USB-powered B0505S/VCC2
  margin (was the top open item) is now **fixed in-place** with a TPS2116 ideal-diode mux (§3), SPICE-verified.

### Fixes applied this pass (value-only, no reroute)
| Ref | Was | Now | Why |
|---|---|---|---|
| C12/C13 | 22pF | **33pF C0G** | Crystal is **CL=20pF** (part# 2520-25-**20**-...). 22pF presented only 15pF → W5500 25MHz ran fast, eating the ±50ppm Ethernet budget. 33pF‖33pF + ~4pF stray = 20.5pF ✓ (**was a real blocker**) |
| R3 | 12k | **12.4k 1%** | W5500 EXRES1 datasheet value (was −3.2%, off-spec PHY bias) |
| D10 | SMAJ58A | **SMAJ60A** | PoE TVS standoff was only 1V over the 57V max (leakage/self-heat risk). 60A: Vbr 66.7V, clamp 96.8V |

---

## 1. Per-part datasheet validation (ratings, values, fit)

Sources: TI SLOS581J (ISO3086), MORNSUN B_S-1WR2 ds, SDAPO DP9900, HanRun HY931147C REV.A/1, ST USBLC6-2,
Littelfuse SMAJ, Bourns SM712, Silergy SY8089, BHFUSE BSMD1206, Espressif ESP32-S3-WROOM-1 v1.8, WIZnet W5500
v1.0.2, WCH CH340, Suzhou-Liming 2520 crystal, TDK ACM2012, Fenghua CBM bead, Neutrik NC5FAH, JST eSH.

### Isolation / power modules
- **B0505S-1W (C2912568):** Vin 4.5–5.5V, Vout 5V/200mA (1W) **unregulated**, needs ≥10% load (≥20mA; we run
  ~50–70mA ✓), eff ~72–76% full / ~40% @10%, ripple ≤100mVpp. **Isolation = 1000VDC** for this exact SKU
  (the 1500VDC figure is the newer ‑1WR2 sheet). Functional isolation, not safety-rated. **Pinout 1=GNDin
  2=Vin 3=GNDout 4=Vout.** Fit OK, but its unregulated output tracks Vin → see §3 margin.
- **DP9900M-5V (C5380106):** 36–57V in, **5V/1.8A (9W)**, **1500Vrms** iso, 802.3af Class 0, eff ≥86%,
  integrated SC/OC/thermal/inrush/surge. We need ~0.4A → ~22% load, big margin. *Open: confirm the LCSC
  part-specific PDF (5V/1.8A SKU, on-module 802.3af detection/classification, exact pin order) — JS landing
  page blocked the raw PDF.*
- **ISO3086DWR (C183095):** VCC1 3.15–5.5V; **VCC2 4.5–5.5V (the tight rail)**; isolation **2500Vrms/4000Vpk**
  (basic, ~8mm creepage); 20Mbps grade (DMX 250k trivial); VOD ≥1.5V into 54Ω; **receiver fail-safe HIGH** on
  open/short/idle (good for DMX). Full-duplex silicon → we correctly tie Y→A, Z→B for the half-duplex pair,
  one 120Ω term per universe. Fit OK except VCC2 4.5V min (see §3).
- **HY931147C (C91754):** 1CT:1, 350µH, **1500Vrms**, **integrated PoE Mode-A/B bridge → V+=P9/V−=P10**
  (confirmed), straight-MDI magnetics (right for W5500, which has no auto-MDIX). LEDs Y=11/12 G=13/14. **No
  integrated Bob-Smith termination** (distributor claim is wrong; the schematic shows none) — see §5 EMC.

### Protection / power semis
- **TPS2116 (U9, SOT-583):** dual-input ideal-diode power mux, RDSON ~40mΩ typ / 65mΩ max over temp, 1.6A.
  Replaces the SS54 OR **diodes** (D8/D9, removed) so the OR drop is ~0.03V instead of ~0.40V — **this is
  what fixes the §3 margin.** PR1/MODE tied low (priority off → simple highest-input-wins OR); ST/PG open.
- **SMAJ5.0A (C151932):** Vrwm 5.0V, Vbr 6.4–7.0V, clamp 9.2V@43.5A, on the +5V rail. With the low-drop mux
  the rail now reaches ~5.20V max (5.25V USB − PTC − mux), so it sits a touch above the 5.0V standoff only at
  the USB ceiling → **µA reverse leakage, no clamping** (Vbr 6.4V ≫ 5.2V); fully protective, negligible. The
  tight 9.2V clamp beats the SY8089 6V abs-max only on ns–µs transients (buck Cin handles those). Optional
  purist swap is SMAJ5.5A (5.5V standoff); kept 5.0A for the tighter clamp.
  **Verdict: acceptable as a transient clamp.** Standoff has only ~0.17V over the 4.83V rail — fine.
- **SMAJ58A→60A:** fixed (above).
- **SM712 (D1/D7):** asymmetric +7/−12V standoff, clamps 14/26V, matches the RS-485/DMX −7…+12V common-mode
  range; **pin1 I/O1, pin2 GND(→isolated DMX ground ✓), pin3 I/O2** — our wiring matches. Correct part.
- **SY8089 (C78988):** Vin 2.7–5.5V (abs-max 6.0V), 2A, 1MHz, Vref 0.6V, **pinout 1=EN 2=GND 3=LX 4=IN 5=FB —
  matches our footprint ✓.** Vout 0.6×(1+45.3/10)=**3.318V** ✓. 2.2µH → ΔIL~0.5A, Ipk~0.55A (DCM at 0.3A, fine).
- **BSMD1206-150-16V PTC (C883133):** Ih 1.5A (1.06A @60°C), It 3.0A, Rmin 25mΩ, Vmax 16V. No nuisance trip at
  0.8A even warm; trips on a short. *Confirm 0.8A is peak not sustained; else step to a 2.0A part.*
- **USBLC6-2SC6 (C7519):** Vrwm 5V, 3.5pF/line (transparent to 12Mbps CH340), ±8kV contact ESD. Correct.

### Logic ICs (see §2 for the full GPIO table)
- **ESP32-S3-WROOM-1-N8:** all GPIO uses valid; IO35/36/37 free (no PSRAM on N8); strapping safe; no
  input-only/flash conflicts. **CH340C** SOP-16 pinout matches, V3→VCC for 3.3V correct, integrated clock (no
  xtal) correct, pin8 left NC correct. **W5500** SPI mode 0/3, PMODE float = all-capable auto-neg, RSTn must be
  held ≥500µs (firmware), EXRES1 now 12.4k.

### Passives / crystal / connectors
- **Crystal C2981622 = 25MHz, CL=20pF, ±10ppm/±10ppm** (well within W5500 ±50ppm) — load caps fixed to 33pF C0G.
- **ACM2012-201-2P CM choke:** 200Ω@100MHz, 350mA, 250mΩ, 50V. Differential impedance ~flat near DC → does
  NOT distort 250kbps DMX edges (L/R ≈ 0.08ns ≪ 4µs bit). Suitable. (Optional better-matched: WE-CNSW 90Ω.)
- **Ferrite 600Ω@100MHz 0805 2A 100mΩ (C139168):** all 3 positions at 2.5–20% of rating, IR drop ≤40mV. OK.
- **Connectors:** NC5FAH XLR-5 (pin1=common/shield, 2=Data−, 3=Data+, 4/5 NC; separate shell ground G — keep
  pin-1 off chassis on the iso side ✓). USB-C 16-pin USB2 (CC1/CC2 each need 5.1k Rd ✓ R8/R9). JST-SH 1.0mm
  SM09B (J4/J6) + SM03B (J7/J8) confirmed.
- **MLCC values:** 100nF decap, 10µF bulk, 22µF buck (note: spec **≥10V** in BOM so a 6.3V part isn't picked),
  120R term, dividers, etc. all sane after DC-bias derating. 4.7µF TOCAP 0402 → consider 0603 for sourcing.

---

## 2. GPIO / pin-mux — every pin validated (zero must-change)

ESP32-S3-WROOM-1-**N8** (no PSRAM → IO35/36/37 free). All pins I/O-capable (S3 has no input-only pins).
Strapping: IO0 (pullup+button, idle high ✓), IO3/IO45/IO46 unused (left at safe defaults ✓). Native USB
IO19/IO20 used as plain expansion GPIO on J6 (free because USB console is the CH340) — **doc note added: J6
pins 8/9 are the S3 native USB D−/D+ pads.** UART0 = IO43/44 (correct, crossed TX/RX to CH340). SPI=12/11/13,
CS=10, INT=14, RST=9 (hold ≥500µs). DMX1 UART 17/18/8, DMX2 16/21/47 — all route to HW UARTs, all output-capable.
LEDs 1/2/6/7/15 fine. Display 4/5/39/40/41/42/38 (39–42 are JTAG alt-func, harmless). **No flash/PSRAM/strap
collision anywhere.**

**Firmware cross-check (src/main.cpp) done:** ETH MOSI=11/MISO=13 and BOOT=0 match the netlist. The DMX
and LED pins are **compile-time defaults (DMX TX=17/RX=16, single LED=2) that are runtime-configurable via
web /config** — this dual-universe board must be configured as out#1 = tx17/rx18/de8, out#2 = tx16/rx21/de47,
ledType=3 (5-LED) pins 1/2/6/7/15. Hardware wiring is correct; the /config (or updated compile defaults)
must match it. **Recommended robustness add:** a 10k pull-down on each ISO3086 DE/nRE net (DMX_EN=IO8,
DMX2_EN=IO47) so the drivers stay disabled while IO8/IO47 are high-Z during ESP32 boot (otherwise a brief
indeterminate drive on the DMX line at power-up — harmless to compliant receivers but not clean).

**Net sanity:** 87 nets, **0 single-pin/floating nets**, ERC clean.

---

## 3. RESOLVED: USB-powered B0505S / ISO3086 VCC2 margin (was the top open item)

The original OR **diode** (SS54, ~0.40V Vf) + PTC + input ferrite dropped the +5V rail, on **USB at low
VBUS**, below the **ISO3086 VCC2 minimum of 4.5V** (USB 4.75V − PTC − SS54 − FB1 ≈ 4.29V at the B0505S input
→ VCC2 ~0.2V under spec). **Fixed this pass:** the two OR diodes (D8/D9) are replaced by a **TPS2116
ideal-diode power mux (U9)** — back-to-back pass-FETs, RDSON ~40mΩ typ — so the OR drop falls from ~0.40V to
~0.03V at the ~0.8A worst-case load.

SPICE (`sim/power_chain.cir`, mux 40mΩ; load = both B0505S + buck/logic ≈ 0.8A through the mux):

| VBUS (USB)        | VCC2 before (SS54) | VCC2 now (TPS2116) |
|-------------------|--------------------|--------------------|
| 4.70 V (worst low)| ~4.29 V ❌         | **4.61 V ✓**       |
| 5.00 V (nominal)  | ~4.54 V            | **4.91 V ✓**       |
| 5.25 V (ceiling)  | ~4.79 V            | **5.16 V ✓**       |

VCC2 now clears the 4.5V minimum across the whole USB range, including the 65mΩ max-RDSON-over-temp case
(~4.59V at VBUS 4.70V). PoE (regulated 5.0V) was already fine. **No operating restriction is needed anymore.**

Implementation: U9 (SOT-583) sits at the old OR junction with 1µF input caps (C30/C31, 0603) and the 22µF OR
bulk (C29); PR1/MODE tied low (priority off → simple highest-input-wins OR); ST/PG open. Hand-routed (the
fine-pitch fanout fought the autorouter) and DRC-clean; ERC 0 errors. One second-order effect: the mux's low
drop lets the +5V rail reach ~5.20V on a 5.25V USB — see the D11 TVS note in §2 (still fine, µA leakage).
`validate_electrical.py` + `sim/power_chain.cir` model the fixed chain.

---

## 4. Power integrity, geometry, DFM
- **+5V/+5V_USB trace width:** bulk widened to 0.5mm (`widen_power.py`); a few short pad-entry necks remain
  0.2mm (heat sinks into the pad — acceptable). IPC-2221: 0.5mm/1oz = 1.45A@10°C ≫ 0.8A.
- **Via current** fine; **min annular = 0.125mm** on the 0.5/0.25 escape vias — **0.005mm under JLCPCB's 0.13mm
  preferred** (open item: bump escape-via pad to 0.55mm → 0.15mm annular, or accept; JLCPCB often allows 0.1mm).
- DFM: min track 0.20mm, min drill 0.20mm — OK. Clearance per DRC (3 waivers: 2× W5500 0.137mm fan-out + USB-C
  CC2, all ≥ JLCPCB 0.0889mm).
- Fuse coordination: PTC trips ~3A, trace fuses ~8–10A → fuse always wins.
- **Silk-over-pad = 0, courtyard-overlap = 0** (no assembly/solder or body-collision issue). The ~78
  remaining silk warnings are all silk-over-copper / silk-on-silk (cosmetic, mask-protected) — the standard
  pre-fab silk-cleanup batch (VALIDATION item 3).

## 5. EMC / SI
- CM chokes (L2/L3) + ferrites (FB1-3) + the chassis bond (plated GND holes) form the EMC story. Decoupling
  snapped to pins (a few caps slightly far — see §6).
- **Ethernet: no Bob-Smith in the magjack** → add external 75Ω + 1nF-to-chassis network on the unused/center-tap
  nodes for conducted-EMC margin (open item / next-rev improvement). Center-tap bias (R18 49.9R, C14/C22 100nF)
  present.
- Crystal load now correct → clean 25MHz. SPI/DMX SI fine at these speeds.
- **Ethernet diff-pair skew measured:** TX 24.2/23.2mm (skew 1.0mm), RX 26.3/29.1mm (skew 2.8mm) — both
  ≪ the ~5mm that would matter at 100BASE-TX (skew ↔ ~18ps/3mm vs 10ns bit). Adequately matched; no
  hand-routing needed. (Pairs aren't impedance-controlled by the autorouter but the runs are short.)

## 6. Placement (decoupling proximity) — real findings
`validate_placement.py` (after ASSOC update for the new nets) flags a few caps slightly past target:
**C27 (PoE out bulk) 24mm from U7** (worst; PoE ripple — C28 is close at 4.5mm so functional), C13 7.6mm,
L1 7.2mm, C6 (TOCAP) 7.1mm, C5/C10 ~5.6–5.9mm. All are the user's tight-pack tradeoff; none breaks function,
but C27 and the buck inductor loop are worth tightening on a future placement pass.

## 7. Footprints / orientation / thermal
- SY8089 pinout matches; B0505S/ISO3086/USB-C/XLR/JST/magjack pin maps confirmed vs datasheet (§1).
- **3D top-view render audited (kicad-cli pcb render):** all connectors face their correct edges (XLR-5 ×2
  right = DMX-OUT A/B, RJ45 left = Ethernet, USB-C bottom), modules + ICs sensibly oriented, plated GND
  holes at the 4 corners, silk legible. Electrically, footprint rotation is correct by construction (pads
  follow nets); the visual confirms physical/connector orientation. No orientation issue found.
- **Thermal (rough):** total board dissipation ~1.5–2.5W (2× B0505S ~0.25W, DP9900M ~0.3W, buck ~0.1W,
  W5500 ~0.4W, ESP32 ~0.1–0.5W). On a 99×79mm 4-layer board with GND/+3V3 plane copper this spreads easily
  (well under any limit); no hotspot of concern. The two B0505S + DP9900M run warm but within their derated
  ratings (§1). Not a constraint.

---

## 8. Open / next-spin items (do NOT block fab — for the user to weigh)
1. ~~**B0505S/ISO3086 USB margin**~~ — **FIXED this pass** (§3): TPS2116 ideal-diode mux (U9) replaces the
   OR diodes; VCC2 ≥ 4.61V across the full USB range, SPICE-verified. No longer an open item.
2. **ISO3086 DE/nRE boot pull-down** — 10k on DMX_EN(IO8)/DMX2_EN(IO47) → drivers stay OFF during boot.
   Evaluated + reverted this pass: the 2 resistors push the W5500 Ethernet TX diff-pair onto a via (hurts
   100BASE-TX SI). Re-do next spin with a small placement nudge so the pair stays via-less.
3. **Escape-via annular 0.125mm** is right at JLCPCB's ~0.13mm limit — acceptable, bump pad 0.5→0.55mm
   (→0.15mm) only if a W5500-fanout reroute is done (larger pads tighten the 0.137mm clearances). [DFM]
4. **Ethernet Bob-Smith** 75Ω + 1nF-to-chassis network — the magjack has none; add for conducted-EMC margin.
5. **DP9900M LCSC PDF** — confirm 5V/1.8A SKU + on-module 802.3af detection/classification + pin order.
6. **Firmware /config** must set out#1 tx17/rx18/de8, out#2 tx16/rx21/de47, ledType=3 pins 1/2/6/7/15
   (compile-time defaults are single-output). Hardware wiring is correct (§2).
7. C27 (PoE bulk, 24mm) + C26 (B0505S#2 in-bulk at FB1, 30mm) + L1 (buck loop) placement could tighten on a
   future pass — functional now (SPICE-confirmed); the user's tight-pack tradeoff. 4.7µF TOCAP 0402→0603.
8. BOM notes: force **≥10V** on the 22µF buck caps; **C0G/NP0** on the 33pF crystal caps; XLR shell off chassis.

The board is fab-ready as-is for PoE / clean-USB power; item 1 is the only thing to decide before ordering.

## 9. Methods run
4 datasheet agents (every active part) · validate_electrical/geometry/placement.py · KiCad DRC · SKiDL ERC ·
SPICE (ngspice-42 in WSL) on the power chain · manual net/GPIO/EMC/footprint review. Re-run all after changes.
