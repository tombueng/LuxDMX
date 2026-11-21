#!/usr/bin/env python3
"""Give the five custom footprints a 3D model, so the board renders as something you can
look at instead of a bare PCB with holes.

KiCad ships STEP models for everything standard here (1206, DIP-20, headers, terminals,
electrolytic, barrel jack). The module sockets and the dual-pitch polyfuse are ours, so they
have none. These are honest boxes: outer dimensions from the footprint's own pads, heights
from the measurements in modules.json or from the part datasheet. Not pretty, but correct in
the dimension that matters, which is whether the lid of the enclosure closes.

VRML because it is text and can be generated. KiCad's convention is **1 VRML unit = 2.54 mm**
with a model scale of 1,1,1, so everything is divided by 2.54 on the way out. The part centre
is baked into the file, so the footprint's 3D offset stays at zero.

Run:  python hardware-carrier/gen_3d_models.py [--dry-run]
"""
import os
import sys

import pcbnew

def _project_dir():
    """The project directory, whether this script sits in it or in tools/ beside it.

    The tooling is deliberately kept out of the git repo (see .gitignore), so it lives one
    level down in tools/. Everything it reads and writes still belongs next to the board."""
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")) or \
           os.path.exists(os.path.join(d, "modules.json")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


HERE = _project_dir()
BOARD = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")
OUTDIR = os.path.join(HERE, "3dmodels")
U = 2.54          # KiCad VRML unit

# Where the real body is bigger than the pad field, say so. The pad envelope is a lower
# bound, not the part: the ESP32 board overhangs its own pin rows, the polyfuse is a 24 mm
# disc on two 10 mm-apart legs, and the buck land is deliberately oversized for three module
# sizes. Numbers from modules.json (MEASURED) and from the Bourns datasheet.
#  footprint id -> (width x, length y) in mm, None = take the pad envelope
XY = {
    "desk_binghe-esp32-s3-devkitc1-n16r8-usbc": (27.9, 57.5),
    "usr-es1-w5500": (25.0, 15.0),
    "polyfuse-dual-pitch": (24.2, 3.0),
    "buck-module-universal": (12.7, 17.8),     # the D24V10F5 drawn by d24v10_parts()
}

#  footprint id -> (height mm, standoff mm, rgb, what it is)
MODELS = {
    "desk_binghe-esp32-s3-devkitc1-n16r8-usbc":
        (5.0, 2.5, (0.05, 0.30, 0.12), "ESP32-S3 Modul auf Stiftleisten"),
    "desk_rakstore-max3485":
        (4.0, 2.5, (0.10, 0.20, 0.45), "MAX3485 Modul auf Stiftleisten"),
    "usr-es1-w5500":
        (14.0, 2.5, (0.15, 0.15, 0.18), "W5500 mit RJ45, der Buchsenkoerper dominiert"),
    "buck-module-universal":
        (6.3, 0.0, (0.10, 0.42, 0.16), "Pololu D24V10F5 auf Stiftleiste in Reihe A (die Empfehlung)"),
    "polyfuse-dual-pitch":
        (25.0, 1.0, (0.60, 0.45, 0.10), "MF-R500/900, stehende Scheibe, ca. 25 mm hoch"),
}


def envelope(fp):
    """XY extent of the pads, relative to the footprint origin, un-rotated."""
    rot = fp.GetOrientationDegrees()
    fp.SetOrientationDegrees(0)
    o = fp.GetPosition()
    xs, ys = [], []
    for p in fp.Pads():
        q, s = p.GetPosition(), p.GetSize()
        x, y = pcbnew.ToMM(q.x - o.x), pcbnew.ToMM(q.y - o.y)
        w, h = pcbnew.ToMM(s.x) / 2, pcbnew.ToMM(s.y) / 2
        xs += [x - w, x + w]
        ys += [y - h, y + h]
    fp.SetOrientationDegrees(rot)
    return min(xs), min(ys), max(xs), max(ys)


def wrl(path, w, l, h, cx, cy, z0, rgb, note):
    """A box, centred at (cx, cy), sitting z0 above the board."""
    r, g, b = rgb
    body = f"""#VRML V2.0 utf8
# {note}
# {w:.2f} x {l:.2f} x {h:.2f} mm. Erzeugt von gen_3d_models.py, nicht von Hand pflegen.
Transform {{
  translation {cx/U:.6f} {-cy/U:.6f} {(z0 + h/2)/U:.6f}
  children [
    Shape {{
      appearance Appearance {{
        material Material {{
          diffuseColor {r:.3f} {g:.3f} {b:.3f}
          specularColor 0.10 0.10 0.10
          ambientIntensity 0.30
          shininess 0.15
        }}
      }}
      geometry Box {{ size {w/U:.6f} {l/U:.6f} {h/U:.6f} }}
    }}
  ]
}}
"""
    open(path, "w", encoding="utf-8").write(body)


def d24v10_parts():
    """The regulator spot's model: the recommended part, a Pololu D24V10F5, on a 0.1 in header
    in row A, label side to the board. Boxes in footprint coordinates (mm, y down, origin at the
    footprint centre). Pin positions and the body come from modules.json; the parts on top
    (inductor, regulator IC, caps) are placed after Pololu's top-view drawing (d24v10fx
    dimension PDF): inductor about 6 x 6 mm next to the VOUT end, 2.8 mm tall per the profile.
    Pin row, header plastic and the module board are what matter for fit; the rest is so it
    reads as that part in a render."""
    import json
    with open(os.path.join(HERE, "modules.json")) as f:
        m = json.load(f)["modules"]["buck-module-universal"]
    ox, oy = m["pcb"]["width"] / 2.0, m["pcb"]["length"] / 2.0
    body = next(b for b in m["bodies"] if b["name"] == "D24V10F5")
    x0, y0, x1, y1 = body["x0"] - ox, body["y0"] - oy, body["x1"] - ox, body["y1"] - oy
    pins = [(t["x"] - ox, t["y"] - oy) for t in m["tht_pads"] if t.get("row") == "A"]
    row_y = pins[0][1]
    HDR, PCB, TOP = 2.5, 1.0, 2.8          # header plastic, module board, tallest part
    green, black, grey, gold = (0.10, 0.42, 0.16), (0.04, 0.04, 0.04), (0.20, 0.20, 0.22), (0.80, 0.65, 0.20)
    parts = [
        # header plastic, one 2.54 mm cell per pin
        (x1 - x0 - 0.2, 2.5, HDR, (x0 + x1) / 2, row_y, 0.0, black),
        # module board, label side down on the plastic
        (x1 - x0, y1 - y0, PCB, (x0 + x1) / 2, (y0 + y1) / 2, HDR, green),
    ]
    for px, py in pins:   # 0.64 mm square pins, from under the carrier to just above the module
        parts.append((0.64, 0.64, 1.6 + 3.0 + HDR + PCB + 0.6, px, py, -1.6 - 3.0, gold))
    # top-view drawing, origin bottom-left of the module = (x0, y1) here, "up" = -y
    def on_top(ax, ay, bx, by, h, rgb):
        parts.append((bx - ax, by - ay, h, x0 + (ax + bx) / 2, y1 - (ay + by) / 2, HDR + PCB, rgb))
    on_top(5.7, 2.9, 11.7, 8.9, TOP, grey)       # inductor
    on_top(1.1, 9.7, 5.3, 13.5, 1.0, black)      # regulator IC
    on_top(6.6, 10.4, 8.2, 13.6, 1.2, (0.55, 0.45, 0.30))   # input / output caps
    on_top(8.8, 10.4, 10.4, 13.6, 1.2, (0.55, 0.45, 0.30))
    on_top(1.3, 4.0, 3.5, 5.3, 0.9, (0.55, 0.45, 0.30))
    return parts


def wrl_parts(path, parts, note):
    """Several boxes in one file: (w, l, h, cx, cy, z0, rgb) each, mm."""
    out = ["#VRML V2.0 utf8", f"# {note}",
           "# Erzeugt von gen_3d_models.py, nicht von Hand pflegen."]
    for w, l, h, cx, cy, z0, (r, g, b) in parts:
        out.append(f"""Transform {{
  translation {cx/U:.6f} {-cy/U:.6f} {(z0 + h/2)/U:.6f}
  children [
    Shape {{
      appearance Appearance {{
        material Material {{
          diffuseColor {r:.3f} {g:.3f} {b:.3f}
          specularColor 0.10 0.10 0.10
          ambientIntensity 0.30
          shininess 0.15
        }}
      }}
      geometry Box {{ size {w/U:.6f} {l/U:.6f} {h/U:.6f} }}
    }}
  ]
}}""")
    open(path, "w", encoding="utf-8").write("\n".join(out) + "\n")


def main():
    dry = "--dry-run" in sys.argv
    os.makedirs(OUTDIR, exist_ok=True)
    board = pcbnew.LoadBoard(BOARD)

    done = set()
    for f in board.GetFootprints():
        fid = f.GetFPIDAsString().split(":")[-1]
        if fid not in MODELS:
            continue
        h, z0, rgb, note = MODELS[fid]
        x0, y0, x1, y1 = envelope(f)
        w, l = x1 - x0, y1 - y0
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if fid in XY:
            w, l = XY[fid]
        if fid == "polyfuse-dual-pitch":
            cx, cy = 5.1, 0.6      # centred on the 10.2 mm hole pair, which is the 9 A part
        path = os.path.join(OUTDIR, fid + ".wrl")
        if fid not in done:
            if not dry and fid == "buck-module-universal":
                wrl_parts(path, d24v10_parts(), note)
            elif not dry:
                wrl(path, w, l, h, cx, cy, z0, rgb, note)
            print(f"{fid[:40]:42s} {w:5.1f} x {l:5.1f} x {h:5.1f} mm  "
                  f"Mitte ({cx:+5.1f},{cy:+5.1f})  {note}")
            done.add(fid)

        if not dry and not f.Models():
            m = pcbnew.FP_3DMODEL()
            m.m_Filename = "${KIPRJMOD}/3dmodels/" + fid + ".wrl"
            m.m_Show = True
            f.Models().push_back(m)

    if not dry:
        pcbnew.SaveBoard(BOARD, board)
        print(f"\n{len(done)} Modelle in 3dmodels/, an die Footprints gehaengt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
