#!/usr/bin/env python3
"""Finish one net by hand, deterministically, when the autorouter will not.

Freerouting gets this board to within two or three connections and then stops, and which ones
it drops moves around: change anything, anywhere, and a different pair comes out open. It is
deterministic but chaotic, so turning a dial and running it again is not a method. This is the
method: pick the net it left open and route that one net properly.

Lee's algorithm on a 0.2 mm grid over both layers. Obstacles are the copper of every OTHER
net - tracks, vias, pads - rasterised already inflated by (its own half width + clearance +
half the width we are laying), so a free cell is free for the centre line of the new track.
Zone fills are deliberately NOT obstacles: the pours are laid after routing and retreat around
whatever is there, so treating them as walls would forbid the whole board.

Everything already on the net is a starting point, not just its pads, so a half-finished run
gets extended rather than replaced. It stops at the first cell of the target group it reaches,
which under a uniform-cost wavefront is a shortest path.

A via costs VIA_COST cells of track. Free vias give a path that stitches back and forth
for no reason, so it is priced, and priced properly rather than merely rationed.

Run:  python tools/hand_route.py --net PIX5_5V [--grid 0.2] [--dry-run]
"""
import os
import sys

import numpy as np
import pcbnew

GRID = 0.20             # mm per cell
VIA_COST = 15           # a via costs this many cells of track, i.e. 3 mm
VIA_SIZE, VIA_DRILL = 0.60, 0.30
EDGE_KEEP = 0.30        # copper to board edge
MARGIN = 0.03           # on top of the class clearance: the grid rounds, DRC does not, and a
                        # diagonal laid on 0.2 mm cells came out 0.1983 mm from its neighbour


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


BOARD = os.path.join(_project_dir(), "luxdmx-carrier.kicad_pcb")
LAYERS = [pcbnew.F_Cu, pcbnew.B_Cu]


class Grid:
    def __init__(self, b, grid):
        e = [s for s in b.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts]
        xs = [pcbnew.ToMM(v) for s in e for v in (s.GetStart().x, s.GetEnd().x)]
        ys = [pcbnew.ToMM(v) for s in e for v in (s.GetStart().y, s.GetEnd().y)]
        self.x0, self.y0 = min(xs), min(ys)
        self.g = grid
        self.nx = int((max(xs) - self.x0) / grid) + 1
        self.ny = int((max(ys) - self.y0) / grid) + 1

    def cell(self, x, y):
        return (int(round((y - self.y0) / self.g)), int(round((x - self.x0) / self.g)))

    def mm(self, r, c):
        # plain floats: these come out of numpy index arithmetic and pcbnew.FromMM refuses
        # a numpy.float64 outright
        return (float(self.x0 + c * self.g), float(self.y0 + r * self.g))

    def rect(self, arr, x0, y0, x1, y1, grow):
        r0, c0 = self.cell(x0 - grow, y0 - grow)
        r1, c1 = self.cell(x1 + grow, y1 + grow)
        arr[max(r0, 0):r1 + 1, max(c0, 0):c1 + 1] = True

    def seg(self, arr, x0, y0, x1, y1, grow):
        n = max(int(((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5 / (self.g / 2)), 1)
        for i in range(n + 1):
            t = i / n
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            self.rect(arr, x, y, x, y, grow)


# Mirrors tools/set_netclasses.py, name for name. Reading it off the board would be better,
# but pcbnew's Python side hands out the net class as a bare SwigPyObject with no accessors,
# BOARD_DESIGN_SETTINGS has no GetNetClasses, and GetNetClassName() answers "Default" for
# every net including V_PIX - which would route the pixel rail at 0.35 mm, 1.5 A, next to the
# 4.8 mm the rest of it runs at. So the assignment is repeated here rather than trusted.
CLASSES = {"Power": (1.50, 0.30), "Rail5V": (1.50, 0.25),
           "Rail3V3": (0.80, 0.25), "Default": (0.35, 0.20)}
PATTERNS = [("V_PIX_IN", "Power"), ("V_PIX", "Power"), ("GND", "Power"),
            ("+5V", "Rail5V"), ("+3V3", "Rail3V3")]


def netclass_of(b, net):
    name = net.GetNetname()
    for pat, cls in PATTERNS:
        if name == pat:
            return CLASSES[cls], cls
    return CLASSES["Default"], "Default"


def build(b, gr, netname, width, clear):
    clear += MARGIN
    """free[layer] = the new track's centre may sit here; own[layer] = already on the net."""
    free = [np.ones((gr.ny, gr.nx), bool) for _ in LAYERS]
    own = [np.zeros((gr.ny, gr.nx), bool) for _ in LAYERS]
    half = width / 2

    # board edge: everything outside the outline bounding box is out anyway, keep a margin
    m = int((EDGE_KEEP + half) / gr.g) + 1
    for a in free:
        a[:m, :] = False
        a[-m:, :] = False
        a[:, :m] = False
        a[:, -m:] = False

    for t in b.GetTracks():
        mine = t.GetNetname() == netname
        s, e = t.GetStart(), t.GetEnd()
        x0, y0 = pcbnew.ToMM(s.x), pcbnew.ToMM(s.y)
        x1, y1 = pcbnew.ToMM(e.x), pcbnew.ToMM(e.y)
        if t.GetClass() == "PCB_VIA":
            w = pcbnew.ToMM(t.GetWidth(pcbnew.F_Cu)) if hasattr(t, "GetWidth") else VIA_SIZE
            for i, ly in enumerate(LAYERS):
                if mine:
                    gr.rect(own[i], x0, y0, x0, y0, w / 2)
                else:
                    gr.rect(free[i], x0, y0, x0, y0, -1) if False else None
                    gr.seg(free[i], x0, y0, x0, y0, w / 2 + clear + half)
            if not mine:
                for i in range(len(LAYERS)):
                    tmp = np.zeros_like(free[i])
                    gr.seg(tmp, x0, y0, x0, y0, w / 2 + clear + half)
                    free[i] &= ~tmp
            continue
        i = LAYERS.index(t.GetLayer()) if t.GetLayer() in LAYERS else None
        if i is None:
            continue
        w = pcbnew.ToMM(t.GetWidth())
        if mine:
            gr.seg(own[i], x0, y0, x1, y1, w / 2)
        else:
            tmp = np.zeros_like(free[i])
            gr.seg(tmp, x0, y0, x1, y1, w / 2 + clear + half)
            free[i] &= ~tmp

    for f in b.GetFootprints():
        for p in f.Pads():
            bb = p.GetBoundingBox()
            x0, y0 = pcbnew.ToMM(bb.GetLeft()), pcbnew.ToMM(bb.GetTop())
            x1, y1 = pcbnew.ToMM(bb.GetRight()), pcbnew.ToMM(bb.GetBottom())
            thru = p.GetAttribute() in (pcbnew.PAD_ATTRIB_PTH, pcbnew.PAD_ATTRIB_NPTH)
            on = [i for i, ly in enumerate(LAYERS)
                  if thru or p.GetLayerSet().Contains(ly)]
            if p.GetNetname() == netname:
                for i in on:
                    gr.rect(own[i], x0, y0, x1, y1, -gr.g)
            else:
                for i in on:
                    tmp = np.zeros_like(free[i])
                    gr.rect(tmp, x0, y0, x1, y1, clear + half)
                    free[i] &= ~tmp

    for z in b.Zones():
        if not z.GetIsRuleArea():
            continue                      # pours are laid afterwards and retreat, not walls
        bb = z.GetBoundingBox()
        for i, ly in enumerate(LAYERS):
            if z.IsOnLayer(ly) and (z.GetDoNotAllowTracks() or z.GetDoNotAllowVias()):
                tmp = np.zeros_like(free[i])
                gr.rect(tmp, pcbnew.ToMM(bb.GetLeft()), pcbnew.ToMM(bb.GetTop()),
                        pcbnew.ToMM(bb.GetRight()), pcbnew.ToMM(bb.GetBottom()), half)
                free[i] &= ~tmp

    for i in range(len(LAYERS)):
        free[i] |= own[i]                 # own copper is always enterable
    return free, own


def groups(b, gr, own, netname):
    """Split what is already on the net into connected groups; we join group 0 to the rest."""
    seen = np.zeros((len(LAYERS), gr.ny, gr.nx), np.int32)
    stack, gid = [], 0
    out = []
    for i in range(len(LAYERS)):
        rs, cs = np.nonzero(own[i])
        for r, c in zip(rs, cs):
            if seen[i, r, c]:
                continue
            gid += 1
            cells = []
            stack = [(i, r, c)]
            seen[i, r, c] = gid
            while stack:
                li, rr, cc = stack.pop()
                cells.append((li, rr, cc))
                for dl, dr, dc in ((0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1), (1, 0, 0)):
                    nl = li ^ dl
                    nr, nc = rr + dr, cc + dc
                    if not (0 <= nr < gr.ny and 0 <= nc < gr.nx):
                        continue
                    if own[nl][nr, nc] and not seen[nl, nr, nc]:
                        seen[nl, nr, nc] = gid
                        stack.append((nl, nr, nc))
            out.append(cells)
    return sorted(out, key=len, reverse=True)


def wave(gr, free, start, target):
    """Dijkstra from `start` until it touches `target`. One cell of track costs 1, a via
    costs VIA_COST.

    Two edge weights, so a plain breadth-first front is not enough. Cells due at step s are
    parked in a ring of bit maps VIA_COST+1 deep: a sideways move lands in the next slot, a
    layer change lands VIA_COST slots ahead. Allowing the layer change only every Nth step
    instead, which is the obvious shortcut, is not the same thing at all - it does not price
    the via, it forbids it at the moment it is wanted, and a run that should have crossed
    once came out 35 mm long with the same four vias as the 11.8 mm one.
    """
    dist = np.full((len(LAYERS), gr.ny, gr.nx), -1, np.int32)
    ring = [[np.zeros((gr.ny, gr.nx), bool) for _ in LAYERS]
            for _ in range(VIA_COST + 1)]
    for li, r, c in start:
        ring[0][li][r, c] = True
    tgt = np.zeros((len(LAYERS), gr.ny, gr.nx), bool)
    for li, r, c in target:
        tgt[li, r, c] = True

    step, idle = 0, 0
    while idle <= VIA_COST:
        slot = ring[step % (VIA_COST + 1)]
        cur = []
        for i in range(len(LAYERS)):
            n = slot[i] & free[i] & (dist[i] < 0)
            dist[i][n] = step
            cur.append(n)
            slot[i][:] = False
        if any(c.any() for c in cur):
            idle = 0
            if any((cur[i] & tgt[i]).any() for i in range(len(LAYERS))):
                return dist, step
            side = ring[(step + 1) % (VIA_COST + 1)]
            over = ring[(step + VIA_COST) % (VIA_COST + 1)]
            for i in range(len(LAYERS)):
                a = cur[i]
                side[i][1:, :] |= a[:-1, :]
                side[i][:-1, :] |= a[1:, :]
                side[i][:, 1:] |= a[:, :-1]
                side[i][:, :-1] |= a[:, 1:]
                over[i ^ 1] |= a
        else:
            idle += 1
        step += 1
    return None, step


def smooth(gr, free, path):
    """Pull the staircase straight: keep only the corners a straight run cannot skip.

    A grid wavefront can only go north/south/east/west, so a diagonal comes back as hundreds
    of 0.2 mm steps - one +3V3 run was 141 segments over 50 mm. Electrically it is the same
    copper and no fab minds, but it is not something to ship. So the path is walked and each
    point is joined to the furthest later point whose straight line stays inside the free
    cells of that layer, which is the usual string-pulling and gives back a handful of
    segments. Layer changes are hard stops: a via is a corner by definition.
    """
    out = [path[0]]
    i = 0
    while i < len(path) - 1:
        best = i + 1
        for j in range(len(path) - 1, i, -1):
            if path[j][0] != path[i][0]:
                continue
            if any(path[k][0] != path[i][0] for k in range(i, j + 1)):
                continue                      # a via lies in between, cannot cut across it
            li, r0, c0 = path[i]
            _l, r1, c1 = path[j]
            n = max(abs(r1 - r0), abs(c1 - c0))
            ok = True
            for s in range(n + 1):
                r = int(round(r0 + (r1 - r0) * s / n))
                c = int(round(c0 + (c1 - c0) * s / n))
                if not free[li][r, c]:
                    ok = False
                    break
            if ok:
                best = j
                break
        out.append(path[best])
        i = best
    return out


def backtrace(gr, dist, hit):
    li, r, c = hit
    path = [(li, r, c)]
    d = dist[li, r, c]
    while d > 0:
        # the predecessor's cost is exactly d-1 sideways and d-VIA_COST through a via.
        # "any smaller value" looks like it works and does not: it will happily step to the
        # other layer for a saving of one, which counts a via that the wavefront never paid
        # for, so the path comes back with more vias than it actually needs.
        cands = [(li, r - 1, c, d - 1), (li, r + 1, c, d - 1),
                 (li, r, c - 1, d - 1), (li, r, c + 1, d - 1),
                 (li ^ 1, r, c, d - VIA_COST)]
        for nl, nr, nc, want in cands:
            if want < 0 or not (0 <= nr < gr.ny and 0 <= nc < gr.nx):
                continue
            if dist[nl, nr, nc] == want:
                li, r, c, d = nl, nr, nc, want
                path.append((li, r, c))
                break
        else:
            return None
    return path[::-1]


def main():
    netname = sys.argv[sys.argv.index("--net") + 1]
    grid = float(sys.argv[sys.argv.index("--grid") + 1]) if "--grid" in sys.argv else GRID

    b = pcbnew.LoadBoard(BOARD)
    net = b.FindNet(netname)
    if net is None:
        sys.exit(f"Netz {netname} gibt es nicht")
    (width, clear), cls = netclass_of(b, net)
    gr = Grid(b, grid)
    print(f"{netname}: Klasse {cls}, {width:.2f} mm breit, {clear:.2f} mm Abstand, "
          f"Raster {grid} mm ({gr.nx} x {gr.ny})")

    free, own = build(b, gr, netname, width, clear)
    gs = groups(b, gr, own, netname)
    if len(gs) < 2:
        print("  schon zusammenhaengend, nichts zu tun")
        return 0
    print(f"  {len(gs)} getrennte Gruppen, groesste {len(gs[0])} Zellen")

    laid = 0
    while len(gs) > 1:
        if laid > 40:
            print("  ueber 40 Verbindungen fuer ein Netz, das kann nicht stimmen, Abbruch")
            return 1
        start = gs[0]
        target = [c for g in gs[1:] for c in g]
        dist, step = wave(gr, free, start, target)
        if dist is None:
            print(f"  kein Weg auf {gr.g:.2f} mm Raster (Front nach {step} Schritten "
                  f"erschoepft)")
            return 2                       # der Aufrufer darf es feiner versuchen
        hit = next((li, r, c) for li, r, c in target if dist[li, r, c] >= 0)
        path = backtrace(gr, dist, hit)
        if path is None:
            print("  Rueckverfolgung fehlgeschlagen")
            return 1

        traced = path                    # every cell, for marking the net as covered
        path = smooth(gr, free, path)    # corners only, for the copper
        # cells -> segments, one per straight run, with a via wherever the layer changes
        pts = [(p[0],) + gr.mm(p[1], p[2]) for p in path]
        runs = []
        for (la, xa, ya), (lb, xb, yb) in zip(pts, pts[1:]):
            if la != lb:
                runs.append(("via", xa, ya, xa, ya))
            elif abs(xa - xb) > 1e-9 or abs(ya - yb) > 1e-9:
                runs.append((la, xa, ya, xb, yb))

        if "--dry-run" not in sys.argv:
            for r in runs:
                if r[0] == "via":
                    v = pcbnew.PCB_VIA(b)
                    v.SetViaType(pcbnew.VIATYPE_THROUGH)
                    v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
                    v.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(r[1]), pcbnew.FromMM(r[2])))
                    v.SetWidth(pcbnew.FromMM(VIA_SIZE))
                    v.SetDrill(pcbnew.FromMM(VIA_DRILL))
                    v.SetNet(net)
                    v.SetLocked(True)
                    b.Add(v)
                    continue
                li, x0, y0, x1, y1 = r
                if abs(x0 - x1) < 1e-9 and abs(y0 - y1) < 1e-9:
                    continue
                t = pcbnew.PCB_TRACK(b)
                t.SetStart(pcbnew.VECTOR2I(pcbnew.FromMM(x0), pcbnew.FromMM(y0)))
                t.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(x1), pcbnew.FromMM(y1)))
                t.SetWidth(pcbnew.FromMM(width))
                t.SetLayer(LAYERS[li])
                t.SetNet(net)
                t.SetLocked(True)
                b.Add(t)
        length = sum(((r[3] - r[1]) ** 2 + (r[4] - r[2]) ** 2) ** 0.5
                     for r in runs if r[0] != "via")
        vias = sum(1 for r in runs if r[0] == "via")
        laid += 1
        print(f"  Verbindung {laid}: {length:.1f} mm, {vias} Via(s), "
              f"{len([r for r in runs if r[0] != 'via'])} Segmente")
        # mark the TRACED cells, not the smoothed corners. Smoothing throws away everything
        # between them, so marking the corners leaves the two groups still looking separate
        # and the same connection gets laid again, and again: one run reached 5036 copies of
        # an identical 17.4 mm track before it was stopped.
        for li, r, c in traced:
            own[li][r, c] = True
        gs = groups(b, gr, own, netname)

    if "--dry-run" not in sys.argv:
        pcbnew.SaveBoard(BOARD, b)
        print(f"{laid} Verbindung(en) gelegt und gesperrt, gespeichert")
    return 0


if __name__ == "__main__":
    sys.exit(main())
