#!/usr/bin/env python3
"""Break the buck's landing zones into a grid of small solderable windows.

The step-down module has no fixed footprint - the class runs from 22 x 18 to 30 x 18 mm - so
its four connections are landing zones rather than pads: whatever module is to hand, its pins
come down somewhere on copper and get soldered there. That is why they are 12 x 5 mm.

A 60 mm2 opening is a bad thing to solder to by hand. The tin runs out across the whole area
instead of standing up around the pin, it takes forever to wet, and there is nothing holding
the joint in place while it cools.

So the copper stays one continuous piece, which is what the current and the connectivity want,
and the solder mask goes over it with a grid of windows cut in it. Only the windows take tin.
A pin lands on one of them, or close enough that the tin bridges half a millimetre, and the
joint is the size of a normal pad.

Copper is not touched, so this can be run after routing without invalidating it.

The pads lose their own mask and paste apertures and keep only their copper layer; the windows
are drawn as filled rectangles on the mask layer, where KiCad plots them as openings.

Each step runs in its own process. Removing shapes and adding shapes to one board in one
pcbnew takes it down with SIGSEGV, the same trap as everywhere else in this toolchain.

Run:  python tools/mask_grid.py [--pitch 1.6] [--window 1.1] [--remove]
"""
import math
import os
import re
import subprocess
import sys

TARGET = "buck"         # footprints whose big lands get the treatment
MIN_SIZE = 3.0          # only lands at least this big; ordinary pads are left alone
EDGE = 0.25             # copper left standing round the outermost window


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


BOARD = os.path.join(_project_dir(), "luxdmx-carrier.kicad_pcb")


def lands(b):
    """The big landing zones, with their own rotation, as (pad, side)."""
    import pcbnew
    out = []
    for f in b.GetFootprints():
        if TARGET not in f.GetFPIDAsString().lower():
            continue
        for p in f.Pads():
            if pcbnew.ToMM(p.GetDrillSizeX()) >= 0.05:
                continue
            if max(pcbnew.ToMM(p.GetSizeX()), pcbnew.ToMM(p.GetSizeY())) < MIN_SIZE:
                continue
            out.append(p)
    return out


def windows(p, pitch, win):
    """Window centres in board coordinates, laid out on the pad's own axes."""
    import pcbnew
    w, h = pcbnew.ToMM(p.GetSizeX()), pcbnew.ToMM(p.GetSizeY())
    room_x = w - win - 2 * EDGE
    room_y = h - win - 2 * EDGE
    nx = max(1, int(room_x / pitch) + 1)
    ny = max(1, int(room_y / pitch) + 1)
    q = p.GetPosition()
    cx, cy = pcbnew.ToMM(q.x), pcbnew.ToMM(q.y)
    a = math.radians(p.GetOrientationDegrees())
    out = []
    for i in range(nx):
        for j in range(ny):
            dx = (i - (nx - 1) / 2) * pitch
            dy = (j - (ny - 1) / 2) * pitch
            out.append((cx + dx * math.cos(a) - dy * math.sin(a),
                        cy + dx * math.sin(a) + dy * math.cos(a)))
    return out, nx, ny


def mask_layer(p):
    import pcbnew
    return pcbnew.B_Mask if p.GetLayerSet().Contains(pcbnew.B_Cu) else pcbnew.F_Mask


def stage_clear():
    """Drop any windows a previous run left, so this is repeatable."""
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    boxes = []
    for p in lands(b):
        bb = p.GetBoundingBox()
        boxes.append((mask_layer(p), pcbnew.ToMM(bb.GetLeft()), pcbnew.ToMM(bb.GetRight()),
                      pcbnew.ToMM(bb.GetTop()), pcbnew.ToMM(bb.GetBottom())))
    gone = 0
    for s in list(b.GetDrawings()):
        if not isinstance(s, pcbnew.PCB_SHAPE) or s.GetShape() != pcbnew.SHAPE_T_RECTANGLE:
            continue
        c = s.GetCenter()
        x, y = pcbnew.ToMM(c.x), pcbnew.ToMM(c.y)
        if any(s.GetLayer() == ly and x0 <= x <= x1 and y0 <= y <= y1
               for ly, x0, x1, y0, y1 in boxes):
            b.Remove(s)
            gone += 1
    pcbnew.SaveBoard(BOARD, b)
    print(f"\n@@RESULT {gone}", flush=True)


def stage_pads(open_mask):
    """Copper only, no mask and no paste of their own - or put both back on --remove."""
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    n = 0
    for p in lands(b):
        cu = pcbnew.B_Cu if p.GetLayerSet().Contains(pcbnew.B_Cu) else pcbnew.F_Cu
        ls = pcbnew.LSET()
        ls.addLayer(cu)
        if open_mask:
            ls.addLayer(pcbnew.B_Mask if cu == pcbnew.B_Cu else pcbnew.F_Mask)
            ls.addLayer(pcbnew.B_Paste if cu == pcbnew.B_Cu else pcbnew.F_Paste)
        p.SetLayerSet(ls)
        n += 1
    pcbnew.SaveBoard(BOARD, b)
    print(f"\n@@RESULT {n}", flush=True)


def stage_grid(pitch, win):
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    made = 0
    for p in lands(b):
        pts, nx, ny = windows(p, pitch, win)
        ly = mask_layer(p)
        for x, y in pts:
            s = pcbnew.PCB_SHAPE(b)
            s.SetShape(pcbnew.SHAPE_T_RECTANGLE)
            s.SetLayer(ly)
            s.SetFilled(True)
            s.SetWidth(0)
            s.SetStart(pcbnew.VECTOR2I(pcbnew.FromMM(x - win / 2), pcbnew.FromMM(y - win / 2)))
            s.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(x + win / 2), pcbnew.FromMM(y + win / 2)))
            b.Add(s)
            made += 1
        print(f"  Pad {p.GetNumber()} [{p.GetNetname()}]: {nx} x {ny} Fenster "
              f"{win:.1f} mm, Raster {pitch:.1f} mm, Steg {pitch - win:.1f} mm")
    pcbnew.SaveBoard(BOARD, b)
    print(f"\n@@RESULT {made}", flush=True)


def sub(*a):
    r = subprocess.run([sys.executable, os.path.abspath(__file__), "--stage", *a],
                       capture_output=True, text=True)
    m = re.search(r"@@RESULT ([^\n]*)", r.stdout)
    if not m:
        raise RuntimeError(f"Stage {a[0]}:\n{r.stdout[-900:]}\n{r.stderr[-500:]}")
    print("\n".join(l for l in r.stdout.splitlines() if l.startswith("  ")))
    return m.group(1)


def main():
    if "--stage" in sys.argv:
        i = sys.argv.index("--stage")
        name = sys.argv[i + 1]
        if name == "clear":
            return stage_clear()
        if name == "pads":
            return stage_pads(sys.argv[i + 2] == "open")
        return stage_grid(float(sys.argv[i + 2]), float(sys.argv[i + 3]))

    pitch = float(sys.argv[sys.argv.index("--pitch") + 1]) if "--pitch" in sys.argv else 1.6
    win = float(sys.argv[sys.argv.index("--window") + 1]) if "--window" in sys.argv else 1.1
    if win >= pitch:
        sys.exit("Fenster muss kleiner als das Raster sein, sonst bleibt kein Steg stehen")
    print(f"{sub('clear')} alte Fenster entfernt")
    if "--remove" in sys.argv:
        print(f"{sub('pads', 'open')} Flaechen wieder ganz offen")
        return 0
    print(f"{sub('pads', 'closed')} Flaechen abgedeckt, "
          f"{sub('grid', str(pitch), str(win))} Fenster gesetzt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
