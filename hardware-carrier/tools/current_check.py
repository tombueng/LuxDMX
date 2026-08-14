#!/usr/bin/env python3
"""Measure what the power pours can actually carry, instead of assuming it.

A netclass width is a claim about a track. The current on this board travels in copper
pours, and a pour is only as good as its narrowest neck, which no netclass knows about. So
this walks a cut line across the board, adds up every millimetre of copper belonging to the
net at that cut (zone fill plus tracks, both layers), and turns the total into amps with
IPC-2221 for an external layer:

    I = 0.048 * dT^0.44 * A^0.725      A in mil^2

Reported at a 10 K and a 20 K rise, for 1 oz and 2 oz outer copper. The number that matters
is the MINIMUM over the cuts that the current has to cross, not the average.

Run:  python hardware-carrier/current_check.py [--step 0.5] [--res 0.1]
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
BOARD = os.path.join(HERE, sys.argv[sys.argv.index("--board") + 1]
                     if "--board" in sys.argv else "luxdmx-carrier.kicad_pcb")
if "--board" in sys.argv:
    BOARD = os.path.join(HERE, sys.argv[sys.argv.index("--board") + 1])

def paths_for(board):
    """Where to cut each net, taken from where its own pads are.

    Hardcoded scan windows measured the wrong part of the board the moment anything moved,
    and a current figure from the wrong window is worse than none. Each net is cut along the
    longer axis of its own pad bounding box, across a span wide enough to catch the whole
    pour, so the number follows the layout.
    """
    pads = {}
    for f in board.GetFootprints():
        for p in f.Pads():
            n = p.GetNetname()
            if n in ("V_PIX", "V_PIX_IN", "GND"):
                q = p.GetPosition()
                pads.setdefault(n, []).append((pcbnew.ToMM(q.x), pcbnew.ToMM(q.y)))
    e = [s for s in board.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts]
    bx = [pcbnew.ToMM(v) for s in e for v in (s.GetStart().x, s.GetEnd().x)]
    by = [pcbnew.ToMM(v) for s in e for v in (s.GetStart().y, s.GetEnd().y)]

    out = {}
    for net, pts in pads.items():
        x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts)
        y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
        m = 5.0
        if (x1 - x0) >= (y1 - y0):
            out[net] = ("x", x0 + 1.0, x1 - 1.0,
                        max(y0 - m, min(by) + 0.5), min(y1 + m, max(by) - 0.5))
        else:
            out[net] = ("y", y0 + 1.0, y1 - 1.0,
                        max(x0 - m, min(bx) + 0.5), min(x1 + m, max(bx) - 0.5))
    return out


def amps(mm, dT, oz, inner=False):
    """mm of copper width -> amps.

    IPC-2221 uses k = 0.048 for an outer layer and 0.024 for an inner one: an inner
    conductor is buried in laminate and cannot shed its heat, so the same cross-section
    carries about half."""
    area_mil2 = mm * 0.0347 * oz / 0.0006452
    return (0.024 if inner else 0.048) * dT ** 0.44 * area_mil2 ** 0.725


def main():
    step = float(sys.argv[sys.argv.index("--step") + 1]) if "--step" in sys.argv else 0.5
    res = float(sys.argv[sys.argv.index("--res") + 1]) if "--res" in sys.argv else 0.1

    board = pcbnew.LoadBoard(BOARD)
    nlay = board.GetCopperLayerCount()
    layers = [pcbnew.F_Cu, pcbnew.B_Cu] + \
             ([pcbnew.In1_Cu, pcbnew.In2_Cu] if nlay >= 4 else [])
    INNER = {pcbnew.In1_Cu, pcbnew.In2_Cu}
    OZ = {False: 1.0, True: 0.5}      # JLC 4-Lagen-Standard: aussen 1oz, innen 0.5oz
    zones = {}
    for z in board.Zones():
        for ly in layers:
            if z.IsOnLayer(ly):
                zones.setdefault((z.GetNetname(), ly), []).append(
                    z.GetFilledPolysList(ly))
    tracks = {}
    for t in board.GetTracks():
        if t.GetClass() == "PCB_VIA":
            continue
        tracks.setdefault((t.GetNetname(), t.GetLayer()), []).append(t)

    print(f"Abtastung: Schnitt alle {step} mm, Auflösung {res} mm\n")
    print(f"{'Netz':10s} {'Lage':6s} {'min':>7s} {'median':>7s}   "
          f"{'10K 1oz':>8s} {'10K 2oz':>8s} {'20K 2oz':>8s}")
    print("-" * 62)

    summary = {}
    for net, (axis, a0, a1, s0, s1) in paths_for(board).items():
        totals = []
        per_layer = {ly: [] for ly in layers}
        n = int((a1 - a0) / step) + 1
        for i in range(n):
            a = a0 + i * step
            tot = 0.0
            for ly in layers:
                cov = 0.0
                polys = zones.get((net, ly), [])
                trs = tracks.get((net, ly), [])
                m = int((s1 - s0) / res) + 1
                for j in range(m):
                    s = s0 + j * res
                    x, y = (a, s) if axis == "x" else (s, a)
                    v = pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y))
                    hit = any(p.Contains(v) for p in polys)
                    if not hit:
                        for t in trs:
                            if t.HitTest(v, 0):
                                hit = True
                                break
                    if hit:
                        cov += res
                per_layer[ly].append(cov)
                tot += cov
            totals.append(tot)

        for ly in layers:
            vals = sorted(per_layer[ly])
            if not vals or vals[-1] == 0:
                continue
            mn, md = vals[0], vals[len(vals) // 2]
            print(f"{net:10s} {board.GetLayerName(ly):6s} {mn:6.2f}m {md:6.2f}m")
        # der Engpass ist der Schnitt mit dem kleinsten GESAMTSTROM, nicht mit dem
        # wenigsten Kupfer: innen zaehlt ein Millimeter nur halb
        cuts = [(sum(amps(per_layer[ly][i], 10, OZ[ly in INNER], ly in INNER)
                     for ly in layers), i) for i in range(len(totals))]
        cuts.sort()
        worst_i = cuts[0][1]
        # where the pinch is, not just how bad: without the coordinate there is no way to
        # tell a pad that grew from a track that was rerouted through the pour
        print(f"{net:10s} {'@':6s} engster Schnitt bei {axis}={a0 + worst_i * step:.1f} mm, "
              + ", ".join(f"{board.GetLayerName(ly)} {per_layer[ly][worst_i]:.2f}mm"
                          for ly in layers))
        summary[net] = (sum(per_layer[ly][worst_i] for ly in layers),
                        cuts[0][0],
                        sum(amps(per_layer[ly][worst_i], 20, OZ[ly in INNER], ly in INNER)
                            for ly in layers))
        print(f"{net:10s} {'ENGSTE':6s} {summary[net][0]:6.2f}m          "
              f"{summary[net][1]:7.1f}A bei 10K   {summary[net][2]:7.1f}A bei 20K")
        print()

    if "--profile" in sys.argv:
        print("Engstellen (Schnitte unter 6 mm Gesamtkupfer):")
        for net, (axis, a0, a1, s0, s1) in paths_for(board).items():
            n = int((a1 - a0) / step) + 1
            runs = []
            for i in range(n):
                a = a0 + i * step
                tot = 0.0
                for ly in layers:
                    polys = zones.get((net, ly), [])
                    trs = tracks.get((net, ly), [])
                    m = int((s1 - s0) / res) + 1
                    for j in range(m):
                        sv = s0 + j * res
                        x, y = (a, sv) if axis == "x" else (sv, a)
                        v = pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y))
                        if any(p.Contains(v) for p in polys) or \
                           any(t.HitTest(v, 0) for t in trs):
                            tot += res
                if tot < 6.0:
                    runs.append((a, tot))
            if runs:
                print(f"  {net}: " + ", ".join(f"{a:.0f}mm={t:.1f}" for a, t in runs))
            else:
                print(f"  {net}: keine")
        print()

    print(f"Engste Stelle je Netz ({nlay} Lagen, aussen 1oz" +
          (", innen 0.5oz):" if nlay >= 4 else "):"))
    for net, (mm, a10, a20) in summary.items():
        print(f"  {net:10s} {mm:5.2f} mm Kupfer  ->  {a10:5.1f} A bei 10K, {a20:5.1f} A bei 20K")
    return 0


if __name__ == "__main__":
    sys.exit(main())
