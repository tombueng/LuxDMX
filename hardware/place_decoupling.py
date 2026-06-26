"""Auto-place the support parts (decoupling/HF/bulk caps, crystal + load caps, switcher caps,
feedback/pull-up/term resistors, TVS) hard against the IC pin they serve, to fix the EMC-invalid
auto-grid spread flagged by validate_placement.py.

Anchors that are NOT moved: the ICs/modules (U*, PS*), all connectors (J*), the buck inductor L1,
switches, mounting holes, the status LEDs + their resistors, the PoE OR/TVS diodes, and the
auto-reset transistors. Every part in PLACE is snapped to its shared-net pin on the anchor, searched
outward (pin side first) with collision avoidance against everything already down. Run BEFORE the
routing pipeline (rebuild_iso wipes tracks anyway). KiCad 10 python."""
import pcbnew, math
PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
b = pcbnew.LoadBoard(PCB)

# (part, anchor, preferred shared net) -- caps/res/xtal/tvs to snap to their IC pin
PLACE = [
    ("C1","U1","+3V3"),("C2","U1","+3V3"),("C3","U1","EN"),("R1","U1","EN"),("R2","U1","IO0"),
    ("C15","U3","+3V3"),("R6","U3","RTS"),("R7","U3","DTR"),
    ("C8","U2","+3V3"),("C9","U2","+3V3"),("C10","U2","+3V3"),("C11","U2","+3V3"),
    ("C4","U2","W5500_1V2"),("C5","U2","W5500_1V2"),("C6","U2","TOCAP"),("R3","U2",None),
    ("Y1","U2","XI"),("C12","U2","XI"),("C13","U2","XO"),
    ("R18","J3","ETH_TCT"),("C14","J3","ETH_TCT"),("C22","J3","ETH_RCT"),("R4","J3",None),("R5","J3",None),
    ("L1","U4","BUCK_LX"),("C16","U4","+5V"),("C17","L1","+3V3"),("R10","U4","BUCK_FB"),("R11","U4","BUCK_FB"),
    ("C18","U5","+3V3"),("C19","U5","VISO"),("C20","U5","VISO"),
    ("C23","U6","+3V3"),("C24","U6","VISO2"),("C25","U6","VISO2"),
    ("C21","PS1","+5V"),("C26","PS2","+5V"),
    ("C27","U7","+5V_POE"),("C28","U7","+5V_POE"),("C29","U4","+5V"),
    ("D1","J1","DMX_A"),("R12","J1","DMX_A"),("D7","J5","DMX2_A"),("R19","J5","DMX2_A"),
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
KEEPOUT = {"U1"}    # ESP32-S3-WROOM-1: courtyard includes the RF antenna keepout (no body there).
                    # Use its pad-span so decoupling can sit in the keepout (wired board); every other
                    # part (incl. connector/module bodies that also overhang their pads) keeps its
                    # real courtyard so parts don't collide with physical bodies.
def cbox(f):
    ps = _padspan(f)
    if f.GetReference() in KEEPOUT: return ps        # ESP32: ignore RF keepout, use pads only
    r = f.GetCourtyard(pcbnew.F_CrtYd).BBox()
    if r.GetWidth() == 0: return ps
    cy = [TM(r.GetLeft()), TM(r.GetTop()), TM(r.GetRight()), TM(r.GetBottom())]
    # UNION of pad-span and courtyard: QFN/SOIC pads stick OUT past the courtyard outline, so the
    # courtyard alone misses them and caps land on the pads. The union covers body AND pads.
    return [min(ps[0], cy[0]), min(ps[1], cy[1]), max(ps[2], cy[2]), max(ps[3], cy[3])]

# occupied = courtyard (or pad-span for keepout parts) of every part we are NOT moving
occ = [cbox(f) for f in b.GetFootprints() if f.GetReference() not in MOVE]
def overlap(a, c, m=1.8):        # >=~2mm pad-to-pad clearance (box union already covers pads)
    return not (a[2]+m < c[0] or c[2]+m < a[0] or a[3]+m < c[1] or c[3]+m < a[1])
def fits(box):
    if box[0]<BX0 or box[1]<BY0 or box[2]>BX1 or box[3]>BY1: return False
    return not any(overlap(box, o) for o in occ)

# round-robin anchor pads per (anchor, net)
used = {}
def target_pad(part, anchor, prefnet):
    pf, af = fp(part), fp(anchor)
    pn = {p.GetNetname() for p in pf.Pads()}
    an = {p.GetNetname() for p in af.Pads()}
    shared = (pn & an) - {"GND", ""}
    net = prefnet if prefnet in shared else (sorted(shared)[0] if shared else None)
    if not net: return None, None
    pads = [p.GetPosition() for p in af.Pads() if p.GetNetname()==net]
    k = (anchor, net); i = used.get(k, 0); used[k] = i+1
    return pads[i % len(pads)], af.GetPosition()

placed = fail = 0
for part, anchor, prefnet in PLACE:
    f = fp(part)
    if not f: print(f"  ?? {part} missing"); continue
    pad, acen = target_pad(part, anchor, prefnet)
    if pad is None: print(f"  ?? {part}<->{anchor}: no shared net"); fail += 1; continue
    px, py = TM(pad.x), TM(pad.y)
    # outward direction = from anchor centre to the pin
    dx, dy = px-TM(acen.x), py-TM(acen.y)
    a0 = math.atan2(dy, dx) if (dx or dy) else 0
    w = abs(cbox(f)[2]-cbox(f)[0]); h = abs(cbox(f)[3]-cbox(f)[1])
    done = False
    for rot in (0, 90):
        ww, hh = (w, h) if rot==0 else (h, w)
        for rad in [g*0.4 for g in range(5, 45)]:    # start ~2mm out from the pin, search to ~18mm
            for da in [0]+[s*j*0.30 for j in range(1, 11) for s in (1, -1)]:
                ang = a0+da
                cx, cy = px+rad*math.cos(ang), py+rad*math.sin(ang)
                box = [cx-ww/2, cy-hh/2, cx+ww/2, cy+hh/2]
                if fits(box):
                    f.SetPosition(pcbnew.VECTOR2I(FM(cx), FM(cy)))
                    f.SetOrientationDegrees(rot)
                    occ.append(box); placed += 1; done = True; break
            if done: break
        if done: break
    if not done: print(f"  !! {part}: no free spot near {anchor}"); fail += 1

pcbnew.SaveBoard(PCB, b)
print(f"placed {placed}/{len(PLACE)} support parts adjacent to their IC pins ({fail} unplaced)")
