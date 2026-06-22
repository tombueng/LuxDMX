"""Redraw the Edge.Cuts outline to fit the current (manually packed) placement and re-place the 4
corner M3 mounting holes. The outline = all-pad bbox + margins; edge-connector cable fronts (RJ45
left, XLR barrels right, USB-C bottom) deliberately overhang the edge for flush panel mounting.
Mounting holes go at the new corners (inset), grid-searched inward to clear any part body (the ESP32
RF keepout is ignored -- an NPTH hole may sit there). KiCad 10 python.

NB: all footprint geometry is read up-front, because re-reading footprints after a board edit
(remove/add drawings) returns raw SwigPyObjects."""
import pcbnew
PCB = r"C:\dev\DMX\hardware\lumigate.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
MARGIN = 1.5
INSET = 5.0
b = pcbnew.LoadBoard(PCB)

# ---- gather ALL footprint geometry first (ref, pad-bbox, courtyard-bbox) ----
DATA = []
for f in b.GetFootprints():
    ref = f.GetReference()
    pads = list(f.Pads())
    pb = None
    if pads:
        L = min(p.GetBoundingBox().GetLeft() for p in pads); T = min(p.GetBoundingBox().GetTop() for p in pads)
        R = max(p.GetBoundingBox().GetRight() for p in pads); B = max(p.GetBoundingBox().GetBottom() for p in pads)
        pb = [TM(L), TM(T), TM(R), TM(B)]
    r = f.GetCourtyard(pcbnew.F_CrtYd).BBox()
    cb = [TM(r.GetLeft()), TM(r.GetTop()), TM(r.GetRight()), TM(r.GetBottom())] if r.GetWidth() else None
    DATA.append((ref, pb, cb))

allpad = [pb for (ref, pb, cb) in DATA if pb]
X0 = round(min(pb[0] for pb in allpad) - MARGIN, 1); X1 = round(max(pb[2] for pb in allpad) + MARGIN, 1)
Y0 = round(min(pb[1] for pb in allpad) - MARGIN, 1); Y1 = round(max(pb[3] for pb in allpad) + MARGIN, 1)
print(f"new outline: x {X0}..{X1} ({X1-X0:.1f}mm)  y {Y0}..{Y1} ({Y1-Y0:.1f}mm)")

# body box for collision: courtyard, but pad-span for the ESP32 (its courtyard is the RF keepout)
def bodybox(ref, pb, cb):
    if ref == "U1" and pb: return pb
    return cb if cb else pb
OCC = [bb for (ref, pb, cb) in DATA if not ref.startswith("MH") and (bb := bodybox(ref, pb, cb))]

# ---- re-place the 4 mounting holes FIRST (footprints stay valid until we edit the board graphics) ----
def clear(cx, cy, rad=2.7):
    if not (X0+rad <= cx <= X1-rad and Y0+rad <= cy <= Y1-rad): return False
    bx = [cx-rad, cy-rad, cx+rad, cy+rad]
    return not any(not (bx[2]+0.3 < o[0] or o[2]+0.3 < bx[0] or bx[3]+0.3 < o[1] or o[3]+0.3 < bx[1]) for o in OCC)

targets = {"MH1": (X0+INSET, Y0+INSET, 1, 1), "MH2": (X1-INSET, Y0+INSET, -1, 1),
           "MH3": (X0+INSET, Y1-INSET, 1, -1), "MH4": (X1-INSET, Y1-INSET, -1, -1)}
for ref, (tx, ty, sx, sy) in targets.items():
    f = b.FindFootprintByReference(ref)
    if not f: print(f"  ?? {ref} missing"); continue
    best = None; bestd = 1e9
    for ix in range(0, 30):
        for iy in range(0, 30):
            cx, cy = tx + sx*ix*0.7, ty + sy*iy*0.7
            if clear(cx, cy):
                d = ix*ix + iy*iy
                if d < bestd: bestd = d; best = (cx, cy)
    if best:
        f.SetPosition(pcbnew.VECTOR2I(FM(best[0]), FM(best[1])))
        print(f"  {ref} -> ({best[0]:.1f},{best[1]:.1f})")
    else:
        print(f"  !! {ref}: no clear spot in corner quadrant")

# ---- now replace Edge.Cuts with a fresh rectangle (do this LAST -- it invalidates footprint wrappers) ----
for d in list(b.GetDrawings()):
    if d.GetLayer() == pcbnew.Edge_Cuts:
        b.Remove(d)
corners = [(X0, Y0), (X1, Y0), (X1, Y1), (X0, Y1), (X0, Y0)]
for (x0, y0), (x1, y1) in zip(corners, corners[1:]):
    seg = pcbnew.PCB_SHAPE(b); seg.SetShape(pcbnew.SHAPE_T_SEGMENT); seg.SetLayer(pcbnew.Edge_Cuts)
    seg.SetStart(pcbnew.VECTOR2I(FM(x0), FM(y0))); seg.SetEnd(pcbnew.VECTOR2I(FM(x1), FM(y1)))
    seg.SetWidth(FM(0.1)); b.Add(seg)

pcbnew.SaveBoard(PCB, b)
print("outline + mounting holes updated")
