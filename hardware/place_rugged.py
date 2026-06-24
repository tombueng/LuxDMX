"""Place ONLY the 8 ruggedization parts (added by sync_board.py, currently parked in the top strip)
against the pin they serve, with collision avoidance against EVERYTHING already placed. Same snap
engine as place_decoupling.py, but it never moves the existing 80-part layout. Run before the routing
pipeline (rebuild_iso wipes tracks). KiCad 10 python.

  U8  USBLC6 ESD  -> J2  USB D+ (clamp at the connector)
  F1  PTC fuse    -> J2  VBUS    (input fuse at the connector)
  D11 SMAJ5.0A    -> C29 +5V     (clamp on the +5V bulk node)
  FB1 ferrite     -> PS1 +5V_DMX (feeds both DMX iso DC-DC inputs)
  FB2 ferrite     -> U5  VISO_DRV(driver-supply filter, DMX1 island)
  FB3 ferrite     -> U6  VISO2_DRV(DMX2 island)
  L2  CM choke    -> U5  DMX_A    (between transceiver and the cable-side TVS/XLR, DMX1 island)
  L3  CM choke    -> U6  DMX2_A   (DMX2 island)
"""
import pcbnew, math
PCB = r"C:\dev\DMX\hardware\lumigate.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
b = pcbnew.LoadBoard(PCB)

PLACE = [
    ("U8", "J2", "USB_DP"), ("F1", "J2", "+5V_USB"),
    ("D11", "C29", "+5V"), ("FB1", "PS1", "+5V_DMX"),
    ("FB2", "U5", "VISO_DRV"), ("FB3", "U6", "VISO2_DRV"),
    ("L2", "U5", "DMX_A"), ("L3", "U6", "DMX2_A"),
]
MOVE = {p[0] for p in PLACE}

bb = b.GetBoardEdgesBoundingBox()
BX0, BY0, BX1, BY1 = TM(bb.GetLeft())+0.5, TM(bb.GetTop())+0.5, TM(bb.GetRight())-0.5, TM(bb.GetBottom())-0.5


def fp(r): return b.FindFootprintByReference(r)
def _padspan(f):
    pads = list(f.Pads())
    if not pads:
        r = f.GetBoundingBox(False, False); return [TM(r.GetLeft()), TM(r.GetTop()), TM(r.GetRight()), TM(r.GetBottom())]
    L = min(p.GetBoundingBox().GetLeft() for p in pads); T = min(p.GetBoundingBox().GetTop() for p in pads)
    R = max(p.GetBoundingBox().GetRight() for p in pads); B = max(p.GetBoundingBox().GetBottom() for p in pads)
    return [TM(L), TM(T), TM(R), TM(B)]
KEEPOUT = {"U1"}
def cbox(f):
    ps = _padspan(f)
    if f.GetReference() in KEEPOUT: return ps
    r = f.GetCourtyard(pcbnew.F_CrtYd).BBox()
    if r.GetWidth() == 0: return ps
    cy = [TM(r.GetLeft()), TM(r.GetTop()), TM(r.GetRight()), TM(r.GetBottom())]
    return [min(ps[0], cy[0]), min(ps[1], cy[1]), max(ps[2], cy[2]), max(ps[3], cy[3])]

occ = [cbox(f) for f in b.GetFootprints() if f.GetReference() not in MOVE]
def overlap(a, c, m=1.6):
    return not (a[2]+m < c[0] or c[2]+m < a[0] or a[3]+m < c[1] or c[3]+m < a[1])
def fits(box):
    if box[0]<BX0 or box[1]<BY0 or box[2]>BX1 or box[3]>BY1: return False
    return not any(overlap(box, o) for o in occ)

used = {}
def target_pad(part, anchor, prefnet):
    pf, af = fp(part), fp(anchor)
    pn = {p.GetNetname() for p in pf.Pads()}
    an = {p.GetNetname() for p in af.Pads()}
    shared = (pn & an) - {"GND", ""}
    net = prefnet if prefnet in shared else (sorted(shared)[0] if shared else None)
    if not net: return None, None
    pads = [p.GetPosition() for p in af.Pads() if p.GetNetname() == net]
    k = (anchor, net); i = used.get(k, 0); used[k] = i+1
    return pads[i % len(pads)], af.GetPosition()

placed = fail = 0
for part, anchor, prefnet in PLACE:
    f = fp(part)
    if not f: print(f"  ?? {part} missing"); continue
    pad, acen = target_pad(part, anchor, prefnet)
    if pad is None: print(f"  ?? {part}<->{anchor}: no shared net"); fail += 1; continue
    px, py = TM(pad.x), TM(pad.y)
    dx, dy = px-TM(acen.x), py-TM(acen.y)
    a0 = math.atan2(dy, dx) if (dx or dy) else 0
    w = abs(cbox(f)[2]-cbox(f)[0]); h = abs(cbox(f)[3]-cbox(f)[1])
    done = False
    for rot in (0, 90):
        ww, hh = (w, h) if rot == 0 else (h, w)
        for rad in [g*0.4 for g in range(4, 50)]:
            for da in [0]+[s*j*0.25 for j in range(1, 13) for s in (1, -1)]:
                ang = a0+da
                cx, cy = px+rad*math.cos(ang), py+rad*math.sin(ang)
                box = [cx-ww/2, cy-hh/2, cx+ww/2, cy+hh/2]
                if fits(box):
                    f.SetPosition(pcbnew.VECTOR2I(FM(cx), FM(cy)))
                    f.SetOrientationDegrees(rot)
                    occ.append(box); placed += 1; done = True
                    print(f"  {part:4s} -> ({cx:.1f},{cy:.1f}) rot{rot} near {anchor}.{prefnet}")
                    break
            if done: break
        if done: break
    if not done: print(f"  !! {part}: no free spot near {anchor}"); fail += 1

pcbnew.SaveBoard(PCB, b)
print(f"placed {placed}/{len(PLACE)} ruggedization parts ({fail} unplaced)")
