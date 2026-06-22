"""Normalize F.Silkscreen: (1) move every small-part reference designator to a consistent side (above the
part, horizontal, 0.8mm) with a 4-side collision fallback (below/right/left) for the ones that won't fit;
(2) add a function label next to each big chip (ESP32-S3, W5500, CH340, buck, ISO485 x2, PoE, B0505S x2).
Idempotent for the chip labels. Run standalone after placement. KiCad 10 python.

Does NOT touch: the connector pinout silk / LED grid / key-features grid (add_port_pinout_silk.py owns
those), the branding, or the mounting-hole 'M? GND' labels."""
import pcbnew
PCB = r"C:\dev\DMX\hardware\lumigate.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
FS = pcbnew.F_SilkS
b = pcbnew.LoadBoard(PCB)

CHIP = {"U1": "ESP32-S3", "U2": "W5500 ETH", "U3": "USB-UART", "U4": "3V3 BUCK", "U5": "DMX1 ISO485",
        "U6": "DMX2 ISO485", "U7": "PoE PD", "U8": "USB ESD", "PS1": "ISO 5V", "PS2": "ISO 5V"}
SMALL0 = ("R", "C", "L", "F", "D", "Q", "Y")   # 2-3 pin small parts whose ref-des we normalize
REFH = 0.8

bb = b.GetBoardEdgesBoundingBox()
EX0, EY0, EX1, EY1 = TM(bb.GetLeft())+0.3, TM(bb.GetTop())+0.3, TM(bb.GetRight())-0.3, TM(bb.GetBottom())-0.3


def cbox(f):
    r = f.GetCourtyard(pcbnew.F_CrtYd).BBox()
    if r.GetWidth():
        return [TM(r.GetLeft()), TM(r.GetTop()), TM(r.GetRight()), TM(r.GetBottom())]
    ps = list(f.Pads())
    return [min(TM(p.GetBoundingBox().GetLeft()) for p in ps), min(TM(p.GetBoundingBox().GetTop()) for p in ps),
            max(TM(p.GetBoundingBox().GetRight()) for p in ps), max(TM(p.GetBoundingBox().GetBottom()) for p in ps)]


parts = [(f.GetReference(), cbox(f)) for f in b.GetFootprints() if not f.GetReference().startswith("MH")]
PB = dict(parts)
obstacles = [bx for _, bx in parts]          # part bodies; placed labels get appended as we go


def tbox(s, x, y, h):
    w = len(s)*h*0.62
    return [x-w/2, y-h/2, x+w/2, y+h/2]


def overlap(a, c, m=0.15):
    return not (a[2]+m < c[0] or c[2]+m < a[0] or a[3]+m < c[1] or c[3]+m < a[1])


def best_pos(part_bx, s, h, skip_self_ref=None):
    cx = (part_bx[0]+part_bx[2])/2; cy = (part_bx[1]+part_bx[3])/2; g = 0.35
    hw = len(s)*h*0.62/2
    cands = [(cx, part_bx[1]-h/2-g), (cx, part_bx[3]+h/2+g),
             (part_bx[2]+g+hw, cy), (part_bx[0]-g-hw, cy)]
    for x, y in cands:
        t = tbox(s, x, y, h)
        if t[0] < EX0 or t[2] > EX1 or t[1] < EY0 or t[3] > EY1:
            continue
        if any(overlap(t, o) for o in obstacles):
            continue
        return x, y, t
    x, y = cands[0]
    return x, y, tbox(s, x, y, h)          # fallback: above (may overlap on a dense corner)


def mktext(s, x, y, h):
    t = pcbnew.PCB_TEXT(b); t.SetText(s); t.SetLayer(FS)
    t.SetPosition(pcbnew.VECTOR2I(FM(x), FM(y)))
    t.SetTextHeight(FM(h)); t.SetTextWidth(FM(h*0.8)); t.SetTextThickness(FM(0.12))
    t.SetHorizJustify(pcbnew.GR_TEXT_H_ALIGN_CENTER); b.Add(t)


# remove old chip labels (idempotent)
for d in list(b.GetDrawings()):
    if isinstance(d, pcbnew.PCB_TEXT) and d.GetLayer() == FS and d.GetText() in CHIP.values():
        b.Remove(d)

# (1) normalize small-part reference designators
nref = 0
for f in b.GetFootprints():
    ref = f.GetReference()
    if ref.startswith("MH") or not ref or ref[0] not in SMALL0:
        continue
    if ref in CHIP:        # PS1/PS2 etc. handled as chips
        continue
    rt = f.Reference()
    x, y, t = best_pos(PB[ref], ref, REFH, skip_self_ref=ref)
    rt.SetTextHeight(FM(REFH)); rt.SetTextWidth(FM(REFH*0.8)); rt.SetTextThickness(FM(0.12))
    rt.SetTextAngleDegrees(0)
    rt.SetPosition(pcbnew.VECTOR2I(FM(x), FM(y)))
    obstacles.append(t); nref += 1

# (2) chip function labels
nlab = 0
for ref, lab in CHIP.items():
    if ref not in PB:
        continue
    x, y, t = best_pos(PB[ref], lab, 0.9)
    mktext(lab, x, y, 0.9); obstacles.append(t); nlab += 1

pcbnew.SaveBoard(PCB, b)
print(f"normalized {nref} small ref-des to a consistent side + added {nlab} chip function labels")
