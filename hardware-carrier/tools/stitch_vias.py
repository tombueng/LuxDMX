#!/usr/bin/env python3
"""Sew the front and back pours of a power net together with a grid of vias.

Two pours on different layers are only connected where a through-hole pad happens to land in
both, so all the current has to funnel through a handful of terminal pins. A via grid over
the area where both layers actually carry the net turns them into one conductor.

Every candidate is clearance-checked before it is placed. A first version dropped vias on a
blind 4 mm grid and produced 30 clearance violations plus 2 hole-to-hole; a via is 1.0 mm of
copper around a 0.5 mm drill and the bottom of this board has very little slack.

Three subprocesses, because pcbnew segfaults on a second board object in the same
interpreter and on ZONE_FILLER being constructed twice.

Run:  python hardware-carrier/stitch_vias.py [--pitch 4.0]
"""
import json
import math
import os
import re
import subprocess
import sys
import tempfile

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
PTS = os.path.join(tempfile.gettempdir(), "carrier-stitch-pts.json")

NETS = ["V_PIX", "V_PIX_IN", "GND"]
DRILL, DIA = 0.5, 1.0
CLEAR = 0.30          # Power netclass
HOLE2HOLE = 0.25      # fab minimum between drill edges


def stage_compute(pitch):
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    polys = {}
    for z in b.Zones():
        for ly in (pcbnew.F_Cu, pcbnew.B_Cu):
            if z.IsOnLayer(ly) and z.GetNetname() in NETS:
                polys.setdefault((z.GetNetname(), ly), []).append(z.GetFilledPolysList(ly))

    pads, holes, tracks, vias = [], [], [], []
    for f in b.GetFootprints():
        for p in f.Pads():
            q = p.GetPosition()
            x, y = pcbnew.ToMM(q.x), pcbnew.ToMM(q.y)
            s = p.GetSize()
            # half the DIAGONAL, not half the longest edge: a 1.30 x 1.75 pad reaches
            # 1.09 mm into its corners, and using 0.875 let two vias through that KiCad
            # then flagged at 0.17 mm
            r = math.hypot(pcbnew.ToMM(s.x), pcbnew.ToMM(s.y)) / 2
            pads.append((p.GetNetname(), x, y, r))
            d = pcbnew.ToMM(p.GetDrillSizeX())
            if d > 0:
                holes.append((x, y, d / 2))
    for t in b.GetTracks():
        if t.GetClass() == "PCB_VIA":
            q = t.GetPosition()
            vias.append((t.GetNetname(), pcbnew.ToMM(q.x), pcbnew.ToMM(q.y),
                         pcbnew.ToMM(t.GetWidth()) / 2, pcbnew.ToMM(t.GetDrill()) / 2))
        else:
            a, c = t.GetStart(), t.GetEnd()
            tracks.append((t.GetNetname(), pcbnew.ToMM(a.x), pcbnew.ToMM(a.y),
                           pcbnew.ToMM(c.x), pcbnew.ToMM(c.y),
                           pcbnew.ToMM(t.GetWidth()) / 2))

    e = [s for s in b.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts]
    xs = [pcbnew.ToMM(v) for s in e for v in (s.GetStart().x, s.GetEnd().x)]
    ys = [pcbnew.ToMM(v) for s in e for v in (s.GetStart().y, s.GetEnd().y)]

    def seg_dist(px, py, x1, y1, x2, y2):
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / L2))
        return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))

    def ok(net, x, y):
        if min(x - min(xs), max(xs) - x, y - min(ys), max(ys) - y) < DIA / 2 + 0.5:
            return False
        for n, px, py, r in pads:
            if n != net and math.hypot(x - px, y - py) < DIA / 2 + r + CLEAR:
                return False
        for px, py, hr in holes:                       # hole-to-hole ignores nets
            if math.hypot(x - px, y - py) < DRILL / 2 + hr + HOLE2HOLE:
                return False
        for n, x1, y1, x2, y2, hw in tracks:
            if n != net and seg_dist(x, y, x1, y1, x2, y2) < DIA / 2 + hw + CLEAR:
                return False
        for n, px, py, vr, hr in vias:
            d = math.hypot(x - px, y - py)
            if d < DRILL / 2 + hr + HOLE2HOLE:
                return False
            if n != net and d < DIA / 2 + vr + CLEAR:
                return False
        return True

    out, skipped = [], 0
    for net in NETS:
        f = polys.get((net, pcbnew.F_Cu), [])
        bk = polys.get((net, pcbnew.B_Cu), [])
        if not f or not bk:
            continue
        y = min(ys) + pitch
        while y < max(ys):
            x = min(xs) + pitch
            while x < max(xs):
                v = pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y))
                if any(p.Contains(v) for p in f) and any(p.Contains(v) for p in bk):
                    if ok(net, x, y):
                        out.append([net, round(x, 3), round(y, 3)])
                        vias.append((net, x, y, DIA / 2, DRILL / 2))
                    else:
                        skipped += 1
                x += pitch
            y += pitch
    json.dump(out, open(PTS, "w"))
    print(f"\n@@RESULT {len(out)} {skipped}", flush=True)


def stage_clear():
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    n = 0
    for t in list(b.GetTracks()):
        # Only ours. "Every locked via" was the old rule and it is too greedy now that
        # tools/hand_route.py finishes signal nets by hand and locks what it lays: this quietly
        # deleted the two vias of a DMX3_A run and left the net split across the layers, with
        # nothing in the log to say so.
        if t.GetClass() == "PCB_VIA" and t.IsLocked() and t.GetNetname() in NETS:
            b.Remove(t)
            n += 1
    pcbnew.SaveBoard(BOARD, b)
    print(f"\n@@RESULT {n}", flush=True)


def stage_write():
    import pcbnew
    pts = json.load(open(PTS))
    b = pcbnew.LoadBoard(BOARD)
    for net, x, y in pts:
        v = pcbnew.PCB_VIA(b)
        # without these two the via has no layer pair and SaveBoard takes the process down
        v.SetViaType(pcbnew.VIATYPE_THROUGH)
        v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
        v.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y)))
        v.SetDrill(pcbnew.FromMM(DRILL))
        v.SetWidth(pcbnew.FromMM(DIA))
        v.SetNet(b.FindNet(net))
        v.SetLocked(True)          # so a re-route does not rip them out
        b.Add(v)
    pcbnew.SaveBoard(BOARD, b)
    print(f"\n@@RESULT {len(pts)}", flush=True)


def stage_fill():
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    pcbnew.ZONE_FILLER(b).Fill(b.Zones())
    pcbnew.SaveBoard(BOARD, b)
    print("\n@@RESULT ok", flush=True)


def sub(*a):
    r = subprocess.run([sys.executable, os.path.abspath(__file__), "--stage", *a],
                       capture_output=True, text=True)
    # KiCad's leak tracker prints without a newline and glues itself onto our output
    m = re.search(r"@@RESULT ([^\n]*)", r.stdout)
    if not m:
        raise RuntimeError(f"Stage {a[0]}:\n{r.stdout[-600:]}\n{r.stderr[-400:]}")
    return m.group(1).split()


def main():
    if "--stage" in sys.argv:
        i = sys.argv.index("--stage")
        name = sys.argv[i + 1]
        return {"compute": lambda: stage_compute(float(sys.argv[i + 2])),
                "clear": stage_clear, "write": stage_write, "fill": stage_fill}[name]()

    pitch = float(sys.argv[sys.argv.index("--pitch") + 1]) if "--pitch" in sys.argv else 4.0
    print(f"alte Naehvias entfernt: {sub('clear')[0]}")
    n, skipped = sub("compute", str(pitch))
    print(f"Raster {pitch} mm: {n} Vias gesetzt, {skipped} wegen Abstand verworfen")
    sub("write")
    sub("fill")
    print("Zonen neu gefuellt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
