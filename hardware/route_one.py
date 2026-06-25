"""Route ONE pad-to-pad connection that the autorouter left open, with a clearance-checked F.Cu path
(straight / L / Z), going around other-net copper. For the recurring single unrouted net in the dense
W5500 fan-out. Usage: route_one.py NET x0 y0 x1 y1   (mm). KiCad 10."""
import pcbnew, math, sys
PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
NET = sys.argv[1]; P0 = (float(sys.argv[2]), float(sys.argv[3])); P1 = (float(sys.argv[4]), float(sys.argv[5]))
b = pcbnew.LoadBoard(PCB); NC = b.FindNet(NET).GetNetCode()

pads = []; segs = []
for f in b.GetFootprints():
    for p in f.Pads():
        if p.GetNetname() != NET:
            r = p.GetBoundingBox(); pads.append((TM(r.GetLeft()), TM(r.GetTop()), TM(r.GetRight()), TM(r.GetBottom())))
for t in b.GetTracks():
    if t.GetNetname() == NET: continue
    if isinstance(t, pcbnew.PCB_VIA):
        q = t.GetPosition(); segs.append((TM(q.x), TM(q.y), TM(q.x), TM(q.y), 0.35))
    else:
        s = t.GetStart(); e = t.GetEnd(); segs.append((TM(s.x), TM(s.y), TM(e.x), TM(e.y), TM(t.GetWidth())/2))

def pt_seg(px, py, x0, y0, x1, y1):
    dx, dy = x1-x0, y1-y0
    if dx == dy == 0: return math.hypot(px-x0, py-y0)
    tt = max(0, min(1, ((px-x0)*dx+(py-y0)*dy)/(dx*dx+dy*dy)))
    return math.hypot(px-(x0+tt*dx), py-(y0+tt*dy))
def ok(pts):
    for i in range(len(pts)-1):
        ax, ay = pts[i]; bx, by = pts[i+1]; n = max(2, int(math.hypot(bx-ax, by-ay)/0.12))
        for k in range(n+1):
            t = k/n; x = ax+(bx-ax)*t; y = ay+(by-ay)*t
            for (l, tp, rr, bo) in pads:
                if math.hypot(max(l-x, 0, x-rr), max(tp-y, 0, y-bo)) < 0.15+0.125: return False
            for (x0, y0, x1, y1, hw) in segs:
                if pt_seg(x, y, x0, y0, x1, y1) < 0.15+hw: return False
    return True
def cands(a, c):
    yield [a, c]
    for o in [v*0.3 for v in range(-14, 15)]:
        yield [a, (a[0]+o, a[1]), (a[0]+o, c[1]), c]
        yield [a, (a[0], a[1]+o), (c[0], a[1]+o), c]

routed = False
for pts in cands(P0, P1):
    if ok(pts):
        for i in range(len(pts)-1):
            tr = pcbnew.PCB_TRACK(b); tr.SetStart(pcbnew.VECTOR2I(FM(pts[i][0]), FM(pts[i][1])))
            tr.SetEnd(pcbnew.VECTOR2I(FM(pts[i+1][0]), FM(pts[i+1][1]))); tr.SetWidth(FM(0.2))
            tr.SetLayer(pcbnew.F_Cu); tr.SetNetCode(NC); tr.SetLocked(True); b.Add(tr)
        print(f"  {NET} routed, {len(pts)-1} seg(s)"); routed = True; break
if not routed:
    print(f"  {NET}: no clear F.Cu path"); sys.exit(1)
pcbnew.SaveBoard(PCB, b)
print("saved")
