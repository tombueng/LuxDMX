"""Route the one long EN straggler (Q1.3 collector -> U1.EN cluster, ~29mm) that Freerouting leaves open
on this dense board. F.Cu is congested, so haul it on B.Cu: short F.Cu stub Q1.3->via1, grid-A* path on
B.Cu to via2, short F.Cu stub via2->T (a point on the existing EN copper). All added segments locked.
KiCad 10 bundled python."""
import pcbnew, math, heapq
PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
b = pcbnew.LoadBoard(PCB)
NET = "EN"; NC = b.FindNet(NET).GetNetCode()
P0 = (140.95, 103.12)          # Q1.3 EN
T  = (102.430, 117.750)   # U1.EN pad

def pads_segs(layer):
    pads = []; segs = []
    for f in b.GetFootprints():
        for p in f.Pads():
            if p.GetNetname() == NET:
                continue
            # a pad blocks 'layer' if it is on that copper layer or is a through-hole
            if p.IsOnLayer(layer) or p.GetAttribute() == pcbnew.PAD_ATTRIB_PTH:
                r = p.GetBoundingBox(); pads.append((TM(r.GetLeft()), TM(r.GetTop()), TM(r.GetRight()), TM(r.GetBottom())))
    for t in b.GetTracks():
        if t.GetNetname() == NET:
            continue
        if isinstance(t, pcbnew.PCB_VIA):
            q = t.GetPosition(); segs.append((TM(q.x), TM(q.y), TM(q.x), TM(q.y), 0.45))  # via radius+clearance margin
        elif t.GetLayer() == layer:
            s = t.GetStart(); e = t.GetEnd(); segs.append((TM(s.x), TM(s.y), TM(e.x), TM(e.y), TM(t.GetWidth())/2))
    return pads, segs

def pt_seg(px, py, x0, y0, x1, y1):
    dx, dy = x1-x0, y1-y0
    if dx == dy == 0:
        return math.hypot(px-x0, py-y0)
    tt = max(0, min(1, ((px-x0)*dx+(py-y0)*dy)/(dx*dx+dy*dy)))
    return math.hypot(px-(x0+tt*dx), py-(y0+tt*dy))

fp, fs = pads_segs(pcbnew.F_Cu)
bp, bs = pads_segs(pcbnew.B_Cu)

def clear_pt(x, y, pads, segs, cl):
    for (l, tp, rr, bo) in pads:
        if math.hypot(max(l-x, 0, x-rr), max(tp-y, 0, y-bo)) < cl+0.1:
            return False
    for (x0, y0, x1, y1, hw) in segs:
        if pt_seg(x, y, x0, y0, x1, y1) < cl+hw:
            return False
    return True

def stub_ok(a, c, pads, segs, cl=0.13):
    n = max(2, int(math.hypot(c[0]-a[0], c[1]-a[1])/0.05))
    for k in range(n+1):
        t = k/n
        if not clear_pt(a[0]+(c[0]-a[0])*t, a[1]+(c[1]-a[1])*t, pads, segs, cl):
            return False
    return True

def via_near(p, toward):
    base = math.atan2(toward[1]-p[1], toward[0]-p[0])
    for r in [v*0.25 for v in range(2, 24)]:
        for da in [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.0, -2.0]:
            ang = base+da; vx, vy = p[0]+r*math.cos(ang), p[1]+r*math.sin(ang)
            if clear_pt(vx, vy, fp, fs, 0.18) and clear_pt(vx, vy, bp, bs, 0.18) and stub_ok(p, (vx, vy), fp, fs):
                return (vx, vy)
    return None

v1 = via_near(P0, T); v2 = via_near(T, P0)
print("v1", v1, "v2", v2)
if not (v1 and v2):
    raise SystemExit("could not place EN escape vias")

# ---- grid A* on B.Cu between v1 and v2 ----
GS = 0.25                                   # grid step
minx = 98.0; maxx = 197.0
miny = 89.0; maxy = 168.0
nx = int((maxx-minx)/GS)+1; ny = int((maxy-miny)/GS)+1
def cell(p): return (int(round((p[0]-minx)/GS)), int(round((p[1]-miny)/GS)))
def pos(c): return (minx+c[0]*GS, miny+c[1]*GS)
CL = 0.18                                    # B.Cu route clearance (0.2mm trace) -> matches DRC general 0.2mm
blocked = bytearray(nx*ny)
for ix in range(nx):
    for iy in range(ny):
        x, y = minx+ix*GS, miny+iy*GS
        if not clear_pt(x, y, bp, bs, CL):
            blocked[ix*ny+iy] = 1
s = cell(v1); g = cell(v2)
blocked[s[0]*ny+s[1]] = 0; blocked[g[0]*ny+g[1]] = 0       # endpoints always free
def astar(s, g):
    import heapq
    def h(c): return math.hypot(c[0]-g[0], c[1]-g[1])
    openh = [(h(s), 0.0, s, None)]; came = {}; gsc = {s: 0.0}
    nbrs = [(1,0,1),(-1,0,1),(0,1,1),(0,-1,1),(1,1,1.41),(1,-1,1.41),(-1,1,1.41),(-1,-1,1.41)]
    while openh:
        f, gc, c, par = heapq.heappop(openh)
        if c in came: continue
        came[c] = par
        if c == g:
            path = [c]
            while came[path[-1]] is not None: path.append(came[path[-1]])
            return path[::-1]
        for dx, dy, w in nbrs:
            ncl = (c[0]+dx, c[1]+dy)
            if not (0 <= ncl[0] < nx and 0 <= ncl[1] < ny): continue
            if blocked[ncl[0]*ny+ncl[1]]: continue
            if dx and dy and (blocked[(c[0]+dx)*ny+c[1]] or blocked[c[0]*ny+(c[1]+dy)]): continue  # no corner-cut
            ng = gc + w*GS
            if ng < gsc.get(ncl, 1e18):
                gsc[ncl] = ng; heapq.heappush(openh, (ng+h(ncl)*GS, ng, ncl, c))
    return None
path = astar(s, g)
if not path:
    raise SystemExit("A* found no B.Cu path for EN")
# simplify collinear runs
pts = [pos(path[0])]
for i in range(1, len(path)-1):
    ax, ay = path[i-1]; bx, by = path[i]; cx, cy = path[i+1]
    if (bx-ax, by-ay) != (cx-bx, cy-by):
        pts.append(pos(path[i]))
pts.append(pos(path[-1]))
print(f"A* path {len(path)} cells -> {len(pts)} vertices")

def addseg(p, q, layer):
    tr = pcbnew.PCB_TRACK(b); tr.SetStart(pcbnew.VECTOR2I(FM(p[0]), FM(p[1])))
    tr.SetEnd(pcbnew.VECTOR2I(FM(q[0]), FM(q[1]))); tr.SetWidth(FM(0.2))
    tr.SetLayer(layer); tr.SetNetCode(NC); tr.SetLocked(True); b.Add(tr)
addseg(P0, v1, pcbnew.F_Cu); addseg(T, v2, pcbnew.F_Cu)
for vp in (v1, v2):
    v = pcbnew.PCB_VIA(b); v.SetPosition(pcbnew.VECTOR2I(FM(vp[0]), FM(vp[1])))
    v.SetViaType(pcbnew.VIATYPE_THROUGH); v.SetDrill(FM(0.3)); v.SetWidth(FM(0.6)); v.SetNetCode(NC)
    v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu); v.SetLocked(True); b.Add(v)
# stitch v1->path[0] and path[-1]->v2 (they coincide with grid cells, tiny)
addseg(v1, pts[0], pcbnew.B_Cu); addseg(pts[-1], v2, pcbnew.B_Cu)
for i in range(len(pts)-1):
    addseg(pts[i], pts[i+1], pcbnew.B_Cu)
pcbnew.SaveBoard(PCB, b)
print("EN routed on B.Cu:", len(pts)-1, "B.Cu segs + 2 F.Cu stubs + 2 vias")
