"""Stamp the board branding onto the REAL silkscreen (F.Silkscreen) so it actually prints:
   line 1:  LuxDMX v<VERSION>
   line 2:  luxdmx.org

Single source of truth = HW_VERSION in hw_version.py (the hardware version, SEPARATE from
the firmware version). Bump it there and re-run; the script is idempotent (it removes any
prior LuxDMX/github silk on ANY layer first, incl. the stray User.Drawings copy KiCad
creates when you "add text" without picking the silk layer). Free drawings survive
build_v3.py / sync_board.py (they only wipe footprints/zones/tracks), so this only needs
re-running when HW_VERSION changes. Text height matches the unified 1.0mm board silk. KiCad 10."""
import pcbnew
from hw_version import HW_VERSION      # hardware (PCB) revision -- source of truth

PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb" 
FM = pcbnew.FromMM
VERSION = HW_VERSION
WEB_URL = "luxdmx.org"

LINES = [                             # (text, x_mm, y_mm)  centred anchor
    (f"LuxDMX v{VERSION}", 122.5, 176.0),
    (WEB_URL,                122.5, 178.0),
]
H = 1.0          # mm, matches board silk standard
TH = 0.15        # mm stroke

b = pcbnew.LoadBoard(PCB)

# idempotent: drop any earlier branding text on any layer
for d in list(b.GetDrawings()):
    if isinstance(d, pcbnew.PCB_TEXT):
        t = d.GetText().lower()
        if t.startswith("luxdmx") or "luxdmx.org" in t or "github.com" in t:
            b.Remove(d)

for text, x, y in LINES:
    t = pcbnew.PCB_TEXT(b)
    t.SetText(text)
    t.SetLayer(pcbnew.F_SilkS)
    t.SetPosition(pcbnew.VECTOR2I(FM(x), FM(y)))
    t.SetTextHeight(FM(H)); t.SetTextWidth(FM(H)); t.SetTextThickness(FM(TH))
    t.SetHorizJustify(pcbnew.GR_TEXT_H_ALIGN_CENTER)
    b.Add(t)
    print(f"  F.Silkscreen ({x},{y}) '{text}'")

# hardware versioning in the board metadata: title-block Revision prints on the fab drawing.
# Build a fresh TITLE_BLOCK + SetTitleBlock -- GetTitleBlock() returns a read-only handle
# after the board has been mutated above.
tb = pcbnew.TITLE_BLOCK()
tb.SetTitle("LuxDMX")
tb.SetRevision(f"v{VERSION}")
tb.SetCompany(WEB_URL)
b.SetTitleBlock(tb)
print(f"  title block: title='LuxDMX' rev='v{VERSION}' company='{WEB_URL}'")

pcbnew.SaveBoard(PCB, b)
print(f"branding stamped: LuxDMX v{VERSION} + {GITHUB}")
