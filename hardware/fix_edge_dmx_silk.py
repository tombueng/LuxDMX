"""Two targeted touch-ups (does NOT touch other silk, incl. the LED legend):
  1. raise the top Edge.Cuts 0.7mm so the EN trace that hugs it clears the 0.5mm edge rule;
  2. add per-pin SH / D- / D+ pinout labels at J7 and J8 (vertical, to fit the 1mm pitch).
KiCad 10. Idempotent for the J7/J8 pin labels."""
import pcbnew
PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
b = pcbnew.LoadBoard(PCB)
PINOUT = {"1": "COM", "2": "D1-", "3": "D1+"}   # E1.11 Table 8 abbreviations (was SH/D-/D+)

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
            q = pads[n]; labels.append((fn, TM(q.x), TM(q.y) + (-1.7 if above else 1.7)))

drawings = list(b.GetDrawings())                        # materialise once before mutating

# 2) (edge-raise DISABLED 2026-06-28): the top edge sits at y=88.9 and already clears the EN trace
#    (~91.1) by 2.2mm. The old raise-to-90.0 actually pushed the edge INTO corner copper at (98,90),
#    creating 4 copper_edge_clearance errors. So we no longer touch Edge.Cuts here, only the pin labels.
print("edge-raise skipped (top edge y=88.9 already clears the EN trace)")

# 3) idempotent: drop existing J7/J8 pin labels (SH/D-/D+ in that region), then add fresh
for d in drawings:
    # these exact strings are only ever DMX-breakout pin labels -> clear board-wide (idempotent),
    # avoids stale orphans when a connector/label drifts out of a fixed region
    if isinstance(d, pcbnew.PCB_TEXT) and d.GetText() in ("SH", "D-", "D+", "COM", "D1-", "D1+"):
        b.Remove(d)
for s, x, y in labels:
    t = pcbnew.PCB_TEXT(b); t.SetText(s); t.SetLayer(pcbnew.F_SilkS)
    t.SetPosition(pcbnew.VECTOR2I(FM(x), FM(y)))
    t.SetTextHeight(FM(0.8)); t.SetTextWidth(FM(0.55)); t.SetTextThickness(FM(0.1))   # 0.8mm = fab min legible; slimmer glyphs for the 3-char COM/D1+- on 1mm pitch
    t.SetHorizJustify(pcbnew.GR_TEXT_H_ALIGN_CENTER); t.SetTextAngleDegrees(90)
    b.Add(t)

pcbnew.SaveBoard(PCB, b)
print(f"added {len(labels)} J7/J8 pin labels (COM/D1-/D1+)")
