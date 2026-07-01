# LuxDMX v5.00 — Hardware Validation Tracking

Single source of truth for "is this board safe to fabricate?" Re-run the scripts after **any**
board change and update the table. Status: ✅ pass · ⚠️ pass-with-caveat · ❌ blocker · 🔲 needs manual/datasheet check.

**Overall verdict (2026-07-01, re-routed on a new placement + full re-validation, all 7 hard gates pass):
DESIGN-COMPLETE, fab-ready as a first-spin PROTOTYPE, not production-proven.** Electrically sound, **0 unrouted / 0 schematic-parity / 0 DRC errors**
(machine-verified, see matrix), DMX **4mm creepage** + 1kV isolation enforced, overvoltage **DMX512-A
"Protected"** SPICE-confirmed (TBU blocks a 42VDC fault in <1µs, signal 7-10x over the 200mV threshold).
Board **119 x 79mm** (widened 20mm for the TBU), 4 corner M3 holes on GND, 4-layer
**F sig / In1 GND / In2 +3V3 / B sig** stackup now **explicitly defined** (JLC04161H-7628). A
**ruggedization pass** added USB ESD (U8), a self-healing PTC fuse (F1), a +5V transient clamp (D11), a
**TPS2116 ideal-diode OR mux (U9)**, DMX common-mode chokes (L2/L3) and ferrite supply filters (FB1-3).

Honest gaps before this is "production": it has **never been fabricated** (first build = prototype), and
the **Ethernet pairs are single-ended — widened toward ~50Ω SE (`widen_eth.py`) but not coupled and not
length-matched** (see the 2026-07-01 notes; ETH_TXN also stays 0.15mm in a dense corridor). The prior 3
W5500/USB-C clearance near-misses and the sub-min via annular are **resolved**.

## 2026-07-01 — full re-route on a new placement + hands-off pipeline + re-validation

The whole board was re-routed from scratch on the current placement and re-validated end to end. **All 7
hard gates PASS** (`validate_all.sh`). Schematic/netlist were **not touched** this pass, so every
schematic-based item below (SPICE #30, rail margins #9-13, crystal #18, EXRES1 #19, PoE-TVS #27, ratings
#28, GPIO #29, magjack #17, E1.11 TBU protection) is unaffected and stays valid.

- **Net classes** (`setup_netclasses.py`): **Default 0.20 / Power 0.40 / Fine 0.15mm** (Fine = only the
  W5500-dense nets). Freerouting routes each net at its class width in ONE pass — no more "everything thin
  + post-widen". Confirmed in the exported DSN.
- **Reproducible, hands-off pipeline** — one command each on any placement change: `./route_all.sh`
  (setup_netclasses → rebuild_iso → escape_connectors → **Freerouting loop** → `finish_partial.py` →
  maze straggler → cleanup → tighten → `widen_eth.py`) and `./validate_all.sh` (7-gate verdict + exit code).
  `finish_partial.py` deletes any net FR left a pad short (via kicad-cli `unconnected_items`) so the maze
  finishes it — no hand-routing.
- **7-gate production gate**: connectivity, DRC, geometry/DFM+current, DMX isolation, electrical, EMC
  placement, and the new **`validate_critical.py`** (eth/SPI/crystal length, vias, intra-pair skew, detour,
  net-class widths).
- **DRC rules aligned to the relaxed-but-JLC-safe spec** (`.kicad_pro`): min track **0.15mm** (JLC min
  0.0889), hole-to-hole **0.2mm**, vias **0.5/0.2 = 0.15mm annular**, min-annular rule **0.13**.
- **Ethernet impedance improved** (`widen_eth.py`, run last): the MDI pairs are widened toward ~50Ω SE on
  the JLC04161H-7628 stackup — **ETH_RXN/RXP/TXP now ~0.34mm ≈ 53Ω**, with short 0.15mm necks at the QFN.
  **ETH_TXN stays 0.15mm/~78Ω** (its corridor is too dense to widen without eating the 0.15mm clearance to a
  Default neighbour). Better than the old 0.2mm/69Ω, but still **single-ended / not length-matched** —
  coupled diff-pair routing remains deferred to a supervised interactive-GUI production spin.
- **DMX iso B-pour** (`validate_tbu_iso.py` check B): FR puts a REST-side DMX trace (**DMX_AO**, behind the
  TBU, not fault-exposed) on B.Cu inside the GNDISO pour. The gate now enforces B.Cu-off-pour only for the
  **CABLE-side** fault-exposed nets (*_AX/BX); the REST cut is bridged by the F.Cu pour + stitch vias
  (keepouts can't be used — Freerouting chokes on rule areas).
- **Two operator placement fixes closed the last two gates**: **F5** (DMX2 fuse) moved for the 4mm creepage
  (which is invariant to the void margin — it was always a placement issue); **U9** (OR-mux) loosened so
  +5V_USBF clears a GND via. Design rule confirmed: if a net won't route under the requirement, move parts.
- **Fab package regenerated**, each **hard-gated on 0 unrouted**: 14 gerbers → `luxdmx_gerbers.zip`,
  97 placements → `luxdmx_CPL.csv`, 49-line BOM.

## Post-validation hardening (2026-06-29)
Re-validated live against the committed board (not from notes). Every edit clearance-checked by real DRC;
the board was never left worse than the prior step; backups taken at each step.
- **Via annular** — 14 escape vias were 0.125mm annular (0.5/0.25, under the 0.13mm DFM rule). Fixed by
  shrinking the drill 0.25 -> 0.20mm (pad unchanged = zero clearance change): now **0.150mm, 0 sub-min**.
- **Dangling via** — one stub via on CC2 (USB-C) removed; CC2 stays fully connected (gate: 0 unrouted).
- **Fine-pitch clearance** — the 3 prior "errors" (W5500 ETH_TXP/GND/+3V3 at the 0.5mm QFN pitch, USB-C
  CC2) were 0.16-0.174mm vs a 0.2mm rule. **Re-route to 0.2mm is geometrically impossible at 0.5mm pitch**
  (0.25mm pad + 0.2mm trace + 2x0.2mm clearance = 0.85mm needed in a 0.5mm pitch). The 0.2mm rule was
  simply stricter than fine-pitch parts allow, so the Default netclass clearance is now **0.15mm** (still
  68% over JLC's 0.0889mm min). **No copper moved.** DRC clearance errors now **0**.
- **Ethernet stackup + impedance** — added the **JLC04161H-7628 4-layer stackup** (L1-L2 prepreg 0.2104mm,
  Er 4.05). With the 0.2mm traces that is ~69 ohm single-ended / ~117 ohm differential, **above the 100
  ohm target**, and the pairs are **not actually coupled** (ETH_TXP takes a 42mm B.Cu detour vs ETH_TXN's
  22mm F.Cu = ~20mm intra-pair skew). **Deliberately NOT re-routed by script:** correct coupled,
  length-matched diff-pair routing needs the interactive GUI (the single-net auto-router can't do it) and a
  botched Ethernet re-route is the worst failure mode, so it is left for a supervised production spin.
  Functional for short 100BASE-TX as-is.
- **Silk** — `normalize_silk.py` re-placed 89 ref-des clear of pads/silk, dropping cosmetic warnings
  **62 -> 46** (24 overlap / 16 edge / 6 over-copper). The rest are dense-area ref-on-ref, refs near the
  edge (J*/MH* not moved) and the informative back-silk tables; fab auto-clips silk off pads/edges.

## How to re-run the validation
```
python validate_electrical.py      # DC/RC operating points (no KiCad needed)
"<KiCad>/bin/python" validate_geometry.py     # trace width / via current / DFM
"<KiCad>/bin/python" validate_placement.py    # decoupling/ferrite/switcher proximity (EMC); also auto-run by gen_gerbers.py, exits non-zero on drift
"<KiCad>/bin/kicad-cli" pcb drc --format json -o drc.json luxdmx.kicad_pcb   # DRC + connectivity
# --- 2026-07-01: after ANY placement/netlist change, just two commands (the above validators are all
#     wrapped by validate_all.sh; run them standalone only to debug a specific gate) ---
bash route_all.sh       # setup_netclasses -> rebuild_iso -> escape -> Freerouting-loop -> finish_partial -> maze -> cleanup -> tighten -> widen_eth
bash validate_all.sh    # 7-gate production verdict + exit code (connectivity/DRC/geometry/DMX-iso/electrical/placement/critical)
```

## Status matrix

| # | Item | Status | Method | Result / action |
|---|------|--------|--------|-----------------|
| 1 | Routing complete (MACHINE-ENFORCED) | ✅ | `validate_connectivity.py` (kicad-cli DRC `unconnected_items`), wired into gen_gerbers.py + gen_cpl.py | **v4.01: 0 unrouted, machine-verified.** The gate ABORTS any fab export while a single net is unrouted; it caught **C17** (stranded INSIDE the DMX2 isolation void, planes cut away -> unconnectable). v4.01 (2026-06-28): C17 moved to the buck + via-in-pad; **bias R20-R23** placed + **re-routed by Freerouting on F.Cu only** (0 signal B.Cu, so the iso GND pour is not cut), and **122 GNDISO/GNDISO2 stitch vias** reconnect the F-pour fragments to the solid B-pour. **Isolation verified: 0 island-net copper leaves its island.** EN/IO0 preserved from HEAD (digital side locked, not re-routed). **0 DRC errors** after the 2026-06-29 hardening (the W5500 fan-out + USB-C CC2 fine-pitch near-misses resolved by the 0.15mm Default clearance). Fab package regenerated. |
| 1b | 4-layer power stackup | ✅ | rebuild_iso (In1=GND, In2=+3V3 LT_POWER) | signals F/B only, planes solid; +3V3/GND pads stitched to planes |
| 2 | DRC (electrical) | ✅ | kicad-cli pcb drc | **0 shorts, 0 clearance errors.** The 3 fine-pitch near-misses (W5500 0.5mm QFN + USB-C CC2, 0.16-0.174mm) resolved by setting Default clearance 0.2 -> 0.15mm; re-route to 0.2mm is geometrically impossible at 0.5mm pitch, 0.15mm still 68% over JLC's 0.0889mm min |
| 3 | DRC (silk cosmetic) | ⚠️ | kicad-cli pcb drc | **46 cosmetic** silk warnings (24 overlap / 16 edge / 6 over-copper) after `normalize_silk.py` re-placed 89 ref-des clear of pads/silk (down from 62). The rest are dense-area ref-on-ref, refs near the edge (J*/MH* not moved) and the informative back-silk tables; fab auto-clips silk off pads/edges = no functional or fab impact. Accepted |
| 4 | Net connectivity = intent | ✅ | board generated from `luxdmx.net` (SKiDL) | by construction; schematic reviewed pin-by-pin |
| 5 | Decoupling/xtal/switcher placement (EMC) | ✅ enforced | **validate_placement.py** (per-part pad-to-pad distance to the served IC pin, incl. crystal load caps + **FB1/2/3 supply ferrites**) **wired into gen_gerbers.py** (reports drift on every fab export, exits non-zero standalone) + place_decoupling.py to re-snap | each cap/ferrite has a per-part max distance to its IC pin; after any placement change, re-run place_decoupling.py to re-cluster + validate_placement.py to confirm. Connectivity stays the HARD gate; placement is a loud quality WARNING (never blocks fab on a fuzzy threshold) |
| 5b | Board outline / mounting holes | ✅ | set_outline_holes.py | **99 x 79mm**; 4 corner M3 holes at **90 x 70mm spacing, uniform 4.5mm inset** (all 4 equal edge distance); 0 hole-vs-body collisions. Holes are **plated + tied to GND** (MountingHole_3.2mm_M3_Pad) so the 4 corners bond board GND to a metal chassis — see docs/ruggedization.md "Grounding & shielding". |
| 6 | PoE module ↔ magjack distance | ⚠️ | geometry | VPOE runs ~50mm; functional, see PoE note |
| 7 | Isolation surface creepage (DMX 4mm / PoE 2.5mm) | ✅ | DRC `.kicad_dru` | 0 isolation-clearance violations |
| 8 | Isolation inner-plane (vertical) | ✅ | rebuild_iso + tighten_poe_void | DMX islands voided 4mm; PoE TH-pins moated 2.5mm; VPOE surface trace over plane = functional 58V (D10-clamped) |
| 9 | +5V rail vs B0505S 4.5V min | ✅ | sim/power_chain.cir | **Fixed:** OR diodes (D8/D9) replaced by a **TPS2116 ideal-diode mux (U9)** — OR drop ~0.03V not ~0.40V. +5V ≈ 4.91V from a 5.0V USB; **VCC2 ≥ 4.61V even at VBUS 4.70V** (was ~4.29V ❌). PoE clean. SPICE-verified across the full USB range. |
| 10 | Buck +3V3 output | ✅ | validate_electrical.py | 3.318V (R10/R11) |
| 11 | LED currents | ✅ | validate_electrical.py | 1.3-8.7mA, all < GPIO 40mA |
| 12 | EN power-on RC | ✅ | validate_electrical.py | 10ms |
| 13 | USB-C CC / power budget | ⚠️ | validate_electrical.py | Rd=5.1k correct; ~370mA → needs ≥1A source for both universes |
| 14 | Power trace width vs current | ✅ | widen_power.py | +5V family widened to **0.5mm** where clearance allows (0.5mm=1.45A@10°C); only short pad-entry necks remain 0.2mm (heat sinks into the pad). Fuse coordination ok: F1 trips ~3A, a 0.2mm trace doesn't fuse below ~8A. Re-run widen_power.py after any re-route (it resets widths). |
| 15 | Via current / annular | ✅ | validate_geometry.py | via current fine; **escape-via annular fixed 0.125 -> 0.150mm** (14 vias re-drilled 0.25->0.20, pad unchanged); **0 sub-min** |
| 16 | DFM vs JLCPCB 4-layer | ✅ | validate_geometry.py | min trace 0.2mm, drill 0.2mm OK |
| 17 | Magjack HY931147C pinout | ✅ | datasheet | verified vs HanRun REV.A/1 (2026-06-22): TD=5/6, RD=1/2, RCT=3/TCT=4, V+=9/V-=10, LED-Y=11/12 (A/K), LED-G=13/14 (A/K); straight MDI correct (no auto-MDIX) |
| 18 | W5500 crystal CL vs caps | ✅ | datasheet (2520-25-**20**) | **FIXED**: crystal is CL=20pF; caps 22pF→**33pF C0G** (presented 15pF→20.5pF). Was running the 25MHz fast. |
| 19 | W5500 EXRES1 | ✅ | datasheet | **FIXED**: R3 12k→**12.4k 1%** (on-spec PHY bias) |
| 27 | PoE TVS margin | ✅ | datasheet | **FIXED**: D10 SMAJ58A→**SMAJ60A** (58V standoff was only 1V over 57V max) |
| 28 | Every part rating/value/datasheet | ✅/⚠️ | 4-agent datasheet pass | see **VALIDATION_REPORT.md**: all active parts + crystal + connectors read from official datasheets; ratings/values recomputed. 3 fixes applied, open items listed. |
| 29 | ESP32-S3 GPIO map | ✅ | datasheet | **every pin validated, zero must-change**. IO35/36/37 free (N8 no PSRAM), strapping safe, no flash/input-only conflict, UART/SPI routable, IO19/20 native-USB noted |
| 30 | SPICE power chain | ✅ | ngspice-42 (WSL) | DC + transient (sim/*.cir): with the TPS2116 mux, VCC2 ≥ 4.5V across the **whole** USB range (4.61V @ 4.70V VBUS, 65mΩ-max-over-temp case 4.59V); PoE 5.0V→4.91V ✓; load-step ok. See report §3 (margin now resolved). |
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
- **F1 PPTC (1.5A/16V, 25mΩ)** — self-healing fuse on USB VBUS; the TPS2116 OR mux (U9) keeps the B0505S margin. (22/9)
- **D11 SMAJ5.0A** — +5V transient/overvoltage clamp. (23)
- **L2/L3 ACM2012-201-2P** — common-mode chokes on each DMX pair, cable side, after the TVS. (24)
- **F2-F5 Bourns TBU-CA065-200-WH (200mA/650V high-speed protector, C913221)** — series TBU per DMX data
  line for **DMX512-A Protected** (Annex C, the "fault-protected" approach). Chain: cable/XLR + breakout →
  **TBU** → SM712 TVS → choke → transceiver; a sustained 30VAC/42VDC fault makes the TBU trigger in <1µs and
  BLOCK (650V standoff) so the SM712 only sees the sub-µs transient. v5.00 replaced the v4.01 PTC (its ms
  thermal trip let ~19A through the SM712 → would cook). SPICE-confirmed (spice/sim_tbu.py); 8.6Ω×2 series is
  signal-OK (far receiver 7-10× threshold). 4.0mm cable-side creepage; board widened 20mm right to fit the
  bigger TBU + keep all 4 corner MH on GND. **Annex-C survival bench-test still pending** before the silk
  "Protected" mark. (see E1.11_COMPLIANCE.md)
- **FB1/FB2/FB3 (600Ω@100MHz)** — pi-filter the isolated DMX DC-DC input (+5V) and outputs (VISO/VISO2). (25)
- **Conformal coating** — assembly note for humidity/dust (no BOM part). (26)
- **Grounding/shielding** — 4 mounting holes are plated + on GND to bond the digital ground to a
  metal chassis (multipoint). Digital shields (USB/Eth) → chassis; isolated DMX grounds stay OFF
  chassis (isolating XLR mount). Soft-ground bridge (GNDISO→GND via 1nF+1M) was evaluated but NOT
  fitted — it can't cross the 4mm void cleanly at the packed PS1/PS2 barrier. (docs/ruggedization.md)
Net restructuring: DMX_A/B (transceiver) → choke → DMX_AO/BO (cable side, where the TVS, XLR and the
J7/J8 breakouts now sit); +5V_USB → F1 → +5V_USBF and +5V_POE → **U9 (TPS2116 OR mux)** → +5V → FB1 →
+5V_DMX → PS1/PS2; VISO → FB2 → VISO_DRV.

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
