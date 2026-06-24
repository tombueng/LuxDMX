"""Set a clean rectangular Edge.Cuts and place the 4 M3 mounting holes at a UNIFORM inset so all four
sit the same distance from the edges AND form a round hole-spacing rectangle (default 90 x 70 mm).

Board = SX+2*INSET wide, SY+2*INSET tall, anchored to keep the right (XLR) + bottom (USB-C) faces flush
with the current outline. Holes at the 4 symmetric inset corners; clearance-checked against part bodies
(the ESP32 U1 RF-keepout corner is allowed -- an NPTH hole there is the known waiver). KiCad 10 python."""
import pcbnew
PCB = r"C:\dev\DMX\hardware\lumigate.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
SX, SY, INSET = 90.0, 70.0, 4.5            # hole-to-hole spacing X/Y, uniform edge inset
W, H = SX + 2*INSET, SY + 2*INSET          # 99 x 79
b = pcbnew.LoadBoard(PCB)

# gather geometry up-front (re-reading after edge edit returns stale SWIG wrappers)
DATA = []
allpad = []
for f in b.GetFootprints():
    ref = f.GetReference()
    pads = list(f.Pads())
    pb = None
    if pads:
        L = min(p.GetBoundingBox().GetLeft() for p in pads); T = min(p.GetBoundingBox().GetTop() for p in pads)
        R = max(p.GetBoundingBox().GetRight() for p in pads); B = max(p.GetBoundingBox().GetBottom() for p in pads)
        pb = [TM(L), TM(T), TM(R), TM(B)]; allpad.append(pb)
    r = f.GetCourtyard(pcbnew.F_CrtYd).BBox()
    cb = [TM(r.GetLeft()), TM(r.GetTop()), TM(r.GetRight()), TM(r.GetBottom())] if r.GetWidth() else None
    DATA.append((ref, pb, cb))

PX0 = min(p[0] for p in allpad); PY0 = min(p[1] for p in allpad)
PX1 = max(p[2] for p in allpad); PY1 = max(p[3] for p in allpad)

# anchor right + bottom to the current edge (keep XLR / USB-C panel faces flush), grow left/top
ec = [d for d in b.GetDrawings() if d.GetLayer() == pcbnew.Edge_Cuts]
cxs = [TM(d.GetBoundingBox().GetRight()) for d in ec]; cys = [TM(d.GetBoundingBox().GetBottom()) for d in ec]
X1 = round(max(cxs), 2); Y1 = round(max(cys), 2)
X0 = round(X1 - W, 2); Y0 = round(Y1 - H, 2)
print(f"outline: x {X0}..{X1} (W={W})  y {Y0}..{Y1} (H={H})")
assert X0 <= PX0 - 1.0 and Y0 <= PY0 - 1.0 and X1 >= PX1 - 0.1 and Y1 >= PY1 - 0.1, \
    f"parts don't fit: pads x{PX0:.1f}..{PX1:.1f} y{PY0:.1f}..{PY1:.1f}"

# clearance of a hole vs part bodies (ESP32 keepout corner allowed)
def bodybox(ref, pb, cb):
    if ref == "U1" and pb: return pb            # ESP32: use pad-span (its courtyard is the RF keepout)
    return cb if cb else pb
OCC = [(ref, bb) for (ref, pb, cb) in DATA if not ref.startswith("MH") and (bb := bodybox(ref, pb, cb))]
def hole_clear(cx, cy, rad=2.7, gap=0.3):
    bx = [cx-rad, cy-rad, cx+rad, cy+rad]
    hits = [ref for (ref, o) in OCC if not (bx[2]+gap < o[0] or o[2]+gap < bx[0] or bx[3]+gap < o[1] or o[3]+gap < bx[1])]
    return hits

holes = {"MH1": (X0+INSET, Y0+INSET), "MH2": (X1-INSET, Y0+INSET),
         "MH3": (X0+INSET, Y1-INSET), "MH4": (X1-INSET, Y1-INSET)}
print(f"hole spacing: {SX} x {SY} mm, uniform inset {INSET} mm")
for ref, (cx, cy) in holes.items():
    f = b.FindFootprintByReference(ref)
    if not f: print(f"  ?? {ref} missing"); continue
    f.SetPosition(pcbnew.VECTOR2I(FM(cx), FM(cy)))
    hits = hole_clear(cx, cy)
    flag = "" if not hits else ("  <-- in " + ",".join(hits) + (" (RF-keepout waiver OK)" if hits == ["U1"] else " !! COLLISION"))
    print(f"  {ref} -> ({cx:.2f},{cy:.2f}){flag}")

# redraw Edge.Cuts rectangle LAST (invalidates footprint wrappers)
for d in list(b.GetDrawings()):
    if d.GetLayer() == pcbnew.Edge_Cuts:
        b.Remove(d)
corners = [(X0, Y0), (X1, Y0), (X1, Y1), (X0, Y1), (X0, Y0)]
for (x0, y0), (x1, y1) in zip(corners, corners[1:]):
    seg = pcbnew.PCB_SHAPE(b); seg.SetShape(pcbnew.SHAPE_T_SEGMENT); seg.SetLayer(pcbnew.Edge_Cuts)
    seg.SetStart(pcbnew.VECTOR2I(FM(x0), FM(y0))); seg.SetEnd(pcbnew.VECTOR2I(FM(x1), FM(y1)))
    seg.SetWidth(FM(0.1)); b.Add(seg)

pcbnew.SaveBoard(PCB, b)
print("outline + symmetric mounting holes updated")
