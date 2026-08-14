#!/usr/bin/env python3
"""Keep the carrier clear under the OLED's four mounting holes, and mark them to drill.

The display sits on a socket with nothing holding it but four pins. Anyone who wants it
supported will drill through the carrier at the module's own mounting holes and put standoffs
through, and that only works if there is no copper there. So each spot is reserved: no tracks,
no vias, no pads and no pour either, on both layers.

The positions are not typed in. They come from the module's STEP file, whose four mounting
barrels sit at (+-15.24, +-13.97) with a 3.0 mm bore, put through the display header's own
placement. Move the header and re-run and they follow it.

Deliberately generous: a 3.0 mm bore inside a 7.0 mm reserved circle leaves room for an M3
standoff's collar and for the drill to wander. Each is marked on BOTH silkscreens with a
circle the size of the bore and a crosshair to centre-punch on. Both sides on purpose: from
the front the display covers the spot, so the back is where you will be looking.

Every step runs in its own process: clear the rule areas, clear the silk, draw the rule areas,
draw the silk. Doing any two of those in one pcbnew takes it down with SIGSEGV, the same way
removing zones and tracks together does in tools/autoroute.py. Each on its own is fine, and
one board per process is the rule the rest of this toolchain already follows.

Run:  python tools/oled_mount_keepouts.py [--dia 7.0] [--remove]
"""
import math
import os
import re
import subprocess
import sys

HOLES = [(sx * 15.24, sy * 13.97) for sx in (-1, 1) for sy in (-1, 1)]
MODEL_ROT_X, MODEL_ROT_Y = -15.405, 3.81      # how the model hangs off the header
NAME = "oled-mount"
BORE, SILK_W = 3.0, 0.15


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


BOARD = os.path.join(_project_dir(), "luxdmx-carrier.kicad_pcb")


def spots(b):
    """The four hole centres in board coordinates, from the display header's placement."""
    import pcbnew
    d = next((f for f in b.GetFootprints() if f.GetReference().startswith("Display")), None)
    if d is None:
        sys.exit("Display-Header nicht gefunden")
    o = d.GetPosition()
    ox, oy = pcbnew.ToMM(o.x), pcbnew.ToMM(o.y)
    a = math.radians(-d.GetOrientationDegrees())
    out = []
    for hx, hy in HOLES:
        # the model is turned 90 degrees on the header, so its y is the header's x
        fx, fy = hy + MODEL_ROT_X, -hx + MODEL_ROT_Y
        out.append((ox + fx * math.cos(a) - fy * math.sin(a),
                    oy + fx * math.sin(a) + fy * math.cos(a)))
    return out


def stage_clear_zones():
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    n = 0
    for z in list(b.Zones()):
        if z.GetIsRuleArea() and z.GetZoneName().startswith(NAME):
            b.Remove(z)
            n += 1
    pcbnew.SaveBoard(BOARD, b)
    print(f"\n@@RESULT {n}", flush=True)


def stage_clear_silk():
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    old = spots(b)
    n = 0
    for s in list(b.GetDrawings()):
        if not isinstance(s, pcbnew.PCB_SHAPE) or \
                s.GetLayer() not in (pcbnew.F_SilkS, pcbnew.B_SilkS):
            continue
        c = s.GetCenter()
        if any(math.hypot(pcbnew.ToMM(c.x) - mx, pcbnew.ToMM(c.y) - my) < BORE
               for mx, my in old):
            b.Remove(s)
            n += 1
    pcbnew.SaveBoard(BOARD, b)
    print(f"\n@@RESULT {n}", flush=True)


def keep(x, y, dia, xs, ys):
    return (min(xs) + dia / 2 <= x <= max(xs) - dia / 2 and
            min(ys) + dia / 2 <= y <= max(ys) - dia / 2)


def outline(b):
    import pcbnew
    e = [s for s in b.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts]
    return ([pcbnew.ToMM(v) for s in e for v in (s.GetStart().x, s.GetEnd().x)],
            [pcbnew.ToMM(v) for s in e for v in (s.GetStart().y, s.GetEnd().y)])


def stage_make_zones(dia):
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    xs, ys = outline(b)
    made = 0
    for i, (x, y) in enumerate(spots(b), 1):
        if not keep(x, y, dia, xs, ys):
            print(f"  Loch {i} bei ({x:.2f}, {y:.2f}) liegt zu dicht am Rand, uebersprungen")
            continue
        z = pcbnew.ZONE(b)
        z.SetIsRuleArea(True)
        z.SetZoneName(f"{NAME}-{i}")
        ls = pcbnew.LSET()
        ls.addLayer(pcbnew.F_Cu)
        ls.addLayer(pcbnew.B_Cu)
        z.SetLayerSet(ls)
        z.SetDoNotAllowTracks(True)
        z.SetDoNotAllowVias(True)
        z.SetDoNotAllowPads(True)
        z.SetDoNotAllowZoneFills(True)
        pts = pcbnew.VECTOR_VECTOR2I()
        for k in range(16):
            t = 2 * math.pi * k / 16
            pts.append(pcbnew.VECTOR2I(pcbnew.FromMM(x + dia / 2 * math.cos(t)),
                                       pcbnew.FromMM(y + dia / 2 * math.sin(t))))
        z.AddPolygon(pts)
        b.Add(z)
        made += 1
        print(f"  Loch {i}: {dia:.1f} mm Kupfer frei um ({x:.2f}, {y:.2f})")
    pcbnew.SaveBoard(BOARD, b)
    print(f"\n@@RESULT {made}", flush=True)


def stage_make_silk(dia):
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    xs, ys = outline(b)
    made = 0
    for x, y in spots(b):
        if not keep(x, y, dia, xs, ys):
            continue
        for layer in (pcbnew.F_SilkS, pcbnew.B_SilkS):
            c = pcbnew.PCB_SHAPE(b)
            c.SetShape(pcbnew.SHAPE_T_CIRCLE)
            c.SetLayer(layer)
            c.SetWidth(pcbnew.FromMM(SILK_W))
            c.SetCenter(pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y)))
            c.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(x + BORE / 2), pcbnew.FromMM(y)))
            b.Add(c)
            r0, r1 = BORE / 2 + 0.4, BORE / 2 + 1.4
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                s = pcbnew.PCB_SHAPE(b)
                s.SetShape(pcbnew.SHAPE_T_SEGMENT)
                s.SetLayer(layer)
                s.SetWidth(pcbnew.FromMM(SILK_W))
                s.SetStart(pcbnew.VECTOR2I(pcbnew.FromMM(x + dx * r0),
                                           pcbnew.FromMM(y + dy * r0)))
                s.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(x + dx * r1),
                                         pcbnew.FromMM(y + dy * r1)))
                b.Add(s)
            made += 1
    pcbnew.SaveBoard(BOARD, b)
    print(f"\n@@RESULT {made}", flush=True)


def sub(*a):
    r = subprocess.run([sys.executable, os.path.abspath(__file__), "--stage", *a],
                       capture_output=True, text=True)
    m = re.search(r"@@RESULT ([^\n]*)", r.stdout)
    if not m:
        raise RuntimeError(f"Stage {a[0]}:\n{r.stdout[-800:]}\n{r.stderr[-500:]}")
    print("\n".join(l for l in r.stdout.splitlines() if l.startswith("  ")))
    return m.group(1)


def main():
    if "--stage" in sys.argv:
        i = sys.argv.index("--stage")
        name = sys.argv[i + 1]
        if name == "clear_zones":
            return stage_clear_zones()
        if name == "clear_silk":
            return stage_clear_silk()
        if name == "make_zones":
            return stage_make_zones(float(sys.argv[i + 2]))
        return stage_make_silk(float(sys.argv[i + 2]))

    dia = float(sys.argv[sys.argv.index("--dia") + 1]) if "--dia" in sys.argv else 7.0
    print(f"alt: {sub('clear_silk')} Siebdruck, {sub('clear_zones')} Sperrflaechen entfernt")
    if "--remove" in sys.argv:
        return 0
    n = sub("make_zones", str(dia))
    print(f"{n} Sperrflaechen gesetzt, "
          f"{sub('make_silk', str(dia))} Bohrmarken auf beiden Siebdrucken")
    return 0


if __name__ == "__main__":
    sys.exit(main())
