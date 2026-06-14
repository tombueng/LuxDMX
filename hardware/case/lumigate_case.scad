// =============================================================================
//  LumiGate v3 - parametric 3D-printable enclosure  (OpenSCAD, "case as code")
// -----------------------------------------------------------------------------
//  Two-part clamshell, split at the PCB top plane, closed with a FLUSH snap-fit
//  (no protruding screws - the outside stays straight):
//
//    * BASE  - shallow tray: floor, board pocket, support ledge, board snap
//              clamps, and a recessed rim on 3 sides with a snap groove.
//    * COVER - deep shell: every connector opening (XLR round hole + 2 flange
//              screws, RJ45, USB-C), LED windows in the FRONT side wall, a
//              perimeter hold-down lip, and an overlapping skirt whose inner
//              rib snaps into the base groove.  Outer faces are flush.
//
//  Assembly:  drop PCB into the base (snap clamps hold it) -> press the cover
//  straight down until the skirt clicks over the base rim.  Connectors enter
//  their bottom-open openings.  To open: pry the seam (front pry-notches).
//
//  Connector opening sizes/heights were MEASURED from the populated board GLB
//  at the wall plane (measure_connectors.py), not guessed.
//
//  Frame (board-local; positions come from extract_case_params.py):
//    X = u  -> +X = RIGHT wall  (XLR + RJ45)     Y = v -> +Y = BOTTOM wall (USB-C)
//    Z      -> up; z=0 = inner floor top;  board top = split_z (parting plane)
// =============================================================================

include <board_params.scad>     // AUTO-GENERATED - run extract_case_params.py

part = "assembly";

// ----------------------------------------------------------- print / structure
wall        = 2.4;     // side-wall thickness
floor_th    = 2.2;     // base floor thickness
ceil_th     = 2.2;     // cover top thickness
clr         = 0.35;    // PCB-to-pocket XY clearance (per side)
board_th    = 1.6;     // PCB thickness
standoff_h  = 3.5;     // gap under the board (underside above the inner floor)
ledge_w     = 1.8;     // perimeter ledge that supports the board underside
esp_clr     = 1.6;     // extra cavity beyond the ESP32 antenna overhang (left)
cav_h       = 30.0;    // cavity height above the board top (XLR tops out ~28.3mm)
corner_r    = 2.0;     // vertical corner radius
edge_r      = 2.0;     // rounding of all OUTER edges (top of cover, bottom of base, verticals)
$fn         = 72;

// ---------------------------- drop-in clearance (connectors overhang the edges) --
usbc_drop   = 2.5;     // lower the base back-wall top under the USB-C so it clears on insertion
esp_drop    = 1.5;     // recess the base left block under the overhanging ESP32 module

// ------------------------- connector openings (MEASURED at the wall plane, GLB)
xlr_axis_z    = 13.0;  // XLR barrel centre above the board top (real wall-slice cz=13.05)
xlr_hole_dia  = 22.0;  // round hole for the barrel/ring (XLR datasheet panel cut-out = 22mm)
xlr_chamfer   = 1.0;   // outside lead-in chamfer (flange seat / printable top)
xlr_relief    = false; // assembly slot below the barrel hole - OFF: clean round hole only
                       //   (the cover still goes over the PCB-mounted barrel by tilting it in)
// 2 flange screw holes on the DIAGONAL of the connector face (datasheet panel
// pattern: holes are 19.8mm apart in BOTH the horizontal (v) and vertical (z)
// axis -> +-9.9mm from the flange centre).  The flange centre (12.5mm) sits a
// touch below the oversized barrel hole (13.0): the M2 holes must hit the
// connector's real flange holes; the loose barrel hole tolerates the 0.5mm.
xlr_screw_dia  = 2.4;   // M2 clearance, normal/medium fit (ISO 273; close=2.2 / free=2.6)
xlr_screw_off  = 9.9;   // +-offset from the screw-pattern centre, PER axis (= 19.8 / 2)
xlr_screw_cz   = 12.5;  // screw-pattern centre height above the board (datasheet flange centre)
xlr_screw_diag = 1;     // diagonal sense: +1 = "/" (BL->TR), -1 = "\" (TL->BR)
// PUSH cable-release latch (top of the connector, reaches +28.3mm) - needs a slot
xlr_push      = true;
xlr_push_w    = 9.0;   // latch slot width (v)
xlr_push_top  = 29.0;  // slot top above the board top
rj45_open_w   = 17.0;  // RJ45 opening width along v (real face 16.3 + clr)
rj45_z0       = 1.2;   // RJ45 opening lower edge above board top (real face from +1.8)
rj45_h        = 13.8;  // RJ45 opening top above board top (real face to +13.4)
usbc_open_w   = 9.9;   // USB-C opening width along u (real 8.94 + clr)
usbc_z0       = -1.0;  // USB-C opening lower edge vs board top (bottom-open for assembly)
usbc_h        = 4.5;   // USB-C opening top above board top (real face to +3.25)

// ------------------------------------------ LED windows (FRONT side wall, +iy0)
// LED pitch is 2.51mm, so keep windows < ~1.6mm wide to stay separate (>=0.9mm dividers)
led_win_w     = 1.1;   // window width  (along u; LED body is ~0.8mm wide along the row)
led_win_h     = 3.4;   // window height (along z)
led_win_z0    = 0.2;   // window lower edge above the board top

// LED light-guide CAPS: a little walled chamber over each LED that isolates its light
// from the neighbours and channels it out through that LED's window (a "cap" per LED).
// LED pitch 2.51mm, LED only ~0.8mm wide along the row -> roomy 1.2mm dividers.
led_caps      = true;
led_cap_h     = 4.6;   // chamber height above the board top
led_cap_back  = 1.3;   // chamber back wall this far past the LED (inward, +v)
led_div_t     = 0.6;   // chamber wall / divider thickness
led_cap_top   = 0.8;   // chamber roof thickness

// ----------------------------------------------- flush snap-fit closure (lap)
lap_h         = 4.0;   // overlap height of the skirt below the split
lap_t         = 1.2;   // skirt thickness = rim recess (wall - lap_t stays on the base)
snap_d        = 0.6;   // snap rib depth / groove depth
snap_z        = 2.6;   // snap groove/rib centre height (z, absolute)
snap_h        = 1.4;   // snap groove/rib height
pry           = true;  // small pry notches at the front seam to open the case

// ------------------------------------------------------- board snap clamps
board_snaps   = true;  // cantilever clamps that hold the PCB before the cover
clamp_w       = 6.0;
clamp_t       = 1.5;
clamp_catch   = 1.0;
clamp_over    = 2.2;

// ------------------------------------------------------------ hold-down lip
lip_w         = 1.6;
lip_h         = 1.4;
lip_press     = 0.15;

eps = 0.05;

// =============================================================================
//  Derived geometry
// =============================================================================
split_z = standoff_h + board_th;      // parting plane (board top)
ceil_z  = split_z + cav_h;            // cover ceiling inner face
top_z   = ceil_z + ceil_th;           // cover outside top
lap_z   = split_z - lap_h;            // bottom of the overlap

ix0 = -(esp_overhang_left + esp_clr); // left inner face (module clearance)
ix1 = board_w;                        // right inner face = XLR flange / screw plane
iy0 = -clr;                           // front inner face (LED edge side)
iy1 = board_h + clr;                  // back inner face (USB-C side)

px0 = -clr;  px1 = board_w;  py0 = -clr;  py1 = board_h + clr;   // board pocket

ox0 = ix0 - wall;  ox1 = ix1 + wall;
oy0 = iy0 - wall;  oy1 = iy1 + wall;

// board snap clamps: [x, side]  side = "ylo" (front wall) | "yhi" (back wall)
clamp_pos = [[28, "ylo"], [51, "ylo"], [20, "yhi"], [46, "yhi"]];

// =============================================================================
//  Helpers
// =============================================================================
module rrect(x0, y0, x1, y1, z0, z1, r=0) {
    translate([x0, y0, z0])
        linear_extrude(z1 - z0)
            if (r > 0) offset(r) offset(-r) square([x1 - x0, y1 - y0]);
            else square([x1 - x0, y1 - y0]);
}

// 3-sided frame band (LEFT + FRONT + BACK walls; the RIGHT wall is left full for
// the connectors).  `inset` = how far in from the outer face, `t` = band thickness.
module band3(inset, t, z0, z1) {
    // left
    rrect(ox0 + inset, oy0, ox0 + inset + t, oy1, z0, z1);
    // front (y low)
    rrect(ox0, oy0 + inset, ox1, oy0 + inset + t, z0, z1);
    // back (y high)
    rrect(ox0, oy1 - inset - t, ox1, oy1 - inset, z0, z1);
}

// Outer shell with ALL outer edges/corners rounded (hull of 8 corner spheres),
// then the mating face (the parting plane at split_z) cut flat for a flush seam.
module base_outer() {           // rounded bottom + verticals; flat sharp top at split
    r = edge_r;
    difference() {
        hull() for (x=[ox0+r, ox1-r], y=[oy0+r, oy1-r], z=[-floor_th+r, split_z+r])
            translate([x,y,z]) sphere(r);
        translate([ox0-50, oy0-50, split_z]) cube([ox1-ox0+100, oy1-oy0+100, 100]);
    }
}
module cover_outer() {          // rounded top + verticals; flat sharp bottom at split
    r = edge_r;
    difference() {
        hull() for (x=[ox0+r, ox1-r], y=[oy0+r, oy1-r], z=[split_z-r, top_z-r])
            translate([x,y,z]) sphere(r);
        translate([ox0-50, oy0-50, split_z-100]) cube([ox1-ox0+100, oy1-oy0+100, 100]);
    }
}

// =============================================================================
//  Connector / LED cuts  (subtracted from the COVER)
// =============================================================================
module xlr_cut() {
    yc = xlr_axis_v;
    // barrel hole + outside lead-in chamfer
    translate([ix1 - eps, yc, split_z + xlr_axis_z]) rotate([0,90,0])
        cylinder(h = wall + 2*eps, d = xlr_hole_dia);
    translate([ix1 + wall - xlr_chamfer, yc, split_z + xlr_axis_z]) rotate([0,90,0])
        cylinder(h = xlr_chamfer + eps, d1 = xlr_hole_dia, d2 = xlr_hole_dia + 2*xlr_chamfer);
    // optional relief down to the split (lets the barrel drop in if the cover is
    // lowered straight down); OFF by default - tilt the cover over the barrel instead
    if (xlr_relief)
        translate([ix1 - eps, yc - xlr_hole_dia/2, split_z - eps])
            cube([wall + 2*eps, xlr_hole_dia, xlr_axis_z + eps]);
    // PUSH latch slot above the barrel (overlaps the hole top -> keyhole)
    if (xlr_push)
        translate([ix1 - eps, yc - xlr_push_w/2, split_z + xlr_axis_z + xlr_hole_dia/2 - 2])
            cube([wall + 2*eps, xlr_push_w,
                  xlr_push_top - (xlr_axis_z + xlr_hole_dia/2 - 2)]);
    // 2 flange screw holes on the diagonal, centred at the datasheet flange height
    for (s = [-1, 1])
        translate([ix1 - eps, yc + s*xlr_screw_off,
                   split_z + xlr_screw_cz + s*xlr_screw_diag*xlr_screw_off]) rotate([0,90,0])
            cylinder(h = wall + 2*eps, d = xlr_screw_dia);
}
module rj45_cut() {
    translate([ix1 - eps, rj45_center_v - rj45_open_w/2, split_z - eps])
        cube([wall + 2*eps, rj45_open_w, rj45_h + eps]);
}
module usbc_cut() {
    translate([usbc_center_u - usbc_open_w/2, iy1 - eps, split_z + usbc_z0])
        cube([usbc_open_w, wall + 2*eps, usbc_h - usbc_z0]);
}
module led_windows() {                 // in the FRONT side wall (iy0), next to the LEDs
    for (u = led_u)
        translate([u - led_win_w/2, oy0 - eps, split_z + led_win_z0])
            cube([led_win_w, wall + 2*eps, led_win_h]);
}
// a walled chamber over each LED: 2 side dividers + back wall + roof, open at the
// bottom (over the LED) and at the front (to that LED's wall window).  Added to the COVER.
module led_caps() {
    pitch = (len(led_u) > 1) ? led_u[1] - led_u[0] : 2.5;
    backv = led_v + led_cap_back;            // inward (v) extent of the chamber
    for (u = led_u) difference() {
        translate([u - pitch/2, iy0, split_z]) cube([pitch, backv - iy0, led_cap_h]);
        translate([u - pitch/2 + led_div_t, iy0 - 1, split_z - 1])
            cube([pitch - 2*led_div_t, (backv - iy0) - led_div_t + 1, led_cap_h - led_cap_top + 1]);
    }
}

// =============================================================================
//  Board snap clamps (part of the BASE)
// =============================================================================
module clamp(x, side) {
    inward = (side == "yhi") ? -1 : 1;
    yin    = (side == "yhi") ? iy1 : iy0;
    ztop   = split_z + clamp_over;
    fy     = (inward > 0) ? yin - clamp_t : yin;
    translate([x - clamp_w/2, fy, 0]) cube([clamp_w, clamp_t, ztop]);
    translate([x - clamp_w/2, yin, split_z]) rotate([0,90,0])
        linear_extrude(clamp_w) polygon(inward > 0
            ? [[0,0], [0, clamp_catch], [-clamp_over, 0]]
            : [[0,0], [0,-clamp_catch], [-clamp_over, 0]]);
}
module clamp_cuts(x, side) {
    inward = (side == "yhi") ? -1 : 1;
    yin    = (side == "yhi") ? iy1 : iy0;
    yout   = (side == "yhi") ? oy1 : oy0;
    ylo = min(yin, yout) - 0.5;  yhi = max(yin, yout) + 0.5;
    ztop = split_z + clamp_over + 1;
    for (sx = [-1, 1])
        translate([x + sx*clamp_w/2 - (sx<0 ? 0.9 : 0), ylo, eps]) cube([0.9, yhi - ylo, ztop]);
    translate([x - clamp_w/2 - eps, (inward > 0) ? yout - eps : yin + clamp_t, eps])
        cube([clamp_w + 2*eps, wall - clamp_t + eps, ztop]);
}
module clamp_clearance(x, side) {      // notch in the COVER for the hook
    yin = (side == "yhi") ? iy1 : iy0;
    inward = (side == "yhi") ? -1 : 1;
    y0 = yin - inward*(clamp_catch + 0.6);  y1 = yin + inward*0.6;
    translate([x - clamp_w/2 - 0.6, min(y0,y1), split_z - eps])
        cube([clamp_w + 1.2, abs(y1 - y0), clamp_over + 0.8]);
}

// =============================================================================
//  BASE
// =============================================================================
module base() {
    difference() {
        union() {
            difference() {
                base_outer();
                rrect(px0, py0, px1, py1, standoff_h, split_z + eps);                  // board pocket
                rrect(px0 + ledge_w, py0 + ledge_w, px1 - ledge_w, py1 - ledge_w,      // under-board recess
                      -eps, standoff_h + eps);
                band3(0, lap_t, lap_z, split_z + eps);                                 // recess the rim (3 sides)
                band3(lap_t - eps, snap_d + eps, snap_z - snap_h/2, snap_z + snap_h/2); // snap GROOVE in the rim
                // USB-C drop-in clearance: lower the back-wall top where it overhangs
                translate([usbc_center_u - (usbc_open_w/2 + 1.5), iy1 - eps, split_z - usbc_drop])
                    cube([usbc_open_w + 3, (oy1 - iy1) + edge_r + 2*eps, usbc_drop + 2*eps]);
                // ESP32 drop-in clearance: recess the left block under the module
                translate([ox0 - eps, 8, split_z - esp_drop])
                    cube([(px0 - ox0) + eps, board_h - 16, esp_drop + 2*eps]);
            }
            if (board_snaps) for (c = clamp_pos) clamp(c[0], c[1]);
        }
        if (board_snaps) for (c = clamp_pos) clamp_cuts(c[0], c[1]);
        if (pry) for (px = [22, 0]) translate([usbc_center_u + (px==0?-18:18), oy0-eps, lap_z-eps])
                     cube([4, lap_t + 1, 1.4]);   // front pry notches
    }
}

// =============================================================================
//  COVER
// =============================================================================
//  Inner perimeter ledge that presses the board top edge down.  It must be OPEN
//  wherever a connector or module sits ON the board edge, or it crushes/intersects
//  the connector body (e.g. the USB-C, which is right on the edge).
module hold_down_lip() {
    zlo = split_z - lip_press - eps;  zh = lip_h + 2*eps;
    difference() {
        rrect(ix0, iy0, ix1, iy1, split_z - lip_press, split_z + lip_h);
        rrect(ix0 + lip_w, iy0 + lip_w, ix1 - lip_w, iy1 - lip_w, zlo, split_z + lip_h + eps);
        // left: ESP32 module overhang
        translate([ix0 - eps, 8, zlo]) cube([0 - ix0 + lip_w + eps, board_h - 16, zh]);
        // right edge: XLR + RJ45 sit on it
        translate([ix1 - lip_w - eps, iy0 - eps, zlo]) cube([lip_w + 2*eps, (iy1 - iy0) + 2*eps, zh]);
        // back edge (design frame): USB-C sits on it
        translate([usbc_center_u - usbc_open_w/2 - 1.5, iy1 - lip_w - eps, zlo])
            cube([usbc_open_w + 3, lip_w + 2*eps, zh]);
    }
}
module cover() {
    difference() {
        union() {
            difference() {
                cover_outer();
                rrect(ix0, iy0, ix1, iy1, split_z - eps, ceil_z);
            }
            // overlapping skirt (flush outer) on 3 sides + snap rib
            difference() {
                band3(0, lap_t, lap_z, split_z);                  // skirt outer skin
                rrect(px0, py0, px1, py1, lap_z - eps, split_z + eps);  // keep clear of the board pocket
            }
            band3(lap_t - eps, snap_d, snap_z - snap_h/2, snap_z + snap_h/2);   // snap RIB
            hold_down_lip();
            if (led_caps) led_caps();
        }
        xlr_cut();
        rj45_cut();
        usbc_cut();
        led_windows();
        if (board_snaps) for (c = clamp_pos) clamp_clearance(c[0], c[1]);
    }
}

// =============================================================================
//  Board mock (preview only)
// =============================================================================
module board_mock() {
    color("green")  translate([0,0,standoff_h]) cube([board_w, board_h, board_th]);
    color("#303030") translate([-esp_overhang_left, 10.2, split_z]) cube([25.5, 18.0, 3.1]);
    color("black")  translate([ix1 - 5, xlr_axis_v, split_z + xlr_axis_z]) rotate([0,90,0]) cylinder(h=9, d=18);
    color("silver") translate([ix1 - 16, rj45_center_v - rj45_open_w/2 + 0.4, split_z + rj45_z0]) cube([18, rj45_open_w-0.8, rj45_h-rj45_z0]);
    color("silver") translate([usbc_center_u - usbc_open_w/2 + 0.5, iy1 - 7, split_z]) cube([usbc_open_w-1, 7, 3.2]);
    for (u = led_u) color("red") translate([u, led_v, split_z]) cylinder(h=0.8, d=1.6);
}

// =============================================================================
//  Output
// -----------------------------------------------------------------------------
//  HANDEDNESS FIX: extract_case_params.py maps KiCad's Y-DOWN axis onto OpenSCAD's
//  Y-UP, which flips the layout's handedness - i.e. the geometry built above is a
//  MIRROR of the real board.  vflip() applies one compensating reflection about the
//  board's v centre line, so the exported parts match the real board (the populated
//  GLB) and actually fit it.  Everything (openings, clamps, snaps, screw diagonal)
//  reflects together, so all clearances are preserved.  Renders use FLIP_Y=False.
// =============================================================================
module vflip() { translate([0, oy0 + oy1, 0]) mirror([0,1,0]) children(); }

if      (part == "base")  vflip() color("gainsboro")      base();
else if (part == "cover") vflip() color("lightsteelblue") cover();
else if (part == "board") vflip() board_mock();
else if (part == "assembly") vflip() { color("gainsboro") base(); board_mock(); color([0.72,0.80,0.90,0.32]) cover(); }
else if (part == "exploded") vflip() {
    color("gainsboro") base();
    translate([0,0,7]) board_mock();
    translate([0,0,40]) color([0.72,0.80,0.90,0.5]) cover();
}
