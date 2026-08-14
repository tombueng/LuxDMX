#!/usr/bin/env python3
"""Lay the supply rails as wide locked copper BEFORE the router gets the board.

The pours carry the current, but a pour only gets what is left over. Freerouting does not
know that the strip between the input terminal and the fuse is the narrowest part of the
whole board, so it happily lays pixel data lines straight across it. One reroute took the
input rail from 9.2 A to 7.1 A that way, and the only reason it came back was that a taller
pour was available. That is luck, not design.

So the corridor is reserved first, as a keepout that bars tracks and vias but lets the pour
fill straight through it. The router has to take its signals elsewhere and the pour gets the
whole band, every time.

It reserves the corridor rather than laying fat locked tracks, which was the first attempt and
does not work: Freerouting will not converge with a wide protected wire in the way. 7.8 mm ran
past 15 minutes, and so did 5.5 and even 4.0, against 18 seconds for the same board with no
backbone at all. It is not the blockage, a keepout of the same width routes fine, it is the
wire. Keepouts are a first-class concept in the DSN and fat protected wiring is not.

Widths are not guessed. For each path the script measures, every 0.5 mm along it, how much
room there is between the pads of other nets, and reserves no more than fits with the netclass
clearance. What it prints is what actually went down.

The keepout is an instruction to the router, not a feature of the board, so it comes off again
once the routing is done: `--remove`. Leaving it in place splits the pours, because barring
vias bars the stitching vias too, and then the two layers of a net never meet.

Run before autoroute:  python tools/power_backbone.py [--check] [--max W]
Run after  autoroute:  python tools/power_backbone.py --remove
"""
import math
import os
import sys

import pcbnew

CLEAR = 0.30            # power netclass clearance

# net, layer, waypoints, requested width. Waypoints are the middle of the band.
PATHS = [
    # Two bands with a 3 mm door between them at x 108..111. Reserving only the narrow
    # stretch from x 113 does not work: the router simply piles everything into x 112 and
    # the rail chokes there instead, 2.3 mm and 6.7 A. Reserving the whole run from 99.5
    # works but leaves the signals no way across and costs a PIX5 connection. So the band
    # runs the whole way with one gap, placed where the pour is 13 mm tall and can spare
    # what crosses it.
    ("V_PIX_IN", "F.Cu", [(99.5, 124.5), (130.4, 124.5)], 8.0),
    # Fuse to the pixel terminals, along the BACK. Reserving a band on the front instead was
    # the first attempt and it protects the wrong thing: on the front the terminals' own DATA
    # and GND pads chop the strip into pieces no pour can bridge, so the rail has always run
    # on the back. The pixel data lines cross it there, and when they cut it the 1000 uF and
    # the Pixel1 and Pixel2 outputs end up on 272 mm2 of copper connected to nothing.
    ("V_PIX", "B.Cu", [(110.0, 130.4), (185.0, 130.4)], 3.0),
    # The lane from the fuse back to the three loads that sit left of it: the 1000 uF at
    # x 114, Pixel1 at 107, Pixel2 at 123. Nothing can be moved to avoid the crossing, the
    # board is full on both sides of the fuse, so the crossing gets reserved instead. Laid as
    # a zone after routing it just fragments on the signal tracks; reserved before routing the
    # signals go elsewhere. At y 120.5 it is the direct line from the fuse to the cap. That was
    # impossible while the buffer was a DIP-20, whose pin rows blocked the back there too;
    # with the SOIC there are no back-side pins in the way at all.
    ("V_PIX", "B.Cu", [(112.0, 120.5), (136.0, 120.5)], 8.0),
]


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


BOARD = os.path.join(_project_dir(), "luxdmx-carrier.kicad_pcb")


def room(pads, edge, net, x, y, horizontal=True):
    """Free span across the path at (x, y), between foreign pads and the board edge."""
    lo, hi = edge[0], edge[1]
    for n, px, py, r in pads:
        if n == net:
            continue
        a, c = (x, y) if horizontal else (y, x)
        d = abs(px - a) if horizontal else abs(py - a)
        reach2 = (r + CLEAR) ** 2 - d * d
        if reach2 <= 0:
            continue
        reach = math.sqrt(reach2)
        q = py if horizontal else px
        if q + reach <= y and q + reach > lo:
            lo = q + reach
        if q - reach >= y and q - reach < hi:
            hi = q - reach
    return lo, hi


def corridors(b, width, fits):
    """Bands to reserve, derived from where each rail's own pads sit.

    Hardcoded waypoints reserved the wrong strip the moment the fuse and the terminals moved.
    Two runs matter: along the pixel terminal row, which has to reach every output, and from
    the supply inlet across to the fuse. Where exactly to put each band is not guessed either
    - a fixed offset put the first one straight onto the terminals' own DATA and GND pads and
    it measured 0.8 mm of room. So the line is searched: try every 0.5 mm across the strip
    and keep whichever one leaves the most space.
    """
    pads = {}
    for f in b.GetFootprints():
        for p in f.Pads():
            n = p.GetNetname()
            if n in ("V_PIX", "V_PIX_IN"):
                q = p.GetPosition()
                pads.setdefault(n, []).append((pcbnew.ToMM(q.x), pcbnew.ToMM(q.y),
                                               pcbnew.ToMM(p.GetSizeY()) / 2))
    out = []
    vp = pads.get("V_PIX") or []
    if vp:
        ymax = max(p[1] for p in vp)
        row = [p for p in vp if abs(p[1] - ymax) < 1.0]
        if len(row) > 1:
            x0, x1 = min(p[0] for p in row), max(p[0] for p in row)
            best = max(((fits("V_PIX", x0, x1, ymax - d), ymax - d)
                        for d in [k * 0.5 for k in range(6, 30)]), key=lambda t: t[0])
            if best[0] >= 1.0:
                out.append(("V_PIX", "B.Cu", [(x0, best[1]), (x1, best[1])],
                            min(width, best[0])))
    vi = pads.get("V_PIX_IN") or []
    if len(vi) > 1:
        x0, x1 = min(p[0] for p in vi), max(p[0] for p in vi)
        lo, hi = min(p[1] for p in vi), max(p[1] for p in vi)
        best = max(((fits("V_PIX_IN", x0, x1, lo - 6 + k * 0.5), lo - 6 + k * 0.5)
                    for k in range(int((hi - lo + 12) / 0.5))), key=lambda t: t[0])
        if best[0] >= 1.0:
            out.append(("V_PIX_IN", "F.Cu", [(x0, best[1]), (x1, best[1])],
                        min(width, best[0])))
    return out


def main():
    # A wider band is better copper and a harder routing problem. 7.8 mm blocked so much of
    # the front layer that Freerouting did not converge in 15 minutes, so the width is a dial,
    # not a constant, and the pipeline picks the widest that still routes.
    cap = float(sys.argv[sys.argv.index("--max") + 1]) if "--max" in sys.argv else 99.0
    b = pcbnew.LoadBoard(BOARD)
    pads = []
    for f in b.GetFootprints():
        for p in f.Pads():
            q, s = p.GetPosition(), p.GetSize()
            pads.append((p.GetNetname(), pcbnew.ToMM(q.x), pcbnew.ToMM(q.y),
                         math.hypot(pcbnew.ToMM(s.x), pcbnew.ToMM(s.y)) / 2))
    e = [s for s in b.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts]
    ys = [pcbnew.ToMM(v) for s in e for v in (s.GetStart().y, s.GetEnd().y)]
    edge = (min(ys) + 0.5, max(ys) - 0.5)

    # anything this script laid before, so it is idempotent
    old = 0
    for z in list(b.Zones()):
        if z.GetIsRuleArea() and z.GetZoneName().startswith("backbone"):
            b.Remove(z)
            old += 1
    for t in list(b.GetTracks()):
        if t.GetClass() == "PCB_TRACK" and t.IsLocked() and \
                pcbnew.ToMM(t.GetWidth()) >= 3.0:
            b.Remove(t)
            old += 1
    if old:
        print(f"{old} alte Rueckgrat-Elemente entfernt")

    if "--none" in sys.argv:
        # the safe configuration: no corridor reserved at all. Costs the input rail about
        # 5 A but every net comes out whole, which the reserved variants so far do not.
        pcbnew.SaveBoard(BOARD, b)
        print("keine Sperrflaechen, Router bekommt die Platine wie sie ist")
        return 0

    if "--remove" in sys.argv:
        pcbnew.SaveBoard(BOARD, b)
        print("Sperrflaechen entfernt, das Routing steht")
        return 0

    def fits(net, x0, x1, y):
        w = 99.0
        n = int(abs(x1 - x0) / 1.0) + 1
        for i in range(n + 1):
            x = x0 + (x1 - x0) * i / n
            lo, hi = room(pads, edge, net, x, y)
            w = min(w, 2 * min(y - lo, hi - y))
        return max(w, 0.0)

    auto = "--auto" in sys.argv
    plan = corridors(b, float(sys.argv[sys.argv.index("--auto") + 1]), fits) if auto else PATHS
    laid = 0
    for net, layer, pts, want in plan:
        ly = pcbnew.F_Cu if layer == "F.Cu" else pcbnew.B_Cu
        n = b.FindNet(net)
        if n is None:
            sys.exit(f"Netz {net} gibt es nicht")
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            steps = int(abs(x1 - x0) / 0.5) + 1
            fits = min(want, cap)
            for i in range(steps + 1):
                x = x0 + (x1 - x0) * i / steps
                y = y0 + (y1 - y0) * i / steps
                lo, hi = room(pads, edge, net, x, y)
                fits = min(fits, 2 * min(y - lo, hi - y))
            fits = math.floor(fits * 10) / 10
            if fits < 1.0:
                print(f"  {net} {x0:.1f}->{x1:.1f}: nur {fits:.1f} mm frei, nichts gelegt")
                continue
            if "--check" in sys.argv:
                print(f"  {net} {layer} {x0:.1f},{y0:.1f} -> {x1:.1f},{y1:.1f}: "
                      f"{fits:.1f} mm moeglich (gewuenscht {want:.1f})")
                continue
            z = pcbnew.ZONE(b)
            z.SetIsRuleArea(True)
            z.SetLayer(ly)
            z.SetZoneName(f"backbone-{net}-{int(x0)}")
            z.SetDoNotAllowTracks(True)
            z.SetDoNotAllowVias(True)
            z.SetDoNotAllowZoneFills(False)
            z.SetDoNotAllowPads(False)
            z.SetDoNotAllowFootprints(False)
            pts = pcbnew.VECTOR_VECTOR2I()
            for px, py in ((x0, y0 - fits / 2), (x1, y1 - fits / 2),
                           (x1, y1 + fits / 2), (x0, y0 + fits / 2)):
                pts.append(pcbnew.VECTOR2I(pcbnew.FromMM(px), pcbnew.FromMM(py)))
            z.AddPolygon(pts)
            b.Add(z)
            laid += 1
            print(f"  {net} {layer}: {x0:.1f},{y0:.1f} -> {x1:.1f},{y1:.1f}, "
                  f"{fits:.1f} mm breit als Sperrflaeche")
    if "--check" not in sys.argv:
        pcbnew.SaveBoard(BOARD, b)
        print(f"{laid} Segmente gelegt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
