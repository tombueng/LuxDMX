#!/usr/bin/env python3
"""Move the lone GND stitching via next to Button 1's pad 2 hole 0.15 mm further out.

Drill wall to drill wall it was 0.318 mm from the 1.10 mm pad hole; JLCPCB's hole-to-hole
minimum is 0.45 mm. The via has no tracks (it only stitches the two GND pours), so it moves
along the line away from the pad to 0.45+ mm and the zones are refilled. Found by exact
position, not by radius. Idempotent: does nothing once the via has moved.

Run:  python tools/nudge_button_via.py
"""
import math
import os
import sys

import pcbnew

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARD = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")
OLD = (182.5, 124.0)
PAD = (183.0, 123.0)
STEP = 0.15


def main():
    b = pcbnew.LoadBoard(BOARD)
    vias = [t for t in b.GetTracks() if t.Type() == pcbnew.PCB_VIA_T and t.GetNetname() == "GND"
            and abs(pcbnew.ToMM(t.GetPosition().x) - OLD[0]) < 0.005
            and abs(pcbnew.ToMM(t.GetPosition().y) - OLD[1]) < 0.005]
    if not vias:
        print("already moved")
        return 0
    dx, dy = OLD[0] - PAD[0], OLD[1] - PAD[1]
    d = math.hypot(dx, dy)
    nx, ny = OLD[0] + dx / d * STEP, OLD[1] + dy / d * STEP
    v = vias[0]
    v.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(nx), pcbnew.FromMM(ny)))
    pcbnew.ZONE_FILLER(b).Fill(b.Zones())
    pcbnew.SaveBoard(BOARD, b)
    print(f"via {OLD} -> ({nx:.3f}, {ny:.3f}), centre distance {d + STEP:.3f} mm")
    return 0


if __name__ == "__main__":
    sys.exit(main())
