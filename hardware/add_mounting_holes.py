"""Add 4 corner M3 (3.2mm NPTH) mounting holes, inset from the board edges.
Idempotent: removes any existing MH1..MH4 first. Run with KiCad 10 bundled python."""
import pcbnew, os

HERE = os.path.dirname(os.path.abspath(__file__))
PCB = os.path.join(HERE, "lumigate.kicad_pcb")
STOCK = r"C:\Program Files\KiCad\10.0\share\kicad\footprints"
MM = pcbnew.ToMM; FM = pcbnew.FromMM
INSET = 4.5   # mm from each edge to hole centre

b = pcbnew.LoadBoard(PCB)
# remove existing mounting holes
for fp in list(b.GetFootprints()):
    if fp.GetReference() in ("MH1", "MH2", "MH3", "MH4"):
        b.Remove(fp)

ec = [d for d in b.GetDrawings() if d.GetLayer() == pcbnew.Edge_Cuts]
bb = None
for d in ec:
    bb = d.GetBoundingBox() if bb is None else (bb.Merge(d.GetBoundingBox()) or bb)
L, T, R, Bt = MM(bb.GetLeft()), MM(bb.GetTop()), MM(bb.GetRight()), MM(bb.GetBottom())
pts = {"MH1": (L + INSET, T + INSET), "MH2": (R - INSET, T + INSET),
       "MH3": (L + INSET, Bt - INSET), "MH4": (R - INSET, Bt - INSET)}

libd = os.path.join(STOCK, "MountingHole.pretty")
for ref, (x, y) in pts.items():
    fp = pcbnew.FootprintLoad(libd, "MountingHole_3.2mm_M3")
    fp.SetReference(ref)
    fp.SetPosition(pcbnew.VECTOR2I(FM(x), FM(y)))
    b.Add(fp)
    print(f"  {ref} @ ({x:.2f},{y:.2f})")

pcbnew.SaveBoard(PCB, b)
print("added 4 M3 corner mounting holes")
