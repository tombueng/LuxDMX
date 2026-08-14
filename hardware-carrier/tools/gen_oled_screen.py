#!/usr/bin/env python3
"""Put a real firmware screen on the OLED in the renders, under a glossy glass layer.

The downloaded OLED model is a grey slab where the panel is. This adds three thin layers on
top of it, as a second 3D model on the same footprint:

    5.005 - 5.020   black panel, so the grey does not show through anywhere
    5.020 - 5.040   the lit pixels, one quad per run, emissive so they glow
    5.040 - 5.450   glass, mostly transparent with a hard specular highlight

The pixels come from docs/make_display_preview.py, the same generator the display docs use, at
its native 128 x 64. So the render shows what the firmware actually draws, not a mock-up. The
default is the yellow/blue split panel: rows 0-15 yellow, the rest blue, which is the physical
emitter layout of the dual-colour parts.

Geometry is in the display header's own frame, measured off an orthographic render of the
model: the glass sits at x -26.78..-4.13, y -13.17..20.91 and its top face is 5.00 mm above the
carrier. The active area is 14.70 x 29.42 inside it, pushed away from the chip-on-glass edge.

Run:  python tools/gen_oled_screen.py [status|conflict|identify|manual] [split|blue|white]
"""
import importlib.util
import os
import sys

U = 2.54                       # KiCad VRML unit

GLASS_X = (-26.78, -4.13)      # the grey slab of the downloaded model
GLASS_Y = (-13.17, 20.91)
ACTIVE_W = 14.70               # 1.3" 128x64: 29.42 x 14.70 mm of lit area
ACTIVE_H = 29.42
EDGE_GAP = 1.80                # glass border on the side away from the driver
Z_PANEL, Z_PIX, Z_GLASS, Z_TOP = 5.005, 5.020, 5.040, 5.450


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


HERE = _project_dir()
OUT = os.path.join(HERE, "3dmodels", "oled-screen-1v3.wrl")
PREVIEW = os.path.abspath(os.path.join(HERE, "..", "docs", "make_display_preview.py"))


def screen(which, mode):
    """The firmware's own 128 x 64 frame, in its native resolution."""
    spec = importlib.util.spec_from_file_location("display_preview", PREVIEW)
    m = importlib.util.module_from_spec(spec)
    sys.modules["display_preview"] = m
    spec.loader.exec_module(m)
    render = {"status": m.draw_status,
              "conflict": lambda p: m.draw_banner(p, "CONFLICT", "2+ sources", m.RED),
              "identify": lambda p: m.draw_banner(p, "IDENTIFY", "ch 12", m.AMBER),
              "manual": lambda p: m.draw_banner(p, "MANUAL", "override", m.BLUE)}[which]
    return m.mono_panel(128, 64, render, mode)


def runs(img):
    """One quad per horizontal run of one colour, black skipped.

    A pixel each would be 8192 quads for a picture that is 90 percent background. Runs bring
    the status screen down to a few hundred and the file stays small enough to load."""
    out = []
    px = img.load()
    for y in range(img.height):
        x = 0
        while x < img.width:
            c = px[x, y]
            if c == (0, 0, 0):
                x += 1
                continue
            x0 = x
            while x + 1 < img.width and px[x + 1, y] == c:
                x += 1
            out.append((y, x0, x + 1, c))       # row, first col, one past last, colour
            x += 1
    return out


def mat(diff, emis=(0, 0, 0), spec=(0.08, 0.08, 0.08), shine=0.2, transp=0.0, amb=0.3):
    return ("material Material { "
            f"diffuseColor {diff[0]:.3f} {diff[1]:.3f} {diff[2]:.3f} "
            f"emissiveColor {emis[0]:.3f} {emis[1]:.3f} {emis[2]:.3f} "
            f"specularColor {spec[0]:.3f} {spec[1]:.3f} {spec[2]:.3f} "
            f"ambientIntensity {amb:.2f} shininess {shine:.2f} transparency {transp:.2f} }}")


def slab(x0, x1, y0, y1, z0, z1, material):
    return (f"  Transform {{ translation {(x0+x1)/2/U:.5f} {-(y0+y1)/2/U:.5f} "
            f"{(z0+z1)/2/U:.5f}\n"
            f"    children Shape {{ appearance Appearance {{ {material} }}\n"
            f"      geometry Box {{ size {(x1-x0)/U:.5f} {(y1-y0)/U:.5f} {(z1-z0)/U:.5f} }} }} }}")


def pixels(rects, material):
    """One thin box per run.

    Flat faces would be a tenth of the file, but a single-sided IndexedFaceSet does not come
    back out of KiCad's VRML reader whatever `solid` says, the same trap as Cylinder in
    tools/gen_3d_parts.py. Boxes always draw."""
    return [slab(x0, x1, y0, y1, Z_PIX, Z_GLASS, material) for x0, x1, y0, y1 in rects]


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "status"
    mode = sys.argv[2] if len(sys.argv) > 2 else "split"
    img = screen(which, mode)

    # active area: centred across the module, pushed to the edge away from the driver
    ax1 = GLASS_X[1] - EDGE_GAP
    ax0 = ax1 - ACTIVE_W
    cy = (GLASS_Y[0] + GLASS_Y[1]) / 2
    ay0, ay1 = cy - ACTIVE_H / 2, cy + ACTIVE_H / 2
    dx, dy = ACTIVE_W / img.height, ACTIVE_H / img.width

    by_colour = {}
    for row, c0, c1, col in runs(img):
        # image row runs along x, image column along y, column 0 at the +y end
        by_colour.setdefault(col, []).append(
            (ax0 + row * dx, ax0 + (row + 1) * dx, ay1 - c1 * dy, ay1 - c0 * dy))

    parts = [slab(GLASS_X[0], GLASS_X[1], GLASS_Y[0], GLASS_Y[1], Z_PANEL, Z_PIX,
                  mat((0.020, 0.020, 0.024), amb=0.10))]
    for col, rects in sorted(by_colour.items(), key=lambda kv: -len(kv[1])):
        c = tuple(v / 255.0 for v in col)
        parts += pixels(rects, mat(tuple(v * 0.25 for v in c), emis=c,
                                   spec=(0.2, 0.2, 0.2), shine=0.4, amb=0.0))
    parts.append(slab(GLASS_X[0], GLASS_X[1], GLASS_Y[0], GLASS_Y[1], Z_GLASS, Z_TOP,
                      mat((0.015, 0.015, 0.020), spec=(1.0, 1.0, 1.0), shine=0.55,
                          transp=0.70, amb=0.05)))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w", encoding="utf-8").write(
        "#VRML V2.0 utf8\n"
        f"# {which} auf einem 1.3\" 128x64 ({mode}), erzeugt von tools/gen_oled_screen.py\n"
        "# 1 Einheit = 2.54 mm, Y gegenueber dem Footprint gespiegelt.\n"
        + "\n".join(parts) + "\n")

    n = sum(len(v) for v in by_colour.values())
    print(f"{which}/{mode}: {n} Rechtecke in {len(by_colour)} Farben, "
          f"aktive Flaeche {ACTIVE_W:.2f} x {ACTIVE_H:.2f} mm "
          f"bei x {ax0:.2f}..{ax1:.2f}, y {ay0:.2f}..{ay1:.2f}")
    print(f"-> 3dmodels/{os.path.basename(OUT)}  {os.path.getsize(OUT)//1024} kB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
