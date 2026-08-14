#!/usr/bin/env python3
"""Say which pieces of a poured net are not joined to the rest, and where they are.

KiCad's DRC will tell you that the front pour and the back pour of a net are unconnected. It
will not tell you which piece of copper is the problem, and on a board with a few hundred
fill islands that is not a question you can answer by looking.

So this rebuilds the connectivity by hand: every filled island is a node, and every via,
through-hole pad and track of that net that touches two of them is an edge. What comes out is
the list of connected groups. One group means the net is whole. More than one, and the small
ones are printed with their area and position, which is the thing you actually need in order
to fix it.

Run:  python tools/net_islands.py [--board X.kicad_pcb] [--net GND]
"""
import os
import sys

import pcbnew

POURED = ("GND", "V_PIX", "V_PIX_IN")


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


HERE = _project_dir()


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


def main():
    name = sys.argv[sys.argv.index("--board") + 1] if "--board" in sys.argv \
        else "luxdmx-carrier.kicad_pcb"
    only = sys.argv[sys.argv.index("--net") + 1] if "--net" in sys.argv else None
    b = pcbnew.LoadBoard(os.path.join(HERE, name))
    layers = [pcbnew.F_Cu, pcbnew.B_Cu] + \
             ([pcbnew.In1_Cu, pcbnew.In2_Cu] if b.GetCopperLayerCount() >= 4 else [])

    rc = 0
    for net in (POURED if only is None else [only]):
        islands = []                      # (layer, SHAPE_POLY_SET, area, bbox)
        for z in b.Zones():
            if z.GetNetname() != net:
                continue
            for ly in layers:
                if not z.IsOnLayer(ly):
                    continue
                pl = z.GetFilledPolysList(ly)
                for k in range(pl.OutlineCount()):
                    one = pcbnew.SHAPE_POLY_SET()
                    one.AddOutline(pl.Outline(k))
                    islands.append((ly, one, one.Area() / 1e12, one.BBox()))
        if not islands:
            continue

        u = Union()
        for i in range(len(islands)):
            u.find(i)

        def hits(pos, ly=None):
            return [i for i, (l, poly, _a, _bb) in enumerate(islands)
                    if (ly is None or l == ly) and poly.Contains(pos)]

        # vias and through-hole pads reach every layer they pass
        for t in b.GetTracks():
            if t.GetClass() == "PCB_VIA" and t.GetNetname() == net:
                h = hits(t.GetPosition())
                for j in h[1:]:
                    u.join(h[0], j)
        for f in b.GetFootprints():
            for p in f.Pads():
                if p.GetNetname() != net:
                    continue
                h = hits(p.GetPosition(),
                         None if p.GetAttribute() == pcbnew.PAD_ATTRIB_PTH
                         else (pcbnew.F_Cu if p.GetLayerSet().Contains(pcbnew.F_Cu)
                               else pcbnew.B_Cu))
                for j in h[1:]:
                    u.join(h[0], j)
        # a track bridges two islands on its own layer
        for t in b.GetTracks():
            if t.GetClass() == "PCB_VIA" or t.GetNetname() != net:
                continue
            h = hits(t.GetStart(), t.GetLayer()) + hits(t.GetEnd(), t.GetLayer())
            for j in h[1:]:
                u.join(h[0], j)

        groups = {}
        for i, (ly, _p, area, bb) in enumerate(islands):
            groups.setdefault(u.find(i), []).append((ly, area, bb))
        order = sorted(groups.values(), key=lambda g: -sum(a for _l, a, _b in g))
        print(f"{net}: {len(islands)} Inseln in {len(order)} Gruppen "
              f"({', '.join('%.0f mm2' % sum(a for _l, a, _b in g) for g in order[:4])}"
              f"{' ...' if len(order) > 4 else ''})")
        if len(order) > 1:
            rc = 1
            for g in order[1:]:
                for ly, area, bb in sorted(g, key=lambda t: -t[1])[:3]:
                    print("   abgetrennt: %-5s %6.2f mm2 bei x %.1f..%.1f y %.1f..%.1f" % (
                        b.GetLayerName(ly), area,
                        pcbnew.ToMM(bb.GetLeft()), pcbnew.ToMM(bb.GetRight()),
                        pcbnew.ToMM(bb.GetTop()), pcbnew.ToMM(bb.GetBottom())))
    return rc


if __name__ == "__main__":
    sys.exit(main())
