#!/usr/bin/env python3
"""Open the KF128 screw-terminal holes from 1.30 to 1.40 mm, on the board and in the library.

Kefa's KF128-5.08 drawing has 0.90 x 0.80 mm pins (1.20 mm across the corners) and asks for a
1.40 +0.10/-0 mm hole; JLC's own footprint for C474952/C474953 uses 1.40 too. A 1.30 mm
plated hole at the low end of the fab tolerance leaves 0.02 mm on the diagonal: a force fit.
The pads (4.80 x 6.15, DATA 2.00 x 6.15) keep 1.7 mm / 0.3 mm of ring, so only the drill
changes; pad copper, positions and tracks stay as they are.

Idempotent. Run:  python tools/terminal_drill.py   then refill nothing (pads keep their size),
re-run DRC.
"""
import glob
import os
import re
import sys

import pcbnew

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARD = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")
FPS = ("terminal-1x02-P5.08-bigpad", "terminal-1x03-P5.08-bigpad")
OLD, NEW = 1.30, 1.40


def main():
    for name in FPS:
        for p in glob.glob(os.path.join(HERE, "footprints", "*.pretty", name + ".kicad_mod")):
            s = open(p).read()
            t = re.sub(r"\(drill 1\.30?\b", f"(drill {NEW:.2f}", s)
            if t != s:
                open(p, "w").write(t)
                print(f"  {os.path.relpath(p, HERE)}: drill {OLD} -> {NEW}")
    b = pcbnew.LoadBoard(BOARD)
    n = 0
    for f in b.GetFootprints():
        if f.GetFPID().GetLibItemName() not in FPS:
            continue
        for pad in f.Pads():
            d = pad.GetDrillSize()
            if abs(pcbnew.ToMM(d.x) - OLD) < 0.01:
                pad.SetDrillSize(pcbnew.VECTOR2I(pcbnew.FromMM(NEW), pcbnew.FromMM(NEW)))
                n += 1
    pcbnew.SaveBoard(BOARD, b)
    print(f"  board: {n} pads drilled {NEW} mm")
    return 0


if __name__ == "__main__":
    sys.exit(main())
