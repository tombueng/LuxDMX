"""Widen the W5500 Ethernet MDI signal pairs (ETH_TXN/TXP/RXN/RXP) toward a controlled single-ended
impedance. On the JLC04161H-7628 4-layer stackup (F.Cu over In1=GND, prepreg h=0.2104mm, Er 4.05) the
microstrip Z0 is:  0.15mm -> ~78 ohm,  0.20mm -> ~69,  0.30mm -> ~57,  0.35mm -> ~51 ohm single-ended.
100BASE-TX wants ~50 ohm single-ended (~100 ohm differential), so the traces are widened toward 0.35mm
wherever the local clearance allows -- greedy per-segment, never shrinks, never creates a violation, necks
back at the 0.5mm-pitch W5500 fan-out where 0.35mm can't fit. Run LAST (after route + cleanup + tighten;
a re-route resets widths). The pairs are still single-ended / not length-matched (coupled diff-pair routing
needs the interactive GUI), but the impedance is now close to target instead of ~40% high. KiCad 10."""
import pcbnew, math

PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
ETH = {"ETH_TXN", "ETH_TXP", "ETH_RXN", "ETH_RXP"}
MAXW, CLR, EDGE_CLR = 0.35, 0.15, 0.25   # target ~51 ohm SE; keep 0.15mm to other copper (Fine rule is 0.10)
b = pcbnew.LoadBoard(PCB)

edges = []
for d in b.GetDrawings():
    if d.GetLayer() == pcbnew.Edge_Cuts and d.GetShape() == pcbnew.SHAPE_T_SEGMENT:
        s, e = d.GetStart(), d.GetEnd()
        edges.append((TM(s.x), TM(s.y), TM(e.x), TM(e.y)))


def seg_pt(px, py, x0, y0, x1, y1):
    dx, dy = x1 - x0, y1 - y0
    if dx == dy == 0:
        return math.hypot(px - x0, py - y0)
    t = max(0, min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))


def seg_seg(a, bb):
    ax0, ay0, ax1, ay1 = a; bx0, by0, bx1, by1 = bb
    return min(seg_pt(ax0, ay0, bx0, by0, bx1, by1), seg_pt(ax1, ay1, bx0, by0, bx1, by1),
              seg_pt(bx0, by0, ax0, ay0, ax1, ay1), seg_pt(bx1, by1, ax0, ay0, ax1, ay1))


def box_seg(box, s):
    x0, y0, x1, y1 = s; bl, bt, br, bb_ = box
    best = 1e9
    for i in range(25):
        t = i / 24; x = x0 + (x1 - x0) * t; y = y0 + (y1 - y0) * t
        dx = max(bl - x, 0, x - br); dy = max(bt - y, 0, y - bb_)
        best = min(best, math.hypot(dx, dy))
    return best


tracks = list(b.GetTracks())
vias = [t for t in tracks if isinstance(t, pcbnew.PCB_VIA)]
segs = [t for t in tracks if not isinstance(t, pcbnew.PCB_VIA)]
pads = [p for f in b.GetFootprints() for p in f.Pads()]


def widen(t):
    net = t.GetNetname(); layer = t.GetLayer()
    s = (TM(t.GetStart().x), TM(t.GetStart().y), TM(t.GetEnd().x), TM(t.GetEnd().y))
    avail = (MAXW / 2) + CLR
    for o in segs:
        if o is t or o.GetNetname() == net or o.GetLayer() != layer:
            continue
        os = (TM(o.GetStart().x), TM(o.GetStart().y), TM(o.GetEnd().x), TM(o.GetEnd().y))
        avail = min(avail, seg_seg(s, os) - TM(o.GetWidth()) / 2)
    for v in vias:
        if v.GetNetname() == net:
            continue
        p = v.GetPosition()
        avail = min(avail, seg_pt(TM(p.x), TM(p.y), *s) - TM(v.GetWidth(pcbnew.F_Cu)) / 2)
    for p in pads:
        if p.GetNetname() == net or not (p.HasHole() or p.IsOnLayer(layer)):
            continue
        r = p.GetBoundingBox()
        avail = min(avail, box_seg((TM(r.GetLeft()), TM(r.GetTop()), TM(r.GetRight()), TM(r.GetBottom())), s))
    for e in edges:
        avail = min(avail, seg_seg(s, e) - (EDGE_CLR - CLR))
    w = 2 * (avail - CLR)
    w = max(TM(t.GetWidth()), min(MAXW, w))
    w = math.floor(w * 100) / 100
    if w > TM(t.GetWidth()) + 0.001:
        t.SetWidth(FM(w)); return w
    return None


changed = {}
for t in segs:
    if t.GetNetname() in ETH:
        w = widen(t)
        if w:
            changed.setdefault(t.GetNetname(), []).append(w)
for net in sorted(changed):
    ws = changed[net]
    print(f"  {net:9s} widened {len(ws)} seg(s)  -> {min(ws):.2f}..{max(ws):.2f}mm")
pcbnew.SaveBoard(PCB, b)
print(f"eth pairs widened toward controlled impedance (cap {MAXW}mm ~51ohm SE, {CLR}mm clearance kept)")
