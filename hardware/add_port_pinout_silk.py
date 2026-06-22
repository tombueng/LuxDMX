"""Connector pinout silk for the two SH9 headers (J6 expansion, J4 display).

FRONT (F.Silk): the connector name ("Expansion" / "Display") + a filled pin-1 dot and a "1" next to
pin 1, so you can orient the cable without flipping the board.
BACK (B.Silk, mirrored): a full gridded table per connector (PIN | FUNCTION | GPIO) in a big readable
font. Back silk is free at fab and the back is bare, so there's room to do it properly.

Idempotent (clears its own front+back silk first). Does NOT touch the LED legend / branding (those live
outside the connector region). Run standalone after placement. KiCad 10 python.
"""
import pcbnew
PCB = r"C:\dev\DMX\hardware\lumigate.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
FS, BS = pcbnew.F_SilkS, pcbnew.B_SilkS
b = pcbnew.LoadBoard(PCB)

# (pin, function, gpio)
J6 = [("1", "+5V", "-"), ("2", "+3V3", "-"), ("3", "GND", "-"), ("4", "GPIO", "35"), ("5", "GPIO", "36"),
      ("6", "GPIO", "37"), ("7", "GPIO", "48"), ("8", "GPIO", "19"), ("9", "GPIO", "20")]
J4 = [("1", "+3V3", "-"), ("2", "GND", "-"), ("3", "SDA", "4"), ("4", "SCL", "5"), ("5", "SCK", "39"),
      ("6", "MOSI", "40"), ("7", "CS", "41"), ("8", "DC", "42"), ("9", "RST", "38")]


def text(s, x, y, h, layer, rot=0, just=pcbnew.GR_TEXT_H_ALIGN_CENTER, mirror=False):
    t = pcbnew.PCB_TEXT(b); t.SetText(s); t.SetLayer(layer)
    t.SetPosition(pcbnew.VECTOR2I(FM(x), FM(y)))
    t.SetTextHeight(FM(h)); t.SetTextWidth(FM(h * 0.85)); t.SetTextThickness(FM(max(0.12, h * 0.15)))
    t.SetHorizJustify(just)
    if mirror: t.SetMirrored(True)
    if rot: t.SetTextAngleDegrees(rot)
    b.Add(t)


def line(x0, y0, x1, y1, layer, w=0.15):
    s = pcbnew.PCB_SHAPE(b); s.SetShape(pcbnew.SHAPE_T_SEGMENT); s.SetLayer(layer)
    s.SetStart(pcbnew.VECTOR2I(FM(x0), FM(y0))); s.SetEnd(pcbnew.VECTOR2I(FM(x1), FM(y1)))
    s.SetWidth(FM(w)); b.Add(s)


def dot(x, y, r, layer):
    c = pcbnew.PCB_SHAPE(b); c.SetShape(pcbnew.SHAPE_T_CIRCLE); c.SetLayer(layer)
    c.SetCenter(pcbnew.VECTOR2I(FM(x), FM(y))); c.SetEnd(pcbnew.VECTOR2I(FM(x + r), FM(y)))
    c.SetFilled(True); c.SetWidth(FM(0.12)); b.Add(c)


# ---- idempotent cleanup: do ALL removal in ONE pass up-front (a b.Remove/b.Add invalidates the
#      GetDrawings iterator, so we can't fetch it again after adding). Region-limited so the branding
#      stays. Covers: connector front labels + pin-1, the old plain LED legend, and all our back silk.
_LEDKW = ("status led", "fault", "network up", "dmx activ", "connecting", "identify", "no net")
for d in list(b.GetDrawings()):
    lay = d.GetLayer()
    if not isinstance(d, (pcbnew.PCB_TEXT, pcbnew.PCB_SHAPE)):
        continue
    x, y = TM(d.GetPosition().x), TM(d.GetPosition().y)
    s = d.GetText() if isinstance(d, pcbnew.PCB_TEXT) else ""
    if lay == FS and (s in ("DISPLAY", "EXP I/O", "Display", "Expansion", "1")
                      or (137 < x < 154 and 111 < y < 140)                 # connector silk
                      or any(k in s.lower() for k in _LEDKW)               # old plain LED legend
                      or (133 < x < 156 and 88.5 < y < 103.5)):            # LED grid region
        b.Remove(d)
    elif lay == BS:
        b.Remove(d)   # all board-level back silk is ours (footprint silk is not in GetDrawings)

# ---- FRONT: name labels + pin-1 markers ----
text("Expansion", 145.0, 114.3, 1.0, FS)             # above J6 (pads at y122)
text("Display", 145.0, 127.9, 1.0, FS)               # in the gap above J4 (pads at y135.5)
for px, py in ((149.5, 122.0), (149.5, 135.5)):      # J6 pin1, J4 pin1 (rightmost pad)
    dot(151.0, py, 0.45, FS); text("1", 151.9, py, 0.9, FS)

# ---- BACK: gridded table per connector (mirrored). Columns file-order GPIO|FUNCTION|PIN so the
#      mirrored back view reads PIN | FUNCTION | GPIO left-to-right. ----
RH = 2.2                                              # row height
WG, WF, WP = 6.0, 11.0, 5.0                           # column widths (file L->R: GPIO, FUNCTION, PIN)
TW = WG + WF + WP                                     # table width = 22mm


def table(title, rows, X, Y):
    n = len(rows) + 1                                 # header + data rows
    bot = Y + n * RH
    # grid: horizontals + verticals
    for i in range(n + 1):
        line(X, Y + i * RH, X + TW, Y + i * RH, BS, 0.12)
    for vx in (X, X + WG, X + WG + WF, X + TW):
        line(vx, Y, vx, bot, BS, 0.12)
    cG, cF, cP = X + WG/2, X + WG + WF/2, X + WG + WF + WP/2
    # title (centered over the table)
    text(title, X + TW/2, Y - 1.6, 1.5, BS, mirror=True)
    # header
    yc = Y + RH/2
    text("GPIO", cG, yc, 1.15, BS, mirror=True); text("FUNCTION", cF, yc, 1.15, BS, mirror=True); text("PIN", cP, yc, 1.15, BS, mirror=True)
    # data
    for r, (pin, func, gpio) in enumerate(rows):
        yc = Y + (r + 1) * RH + RH/2
        text(gpio, cG, yc, 1.25, BS, mirror=True); text(func, cF, yc, 1.25, BS, mirror=True); text(pin, cP, yc, 1.25, BS, mirror=True)


table("EXPANSION  J6", J6, 106.0, 110.0)
table("DISPLAY  J4", J4, 132.0, 110.0)

# ---- FRONT: status-LED legend as a grid, at its current hand-placed spot (top-centre). NOT mirrored. ----
LED = [("RED", "FAULT / NO NET"), ("GRN", "NETWORK UP"), ("YEL", "DMX ACTIVITY"),
       ("BLU", "CONNECTING"), ("WHT", "IDENTIFY / BOOT")]
LX, LY, LWC, LWM, LRH = 134.5, 90.6, 6.5, 13.5, 1.85     # top-left, colour-col w, meaning-col w, row h
LTW = LWC + LWM
n = len(LED) + 1                                         # title row + 5 colours
for i in range(n + 1):
    line(LX, LY + i * LRH, LX + LTW, LY + i * LRH, FS, 0.12)
line(LX, LY, LX, LY + n * LRH, FS, 0.12); line(LX + LTW, LY, LX + LTW, LY + n * LRH, FS, 0.12)
line(LX + LWC, LY + LRH, LX + LWC, LY + n * LRH, FS, 0.12)        # colour/meaning divider (below title)
text("STATUS LEDS", LX + LTW / 2, LY + LRH / 2, 1.05, FS)
for r, (col, mean) in enumerate(LED):
    yc = LY + (r + 1) * LRH + LRH / 2
    text(col, LX + LWC / 2, yc, 1.0, FS)
    text(mean, LX + LWC + 0.6, yc, 0.95, FS, just=pcbnew.GR_TEXT_H_ALIGN_LEFT)

pcbnew.SaveBoard(PCB, b)
print("front: Expansion/Display + pin-1 + gridded STATUS-LED table; back: 2 gridded pinout tables")
