"""Two targeted touch-ups (does NOT touch other silk, incl. the LED legend):
  1. raise the top Edge.Cuts 0.7mm so the EN trace that hugs it clears the 0.5mm edge rule;
  2. add per-pin SH / D- / D+ pinout labels at J7 and J8 (vertical, to fit the 1mm pitch).
KiCad 10. Idempotent for the J7/J8 pin labels."""
import pcbnew
PCB = r"C:\dev\DMX\hardware\lumigate.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
b = pcbnew.LoadBoard(PCB)
PINOUT = {"1": "SH", "2": "D-", "3": "D+"}

# 1) read J7/J8 pad geometry up-front (before any board mutation)
labels = []   # (text, x, y)
for ref in ("J7", "J8"):
    f = b.FindFootprintByReference(ref)
    if not f: continue
    pads = {p.GetNumber(): p.GetPosition() for p in f.Pads()}
    # pads sit on one side of the connector; put labels just past them on the cable-entry side
    ys = [TM(pads[n].y) for n in PINOUT if n in pads]
    above = (min(ys) < TM(f.GetPosition().y))          # pads above the body -> label above the pads
    for n, fn in PINOUT.items():
        if n in pads:
            q = pads[n]; labels.append((fn, TM(q.x), TM(q.y) + (-1.4 if above else 1.4)))

drawings = list(b.GetDrawings())                        # materialise once before mutating

# 2) raise the top edge to y=90.0 (clears the EN trace at ~91.1); absolute -> idempotent
for d in drawings:
    if d.GetLayer() == pcbnew.Edge_Cuts and d.GetShape() == pcbnew.SHAPE_T_SEGMENT:
        for setter, getter in (("SetStart", "GetStart"), ("SetEnd", "GetEnd")):
            pt = getattr(d, getter)()
            if TM(pt.y) < 91.0:                         # top-edge endpoints (~90.7)
                getattr(d, setter)(pcbnew.VECTOR2I(pt.x, FM(90.0)))
print("top edge -> 90.0")

# 3) idempotent: drop existing J7/J8 pin labels (SH/D-/D+ in that region), then add fresh
for d in drawings:
    if isinstance(d, pcbnew.PCB_TEXT) and d.GetText() in ("SH", "D-", "D+"):
        p = d.GetPosition()
        if 165 < TM(p.x) < 180 and 108 < TM(p.y) < 152:
            b.Remove(d)
for s, x, y in labels:
    t = pcbnew.PCB_TEXT(b); t.SetText(s); t.SetLayer(pcbnew.F_SilkS)
    t.SetPosition(pcbnew.VECTOR2I(FM(x), FM(y)))
    t.SetTextHeight(FM(0.8)); t.SetTextWidth(FM(0.6)); t.SetTextThickness(FM(0.12))
    t.SetHorizJustify(pcbnew.GR_TEXT_H_ALIGN_CENTER); t.SetTextAngleDegrees(90)
    b.Add(t)

pcbnew.SaveBoard(PCB, b)
print(f"added {len(labels)} J7/J8 pin labels (SH/D-/D+)")
