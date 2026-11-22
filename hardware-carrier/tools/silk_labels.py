#!/usr/bin/env python3
"""Silkscreen labels that are not part of any footprint's own artwork.

  * board revision: "rev X.Y" on the front between the two buttons, and
    "LuxDMX carrier rev X.Y" on the back along the bottom edge. REV below is the one place the
    number lives; bump it for every board change that gets pushed, then re-run this script and
    regenerate the production files. The README and the BOM pick it up from here.
  * pixel ports: the terminals' references ("Pixel1:Vcc/Data/GND" ...) stay as they are (BOM, CPL
    and ASSEMBLY.md use them), but their silk is hidden: 19 characters on a 16.26 mm terminal
    pitch ran into each other and into the buttons' pads. Each terminal gets a short "PIXn" inside
    its body outline instead, above the screw pads, with its "+" and "-" moved up next to it:
    they used to sit on the pads, where the fab clips them away.
  * pixel inlet: "+" and "-" over its two pads, same band. The two loose marks at x 91.5 went:
    the "-" sat nearest the PLUS pads and read as reverse polarity.
  * DMX headers: the references ("DMX 1 - GND/B/A") ran across the pads and off the edge. Hidden;
    each header gets "DMXn" and, under it, "G B A" (its pins left to right) beside pin 1.
  * odd sizes: the polyfuse's BRIDGE text 0.7 -> 0.8 mm, the OLED outline note had stroke 0.

Idempotent: texts are found again by their content and moved/updated, never doubled.
Silk only, no copper is touched.

Run:  python tools/silk_labels.py
"""
import os
import re
import sys

import pcbnew

REV = "1.1"

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARD = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")

# (layer, text, x, y, size, thickness): board mm
REV_TEXTS = [
    (pcbnew.F_SilkS, "rev {rev}", 169.25, 122.2, 1.5, 0.25),
    (pcbnew.B_SilkS, "LuxDMX carrier  rev {rev}", 138.0, 126.3, 1.6, 0.25),
]
REV_RE = re.compile(r"rev \d+\.\d+$")

PIX_RE = re.compile(r"Pixel(\d):Vcc/Data/GND$")
PIX_DX, PIX_DY = -1.0, 2.15   # from the hidden reference (just above the body) into the body,
                              # 1 mm left so PIX5 clears the GND via at 177.0, 125.6
PIX_SIZE, PIX_THICK = 1.2, 0.2


def mm(v):
    return pcbnew.FromMM(v)


def rev_texts(b):
    have = {}
    for d in b.GetDrawings():
        if d.GetClass() == "PCB_TEXT" and REV_RE.search(d.GetText()):
            have[d.GetLayer()] = d
    for layer, fmt, x, y, size, thick in REV_TEXTS:
        t = have.get(layer)
        if t is None:
            t = pcbnew.PCB_TEXT(b)
            t.SetLayer(layer)
            b.Add(t)
        t.SetText(fmt.format(rev=REV))
        t.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
        t.SetTextSize(pcbnew.VECTOR2I(mm(size), mm(size)))
        t.SetTextThickness(mm(thick))
        t.SetHorizJustify(pcbnew.GR_TEXT_H_ALIGN_CENTER)
        t.SetVertJustify(pcbnew.GR_TEXT_V_ALIGN_CENTER)
        t.SetMirrored(layer == pcbnew.B_SilkS)
        print(f"  {pcbnew.LayerName(layer):14s} {t.GetText()!r} at {x}, {y}")


def pixel_labels(b):
    for f in b.GetFootprints():
        m = PIX_RE.match(f.GetReference())
        if not m:
            continue
        label = f"PIX{m.group(1)}"
        ref = f.Reference()
        # where the reference sat before it was hidden: the terminal's centre line
        rp = ref.GetPosition()
        x, y = rp.x + mm(PIX_DX), rp.y + mm(PIX_DY)
        old = [g for g in f.GraphicalItems()
               if g.GetClass() == "PCB_TEXT" and re.fullmatch(r"PIX\d", g.GetText())]
        if old:
            t = old[0]
        else:
            t = pcbnew.PCB_TEXT(f)
            t.SetLayer(pcbnew.F_SilkS)
            f.Add(t)
        t.SetText(label)
        t.SetPosition(pcbnew.VECTOR2I(x, y))
        t.SetTextSize(pcbnew.VECTOR2I(mm(PIX_SIZE), mm(PIX_SIZE)))
        t.SetTextThickness(mm(PIX_THICK))
        t.SetHorizJustify(pcbnew.GR_TEXT_H_ALIGN_CENTER)
        t.SetVertJustify(pcbnew.GR_TEXT_V_ALIGN_CENTER)
        ref.SetVisible(False)
        p = t.GetPosition()
        print(f"  {f.GetReference():22s} -> {label} at {pcbnew.ToMM(p.x):.2f}, {pcbnew.ToMM(p.y):.2f}")


BAND_Y = 126.1                  # the strip inside the terminal bodies, above the screw pads
MARK_SIZE = 1.2
INLET = "12-24V IN"
STRAY_MARKS = [(91.5, 110.5), (91.5, 123.5)]
REMOVE = []
REMOVE_FP = []
DMX_RE = re.compile(r"DMX (\d) - GND/B/A$")


def board_text(b, layer, text, x, y, size, thick, find=None):
    """Board-level text, found again by `find` (x, y within 0.05) or by content near (x, y)."""
    t = None
    for d in b.GetDrawings():
        if d.GetClass() != "PCB_TEXT" or d.GetLayer() != layer:
            continue
        q = d.GetPosition()
        qx, qy = pcbnew.ToMM(q.x), pcbnew.ToMM(q.y)
        if find and abs(qx - find[0]) < 0.05 and abs(qy - find[1]) < 0.05 and d.GetText() == text:
            t = d
        elif d.GetText() == text and abs(qx - x) < 0.05 and abs(qy - y) < 0.05:
            t = d
    if t is None:
        t = pcbnew.PCB_TEXT(b)
        t.SetLayer(layer)
        b.Add(t)
    t.SetText(text)
    t.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
    t.SetTextSize(pcbnew.VECTOR2I(mm(size), mm(size)))
    t.SetTextThickness(mm(thick))
    t.SetHorizJustify(pcbnew.GR_TEXT_H_ALIGN_CENTER)
    t.SetVertJustify(pcbnew.GR_TEXT_V_ALIGN_CENTER)
    return t


def polarity_marks(b):
    # pixel terminals: "+"/"-" that sat on the pads at y ~134.3 move up into the band
    for d in list(b.GetDrawings()):
        if d.GetClass() == "PCB_TEXT" and d.GetLayer() == pcbnew.F_SilkS and d.GetText() in "+-":
            q = d.GetPosition()
            x, y = pcbnew.ToMM(q.x), pcbnew.ToMM(q.y)
            if y > 133.5 and x > 103:
                d.SetPosition(pcbnew.VECTOR2I(q.x, mm(BAND_Y)))
                d.SetTextSize(pcbnew.VECTOR2I(mm(MARK_SIZE), mm(MARK_SIZE)))
                d.SetTextThickness(mm(0.2))
            elif any(abs(x - sx) < 0.05 and abs(y - sy) < 0.05 for sx, sy in STRAY_MARKS):
                REMOVE.append(d)        # removed last: Remove() mid-run breaks pcbnew's iterators
                print(f"  removing stray {d.GetText()!r} at {x}, {y}")
    inlet = next(f for f in b.GetFootprints() if f.GetReference() == INLET)
    for pad in inlet.Pads():
        net = pad.GetNetname()
        mark = "+" if net == "V_PIX_IN" else "-" if net == "GND" else None
        if mark:
            x = pcbnew.ToMM(pad.GetPosition().x)
            board_text(b, pcbnew.F_SilkS, mark, x, BAND_Y, MARK_SIZE, 0.2)
            print(f"  inlet {mark} over pad {pad.GetNumber()} ({net}) at {x:.2f}")


def dmx_labels(b):
    for f in b.GetFootprints():
        m = DMX_RE.match(f.GetReference())
        if not m:
            continue
        f.Reference().SetVisible(False)
        old = {g.GetText(): g for g in f.GraphicalItems() if g.GetClass() == "PCB_TEXT"}
        pads = sorted((p for p in f.Pads() if p.GetNetname()), key=lambda p: p.GetPosition().x)
        # Pin letters, in pad order left to right, as one line under "DMXn" left of pin 1.
        # There is no room under the pads themselves (the pads run to 0.9 mm from the body line)
        # and right of DMX3 is the 5V IN label.
        letters = " ".join("G" if p.GetNetname() == "GND" else p.GetNetname()[-1] for p in pads)
        for g in old.values():
            if g.GetText() in ("G", "B", "A"):        # single letters from an earlier layout
                REMOVE_FP.append((f, g))
        first = pads[0].GetPosition()
        x = first.x - mm(4.6)
        want = [(f"DMX{m.group(1)}", x, mm(58.0), 1.2, 0.2),
                (letters, x, mm(60.45), 1.0, 0.18)]
        for text, x, y, size, thick in want:
            t = old.get(text)
            if t is None:
                t = pcbnew.PCB_TEXT(f)
                t.SetLayer(pcbnew.F_SilkS)
                f.Add(t)
            t.SetText(text)
            t.SetPosition(pcbnew.VECTOR2I(x, y))
            t.SetTextAngleDegrees(0)
            t.SetTextSize(pcbnew.VECTOR2I(mm(size), mm(size)))
            t.SetTextThickness(mm(thick))
            t.SetHorizJustify(pcbnew.GR_TEXT_H_ALIGN_CENTER)
            t.SetVertJustify(pcbnew.GR_TEXT_V_ALIGN_CENTER)
        print(f"  {f.GetReference():18s} -> " + " / ".join(w[0] for w in want))


def odd_sizes(b):
    for f in b.GetFootprints():
        for g in f.GraphicalItems():
            if g.GetClass() == "PCB_TEXT" and g.GetText() == "BRIDGE":
                g.SetTextSize(pcbnew.VECTOR2I(mm(0.8), mm(0.8)))
                g.SetTextThickness(mm(0.15))
    for d in b.GetDrawings():
        if d.GetClass() == "PCB_TEXT" and d.GetText().startswith("OLED ") and d.GetTextThickness() == 0:
            d.SetTextThickness(mm(0.18))


def main():
    b = pcbnew.LoadBoard(BOARD)
    rev_texts(b)
    pixel_labels(b)
    polarity_marks(b)
    dmx_labels(b)
    odd_sizes(b)
    for d in REMOVE:
        b.Remove(d)
    for f, g in REMOVE_FP:
        f.Remove(g)
    pcbnew.SaveBoard(BOARD, b)
    return 0


if __name__ == "__main__":
    sys.exit(main())
