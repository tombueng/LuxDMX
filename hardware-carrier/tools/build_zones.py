#!/usr/bin/env python3
"""Build the copper pours.

20 A does not travel in a track. IPC-2221 on an external layer at a 10 K rise wants 9.4 mm
of 2 oz copper for it, so V_PIX_IN, V_PIX and GND are poured, and the router only has to
find the short stubs between a pad and the pour.

Geography, from where the pads actually sit:

    V_PIX_IN   screw terminal (95.5, 114.5) and DC jack (101.2, 129.3) on the left,
               over to the fuse's left hole (130.4, 122.9).  Front pour.
    V_PIX      out of the fuse (135.5 / 140.6) along the bottom to five pixel terminals
               (x 107 .. 172 at y 133.4), plus C1 and the buck.  Back pour, so it does not
               fight V_PIX_IN for the same layer in the overlapping x range.
    GND        everything else on both layers, lowest priority, so it takes whatever is
               left after the two supply pours have claimed their ground.

Pad connection: the two supply pours connect solid, because a thermal relief is a current
limit and these pads are the ones carrying the amps. GND keeps thermal spokes so the 47 GND
pads stay hand-solderable, but with 1.5 mm spokes rather than the default hairlines.

Idempotent, re-running replaces the zones. Run:
    python hardware-carrier/build_zones.py [--dry-run]
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

# Same-net zones may touch on an edge but must not overlap in area, KiCad reports
# zones_intersect for that. So the V_PIX boxes share exact boundaries at x 136.0 / y 126.0.
INSET = 0.5          # keep the pour off the board edge
SPOKE = 1.5          # GND thermal spoke width, mm

#  net,        layer,  priority, (x0, y0, x1, y1) or None for the whole board, connection
# Three power nets, two layers, one 13 mm band along the bottom: they cannot all have the
# whole band. Measured what each actually needs and gave the rest back to GND, whose return
# current is the one that concentrates (everything comes back to the input terminal at x 95).
def plan_for(board):
    """Where each rail pours, taken from where its own pads actually are.

    Hand-drawn rectangles went stale the moment the fuse, the bulk cap and the terminals
    moved: the input rail's box still covered half of what is now output-side board. So the
    geography is derived instead. Each supply gets the bounding box of its own pads plus a
    margin, and V_PIX_IN outranks V_PIX, so where they overlap the input side carves its own
    area out of the output side rather than the two fighting at equal priority. GND takes
    what is left, at the bottom of the pile, on both layers.
    """
    pads = {}
    for f in board.GetFootprints():
        for p in f.Pads():
            n = p.GetNetname()
            if n in ("V_PIX", "V_PIX_IN"):
                q = p.GetPosition()
                pads.setdefault(n, []).append((pcbnew.ToMM(q.x), pcbnew.ToMM(q.y)))
    out = []
    # The input rail's margin is the dial that matters. Its box is uniform, but its pads only
    # live at the inlet and the fuse, so a generous margin claims board where V_PIX has to get
    # past it to reach the westernmost pixel output. At 3.0 that squeezed V_PIX to 3.3 mm and
    # 5.6 A while the input rail sat on 17.9 A it did not need.
    vin_margin = float(os.environ.get("VIN_MARGIN", "3.0"))
    # Supply rails are tracks now, not pours. A pour beside a track of the same net just
    # carries an unknown share of the current and makes the number meaningless again, and the
    # hundreds of stitching vias only existed to hold two halves of a pour together.
    rails = () if os.environ.get("RAIL_POURS", "0") != "1" else \
        (("V_PIX_IN", 40, vin_margin), ("V_PIX", 30, 3.0))
    for net, prio, margin in rails:
        pts = pads.get(net)
        if not pts:
            print(f"  {net}: keine Pads, keine Zone")
            continue
        r = (min(p[0] for p in pts) - margin, min(p[1] for p in pts) - margin,
             max(p[0] for p in pts) + margin, max(p[1] for p in pts) + margin)
        print(f"  {net}: {len(pts)} Pads -> Kasten x {r[0]:.1f}..{r[2]:.1f} "
              f"y {r[1]:.1f}..{r[3]:.1f}, Prioritaet {prio}")
        for layer in ("F.Cu", "B.Cu"):
            out.append((net, layer, prio, r, "solid"))
    out.append(("GND", "F.Cu", 10, None, "thermal"))
    out.append(("GND", "B.Cu", 10, None, "thermal"))
    return out


def outline_box(board):
    e = [s for s in board.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts]
    xs = [pcbnew.ToMM(v) for s in e for v in (s.GetStart().x, s.GetEnd().x)]
    ys = [pcbnew.ToMM(v) for s in e for v in (s.GetStart().y, s.GetEnd().y)]
    return min(xs), min(ys), max(xs), max(ys)


def main():
    dry = "--dry-run" in sys.argv
    board = pcbnew.LoadBoard(BOARD)
    box = outline_box(board)
    print(f"Outline x {box[0]:.1f}..{box[2]:.1f}  y {box[1]:.1f}..{box[3]:.1f}")

    # rule areas are not pours: the OLED mounting keepouts and anything power_backbone.py
    # reserved have to survive a rebuild of the zones
    old = [z for z in board.Zones() if not z.GetIsRuleArea()]
    keep = sum(1 for z in board.Zones() if z.GetIsRuleArea())
    for z in old:
        if not dry:
            board.Remove(z)
    if old:
        print(f"{len(old)} alte Zonen entfernt, {keep} Sperrflaechen behalten")

    nets = {n.GetNetname(): n for n in board.GetNetInfo().NetsByName().values()}
    layers = {"F.Cu": pcbnew.F_Cu, "B.Cu": pcbnew.B_Cu}

    print("\nZonen:")
    for netname, layer, prio, rect, conn in plan_for(board):
        if netname not in nets:
            print(f"  {netname}: Netz gibt es nicht, uebersprungen")
            continue
        if isinstance(rect, list):
            corners = [(min(max(x, box[0] + INSET), box[2] - INSET),
                        min(max(y, box[1] + INSET), box[3] - INSET)) for x, y in rect]
            x0 = min(c[0] for c in corners); x1 = max(c[0] for c in corners)
            y0 = min(c[1] for c in corners); y1 = max(c[1] for c in corners)
        else:
            x0, y0, x1, y1 = rect if rect else box
            x0, y0 = max(x0, box[0] + INSET), max(y0, box[1] + INSET)
            x1, y1 = min(x1, box[2] - INSET), min(y1, box[3] - INSET)
            corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]

        z = pcbnew.ZONE(board)
        z.SetLayer(layers[layer])
        z.SetNet(nets[netname])
        z.SetAssignedPriority(prio)
        z.SetIsFilled(False)
        z.SetPadConnection(pcbnew.ZONE_CONNECTION_FULL if conn == "solid"
                           else pcbnew.ZONE_CONNECTION_THERMAL)
        if conn != "solid":
            z.SetThermalReliefSpokeWidth(pcbnew.FromMM(SPOKE))
            z.SetThermalReliefGap(pcbnew.FromMM(0.3))
        z.SetMinThickness(pcbnew.FromMM(0.25))
        # Fill everything first, prune later. Dropping unconnected islands here would be
        # the wrong order: stitch_vias.py only puts a via where BOTH layers carry the net,
        # so an island removed now can never earn the via that would have connected it.
        # That is exactly what killed the back-side V_PIX_IN pour. stitch_islands.py turns
        # this to ALWAYS at the end, once everything stitchable has been stitched.
        z.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_NEVER)
        pts = pcbnew.VECTOR_VECTOR2I()
        for x, y in corners:
            pts.append(pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y)))
        z.AddPolygon(pts)
        if not dry:
            board.Add(z)
        print(f"  {netname:9s} {layer}  Prio {prio:2d}  {conn:7s}  "
              f"x {x0:6.1f}..{x1:6.1f}  y {y0:6.1f}..{y1:6.1f}  "
              f"({len(corners)} Ecken)")

    if not dry:
        filler = pcbnew.ZONE_FILLER(board)
        filler.Fill(board.Zones())
        pcbnew.SaveBoard(BOARD, board)
        board = pcbnew.LoadBoard(BOARD)
        board.BuildConnectivity()
        print(f"\ngefuellt und gespeichert, "
              f"{board.GetConnectivity().GetUnconnectedCount(True)} Verbindungen offen")
    return 0


if __name__ == "__main__":
    sys.exit(main())
