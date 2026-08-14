#!/usr/bin/env python3
"""Stitch a poured net back into one piece, then drop whatever still cannot be reached.

stitch_vias.py works on a fixed grid and covers the big pours. What it walks past are the
narrow strips the router leaves behind, and those matter: a strip of GND on the front with no
via under it is not ground, it is a floating plate, and KiCad reports the two pours of the net
as unconnected until it is dealt with.

The stitching is driven by connectivity, not by geometry. An earlier version worked island by
island and placed a via wherever an island overlapped the same net on the far layer. It did
not converge: most of those vias joined two islands that were already connected to each other,
while the genuinely stranded group stayed stranded. So each round now rebuilds the groups the
way tools/net_islands.py does, takes the ones that are not part of the largest, and places a
via exactly where such a group overlaps the largest one on the other layer. That is the only
place a via can do any good.

Whatever is still separate after that is copper connected to nothing, so the zones are set to
drop unconnected islands and filled once more. Any stitching via left stranded by that goes
with it, otherwise it becomes an unconnected item of its own.

Run after stitch_vias.py.

Run:  python tools/stitch_islands.py [--drill 0.3] [--size 0.6] [--keep-islands]
"""
import os
import sys

import pcbnew

POURED = ("GND", "V_PIX", "V_PIX_IN")
ROUNDS = 6


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


BOARD = os.path.join(_project_dir(), "luxdmx-carrier.kicad_pcb")


class Union:
    def __init__(self):
        self.p = {}

    def find(self, a):
        self.p.setdefault(a, a)
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def join(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[ra] = rb


def spot(poly, size, holes, res=0.15):
    """A point whose whole via footprint sits inside `poly` and clears every drill.

    Testing the centre alone is not enough, and the outline's distance function is not usable
    through SWIG, so the test is the four corners of the via's own square plus a margin."""
    bb = poly.BBox()
    x0, x1 = pcbnew.ToMM(bb.GetLeft()), pcbnew.ToMM(bb.GetRight())
    y0, y1 = pcbnew.ToMM(bb.GetTop()), pcbnew.ToMM(bb.GetBottom())
    h = size / 2 + 0.10
    y = y0 + res
    while y < y1:
        x = x0 + res
        while x < x1:
            if not any((x - hx) ** 2 + (y - hy) ** 2 < 1.44 for hx, hy in holes) and \
                    all(poly.Contains(pcbnew.VECTOR2I(pcbnew.FromMM(x + dx),
                                                      pcbnew.FromMM(y + dy)))
                        for dx in (-h, h) for dy in (-h, h)):
                return (x, y)
            x += res
        y += res
    return None


def groups_of(b, net, layers):
    """Filled islands of `net`, grouped by what is actually connected to what."""
    islands = []
    for z in b.Zones():
        if z.GetNetname() != net or z.GetIsRuleArea():
            continue
        for ly in layers:
            if not z.IsOnLayer(ly):
                continue
            pl = z.GetFilledPolysList(ly)
            for k in range(pl.OutlineCount()):
                one = pcbnew.SHAPE_POLY_SET()
                one.AddOutline(pl.Outline(k))
                islands.append((ly, one, one.Area() / 1e12))
    u = Union()
    for i in range(len(islands)):
        u.find(i)

    def hits(pos, ly=None):
        return [i for i, (l, poly, _a) in enumerate(islands)
                if (ly is None or l == ly) and poly.Contains(pos)]

    for t in b.GetTracks():
        if t.GetNetname() != net:
            continue
        if t.GetClass() == "PCB_VIA":
            h = hits(t.GetPosition())
        else:
            h = hits(t.GetStart(), t.GetLayer()) + hits(t.GetEnd(), t.GetLayer())
        for j in h[1:]:
            u.join(h[0], j)
    for f in b.GetFootprints():
        for p in f.Pads():
            if p.GetNetname() != net:
                continue
            ly = None if p.GetAttribute() == pcbnew.PAD_ATTRIB_PTH else \
                (pcbnew.F_Cu if p.GetLayerSet().Contains(pcbnew.F_Cu) else pcbnew.B_Cu)
            h = hits(p.GetPosition(), ly)
            for j in h[1:]:
                u.join(h[0], j)

    out = {}
    for i, isl in enumerate(islands):
        out.setdefault(u.find(i), []).append(isl)
    return sorted(out.values(), key=lambda g: -sum(a for _l, _p, a in g))


def main():
    drill0 = float(sys.argv[sys.argv.index("--drill") + 1]) if "--drill" in sys.argv else 0.3
    size0 = float(sys.argv[sys.argv.index("--size") + 1]) if "--size" in sys.argv else 0.6

    added, stuck = 0, []
    for _rnd in range(ROUNDS):
        b = pcbnew.LoadBoard(BOARD)
        layers = [pcbnew.F_Cu, pcbnew.B_Cu]
        holes = [(pcbnew.ToMM(t.GetPosition().x), pcbnew.ToMM(t.GetPosition().y))
                 for t in b.GetTracks() if t.GetClass() == "PCB_VIA"] + \
                [(pcbnew.ToMM(p.GetPosition().x), pcbnew.ToMM(p.GetPosition().y))
                 for f in b.GetFootprints() for p in f.Pads()
                 if p.GetAttribute() == pcbnew.PAD_ATTRIB_PTH]
        placed, stuck = 0, []
        for net in POURED:
            gs = groups_of(b, net, layers)
            if len(gs) < 2:
                continue
            for gi, g in enumerate(gs[1:], 1):
                done = False
                # The main group first, and failing that any other group. Only ever joining to
                # the main one leaves pockets that overlap each other but not it: the pixel row
                # ends up walled in on both layers at the same place, so its two islands can
                # reach each other and nothing else. Merged, they hang off the terminal's own
                # pad and the net is whole; left apart, DRC calls the zones unconnected and the
                # gerber gate refuses, over 17 mm2 of copper.
                for other in [gs[0]] + [x for j, x in enumerate(gs) if j not in (0, gi)]:
                    for ly, poly, _a in sorted(g, key=lambda t: -t[2]):
                        for mly, mpoly, _ma in sorted(other, key=lambda t: -t[2]):
                            if mly == ly:
                                continue
                            ov = pcbnew.SHAPE_POLY_SET(poly)
                            ov.BooleanIntersection(mpoly)
                            if ov.IsEmpty():
                                continue
                            # the fallback is the board's own minimum, 0.50 / 0.30. An earlier
                            # 0.45 / 0.25 fitted more islands and produced four DRC violations,
                            # via_diameter and drill_out_of_range, which is not a trade.
                            for size, drill in ((size0, drill0), (0.50, 0.30)):
                                pt = spot(ov, size, holes)
                                if pt is None:
                                    continue
                                v = pcbnew.PCB_VIA(b)
                                v.SetViaType(pcbnew.VIATYPE_THROUGH)
                                v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
                                v.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(pt[0]),
                                                              pcbnew.FromMM(pt[1])))
                                v.SetWidth(pcbnew.FromMM(size))
                                v.SetDrill(pcbnew.FromMM(drill))
                                v.SetNet(b.FindNet(net))
                                v.SetLocked(True)
                                b.Add(v)
                                holes.append(pt)
                                placed += 1
                                done = True
                                print(f"  {net}: {sum(x for _l, _p, x in g):6.1f} mm2 "
                                      f"angebunden bei ({pt[0]:.2f}, {pt[1]:.2f})")
                                break
                            if done:
                                break
                        if done:
                            break
                    if done:
                        break
                if not done:
                    stuck.append((net, sum(x for _l, _p, x in g)))
        added += placed
        if placed:
            pcbnew.ZONE_FILLER(b).Fill(b.Zones())
            pcbnew.SaveBoard(BOARD, b)
        else:
            break

    # Tried pulling the vias out of any group that holds no pad, on the theory that such
    # copper is scrap the router left behind. It is not: GND tracks run into those groups and
    # reach the rest of the net through them. Removing the vias took GND from 16.2 A to
    # 12.6 A and turned two unconnected items into five.
    for net, area in stuck:
        print(f"  {net}: {area:.1f} mm2 nicht erreichbar, wird verworfen")

    b = pcbnew.LoadBoard(BOARD)
    orphan = 0
    if "--keep-islands" not in sys.argv:
        for z in b.Zones():
            if not z.GetIsRuleArea():
                z.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_ALWAYS)
        pcbnew.ZONE_FILLER(b).Fill(b.Zones())
        after = {}
        for z in b.Zones():
            for ly in (pcbnew.F_Cu, pcbnew.B_Cu):
                if z.IsOnLayer(ly) and not z.GetIsRuleArea():
                    after[(z.GetNetname(), ly)] = z.GetFilledPolysList(ly)
        for v in list(b.GetTracks()):
            if v.GetClass() != "PCB_VIA" or not v.IsLocked() or v.GetNetname() not in POURED:
                continue
            q = v.GetPosition()
            if not all((after.get((v.GetNetname(), ly)) or
                        pcbnew.SHAPE_POLY_SET()).Contains(q)
                       for ly in (pcbnew.F_Cu, pcbnew.B_Cu)):
                b.Remove(v)
                orphan += 1
        if orphan:
            pcbnew.ZONE_FILLER(b).Fill(b.Zones())
    pcbnew.SaveBoard(BOARD, b)
    print(f"{added} Vias gesetzt, {len(stuck)} Gruppen unerreichbar, "
          f"{orphan} verwaiste Vias gezogen")
    return 0


if __name__ == "__main__":
    sys.exit(main())
