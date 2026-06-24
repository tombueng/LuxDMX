"""Finish the last W5500 power pin (pin 14 GND) that couldn't fit the fan-out. Route it to the GND
via 1.46mm away (already on the plane), clearance-checked against non-GND copper. Obstacle geometry is
gathered into plain lists up-front so it stays valid after we delete the autorouter's bad local stub
(a single LoadBoard per process; no reload). KiCad 10."""
import pcbnew, math
PCB = r"C:\dev\DMX\hardware\lumigate.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
b = pcbnew.LoadBoard(PCB)
GNDNC = b.FindNet("GND").GetNetCode()
PIN = (126.50, 148.00)
TGTS = [(125.40, 148.96), (123.39, 148.17)]      # nearby GND via, then C11.2 cap

# obstacles = all non-GND copper (gathered now, valid for the whole run)
pads = []; segs = []
for f in b.GetFootprints():
    for p in f.Pads():
        if p.GetNetname() != "GND":
            r = p.GetBoundingBox(); pads.append((TM(r.GetLeft()), TM(r.GetTop()), TM(r.GetRight()), TM(r.GetBottom())))
for t in b.GetTracks():
    if t.GetNetname() == "GND": continue
    if isinstance(t, pcbnew.PCB_VIA):
        q = t.GetPosition(); segs.append((TM(q.x), TM(q.y), TM(q.x), TM(q.y), 0.35))
    else:
        s = t.GetStart(); e = t.GetEnd(); segs.append((TM(s.x), TM(s.y), TM(e.x), TM(e.y), TM(t.GetWidth())/2))

# remove the autorouter's bad unlocked GND stub at pin 14
for t in list(b.GetTracks()):
    if isinstance(t, pcbnew.PCB_VIA) or t.GetNetname() != "GND" or t.IsLocked(): continue
    s = t.GetStart(); e = t.GetEnd()
    if min(math.hypot((TM(s.x)+TM(e.x))/2-PIN[0], (TM(s.y)+TM(e.y))/2-PIN[1]),
           math.hypot(TM(s.x)-PIN[0], TM(s.y)-PIN[1])) < 2.0 and TM(t.GetLength()) <= 3.0:
        b.Remove(t)

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
                if math.hypot(max(l-x, 0, x-rr), max(tp-y, 0, y-bo)) < 0.15+0.125: return False  # 0.15mm gap (JLCPCB 4L ok)
            for (x0, y0, x1, y1, hw) in segs:
                if pt_seg(x, y, x0, y0, x1, y1) < 0.15+hw: return False
    return True

routed = False
for cx, cy in TGTS:
    cands = [[PIN, (cx, cy)]]
    for o in [v*0.25 for v in range(-10, 11)]:
        cands.append([PIN, (PIN[0]+o, PIN[1]), (PIN[0]+o, cy), (cx, cy)])
        cands.append([PIN, (PIN[0], PIN[1]+o), (cx, PIN[1]+o), (cx, cy)])
    for pts in cands:
        if ok(pts):
            for i in range(len(pts)-1):
                tr = pcbnew.PCB_TRACK(b); tr.SetStart(pcbnew.VECTOR2I(FM(pts[i][0]), FM(pts[i][1])))
                tr.SetEnd(pcbnew.VECTOR2I(FM(pts[i+1][0]), FM(pts[i+1][1]))); tr.SetWidth(FM(0.25))
                tr.SetLayer(pcbnew.F_Cu); tr.SetNetCode(GNDNC); tr.SetLocked(True); b.Add(tr)
            print(f"  pin14 GND routed to ({cx:.1f},{cy:.1f}), {len(pts)-1} seg(s)"); routed = True; break
    if routed: break
if not routed: print("  pin14: no clear path")
pcbnew.SaveBoard(PCB, b)
print("saved" if routed else "no change")
