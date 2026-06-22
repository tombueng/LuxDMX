# LumiGate v4.0 — Hardware Validation Tracking

Single source of truth for "is this board safe to fabricate?" Re-run the scripts after **any**
board change and update the table. Status: ✅ pass · ⚠️ pass-with-caveat · ❌ blocker · 🔲 needs manual/datasheet check.

**Overall verdict (2026-06-22, updated): fab-ready pending datasheet checks + silk cleanup.** Schematic/
electrical sound; placement **EMC-valid** (decoupling snapped to IC pins, 2mm spacing); board **99 x 79mm**
with **4 symmetric M3 holes at 90 x 70mm spacing, uniform 4.5mm edge inset**; proper 4-layer stackup
**F sig / In1 GND plane / In2 +3V3 plane / B sig** (power pads stitched to planes, signals on F/B only).
**Fully routed (0 unrouted).** A **ruggedization pass** added USB ESD (U8), a self-healing PTC fuse (F1),
a +5V transient clamp (D11), lower-drop SS54 OR diodes, DMX common-mode chokes (L2/L3) and ferrite supply
filters (FB1-3) — see the Ruggedization section. Remaining before order: item 18 crystal CL, widen +5V
trace, silk cleanup, waive the 2 W5500-fanout 0.137mm near-misses + CC2-to-SBU1 (all JLCPCB-4L ok).

## How to re-run the validation
```
python validate_electrical.py      # DC/RC operating points (no KiCad needed)
"<KiCad>/bin/python" validate_geometry.py     # trace width / via current / DFM
"<KiCad>/bin/python" validate_placement.py    # decoupling/switcher cap proximity (EMC)
"<KiCad>/bin/kicad-cli" pcb drc --format json -o drc.json lumigate.kicad_pcb   # DRC + connectivity
# routing pipeline (after any placement change):
"<KiCad>/bin/python" rebuild_iso.py && python escape_connectors.py && python autoroute_fr2.py \
  && python cleanup_pads.py && python tighten_poe_void.py
```

## Status matrix

| # | Item | Status | Method | Result / action |
|---|------|--------|--------|-----------------|
| 1 | Routing complete | ✅ | autoroute + DRC connectivity | **0 unrouted** (full pipeline: rebuild_iso → escape_connectors → autoroute_fr2 → cleanup_pads → tighten_poe_void, + route_one for stragglers). 2 W5500 fan-out clearances at 0.137mm = JLCPCB-4L ok |
| 1b | 4-layer power stackup | ✅ | rebuild_iso (In1=GND, In2=+3V3 LT_POWER) | signals F/B only, planes solid; +3V3/GND pads stitched to planes |
| 2 | DRC (electrical) | ⚠️ | kicad-cli pcb drc | 0 shorts; 2 W5500 pin4/16 trace near-misses + 3 DISP_DC-near-edge (local hand-fix); waivable CC2↔SBU1 |
| 3 | DRC (silk cosmetic) | ⚠️ | kicad-cli pcb drc | ~54 silk_over_copper / overlap / edge — cosmetic, fix before fab |
| 4 | Net connectivity = intent | ✅ | board generated from `lumigate.net` (SKiDL) | by construction; schematic reviewed pin-by-pin |
| 5 | Decoupling/xtal/switcher placement (EMC) | ✅ | validate_placement.py + place_decoupling.py | caps snapped to IC pins, 2mm min gap, 0 overlaps (was 20-56mm) |
| 5b | Board outline / mounting holes | ✅ | set_outline_holes.py | **99 x 79mm**; 4 corner M3 holes at **90 x 70mm spacing, uniform 4.5mm inset** (all 4 equal edge distance); 0 hole-vs-body collisions. Holes are **plated + tied to GND** (MountingHole_3.2mm_M3_Pad) so the 4 corners bond board GND to a metal chassis — see docs/ruggedization.md "Grounding & shielding". |
| 6 | PoE module ↔ magjack distance | ⚠️ | geometry | VPOE runs ~50mm; functional, see PoE note |
| 7 | Isolation surface creepage (DMX 4mm / PoE 2.5mm) | ✅ | DRC `.kicad_dru` | 0 isolation-clearance violations |
| 8 | Isolation inner-plane (vertical) | ✅ | rebuild_iso + tighten_poe_void | DMX islands voided 4mm; PoE TH-pins moated 2.5mm; VPOE surface trace over plane = functional 58V (D10-clamped) |
| 9 | +5V rail vs B0505S 4.5V min | ✅/⚠️ | validate_electrical.py | OR diodes now **SS54** (lower Vf): +5V ≈ 4.6V typ from a 5.0V USB after PTC(F1, 25mΩ) + FB1(100mΩ); ≈4.45V worst-case from a sagging USB. B0505S unregulated → ISO3086 still valid below 4.5V. PoE path (regulated 5V) is clean. |
| 10 | Buck +3V3 output | ✅ | validate_electrical.py | 3.318V (R10/R11) |
| 11 | LED currents | ✅ | validate_electrical.py | 1.3-8.7mA, all < GPIO 40mA |
| 12 | EN power-on RC | ✅ | validate_electrical.py | 10ms |
| 13 | USB-C CC / power budget | ⚠️ | validate_electrical.py | Rd=5.1k correct; ~370mA → needs ≥1A source for both universes |
| 14 | Power trace width vs current | ✅ | widen_power.py | +5V family widened to **0.5mm** where clearance allows (0.5mm=1.45A@10°C); only short pad-entry necks remain 0.2mm (heat sinks into the pad). Fuse coordination ok: F1 trips ~3A, a 0.2mm trace doesn't fuse below ~8A. Re-run widen_power.py after any re-route (it resets widths). |
| 15 | Via current / annular | ✅/⚠️ | validate_geometry.py | via current fine; escape-via annular 0.125mm meets JLCPCB (tight) |
| 16 | DFM vs JLCPCB 4-layer | ✅ | validate_geometry.py | min trace 0.2mm, drill 0.2mm OK |
| 17 | Magjack HY931147C pinout | ✅ | datasheet | verified vs HanRun REV.A/1 (2026-06-22): TD=5/6, RD=1/2, RCT=3/TCT=4, V+=9/V-=10, LED-Y=11/12 (A/K), LED-G=13/14 (A/K); straight MDI correct (no auto-MDIX) |
| 18 | W5500 crystal CL vs caps | ✅ | datasheet (2520-25-**20**) | **FIXED**: crystal is CL=20pF; caps 22pF→**33pF C0G** (presented 15pF→20.5pF). Was running the 25MHz fast. |
| 19 | W5500 EXRES1 | ✅ | datasheet | **FIXED**: R3 12k→**12.4k 1%** (on-spec PHY bias) |
| 27 | PoE TVS margin | ✅ | datasheet | **FIXED**: D10 SMAJ58A→**SMAJ60A** (58V standoff was only 1V over 57V max) |
| 28 | Every part rating/value/datasheet | ✅/⚠️ | 4-agent datasheet pass | see **VALIDATION_REPORT.md**: all active parts + crystal + connectors read from official datasheets; ratings/values recomputed. 3 fixes applied, open items listed. |
| 29 | ESP32-S3 GPIO map | ✅ | datasheet | **every pin validated, zero must-change**. IO35/36/37 free (N8 no PSRAM), strapping safe, no flash/input-only conflict, UART/SPI routable, IO19/20 native-USB noted |
| 30 | SPICE power chain | ⚠️ | ngspice-42 (WSL) | DC + transient (sim/*.cir): VCC2≥4.5V needs VBUS≥~4.95V on USB; PoE 5.0V→4.56V ✓; load-step burst dips to 4.52V ✓. See report §3 (top open item: USB margin / ideal-diode OR). |
| 20 | ESP32-S3 strapping pins | ⚠️ | schematic | IO0 pulled-up ✓; IO3/IO45/IO46 float (standard for WROOM-1, verify) |
| 21 | ESD on USB data / DMX | ✅ | schematic | DMX has SM712 TVS ✓; **USB D+/D- now protected by U8 USBLC6-2SC6** ESD/TVS array (VBUS clamp at the connector) |
| 22 | Self-healing input fuse | ✅ | schematic | **F1 BSMD1206-150-16V PPTC** (1.5A hold, 25mΩ) in series on USB VBUS; resets after an overcurrent/short. PoE path uses the DP9900M internal limit. |
| 23 | +5V transient clamp | ✅ | schematic | **D11 SMAJ5.0A** (5V standoff, 6.4V breakdown, 9.2V clamp) on +5V→GND; shunts surges/ESD. No conduction at the ≤4.7V normal rail. |
| 24 | DMX common-mode chokes (EMC) | ✅ | schematic | **L2/L3 ACM2012-201-2P** (200Ω@100MHz) in series on each DMX A/B pair, cable side. Order from cable: XLR → SM712 TVS → choke → transceiver. Cuts common-mode emissions on the (long) DMX cables. |
| 25 | Ferrite supply filters (EMC) | ✅ | schematic | **FB1** (600Ω@100MHz) on +5V→DMX iso DC-DC inputs; **FB2/FB3** on each B0505S output (VISO/VISO2) → DMX driver. Keeps DC-DC switching noise off the +5V rail and off the DMX cable. |
| 26 | Conformal coating (environment) | 🔲 | assembly note | Specify acrylic/urethane conformal coat for humidity/dust/condensation in harsh installs. Mask connectors + the magjack. Process step, no BOM part. See docs/ruggedization.md. |

## ✅ RESOLVED — EMC placement (was a blocker)
Decoupling/crystal/switcher caps were at 20-56mm auto-grid positions (HF decoupling essentially absent).
Fixed by `place_decoupling.py`: every cap snapped hard to its IC power pin (≤2-3mm, same side), crystal +
load caps hugging the W5500, buck Cin/Cout/L tight at U4, TVS at the XLR. `validate_placement.py` now
passes (0 overlaps, 2mm min gap). Re-routed + re-validated.

## Ruggedization (harsh-environment hardening, 2026-06-22)
Added a protection layer for touring/stage/field use. The DMX outputs were already the strongest defence
(galvanic isolation via B0505S + ISO3086 + SM712 TVS); PoE is isolated (DP9900M 1500V + SMAJ58A). This
pass closed the remaining gaps and improved EMC. Full rationale + part numbers in **docs/ruggedization.md**.
- **U8 USBLC6-2SC6** — ESD/TVS array on USB D+/D- (+VBUS clamp), at the connector. (item 21)
- **F1 PPTC (1.5A/16V, 25mΩ)** — self-healing fuse on USB VBUS; SS54 OR diodes keep the B0505S margin. (22/9)
- **D11 SMAJ5.0A** — +5V transient/overvoltage clamp. (23)
- **L2/L3 ACM2012-201-2P** — common-mode chokes on each DMX pair, cable side, after the TVS. (24)
- **FB1/FB2/FB3 (600Ω@100MHz)** — pi-filter the isolated DMX DC-DC input (+5V) and outputs (VISO/VISO2). (25)
- **Conformal coating** — assembly note for humidity/dust (no BOM part). (26)
- **Grounding/shielding** — 4 mounting holes are plated + on GND to bond the digital ground to a
  metal chassis (multipoint). Digital shields (USB/Eth) → chassis; isolated DMX grounds stay OFF
  chassis (isolating XLR mount). Soft-ground bridge (GNDISO→GND via 1nF+1M) was evaluated but NOT
  fitted — it can't cross the 4mm void cleanly at the packed PS1/PS2 barrier. (docs/ruggedization.md)
Net restructuring: DMX_A/B (transceiver) → choke → DMX_AO/BO (cable side, where the TVS, XLR and the
J7/J8 breakouts now sit); +5V_USB → F1 → +5V_USBF; +5V → FB1 → +5V_DMX → PS1/PS2; VISO → FB2 → VISO_DRV.

## PoE isolation note (item 6/8)
PD module U7 is ~50mm from magjack J3, so VPOE (isolated 48V) crosses the board. Current mitigation:
solid GND plane + 2.5mm moat around the magjack PoE through-pins + DRU 2.5mm surface creepage + D10
(58V TVS). This gives **functional** PoE isolation; it is **not** certified 1500V-reinforced because the
VPOE surface trace runs over the inner GND plane (0.2mm FR4). For reinforced isolation, relocate
U7/D10/C27/C28 adjacent to J3 (short local VPOE run, corner void). Not a functional blocker.

## Methods that would add confidence but weren't run
- True transient SPICE of the diode-OR under a load step (ngspice ships as DLL only here; DC analytics used).
- Controlled-impedance / length-matched Ethernet diff pairs (auto-router is not impedance-aware; OK for
  short 100BASE-TX but hand-route for best eye/EMC).
- Thermal: B0505S ×2 + DP9900M dissipation at full load (estimate < board limits; not modeled).
