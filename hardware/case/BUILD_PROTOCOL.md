# LumiGate enclosure - build protocol

A chronological record of how the enclosure was produced, the decisions taken, the
problems hit and how they were solved. (Requested as part of the task.)

## 0. Goal

A parametric, code-defined 3D-printable housing for the LumiGate v3 board with:
holding clamps, openings for Ethernet / USB-C / XLR(DMX), XLR flange screw holes at
the correct position, LED windows, buttons covered, the ESP32 (which overhangs the
PCB) fully enclosed, a removable side so the board can be inserted, and photoreal
documentation renders. "Case as code" so outputs regenerate after changes.

## 1. Toolchain (installed as needed)

| Tool | Use | Notes |
|---|---|---|
| **OpenSCAD 2021.01** | parametric case → STL | installed via `winget install OpenSCAD.OpenSCAD` |
| **KiCad 10.0 `kicad-cli`** | populated-board → GLB | already present (9.0 + 10.0). The board is a v10 file, so **9.0 fails to load it** — use 10.0 |
| **Blender 5.1** | Cycles raytraced renders | already present; OPTIX GPU available |
| Python 3.11/3.13 | PCB parsing, validation | no `pcbnew` module → wrote a standalone s-expression parser |

Decision: **OpenSCAD** for the case (confirmed with the user) - lightweight, the
de-facto "enclosure as code" tool, trivial CLI STL export. **Round XLR hole + 2 wall
screws** chosen for the DMX connector (confirmed with the user).

## 2. Geometry extracted from the PCB

`lumigate.kicad_pcb` is a single Edge.Cuts rectangle → board **74.64 × 51.43 mm**.
A custom s-expr parser (no pcbnew) + the KiCad footprint placement transform
`(bx,by) = (px + lx·cosθ + ly·sinθ, py − lx·sinθ + ly·cosθ)` (verified against the
RJ45 opening direction) gave, in a board-local frame (u=+X right, v=+Y bottom):

* **XLR (J1)** exits +X (right) wall; axis at (u 60.2, v 14.6); 2 mounting holes at
  v 10.7 / 18.4.
* **RJ45 (J3)** exits +X; v-span 31.7…47.8.
* **USB-C (J2)** exits +Y (bottom); u-span 33.0…41.9.
* **ESP32 (U1)** module **body** (F.Fab) overhangs the **left** edge by **6.35 mm**
  (the courtyard extends to ~21 mm but that is the antenna RF keep-out, not a
  physical obstruction — important distinction used later for clamp/ear clearance).
* **LEDs D2-D6** in a row at v≈2.9, emitting +Z → windows in the lid.

This is emitted to `board_params.scad` by `extract_case_params.py`, so the case
re-derives from the live board.

## 3. Case architecture

Split **at the PCB top plane**:
* **base** = floor + board pocket + support ledge + snap clamps,
* **cover** = deep shell with all wall openings (bottom-open so connectors enter as
  the cover lowers), LED windows + light guides, hold-down lip, corner ears.

Why this split: connectors live on **two perpendicular walls** (XLR+RJ45 right,
USB-C bottom). A vertical clamshell assembly (board drops into base, cover drops on)
is the only scheme that threads multi-wall connectors without tilting or open-topped
slots. All connector bodies sit above the parting plane, so their openings are open
at the bottom edge of the cover and self-clear during assembly.

## 4. Problems hit & fixes

1. **`pcbnew` not available** in the local Python → wrote a tolerant s-expression
   parser; works on the KiCad 9/10 multi-line footprint format.
2. **Wrong KiCad rotation sign** initially put connectors on the wrong edges →
   derived the correct transform empirically (RJ45 must exit +X) and verified all
   connector board-coords against the 3D board render.
3. **Disconnected solids** (OpenSCAD reported `Volumes: 4` for the base): my first
   snap-latch closure assumed a deep base, but the base wall is only ~5 mm tall, so
   the 9 mm latch arms floated below the floor; the board snap-clamp slots also cut
   through the floor and **isolated each clamp**. Fixes:
   * replaced wall snap-latches with **4 external corner-ear M3 screws** (the only
     board-free fastening zone — the PCB fills the whole footprint and the right wall
     is full of connectors);
   * rebuilt the snap clamp as an inner-wall cantilever flexing into an outer pocket,
     anchored to the floor (no floor-cutting slots).
   Verified with a Python STL connected-component check → **1 component**, and
   `Simple: yes` (manifold). (`Volumes: 2` = the CGAL outer background + 1 body, i.e.
   a single solid with no sealed voids.)
4. **Board-edge clamps didn't fit** the 0.35 mm board-to-wall gap → the clamp is a
   slice of the wall itself (thinned for flex), not a finger standing in the gap.
5. **Validation false-positive** (ear "hits" U1): the ESP32 *courtyard* includes the
   antenna keep-out reaching far outside the board; switched the internal-feature
   clearance checks to use the **F.Fab body** outline → ears/clamps clear.
6. **Heights were guessed too low.** Aligning the real populated **GLB** into the
   case frame in Blender exposed the true component heights:
   | part | my estimate | real (above board top) |
   |---|---|---|
   | XLR barrel axis | 12.5 mm | **15.8 mm** |
   | XLR barrel top | 24.5 mm | **28.3 mm** |
   | RJ45 height | 13.8 mm | 14.4 mm |
   | RJ45 width | 16.1 mm (courtyard) | **18.7 mm** (real body) |
   | PS1 (B0505S) | n/a | 10.0 mm tall |
   With the old `cav_h=26`, **the XLR would have punched through the lid**. Corrected
   `cav_h=30`, `xlr_axis_z=15.8`, `xlr_hole_dia=24.5`, RJ45 opening widened to 19 mm,
   and snap-clamp positions moved to the real free zones (clear of PS1 at v1.9-7.9 and
   the RJ45 body reaching v49.1).
7. **Blender scale blow-up** (board imported at km scale): the glTF nodes carry a unit
   scale that I baked then re-multiplied. Fixed by parenting to one empty and scaling
   once (no compounding); board substrate detected via the modal object z-min so it
   seats on the ledge, not on the THT pin tips.

## 5. Validation (`validate_fit.py`, cross-checked vs the live PCB)

```
Board 74.6 x 51.4 mm   outer 87.4 x 56.9 x 39.5 mm
  OK | left cavity -7.95 encloses ESP32 overhang -6.35 (>=0.5mm clear)
  OK | right wall at board edge 74.64 = XLR flange plane
  OK | XLR hole y 14.6 near J1 courtyard centre 14.7 ; dia 24.5 >= barrel
  OK | XLR wall screw v=10.7 / 18.4 within J1 span
  OK | RJ45 opening (19.1) covers J3 v-span [31.7,47.8]
  OK | USB-C opening (10.3) covers J2 u-span [33.0,41.9]
  OK | 5 LED windows over D2..D6 (Δ<0.03 mm)
  OK | corner ears clear of all component bodies
  OK | snap clamps clear of component bodies
  OK | cavity 30 mm clears tallest opening 28.1 mm
  17 pass, 0 warn, 0 fail
```

Plus: both STLs `Simple: yes` (2-manifold) and **1 connected component** each (single
printable piece, no loose fragments, no sealed voids).

## 6. Outputs

* `lumigate_case_base.stl`, `lumigate_case_cover.stl` - ready to slice.
* `render/01_hero_assembled.png` … `06_front_usbc.png` - Cycles raytraced docs.
* `prev/*.png` - quick OpenSCAD previews + cross-sections used during development.

## 7. Open points / future tuning

* Connector **heights** are measured from the current GLB; if a different XLR/RJ45/
  USB-C part is fitted, update the height block in `lumigate_case.scad`.
* The XLR flange **screw spacing** defaults to the connector's PCB mounting-hole
  v-positions; set `xlr_screw_v` / `xlr_screw_z` to the real flange pattern if needed.
* First print should be a **fit test**: verify snap-clamp grip (`clamp_catch`,
  `clamp_t`) and cover-lip pressure (`lip_press`) on the actual board, then adjust.
* The cover has generous empty headroom on the LED/ESP32 side (the XLR drives the
  height); a stepped lid could save material/filament later if desired.

---

## 8. Revision 2 - fixes from the first render review

The first renders were reviewed and four issues were reported and fixed:

1. **XLR hole ~7 mm too high & too big.** Root cause: I had taken the XLR centre as
   `bbox_top − radius`, but the connector's bbox top is the **"PUSH" latch tab**, not
   the barrel. `measure_connectors.py` (new) slices the connector **at the wall
   plane** and reports the real cross-section: barrel centre **+13.05 mm** (not 15.8)
   and **~16-18 mm** across (not 24.5). Fixed: `xlr_axis_z=13.0`, `xlr_hole_dia=19`.
2. **Ethernet cutout too big.** The 19.1 mm opening used the magjack's full body bbox
   (18.7 mm) incl. the rear flanges that don't poke through. The face **at the wall**
   is 16.3 mm. Fixed: `rj45_open_w=17` (snug, ~0.4 mm/side).
3. **External screw ears are ugly / outside not straight.** Replaced the 4 corner-ear
   screws with a **flush snap-fit**: the cover has an overlapping skirt that wraps a
   recessed rim on the base (3 sides - the connector-filled right wall is a butt
   joint), with an inner snap rib clicking into a base groove. No external features;
   outer faces are flush. Front **pry-notches** open it. (Vertical internal screw
   bosses are impossible here - the rectangular PCB fills the whole footprint to
   within 0.35 mm of the walls, leaving no board-free column except the left strip.)
4. **LED windows were on the lid.** Moved to the **front side wall** next to the LEDs:
   5 separate 1.6 × 3.4 mm windows (LED pitch is 2.51 mm, so widths are kept ≤1.6 mm to
   leave ~0.9 mm printable dividers). Removed the lid holes + light-guide tubes.

Also added: **`lumigate_case_assembly.glb`** (board + base + translucent cover,
exported from `render_blender.py`) so the whole assembly can be inspected in any glTF
viewer (Windows 3D Viewer / Blender / gltf-viewer.donmccurdy.com).

Re-validated: **21 pass, 0 warn, 0 fail**; both STLs still manifold + single-piece.
The Blender connector render confirms the XLR now seats flush in its hole with no top
gap, and the RJ45 fills its opening.

---

## 9. Revision 3 - more review feedback

1. **XLR flange screw holes "missing".** They were in the code, but at the connector's
   PCB-post v-positions (±3.85 mm from centre) they sat **inside** the Ø19 barrel hole
   *and* inside the assembly relief below it - invisible. A straight-on GLB close-up
   (`render_blender.py -- xlr`) showed the real connector has **no front flange
   screws** at all (it mounts via 2 rear PCB posts) and a **PUSH latch at the top**.
   Fix: placed the 2 wall screw holes **flanking the barrel** (3/9 o'clock,
   `xlr_screw_off=11`, clear of the hole + relief), and added a **PUSH-latch slot**
   above the barrel (keyhole) so the cable can be released.
2. **USB-C drop-in collision.** The board drops straight down into the base; the USB-C
   overhangs the back edge and its underside sits only **+0.05 mm** above the board
   top, i.e. it would scrape the base back-wall top on insertion. Fix: lowered the base
   back-wall top **2.5 mm** under the USB-C (`usbc_drop`) and recessed the left block
   **1.5 mm** under the ESP32 module (`esp_drop`). Added drop-in path assertions to
   `validate_fit.py` (clearance + no snap clamp in the USB-C column).
3. **Rounded outer edges.** All outer edges/corners are now rounded (`edge_r=2`, limited
   by the 2.4 mm wall) via a hull-of-8-spheres outer shell whose mating face (the
   parting plane) is cut flat for a flush seam. (`base_outer()` / `cover_outer()`.)
4. **USB-C to the opposite side (PCB layout)?** Considered, then declined: the side
   opposite the DMX/Ethernet (right wall) is the **ESP32 WiFi antenna** side (left),
   which is RF-hostile for a USB cable and is physically occupied by the module +
   antenna-overhang cavity. It would also be a board respin (re-route USB+5V). Decision
   (with the user): **keep USB-C on the back wall** - the case already handles it.

Re-validated: **28 pass, 0 warn, 0 fail**; both STLs manifold + single connected piece.

---

## 10. Revision 4 - the mirror bug (handedness)

**Symptom (user):** in a glTF viewer the assembly looked mirrored along the long
axis - USB-C/Ethernet appeared on the opposite side from the KiCad layout, and the
XLR "PUSH" text rendered backwards.

**Diagnosis.** `_mirror_check.py` imported the populated GLB with **no** Y-flip and
rendered the XLR face: "PUSH" read **correctly**, and the XLR sat at **v≈37.6** - but
the case puts the XLR opening at **v=14.6**, the mirror position (37.6 + 14.6 ≈
board_h). So the GLB is right and the **case was mirrored**.

**Root cause.** `extract_case_params.py` maps `v = KiCad_Y − minY`. KiCad's Y axis
points **down**; OpenSCAD's Y points **up**. Using KiCad_Y directly as OpenSCAD +v
flips the handedness, so the whole case (openings, LED windows, XLR screw diagonal,
clamps) was built as a **mirror image of the real board** - it would not have fit.
(The earlier Blender renders *hid* this: they mirrored the board with `scale.y=-1`
to make it line up with the mirrored case, which also flipped the "PUSH" text - the
tell-tale.)

**Fix.** One compensating reflection on the OpenSCAD output, `vflip()` (mirror about
the board's v centre line). It reflects every feature *together*, so all clearances
and the validation stay intact, and the exported parts now match the real board.
The renderer uses `FLIP_Y = False` (the GLB is correct as-is). Verified: "PUSH" now
reads correctly, USB-C sits on the same edge as in KiCad, and the board GLB + case
align with no mirror. (A cleaner long-term fix is to negate v in
`extract_case_params.py` and swap the hard-coded front/back walls; `vflip()` is the
lower-risk equivalent.)

Re-validated: **28 pass, 0 warn, 0 fail**; STLs manifold + single piece. Doc renders
re-shot at max quality (480-spp Cycles) from the connector corner.

---

## 11. Revision 5 - cut-out fit (alignment, 22mm XLR, lip vs USB-C)

1. **"XLR/Ethernet cut-outs laterally shifted / too big."** The *case* was right; the
   **renderer** placed the board ~0.79mm off. It aligned the component bounding-box
   min to the edge, but the USB-C **overhangs the PCB edge** by ~0.8mm, so the whole
   board (and every right-wall opening) shifted. Fixed: align the board to its
   **outline edge** (`BOARD_H - mx.y`, using the glTF user-origin) instead of the
   overhang. Measured before/after: XLR connector v 37.64 -> **36.85** = the opening
   centre exactly.
2. **XLR hole = 22mm.** Per the connector datasheet (panel cut-out 22mm); mine was 19.
   With 22mm the barrel is snug.
   - First attempt kept the assembly **relief** (the slot below the hole that let a
     PCB-mounted barrel drop past a vertically-lowered cover); with 22mm it widens to
     ±11mm and swallowed the datasheet's **lower** diagonal flange screw.
   - **Final (user request): the relief is removed** (`xlr_relief=false`). The XLR
     opening is now just the **clean Ø22 round hole + the PUSH slot**. The cover goes
     over the PCB-mounted barrel by **tilting it in**, so the relief isn't needed. Both
     diagonal flange screws now sit in solid material. (`xlr_relief=true` brings the
     slot back if you prefer straight-down assembly.)
3. **Housing intersected the USB-C (bottom).** Real case bug: the cover's **hold-down
   lip** (the inner ledge that presses the board top edge) ran along the USB-C edge and
   crushed into the connector body. The lip was only opened at the ESP32. Fixed:
   `hold_down_lip()` now also opens at the **USB-C** and the whole **right edge**
   (XLR + RJ45) - anywhere a connector sits on the board edge.
4. **Red inspection GLB.** Added `render_blender.py -- redglb` -> `lumigate_case_assembly_red.glb`
   (housing red + ~40% opaque) + `render/red_connectors.png` / `red_usbc.png`, so the
   cut-out-vs-connector fit is easy to judge.

Re-validated: **28 pass, 1 warn (lower XLR screw in relief), 0 fail**; STLs manifold +
single piece. Verified in the red render: USB-C clear of the lip, XLR snug in the 22mm
hole, connectors centred in their openings.

---

## 12. Revision 6 - XLR relief removed + per-LED light caps

1. **XLR relief removed** (user). The rectangular assembly slot below the barrel hole
   was overshooting the screw hole. `xlr_relief=false` now -> just the clean **Ø22
   round hole + PUSH slot**; the cover goes over the PCB-mounted barrel by tilting it
   in. Both diagonal flange screws are now in solid material (warning gone -> **28/0/0**).
2. **Per-LED light-guide caps** (user idea). The LEDs were plain side windows; now each
   LED sits under a little walled **chamber** (`led_caps()`): 2 side dividers + back
   wall + roof, open at the bottom over the LED, exiting only through that LED's window.
   This **isolates each colour** (no bleed to the neighbour) and channels it out. The
   LED pitch is 2.51mm and the bodies are only ~0.8mm wide along the row, so the
   dividers are a comfortable 1.2mm. Verified by lighting the 5 LEDs (R/G/Y/B/W) in the
   render - `render/red_leds.png` / `07_leds.png` show five cleanly separated colours.
   (`led_caps=false` reverts to plain windows.)

Both STLs manifold + single piece; validation **28 pass, 0 warn, 0 fail**.
