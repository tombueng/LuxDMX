#!/usr/bin/env python3
"""Printed markings and the parts KiCad has no model for, for the regulator spot's modules.

Stock KiCad models are blank: no "MP1584EN" on the IC, no "SS34" on the diode. This writes them
as thin coloured solids in separate STEP files that share the origin of the model they belong
to, so KiCad (and anything else) loads them on top. gen_regulator_modules.py hangs them on the
carrier footprint next to their models. Needs build123d, which KiCad's Python doesn't have:

Run:  <python with build123d> tools/gen_regulator_marks.py
      e.g. ~/feuerwerk/tools/cadenv/bin/python tools/gen_regulator_marks.py

What it makes, all in 3dmodels/:

  mp1584en-module-marks.step   overlay for mp1584en-module.step (origin module centre, z = board
                               underside). From ProtoSupplies' photos: "MP1584EN / J3828829 /
                               MPSJ18" on the SOIC, "SS34" on the diode, "010" and "822" on the
                               0603 resistors, a silver-grey skin with "4R7" on the inductor (the
                               stock model is black and the real one isn't), and the 3 x 3 mm
                               open-frame trimmer with its metal rotor, which KiCad has no model of.
  recom-r78e-marks.step        overlay for KiCad's Converter_DCDC_RECOM_R-78E-0.5_THT.step (same
                               SIP-3 package as the R-78E5.0-1.0, origin pin 1). Embossed RECOM
                               logo on the top (datasheet: "embossed logo"), part number printed
                               on the face.
  mornsun-k7805-1000r3.step    the whole part, no stock model exists. Mornsun K78xx-1000R3
                               datasheet: 11.50 x 9.00 x 17.50 mm, pins 0.50 wide on 2.54 mm,
                               4.10 mm below the body, 2.15 mm from one face, pin 1 = +Vin. Origin
                               pin 1, body towards -y in KiCad terms like the RECOM model.

Coordinates below are KiCad's (y down), converted to STEP's y-up on the way in.
"""
import os
import sys

from build123d import (Align, Axis, Box, Color, Compound, Cylinder, Location, Text,
                       export_step, extrude, fillet, import_step)

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "3dmodels")
KICAD3D = os.environ.get("KICAD10_3DMODEL_DIR", "/usr/share/kicad/3dmodels")

WHITE = Color(0.95, 0.95, 0.93)
LASER = Color(0.72, 0.72, 0.70)       # laser marking on black epoxy
DARKPRINT = Color(0.22, 0.22, 0.22)
INDUCTOR = Color(0.60, 0.60, 0.58)    # the moulded silver-grey body in the photos
FRAME = Color(0.93, 0.91, 0.85)
METAL = Color(0.80, 0.80, 0.82)
BLACK = Color(0.06, 0.06, 0.06)
TIN = Color(0.82, 0.82, 0.80)
FONT = "DejaVu Sans"


def solids_of(step):
    shape = import_step(step)
    return [(s, s.bounding_box()) for s in shape.solids()]


def top_at(solids, x, y, max_area=90.0):
    """Tallest small solid whose footprint contains KiCad point (x, y)."""
    ys = -y
    best = None
    for s, bb in solids:
        if (bb.max.X - bb.min.X) * (bb.max.Y - bb.min.Y) > max_area:
            continue
        if bb.min.X <= x <= bb.max.X and bb.min.Y <= ys <= bb.max.Y:
            if best is None or bb.max.Z > best.max.Z:
                best = bb
    if best is None:
        raise SystemExit(f"nothing at ({x}, {y})")
    return best


def flat_text(txt, size, x, y, z, rot=0, colour=WHITE, depth=0.02, bold=False):
    """Text lying on a top face at KiCad (x, y), height z, readable from above."""
    t = extrude(Text(txt, font_size=size, font=FONT + (" Bold" if bold else ""),
                     align=(Align.CENTER, Align.CENTER)), amount=depth)
    t = t.rotate(Axis.Z, rot).moved(Location((x, -y, z)))
    t.color = colour
    return t


def face_text(txt, size, x, z, y_face, outward, colour=WHITE, depth=0.02):
    """Text on a vertical face at STEP y = y_face, readable from outside (outward = +1 or -1)."""
    t = extrude(Text(txt, font_size=size, font=FONT, align=(Align.CENTER, Align.CENTER)),
                amount=depth)
    t = t.rotate(Axis.X, 90)                   # normal -y, reading +x, up +z
    if outward > 0:
        t = t.rotate(Axis.Z, 180)              # normal +y, reading -x
    t = t.moved(Location((x, y_face + outward * 0.0, z)))
    t.color = colour
    return t


def mp1584_marks():
    mod = os.path.join(OUT, "mp1584en-module.step")
    sol = solids_of(mod)
    board = max((bb for _, bb in sol), key=lambda bb: (bb.max.X - bb.min.X) * (bb.max.Y - bb.min.Y))
    ztop = board.max.Z
    parts = []
    # IC, SOIC-8 at (3.08, -0.25), long axis along x, pin 1 bottom left
    ic = top_at(sol, 3.08, -0.25)
    for i, line in enumerate(("MP1584EN", "J3828829", "MPSJ18")):
        parts.append(flat_text(line, 0.62, 3.08, -0.95 + 0.72 * i, ic.max.Z, 0, LASER))
    # inductor: silver-grey skin over the black stock body, "4R7" reading bottom to top
    L = top_at(sol, -4.40, 2.50)
    skin = Box(L.max.X - L.min.X + 0.06, L.max.Y - L.min.Y + 0.06, L.max.Z - ztop + 0.02,
               align=(Align.CENTER, Align.CENTER, Align.MIN))
    skin = skin.moved(Location(((L.min.X + L.max.X) / 2, (L.min.Y + L.max.Y) / 2, ztop)))
    skin.color = INDUCTOR
    parts.append(skin)
    parts.append(flat_text("4R7", 2.0, -4.40, 2.50, L.max.Z + 0.02, 90, DARKPRINT))
    # diode
    d = top_at(sol, 3.56, 5.50)
    parts.append(flat_text("SS34", 1.15, 3.56, 5.50, d.max.Z, 0, WHITE))
    # 0603 resistor codes
    for x, y, code, rot in ((1.07, -6.95, "010", 0), (1.07, -5.47, "010", 0),
                            (3.80, -5.47, "010", 0), (5.90, -0.50, "010", 90),
                            (7.00, -3.70, "822", 90)):
        r = top_at(sol, x, y)
        parts.append(flat_text(code, 0.42, x, y, r.max.Z, rot, WHITE, 0.01))
    # trimmer, 3 x 3 mm open frame with a slotted metal rotor
    tx, ty = -4.65, -6.70
    base = Box(3.0, 3.2, 0.9, align=(Align.CENTER, Align.CENTER, Align.MIN))
    base = base.moved(Location((tx, -ty, ztop)))
    base.color = FRAME
    rotor = Cylinder(1.15, 0.45, align=(Align.CENTER, Align.CENTER, Align.MIN))
    rotor = rotor.moved(Location((tx, -ty, ztop + 0.9)))
    rotor.color = METAL
    slot = Box(1.7, 0.32, 0.12, align=(Align.CENTER, Align.CENTER, Align.MIN))
    slot = slot.rotate(Axis.Z, 30).moved(Location((tx, -ty, ztop + 1.35)))
    slot.color = BLACK
    parts += [base, rotor, slot]
    export_step(Compound(children=parts), os.path.join(OUT, "mp1584en-module-marks.step"))
    print("  mp1584en-module-marks.step", len(parts), "pieces")


def r78e_marks():
    src = os.path.join(KICAD3D, "Converter_DCDC.3dshapes", "Converter_DCDC_RECOM_R-78E-0.5_THT.step")
    bb = import_step(src).bounding_box()
    cx = (bb.min.X + bb.max.X) / 2
    parts = []
    # top face: embossed logo, same black as the case, standing proud 0.05 mm
    parts.append(flat_text("RECOM", 2.0, cx, -(bb.min.Y + bb.max.Y) / 2, bb.max.Z, 0,
                           Color(0.16, 0.16, 0.16), 0.05, bold=True))
    # big face away from the pins: part number and a date code
    yf = bb.max.Y
    parts.append(face_text("RECOM", 1.6, cx, bb.max.Z - 2.6, yf, +1, WHITE))
    parts.append(face_text("R-78E5.0-1.0", 1.15, cx, bb.max.Z - 4.6, yf, +1, WHITE))
    parts.append(face_text("2544", 0.9, cx, bb.max.Z - 6.3, yf, +1, WHITE))
    export_step(Compound(children=parts), os.path.join(OUT, "recom-r78e-marks.step"))
    print("  recom-r78e-marks.step", len(parts), "pieces, body", f"{bb.max.X - bb.min.X:.1f} x "
          f"{bb.max.Y - bb.min.Y:.1f} x {bb.max.Z - bb.min.Z:.1f}")


def k7805():
    L, W, H = 11.50, 9.00, 17.50
    seat = 0.50
    x0 = 2.54 - L / 2                      # pin 2 in the middle of the case
    # KiCad y: pins at 0, the case reaches 2.15 mm one way and 6.85 the other (towards -y)
    body = Box(L, W, H, align=(Align.MIN, Align.MIN, Align.MIN))
    body = fillet(body.edges().filter_by(Axis.Z), 0.4)
    body = body.moved(Location((x0, -2.15, seat)))
    body.color = BLACK
    parts = [body]
    for i in range(3):
        p = Box(0.50, 0.25, 4.10 + seat + 0.3, align=(Align.CENTER, Align.CENTER, Align.MIN))
        p = p.moved(Location((2.54 * i, 0, -4.10)))
        p.color = TIN
        parts.append(p)
    yf = 6.85                              # STEP y of the face away from the pins
    cx = x0 + L / 2
    parts.append(face_text("MORNSUN", 1.5, cx, seat + H - 3.0, yf, +1, WHITE))
    parts.append(face_text("K7805-1000R3", 1.1, cx, seat + H - 5.4, yf, +1, WHITE))
    parts.append(face_text("4.75-36V  5V/1A", 0.8, cx, seat + H - 7.2, yf, +1, WHITE))
    parts.append(face_text("2544", 0.8, cx, seat + H - 8.8, yf, +1, WHITE))
    dot = Cylinder(0.45, 0.02, align=(Align.CENTER, Align.CENTER, Align.MIN))
    dot = dot.rotate(Axis.X, -90).moved(Location((0.0, yf, seat + 1.6)))
    dot.color = WHITE
    parts.append(dot)                      # pin 1 mark over pin 1, as in the datasheet's front view
    export_step(Compound(children=parts), os.path.join(OUT, "mornsun-k7805-1000r3.step"))
    print("  mornsun-k7805-1000r3.step", len(parts), "pieces")


def main():
    mp1584_marks()
    r78e_marks()
    k7805()
    return 0


if __name__ == "__main__":
    sys.exit(main())
