#!/usr/bin/env python3
"""Wire up any pad that the pour left on an island of its own.

A poured net looks connected right up until the router chops the pour into pieces. Here the
pixel row ends up in a pocket: the supply bus runs the length of the row on the back and the
terminals' own pads and the data lines close the front, so the fill around Pixel1's GND pad
comes out as 17 mm2 of copper with nothing joining it to the other 9229. There is not a single
GND track in that pocket - the pour was supposed to be the connection.

KiCad's DRC does report it, as two GND zones unconnected, which is easy to read as cosmetic.
It is not: that is the return path of a pixel output carrying the same current as its V+.

stitch_islands.py cannot fix this one. It joins an island to the main group where the two
overlap on opposite layers, and this pocket overlaps the main group nowhere - both layers are
walled in at the same place.

So the pad gets a real track. Same maze router as tools/hand_route.py, from the stranded pad
to the nearest copper that IS in the main group, at the net's own class width.

Run:  python tools/rescue_islands.py [--net GND] [--dry-run]
"""
import os
import sys

import pcbnew

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hand_route import (Grid, GRID, LAYERS, backtrace, build, netclass_of,  # noqa: E402
                        smooth, wave)


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


def fill_groups(b, netname):
    """The net's filled islands, grouped by what actually ties them together.

    Same union-find as tools/net_islands.py: islands, then vias, tracks and pads joining them.
    """
    islands = []
    for z in b.Zones():
        if z.GetNetname() != netname or z.GetIsRuleArea():
            continue
        for ly in LAYERS:
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
        if t.GetNetname() != netname:
            continue
        h = hits(t.GetPosition()) if t.GetClass() == "PCB_VIA" else \
            hits(t.GetStart(), t.GetLayer()) + hits(t.GetEnd(), t.GetLayer())
        for j in h[1:]:
            u.join(h[0], j)
    for f in b.GetFootprints():
        for p in f.Pads():
            if p.GetNetname() != netname:
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


def touches(group, pad, ly=None):
    """Does this pad sit on one of the group's islands?

    Not by its centre: a through-hole pad has its centre in the hole, and the fill has an
    anti-pad there, so poly.Contains(centre) is False for every pad on the board and every
    stranded one reads as "no pad attached". The ring just outside the pad is where the
    thermal spokes land, so that is what gets sampled.
    """
    import math
    q = pad.GetPosition()
    rx = pcbnew.ToMM(pad.GetSizeX()) / 2 + 0.35
    ry = pcbnew.ToMM(pad.GetSizeY()) / 2 + 0.35
    for k in range(12):
        a = 2 * math.pi * k / 12
        pt = pcbnew.VECTOR2I(int(q.x + pcbnew.FromMM(rx * math.cos(a))),
                             int(q.y + pcbnew.FromMM(ry * math.sin(a))))
        if any((l == ly or ly is None) and poly.Contains(pt) for l, poly, _a in group):
            return True
    return False


def points(gr, pad, anchors):
    """Grid cells of the stranded pad, and of every pad that is on the main island."""
    def cells(p):
        bb = p.GetBoundingBox()
        r0, c0 = gr.cell(pcbnew.ToMM(bb.GetLeft()), pcbnew.ToMM(bb.GetTop()))
        r1, c1 = gr.cell(pcbnew.ToMM(bb.GetRight()), pcbnew.ToMM(bb.GetBottom()))
        out = []
        for i in range(len(LAYERS)):
            if p.GetAttribute() == pcbnew.PAD_ATTRIB_PTH or \
                    p.GetLayerSet().Contains(LAYERS[i]):
                for r in range(max(r0, 0), r1 + 1):
                    for c in range(max(c0, 0), c1 + 1):
                        out.append((i, r, c))
        return out

    start = cells(pad)
    target = [c for _ref, ap in anchors for c in cells(ap)]
    return start, target


def main():
    netname = sys.argv[sys.argv.index("--net") + 1] if "--net" in sys.argv else "GND"
    b = pcbnew.LoadBoard(BOARD)
    net = b.FindNet(netname)
    if net is None:
        sys.exit(f"Netz {netname} gibt es nicht")

    gs = fill_groups(b, netname)
    if len(gs) < 2:
        print(f"{netname}: die Flaeche haengt zusammen, nichts zu retten")
        return 0
    main_g, rest = gs[0], gs[1:]
    print(f"{netname}: {len(gs)} Gruppen, groesste {sum(a for _l,_p,a in main_g):.0f} mm2")

    # which pads sit on a stranded island, and which sit on the main one
    stranded, anchors = [], []
    for f in b.GetFootprints():
        for p in f.Pads():
            if p.GetNetname() != netname:
                continue
            ly = None if p.GetAttribute() == pcbnew.PAD_ATTRIB_PTH else \
                (pcbnew.F_Cu if p.GetLayerSet().Contains(pcbnew.F_Cu) else pcbnew.B_Cu)
            # Side groups first. A pad can probe as touching both - the main fill often runs
            # past a pad it is not actually joined to, a clearance gap away - and treating
            # that as "already connected" leaves the pocket floating. An extra GND track is
            # harmless; a pixel return with no way home is not.
            if any(touches(g, p, ly) for g in rest):
                stranded.append((f.GetReference(), p))
            elif touches(main_g, p, ly):
                anchors.append((f.GetReference(), p))

    if not stranded:
        for g in rest:
            print(f"  {sum(a for _l,_p,a in g):.1f} mm2 haengen frei, aber ohne Pad daran - "
                  f"das ist Kupferabfall, kein Anschluss")
        return 0

    (width, clear), cls = netclass_of(b, net)
    gr = Grid(b, GRID)
    laid = 0
    for ref, pad in stranded:
        # The class width first, then narrower. A pocket like this one is walled in by the
        # very tracks that made it, and 1.5 mm does not fit through what is left. A thinner
        # return is worth having and worth stating: it is printed with what it carries, so it
        # ends up in the README rather than in nobody's head.
        widths = [w for w in (width, 1.0, 0.8, 0.6, 0.4) if w <= width]
        q = pad.GetPosition()
        print(f"  {ref} Pad {pad.GetNumber()} [{netname}] bei "
              f"({pcbnew.ToMM(q.x):.2f}, {pcbnew.ToMM(q.y):.2f}) haengt auf einer Insel")
        free = own = None

        dist = None
        for width in widths:
            free, own = build(b, gr, netname, width, clear)
            start, target = points(gr, pad, anchors)
            dist, step = wave(gr, free, start, target)
            if dist is not None:
                break
            print(f"     {width:.2f} mm passt nicht (Front nach {step} Schritten erschoepft)")
        if dist is None:
            print("     auch die schmalste Breite kommt nicht heraus")
            continue
        hit = next((li, r, c) for li, r, c in target if dist[li, r, c] >= 0)
        path = smooth(gr, free, backtrace(gr, dist, hit))
        pts = [(p[0],) + gr.mm(p[1], p[2]) for p in path]
        length = 0.0
        if "--dry-run" not in sys.argv:
            for (la, xa, ya), (lb, xb, yb) in zip(pts, pts[1:]):
                if la != lb:
                    v = pcbnew.PCB_VIA(b)
                    v.SetViaType(pcbnew.VIATYPE_THROUGH)
                    v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
                    v.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(xa), pcbnew.FromMM(ya)))
                    v.SetWidth(pcbnew.FromMM(0.60))
                    v.SetDrill(pcbnew.FromMM(0.30))
                    v.SetNet(net)
                    v.SetLocked(True)
                    b.Add(v)
                elif abs(xa - xb) > 1e-9 or abs(ya - yb) > 1e-9:
                    t = pcbnew.PCB_TRACK(b)
                    t.SetStart(pcbnew.VECTOR2I(pcbnew.FromMM(xa), pcbnew.FromMM(ya)))
                    t.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(xb), pcbnew.FromMM(yb)))
                    t.SetWidth(pcbnew.FromMM(width))
                    t.SetLayer(LAYERS[la])
                    t.SetNet(net)
                    t.SetLocked(True)
                    b.Add(t)
                    length += ((xb - xa) ** 2 + (yb - ya) ** 2) ** 0.5
        laid += 1
        print(f"     angebunden: {length:.1f} mm bei {width:.2f} mm Breite, Klasse {cls}")

    if laid and "--dry-run" not in sys.argv:
        pcbnew.ZONE_FILLER(b).Fill(b.Zones())
        pcbnew.SaveBoard(BOARD, b)
        print(f"{laid} gestrandete Pads angebunden, Flaechen neu gefuellt, gespeichert")
    return 0


if __name__ == "__main__":
    sys.exit(main())
