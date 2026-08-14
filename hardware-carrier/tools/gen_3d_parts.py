#!/usr/bin/env python3
"""Build the VRML models for the parts no library here has.

  Button      6 x 6 mm tact switch with a 30 mm plunger, long enough to reach a front panel
              past the encoder's 20 mm shaft. Button_Switch_THT.3dshapes is not installed
              here either.

  Encoder     Alps EC11E with switch. KiCad has the footprint but this installation has no
              Rotary_Encoder.3dshapes at all, so there is no model to point at.

  Polyfuse    Bourns MF-R500, the part the BOM specifies: a 17.4 mm disc, 3.0 mm thick, on
              two leads 10.2 mm apart. The land is ours (three holes, two pitches) and no
              library part matches it. Not the MF-R900, whose 24.2 mm body clears the 1000uF
              can by 0.40 mm at this placement and therefore does not fit.

KiCad's VRML convention: 1 unit = 2.54 mm, and the model Y axis is the footprint Y axis
negated. Both are handled by emit().

Run:  python tools/gen_3d_parts.py
"""
import os
import sys

U = 2.54


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


HERE = _project_dir()
OUT = os.path.join(HERE, "3dmodels")

COL = {
    "pcb_blue":  (0.06, 0.28, 0.55),
    "black":     (0.10, 0.10, 0.11),
    "tan":       (0.62, 0.55, 0.40),
    "beige":     (0.78, 0.70, 0.52),
    "gold":      (0.83, 0.68, 0.22),
    "led":       (0.85, 0.90, 0.75),
    "epoxy":     (0.55, 0.42, 0.12),
    "tin":       (0.75, 0.76, 0.78),
    "steel":     (0.60, 0.61, 0.64),
}


def mat(c):
    r, g, b = COL[c]
    return (f"appearance Appearance {{ material Material {{ diffuseColor {r:.3f} {g:.3f} {b:.3f} "
            f"specularColor 0.08 0.08 0.08 ambientIntensity 0.30 shininess 0.20 }} }}")


def box(x, y, z, w, l, h, c):
    """Box centred at footprint (x, y), sitting z..z+h above the board."""
    return (f"  Transform {{ translation {x/U:.5f} {-y/U:.5f} {(z+h/2)/U:.5f}\n"
            f"    children Shape {{ {mat(c)}\n"
            f"      geometry Box {{ size {w/U:.5f} {l/U:.5f} {h/U:.5f} }} }} }}")


def prism(x, y, z, r, t, c, n=32):
    """A disc of radius r and thickness t, standing upright, face in the X-Z plane.

    Written as an IndexedFaceSet rather than a VRML Cylinder: KiCad's VRML reader renders
    the Box primitives next to it but silently drops Cylinder, so the part just is not
    there. A 32-gon is round enough at this size and always draws."""
    import math
    pts, faces = [], []
    for i in range(n):
        a = 2 * math.pi * i / n
        cx, cz = r * math.cos(a), r * math.sin(a)
        pts.append((cx, -t / 2, cz))
        pts.append((cx, +t / 2, cz))
    for i in range(n):
        a0, a1 = 2 * i, 2 * ((i + 1) % n)
        faces.append((a0, a0 + 1, a1 + 1, a1))              # rim
    faces.append(tuple(2 * i for i in range(n)))             # one face
    faces.append(tuple(2 * i + 1 for i in range(n - 1, -1, -1)))
    P = " ".join(f"{a/U:.5f} {b/U:.5f} {c2/U:.5f}," for a, b, c2 in pts)
    F = " ".join(" ".join(str(v) for v in f) + " -1," for f in faces)
    return (f"  Transform {{ translation {x/U:.5f} {-y/U:.5f} {z/U:.5f}\n"
            f"    children Shape {{ {mat(c)}\n"
            f"      geometry IndexedFaceSet {{ solid FALSE\n"
            f"        coord Coordinate {{ point [ {P} ] }}\n"
            f"        coordIndex [ {F} ] }} }} }}")


def polyfuse():
    """Bourns MF-R500: a 17.4 mm epoxy disc, 3.0 mm thick, standing on 10.2 mm leads.

    The leads are 1.2 mm of tin between the board and the disc, and the disc is centred
    between them, so its top sits 18.6 mm above the board. The land is ours, three holes on
    two lead pitches, and no library part matches it.
    """
    return [
        box(0.0, 0.60, 0.0, 0.8, 0.8, 1.2, "tin"),
        box(10.20, 0.60, 0.0, 0.8, 0.8, 1.2, "tin"),
        prism(5.10, 0.60, 1.2 + 17.4 / 2, 17.4 / 2, 3.0, "epoxy"),
    ]


def cyl(x, y, z, r, h, c, n=32, flat=None):
    """An upright cylinder from z to z+h, centred on footprint (x, y).

    Same reason as prism(): written out as an IndexedFaceSet because KiCad's VRML reader
    drops the Cylinder primitive without a word. `flat` cuts a D on the +x side at that
    distance from the axis, which is what an encoder shaft has and what a knob keys onto.
    """
    import math
    pts, faces = [], []
    for i in range(n):
        a = 2 * math.pi * i / n
        cx, cy = r * math.cos(a), r * math.sin(a)
        if flat is not None and cx > flat:
            cx = flat
        pts.append((cx, cy, 0.0))
        pts.append((cx, cy, h))
    for i in range(n):
        a0, a1 = 2 * i, 2 * ((i + 1) % n)
        faces.append((a0, a1, a1 + 1, a0 + 1))                # side
    faces.append(tuple(2 * i + 1 for i in range(n)))           # top
    faces.append(tuple(2 * i for i in range(n - 1, -1, -1)))   # bottom
    P = " ".join(f"{a/U:.5f} {b/U:.5f} {c2/U:.5f}," for a, b, c2 in pts)
    F = " ".join(" ".join(str(v) for v in f) + " -1," for f in faces)
    return (f"  Transform {{ translation {x/U:.5f} {-y/U:.5f} {z/U:.5f}\n"
            f"    children Shape {{ {mat(c)}\n"
            f"      geometry IndexedFaceSet {{ solid FALSE\n"
            f"        coord Coordinate {{ point [ {P} ] }}\n"
            f"        coordIndex [ {F} ] }} }} }}")


def encoder():
    """Alps EC11E with switch, 20 mm shaft: the part under every KY-040 module.

    Dimensions off the KiCad footprint's own fab outline, 12.0 x 11.6 mm centred at
    (7.50, 2.50) from pad A, plus the datasheet stack: 6.4 mm case, a 5 mm M7 bushing and a
    6 mm D-shaft up to 20 mm above the board, which is what the H20mm in the footprint name
    means. The five terminals get short tabs so the model reads right from the side.
    """
    cx, cy = 7.50, 2.50
    p = [
        box(cx, cy, 0.0, 12.0, 11.6, 6.4, "steel"),          # the crimped metal can
        box(cx, cy, 6.4, 9.6, 9.6, 0.6, "steel"),            # its rolled top face
        cyl(cx, cy, 7.0, 3.5, 4.4, "steel"),                 # M7 threaded bushing
        cyl(cx, cy, 11.4, 3.0, 8.6, "tin", flat=2.25),       # D-shaft, flat for the knob
    ]
    for px, py in ((0.0, 0.0), (0.0, 2.5), (0.0, 5.0), (14.5, 0.0), (14.5, 5.0)):
        # tab out of the can to its pad, then down through the board
        p.append(box((px + cx) / 2, py, 0.4, abs(cx - px) - 5.0, 0.7, 0.3, "tin"))
        p.append(box(px, py, -1.6, 0.7, 0.7, 2.0, "tin"))
    return p


def button(height=30.0):
    """6 x 6 mm tact switch with a long plunger, the kind that reaches through a front panel.

    The carrier's encoder stands 20 mm off the board, so a standard 4.3 mm tact switch would
    disappear under the same panel the knob comes through. These come in a whole range of
    plunger lengths off one footprint - 5, 7, 9, 13, 17, 25, 30 mm - so the land is the usual
    SW_PUSH_6mm and only the part number changes.

    KiCad's own Button_Switch_THT.3dshapes is not installed here either, so there is nothing
    to point at even for the short one.

    Geometry off the footprint: pads at (0,0), (6.5,0), (0,4.5), (6.5,4.5), so the body is
    centred at (3.25, 2.25). Body 6.0 x 6.0 x 3.5 mm, plunger 3.5 mm across up to `height`.
    """
    cx, cy = 3.25, 2.25
    p = [
        box(cx, cy, 0.0, 6.0, 6.0, 3.2, "black"),          # moulded base
        box(cx, cy, 3.2, 4.4, 4.4, 0.3, "tin"),            # the metal dome cover
        cyl(cx, cy, 3.5, 1.75, height - 3.5, "beige"),     # plunger
    ]
    for px, py in ((0.0, 0.0), (6.5, 0.0), (0.0, 4.5), (6.5, 4.5)):
        p.append(box((px + cx) / 2, py, 0.6, abs(cx - px) - 2.6, 0.6, 0.3, "tin"))
        p.append(box(px, py, -1.6, 0.6, 0.6, 2.0, "tin"))
    return p


def emit(path, title, parts):
    body = "\n".join(parts)
    open(path, "w", encoding="utf-8").write(
        f"#VRML V2.0 utf8\n# {title}\n"
        f"# Erzeugt von tools/gen_3d_parts.py. 1 Einheit = 2.54 mm, Y gegenueber dem "
        f"Footprint gespiegelt.\n{body}\n")
    print(f"  {os.path.basename(path):34s} {len(parts):3d} Koerper")


def main():
    os.makedirs(OUT, exist_ok=True)
    print("VRML-Modelle:")
    emit(os.path.join(OUT, "polyfuse-dual-pitch.wrl"),
         "Bourns MF-R500, Scheibe 17.4 mm x 3.0 mm auf 10.2 mm Raster", polyfuse())
    emit(os.path.join(OUT, "encoder-ec11-switch.wrl"),
         "Alps EC11E mit Taster, 12 mm Korpus, 20 mm D-Welle", encoder())
    emit(os.path.join(OUT, "button-6mm-h30.wrl"),
         "Taster 6 x 6 mm mit 30 mm Stoessel", button(30.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
