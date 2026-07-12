#!/usr/bin/env python
"""Annotate every USED pad on the placed test-rig board with its function / GPIO on silk.

Operates on the existing (placed + routed) test_rig.kicad_pcb - it does NOT re-place or
re-route anything. Each label is a footprint-child text (moves/rotates with its part),
offset to the OUTER side of the part (away from the paired socket, or the board centre)
so it clears the plugged-in module. Idempotent: re-running first removes the labels it
added last time.

pcbnew's SWIG bindings here intermittently hand back raw SwigPyObjects, so the board is
loaded ONCE and every footprint is re-fetched fresh via FindFootprintByReference (the
pattern that stays stable); pad reads / writes / save each retry on a flake.

    "/c/Program Files/KiCad/10.0/bin/python.exe" add_pin_silk.py
Then re-run gen_fab_test_rig.py to refresh the gerbers with the new silk.
"""
import os, sys, math, pcbnew
from pcbnew import FromMM as MM, VECTOR2I as V

PCB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_rig.kicad_pcb")
TEXT_MM = 1.0        # legible + above the fab min silk height (0.8mm); fits at 2.54mm pitch
THICK_MM = 0.15
OFFSET_MM = 2.9      # base gap from pad to label near-edge (moved 1.5mm further out per request)
FLAKE = (TypeError, AttributeError)

# ref -> {pad number: short function/GPIO label}  (only the pins we actually use)
LABELS = {
    "J_PICOA": {1: "GP0 RX", 2: "GP1 TX", 3: "GND", 4: "GP2 EN", 8: "GND", 13: "GND", 18: "GND"},
    "J_PICOB": {2: "VSYS 5V", 3: "GND", 5: "3V3", 8: "GND", 9: "GP27 A1", 10: "GP26 A0",
                13: "GND", 18: "GND"},
    "J_485A_L": {1: "GND", 2: "TXD/DI", 3: "RXD/RO", 4: "VCC", 5: "EN"},
    "J_485A_R": {2: "B", 3: "A", 4: "GND"},
    "J_485B_R": {2: "B", 3: "A", 4: "GND"},
    "J_485B_L": {1: "GND", 2: "TXD/DI", 3: "RXD/RO", 4: "VCC", 5: "EN"},
    "J_S3A": {1: "3V3", 2: "3V3", 10: "IO17 TX", 11: "IO18 RX", 12: "IO8 EN", 15: "IO9 RST",
              16: "IO10 CS", 17: "IO11 MOSI", 18: "IO12 SCLK", 19: "IO13 MISO",
              20: "IO14 INT", 21: "5V", 22: "GND"},
    "J_S3B": {1: "GND", 21: "GND", 22: "GND"},
    "J_W5500": {2: "5V", 3: "MISO", 4: "GND", 5: "MOSI", 6: "RST", 7: "CS", 8: "INT", 9: "SCLK"},
    "J_MEAS": {1: "A", 2: "B", 3: "3V3", 4: "GND", 5: "5V", 6: "TX", 7: "RX"},
    "J_LA": {1: "A", 2: "GND", 3: "B", 4: "GND", 5: "simTX", 6: "GND", 7: "simRX", 8: "GND",
             9: "simEN", 10: "GND", 11: "s3TX", 12: "GND", 13: "s3RX", 14: "GND",
             15: "s3EN", 16: "GND"},
    "J_TERM": {1: "A", 2: "B", 3: "GND"},
    "Rb1": {1: "A", 2: "3V3"}, "Rb2": {1: "B", 2: "GND"},
    "Rd1": {1: "A", 2: "A1"}, "Rd2": {1: "A1", 2: "GND"},
    "Rd3": {1: "B", 2: "A0"}, "Rd4": {1: "A0", 2: "GND"},
}
TWO_COL = {"J_W5500", "J_LA"}      # label each row toward its own outer side
PARTNER = {"J_PICOA": "J_PICOB", "J_PICOB": "J_PICOA", "J_S3A": "J_S3B", "J_S3B": "J_S3A",
           "J_485A_L": "J_485A_R", "J_485A_R": "J_485A_L", "J_485B_L": "J_485B_R", "J_485B_R": "J_485B_L"}


def load_board():
    for _ in range(40):
        b = pcbnew.LoadBoard(PCB)
        if type(b).__name__ == "BOARD":
            return b
    raise SystemExit("LoadBoard kept returning a raw SwigPyObject")


def read_pads(b, ref, wanted):
    """(num,x,y) for the wanted pads, plus the footprint orientation. Retries on flake."""
    for _ in range(40):
        fp = b.FindFootprintByReference(ref)
        try:
            out = []
            for p in fp.Pads():
                n = int(p.GetNumber() or 0)
                if n in wanted:
                    pos = p.GetPosition(); out.append((n, pos.x, pos.y))
            return out, fp.GetOrientationDegrees()
        except FLAKE:
            continue
    raise SystemExit(f"read_pads: could not read {ref}")


def write_labels(b, ref, items):
    """items: list of (label_x_nm, label_y_nm, angle, text). Idempotent per footprint."""
    for _ in range(40):
        fp = b.FindFootprintByReference(ref)
        try:
            for it in list(fp.GraphicalItems()):
                if isinstance(it, pcbnew.PCB_TEXT) and not isinstance(it, pcbnew.PCB_FIELD):
                    fp.Remove(it)
            for lx, ly, ang, txt in items:
                t = pcbnew.PCB_TEXT(fp)
                t.SetText(txt)
                t.SetLayer(pcbnew.F_SilkS)
                t.SetTextSize(V(MM(TEXT_MM), MM(TEXT_MM)))
                t.SetTextThickness(MM(THICK_MM))
                t.SetHorizJustify(pcbnew.GR_TEXT_H_ALIGN_CENTER)
                t.SetVertJustify(pcbnew.GR_TEXT_V_ALIGN_CENTER)
                t.SetPosition(V(int(lx), int(ly)))
                t.SetTextAngleDegrees(ang)
                fp.Add(t)
            return len(items)
        except FLAKE:
            continue
    raise SystemExit(f"write_labels: could not annotate {ref}")


def main():
    # pcbnew's write path corrupts after a batch of calls, so this can be run for ONE
    # footprint at a time (arg = ref) in a fresh process; reads (all pads) stay stable.
    target = sys.argv[1] if len(sys.argv) > 1 else None
    b = load_board()
    # 1) read all pad geometry into plain tuples (no pcbnew objects held across steps)
    pads = {}      # ref -> [(num,x,y)]
    orient = {}    # ref -> degrees
    allpts = []
    for ref in LABELS:
        if b.FindFootprintByReference(ref) is None:
            print("  (skip, not on board:", ref, ")"); continue
        pads[ref], orient[ref] = read_pads(b, ref, LABELS[ref])
        allpts += [(x, y) for _, x, y in pads[ref]]
    bcx = sum(p[0] for p in allpts) / len(allpts)
    bcy = sum(p[1] for p in allpts) / len(allpts)

    def centroid(ref):
        pts = pads[ref]
        return (sum(p[1] for p in pts) / len(pts), sum(p[2] for p in pts) / len(pts))

    # 2) compute label placements (pure python)
    total = 0
    for ref, m in LABELS.items():
        if ref not in pads:
            continue
        if target and ref != target:
            continue
        cx, cy = centroid(ref)
        Sxx = Syy = Sxy = 0.0
        for _, x, y in pads[ref]:
            dx, dy = x - cx, y - cy
            Sxx += dx * dx; Syy += dy * dy; Sxy += dx * dy
        theta = 0.5 * math.atan2(2 * Sxy, Sxx - Syy)
        minor = (-math.sin(theta), math.cos(theta))     # perpendicular to the pad row
        if ref in PARTNER and PARTNER[ref] in pads:
            rcx, rcy = centroid(PARTNER[ref])
        else:
            rcx, rcy = bcx, bcy
        gside = 1.0 if ((cx - rcx) * minor[0] + (cy - rcy) * minor[1]) >= 0 else -1.0
        ang = 90.0 if (round(orient[ref] / 90.0) % 2 == 1) else 0.0

        # ONE offset distance per footprint (sized for its longest label) so every label
        # centre lands on a neat line parallel to the pad row - keeps them from bunching.
        maxlen = max(len(m[num]) for num, _, _ in pads[ref])
        D = MM(OFFSET_MM + maxlen * TEXT_MM * 0.38)
        items = []
        for num, x, y in pads[ref]:
            txt = m[num]
            if ref in TWO_COL:
                proj = (x - cx) * minor[0] + (y - cy) * minor[1]
                side = 1.0 if proj >= 0 else -1.0
            else:
                side = gside
            items.append((x + side * minor[0] * D, y + side * minor[1] * D, ang, txt))
        total += write_labels(b, ref, items)

    for _ in range(40):
        try:
            pcbnew.SaveBoard(PCB, b); break
        except FLAKE:
            continue
    else:
        raise SystemExit("SaveBoard kept flaking")
    print(f"pin-function silk: {total} labels at {TEXT_MM}mm, saved {os.path.basename(PCB)}")


if __name__ == "__main__":
    main()
