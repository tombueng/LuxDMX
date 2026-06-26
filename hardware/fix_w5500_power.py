"""Hand-finish the 2 W5500 power pins that couldn't escape the dense LQFP fan-out (pin 4 +3V3, pin 16
GND). Phase 1: remove the autorouter's short stubs + any prior hand-trace at those pins, save.
Phase 2 (fresh reload so obstacle geometry is valid): route a CLEARANCE-CHECKED F.Cu path from each
pin to the nearest reachable plane-stitched target (a +3V3/GND decoupling-cap pad or power via), trying
several targets and straight/L/Z path shapes, picking the first that clears all other-net copper.
KiCad 10 python."""
import pcbnew, math
PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
PINS = {"+3V3": (132.00, 146.00), "GND": (126.50, 149.00)}   # U2.4, U2.16

# ---- phase 1: remove stubs near the pins, save ----
b = pcbnew.LoadBoard(PCB)
for t in list(b.GetTracks()):
    if isinstance(t, pcbnew.PCB_VIA) or t.GetNetname() not in ("+3V3", "GND"): continue
    s = t.GetStart(); e = t.GetEnd()
    mid = ((TM(s.x)+TM(e.x))/2, (TM(s.y)+TM(e.y))/2)
    if min(math.hypot(mid[0]-p[0], mid[1]-p[1]) for p in PINS.values()) < 2.5 and (t.IsLocked() or TM(t.GetLength()) <= 3.5):
        b.Remove(t)
pcbnew.SaveBoard(PCB, b)

# ---- phase 2: fresh reload, collect obstacles, route ----
b = pcbnew.LoadBoard(PCB)
NC = {n: b.FindNet(n).GetNetCode() for n in ("+3V3", "GND")}

def targets(net, px, py):                 # same-net cap pads + power vias, nearest first
    out = []
    for f in b.GetFootprints():
        if not f.GetReference().startswith("C"): continue
        for p in f.Pads():
            if p.GetNetname() == net:
                q = p.GetPosition(); out.append((TM(q.x), TM(q.y)))
    for t in b.GetTracks():
        if isinstance(t, pcbnew.PCB_VIA) and t.GetNetname() == net:
            q = t.GetPosition(); out.append((TM(q.x), TM(q.y)))
    out.sort(key=lambda c: math.hypot(c[0]-px, c[1]-py))
    return out[:6]

def obstacles(net):
    pads = []; segs = []
    for f in b.GetFootprints():
        for p in f.Pads():
            if p.GetNetname() != net:
                r = p.GetBoundingBox(); pads.append((TM(r.GetLeft()), TM(r.GetTop()), TM(r.GetRight()), TM(r.GetBottom())))
    for t in b.GetTracks():
        if t.GetNetname() == net: continue
        if isinstance(t, pcbnew.PCB_VIA):
            q = t.GetPosition(); segs.append((TM(q.x), TM(q.y), TM(q.x), TM(q.y), 0.35))
        else:
            s = t.GetStart(); e = t.GetEnd(); segs.append((TM(s.x), TM(s.y), TM(e.x), TM(e.y), TM(t.GetWidth())/2))
    return pads, segs

def pt_seg(px, py, x0, y0, x1, y1):
    dx, dy = x1-x0, y1-y0
    if dx == dy == 0: return math.hypot(px-x0, py-y0)
    tt = max(0, min(1, ((px-x0)*dx+(py-y0)*dy)/(dx*dx+dy*dy)))
    return math.hypot(px-(x0+tt*dx), py-(y0+tt*dy))

def ok(pts, pads, segs):
    for i in range(len(pts)-1):
        ax, ay = pts[i]; bx, by = pts[i+1]; n = max(2, int(math.hypot(bx-ax, by-ay)/0.15))
        for k in range(n+1):
            t = k/n; x = ax+(bx-ax)*t; y = ay+(by-ay)*t
            for (l, tp, rr, bo) in pads:
                if math.hypot(max(l-x, 0, x-rr), max(tp-y, 0, y-bo)) < 0.30: return False
            for (x0, y0, x1, y1, hw) in segs:
                if pt_seg(x, y, x0, y0, x1, y1) < 0.20 + hw: return False
    return True

def paths(px, py, cx, cy):
    yield [(px, py), (cx, cy)]
    for o in [v*0.3 for v in range(-12, 13)]:
        yield [(px, py), (px+o, py), (px+o, cy), (cx, cy)]      # vertical-first dogleg
        yield [(px, py), (px, py+o), (cx, py+o), (cx, cy)]      # horizontal-first dogleg

for net, (px, py) in PINS.items():
    pads, segs = obstacles(net)
    routed = False
    for cx, cy in targets(net, px, py):
        for pts in paths(px, py, cx, cy):
            if ok(pts, pads, segs):
                for i in range(len(pts)-1):
                    t = pcbnew.PCB_TRACK(b); t.SetStart(pcbnew.VECTOR2I(FM(pts[i][0]), FM(pts[i][1])))
                    t.SetEnd(pcbnew.VECTOR2I(FM(pts[i+1][0]), FM(pts[i+1][1]))); t.SetWidth(FM(0.25))
                    t.SetLayer(pcbnew.F_Cu); t.SetNetCode(NC[net]); t.SetLocked(True); b.Add(t)
                print(f"  {net} U2 pin routed to ({cx:.1f},{cy:.1f}) via {len(pts)-1} seg(s)"); routed = True; break
        if routed: break
    if not routed: print(f"  {net}: NO clear path -- left for manual")

pcbnew.ZONE_FILLER(b).Fill(b.Zones())
b.BuildConnectivity()
pcbnew.SaveBoard(PCB, b)
print("unrouted:", b.GetConnectivity().GetUnconnectedCount(True))
