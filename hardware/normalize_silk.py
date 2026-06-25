"""Normalize F.Silkscreen so reference designators ("C21" etc.) don't overlap other silk, pads or refs.
Every movable ref (all except J* connectors and MH* holes) is re-placed beside its part, tried
above -> below -> right -> left with increasing offset, against ALL obstacles: every part's PADS + every
board-level F.Silk text/graphic + the refs of fixed parts + the refs already placed this run. Big chips
also get a function label, placed the same way. Idempotent for the chip labels.

Uses only segfault-safe ops (pad bboxes + estimated text extents -- pcbnew segfaults on FP_TEXT
GetBoundingBox()/footprint GraphicalItems() in this build). Run AFTER add_port_pinout_silk.py. KiCad 10."""
import pcbnew, math
PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
FS = pcbnew.F_SilkS
b = pcbnew.LoadBoard(PCB)

CHIP = {"U1": "ESP32-S3", "U2": "W5500 ETH", "U3": "USB-UART", "U4": "3V3 BUCK", "U5": "DMX-A ISO485",
        "U6": "DMX-B ISO485", "U7": "PoE PD", "U8": "USB ESD", "PS1": "ISO 5V", "PS2": "ISO 5V"}
REFH = 0.8
bb = b.GetBoardEdgesBoundingBox()
EX0, EY0, EX1, EY1 = TM(bb.GetLeft())+0.25, TM(bb.GetTop())+0.25, TM(bb.GetRight())-0.25, TM(bb.GetBottom())-0.25


def bm(box):
    return [TM(box.GetLeft()), TM(box.GetTop()), TM(box.GetRight()), TM(box.GetBottom())]


def overlap(a, c, m=0.15):
    return not (a[2]+m < c[0] or c[2]+m < a[0] or a[3]+m < c[1] or c[3]+m < a[1])


def textbox(s, x, y, h):                      # CONSERVATIVE centred text extent (no GetBoundingBox -> font
    hw = (len(s)*h*1.05)/2 + h*0.30           # segfaults headless). KiCad stroke char ~1.0-1.1x h wide + space;
    hh = h*0.62 + 0.15                         # over-estimate so "clear" really is clear per DRC.
    return [x-hw, y-hh, x+hw, y+hh], hw, hh


def is_movable(ref):
    return ref and not (ref.startswith("J") or ref.startswith("MH"))


def textest(s, x, y, h):                      # estimated text box (NO GetBoundingBox -> font segfaults headless)
    return textbox(s, x, y, h)[0]


def shape_box(d):                             # PCB_SHAPE bbox from geometry (no GetBoundingBox)
    sh = d.GetShape(); w = TM(d.GetWidth())/2
    if sh == pcbnew.SHAPE_T_CIRCLE:
        c = d.GetCenter(); e = d.GetEnd(); r = math.hypot(TM(e.x-c.x), TM(e.y-c.y)) + w
        return [TM(c.x)-r, TM(c.y)-r, TM(c.x)+r, TM(c.y)+r]
    s = d.GetStart(); e = d.GetEnd()
    return [min(TM(s.x), TM(e.x))-w, min(TM(s.y), TM(e.y))-w, max(TM(s.x), TM(e.x))+w, max(TM(s.y), TM(e.y))+w]


# No b.Remove/b.Add anywhere (that combo segfaults headless pcbnew on this board). The existing chip
# labels are collected below and re-POSITIONED in place; everything else is SetPosition only.
ALL_FP = list(b.GetFootprints())
PBOX = {}                                   # ref -> pad-span bbox (anchor)
obstacles = []                                # pad bboxes + fixed silk + non-movable refs
for f in ALL_FP:
    ref = f.GetReference()
    boxes = [bm(p.GetBoundingBox()) for p in f.Pads()]   # pads (geometric -> safe)
    cr = f.GetCourtyard(pcbnew.F_CrtYd).BBox()            # courtyard covers the silk silhouette (also safe)
    if cr.GetWidth():
        boxes.append(bm(cr))
    if not boxes:
        continue
    pbox = [min(p[0] for p in boxes), min(p[1] for p in boxes), max(p[2] for p in boxes), max(p[3] for p in boxes)]
    PBOX[ref] = pbox
    obstacles.append(pbox)                    # one union(pads, courtyard) box per part -> refs clear the body+silk
    if not is_movable(ref):                   # fixed connector/hole ref text -> obstacle (estimated)
        rt = f.Reference(); rp = rt.GetPosition()
        obstacles.append(textest(ref, TM(rp.x), TM(rp.y), TM(rt.GetTextHeight())))
chip_labels = []                              # existing chip-label texts -> repositioned (not obstacles)
for d in list(b.GetDrawings()):               # board-level silk: grids, labels, branding, pin-1 dots
    if d.GetLayer() != FS:
        continue
    if isinstance(d, pcbnew.PCB_TEXT):
        if d.GetText() in CHIP.values():
            chip_labels.append(d); continue
        p = d.GetPosition(); obstacles.append(textest(d.GetText(), TM(p.x), TM(p.y), TM(d.GetTextHeight())))
    elif isinstance(d, pcbnew.PCB_SHAPE):
        obstacles.append(shape_box(d))


def overlap_area(a, c):
    ix = max(0, min(a[2], c[2]) - max(a[0], c[0])); iy = max(0, min(a[3], c[3]) - max(a[1], c[1]))
    return ix*iy


def boxfor(x, y, hw, hh, ang):                 # text box; rotated 90 swaps the extents
    return [x-hh, y-hw, x+hh, y+hw] if ang == 90 else [x-hw, y-hh, x+hw, y+hh]


def place(setpose, s, h, pbx):
    # ADJACENCY IS MANDATORY: the ref/label MUST hug its own part so it's obvious which part it belongs to.
    # Try the 4 sides (above/below horizontal; left/right rotated 90 so they hug a narrow part), with only
    # small slides ALONG the edge -- never step perpendicular away. If nothing is clear, take the
    # least-overlapping side (still adjacent). Never fling the ref off into open board.
    L, T, R, B = pbx; cx = (L+R)/2; cy = (T+B)/2; pw = R-L; ph = B-T; g = 0.22
    _, hw, hh = textbox(s, cx, cy, h)
    prim = [(cx, T-g-hh, 0), (cx, B+g+hh, 0), (R+g+hh, cy, 90), (L-g-hh, cy, 90)]
    cand = list(prim)
    for d in (0.4, 0.8, 1.2, 1.6):             # slide along the edge only, bounded to stay over the part
        if d <= max(pw/2, 0.5) + 0.5:
            cand += [(cx-d, T-g-hh, 0), (cx+d, T-g-hh, 0), (cx-d, B+g+hh, 0), (cx+d, B+g+hh, 0)]
        if d <= max(ph/2, 0.5) + 0.5:
            cand += [(R+g+hh, cy-d, 90), (R+g+hh, cy+d, 90), (L-g-hh, cy-d, 90), (L-g-hh, cy+d, 90)]
    cand += [(R+g+hw, cy, 0), (L-g-hw, cy, 0)]  # last resort: horizontal to the side (a touch wider, still adjacent)
    for x, y, ang in cand:
        t = boxfor(x, y, hw, hh, ang)
        if t[0] < EX0 or t[2] > EX1 or t[1] < EY0 or t[3] > EY1:
            continue
        if any(overlap(t, o) for o in obstacles):
            continue
        setpose(x, y, ang); obstacles.append(t); return True
    best = None                                # fallback: least-overlap side, prefer on-board -- ALWAYS adjacent
    for x, y, ang in prim:
        t = boxfor(x, y, hw, hh, ang)
        edge = 100 if (t[0] < EX0 or t[2] > EX1 or t[1] < EY0 or t[3] > EY1) else 0
        a = edge + sum(overlap_area(t, o) for o in obstacles)
        if best is None or a < best[0]: best = (a, x, y, ang, t)
    _, x, y, ang, t = best
    setpose(x, y, ang); obstacles.append(t); return False


# smallest parts first (least room) so they claim a spot before the big ones
movers = sorted([f for f in ALL_FP if is_movable(f.GetReference()) and f.GetReference() in PBOX],
                key=lambda f: (PBOX[f.GetReference()][2]-PBOX[f.GetReference()][0]) *
                              (PBOX[f.GetReference()][3]-PBOX[f.GetReference()][1]))
placed = far = 0
chip_jobs = []
for f in movers:                              # Phase 1: position refs (SetPosition only)
    ref = f.GetReference(); rt = f.Reference()
    rt.SetTextHeight(FM(REFH)); rt.SetTextWidth(FM(REFH*0.8)); rt.SetTextThickness(FM(0.12))
    rt.SetHorizJustify(pcbnew.GR_TEXT_H_ALIGN_CENTER)
    def setp(x, y, a, _rt=rt):
        _rt.SetTextAngleDegrees(a); _rt.SetPosition(pcbnew.VECTOR2I(FM(x), FM(y)))
    ok = place(setp, ref, REFH, PBOX[ref])
    placed += 1; far += 0 if ok else 1
    if ref in CHIP:
        chip_jobs.append((ref, PBOX[ref]))
used = set()                                  # Phase 2: reposition the EXISTING chip labels (SetPosition only)
moved_labels = 0
for ref, pbx in chip_jobs:
    cx = (pbx[0]+pbx[2])/2; cy = (pbx[1]+pbx[3])/2
    cands = [L for L in chip_labels if L.GetText() == CHIP[ref] and id(L) not in used]
    if not cands:
        continue
    L = min(cands, key=lambda l: (TM(l.GetPosition().x)-cx)**2 + (TM(l.GetPosition().y)-cy)**2)
    used.add(id(L))
    L.SetTextHeight(FM(0.85)); L.SetTextWidth(FM(0.68)); L.SetTextThickness(FM(0.12))
    L.SetHorizJustify(pcbnew.GR_TEXT_H_ALIGN_CENTER)
    def setpL(x, y, a, _L=L):
        _L.SetTextAngleDegrees(a); _L.SetPosition(pcbnew.VECTOR2I(FM(x), FM(y)))
    place(setpL, CHIP[ref], 0.85, pbx)
    moved_labels += 1

pcbnew.SaveBoard(PCB, b)
print(f"placed {placed} movable ref-des + repositioned {moved_labels} chip labels; {far} fell back to overlap")
