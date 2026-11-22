#!/usr/bin/env python3
"""Move the three DMX header rows 0.45 mm in from the top edge (rev 1.2).

The Phoenix MPT 0,5/3-2,54 peg holes sit 2.54 mm on the edge side of the pin row, so with
the row at y 59.45 the 1.10 mm peg holes were at y 56.91: 0.36 mm of board left between the
hole and the outline at y 56.00. JLCPCB mills the outline to +-0.2 mm, so that web could come
out at 0.16 mm or break out. The peg offset is the connector's, so the whole row moves:
pins to y 59.90, pegs to 57.36, which leaves 0.81 mm nominal and 0.61 mm at worst tolerance.

The pads are 3.85 mm ovals stretched inwards, and tracks run 0.3 mm past their inner ends
(the DMX3_B and GND tracks at y 62.8 .. 63.2). So the pads must not move inwards with the
row: they get 0.45 mm shorter instead, inner end still at y 62.40, outer end at 58.95.
That leaves 0.35 mm of ring outboard of the 1.20 mm hole, the same as on the sides.

Every track end that sat inside a header pad moves with it (same net, and only that end; the
far end stays where it was). Most of those ends would still be inside the moved pad anyway,
since the pads are 3.85 mm long and stretched inwards, but the GND junctions just left of pin
1 of DMX1 and DMX2 would fall off the pad's rounded end. Afterwards the script checks that
every moved end is inside its pad, and DRC checks the clearances.
The DMXn / G B A labels are footprint texts and move with the row.
Idempotent.

Run:  python tools/dmx_row_inward.py
"""
import os
import sys

import pcbnew

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARD = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")
FPID = "header-1x03-P2.54-terminal"
Y_OLD, Y_NEW = 59.45, 59.90
PAD_OLD = (3.85, 1.90, -1.025)            # local size x, y and drill offset x (library frame)
PAD_NEW = (3.45, 1.90, -0.775)
mm = pcbnew.ToMM


def main():
    b = pcbnew.LoadBoard(BOARD)
    rows = [f for f in b.GetFootprints() if f.GetFPIDAsString().endswith(FPID)]
    if len(rows) != 3:
        print(f"expected 3 DMX rows, found {len(rows)}")
        return 1
    if all(abs(mm(f.GetPosition().y) - Y_NEW) < 0.005 for f in rows):
        print("already moved")
        return 0
    # every track end that sits in a header pad now, by pad
    ends = []
    for f in rows:
        if abs(mm(f.GetPosition().y) - Y_OLD) > 0.005:
            print(f"{f.GetReference()} at y {mm(f.GetPosition().y)}, expected {Y_OLD}")
            return 1
        for p in f.Pads():
            if not p.GetNetname():
                continue
            for t in b.GetTracks():
                if t.Type() != pcbnew.PCB_TRACE_T or t.GetNetCode() != p.GetNetCode():
                    continue
                for q in (t.GetStart(), t.GetEnd()):
                    if p.HitTest(q) and p.IsOnLayer(t.GetLayer()):
                        ends.append((f.GetReference(), p.GetNumber(), pcbnew.VECTOR2I(q.x, q.y), t.GetLayer()))
    d = pcbnew.VECTOR2I(0, pcbnew.FromMM(Y_NEW - Y_OLD))
    for f in rows:
        f.Move(d)
        for p in f.Pads():
            if not p.GetNetname():
                continue
            L = pcbnew.F_Cu
            sx, sy = mm(p.GetSize(L).x), mm(p.GetSize(L).y)
            ox = mm(p.GetOffset(L).x)
            if (round(sx, 3), round(sy, 3), round(ox, 3)) != PAD_OLD:
                print(f"{f.GetReference()} pad {p.GetNumber()}: {sx} x {sy} offset {ox}, expected {PAD_OLD}")
                return 1
            p.SetSize(L, pcbnew.VECTOR2I(pcbnew.FromMM(PAD_NEW[0]), pcbnew.FromMM(PAD_NEW[1])))
            p.SetOffset(L, pcbnew.VECTOR2I(pcbnew.FromMM(PAD_NEW[2]), 0))
    # move the ends: every track end of the pad's net at one of the recorded points
    pts = {(q.x, q.y) for _, _, q, _ in ends}
    nets = {p.GetNetCode() for f in rows for p in f.Pads() if p.GetNetname()}
    n = 0
    for t in b.GetTracks():
        if t.Type() != pcbnew.PCB_TRACE_T or t.GetNetCode() not in nets:
            continue
        if (t.GetStart().x, t.GetStart().y) in pts:
            t.SetStart(t.GetStart() + d); n += 1
        if (t.GetEnd().x, t.GetEnd().y) in pts:
            t.SetEnd(t.GetEnd() + d); n += 1
    print(f"{n} track ends moved with their pads")
    lost = []
    for ref, num, q, layer in ends:
        q = q + d
        f = [r for r in rows if r.GetReference() == ref][0]
        p = [x for x in f.Pads() if x.GetNumber() == num][0]
        if not p.HitTest(q):
            lost.append((ref, num, mm(q.x), mm(q.y)))
    if lost:
        print("track ends that would leave their pad:", lost)
        return 1
    pcbnew.ZONE_FILLER(b).Fill(b.Zones())
    pcbnew.SaveBoard(BOARD, b)
    for f in rows:
        pegs = [mm(p.GetPosition().y) for p in f.Pads() if not p.GetNumber()]
        pb = [p.GetBoundingBox() for p in f.Pads() if p.GetNetname()]
        print(f"{f.GetReference()}: row y {mm(f.GetPosition().y):.2f}, pegs y {min(pegs):.2f}, "
              f"pads y {mm(min(x.GetTop() for x in pb)):.2f}..{mm(max(x.GetBottom() for x in pb)):.2f}, "
              f"{len(ends)} track ends still in their pads")
    return 0


if __name__ == "__main__":
    sys.exit(main())
