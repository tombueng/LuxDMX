"""Repair the 5 nets whose traces were accidentally removed during the test-point experiment.
Same approach as route_en.py: for each gap, drop a via near each endpoint (short F.Cu stub pad/trace->via)
and haul between them on B.Cu with a grid-A* pathfinder. Re-queries obstacles per gap so each new route is
seen by the next. KiCad 10 bundled python."""
import pcbnew, math, heapq
PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
b = pcbnew.LoadBoard(PCB)

GAPS = [
    ("TOCAP", (122.492, 145.187), (126.500, 151.000)),   # C6 decoupling -> W5500 TOCAP pin
]

def pads_segs(net, layer):
    pads = []; segs = []
    for f in b.GetFootprints():
        for p in f.Pads():
            if p.GetNetname() == net:
                continue
            if p.IsOnLayer(layer) or p.GetAttribute() == pcbnew.PAD_ATTRIB_PTH:
                r = p.GetBoundingBox(); pads.append((TM(r.GetLeft()), TM(r.GetTop()), TM(r.GetRight()), TM(r.GetBottom())))
    for t in b.GetTracks():
        if t.GetNetname() == net:
            continue
        if isinstance(t, pcbnew.PCB_VIA):
            q = t.GetPosition(); segs.append((TM(q.x), TM(q.y), TM(q.x), TM(q.y), 0.45))
        elif t.GetLayer() == layer:
            s = t.GetStart(); e = t.GetEnd(); segs.append((TM(s.x), TM(s.y), TM(e.x), TM(e.y), TM(t.GetWidth())/2))
    return pads, segs

def pt_seg(px, py, x0, y0, x1, y1):
    dx, dy = x1-x0, y1-y0
    if dx == dy == 0: return math.hypot(px-x0, py-y0)
    tt = max(0, min(1, ((px-x0)*dx+(py-y0)*dy)/(dx*dx+dy*dy)))
    return math.hypot(px-(x0+tt*dx), py-(y0+tt*dy))

def clear_pt(x, y, pads, segs, cl):
    for (l, t, r, bo) in pads:
        if math.hypot(max(l-x, 0, x-r), max(t-y, 0, y-bo)) < cl+0.1: return False
    for (x0, y0, x1, y1, hw) in segs:
        if pt_seg(x, y, x0, y0, x1, y1) < cl+hw: return False
    return True

def stub_ok(a, c, pads, segs, cl=0.13):
    n = max(2, int(math.hypot(c[0]-a[0], c[1]-a[1])/0.05))
    return all(clear_pt(a[0]+(c[0]-a[0])*k/n, a[1]+(c[1]-a[1])*k/n, pads, segs, cl) for k in range(n+1))

def via_near(p, toward, net):
    fp, fs = pads_segs(net, pcbnew.F_Cu); bp, bs = pads_segs(net, pcbnew.B_Cu)
    base = math.atan2(toward[1]-p[1], toward[0]-p[0])
    for r in [v*0.25 for v in range(0, 44)]:
        for da in [0, .4, -.4, .8, -.8, 1.2, -1.2, 1.6, -1.6, 2.2, -2.2, 3.14]:
            vx, vy = p[0]+r*math.cos(base+da), p[1]+r*math.sin(base+da)
            if clear_pt(vx, vy, fp, fs, 0.16) and clear_pt(vx, vy, bp, bs, 0.16) and stub_ok(p, (vx, vy), fp, fs):
                return (vx, vy)
    return None

def addseg(p, q, code, layer):
    tr = pcbnew.PCB_TRACK(b); tr.SetStart(pcbnew.VECTOR2I(FM(p[0]), FM(p[1])))
    tr.SetEnd(pcbnew.VECTOR2I(FM(q[0]), FM(q[1]))); tr.SetWidth(FM(0.2))
    tr.SetLayer(layer); tr.SetNetCode(code); tr.SetLocked(True); b.Add(tr)

def addvia(p, code):
    v = pcbnew.PCB_VIA(b); v.SetPosition(pcbnew.VECTOR2I(FM(p[0]), FM(p[1])))
    v.SetViaType(pcbnew.VIATYPE_THROUGH); v.SetDrill(FM(0.3)); v.SetWidth(FM(0.6)); v.SetNetCode(code)
    v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu); v.SetLocked(True); b.Add(v)

def astar_bcu(v1, v2, net):
    bp, bs = pads_segs(net, pcbnew.B_Cu)
    GS = 0.2; CL = 0.16
    minx = min(v1[0], v2[0])-13; maxx = max(v1[0], v2[0])+13
    miny = min(v1[1], v2[1])-13; maxy = max(v1[1], v2[1])+13
    nx = int((maxx-minx)/GS)+1; ny = int((maxy-miny)/GS)+1
    blocked = bytearray(nx*ny)
    for ix in range(nx):
        for iy in range(ny):
            if not clear_pt(minx+ix*GS, miny+iy*GS, bp, bs, CL): blocked[ix*ny+iy] = 1
    def cell(p): return (int(round((p[0]-minx)/GS)), int(round((p[1]-miny)/GS)))
    s = cell(v1); g = cell(v2); blocked[s[0]*ny+s[1]] = 0; blocked[g[0]*ny+g[1]] = 0
    def h(c): return math.hypot(c[0]-g[0], c[1]-g[1])
    openh = [(h(s), 0.0, s)]; came = {s: None}; gsc = {s: 0.0}
    nb = [(1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1), (1, 1, 1.41), (1, -1, 1.41), (-1, 1, 1.41), (-1, -1, 1.41)]
    found = False
    while openh:
        f, gc, c = heapq.heappop(openh)
        if c == g: found = True; break
        for dx, dy, w in nb:
            n = (c[0]+dx, c[1]+dy)
            if not (0 <= n[0] < nx and 0 <= n[1] < ny) or blocked[n[0]*ny+n[1]]: continue
            if dx and dy and (blocked[(c[0]+dx)*ny+c[1]] or blocked[c[0]*ny+(c[1]+dy)]): continue
            ng = gc+w*GS
            if ng < gsc.get(n, 1e18): gsc[n] = ng; came[n] = c; heapq.heappush(openh, (ng+h(n)*GS, ng, n))
    if not found: return None
    path = [g]
    while came[path[-1]] is not None: path.append(came[path[-1]])
    path = path[::-1]
    pts = [(minx+path[0][0]*GS, miny+path[0][1]*GS)]
    for i in range(1, len(path)-1):
        a, bb2, cc = path[i-1], path[i], path[i+1]
        if (bb2[0]-a[0], bb2[1]-a[1]) != (cc[0]-bb2[0], cc[1]-bb2[1]):
            pts.append((minx+path[i][0]*GS, miny+path[i][1]*GS))
    pts.append((minx+path[-1][0]*GS, miny+path[-1][1]*GS))
    return pts

for net, P0, P1 in GAPS:
    code = b.FindNet(net).GetNetCode()
    v1 = via_near(P0, P1, net); v2 = via_near(P1, P0, net)
    if not (v1 and v2):
        print(f"  {net}: via placement FAILED v1={v1} v2={v2}"); continue
    path = astar_bcu(v1, v2, net)
    if not path:
        print(f"  {net}: A* FAILED"); continue
    fp, fs = pads_segs(net, pcbnew.F_Cu)
    addseg(P0, v1, code, pcbnew.F_Cu); addseg(P1, v2, code, pcbnew.F_Cu)
    addvia(v1, code); addvia(v2, code)
    addseg(v1, path[0], code, pcbnew.B_Cu); addseg(path[-1], v2, code, pcbnew.B_Cu)
    for i in range(len(path)-1): addseg(path[i], path[i+1], code, pcbnew.B_Cu)
    print(f"  {net}: routed ({len(path)} pts, {math.hypot(P1[0]-P0[0],P1[1]-P0[1]):.1f}mm gap)")

pcbnew.SaveBoard(PCB, b)
print("saved")
