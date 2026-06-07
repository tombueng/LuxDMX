#!/usr/bin/env python
"""Shrink the board outline to fit all solder pads (+ margin) after manual placement.
The connector openings/bodies that overhang are fine — we only fit to PADS.

Run AFTER manually placing all footprints and BEFORE routing:
  "C:\\Program Files\\KiCad\\10.0\\bin\\python.exe" shrink_board.py

Then re-run optimize.py (or route manually).
"""
import pcbnew, os
HERE = os.path.dirname(os.path.abspath(__file__))
BOARD = os.path.join(HERE, 'lumigate_carrier.kicad_pcb')
MARGIN = 2.0  # mm around the outermost pads (covers the ~28mm module body snugly)

b = pcbnew.LoadBoard(BOARD)
mm = pcbnew.ToMM

# Fit to PAD positions (electrically meaningful extent) + margin. The module body
# (~28mm) overhangs the pads by ~1.3mm each side; 2mm margin keeps it on the board.
xs, ys = [], []
for fp in b.GetFootprints():
    for pad in fp.Pads():
        p = pad.GetPosition()
        xs.append(mm(p.x)); ys.append(mm(p.y))
if not xs:
    print("No pads found — is the board saved?"); exit(1)

x1, y1 = min(xs) - MARGIN, min(ys) - MARGIN
x2, y2 = max(xs) + MARGIN, max(ys) + MARGIN
print(f"Pads span: x[{min(xs):.1f}..{max(xs):.1f}] y[{min(ys):.1f}..{max(ys):.1f}]")
print(f"New board outline: ({x1:.1f},{y1:.1f}) -> ({x2:.1f},{y2:.1f})  = {x2-x1:.1f} x {y2-y1:.1f} mm")

# Remove existing Edge.Cuts shapes
for s in [s for s in b.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts]:
    b.Remove(s)

# Draw new outline
rect = pcbnew.PCB_SHAPE(b); rect.SetShape(pcbnew.SHAPE_T_RECT)
rect.SetStart(pcbnew.VECTOR2I(pcbnew.FromMM(x1), pcbnew.FromMM(y1)))
rect.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(x2), pcbnew.FromMM(y2)))
rect.SetLayer(pcbnew.Edge_Cuts); rect.SetWidth(pcbnew.FromMM(0.15))
b.Add(rect)
pcbnew.SaveBoard(BOARD, b)
print("Saved. Open KiCad and reload ('Extern geändert? -> Neu laden').")
print("Then check that J2 opening overhangs the left edge as intended.")
