"""Add human-readable F.Silkscreen function labels next to each connector + keep the branding on-board.
Labels are positioned RELATIVE to the live footprint positions (read from the board) so they follow parts
when you move them -- just re-run after a placement change. Idempotent (removes its own previously-added
text by content first). KiCad 10.

NB: the STATUS-LED legend and the J4/J6 pinout grids live in add_port_pinout_silk.py (the gridded silk
tables). This script no longer touches them, so the hand-placed LED table stays where it is."""
import pcbnew
from hw_version import HW_VERSION
PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
b = pcbnew.LoadBoard(PCB)

# ref -> (label, dx, dy, rot)  offset in mm from the footprint centre, toward open silk
LABELS = {
    "J1": ("DMX-OUT A", -10.5, 0.0, 90),   # XLR-5 universe 1, left of the connector (vertical)
    "J5": ("DMX-OUT B", -10.5, 0.0, 90),   # XLR-5 universe 2
    "J3": ("ETHERNET 10/100", 1.0, -8.5, 0),  # RJ45 magjack, above
    "J2": ("USB-C", 0.0, -5.0, 0),         # USB-C inlet, above
    # J4 (display) + J6 (expansion) get per-pin pinout grids instead — see add_port_pinout_silk.py
}
BRAND = [f"LuxDMX v{HW_VERSION}", "github.com/tombueng/LuxDMX"]

# read all footprint positions BEFORE mutating the board (re-reading after Remove() returns
# raw SwigPyObjects). branding bottom-left.
POS = {ref: (TM(f.GetPosition().x), TM(f.GetPosition().y))
       for ref in LABELS if (f := b.FindFootprintByReference(ref))}
BR_X, BR_Y = 116.0, 163.0

# idempotent: drop ANY earlier connector-label / branding copy (match by keyword). Deliberately does NOT
# include the LED-legend keywords -- that table is owned by add_port_pinout_silk.py and must not be moved.
_kw = ("dmx-out", "ethernet", "usb-c", "display", "exp i/o", "luxdmx", "github.com")
for d in list(b.GetDrawings()):
    if isinstance(d, pcbnew.PCB_TEXT) and any(k in d.GetText().lower() for k in _kw):
        b.Remove(d)

def text(s, x, y, h, rot=0, left=False):
    t = pcbnew.PCB_TEXT(b); t.SetText(s); t.SetLayer(pcbnew.F_SilkS)
    t.SetPosition(pcbnew.VECTOR2I(FM(x), FM(y)))
    t.SetTextHeight(FM(h)); t.SetTextWidth(FM(h)); t.SetTextThickness(FM(max(0.1, h*0.13)))
    t.SetHorizJustify(pcbnew.GR_TEXT_H_ALIGN_LEFT if left else pcbnew.GR_TEXT_H_ALIGN_CENTER)
    if rot: t.SetTextAngleDegrees(rot)
    b.Add(t)

for ref, (txt, dx, dy, rot) in LABELS.items():
    if ref not in POS: print(f"  ?? {ref} missing"); continue
    cx, cy = POS[ref]; text(txt, cx+dx, cy+dy, 0.9, rot)
for i, line in enumerate(BRAND):
    text(line, BR_X, BR_Y + i*1.4, 1.0, left=True)

pcbnew.SaveBoard(PCB, b)
print(f"placed {len(LABELS)} connector labels (relative) + branding (LED legend = add_port_pinout_silk.py)")
