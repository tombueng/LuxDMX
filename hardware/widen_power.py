"""Widen the high-current power traces (+5V family) as far as the LOCAL clearance allows, up to 0.5mm,
keeping the 0.2mm design-rule gap to every other-net copper + the board edge. Greedy per-segment: never
shrinks a trace, never creates a new clearance violation. Run LAST in the pipeline (after autoroute +
cleanup + tighten), because a re-route resets track widths to the netclass default. KiCad 10 python.

Why: F1 (PTC) trips ~3A and a trace won't fuse below ~8A, so fuse-coordination is fine even at 0.2mm,
but 0.2mm/1oz is only ~0.74A @10C rise and the board pulls ~0.8A -- thin. Widening the +5V path gives
steady-state thermal margin, survives the 3A fault without cooking, and drops the IR loss feeding the
B0505S (helps the 4.5V margin). Isolated/low-current rails (VISO*, VPOE*) are left at 0.2mm."""
import pcbnew, math
PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
POWER = {"+5V", "+5V_USB", "+5V_USBF", "+5V_DMX", "+5V_POE"}
MAXW, CLR, EDGE_CLR = 0.5, 0.2, 0.25
b = pcbnew.LoadBoard(PCB)

# board edge segments (for edge clearance)
edges = []
for d in b.GetDrawings():
    if d.GetLayer() == pcbnew.Edge_Cuts and d.GetShape() == pcbnew.SHAPE_T_SEGMENT:
        s, e = d.GetStart(), d.GetEnd(); edges.append((TM(s.x), TM(s.y), TM(e.x), TM(e.y)))


def seg_pt(px, py, x0, y0, x1, y1):
    dx, dy = x1-x0, y1-y0
    if dx == dy == 0: return math.hypot(px-x0, py-y0)
    t = max(0, min(1, ((px-x0)*dx+(py-y0)*dy)/(dx*dx+dy*dy)))
    return math.hypot(px-(x0+t*dx), py-(y0+t*dy))


def seg_seg(a, bb):
    ax0, ay0, ax1, ay1 = a; bx0, by0, bx1, by1 = bb
    return min(seg_pt(ax0, ay0, bx0, by0, bx1, by1), seg_pt(ax1, ay1, bx0, by0, bx1, by1),
              seg_pt(bx0, by0, ax0, ay0, ax1, ay1), seg_pt(bx1, by1, ax0, ay0, ax1, ay1))


def box_seg(box, s):                       # min distance from segment s to a pad box (0 if it crosses)
    x0, y0, x1, y1 = s; bl, bt, br, bb_ = box
    pts = 24
    best = 1e9
    for i in range(pts+1):
        t = i/pts; x = x0+(x1-x0)*t; y = y0+(y1-y0)*t
        dx = max(bl-x, 0, x-br); dy = max(bt-y, 0, y-bb_)
        best = min(best, math.hypot(dx, dy))
    return best


# gather obstacle copper, tagged by layer set + net + half-extent
tracks = list(b.GetTracks())
vias = [t for t in tracks if isinstance(t, pcbnew.PCB_VIA)]
segs = [t for t in tracks if not isinstance(t, pcbnew.PCB_VIA)]
pads = [p for f in b.GetFootprints() for p in f.Pads()]


def widen(t):
    net = t.GetNetname(); layer = t.GetLayer()
    s = (TM(t.GetStart().x), TM(t.GetStart().y), TM(t.GetEnd().x), TM(t.GetEnd().y))
    avail = (MAXW/2) + CLR                  # cap: don't exceed MAXW
    # other tracks on the same layer, different net
    for o in segs:
        if o is t or o.GetNetname() == net: continue
        if o.GetLayer() != layer: continue
        os = (TM(o.GetStart().x), TM(o.GetStart().y), TM(o.GetEnd().x), TM(o.GetEnd().y))
        avail = min(avail, seg_seg(s, os) - TM(o.GetWidth())/2)
    # vias (all layers), different net
    for v in vias:
        if v.GetNetname() == net: continue
        p = v.GetPosition()
        avail = min(avail, seg_pt(TM(p.x), TM(p.y), *s) - TM(v.GetWidth(pcbnew.F_Cu))/2)
    # pads: TH (all layers) or SMD on this layer, different net
    for p in pads:
        if p.GetNetname() == net: continue
        on_layer = p.HasHole() or p.IsOnLayer(layer)
        if not on_layer: continue
        r = p.GetBoundingBox()
        box = (TM(r.GetLeft()), TM(r.GetTop()), TM(r.GetRight()), TM(r.GetBottom()))
        avail = min(avail, box_seg(box, s))
    # board edge
    for e in edges:
        avail = min(avail, seg_seg(s, e) - (EDGE_CLR - CLR))
    w = 2*(avail - CLR)
    w = max(TM(t.GetWidth()), min(MAXW, w))     # never shrink, cap at MAXW
    w = math.floor(w*100)/100                    # round down to 0.01mm so we never eat into the gap
    if w > TM(t.GetWidth()) + 0.001:
        t.SetWidth(FM(w)); return w
    return None


changed = {}
for t in segs:
    if t.GetNetname() in POWER:
        w = widen(t)
        if w: changed.setdefault(t.GetNetname(), []).append(w)
for net in sorted(changed):
    ws = changed[net]; print(f"  {net:10s} widened {len(ws)} seg(s)  -> {min(ws):.2f}..{max(ws):.2f}mm")
pcbnew.SaveBoard(PCB, b)
print(f"power traces widened (cap {MAXW}mm, {CLR}mm clearance kept)")
